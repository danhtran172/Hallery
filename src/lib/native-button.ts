/**
 * Native buttons: what a Notion button does, defined in Hallery instead.
 *
 * Notion's API exposes a button property as `button: {}` — neither its configured steps
 * nor any way to press it — so its setup cannot be copied, and Hallery does not take
 * Notion's buttons in at all. Buttons are created in Hallery instead. One runs its steps in
 * order, like Notion's own: edit this record, edit the records linked to it, add a record
 * to another gallery, then optionally open a record or a form.
 *
 * Every step is a value write or a page create; none of them touches a database's
 * structure, which keeps buttons inside the line Hallery does not cross.
 *
 * Stored in the button's PropertyConfig display config, under `button`.
 */

import { parseCardLayout, type CardLayout } from "@/lib/card-layout";

/**
 * Id prefix of a button that lives only in Hallery. Notion property ids are short and
 * URL-encoded, so this can never collide with one; it lets a Hallery button sit in the
 * same PropertyConfig table, layouts and render paths as a Notion property.
 */
export const HALLERY_BUTTON_PREFIX = "hallery-button:";

export function isHalleryButtonId(propertyId: string): boolean {
  return propertyId.startsWith(HALLERY_BUTTON_PREFIX);
}

/**
 * Whether Hallery takes a Notion property in at all. Notion's buttons are left out: the
 * API shows them as `button: {}` — no steps to copy and no way to press them — so they
 * would only ever sit on a card doing nothing. Hallery's own buttons replace them.
 */
export function isImportedNotionType(type: string): boolean {
  return type !== "button";
}

/** The nested `create` that gives a new Gallery one PropertyConfig per imported Notion property. */
export function propertyConfigsCreate(properties: Record<string, { id: string; type: string }>) {
  return {
    create: Object.entries(properties)
      .filter(([, config]) => isImportedNotionType(config.type))
      .map(([name, config], index) => ({
        notionPropertyId: config.id,
        notionPropertyName: name,
        notionPropertyType: config.type,
        sortOrder: index,
      })),
  };
}

export type ButtonOp =
  /** select / status / rich_text / url / email / phone_number / number: write this value. */
  | "set"
  /** Any writable type: empty it. */
  | "clear"
  /** date: today's date, no time. */
  | "today"
  /** date: this moment, with time. */
  | "now"
  /** number: add `value` (negative subtracts). */
  | "increment"
  /** checkbox */
  | "check"
  | "uncheck"
  | "toggle"
  /** multi_select: add or remove one option. */
  | "add"
  | "remove";

/** One property change on a record. */
export type ButtonAction = { propertyId: string; op: ButtonOp; value?: string };

/** Where a value written into a newly added record comes from. */
export type AddValueSource =
  /** Typed in the button settings. */
  | "fixed"
  | "today"
  | "now"
  /** A relation pointing back at the record whose button was pressed. */
  | "this"
  /** Copied from a property of the record whose button was pressed (`value` = its id). */
  | "copy";

export type AddValue = { propertyId: string; source: AddValueSource; value?: string };

export type ButtonStep =
  | { kind: "edit_this"; actions: ButtonAction[] }
  /** Every record linked through `relationPropertyId`, each given the same changes. */
  | { kind: "edit_related"; relationPropertyId: string; actions: ButtonAction[] }
  | { kind: "add"; galleryId: string; values: AddValue[] }
  /** Opens the record's Card Detail to read, on this record or the one an earlier step added. */
  | { kind: "open_view"; target: OpenTarget }
  /**
   * Opens an edit form in a popup, on this record or the one an earlier step added.
   * `layout` is the button's own form, laid out like the "Form thêm" one; absent means the
   * gallery's own edit form — whatever its Card Detail shows.
   */
  | { kind: "open_form"; target: OpenTarget; layout?: CardLayout; prefill?: FormPrefill };

export type OpenTarget = "this" | "added";

/**
 * What a form field holds when the button opens it, instead of the record's current value
 * — "Status = Readed, Read Time = today", left for the reader to confirm or change before
 * saving. Keyed by property id, the title as `__title__`. A field not listed shows its
 * current value.
 */
