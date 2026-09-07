import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

/**
 * Local copies of cover images.
 *
 * Notion serves files through signed URLs that expire within the hour, so remembering a
 * URL keeps a cover alive for less than a day — after that every card has to ask Notion
 * again, one request per page. Keeping the bytes instead makes a cover permanent: resolved
 * once, served from here forever, with no further Notion traffic.
 */

const CACHE_DIR = path.join(process.cwd(), ".hallery-cache", "covers");
const THUMBNAIL_SUFFIX = ".thumbnail.webp";
const CARD_SUFFIX = ".card.webp";
const CACHE_BYTE_BUDGET = 512 * 1024 * 1024;
const MAX_CONCURRENT_JOBS = 3;
const MAINTENANCE_EVERY_WRITES = 16;

/** Bigger than this and we keep pointing at Notion rather than hoarding the bytes. */
const MAX_BYTES = 8 * 1024 * 1024;

/**
 * Give up on a slow download quickly. Notion's file host is not always reachable from
 * wherever Hallery runs, and without a bound every unreachable cover would stall its
 * request for the fetch default (~10s) before falling back to the Notion URL.
 */
const DOWNLOAD_TIMEOUT_MS = 5000;

const EXTENSION_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/svg+xml": "svg",
};

type DownloadedImage = { bytes: Buffer; contentType: string };
export type CoverVariants = { thumbnailFile: string; cardFile: string };

type CoverJob = {
  key: string;
  priority: number;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
};

const inFlightJobs = new Map<string, Promise<unknown>>();
const queuedJobs: CoverJob[] = [];
let activeJobs = 0;
let cacheWrites = 0;
let pruning: Promise<void> | null = null;

export const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_BY_TYPE).map(([type, ext]) => [ext, type]),
);

/**
 * Image work is CPU- and network-heavy. One queue makes every caller share a small fixed
 * budget instead of allowing a freshly opened Gallery to start dozens of Sharp jobs.
 */
function enqueueCoverJob<T>(key: string, priority: number, run: () => Promise<T>): Promise<T | null> {
  const existing = inFlightJobs.get(key);
  if (existing) return existing as Promise<T | null>;

  // Jobs are intentionally erased at the shared queue boundary. Every public caller
  // already models failure as null, which lets the drain recover one image without
  // poisoning the entire browser-visible request.
  const job: Promise<unknown> = new Promise((resolve) => {
    queuedJobs.push({ key, priority, run, resolve });
    queuedJobs.sort((left, right) => right.priority - left.priority);
    drainCoverJobs();
  });
  inFlightJobs.set(key, job);
  return job as Promise<T | null>;
}

function drainCoverJobs() {
  while (activeJobs < MAX_CONCURRENT_JOBS && queuedJobs.length > 0) {
    const next = queuedJobs.shift();
    if (!next) return;
    activeJobs += 1;
    void next
      .run()
      .catch(() => null)
      .then(next.resolve)
      .finally(() => {
        activeJobs -= 1;
        inFlightJobs.delete(next.key);
        drainCoverJobs();
      });
  }
}

async function writeCoverFile(filename: string, bytes: Buffer) {
  await mkdir(CACHE_DIR, { recursive: true });
  const target = path.join(CACHE_DIR, filename);
  const temporary = path.join(CACHE_DIR, `.${filename}.${process.pid}.${crypto.randomUUID()}.tmp`);
  try {
    await writeFile(temporary, bytes);
    await rename(temporary, target);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }

  cacheWrites += 1;
  if (cacheWrites % MAINTENANCE_EVERY_WRITES === 0) void scheduleCachePrune();
}

/** Prunes least-recently-used cache files outside the reader's request path. */
function scheduleCachePrune(): Promise<void> {
  if (pruning) return pruning;
  pruning = pruneCoverCache().finally(() => {
    pruning = null;
  });
  return pruning;
}

async function pruneCoverCache() {
  let names: string[];
  try {
    names = await readdir(CACHE_DIR);
  } catch {
    return;
  }

  const entries = await Promise.all(
    names
      .filter((name) => !name.endsWith(".tmp"))
      .map(async (name) => {
        const file = path.join(CACHE_DIR, name);
        try {
          const info = await stat(file);
          return info.isFile() ? { file, size: info.size, usedAt: info.mtimeMs } : null;
        } catch {
          return null;
        }
      }),
  );
  const files = entries.filter((entry): entry is { file: string; size: number; usedAt: number } => entry !== null);
  let total = files.reduce((sum, file) => sum + file.size, 0);
  if (total <= CACHE_BYTE_BUDGET) return;

  for (const file of files.sort((left, right) => left.usedAt - right.usedAt)) {
    await unlink(file.file).catch(() => undefined);
    total -= file.size;
    if (total <= CACHE_BYTE_BUDGET) return;
  }
}

