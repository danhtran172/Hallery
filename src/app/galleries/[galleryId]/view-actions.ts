"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { serializeFilters, serializeSorts, type Filter, type SortKey } from "@/lib/gallery-query";
import { initialViewLayoutConfig } from "@/lib/gallery-view";
import { isFullDataSource } from "@notionhq/client";
import { getNotionClient } from "@/lib/notion";
import { addRelationGalleries } from "@/lib/relation-galleries";

type ViewQueryInput = { filters: Filter[]; sorts: SortKey[]; groupBy: string | null };
type ViewActionResult = { error: string | null; viewId?: string };

function refreshGallery(galleryId: string) {
  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/settings/card`);
  revalidatePath(`/galleries/${galleryId}/settings/display`);
}

/** Persists the three view query controls after confirming the view belongs to this gallery. */
export async function saveGalleryViewQuery(
  galleryId: string,
  viewId: string,
  query: ViewQueryInput,
): Promise<ViewActionResult> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { propertyConfigs: true },
  });
  if (!gallery) return { error: "Gallery không còn tồn tại." };

  const managed = new Set(
    gallery.propertyConfigs.filter((property) => !property.disabled && !property.isMissing).map((property) => property.notionPropertyId),
  );
  const filters = query.filters.filter((filter) => managed.has(filter.propertyId));
  const sorts = query.sorts.filter((sort) => managed.has(sort.propertyId));
  const groupBy = query.groupBy && managed.has(query.groupBy) ? query.groupBy : null;

  const result = await db.galleryView.updateMany({
    where: { id: viewId, galleryId },
    data: { filterConfig: serializeFilters(filters) || "[]", sortConfig: serializeSorts(sorts) || "[]", groupBy },
  });
  if (result.count === 0) return { error: "View này không còn tồn tại." };

  refreshGallery(galleryId);
  return { error: null };
}

async function sourceView(galleryId: string, viewId: string) {
  return db.galleryView.findFirst({ where: { id: viewId, galleryId } });
}

export async function createGalleryView(galleryId: string, sourceViewId: string): Promise<ViewActionResult> {
  const [gallery, source, last] = await Promise.all([
    db.gallery.findUnique({ where: { id: galleryId } }),
    sourceView(galleryId, sourceViewId),
    db.galleryView.findFirst({ where: { galleryId }, orderBy: { sortOrder: "desc" } }),
  ]);
  if (!gallery) return { error: "Gallery không còn tồn tại." };
  if (!source) return { error: "View nguồn không còn tồn tại." };

  const view = await db.galleryView.create({
    data: {
      galleryId,
      name: "View mới",
      sortOrder: (last?.sortOrder ?? -1) + 1,
      filterConfig: source.filterConfig,
      sortConfig: source.sortConfig,
      groupBy: source.groupBy,
      layoutConfig: source.layoutConfig || initialViewLayoutConfig(gallery.displayConfig),
    },
  });
  refreshGallery(galleryId);
  return { error: null, viewId: view.id };
}

export async function duplicateGalleryView(galleryId: string, sourceViewId: string): Promise<ViewActionResult> {
  const source = await sourceView(galleryId, sourceViewId);
  if (!source) return { error: "View nguồn không còn tồn tại." };
  const last = await db.galleryView.findFirst({ where: { galleryId }, orderBy: { sortOrder: "desc" } });
  const view = await db.galleryView.create({
    data: {
      galleryId,
      name: `${source.name} copy`,
      sortOrder: (last?.sortOrder ?? -1) + 1,
      filterConfig: source.filterConfig,
      sortConfig: source.sortConfig,
      groupBy: source.groupBy,
      layoutConfig: source.layoutConfig,
    },
  });
  refreshGallery(galleryId);
  return { error: null, viewId: view.id };
}

/**
 * Walks the Gallery's relations again — after the owner has shared a linked table with the
 * integration, this is what turns it into a Gallery they can open.
 */
export async function refreshRelationGalleries(galleryId: string): Promise<ViewActionResult> {
  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, include: { workspace: true } });
  if (!gallery) return { error: "Gallery không còn tồn tại." };
  const notion = getNotionClient(gallery.workspace.accessToken);
  try {
    const dataSource = await notion.dataSources.retrieve({ data_source_id: gallery.notionDataSourceId });
    if (!isFullDataSource(dataSource)) return { error: "Không đọc được cấu trúc database." };
    const walk = await addRelationGalleries(notion, gallery.workspaceId, gallery.notionDataSourceId, dataSource.properties);
    revalidatePath("/", "layout");
    return walk.unreachable.length
      ? { error: `Vẫn còn ${walk.unreachable.length} bảng chưa chia sẻ với integration.` }
      : { error: null };
  } catch {
    return { error: "Không gọi được Notion. Thử lại sau." };
  }
}

/** Removes a view. The last one stays: a Gallery always opens on some view. */
export async function deleteGalleryView(galleryId: string, viewId: string): Promise<ViewActionResult> {
  const views = await db.galleryView.findMany({ where: { galleryId }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  if (views.length <= 1) return { error: "Gallery cần ít nhất một view." };
  const index = views.findIndex((view) => view.id === viewId);
  if (index === -1) return { error: "View này không còn tồn tại." };
  await db.galleryView.delete({ where: { id: viewId } });
  refreshGallery(galleryId);
  const fallback = views[index === 0 ? 1 : index - 1];
  return { error: null, viewId: fallback.id };
}

export async function renameGalleryView(galleryId: string, viewId: string, name: string): Promise<ViewActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Tên view không được để trống." };
  const result = await db.galleryView.updateMany({ where: { id: viewId, galleryId }, data: { name: trimmed.slice(0, 80) } });
  if (result.count === 0) return { error: "View này không còn tồn tại." };
  refreshGallery(galleryId);
  return { error: null };
}
