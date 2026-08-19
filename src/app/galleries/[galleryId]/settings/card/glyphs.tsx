import { ARRANGEMENTS, type ArrangementId } from "@/lib/card-layout";

/**
 * Diagrams for the layout pickers, in the Card Detail builder's visual language: a soft
 * frame, cells that fill it, emerald when chosen. The cover reads solid where a content
 * box reads outlined, so the two stay apart at this size.
 */

const FRAME = "shrink-0 rounded-sm bg-stone-200/70 p-1";

const cover = (selected: boolean) => `rounded-[2px] ${selected ? "bg-emerald-400/80" : "bg-stone-400/70"}`;
const cell = (selected: boolean) =>
  `rounded-[2px] border ${selected ? "border-emerald-400 bg-emerald-100" : "border-stone-300 bg-stone-100"}`;

export function ArrangementGlyph({ id, selected }: { id: ArrangementId; selected: boolean }) {
  const spec = ARRANGEMENTS[id];
  const box = `flex h-10 w-14 gap-1 ${FRAME}`;

  if (id === "cover-only") {
    return (
      <span aria-hidden className={box}>
        <span className={`${cover(selected)} flex-1`} />
      </span>
    );
  }

  if (spec.cover === "none") {
    return (
      <span aria-hidden className={box}>
        <span className={`${cell(selected)} flex-1`} />
      </span>
    );
  }

  if (spec.cover === "left" || spec.cover === "right") {
    const image = <span className={`${cover(selected)} w-1/3`} />;
    const text = <span className={`${cell(selected)} flex-1`} />;
    const row = (
      <span className="flex flex-1 gap-1">
        {spec.cover === "left" ? image : text}
        {spec.cover === "left" ? text : image}
      </span>
    );
    return spec.regions.length === 2 ? (
      <span aria-hidden className={`${box} flex-col`}>
        {row}
        <span className={`${cell(selected)} h-2.5`} />
      </span>
    ) : (
      <span aria-hidden className={box}>
        {row}
      </span>
    );
  }

  return (
    <span aria-hidden className={`${box} flex-col`}>
      <span className={`${cover(selected)} h-4`} />
      <span className={`${cell(selected)} flex-1`} />
    </span>
  );
}

/** A cols × rows grid, used for both layer-1 frames and layer-2 subdivision. */
export function GridGlyph({ cols, rows, selected }: { cols: number; rows: number; selected: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid h-5 w-6 gap-[2px] ${FRAME}`}
      style={{
        gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))`,
        gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
      }}
    >
      {Array.from({ length: cols * rows }, (_, index) => (
        <span key={index} className={cell(selected)} />
      ))}
    </span>
  );
}

/** Cover frame at its true proportion. */
export function RatioGlyph({
  ratio,
  selected,
  round,
}: {
  ratio: string;
  selected: boolean;
  /** Draw the frame's fill as a circle, for the round member of the symmetric family. */
  round?: boolean;
}) {
  return (
    <span aria-hidden className={`flex h-10 w-14 items-center justify-center ${FRAME}`}>
      <span
        className={`max-h-full max-w-full ${cover(selected)} ${round ? "!rounded-full" : ""}`}
        style={{ aspectRatio: ratio.replace(":", " / "), height: "100%" }}
      />
    </span>
  );
}
