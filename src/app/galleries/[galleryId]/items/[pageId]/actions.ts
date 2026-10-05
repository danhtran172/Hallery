"use server";

import { revalidatePath } from "next/cache";
import {
  APIErrorCode,
  isFullPage,
  isNotionClientError,
  type PageObjectResponse,
  type UpdatePageParameters,
} from "@notionhq/client";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot, patchGalleryNotionSnapshot, snapshotPage } from "@/lib/gallery-notion-cache";
import { getNotionClient } from "@/lib/notion";
import { FORM_FIELD_MANIFEST, buildPropertyUpdate, isUnchangedValue } from "@/lib/notion-write";
import { PROPERTY_PREFIX, parseGalleryConfig } from "@/lib/notion-cover";
import { parseViewLayoutConfig } from "@/lib/gallery-view";
import { NOTION_PROBLEM_COPY, classifyNotionError } from "@/lib/notion-errors";
import { propertyById } from "@/lib/page-properties";

export type SaveItemState = { error: string | null; savedAt?: number };

/** Splits `field:<propertyType>:<propertyId>` — id last, since Notion ids may hold a colon. */
function parseFieldName(key: string): { type: string; id: string } | null {
  if (!key.startsWith("field:")) return null;
  const rest = key.slice("field:".length);
  const separatorIndex = rest.indexOf(":");
  if (separatorIndex === -1) return null;
  return { type: rest.slice(0, separatorIndex), id: rest.slice(separatorIndex + 1) };
}

/** A refused page write, in words the reader can act on. */
function writeErrorMessage(error: unknown): string {
  // A page archived in Notion since the last full sync refuses every write with a
  // validation error; "the property changed type" would send the reader looking in the
  // wrong place.
  if (isNotionClientError(error) && error.code === APIErrorCode.ValidationError && /archiv|trash/i.test(error.message)) {
    return "Item này đã bị xoá trong Notion nên không lưu được. Nó sẽ biến khỏi gallery ở lần đồng bộ tới.";
  }
  const problem = classifyNotionError(error);
  if (problem === "unavailable") {
    return "Notion từ chối lưu — có thể property đã đổi kiểu, bị xoá, hoặc giá trị không hợp lệ.";
  }
  return `${NOTION_PROBLEM_COPY[problem].title}. ${NOTION_PROBLEM_COPY[problem].body}`;
}

/**
 * Brings the local snapshot up to the saved page, and drops a cached cover when the save
 * touched the property a view draws its cover from.
 */
async function refreshLocalCopies(
  galleryId: string,
  pageId: string,
  updatedPage: PageObjectResponse,
  written: Record<string, unknown>,
  gallery: { displayConfig: string; views: { layoutConfig: string }[] },
) {
  await patchGalleryNotionSnapshot(galleryId, updatedPage);

  // A cover-property change needs a new thumbnail, but an ordinary title or tag edit
  // should not evict a content-image cache for the entire card. Any view may draw its
  // cover from its own property, so each one counts.
  const legacy = parseGalleryConfig(gallery.displayConfig);
  const coverSources = [legacy, ...gallery.views.map((view) => parseViewLayoutConfig(view.layoutConfig, legacy))]
    .map((config) => config.coverSource)
    .filter((source): source is string => Boolean(source?.startsWith(PROPERTY_PREFIX)));
  const writtenNames = new Set(
    Object.entries(updatedPage.properties)
      .filter(([, value]) => Object.hasOwn(written, value.id))
      .map(([name]) => name),
  );
  if (coverSources.some((source) => writtenNames.has(source.slice(PROPERTY_PREFIX.length)))) {
    await db.pageImageCache.deleteMany({ where: { notionPageId: pageId } });
  }
}

export async function saveItem(
  galleryId: string,
  pageId: string,
  _prevState: SaveItemState,
  formData: FormData,
): Promise<SaveItemState> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, views: { select: { layoutConfig: true } } },
  });
  if (!gallery) return { error: "Gallery không còn tồn tại." };
  const notion = getNotionClient(gallery.workspace.accessToken);

  // The page as Hallery last saw it, so untouched fields can be left alone.
  let current: PageObjectResponse | undefined;
  try {
    const snapshot = await getGalleryNotionSnapshot({
      galleryId,
      dataSourceId: gallery.notionDataSourceId,
      accessToken: gallery.workspace.accessToken,
    });
    current = snapshotPage(snapshot, pageId);
  } catch {
    current = undefined;
  }
  if (!current) {
    const retrieved = await notion.pages.retrieve({ page_id: pageId }).catch(() => null);
    current = retrieved && isFullPage(retrieved) ? retrieved : undefined;
  }

  const fieldNames = formData.getAll(FORM_FIELD_MANIFEST).map(String);
  const properties: Record<string, unknown> = {};
  for (const key of fieldNames) {
    const field = parseFieldName(key);
    if (!field) continue;
    const update = buildPropertyUpdate(field.type, formData, key);
    const currentValue = current ? propertyById(current, field.id) : undefined;
    if (!update) {
      if (field.type === "number") {
        const name = current ? Object.entries(current.properties).find(([, value]) => value.id === field.id)?.[0] : null;
        return { error: `"${name ?? "Số"}" phải là một số.` };
      }
      continue;
    }
    if (isUnchangedValue(update, currentValue)) continue;
    // Notion accepts a property id wherever it takes a name.
    properties[field.id] = update;
  }

  // Nothing differs from what Notion already holds: no request, nothing to roll back.
  if (Object.keys(properties).length === 0) return { error: null, savedAt: Date.now() };

  let updated: Awaited<ReturnType<typeof notion.pages.update>>;
  try {
    updated = await notion.pages.update({
      page_id: pageId,
      properties: properties as UpdatePageParameters["properties"],
    });
  } catch (error) {
    return { error: writeErrorMessage(error) };
  }

  // Saved in Notion from here on. Local bookkeeping that fails now must not report the
  // save as failed — the reader would retry a write that already landed.
  try {
    const full = isFullPage(updated) ? updated : await notion.pages.retrieve({ page_id: pageId });
    if (isFullPage(full)) await refreshLocalCopies(galleryId, pageId, full, properties, gallery);
  } catch (error) {
    console.error("Post-save bookkeeping failed", error);
  }
  revalidatePath(`/galleries/${galleryId}/items/${pageId}`);
  revalidatePath(`/galleries/${galleryId}`);
  return { error: null, savedAt: Date.now() };
}
