"use server";

import { revalidatePath } from "next/cache";
import type { CreatePageParameters } from "@notionhq/client";
import { db } from "@/lib/db";
import { invalidateGalleryNotionCache } from "@/lib/gallery-notion-cache";
import { getNotionClient } from "@/lib/notion";
import { buildPropertyUpdate } from "@/lib/notion-write";
import { TITLE_FIELD_ID } from "@/lib/card-layout";
import { CONTENT_IMAGE, PAGE_COVER, PROPERTY_PREFIX, parseGalleryConfig } from "@/lib/notion-cover";
import { parseFormDefaults, type FormLastValues } from "@/lib/create-form";
import { MAX_UPLOAD_BYTES } from "@/components/image-drop-zone";

export type CreateItemState = { error: string | null; createdPageId?: string };

/**
 * Adds a row to the gallery's Notion database from the quick-entry form.
 *
 * This writes values into a new page and nothing else — the database's properties are
 * untouched, which is the line Hallery does not cross. Field names follow the same
 * `field:<type>:<name>` convention the item editor uses, so both share one encoder.
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
  const byName = new Map(gallery.propertyConfigs.map((c) => [c.notionPropertyName, c]));

  const properties: Record<string, unknown> = {};
  const lastValues: FormLastValues = {};

  for (const key of new Set(formData.keys())) {
    if (!key.startsWith("field:")) continue;
    const rest = key.slice("field:".length);
    const separator = rest.indexOf(":");
    if (separator === -1) continue;
    const propertyType = rest.slice(0, separator);
    const propertyName = rest.slice(separator + 1);

    // The editor files the title under TITLE_FIELD_ID, not under its Notion property id —
    // it is a pseudo-property there. Looking it up by Notion id found nothing, so a
    // required title silently passed and an untitled page went in.
    const configKey =
      propertyType === "title" ? TITLE_FIELD_ID : (byName.get(propertyName)?.notionPropertyId ?? "");

    // Required is Hallery's own idea — Notion has no such flag — so it is enforced here,
    // before the request rather than by reading a rejection.
    const entered = formData.getAll(key).map((v) => String(v).trim()).filter(Boolean);
    if (configKey && defaults[configKey]?.required && entered.length === 0) {
      return { error: `"${propertyName}" là bắt buộc.` };
    }

    const update = buildPropertyUpdate(propertyType, formData, key);
    if (update) properties[propertyName] = update;
    if (configKey && entered.length) lastValues[configKey] = entered.join(", ");
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

  let createdPageId: string;
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
    createdPageId = created.id;
  } catch {
    return {
      error: "Notion từ chối request. Có thể một giá trị không khớp kiểu property, hoặc property đã bị đổi.",
    };
  }

  // Remembered so the copy-from-last default has something to copy next time.
  config.formLastValues = { ...config.formLastValues, ...lastValues };
  await db.gallery.update({ where: { id: galleryId }, data: { displayConfig: JSON.stringify(config) } });

  await invalidateGalleryNotionCache(galleryId);
  revalidatePath(`/galleries/${galleryId}`);
  return { error: null, createdPageId };
}
