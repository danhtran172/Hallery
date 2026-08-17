"use server";

import { db } from "@/lib/db";

const clamp = (n: number) => Math.min(100, Math.max(0, n));

/** Persists where a card's cover image sits after a Ctrl-drag. */
export async function saveCoverPosition(
  galleryId: string,
  notionPageId: string,
  posX: number,
  posY: number,
) {
  const x = clamp(Number(posX) || 50);
  const y = clamp(Number(posY) || 50);

  await db.coverPosition.upsert({
    where: { galleryId_notionPageId: { galleryId, notionPageId } },
    create: { galleryId, notionPageId, posX: x, posY: y },
    update: { posX: x, posY: y },
  });
}
