import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { PropertyDisplayConfigForm } from "@/components/property-display-config-form";

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

      <div className="flex flex-col gap-4">
        {properties.map((p) => (
          <PropertyConfigCard key={p.id} galleryId={galleryId} property={p} />
        ))}
      </div>
    </div>
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
    displayConfig: string;
  };
}) {
  return (
    <div className="rounded-lg border border-stone-200 p-4">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="font-medium text-stone-900">{property.notionPropertyName}</span>
        <span className="font-mono text-xs text-stone-400">{property.notionPropertyType}</span>
      </div>

      <PropertyDisplayConfigForm galleryId={galleryId} property={property} />
    </div>
  );
}
