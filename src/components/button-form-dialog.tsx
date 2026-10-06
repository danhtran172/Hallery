"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { loadButtonForm, type ButtonFormData, type ButtonFormTarget } from "@/app/galleries/[galleryId]/button-actions";
import {
  DetailLayoutRenderer,
  PrefilledMark,
  fieldNameOf,
} from "@/app/galleries/[galleryId]/items/[pageId]/item-detail";
import { saveItem } from "@/app/galleries/[galleryId]/items/[pageId]/actions";
import type { CardEligibleProperty, ResolvedCardLayout } from "@/lib/card-layout";
import { getEditableValue } from "@/lib/notion-schema";
import { FORM_FIELD_MANIFEST } from "@/lib/notion-write";

function hasFields(layout: ResolvedCardLayout<CardEligibleProperty>): boolean {
  return Object.values(layout.regions).some((grid) => grid.boxes.some((box) => box.fields.some((field) => field.property)));
}

/** A two-column form needs the room a single column does not. */
function isWide(layout: ResolvedCardLayout<CardEligibleProperty>): boolean {
  return Object.values(layout.regions).some((grid) => grid.cols > 1);
}

/**
 * The edit form a button opens: on the record it was pressed on, or on one it just added.
 * Shows the fields the button picked — or the gallery's own edit form — and saves through
 * the same path as Card Detail's "Sửa".
 */
export function ButtonFormDialog({ target, onClose }: { target: ButtonFormTarget; onClose: () => void }) {
  const router = useRouter();
  const [data, setData] = useState<ButtonFormData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [pending, startTransition] = useTransition();
  const latest = useRef({ onClose, dirty });
  useEffect(() => {
    latest.current = { onClose, dirty };
  });

  useEffect(() => {
    let live = true;
    loadButtonForm(target).then((result) => {
      if (live) setData(result);
    });
    return () => {
      live = false;
    };
  }, [target]);

  const requestClose = () => {
    if (latest.current.dirty && !window.confirm("Bỏ các thay đổi chưa lưu?")) return;
    latest.current.onClose();
  };
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      requestCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    startTransition(async () => {
      const result = await saveItem(target.galleryId, target.pageId, { error: null }, formData);
      if (result.error) {
        setError(result.error);
        return;
      }
      setDirty(false);
      router.refresh();
      onClose();
    });
  }

  const renderContext = { galleryId: target.galleryId, pageId: target.pageId, surface: "detail" as const };

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[65] flex animate-fade-in items-start justify-center overflow-y-auto bg-scrim p-2 backdrop-blur-sm sm:p-8"
      onMouseDown={(event) => {
        event.stopPropagation();
        if (event.target === event.currentTarget) requestClose();
      }}
      onClick={(event) => event.stopPropagation()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Sửa record"
        className={`my-auto w-full ${
          data && data.error === null && isWide(data.layout) ? "max-w-3xl" : "max-w-lg"
        } animate-rise-in rounded-[1.75rem] bg-surface p-5 shadow-pop ring-1 ring-line sm:p-6`}
      >
        <div className="mb-4 flex items-center gap-2">
          <h2 className="shrink-0 text-base font-semibold text-ink">Sửa record</h2>
          {data && data.error === null && (
            <span className="truncate text-sm text-muted" title={data.recordTitle}>
              {data.galleryName}
              {data.recordTitle && !data.titleField ? ` · ${data.recordTitle}` : ""}
            </span>
          )}
          <button type="button" aria-label="Đóng" onClick={requestClose} className="btn btn-ghost btn-sm btn-icon ml-auto">
            <Icon name="x" />
          </button>
        </div>
        {!data && <p className="py-6 text-center text-sm text-faint">Đang mở form…</p>}
        {data && data.error !== null && <p className="text-sm text-danger">{data.error}</p>}
        {data && data.error === null && (
          <form onSubmit={submit} onChange={() => setDirty(true)} className="flex flex-col gap-4">
            {data.titleField && (
              <div>
                <input type="hidden" name={FORM_FIELD_MANIFEST} value={fieldNameOf(data.titleField)} />
                {data.titleField.prefilled && <PrefilledMark />}
                <label className="field-label" htmlFor={`button-form-title-${target.pageId}`}>
                  Tiêu đề
                </label>
                <input
                  id={`button-form-title-${target.pageId}`}
                  name={fieldNameOf(data.titleField)}
                  defaultValue={String(getEditableValue(data.titleField.value))}
                  autoFocus
                  className="input h-10 text-base font-medium"
                />
              </div>
            )}
            {hasFields(data.layout) || data.image ? (
              <DetailLayoutRenderer
                fields={data.fields}
                layout={data.layout}
                coverUrl={data.image?.url ?? null}
                coverRatio={data.image?.ratio ?? "3 / 4"}
                coverRound={data.image?.round ?? false}
                renderContext={renderContext}
                editing
                image={data.image?.slot ?? null}
              />
            ) : (
              !data.titleField && (
                <p className="text-sm text-faint">Form này chưa có field nào. Bấm “Chỉnh form” trong cấu hình nút.</p>
              )
            )}
            {error && (
              <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <button type="submit" disabled={pending} className="btn btn-primary">
                <Icon name="check" />
                {pending ? "Đang lưu…" : "Lưu"}
              </button>
              <button type="button" onClick={requestClose} disabled={pending} className="btn btn-secondary">
                Đóng
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  );
}
