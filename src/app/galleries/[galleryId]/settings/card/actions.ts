"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  MAX_OVERLAY_FIELDS,
  cardEligibleProperties,
  isPreset,
  type CardField,
  type CardLayout,
} from "@/lib/card-layout";
import { parseGalleryConfig } from "@/lib/notion-cover";

export type SaveCardLayoutState = { error: string | null };

/**
 * Stores how the gallery's cards are arranged. Only ids still present in this gallery's
 * shadow schema survive, so a stale editor tab can't reintroduce a property Notion has
 * since dropped, and a property can only land in one zone.
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

  let submitted: unknown;
  try {
    submitted = JSON.parse(String(formData.get("layout") ?? "null"));
  } catch {
    return { error: "Không đọc được cấu hình. Tải lại trang rồi thử lại." };
  }
  if (typeof submitted !== "object" || submitted === null) {
    return { error: "Không đọc được cấu hình. Tải lại trang rồi thử lại." };
  }

  const { preset, span, fields, overlayFields } = submitted as Record<string, unknown>;
  const allowed = new Set(cardEligibleProperties(gallery.propertyConfigs).map((p) => p.notionPropertyId));
  const taken = new Set<string>();

  const clean = (raw: unknown, limit?: number): CardField[] => {
    if (!Array.isArray(raw)) return [];
    const out: CardField[] = [];
    for (const entry of raw) {
      if (limit !== undefined && out.length >= limit) break;
      if (typeof entry !== "object" || entry === null) continue;
      const { id, showLabel } = entry as { id?: unknown; showLabel?: unknown };
      if (typeof id !== "string" || !allowed.has(id) || taken.has(id)) continue;
      taken.add(id);
      out.push({ id, showLabel: showLabel !== false });
    }
    return out;
  };

  const layout: CardLayout = {
    preset: isPreset(preset) ? preset : "stack",
    span: span === 2 ? 2 : 1,
    // Overlay first: it holds the scarce slots, so it should win a contested property.
    overlayFields: clean(overlayFields, MAX_OVERLAY_FIELDS),
    fields: clean(fields),
  };

  const config = parseGalleryConfig(gallery.displayConfig);
  config.card = layout;

  await db.gallery.update({
    where: { id: galleryId },
    data: { displayConfig: JSON.stringify(config) },
  });

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/settings/card`);
  return { error: null };
}
