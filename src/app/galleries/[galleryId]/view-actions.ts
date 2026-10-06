"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { serializeFilters, serializeSorts, type Filter, type SortKey } from "@/lib/gallery-query";
import { initialViewLayoutConfig, parseViewLayoutConfig, viewLayoutConfig } from "@/lib/gallery-view";
import { CONTENT_IMAGE, PAGE_COVER, PROPERTY_PREFIX, parseGalleryConfig } from "@/lib/notion-cover";
import { TITLE_FIELD_ID, cardEligibleProperties, parseCardLayout } from "@/lib/card-layout";
import { parseDisplayConfig } from "@/lib/display-config";
import {
  COVER_COLUMN_ID,
  clampColumnWidth,
  createDefaultTableLayout,
  parseTableLayout,
  parseViewType,
  type TableLayout,
  type ViewType,
} from "@/lib/table-layout";
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

/** Moves a view one place left or right among the tabs. */
export async function moveGalleryView(galleryId: string, viewId: string, direction: -1 | 1): Promise<ViewActionResult> {
  const views = await db.galleryView.findMany({ where: { galleryId }, orderBy: { sortOrder: "asc" }, select: { id: true } });
  const from = views.findIndex((view) => view.id === viewId);
  if (from === -1) return { error: "View này không còn tồn tại." };
  const to = from + direction;
  if (to < 0 || to >= views.length) return { error: null };
  const order = views.map((view) => view.id);
  [order[from], order[to]] = [order[to], order[from]];
  // Rewritten from positions: stored sortOrder can carry ties, which a swap would keep.
  await db.$transaction(order.map((id, sortOrder) => db.galleryView.updateMany({ where: { id, galleryId }, data: { sortOrder } })));
  refreshGallery(galleryId);
  return { error: null };
}

export async function renameGalleryView(galleryId: string, viewId: string, name: string): Promise<ViewActionResult> {
  const trimmed = name.trim();
  if (!trimmed) return { error: "Tên view không được để trống." };
  const result = await db.galleryView.updateMany({ where: { id: viewId, galleryId }, data: { name: trimmed.slice(0, 80) } });
  if (result.count === 0) return { error: "View này không còn tồn tại." };
  refreshGallery(galleryId);
  return { error: null };
}

/** Switches a view between cards and a table. Each keeps its own settings for when it comes back. */
export async function setGalleryViewType(galleryId: string, viewId: string, type: ViewType): Promise<ViewActionResult> {
  const [gallery, view] = await Promise.all([
    db.gallery.findUnique({ where: { id: galleryId }, select: { displayConfig: true } }),
    sourceView(galleryId, viewId),
  ]);
  if (!gallery || !view) return { error: "View này không còn tồn tại." };
  const config = parseViewLayoutConfig(view.layoutConfig, parseGalleryConfig(gallery.displayConfig));
  config.viewType = parseViewType(type);
  await db.galleryView.update({ where: { id: view.id }, data: { layoutConfig: viewLayoutConfig(config) } });
  refreshGallery(galleryId);
  revalidatePath(`/galleries/${galleryId}/settings/table`);
  return { error: null };
}

/**
 * Stores a table view's columns and options. Unknown property ids are dropped and the
 * title column is always kept, so a stale editor cannot save a table with no way into its items.
 * The thumbnail's source is the view's own cover source — the one its cards use too.
 */
export async function saveTableLayout(
  galleryId: string,
  viewId: string,
  layout: TableLayout,
  coverSource: string,
  /** Shared Hallery names edited alongside, by Notion property id; "" goes back to Notion's. */
  names: Record<string, string> = {},
): Promise<ViewActionResult> {
  const [gallery, view] = await Promise.all([
    db.gallery.findUnique({ where: { id: galleryId }, include: { propertyConfigs: true } }),
    sourceView(galleryId, viewId),
  ]);
  if (!gallery || !view) return { error: "View này không còn tồn tại." };
  const parsed = parseTableLayout(layout);
  if (!parsed) return { error: "Bố cục bảng không hợp lệ." };
  // The parser already guarantees the title column; anything else must still be managed.
  const known = new Set([
    TITLE_FIELD_ID,
    COVER_COLUMN_ID,
    ...cardEligibleProperties(gallery.propertyConfigs).map((p) => p.notionPropertyId),
  ]);
  parsed.columns = parsed.columns.filter((column) => known.has(column.id));

  const config = parseViewLayoutConfig(view.layoutConfig, parseGalleryConfig(gallery.displayConfig));
  config.table = parsed;
  if (coverSource === PAGE_COVER || coverSource === CONTENT_IMAGE || coverSource.startsWith(PROPERTY_PREFIX)) {
    config.coverSource = coverSource;
  }

  // A rename is the property's own, not this table's: it lands in the shared display config,
  // next to whatever formatting is already there.
  const renames = cardEligibleProperties(gallery.propertyConfigs).flatMap((property) => {
    const raw = names[property.notionPropertyId];
    if (typeof raw !== "string") return [];
    const display = parseDisplayConfig(property.displayConfig);
    const name = raw.trim().slice(0, 120);
    if ((display.nameOverride?.trim() ?? "") === name) return [];
    if (name) display.nameOverride = name;
    else delete display.nameOverride;
    return [db.propertyConfig.update({ where: { id: property.id }, data: { displayConfig: JSON.stringify(display) } })];
  });

  await db.$transaction([
    db.galleryView.update({ where: { id: view.id }, data: { layoutConfig: viewLayoutConfig(config) } }),
    ...renames,
  ]);
  refreshGallery(galleryId);
  revalidatePath(`/galleries/${galleryId}/settings/table`);
  if (renames.length > 0) revalidatePath(`/galleries/${galleryId}/items/[pageId]`, "page");
  return { error: null };
}

/** One column's width, dragged on the table's own header. Everything else stays as stored. */
export async function saveTableColumnWidth(galleryId: string, viewId: string, columnId: string, width: number): Promise<ViewActionResult> {
  const [gallery, view] = await Promise.all([
    db.gallery.findUnique({ where: { id: galleryId }, include: { propertyConfigs: true } }),
    sourceView(galleryId, viewId),
  ]);
  if (!gallery || !view) return { error: "View này không còn tồn tại." };
  const config = parseViewLayoutConfig(view.layoutConfig, parseGalleryConfig(gallery.displayConfig));
  // A table nobody arranged yet is drawn from its default, so that is what gets resized.
  const table = parseTableLayout(config.table) ?? createDefaultTableLayout(gallery.propertyConfigs, parseCardLayout(config.card));
  const column = table.columns.find((entry) => entry.id === columnId);
  if (!column) return { error: "Cột này không còn trong bảng." };
  column.width = clampColumnWidth(width);
  config.table = table;
  await db.galleryView.update({ where: { id: view.id }, data: { layoutConfig: viewLayoutConfig(config) } });
  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/settings/table`);
  return { error: null };
}
