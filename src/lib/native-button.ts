/**
 * Native buttons: what a Notion button property does, defined in Hallery instead.
 *
 * Notion's API exposes a button property as `button: {}` — neither its configured action
 * nor any way to press it. So Hallery lets the owner attach its own actions to that
 * property. Every action is a value write on the same page (set a status, stamp a date,
 * tick a box, bump a number); none of them touches the database schema, which keeps
 * buttons inside the line Hallery does not cross.
 *
 * Stored in the button property's own display config, under `actions`.
 */

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

export type ButtonAction = { propertyId: string; op: ButtonOp; value?: string };

export type NativeButtonConfig = {
  /** Text on the button; the property's own name when empty. */
  label?: string;
  actions: ButtonAction[];
  /** Ask before running — for buttons that are hard to undo by hand. */
  confirm?: boolean;
};

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

const OPS = new Set<ButtonOp>(Object.keys(OP_LABELS) as ButtonOp[]);

export function parseNativeButton(raw: unknown): NativeButtonConfig | null {
  if (typeof raw !== "object" || raw === null) return null;
  const { actions, label, confirm } = raw as Record<string, unknown>;
  if (!Array.isArray(actions)) return null;
  const parsed: ButtonAction[] = [];
  for (const entry of actions) {
    if (typeof entry !== "object" || entry === null) continue;
    const { propertyId, op, value } = entry as Record<string, unknown>;
    if (typeof propertyId !== "string" || typeof op !== "string" || !OPS.has(op as ButtonOp)) continue;
    parsed.push({ propertyId, op: op as ButtonOp, ...(typeof value === "string" ? { value } : {}) });
  }
  if (parsed.length === 0) return null;
  return {
    actions: parsed,
    ...(typeof label === "string" && label.trim() ? { label: label.trim() } : {}),
    ...(confirm === true ? { confirm: true } : {}),
  };
}
