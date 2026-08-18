"use client";

import { CARD_RATIOS, MAX_ROWS, type CardRatio, type FrameAlign, type Grid } from "@/lib/card-layout";
import { GridGlyph } from "./glyphs";

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
}: {
  regions: { id: string; grid: Grid }[];
  regionLabel: (id: string) => string;
  rowCap: (id: string) => number;
  ratio: CardRatio;
  showRatio: boolean;
  onResize: (regionId: string, cols: 1 | 2, rows: number) => void;
  onAlign: (regionId: string, align: FrameAlign) => void;
  onRatio: (ratio: CardRatio) => void;
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

/** One-column choices on the left, two-column choices on the right. */
function GridChooser({
  grid,
  maxRows,
  onChange,
}: {
  grid: Grid;
  maxRows: number;
  onChange: (cols: 1 | 2, rows: number) => void;
}) {
  const rows = Array.from({ length: Math.min(MAX_ROWS, maxRows) }, (_, index) => index + 1);

  return (
    <div className="grid grid-cols-2 gap-2">
      {([1, 2] as const).map((cols) => (
        <div key={cols} className="flex flex-col gap-1.5">
          <span className="text-center text-[10px] text-stone-400">{cols} cột</span>
          {rows.map((rowCount) => {
            const selected = grid.cols === cols && grid.rows === rowCount;
            return (
              <button
                key={rowCount}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange(cols, rowCount)}
                className={`flex items-center justify-center gap-1.5 rounded-md border px-1 py-1.5 ${
                  selected ? "border-emerald-700 bg-emerald-50" : "border-stone-300 hover:border-stone-500"
                }`}
              >
                <GridGlyph cols={cols} rows={rowCount} selected={selected} />
                <span className="font-mono text-[10px] text-stone-600">
                  {cols}×{rowCount}
                </span>
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
