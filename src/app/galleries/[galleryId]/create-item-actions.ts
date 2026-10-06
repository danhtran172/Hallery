"use server";

import { revalidatePath } from "next/cache";
import { isFullPage, type CreatePageParameters } from "@notionhq/client";
import { db } from "@/lib/db";
import { patchGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { getNotionClient } from "@/lib/notion";
import { buildPropertyUpdate } from "@/lib/notion-write";
import { TITLE_FIELD_ID, parseCardLayout } from "@/lib/card-layout";
import { CONTENT_IMAGE, PAGE_COVER, PROPERTY_PREFIX, parseGalleryConfig } from "@/lib/notion-cover";
import { FORM_FIELD_TYPES, TITLE_PROPERTY_ID, createFieldName, parseFormDefaults, type FormLastValues } from "@/lib/create-form";
import { parseDisplayConfig } from "@/lib/display-config";
import { NOTION_PROBLEM_COPY, classifyNotionError } from "@/lib/notion-errors";
import {
  ImageError,
  coverPayload,
  imageBlock,
  propertyPayload,
  readPickedImage,
  toNotionImage,
  type NotionImage,
} from "@/lib/cover-write";

export type CreateItemState = { error: string | null; createdPageId?: string; createdAt?: number };

/**
 * Adds a row to the gallery's Notion database from the quick-entry form.
 *
 * This writes values into a new page and nothing else — the database's properties are
 * untouched, which is the line Hallery does not cross. Properties are addressed by id, so
 * a property renamed in Notion since the form was drawn still receives its value.
 */
export async function createItem(
  galleryId: string,
  _prevState: CreateItemState,
  formData: FormData,
): Promise<CreateItemState> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: true },
  });
  if (!gallery) return { error: "Gallery không còn tồn tại." };

  const config = parseGalleryConfig(gallery.displayConfig);
  const defaults = parseFormDefaults(config.formDefaults);
  const byId = new Map(gallery.propertyConfigs.map((property) => [property.notionPropertyId, property]));
  // Image targets name their property; its type decides whether it holds a file or a link.
  const propertyTypes = new Map(gallery.propertyConfigs.map((property) => [property.notionPropertyName, property.notionPropertyType]));
  const layout = parseCardLayout(config.formCard);

  // The fields the form was built from, not whatever the browser chose to send: an empty
  // multi-select or an unticked box sends nothing at all, and "required" still has to hold.
  const expected = (layout ? Object.values(layout.regions).flatMap((grid) => grid.boxes.flatMap((box) => box.fields)) : [])
    .flatMap((field) => {
      if (field.id === TITLE_FIELD_ID) return [{ id: field.id, type: "title", label: "Tiêu đề" }];
      const property = byId.get(field.id);
      if (!property || property.disabled || property.isMissing || !FORM_FIELD_TYPES.has(property.notionPropertyType)) {
        return [];
      }
      const label = parseDisplayConfig(property.displayConfig).nameOverride?.trim() || property.notionPropertyName;
      return [{ id: field.id, type: property.notionPropertyType, label }];
    });

  const properties: Record<string, unknown> = {};
  const lastValues: FormLastValues = {};

  for (const field of expected) {
    const key = createFieldName(field.type, field.id);
    const entered = formData.getAll(key).map((v) => String(v).trim()).filter(Boolean);
    // Required is Hallery's own idea — Notion has no such flag — so it is enforced here,
    // before the request rather than by reading a rejection.
    if (defaults[field.id]?.required && entered.length === 0) {
      return { error: `"${field.label}" là bắt buộc.` };
    }
    if (entered.length === 0 && field.type !== "checkbox") continue;

    const update = buildPropertyUpdate(field.type, formData, key);
    if (!update) return { error: `"${field.label}" có giá trị không hợp lệ.` };
    properties[field.id === TITLE_FIELD_ID ? TITLE_PROPERTY_ID : field.id] = update;
    if (entered.length) lastValues[field.id] = entered.join(", ");
  }

  const notion = getNotionClient(gallery.workspace.accessToken);

  // The image is uploaded before the page exists, so its id can be attached in the same
  // create call rather than costing a second write. A pasted link needs no upload at all.
  const picked = readPickedImage(formData);
  const target = config.formCoverTarget ?? PAGE_COVER;
  let image: NotionImage | null = null;
  if (picked) {
    try {
      image = await toNotionImage(notion, picked);
      if (target.startsWith(PROPERTY_PREFIX)) {
        const name = target.slice(PROPERTY_PREFIX.length);
        properties[name] = propertyPayload(propertyTypes.get(name) ?? "files", image);
      }
    } catch (error) {
      const reason = error instanceof ImageError ? error.message : "Không xử lý được ảnh.";
      return { error: `${reason} Item chưa được tạo.` };
    }
  }

  let created: Awaited<ReturnType<typeof notion.pages.create>>;
  try {
    created = await notion.pages.create({
      parent: { data_source_id: gallery.notionDataSourceId },
      properties: properties as CreatePageParameters["properties"],
      ...(image && target === PAGE_COVER ? { cover: coverPayload(image) } : {}),
      // Into the body as an image block. This is the one target the gallery can read back
      // as a cover through its own content_image source, closing that loop.
      ...(image && target === CONTENT_IMAGE ? { children: [imageBlock(image)] } : {}),
    });
  } catch (error) {
    const problem = classifyNotionError(error);
    return {
      error:
        problem === "unavailable"
          ? "Notion từ chối request. Có thể một giá trị không khớp kiểu property, hoặc property đã bị đổi."
          : `${NOTION_PROBLEM_COPY[problem].title}. ${NOTION_PROBLEM_COPY[problem].body}`,
    };
  }

  // The item exists in Notion from here on. Nothing below may turn that into an error —
  // a "failed" message after a successful create is how a retry makes a duplicate.
  try {
    // Remembered so the copy-from-last default has something to copy next time. Re-read
    // first: the upload above can take seconds, and form settings saved meanwhile in
    // another tab must not be overwritten with the copy read at the start.
    const fresh = await db.gallery.findUnique({ where: { id: galleryId }, select: { displayConfig: true } });
    if (fresh) {
      const latest = parseGalleryConfig(fresh.displayConfig);
      latest.formLastValues = { ...latest.formLastValues, ...lastValues };
      await db.gallery.update({ where: { id: galleryId }, data: { displayConfig: JSON.stringify(latest) } });
    }
    const page = isFullPage(created) ? created : await notion.pages.retrieve({ page_id: created.id });
    if (isFullPage(page)) await patchGalleryNotionSnapshot(galleryId, page);
  } catch (error) {
    // The next sync brings the new card in; the reader only loses the remembered values.
    console.error("Post-create bookkeeping failed", error);
  }
  revalidatePath(`/galleries/${galleryId}`);
  return { error: null, createdPageId: created.id, createdAt: Date.now() };
}
