import type { PageObjectResponse } from "@notionhq/client";

/** Property types Hallery can write back to Notion (plain values, no rich formatting). */
export const EDITABLE_PROPERTY_TYPES = new Set([
  "title",
  "rich_text",
  "number",
  "url",
  "email",
  "phone_number",
  "checkbox",
  "date",
  "select",
  "multi_select",
  "status",
]);

/** Notion-enforced read-only: no workaround exists, ever (see blueprint A.2). */
export const READONLY_PROPERTY_TYPES = new Set([
  "formula",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
  "button",
  "verification",
  "place",
]);

/** Suffix of the companion input carrying a date's end, next to the start's field name. */
export const DATE_END_SUFFIX = "::end";

/**
 * Hidden input listing every field the form rendered. A browser omits an unticked checkbox
 * from the submission entirely, so without this the server could never tell "unticked"
 * from "not on the form" — and unticking a box silently did nothing.
 */
export const FORM_FIELD_MANIFEST = "__fields";

/** Notion caps one rich-text object at 2,000 characters; longer text has to be split. */
const RICH_TEXT_CHUNK = 2000;

type NotionPropertyUpdate = Record<string, unknown>;
type PropertyValue = PageObjectResponse["properties"][string];

function richText(value: string) {
  const chunks: { text: { content: string } }[] = [];
  for (let start = 0; start < value.length; start += RICH_TEXT_CHUNK) {
    chunks.push({ text: { content: value.slice(start, start + RICH_TEXT_CHUNK) } });
  }
  return chunks;
}

/** Reads one field out of FormData for a given property type and builds the Notion pages.update payload for it. */
export function buildPropertyUpdate(
  type: string,
  formData: FormData,
  fieldName: string,
): NotionPropertyUpdate | null {
  if (!EDITABLE_PROPERTY_TYPES.has(type)) return null;

  switch (type) {
    case "title":
    case "rich_text": {
      const value = String(formData.get(fieldName) ?? "");
      return { [type]: value ? richText(value) : [] };
    }
    case "number": {
      const raw = String(formData.get(fieldName) ?? "").trim().replace(",", ".");
      if (raw === "") return { number: null };
      const value = Number(raw);
      return Number.isFinite(value) ? { number: value } : null;
    }
    case "url":
    case "email":
    case "phone_number": {
      const value = String(formData.get(fieldName) ?? "").trim();
      return { [type]: value === "" ? null : value };
    }
    case "checkbox": {
      return { checkbox: formData.get(fieldName) === "on" };
    }
    case "date": {
      const start = String(formData.get(fieldName) ?? "").trim();
      const end = String(formData.get(`${fieldName}${DATE_END_SUFFIX}`) ?? "").trim();
      return { date: start === "" ? null : { start, end: end || null } };
    }
    case "select":
    case "status": {
      const value = String(formData.get(fieldName) ?? "").trim();
      return { [type]: value === "" ? null : { name: value } };
    }
    case "multi_select": {
      // Rendered as one hidden input per chip, all sharing `fieldName` — getAll collects them all.
      const names = formData.getAll(fieldName).map((v) => String(v).trim()).filter(Boolean);
      return { multi_select: [...new Set(names)].map((name) => ({ name })) };
    }
    default:
      return null;
  }
}

/** Instant of a Notion date string, treating a bare date as that calendar day. */
function sameInstant(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return !a && !b;
  if (a === b) return true;
  const isDateOnly = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value);
  if (isDateOnly(a) || isDateOnly(b)) return a.slice(0, 10) === b.slice(0, 10) && isDateOnly(a) === isDateOnly(b);
  return Date.parse(a) === Date.parse(b);
}

/**
 * True when writing `update` would not change what the page already holds.
 *
 * The editor submits every field it shows, but rewriting an untouched one is not harmless:
 * a title or text written back as plain text loses its bold, links and mentions, and an
 * unchanged value written over a newer edit made in Notion meanwhile would revert it. So
 * only fields whose value actually differs are sent.
 */
export function isUnchangedValue(update: NotionPropertyUpdate, current: PropertyValue | undefined): boolean {
  if (!current) return false;
  switch (current.type) {
    case "title":
    case "rich_text": {
      const next = (update[current.type] as { text: { content: string } }[] | undefined) ?? [];
      const nextText = next.map((part) => part.text.content).join("");
      const currentItems = current.type === "title" ? current.title : current.rich_text;
      return nextText === currentItems.map((part) => part.plain_text).join("");
    }
    case "number":
      return update.number === current.number;
    case "url":
      return (update.url ?? null) === current.url;
    case "email":
      return (update.email ?? null) === current.email;
    case "phone_number":
      return (update.phone_number ?? null) === current.phone_number;
    case "checkbox":
      return update.checkbox === current.checkbox;
    case "date": {
      const next = update.date as { start: string; end: string | null } | null;
      if (!next || !current.date) return !next && !current.date;
      return sameInstant(next.start, current.date.start) && sameInstant(next.end, current.date.end);
    }
    case "select":
      return ((update.select as { name: string } | null)?.name ?? null) === (current.select?.name ?? null);
    case "status":
      return ((update.status as { name: string } | null)?.name ?? null) === (current.status?.name ?? null);
    case "multi_select": {
      const next = ((update.multi_select as { name: string }[]) ?? []).map((option) => option.name).sort();
      const now = current.multi_select.map((option) => option.name).sort();
      return next.length === now.length && next.every((name, index) => name === now[index]);
    }
    default:
      return false;
  }
}
