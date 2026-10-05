import Link from "next/link";
import { NOTION_PROBLEM_COPY, type NotionProblem } from "@/lib/notion-errors";
import { notionPageUrl } from "@/lib/notion-url";
import { Icon } from "@/components/icons";
import { RetryButton } from "@/components/retry-button";

type ProblemContext = {
  workspaceId: string;
  /** The Notion database to open when the fix is to share it again. */
  notionDatabaseId?: string;
  /** Where the reader should land after reconnecting — normally the page being viewed. */
  retryHref: string;
};

function ProblemActions({ problem, context, small }: { problem: NotionProblem; context: ProblemContext; small?: boolean }) {
  const size = small ? " btn-sm" : "";
  return (
    <div className="flex flex-wrap items-center gap-2">
      {problem === "unauthorized" && (
        <Link
          href={`/connect?workspace=${context.workspaceId}&return=${encodeURIComponent(context.retryHref)}`}
          className={`btn btn-primary${size}`}
        >
          <Icon name="key" />
          Kết nối lại token
        </Link>
      )}
      {problem === "not_shared" && context.notionDatabaseId && (
        <a
          href={notionPageUrl(context.notionDatabaseId)}
          target="_blank"
          rel="noreferrer"
          className={`btn btn-primary${size}`}
        >
          Mở database trong Notion
          <Icon name="external" />
        </a>
      )}
      <RetryButton className={`btn btn-secondary${size}`} />
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
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-5 px-6 py-20">
      <span className="flex size-12 items-center justify-center rounded-2xl bg-warn-soft text-warn">
        <Icon name="alert" className="size-5" />
      </span>
      <div>
        <p className="text-xs font-medium tracking-wide text-muted uppercase">{title}</p>
        <h1 className="display mt-1.5 text-2xl text-ink">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">{copy.body}</p>
      </div>
      {problem === "not_shared" && (
        <ol className="flex flex-col gap-2 rounded-3xl bg-subtle p-5 text-sm text-ink-soft ring-1 ring-line">
          {[
            "Mở database trong Notion.",
            <>
              Bấm <b>•••</b> ở góc trên bên phải → <b>Connections</b>.
            </>,
            <>
              Tìm và chọn integration bạn đã tạo cho Hallery → <b>Confirm</b>.
            </>,
            "Quay lại đây và bấm Thử lại.",
          ].map((step, index) => (
            <li key={index} className="flex gap-3">
              <span className="flex size-5 shrink-0 items-center justify-center rounded-full bg-surface text-[11px] font-semibold text-muted ring-1 ring-line">
                {index + 1}
              </span>
              <span>{step}</span>
            </li>
          ))}
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
    <div role="status" className="notice mb-5 flex flex-wrap items-center gap-x-4 gap-y-2">
      <Icon name="alert" className="size-4 shrink-0" />
      <p className="min-w-0 flex-1">
        <b>{copy.title}.</b> Đang hiển thị bản lưu gần nhất — có thể chưa khớp với Notion.
      </p>
      <ProblemActions problem={problem} context={context} small />
    </div>
  );
}
