import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { peekGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { fold } from "@/lib/gallery-query";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";

export type SearchGalleryHit = { id: string; name: string; icon: string | null; workspace: string };
export type SearchItemHit = {
  galleryId: string;
  galleryName: string;
  pageId: string;
  title: string;
  icon: string | null;
};
export type SearchResults = { galleries: SearchGalleryHit[]; items: SearchItemHit[] };

const MAX_GALLERIES = 6;
const MAX_ITEMS = 24;

/** Earlier is better: a title that starts with the words outranks one that merely holds them. */
function rank(haystack: string, needle: string): number {
  const at = haystack.indexOf(needle);
  if (at === -1) return -1;
  return at === 0 ? 0 : haystack[at - 1] === " " ? 1 : 2;
}

/**
 * Finds galleries by name and items by title across every workspace.
 *
 * Reads only the snapshots already on disk — no Notion request — so it answers in
 * milliseconds and works while Notion is unreachable. Items added in Notion moments ago
 * appear once their gallery's next sync lands.
 */
export async function searchEverything(query: string): Promise<SearchResults> {
  const needle = fold(query);
  const galleries = await db.gallery.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, icon: true, autoAdded: true, sortOrder: true, workspace: { select: { name: true } } },
    orderBy: [{ autoAdded: "asc" }, { sortOrder: "asc" }],
  });

  const galleryHits = galleries
    .map((gallery) => ({ gallery, score: needle ? rank(fold(gallery.name), needle) : 0 }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, needle ? MAX_GALLERIES : 8)
    .map(({ gallery }) => ({
      id: gallery.id,
      name: gallery.name,
      icon: gallery.icon,
      workspace: gallery.workspace.name,
    }));

  if (!needle) return { galleries: galleryHits, items: [] };

  const scored: (SearchItemHit & { score: number })[] = [];
  for (const gallery of galleries) {
    const snapshot = await peekGalleryNotionSnapshot(gallery.id);
    if (!snapshot || !isFullDataSource(snapshot.dataSourceRes)) continue;
    const titleName = getTitlePropertyName(snapshot.dataSourceRes.properties);
    for (const page of snapshot.pages) {
      const title = getPageTitle(page, titleName);
      const score = rank(fold(title), needle);
      if (score < 0) continue;
      scored.push({ galleryId: gallery.id, galleryName: gallery.name, pageId: page.id, title, icon: getPageIcon(page), score });
    }
  }

  const items = scored
    .sort((a, b) => a.score - b.score || a.title.length - b.title.length)
    .slice(0, MAX_ITEMS)
    .map((entry) => ({
      galleryId: entry.galleryId,
      galleryName: entry.galleryName,
      pageId: entry.pageId,
      title: entry.title,
      icon: entry.icon,
    }));

  return { galleries: galleryHits, items };
}
