import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullPage } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import {
  arrangementsFor,
  cardEligibleProperties,
  createDefaultCardLayout,
  detailLayoutFrom,
  parseCardLayout,
  type CoverOrientation,
} from "@/lib/card-layout";
import { COVER_RATIOS, parseGalleryConfig, resolveCoverUrl, resolveDetailWidth } from "@/lib/notion-cover";
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
  const config = parseGalleryConfig(gallery.displayConfig);
  const stored = parseCardLayout(config.card) ?? createDefaultCardLayout(gallery.propertyConfigs);

  const aspect: CoverOrientation =
    config.coverAspect === "portrait" || config.coverAspect === "square" ? config.coverAspect : "landscape";

  // A stored arrangement this cover shape no longer offers would leave the picker showing
  // nothing selected, so pull it back to one that exists.
  const allowed = arrangementsFor(aspect);
  const layout = allowed.includes(stored.arrangement)
    ? stored
    : { ...stored, arrangement: allowed[0], regions: { main: stored.regions.main ?? stored.regions.below } };
  const ratio = config.coverRatio && COVER_RATIOS[aspect].includes(config.coverRatio)
    ? config.coverRatio
    : COVER_RATIOS[aspect][0];

  // An untouched detail opens on the card's arrangement without its cover — the same thing
  // the Card Detail is already rendering, so the editor shows the truth rather than a blank.
  const detailLayout = parseCardLayout(config.detailCard) ?? detailLayoutFrom(layout, gallery.propertyConfigs);

  const preview = await loadPreviewItem(
    gallery.notionDataSourceId,
    gallery.workspace.accessToken,
    config.coverSource,
  );

  return (
    <div className="flex h-screen w-full flex-col px-6 py-6">
      <div className="mb-4 shrink-0">
        <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
          ← {gallery.name}
        </Link>
        <h1 className="mt-1 text-xl font-semibold text-stone-900">Bố cục card</h1>
      </div>

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
            resolvedType: p.resolvedType,
            displayConfig: p.displayConfig,
            detailDisplayConfig: p.detailDisplayConfig,
          }))}
          initialShape={{ aspect, ratio }}
          initialLayout={layout}
          initialDetailLayout={detailLayout}
          initialDetailWidth={resolveDetailWidth(config)}
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

    const titleProperty = "properties" in dataSource ? getTitlePropertyName(dataSource.properties) : null;
    const values: Record<string, string> = {};
    for (const value of Object.values(page.properties)) values[value.id] = plainTextValue(value);

    return {
      title: getPageTitle(page, titleProperty),
      values,
      // Content-image covers resolve lazily elsewhere; the preview settles for the frame
      // rather than spending a blocks crawl here.
      coverUrl: resolveCoverUrl(page, coverSource),
    };
  } catch {
    return EMPTY_PREVIEW;
  }
}
