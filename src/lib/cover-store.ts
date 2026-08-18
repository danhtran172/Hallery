import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Local copies of cover images.
 *
 * Notion serves files through signed URLs that expire within the hour, so remembering a
 * URL keeps a cover alive for less than a day — after that every card has to ask Notion
 * again, one request per page. Keeping the bytes instead makes a cover permanent: resolved
 * once, served from here forever, with no further Notion traffic.
 */

const CACHE_DIR = path.join(process.cwd(), ".hallery-cache", "covers");

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

export const CONTENT_TYPE_BY_EXTENSION: Record<string, string> = Object.fromEntries(
  Object.entries(EXTENSION_BY_TYPE).map(([type, ext]) => [ext, type]),
);

/** Notion page ids are uuids; refuse anything else so a page id can't escape the cache dir. */
export function isSafePageId(pageId: string): boolean {
  return /^[0-9a-fA-F-]{32,36}$/.test(pageId);
}

/**
 * Downloads an image and keeps it. Returns the stored filename, or null when the fetch
 * fails or the file is too big to be worth storing — callers then fall back to the
 * (perishable) Notion URL.
 */
export async function storeCoverImage(pageId: string, sourceUrl: string): Promise<string | null> {
  if (!isSafePageId(pageId)) return null;

  try {
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS) });
    if (!response.ok) return null;

    const declaredLength = Number(response.headers.get("content-length") ?? 0);
    if (declaredLength > MAX_BYTES) return null;

    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > MAX_BYTES) return null;

    const contentType = (response.headers.get("content-type") ?? "").split(";")[0].trim();
    const extension = EXTENSION_BY_TYPE[contentType] ?? "jpg";
    const filename = `${pageId}.${extension}`;

    await mkdir(CACHE_DIR, { recursive: true });
    await writeFile(path.join(CACHE_DIR, filename), bytes);
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

/** Stable, never-expiring URL for a cover Hallery has a copy of. */
export function storedCoverUrl(pageId: string): string {
  return `/api/covers/${pageId}`;
}
