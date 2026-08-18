/**
 * How a gallery card is arranged, in two layers over a cover image.
 *
 *   Layer 1 — where the cover sits, and how the content area is divided into frames.
 *   Layer 2 — how each frame is divided into the boxes that hold properties.
 *
 * Both are grids of at most two columns, because a card is a thumbnail: past two columns
 * the text is narrower than the words in it. Empty boxes can be merged into a neighbour,
 * so a 2×2 that only needs three boxes does not have to look like it lost one.
 *
 * Stored in Gallery.displayConfig. Property references are Notion property IDs, so a
 * rename in Notion cannot break a saved arrangement.
 */

export const CARD_LAYOUT_VERSION = 4;

/** The page title, draggable like any other property but rendered bold. */
export const TITLE_FIELD_ID = "__title__";

export type CardField = { id: string; showLabel: boolean };

/* ── Layer 1 ─────────────────────────────────────────────────────────────── */

export type CoverSlot = "top" | "left" | "right" | "none";
export type CoverOrientation = "landscape" | "portrait" | "square";

export type Arrangement = {
  label: string;
  cover: CoverSlot;
  /** Content frames this arrangement exposes, in visual order. */
  regions: ("main" | "below")[];
  /** True when the cover and a frame share a row, making their ratio meaningful. */
  sideBySide: boolean;
};

export const ARRANGEMENTS = {
  "cover-top": { label: "Ảnh trên, content dưới", cover: "top", regions: ["main"], sideBySide: false },
  "cover-left": { label: "Ảnh trái, content phải", cover: "left", regions: ["main"], sideBySide: true },
  "cover-left-below": {
    label: "Ảnh trái, content phải và dưới",
    cover: "left",
    regions: ["main", "below"],
    sideBySide: true,
  },
  "cover-right": { label: "Ảnh phải, content trái", cover: "right", regions: ["main"], sideBySide: true },
  "cover-only": { label: "Chỉ ảnh", cover: "top", regions: [], sideBySide: false },
  "no-cover": { label: "Không ảnh", cover: "none", regions: ["main"], sideBySide: false },
} as const satisfies Record<string, Arrangement>;

export type ArrangementId = keyof typeof ARRANGEMENTS;

/**
 * Arrangements offered for a cover shape. A landscape cover beside its text leaves a
 * strip too short to hold anything, so only the taller shapes offer the side layouts.
 */
export function arrangementsFor(orientation: CoverOrientation): ArrangementId[] {
  if (orientation === "landscape") return ["cover-top", "cover-only", "no-cover"];
  return ["cover-top", "cover-left", "cover-left-below", "cover-right", "cover-only", "no-cover"];
}

export function isArrangement(value: unknown): value is ArrangementId {
  return typeof value === "string" && value in ARRANGEMENTS;
}

/* ── Grids ───────────────────────────────────────────────────────────────── */

export const MAX_COLS = 2;
export const MAX_ROWS = 3;

export type MergeDirection = "left" | "up";

export type GridBox = {
  id: string;
  fields: CardField[];
  /**
   * This box has been folded into the neighbour to its left or above. Kept in the grid
   * rather than deleted so the merge stays reversible, and so dropping a property in can
   * simply undo it.
   */
  mergedInto?: MergeDirection;
};

/** Where a frame's content sits when the frame is taller than its boxes. */
export type FrameAlign = "start" | "center" | "end";

export type Grid = { cols: 1 | 2; rows: number; boxes: GridBox[]; align?: FrameAlign };

export type CardRatio = [30, 70] | [40, 60] | [50, 50] | [60, 40] | [70, 30];
export const CARD_RATIOS: CardRatio[] = [
  [30, 70],
  [40, 60],
  [50, 50],
  [60, 40],
  [70, 30],
];

/**
 * Card widths are fixed per kind rather than stretching to fill a column, so a gallery of
 * mixed layouts still lines up. The base is whatever one normal card is wide; the rest are
 * multiples of it.
 */
