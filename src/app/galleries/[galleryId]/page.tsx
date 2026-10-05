import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullDataSource, type PageObjectResponse } from "@notionhq/client";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot, type GalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { isNotionAccessError } from "@/lib/notion-errors";
import { NotionProblemBanner, NotionProblemState } from "@/components/notion-problem";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
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
import { syncPropertyConfigs, syncResolvedTypes } from "@/lib/property-config-sync";
import { CategoryBar } from "@/components/category-bar";
import { bucketPages, filterPagesByCategory } from "@/lib/category";
import { ARRANGEMENTS, TITLE_FIELD_ID, cardKindOf, isRoundCover, parseCardLayout, resolveCardLayout } from "@/lib/card-layout";
import { CreateItemPopup, type CreateFormField } from "@/components/create-item-popup";
import { FORM_FIELD_TYPES, parseFormDefaults, parseFormLastValues, resolveDefaultValue } from "@/lib/create-form";
import { GalleryToolbar, type ToolbarProperty } from "@/components/gallery-toolbar";
import { GalleryViewBar } from "@/components/gallery-view-bar";
import {
  RETURN_PARAM,
  applyGalleryQuery,
  groupPages,
  isQueryActive,
  parseGalleryQuery,
  returnQueryString,
} from "@/lib/gallery-query";
import { ensureGalleryViews, parseViewLayoutConfig, parseViewQuery } from "@/lib/gallery-view";
import { configTypeOf } from "@/lib/property-kind";
import { parseDisplayConfig } from "@/lib/display-config";
import { RelationGalleryMenu } from "@/components/relation-gallery-menu";
import { listRelationGalleries } from "@/lib/relation-galleries";
import { GallerySyncHeartbeat } from "@/components/gallery-sync-heartbeat";
import { DeferredCards } from "@/components/deferred-cards";
import { LoadMore } from "@/components/load-more";
import { GalleryCard, type CardCoverModel } from "@/components/gallery-card";
import { buildButtonConfigs, buildRelationLinks } from "@/lib/render-context";
import { itemHref, type RenderContext } from "@/lib/property-render";
import { shortHash } from "@/lib/short-hash";
import { notionPageUrl } from "@/lib/notion-url";
import { GalleryHeader, type SettingsLink } from "@/components/gallery-header";
import { TrashedGalleryState } from "@/components/trashed-gallery";
import { settingsHref } from "@/components/settings-header";
import { Icon } from "@/components/icons";
import { requestTime } from "@/lib/relative-time";
import {
  coverSourceFingerprint,
  storedCoverCardUrl,
  storedCoverThumbnailUrl,
  storedCoverUrl,
} from "@/lib/cover-store";

/** Each "Xem thêm" reveals a 50-card batch, but paints its first half before the rest. */
const CARDS_PER_PAGE = 50;
const PRIORITY_CARDS_PER_BATCH = 25;

function requestedCardPage(value: string | string[] | undefined, totalCards: number) {
  const parsed = typeof value === "string" ? Number.parseInt(value, 10) : 1;
  const page = Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
  return Math.min(page, Math.max(1, Math.ceil(totalCards / CARDS_PER_PAGE)));
}

function withCardPage(search: Record<string, string | string[] | undefined>, cardPage: number): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string" && key !== "cardPage") params.set(key, value);
  }
  params.set("cardPage", String(cardPage));
  return params.toString();
}

/** Choices for a select-like property, so filters and forms pick rather than type. */
function optionsOf(schema: { type: string; [key: string]: unknown } | undefined): string[] | undefined {
  if (schema?.type === "select" || schema?.type === "status" || schema?.type === "multi_select") {
    return (schema[schema.type] as { options: { name: string }[] }).options.map((option) => option.name);
  }
  return undefined;
}

