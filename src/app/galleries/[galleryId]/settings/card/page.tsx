import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullPage } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { cardEligibleProperties, parseCardLayout, resolveCardFields } from "@/lib/card-layout";
import { parseGalleryConfig } from "@/lib/notion-cover";
import { plainTextValue } from "@/lib/property-text";
import { CardLayoutEditor } from "./card-layout-editor";

export default async function CardLayoutSettingsPage({
  params,
}: PageProps<"/galleries/[galleryId]/settings/card">) {
  const { galleryId } = await params;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();

  const properties = cardEligibleProperties(gallery.propertyConfigs);
  const layout = parseCardLayout(parseGalleryConfig(gallery.displayConfig).card);
  const initialFields = resolveCardFields(layout, gallery.propertyConfigs).map((field) => ({
    id: field.property.notionPropertyId,
    showLabel: field.showLabel,
  }));

  // One real item, so the preview shows the actual shape of the data rather than filler.
  const { title, values } = await loadPreviewItem(gallery.notionDataSourceId, gallery.workspace.accessToken);

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold text-stone-900">Bố cục card</h1>
      <p className="mb-8 text-sm text-stone-600">
        Chọn property nào hiện trên card ngoài Gallery, theo thứ tự nào, và property nào cần hiện kèm tên field.
      </p>

      {properties.length === 0 ? (
        <p className="rounded-md border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
          Database này chưa có property nào ngoài tiêu đề để đưa lên card.
        </p>
      ) : (
        <CardLayoutEditor
          galleryId={galleryId}
          properties={properties.map((p) => ({
            notionPropertyId: p.notionPropertyId,
            notionPropertyName: p.notionPropertyName,
            notionPropertyType: p.notionPropertyType,
          }))}
          initialFields={initialFields}
          previewTitle={title}
          previewValues={values}
        />
      )}
    </div>
  );
}

async function loadPreviewItem(
  dataSourceId: string,
  accessToken: string,
): Promise<{ title: string; values: Record<string, string> }> {
  try {
    const notion = getNotionClient(accessToken);
    const [dataSource, query] = await Promise.all([
      notion.dataSources.retrieve({ data_source_id: dataSourceId }),
      notion.dataSources.query({ data_source_id: dataSourceId, page_size: 1 }),
    ]);

    const page = query.results.filter(isFullPage)[0];
    if (!page) return { title: "Item mẫu", values: {} };

    const titleProperty =
      "properties" in dataSource ? getTitlePropertyName(dataSource.properties) : null;

    const values: Record<string, string> = {};
    for (const value of Object.values(page.properties)) {
      values[value.id] = plainTextValue(value);
    }
    return { title: getPageTitle(page, titleProperty), values };
  } catch {
    return { title: "Item mẫu", values: {} };
  }
}
