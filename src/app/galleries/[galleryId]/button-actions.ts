"use server";

import { revalidatePath } from "next/cache";
import {
  isFullDataSource,
  isFullPage,
  type Client,
  type CreatePageParameters,
  type DataSourceObjectResponse,
  type PageObjectResponse,
  type UpdatePageParameters,
} from "@notionhq/client";
import { db } from "@/lib/db";
import { parseDisplayConfig } from "@/lib/display-config";
import { getGalleryNotionSnapshot, patchGalleryNotionSnapshot, snapshotPage } from "@/lib/gallery-notion-cache";
import { buildItemFields, defaultFormLayout, type FieldData } from "@/lib/item-fields";
import {
  TITLE_FIELD_ID,
  isRoundCover,
  resolveCardLayout,
  type CardEligibleProperty,
  type CardLayout,
  type ResolvedCardLayout,
} from "@/lib/card-layout";
import { asFormLayout } from "@/lib/card-layout-edit";
import { imageSlotFor } from "@/lib/cover-write";
import { parseViewLayoutConfig } from "@/lib/gallery-view";
import {
  CONTENT_IMAGE,
  PAGE_COVER,
  findFirstImageUrl,
  parseGalleryConfig,
  resolveCoverUrl,
  resolveDetailCoverShape,
} from "@/lib/notion-cover";
import {
  STEP_LABELS,
  isOpenStep,
  parseNativeButton,
  type AddValue,
  type ButtonAction,
  type ButtonStep,
  type FieldPrefill,
  type FormPrefill,
} from "@/lib/native-button";
import { getNotionClient } from "@/lib/notion";
import { NOTION_PROBLEM_COPY, classifyNotionError } from "@/lib/notion-errors";
import { propertyById } from "@/lib/page-properties";

export type ButtonRecord = { galleryId: string; pageId: string };
/** A record to edit, in the button's own form layout or (absent) the gallery's edit form. */
export type ButtonFormTarget = ButtonRecord & { layout?: CardLayout; prefill?: FormPrefill };

export type RunButtonResult = {
  error: string | null;
  /** A form to open now that the writes have landed. */
  open?: ButtonFormTarget;
  /** A record to show in its Card Detail now that the writes have landed. */
  view?: ButtonRecord;
};

/**
 * Ceiling on linked records one press edits. Each costs a Notion request (two when the
 * change reads the current value) at ~3 per second, so 50 is already ~20 seconds.
 */
const MAX_RELATED = 50;

const pad = (value: number) => String(value).padStart(2, "0");

function localDate(now: Date): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function localDateTime(now: Date): string {
  const offset = -now.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  return `${localDate(now)}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${sign}${pad(
    Math.floor(Math.abs(offset) / 60),
  )}:${pad(Math.abs(offset) % 60)}`;
}

/** Ops that read the current value, so they need the page as Notion has it right now. */
const READS_CURRENT = new Set(["increment", "toggle", "add", "remove"]);

/**
 * The value one action writes, given what the property holds now (or what an earlier
 * action on the same property already set it to). Null means the action cannot apply.
 */
