"use client";

import Link from "next/link";
import { useState } from "react";

export type ListedProperty = {
  id: string;
  notionPropertyId: string;
  notionPropertyName: string;
  typeLabel: string;
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
  properties,
  selectedId,
}: {
  galleryId: string;
  properties: ListedProperty[];
  selectedId: string | null;
}) {
  const [search, setSearch] = useState("");
  const needle = search.trim().toLowerCase();
  const visible = properties.filter((property) => property.notionPropertyName.toLowerCase().includes(needle));

  const active = visible.filter((property) => !property.disabled);
  const disabled = visible.filter((property) => property.disabled);

  return (
    <div className="flex min-h-0 flex-col gap-2">
      <input
        type="search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="Tìm property"
        className="w-full rounded-md border border-stone-300 px-2.5 py-1.5 text-xs outline-none focus:border-emerald-600"
      />

      <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto">
        {visible.length === 0 && <p className="px-1 py-2 text-xs text-stone-400">Không tìm thấy property nào.</p>}

        {active.map((property) => (
          <PropertyLink
            key={property.id}
            galleryId={galleryId}
            property={property}
            selected={property.notionPropertyId === selectedId}
          />
        ))}

        {disabled.length > 0 && (
          <div className="mt-3 rounded-md border border-dashed border-stone-300 bg-stone-50 p-1.5">
            <p className="px-1 pb-1 text-[11px] font-medium uppercase tracking-wide text-stone-400">
              Không quản lý ({disabled.length})
            </p>
            <div className="flex flex-col gap-1">
              {disabled.map((property) => (
                <PropertyLink
                  key={property.id}
                  galleryId={galleryId}
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
  property,
  selected,
}: {
  galleryId: string;
  property: ListedProperty;
  selected: boolean;
}) {
  return (
    <Link
      href={`/galleries/${galleryId}/settings/display?prop=${encodeURIComponent(property.notionPropertyId)}`}
      aria-current={selected ? "true" : undefined}
      className={`flex items-center gap-1.5 rounded border px-2 py-1.5 text-xs ${
        selected
          ? "border-emerald-600 bg-emerald-50 text-emerald-900"
          : "border-transparent hover:border-stone-300"
      } ${property.disabled ? "text-stone-400" : "text-stone-700"}`}
    >
      <span className="min-w-0 flex-1 truncate">{property.notionPropertyName}</span>
      <span className="shrink-0 font-mono text-[10px] text-stone-400">{property.typeLabel}</span>
    </Link>
  );
}
