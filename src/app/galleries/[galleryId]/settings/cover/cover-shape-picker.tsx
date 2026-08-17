"use client";

import { useState } from "react";
import { COVER_RATIOS, type CoverAspect } from "@/lib/notion-cover";

const ASPECT_LABELS: { value: CoverAspect; label: string }[] = [
  { value: "landscape", label: "Ngang" },
  { value: "portrait", label: "Dọc" },
  { value: "square", label: "Vuông" },
  { value: "none", label: "Không hiện" },
];

/** Two steps: pick the orientation, then a ratio within it, with a live preview alongside. */
export function CoverShapePicker({
  initialAspect,
  initialRatio,
  sampleUrl,
}: {
  initialAspect: CoverAspect;
  initialRatio: string;
  sampleUrl: string | null;
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
    <div className="flex flex-col gap-6 rounded-lg border border-stone-200 p-5 sm:flex-row sm:items-stretch">
      <input type="hidden" name="coverAspect" value={aspect} />
      <input type="hidden" name="coverRatio" value={activeRatio ?? ""} />

      <div className="min-w-0 flex-1">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">Định dạng</p>
        <div className="mb-5 flex flex-wrap gap-2">
          {ASPECT_LABELS.map((opt) => (
            <Choice key={opt.value} active={aspect === opt.value} onClick={() => pickAspect(opt.value)}>
              {opt.label}
            </Choice>
          ))}
        </div>

        {aspect !== "none" && (
          <>
            <p className="mb-2 text-xs font-medium uppercase tracking-wide text-stone-400">Tỉ lệ</p>
            <div className="flex flex-wrap gap-2">
              {ratios.map((r) => (
                <Choice key={r} active={activeRatio === r} mono onClick={() => setRatio(r)}>
                  {r}
                </Choice>
              ))}
            </div>
          </>
        )}
      </div>

      <Preview ratio={activeRatio} sampleUrl={sampleUrl} hidden={aspect === "none"} />
    </div>
  );
}

function Preview({
  ratio,
  sampleUrl,
  hidden,
}: {
  ratio: string | undefined;
  sampleUrl: string | null;
  hidden: boolean;
}) {
  return (
    <div className="flex w-full shrink-0 flex-col items-center justify-center gap-2 rounded-md bg-stone-50 p-4 sm:w-56">
      {hidden ? (
        <p className="text-center text-xs text-stone-400">Card sẽ không có ảnh bìa.</p>
      ) : (
        <>
          {/* Square well: wide ratios span its width, tall ones its height, so no ratio overflows. */}
          <div className="flex aspect-square w-full max-w-40 items-center justify-center">
            <div
              className="rounded border border-stone-300 bg-stone-200 bg-cover bg-center"
              style={previewSize(ratio)}
            />
          </div>
          <span className="text-[11px] text-stone-400">
            Xem trước {ratio && <span className="font-mono">{ratio}</span>}
          </span>
        </>
      )}
    </div>
  );

  function previewSize(r: string | undefined): React.CSSProperties {
    const [w, h] = (r ?? "1:1").split(":").map(Number);
    const style: React.CSSProperties = {
      aspectRatio: `${w} / ${h}`,
      ...(w >= h ? { width: "100%" } : { height: "100%" }),
    };
    if (sampleUrl) style.backgroundImage = `url(${JSON.stringify(sampleUrl)})`;
    return style;
  }
}

function Choice({
  active,
  mono,
  onClick,
  children,
}: {
  active: boolean;
  mono?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-md border px-3 py-1.5 text-sm ${mono ? "font-mono" : ""} ${
        active
          ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800"
          : "border-stone-300 text-stone-600 hover:border-stone-400"
      }`}
    >
      {children}
    </button>
  );
}
