"use client";

import Link from "next/link";
import { useTransition } from "react";
import { removeWorkspace } from "@/app/connect/actions";

/** Per-workspace actions on the dashboard. Removing only ever affects Hallery's own records. */
export function WorkspaceActions({ workspaceId, name, galleryCount }: { workspaceId: string; name: string; galleryCount: number }) {
  const [pending, startTransition] = useTransition();

  function remove() {
    const message =
      galleryCount > 0
        ? `Gỡ “${name}” khỏi Hallery? ${galleryCount} gallery cùng cấu hình hiển thị, bố cục và view của chúng sẽ bị xoá khỏi Hallery. Dữ liệu trong Notion không bị đụng tới.`
        : `Gỡ “${name}” khỏi Hallery? Dữ liệu trong Notion không bị đụng tới.`;
    if (!window.confirm(message)) return;
    startTransition(() => removeWorkspace(workspaceId));
  }

  return (
    <div className="flex flex-wrap items-center gap-1">
      <Link href={`/workspaces/${workspaceId}/pick`} className="btn btn-secondary btn-sm">
        + Thêm gallery
      </Link>
      <Link href={`/connect?workspace=${workspaceId}`} className="btn btn-ghost btn-sm" title="Dán token mới cho workspace này">
        Kết nối lại
      </Link>
      <button type="button" onClick={remove} disabled={pending} className="btn btn-ghost btn-sm text-muted hover:text-danger">
        {pending ? "Đang gỡ…" : "Gỡ"}
      </button>
    </div>
  );
}
