import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import Link from "next/link";
import { SettingsHeader, settingsHref } from "@/components/settings-header";
import { parseGalleryConfig, resolveCardsPerRow } from "@/lib/notion-cover";
import { describePropertyType } from "@/lib/property-kind";
import { ensureGalleryViews, parseViewLayoutConfig, viewTypeOf } from "@/lib/gallery-view";
import { parseDisplayConfig } from "@/lib/display-config";
import { parseNativeButton } from "@/lib/native-button";
import { ButtonEditor } from "@/components/button-editor";
import { setPropertyDisabled, updatePropertyPlacement } from "./actions";
import { PropertyList, type ListedProperty } from "./property-list";
import { GridSettingsForm } from "./grid-settings-form";

export const metadata: Metadata = { title: "Cài đặt hiển thị" };

export default async function DisplaySettingsPage({
  params,
  searchParams,
}: PageProps<"/galleries/[galleryId]/settings/display">) {
  const { galleryId } = await params;
  const { prop, view: viewParam, back } = await searchParams;
  const backQuery = typeof back === "string" ? back : undefined;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: {
      workspace: true,
      propertyConfigs: { orderBy: { sortOrder: "asc" } },
      views: { orderBy: { sortOrder: "asc" } },
    },
  });
  if (!gallery) notFound();
  const views = await ensureGalleryViews(gallery);
  const requestedViewId = typeof viewParam === "string" ? viewParam : null;
  const view = views.find((entry) => entry.id === requestedViewId) ?? views[0];

  const properties = gallery.propertyConfigs.filter((p) => p.notionPropertyType !== "title");
  const galleryConfig = parseGalleryConfig(gallery.displayConfig);
  const cardsPerRow = resolveCardsPerRow(parseViewLayoutConfig(view.layoutConfig, galleryConfig));
  const viewType = viewTypeOf(view);

  const selectedId = typeof prop === "string" ? prop : null;
  const selected = properties.find((p) => p.notionPropertyId === selectedId) ?? null;

  const listed: ListedProperty[] = properties.map((p) => ({
    id: p.id,
    notionPropertyId: p.notionPropertyId,
    notionPropertyName: p.notionPropertyName,
    displayName: parseDisplayConfig(p.displayConfig).nameOverride?.trim() || null,
    typeLabel: describePropertyType(p.notionPropertyType, p.resolvedType),
    type: p.notionPropertyType,
    disabled: p.disabled,
  }));

  // Position is only meaningful among the properties Hallery still manages.
  const managed = properties.filter((p) => !p.disabled);
  const managedIndex = selected ? managed.findIndex((p) => p.id === selected.id) : -1;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
      <SettingsHeader
        galleryId={galleryId}
        galleryName={gallery.name}
        viewId={view.id}
        viewType={viewType}
        back={backQuery}
        active="display"
        description={`${viewType === "table" ? "Nút chọn ngẫu nhiên" : "Số card mỗi hàng, nút chọn ngẫu nhiên"}, property nào Hallery quản lý và hành động của nút — không đổi gì trong Notion.`}
      />

      <GridSettingsForm
        galleryId={galleryId}
        viewId={view.id}
        viewName={view.name}
        viewType={viewType}
        cardsPerRow={cardsPerRow}
        randomPick={galleryConfig.randomPick !== false}
      />

      <div className="flex flex-col gap-6 md:flex-row">
        <div className="max-h-[36rem] w-full shrink-0 md:w-64">
          <PropertyList galleryId={galleryId} viewId={view.id} properties={listed} selectedId={selectedId} />
        </div>

        <div className="min-w-0 flex-1">
          {selected ? (
            <PropertyEditor
              key={selected.id}
              galleryId={galleryId}
              formatLinks={
                viewType === "table"
                  ? [
                      { label: "Cột bảng", href: settingsHref(galleryId, "table", view.id, backQuery) },
                      { label: "Card Detail", href: settingsHref(galleryId, "card", view.id, backQuery, { mode: "detail" }) },
                    ]
                  : [{ label: "Bố cục card", href: settingsHref(galleryId, "card", view.id, backQuery) }]
              }
              property={selected}
              isFirst={managedIndex === 0}
              isLast={managedIndex === managed.length - 1}
            />
          ) : (
            <p className="empty-state py-16">Chọn một property bên trái để quản lý nó.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PropertyEditor({
  galleryId,
  formatLinks,
  property,
  isFirst,
  isLast,
}: {
  galleryId: string;
  /** Where this property's name and formatting are edited for the open view. */
  formatLinks: { label: string; href: string }[];
  property: {
    id: string;
    notionPropertyId: string;
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
  const display = parseDisplayConfig(property.displayConfig);

  return (
    <div className="panel p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="display truncate text-xl text-ink">{display.nameOverride?.trim() || property.notionPropertyName}</h2>
          <span className="font-mono text-xs text-faint">
            {display.nameOverride?.trim() ? `${property.notionPropertyName} · ` : ""}
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
        <p className="mb-4 rounded-2xl border border-dashed border-line-strong bg-subtle px-4 py-4 text-sm text-ink-soft">
          Hallery không quản lý property này. Nó không lên card, không sắp xếp, lọc hay tìm kiếm được — coi như
          không tồn tại. Giá trị trong Notion vẫn nguyên vẹn và Notion vẫn quản lý bình thường.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          {/* Naming and formatting live beside what they format, where the result shows as it changes. */}
          <p className="text-sm text-ink-soft">
            Tên hiển thị, kiểu hiển thị và chữ kèm theo chỉnh ở{" "}
            {formatLinks.map((link, index) => (
              <span key={link.href}>
                {index > 0 && " hoặc "}
                <Link href={link.href} className="font-medium text-brand-ink underline-offset-2 hover:underline">
                  {link.label}
                </Link>
              </span>
            ))}
            .
          </p>
          {property.notionPropertyType === "button" && (
            <section className="border-t border-line pt-5">
              <h3 className="mb-3 text-sm font-semibold text-ink">Cấu hình nút</h3>
              <ButtonEditor
                key={property.notionPropertyId}
                galleryId={galleryId}
                propertyId={property.notionPropertyId}
                propertyName={display.nameOverride?.trim() || property.notionPropertyName}
                initial={parseNativeButton(display.button)}
              />
            </section>
          )}
        </div>
      )}

      <form action={toggle} className="mt-6 border-t border-line pt-4">
        <button type="submit" className={`btn btn-sm ${property.disabled ? "btn-primary" : "btn-danger"}`}>
          {property.disabled ? "Quản lý lại property này" : "Không quản lý nữa"}
        </button>
        {!property.disabled && (
          <p className="mt-2 text-xs text-muted">
            Để Notion tự quản lý. Bỏ khỏi card, Card Detail, sắp xếp, lọc và tìm kiếm — bật lại được bất cứ lúc nào.
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
      <button type="submit" aria-label={label} title={label} disabled={disabled} className="btn btn-secondary btn-sm btn-icon">
        {children}
      </button>
    </form>
  );
}