function touchCoverFile(filename: string) {
  const now = new Date();
  void utimes(path.join(CACHE_DIR, filename), now, now).catch(() => undefined);
}

/** Notion page ids are uuids; refuse anything else so a page id can't escape the cache dir. */
export function isSafePageId(pageId: string): boolean {
  return /^[0-9a-fA-F-]{32,36}$/.test(pageId);
}

/**
 * Notion rotates S3 signature/expiry query parameters without changing the image. Keep
 * meaningful external-image query parameters intact, but remove only well-known volatile
 * signing keys so a cached derivative survives that harmless URL rotation.
 */
export function coverSourceFingerprint(sourceUrl: string): string {
  try {
    const url = new URL(sourceUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (/^(x-amz-|awsaccesskeyid$|signature$|expires$|security-token$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    url.search = [...url.searchParams.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
      .join("&");
    return url.toString();
  } catch {
    return sourceUrl;
  }
}

/**
 * Stops hammering a host that is not answering.
 *
 * Notion's file host is sometimes unreachable from where Hallery runs. Without this, a
 * gallery of ninety cards spends five seconds per card discovering that again — the
 * browser runs a handful at a time, so the whole grid stays busy for over a minute and the
 * server has no capacity left for the page the reader is trying to open. One failure now
 * speaks for the next minute, and a single probe after that decides whether to resume.
 */
const HOST_COOLDOWN_MS = 60 * 1000;
const unreachableUntil = new Map<string, number>();

/**
 * Forgets every cooldown, so a reader who has just fixed their connection does not have to
 * wait out a minute that is no longer true.
 */
export function clearHostCooldowns() {
  unreachableUntil.clear();
}

function hostIsCoolingDown(host: string): boolean {
  const until = unreachableUntil.get(host);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  unreachableUntil.delete(host);
  return false;
}

async function downloadCoverImage(sourceUrl: string): Promise<DownloadedImage | null> {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (hostIsCoolingDown(parsed.host)) return null;

    let response: Response;
    try {
      response = await fetch(sourceUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    } catch (error) {
      // A timeout or a refused connection is the host's problem, not this URL's, so it
      // counts against the host. An HTTP error below does not: that one URL may just be
      // expired while the host is perfectly fine.
      unreachableUntil.set(parsed.host, Date.now() + HOST_COOLDOWN_MS);
      throw error;
    }
    if (!response.ok) return null;

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BYTES) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return null;

    return {
      bytes,
      contentType: (response.headers.get("content-type") ?? "").split(";")[0].trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Downloads an image and keeps it. Returns the stored filename, or null when the fetch
 * fails or the file is too big to be worth storing — callers then fall back to the
 * (perishable) Notion URL.
 */
export async function storeCoverImage(pageId: string, sourceUrl: string): Promise<string | null> {
  if (!isSafePageId(pageId)) return null;
  return enqueueCoverJob(`original:${pageId}:${sourceUrl}`, 1, async () => {
    const downloaded = await downloadCoverImage(sourceUrl);
    if (!downloaded) return null;

    try {
      const extension = EXTENSION_BY_TYPE[downloaded.contentType] ?? "jpg";
      const filename = `${pageId}.${extension}`;
      await writeCoverFile(filename, downloaded.bytes);
      return filename;
    } catch {
      return null;
    }
  });
}

export async function readCoverImage(filename: string): Promise<Buffer | null> {
  // Guard against a stored name that tries to walk out of the cache directory.
  if (filename !== path.basename(filename)) return null;
  try {
    const bytes = await readFile(path.join(CACHE_DIR, filename));
    touchCoverFile(filename);
    return bytes;
  } catch {
    return null;
  }
}

/**
 * Creates a deliberately small preview for a card. The blur belongs in CSS so the same
 * source stays usable for any card ratio; WebP keeps the preview normally just a few KB.
 */
export async function storeCoverThumbnail(pageId: string, source: Buffer): Promise<string | null> {
  if (!isSafePageId(pageId)) return null;
  return enqueueCoverJob(`thumbnail:${pageId}`, 2, () => createCoverThumbnail(pageId, source));
}

async function createCoverThumbnail(pageId: string, source: Buffer): Promise<string | null> {
  try {
    const thumbnail = await sharp(source)
      .rotate()
      .resize({ width: 64, withoutEnlargement: true })
      .webp({ quality: 35 })
      .toBuffer();
    const filename = `${pageId}${THUMBNAIL_SUFFIX}`;
    await writeCoverFile(filename, thumbnail);
    return filename;
  } catch {
    return null;
  }
}

/** Generates the two Gallery derivatives from one source buffer and one queued job. */
function coverVariantFilename(pageId: string, sourceKey: string, suffix: string) {
  // Source-specific names make concurrent requests for an old and new cover harmless:
  // neither can overwrite the other's immutable browser-cache URL.
  const sourceHash = createHash("sha256").update(sourceKey).digest("hex").slice(0, 16);
  return `${pageId}.${sourceHash}${suffix}`;
}

async function createCoverVariants(pageId: string, source: Buffer, sourceKey: string): Promise<CoverVariants | null> {
  try {
    const image = sharp(source).rotate();
    const [thumbnail, card] = await Promise.all([
      image.clone().resize({ width: 64, withoutEnlargement: true }).webp({ quality: 35 }).toBuffer(),
      image.clone().resize({ width: 320, withoutEnlargement: true }).webp({ quality: 72 }).toBuffer(),
    ]);
    const thumbnailFile = coverVariantFilename(pageId, sourceKey, THUMBNAIL_SUFFIX);
    const cardFile = coverVariantFilename(pageId, sourceKey, CARD_SUFFIX);
    await Promise.all([writeCoverFile(thumbnailFile, thumbnail), writeCoverFile(cardFile, card)]);
    return { thumbnailFile, cardFile };
  } catch {
    return null;
  }
}

export async function storeCoverVariants(
  pageId: string,
  source: Buffer,
  sourceKey: string,
): Promise<CoverVariants | null> {
  if (!isSafePageId(pageId)) return null;
  return enqueueCoverJob(`variants:${pageId}:${sourceKey}`, 3, async () =>
    createCoverVariants(pageId, source, sourceKey),
  );
}

/** Downloads once, then builds both Gallery variants without fetching the original twice. */
export async function storeCoverVariantsFromUrl(
  pageId: string,
  sourceUrl: string,
  sourceKey: string,
): Promise<CoverVariants | null> {
  if (!isSafePageId(pageId)) return null;
  return enqueueCoverJob(`variants:${pageId}:${sourceKey}`, 3, async () => {
    const downloaded = await downloadCoverImage(sourceUrl);
    return downloaded ? createCoverVariants(pageId, downloaded.bytes, sourceKey) : null;
  });
}

/** Downloads only to derive a small preview; the full external image stays at its own URL. */
export async function storeCoverThumbnailFromUrl(pageId: string, sourceUrl: string): Promise<string | null> {
  if (!isSafePageId(pageId)) return null;
  return enqueueCoverJob(`thumbnail:${pageId}:${sourceUrl}`, 2, async () => {
    const downloaded = await downloadCoverImage(sourceUrl);
    return downloaded ? createCoverThumbnail(pageId, downloaded.bytes) : null;
  });
}

export async function readCoverThumbnail(filename: string): Promise<Buffer | null> {
  if (filename !== path.basename(filename) || !filename.endsWith(THUMBNAIL_SUFFIX)) return null;
  try {
    const bytes = await readFile(path.join(CACHE_DIR, filename));
    touchCoverFile(filename);
    return bytes;
  } catch {
    return null;
  }
}

export async function readCoverCard(filename: string): Promise<Buffer | null> {
  if (filename !== path.basename(filename) || !filename.endsWith(CARD_SUFFIX)) return null;
  try {
    const bytes = await readFile(path.join(CACHE_DIR, filename));
    touchCoverFile(filename);
    return bytes;
  } catch {
    return null;
  }
}

/** A derivative may only live under its own page's cache namespace. */
export function isSafeCoverVariantFile(pageId: string, filename: string, suffix: string): boolean {
  return (
    isSafePageId(pageId) &&
    filename === path.basename(filename) &&
    filename.startsWith(`${pageId}.`) &&
    filename.endsWith(suffix)
  );
}

/** Stable, never-expiring URL for a cover Hallery has a copy of. */
export function storedCoverUrl(pageId: string): string {
  return `/api/covers/${pageId}`;
}

/** Versioned by the cache record timestamp at the callsite before browser-caching hard. */
export function storedCoverThumbnailUrl(pageId: string, version: number, filename: string): string {
  return `/api/covers/${pageId}/thumbnail?v=${version}&f=${encodeURIComponent(filename)}`;
}

/** Versioned local 320px WebP for Gallery cards. */
export function storedCoverCardUrl(pageId: string, version: number, filename: string): string {
  return `/api/covers/${pageId}/card?v=${version}&f=${encodeURIComponent(filename)}`;
}
