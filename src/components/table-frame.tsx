"use client";

import { useEffect, useRef, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { saveGalleryViewQuery, saveTableColumnWidth } from "@/app/galleries/[galleryId]/view-actions";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";
import type { GalleryQuery, SortKey } from "@/lib/gallery-query";
import {
  MAX_COLUMN_WIDTH,
  MIN_COLUMN_WIDTH,
  ROW_NUMBER_WIDTH,
  tableTracks,
  widthVariables,
  type ColumnAlign,
  type TableDensity,
} from "@/lib/table-layout";

export type TableHeaderColumn = {
  id: string;
  label: string;
  width: number;
  /** The Notion property id a click sorts by; null when the column cannot be sorted. */
  sortId: string | null;
  /** False for the picture column, whose width follows the picture. */
  resizable: boolean;
  align: ColumnAlign;
  /** CSS `left` while the column is fixed; null when it scrolls. */
  left: string | null;
};

/** The table-wide look, read by CSS off data attributes. */
export type TableLook = { density: TableDensity; stripes: boolean; rowNumbers: boolean; numberSticky: boolean };

type ViewQuery = Pick<GalleryQuery, "filters" | "sorts" | "groupBy">;

const clamp = (width: number) => Math.round(Math.min(MAX_COLUMN_WIDTH, Math.max(MIN_COLUMN_WIDTH, width)));

/**
 * The next sort after a header click: a column not leading the sort moves to the front
 * ascending, then flips to descending, then leaves the sort. Other levels stay where they were,
 * so a careful multi-level sort from the toolbar is never wiped by one click.
 */
function nextSorts(sorts: SortKey[], propertyId: string): SortKey[] {
  const rest = sorts.filter((sort) => sort.propertyId !== propertyId);
  const lead = sorts[0];
  if (lead?.propertyId !== propertyId) return [{ propertyId, direction: "asc" }, ...rest];
  if (lead.direction === "asc") return [{ propertyId, direction: "desc" }, ...rest];
  return rest;
}

/**
 * A table view's frame: the header row and the column widths every row reads. Rows arrive
 * as server-rendered children and take their tracks from `--table-cols`, so dragging a
 * column edge resizes the whole column live without re-rendering a single row.
 */
export function TableFrame({
  galleryId,
  viewId,
  columns,
  query,
  look,
  children,
}: {
  galleryId: string;
  viewId: string;
  columns: TableHeaderColumn[];
  query: ViewQuery;
  look: TableLook;
  children: ReactNode;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const incoming = JSON.stringify(columns.map((column) => [column.id, column.width]));
  const [lastIncoming, setLastIncoming] = useState(incoming);
  const [widths, setWidths] = useState(() => Object.fromEntries(columns.map((column) => [column.id, column.width])));
  if (lastIncoming !== incoming) {
    setLastIncoming(incoming);
    setWidths(Object.fromEntries(columns.map((column) => [column.id, column.width])));
  }
  // What the pointer and key handlers read; they run after commit, so an effect keeps it current.
  const widthsRef = useRef(widths);
  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const current = columns.map((column) => widths[column.id] ?? column.width);
  const total = current.reduce((sum, width) => sum + width, look.rowNumbers ? ROW_NUMBER_WIDTH : 0);

  function saveWidth(columnId: string) {
    const width = widthsRef.current[columnId];
    startTransition(async () => {
      try {
        const result = await saveTableColumnWidth(galleryId, viewId, columnId, width);
        if (result.error) toast(result.error, "error");
        // Grouped views draw one table per group; the refresh lines the others up too.
        else router.refresh();
      } catch {
        toast("Không lưu được độ rộng cột. Thử lại sau giây lát.", "error");
      }
    });
  }

  function startResize(event: React.PointerEvent<HTMLSpanElement>, columnId: string) {
    event.preventDefault();
    event.stopPropagation();
    const handle = event.currentTarget;
    const startX = event.clientX;
    const startWidth = widthsRef.current[columnId];
    handle.setPointerCapture(event.pointerId);
    const move = (moveEvent: PointerEvent) =>
      setWidths((current) => ({ ...current, [columnId]: clamp(startWidth + moveEvent.clientX - startX) }));
    const end = () => {
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", end);
      handle.removeEventListener("pointercancel", end);
      if (widthsRef.current[columnId] !== startWidth) saveWidth(columnId);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", end);
    handle.addEventListener("pointercancel", end);
  }

  function nudgeWidth(event: React.KeyboardEvent<HTMLSpanElement>, columnId: string) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.shiftKey ? 64 : 16;
    const next = clamp(widthsRef.current[columnId] + (event.key === "ArrowRight" ? step : -step));
    widthsRef.current = { ...widthsRef.current, [columnId]: next };
    setWidths(widthsRef.current);
    saveWidth(columnId);
  }

  function sortBy(propertyId: string) {
    startTransition(async () => {
      try {
        const result = await saveGalleryViewQuery(galleryId, viewId, {
          ...query,
          sorts: nextSorts(query.sorts, propertyId),
        });
        if (result.error) toast(result.error, "error");
        else router.refresh();
      } catch {
        toast("Không lưu được thứ tự sắp xếp. Thử lại sau giây lát.", "error");
      }
    });
  }

  return (
    <div className={`g-table-scroll ${pending ? "opacity-80" : ""}`}>
      <div
        role="table"
        className="g-table"
        data-density={look.density}
        data-stripes={look.stripes ? "true" : "false"}
        style={
          {
            ...widthVariables(current),
            "--table-cols": tableTracks(columns.length, look.rowNumbers),
            width: total,
          } as React.CSSProperties
        }
      >
        <div role="row" className="g-thead">
          {look.rowNumbers && (
            <div
              role="columnheader"
              className={`g-th justify-end${look.numberSticky ? " g-sticky" : ""}`}
              style={look.numberSticky ? { left: 0 } : undefined}
            >
              #
            </div>
          )}
          {columns.map((column) => {
            const level = column.sortId ? query.sorts.findIndex((sort) => sort.propertyId === column.sortId) : -1;
            const sort = level >= 0 ? query.sorts[level] : null;
            return (
              <div
                key={column.id}
                role="columnheader"
                aria-sort={level === 0 ? (sort?.direction === "asc" ? "ascending" : "descending") : undefined}
                data-align={column.align}
                className={`g-th${column.left ? " g-sticky" : ""}`}
                style={column.left ? { left: column.left } : undefined}
              >
                {column.sortId ? (
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() => sortBy(column.sortId!)}
                    title={
                      level !== 0
                        ? "Sắp xếp tăng dần theo cột này"
                        : sort?.direction === "asc"
                          ? "Đổi sang giảm dần"
                          : "Bỏ sắp xếp theo cột này"
                    }
                    className="flex min-w-0 flex-1 items-center gap-1 text-left hover:text-ink"
                  >
                    <span className="truncate">{column.label}</span>
                    {sort && (
                      <span className={`flex shrink-0 items-center ${level === 0 ? "text-brand-ink" : "text-faint"}`}>
                        <Icon name={sort.direction === "asc" ? "arrow-up" : "arrow-down"} className="size-3.5" />
                        {query.sorts.length > 1 && <span className="text-[10px] tabular-nums">{level + 1}</span>}
                      </span>
                    )}
                  </button>
                ) : (
                  <span className="min-w-0 flex-1 truncate">{column.label}</span>
                )}
                {column.resizable && (
                  <span
                    role="separator"
                    aria-orientation="vertical"
                    aria-label={`Độ rộng cột ${column.label}`}
                    aria-valuemin={MIN_COLUMN_WIDTH}
                    aria-valuemax={MAX_COLUMN_WIDTH}
                    aria-valuenow={widths[column.id]}
                    tabIndex={0}
                    title="Kéo để đổi độ rộng cột"
                    onPointerDown={(event) => startResize(event, column.id)}
                    onKeyDown={(event) => nudgeWidth(event, column.id)}
                    className="g-resize"
                  />
                )}
              </div>
            );
          })}
        </div>
        {children}
      </div>
    </div>
  );
}
