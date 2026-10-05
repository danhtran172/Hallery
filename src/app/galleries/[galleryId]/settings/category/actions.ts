"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { AXIS_TYPES } from "@/lib/category";

/**
 * Replaces the gallery's category axes with the chosen properties, keeping the order the
 * user ticked them in. Stores the property name alongside the id so the settings screen
 * can still name an axis whose property has since vanished from Notion.
 */
export async function saveCategoryAxes(galleryId: string, formData: FormData): Promise<{ error: string | null }> {
  const gallery = await db.gallery.findUnique({ where: { id: galleryId } });
  if (!gallery) return { error: "Gallery này không còn trong Hallery." };
  const chosen = formData.getAll("axis").map(String);

  // `axis` values arrive as `<propertyId>|<type>|<name>`; the name may contain "|", so
  // only split off the first two segments.
  const parsed = chosen
    .map((raw) => {
      const first = raw.indexOf("|");
      const second = raw.indexOf("|", first + 1);
      if (first === -1 || second === -1) return null;
      return {
        notionPropertyId: raw.slice(0, first),
        sourceType: raw.slice(first + 1, second),
        notionPropertyName: raw.slice(second + 1),
      };
    })
    .filter((axis): axis is NonNullable<typeof axis> => axis !== null)
    .filter((axis) => (AXIS_TYPES as readonly string[]).includes(axis.sourceType));

  await db.$transaction([
    db.categoryAxis.deleteMany({ where: { galleryId: gallery.id } }),
    ...parsed.map((axis, index) =>
      db.categoryAxis.create({
        data: {
          galleryId: gallery.id,
          notionPropertyId: axis.notionPropertyId,
          notionPropertyName: axis.notionPropertyName,
          sourceType: axis.sourceType,
          sortOrder: index,
        },
      }),
    ),
  ]);

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/settings/category`);
  return { error: null };
}