function applyAction(
  type: string,
  action: ButtonAction,
  current: unknown,
  now: Date,
): Record<string, unknown> | null {
  const value = action.value ?? "";
  switch (action.op) {
    case "clear":
      if (type === "multi_select") return { multi_select: [] };
      if (type === "rich_text") return { rich_text: [] };
      if (type === "checkbox") return { checkbox: false };
      return { [type]: null };
    case "set":
      if (type === "select" || type === "status") return { [type]: value ? { name: value } : null };
      if (type === "rich_text") return { rich_text: value ? [{ text: { content: value.slice(0, 2000) } }] : [] };
      if (type === "number") {
        const number = Number(value.replace(",", "."));
        return value.trim() === "" ? { number: null } : Number.isFinite(number) ? { number } : null;
      }
      if (type === "url" || type === "email" || type === "phone_number") return { [type]: value || null };
      return null;
    case "today":
      return type === "date" ? { date: { start: localDate(now) } } : null;
    case "now":
      return type === "date" ? { date: { start: localDateTime(now) } } : null;
    case "increment": {
      if (type !== "number") return null;
      const step = Number(value.replace(",", "."));
      if (!Number.isFinite(step)) return null;
      const base = typeof current === "number" ? current : 0;
      // Rounded to sidestep 0.1 + 0.2 landing in Notion as 0.30000000000000004.
      return { number: Math.round((base + step) * 1e9) / 1e9 };
    }
    case "check":
      return type === "checkbox" ? { checkbox: true } : null;
    case "uncheck":
      return type === "checkbox" ? { checkbox: false } : null;
    case "toggle":
      return type === "checkbox" ? { checkbox: !current } : null;
    case "add":
    case "remove": {
      if (type !== "multi_select" || !value) return null;
      const names = Array.isArray(current) ? (current as string[]) : [];
      const next = action.op === "add" ? [...new Set([...names, value])] : names.filter((name) => name !== value);
      return { multi_select: next.map((name) => ({ name })) };
    }
    default:
      return null;
  }
}

/** The comparable current value of a property, as the actions above read it. */
function currentOf(value: PageObjectResponse["properties"][string] | undefined): unknown {
  if (!value) return undefined;
  if (value.type === "number") return value.number;
  if (value.type === "checkbox") return value.checkbox;
  if (value.type === "multi_select") return value.multi_select.map((option) => option.name);
  return undefined;
}

/** A property value as plain text, for copying into a text-like property. */
function plainText(value: PageObjectResponse["properties"][string]): string {
  switch (value.type) {
    case "title":
      return value.title.map((part) => part.plain_text).join("");
    case "rich_text":
      return value.rich_text.map((part) => part.plain_text).join("");
    case "url":
      return value.url ?? "";
    case "email":
      return value.email ?? "";
    case "phone_number":
      return value.phone_number ?? "";
    case "select":
      return value.select?.name ?? "";
    case "status":
      return value.status?.name ?? "";
    case "number":
      return value.number === null ? "" : String(value.number);
    default:
      return "";
  }
}

/** The write payload for a property of `type` holding `text`. Null when it cannot hold it. */
function fromText(type: string, text: string): Record<string, unknown> | null {
  const content = text.slice(0, 2000);
  switch (type) {
    case "title":
    case "rich_text":
      return { [type]: content ? [{ text: { content } }] : [] };
    case "url":
    case "email":
    case "phone_number":
      return { [type]: content || null };
    case "select":
    case "status":
      return { [type]: content ? { name: content } : null };
    case "multi_select":
      return {
        multi_select: content
          .split(",")
          .map((name) => name.trim())
          .filter(Boolean)
          .map((name) => ({ name })),
      };
    case "number": {
      if (content.trim() === "") return { number: null };
      const number = Number(content.replace(",", "."));
      return Number.isFinite(number) ? { number } : null;
    }
    case "checkbox":
      return { checkbox: content === "true" };
    case "date":
      return { date: content ? { start: content } : null };
    default:
      return null;
  }
}

/** One value of a newly added record. Null when the source cannot fill this type. */
function addValuePayload(
  type: string,
  entry: AddValue,
  source: PageObjectResponse,
  now: Date,
): Record<string, unknown> | null {
  switch (entry.source) {
    case "fixed":
      return fromText(type, entry.value ?? "");
    case "today":
      return type === "date" ? { date: { start: localDate(now) } } : null;
    case "now":
      return type === "date" ? { date: { start: localDateTime(now) } } : null;
    case "this":
      return type === "relation" ? { relation: [{ id: source.id }] } : null;
    case "copy": {
      const from = entry.value ? propertyById(source, entry.value) : undefined;
      if (!from) return null;
      if (type === "relation" && from.type === "relation") return { relation: from.relation.map(({ id }) => ({ id })) };
      if (type === "date" && from.type === "date") return { date: from.date ? { start: from.date.start, end: from.date.end } : null };
      if (type === "checkbox" && from.type === "checkbox") return { checkbox: from.checkbox };
      if (type === "number" && from.type === "number") return { number: from.number };
      if (type === "multi_select" && from.type === "multi_select") {
        return { multi_select: from.multi_select.map(({ name }) => ({ name })) };
      }
      return fromText(type, plainText(from));
    }
    default:
      return null;
  }
}

