import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullPage } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { cardEligibleProperties, parseCardLayout, resolveCardLayout } from "@/lib/card-layout";
import { parseGalleryConfig, resolveCoverRatio, resolveCoverUrl } from "@/lib/notion-cover";
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
  const galleryConfig = parseGalleryConfig(gallery.displayConfig);
  const resolved = resolveCardLayout(
    parseCardLayout(galleryConfig.card),
    gallery.propertyConfigs,
    galleryConfig.coverAspect,
  );
  const toFields = (list: typeof resolved.fields) =>
    list.map((field) => ({ id: field.property.notionPropertyId, showLabel: field.showLabel }));

  // One real item, so the preview shows the actual data rather than filler.
  const preview = await loadPreviewItem(
    gallery.notionDataSourceId,
    gallery.workspace.accessToken,
    galleryConfig.coverSource,
  );

  return (
    <div className="mx-auto max-w-4xl px-6 py-12">
      <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold text-stone-900">Bố cục card</h1>
      <p className="mb-8 text-sm text-stone-600">
        Chọn kiểu sắp xếp ảnh và chữ, độ rộng card, rồi kéo property vào chỗ muốn hiện. Kiểu bố cục có sẵn tuỳ theo
        khung ảnh bìa đang dùng.
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
          coverAspect={galleryConfig.coverAspect}
          coverRatio={resolveCoverRatio(galleryConfig)}
          initial={{
            preset: resolved.preset,
            span: resolved.span,
            fields: toFields(resolved.fields),
            overlayFields: toFields(resolved.overlayFields),
          }}
          previewTitle={preview.title}
          previewValues={preview.values}
          previewCoverUrl={preview.coverUrl}
        />
      )}
    </div>
  );
}

type PreviewItem = { title: string; values: Record<string, string>; coverUrl: string | null };

const EMPTY_PREVIEW: PreviewItem = { title: "Item mẫu", values: {}, coverUrl: null };

async function loadPreviewItem(
  dataSourceId: string,
  accessToken: string,
  coverSource: string | undefined,
): Promise<PreviewItem> {
  try {
    const notion = getNotionClient(accessToken);
    const [dataSource, query] = await Promise.all([
      notion.dataSources.retrieve({ data_source_id: dataSourceId }),
      notion.dataSources.query({ data_source_id: dataSourceId, page_size: 1 }),
    ]);

    const page = query.results.filter(isFullPage)[0];
    if (!page) return EMPTY_PREVIEW;

    const titleProperty =
      "properties" in dataSource ? getTitlePropertyName(dataSource.properties) : null;

    const values: Record<string, string> = {};
    for (const value of Object.values(page.properties)) {
      values[value.id] = plainTextValue(value);
    }

    return {
      title: getPageTitle(page, titleProperty),
      values,
      // Content-image covers are resolved lazily elsewhere; the preview settles for the
      // frame rather than spending a blocks crawl here.
      coverUrl: resolveCoverUrl(page, coverSource),
    };
  } catch {
    return EMPTY_PREVIEW;
  }
}
