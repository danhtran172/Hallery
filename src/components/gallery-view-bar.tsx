"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createGalleryView, duplicateGalleryView, renameGalleryView } from "@/app/galleries/[galleryId]/view-actions";

export type GalleryViewTab = { id: string; name: string };

/** Tabs and the deliberately small set of actions that change the saved view itself. */
export function GalleryViewBar({
  galleryId,
  views,
  activeViewId,
}: {
  galleryId: string;
  views: GalleryViewTab[];
  activeViewId: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go(viewId: string) {
    const next = new URLSearchParams(params.toString());
    next.set("view", viewId);
    next.delete("cardPage");
    router.push(`${pathname}?${next}`);
  }

  function run(create: () => Promise<{ error: string | null; viewId?: string }>) {
    setError(null);
    startTransition(async () => {
      const result = await create();
      if (result.error) setError(result.error);
      else if (result.viewId) go(result.viewId);
      else router.refresh();
    });
  }

  function rename() {
    const current = views.find((view) => view.id === activeViewId);
    const name = window.prompt("Tên view", current?.name ?? "");
    if (name === null) return;
    run(() => renameGalleryView(galleryId, activeViewId, name));
  }

  return (
    <div className="mb-3 flex flex-wrap items-center gap-1.5 border-b border-stone-200 pb-2">
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            onClick={() => go(view.id)}
            aria-current={view.id === activeViewId ? "page" : undefined}
            className={`rounded-md px-2.5 py-1.5 text-sm font-medium ${
              view.id === activeViewId
                ? "bg-emerald-50 text-emerald-800"
                : "text-stone-600 hover:bg-stone-100 hover:text-stone-900"
            }`}
          >
            {view.name}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => createGalleryView(galleryId, activeViewId))}
          className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:border-stone-500 disabled:opacity-50"
        >
          + View
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => run(() => duplicateGalleryView(galleryId, activeViewId))}
          className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:border-stone-500 disabled:opacity-50"
        >
          Nhân bản
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={rename}
          className="rounded border border-stone-300 px-2 py-1 text-xs text-stone-700 hover:border-stone-500 disabled:opacity-50"
        >
          Đổi tên
        </button>
      </div>
      {error && <p className="basis-full text-xs text-red-700">{error}</p>}
    </div>
  );
}
