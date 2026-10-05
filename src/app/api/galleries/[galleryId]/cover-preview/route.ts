import type { NextRequest } from "next/server";
import { resolveContentImage } from "@/lib/content-image-cache";
import {
  clearHostCooldowns,
  coverSourceFingerprint,
  isSafePageId,
  readCoverImage,
  storeCoverVariants,
  storeCoverVariantsFromUrl,
  storedCoverCardUrl,
  storedCoverThumbnailUrl,
} from "@/lib/cover-store";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot, snapshotPage } from "@/lib/gallery-notion-cache";
import { parseGalleryConfig, CONTENT_IMAGE, resolveCoverUrl } from "@/lib/notion-cover";
import { parseViewLayoutConfig } from "@/lib/gallery-view";

type CoverSource = { fullUrl: string | null; storedFile: string | null };

/** Resolves a card cover from its Gallery/Page identity, never from a caller-provided URL. */
async function resolveCoverSource(galleryId: string, pageId: string, viewId: string | null): Promise<CoverSource | null> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, views: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) return null;

  const legacyConfig = parseGalleryConfig(gallery.displayConfig);
  const view = gallery.views.find((entry) => entry.id === viewId) ?? gallery.views[0];
  const config = view ? parseViewLayoutConfig(view.layoutConfig, legacyConfig) : legacyConfig;
  if (config.coverSource === CONTENT_IMAGE) {
    return resolveContentImage(gallery.workspace.accessToken, pageId);
  }

  const snapshot = await getGalleryNotionSnapshot({
    galleryId,
    dataSourceId: gallery.notionDataSourceId,
    accessToken: gallery.workspace.accessToken,
  });
  const page = snapshotPage(snapshot, pageId);
  if (!page) return { fullUrl: null, storedFile: null };

  return { fullUrl: resolveCoverUrl(page, config.coverSource), storedFile: null };
}

type CardCoverUrls = { previewUrl: string | null; cardUrl: string | null };

async function resolveCardCoverUrls(pageId: string, source: CoverSource): Promise<CardCoverUrls> {
  if (!source.fullUrl) return { previewUrl: null, cardUrl: null };

  const sourceKey = source.storedFile ? `stored:${source.storedFile}` : coverSourceFingerprint(source.fullUrl);
  const cached = await db.pageImageCache.findUnique({ where: { notionPageId: pageId } });
  if (cached?.thumbnailFile && cached.cardFile && cached.detailFile && cached.thumbnailSource === sourceKey) {
    return {
      previewUrl: storedCoverThumbnailUrl(pageId, cached.checkedAt.getTime(), cached.thumbnailFile),
      cardUrl: storedCoverCardUrl(pageId, cached.checkedAt.getTime(), cached.cardFile),
    };
  }

  const variants = source.storedFile
    ? await readCoverImage(source.storedFile).then((bytes) =>
        bytes ? storeCoverVariants(pageId, bytes, sourceKey) : null,
      )
    : await storeCoverVariantsFromUrl(pageId, source.fullUrl, sourceKey);
  if (!variants) return { previewUrl: null, cardUrl: null };

  const next = await db.pageImageCache.upsert({
    where: { notionPageId: pageId },
    create: {
      notionPageId: pageId,
      imageUrl: null,
      expiresAt: new Date(0),
      thumbnailFile: variants.thumbnailFile,
      cardFile: variants.cardFile,
      detailFile: variants.detailFile,
      thumbnailSource: sourceKey,
    },
    update: {
      thumbnailFile: variants.thumbnailFile,
      cardFile: variants.cardFile,
      detailFile: variants.detailFile,
      thumbnailSource: sourceKey,
    },
  });
  return {
    previewUrl: storedCoverThumbnailUrl(pageId, next.checkedAt.getTime(), variants.thumbnailFile),
    cardUrl: storedCoverCardUrl(pageId, next.checkedAt.getTime(), variants.cardFile),
  };
}

/** Returns local 64px and 320px WebP derivatives for one gallery card. */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/galleries/[galleryId]/cover-preview">) {
  const { galleryId } = await ctx.params;
  const pageId = request.nextUrl.searchParams.get("pageId");
  const viewId = request.nextUrl.searchParams.get("view");
  if (!pageId || !isSafePageId(pageId)) {
    return Response.json({ previewUrl: null, cardUrl: null, fullUrl: null }, { status: 400 });
  }

  // Someone pressing retry is telling us the network changed, which outranks a cooldown
  // that was recorded before it did.
  if (request.nextUrl.searchParams.get("retry") === "1") clearHostCooldowns();

  let source: CoverSource | null;
  try {
    source = await resolveCoverSource(galleryId, pageId, viewId);
  } catch {
    // Not "no picture": the lookup itself failed, and the card should offer "Thử lại"
    // rather than settle into a blank grey block.
    return Response.json({ previewUrl: null, cardUrl: null, fullUrl: null }, { status: 503 });
  }
  if (!source) return Response.json({ previewUrl: null, cardUrl: null, fullUrl: null }, { status: 404 });

  try {
    const variants = await resolveCardCoverUrls(pageId, source);
    return Response.json({
      previewUrl: variants.previewUrl,
      cardUrl: variants.cardUrl,
      fullUrl: source.fullUrl,
    });
  } catch {
    // A full image remains useful even when a local derivative cannot be generated.
    return Response.json({ previewUrl: null, cardUrl: null, fullUrl: source.fullUrl });
  }
}
