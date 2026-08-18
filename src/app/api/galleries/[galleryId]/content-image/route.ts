import type { NextRequest } from "next/server";
import { resolveContentImage } from "@/lib/content-image-cache";
import { db } from "@/lib/db";

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

  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, include: { workspace: true } });
  if (!gallery) return Response.json({ error: "Gallery không tồn tại" }, { status: 404 });

  const resolved = await resolveContentImage(gallery.workspace.accessToken, pageId);
  return Response.json({ url: resolved.fullUrl });
}
