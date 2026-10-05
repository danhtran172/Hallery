"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { parseDisplayConfig, type DisplayConfig } from "@/lib/display-config";
import { parseNativeButton, type NativeButtonConfig } from "@/lib/native-button";
import {
  DEFAULT_CARDS_PER_ROW,
  MAX_CARDS_PER_ROW,
  MIN_CARDS_PER_ROW,
  parseGalleryConfig,
} from "@/lib/notion-cover";
import { parseViewLayoutConfig, viewLayoutConfig } from "@/lib/gallery-view";

/**
 * `configType` is the type whose options were shown — for formula and rollup properties
 * that's what they evaluate to, not "formula"/"rollup" themselves.
 */
export async function saveDisplayConfig(
  galleryId: string,
  propertyConfigId: string,
  configType: string,
  formData: FormData,
): Promise<{ error: string | null }> {
  // Only the formatting keys belong to this form. The rest — a rename made in the card
  // editor, a native button's actions — used to be wiped by every save here.
  const existing = await db.propertyConfig.findUnique({ where: { id: propertyConfigId }, select: { displayConfig: true } });
  if (!existing) return { error: "Property này không còn trong Hallery — tải lại trang." };
  const config: DisplayConfig = parseDisplayConfig(existing.displayConfig);
  for (const key of ["kind", "max", "prefix", "suffix", "label"] as const) delete config[key];
  const propertyType = configType;

  if (propertyType === "rich_text") {
    config.prefix = String(formData.get("prefix") ?? "");
    config.suffix = String(formData.get("suffix") ?? "");
  } else if (propertyType === "number") {
    config.kind = String(formData.get("kind") ?? "plain");
    if (config.kind === "rate") {
      const max = Number(formData.get("max"));
      config.max = Number.isFinite(max) && max > 0 ? max : 5;
    }
    if (config.kind === "with_text") {
      config.prefix = String(formData.get("prefix") ?? "");
      config.suffix = String(formData.get("suffix") ?? "");
    }
  } else if (propertyType === "url") {
    config.kind = String(formData.get("kind") ?? "link");
    if (config.kind === "button") {
      config.label = String(formData.get("label") ?? "");
    }
  } else if (propertyType === "date") {
    config.kind = String(formData.get("kind") ?? "full");
  } else if (["select", "status", "multi_select"].includes(propertyType)) {
    config.kind = String(formData.get("kind") ?? "pill");
    config.prefix = String(formData.get("prefix") ?? "");
    config.suffix = String(formData.get("suffix") ?? "");
  }

  // The rename travels with every save of this form; an emptied one goes back to Notion's name.
  if (formData.has("nameOverride")) {
    const name = String(formData.get("nameOverride") ?? "").trim();
    if (name) config.nameOverride = name.slice(0, 120);
    else delete config.nameOverride;
  }

  // A Card Detail with formatting of its own (set in the card editor) ignored this form
  // without a word. Ticking the box hands the detail back to this formatting.
  const useForDetail = formData.get("applyToDetail") !== null;

  await db.propertyConfig.update({
    where: { id: propertyConfigId },
    data: { displayConfig: JSON.stringify(config), ...(useForDetail ? { detailDisplayConfig: "" } : {}) },
  });

  revalidateProperty(galleryId);
  return { error: null };
}

/**
 * Stores the actions a Notion button property runs in Hallery. Only value writes can be
 * configured (see lib/native-button), so saving one never reaches Notion at all.
 */
export async function saveNativeButton(
  galleryId: string,
  propertyConfigId: string,
  button: NativeButtonConfig | null,
): Promise<{ error: string | null }> {
  const existing = await db.propertyConfig.findFirst({
    where: { id: propertyConfigId, galleryId },
    select: { displayConfig: true, notionPropertyType: true },
  });
  if (!existing) return { error: "Property không còn tồn tại." };
  if (existing.notionPropertyType !== "button") return { error: "Chỉ gán hành động cho property kiểu Button." };

  const config = parseDisplayConfig(existing.displayConfig);
  const parsed = button ? parseNativeButton(button) : null;
  if (parsed) config.button = parsed;
  else delete config.button;

  await db.propertyConfig.update({ where: { id: propertyConfigId }, data: { displayConfig: JSON.stringify(config) } });
  revalidateProperty(galleryId);
  return { error: null };
}

export async function saveGalleryGridSettings(
  galleryId: string,
  viewId: string,
  formData: FormData,
): Promise<{ error: string | null }> {
  const gallery = await db.gallery.findUnique({ where: { id: galleryId } });
  if (!gallery) return { error: "Gallery này không còn trong Hallery." };
  const view = await db.galleryView.findFirst({ where: { id: viewId, galleryId } });
  if (!view) return { error: "View này đã bị xoá — chọn lại view từ Gallery." };
  const config = parseGalleryConfig(gallery.displayConfig);
  const viewConfig = parseViewLayoutConfig(view.layoutConfig, config);
  const cardsPerRow = Number(formData.get("cardsPerRow"));

  viewConfig.cardsPerRow =
    Number.isInteger(cardsPerRow) && cardsPerRow >= MIN_CARDS_PER_ROW && cardsPerRow <= MAX_CARDS_PER_ROW
      ? cardsPerRow
      : DEFAULT_CARDS_PER_ROW;

  config.randomPick = formData.get("randomPick") !== null;

  await db.$transaction([
    db.gallery.update({ where: { id: galleryId }, data: { displayConfig: JSON.stringify(config) } }),
    db.galleryView.update({ where: { id: view.id }, data: { layoutConfig: viewLayoutConfig(viewConfig) } }),
  ]);

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/settings/display`);
  return { error: null };
}

/**
 * Stops Hallery managing a property, or takes it back.
 *
 * Notion keeps the property either way — this only decides whether Hallery treats it as
 * existing at all. Switched off, it leaves cards, the Card Detail, sort, filter and search
 * in one move, and any saved card arrangement mentioning it simply stops resolving until
 * it is switched back on.
 */
export async function setPropertyDisabled(galleryId: string, propertyConfigId: string, disabled: boolean) {
  await db.propertyConfig.update({ where: { id: propertyConfigId }, data: { disabled } });
  revalidateProperty(galleryId);
}

/** Moves a property up or down the order the settings list and the property tray read. */
export async function updatePropertyPlacement(
  galleryId: string,
  propertyConfigId: string,
  action: "up" | "down",
) {
  // Only managed properties take part: a disabled one has no place in the order, and
  // stepping over it would make one press look like it did nothing.
  const configs = (
    await db.propertyConfig.findMany({ where: { galleryId }, orderBy: { sortOrder: "asc" } })
  ).filter((config) => !config.disabled);

  const index = configs.findIndex((config) => config.id === propertyConfigId);
  if (index === -1) return;
  const target = action === "up" ? index - 1 : index + 1;
  if (target < 0 || target >= configs.length) return;

  // Stored order can arrive with ties or gaps, so rewrite the whole list from its new
  // positions rather than swapping two values that may not differ.
  const reordered = [...configs];
  [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
  await db.$transaction(
    reordered.map((config, position) =>
      db.propertyConfig.update({ where: { id: config.id }, data: { sortOrder: position } }),
    ),
  );

  revalidateProperty(galleryId);
}

function revalidateProperty(galleryId: string) {
  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/items/[pageId]`, "page");
  revalidatePath(`/galleries/${galleryId}/settings/display`);
  revalidatePath(`/galleries/${galleryId}/settings/card`);
}