type GalleryRow = Awaited<ReturnType<typeof loadGalleryRow>>;

function loadGalleryRow(galleryId: string) {
  return db.gallery.findUnique({
    where: { id: galleryId },
    include: {
      workspace: true,
      propertyConfigs: true,
      views: { orderBy: { sortOrder: "asc" }, select: { id: true, layoutConfig: true } },
    },
  });
}

type LoadedGallery = {
  row: NonNullable<GalleryRow>;
  dataSource: DataSourceObjectResponse;
  snapshot: Awaited<ReturnType<typeof getGalleryNotionSnapshot>>;
  schemaById: Map<string, { name: string; type: string; relationDataSourceId?: string }>;
};

async function loadGallery(galleryId: string): Promise<LoadedGallery | null> {
  const row = await loadGalleryRow(galleryId);
  if (!row || row.deletedAt) return null;
  const snapshot = await getGalleryNotionSnapshot({
    galleryId,
    dataSourceId: row.notionDataSourceId,
    accessToken: row.workspace.accessToken,
  });
  if (!isFullDataSource(snapshot.dataSourceRes)) return null;
  const dataSource = snapshot.dataSourceRes;
  const schemaById = new Map(
    Object.entries(dataSource.properties).map(([name, schema]) => [
      schema.id,
      {
        name,
        type: schema.type,
        ...(schema.type === "relation" ? { relationDataSourceId: schema.relation.data_source_id } : {}),
      },
    ]),
  );
  return { row, dataSource, snapshot, schemaById };
}

/** A page as Notion has it now when the change depends on it, else the snapshot's copy. */
async function pageFor(
  notion: Client,
  gallery: LoadedGallery,
  pageId: string,
  fresh: boolean,
): Promise<PageObjectResponse | undefined> {
  const cached = snapshotPage(gallery.snapshot, pageId);
  if (cached && !fresh) return cached;
  const retrieved = await notion.pages.retrieve({ page_id: pageId });
  return isFullPage(retrieved) ? retrieved : cached;
}

/** The changes `actions` make to `page`, keyed by property id — what `pages.update` takes. */
function changesFor(
  gallery: LoadedGallery,
  actions: ButtonAction[],
  page: PageObjectResponse | undefined,
  now: Date,
): Record<string, unknown> {
  const working = new Map<string, unknown>();
  const properties: Record<string, unknown> = {};
  for (const action of actions) {
    const schema = gallery.schemaById.get(action.propertyId);
    if (!schema) continue;
    const current = working.has(action.propertyId)
      ? working.get(action.propertyId)
      : currentOf(page ? propertyById(page, action.propertyId) : undefined);
    const update = applyAction(schema.type, action, current, now);
    if (!update) continue;
    properties[action.propertyId] = update;
    const written = Object.values(update)[0];
    working.set(
      action.propertyId,
      Array.isArray(written) ? written.map((option: { name?: string }) => option.name) : written,
    );
  }
  return properties;
}

/** Writes and brings the gallery's local copy up to date. A failed refresh is not a failed write. */
async function updatePage(notion: Client, galleryId: string, pageId: string, properties: Record<string, unknown>) {
  const updated = await notion.pages.update({
    page_id: pageId,
    properties: properties as UpdatePageParameters["properties"],
  });
  try {
    const full = isFullPage(updated) ? updated : await notion.pages.retrieve({ page_id: pageId });
    if (isFullPage(full)) await patchGalleryNotionSnapshot(galleryId, full);
  } catch (error) {
    console.error("Post-button bookkeeping failed", error);
  }
}

/**
 * Every page linked through a relation. A page object lists at most 25; past that, only
 * the property endpoint has them all.
 */
