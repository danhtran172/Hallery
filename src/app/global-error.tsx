"use client";

import "./globals.css";

/**
 * When the root layout itself fails — the database unreachable, a migration not yet
 * applied — nothing of the app's frame is left to render, so this page brings its own
 * document. Without it Next showed a bare English error.
 */
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="vi">
      <body className="flex min-h-dvh items-center justify-center bg-canvas p-6 font-sans text-ink">
        <title>Hallery — có lỗi</title>
        <main className="w-full max-w-md rounded-3xl bg-surface p-8 shadow-pop ring-1 ring-line">
          <p className="eyebrow">Hallery</p>
          <h1 className="mt-2 text-2xl font-semibold">Hallery chưa khởi động được</h1>
          <p className="mt-3 text-sm leading-relaxed text-ink-soft">
            Không đọc được dữ liệu cục bộ của Hallery. Nếu vừa cập nhật code, chạy lại <code>npx prisma migrate deploy</code>{" "}
            rồi khởi động lại server. Dữ liệu trong Notion không bị ảnh hưởng.
          </p>
          {error.digest && <p className="mt-3 font-mono text-xs text-faint">Mã lỗi: {error.digest}</p>}
          <button type="button" onClick={() => retry()} className="btn btn-primary mt-6">
            Thử lại
          </button>
        </main>
      </body>
    </html>
  );
}
