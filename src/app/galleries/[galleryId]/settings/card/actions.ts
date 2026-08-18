"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { cardEligibleProperties, type CardField } from "@/lib/card-layout";
import { parseGalleryConfig } from "@/lib/notion-cover";

export type SaveCardLayoutState = { error: string | null };

/**
 * Stores which properties the gallery cards show and in what order. Only ids that still
 * exist in this gallery's shadow schema are kept, so a stale editor tab can't reintroduce
 * a property Notion has since dropped.
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
    submitted = JSON.parse(String(formData.get("fields") ?? "[]"));
  } catch {
    return { error: "Không đọc được cấu hình. Tải lại trang rồi thử lại." };
  }
  if (!Array.isArray(submitted)) {
    return { error: "Không đọc được cấu hình. Tải lại trang rồi thử lại." };
  }

  const allowed = new Set(
    cardEligibleProperties(gallery.propertyConfigs).map((p) => p.notionPropertyId),
  );
  const seen = new Set<string>();
  const fields: CardField[] = [];

  for (const entry of submitted) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, showLabel } = entry as { id?: unknown; showLabel?: unknown };
    if (typeof id !== "string" || !allowed.has(id) || seen.has(id)) continue;
    seen.add(id);
    fields.push({ id, showLabel: showLabel !== false });
  }

  const config = parseGalleryConfig(gallery.displayConfig);
  config.card = { fields };

  await db.gallery.update({
    where: { id: galleryId },
    data: { displayConfig: JSON.stringify(config) },
  });

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/settings/card`);
  return { error: null };
}
