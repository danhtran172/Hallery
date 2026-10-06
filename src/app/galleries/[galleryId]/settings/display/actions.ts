"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  DEFAULT_CARDS_PER_ROW,
  MAX_CARDS_PER_ROW,
  MIN_CARDS_PER_ROW,
  parseGalleryConfig,
} from "@/lib/notion-cover";
import { parseViewLayoutConfig, viewLayoutConfig } from "@/lib/gallery-view";

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
  // A table view's form has no such field; its absence must not reset the card count.
  if (formData.has("cardsPerRow")) {
    const cardsPerRow = Number(formData.get("cardsPerRow"));
    viewConfig.cardsPerRow =
      Number.isInteger(cardsPerRow) && cardsPerRow >= MIN_CARDS_PER_ROW && cardsPerRow <= MAX_CARDS_PER_ROW
        ? cardsPerRow
        : DEFAULT_CARDS_PER_ROW;
  }

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