export async function generateMetadata({ params }: PageProps<"/galleries/[galleryId]">): Promise<Metadata> {
  const { galleryId } = await params;
  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, select: { name: true } });
  return { title: gallery?.name ?? "Gallery" };
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
      views: { orderBy: { sortOrder: "asc" } },
      parentGallery: { select: { id: true, name: true, deletedAt: true } },
      notionCache: { select: { lastDeltaSyncAt: true, updatedAt: true } },
    },
  });
  if (!gallery) notFound();
  // Trashed: the address still explains itself, but nothing here keeps syncing or writing.
  if (gallery.deletedAt) return <TrashedGalleryState galleryId={galleryId} name={gallery.name} />;
  const views = await ensureGalleryViews(gallery);
  const problemContext = {
    workspaceId: gallery.workspaceId,
    notionDatabaseId: gallery.notionDatabaseId,
    retryHref: `/galleries/${galleryId}`,
  };

  let snapshot: GalleryNotionSnapshot;
  try {
    snapshot = await getGalleryNotionSnapshot({
      galleryId,
      dataSourceId: gallery.notionDataSourceId,
      accessToken: gallery.workspace.accessToken,
    });
  } catch (error) {
    if (!isNotionAccessError(error)) throw error;
    return <NotionProblemState problem={error.problem} title={gallery.name} context={problemContext} />;
  }
  const { dataSourceRes, queryRes } = snapshot;
  const dataSource = isFullDataSource(dataSourceRes) ? dataSourceRes : null;
  const titlePropertyName = dataSource ? getTitlePropertyName(dataSource.properties) : null;
  const allPages = snapshot.pages;

  // Both only write when something changed. What each formula/rollup evaluates to is only
  // visible on a page value, and pages are already here — so it is learnt now rather than
  // with a request in Settings.
  // Bookkeeping: a failure here costs a stale property list, never the page.
  await Promise.all([
    dataSource ? syncPropertyConfigs(galleryId, gallery.propertyConfigs, dataSource) : null,
    syncResolvedTypes(gallery.propertyConfigs, allPages[0]),
  ]).catch((error) => console.error("Property config sync failed", error));

  // Category axes bucket and filter the pages already in hand — no extra Notion request.
  // Relation axes name other tables rather than values inside this one, so they drive the
  // gallery-switching menu instead.
  const axes = gallery.categoryAxes.filter((axis) => axis.sourceType !== "relation");
  const firstAxisParam = typeof axisParam === "string" ? axisParam : undefined;
  const activeAxis = axes.find((axis) => axis.id === firstAxisParam) ?? axes[0];
  const activeValue = typeof valueParam === "string" && valueParam !== "" ? valueParam : null;

  const buckets = activeAxis ? bucketPages(allPages, activeAxis) : [];
  const categoryPages = activeAxis && activeValue ? filterPagesByCategory(allPages, activeAxis, activeValue) : allPages;

  // A property Hallery no longer manages is absent as far as the toolbar is concerned —
  // not shown, not filtered on, and not searched.
  const managed = gallery.propertyConfigs.filter((config) => !config.disabled && !config.isMissing);
  const searchable = new Set(managed.map((config) => config.notionPropertyId));

  const requestedViewId = typeof search.view === "string" ? search.view : null;
  const activeView = views.find((view) => view.id === requestedViewId) ?? views[0];

  // Views persist the structural query. Search intentionally stays in the URL as a one-off
  // lookup, rather than silently changing the saved tab for every reader. The toolbar
  // narrows whatever the category axis left, so the two compose rather than fight.
  const query = { ...parseViewQuery(activeView), search: parseGalleryQuery(search).search };
  const pages = applyGalleryQuery(categoryPages, query, searchable);
  const cardPage = requestedCardPage(search.cardPage, pages.length);
  const visiblePages = pages.slice(0, cardPage * CARDS_PER_PAGE);
  // Existing batches remain mounted; only the newest batch splits into a first paint of
  // 25 cards and a deferred second 25 cards.
  const eagerCardCount = Math.min(
    visiblePages.length,
    Math.max(0, cardPage - 1) * CARDS_PER_PAGE + PRIORITY_CARDS_PER_BATCH,
  );
  const eagerPageIds = new Set(visiblePages.slice(0, eagerCardCount).map((page) => page.id));
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
  const viewConfig = parseViewLayoutConfig(activeView.layoutConfig, galleryConfig);
  const cardKindOrientation =
    viewConfig.coverAspect === "portrait" || viewConfig.coverAspect === "square" || viewConfig.coverAspect === "circle"
      ? viewConfig.coverAspect
      : "landscape";
  const cardLayout = resolveCardLayout(parseCardLayout(viewConfig.card), gallery.propertyConfigs, viewConfig.coverAspect);
  const cardsPerRow = resolveCardsPerRow(viewConfig);
  const coverRatio = resolveCoverRatio(viewConfig);
  const cardKind = cardKindOf(cardLayout.arrangement, cardKindOrientation, cardLayout.extended);
  const showCover = cardLayout.cover !== "none" && Boolean(coverRatio);
  const visibleIds = visiblePages.map((page) => page.id);

  // Everything per-card the grid needs, in one round of parallel local reads. The cover
  // manifest covers page/property sources without a request per card; content-image
  // sources stay lazy, looked up only once a card nears the viewport.
  const [cachedCoverPreviews, positionRows, relationGalleries, relationLinks] = await Promise.all([
    showCover ? db.pageImageCache.findMany({ where: { notionPageId: { in: visibleIds } } }) : [],
    showCover ? db.coverPosition.findMany({ where: { galleryId, notionPageId: { in: visibleIds } } }) : [],
    dataSource ? listRelationGalleries(gallery.workspaceId, dataSource.properties) : [],
    buildRelationLinks({ workspaceId: gallery.workspaceId, dataSource, pages: visiblePages, crawl: false }),
  ]);
  const cachedCoversByPageId = new Map(cachedCoverPreviews.map((cached) => [cached.notionPageId, cached]));
  const positions = new Map(positionRows.map((position) => [position.notionPageId, position]));

  const coverModelOf = (page: PageObjectResponse): CardCoverModel | null => {
    if (!showCover || !coverRatio) return null;
    const cached = cachedCoversByPageId.get(page.id);
    // undefined: a content image nobody has looked for yet.
    const sourceUrl =
      viewConfig.coverSource === CONTENT_IMAGE
        ? cached?.storedFile
          ? storedCoverUrl(page.id)
          : (cached?.imageUrl ?? undefined)
        : resolveCoverUrl(page, viewConfig.coverSource);
    const sourceKey = cached?.storedFile ? `stored:${cached.storedFile}` : sourceUrl ? coverSourceFingerprint(sourceUrl) : null;
    const variants =
      cached?.thumbnailFile && cached.cardFile && cached.detailFile && sourceKey && cached.thumbnailSource === sourceKey
        ? {
            previewUrl: storedCoverThumbnailUrl(page.id, cached.checkedAt.getTime(), cached.thumbnailFile),
            imageUrl: storedCoverCardUrl(page.id, cached.checkedAt.getTime(), cached.cardFile),
          }
        : null;
    return {
      ratio: coverRatio,
      round: isRoundCover(viewConfig.coverAspect),
      key: variants ? `v${shortHash(variants.imageUrl)}` : sourceKey ? `s${shortHash(sourceKey)}` : "none",
      hasSource: sourceUrl === undefined && viewConfig.coverSource === CONTENT_IMAGE ? undefined : Boolean(sourceUrl),
      previewUrl: variants?.previewUrl,
      imageUrl: variants?.imageUrl,
      posX: positions.get(page.id)?.posX ?? 50,
      posY: positions.get(page.id)?.posY ?? 50,
    };
  };

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
    const label = isTitle ? name : parseDisplayConfig(config!.displayConfig).nameOverride?.trim() || name;

    return [
      {
        propertyId: field.id,
        name,
        label,
        type,
        options: optionsOf(dataSource?.properties[name]),
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

  const toolbarProperties: ToolbarProperty[] = managed.map((config) => ({
    notionPropertyId: config.notionPropertyId,
    name: parseDisplayConfig(config.displayConfig).nameOverride?.trim() || config.notionPropertyName,
    configType: configTypeOf(config.notionPropertyType, config.resolvedType),
    options: optionsOf(dataSource?.properties[config.notionPropertyName]),
  }));

  const buttons = buildButtonConfigs(gallery.propertyConfigs);
  const renderCards = (list: PageObjectResponse[]) =>
    list.map((page) => {
      const context: RenderContext = { galleryId, pageId: page.id, surface: "card", relations: relationLinks, buttons };
      return (
        <GalleryCard
          key={page.id}
          page={page}
          title={getPageTitle(page, titlePropertyName)}
          icon={getPageIcon(page)}
          href={`${itemHref(galleryId, page.id)}${itemSuffix}`}
          layout={cardLayout}
          kind={cardKind}
          cover={coverModelOf(page)}
          galleryId={galleryId}
          viewId={activeView.id}
          context={context}
        />
      );
    });

  const gridStyle = { "--cards-per-row": cardsPerRow } as React.CSSProperties;
  const renderPrioritizedGrid = (list: PageObjectResponse[]) => {
    const eager = list.filter((page) => eagerPageIds.has(page.id));
    const deferred = list.filter((page) => !eagerPageIds.has(page.id));
    return (
      <div className="gallery-grid flex flex-wrap items-start" style={gridStyle}>
        {renderCards(eager)}
        {deferred.length > 0 && <DeferredCards>{renderCards(deferred)}</DeferredCards>}
      </div>
    );
  };

  const narrowed = isQueryActive(query) || Boolean(activeValue);
  const settings: SettingsLink[] = [
    {
      href: settingsHref(galleryId, "display", activeView.id, returnQuery),
      label: "Hiển thị",
      icon: "eye",
      hint: "Định dạng từng property, số card mỗi hàng",
    },
    {
      href: settingsHref(galleryId, "card", activeView.id, returnQuery),
      label: "Bố cục card",
      icon: "layout",
      hint: "Ảnh bìa, khung card, Card Detail và form thêm",
    },
    {
      href: settingsHref(galleryId, "category", activeView.id, returnQuery),
      label: "Phân loại",
      icon: "tag",
      hint: "Thanh lọc nhanh theo select, tag, checkbox",
    },
  ];

  /** The current Gallery address minus some state — for "clear this" links in empty states. */
  const hrefWithout = (...keys: string[]) => {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (typeof value === "string" && value !== "" && key !== "cardPage" && !keys.includes(key)) params.set(key, value);
    }
    const qs = params.toString();
    return `/galleries/${galleryId}${qs ? `?${qs}` : ""}`;
  };
  const parent = gallery.parentGallery && !gallery.parentGallery.deletedAt ? gallery.parentGallery : null;
  const syncedAt = gallery.notionCache ? (gallery.notionCache.lastDeltaSyncAt ?? gallery.notionCache.updatedAt) : null;

  return (
    <div className="gallery-area w-full flex-1 px-5 py-6 sm:px-8 sm:py-8">
      {snapshot.syncProblem && <NotionProblemBanner problem={snapshot.syncProblem} context={problemContext} />}

      <GalleryHeader
        galleryId={galleryId}
        name={gallery.name}
        notionUrl={notionPageUrl(gallery.notionDatabaseId)}
        settings={settings}
        crumbs={
          <nav aria-label="Vị trí" className="flex min-w-0 items-center gap-1 text-[13px] text-muted">
            <Link href="/" className="rounded-md hover:text-ink">
              Trang chủ
            </Link>
            {parent && (
              <>
                <Icon name="chevron-right" className="size-3.5 shrink-0 text-faint" />
                <Link href={`/galleries/${parent.id}`} className="truncate rounded-md hover:text-ink">
                  {parent.name}
                </Link>
              </>
            )}
            <Icon name="chevron-right" className="size-3.5 shrink-0 text-faint" />
            <span className="truncate text-ink-soft">{gallery.workspace.name}</span>
          </nav>
        }
        meta={
          <>
            <span className="tabular-nums">
              <b className="font-semibold text-ink-soft">{pages.length.toLocaleString("vi-VN")}</b> item
              {narrowed && pages.length !== allPages.length && ` / ${allPages.length.toLocaleString("vi-VN")}`}
            </span>
            <span aria-hidden className="px-1 text-faint">
              ·
            </span>
            <GallerySyncHeartbeat
              galleryId={galleryId}
              syncedAt={syncedAt ? syncedAt.getTime() : null}
              renderedAt={requestTime()}
            />
          </>
        }
        actions={
          <>
            <RelationGalleryMenu galleryId={galleryId} entries={relationGalleries} />
            <CreateItemPopup galleryId={galleryId} fields={formFields} columns={formColumns} cover={formCover} />
          </>
        }
      />

      {/* Sticky on wider screens so search and filters stay in reach down a long grid; on a
          phone it would eat a fifth of the screen. */}
      <div className="z-20 -mx-5 mb-5 flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-y border-line bg-surface/85 px-5 py-2.5 backdrop-blur-md sm:-mx-8 sm:px-8 md:sticky md:top-0">
        <GalleryViewBar
          galleryId={galleryId}
          views={views.map((view) => ({ id: view.id, name: view.name }))}
          activeViewId={activeView.id}
        />
        <GalleryToolbar
          galleryId={galleryId}
          viewId={activeView.id}
          properties={toolbarProperties}
          query={query}
          matchCount={pages.length}
          totalCount={categoryPages.length}
          pickTargets={pages.map((page) => page.id)}
          randomPickEnabled={galleryConfig.randomPick !== false}
        />
      </div>

      {activeAxis && buckets.length > 0 && (
        <CategoryBar
          galleryId={galleryId}
          axes={axes}
          activeAxis={activeAxis}
          buckets={buckets}
          activeValue={activeValue}
          partialCounts={queryRes.has_more}
          preserved={Object.fromEntries(
            ["view", "q"].flatMap((key) => (typeof search[key] === "string" && search[key] ? [[key, search[key]]] : [])),
          )}
        />
      )}

      {pages.length === 0 ? (
        <div className="empty-state flex flex-col items-center gap-4">
          <span className="flex size-12 items-center justify-center rounded-2xl bg-surface text-faint ring-1 ring-line">
            <Icon name={allPages.length === 0 ? "image" : "search"} className="size-5" />
          </span>
          {allPages.length === 0 ? (
            <p>Database này chưa có item nào — bấm “Thêm item” ở góc trên để tạo item đầu tiên.</p>
          ) : query.search ? (
            <>
              <p>
                Không có item nào khớp “<b className="text-ink-soft">{query.search}</b>”
                {activeValue ? " trong phân loại này" : ""}.
              </p>
              <Link href={hrefWithout("q", "value")} scroll={false} className="btn btn-secondary btn-sm">
                Xoá tìm kiếm{activeValue ? " và phân loại" : ""}
              </Link>
            </>
          ) : activeValue && categoryPages.length === 0 ? (
            <>
              <p>Không có item nào trong phân loại này.</p>
              <Link href={hrefWithout("value")} scroll={false} className="btn btn-secondary btn-sm">
                Xem tất cả
              </Link>
            </>
          ) : (
            <p>Bộ lọc của view “{activeView.name}” không khớp item nào — chỉnh hoặc xoá điều kiện trong nút Lọc ở trên.</p>
          )}
        </div>
      ) : visibleGroups ? (
        <div className="flex flex-col gap-10">
          {visibleGroups.map((group) => (
            <section key={group.key}>
              <h2 className="mb-4 flex items-baseline gap-2">
                <span className="display text-lg text-ink">{group.label}</span>
                <span className="rounded-full bg-subtle px-2 py-0.5 text-xs text-muted tabular-nums">
                  {group.pages.length === group.total ? group.total : `${group.pages.length} / ${group.total}`}
                </span>
              </h2>
              {renderPrioritizedGrid(group.pages)}
            </section>
          ))}
        </div>
      ) : (
        renderPrioritizedGrid(visiblePages)
      )}

      {visiblePages.length < pages.length && (
        <LoadMore
          href={`/galleries/${galleryId}?${withCardPage(search, cardPage + 1)}`}
          remaining={Math.min(CARDS_PER_PAGE, pages.length - visiblePages.length)}
        />
      )}
    </div>
  );
}
