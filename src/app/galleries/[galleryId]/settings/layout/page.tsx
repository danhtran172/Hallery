import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { parseDetailLayout } from "@/lib/detail-layout";
import { LayoutBuilder } from "./layout-builder";

export default async function LayoutSettingsPage({
  params,
}: PageProps<"/galleries/[galleryId]/settings/layout">) {
  const { galleryId } = await params;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { propertyConfigs: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();

  const parsed = parseDetailLayout(gallery.detailLayout, gallery.propertyConfigs);
  if (parsed.usedFallback) console.warn(`Gallery ${galleryId}: ${parsed.reason}`);

  return (
    <div className="mx-auto max-w-6xl px-6 py-12">
      <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold text-stone-900">Bố cục Card Detail</h1>
      <p className="mb-8 text-sm text-stone-600">
        Sắp property trên màn Card Detail. Đây chỉ là metadata của Hallery, không thay đổi property hay cấu trúc trong Notion.
      </p>
      <LayoutBuilder galleryId={galleryId} properties={gallery.propertyConfigs} initialLayout={parsed.layout} />
    </div>
  );
}
