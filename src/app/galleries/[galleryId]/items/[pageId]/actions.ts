"use server";

import { revalidatePath } from "next/cache";
import type { UpdatePageParameters } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { buildPropertyUpdate } from "@/lib/notion-write";

export type SaveItemState = { error: string | null };

export async function saveItem(
  galleryId: string,
  pageId: string,
  _prevState: SaveItemState,
  formData: FormData,
): Promise<SaveItemState> {
  const gallery = await db.gallery.findUniqueOrThrow({
    where: { id: galleryId },
    include: { workspace: true },
  });
  const notion = getNotionClient(gallery.workspace.accessToken);

  // Fields are posted as `field:<propertyType>:<propertyName>` (name last, since it's the only
  // part that may itself contain a colon) so we know how to encode each one.
  const properties: Record<string, unknown> = {};
  for (const key of formData.keys()) {
    if (!key.startsWith("field:")) continue;
    const rest = key.slice("field:".length);
    const separatorIndex = rest.indexOf(":");
    if (separatorIndex === -1) continue;
    const propertyType = rest.slice(0, separatorIndex);
    const propertyName = rest.slice(separatorIndex + 1);
    const update = buildPropertyUpdate(propertyType, formData, key);
    if (update) properties[propertyName] = update;
  }

  try {
    await notion.pages.update({
      page_id: pageId,
      properties: properties as UpdatePageParameters["properties"],
    });
  } catch {
    return { error: "Không lưu được — Notion từ chối request. Có thể property đã đổi kiểu hoặc bị xoá." };
  }

  revalidatePath(`/galleries/${galleryId}/items/${pageId}`);
  revalidatePath(`/galleries/${galleryId}`);
  return { error: null };
}
