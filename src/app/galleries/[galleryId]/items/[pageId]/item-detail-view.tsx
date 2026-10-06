import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullDataSource, isFullPage } from "@notionhq/client";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot, snapshotPage, type GalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { classifyNotionError, isNotionAccessError } from "@/lib/notion-errors";
import { NotionProblemState } from "@/components/notion-problem";
import { TrashedGalleryState } from "@/components/trashed-gallery";
import { Icon } from "@/components/icons";
import { parseViewLayoutConfig } from "@/lib/gallery-view";
import { getNotionClient } from "@/lib/notion";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { buildItemFields } from "@/lib/item-fields";
import { imageSlotFor } from "@/lib/cover-write";
import { createDefaultCardLayout, isRoundCover, parseCardLayout, resolveCardLayout } from "@/lib/card-layout";
import { parseGalleryConfig, resolveCoverUrl, resolveDetailCoverShape, resolveDetailWidth } from "@/lib/notion-cover";
import { coverFileExists, coverSourceFingerprint, storedCoverDetailUrl, storedCoverUrl } from "@/lib/cover-store";
import { buildButtonConfigs, buildRelationLinks } from "@/lib/render-context";
import type { RenderContext } from "@/lib/property-render";
import { ItemDetail } from "./item-detail";

