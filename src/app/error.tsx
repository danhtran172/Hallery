"use client";

import Link from "next/link";
import { useEffect } from "react";

/**
 * Last-resort screen for an unexpected failure. Notion problems Hallery can name are handled
 * where they happen (see components/notion-problem); this only catches what slipped past.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-20">
      <p className="eyebrow">Có lỗi</p>
      <h1 className="text-xl font-semibold text-ink">Trang này chưa tải được</h1>
      <p className="text-sm leading-relaxed text-ink-soft">
        Có thể Notion đang chậm hoặc mạng vừa chập chờn. Thử lại; nếu vẫn lỗi, quay về trang chủ rồi mở lại gallery.
      </p>
      {error.digest && <p className="font-mono text-xs text-faint">Mã lỗi: {error.digest}</p>}
      <div className="flex gap-2">
        <button type="button" onClick={() => retry()} className="btn btn-primary">
          Thử lại
        </button>
        <Link href="/" className="btn btn-secondary">
          Về trang chủ
        </Link>
      </div>
    </div>
  );
}
