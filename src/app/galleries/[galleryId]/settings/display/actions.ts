"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type { DisplayConfig } from "@/lib/display-config";
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
) {
  const config: DisplayConfig = {};
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

  await db.propertyConfig.update({
    where: { id: propertyConfigId },
    data: { displayConfig: JSON.stringify(config) },
  });

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/items/[pageId]`, "page");
  revalidatePath(`/galleries/${galleryId}/settings/display`);
  revalidatePath(`/galleries/${galleryId}/settings/card`);
}

export async function saveGalleryGridSettings(galleryId: string, viewId: string, formData: FormData) {
  const gallery = await db.gallery.findUniqueOrThrow({ where: { id: galleryId } });
  const view = await db.galleryView.findFirst({ where: { id: viewId, galleryId } });
  if (!view) return;
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
