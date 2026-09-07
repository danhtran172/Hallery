import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { CardCover } from "@/components/card-cover";
import {
  CONTENT_IMAGE,
  PAGE_COVER,
  PROPERTY_PREFIX,
  parseGalleryConfig,
  resolveCardsPerRow,
  resolveCoverRatio,
  resolveCoverUrl,
  resolveFormCoverShape,
} from "@/lib/notion-cover";
import { isFullDataSource, isFullPage, type PageObjectResponse } from "@notionhq/client";
import { syncPropertyConfigs, syncResolvedTypes } from "@/lib/property-config-sync";
import { CategoryBar } from "@/components/category-bar";
import { bucketPages, filterPagesByCategory } from "@/lib/category";
import {
  ARRANGEMENTS,
  CARD_WIDTH_FACTOR,
  TITLE_FIELD_ID,
  cardKindOf,
  isRoundCover,
  parseCardLayout,
  resolveCardLayout,
} from "@/lib/card-layout";
import { CreateItemPopup, type CreateFormField } from "@/components/create-item-popup";
import {
  FORM_FIELD_TYPES,
  parseFormDefaults,
  parseFormLastValues,
  resolveDefaultValue,
} from "@/lib/create-form";
import { CardGrid } from "@/components/card-grid";
import { GalleryToolbar, type ToolbarProperty } from "@/components/gallery-toolbar";
import {
  RETURN_PARAM,
  applyGalleryQuery,
  groupPages,
  parseGalleryQuery,
  returnQueryString,
} from "@/lib/gallery-query";
import { configTypeOf } from "@/lib/property-kind";
import { RelationGalleryMenu } from "@/components/relation-gallery-menu";
import { listRelationGalleries } from "@/lib/relation-galleries";
import { GallerySyncHeartbeat } from "@/components/gallery-sync-heartbeat";
import {
  coverSourceFingerprint,
  storedCoverCardUrl,
  storedCoverThumbnailUrl,
  storedCoverUrl,
} from "@/lib/cover-store";

/** Gap between cards, mirrored in the base-width calculation below. */
const CARD_GAP_REM = 1;
const CARDS_PER_PAGE = 24;

function requestedCardPage(value: string | string[] | undefined, totalCards: number) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : 1;
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return Math.min(page, Math.max(1, Math.ceil(totalCards / CARDS_PER_PAGE)));
}

function withCardPage(
  search: Record<string, string | string[] | undefined>,
  cardPage: number,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" && key !== "cardPage") params.set(key, value);
  }
  params.set("cardPage", String(cardPage));
  return params.toString();
}

