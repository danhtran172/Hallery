import type { Metadata } from "next";
import { SettingsHeader } from "@/components/settings-header";
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
import { ensureGalleryViews, parseViewLayoutConfig } from "@/lib/gallery-view";
import { isNotionAccessError } from "@/lib/notion-errors";
import { CardLayoutEditor, type PreviewRecord } from "./card-layout-editor";

export const metadata: Metadata = { title: "Bố cục card" };

export default async function CardLayoutSettingsPage({
  params,
  searchParams,
}: PageProps<"/galleries/[galleryId]/settings/card">) {
  const { galleryId } = await params;
  const { view: viewParam, back, mode } = await searchParams;
  const initialMode = mode === "detail" || mode === "form" ? mode : "gallery";
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: { orderBy: { sortOrder: "asc" } }, views: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();
  const views = await ensureGalleryViews(gallery);
  const requestedViewId = typeof viewParam === "string" ? viewParam : null;
  const view = views.find((entry) => entry.id === requestedViewId) ?? views[0];

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
  const detailLayout = parseCardLayout(config.detailCard) ?? layout;
  const detailShape = resolveDetailCoverShape(config);
  const formShape = resolveFormCoverShape(config);

  // A form starts empty rather than borrowing the card: what reads well on a thumbnail is
  // rarely what you want to be asked for when adding an item.
  const formLayout = parseCardLayout(config.formCard) ?? {
    ...createDefaultCardLayout([]),
    arrangement: "no-cover" as const,
  };

  // The editor works without live data — it only loses its preview — so a Notion outage
  // must not lock someone out of arranging their cards.
  const snapshot = await getGalleryNotionSnapshot({
    galleryId,
    dataSourceId: gallery.notionDataSourceId,
    accessToken: gallery.workspace.accessToken,
  }).catch((error: unknown) => {
    if (isNotionAccessError(error)) return null;
    throw error;
  });
  const preview = snapshot ? loadPreviewItems(snapshot) : EMPTY_PREVIEW;

  return (
    <div className="flex w-full flex-1 flex-col px-5 py-6 sm:px-8">
      <SettingsHeader
        galleryId={galleryId}
        galleryName={gallery.name}
        viewId={view.id}
        back={typeof back === "string" ? back : undefined}
        active="card"
        compact
      />

      {properties.length === 0 ? (
        <p className="empty-state">Database này chưa có property nào ngoài tiêu đề để đưa lên card.</p>
      ) : (
        <CardLayoutEditor
          galleryId={galleryId}
          viewId={view.id}
          initialMode={initialMode}
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
