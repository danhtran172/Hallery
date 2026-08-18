"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  ARRANGEMENTS,
  CARD_LAYOUT_VERSION,
  CARD_RATIOS,
  MAX_OVERLAY_FIELDS,
  cardEligibleProperties,
  isArrangement,
  isCellDisplay,
  type CardCell,
  type CardField,
  type CardLayout,
  type CardRatio,
} from "@/lib/card-layout";
import { COVER_RATIOS, parseGalleryConfig, type CoverAspect } from "@/lib/notion-cover";

export type SaveCardLayoutState = { error: string | null };

/**
 * Stores how the gallery's cards are arranged. Only ids still present in this gallery's
 * shadow schema survive, and a property lands in exactly one box, so a stale editor tab
 * can neither resurrect a deleted property nor duplicate a live one.
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

  const value = submitted as Record<string, unknown>;
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

  const arrangement = isArrangement(value.arrangement) ? value.arrangement : "cover-top";
  const cellsRaw = (value.cells ?? {}) as Record<string, unknown>;
  const cells: Record<string, CardCell> = {};

  // Boxes are cleaned in visual order, so a contested property stays wherever it appears
  // first on the card rather than wherever the client happened to list it.
  const overlay = clean(value.overlay, MAX_OVERLAY_FIELDS);
  for (const id of ARRANGEMENTS[arrangement].cells) {
    const cell = (cellsRaw[id] ?? {}) as Record<string, unknown>;
    cells[id] = {
      display: isCellDisplay(cell.display) ? cell.display : "rows",
      fields: clean(cell.fields),
    };
  }

  const layout: CardLayout = {
    version: CARD_LAYOUT_VERSION,
    arrangement,
    span: value.span === 2 ? 2 : 1,
    ratio:
      (Array.isArray(value.ratio) &&
        CARD_RATIOS.find((r) => r[0] === (value.ratio as unknown[])[0] && r[1] === (value.ratio as unknown[])[1])) ||
      ([40, 60] as CardRatio),
    overlay,
    cells,
  };

  const config = parseGalleryConfig(gallery.displayConfig);
  config.card = layout;

  // Cover shape is edited from the same screen, so it saves on the same click.
  const aspect = String(formData.get("coverAspect") ?? "");
  if (aspect === "landscape" || aspect === "portrait" || aspect === "square") {
    const allowedRatios = COVER_RATIOS[aspect];
    const ratio = String(formData.get("coverRatio") ?? "");
    config.coverAspect = aspect as CoverAspect;
    config.coverRatio = allowedRatios.includes(ratio) ? ratio : allowedRatios[0];
  }

  await db.gallery.update({
    where: { id: galleryId },
    data: { displayConfig: JSON.stringify(config) },
  });

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/settings/card`);
  return { error: null };
}
