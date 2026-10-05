import { db } from "@/lib/db";
import { peekGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { storedCoverCardUrl } from "@/lib/cover-store";

export type GalleryPreview = {
  /** Null until the gallery has been opened once and Hallery holds a snapshot. */
  itemCount: number | null;
  /** Up to four covers Hallery already has on disk, for the dashboard mosaic. */
  covers: string[];
  syncedAt: Date | null;
  syncError: boolean;
};

/** How far into a gallery to look for pictures — the first rows are what a reader sees first. */
const LOOKAHEAD = 40;
const MOSAIC = 4;

/**
 * What the dashboard shows of each gallery without asking Notion anything: the item count
 * from the cached snapshot and a few covers from the local image cache. A gallery never
 * opened has neither, and says so rather than costing a crawl.
 */
export async function galleryPreviews(galleryIds: string[]): Promise<Map<string, GalleryPreview>> {
  const caches = await db.galleryNotionCache.findMany({
    where: { galleryId: { in: galleryIds } },
    select: { galleryId: true, lastDeltaSyncAt: true, updatedAt: true, lastSyncError: true },
  });
  const cacheById = new Map(caches.map((cache) => [cache.galleryId, cache]));

  const pageIdsByGallery = new Map<string, string[]>();
  const counts = new Map<string, number>();
  for (const galleryId of galleryIds) {
    if (!cacheById.has(galleryId)) continue;
    const snapshot = await peekGalleryNotionSnapshot(galleryId).catch(() => null);
    if (!snapshot) continue;
    counts.set(galleryId, snapshot.pages.length);
    pageIdsByGallery.set(
      galleryId,
      snapshot.pages.slice(0, LOOKAHEAD).map((page) => page.id),
    );
  }

  const allPageIds = [...pageIdsByGallery.values()].flat();
  const images = allPageIds.length
    ? await db.pageImageCache.findMany({
        where: { notionPageId: { in: allPageIds }, cardFile: { not: null } },
        select: { notionPageId: true, cardFile: true, checkedAt: true },
      })
    : [];
  const imageByPage = new Map(images.map((image) => [image.notionPageId, image]));

  const previews = new Map<string, GalleryPreview>();
  for (const galleryId of galleryIds) {
    const cache = cacheById.get(galleryId);
    const covers = (pageIdsByGallery.get(galleryId) ?? [])
      .flatMap((pageId) => {
        const image = imageByPage.get(pageId);
        return image?.cardFile ? [storedCoverCardUrl(pageId, image.checkedAt.getTime(), image.cardFile)] : [];
      })
      .slice(0, MOSAIC);
    previews.set(galleryId, {
      itemCount: counts.get(galleryId) ?? null,
      covers,
      syncedAt: cache ? (cache.lastDeltaSyncAt ?? cache.updatedAt) : null,
      syncError: Boolean(cache?.lastSyncError),
    });
  }
  return previews;
}
