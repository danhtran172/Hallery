import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { PropertyValue } from "@/components/property-value";
import { parseDisplayConfig } from "@/lib/display-config";
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
import { parseCardLayout, resolveCardLayout } from "@/lib/card-layout";

/** Written out rather than interpolated so Tailwind keeps the class in the build. */
const CARD_SPAN_CLASS = "sm:col-span-2";

const GALLERY_GRID_COLUMNS: Record<number, string> = {
  1: "lg:grid-cols-1",
  2: "lg:grid-cols-2",
  3: "lg:grid-cols-3",
  4: "lg:grid-cols-4",
  5: "lg:grid-cols-5",
  6: "lg:grid-cols-6",
};

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
  const cardLayout = resolveCardLayout(
    parseCardLayout(galleryConfig.card),
    gallery.propertyConfigs,
    galleryConfig.coverAspect,
  );
  const cardsPerRow = resolveCardsPerRow(galleryConfig);
  const coverRatio = resolveCoverRatio(galleryConfig);
  const coverSource = galleryConfig.coverSource;

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
        <div className={`grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 ${GALLERY_GRID_COLUMNS[cardsPerRow]}`}>
          {pages.map((page) => {
            const title = getPageTitle(page, titlePropertyName);
            const icon = getPageIcon(page);
            const coverUrl = coverRatio
              ? (resolveCoverUrl(page, coverSource) ?? cachedImages.get(page.id) ?? null)
              : null;
            const beside = cardLayout.preset === "beside";
            const valueOf = (propertyId: string) =>
                Object.values(page.properties).find((property) => property.id === propertyId);

              return (
                <div
                  key={page.id}
                  className={`group relative overflow-hidden rounded-lg border border-stone-200 hover:border-emerald-600 hover:shadow-sm ${
                    beside ? "flex" : "flex flex-col"
                  } ${cardLayout.span === 2 ? CARD_SPAN_CLASS : ""}`}
                >
                  <Link
                    href={`/galleries/${galleryId}/items/${page.id}`}
                    aria-label={title}
                    className="absolute inset-0 z-10"
                  />
                  {coverRatio && (
                    <div className={beside ? "relative w-2/5 shrink-0" : "relative"}>
                      <CardCover
                        ratio={coverRatio}
                        url={coverUrl}
                        galleryId={galleryId}
                        pageId={page.id}
                        lazy={coverSource === CONTENT_IMAGE}
                        initialX={positions.get(page.id)?.posX ?? 50}
                        initialY={positions.get(page.id)?.posY ?? 50}
                      />
                      {cardLayout.overlayFields.length > 0 && (
                        // Sits above the card-wide link so overlaid links stay clickable,
                        // and carries a scrim because the image underneath is unknowable.
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex flex-col gap-0.5 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-2">
                          {cardLayout.overlayFields.map(({ property: cfg, showLabel }) => {
                            const value = valueOf(cfg.notionPropertyId);
                            if (!value) return null;
                            return (
                              <span
                                key={cfg.id}
                                className="flex items-baseline gap-1.5 truncate text-xs text-white [&_a]:pointer-events-auto"
                              >
                                {showLabel && (
                                  <span className="shrink-0 text-white/60">{cfg.notionPropertyName}</span>
                                )}
                                <PropertyValue
                                  value={value}
                                  displayConfig={parseDisplayConfig(cfg.displayConfig)}
                                />
                              </span>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  )}
                  <div className="pointer-events-none relative flex min-w-0 flex-1 flex-col gap-2 p-4">
                    <div className="flex items-center gap-2">
                      {icon && <span className="text-lg leading-none">{icon.length <= 4 ? icon : "📄"}</span>}
                      <span className="min-w-0 truncate font-medium text-stone-900">{title}</span>
                    </div>
                    <dl className="flex flex-col gap-1 text-sm text-stone-600">
                      {cardLayout.fields.map(({ property: cfg, showLabel }) => {
                        const value = valueOf(cfg.notionPropertyId);
                        if (!value) return null;
                        return (
                          <div key={cfg.id} className="flex items-baseline gap-2">
                            {showLabel && (
                              <dt className="w-24 shrink-0 truncate text-xs text-stone-400">
                                {cfg.notionPropertyName}
                              </dt>
                            )}
                            <dd className="min-w-0 flex-1 [&_a]:pointer-events-auto">
                              <PropertyValue value={value} displayConfig={parseDisplayConfig(cfg.displayConfig)} />
                            </dd>
                          </div>
                        );
                      })}
                    </dl>
                  </div>
                </div>
              );
          })}
        </div>
      )}
    </div>
  );
}
