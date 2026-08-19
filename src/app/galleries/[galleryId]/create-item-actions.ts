"use server";

import { revalidatePath } from "next/cache";
import type { CreatePageParameters } from "@notionhq/client";
import { db } from "@/lib/db";
import { invalidateGalleryNotionCache } from "@/lib/gallery-notion-cache";
import { getNotionClient } from "@/lib/notion";
import { buildPropertyUpdate } from "@/lib/notion-write";
import { TITLE_FIELD_ID } from "@/lib/card-layout";
import { parseGalleryConfig } from "@/lib/notion-cover";
import { parseFormDefaults, type FormLastValues } from "@/lib/create-form";

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

  let createdPageId: string;
  try {
    const created = await notionCreate(gallery.workspace.accessToken, gallery.notionDataSourceId, properties);
    createdPageId = created;
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

async function notionCreate(accessToken: string, dataSourceId: string, properties: Record<string, unknown>) {
  const notion = getNotionClient(accessToken);
  const created = await notion.pages.create({
    parent: { data_source_id: dataSourceId },
    properties: properties as CreatePageParameters["properties"],
  });
  return created.id;
}
