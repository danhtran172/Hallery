"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { PROPERTY_SEARCH_PLACEHOLDER, matchesPropertySearch, splitButtons } from "@/lib/property-search";

export type ListedProperty = {
  id: string;
  notionPropertyId: string;
  notionPropertyName: string;
  /** The Hallery rename, when there is one. */
  displayName: string | null;
  typeLabel: string;
  /** Notion's type name, which "/<type>" searches match. */
  type: string;
  disabled: boolean;
};

/**
 * The property picker beside the editor.
 *
 * Disabled properties sink into their own section rather than leaving the list, because
 * switching one back on has to be as findable as switching it off — and the search runs
 * over both sections for the same reason.
 */
export function PropertyList({
  galleryId,
  viewId,
  properties,
  selectedId,
}: {
  galleryId: string;
  viewId: string;
  properties: ListedProperty[];
  selectedId: string | null;
}) {
  const [search, setSearch] = useState("");
  const visible = properties.filter((property) =>
    matchesPropertySearch(
      { name: property.notionPropertyName, otherName: property.displayName, type: property.type },
      search,
    ),
  );

  const { values: active, buttons } = splitButtons(
    visible.filter((property) => !property.disabled),
    (property) => property.type,
  );
  const disabled = visible.filter((property) => property.disabled);

  return (
    <div className="flex h-full min-h-0 flex-col gap-2">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder={PROPERTY_SEARCH_PLACEHOLDER}
        aria-label="Tìm property"
        className="input input-sm"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto">
        {visible.length === 0 && <p className="px-1 py-2 text-xs text-faint">Không tìm thấy property nào.</p>}

        {active.map((property) => (
          <PropertyLink
            key={property.id}
            galleryId={galleryId}
            viewId={viewId}
            property={property}
            selected={property.notionPropertyId === selectedId}
          />
        ))}

        {buttons.length > 0 && (
          <div className="mt-3 rounded-2xl bg-subtle/70 p-1.5 ring-1 ring-line">
            <p className="px-1 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Nút ({buttons.length})</p>
            <div className="flex flex-col gap-0.5">
              {buttons.map((property) => (
                <PropertyLink
                  key={property.id}
                  galleryId={galleryId}
                  viewId={viewId}
                  property={property}
                  selected={property.notionPropertyId === selectedId}
                />
              ))}
            </div>
          </div>
        )}

        {disabled.length > 0 && (
          <div className="mt-3 rounded-2xl border border-dashed border-line-strong bg-subtle/60 p-1.5">
            <p className="px-1 pb-1 text-[11px] font-medium tracking-wide text-faint uppercase">
              Không quản lý ({disabled.length})
            </p>
            <div className="flex flex-col gap-0.5">
              {disabled.map((property) => (
                <PropertyLink
                  key={property.id}
                  galleryId={galleryId}
                  viewId={viewId}
                  property={property}
                  selected={property.notionPropertyId === selectedId}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyLink({
  galleryId,
  viewId,
  property,
  selected,
}: {
  galleryId: string;
  viewId: string;
  property: ListedProperty;
  selected: boolean;
}) {
  // Everything else on the address — the way back to the Gallery above all — stays.
  const params = new URLSearchParams(useSearchParams().toString());
  params.set("view", viewId);
  params.set("prop", property.notionPropertyId);
  return (
    <Link
      href={`/galleries/${galleryId}/settings/display?${params}`}
      scroll={false}
      aria-current={selected ? "true" : undefined}
      className={`flex items-center gap-1.5 rounded-xl px-2.5 py-2 text-[13px] transition-colors ${
        selected ? "bg-brand-soft font-medium text-brand-ink ring-1 ring-brand-line" : "hover:bg-subtle"
      } ${property.disabled ? "text-faint" : "text-ink-soft"}`}
    >
      <span className="min-w-0 flex-1 truncate" title={property.notionPropertyName}>
        {property.displayName ?? property.notionPropertyName}
      </span>
      <span className="shrink-0 font-mono text-[10px] text-faint">{property.typeLabel}</span>
    </Link>
  );
}
