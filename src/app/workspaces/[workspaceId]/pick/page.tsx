import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullDataSource, type DataSourceObjectResponse } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { classifyNotionError, NOTION_PROBLEM_COPY, type NotionProblem } from "@/lib/notion-errors";
import { NOTION_CONNECTIONS_HELP_URL, NOTION_INTEGRATIONS_URL, notionPageUrl } from "@/lib/notion-url";
import { DataSourcePicker, type PickableDataSource } from "./data-source-picker";

export const metadata: Metadata = { title: "Chọn database" };

/** Enough for any real workspace; a runaway search still stops. */
const MAX_SEARCH_PAGES = 10;

async function listSharedDataSources(accessToken: string): Promise<DataSourceObjectResponse[] | NotionProblem> {
  const notion = getNotionClient(accessToken);
  const found: DataSourceObjectResponse[] = [];
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const response = await notion.search({
        filter: { property: "object", value: "data_source" },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      found.push(...response.results.filter(isFullDataSource));
      if (!response.has_more || !response.next_cursor) break;
      cursor = response.next_cursor;
    }
    return found;
  } catch (error) {
    return classifyNotionError(error);
  }
}

function iconOf(source: DataSourceObjectResponse): string | null {
  const icon = (source as { icon?: { type: string; emoji?: string } | null }).icon;
  return icon?.type === "emoji" && icon.emoji ? icon.emoji : null;
}

export default async function PickDatabasePage({ params, searchParams }: PageProps<"/workspaces/[workspaceId]/pick">) {
  const { workspaceId } = await params;
  const { reconnected } = await searchParams;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) notFound();

  const [alreadyAdded, result] = await Promise.all([
    db.gallery.findMany({
      where: { workspaceId },
      select: { id: true, notionDataSourceId: true, autoAdded: true, deletedAt: true },
    }),
    listSharedDataSources(workspace.accessToken),
  ]);
  const addedBySource = new Map(alreadyAdded.map((gallery) => [gallery.notionDataSourceId, gallery]));

  const sources: PickableDataSource[] =
    typeof result === "string"
      ? []
      : result
          .map((source) => {
            const databaseId = source.database_parent.type === "database_id" ? source.database_parent.database_id : source.id;
            const added = addedBySource.get(source.id);
            return {
              id: source.id,
              databaseId,
              title: source.title.map((t) => t.plain_text).join("") || "Untitled",
              icon: iconOf(source),
              notionUrl: notionPageUrl(databaseId),
              // An auto-added or trashed gallery can still be picked: picking promotes it.
              galleryId: added && !added.autoAdded && !added.deletedAt ? added.id : null,
              editedAt: source.last_edited_time,
            };
          })
          .sort((a, b) => Date.parse(b.editedAt) - Date.parse(a.editedAt));

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-10 sm:px-6 sm:py-14">
      <Link href="/" className="text-xs text-muted hover:text-ink hover:underline">
        ← Trang chủ
      </Link>
      <p className="eyebrow mt-4">{workspace.name}</p>
      <h1 className="mt-1 text-2xl font-semibold text-ink">Chọn database làm Gallery</h1>
      <p className="mt-2 text-sm leading-relaxed text-ink-soft">
        Danh sách chỉ gồm database đã được chia sẻ với integration. Không thấy database cần dùng? Mở nó trong Notion →{" "}
        <b>•••</b> → <b>Connections</b> → chọn integration, rồi tải lại trang này.
      </p>

      {reconnected === "1" && (
        <p role="status" className="mt-4 rounded-lg border border-brand-line bg-brand-soft px-4 py-3 text-sm text-brand-hover">
          ✓ Đã cập nhật token. Các gallery của workspace này dùng token mới ngay.
        </p>
      )}

      {typeof result === "string" ? (
        <div className="mt-8 rounded-xl border border-amber-300 bg-amber-50 px-5 py-4 text-sm text-amber-900">
          <p className="font-medium">{NOTION_PROBLEM_COPY[result].title}</p>
          <p className="mt-1">{NOTION_PROBLEM_COPY[result].body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {result === "unauthorized" && (
              <Link href={`/connect?workspace=${workspace.id}`} className="btn btn-primary btn-sm">
                Kết nối lại token
              </Link>
            )}
            <a href={`/workspaces/${workspace.id}/pick`} className="btn btn-secondary btn-sm">
              Thử lại
            </a>
          </div>
        </div>
      ) : sources.length === 0 ? (
        <div className="empty-state mt-8 flex flex-col items-center gap-3">
          <p className="font-medium text-ink">Integration này chưa được chia sẻ database nào.</p>
          <p className="max-w-md">
            Mở database trong Notion → <b>•••</b> → <b>Connections</b> → chọn integration. Hoặc vào tab <b>Access</b> của
            integration để chọn nhiều page một lúc.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <a href={`/workspaces/${workspace.id}/pick`} className="btn btn-primary btn-sm">
              Tải lại
            </a>
            <a href={NOTION_INTEGRATIONS_URL} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
              Mở trang integration ↗
            </a>
            <a href={NOTION_CONNECTIONS_HELP_URL} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
              Hướng dẫn ↗
            </a>
          </div>
        </div>
      ) : (
        <DataSourcePicker workspaceId={workspace.id} sources={sources} />
      )}
    </div>
  );
}
