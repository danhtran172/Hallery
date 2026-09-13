"use client";

import { useEffect, useRef, useState } from "react";
import {
  CARD_RATIOS,
  MAX_ROWS,
  canSwapGridTrack,
  mergeBoxes,
  mergedBoxIds,
  spanOf,
  type CardRatio,
  type FrameAlign,
  type Grid,
} from "@/lib/card-layout";

/**
 * Panel 5 in layout mode: how many boxes each frame is divided into, and how the cover
 * and content share their row. Only the controls a given arrangement actually has appear
 * — a card with the cover on top has no ratio to set.
 */
export function LayoutPanel({
  regions,
  regionLabel,
  rowCap,
  ratio,
  showRatio,
  onResize,
  onAlign,
  onRatio,
  onMergeSelection,
  onUnmergeSelection,
  onSwapTrack,
}: {
  regions: { id: string; grid: Grid }[];
  regionLabel: (id: string) => string;
  rowCap: (id: string) => number;
  ratio: CardRatio;
  showRatio: boolean;
  onResize: (regionId: string, cols: 1 | 2, rows: number) => void;
  onAlign: (regionId: string, align: FrameAlign) => void;
  onRatio: (ratio: CardRatio) => void;
  onMergeSelection: (regionId: string, boxIds: string[]) => void;
  onUnmergeSelection: (regionId: string, boxIds: string[]) => void;
  onSwapTrack: (regionId: string, axis: "row" | "column", from: number, to: number) => void;
}) {
  return (
    <aside className="flex h-full w-full flex-col gap-5 overflow-y-auto rounded-lg border border-stone-200 bg-white p-4">
      <h2 className="text-[11px] font-medium uppercase tracking-wide text-stone-500">Bố cục khung</h2>

      {regions.length === 0 && (
        <p className="text-xs text-stone-400">Bố cục này chỉ có ảnh, không có khung nội dung nào.</p>
      )}

      {regions.map(({ id, grid }) => (
        <section key={id}>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone-400">
            {regionLabel(id)}
          </p>
          <GridChooser grid={grid} maxRows={rowCap(id)} onChange={(cols, rows) => onResize(id, cols, rows)} />
          <AlignChooser value={grid.align ?? "start"} onChange={(align) => onAlign(id, align)} />
          <StructureEditor
            regionId={id}
            grid={grid}
            onMerge={onMergeSelection}
            onUnmerge={onUnmergeSelection}
            onSwapTrack={onSwapTrack}
          />
        </section>
      ))}

      {showRatio && (
        <section>
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone-400">Tỉ lệ ảnh / khung</p>
          <div className="flex flex-col gap-1">
            {CARD_RATIOS.map((option) => {
              const selected = option[0] === ratio[0];
              return (
                <button
                  key={option.join("-")}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => onRatio(option)}
                  className={`flex items-center gap-2 rounded-md border px-2 py-1.5 ${
                    selected ? "border-emerald-700 bg-emerald-50" : "border-stone-300 hover:border-stone-500"
                  }`}
                >
                  <span aria-hidden className="flex h-4 w-12 shrink-0 gap-0.5 rounded-sm bg-stone-200/70 p-0.5">
                    <span
                      className={`rounded-[1px] ${selected ? "bg-emerald-400/80" : "bg-stone-400/70"}`}
                      style={{ width: `${option[0]}%` }}
                    />
                    <span
                      className={`flex-1 rounded-[1px] border ${
                        selected ? "border-emerald-400 bg-emerald-100" : "border-stone-300 bg-stone-100"
                      }`}
                    />
                  </span>
                  <span className="font-mono text-[11px] text-stone-700">
                    {option[0]}:{option[1]}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </aside>
  );
}

const ALIGN_OPTIONS: { value: FrameAlign; label: string }[] = [
  { value: "start", label: "Trên" },
  { value: "center", label: "Giữa" },
  { value: "end", label: "Dưới" },
];

/** Where the boxes sit when the frame is taller than they are. */
function AlignChooser({ value, onChange }: { value: FrameAlign; onChange: (value: FrameAlign) => void }) {
  return (
    <div className="mt-2">
      <p className="mb-1 text-[10px] text-stone-400">Căn theo chiều dọc</p>
      <div className="flex gap-1">
        {ALIGN_OPTIONS.map((option) => {
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-md border px-1 py-1 text-[10px] ${
                selected ? "border-emerald-700 bg-emerald-50 text-emerald-800" : "border-stone-300 text-stone-600 hover:border-stone-500"
              }`}
            >
              <span
                aria-hidden
                className="flex h-4 w-4 rounded-sm bg-stone-200/70 p-0.5"
                style={{ alignItems: option.value === "start" ? "flex-start" : option.value === "end" ? "flex-end" : "center" }}
              >
                <span className={`h-1 w-full rounded-[1px] ${selected ? "bg-emerald-400" : "bg-stone-400"}`} />
              </span>
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** A compact 2×3 matrix: each cell represents the grid bounded at that point. */
function GridChooser({
  grid,
  maxRows,
  onChange,
}: {
  grid: Grid;
  maxRows: number;
  onChange: (cols: 1 | 2, rows: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = [
    { cols: 1 as const, rows: 1 }, { cols: 2 as const, rows: 1 },
    { cols: 1 as const, rows: 2 }, { cols: 2 as const, rows: 2 },
    { cols: 1 as const, rows: 3 }, { cols: 2 as const, rows: 3 },
  ];

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center justify-between rounded-md border border-stone-300 px-2 py-1.5 text-left text-xs text-stone-700 hover:border-stone-500"
      >
        <span className="flex items-center gap-2">
          <GridPreview cols={grid.cols} rows={grid.rows} />
          <span>
            {grid.cols} cột × {grid.rows} hàng
          </span>
        </span>
        <span aria-hidden className="text-stone-400">⌄</span>
      </button>

      {open && (
        <div className="absolute left-0 top-full z-40 mt-1.5 w-40 rounded-md border border-stone-200 bg-white p-2 shadow-lg">
          <p className="mb-2 text-[10px] font-medium uppercase tracking-wide text-stone-400">Chọn khung nội dung</p>
          <div className="grid w-24 grid-cols-2 gap-1">
            {options.map((option, index) => {
              const selected = grid.cols === option.cols && grid.rows === option.rows;
              const allowed = option.rows <= Math.min(MAX_ROWS, maxRows);
              const row = Math.floor(index / 2) + 1;
              const col = (index % 2) + 1;
              const included = allowed && row <= grid.rows && col <= grid.cols;
              return (
                <button
                  key={`${option.cols}-${option.rows}`}
                  type="button"
                  aria-label={`${option.cols} cột, ${option.rows} hàng`}
                  aria-pressed={selected}
                  disabled={!allowed}
                  onClick={() => {
                    onChange(option.cols, option.rows);
                    setOpen(false);
                  }}
                  className={`aspect-square rounded-sm border transition-colors disabled:cursor-not-allowed disabled:opacity-25 ${
                    selected
                      ? "border-emerald-800 bg-emerald-600"
                      : included
                        ? "border-emerald-500 bg-emerald-400"
                        : "border-stone-300 bg-stone-100 hover:border-stone-500"
                  }`}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

/** A quiet thumbnail in the trigger, so the size control reads before it opens. */
function GridPreview({ cols, rows }: { cols: 1 | 2; rows: number }) {
  return (
    <span aria-hidden className="grid h-5 w-5 grid-cols-2 gap-px rounded-sm bg-stone-200 p-px">
      {Array.from({ length: 6 }, (_, index) => {
        const row = Math.floor(index / 2) + 1;
        const col = (index % 2) + 1;
        return <span key={index} className={`rounded-[1px] ${row <= rows && col <= cols ? "bg-emerald-500" : "bg-white"}`} />;
      })}
    </span>
  );
}

/** The structural controls live in the property panel; the centre canvas stays a preview. */
function StructureEditor({
  regionId,
  grid,
  onMerge,
  onUnmerge,
  onSwapTrack,
}: {
  regionId: string;
  grid: Grid;
  onMerge: (regionId: string, boxIds: string[]) => void;
  onUnmerge: (regionId: string, boxIds: string[]) => void;
  onSwapTrack: (regionId: string, axis: "row" | "column", from: number, to: number) => void;
}) {
  const [selected, setSelected] = useState<string[]>([]);
  const [dragTrack, setDragTrack] = useState<{ axis: "row" | "column"; index: number } | null>(null);
  const anchor = useRef<number | null>(null);
  const selecting = useRef(false);
  const selectedSet = new Set(selected);
  const selectedHasMerge = selected.some((id) => mergedBoxIds(grid, id).length > 1);
  const canMergeSelection = selected.length >= 2 && mergeBoxes(grid, selected) !== grid;
  const canMoveRows = canSwapGridTrack(grid, "row");
  const canMoveColumns = canSwapGridTrack(grid, "column");

  useEffect(() => {
    const stopSelecting = () => {
      selecting.current = false;
    };
    window.addEventListener("mouseup", stopSelecting);
    return () => window.removeEventListener("mouseup", stopSelecting);
  }, []);

  const selectRectangle = (to: number) => {
    if (anchor.current === null) return;
    const startRow = Math.floor(anchor.current / grid.cols);
    const startCol = anchor.current % grid.cols;
    const endRow = Math.floor(to / grid.cols);
    const endCol = to % grid.cols;
    const ids: string[] = [];
    for (let row = Math.min(startRow, endRow); row <= Math.max(startRow, endRow); row += 1) {
      for (let col = Math.min(startCol, endCol); col <= Math.max(startCol, endCol); col += 1) {
        ids.push(grid.boxes[row * grid.cols + col].id);
      }
    }
    setSelected(ids);
  };

  const beginSelection = (index: number, event: React.MouseEvent) => {
    event.preventDefault();
    const id = grid.boxes[index].id;
    if (event.ctrlKey || event.metaKey) {
      setSelected((current) => (current.includes(id) ? current.filter((item) => item !== id) : [...current, id]));
      anchor.current = null;
      return;
    }
    anchor.current = index;
    selecting.current = true;
    setSelected([id]);
  };

  const track = (axis: "row" | "column", index: number, allowed: boolean) => ({
    draggable: allowed,
    onDragStart: () => allowed && setDragTrack({ axis, index }),
    onDragOver: (event: React.DragEvent) => {
      if (allowed) event.preventDefault();
    },
    onDrop: () => {
      if (dragTrack?.axis === axis && allowed) onSwapTrack(regionId, axis, dragTrack.index, index);
      setDragTrack(null);
    },
  });

  return (
    <div className="mt-3 border-t border-stone-200 pt-3">
      <p className="mb-1 text-[10px] text-stone-400">Gộp ô và đổi hàng/cột</p>
      <div className="mb-1 ml-5 grid gap-1" style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}>
        {Array.from({ length: grid.cols }, (_, index) => (
          <button
            key={index}
            type="button"
            aria-label="Kéo đổi cột"
            title={canMoveColumns ? "Kéo để đổi cột" : "Tách merge ngang để đổi cột"}
            {...track("column", index, canMoveColumns)}
            disabled={!canMoveColumns}
            className="h-4 cursor-ew-resize text-[10px] text-stone-400 disabled:cursor-not-allowed disabled:opacity-30"
          >
            ↔
          </button>
        ))}
      </div>
      <div className="flex gap-1">
        <div className="flex w-4 flex-col gap-1">
          {Array.from({ length: grid.rows }, (_, index) => (
            <button
              key={index}
              type="button"
              aria-label="Kéo đổi hàng"
              title={canMoveRows ? "Kéo để đổi hàng" : "Tách merge dọc để đổi hàng"}
              {...track("row", index, canMoveRows)}
              disabled={!canMoveRows}
              className="min-h-10 flex-1 cursor-ns-resize text-[10px] text-stone-400 disabled:cursor-not-allowed disabled:opacity-30"
            >
              ↕
            </button>
          ))}
        </div>
        <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}>
          {grid.boxes.map((box, index) => {
            // A folded cell is represented by its root's span, not a second visual button.
            if (box.mergedInto) return null;
            const { colSpan, rowSpan } = spanOf(grid, index);
            return (
              <button
                key={box.id}
                type="button"
                onMouseDown={(event) => beginSelection(index, event)}
                onMouseEnter={() => selecting.current && selectRectangle(index)}
                style={{
                  gridColumn: colSpan > 1 ? `span ${colSpan}` : undefined,
                  gridRow: rowSpan > 1 ? `span ${rowSpan}` : undefined,
                }}
                className={`min-h-10 rounded border text-[10px] transition-colors ${
                  selectedSet.has(box.id)
                    ? "border-emerald-600 bg-emerald-100 ring-1 ring-emerald-400"
                    : "border-stone-300 bg-white text-stone-500 hover:border-stone-500"
                }`}
              >
                {box.fields.length ? `${box.fields.length} prop` : "Ô trống"}
              </button>
            );
          })}
        </div>
      </div>
      {selected.length > 0 && (
        <div className="mt-2 rounded-md border border-stone-200 bg-stone-50 p-2 text-xs">
          {selectedHasMerge ? (
            <button
              type="button"
              onClick={() => {
                onUnmerge(regionId, selected);
                setSelected([]);
              }}
              className="rounded bg-stone-800 px-2 py-1 text-white hover:bg-stone-700"
            >
              Tách
            </button>
          ) : (
            <div className="flex flex-col items-start gap-1.5">
              <button
                type="button"
                disabled={!canMergeSelection}
                onClick={() => {
                  const rootId = [...selected]
                    .sort((left, right) => grid.boxes.findIndex((box) => box.id === left) - grid.boxes.findIndex((box) => box.id === right))[0];
                  onMerge(regionId, selected);
                  // Keep the merged root selected so its only reversal action, Tách, stays below the grid.
                  setSelected(rootId ? [rootId] : []);
                }}
                className="rounded bg-emerald-700 px-2 py-1 text-white hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-stone-300"
              >
                Gộp {selected.length} ô
              </button>
              {!canMergeSelection && (
                <span className="text-stone-500">Chọn 2–3 ô trống liền nhau để gộp.</span>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
