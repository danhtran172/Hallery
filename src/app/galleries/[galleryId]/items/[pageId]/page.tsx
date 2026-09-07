import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { EDITABLE_PROPERTY_TYPES, READONLY_PROPERTY_TYPES } from "@/lib/notion-write";
import { parseDisplayConfig } from "@/lib/display-config";
import {
  createDefaultCardLayout,
  isRoundCover,
  parseCardLayout,
  resolveCardLayout,
} from "@/lib/card-layout";
import {
  parseGalleryConfig,
  resolveCoverUrl,
  resolveDetailCoverShape,
  resolveDetailWidth,
} from "@/lib/notion-cover";
import { coverFileExists, coverSourceFingerprint, storedCoverDetailUrl, storedCoverUrl } from "@/lib/cover-store";
import { RETURN_PARAM, galleryHrefFromReturn } from "@/lib/gallery-query";
import { getGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { isFullDataSource, isFullPage } from "@notionhq/client";
import { ItemDetail, type FieldData } from "./item-detail";

export default async function ItemDetailPage({
  params,
  searchParams,
}: PageProps<"/galleries/[galleryId]/items/[pageId]">) {
  const { galleryId, pageId } = await params;
  const { [RETURN_PARAM]: back } = await searchParams;
  const galleryHref = galleryHrefFromReturn(galleryId, back);
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: true },
  });
  if (!gallery) notFound();

  // The gallery's snapshot already holds this page and the schema, and it is refreshed
  // whenever Hallery writes. Reading it turns two Notion round trips per item view into a
  // local one — worth it on a ~3 req/s budget, and it is what made opening a card feel slow.
  const snapshot = await getGalleryNotionSnapshot({
    galleryId,
    dataSourceId: gallery.notionDataSourceId,
    accessToken: gallery.workspace.accessToken,
  });
  const dataSourceRes = snapshot.dataSourceRes;

  // A page created since the snapshot, or past the crawl's ceiling, is not in it — fall
  // back to fetching just that one rather than showing a missing item.
  const notion = getNotionClient(gallery.workspace.accessToken);
  const fromSnapshot = snapshot.queryRes.results.find((result) => result.id === pageId);
  const pageRes =
    fromSnapshot && isFullPage(fromSnapshot) ? fromSnapshot : await notion.pages.retrieve({ page_id: pageId });

  if (!isFullPage(pageRes) || !isFullDataSource(dataSourceRes)) notFound();

  const titlePropertyName = getTitlePropertyName(dataSourceRes.properties);
  const title = getPageTitle(pageRes, titlePropertyName);
  const icon = getPageIcon(pageRes);

  const propertyConfigsById = new Map(gallery.propertyConfigs.map((config) => [config.notionPropertyId, config]));
  const fields: FieldData[] = Object.entries(pageRes.properties)
    .filter(([name]) => name !== titlePropertyName)
    .map(([name, value]) => {
      const schema = dataSourceRes.properties[name];
      let options: string[] | undefined;
      if (schema?.type === "select") options = schema.select.options.map((o) => o.name);
      if (schema?.type === "status") options = schema.status.options.map((o) => o.name);
      if (schema?.type === "multi_select") options = schema.multi_select.options.map((o) => o.name);
      const propertyConfig = propertyConfigsById.get(value.id);
      return {
        propertyId: value.id,
        name,
        type: value.type,
        value,
        editable: EDITABLE_PROPERTY_TYPES.has(value.type),
        readonly: READONLY_PROPERTY_TYPES.has(value.type),
        options,
        // The detail formats its properties on its own settings, falling back to the
        // gallery card's while it has none of its own.
        displayConfig: propertyConfig
          ? parseDisplayConfig(propertyConfig.detailDisplayConfig || propertyConfig.displayConfig)
          : {},
      };
    })
    .sort((a, b) => {
      const aOrder = propertyConfigsById.get(a.propertyId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      const bOrder = propertyConfigsById.get(b.propertyId)?.sortOrder ?? Number.MAX_SAFE_INTEGER;
      return aOrder - bOrder || a.name.localeCompare(b.name, "vi");
    });

  // An untouched detail borrows the gallery card's arrangement whole — that is what
  // "giống gallery card cho tới khi custom" means in storage.
  const galleryConfig = parseGalleryConfig(gallery.displayConfig);
  const galleryCard = parseCardLayout(galleryConfig.card) ?? createDefaultCardLayout(gallery.propertyConfigs);
  const detailCard = parseCardLayout(galleryConfig.detailCard) ?? galleryCard;
  const coverShape = resolveDetailCoverShape(galleryConfig);
  const layout = resolveCardLayout(
    detailCard,
    gallery.propertyConfigs.map((p) => ({
      notionPropertyId: p.notionPropertyId,
      notionPropertyName: p.notionPropertyName,
      notionPropertyType: p.notionPropertyType,
      isMissing: p.isMissing,
      disabled: p.disabled,
    })),
    coverShape.aspect,
  );

  // A known local 768px derivative makes the detail as cheap as a card. Content images
  // still avoid a blocks crawl here: use only a fresh or locally stored source.
  const coverSource = galleryConfig.coverSource;
  const cached =
    layout.cover !== "none"
      ? await db.pageImageCache.findUnique({ where: { notionPageId: pageId } })
      : null;
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
  const coverUrl = localDetailUrl ?? coverSourceUrl;

  return (
    <div className="mx-auto px-6 py-12" style={{ maxWidth: resolveDetailWidth(galleryConfig) }}>
      <Link href={galleryHref} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <div className="mt-2 mb-6 flex items-center gap-3">
        {icon && <span className="text-3xl leading-none">{icon.length <= 4 ? icon : "📄"}</span>}
        <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
      </div>

      <ItemDetail
        galleryId={galleryId}
        pageId={pageId}
        fields={fields}
        layout={layout}
        coverUrl={coverUrl}
        coverRatio={coverShape.ratio.replace(":", " / ")}
        coverRound={isRoundCover(coverShape.aspect)}
        notionUrl={pageRes.url}
      />
    </div>
  );
}
