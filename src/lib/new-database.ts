/**
 * The shape of a database Hallery creates in Notion — the one place Hallery writes schema,
 * and only ever for a database it is making from nothing. Existing databases stay read-only
 * as far as structure goes.
 *
 * Shared by the form (client) and the action (server), so both agree on what is allowed.
 */

/** Column types offered when creating a database: the ones a gallery reads and writes well. */
export const NEW_PROPERTY_TYPES = [
  { type: "files", label: "Ảnh / tệp" },
  { type: "rich_text", label: "Văn bản" },
  { type: "number", label: "Số" },
  { type: "select", label: "Chọn một" },
  { type: "multi_select", label: "Chọn nhiều" },
  { type: "date", label: "Ngày" },
  { type: "checkbox", label: "Checkbox" },
  { type: "url", label: "URL" },
  { type: "email", label: "Email" },
  { type: "phone_number", label: "Số điện thoại" },
  { type: "people", label: "Người" },
] as const;

export type NewPropertyType = (typeof NEW_PROPERTY_TYPES)[number]["type"];

export type NewProperty = { name: string; type: NewPropertyType };

export type NewDatabaseInput = {
  parentPageId: string;
  title: string;
  /** One emoji, or empty for none. */
  icon: string;
  /** Name of the title column — every Notion database has exactly one. */
  titleName: string;
  properties: NewProperty[];
};

export const NEW_DATABASE_DEFAULTS: Pick<NewDatabaseInput, "titleName" | "properties"> = {
  titleName: "Tên",
  properties: [
    { name: "Ảnh", type: "files" },
    { name: "Tags", type: "multi_select" },
  ],
};

const MAX_PROPERTIES = 30;
const KNOWN_TYPES = new Set<string>(NEW_PROPERTY_TYPES.map((entry) => entry.type));

/** Trims and checks the input; returns the cleaned input or a Vietnamese reason it can't go. */
export function validateNewDatabase(input: NewDatabaseInput): { ok: true; value: NewDatabaseInput } | { ok: false; error: string } {
  const title = input.title.trim().slice(0, 200);
  if (!title) return { ok: false, error: "Đặt tên cho database." };
  if (!input.parentPageId) return { ok: false, error: "Chọn trang Notion sẽ chứa database." };
  const titleName = input.titleName.trim().slice(0, 100) || "Tên";
  const icon = input.icon.trim();
  // Notion rejects anything that is not a single emoji; a long string is never one.
  if ([...icon].length > 8) return { ok: false, error: "Icon chỉ nhận một emoji." };

  const properties: NewProperty[] = [];
  const seen = new Set([titleName.toLowerCase()]);
  for (const raw of input.properties) {
    const name = raw.name.trim().slice(0, 100);
    if (!name) continue;
    if (!KNOWN_TYPES.has(raw.type)) return { ok: false, error: `Kiểu cột “${name}” không hợp lệ.` };
    if (seen.has(name.toLowerCase())) return { ok: false, error: `Tên cột “${name}” bị trùng.` };
    seen.add(name.toLowerCase());
    properties.push({ name, type: raw.type });
  }
  if (properties.length > MAX_PROPERTIES) return { ok: false, error: `Tối đa ${MAX_PROPERTIES} cột khi tạo.` };

  return { ok: true, value: { parentPageId: input.parentPageId, title, icon, titleName, properties } };
}

/** The `initial_data_source.properties` body Notion expects for these columns. */
export function notionPropertiesOf(input: NewDatabaseInput) {
  const body: Record<string, Record<string, unknown>> = { [input.titleName]: { title: {} } };
  for (const property of input.properties) {
    body[property.name] =
      property.type === "number"
        ? { number: { format: "number" } }
        : property.type === "select" || property.type === "multi_select"
          ? { [property.type]: { options: [] } }
          : { [property.type]: {} };
  }
  return body;
}
