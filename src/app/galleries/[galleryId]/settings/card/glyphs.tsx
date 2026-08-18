import { ARRANGEMENTS, type ArrangementId, type CellDisplay } from "@/lib/card-layout";

/**
 * Small diagrams for the layout pickers, following the Card Detail builder's visual
 * language: a soft frame, cells that fill it, and an emerald wash when chosen. The cover
 * reads darker than a text box so the two are distinguishable at this size.
 */

const frame = "shrink-0 rounded-sm bg-stone-200/70 p-1";

function tone(selected: boolean, kind: "cover" | "cell") {
  if (kind === "cover") {
    return selected ? "bg-emerald-400/80" : "bg-stone-400/70";
  }
  return selected ? "border-emerald-400 bg-emerald-100" : "border-stone-300 bg-stone-100";
}

function Cover({ selected, className = "" }: { selected: boolean; className?: string }) {
  return <span className={`rounded-[2px] ${tone(selected, "cover")} ${className}`} />;
}

function Cell({ selected, className = "" }: { selected: boolean; className?: string }) {
  return <span className={`rounded-[2px] border ${tone(selected, "cell")} ${className}`} />;
}

export function ArrangementGlyph({ id, selected }: { id: ArrangementId; selected: boolean }) {
  const spec = ARRANGEMENTS[id];
  const box = `flex h-12 w-full gap-1 ${frame}`;

  if (spec.cover === "none") {
    return (
      <span aria-hidden className={box}>
        <Cell selected={selected} className="flex-1" />
      </span>
    );
  }

  if (spec.cover === "full") {
    return (
      <span aria-hidden className={`${box} relative`}>
        <Cover selected={selected} className="flex-1" />
        <span className={`absolute inset-x-1 bottom-1 h-2 rounded-[2px] border ${tone(selected, "cell")}`} />
      </span>
    );
  }

  if (spec.cover === "left" || spec.cover === "right") {
    const cover = <Cover selected={selected} className="w-1/3" />;
    const side = <Cell selected={selected} className="flex-1" />;
    const row = (
      <span className="flex flex-1 gap-1">
        {spec.cover === "left" ? cover : side}
        {spec.cover === "left" ? side : cover}
      </span>
    );
    return spec.cells.length === 2 ? (
      <span aria-hidden className={`${box} flex-col`}>
        {row}
        <Cell selected={selected} className="h-3" />
      </span>
    ) : (
      <span aria-hidden className={box}>
        {row}
      </span>
    );
  }

  // Cover on top, with one or two boxes underneath.
  return (
    <span aria-hidden className={`${box} flex-col`}>
      <Cover selected={selected} className="h-5" />
      {spec.cells.length === 2 ? (
        <span className="flex flex-1 gap-1">
          <Cell selected={selected} className="flex-1" />
          <Cell selected={selected} className="flex-1" />
        </span>
      ) : (
        <Cell selected={selected} className="flex-1" />
      )}
    </span>
  );
}

/** Layer 2: how the properties inside one box are laid out. */
export function CellDisplayGlyph({ display, selected }: { display: CellDisplay; selected: boolean }) {
  const bar = (className: string) => (
    <span className={`rounded-[1px] ${selected ? "bg-emerald-400" : "bg-stone-400"} ${className}`} />
  );
  const box = `flex h-6 w-10 gap-[3px] ${frame}`;

  if (display === "rows") {
    return (
      <span aria-hidden className={`${box} flex-col justify-center`}>
        {[0, 1].map((row) => (
          <span key={row} className="flex gap-[3px]">
            {bar("h-1 w-3")}
            {bar("h-1 flex-1 opacity-50")}
          </span>
        ))}
      </span>
    );
  }

  if (display === "stacked") {
    return (
      <span aria-hidden className={`${box} flex-col justify-center`}>
        {bar("h-1 w-3")}
        {bar("h-1 w-full opacity-50")}
        {bar("h-1 w-3")}
      </span>
    );
  }

  if (display === "two-col") {
    return (
      <span aria-hidden className={box}>
        {[0, 1].map((col) => (
          <span key={col} className="flex flex-1 flex-col justify-center gap-[3px]">
            {bar("h-1 w-full")}
            {bar("h-1 w-full opacity-50")}
          </span>
        ))}
      </span>
    );
  }

  return (
    <span aria-hidden className={`${box} items-center`}>
      {bar("h-1.5 w-2")}
      {bar("h-1.5 w-3 opacity-70")}
      {bar("h-1.5 flex-1 opacity-50")}
    </span>
  );
}

/** Cover frame ratio, drawn at its true proportion. */
export function RatioGlyph({ ratio, selected }: { ratio: string; selected: boolean }) {
  return (
    <span aria-hidden className={`flex h-8 w-12 items-center justify-center ${frame}`}>
      <span
        className={`max-h-full max-w-full rounded-[2px] ${tone(selected, "cover")}`}
        style={{ aspectRatio: ratio.replace(":", " / "), height: "100%" }}
      />
    </span>
  );
}
