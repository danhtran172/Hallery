import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { EDITABLE_PROPERTY_TYPES, READONLY_PROPERTY_TYPES } from "@/lib/notion-write";
import { parseDisplayConfig } from "@/lib/display-config";
import {
  createDefaultCardLayout,
  detailLayoutFrom,
  parseCardLayout,
  resolveCardLayout,
} from "@/lib/card-layout";
import { parseGalleryConfig, resolveDetailWidth } from "@/lib/notion-cover";
import { isFullDataSource, isFullPage } from "@notionhq/client";
import { ItemDetail, type FieldData } from "./item-detail";

export default async function ItemDetailPage({
  params,
}: PageProps<"/galleries/[galleryId]/items/[pageId]">) {
  const { galleryId, pageId } = await params;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: true },
  });
  if (!gallery) notFound();

  const notion = getNotionClient(gallery.workspace.accessToken);

  const [pageRes, dataSourceRes] = await Promise.all([
    notion.pages.retrieve({ page_id: pageId }),
    notion.dataSources.retrieve({ data_source_id: gallery.notionDataSourceId }),
  ]);
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

  // An untouched detail borrows the gallery card's arrangement, minus its cover — that is
  // what "giống gallery card cho tới khi custom" means in storage.
  const galleryConfig = parseGalleryConfig(gallery.displayConfig);
  const galleryCard = parseCardLayout(galleryConfig.card) ?? createDefaultCardLayout(gallery.propertyConfigs);
  const detailCard =
    parseCardLayout(galleryConfig.detailCard) ?? detailLayoutFrom(galleryCard, gallery.propertyConfigs);
  const layout = resolveCardLayout(
    detailCard,
    gallery.propertyConfigs.map((p) => ({
      notionPropertyId: p.notionPropertyId,
      notionPropertyName: p.notionPropertyName,
      notionPropertyType: p.notionPropertyType,
      isMissing: p.isMissing,
    })),
    "none",
  );

  return (
    <div className="mx-auto px-6 py-12" style={{ maxWidth: resolveDetailWidth(galleryConfig) }}>
      <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <div className="mt-2 mb-6 flex items-center gap-3">
        {icon && <span className="text-3xl leading-none">{icon.length <= 4 ? icon : "📄"}</span>}
        <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
      </div>

      <ItemDetail galleryId={galleryId} pageId={pageId} fields={fields} layout={layout} notionUrl={pageRes.url} />
    </div>
  );
}
