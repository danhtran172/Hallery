"use client";

import Link from "next/link";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { restoreGallery } from "@/app/sidebar-actions";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";

/**
 * What a trashed Gallery's address shows: it stays reachable — a bookmark should explain
 * itself — but read-only, with the way back out of the trash one click away.
 */
export function TrashedGalleryState({ galleryId, name }: { galleryId: string; name: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-center justify-center px-6 py-20 text-center">
      <span className="flex size-14 items-center justify-center rounded-3xl bg-subtle text-muted">
        <Icon name="trash" className="size-6" />
      </span>
      <h1 className="display mt-6 text-2xl text-ink">“{name}” đang ở thùng rác</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Hallery tạm ngừng quản lý gallery này. Database trong Notion vẫn nguyên vẹn — khôi phục để xem và sửa lại như cũ.
      </p>
      <div className="mt-6 flex flex-wrap justify-center gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await restoreGallery(galleryId);
              if (result.error) toast(result.error, "error");
              else router.refresh();
            })
          }
          className="btn btn-primary"
        >
          <Icon name="restore" />
          {pending ? "Đang khôi phục…" : "Khôi phục gallery"}
        </button>
        <Link href="/" className="btn btn-secondary">
          Về trang chủ
        </Link>
      </div>
    </div>
  );
}
