import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { findFirstImageUrl } from "@/lib/notion-cover";
import { storeCoverImage, storedCoverUrl } from "@/lib/cover-store";

/** Notion's signed file URLs live about an hour; refresh a little early to avoid serving a dud. */
const CACHE_TTL_MS = 45 * 60 * 1000;

/**
 * Resolves the first image inside a Notion page, one page per request so the Gallery can
 * fill covers in lazily instead of blocking on a crawl of every page.
 *
 * The answer is a Hallery URL wherever possible: the bytes get downloaded on first
 * resolve, after which the cover survives Notion's one-hour signed URLs and needs no
 * further requests. Notion's own URL is only returned when storing the copy failed.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/galleries/[galleryId]/content-image">) {
  const { galleryId } = await ctx.params;
  const pageId = request.nextUrl.searchParams.get("pageId");
  if (!pageId) return Response.json({ error: "pageId là bắt buộc" }, { status: 400 });

  const cached = await db.pageImageCache.findUnique({ where: { notionPageId: pageId } });
  if (cached?.storedFile) return Response.json({ url: storedCoverUrl(pageId) });
  if (cached && cached.expiresAt > new Date()) return Response.json({ url: cached.imageUrl });

  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, include: { workspace: true } });
  if (!gallery) return Response.json({ error: "Gallery không tồn tại" }, { status: 404 });

  try {
    const notion = getNotionClient(gallery.workspace.accessToken);
    const url = await findFirstImageUrl(notion, pageId);
    const storedFile = url ? await storeCoverImage(pageId, url) : null;
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    const record = { imageUrl: url, expiresAt, storedFile };

    await db.pageImageCache.upsert({
      where: { notionPageId: pageId },
      create: { notionPageId: pageId, ...record },
      update: record,
    });

    return Response.json({ url: storedFile ? storedCoverUrl(pageId) : url });
  } catch {
    // A stale URL still beats an empty card, so fall back to whatever we had.
    return Response.json({ url: cached?.imageUrl ?? null });
  }
}