/** The record body shared by its full page and its gallery popup. */
export async function ItemDetailView({
  galleryId,
  pageId,
  galleryHref,
  viewId,
}: {
  galleryId: string;
  pageId: string;
  /** Omitted inside the popup, where closing returns to the already-visible gallery. */
  galleryHref?: string;
  /** The Gallery view the item was opened from — its cover source and card apply here too. */
  viewId?: string | null;
}) {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: true, views: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();
  if (gallery.deletedAt) return <TrashedGalleryState galleryId={galleryId} name={gallery.name} />;

  const problemContext = {
    workspaceId: gallery.workspaceId,
    notionDatabaseId: gallery.notionDatabaseId,
    retryHref: `/galleries/${galleryId}/items/${pageId}`,
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
  const dataSourceRes = snapshot.dataSourceRes;
  // Nearly always in the snapshot. A page added in Notion moments ago may not be yet, and
  // costs one request. Only "not found" is a 404 — a revoked token or a rate limit used to
  // read as "this item was deleted".
  let pageRes = snapshotPage(snapshot, pageId) ?? null;
  if (!pageRes) {
    try {
      const fetched = await getNotionClient(gallery.workspace.accessToken).pages.retrieve({ page_id: pageId });
      pageRes = isFullPage(fetched) ? fetched : null;
    } catch (error) {
      const problem = classifyNotionError(error);
      if (problem !== "not_shared") {
        return <NotionProblemState problem={problem} title={gallery.name} context={problemContext} />;
      }
    }
  }
  if (!pageRes || !isFullDataSource(dataSourceRes)) notFound();
  // Archived in Notion since the last full sync: say so rather than offer edits Notion refuses.
  if (pageRes.archived || pageRes.in_trash) {
    return (
      <div className="mx-auto flex max-w-md flex-col items-center gap-3 py-16 text-center">
        <span className="flex size-12 items-center justify-center rounded-2xl bg-subtle text-muted">
          <Icon name="trash" className="size-5" />
        </span>
        <h1 className="display text-xl text-ink">Item này đã bị xoá trong Notion</h1>
        <p className="text-sm text-muted">Nó sẽ biến khỏi gallery ở lần đồng bộ tới. Khôi phục trong thùng rác của Notion nếu cần.</p>
      </div>
    );
  }

  const titlePropertyName = getTitlePropertyName(dataSourceRes.properties);
  const title = getPageTitle(pageRes, titlePropertyName);
  const icon = getPageIcon(pageRes);
  const { titleField, fields } = buildItemFields(pageRes, dataSourceRes, gallery.propertyConfigs);

  // The view the reader came from owns the card and its cover source; the detail follows
  // it, so a view that shows another picture opens on that picture too.
  const view = gallery.views.find((entry) => entry.id === viewId) ?? gallery.views[0];
  const galleryConfig = view
    ? parseViewLayoutConfig(view.layoutConfig, parseGalleryConfig(gallery.displayConfig))
    : parseGalleryConfig(gallery.displayConfig);
  const galleryCard = parseCardLayout(galleryConfig.card) ?? createDefaultCardLayout(gallery.propertyConfigs);
  const detailCard = parseCardLayout(galleryConfig.detailCard) ?? galleryCard;
  // The detail's own shape and width are gallery-wide settings, as the card editor shows them.
  const coverShape = resolveDetailCoverShape(parseGalleryConfig(gallery.displayConfig));
  const layout = resolveCardLayout(
    detailCard,
    gallery.propertyConfigs.map((property) => ({
      notionPropertyId: property.notionPropertyId,
      notionPropertyName: property.notionPropertyName,
      notionPropertyType: property.notionPropertyType,
      isMissing: property.isMissing,
      disabled: property.disabled,
    })),
    coverShape.aspect,
  );

  const coverSource = galleryConfig.coverSource;
  const cached = layout.cover !== "none" ? await db.pageImageCache.findUnique({ where: { notionPageId: pageId } }) : null;
  const directCoverUrl = resolveCoverUrl(pageRes, coverSource);
  const cachedContentUrl = cached?.storedFile
    ? storedCoverUrl(pageId)
    : cached && cached.expiresAt > new Date()
      ? cached.imageUrl
      : null;
  const coverSourceUrl = directCoverUrl ?? cachedContentUrl;
  const sourceKey = cached?.storedFile && coverSourceUrl === storedCoverUrl(pageId)
    ? `stored:${cached.storedFile}`
    : coverSourceUrl
      ? coverSourceFingerprint(coverSourceUrl)
      : null;
  const localDetailUrl =
    cached?.detailFile && sourceKey && cached.thumbnailSource === sourceKey && (await coverFileExists(cached.detailFile))
      ? storedCoverDetailUrl(pageId, cached.checkedAt.getTime(), cached.detailFile)
      : null;

  const renderContext: RenderContext = {
    galleryId,
    pageId: pageRes.id,
    surface: "detail",
    relations: await buildRelationLinks({
      workspaceId: gallery.workspaceId,
      dataSource: dataSourceRes,
      pages: [pageRes],
      crawl: true,
    }),
    buttons: buildButtonConfigs(gallery.propertyConfigs),
  };

  return (
    <div
      className={galleryHref ? "mx-auto w-full px-5 py-8 sm:px-8 sm:py-12" : "w-full"}
      style={{ maxWidth: resolveDetailWidth(parseGalleryConfig(gallery.displayConfig)) }}
    >
      {galleryHref && (
        <Link
          href={galleryHref}
          className="inline-flex items-center gap-1 rounded-full py-1 pr-2 text-[13px] text-muted transition-colors hover:text-ink"
        >
          <Icon name="arrow-left" className="size-4" />
          {gallery.name}
        </Link>
      )}
      <div className={`${galleryHref ? "mt-3" : ""} mb-6 flex items-center gap-3`}>
        <PageIcon icon={icon} />
        <h1 className="display min-w-0 text-3xl break-words text-ink">{title}</h1>
      </div>
      <ItemDetail
        galleryId={galleryId}
        pageId={pageRes.id}
        titleField={titleField}
        fields={fields}
        layout={layout}
        coverUrl={localDetailUrl ?? coverSourceUrl}
        coverRatio={coverShape.ratio.replace(":", " / ")}
        coverRound={isRoundCover(coverShape.aspect)}
        notionUrl={pageRes.url}
        renderContext={renderContext}
        image={imageSlotFor(coverSource, dataSourceRes)}
      />
    </div>
  );
}

/** A page's Notion icon: an emoji as text, an uploaded or external image as a picture. */
function PageIcon({ icon }: { icon: string | null }) {
  if (!icon) return null;
  if (!/^https?:\/\//.test(icon)) return <span className="text-3xl leading-none">{icon}</span>;
  return (
    <span
      aria-hidden
      className="size-8 shrink-0 rounded bg-contain bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${JSON.stringify(icon)})` }}
    />
  );
}
