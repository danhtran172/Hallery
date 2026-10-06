"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { parseDisplayConfig } from "@/lib/display-config";
import { getGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { defaultFormLayout } from "@/lib/item-fields";
import type { CardLayout } from "@/lib/card-layout";
import {
  HALLERY_BUTTON_PREFIX,
  isHalleryButtonId,
  parseNativeButton,
  type NativeButtonConfig,
} from "@/lib/native-button";
import { NOTION_PROBLEM_COPY, classifyNotionError } from "@/lib/notion-errors";

/** A property as the button editor offers it. */
export type EditorProperty = {
  id: string;
  name: string;
  type: string;
  options?: string[];
  /** For a relation: the gallery its table is in, when Hallery has one. */
  relationGalleryId?: string | null;
  relationGalleryName?: string;
};

export type GalleryFields = {
  galleryId: string;
  name: string;
  properties: EditorProperty[];
  /** The gallery's own edit form, which a button's form starts from. */
  formLayout: CardLayout;
};

export type ButtonEditorData =
  | { error: string }
  | { error: null; self: GalleryFields; galleries: { id: string; name: string; icon: string | null }[] };

async function galleryFields(galleryId: string, workspaceId?: string): Promise<GalleryFields | string> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: {
      workspace: true,
      propertyConfigs: { orderBy: { sortOrder: "asc" } },
      views: { orderBy: { sortOrder: "asc" }, select: { id: true, layoutConfig: true } },
    },
  });
  if (!gallery || gallery.deletedAt) return "Gallery không còn tồn tại.";
  if (workspaceId && gallery.workspaceId !== workspaceId) return "Gallery này thuộc workspace khác.";

  let snapshot;
  try {
    snapshot = await getGalleryNotionSnapshot({
      galleryId,
      dataSourceId: gallery.notionDataSourceId,
      accessToken: gallery.workspace.accessToken,
    });
  } catch (error) {
    return NOTION_PROBLEM_COPY[classifyNotionError(error)].title;
  }
  if (!isFullDataSource(snapshot.dataSourceRes)) return "Không đọc được cấu trúc database.";
  const schemaById = new Map(Object.values(snapshot.dataSourceRes.properties).map((schema) => [schema.id, schema]));

  const relationSources = [...schemaById.values()].flatMap((schema) =>
    schema.type === "relation" ? [schema.relation.data_source_id] : [],
  );
  const linked = relationSources.length
    ? await db.gallery.findMany({
        where: { workspaceId: gallery.workspaceId, notionDataSourceId: { in: relationSources }, deletedAt: null },
        select: { id: true, name: true, notionDataSourceId: true },
      })
    : [];
  const linkedBySource = new Map(linked.map((entry) => [entry.notionDataSourceId, entry]));

  const properties: EditorProperty[] = [];
  for (const config of gallery.propertyConfigs) {
    if (config.disabled || config.isMissing || isHalleryButtonId(config.notionPropertyId)) continue;
    const schema = schemaById.get(config.notionPropertyId);
    if (!schema) continue;
    const name = parseDisplayConfig(config.displayConfig).nameOverride?.trim() || config.notionPropertyName;
    const entry: EditorProperty = { id: schema.id, name, type: schema.type };
    if (schema.type === "select") entry.options = schema.select.options.map((option) => option.name);
    if (schema.type === "status") entry.options = schema.status.options.map((option) => option.name);
    if (schema.type === "multi_select") entry.options = schema.multi_select.options.map((option) => option.name);
    if (schema.type === "relation") {
      const target = linkedBySource.get(schema.relation.data_source_id);
      entry.relationGalleryId = target?.id ?? null;
      if (target) entry.relationGalleryName = target.name;
    }
    properties.push(entry);
  }
  // The title first: it is what a new record is called.
  properties.sort((a, b) => Number(b.type === "title") - Number(a.type === "title"));

  return {
    galleryId,
    name: gallery.name,
    properties,
    formLayout: defaultFormLayout(gallery, gallery.propertyConfigs),
  };
}

