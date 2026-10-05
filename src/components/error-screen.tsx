"use client";

import Link from "next/link";
import { useEffect } from "react";
import { Icon } from "@/components/icons";

/**
 * What an unexpected failure looks like anywhere in the app. Notion problems Hallery can
 * name are handled where they happen (components/notion-problem); this catches the rest.
 */
export function ErrorScreen({
  error,
  retry,
  title = "Trang này chưa tải được",
  compact,
}: {
  error: Error & { digest?: string };
  retry: () => void;
  title?: string;
  /** Inside the item popup: no "home" link, less air. */
  compact?: boolean;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className={`mx-auto flex w-full max-w-lg flex-col items-start gap-4 ${compact ? "py-10" : "flex-1 justify-center px-6 py-20"}`}>
      <span className="flex size-12 items-center justify-center rounded-2xl bg-danger-soft text-danger">
        <Icon name="alert" className="size-5" />
      </span>
      <h1 className="display text-2xl text-ink">{title}</h1>
      <p className="text-sm leading-relaxed text-ink-soft">
        Có thể Notion đang chậm hoặc mạng vừa chập chờn. Thử lại; nếu vẫn lỗi, quay về trang chủ rồi mở lại gallery. Dữ
        liệu trong Notion không bị ảnh hưởng.
      </p>
      {error.digest && <p className="font-mono text-xs text-faint">Mã lỗi: {error.digest}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          <Icon name="refresh" />
          Thử lại
        </button>
        {!compact && (
          <Link href="/" className="btn btn-secondary">
            Về trang chủ
          </Link>
        )}
      </div>
    </div>
  );
}