async function relatedPageIds(notion: Client, page: PageObjectResponse, relationPropertyId: string): Promise<string[]> {
  const inline = propertyById(page, relationPropertyId);
  if (inline?.type !== "relation") return [];
  // Notion sends `has_more` on a page's relation value; the SDK's type leaves it out.
  if (!(inline as { has_more?: boolean }).has_more) return inline.relation.map(({ id }) => id);
  const ids: string[] = [];
  let cursor: string | undefined;
  do {
    const response = await notion.pages.properties.retrieve({
      page_id: page.id,
      property_id: relationPropertyId,
      ...(cursor ? { start_cursor: cursor } : {}),
    });
    if (!("results" in response)) break;
    for (const item of response.results) if (item.type === "relation") ids.push(item.relation.id);
    cursor = response.has_more ? (response.next_cursor ?? undefined) : undefined;
  } while (cursor && ids.length <= MAX_RELATED);
  return ids;
}

class StepError extends Error {}

/** Runs the steps a native button is configured with, in order. */
export async function runNativeButton(
  galleryId: string,
  pageId: string,
  buttonPropertyId: string,
): Promise<RunButtonResult> {
  const config = await db.propertyConfig
    .findFirst({ where: { galleryId, notionPropertyId: buttonPropertyId }, select: { displayConfig: true } })
    .then((row) => (row ? parseNativeButton(parseDisplayConfig(row.displayConfig).button) : null));
  if (!config) return { error: "Nút này chưa có hành động. Bấm “Cấu hình nút” ở Bố cục card." };

  const now = new Date();
  const touched = new Set<string>([galleryId]);
  let added: { galleryId: string; pageId: string } | null = null;
  let open: ButtonFormTarget | undefined;
  let view: ButtonRecord | undefined;
  let done = 0;
  const writes = config.steps.filter((step) => !isOpenStep(step)).length;

  try {
    const home = await loadGallery(galleryId);
    if (!home) return { error: "Gallery không còn tồn tại hoặc không đọc được." };
    const notion = getNotionClient(home.row.workspace.accessToken);

    const runStep = async (step: ButtonStep) => {
      switch (step.kind) {
        case "edit_this": {
          const fresh = step.actions.some((action) => READS_CURRENT.has(action.op));
          const page = await pageFor(notion, home, pageId, fresh);
          const properties = changesFor(home, step.actions, page, now);
          if (Object.keys(properties).length === 0) {
            throw new StepError("không thay đổi nào áp dụng được — property có thể đã đổi kiểu hoặc bị xoá");
          }
          await updatePage(notion, galleryId, pageId, properties);
          return;
        }
        case "edit_related": {
          const relation = home.schemaById.get(step.relationPropertyId);
          if (!relation?.relationDataSourceId) throw new StepError("property relation không còn");
          const target = await db.gallery.findFirst({
            where: {
              workspaceId: home.row.workspaceId,
              notionDataSourceId: relation.relationDataSourceId,
              deletedAt: null,
            },
            select: { id: true },
          });
          if (!target) throw new StepError(`bảng mà “${relation.name}” trỏ tới chưa có trong Hallery`);
          const linked = await loadGallery(target.id);
          if (!linked) throw new StepError("không đọc được gallery liên kết");
          // The relation as Notion has it now — a link added a minute ago must count.
          const page = await pageFor(notion, home, pageId, true);
          if (!page) throw new StepError("không đọc được record này");
          const ids = await relatedPageIds(notion, page, step.relationPropertyId);
          if (ids.length > MAX_RELATED) {
            throw new StepError(`có ${ids.length} record liên kết — quá ${MAX_RELATED}, không chạy để tránh ghi hàng loạt`);
          }
          const fresh = step.actions.some((action) => READS_CURRENT.has(action.op));
          for (const id of ids) {
            const related = await pageFor(notion, linked, id, fresh);
            const properties = changesFor(linked, step.actions, related, now);
            if (Object.keys(properties).length) await updatePage(notion, linked.row.id, id, properties);
          }
          touched.add(linked.row.id);
          return;
        }
        case "add": {
          const target = step.galleryId === galleryId ? home : await loadGallery(step.galleryId);
          if (!target || target.row.workspaceId !== home.row.workspaceId) {
            throw new StepError("gallery đích không còn trong workspace này");
          }
          const source = await pageFor(notion, home, pageId, step.values.some((value) => value.source === "copy"));
          if (!source) throw new StepError("không đọc được record này");
          const properties: Record<string, unknown> = {};
          for (const entry of step.values) {
            const schema = target.schemaById.get(entry.propertyId);
            if (!schema) continue;
            const payload = addValuePayload(schema.type, entry, source, now);
            if (payload) properties[entry.propertyId] = payload;
          }
          const created = await notion.pages.create({
            parent: { data_source_id: target.row.notionDataSourceId },
            properties: properties as CreatePageParameters["properties"],
          });
          added = { galleryId: target.row.id, pageId: created.id };
          try {
            const full = isFullPage(created) ? created : await notion.pages.retrieve({ page_id: created.id });
            if (isFullPage(full)) await patchGalleryNotionSnapshot(target.row.id, full);
          } catch (error) {
            console.error("Post-button bookkeeping failed", error);
          }
          touched.add(target.row.id);
          return;
        }
        case "open_view":
        case "open_form": {
          if (step.target === "added" && !added) throw new StepError("không có record nào vừa được thêm để mở");
          const record = step.target === "added" && added ? added : { galleryId, pageId };
          if (step.kind === "open_view") view = record;
          else {
            open = {
              ...record,
              ...(step.layout ? { layout: step.layout } : {}),
              ...(step.prefill ? { prefill: step.prefill } : {}),
            };
          }
          return;
        }
      }
    };

    for (const step of config.steps) {
      await runStep(step);
      if (!isOpenStep(step)) done += 1;
    }
  } catch (error) {
    const step = config.steps[done];
    const where = writes > 1 && step ? `Bước ${done + 1} (${STEP_LABELS[step.kind]}) lỗi: ` : "";
    const landed = done > 0 ? ` ${done} bước trước đã chạy xong.` : "";
    const reason =
      error instanceof StepError
        ? error.message
        : classifyNotionError(error) === "unavailable"
          ? "Notion từ chối — có thể một giá trị không khớp kiểu hoặc option của property"
          : NOTION_PROBLEM_COPY[classifyNotionError(error)].title;
    revalidateAll(touched);
    const message = `${where}${reason}.${landed}`;
    return { error: message.charAt(0).toUpperCase() + message.slice(1) };
  }

  revalidateAll(touched);
  return { error: null, ...(open ? { open } : {}), ...(view ? { view } : {}) };
}