/** Everything the button editor needs up front: this gallery's fields and where else a record can go. */
export async function loadButtonEditorData(galleryId: string): Promise<ButtonEditorData> {
  const self = await galleryFields(galleryId);
  if (typeof self === "string") return { error: self };
  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, select: { workspaceId: true } });
  const galleries = await db.gallery.findMany({
    where: { workspaceId: gallery?.workspaceId ?? "", deletedAt: null },
    orderBy: [{ autoAdded: "asc" }, { name: "asc" }],
    select: { id: true, name: true, icon: true },
  });
  return { error: null, self, galleries };
}

/** Another gallery's fields, fetched when the editor first points a step at it. */
export async function loadGalleryFields(
  fromGalleryId: string,
  galleryId: string,
): Promise<{ error: string } | { error: null; fields: GalleryFields }> {
  const from = await db.gallery.findUnique({ where: { id: fromGalleryId }, select: { workspaceId: true } });
  if (!from) return { error: "Gallery không còn tồn tại." };
  const fields = await galleryFields(galleryId, from.workspaceId);
  return typeof fields === "string" ? { error: fields } : { error: null, fields };
}

/**
 * Stores what a button does. Saving never reaches Notion: steps run only when pressed. A
 * Hallery button's name follows its label, so lists and the card editor show it by that.
 */
export async function saveNativeButton(
  galleryId: string,
  notionPropertyId: string,
  button: NativeButtonConfig | null,
): Promise<{ error: string | null }> {
  const existing = await db.propertyConfig.findFirst({
    where: { galleryId, notionPropertyId },
    select: { id: true, displayConfig: true, notionPropertyType: true },
  });
  if (!existing) return { error: "Nút này không còn tồn tại." };
  if (existing.notionPropertyType !== "button") return { error: "Chỉ gán hành động cho property kiểu Button." };

  const config = parseDisplayConfig(existing.displayConfig);
  const parsed = button ? parseNativeButton(button) : null;
  if (parsed) config.button = parsed;
  else delete config.button;

  await db.propertyConfig.update({
    where: { id: existing.id },
    data: {
      displayConfig: JSON.stringify(config),
      ...(isHalleryButtonId(notionPropertyId) && button?.label?.trim()
        ? { notionPropertyName: button.label.trim().slice(0, 80) }
        : {}),
    },
  });
  revalidateButtons(galleryId);
  return { error: null };
}

/** A button that exists only in Hallery, ready to be configured and placed on the card. */
export async function createHalleryButton(
  galleryId: string,
): Promise<{ error: string } | { error: null; propertyId: string }> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    select: { propertyConfigs: { select: { sortOrder: true, notionPropertyId: true } } },
  });
  if (!gallery) return { error: "Gallery không còn tồn tại." };
  const count = gallery.propertyConfigs.filter((config) => isHalleryButtonId(config.notionPropertyId)).length;
  const propertyId = `${HALLERY_BUTTON_PREFIX}${randomUUID().slice(0, 8)}`;
  await db.propertyConfig.create({
    data: {
      galleryId,
      notionPropertyId: propertyId,
      notionPropertyName: count ? `Nút mới ${count + 1}` : "Nút mới",
      notionPropertyType: "button",
      sortOrder: Math.max(-1, ...gallery.propertyConfigs.map((config) => config.sortOrder)) + 1,
    },
  });
  revalidateButtons(galleryId);
  return { error: null, propertyId };
}

/** Removes a Hallery button. Layouts that held it simply stop drawing it. */
export async function deleteHalleryButton(galleryId: string, notionPropertyId: string): Promise<{ error: string | null }> {
  if (!isHalleryButtonId(notionPropertyId)) return { error: "Nút của Notion không xoá được từ Hallery." };
  await db.propertyConfig.deleteMany({ where: { galleryId, notionPropertyId } });
  revalidateButtons(galleryId);
  return { error: null };
}

function revalidateButtons(galleryId: string) {
  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/items/[pageId]`, "page");
  revalidatePath(`/galleries/${galleryId}/settings/display`);
  revalidatePath(`/galleries/${galleryId}/settings/card`);
  revalidatePath(`/galleries/${galleryId}/settings/table`);
}
