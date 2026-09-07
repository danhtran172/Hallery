import { db } from "@/lib/db";
import { isSafeCoverVariantFile, isSafePageId, readCoverCard } from "@/lib/cover-store";

/** Serves Hallery's versioned 320px WebP derivative for Gallery cards. */
export async function GET(request: Request, ctx: RouteContext<"/api/covers/[pageId]/card">) {
  const { pageId } = await ctx.params;
  if (!isSafePageId(pageId)) return new Response("Not found", { status: 404 });

  const requestedFile = new URL(request.url).searchParams.get("f");
  const cached = requestedFile ? null : await db.pageImageCache.findUnique({ where: { notionPageId: pageId } });
  const filename = requestedFile ?? cached?.cardFile;
  if (!filename || !isSafeCoverVariantFile(pageId, filename, ".card.webp")) {
    return new Response("Not found", { status: 404 });
  }

  const bytes = await readCoverCard(filename);
  if (!bytes) return new Response("Not found", { status: 404 });

  return new Response(new Uint8Array(bytes), {
    headers: {
      "Content-Type": "image/webp",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
