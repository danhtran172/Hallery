import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { PropertyDisplayConfigForm } from "@/components/property-display-config-form";
import { SettingsHeader } from "@/components/settings-header";
import { parseGalleryConfig, resolveCardsPerRow } from "@/lib/notion-cover";
import { describePropertyType } from "@/lib/property-kind";
import { ensureGalleryViews, parseViewLayoutConfig } from "@/lib/gallery-view";
import { parseDisplayConfig } from "@/lib/display-config";
import { opsFor, parseNativeButton } from "@/lib/native-button";
import { getGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { setPropertyDisabled, updatePropertyPlacement } from "./actions";
import { PropertyList, type ListedProperty } from "./property-list";
import { GridSettingsForm } from "./grid-settings-form";
import { ButtonActionsEditor, type WritableProperty } from "./button-actions-editor";

export const metadata: Metadata = { title: "Cài đặt hiển thị" };

export default async function DisplaySettingsPage({
  params,
  searchParams,
}: PageProps<"/galleries/[galleryId]/settings/display">) {
  const { galleryId } = await params;
  const { prop, view: viewParam } = await searchParams;
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

  const selectedId = typeof prop === "string" ? prop : null;
  const selected = properties.find((p) => p.notionPropertyId === selectedId) ?? null;

  const listed: ListedProperty[] = properties.map((p) => ({
    id: p.id,
    notionPropertyId: p.notionPropertyId,
    notionPropertyName: p.notionPropertyName,
    displayName: parseDisplayConfig(p.displayConfig).nameOverride?.trim() || null,
    typeLabel: describePropertyType(p.notionPropertyType, p.resolvedType),
    disabled: p.disabled,
  }));

  // Position is only meaningful among the properties Hallery still manages.
  const managed = properties.filter((p) => !p.disabled);
  const managedIndex = selected ? managed.findIndex((p) => p.id === selected.id) : -1;

  // A native button can write to any managed property of a writable type; select-like ones
  // offer their options, read from the snapshot (no request when it is warm).
  let writable: WritableProperty[] = [];
  if (selected?.notionPropertyType === "button") {
    const snapshot = await getGalleryNotionSnapshot({
      galleryId,
      dataSourceId: gallery.notionDataSourceId,
      accessToken: gallery.workspace.accessToken,
    }).catch(() => null);
    const schema = snapshot && isFullDataSource(snapshot.dataSourceRes) ? snapshot.dataSourceRes.properties : {};
    const schemaById = new Map(Object.values(schema).map((entry) => [entry.id, entry]));
    writable = managed
      .filter((property) => opsFor(property.notionPropertyType).length > 0)
      .map((property) => {
        const entry = schemaById.get(property.notionPropertyId);
        const options =
          entry?.type === "select"
            ? entry.select.options.map((option) => option.name)
            : entry?.type === "status"
              ? entry.status.options.map((option) => option.name)
              : entry?.type === "multi_select"
                ? entry.multi_select.options.map((option) => option.name)
                : undefined;
        return {
          notionPropertyId: property.notionPropertyId,
          name: parseDisplayConfig(property.displayConfig).nameOverride?.trim() || property.notionPropertyName,
          type: property.notionPropertyType,
          options,
        };
      });
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <SettingsHeader
        galleryId={galleryId}
        galleryName={gallery.name}
        viewId={view.id}
        active="display"
        description="Chọn cách mỗi property hiển thị trong Gallery và Card Detail — không đổi gì trong Notion, chỉ đổi cách Hallery trình bày lại giá trị."
      />

      <GridSettingsForm
        galleryId={galleryId}
        viewId={view.id}
        viewName={view.name}
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
              property={selected}
              isFirst={managedIndex === 0}
              isLast={managedIndex === managed.length - 1}
              writable={writable}
            />
          ) : (
            <p className="empty-state py-16">Chọn một property bên trái để chỉnh cách nó hiển thị.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function PropertyEditor({
  galleryId,
  property,
  isFirst,
  isLast,
  writable,
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
  writable: WritableProperty[];
}) {
  const place = updatePropertyPlacement.bind(null, galleryId, property.id);
  const toggle = setPropertyDisabled.bind(null, galleryId, property.id, !property.disabled);
  const display = parseDisplayConfig(property.displayConfig);

  return (
    <div className="panel p-5">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="truncate text-lg font-semibold text-ink">{display.nameOverride?.trim() || property.notionPropertyName}</h2>
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
        <p className="mb-4 rounded-lg border border-dashed border-line-strong bg-canvas px-3 py-4 text-sm text-ink-soft">
          Hallery không quản lý property này. Nó không lên card, không sắp xếp, lọc hay tìm kiếm được — coi như
          không tồn tại. Giá trị trong Notion vẫn nguyên vẹn và Notion vẫn quản lý bình thường.
        </p>
      ) : (
        <div className="flex flex-col gap-6">
          <PropertyDisplayConfigForm galleryId={galleryId} property={property} />
          {property.notionPropertyType === "button" && (
            <section className="border-t border-line pt-5">
              <h3 className="mb-3 text-sm font-semibold text-ink">Hành động khi bấm nút</h3>
              <ButtonActionsEditor
                galleryId={galleryId}
                propertyConfigId={property.id}
                propertyName={display.nameOverride?.trim() || property.notionPropertyName}
                initial={parseNativeButton(display.button)}
                properties={writable}
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