export type CardKind = "ngang" | "extra" | "doc";

export const CARD_WIDTH_FACTOR: Record<CardKind, number> = {
  ngang: 1,
  extra: 1.2,
  doc: 0.6,
};

/**
 * Which kind a layout produces. A cover beside its text always reads wide; a cover above
 * its text is only wide when the cover itself is. Extra width is opt-in and meaningless
 * for a tall card, so it is ignored there.
 */
export function cardKindOf(
  arrangement: ArrangementId,
  orientation: CoverOrientation,
  extended: boolean,
): CardKind {
  const spec = ARRANGEMENTS[arrangement];
  const tall = spec.cover !== "none" && !spec.sideBySide && orientation !== "landscape";
  if (tall) return "doc";
  return extended ? "extra" : "ngang";
}

/** Extra width only applies to the wide kinds. */
export function canExtend(arrangement: ArrangementId, orientation: CoverOrientation): boolean {
  return cardKindOf(arrangement, orientation, false) !== "doc";
}

export type CardLayout = {
  version: typeof CARD_LAYOUT_VERSION;
  arrangement: ArrangementId;
  /** Widen a already-wide card to 120%. Ignored for tall cards. */
  extended: boolean;
  /** Cover vs content split, used when they share a row. */
  ratio: CardRatio;
  /** Burned onto the cover. Capped — a cover buried under text stops being an image. */
  overlay: CardField[];
  regions: Record<string, Grid>;
};

export const MAX_OVERLAY_FIELDS = 3;
export const DEFAULT_CARD_FIELD_COUNT = 4;

/* ── Row budget ──────────────────────────────────────────────────────────── */

/** Nominal card width used to reason about how many rows fit beside a cover. */
const NOMINAL_CARD_WIDTH = 380;
/** A labelled row of text, near enough. */
export const MIN_ROW_HEIGHT = 30;

/**
 * How many rows fit beside the cover before the text runs taller than the image.
 * Only meaningful when the two share a row.
 */
export function maxRowsBesideCover(orientation: CoverOrientation, ratio: CardRatio, ratioLabel: string): number {
  const [w, h] = ratioLabel.split(":").map(Number);
  if (!w || !h) return MAX_ROWS;
  const coverWidth = (NOMINAL_CARD_WIDTH * ratio[0]) / 100;
  const coverHeight = (coverWidth * h) / w;
  return Math.max(1, Math.min(MAX_ROWS, Math.floor(coverHeight / MIN_ROW_HEIGHT)));
}

/* ── Construction ────────────────────────────────────────────────────────── */

let boxCounter = 0;
function makeBox(fields: CardField[] = []): GridBox {
  boxCounter += 1;
  return { id: `b${Date.now().toString(36)}${boxCounter}`, fields };
}

export function makeGrid(cols: 1 | 2, rows: number, carried: CardField[][] = []): Grid {
  const count = cols * rows;
  const boxes: GridBox[] = [];
  for (let index = 0; index < count; index += 1) {
    // Anything past the new box count folds into the last one rather than vanishing.
    const overflow = index === count - 1 ? carried.slice(count).flat() : [];
    boxes.push(makeBox([...(carried[index] ?? []), ...overflow]));
  }
  return { cols, rows, boxes };
}

/** Fields held anywhere in a grid, in visual order. */
export function gridFields(grid: Grid): CardField[] {
  return grid.boxes.flatMap((box) => box.fields);
}

/** Resizes a grid, preserving as much placement as the new shape allows. */
export function resizeGrid(grid: Grid, cols: 1 | 2, rows: number): Grid {
  const resized = makeGrid(cols, rows, grid.boxes.map((box) => box.fields));
  return grid.align ? { ...resized, align: grid.align } : resized;
}

/** Folds an empty box into its left or upper neighbour. Reversible; nothing is deleted. */
export function mergeBox(grid: Grid, boxId: string, direction: MergeDirection): Grid {
  if (!canMerge(grid, boxId, direction)) return grid;
  return {
    ...grid,
    boxes: grid.boxes.map((box) => (box.id === boxId ? { ...box, mergedInto: direction, fields: [] } : box)),
  };
}

