/**
 * Versioned, Hallery-only layout metadata for a Card Detail.  Property references
 * are Notion property IDs so a Notion rename cannot break a saved arrangement.
 */
export const DETAIL_LAYOUT_VERSION = 1;

export const LAYOUT_KINDS = [
  "single",
  "two-col",
  "two-col-split-left",
  "two-col-split-right",
  "stack",
] as const;

export type LayoutKind = (typeof LAYOUT_KINDS)[number];
export type LayoutRatio = [50, 50] | [60, 40] | [40, 60] | [70, 30] | [30, 70];

export type DetailLayoutCell = {
  id: string;
  props: string[];
  kind?: LayoutKind;
  ratio?: LayoutRatio;
  cells?: DetailLayoutCell[];
};

export type DetailLayoutNode = {
  kind: LayoutKind;
  ratio?: LayoutRatio;
  cells: DetailLayoutCell[];
};

export type DetailLayout = {
  version: typeof DETAIL_LAYOUT_VERSION;
  root: DetailLayoutNode;
};

export type LayoutProperty = {
  notionPropertyId: string;
  notionPropertyType: string;
  sortOrder: number;
};

export type ParsedDetailLayout = {
  layout: DetailLayout;
  usedFallback: boolean;
  reason?: string;
};

const RATIO_OPTIONS: LayoutRatio[] = [
  [50, 50],
  [60, 40],
  [40, 60],
  [70, 30],
  [30, 70],
];

export function layoutCellCount(kind: LayoutKind): 1 | 2 | 3 {
  if (kind === "single") return 1;
  if (kind === "two-col-split-left" || kind === "two-col-split-right") return 3;
  return 2;
}

export function layoutUsesColumns(kind: LayoutKind) {
  return kind === "two-col" || kind === "two-col-split-left" || kind === "two-col-split-right";
}

/** Existing Galleries have an empty layout, which deliberately means this shape. */
export function createDefaultDetailLayout(properties: LayoutProperty[]): DetailLayout {
  const props = properties
    .filter((property) => property.notionPropertyType !== "title")
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((property) => property.notionPropertyId);

  return {
    version: DETAIL_LAYOUT_VERSION,
    root: { kind: "single", cells: [{ id: "root-1", props }] },
  };
}

/**
 * Invalid, future-version, or over-nested persisted JSON never breaks a detail
 * page. It falls back to the ordered legacy layout and reports why to the caller.
 */
export function parseDetailLayout(raw: string | undefined, properties: LayoutProperty[]): ParsedDetailLayout {
  const fallback = (reason: string): ParsedDetailLayout => ({
    layout: createDefaultDetailLayout(properties),
    usedFallback: true,
    reason,
  });

  if (!raw?.trim()) return { layout: createDefaultDetailLayout(properties), usedFallback: false };

  try {
    const value: unknown = JSON.parse(raw);
    const layout = parseLayout(value, 0, new Set<string>(), new Set<string>());
    if (!layout) return fallback("Cấu trúc layout không hợp lệ.");
    return { layout, usedFallback: false };
  } catch {
    return fallback("JSON layout không đọc được.");
  }
}

export function getPlacedPropertyIds(layout: DetailLayout): Set<string> {
  const placed = new Set<string>();
  collectProperties(layout.root, placed);
  return placed;
}

function collectProperties(node: DetailLayoutNode, placed: Set<string>) {
  for (const cell of node.cells) {
    for (const propertyId of cell.props) placed.add(propertyId);
    if (cell.kind && cell.cells) collectProperties(cell as DetailLayoutNode, placed);
  }
}

function parseLayout(
  value: unknown,
  depth: number,
  propertyIds: Set<string>,
  cellIds: Set<string>,
): DetailLayout | null {
  if (!isRecord(value) || value.version !== DETAIL_LAYOUT_VERSION || !isRecord(value.root)) return null;
  const root = parseNode(value.root, depth, propertyIds, cellIds);
  return root ? { version: DETAIL_LAYOUT_VERSION, root } : null;
}

function parseNode(
  value: Record<string, unknown>,
  depth: number,
  propertyIds: Set<string>,
  cellIds: Set<string>,
): DetailLayoutNode | null {
  const kind = value.kind;
  if (!isLayoutKind(kind) || !Array.isArray(value.cells) || value.cells.length !== layoutCellCount(kind)) return null;

  const ratio = parseRatio(value.ratio, kind);
  if (ratio === null) return null;

  const cells: DetailLayoutCell[] = [];
  for (const rawCell of value.cells) {
    const cell = parseCell(rawCell, depth, propertyIds, cellIds);
    if (!cell) return null;
    cells.push(cell);
  }
  return { kind, ...(ratio ? { ratio } : {}), cells };
}

function parseCell(
  value: unknown,
  depth: number,
  propertyIds: Set<string>,
  cellIds: Set<string>,
): DetailLayoutCell | null {
  if (!isRecord(value) || typeof value.id !== "string" || !value.id || cellIds.has(value.id)) return null;
  if (!Array.isArray(value.props) || !value.props.every((id) => typeof id === "string" && id)) return null;
  if (value.props.some((id) => propertyIds.has(id))) return null;

  cellIds.add(value.id);
  value.props.forEach((id) => propertyIds.add(id));

  if (value.kind === undefined && value.cells === undefined && value.ratio === undefined) {
    return { id: value.id, props: [...value.props] };
  }

  // Root is depth 0. A nested node is allowed only in one of its cells (depth 1).
  if (depth >= 1 || !isLayoutKind(value.kind) || !Array.isArray(value.cells) || value.props.length > 0) return null;
  const ratio = parseRatio(value.ratio, value.kind);
  if (ratio === null || value.cells.length !== layoutCellCount(value.kind)) return null;

  const cells: DetailLayoutCell[] = [];
  for (const rawChild of value.cells) {
    const child = parseCell(rawChild, depth + 1, propertyIds, cellIds);
    if (!child || child.kind) return null;
    cells.push(child);
  }
  return { id: value.id, props: [], kind: value.kind, ...(ratio ? { ratio } : {}), cells };
}

function parseRatio(value: unknown, kind: LayoutKind): LayoutRatio | undefined | null {
  if (!layoutUsesColumns(kind)) return value === undefined ? undefined : null;
  if (value === undefined) return [50, 50];
  if (!Array.isArray(value) || value.length !== 2 || !value.every((part) => typeof part === "number")) return null;
  return RATIO_OPTIONS.some((ratio) => ratio[0] === value[0] && ratio[1] === value[1])
    ? ([value[0], value[1]] as LayoutRatio)
    : null;
}

function isLayoutKind(value: unknown): value is LayoutKind {
  return typeof value === "string" && LAYOUT_KINDS.includes(value as LayoutKind);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
