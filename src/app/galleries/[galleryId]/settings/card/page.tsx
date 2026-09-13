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
  CONTENT_IMAGE,
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
import { resolveContentImage } from "@/lib/content-image-cache";
import { plainTextValue } from "@/lib/property-text";
import { parseFormDefaults } from "@/lib/create-form";
import { parseViewLayoutConfig } from "@/lib/gallery-view";
import { CardLayoutEditor } from "./card-layout-editor";

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
  const preview = await loadPreviewItem(snapshot, viewConfig.coverSource, gallery.workspace.accessToken);

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
          previewTitle={preview.title}
          previewValues={preview.values}
          previewCoverUrl={preview.coverUrl}
        />
      )}
    </div>
  );
}

type PreviewItem = {
  title: string;
  values: Record<string, string>;
  coverUrl: string | null;
  /** Files/URL properties that could serve as a cover — the source picker's options. */
  imageProperties: string[];
  /** Files properties, the only ones an upload can be written into. */
  uploadProperties: string[];
};
const EMPTY_PREVIEW: PreviewItem = {
  title: "Item mẫu",
  values: {},
  coverUrl: null,
  imageProperties: [],
  uploadProperties: [],
};

async function loadPreviewItem(
  snapshot: GalleryNotionSnapshot,
  coverSource: string | undefined,
  accessToken: string,
): Promise<PreviewItem> {
  try {
    const { dataSourceRes: dataSource, queryRes: query } = snapshot;

    const page = query.results.filter(isFullPage)[0];
    if (!page) return EMPTY_PREVIEW;

    const titleProperty = "properties" in dataSource ? getTitlePropertyName(dataSource.properties) : null;
    const values: Record<string, string> = {};
    for (const value of Object.values(page.properties)) values[value.id] = plainTextValue(value);

    return {
      title: getPageTitle(page, titleProperty),
      values,
      imageProperties: isFullDataSource(dataSource) ? listImagePropertyNames(dataSource) : [],
      uploadProperties: isFullDataSource(dataSource) ? listUploadTargetNames(dataSource) : [],
      coverUrl:
        coverSource === CONTENT_IMAGE
          ? (await resolveContentImage(accessToken, page.id)).fullUrl
          : resolveCoverUrl(page, coverSource),
    };
  } catch {
    return EMPTY_PREVIEW;
  }
}
