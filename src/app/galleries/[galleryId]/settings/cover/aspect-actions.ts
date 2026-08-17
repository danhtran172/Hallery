"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  CONTENT_IMAGE,
  PAGE_COVER,
  PROPERTY_PREFIX,
  parseGalleryConfig,
  type GalleryConfig,
} from "@/lib/notion-cover";

const ASPECTS = new Set<GalleryConfig["coverAspect"]>(["landscape", "portrait", "square", "none"]);

export async function saveCoverSettings(galleryId: string, formData: FormData) {
  const gallery = await db.gallery.findUniqueOrThrow({ where: { id: galleryId } });
  const config = parseGalleryConfig(gallery.displayConfig);

  const aspect = String(formData.get("coverAspect") ?? "") as GalleryConfig["coverAspect"];
  config.coverAspect = ASPECTS.has(aspect) ? aspect : "landscape";

  const source = String(formData.get("coverSource") ?? "");
  const validSource =
    source === PAGE_COVER || source === CONTENT_IMAGE || source.startsWith(PROPERTY_PREFIX);
  config.coverSource = validSource ? source : PAGE_COVER;

  await db.gallery.update({
    where: { id: galleryId },
    data: { displayConfig: JSON.stringify(config) },
  });

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/settings/cover`);
}
