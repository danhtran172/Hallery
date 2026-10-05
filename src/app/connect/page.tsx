import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/lib/db";
import { NOTION_CONNECTIONS_HELP_URL, NOTION_INTEGRATIONS_URL } from "@/lib/notion-url";
import { ConnectForm } from "./connect-form";
import { Icon } from "@/components/icons";

export const metadata: Metadata = { title: "Kết nối Notion" };

const STEPS: { title: string; body: React.ReactNode; action?: { href: string; label: string } }[] = [
  {
    title: "Tạo integration",
    body: (
      <>
        Trên trang Integrations của Notion, bấm <b>New integration</b> (hoặc <b>+ New</b>). Đặt tên, ví dụ “Hallery”,
        chọn đúng workspace, kiểu <b>Internal</b>, rồi <b>Save</b>.
      </>
    ),
    action: { href: NOTION_INTEGRATIONS_URL, label: "Mở trang tạo integration" },
  },
  {
    title: "Bật quyền",
    body: (
      <>
        Ở mục <b>Capabilities</b>, bật <b>Read content</b>, <b>Update content</b> và <b>Insert content</b>. Thiếu quyền
        ghi thì Hallery chỉ xem được, không sửa hay thêm item được.
      </>
    ),
  },
  {
    title: "Chia sẻ database",
    body: (
      <>
        Ở tab <b>Access</b> của integration, chọn các page/database muốn dùng. Hoặc mở database trong Notion →{" "}
        <b>•••</b> → <b>Connections</b> → chọn integration. Integration chỉ thấy những gì được chia sẻ.
      </>
    ),
    action: { href: NOTION_CONNECTIONS_HELP_URL, label: "Hướng dẫn của Notion" },
  },
  {
    title: "Copy secret",
    body: (
      <>
        Ở tab <b>Configuration</b>, mục <b>Internal Integration Secret</b>, bấm <b>Show</b> → <b>Copy</b>, rồi dán vào ô
        bên dưới.
      </>
    ),
  },
];

export default async function ConnectPage({ searchParams }: PageProps<"/connect">) {
  const { workspace: workspaceParam, return: returnParam } = await searchParams;
  const reconnect =
    typeof workspaceParam === "string"
      ? await db.workspace.findUnique({ where: { id: workspaceParam }, select: { id: true, name: true } })
      : null;
  const returnTo = typeof returnParam === "string" && returnParam.startsWith("/") ? returnParam : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-5 py-8 sm:px-10 sm:py-12">
      <Link
        href={returnTo ?? "/"}
        className="inline-flex items-center gap-1 rounded-full py-1 pr-2 text-[13px] text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrow-left" className="size-4" />
        {returnTo ? "Quay lại" : "Trang chủ"}
      </Link>
      <p className="eyebrow mt-6">Kết nối Notion</p>
      <h1 className="display mt-2 text-3xl text-ink sm:text-4xl">
        {reconnect ? `Kết nối lại “${reconnect.name}”` : "Kết nối Hallery với Notion"}
      </h1>
      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-ink-soft">
        {reconnect
          ? "Dán secret mới của integration. Gallery, view và mọi cấu hình hiển thị của workspace này được giữ nguyên."
          : "Hallery đọc dữ liệu qua một Internal Integration của chính bạn. Mất khoảng hai phút."}{" "}
        Hallery chỉ đọc dữ liệu và ghi <i>giá trị</i> — không tạo, sửa hay xoá property hay cấu trúc database nào trong
        Notion.
      </p>

      <div className="mt-10 grid items-start gap-6 lg:grid-cols-[1fr_24rem]">
        <ol className="flex flex-col gap-3">
          {STEPS.map((step, index) => (
            <li key={step.title} className="flex gap-4 rounded-3xl bg-surface p-5 ring-1 ring-line">
              <span className="display flex size-9 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-base text-brand-ink">
                {index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <p className="font-medium text-ink">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-ink-soft">{step.body}</p>
                {step.action && (
                  <a href={step.action.href} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm mt-3">
                    {step.action.label}
                    <Icon name="external" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>

        <div className="lg:sticky lg:top-6">
          <section className="rounded-3xl bg-surface p-6 shadow-card ring-1 ring-line">
            <p className="display mb-4 text-lg text-ink">Dán secret</p>
            <ConnectForm workspaceId={reconnect?.id ?? null} returnTo={reconnect ? returnTo : null} />
          </section>
          <p className="mt-4 px-2 text-xs leading-relaxed text-faint">
            Đã kết nối integration này trước đó? Dán lại cũng được — Hallery nhận ra integration cũ và chỉ cập nhật token,
            không tạo workspace trùng.
          </p>
        </div>
      </div>
    </div>
  );
}
