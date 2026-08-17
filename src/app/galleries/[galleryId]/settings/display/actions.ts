"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import type { DisplayConfig } from "@/lib/display-config";

export async function saveDisplayConfig(
  galleryId: string,
  propertyConfigId: string,
  propertyType: string,
  formData: FormData,
) {
  const config: DisplayConfig = {};

  if (propertyType === "number") {
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
  revalidatePath(`/galleries/${galleryId}/settings/display`);
}