function revalidateAll(galleryIds: Set<string>) {
  for (const id of galleryIds) {
    revalidatePath(`/galleries/${id}`);
    revalidatePath(`/galleries/${id}/items/[pageId]`, "page");
  }
}

/** Plain text as Notion's rich text, the shape the form's inputs read a value from. */
function richText(text: string) {
  return text
    ? [
        {
          type: "text",
          text: { content: text, link: null },
          annotations: { bold: false, italic: false, strikethrough: false, underline: false, code: false, color: "default" },
          plain_text: text,
          href: null,
        },
      ]
    : [];
}

/**
 * A field as the form should open it: holding the button's preset instead of the record's
 * current value. The preset is only a starting point — nothing is written until "Lưu".
 */
function withPrefill(field: FieldData, prefill: FieldPrefill | undefined, now: Date): FieldData {
  if (!prefill || !field.editable) return field;
  const text = prefill.mode === "static" ? (prefill.value ?? "") : "";
  const option = (name: string) => ({ id: "", name, color: "default" });
  let next: unknown;
  switch (field.value.type) {
    case "title":
    case "rich_text":
      next = richText(text);
      break;
    case "number": {
      const number = Number(text.replace(",", "."));
      next = text.trim() && Number.isFinite(number) ? number : null;
      break;
    }
    case "select":
    case "status":
      next = text ? option(text) : null;
      break;
    case "multi_select":
      next = text
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
        .map(option);
      break;
    case "checkbox":
      next = text === "true";
      break;
    case "date": {
      const start =
        prefill.mode === "today" ? localDate(now) : prefill.mode === "now" ? localDateTime(now) : text || null;
      next = start ? { start, end: null, time_zone: null } : null;
      break;
    }
    case "url":
    case "email":
    case "phone_number":
      next = text || null;
      break;
    default:
      return field;
  }
  return {
    ...field,
    prefilled: true,
    value: { ...field.value, [field.value.type]: next } as FieldData["value"],
  };
}

