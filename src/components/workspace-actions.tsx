"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { removeWorkspace } from "@/app/connect/actions";
import { Icon } from "@/components/icons";
import { useDismiss } from "@/lib/use-dismiss";

/** Per-workspace actions on the dashboard. Removing only ever affects Hallery's own records. */
export function WorkspaceActions({ workspaceId, name, galleryCount }: { workspaceId: string; name: string; galleryCount: number }) {
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  function remove() {
    setOpen(false);
    const message =
      galleryCount > 0
        ? `Gỡ “${name}” khỏi Hallery? ${galleryCount} gallery cùng cấu hình hiển thị, bố cục và view của chúng sẽ bị xoá khỏi Hallery. Dữ liệu trong Notion không bị đụng tới.`
        : `Gỡ “${name}” khỏi Hallery? Dữ liệu trong Notion không bị đụng tới.`;
    if (!window.confirm(message)) return;
    startTransition(() => removeWorkspace(workspaceId));
  }

  return (
    <div ref={ref} className="relative flex items-center gap-1">
      <Link href={`/workspaces/${workspaceId}/pick`} className="btn btn-ghost btn-sm">
        <Icon name="plus" />
        Thêm gallery
      </Link>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={pending}
        aria-label={`Tuỳ chọn workspace ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        className="btn btn-ghost btn-sm btn-icon"
      >
        <Icon name="more" />
      </button>
      {open && (
        <div role="menu" className="popover absolute top-full right-0 z-30 mt-1 w-60 p-1.5">
          <Link role="menuitem" href={`/connect?workspace=${workspaceId}`} className="menu-item" onClick={() => setOpen(false)}>
            <Icon name="key" />
            Kết nối lại bằng token mới
          </Link>
          <button type="button" role="menuitem" onClick={remove} className="menu-item text-danger hover:text-danger [&_svg]:text-danger">
            <Icon name="trash" />
            {pending ? "Đang gỡ…" : "Gỡ workspace khỏi Hallery"}
          </button>
        </div>
      )}
    </div>
  );
}
