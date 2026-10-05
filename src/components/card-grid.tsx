import type { PageObjectResponse } from "@notionhq/client";
import { PropertyValue } from "@/components/property-value";
import { parseDisplayConfig } from "@/lib/display-config";
import type { ResolvedField, ResolvedGrid } from "@/lib/card-layout";
import type { RenderContext } from "@/lib/property-render";

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
  context,
}: {
  grid: ResolvedGrid<GridProperty>;
  title: string;
  valueOf: (propertyId: string) => PropertyValueResponse | undefined;
  context?: RenderContext;
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
        const spans = box.colSpan > 1 || box.rowSpan > 1;
        return (
          <div
            key={box.id}
            className="min-w-0"
            style={
              spans
                ? {
                    gridColumn: box.colSpan > 1 ? `span ${box.colSpan}` : undefined,
                    gridRow: box.rowSpan > 1 ? `span ${box.rowSpan}` : undefined,
                  }
                : undefined
            }
          >
            <BoxFields fields={box.fields} title={title} valueOf={valueOf} context={context} />
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
  context,
}: {
  fields: ResolvedField<GridProperty>[];
  title: string;
  valueOf: (propertyId: string) => PropertyValueResponse | undefined;
  context?: RenderContext;
}) {
  if (fields.length === 0) return null;

  return (
    <dl className="flex min-w-0 flex-col gap-1 text-sm text-ink-soft">
      {fields.map(({ property, field, isTitle }) => {
        if (isTitle) {
          return (
            <p key={field.id} className="min-w-0 truncate font-medium text-ink" title={title}>
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
          <div key={field.id} className="g-row">
            {field.showLabel && (
              // Capped rather than fixed: a fixed 6rem label left nothing for the value on a
              // narrow card, and the value is what the card is for.
              <dt className="g-label" title={label}>
                {label}
              </dt>
            )}
            <dd className="g-value">
              <PropertyValue value={value} displayConfig={config} context={context} />
            </dd>
          </div>
        );
      })}
    </dl>
  );
}
