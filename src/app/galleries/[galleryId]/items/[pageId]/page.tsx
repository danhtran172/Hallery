import { notFound } from "next/navigation";
import Link from "next/link";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { EDITABLE_PROPERTY_TYPES, READONLY_PROPERTY_TYPES } from "@/lib/notion-write";
import { parseDisplayConfig } from "@/lib/display-config";
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

  const fields: FieldData[] = Object.entries(pageRes.properties)
    .filter(([name]) => name !== titlePropertyName)
    .map(([name, value]) => {
      const schema = dataSourceRes.properties[name];
      let options: string[] | undefined;
      if (schema?.type === "select") options = schema.select.options.map((o) => o.name);
      if (schema?.type === "status") options = schema.status.options.map((o) => o.name);
      if (schema?.type === "multi_select") options = schema.multi_select.options.map((o) => o.name);
      const propertyConfig = gallery.propertyConfigs.find((p) => p.notionPropertyName === name);
      return {
        name,
        type: value.type,
        value,
        editable: EDITABLE_PROPERTY_TYPES.has(value.type),
        readonly: READONLY_PROPERTY_TYPES.has(value.type),
        options,
        displayConfig: propertyConfig ? parseDisplayConfig(propertyConfig.displayConfig) : {},
      };
    });

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <div className="mt-2 mb-6 flex items-center gap-3">
        {icon && <span className="text-3xl leading-none">{icon.length <= 4 ? icon : "📄"}</span>}
        <h1 className="text-2xl font-semibold text-stone-900">{title}</h1>
      </div>

      <ItemDetail galleryId={galleryId} pageId={pageId} fields={fields} notionUrl={pageRes.url} />
    </div>
  );
}