export function unmergeBox(grid: Grid, boxId: string): Grid {
  return {
    ...grid,
    boxes: grid.boxes.map((box) => {
      if (box.id !== boxId) return box;
      const rest = { ...box };
      delete rest.mergedInto;
      return rest;
    }),
  };
}

/**
 * Whether an empty box can fold that way. A box only merges into a neighbour that is
 * itself standing on its own, so merges never chain into shapes a grid cannot express.
 */
export function canMerge(grid: Grid, boxId: string, direction: MergeDirection): boolean {
  const index = grid.boxes.findIndex((box) => box.id === boxId);
  if (index === -1) return false;
  const box = grid.boxes[index];
  if (box.mergedInto || box.fields.length > 0) return false;

  if (direction === "left") {
    if (grid.cols === 1 || index % grid.cols === 0) return false;
    return !grid.boxes[index - 1]?.mergedInto;
  }
  const above = grid.boxes[index - grid.cols];
  return Boolean(above) && !above.mergedInto;
}

/**
 * Grid spans, derived from which boxes were folded away. Kept out of storage so a merge
 * is one flag rather than three fields that can disagree.
 */
export function spanOf(grid: Grid, index: number): { colSpan: number; rowSpan: number } {
  const right = grid.boxes[index + 1];
  const colSpan = right && index % grid.cols !== grid.cols - 1 && right.mergedInto === "left" ? 2 : 1;

  let rowSpan = 1;
  for (let below = index + grid.cols; below < grid.boxes.length; below += grid.cols) {
    if (grid.boxes[below]?.mergedInto !== "up") break;
    rowSpan += 1;
  }
  return { colSpan, rowSpan };
}

export type CardEligibleProperty = {
  notionPropertyId: string;
  notionPropertyName: string;
  notionPropertyType: string;
  isMissing: boolean;
};

/** Properties a card may show. The title joins them as a draggable pseudo-property. */
export function cardEligibleProperties<T extends CardEligibleProperty>(properties: T[]): T[] {
  return properties.filter((p) => p.notionPropertyType !== "title" && !p.isMissing);
}

export function createDefaultCardLayout(properties: CardEligibleProperty[]): CardLayout {
  const fields: CardField[] = [
    { id: TITLE_FIELD_ID, showLabel: false },
    ...cardEligibleProperties(properties)
      .slice(0, DEFAULT_CARD_FIELD_COUNT)
      .map((property) => ({ id: property.notionPropertyId, showLabel: true })),
  ];

  return {
    version: CARD_LAYOUT_VERSION,
    arrangement: "cover-top",
    extended: false,
    ratio: [40, 60],
    overlay: [],
    regions: { main: makeGrid(1, 1, [fields]) },
  };
}

/* ── Parsing ─────────────────────────────────────────────────────────────── */

function parseFields(raw: unknown): CardField[] {
  if (!Array.isArray(raw)) return [];
  const fields: CardField[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, showLabel } = entry as { id?: unknown; showLabel?: unknown };
    if (typeof id !== "string" || id === "") continue;
    fields.push({ id, showLabel: showLabel !== false });
  }
  return fields;
}

function parseRatio(raw: unknown): CardRatio {
  if (Array.isArray(raw) && raw.length === 2) {
    const match = CARD_RATIOS.find((ratio) => ratio[0] === raw[0] && ratio[1] === raw[1]);
    if (match) return match;
  }
  return [40, 60];
}

