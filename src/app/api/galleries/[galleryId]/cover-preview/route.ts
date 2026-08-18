import type { NextRequest } from "next/server";
import { isFullPage } from "@notionhq/client";
import { resolveContentImage } from "@/lib/content-image-cache";
import {
  isSafePageId,
  readCoverImage,
  storeCoverThumbnail,
  storeCoverThumbnailFromUrl,
  storedCoverThumbnailUrl,
} from "@/lib/cover-store";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { parseGalleryConfig, CONTENT_IMAGE, resolveCoverUrl } from "@/lib/notion-cover";

type CoverSource = { fullUrl: string | null; storedFile: string | null };

/** Resolves a card cover from its Gallery/Page identity, never from a caller-provided URL. */
async function resolveCoverSource(galleryId: string, pageId: string): Promise<CoverSource | null> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true },
  });
  if (!gallery) return null;

  const config = parseGalleryConfig(gallery.displayConfig);
  if (config.coverSource === CONTENT_IMAGE) {
    return resolveContentImage(gallery.workspace.accessToken, pageId);
  }

  const snapshot = await getGalleryNotionSnapshot({
    galleryId,
    dataSourceId: gallery.notionDataSourceId,
    accessToken: gallery.workspace.accessToken,
  });
  const page = snapshot.queryRes.results.find(
    (result): result is Parameters<typeof resolveCoverUrl>[0] => isFullPage(result) && result.id === pageId,
  );
  if (!page) return { fullUrl: null, storedFile: null };

  return { fullUrl: resolveCoverUrl(page, config.coverSource), storedFile: null };
}

async function resolvePreviewUrl(pageId: string, source: CoverSource): Promise<string | null> {
  if (!source.fullUrl) return null;

  const sourceKey = source.storedFile ? `stored:${source.storedFile}` : source.fullUrl;
  const cached = await db.pageImageCache.findUnique({ where: { notionPageId: pageId } });
  if (cached?.thumbnailFile && cached.thumbnailSource === sourceKey) {
    return storedCoverThumbnailUrl(pageId, cached.checkedAt.getTime());
  }

  const thumbnailFile = source.storedFile
    ? await readCoverImage(source.storedFile).then((bytes) => (bytes ? storeCoverThumbnail(pageId, bytes) : null))
    : await storeCoverThumbnailFromUrl(pageId, source.fullUrl);
  if (!thumbnailFile) return null;

  const next = await db.pageImageCache.upsert({
    where: { notionPageId: pageId },
    create: {
      notionPageId: pageId,
      imageUrl: null,
      expiresAt: new Date(0),
      thumbnailFile,
      thumbnailSource: sourceKey,
    },
    update: { thumbnailFile, thumbnailSource: sourceKey },
  });
  return storedCoverThumbnailUrl(pageId, next.checkedAt.getTime());
}

/** Returns a tiny WebP preview and the deferred full-image URL for one gallery card. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/galleries/[galleryId]/cover-preview">) {
  const { galleryId } = await ctx.params;
  const pageId = request.nextUrl.searchParams.get("pageId");
  if (!pageId || !isSafePageId(pageId)) {
    return Response.json({ previewUrl: null, fullUrl: null }, { status: 400 });
  }

  let source: CoverSource | null;
  try {
    source = await resolveCoverSource(galleryId, pageId);
  } catch {
    return Response.json({ previewUrl: null, fullUrl: null });
  }
  if (!source) return Response.json({ previewUrl: null, fullUrl: null }, { status: 404 });

  try {
    return Response.json({
      previewUrl: await resolvePreviewUrl(pageId, source),
      fullUrl: source.fullUrl,
    });
  } catch {
    // A full image remains useful even when a preview cannot be generated.
    return Response.json({ previewUrl: null, fullUrl: source.fullUrl });
  }
}
