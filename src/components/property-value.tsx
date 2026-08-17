import type { PageObjectResponse } from "@notionhq/client";
import { formatDateByGranularity, formatDuration, type DisplayConfig } from "@/lib/display-config";

type PropertyValue = PageObjectResponse["properties"][string];

/** Default renderer per Notion property type, customized by an optional Hallery display config. */
export function PropertyValue({ value, displayConfig }: { value: PropertyValue; displayConfig?: DisplayConfig }) {
  const cfg = displayConfig ?? {};
  switch (value.type) {
    case "title":
      return null; // rendered separately as the card heading
    case "rich_text": {
      const text = value.rich_text.map((t) => t.plain_text).join("");
      return text ? <span>{withAffixes(text, cfg)}</span> : <Empty />;
    }
    case "number":
      return <NumberValue value={value.number} cfg={cfg} />;
    case "select":
      return value.select ? <SelectOption name={value.select.name} color={value.select.color} cfg={cfg} /> : <Empty />;
    case "status":
      return value.status ? <SelectOption name={value.status.name} color={value.status.color} cfg={cfg} /> : <Empty />;
    case "multi_select":
      if (!value.multi_select.length) return <Empty />;
      if (cfg.kind === "text") {
        return <span>{value.multi_select.map((opt) => withAffixes(opt.name, cfg)).join(", ")}</span>;
      }
      return (
        <div className="flex flex-wrap gap-1">
          {value.multi_select.map((opt) => (
            <Pill key={opt.id} color={opt.color}>
              {withAffixes(opt.name, cfg)}
            </Pill>
          ))}
        </div>
      );
    case "date":
      return value.date ? <span>{formatDateByGranularity(value.date.start, cfg.kind)}</span> : <Empty />;
    case "checkbox":
      return <span>{value.checkbox ? "✓" : "—"}</span>;
    case "url":
      return <UrlValue url={value.url} cfg={cfg} />;
    case "email":
      return value.email ? <span>{value.email}</span> : <Empty />;
    case "phone_number":
      return value.phone_number ? <span>{value.phone_number}</span> : <Empty />;
    case "people":
      return value.people.length ? (
        <span>{value.people.map((p) => ("name" in p ? p.name : "?")).join(", ")}</span>
      ) : (
        <Empty />
      );
    case "files":
      return value.files.length ? <span>{value.files.length} tệp</span> : <Empty />;
    case "relation":
      return value.relation.length ? <span>{value.relation.length} liên kết</span> : <Empty />;
    case "rollup":
      return <RollupValue rollup={value.rollup} cfg={cfg} />;
    case "formula":
      return <FormulaValue formula={value.formula} cfg={cfg} />;
    case "created_time":
      return <span>{formatDate(value.created_time)}</span>;
    case "last_edited_time":
      return <span>{formatDate(value.last_edited_time)}</span>;
    case "created_by":
      return <span>{"name" in value.created_by ? value.created_by.name : "?"}</span>;
    case "last_edited_by":
      return <span>{"name" in value.last_edited_by ? value.last_edited_by.name : "?"}</span>;
    case "unique_id":
      return (
        <span>
          {value.unique_id.prefix ? `${value.unique_id.prefix}-` : ""}
          {value.unique_id.number}
        </span>
      );
    default:
      return <Empty />;
  }
}

function withAffixes(text: string, cfg: DisplayConfig) {
  return `${cfg.prefix ?? ""}${text}${cfg.suffix ?? ""}`;
}

function SelectOption({ name, color, cfg }: { name: string; color: string; cfg: DisplayConfig }) {
  if (cfg.kind === "text") return <span>{withAffixes(name, cfg)}</span>;
  return <Pill color={color}>{withAffixes(name, cfg)}</Pill>;
}

function NumberValue({ value, cfg }: { value: number | null; cfg: DisplayConfig }) {
  if (value === null) return <Empty />;
  if (cfg.kind === "rate") {
    const max = cfg.max && cfg.max > 0 ? cfg.max : 5;
    const filled = Math.max(0, Math.min(max, Math.round(value)));
    return (
      <span aria-label={`${filled}/${max}`} className="text-amber-500">
        {"★".repeat(filled)}
        <span className="text-stone-300">{"★".repeat(max - filled)}</span>
      </span>
    );
  }
  if (cfg.kind === "duration") return <span>{formatDuration(value)}</span>;
  if (cfg.kind === "with_text") return <span>{withAffixes(String(value), cfg)}</span>;
  return <span>{value}</span>;
}

function UrlValue({ url, cfg }: { url: string | null; cfg: DisplayConfig }) {
  if (!url) return <Empty />;
  if (cfg.kind === "button") {
    return (
      <a
        href={url}
        target="_blank"
        rel="noreferrer"
        className="inline-block rounded-md bg-emerald-700 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-800"
      >
        {cfg.label || url}
      </a>
    );
  }
  return (
    <a href={url} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
      {url}
    </a>
  );
}

function RollupValue({ rollup, cfg }: { rollup: { type: string; [key: string]: unknown }; cfg: DisplayConfig }) {
  if (rollup.type === "number") return <NumberValue value={(rollup.number as number | null) ?? null} cfg={cfg} />;
  if (rollup.type === "date") {
    const d = rollup.date as { start: string } | null;
    return d ? <span>{formatDateByGranularity(d.start, cfg.kind)}</span> : <Empty />;
  }
  if (rollup.type === "array") {
    const arr = rollup.array as Array<{ type: string; [key: string]: unknown }>;
    return arr.length ? <span>{arr.length} giá trị</span> : <Empty />;
  }
  return <Empty />;
}

function FormulaValue({ formula, cfg }: { formula: { type: string; [key: string]: unknown }; cfg: DisplayConfig }) {
  if (formula.type === "string")
    return formula.string ? <span>{withAffixes(formula.string as string, cfg)}</span> : <Empty />;
  if (formula.type === "number") return <NumberValue value={(formula.number as number | null) ?? null} cfg={cfg} />;
  if (formula.type === "boolean") return <span>{formula.boolean ? "✓" : "—"}</span>;
  if (formula.type === "date") {
    const d = formula.date as { start: string } | null;
    return d ? <span>{formatDateByGranularity(d.start, cfg.kind)}</span> : <Empty />;
  }
  return <Empty />;
}

function Empty() {
  return <span className="text-stone-400">—</span>;
}

const PILL_COLORS: Record<string, string> = {
  default: "bg-stone-100 text-stone-700",
  gray: "bg-stone-200 text-stone-700",
  brown: "bg-amber-100 text-amber-900",
  orange: "bg-orange-100 text-orange-800",
  yellow: "bg-yellow-100 text-yellow-800",
  green: "bg-emerald-100 text-emerald-800",
  blue: "bg-sky-100 text-sky-800",
  purple: "bg-purple-100 text-purple-800",
  pink: "bg-pink-100 text-pink-800",
  red: "bg-red-100 text-red-800",
};

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${PILL_COLORS[color] ?? PILL_COLORS.default}`}>
      {children}
    </span>
  );
}

function formatDate(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("vi-VN");
}
