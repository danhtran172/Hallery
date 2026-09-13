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
import { parseFormDefaults } from "@/lib/create-form";
import {
  CONTENT_IMAGE,
  COVER_RATIOS,
  MAX_DETAIL_WIDTH,
  MIN_DETAIL_WIDTH,
  PAGE_COVER,
  PROPERTY_PREFIX,
  parseGalleryConfig,
  type CoverAspect,
} from "@/lib/notion-cover";
import { parseViewLayoutConfig, viewLayoutConfig } from "@/lib/gallery-view";

export type SaveCardLayoutState = { error: string | null };

/**
 * Saves both arrangements, the cover shape, the detail's width, and any property display
 * settings touched in the side panel — one screen edits the pair, so one click commits it.
 *
 * Only ids still present in this gallery's shadow schema survive, and a property lands in
 * exactly one box, so a stale editor tab can neither resurrect a deleted property nor
 * duplicate a live one.
 */
export async function saveCardLayout(
  galleryId: string,
  viewId: string,
  _previous: SaveCardLayoutState,
  formData: FormData,
): Promise<SaveCardLayoutState> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { propertyConfigs: true },
  });
  if (!gallery) return { error: "Gallery không còn tồn tại." };
  const view = await db.galleryView.findFirst({ where: { id: viewId, galleryId } });
  if (!view) return { error: "View này không còn tồn tại." };

  const parsed = parseCardLayout(readJson(formData.get("layout")));
  if (!parsed) return { error: "Không đọc được bố cục. Tải lại trang rồi thử lại." };

  const allowed = new Set(cardEligibleProperties(gallery.propertyConfigs).map((p) => p.notionPropertyId));
  allowed.add(TITLE_FIELD_ID);

  /**
   * Prunes one arrangement. Each view gets its own `taken` set: the two are stored
   * separately and a property may sit on both, so sharing one would let whichever saved
   * first swallow the id and blank the other view.
   */
  const sanitize = (layout: CardLayout): CardLayout => {
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
    const overlay = keep(layout.overlay, MAX_OVERLAY_FIELDS);
    const regions: Record<string, Grid> = {};
    for (const id of ARRANGEMENTS[layout.arrangement].regions) {
      regions[id] = prune(layout.regions[id]);
    }
    return {
      ...layout,
      overlay,
      regions,
      labelVisibility: Object.fromEntries(
        Object.entries(layout.labelVisibility).filter(([id]) => allowed.has(id)),
      ),
    };
  };

  // Only the gallery card is a view concern. Detail and quick-entry retain their
  // gallery-wide configuration below, even though one editor exposes all three.
  const config = parseGalleryConfig(gallery.displayConfig);
  const viewConfig = parseViewLayoutConfig(view.layoutConfig, config);
  viewConfig.card = sanitize(parsed);

  const parsedDetail = parseCardLayout(readJson(formData.get("detailLayout")));
  if (parsedDetail) config.detailCard = sanitize(parsedDetail);

  const parsedForm = parseCardLayout(readJson(formData.get("formLayout")));
  if (parsedForm) config.formCard = sanitize(parsedForm);
  config.formDefaults = parseFormDefaults(readJson(formData.get("formDefaults")));

  const width = Number(formData.get("detailWidth"));
  if (Number.isFinite(width)) {
    config.detailWidth = Math.min(MAX_DETAIL_WIDTH, Math.max(MIN_DETAIL_WIDTH, Math.round(width)));
  }

  const aspect = String(formData.get("coverAspect") ?? "");
  if (aspect === "landscape" || aspect === "portrait" || aspect === "square" || aspect === "circle") {
    const ratios = COVER_RATIOS[aspect];
    const ratio = String(formData.get("coverRatio") ?? "");
    viewConfig.coverAspect = aspect as CoverAspect;
    viewConfig.coverRatio = ratios.includes(ratio) ? ratio : ratios[0];
  }

  const source = String(formData.get("coverSource") ?? "");
  if (source === PAGE_COVER || source === CONTENT_IMAGE || source.startsWith(PROPERTY_PREFIX)) {
    viewConfig.coverSource = source;
  }

  const target = String(formData.get("formCoverTarget") ?? "");
  if (target === PAGE_COVER || target === CONTENT_IMAGE || target.startsWith(PROPERTY_PREFIX)) {
    config.formCoverTarget = target;
  }

  const formAspect = String(formData.get("formCoverAspect") ?? "");
  if (formAspect === "landscape" || formAspect === "portrait" || formAspect === "square" || formAspect === "circle") {
    const ratios = COVER_RATIOS[formAspect];
    const formRatio = String(formData.get("formCoverRatio") ?? "");
    config.formCoverAspect = formAspect as CoverAspect;
    config.formCoverRatio = ratios.includes(formRatio) ? formRatio : ratios[0];
  }

  const detailAspect = String(formData.get("detailCoverAspect") ?? "");
  if (detailAspect === "landscape" || detailAspect === "portrait" || detailAspect === "square" || detailAspect === "circle") {
    const ratios = COVER_RATIOS[detailAspect];
    const detailRatio = String(formData.get("detailCoverRatio") ?? "");
    config.detailCoverAspect = detailAspect as CoverAspect;
    config.detailCoverRatio = ratios.includes(detailRatio) ? detailRatio : ratios[0];
  }

  const writes = [
    db.gallery.update({ where: { id: galleryId }, data: { displayConfig: JSON.stringify(config) } }),
    db.galleryView.update({ where: { id: view.id }, data: { layoutConfig: viewLayoutConfig(viewConfig) } }),
    ...propertyConfigWrites(
      readJson(formData.get("propertyConfigs")),
      readJson(formData.get("detailPropertyConfigs")),
      gallery.propertyConfigs,
    ),
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

type StoredPropertyConfig = {
  id: string;
  notionPropertyId: string;
  displayConfig: string;
  detailDisplayConfig: string;
};

/**
 * Merges the panel's edits into each property, per view.
 *
 * The two views format independently, so an edit made while the detail was open must land
 * in `detailDisplayConfig` alone — writing it to the shared column would drag the gallery
 * card along with it, which is exactly what splitting them was meant to stop.
 */
function propertyConfigWrites(rawGallery: unknown, rawDetail: unknown, existing: StoredPropertyConfig[]) {
  const byProperty = new Map(existing.map((property) => [property.notionPropertyId, property]));
  const edits = new Map<string, { displayConfig?: string; detailDisplayConfig?: string }>();

  const collect = (raw: unknown, column: "displayConfig" | "detailDisplayConfig") => {
    if (typeof raw !== "object" || raw === null) return;
    for (const [propertyId, value] of Object.entries(raw as Record<string, unknown>)) {
      const property = byProperty.get(propertyId);
      if (!property || typeof value !== "object" || value === null) continue;

      // A detail with nothing of its own has been showing the card's settings, so that is
      // what an edit there starts from.
      const base =
        column === "detailDisplayConfig"
          ? property.detailDisplayConfig || property.displayConfig
          : property.displayConfig;
      const merged: DisplayConfig = { ...parseDisplayConfig(base), ...(value as DisplayConfig) };
      // An emptied override should disappear rather than persist as "".
      if (!merged.nameOverride?.trim()) delete merged.nameOverride;

      edits.set(propertyId, { ...edits.get(propertyId), [column]: JSON.stringify(merged) });
    }
  };

  collect(rawGallery, "displayConfig");
  collect(rawDetail, "detailDisplayConfig");

  return [...edits].flatMap(([propertyId, data]) => {
    const property = byProperty.get(propertyId);
    return property ? [db.propertyConfig.update({ where: { id: property.id }, data })] : [];
  });
}
