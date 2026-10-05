"use client";

import { useActionState } from "react";
import { saveCategoryAxes } from "./actions";

type Candidate = { id: string; name: string; type: string; chosen: boolean };

export function CategoryForm({ galleryId, candidates }: { galleryId: string; candidates: Candidate[] }) {
  const [state, formAction, pending] = useActionState<{ savedAt: number | null }, FormData>(
    async (_previous, formData) => {
      await saveCategoryAxes(galleryId, formData);
      return { savedAt: Date.now() };
    },
    { savedAt: null },
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <fieldset className="panel flex flex-col gap-1 p-2">
        <legend className="sr-only">Property dùng để phân loại</legend>
        {candidates.map((candidate) => {
          const isRelation = candidate.type === "relation";
          return (
            <label
              key={candidate.id}
              className={`flex items-start gap-3 rounded-lg px-3 py-2.5 text-sm ${
                isRelation ? "text-faint" : "text-ink-soft hover:bg-canvas"
              }`}
            >
              <input
                type="checkbox"
                name="axis"
                value={`${candidate.id}|${candidate.type}|${candidate.name}`}
                defaultChecked={candidate.chosen}
                disabled={isRelation}
                className="mt-0.5 accent-brand"
              />
              <span className="min-w-0">
                {candidate.name}
                <span className="ml-2 font-mono text-xs text-faint">{candidate.type}</span>
                {isRelation && (
                  <span className="block text-xs">
                    Chưa phân loại được theo liên kết — dùng nút “Bảng liên kết” trên Gallery để chuyển sang bảng đó.
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      <p className="text-xs text-muted">
        Thứ tự trong danh sách này là thứ tự hiện trên Gallery. Với Multi-select, một item có thể thuộc nhiều phân loại,
        nên tổng số của các phân loại có thể lớn hơn tổng số item.
      </p>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          {pending ? "Đang lưu…" : "Lưu"}
        </button>
        {state.savedAt && !pending && (
          <span role="status" className="text-xs text-brand">
            ✓ Đã lưu
          </span>
        )}
      </div>
    </form>
  );
}