export default async function GalleryPage({ params, searchParams }: PageProps<"/galleries/[galleryId]">) {
  const { galleryId } = await params;
  const search = await searchParams;
  const { axis: axisParam, value: valueParam } = search;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: {
      workspace: true,
      propertyConfigs: { orderBy: { sortOrder: "asc" } },
      categoryAxes: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!gallery) notFound();

  const { dataSourceRes, queryRes } = await getGalleryNotionSnapshot({
    galleryId,
    dataSourceId: gallery.notionDataSourceId,
    accessToken: gallery.workspace.accessToken,
  });
  const dataSource = isFullDataSource(dataSourceRes) ? dataSourceRes : null;
  if (dataSource) await syncPropertyConfigs(galleryId, gallery.propertyConfigs, dataSource);
  const titlePropertyName = dataSource ? getTitlePropertyName(dataSource.properties) : null;

  const allPages = queryRes.results.filter(isFullPage);

  // What each formula/rollup evaluates to is only visible on a page value, and we already
  // have pages here — so learn it now rather than spending a request on it in Settings.
  await syncResolvedTypes(gallery.propertyConfigs, allPages[0]);

  // Relation axes name other tables rather than values inside this one, so they cannot be
  // bucketed alongside the rest — they drive the gallery-switching menu instead.
  const relationGalleries = dataSource
    ? await listRelationGalleries(gallery.workspaceId, dataSource.properties)
    : [];

  // Category axes bucket and filter the pages already in hand — no extra Notion request.
  // Counts therefore describe the loaded page, hence the "+" when more remain.
  const axes = gallery.categoryAxes.filter((axis) => axis.sourceType !== "relation");
  const firstAxisParam = typeof axisParam === "string" ? axisParam : undefined;
  const activeAxis = axes.find((axis) => axis.id === firstAxisParam) ?? axes[0];
  const activeValue = typeof valueParam === "string" && valueParam !== "" ? valueParam : null;

  const buckets = activeAxis ? bucketPages(allPages, activeAxis) : [];
  const categoryPages =
    activeAxis && activeValue ? filterPagesByCategory(allPages, activeAxis, activeValue) : allPages;

  // A property Hallery no longer manages is absent as far as the toolbar is concerned —
  // not shown, not filtered on, and not searched.
  const managed = gallery.propertyConfigs.filter((config) => !config.disabled && !config.isMissing);
  const searchable = new Set(managed.map((config) => config.notionPropertyId));

  // The toolbar narrows whatever the category axis left, so the two compose rather than
  // fight: pick a category, then search or filter inside it.
  const query = parseGalleryQuery(search);
  const pages = applyGalleryQuery(categoryPages, query, searchable);
  const cardPage = requestedCardPage(search.cardPage, pages.length);
  const visiblePages = pages.slice(0, cardPage * CARDS_PER_PAGE);
  const groups = query.groupBy ? groupPages(pages, query.groupBy) : null;
  const visiblePageIds = new Set(visiblePages.map((page) => page.id));
  const visibleGroups = groups
    ?.map((group) => ({
      ...group,
      total: group.pages.length,
      pages: group.pages.filter((page) => visiblePageIds.has(page.id)),
    }))
    .filter((group) => group.pages.length > 0);

  const galleryConfig = parseGalleryConfig(gallery.displayConfig);
  const cardKindOrientation =
    galleryConfig.coverAspect === "portrait" ||
    galleryConfig.coverAspect === "square" ||
    galleryConfig.coverAspect === "circle"
      ? galleryConfig.coverAspect
      : "landscape";
  const cardLayout = resolveCardLayout(
    parseCardLayout(galleryConfig.card),
    gallery.propertyConfigs,
    galleryConfig.coverAspect,
  );
  const cardsPerRow = resolveCardsPerRow(galleryConfig);
  const coverRatio = resolveCoverRatio(galleryConfig);

  const cardKind = cardKindOf(cardLayout.arrangement, cardKindOrientation, cardLayout.extended);

  // This server-produced manifest covers the common page/property sources without another
  // API request per card. Content-image sources remain lazy because finding their first
  // block is intentionally deferred until that card is near the viewport.
  const cachedCoverPreviews = await db.pageImageCache.findMany({
    where: { notionPageId: { in: visiblePages.map((page) => page.id) } },
  });
  const cachedCoversByPageId = new Map(cachedCoverPreviews.map((cached) => [cached.notionPageId, cached]));
  const coverSources = new Map(
    galleryConfig.coverSource === CONTENT_IMAGE
      ? visiblePages.flatMap((page) => {
          const cached = cachedCoversByPageId.get(page.id);
          const sourceUrl = cached?.storedFile
            ? storedCoverUrl(page.id)
            : (cached?.imageUrl ?? null);
          return sourceUrl ? [[page.id, sourceUrl] as const] : [];
        })
      : visiblePages.map((page) => [page.id, resolveCoverUrl(page, galleryConfig.coverSource)]),
  );
  const coverVariants = new Map(
    cachedCoverPreviews.flatMap((cached) => {
      const sourceUrl = coverSources.get(cached.notionPageId);
      const sourceKey = cached.storedFile
        ? `stored:${cached.storedFile}`
        : sourceUrl
          ? coverSourceFingerprint(sourceUrl)
          : null;
      return cached.thumbnailFile && cached.cardFile && cached.detailFile && sourceKey && cached.thumbnailSource === sourceKey
        ? [[
            cached.notionPageId,
            {
              previewUrl: storedCoverThumbnailUrl(
                cached.notionPageId,
                cached.checkedAt.getTime(),
                cached.thumbnailFile,
              ),
              imageUrl: storedCoverCardUrl(cached.notionPageId, cached.checkedAt.getTime(), cached.cardFile),
            },
          ] as const]
        : [];
    }),
  );

  const positions = new Map(
    (
      await db.coverPosition.findMany({
        where: { galleryId, notionPageId: { in: visiblePages.map((page) => page.id) } },
      })
    ).map((p) => [p.notionPageId, p]),
  );

  // The quick-entry form: whatever the form layout names, in the order it arranged them,
  // each starting on its configured default.
  const formLayout = parseCardLayout(galleryConfig.formCard);
  const formDefaults = parseFormDefaults(galleryConfig.formDefaults);
  const lastValues = parseFormLastValues(galleryConfig.formLastValues);
  const managedById = new Map(managed.map((config) => [config.notionPropertyId, config]));

  const formFields: CreateFormField[] = (
    formLayout ? Object.values(formLayout.regions).flatMap((grid) => grid.boxes.flatMap((box) => box.fields)) : []
  ).flatMap((field) => {
    const isTitle = field.id === TITLE_FIELD_ID;
    const config = managedById.get(field.id);
    if (!isTitle && !config) return [];

    const name = isTitle ? (titlePropertyName ?? "Name") : config!.notionPropertyName;
    const type = isTitle ? "title" : config!.notionPropertyType;
    if (!FORM_FIELD_TYPES.has(type)) return [];

    const schema = dataSource?.properties[name];
    const options =
      schema?.type === "select"
        ? schema.select.options.map((option) => option.name)
        : schema?.type === "status"
          ? schema.status.options.map((option) => option.name)
          : schema?.type === "multi_select"
            ? schema.multi_select.options.map((option) => option.name)
            : undefined;

    return [
      {
        propertyId: field.id,
        name,
        type,
        options,
        required: formDefaults[field.id]?.required === true,
        initialValue: resolveDefaultValue(formDefaults[field.id], type, lastValues, field.id),
      },
    ];
  });

  const formColumns = formLayout?.regions.main?.cols === 2 ? 2 : 1;

  // The form only asks for an image when its layout has somewhere to put one.
  const formCoverShape = resolveFormCoverShape(galleryConfig);
  const formCoverTarget = galleryConfig.formCoverTarget ?? PAGE_COVER;
  const formCover =
    formLayout && ARRANGEMENTS[formLayout.arrangement].cover !== "none"
      ? {
          ratio: formCoverShape.ratio.replace(":", " / "),
          round: isRoundCover(formCoverShape.aspect),
          targetLabel: formCoverTarget.startsWith(PROPERTY_PREFIX)
            ? `prop "${formCoverTarget.slice(PROPERTY_PREFIX.length)}"`
            : formCoverTarget === CONTENT_IMAGE
              ? "nội dung page"
              : "ảnh bìa của page",
        }
      : null;

  // Every card carries the current view, so the item it opens knows what to go back to.
  const returnQuery = returnQueryString(search);
  const itemSuffix = returnQuery ? `?${RETURN_PARAM}=${encodeURIComponent(returnQuery)}` : "";

  const toolbarProperties: ToolbarProperty[] = managed.map((config) => {
      const schema = dataSource?.properties[config.notionPropertyName];
      const options =
        schema?.type === "select"
          ? schema.select.options.map((option) => option.name)
          : schema?.type === "status"
            ? schema.status.options.map((option) => option.name)
            : schema?.type === "multi_select"
              ? schema.multi_select.options.map((option) => option.name)
              : undefined;
      return {
        notionPropertyId: config.notionPropertyId,
        name: config.notionPropertyName,
        configType: configTypeOf(config.notionPropertyType, config.resolvedType),
        options,
      };
    });

  // Cards are a fixed width per kind rather than stretching, so a gallery of mixed
  // layouts still lines up. "Cards per row" now sets what one normal card is wide.
  // Extracted so a grouped gallery can draw the same grid once per section.
  const renderGrid = (list: PageObjectResponse[]) => (
          <div
            className="flex flex-wrap gap-4"
            style={
              {
                "--card-base": `calc((100% - ${(cardsPerRow - 1) * CARD_GAP_REM}rem) / ${cardsPerRow})`,
              } as React.CSSProperties
            }
          >
            {list.map((page) => {
              const title = getPageTitle(page, titlePropertyName);
              const icon = getPageIcon(page);
              const showCover = cardLayout.cover !== "none" && coverRatio;
              const valueOf = (propertyId: string) =>
                Object.values(page.properties).find((property) => property.id === propertyId);
              const region = (id: string) =>
                cardLayout.regions[id] ? (
                  <CardGrid grid={cardLayout.regions[id]} title={title} valueOf={valueOf} />
                ) : null;

              const cover = showCover && (
                <div
                  className="relative shrink-0 self-start"
                  style={cardLayout.sideBySide ? { width: `${cardLayout.ratio[0]}%` } : undefined}
                >
                  {/* Changing source URLs gets a fresh lazy-image lifecycle rather than
                      briefly keeping the previous picture while an observer reconnects. */}
                  <CardCover
                    key={coverVariants.get(page.id)?.imageUrl ?? coverSources.get(page.id) ?? "no-cover"}
                    ratio={coverRatio}
                    round={isRoundCover(galleryConfig.coverAspect)}
                    galleryId={galleryId}
                    pageId={page.id}
                    initialX={positions.get(page.id)?.posX ?? 50}
                    initialY={positions.get(page.id)?.posY ?? 50}
                    sourceUrl={coverSources.get(page.id)}
                    initialPreviewUrl={coverVariants.get(page.id)?.previewUrl}
                    initialImageUrl={coverVariants.get(page.id)?.imageUrl}
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
                    href={`/galleries/${galleryId}/items/${page.id}${itemSuffix}`}
                    prefetch={false}
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
  );

  return (
    <div className="w-full px-6 py-12">
      <GallerySyncHeartbeat galleryId={galleryId} />
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
          <CreateItemPopup
            galleryId={galleryId}
            fields={formFields}
            columns={formColumns}
            cover={formCover}
          />
          <RelationGalleryMenu entries={relationGalleries} />
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

      <GalleryToolbar
        properties={toolbarProperties}
        query={query}
        matchCount={pages.length}
        totalCount={categoryPages.length}
        pickTargets={pages.map((page) => page.id)}
        randomPickEnabled={galleryConfig.randomPick !== false}
      />

      {pages.length === 0 ? (
        <p className="rounded-md border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500">
          {activeValue
            ? "Không có item nào trong phân loại này."
            : "Database này chưa có item nào."}
        </p>
      ) : (
        visibleGroups ? (
          <div className="flex flex-col gap-8">
            {visibleGroups.map((group) => (
              <section key={group.key}>
                <h2 className="mb-3 flex items-baseline gap-2 text-sm font-semibold text-stone-700">
                  {group.label}
                  <span className="text-xs font-normal text-stone-400">
                    {group.pages.length} / {group.total}
                  </span>
                </h2>
                {renderGrid(group.pages)}
              </section>
            ))}
          </div>
        ) : (
          renderGrid(visiblePages)
        )
      )}

      {visiblePages.length < pages.length && (
        <div className="mt-8 flex justify-center">
          <Link
            href={`/galleries/${galleryId}?${withCardPage(search, cardPage + 1)}`}
            prefetch={false}
            scroll={false}
            className="rounded-md border border-stone-300 px-4 py-2 text-sm font-medium text-stone-700 hover:border-stone-500"
          >
            Xem thêm {Math.min(CARDS_PER_PAGE, pages.length - visiblePages.length)} item
          </Link>
        </div>
      )}
    </div>
  );
}
