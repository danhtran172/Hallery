import Link from "next/link";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-4 px-6 py-20">
      <p className="eyebrow">404</p>
      <h1 className="text-xl font-semibold text-ink">Không tìm thấy</h1>
      <p className="text-sm leading-relaxed text-ink-soft">
        Gallery hoặc item này không còn trong Hallery — có thể đã bị bỏ vào thùng rác, hoặc trang trong Notion đã bị
        xoá.
      </p>
      <Link href="/" className="btn btn-primary self-start">
        Về trang chủ
      </Link>
    </div>
  );
}
