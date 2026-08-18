import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { CardCover } from "@/components/card-cover";
import {
  CONTENT_IMAGE,
  parseGalleryConfig,
  resolveCardsPerRow,
  resolveCoverRatio,
  resolveCoverUrl,
} from "@/lib/notion-cover";
import { isFullDataSource, isFullPage } from "@notionhq/client";
import { syncPropertyConfigs, syncResolvedTypes } from "@/lib/property-config-sync";
import { CategoryBar } from "@/components/category-bar";
import { bucketPages, filterPagesByCategory } from "@/lib/category";
import { storedCoverUrl } from "@/lib/cover-store";
import { CARD_WIDTH_FACTOR, cardKindOf, parseCardLayout, resolveCardLayout } from "@/lib/card-layout";
import { CardGrid } from "@/components/card-grid";

/** Gap between cards, mirrored in the base-width calculation below. */
const CARD_GAP_REM = 1;

export default async function GalleryPage({ params, searchParams }: PageProps<"/galleries/[galleryId]">) {
  const { galleryId } = await params;
  const { axis: axisParam, value: valueParam } = await searchParams;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: {
      workspace: true,
      propertyConfigs: { orderBy: { sortOrder: "asc" } },
      categoryAxes: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!gallery) notFound();

  const notion = getNotionClient(gallery.workspace.accessToken);

  const dataSourceRes = await notion.dataSources.retrieve({ data_source_id: gallery.notionDataSourceId });
  const dataSource = isFullDataSource(dataSourceRes) ? dataSourceRes : null;
  if (dataSource) await syncPropertyConfigs(galleryId, gallery.propertyConfigs, dataSource);
  const titlePropertyName = dataSource ? getTitlePropertyName(dataSource.properties) : null;

  const queryRes = await notion.dataSources.query({
    data_source_id: gallery.notionDataSourceId,
    page_size: 100,
  });
  const allPages = queryRes.results.filter(isFullPage);

  // What each formula/rollup evaluates to is only visible on a page value, and we already
  // have pages here — so learn it now rather than spending a request on it in Settings.
  await syncResolvedTypes(gallery.propertyConfigs, allPages[0]);

  // Category axes bucket and filter the pages already in hand — no extra Notion request.
  // Counts therefore describe the loaded page, hence the "+" when more remain.
  const axes = gallery.categoryAxes.filter((axis) => axis.sourceType !== "relation");
  const firstAxisParam = typeof axisParam === "string" ? axisParam : undefined;
  const activeAxis = axes.find((axis) => axis.id === firstAxisParam) ?? axes[0];
  const activeValue = typeof valueParam === "string" && valueParam !== "" ? valueParam : null;

  const buckets = activeAxis ? bucketPages(allPages, activeAxis) : [];
  const pages =
    activeAxis && activeValue ? filterPagesByCategory(allPages, activeAxis, activeValue) : allPages;

  const galleryConfig = parseGalleryConfig(gallery.displayConfig);
  const cardKindOrientation =
    galleryConfig.coverAspect === "portrait" || galleryConfig.coverAspect === "square"
      ? galleryConfig.coverAspect
      : "landscape";
  const cardLayout = resolveCardLayout(
    parseCardLayout(galleryConfig.card),
    gallery.propertyConfigs,
    galleryConfig.coverAspect,
  );
  const cardsPerRow = resolveCardsPerRow(galleryConfig);
  const coverRatio = resolveCoverRatio(galleryConfig);
  const coverSource = galleryConfig.coverSource;

  const cardKind = cardKindOf(cardLayout.arrangement, cardKindOrientation, cardLayout.extended);

  const positions = new Map(
    (await db.coverPosition.findMany({ where: { galleryId } })).map((p) => [p.notionPageId, p]),
  );

  // Content images already resolved on a previous visit are painted server-side, leaving
  // the client to chase only the ones we've never seen. Pages we hold a local copy of are
  // served from Hallery, so they keep working long after Notion's signed URL has expired.
  const cachedImages =
    coverSource === CONTENT_IMAGE
      ? new Map(
          (
            await db.pageImageCache.findMany({
              where: {
                notionPageId: { in: pages.map((p) => p.id) },
                OR: [{ storedFile: { not: null } }, { expiresAt: { gt: new Date() } }],
              },
            })
          ).map((c) => [c.notionPageId, c.storedFile ? storedCoverUrl(c.notionPageId) : c.imageUrl]),
        )
      : new Map<string, string | null>();

  return (
    <div className="w-full px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-stone-500 hover:underline">
            ← Tất cả gallery
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">{gallery.name}</h1>
          <p className="text-sm text-stone-500">
            {pages.length} item
            {activeValue && ` · lọc từ ${allPages.length}`}
          </p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={`/galleries/${galleryId}/settings/category`}
            className="text-xs text-stone-500 hover:underline"
          >
            Phân loại
          </Link>
          <Link
            href={`/galleries/${galleryId}/settings/card`}
            className="text-xs text-stone-500 hover:underline"
          >
            Bố cục card
          </Link>
          <Link
            href={`/galleries/${galleryId}/settings/layout`}
            className="text-xs text-stone-500 hover:underline"
          >
            Bố cục chi tiết
          </Link>
          <Link
            href={`/galleries/${galleryId}/settings/cover`}
            className="text-xs text-stone-500 hover:underline"
          >
            Ảnh bìa
          </Link>
          <Link
            href={`/galleries/${galleryId}/settings/display`}
            className="text-xs text-stone-500 hover:underline"
          >
            Cài đặt hiển thị
          </Link>
        </div>
      </div>

      {activeAxis && buckets.length > 0 && (
        <CategoryBar
          galleryId={galleryId}
          axes={axes}
          activeAxis={activeAxis}
          buckets={buckets}
          activeValue={activeValue}
          partialCounts={queryRes.has_more}
        />
      )}

      {pages.length === 0 ? (
        <p className="rounded-md border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500">
          {activeValue
            ? "Không có item nào trong phân loại này."
            : "Database này chưa có item nào."}
        </p>
      ) : (
        // Cards are a fixed width per kind rather than stretching, so a gallery of mixed
        // layouts still lines up. "Cards per row" now sets what one normal card is wide.
        <div
          className="flex flex-wrap gap-4"
          style={
            {
              "--card-base": `calc((100% - ${(cardsPerRow - 1) * CARD_GAP_REM}rem) / ${cardsPerRow})`,
            } as React.CSSProperties
          }
        >
          {pages.map((page) => {
            const title = getPageTitle(page, titlePropertyName);
            const icon = getPageIcon(page);
            const coverUrl = coverRatio
              ? (resolveCoverUrl(page, coverSource) ?? cachedImages.get(page.id) ?? null)
              : null;
            const showCover = cardLayout.cover !== "none" && coverRatio;
            const valueOf = (propertyId: string) =>
              Object.values(page.properties).find((property) => property.id === propertyId);
            const region = (id: string) =>
              cardLayout.regions[id] ? (
                <CardGrid grid={cardLayout.regions[id]} title={title} valueOf={valueOf} />
              ) : null;

            const cover = showCover && (
              <div
                className="relative shrink-0"
                style={cardLayout.sideBySide ? { width: `${cardLayout.ratio[0]}%` } : undefined}
              >
                <CardCover
                  ratio={coverRatio}
                  url={coverUrl}
                  galleryId={galleryId}
                  pageId={page.id}
                  lazy={coverSource === CONTENT_IMAGE}
                  initialX={positions.get(page.id)?.posX ?? 50}
                  initialY={positions.get(page.id)?.posY ?? 50}
                />
                {cardLayout.overlay.length > 0 && (
                  // Above the card-wide link so overlaid links stay clickable, and on a
                  // scrim because the image underneath is unknowable.
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-2 [&_dd]:text-white [&_dt]:!text-white/60 [&_p]:!text-white">
                    <CardGrid
                      grid={{
                        cols: 1,
                        rows: 1,
                        boxes: [
                          { id: "overlay", colSpan: 1, rowSpan: 1, merged: false, fields: cardLayout.overlay },
                        ],
                      }}
                      title={title}
                      valueOf={valueOf}
                    />
                  </div>
                )}
              </div>
            );

            return (
              <div
                key={page.id}
                className="group relative flex shrink-0 flex-col overflow-hidden rounded-lg border border-stone-200 hover:border-emerald-600 hover:shadow-sm"
                style={{ width: `calc(var(--card-base) * ${CARD_WIDTH_FACTOR[cardKind]})` }}
              >
                <Link
                  href={`/galleries/${galleryId}/items/${page.id}`}
                  aria-label={title}
                  className="absolute inset-0 z-10"
                />

                {cardLayout.sideBySide ? (
                  <>
                    <div className="flex">
                      {cardLayout.cover === "left" && cover}
                      <div className="pointer-events-none relative min-w-0 flex-1 p-4">{region("main")}</div>
                      {cardLayout.cover === "right" && cover}
                    </div>
                    {cardLayout.regions.below && (
                      <div className="pointer-events-none relative px-4 pb-4">{region("below")}</div>
                    )}
                  </>
                ) : (
                  <>
                    {cover}
                    {Object.keys(cardLayout.regions).length > 0 && (
                      <div className="pointer-events-none relative flex flex-col gap-2 p-4">
                        {icon && <span className="text-lg leading-none">{icon}</span>}
                        {Object.keys(cardLayout.regions).map((id) => (
                          <div key={id}>{region(id)}</div>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
