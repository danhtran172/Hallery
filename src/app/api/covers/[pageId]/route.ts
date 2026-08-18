import { db } from "@/lib/db";
import { CONTENT_TYPE_BY_EXTENSION, isSafePageId, readCoverImage } from "@/lib/cover-store";

/**
 * Serves Hallery's own copy of a cover image. Unlike Notion's signed URLs this never
 * expires, so the browser can cache it hard and the Gallery stops re-resolving covers.
 */
export async function GET(_request: Request, ctx: RouteContext<"/api/covers/[pageId]">) {
  const { pageId } = await ctx.params;
  if (!isSafePageId(pageId)) return new Response("Not found", { status: 404 });

  const cached = await db.pageImageCache.findUnique({ where: { notionPageId: pageId } });
  if (!cached?.storedFile) return new Response("Not found", { status: 404 });

  const bytes = await readCoverImage(cached.storedFile);
  if (!bytes) return new Response("Not found", { status: 404 });

  const extension = cached.storedFile.split(".").pop() ?? "jpg";
  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": CONTENT_TYPE_BY_EXTENSION[extension] ?? "application/octet-stream",
      // The bytes for a given page never change under us — a new cover writes a new row.
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
