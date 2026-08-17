import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PropertyDisplayConfigForm } from "@/components/property-display-config-form";
import {
  MAX_CARDS_PER_ROW,
  MIN_CARDS_PER_ROW,
  parseGalleryConfig,
  resolveCardsPerRow,
} from "@/lib/notion-cover";
import { describePropertyType } from "@/lib/property-kind";
import { saveGalleryGridSettings } from "./actions";

export default async function DisplaySettingsPage({
  params,
}: PageProps<"/galleries/[galleryId]/settings/display">) {
  const { galleryId } = await params;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { propertyConfigs: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();

  const properties = gallery.propertyConfigs.filter((p) => p.notionPropertyType !== "title");
  const cardsPerRow = resolveCardsPerRow(parseGalleryConfig(gallery.displayConfig));

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold text-stone-900">Cài đặt hiển thị</h1>
      <p className="mb-8 text-sm text-stone-600">
        Chọn cách mỗi property hiển thị trong Gallery và Card Detail — không đổi gì trong Notion, chỉ đổi cách
        Hallery đọc và trình bày lại giá trị.
      </p>

      <GalleryGridSettings galleryId={galleryId} cardsPerRow={cardsPerRow} />

      <div className="flex flex-col gap-4">
        {properties.map((p) => (
          <PropertyConfigCard key={p.id} galleryId={galleryId} property={p} />
        ))}
      </div>
    </div>
  );
}

function GalleryGridSettings({ galleryId, cardsPerRow }: { galleryId: string; cardsPerRow: number }) {
  return (
    <form action={saveGalleryGridSettings.bind(null, galleryId)} className="mb-6 rounded-lg border border-stone-200 p-4">
      <label htmlFor="cardsPerRow" className="block text-sm font-medium text-stone-900">
        Số card mỗi hàng
      </label>
      <p className="mt-1 text-xs text-stone-500">
        Áp dụng trên desktop. Trên màn hình nhỏ, Gallery tự giảm số cột để card vẫn dễ đọc.
      </p>
      <div className="mt-3 flex items-end gap-3">
        <input
          id="cardsPerRow"
          name="cardsPerRow"
          type="number"
          inputMode="numeric"
          min={MIN_CARDS_PER_ROW}
          max={MAX_CARDS_PER_ROW}
          defaultValue={cardsPerRow}
          className="h-10 w-24 rounded-md border border-stone-300 px-3 text-base text-stone-900 outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
        />
        <button
          type="submit"
          className="h-10 rounded-md bg-emerald-700 px-4 text-sm font-medium text-white hover:bg-emerald-800"
        >
          Lưu
        </button>
      </div>
    </form>
  );
}

function PropertyConfigCard({
  galleryId,
  property,
}: {
  galleryId: string;
  property: {
    id: string;
    notionPropertyName: string;
    notionPropertyType: string;
    resolvedType: string | null;
    displayConfig: string;
  };
}) {
  return (
    <div className="rounded-lg border border-stone-200 p-4">
      <div className="mb-3 flex items-baseline justify-between gap-3">
        <span className="font-medium text-stone-900">{property.notionPropertyName}</span>
        <span className="font-mono text-xs text-stone-400">
          {describePropertyType(property.notionPropertyType, property.resolvedType)}
        </span>
      </div>

      <PropertyDisplayConfigForm galleryId={galleryId} property={property} />
    </div>
  );
}
