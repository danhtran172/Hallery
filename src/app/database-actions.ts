"use server";

import { revalidatePath } from "next/cache";
import { APIErrorCode, isFullDatabase, isFullDataSource, isNotionClientError } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { importGallery } from "@/lib/gallery-import";
import { NOTION_PROBLEM_COPY, classifyNotionError } from "@/lib/notion-errors";
import { databaseIdOf, dataSourceTitle, listParentPages, listSharedDataSources, type ParentPage } from "@/lib/notion-listing";
import { getDataSourceEmoji } from "@/lib/notion-schema";
import { PROPERTY_PREFIX } from "@/lib/notion-cover";
import { notionPropertiesOf, validateNewDatabase, type NewDatabaseInput } from "@/lib/new-database";

type Failure = { error: string };

function problemText(error: unknown): string {
  const problem = classifyNotionError(error);
  return `${NOTION_PROBLEM_COPY[problem].title}. ${NOTION_PROBLEM_COPY[problem].body}`;
}

/** Pages shared with the workspace's integration, as places a new database can go. */
export async function loadParentPages(workspaceId: string): Promise<{ pages: ParentPage[] } | Failure> {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return { error: "Workspace không còn tồn tại trong Hallery." };
  const result = await listParentPages(workspace.accessToken);
  if (typeof result === "string") return { error: `${NOTION_PROBLEM_COPY[result].title}. ${NOTION_PROBLEM_COPY[result].body}` };
  return { pages: result };
}

export type LinkableDataSource = {
  id: string;
  title: string;
  icon: string | null;
  editedAt: string;
  /** The gallery Hallery already has for it, live or trashed or relation-only. */
  galleryName: string | null;
  /** Already one of this gallery's tabs. */
  linked: boolean;
  /** Linking it would nest a gallery inside its own descendant. */
  blocked: boolean;
};

/** Ids of a gallery and every gallery above it — none of them can become its tab. */
async function selfAndAncestors(galleryId: string): Promise<Set<string>> {
  const ids = new Set<string>();
  let current: string | null = galleryId;
  while (current && !ids.has(current)) {
    ids.add(current);
    const row: { parentGalleryId: string | null } | null = await db.gallery.findUnique({
      where: { id: current },
      select: { parentGalleryId: true },
    });
    current = row?.parentGalleryId ?? null;
  }
  return ids;
}

/** Databases that could become a linked tab of this gallery. */
export async function loadLinkableDataSources(galleryId: string): Promise<{ sources: LinkableDataSource[] } | Failure> {
  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, include: { workspace: true } });
  if (!gallery) return { error: "Gallery không còn tồn tại." };
  const [result, existing, blockedIds] = await Promise.all([
    listSharedDataSources(gallery.workspace.accessToken),
    db.gallery.findMany({
      where: { workspaceId: gallery.workspaceId },
      select: { id: true, name: true, notionDataSourceId: true, parentGalleryId: true, deletedAt: true },
    }),
    selfAndAncestors(galleryId),
  ]);
  if (typeof result === "string") return { error: `${NOTION_PROBLEM_COPY[result].title}. ${NOTION_PROBLEM_COPY[result].body}` };

  const bySource = new Map(existing.map((row) => [row.notionDataSourceId, row]));
  const sources = result
    .filter((source) => source.id !== gallery.notionDataSourceId)
    .map((source) => {
      const row = bySource.get(source.id);
      return {
        id: source.id,
        title: dataSourceTitle(source),
        icon: getDataSourceEmoji(source),
        editedAt: source.last_edited_time,
        galleryName: row && !row.deletedAt ? row.name : null,
        linked: Boolean(row && !row.deletedAt && row.parentGalleryId === galleryId),
        blocked: Boolean(row && blockedIds.has(row.id)),
      };
    })
    .sort((a, b) => Date.parse(b.editedAt) - Date.parse(a.editedAt));
  return { sources };
}

/**
 * Makes an existing Notion database one of this gallery's tabs: its gallery (made now if
 * Hallery has none) is nested under this one. Nothing in Notion changes.
 */
