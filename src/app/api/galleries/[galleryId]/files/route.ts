import type { NextRequest } from "next/server";
import { isFullPage, type PageObjectResponse } from "@notionhq/client";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot, snapshotPage } from "@/lib/gallery-notion-cache";
import { getNotionClient } from "@/lib/notion";
import { propertyById } from "@/lib/page-properties";
import { isSafePageId } from "@/lib/cover-store";
import { safeHref } from "@/lib/notion-url";

/** Leave a margin so a URL is never handed out seconds before it dies. */
const EXPIRY_MARGIN_MS = 60 * 1000;

type FileEntry = Extract<PageObjectResponse["properties"][string], { type: "files" }>["files"][number];

function fileAt(page: PageObjectResponse | undefined, propertyId: string, index: number): FileEntry | null {
  if (!page) return null;
  const value = propertyById(page, propertyId);
  return value?.type === "files" ? (value.files[index] ?? null) : null;
}

function isFresh(file: FileEntry): boolean {
  if (file.type === "external") return true;
  return Date.parse(file.file.expiry_time) - EXPIRY_MARGIN_MS > Date.now();
}

/**
 * Opens a file stored in a Files property.
 *
 * Notion signs its file URLs for about an hour, while a Gallery snapshot can be older than
 * that — so links on cards point here, and this redirects to the snapshot's URL while it is
 * still valid, or to a freshly signed one from Notion when it is not.
 */
export async function GET(request: NextRequest, ctx: RouteContext<"/api/galleries/[galleryId]/files">) {
  const { galleryId } = await ctx.params;
  const params = request.nextUrl.searchParams;
  const pageId = params.get("page") ?? "";
  const propertyId = params.get("prop") ?? "";
  const index = Number.parseInt(params.get("i") ?? "0", 10);
  if (!isSafePageId(pageId) || !propertyId || !Number.isInteger(index) || index < 0) {
    return new Response("Bad request", { status: 400 });
  }

  const gallery = await db.gallery.findUnique({ where: { id: galleryId }, include: { workspace: true } });
  if (!gallery) return new Response("Not found", { status: 404 });

  let file: FileEntry | null = null;
  try {
    const snapshot = await getGalleryNotionSnapshot({
      galleryId,
      dataSourceId: gallery.notionDataSourceId,
      accessToken: gallery.workspace.accessToken,
    });
    file = fileAt(snapshotPage(snapshot, pageId), propertyId, index);
  } catch {
    file = null;
  }

  if (!file || !isFresh(file)) {
    try {
      const page = await getNotionClient(gallery.workspace.accessToken).pages.retrieve({ page_id: pageId });
      file = isFullPage(page) ? fileAt(page, propertyId, index) : null;
    } catch {
      return new Response("Không mở được tệp — Notion không trả lời.", { status: 502 });
    }
  }
  if (!file) return new Response("Tệp không còn tồn tại.", { status: 404 });

  const target = safeHref(file.type === "external" ? file.external.url : file.file.url);
  if (!target) return new Response("Đường dẫn tệp không hợp lệ.", { status: 400 });
  return Response.redirect(target, 302);
}
