import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullDataSource, type DataSourceObjectResponse } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { classifyNotionError, NOTION_PROBLEM_COPY, type NotionProblem } from "@/lib/notion-errors";
import { NOTION_CONNECTIONS_HELP_URL, NOTION_INTEGRATIONS_URL, notionPageUrl } from "@/lib/notion-url";
import { DataSourcePicker, type PickableDataSource } from "./data-source-picker";
import { getDataSourceEmoji } from "@/lib/notion-schema";
import { Icon } from "@/components/icons";
import { RetryButton } from "@/components/retry-button";

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

const iconOf = getDataSourceEmoji;

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
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-10 sm:py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1 rounded-full py-1 pr-2 text-[13px] text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrow-left" className="size-4" />
        Trang chủ
      </Link>
      <p className="eyebrow mt-6">{workspace.name}</p>
      <h1 className="display mt-2 text-3xl text-ink sm:text-4xl">Chọn database làm Gallery</h1>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        Danh sách chỉ gồm database đã được chia sẻ với integration. Không thấy database cần dùng? Mở nó trong Notion →{" "}
        <b>•••</b> → <b>Connections</b> → chọn integration, rồi tải lại trang này.
      </p>

      {reconnected === "1" && (
        <p role="status" className="mt-5 flex items-center gap-2 rounded-2xl bg-brand-soft px-4 py-3 text-sm text-brand-ink">
          <Icon name="check" />
          Đã cập nhật token. Các gallery của workspace này dùng token mới ngay.
        </p>
      )}

      {typeof result === "string" ? (
        <div className="notice mt-8 px-5 py-4">
          <p className="font-medium">{NOTION_PROBLEM_COPY[result].title}</p>
          <p className="mt-1">{NOTION_PROBLEM_COPY[result].body}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {result === "unauthorized" && (
              <Link href={`/connect?workspace=${workspace.id}&return=${encodeURIComponent(`/workspaces/${workspace.id}/pick`)}`} className="btn btn-primary btn-sm">
                Kết nối lại token
              </Link>
            )}
            <RetryButton className="btn btn-secondary btn-sm" />
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
            <RetryButton className="btn btn-primary btn-sm" />
            <a href={NOTION_INTEGRATIONS_URL} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
              Mở trang integration
              <Icon name="external" />
            </a>
            <a href={NOTION_CONNECTIONS_HELP_URL} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
              Hướng dẫn
              <Icon name="external" />
            </a>
          </div>
        </div>
      ) : (
        <DataSourcePicker workspaceId={workspace.id} sources={sources} />
      )}
    </div>
  );
}