export type PrefillMode = "static" | "today" | "now" | "clear";
export type FieldPrefill = { mode: PrefillMode; value?: string };
export type FormPrefill = Record<string, FieldPrefill>;

export const PREFILL_LABELS: Record<PrefillMode, string> = {
  static: "Giá trị cố định",
  today: "Hôm nay",
  now: "Bây giờ",
  clear: "Để trống",
};

export function prefillModesFor(type: string): PrefillMode[] {
  if (type === "date") return ["today", "now", "static", "clear"];
  if (type === "checkbox" || type === "title") return ["static"];
  return ["static", "clear"];
}

function parsePrefill(raw: unknown): FormPrefill | null {
  if (typeof raw !== "object" || raw === null) return null;
  const out: FormPrefill = {};
  for (const [id, entry] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof entry !== "object" || entry === null) continue;
    const { mode, value } = entry as Record<string, unknown>;
    if (mode !== "static" && mode !== "today" && mode !== "now" && mode !== "clear") continue;
    out[id] = { mode, ...(typeof value === "string" ? { value } : {}) };
  }
  return Object.keys(out).length ? out : null;
}
export type ButtonStepKind = ButtonStep["kind"];

/** Steps that open something. One per button at most, and always last. */
export function isOpenStep(step: ButtonStep): step is Extract<ButtonStep, { kind: "open_view" | "open_form" }> {
  return step.kind === "open_view" || step.kind === "open_form";
}

export const STEP_LABELS: Record<ButtonStepKind, string> = {
  edit_this: "Sửa record này",
  edit_related: "Sửa các record liên kết",
  add: "Thêm record vào gallery",
  open_view: "Mở record để xem",
  open_form: "Mở form để sửa",
};

export const STEP_HINTS: Record<ButtonStepKind, string> = {
  edit_this: "Đặt status, ghi ngày, tick, cộng số… trên record đang bấm",
  edit_related: "Cùng thay đổi cho mọi record nối qua một relation",
  add: "Tạo record mới ở một gallery cùng workspace",
  open_view: "Mở Card Detail của record",
  open_form: "Mở popup form để sửa ngay",
};

/** Notion's own colour names, so a button can match the select options it sets. */
export const BUTTON_COLORS = [
  "default",
  "brand",
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
] as const;
export type ButtonColor = (typeof BUTTON_COLORS)[number];

export const BUTTON_COLOR_LABELS: Record<ButtonColor, string> = {
  default: "Mặc định",
  brand: "Màu Hallery",
  gray: "Xám",
  brown: "Nâu",
  orange: "Cam",
  yellow: "Vàng",
  green: "Xanh lá",
  blue: "Xanh dương",
  purple: "Tím",
  pink: "Hồng",
  red: "Đỏ",
};

/** Classes on top of `.btn` — the palette steps are theme-aware, so dark mode follows. */
export const BUTTON_COLOR_CLASSES: Record<ButtonColor, string> = {
  default: "btn-secondary",
  brand: "btn-primary",
  gray: "bg-stone-200 text-stone-800 ring-1 ring-current/15 ring-inset hover:brightness-95",
  brown: "bg-amber-100 text-amber-900 ring-1 ring-current/15 ring-inset hover:brightness-95",
  orange: "bg-orange-100 text-orange-800 ring-1 ring-current/15 ring-inset hover:brightness-95",
  yellow: "bg-yellow-100 text-yellow-800 ring-1 ring-current/15 ring-inset hover:brightness-95",
  green: "bg-emerald-100 text-emerald-800 ring-1 ring-current/15 ring-inset hover:brightness-95",
  blue: "bg-sky-100 text-sky-800 ring-1 ring-current/15 ring-inset hover:brightness-95",
  purple: "bg-purple-100 text-purple-800 ring-1 ring-current/15 ring-inset hover:brightness-95",
  pink: "bg-pink-100 text-pink-800 ring-1 ring-current/15 ring-inset hover:brightness-95",
  red: "bg-red-100 text-red-800 ring-1 ring-current/15 ring-inset hover:brightness-95",
};

