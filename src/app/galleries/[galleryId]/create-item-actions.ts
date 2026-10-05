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
import { MAX_UPLOAD_BYTES } from "@/components/image-drop-zone";

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
  // create call rather than costing a second write.
  const picked = formData.get("coverImage");
  let uploadId: string | null = null;
  if (picked instanceof File && picked.size > 0) {
    if (picked.size > MAX_UPLOAD_BYTES) {
      return { error: "Ảnh vượt quá 20MB — Notion không nhận trong một lần tải." };
    }
    try {
      const upload = await notion.fileUploads.create({
        mode: "single_part",
        filename: picked.name || "cover",
        content_type: picked.type || "image/png",
      });
      await notion.fileUploads.send({
        file_upload_id: upload.id,
        file: { filename: picked.name || "cover", data: picked },
      });
      uploadId = upload.id;
    } catch {
      return { error: "Không tải được ảnh lên Notion. Item chưa được tạo — thử lại hoặc bỏ ảnh ra." };
    }
  }

  const target = config.formCoverTarget ?? PAGE_COVER;
  if (uploadId && target.startsWith(PROPERTY_PREFIX)) {
    properties[target.slice(PROPERTY_PREFIX.length)] = {
      files: [{ type: "file_upload", file_upload: { id: uploadId }, name: picked instanceof File ? picked.name : "cover" }],
    };
  }

  let createdPage: Awaited<ReturnType<typeof notion.pages.retrieve>>;
  try {
    const created = await notion.pages.create({
      parent: { data_source_id: gallery.notionDataSourceId },
      properties: properties as CreatePageParameters["properties"],
      ...(uploadId && target === PAGE_COVER
        ? { cover: { type: "file_upload" as const, file_upload: { id: uploadId } } }
        : {}),
      // Into the body as an image block. This is the one target the gallery can read back
      // as a cover through its own content_image source, closing that loop.
      ...(uploadId && target === CONTENT_IMAGE
        ? { children: [{ type: "image" as const, image: { file_upload: { id: uploadId } } }] }
        : {}),
    });
    createdPage = isFullPage(created) ? created : await notion.pages.retrieve({ page_id: created.id });
  } catch (error) {
    const problem = classifyNotionError(error);
    return {
      error:
        problem === "unavailable"
          ? "Notion từ chối request. Có thể một giá trị không khớp kiểu property, hoặc property đã bị đổi."
          : `${NOTION_PROBLEM_COPY[problem].title}. ${NOTION_PROBLEM_COPY[problem].body}`,
    };
  }

  // Remembered so the copy-from-last default has something to copy next time.
  config.formLastValues = { ...config.formLastValues, ...lastValues };
  await db.gallery.update({ where: { id: galleryId }, data: { displayConfig: JSON.stringify(config) } });

  if (isFullPage(createdPage)) await patchGalleryNotionSnapshot(galleryId, createdPage);
  revalidatePath(`/galleries/${galleryId}`);
  return { error: null, createdPageId: createdPage.id, createdAt: Date.now() };
}
