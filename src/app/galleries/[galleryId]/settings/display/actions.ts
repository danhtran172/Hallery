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

  await db.gallery.update({
    where: { id: galleryId },
    data: { displayConfig: JSON.stringify(config) },
  });

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/settings/display`);
}
