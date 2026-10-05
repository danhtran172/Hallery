import Link from "next/link";
import { NOTION_PROBLEM_COPY, type NotionProblem } from "@/lib/notion-errors";
import { notionPageUrl } from "@/lib/notion-url";

type ProblemContext = {
  workspaceId: string;
  /** The Notion database to open when the fix is to share it again. */
  notionDatabaseId?: string;
  /** Where "Thử lại" goes — normally the page being viewed. */
  retryHref: string;
};

function ProblemActions({ problem, context }: { problem: NotionProblem; context: ProblemContext }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      {problem === "unauthorized" && (
        <Link href={`/connect?workspace=${context.workspaceId}`} className="btn btn-primary">
          Kết nối lại token
        </Link>
      )}
      {problem === "not_shared" && context.notionDatabaseId && (
        <a
          href={notionPageUrl(context.notionDatabaseId)}
          target="_blank"
          rel="noreferrer"
          className="btn btn-primary"
        >
          Mở database trong Notion ↗
        </a>
      )}
      <a href={context.retryHref} className="btn btn-secondary">
        Thử lại
      </a>
    </div>
  );
}

/** Full-page state for a Gallery Hallery has never managed to load from Notion. */
export function NotionProblemState({
  problem,
  title,
  context,
}: {
  problem: NotionProblem;
  /** What could not be loaded, e.g. the Gallery's name. */
  title: string;
  context: ProblemContext;
}) {
  const copy = NOTION_PROBLEM_COPY[problem];
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-20">
      <p className="text-xs font-medium uppercase tracking-wide text-muted">{title}</p>
      <h1 className="text-xl font-semibold text-ink">{copy.title}</h1>
      <p className="text-sm leading-relaxed text-ink-soft">{copy.body}</p>
      {problem === "not_shared" && (
        <ol className="list-decimal space-y-1 pl-5 text-sm text-ink-soft">
          <li>Mở database trong Notion.</li>
          <li>
            Bấm <b>•••</b> ở góc trên bên phải → <b>Connections</b>.
          </li>
          <li>Tìm và chọn integration bạn đã tạo cho Hallery → <b>Confirm</b>.</li>
          <li>Quay lại đây và bấm Thử lại.</li>
        </ol>
      )}
      <ProblemActions problem={problem} context={context} />
    </div>
  );
}

/** Thin strip above content that is still shown, but may be behind Notion. */
export function NotionProblemBanner({ problem, context }: { problem: NotionProblem; context: ProblemContext }) {
  const copy = NOTION_PROBLEM_COPY[problem];
  return (
    <div
      role="status"
      className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
    >
      <p className="min-w-0 flex-1">
        <b>{copy.title}.</b> Đang hiển thị bản lưu gần nhất — có thể chưa khớp với Notion.
      </p>
      <ProblemActions problem={problem} context={context} />
    </div>
  );
}
