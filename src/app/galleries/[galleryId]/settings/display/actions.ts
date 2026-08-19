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
  revalidatePath(`/galleries/${galleryId}/settings/layout`);
}

export async function saveGalleryGridSettings(galleryId: string, formData: FormData) {
  const gallery = await db.gallery.findUniqueOrThrow({ where: { id: galleryId } });
  const config = parseGalleryConfig(gallery.displayConfig);
  const cardsPerRow = Number(formData.get("cardsPerRow"));

  config.cardsPerRow =
    Number.isInteger(cardsPerRow) && cardsPerRow >= MIN_CARDS_PER_ROW && cardsPerRow <= MAX_CARDS_PER_ROW
      ? cardsPerRow
      : DEFAULT_CARDS_PER_ROW;

  config.randomPick = formData.get("randomPick") !== null;

  await db.gallery.update({
    where: { id: galleryId },
    data: { displayConfig: JSON.stringify(config) },
  });

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/settings/display`);
}

/**
 * Hides a property, or moves it up or down the order.
 *
 * Hiding is Hallery-only: the property stays in Notion untouched, it simply stops being
 * offered on cards, in the detail, and in the toolbar's filters. The order is the one the
 * settings list and the property tray read.
 */
export async function updatePropertyPlacement(
  galleryId: string,
  propertyConfigId: string,
  action: "hide" | "show" | "up" | "down",
) {
  const configs = await db.propertyConfig.findMany({
    where: { galleryId },
    orderBy: { sortOrder: "asc" },
  });
  const index = configs.findIndex((config) => config.id === propertyConfigId);
  if (index === -1) return;

  if (action === "hide" || action === "show") {
    await db.propertyConfig.update({
      where: { id: propertyConfigId },
      data: { hidden: action === "hide" },
    });
  } else {
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
  }

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/items/[pageId]`, "page");
  revalidatePath(`/galleries/${galleryId}/settings/display`);
  revalidatePath(`/galleries/${galleryId}/settings/card`);
}
