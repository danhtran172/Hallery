import type { PageObjectResponse } from "@notionhq/client";
import { PropertyValue } from "@/components/property-value";
import { parseDisplayConfig } from "@/lib/display-config";
import type { ResolvedField, ResolvedGrid } from "@/lib/card-layout";

type PropertyValueResponse = PageObjectResponse["properties"][string];

export type GridProperty = {
  id: string;
  notionPropertyId: string;
  notionPropertyName: string;
  displayConfig: string;
};

/** Renders a layer-1 or layer-2 grid of boxes onto a card. */
export function CardGrid({
  grid,
  title,
  valueOf,
}: {
  grid: ResolvedGrid<GridProperty>;
  title: string;
  valueOf: (propertyId: string) => PropertyValueResponse | undefined;
}) {
  return (
    <div
      className="grid h-full gap-x-3 gap-y-1"
      style={{
        gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))`,
        alignContent: grid.align ?? "start",
      }}
    >
      {grid.boxes.map((box) => {
        // A folded box takes no track at all; its neighbour already spans over it.
        if (box.merged) return null;
        return (
          <div
            key={box.id}
            className="min-w-0"
            style={{
              gridColumn: box.colSpan > 1 ? `span ${box.colSpan}` : undefined,
              gridRow: box.rowSpan > 1 ? `span ${box.rowSpan}` : undefined,
            }}
          >
            <BoxFields fields={box.fields} title={title} valueOf={valueOf} />
          </div>
        );
      })}
    </div>
  );
}

function BoxFields({
  fields,
  title,
  valueOf,
}: {
  fields: ResolvedField<GridProperty>[];
  title: string;
  valueOf: (propertyId: string) => PropertyValueResponse | undefined;
}) {
  if (fields.length === 0) return null;

  return (
    <dl className="flex min-w-0 flex-col gap-1 text-sm text-stone-600">
      {fields.map(({ property, field, isTitle }) => {
        if (isTitle) {
          return (
            <p key={field.id} className="min-w-0 truncate font-medium text-stone-900">
              {title}
            </p>
          );
        }
        if (!property) return null;
        const value = valueOf(property.notionPropertyId);
        if (!value) return null;
        const config = parseDisplayConfig(property.displayConfig);
        const label = config.nameOverride?.trim() || property.notionPropertyName;

        return (
          <div key={field.id} className="flex min-w-0 items-baseline gap-2">
            {field.showLabel && (
              <dt className="w-24 shrink-0 truncate text-xs text-stone-400">{label}</dt>
            )}
            <dd className="min-w-0 flex-1 truncate [&_a]:pointer-events-auto">
              <PropertyValue value={value} displayConfig={config} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
