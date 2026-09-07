import type { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { syncGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";

/**
 * Local Hallery has no account/session layer yet, so this endpoint is deliberately
 * same-origin only and reveals no Notion data. It merely asks the server to reconcile its
 * own cache for a Gallery that is already registered locally.
 */
function isTrustedSameOrigin(request: NextRequest) {
  return request.headers.get("origin") === request.nextUrl.origin;
}

export async function POST(request: NextRequest, ctx: RouteContext<"/api/galleries/[galleryId]/sync">) {
  if (!isTrustedSameOrigin(request)) return Response.json({ error: "Forbidden" }, { status: 403 });

  const { galleryId } = await ctx.params;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true },
  });
  if (!gallery) return Response.json({ error: "Not found" }, { status: 404 });

  try {
    const result = await syncGalleryNotionSnapshot({
      galleryId,
      dataSourceId: gallery.notionDataSourceId,
      accessToken: gallery.workspace.accessToken,
    });
    return Response.json(result, { headers: { "Cache-Control": "no-store" } });
  } catch {
    // The stale snapshot remains usable; callers only need to know to retry on their next
    // heartbeat, never why the Notion request failed.
    return Response.json({ error: "Sync unavailable" }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
