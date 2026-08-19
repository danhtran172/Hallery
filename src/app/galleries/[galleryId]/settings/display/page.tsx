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
import { saveGalleryGridSettings, setPropertyDisabled, updatePropertyPlacement } from "./actions";
import { PropertyList, type ListedProperty } from "./property-list";

export default async function DisplaySettingsPage({
  params,
  searchParams,
}: PageProps<"/galleries/[galleryId]/settings/display">) {
  const { galleryId } = await params;
  const { prop } = await searchParams;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { propertyConfigs: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();

  const properties = gallery.propertyConfigs.filter((p) => p.notionPropertyType !== "title");
  const galleryConfig = parseGalleryConfig(gallery.displayConfig);
  const cardsPerRow = resolveCardsPerRow(galleryConfig);

  const selectedId = typeof prop === "string" ? prop : null;
  const selected = properties.find((p) => p.notionPropertyId === selectedId) ?? null;

  const listed: ListedProperty[] = properties.map((p) => ({
    id: p.id,
    notionPropertyId: p.notionPropertyId,
    notionPropertyName: p.notionPropertyName,
    typeLabel: describePropertyType(p.notionPropertyType, p.resolvedType),
    disabled: p.disabled,
  }));

  // Position is only meaningful among the properties Hallery still manages.
  const managed = properties.filter((p) => !p.disabled);
  const managedIndex = selected ? managed.findIndex((p) => p.id === selected.id) : -1;

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold text-stone-900">Cài đặt hiển thị</h1>
      <p className="mb-8 text-sm text-stone-600">
        Chọn cách mỗi property hiển thị trong Gallery và Card Detail — không đổi gì trong Notion, chỉ đổi cách
        Hallery đọc và trình bày lại giá trị.
      </p>

      <GalleryGridSettings
        galleryId={galleryId}
        cardsPerRow={cardsPerRow}
        randomPick={galleryConfig.randomPick !== false}
      />

      <div className="flex gap-6">
        <div className="max-h-[32rem] w-60 shrink-0">
          <PropertyList galleryId={galleryId} properties={listed} selectedId={selectedId} />
        </div>

        <div className="min-w-0 flex-1">
          {selected ? (
            <PropertyEditor
              galleryId={galleryId}
              property={selected}
              isFirst={managedIndex === 0}
              isLast={managedIndex === managed.length - 1}
            />
          ) : (
            <p className="rounded-lg border border-dashed border-stone-300 px-4 py-16 text-center text-sm text-stone-500">
              Chọn một property bên trái để chỉnh cách nó hiển thị.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

function GalleryGridSettings({
  galleryId,
  cardsPerRow,
  randomPick,
}: {
  galleryId: string;
  cardsPerRow: number;
  randomPick: boolean;
}) {
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

      <label className="mt-4 flex items-start gap-2 border-t border-stone-100 pt-4 text-sm text-stone-700">
        <input type="checkbox" name="randomPick" defaultChecked={randomPick} className="mt-0.5" />
        <span>
          Hiện nút chọn ngẫu nhiên
          <span className="mt-0.5 block text-xs text-stone-500">
            Bốc một item bất kỳ trong số đang hiện, nên nó tôn trọng bộ lọc và ô tìm kiếm.
          </span>
        </span>
      </label>
    </form>
  );
}

function PropertyEditor({
  galleryId,
  property,
  isFirst,
  isLast,
}: {
  galleryId: string;
  property: {
    id: string;
    notionPropertyName: string;
    notionPropertyType: string;
    resolvedType: string | null;
    displayConfig: string;
    disabled: boolean;
  };
  isFirst: boolean;
  isLast: boolean;
}) {
  const place = updatePropertyPlacement.bind(null, galleryId, property.id);
  const toggle = setPropertyDisabled.bind(null, galleryId, property.id, !property.disabled);

  return (
    <div className="rounded-lg border border-stone-200 p-5">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-stone-900">{property.notionPropertyName}</h2>
          <span className="font-mono text-xs text-stone-400">
            {describePropertyType(property.notionPropertyType, property.resolvedType)}
          </span>
        </div>
        {!property.disabled && (
          <div className="flex shrink-0 items-center gap-1">
            <PlacementButton action={place.bind(null, "up")} label="Lên trên" disabled={isFirst}>
              ↑
            </PlacementButton>
            <PlacementButton action={place.bind(null, "down")} label="Xuống dưới" disabled={isLast}>
              ↓
            </PlacementButton>
          </div>
        )}
      </div>

      {property.disabled ? (
        <p className="mb-4 rounded-md border border-dashed border-stone-300 bg-stone-50 px-3 py-4 text-sm text-stone-600">
          Hallery không quản lý property này. Nó không lên card, không sắp xếp, lọc hay tìm kiếm được — coi như
          không tồn tại. Giá trị trong Notion vẫn nguyên vẹn và Notion vẫn quản lý bình thường.
        </p>
      ) : (
        <PropertyDisplayConfigForm galleryId={galleryId} property={property} />
      )}

      <form action={toggle} className="mt-5 border-t border-stone-100 pt-4">
        <button
          type="submit"
          className={`rounded-md border px-3 py-1.5 text-xs font-medium ${
            property.disabled
              ? "border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
              : "border-stone-300 text-stone-700 hover:border-red-400 hover:text-red-700"
          }`}
        >
          {property.disabled ? "Quản lý lại property này" : "Không quản lý nữa"}
        </button>
        {!property.disabled && (
          <p className="mt-2 text-xs text-stone-500">
            Để Notion tự quản lý. Bỏ khỏi card, Card Detail, sắp xếp, lọc và tìm kiếm — gỡ lại được bất cứ lúc nào.
          </p>
        )}
      </form>
    </div>
  );
}

function PlacementButton({
  action,
  label,
  disabled,
  children,
}: {
  action: () => void;
  label: string;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <form action={action}>
      <button
        type="submit"
        aria-label={label}
        title={label}
        disabled={disabled}
        className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-600 hover:border-stone-500 disabled:opacity-30"
      >
        {children}
      </button>
    </form>
  );
}
