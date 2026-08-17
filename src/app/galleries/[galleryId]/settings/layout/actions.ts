"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { parseDetailLayout, serializeLayoutTemplate } from "@/lib/detail-layout";

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

export type SaveTemplateState = { error: string | null };

/** Saves an explicit copy of a layout, plus source names needed for safe cross-database mapping. */
export async function saveLayoutTemplate(
  galleryId: string,
  _previous: SaveTemplateState,
  formData: FormData,
): Promise<SaveTemplateState> {
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { error: "Đặt tên cho mẫu trước khi lưu." };
  if (name.length > 100) return { error: "Tên mẫu tối đa 100 ký tự." };

  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { propertyConfigs: true },
  });
  if (!gallery) return { error: "Gallery không còn tồn tại." };

  const raw = String(formData.get("layout") ?? "");
  const parsed = parseDetailLayout(raw, gallery.propertyConfigs);
  if (parsed.usedFallback) return { error: "Bố cục không hợp lệ nên chưa thể lưu làm mẫu." };

  await db.layoutTemplate.create({
    data: { name, layout: serializeLayoutTemplate(parsed.layout, gallery.propertyConfigs) },
  });
  revalidatePath(`/galleries/${galleryId}/settings/layout`);
  return { error: null };
}
