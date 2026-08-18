import { mkdir, readFile, writeFile } from "node:fs/promises";
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

export const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_BY_TYPE).map(([type, ext]) => [ext, type]),
);

/** Notion page ids are uuids; refuse anything else so a page id can't escape the cache dir. */
export function isSafePageId(pageId: string): boolean {
  return /^[0-9a-fA-F-]{32,36}$/.test(pageId);
}

async function downloadCoverImage(sourceUrl: string): Promise<DownloadedImage | null> {
  try {
    const parsed = new URL(sourceUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;

    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
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

  const downloaded = await downloadCoverImage(sourceUrl);
  if (!downloaded) return null;

  try {
    const extension = EXTENSION_BY_TYPE[downloaded.contentType] ?? "jpg";
    const filename = `${pageId}.${extension}`;

    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, filename), downloaded.bytes);
    return filename;
  } catch {
    return null;
  }
}

export async function readCoverImage(filename: string): Promise<Buffer | null> {
  // Guard against a stored name that tries to walk out of the cache directory.
  if (filename !== path.basename(filename)) return null;
  try {
    return await readFile(path.join(CACHE_DIR, filename));
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

  try {
    const thumbnail = await sharp(source)
      .rotate()
      .resize({ width: 64, withoutEnlargement: true })
      .webp({ quality: 35 })
      .toBuffer();
    const filename = `${pageId}${THUMBNAIL_SUFFIX}`;
    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, filename), thumbnail);
    return filename;
  } catch {
    return null;
  }
}

/** Downloads only to derive a small preview; the full external image stays at its own URL. */
export async function storeCoverThumbnailFromUrl(pageId: string, sourceUrl: string): Promise<string | null> {
  const downloaded = await downloadCoverImage(sourceUrl);
  return downloaded ? storeCoverThumbnail(pageId, downloaded.bytes) : null;
}

export async function readCoverThumbnail(filename: string): Promise<Buffer | null> {
  if (filename !== path.basename(filename) || !filename.endsWith(THUMBNAIL_SUFFIX)) return null;
  try {
    return await readFile(path.join(CACHE_DIR, filename));
  } catch {
    return null;
  }
}

/** Stable, never-expiring URL for a cover Hallery has a copy of. */
export function storedCoverUrl(pageId: string): string {
  return `/api/covers/${pageId}`;
}

/** Versioned by the cache record timestamp at the callsite before browser-caching hard. */
export function storedCoverThumbnailUrl(pageId: string, version: number): string {
  return `/api/covers/${pageId}/thumbnail?v=${version}`;
}
