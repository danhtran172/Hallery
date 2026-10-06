import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { NOTION_PROBLEM_COPY } from "@/lib/notion-errors";
import { databaseIdOf, dataSourceTitle, listSharedDataSources } from "@/lib/notion-listing";
import { NOTION_CONNECTIONS_HELP_URL, NOTION_INTEGRATIONS_URL, notionPageUrl } from "@/lib/notion-url";
import { DataSourcePicker, type PickableDataSource } from "./data-source-picker";
import { getDataSourceEmoji } from "@/lib/notion-schema";
import { Icon } from "@/components/icons";
import { RetryButton } from "@/components/retry-button";
import { CreateDatabaseButton } from "@/components/create-database-button";

export const metadata: Metadata = { title: "Chọn database" };

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
            const databaseId = databaseIdOf(source);
            const added = addedBySource.get(source.id);
            return {
              id: source.id,
              databaseId,
              title: dataSourceTitle(source),
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
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className="display text-3xl text-ink sm:text-4xl">Chọn database làm Gallery</h1>
        <CreateDatabaseButton workspaceId={workspace.id} />
      </div>
      <p className="mt-3 text-sm leading-relaxed text-ink-soft">
        Danh sách chỉ gồm database đã được chia sẻ với integration. Không thấy database cần dùng? Mở nó trong Notion →{" "}
        <b>•••</b> → <b>Connections</b> → chọn integration, rồi tải lại trang này — hoặc tạo database mới ngay từ đây.
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
