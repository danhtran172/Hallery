import type { PageObjectResponse } from "@notionhq/client";

type PropertyValue = PageObjectResponse["properties"][string];

/** Phase 0/1 default renderer: one sensible rendering per Notion property type, no custom display config yet. */
export function PropertyValue({ value }: { value: PropertyValue }) {
  switch (value.type) {
    case "title":
      return null; // rendered separately as the card heading
    case "rich_text": {
      const text = value.rich_text.map((t) => t.plain_text).join("");
      return text ? <span>{text}</span> : <Empty />;
    }
    case "number":
      return value.number === null ? <Empty /> : <span>{value.number}</span>;
    case "select":
      return value.select ? <Pill color={value.select.color}>{value.select.name}</Pill> : <Empty />;
    case "status":
      return value.status ? <Pill color={value.status.color}>{value.status.name}</Pill> : <Empty />;
    case "multi_select":
      return value.multi_select.length ? (
        <div className="flex flex-wrap gap-1">
          {value.multi_select.map((opt) => (
            <Pill key={opt.id} color={opt.color}>
              {opt.name}
            </Pill>
          ))}
        </div>
      ) : (
        <Empty />
      );
    case "date":
      return value.date ? <span>{formatDate(value.date.start)}</span> : <Empty />;
    case "checkbox":
      return <span>{value.checkbox ? "✓" : "—"}</span>;
    case "url":
      return value.url ? (
        <a href={value.url} target="_blank" rel="noreferrer" className="text-emerald-700 underline">
          {value.url}
        </a>
      ) : (
        <Empty />
      );
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
      return <RollupValue rollup={value.rollup} />;
    case "formula":
      return <FormulaValue formula={value.formula} />;
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

function RollupValue({ rollup }: { rollup: { type: string; [key: string]: unknown } }) {
  if (rollup.type === "number") {
    const n = rollup.number as number | null;
    return n === null || n === undefined ? <Empty /> : <span>{n}</span>;
  }
  if (rollup.type === "date") {
    const d = rollup.date as { start: string } | null;
    return d ? <span>{formatDate(d.start)}</span> : <Empty />;
  }
  if (rollup.type === "array") {
    const arr = rollup.array as Array<{ type: string; [key: string]: unknown }>;
    return arr.length ? <span>{arr.length} giá trị</span> : <Empty />;
  }
  return <Empty />;
}

function FormulaValue({ formula }: { formula: { type: string; [key: string]: unknown } }) {
  if (formula.type === "string") return formula.string ? <span>{formula.string as string}</span> : <Empty />;
  if (formula.type === "number") return formula.number === null ? <Empty /> : <span>{formula.number as number}</span>;
  if (formula.type === "boolean") return <span>{formula.boolean ? "✓" : "—"}</span>;
  if (formula.type === "date") {
    const d = formula.date as { start: string } | null;
    return d ? <span>{formatDate(d.start)}</span> : <Empty />;
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