export async function linkDataSource(galleryId: string, dataSourceId: string): Promise<{ galleryId: string } | Failure> {
  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, include: { workspace: true } });
  if (!gallery) return { error: "Gallery không còn tồn tại." };
  if (dataSourceId === gallery.notionDataSourceId) return { error: "Đây chính là database của gallery này." };

  const existing = await db.gallery.findUnique({
    where: { workspaceId_notionDataSourceId: { workspaceId: gallery.workspaceId, notionDataSourceId: dataSourceId } },
    select: { id: true },
  });
  if (existing && (await selfAndAncestors(galleryId)).has(existing.id)) {
    return { error: "Gallery đó đang chứa gallery này — không thể đặt nó làm tab bên trong." };
  }

  const notion = getNotionClient(gallery.workspace.accessToken);
  let dataSource;
  try {
    const response = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
    if (!isFullDataSource(response)) return { error: "Notion không trả về cấu trúc của database này." };
    dataSource = response;
  } catch (error) {
    return { error: problemText(error) };
  }

  const linked = await importGallery(notion, {
    workspaceId: gallery.workspaceId,
    dataSource,
    databaseId: databaseIdOf(dataSource),
    name: dataSourceTitle(dataSource),
    icon: getDataSourceEmoji(dataSource),
    parentGalleryId: galleryId,
  });
  revalidatePath("/", "layout");
  return { galleryId: linked.id };
}

/** Why Notion refused to create the database, in words the owner can act on. */
function createFailureText(error: unknown): string {
  if (isNotionClientError(error)) {
    if (error.code === APIErrorCode.ObjectNotFound) {
      return "Trang cha chưa được chia sẻ với integration. Mở trang đó trong Notion → ••• → Connections → thêm integration.";
    }
    if (error.code === APIErrorCode.RestrictedResource) {
      return "Integration chưa có quyền tạo nội dung. Vào trang integration trong Notion → Capabilities → bật “Insert content”.";
    }
    if (error.code === APIErrorCode.ValidationError) {
      if (/emoji/i.test(error.message)) return "Notion không nhận icon này — dùng đúng một emoji, hoặc để trống.";
      console.error("Notion rejected a new database", error.message);
      return "Notion từ chối cấu trúc database này. Kiểm tra lại tên và kiểu các cột.";
    }
  }
  return problemText(error);
}

/**
 * Creates a database in Notion under a page the owner picked, then opens it as a gallery —
 * a tab of `parentGalleryId` when given. The single schema write Hallery makes, and only
 * for a database that did not exist a moment ago.
 */
export async function createNotionDatabase(
  workspaceId: string,
  input: NewDatabaseInput,
  parentGalleryId: string | null = null,
): Promise<{ galleryId: string } | Failure> {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return { error: "Workspace không còn tồn tại trong Hallery." };
  if (parentGalleryId) {
    const parent = await db.gallery.findUnique({ where: { id: parentGalleryId }, select: { workspaceId: true } });
    if (!parent || parent.workspaceId !== workspaceId) return { error: "Gallery hiện tại không còn tồn tại." };
  }
  const checked = validateNewDatabase(input);
  if (!checked.ok) return { error: checked.error };
  const value = checked.value;

  const notion = getNotionClient(workspace.accessToken);
  let dataSourceId: string;
  let databaseId: string;
  try {
    const created = await notion.databases.create({
      parent: { type: "page_id", page_id: value.parentPageId },
      title: [{ type: "text", text: { content: value.title } }],
      ...(value.icon ? { icon: { type: "emoji", emoji: value.icon as never } } : {}),
      is_inline: false,
      initial_data_source: { properties: notionPropertiesOf(value) as never },
    });
    const source = isFullDatabase(created) ? created.data_sources[0] : undefined;
    if (!source) return { error: "Notion đã tạo database nhưng không trả về nguồn dữ liệu. Mở trang Chọn database để thêm nó." };
    dataSourceId = source.id;
    databaseId = created.id;
  } catch (error) {
    return { error: createFailureText(error) };
  }

  // The database exists in Notion from here on, so a failure below must say so rather than
  // read as if nothing happened.
  const landed = `Đã tạo “${value.title}” trong Notion nhưng chưa thêm được vào Hallery — mở trang Chọn database để thêm nó.`;
  let dataSource;
  try {
    const response = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
    if (!isFullDataSource(response)) return { error: landed };
    dataSource = response;
  } catch {
    return { error: landed };
  }

  // A Files column made here is meant for pictures: it becomes the cards' cover and where
  // the quick-entry form puts an image, instead of the gallery starting blank.
  const files = value.properties.find((property) => property.type === "files");
  const displayConfig = files
    ? JSON.stringify({ coverSource: `${PROPERTY_PREFIX}${files.name}`, formCoverTarget: `${PROPERTY_PREFIX}${files.name}` })
    : undefined;

  try {
    const gallery = await importGallery(notion, {
      workspaceId,
      dataSource,
      databaseId,
      name: value.title,
      icon: value.icon || null,
      parentGalleryId,
      displayConfig,
    });
    revalidatePath("/", "layout");
    return { galleryId: gallery.id };
  } catch (error) {
    console.error("New database landed in Notion but not in Hallery", error);
    return { error: landed };
  }
}
