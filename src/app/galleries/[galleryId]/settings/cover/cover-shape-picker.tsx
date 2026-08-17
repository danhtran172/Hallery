"use client";

import { useState } from "react";
import { COVER_RATIOS, type CoverAspect } from "@/lib/notion-cover";

const ASPECT_LABELS: { value: CoverAspect; label: string }[] = [
  { value: "landscape", label: "Ngang" },
  { value: "portrait", label: "Dọc" },
  { value: "square", label: "Vuông" },
  { value: "none", label: "Không hiện" },
];

/** Two steps: pick the orientation, then a ratio within it, with a live preview of the frame. */
export function CoverShapePicker({
  initialAspect,
  initialRatio,
}: {
  initialAspect: CoverAspect;
  initialRatio: string;
}) {
  const [aspect, setAspect] = useState<CoverAspect>(initialAspect);
  const [ratio, setRatio] = useState(initialRatio);

  const ratios = aspect === "none" ? [] : COVER_RATIOS[aspect];
  const activeRatio = ratios.includes(ratio) ? ratio : ratios[0];

  function pickAspect(next: CoverAspect) {
    setAspect(next);
    if (next !== "none") {
      const options = COVER_RATIOS[next];
      if (!options.includes(ratio)) setRatio(options[0]);
    }
  }

  return (
    <div className="rounded-lg border border-stone-200 p-5">
      <input type="hidden" name="coverAspect" value={aspect} />
      <input type="hidden" name="coverRatio" value={activeRatio ?? ""} />

      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">Định dạng</p>
      <div className="mb-5 flex flex-wrap gap-2">
        {ASPECT_LABELS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => pickAspect(opt.value)}
            aria-pressed={aspect === opt.value}
            className={`rounded-md border px-3 py-1.5 text-sm ${
              aspect === opt.value
                ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800"
                : "border-stone-300 text-stone-600 hover:border-stone-400"
            }`}
          >
            {opt.label}
          </button>
        ))}
      </div>

      {aspect !== "none" && (
        <>
          <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">Tỉ lệ</p>
          <div className="flex flex-wrap items-start gap-4">
            <div className="flex flex-wrap gap-2">
              {ratios.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setRatio(r)}
                  aria-pressed={activeRatio === r}
                  disabled={ratios.length === 1}
                  className={`rounded-md border px-3 py-1.5 font-mono text-sm disabled:opacity-60 ${
                    activeRatio === r
                      ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800"
                      : "border-stone-300 text-stone-600 hover:border-stone-400"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>

            <div className="flex flex-col items-center gap-1">
              <div
                className="w-24 rounded border border-dashed border-stone-300 bg-stone-100"
                style={{ aspectRatio: (activeRatio ?? "1:1").replace(":", " / ") }}
              />
              <span className="text-[11px] text-stone-400">Xem trước</span>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
