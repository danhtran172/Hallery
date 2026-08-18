import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { findFirstImageUrl } from "@/lib/notion-cover";
import { storeCoverImage, storedCoverUrl } from "@/lib/cover-store";

/** Notion file URLs are short-lived, so use the remote URL only while it is still fresh. */
const CACHE_TTL_MS = 45 * 60 * 1000;

export type ResolvedContentImage = {
  fullUrl: string | null;
  storedFile: string | null;
};

/**
 * Resolves the first image block once and keeps an original locally where possible. The
 * thumbnail route and the original content-image endpoint share this so they cannot
 * trigger duplicate Notion block crawls for the same page.
 */
export async function resolveContentImage(
  accessToken: string,
  pageId: string,
): Promise<ResolvedContentImage> {
  const cached = await db.pageImageCache.findUnique({ where: { notionPageId: pageId } });
  if (cached?.storedFile) return { fullUrl: storedCoverUrl(pageId), storedFile: cached.storedFile };
  if (cached && cached.expiresAt > new Date()) return { fullUrl: cached.imageUrl, storedFile: null };

  try {
    const url = await findFirstImageUrl(getNotionClient(accessToken), pageId);
    const storedFile = url ? await storeCoverImage(pageId, url) : null;
    const record = {
      imageUrl: url,
      expiresAt: new Date(Date.now() + CACHE_TTL_MS),
      storedFile,
      // A refreshed original must get a newly derived preview too.
      thumbnailFile: null,
      thumbnailSource: null,
    };

    await db.pageImageCache.upsert({
      where: { notionPageId: pageId },
      create: { notionPageId: pageId, ...record },
      update: record,
    });

    return { fullUrl: storedFile ? storedCoverUrl(pageId) : url, storedFile };
  } catch {
    return {
      fullUrl: cached?.storedFile ? storedCoverUrl(pageId) : (cached?.imageUrl ?? null),
      storedFile: cached?.storedFile ?? null,
    };
  }
}
