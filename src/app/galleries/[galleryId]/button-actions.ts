"use server";

import { revalidatePath } from "next/cache";
import { isFullDataSource, isFullPage, type PageObjectResponse, type UpdatePageParameters } from "@notionhq/client";
import { db } from "@/lib/db";
import { parseDisplayConfig } from "@/lib/display-config";
import { getGalleryNotionSnapshot, patchGalleryNotionSnapshot, snapshotPage } from "@/lib/gallery-notion-cache";
import { parseNativeButton, type ButtonAction } from "@/lib/native-button";
import { getNotionClient } from "@/lib/notion";
import { NOTION_PROBLEM_COPY, classifyNotionError } from "@/lib/notion-errors";
import { propertyById } from "@/lib/page-properties";

export type RunButtonResult = { error: string | null };

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

/** Runs the actions a native button is configured with, as one Notion write. */
export async function runNativeButton(
  galleryId: string,
  pageId: string,
  buttonPropertyId: string,
): Promise<RunButtonResult> {
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: { where: { notionPropertyId: buttonPropertyId } } },
  });
  if (!gallery) return { error: "Gallery không còn tồn tại." };
  const config = gallery.propertyConfigs[0]
    ? parseNativeButton(parseDisplayConfig(gallery.propertyConfigs[0].displayConfig).button)
    : null;
  if (!config) return { error: "Nút này chưa có hành động. Cấu hình ở Cài đặt hiển thị." };

  const notion = getNotionClient(gallery.workspace.accessToken);
  try {
    const snapshot = await getGalleryNotionSnapshot({
      galleryId,
      dataSourceId: gallery.notionDataSourceId,
      accessToken: gallery.workspace.accessToken,
    });
    const dataSource = isFullDataSource(snapshot.dataSourceRes) ? snapshot.dataSourceRes : null;
    if (!dataSource) return { error: "Không đọc được cấu trúc database." };
    const schemaById = new Map(Object.entries(dataSource.properties).map(([name, schema]) => [schema.id, { name, type: schema.type }]));

    // Counting and toggling must start from Notion's current value, not a minute-old copy.
    let page = snapshotPage(snapshot, pageId);
    if (!page || config.actions.some((action) => READS_CURRENT.has(action.op))) {
      const fresh = await notion.pages.retrieve({ page_id: pageId });
      if (isFullPage(fresh)) page = fresh;
    }

    const now = new Date();
    const working = new Map<string, unknown>();
    const properties: Record<string, unknown> = {};
    for (const action of config.actions) {
      const schema = schemaById.get(action.propertyId);
      if (!schema) {
        continue;
      }
      const current = working.has(action.propertyId)
        ? working.get(action.propertyId)
        : currentOf(page ? propertyById(page, action.propertyId) : undefined);
      const update = applyAction(schema.type, action, current, now);
      if (!update) {
        continue;
      }
      properties[schema.name] = update;
      const written = Object.values(update)[0];
      working.set(
        action.propertyId,
        Array.isArray(written) ? written.map((option: { name?: string }) => option.name) : written,
      );
    }
    if (Object.keys(properties).length === 0) {
      return { error: "Không hành động nào áp dụng được — property đích có thể đã bị đổi kiểu hoặc xoá." };
    }

    const updated = await notion.pages.update({
      page_id: pageId,
      properties: properties as UpdatePageParameters["properties"],
    });
    const full = isFullPage(updated) ? updated : await notion.pages.retrieve({ page_id: pageId });
    if (isFullPage(full)) await patchGalleryNotionSnapshot(galleryId, full);
  } catch (error) {
    const problem = classifyNotionError(error);
    return {
      error:
        problem === "unavailable"
          ? "Notion từ chối — có thể một giá trị không khớp option của property."
          : NOTION_PROBLEM_COPY[problem].title,
    };
  }

  revalidatePath(`/galleries/${galleryId}`);
  revalidatePath(`/galleries/${galleryId}/items/${pageId}`);
  return { error: null };
}
