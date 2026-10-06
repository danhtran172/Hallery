"use client";

import { useActionState } from "react";
import { MAX_CARDS_PER_ROW, MIN_CARDS_PER_ROW } from "@/lib/notion-cover";
import type { ViewType } from "@/lib/table-layout";
import { saveGalleryGridSettings } from "./actions";

/**
 * Cards per row (this view) and the random-pick switch (the whole Gallery). A table view has
 * no cards to count, so it gets only the switch — its columns live in Cột bảng.
 */
export function GridSettingsForm({
  galleryId,
  viewId,
  viewName,
  viewType,
  cardsPerRow,
  randomPick,
}: {
  galleryId: string;
  viewId: string;
  viewName: string;
  viewType: ViewType;
  cardsPerRow: number;
  randomPick: boolean;
}) {
  const [state, formAction, pending] = useActionState<{ savedAt: number | null; error: string | null }, FormData>(
    async (_previous, formData) => {
      try {
        const result = await saveGalleryGridSettings(galleryId, viewId, formData);
        return result.error ? { savedAt: null, error: result.error } : { savedAt: Date.now(), error: null };
      } catch {
        return { savedAt: null, error: "Không lưu được. Thử lại sau giây lát." };
      }
    },
    { savedAt: null, error: null },
  );

  return (
    <form action={formAction} className="panel mb-6 flex flex-wrap items-end gap-x-8 gap-y-4 p-5">
      {viewType === "gallery" && (
        <div>
          <label htmlFor="cardsPerRow" className="field-label">
            Số card mỗi hàng · view “{viewName}”
          </label>
          <input
            id="cardsPerRow"
            name="cardsPerRow"
            type="number"
            inputMode="numeric"
            min={MIN_CARDS_PER_ROW}
            max={MAX_CARDS_PER_ROW}
            defaultValue={cardsPerRow}
            className="input w-24"
          />
          <span className="field-hint">Màn hình hẹp tự giảm số cột để card vẫn dễ đọc.</span>
        </div>
      )}

      <label className="flex max-w-sm items-start gap-2 text-sm text-ink-soft">
        <input type="checkbox" name="randomPick" defaultChecked={randomPick} className="mt-1 accent-brand" />
        <span>
          Hiện nút chọn ngẫu nhiên
          <span className="mt-0.5 block text-xs text-muted">
            Bốc một item trong số đang hiện, nên nó tôn trọng bộ lọc và ô tìm kiếm.
          </span>
        </span>
      </label>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Đang lưu…" : "Lưu"}
        </button>
        {state.savedAt && !pending && (
          <span role="status" className="text-xs text-brand-ink">
            Đã lưu
          </span>
        )}
        {state.error && !pending && (
          <span role="alert" className="text-xs text-danger">
            {state.error}
          </span>
        )}
      </div>
    </form>
  );
}
