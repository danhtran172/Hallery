import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullDataSource, isFullPage } from "@notionhq/client";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { getNotionClient } from "@/lib/notion";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { EDITABLE_PROPERTY_TYPES, READONLY_PROPERTY_TYPES } from "@/lib/notion-write";
import { parseDisplayConfig } from "@/lib/display-config";
import { createDefaultCardLayout, isRoundCover, parseCardLayout, resolveCardLayout } from "@/lib/card-layout";
import { parseGalleryConfig, resolveCoverUrl, resolveDetailCoverShape, resolveDetailWidth } from "@/lib/notion-cover";
import { coverFileExists, coverSourceFingerprint, storedCoverDetailUrl, storedCoverUrl } from "@/lib/cover-store";
import { ItemDetail, type FieldData } from "./item-detail";

/** The record body shared by its full page and its gallery popup. */
export async function ItemDetailView({
  galleryId,
  pageId,
  galleryHref,
}: {
  galleryId: string;
  pageId: string;
  /** Omitted inside the popup, where closing returns to the already-visible gallery. */
  galleryHref?: string;
}) {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: true },
  });
  if (!gallery) notFound();

  const snapshot = await getGalleryNotionSnapshot({
    galleryId,
    dataSourceId: gallery.notionDataSourceId,
    accessToken: gallery.workspace.accessToken,
  });
  const dataSourceRes = snapshot.dataSourceRes;
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
      if (schema?.type === "select") options = schema.select.options.map((option) => option.name);
      if (schema?.type === "status") options = schema.status.options.map((option) => option.name);
      if (schema?.type === "multi_select") options = schema.multi_select.options.map((option) => option.name);
      const propertyConfig = propertyConfigsById.get(value.id);
      return {
        propertyId: value.id,
        name,
        type: value.type,
        value,
        editable: EDITABLE_PROPERTY_TYPES.has(value.type),
        readonly: READONLY_PROPERTY_TYPES.has(value.type),
        options,
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

  const galleryConfig = parseGalleryConfig(gallery.displayConfig);
  const galleryCard = parseCardLayout(galleryConfig.card) ?? createDefaultCardLayout(gallery.propertyConfigs);
  const detailCard = parseCardLayout(galleryConfig.detailCard) ?? galleryCard;
  const coverShape = resolveDetailCoverShape(galleryConfig);
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

  return (
    <div className={galleryHref ? "mx-auto px-6 py-12" : "w-full px-1 py-1"} style={{ maxWidth: resolveDetailWidth(galleryConfig) }}>
      {galleryHref && (
        <Link href={galleryHref} className="text-xs text-stone-500 hover:underline">
          ← {gallery.name}
        </Link>
      )}
      <div className={galleryHref ? "mt-2 mb-6 flex items-center gap-3" : "mb-6 flex items-center gap-3"}>
        {icon && <span className="text-3xl leading-none">{icon.length <= 4 ? icon : "📄"}</span>}
        <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
      </div>
      <ItemDetail
        galleryId={galleryId}
        pageId={pageId}
        fields={fields}
        layout={layout}
        coverUrl={localDetailUrl ?? coverSourceUrl}
        coverRatio={coverShape.ratio.replace(":", " / ")}
        coverRound={isRoundCover(coverShape.aspect)}
        notionUrl={pageRes.url}
      />
    </div>
  );
}
