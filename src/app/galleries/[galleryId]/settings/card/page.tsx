import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullDataSource, isFullPage } from "@notionhq/client";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot, type GalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import {
  arrangementsFor,
  cardEligibleProperties,
  createDefaultCardLayout,
  parseCardLayout,
  type CoverOrientation,
} from "@/lib/card-layout";
import {
  COVER_RATIOS,
  PAGE_COVER,
  listImagePropertyNames,
  parseGalleryConfig,
  resolveCoverUrl,
  resolveDetailCoverShape,
  resolveDetailWidth,
  resolveFormCoverShape,
  listUploadTargetNames,
} from "@/lib/notion-cover";
import { plainTextValue } from "@/lib/property-text";
import { parseFormDefaults } from "@/lib/create-form";
import { parseViewLayoutConfig } from "@/lib/gallery-view";
import { CardLayoutEditor, type PreviewRecord } from "./card-layout-editor";

export default async function CardLayoutSettingsPage({
  params,
  searchParams,
}: PageProps<"/galleries/[galleryId]/settings/card">) {
  const { galleryId } = await params;
  const { view: viewParam } = await searchParams;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: { orderBy: { sortOrder: "asc" } }, views: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();
  const requestedViewId = typeof viewParam === "string" ? viewParam : null;
  const view = gallery.views.find((entry) => entry.id === requestedViewId) ?? gallery.views[0];
  if (!view) notFound();

  const properties = cardEligibleProperties(gallery.propertyConfigs);
  const config = parseGalleryConfig(gallery.displayConfig);
  const viewConfig = parseViewLayoutConfig(view.layoutConfig, config);
  const stored = parseCardLayout(viewConfig.card) ?? createDefaultCardLayout(gallery.propertyConfigs);

  const aspect: CoverOrientation =
    viewConfig.coverAspect === "portrait" || viewConfig.coverAspect === "square" || viewConfig.coverAspect === "circle"
      ? viewConfig.coverAspect
      : "landscape";

  // A stored arrangement this cover shape no longer offers would leave the picker showing
  // nothing selected, so pull it back to one that exists.
  const allowed = arrangementsFor(aspect);
  const layout = allowed.includes(stored.arrangement)
    ? stored
    : { ...stored, arrangement: allowed[0], regions: { main: stored.regions.main ?? stored.regions.below } };
  const ratio = viewConfig.coverRatio && COVER_RATIOS[aspect].includes(viewConfig.coverRatio)
    ? viewConfig.coverRatio
    : COVER_RATIOS[aspect][0];

  // An untouched detail opens on the card's own arrangement — the same thing the Card
  // Detail is already rendering, so the editor shows the truth rather than a blank.
  const detailLayout = parseCardLayout(config.detailCard) ?? parseCardLayout(config.card) ?? layout;
  const detailShape = resolveDetailCoverShape(config);
  const formShape = resolveFormCoverShape(config);

  // A form starts empty rather than borrowing the card: what reads well on a thumbnail is
  // rarely what you want to be asked for when adding an item.
  const formLayout = parseCardLayout(config.formCard) ?? {
    ...createDefaultCardLayout([]),
    arrangement: "no-cover" as const,
  };

  const snapshot = await getGalleryNotionSnapshot({
    galleryId,
    dataSourceId: gallery.notionDataSourceId,
    accessToken: gallery.workspace.accessToken,
  });
  const preview = loadPreviewItems(snapshot);

  return (
    <div className="flex h-screen w-full flex-col px-6 py-6">
      <div className="mb-4 shrink-0">
        <Link href={`/galleries/${galleryId}?view=${view.id}`} className="text-xs text-stone-500 hover:underline">
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
          viewId={view.id}
          properties={properties.map((p) => ({
            notionPropertyId: p.notionPropertyId,
            notionPropertyName: p.notionPropertyName,
            notionPropertyType: p.notionPropertyType,
            resolvedType: p.resolvedType,
            displayConfig: p.displayConfig,
            detailDisplayConfig: p.detailDisplayConfig,
          }))}
          initialShape={{ aspect, ratio }}
          initialDetailShape={{
            aspect: detailShape.aspect === "none" ? "landscape" : detailShape.aspect,
            ratio: detailShape.ratio,
          }}
          initialLayout={layout}
          initialDetailLayout={detailLayout}
          initialFormLayout={formLayout}
          initialFormShape={{
            aspect: formShape.aspect === "none" ? "landscape" : formShape.aspect,
            ratio: formShape.ratio,
          }}
          initialFormCoverTarget={config.formCoverTarget ?? PAGE_COVER}
          uploadProperties={preview.uploadProperties}
          initialFormDefaults={parseFormDefaults(config.formDefaults)}
          initialDetailWidth={resolveDetailWidth(config)}
          initialCoverSource={viewConfig.coverSource ?? PAGE_COVER}
          imageProperties={preview.imageProperties}
          previewItems={preview.items}
        />
      )}
    </div>
  );
}

type PreviewData = {
  items: PreviewRecord[];
  /** Files/URL properties that could serve as a cover — the source picker's options. */
  imageProperties: string[];
  /** Files properties, the only ones an upload can be written into. */
  uploadProperties: string[];
};
const EMPTY_PREVIEW: PreviewData = {
  items: [],
  imageProperties: [],
  uploadProperties: [],
};

function loadPreviewItems(snapshot: GalleryNotionSnapshot): PreviewData {
  try {
    const { dataSourceRes: dataSource, queryRes: query } = snapshot;
    const titleProperty = "properties" in dataSource ? getTitlePropertyName(dataSource.properties) : null;
    const imageProperties = isFullDataSource(dataSource) ? listImagePropertyNames(dataSource) : [];
    const coverSources = [PAGE_COVER, ...imageProperties.map((name) => `property:${name}`)];
    const items = query.results
      .filter(isFullPage)
      .sort(() => Math.random() - 0.5)
      .slice(0, 50)
      .map((page) => {
        const values: Record<string, string> = {};
        for (const value of Object.values(page.properties)) values[value.id] = plainTextValue(value);
        return {
          pageId: page.id,
          title: getPageTitle(page, titleProperty),
          values,
          coverUrls: Object.fromEntries(coverSources.map((source) => [source, resolveCoverUrl(page, source)])),
        };
      });

    return {
      items,
      imageProperties,
      uploadProperties: isFullDataSource(dataSource) ? listUploadTargetNames(dataSource) : [],
    };
  } catch {
    return EMPTY_PREVIEW;
  }
}