/**
 * The question asked before running, like Notion's "Show confirmation" step. Every field
 * is optional; an empty one falls back to a sensible default at render time.
 */
export type ButtonConfirm = {
  title?: string;
  message?: string;
  confirmLabel?: string;
  cancelLabel?: string;
};

export type NativeButtonConfig = {
  /** Text on the button; the property's own name when empty. */
  label?: string;
  /** Leading emoji or symbol, like the icon on a Notion button. */
  icon?: string;
  color?: ButtonColor;
  steps: ButtonStep[];
  /** Ask before running — for buttons that are hard to undo by hand. */
  confirm?: ButtonConfirm;
};

export const CONFIRM_LIMITS = { title: 120, message: 500, confirmLabel: 40, cancelLabel: 40 } as const;

/** Which operations make sense for a property type, in the order the editor offers them. */
export function opsFor(type: string): ButtonOp[] {
  switch (type) {
    case "select":
    case "status":
      return ["set", "clear"];
    case "multi_select":
      return ["add", "remove", "clear"];
    case "date":
      return ["today", "now", "clear"];
    case "number":
      return ["increment", "set", "clear"];
    case "checkbox":
      return ["check", "uncheck", "toggle"];
    case "rich_text":
    case "url":
    case "email":
    case "phone_number":
      return ["set", "clear"];
    default:
      return [];
  }
}

export const OP_LABELS: Record<ButtonOp, string> = {
  set: "Đặt thành",
  clear: "Xoá trống",
  today: "Đặt là hôm nay",
  now: "Đặt là bây giờ",
  increment: "Cộng thêm",
  check: "Tick",
  uncheck: "Bỏ tick",
  toggle: "Đảo tick",
  add: "Thêm option",
  remove: "Bỏ option",
};

/** True when an op needs a value typed or picked alongside it. */
export function opTakesValue(op: ButtonOp): boolean {
  return op === "set" || op === "increment" || op === "add" || op === "remove";
}

/** Where a new record's value of this type can come from, in the order the editor offers. */
export function sourcesFor(type: string): AddValueSource[] {
  switch (type) {
    case "date":
      return ["today", "now", "fixed", "copy"];
    case "relation":
      return ["this", "copy"];
    case "title":
    case "rich_text":
    case "number":
    case "select":
    case "status":
    case "multi_select":
    case "checkbox":
    case "url":
    case "email":
    case "phone_number":
      return ["fixed", "copy"];
    default:
      return [];
  }
}

export const SOURCE_LABELS: Record<AddValueSource, string> = {
  fixed: "Giá trị cố định",
  today: "Hôm nay",
  now: "Bây giờ",
  this: "Record đang bấm",
  copy: "Chép từ record đang bấm",
};

/** True when a source needs a value typed or picked alongside it. */
export function sourceTakesValue(source: AddValueSource): boolean {
  return source === "fixed" || source === "copy";
}

/**
 * Types a "copy" can read from for a target of `type`. Text-like types copy as plain
 * text, so a title can seed a text field and the other way round.
 */
export function copyableFrom(type: string): string[] {
  const text = ["title", "rich_text", "url", "email", "phone_number", "select", "status"];
  switch (type) {
    case "title":
    case "rich_text":
    case "url":
    case "email":
    case "phone_number":
      return [...text, "number"];
    case "select":
    case "status":
      return ["select", "status"];
    default:
      return [type];
  }
}

const OPS = new Set<ButtonOp>(Object.keys(OP_LABELS) as ButtonOp[]);
const SOURCES = new Set<AddValueSource>(Object.keys(SOURCE_LABELS) as AddValueSource[]);

function parseActions(raw: unknown): ButtonAction[] {
  if (!Array.isArray(raw)) return [];
  const parsed: ButtonAction[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { propertyId, op, value } = entry as Record<string, unknown>;
    if (typeof propertyId !== "string" || typeof op !== "string" || !OPS.has(op as ButtonOp)) continue;
    parsed.push({ propertyId, op: op as ButtonOp, ...(typeof value === "string" ? { value } : {}) });
  }
  return parsed;
}

