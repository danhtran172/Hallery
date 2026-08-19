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

async function apply(assignments: SortAssignment[]) {
  if (assignments.length === 0) return;
  await db.$transaction(
    assignments.map((entry) =>
      db.gallery.update({
        where: { id: entry.id },
        data: { sortOrder: entry.sortOrder, parentGalleryId: entry.parentGalleryId },
      }),
    ),
  );
  revalidatePath("/", "layout");
}

/** Drops a gallery into another, making it a sub-gallery. `parentId` null lifts it back out. */
export async function nestGallery(dragId: string, parentId: string | null) {
  const scope = await siblingsOf(dragId);
  if (!scope) return;
  // A target from another workspace is simply not among the rows, so nestUnder refuses it.
  await apply(nestUnder(scope.rows, dragId, parentId));
}

/** Moves a gallery to where a sibling currently sits. */
export async function reorderGallery(dragId: string, targetId: string) {
  const scope = await siblingsOf(dragId);
  if (!scope) return;
  await apply(reorderBeside(scope.rows, dragId, targetId));
}

/**
 * Moves a gallery to the trash, along with anything nested inside it.
 *
 * Hallery-side only: the Notion database and every page in it are untouched, which is what
 * "xoá" has always meant here. Children go too, because leaving them behind would strand
 * them at the top of the sidebar with no hint of where they came from.
 */
export async function trashGallery(galleryId: string) {
  const scope = await siblingsOf(galleryId);
  if (!scope) return;
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
}

/**
 * Takes a gallery back out of the trash.
 *
 * Restored to the top level rather than to where it was: its old parent may itself still be
 * in the trash, and a gallery restored into an invisible parent would look like it failed.
 */
export async function restoreGallery(galleryId: string) {
  await db.gallery.update({
    where: { id: galleryId },
    data: { deletedAt: null, parentGalleryId: null },
  });
  revalidatePath("/", "layout");
}

/**
 * Removes a gallery from Hallery for good.
 *
 * This deletes Hallery's own record — the display config, layouts and category axes built
 * up for it — and nothing in Notion. There is no undo, so the button behind it asks first.
 */
export async function deleteGalleryForever(galleryId: string) {
  await db.gallery.delete({ where: { id: galleryId } });
  revalidatePath("/", "layout");
}
