import { notFound } from "next/navigation";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { parseDetailLayout } from "@/lib/detail-layout";
import { getNotionClient } from "@/lib/notion";
import { syncPropertyConfigs } from "@/lib/property-config-sync";
import { LayoutBuilder } from "./layout-builder";

export default async function LayoutSettingsPage({
  params,
}: PageProps<"/galleries/[galleryId]/settings/layout">) {
  const { galleryId } = await params;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();

  // Keep the Builder's property tray accurate even when it is opened directly,
  // without first visiting the Gallery page that normally performs this sync.
  try {
    const notion = getNotionClient(gallery.workspace.accessToken);
    const dataSource = await notion.dataSources.retrieve({ data_source_id: gallery.notionDataSourceId });
    if (isFullDataSource(dataSource)) {
      await syncPropertyConfigs(galleryId, gallery.propertyConfigs, dataSource);
    }
  } catch {
    console.warn(`Gallery ${galleryId}: không thể đồng bộ property với Notion khi mở Layout Builder.`);
  }

  const propertyConfigs = await db.propertyConfig.findMany({
    where: { galleryId },
    orderBy: { sortOrder: "asc" },
  });
  const templates = await db.layoutTemplate.findMany({ orderBy: { createdAt: "desc" } });

  const parsed = parseDetailLayout(gallery.detailLayout, propertyConfigs);
  if (parsed.usedFallback) console.warn(`Gallery ${galleryId}: ${parsed.reason}`);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <h1 className="mb-1 text-2xl font-semibold text-stone-900">Bố cục Card Detail</h1>
      <p className="mb-8 text-sm text-stone-600">
        Sắp property trên màn Card Detail. Đây chỉ là metadata của Hallery, không thay đổi property hay cấu trúc trong Notion.
      </p>
      <LayoutBuilder
        galleryId={galleryId}
        galleryName={gallery.name}
        properties={propertyConfigs}
        initialLayout={parsed.layout}
        templates={templates.map((template) => ({ id: template.id, name: template.name, layout: template.layout }))}
      />
    </div>
  );
}
