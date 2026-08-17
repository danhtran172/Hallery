"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { parseDetailLayout } from "@/lib/detail-layout";

export type SaveLayoutState = { error: string | null };

/** Validates user-supplied layout JSON against this Gallery's shadow-schema fields before saving it. */
export async function saveDetailLayout(
  galleryId: string,
  _previous: SaveLayoutState,
  formData: FormData,
): Promise<SaveLayoutState> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { propertyConfigs: true },
  });
  if (!gallery) return { error: "Gallery không còn tồn tại." };

  const raw = String(formData.get("layout") ?? "");
  const parsed = parseDetailLayout(raw, gallery.propertyConfigs);
  if (parsed.usedFallback) {
    return { error: "Bố cục không hợp lệ. Hãy tải lại trang rồi thử lại." };
  }

  await db.gallery.update({ where: { id: galleryId }, data: { detailLayout: raw } });
  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/items/[pageId]`, "page");
  revalidatePath(`/galleries/${galleryId}/settings/layout`);
  return { error: null };
}
