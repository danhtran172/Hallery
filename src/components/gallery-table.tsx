import Link from "next/link";
import type { PageObjectResponse } from "@notionhq/client";
import { CardCover } from "@/components/card-cover";
import type { CardCoverModel } from "@/components/gallery-card";
import type { GridProperty } from "@/components/card-grid";
import { CardPendingOverlay } from "@/components/link-pending";
import { PropertyValue } from "@/components/property-value";
import { parseDisplayConfig, type DisplayConfig } from "@/lib/display-config";
import { propertyById } from "@/lib/page-properties";
import type { RenderContext } from "@/lib/property-render";
import { stickyLeft, type ColumnAlign, type ResolvedTableColumn, type TableLayout } from "@/lib/table-layout";

/** Everything a row needs to draw one column's cell, worked out once per table. */
export type TableCellModel = {
  id: string;
  kind: "title" | "cover" | "property";
  property: GridProperty | null;
  display: DisplayConfig;
  wrap: boolean;
  align: ColumnAlign;
  /** CSS `left` while the column is fixed; null when it scrolls. */
  left: string | null;
};

/** The thumbnail's frame, and whether it sits in the title cell or a column of its own. */
export type TableThumb = { width: number; height: number; round: boolean; inTitle: boolean };

export function buildTableCells(
  columns: ResolvedTableColumn<GridProperty>[],
  layout: Pick<TableLayout, "wrap" | "rowNumbers">,
  stickyCount: number,
): TableCellModel[] {
  return columns.map((column, index) => ({
    id: column.id,
    kind: column.isTitle ? "title" : column.isCover ? "cover" : "property",
    property: column.property,
    display: column.display ?? (column.property ? parseDisplayConfig(column.property.displayConfig) : {}),
    wrap: column.wrap ? column.wrap === "wrap" : layout.wrap,
    align: column.align ?? "left",
    left: index < stickyCount ? stickyLeft(index, layout.rowNumbers) : null,
  }));
}

/**
 * One item as a table row: a whole-row link to the item (the same `g-card-link` the cards
 * use, so the popup's ‹ › pager walks rows exactly as it walks cards) under one cell per
 * column. Cells ignore the pointer except for links and buttons inside them. Without an
 * `href` it is a still preview, as in the column editor.
 */
export function GalleryTableRow({
  page,
  title,
  icon,
  href,
  cells,
  cover,
  thumb,
  rowNumber,
  numberSticky,
  galleryId,
  viewId,
  context,
}: {
  page: PageObjectResponse;
  title: string;
  icon: string | null;
  href: string | null;
  cells: TableCellModel[];
  /** Null when this table shows no pictures. */
  cover: CardCoverModel | null;
  thumb: TableThumb | null;
  /** The running number, when the table shows one. */
  rowNumber: number | null;
  numberSticky: boolean;
  galleryId: string;
  viewId: string;
  context: RenderContext;
}) {
  const picture =
    cover && thumb ? (
      <span
        className={`g-thumb${thumb.round ? " rounded-full" : ""}`}
        style={{ width: thumb.width, height: thumb.height }}
      >
        <CardCover
          key={cover.key}
          ratio={cover.ratio}
          round={cover.round}
          galleryId={galleryId}
          viewId={viewId}
          pageId={page.id}
          initialX={cover.posX}
          initialY={cover.posY}
          hasSource={cover.hasSource}
          initialPreviewUrl={cover.previewUrl}
          initialImageUrl={cover.imageUrl}
          compact
        />
      </span>
    ) : null;

  return (
    <div role="row" className="g-tr">
      {href && (
        <Link href={href} prefetch={false} scroll={false} aria-label={title} className="g-card-link">
          <CardPendingOverlay />
        </Link>
      )}
      {rowNumber !== null && (
        <div role="cell" className={`g-td g-td-num${numberSticky ? " g-sticky" : ""}`} style={numberSticky ? { left: 0 } : undefined}>
          {rowNumber}
        </div>
      )}
      {cells.map((cell) => {
        const common = {
          role: "cell",
          "data-wrap": cell.wrap ? "true" : "false",
          "data-align": cell.align,
          style: cell.left ? { left: cell.left } : undefined,
        } as const;
        const sticky = cell.left ? " g-sticky" : "";
        if (cell.kind === "title") {
          return (
            <div key={cell.id} {...common} className={`g-td g-td-title${sticky}`}>
              {thumb?.inTitle && picture}
              <RowIcon icon={icon} />
              <span className="g-td-text font-medium text-ink" title={title}>
                {title}
              </span>
            </div>
          );
        }
        if (cell.kind === "cover") {
          return (
            <div key={cell.id} {...common} className={`g-td g-td-cover${sticky}`}>
              {picture}
            </div>
          );
        }
        const value = cell.property ? propertyById(page, cell.property.notionPropertyId) : undefined;
        return (
          <div key={cell.id} {...common} className={`g-td${sticky}`}>
            {value && <PropertyValue value={value} displayConfig={cell.display} context={context} />}
          </div>
        );
      })}
    </div>
  );
}

function RowIcon({ icon }: { icon: string | null }) {
  if (!icon) return null;
  if (!/^https?:\/\//.test(icon)) return <span className="shrink-0 leading-none">{icon}</span>;
  return (
    <span
      aria-hidden
      className="size-4 shrink-0 rounded bg-contain bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${JSON.stringify(icon)})` }}
    />
  );
}
