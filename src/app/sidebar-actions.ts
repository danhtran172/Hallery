"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { nestUnder, reorderBeside, type GalleryNode, type SortAssignment } from "@/lib/gallery-tree";

/**
 * The rows a tree operation reasons over: one workspace's galleries, minus the trash.
 *
 * The workspace is read off the gallery being moved rather than passed in. A caller cannot
 * then hand in someone else's id, and a move can never span two workspaces — which would
 * put a gallery in a sidebar that does not list it.
 */
async function siblingsOf(galleryId: string): Promise<{ workspaceId: string; rows: GalleryNode[] } | null> {
  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, select: { workspaceId: true } });
  if (!gallery) return null;

  const rows = await db.gallery.findMany({
    where: { workspaceId: gallery.workspaceId, deletedAt: null },
    select: { id: true, name: true, icon: true, parentGalleryId: true, sortOrder: true, autoAdded: true },
  });
  return { workspaceId: gallery.workspaceId, rows };
}

/** What every sidebar action answers: nothing on success, a sentence to show otherwise. */
export type SidebarActionResult = { error: string | null };

const OK: SidebarActionResult = { error: null };
const GONE: SidebarActionResult = { error: "Gallery này không còn trong Hallery — tải lại trang để cập nhật danh sách." };

/** Runs a change and turns an unexpected failure into a message rather than a crash screen. */
async function attempt(change: () => Promise<SidebarActionResult>): Promise<SidebarActionResult> {
  try {
    return await change();
  } catch (error) {
    console.error("Sidebar action failed", error);
    return { error: "Không lưu được thay đổi. Thử lại sau giây lát." };
  }
}

async function apply(assignments: SortAssignment[]) {
  if (assignments.length === 0) return;
  await db.$transaction(
    assignments.map((entry) =>
      db.gallery.updateMany({
        where: { id: entry.id },
        data: { sortOrder: entry.sortOrder, parentGalleryId: entry.parentGalleryId },
      }),
    ),
  );
  revalidatePath("/", "layout");
}

/** Drops a gallery into another, making it a sub-gallery. `parentId` null lifts it back out. */
export async function nestGallery(dragId: string, parentId: string | null): Promise<SidebarActionResult> {
  return attempt(async () => {
    const scope = await siblingsOf(dragId);
    if (!scope) return GONE;
    // A target from another workspace is simply not among the rows, so nestUnder refuses it.
    await apply(nestUnder(scope.rows, dragId, parentId));
    return OK;
  });
}

/** Moves a gallery to where a sibling currently sits. */
export async function reorderGallery(dragId: string, targetId: string): Promise<SidebarActionResult> {
  return attempt(async () => {
    const scope = await siblingsOf(dragId);
    if (!scope) return GONE;
    await apply(reorderBeside(scope.rows, dragId, targetId));
    return OK;
  });
}

/**
 * Gives a gallery its own name in Hallery. The Notion database keeps its title — this is
 * the label on the sidebar, the dashboard and the Gallery header.
 */
export async function renameGallery(galleryId: string, name: string): Promise<SidebarActionResult> {
  const trimmed = name.trim().slice(0, 120);
  if (!trimmed) return { error: "Tên gallery không được để trống." };
  return attempt(async () => {
    const { count } = await db.gallery.updateMany({ where: { id: galleryId }, data: { name: trimmed } });
    if (count === 0) return GONE;
    revalidatePath("/", "layout");
    return OK;
  });
}

/**
 * Moves a gallery to the trash, along with anything nested inside it.
 *
 * Hallery-side only: the Notion database and every page in it are untouched, which is what
 * "xoá" has always meant here. Children go too, because leaving them behind would strand
 * them at the top of the sidebar with no hint of where they came from.
 */
export async function trashGallery(galleryId: string): Promise<SidebarActionResult> {
  return attempt(async () => {
    const scope = await siblingsOf(galleryId);
    if (!scope) return GONE;
    const rows = scope.rows;
    const doomed = new Set<string>([galleryId]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const row of rows) {
        if (row.parentGalleryId && doomed.has(row.parentGalleryId) && !doomed.has(row.id)) {
          doomed.add(row.id);
          grew = true;
        }
      }
    }

    await db.gallery.updateMany({ where: { id: { in: [...doomed] } }, data: { deletedAt: new Date() } });
    revalidatePath("/", "layout");
    return OK;
  });
}

/**
 * Takes a gallery back out of the trash.
 *
 * Restored to the top level rather than to where it was: its old parent may itself still be
 * in the trash, and a gallery restored into an invisible parent would look like it failed.
 */
export async function restoreGallery(galleryId: string): Promise<SidebarActionResult> {
  return attempt(async () => {
    const { count } = await db.gallery.updateMany({
      where: { id: galleryId },
      data: { deletedAt: null, parentGalleryId: null },
    });
    if (count === 0) return GONE;
    revalidatePath("/", "layout");
    return OK;
  });
}

/**
 * Deletes Hallery's own records for trashed galleries — display config, layouts, views,
 * category axes, the cached snapshot — and nothing in Notion. Only galleries already in the
 * trash qualify, so a stale button can never reach a live one.
 *
 * Children are deleted explicitly rather than left to ON DELETE CASCADE, which SQLite only
 * honours when the connection has foreign keys switched on.
 */
async function purge(galleryIds: string[]) {
  if (galleryIds.length === 0) return;
  await db.$transaction([
    db.propertyConfig.deleteMany({ where: { galleryId: { in: galleryIds } } }),
    db.categoryAxis.deleteMany({ where: { galleryId: { in: galleryIds } } }),
    db.galleryView.deleteMany({ where: { galleryId: { in: galleryIds } } }),
    db.galleryNotionCache.deleteMany({ where: { galleryId: { in: galleryIds } } }),
    db.coverPosition.deleteMany({ where: { galleryId: { in: galleryIds } } }),
    // Anything still pointing at a purged gallery climbs to the top level instead.
    db.gallery.updateMany({ where: { parentGalleryId: { in: galleryIds } }, data: { parentGalleryId: null } }),
    db.gallery.deleteMany({ where: { id: { in: galleryIds }, deletedAt: { not: null } } }),
  ]);
  revalidatePath("/", "layout");
}

/** Removes one trashed gallery from Hallery for good. The button behind it asks first. */
export async function deleteGalleryForever(galleryId: string): Promise<SidebarActionResult> {
  return attempt(async () => {
    const gallery = await db.gallery.findFirst({ where: { id: galleryId, deletedAt: { not: null } }, select: { id: true } });
    if (!gallery) return GONE;
    await purge([gallery.id]);
    return OK;
  });
}

/** Empties the whole trash. */
export async function emptyTrash(): Promise<SidebarActionResult> {
  return attempt(async () => {
    const trashed = await db.gallery.findMany({ where: { deletedAt: { not: null } }, select: { id: true } });
    await purge(trashed.map((gallery) => gallery.id));
    return OK;
  });
}
