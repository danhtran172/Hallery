import { db } from "@/lib/db";
import { isSafeCoverVariantFile, isSafePageId, readCoverDetail } from "@/lib/cover-store";

/** Serves Hallery's versioned 768px WebP derivative for the single Card Detail cover. */
export async function GET(request: Request, ctx: RouteContext<"/api/covers/[pageId]/detail">) {
  const { pageId } = await ctx.params;
  if (!isSafePageId(pageId)) return new Response("Not found", { status: 404 });

  const requestedFile = new URL(request.url).searchParams.get("f");
  const cached = requestedFile ? null : await db.pageImageCache.findUnique({ where: { notionPageId: pageId } });
  const filename = requestedFile ?? cached?.detailFile;
  if (!filename || !isSafeCoverVariantFile(pageId, filename, ".detail.webp")) {
    return new Response("Not found", { status: 404 });
  }

  const bytes = await readCoverDetail(filename);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