function parseValues(raw: unknown): AddValue[] {
  if (!Array.isArray(raw)) return [];
  const parsed: AddValue[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { propertyId, source, value } = entry as Record<string, unknown>;
    if (typeof propertyId !== "string" || typeof source !== "string" || !SOURCES.has(source as AddValueSource)) continue;
    parsed.push({ propertyId, source: source as AddValueSource, ...(typeof value === "string" ? { value } : {}) });
  }
  return parsed;
}

function parseStep(raw: unknown): ButtonStep | null {
  if (typeof raw !== "object" || raw === null) return null;
  const step = raw as Record<string, unknown>;
  switch (step.kind) {
    case "edit_this": {
      const actions = parseActions(step.actions);
      return actions.length ? { kind: "edit_this", actions } : null;
    }
    case "edit_related": {
      const actions = parseActions(step.actions);
      if (typeof step.relationPropertyId !== "string" || !step.relationPropertyId || !actions.length) return null;
      return { kind: "edit_related", relationPropertyId: step.relationPropertyId, actions };
    }
    case "add":
      if (typeof step.galleryId !== "string" || !step.galleryId) return null;
      return { kind: "add", galleryId: step.galleryId, values: parseValues(step.values) };
    case "open_view":
      return { kind: "open_view", target: step.target === "added" ? "added" : "this" };
    case "open_form": {
      const layout = parseCardLayout(step.layout);
      const prefill = parsePrefill(step.prefill);
      return {
        kind: "open_form",
        target: step.target === "added" ? "added" : "this",
        ...(layout ? { layout } : {}),
        ...(prefill ? { prefill } : {}),
      };
    }
    default:
      return null;
  }
}

export function parseNativeButton(raw: unknown): NativeButtonConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { steps, actions, label, icon, color, confirm } = raw as Record<string, unknown>;

  let parsed: ButtonStep[];
  if (Array.isArray(steps)) {
    parsed = steps.map(parseStep).filter((step): step is ButtonStep => step !== null);
  } else {
    // Before steps, a button was one list of edits on its own record.
    const legacy = parseActions(actions);
    parsed = legacy.length ? [{ kind: "edit_this", actions: legacy }] : [];
  }
  // One opening step at most, and last: it opens once everything else has landed.
  const opener = parsed.findLast(isOpenStep);
  parsed = parsed.filter((step) => !isOpenStep(step));
  if (opener && (opener.target === "this" || parsed.some((step) => step.kind === "add"))) parsed.push(opener);
  if (parsed.length === 0) return null;

  const parsedConfirm = parseConfirm(confirm);
  return {
    steps: parsed,
    ...(typeof label === "string" && label.trim() ? { label: label.trim().slice(0, 80) } : {}),
    ...(typeof icon === "string" && icon.trim() ? { icon: firstGrapheme(icon.trim()) } : {}),
    ...(typeof color === "string" && color !== "default" && (BUTTON_COLORS as readonly string[]).includes(color)
      ? { color: color as ButtonColor }
      : {}),
    ...(parsedConfirm ? { confirm: parsedConfirm } : {}),
  };
}

/** One emoji or symbol, kept whole even when it is several code points (👍🏽, 🏳️‍🌈). */
function firstGrapheme(text: string): string {
  const first = new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text)[Symbol.iterator]().next();
  return first.done ? "" : first.value.segment;
}

/** `true` is how confirmation was stored before it could say anything of its own. */
function parseConfirm(raw: unknown): ButtonConfirm | null {
  if (raw === true) return {};
  if (typeof raw !== "object" || raw === null) return null;
  const source = raw as Record<string, unknown>;
  const confirm: ButtonConfirm = {};
  for (const key of Object.keys(CONFIRM_LIMITS) as (keyof ButtonConfirm)[]) {
    const value = source[key];
    if (typeof value === "string" && value.trim()) confirm[key] = value.trim().slice(0, CONFIRM_LIMITS[key]);
  }
  return confirm;
}