function parseGrid(raw: unknown): Grid | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { cols, rows, boxes } = raw as { cols?: unknown; rows?: unknown; boxes?: unknown };
  if (!Array.isArray(boxes)) return null;

  const parsed: GridBox[] = [];
  for (const entry of boxes) {
    if (typeof entry !== "object" || entry === null) continue;
    const box = entry as Record<string, unknown>;
    const merged = box.mergedInto === "left" || box.mergedInto === "up" ? box.mergedInto : undefined;
    parsed.push({
      id: typeof box.id === "string" && box.id ? box.id : makeBox().id,
      fields: merged ? [] : parseFields(box.fields),
      ...(merged ? { mergedInto: merged } : {}),
    });
  }
  if (parsed.length === 0) return null;

  const align = (raw as { align?: unknown }).align;
  const gridCols: 1 | 2 = cols === 2 ? 2 : 1;
  const gridRows = typeof rows === "number" && rows > 0 ? Math.min(MAX_ROWS, rows) : 1;

  // A grid saved taller than the current limit keeps its fields: anything past the last
  // surviving box folds into it rather than disappearing with the row.
  const capacity = gridCols * gridRows;
  const kept =
    parsed.length > capacity
      ? parsed.slice(0, capacity).map((box, index) =>
          index === capacity - 1
            ? { ...box, fields: [...box.fields, ...parsed.slice(capacity).flatMap((extra) => extra.fields)] }
            : box,
        )
      : parsed;

  return {
    cols: gridCols,
    rows: gridRows,
    boxes: kept,
    ...(align === "center" || align === "end" ? { align } : {}),
  };
}

/** Reads persisted JSON, lifting older shapes so a saved arrangement is never lost. */
export function parseCardLayout(raw: unknown): CardLayout | null {
  if (typeof raw !== "object" || raw === null) return null;
  const value = raw as Record<string, unknown>;
  if (value.version !== CARD_LAYOUT_VERSION) return liftLegacyLayout(value);

  const arrangement = isArrangement(value.arrangement) ? value.arrangement : "cover-top";
  const regionsRaw = (value.regions ?? {}) as Record<string, unknown>;
  const regions: Record<string, Grid> = {};
  for (const id of ARRANGEMENTS[arrangement].regions) {
    regions[id] = parseGrid(regionsRaw[id]) ?? makeGrid(1, 1);
  }

  return {
    version: CARD_LAYOUT_VERSION,
    arrangement,
    extended: value.extended === true,
    ratio: parseRatio(value.ratio),
    overlay: parseFields(value.overlay).slice(0, MAX_OVERLAY_FIELDS),
    regions,
  };
}

/** v1 presets, v2 side/below, v3 named cells — all collapse to one or two frames. */
function liftLegacyLayout(value: Record<string, unknown>): CardLayout | null {
  const overlay = parseFields(value.overlay ?? value.overlayFields).slice(0, MAX_OVERLAY_FIELDS);
  const ratio = parseRatio(value.ratio);
  const base = { version: CARD_LAYOUT_VERSION, extended: false, ratio, overlay } as const;

  const collect = (): { main: CardField[]; below: CardField[]; cover: CoverSlot } => {
    if (value.cells && typeof value.cells === "object") {
      const cells = value.cells as Record<string, { fields?: unknown }>;
      const arrangement = String(value.arrangement ?? "");
      return {
        main: parseFields(cells.a?.fields),
        below: parseFields(cells.b?.fields),
        cover: arrangement.includes("left") || arrangement.includes("right") ? "left" : arrangement === "no-cover" ? "none" : "top",
      };
    }
    if ("below" in value) {
      const below = (value.below ?? {}) as Record<string, unknown>;
      const belowCells = Array.isArray(below.cells) ? below.cells : [];
      return {
        main: value.cover === "left" ? parseFields(value.side) : parseFields(belowCells[0]),
        below: value.cover === "left" ? [...parseFields(belowCells[0]), ...parseFields(belowCells[1])] : parseFields(belowCells[1]),
        cover: value.cover === "left" ? "left" : value.cover === "off" ? "none" : "top",
      };
    }
    if ("fields" in value || "preset" in value) {
      return {
        main: parseFields(value.fields),
        below: [],
        cover: value.preset === "beside" ? "left" : "top",
      };
    }
    return { main: [], below: [], cover: "top" };
  };

  const { main, below, cover } = collect();
  if (main.length === 0 && below.length === 0 && overlay.length === 0) return null;

  // The title was implicit before; make it a real field so it can be moved.
  const titled = [{ id: TITLE_FIELD_ID, showLabel: false }, ...main];

  if (cover === "left") {
    return below.length
      ? { ...base, arrangement: "cover-left-below", regions: { main: makeGrid(1, 1, [titled]), below: makeGrid(1, 1, [below]) } }
      : { ...base, arrangement: "cover-left", regions: { main: makeGrid(1, 1, [titled]) } };
  }
  return { ...base, arrangement: "cover-top", regions: { main: makeGrid(1, 1, [[...titled, ...below]]) } };
}

