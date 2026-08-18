"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  ARRANGEMENTS,
  MAX_OVERLAY_FIELDS,
  TITLE_FIELD_ID,
  cardEligibleProperties,
  parseCardLayout,
  type CardField,
  type CardLayout,
  type Grid,
} from "@/lib/card-layout";
import { parseDisplayConfig, type DisplayConfig } from "@/lib/display-config";
import { COVER_RATIOS, parseGalleryConfig, type CoverAspect } from "@/lib/notion-cover";

export type SaveCardLayoutState = { error: string | null };

/**
 * Saves the card arrangement, the cover shape, and any property display settings touched
 * in the side panel — all edited on one screen, so all committed on one click.
 *
 * Only ids still present in this gallery's shadow schema survive, and a property lands in
 * exactly one box, so a stale editor tab can neither resurrect a deleted property nor
 * duplicate a live one.
 */
export async function saveCardLayout(
  galleryId: string,
  _previous: SaveCardLayoutState,
  formData: FormData,
): Promise<SaveCardLayoutState> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { propertyConfigs: true },
  });
  if (!gallery) return { error: "Gallery không còn tồn tại." };

  const parsed = parseCardLayout(readJson(formData.get("layout")));
  if (!parsed) return { error: "Không đọc được bố cục. Tải lại trang rồi thử lại." };

  const allowed = new Set(cardEligibleProperties(gallery.propertyConfigs).map((p) => p.notionPropertyId));
  allowed.add(TITLE_FIELD_ID);
  const taken = new Set<string>();

  const keep = (fields: CardField[], limit?: number): CardField[] => {
    const out: CardField[] = [];
    for (const field of fields) {
      if (limit !== undefined && out.length >= limit) break;
      if (!allowed.has(field.id) || taken.has(field.id)) continue;
      taken.add(field.id);
      out.push(field);
    }
    return out;
  };

  const prune = (grid: Grid): Grid => ({
    ...grid,
    boxes: grid.boxes.map((box) => ({ ...box, fields: keep(box.fields) })),
  });

  // Overlay first: it holds the scarce slots, so it wins a contested property.
  const overlay = keep(parsed.overlay, MAX_OVERLAY_FIELDS);
  const regions: Record<string, Grid> = {};
  for (const id of ARRANGEMENTS[parsed.arrangement].regions) {
    regions[id] = prune(parsed.regions[id]);
  }

  const layout: CardLayout = { ...parsed, overlay, regions };
  const config = parseGalleryConfig(gallery.displayConfig);
  config.card = layout;

  const aspect = String(formData.get("coverAspect") ?? "");
  if (aspect === "landscape" || aspect === "portrait" || aspect === "square") {
    const ratios = COVER_RATIOS[aspect];
    const ratio = String(formData.get("coverRatio") ?? "");
    config.coverAspect = aspect as CoverAspect;
    config.coverRatio = ratios.includes(ratio) ? ratio : ratios[0];
  }

  const writes = [
    db.gallery.update({ where: { id: galleryId }, data: { displayConfig: JSON.stringify(config) } }),
    ...propertyConfigWrites(readJson(formData.get("propertyConfigs")), gallery.propertyConfigs),
  ];
  await db.$transaction(writes);

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/items/[pageId]`, "page");
  revalidatePath(`/galleries/${galleryId}/settings/card`);
  revalidatePath(`/galleries/${galleryId}/settings/display`);
  return { error: null };
}

function readJson(raw: FormDataEntryValue | null): unknown {
  try {
    return JSON.parse(String(raw ?? "null"));
  } catch {
    return null;
  }
}

/** Merges the panel's edits into each property's existing display config. */
function propertyConfigWrites(
  raw: unknown,
  existing: { id: string; notionPropertyId: string; displayConfig: string }[],
) {
  if (typeof raw !== "object" || raw === null) return [];
  const byProperty = new Map(existing.map((property) => [property.notionPropertyId, property]));

  return Object.entries(raw as Record<string, unknown>).flatMap(([propertyId, value]) => {
    const property = byProperty.get(propertyId);
    if (!property || typeof value !== "object" || value === null) return [];

    const incoming = value as DisplayConfig;
    const merged: DisplayConfig = { ...parseDisplayConfig(property.displayConfig), ...incoming };
    // An emptied override should disappear rather than persist as "".
    if (!merged.nameOverride?.trim()) delete merged.nameOverride;

    return [
      db.propertyConfig.update({
        where: { id: property.id },
        data: { displayConfig: JSON.stringify(merged) },
      }),
    ];
  });
}
