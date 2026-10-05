import Link from "next/link";
import { Icon } from "@/components/icons";

export default function NotFound() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-start justify-center gap-4 px-6 py-20">
      <span className="display text-6xl text-faint">404</span>
      <h1 className="display text-2xl text-ink">Không tìm thấy</h1>
      <p className="text-sm leading-relaxed text-ink-soft">
        Gallery hoặc item này không còn trong Hallery — gallery có thể đã bị xoá hẳn khỏi thùng rác, hoặc page trong Notion
        đã bị xoá.
      </p>
      <Link href="/" className="btn btn-primary">
        <Icon name="home" />
        Về trang chủ
      </Link>
    </div>
  );
}