/* ── Resolution ──────────────────────────────────────────────────────────── */

export type ResolvedField<T> = { property: T | null; field: CardField; isTitle: boolean };
export type ResolvedBox<T> = {
  id: string;
  colSpan: number;
  rowSpan: number;
  /** Folded into a neighbour: it occupies no grid track and draws nothing. */
  merged: boolean;
  fields: ResolvedField<T>[];
};
export type ResolvedGrid<T> = { cols: 1 | 2; rows: number; boxes: ResolvedBox<T>[]; align?: FrameAlign };

export type ResolvedCardLayout<T> = {
  arrangement: ArrangementId;
  cover: CoverSlot;
  sideBySide: boolean;
  extended: boolean;
  ratio: CardRatio;
  overlay: ResolvedField<T>[];
  regions: Record<string, ResolvedGrid<T>>;
};

/**
 * The arrangement to render, reconciled against the properties that exist now. Ids whose
 * property has vanished from Notion are dropped rather than rendered blank, and a
 * property claimed twice is kept only where it appears first.
 */
export function resolveCardLayout<T extends CardEligibleProperty>(
  layout: CardLayout | null,
  properties: T[],
  coverAspect: string | undefined,
): ResolvedCardLayout<T> {
  const byId = new Map(cardEligibleProperties(properties).map((p) => [p.notionPropertyId, p]));
  const source = layout ?? createDefaultCardLayout(properties);
  const taken = new Set<string>();

  const pick = (fields: CardField[], limit?: number): ResolvedField<T>[] => {
    const out: ResolvedField<T>[] = [];
    for (const field of fields) {
      if (limit !== undefined && out.length >= limit) break;
      if (taken.has(field.id)) continue;
      if (field.id === TITLE_FIELD_ID) {
        taken.add(field.id);
        out.push({ property: null, field, isTitle: true });
        continue;
      }
      const property = byId.get(field.id);
      if (!property) continue;
      taken.add(field.id);
      out.push({ property, field, isTitle: false });
    }
    return out;
  };

  const resolveGrid = (grid: Grid): ResolvedGrid<T> => ({
    cols: grid.cols,
    rows: grid.rows,
    align: grid.align,
    boxes: grid.boxes.map((box, index) => {
      const { colSpan, rowSpan } = spanOf(grid, index);
      return {
        id: box.id,
        colSpan,
        rowSpan,
        merged: Boolean(box.mergedInto),
        fields: box.mergedInto ? [] : pick(box.fields),
      };
    }),
  });

  const spec = ARRANGEMENTS[source.arrangement];
  const cover: CoverSlot = coverAspect === "none" || spec.cover === "none" ? "none" : spec.cover;
  const overlay = cover === "none" ? [] : pick(source.overlay, MAX_OVERLAY_FIELDS);

  const regions: Record<string, ResolvedGrid<T>> = {};
  for (const id of spec.regions) regions[id] = resolveGrid(source.regions[id] ?? makeGrid(1, 1));

  return {
    arrangement: source.arrangement,
    cover,
    sideBySide: spec.sideBySide && (cover === "left" || cover === "right"),
    extended: source.extended,
    ratio: source.ratio,
    overlay,
    regions,
  };
}
