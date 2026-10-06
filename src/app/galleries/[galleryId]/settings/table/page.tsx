import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { SettingsHeader } from "@/components/settings-header";
import { cardEligibleProperties, parseCardLayout } from "@/lib/card-layout";
import { parseDisplayConfig } from "@/lib/display-config";
import { getGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { ensureGalleryViews, parseViewLayoutConfig, viewTypeOf } from "@/lib/gallery-view";
import { PAGE_COVER, listImagePropertyNames, parseGalleryConfig } from "@/lib/notion-cover";
import { configTypeOf, describePropertyType } from "@/lib/property-kind";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { createDefaultTableLayout, parseTableLayout } from "@/lib/table-layout";
import { TableColumnsEditor, type SampleRow } from "./table-columns-editor";

export const metadata: Metadata = { title: "Cột bảng" };

export default async function TableSettingsPage({ params, searchParams }: PageProps<"/galleries/[galleryId]/settings/table">) {
  const { galleryId } = await params;
  const { view: viewParam, back } = await searchParams;
  const backQuery = typeof back === "string" ? back : undefined;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: { orderBy: { sortOrder: "asc" } }, views: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();
  const views = await ensureGalleryViews(gallery);
  const requestedViewId = typeof viewParam === "string" ? viewParam : null;
  const view = views.find((entry) => entry.id === requestedViewId) ?? views[0];
  const viewType = viewTypeOf(view);

  const viewConfig = parseViewLayoutConfig(view.layoutConfig, parseGalleryConfig(gallery.displayConfig));
  const layout =
    parseTableLayout(viewConfig.table) ?? createDefaultTableLayout(gallery.propertyConfigs, parseCardLayout(viewConfig.card));
  const titleConfig = gallery.propertyConfigs.find((config) => config.notionPropertyType === "title");

  // Image properties come from the schema; without Notion the picker still offers the
  // page cover and the page body, and keeps whatever source is already stored.
  const snapshot = await getGalleryNotionSnapshot({
    galleryId,
    dataSourceId: gallery.notionDataSourceId,
    accessToken: gallery.workspace.accessToken,
  }).catch(() => null);
  const dataSource = snapshot && isFullDataSource(snapshot.dataSourceRes) ? snapshot.dataSourceRes : null;
  const imageProperties = dataSource ? listImagePropertyNames(dataSource) : [];
  // A handful of real items for the preview, in Notion's own order.
  const titlePropertyName = dataSource ? getTitlePropertyName(dataSource.properties) : null;
  const samples: SampleRow[] = (snapshot?.pages ?? []).slice(0, 5).map((page) => ({
    page,
    title: getPageTitle(page, titlePropertyName),
    icon: getPageIcon(page),
  }));

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <SettingsHeader
        galleryId={galleryId}
        galleryName={gallery.name}
        viewId={view.id}
        viewType={viewType}
        back={backQuery}
        active="table"
        description={`Bảng của view “${view.name}”: cột nào hiện, theo thứ tự nào, mỗi cột trông ra sao. Trên trang gallery, kéo mép tiêu đề cột để đổi độ rộng và bấm tiêu đề cột để sắp xếp.`}
      />

      {viewType !== "table" && (
        <p className="notice mb-6">
          View “{view.name}” đang hiện dạng Gallery. Cột bảng vẫn lưu được, và có hiệu lực khi chọn dạng Bảng trong menu Tuỳ
          chỉnh.
        </p>
      )}

      <TableColumnsEditor
        galleryId={galleryId}
        viewId={view.id}
        initialLayout={layout}
        initialCoverSource={viewConfig.coverSource ?? PAGE_COVER}
        imageProperties={imageProperties}
        titleName={(titleConfig && parseDisplayConfig(titleConfig.displayConfig).nameOverride?.trim()) || titleConfig?.notionPropertyName || "Tên"}
        samples={samples}
        properties={cardEligibleProperties(gallery.propertyConfigs).map((config) => ({
          id: config.id,
          notionPropertyId: config.notionPropertyId,
          notionPropertyName: config.notionPropertyName,
          notionPropertyType: config.notionPropertyType,
          displayConfig: config.displayConfig,
          isMissing: config.isMissing,
          disabled: config.disabled,
          name: parseDisplayConfig(config.displayConfig).nameOverride?.trim() || config.notionPropertyName,
          typeLabel: describePropertyType(config.notionPropertyType, config.resolvedType),
          configType: configTypeOf(config.notionPropertyType, config.resolvedType),
        }))}
      />
    </div>
  );
}
