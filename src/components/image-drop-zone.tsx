"use client";

import { useEffect, useRef, useState } from "react";

/** Notion's ceiling for a single-part upload. Anything larger needs the multi-part flow. */
export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/**
 * Picks one image for the create form, three ways: dropped on, pasted, or chosen.
 *
 * The file rides the ordinary form submission rather than a separate request, so a hidden
 * file input holds it — assigned through a DataTransfer, which is the only way to put a
 * File into an input programmatically.
 *
 * Paste listens on the document rather than the zone: nobody focuses a drop target before
 * hitting Ctrl+V, and the form is inside a popup that is already the only thing on screen.
 */
export function ImageDropZone({
  name,
  ratio,
  round,
  active,
}: {
  name: string;
  /** CSS aspect-ratio, so the frame crops the way the card will. */
  ratio: string;
  /** Crop the frame to a circle, matching a circular cover. */
  round?: boolean;
  /** Only listen for pastes while the form is actually open. */
  active: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  // Revoke on replace and on unmount, or every pick leaks its object URL.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function accept(file: File | null | undefined) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setError("Chỉ nhận file ảnh.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`Ảnh ${(file.size / 1024 / 1024).toFixed(1)}MB — Notion chỉ nhận tối đa 20MB một lần tải.`);
      return;
    }

    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (inputRef.current) inputRef.current.files = transfer.files;

    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return URL.createObjectURL(file);
    });
    setFileName(file.name);
    setError(null);
  }

  function clear() {
    if (inputRef.current) inputRef.current.value = "";
    setPreview((current) => {
      if (current) URL.revokeObjectURL(current);
      return null;
    });
    setFileName(null);
    setError(null);
  }

  useEffect(() => {
    if (!active) return;
    function onPaste(event: ClipboardEvent) {
      const file = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        event.preventDefault();
        accept(file);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [active]);

  return (
    <div>
      <span className="mb-0.5 block text-[11px] text-muted">Ảnh</span>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          accept(event.dataTransfer.files?.[0]);
        }}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        aria-label="Thêm ảnh: kéo thả, dán, hoặc bấm để chọn file"
        className={`relative flex cursor-pointer items-center justify-center overflow-hidden border border-dashed bg-cover bg-center text-center ${
          round ? "rounded-full" : "rounded"
        } ${over ? "border-brand bg-brand-soft" : "border-line-strong hover:border-stone-500"}`}
        style={{
          aspectRatio: ratio,
          ...(preview ? { backgroundImage: `url(${JSON.stringify(preview)})` } : {}),
        }}
      >
        {!preview && (
          <span className="px-2 text-[11px] leading-snug text-muted">
            Kéo ảnh vào đây, dán (Ctrl+V), hoặc bấm để chọn file
          </span>
        )}
        {preview && (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              clear();
            }}
            className="absolute right-1 top-1 rounded bg-black/60 px-1.5 py-0.5 text-[11px] text-white hover:bg-black/80"
          >
            Bỏ ảnh
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        name={name}
        accept="image/*"
        onChange={(event) => accept(event.target.files?.[0])}
        className="hidden"
      />

      {fileName && <p className="mt-1 truncate text-[11px] text-muted">{fileName}</p>}
      {error && <p className="mt-1 text-[11px] text-red-600">{error}</p>}
    </div>
  );
}
