"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import {
  CONTENT_IMAGE,
  COVER_RATIOS,
  PAGE_COVER,
  PROPERTY_PREFIX,
  parseGalleryConfig,
  type CoverAspect,
} from "@/lib/notion-cover";

const ASPECTS = new Set<CoverAspect>(["landscape", "portrait", "square", "none"]);

export async function saveCoverSettings(galleryId: string, formData: FormData) {
  const gallery = await db.gallery.findUniqueOrThrow({ where: { id: galleryId } });
  const config = parseGalleryConfig(gallery.displayConfig);

  const aspect = String(formData.get("coverAspect") ?? "") as CoverAspect;
  config.coverAspect = ASPECTS.has(aspect) ? aspect : "landscape";

  if (config.coverAspect !== "none") {
    const allowed = COVER_RATIOS[config.coverAspect];
    const ratio = String(formData.get("coverRatio") ?? "");
    config.coverRatio = allowed.includes(ratio) ? ratio : allowed[0];
  }

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