export type ButtonFormData =
  | { error: string }
  | {
      error: null;
      galleryName: string;
      recordTitle: string;
      /** Present when the form lays the title out; it is drawn above the grid. */
      titleField: FieldData | null;
      fields: FieldData[];
      layout: ResolvedCardLayout<CardEligibleProperty>;
      image: ButtonFormImage | null;
    };

export type ButtonFormImage = {
  slot: { target: string; acceptsUpload: boolean; targetLabel: string };
  url: string | null;
  ratio: string;
  round: boolean;
};

/**
 * One record's form, laid out the way the button's form designer arranged it — or as the
 * gallery's own edit form when the button has none. Values are Notion's current ones.
 */
export async function loadButtonForm(target: ButtonFormTarget): Promise<ButtonFormData> {
  try {
    const gallery = await loadGallery(target.galleryId);
    if (!gallery) return { error: "Gallery không còn tồn tại hoặc không đọc được." };
    const notion = getNotionClient(gallery.row.workspace.accessToken);
    const page = await pageFor(notion, gallery, target.pageId, true);
    if (!page) return { error: "Không đọc được record này." };
    const { titleField, fields } = buildItemFields(page, gallery.dataSource, gallery.row.propertyConfigs);
    const now = new Date();
    const source = target.layout
      ? asFormLayout(target.layout)
      : defaultFormLayout(gallery.row, gallery.row.propertyConfigs);
    // Buttons inside a form would be a second way to run things mid-edit; the form leaves them out.
    const layout = resolveCardLayout(
      source,
      gallery.row.propertyConfigs.filter((config) => config.notionPropertyType !== "button"),
      undefined,
    );
    const hasTitle = Object.values(layout.regions).some((grid) =>
      grid.boxes.some((box) => box.fields.some((field) => field.isTitle)),
    );

    // The picture slot, when the form has one: it changes the picture where the gallery's
    // first view reads it from, starting from the one the record has now.
    let image: ButtonFormImage | null = null;
    if (layout.cover !== "none") {
      const legacy = parseGalleryConfig(gallery.row.displayConfig);
      const view = gallery.row.views[0];
      const coverSource = (view ? parseViewLayoutConfig(view.layoutConfig, legacy) : legacy).coverSource ?? PAGE_COVER;
      const slot = imageSlotFor(coverSource, gallery.dataSource);
      if (slot) {
        const shape = resolveDetailCoverShape(legacy);
        image = {
          slot,
          url:
            coverSource === CONTENT_IMAGE
              ? await findFirstImageUrl(notion, page.id).catch(() => null)
              : resolveCoverUrl(page, coverSource),
          ratio: shape.ratio.replace(":", " / "),
          round: isRoundCover(shape.aspect),
        };
      }
    }

    return {
      error: null,
      galleryName: gallery.row.name,
      recordTitle: titleField ? plainText(titleField.value) : "",
      titleField: hasTitle && titleField ? withPrefill(titleField, target.prefill?.[TITLE_FIELD_ID], now) : null,
      fields: fields
        .filter((field) => field.type !== "button")
        .map((field) => withPrefill(field, target.prefill?.[field.propertyId], now)),
      layout,
      image,
    };
  } catch (error) {
    return { error: NOTION_PROBLEM_COPY[classifyNotionError(error)].title };
  }
}
