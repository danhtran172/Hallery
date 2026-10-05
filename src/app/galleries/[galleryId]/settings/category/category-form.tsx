"use client";

import { useActionState } from "react";
import { saveCategoryAxes } from "./actions";
import { Icon } from "@/components/icons";

type Candidate = { id: string; name: string; type: string; chosen: boolean };
type FormState = { savedAt: number | null; error: string | null };

export function CategoryForm({ galleryId, candidates }: { galleryId: string; candidates: Candidate[] }) {
  const [state, formAction, pending] = useActionState<FormState, FormData>(
    async (_previous, formData) => {
      try {
        const result = await saveCategoryAxes(galleryId, formData);
        return result.error ? { savedAt: null, error: result.error } : { savedAt: Date.now(), error: null };
      } catch {
        return { savedAt: null, error: "Không lưu được. Thử lại sau giây lát." };
      }
    },
    { savedAt: null, error: null },
  );

  return (
    <form action={formAction} className="flex flex-col gap-5">
      <fieldset className="panel flex flex-col gap-0.5 p-2">
        <legend className="sr-only">Property dùng để phân loại</legend>
        {candidates.map((candidate) => {
          const isRelation = candidate.type === "relation";
          return (
            <label
              key={candidate.id}
              className={`flex items-start gap-3 rounded-2xl px-3.5 py-3 text-sm transition-colors ${
                isRelation ? "text-faint" : "cursor-pointer text-ink-soft hover:bg-subtle"
              }`}
            >
              <input
                type="checkbox"
                name="axis"
                value={`${candidate.id}|${candidate.type}|${candidate.name}`}
                defaultChecked={candidate.chosen}
                disabled={isRelation}
                className="mt-0.5 size-4 accent-brand"
              />
              <span className="min-w-0">
                <span className="font-medium text-ink">{candidate.name}</span>
                <span className="ml-2 rounded-full bg-subtle px-2 py-0.5 font-mono text-[11px] text-faint">{candidate.type}</span>
                {isRelation && (
                  <span className="mt-1 block text-xs">
                    Chưa phân loại được theo liên kết — dùng nút “Liên kết” trên Gallery để chuyển sang bảng đó.
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </fieldset>

      <p className="text-xs leading-relaxed text-muted">
        Thứ tự trong danh sách này là thứ tự hiện trên Gallery. Với Multi-select, một item có thể thuộc nhiều phân loại,
        nên tổng số của các phân loại có thể lớn hơn tổng số item.
      </p>

      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className="btn btn-primary">
          <Icon name="check" />
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
