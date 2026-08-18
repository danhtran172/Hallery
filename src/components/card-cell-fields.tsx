import type { PageObjectResponse } from "@notionhq/client";
import { PropertyValue } from "@/components/property-value";
import { parseDisplayConfig } from "@/lib/display-config";
import type { CellDisplay } from "@/lib/card-layout";

type PropertyValueResponse = PageObjectResponse["properties"][string];

type CardFieldProperty = {
  id: string;
  notionPropertyId: string;
  notionPropertyName: string;
  displayConfig: string;
};

/**
 * Layer 2: how the properties inside one box are laid out. The four modes trade label
 * prominence against vertical space — a card only has so much of it.
 */
export function CardCellFields({
  display,
  fields,
  valueOf,
}: {
  display: CellDisplay;
  fields: { property: CardFieldProperty; showLabel: boolean }[];
  valueOf: (propertyId: string) => PropertyValueResponse | undefined;
}) {
  if (fields.length === 0) return null;

  const entries = fields
    .map(({ property, showLabel }) => {
      const value = valueOf(property.notionPropertyId);
      return value ? { property, showLabel, value } : null;
    })
    .filter((entry): entry is NonNullable<typeof entry> => entry !== null);

  if (entries.length === 0) return null;

  if (display === "inline") {
    return (
      <dl className="flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm text-stone-600">
        {entries.map(({ property, showLabel, value }) => (
          <span key={property.id} className="flex items-baseline gap-1">
            {showLabel && <dt className="text-xs text-stone-400">{property.notionPropertyName}</dt>}
            <dd className="[&_a]:pointer-events-auto">
              <PropertyValue value={value} displayConfig={parseDisplayConfig(property.displayConfig)} />
            </dd>
          </span>
        ))}
      </dl>
    );
  }

  if (display === "stacked") {
    return (
      <dl className="flex flex-col gap-1.5 text-sm text-stone-600">
        {entries.map(({ property, showLabel, value }) => (
          <div key={property.id} className="min-w-0">
            {showLabel && (
              <dt className="truncate text-[11px] uppercase tracking-wide text-stone-400">
                {property.notionPropertyName}
              </dt>
            )}
            <dd className="min-w-0 [&_a]:pointer-events-auto">
              <PropertyValue value={value} displayConfig={parseDisplayConfig(property.displayConfig)} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }

  const rows = entries.map(({ property, showLabel, value }) => (
    <div key={property.id} className="flex items-baseline gap-2">
      {showLabel && (
        <dt className="w-24 shrink-0 truncate text-xs text-stone-400">{property.notionPropertyName}</dt>
      )}
      <dd className="min-w-0 flex-1 [&_a]:pointer-events-auto">
        <PropertyValue value={value} displayConfig={parseDisplayConfig(property.displayConfig)} />
      </dd>
    </div>
  ));

  if (display === "two-col") {
    return <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-sm text-stone-600">{rows}</dl>;
  }

  return <dl className="flex flex-col gap-1 text-sm text-stone-600">{rows}</dl>;
}
