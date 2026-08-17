import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { findFirstImageUrl } from "@/lib/notion-cover";

/** Notion's signed file URLs live about an hour; refresh a little early to avoid serving a dud. */
const CACHE_TTL_MS = 45 * 60 * 1000;

/**
 * Resolves the first image inside a Notion page, one page per request so the Gallery
 * can fill covers in lazily instead of blocking on a crawl of every page.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/galleries/[galleryId]/content-image">) {
  const { galleryId } = await ctx.params;
  const pageId = request.nextUrl.searchParams.get("pageId");
  if (!pageId) return Response.json({ error: "pageId là bắt buộc" }, { status: 400 });

  const cached = await db.pageImageCache.findUnique({ where: { notionPageId: pageId } });
  if (cached && cached.expiresAt > new Date()) {
    return Response.json({ url: cached.imageUrl });
  }

  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, include: { workspace: true } });
  if (!gallery) return Response.json({ error: "Gallery không tồn tại" }, { status: 404 });

  try {
    const notion = getNotionClient(gallery.workspace.accessToken);
    const url = await findFirstImageUrl(notion, pageId);
    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);

    await db.pageImageCache.upsert({
      where: { notionPageId: pageId },
      create: { notionPageId: pageId, imageUrl: url, expiresAt },
      update: { imageUrl: url, expiresAt },
    });

    return Response.json({ url });
  } catch {
    // A stale URL still beats an empty card, so fall back to whatever we had.
    return Response.json({ url: cached?.imageUrl ?? null });
  }
}
