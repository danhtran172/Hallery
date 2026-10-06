"use client";

import { useEffect, useRef, useState } from "react";
import { Icon } from "@/components/icons";
import { IMAGE_FILE_FIELD, IMAGE_TARGET_FIELD, IMAGE_URL_FIELD, MAX_UPLOAD_BYTES } from "@/lib/cover-write";

/** Where a picked picture goes, as the server will check it. */
export type ImageSlot = {
  /** `page_cover`, `content_image` or `property:<name>`. */
  target: string;
  /** False for a URL property: it can point at a picture, never hold an upload. */
  acceptsUpload: boolean;
  /** Where the picture lands, in words, so the reader knows what changes. */
  targetLabel: string;
};

const isTyping = (target: EventTarget | null) =>
  target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable=true]"));

const isImageUrl = (text: string) => /^https?:\/\/\S+$/i.test(text.trim());

/**
 * The picture of a form — the create form or an edit form. Click it to upload a file or
 * paste a link; Ctrl+V pastes an image or a link from anywhere in the form; files and
 * links can be dropped on it. Nothing leaves the browser until the form is saved, when
 * the picture is written wherever the gallery reads it from.
 */
export function ImagePicker({
  slot,
  ratio,
  round,
  currentUrl,
  active = true,
  className,
  style,
}: {
  slot: ImageSlot;
  /** CSS aspect-ratio, so the frame crops the way the card will. */
  ratio: string;
  round?: boolean;
  /** The picture the record has now, shown until another is picked. */
  currentUrl?: string | null;
  /** Only listen for pastes while the form is actually open. */
  active?: boolean;
  className?: string;
  style?: React.CSSProperties;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const [picked, setPicked] = useState<{ kind: "file"; preview: string; name: string } | { kind: "url"; url: string } | null>(
    null,
  );
  const [menu, setMenu] = useState(false);
  const [link, setLink] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [over, setOver] = useState(false);

  // Revoke on replace and on unmount, or every pick leaks its object URL.
  const preview = picked?.kind === "file" ? picked.preview : null;
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview);
  }, [preview]);

  function acceptFile(file: File | null | undefined) {
    if (!file) return;
    if (!slot.acceptsUpload) {
      setError("Ảnh của gallery này nằm ở property kiểu URL — dán link ảnh thay vì file.");
      return;
    }
    if (!file.type.startsWith("image/")) {
      setError("Chỉ nhận file ảnh.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`Ảnh ${(file.size / 1024 / 1024).toFixed(1)}MB — Notion chỉ nhận tối đa 20MB một lần tải.`);
      return;
    }
    // The file rides the form's own submission, so it has to sit in a real file input.
    const transfer = new DataTransfer();
    transfer.items.add(file);
    if (fileRef.current) fileRef.current.files = transfer.files;
    setPicked({ kind: "file", preview: URL.createObjectURL(file), name: file.name });
    setError(null);
    setMenu(false);
    rootRef.current?.closest("form")?.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function acceptUrl(text: string) {
    if (!isImageUrl(text)) {
      setError("Link ảnh phải bắt đầu bằng http:// hoặc https://");
      return;
    }
    if (fileRef.current) fileRef.current.value = "";
    setPicked({ kind: "url", url: text.trim() });
    setLink("");
    setError(null);
    setMenu(false);
    rootRef.current?.closest("form")?.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function undo() {
    if (fileRef.current) fileRef.current.value = "";
    setPicked(null);
    setError(null);
  }

  // Latest handlers for the document listener, which is attached once per open form.
  const handlers = useRef({ acceptFile, acceptUrl });
  useEffect(() => {
    handlers.current = { acceptFile, acceptUrl };
  });
  useEffect(() => {
    if (!active) return;
    function onPaste(event: ClipboardEvent) {
      const file = [...(event.clipboardData?.items ?? [])]
        .find((item) => item.kind === "file" && item.type.startsWith("image/"))
        ?.getAsFile();
      if (file) {
        event.preventDefault();
        handlers.current.acceptFile(file);
        return;
      }
      // A link pasted into a field belongs to that field; only a stray paste is a picture.
      const text = event.clipboardData?.getData("text/plain") ?? "";
      if (!isTyping(event.target) && isImageUrl(text)) {
        event.preventDefault();
        handlers.current.acceptUrl(text);
      }
    }
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [active]);

  useEffect(() => {
    if (!menu) return;
    const close = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setMenu(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [menu]);

  const shown = picked ? (picked.kind === "file" ? picked.preview : picked.url) : (currentUrl ?? null);

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`} style={style}>
      <input type="hidden" name={IMAGE_TARGET_FIELD} value={slot.target} />
      <input type="hidden" name={IMAGE_URL_FIELD} value={picked?.kind === "url" ? picked.url : ""} />
      <input
        ref={fileRef}
        type="file"
        name={IMAGE_FILE_FIELD}
        accept="image/*"
        onChange={(event) => acceptFile(event.target.files?.[0])}
        className="hidden"
      />

      <div
        role="button"
        tabIndex={0}
        aria-label="Đổi ảnh: bấm để tải lên hoặc dán link, Ctrl+V để dán, hoặc kéo thả"
        aria-haspopup="menu"
        aria-expanded={menu}
        onClick={() => setMenu((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            setMenu((value) => !value);
          }
        }}
        onDragOver={(event) => {
          event.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(event) => {
          event.preventDefault();
          setOver(false);
          const file = event.dataTransfer.files?.[0];
          if (file) acceptFile(file);
          else {
            const text = event.dataTransfer.getData("text/uri-list") || event.dataTransfer.getData("text/plain");
            if (text) acceptUrl(text.split("\n")[0]);
          }
        }}
        className={`group/img relative flex w-full cursor-pointer items-center justify-center overflow-hidden bg-subtle bg-cover bg-center text-center ring-1 ring-inset ${
          round ? "rounded-full" : "rounded-3xl"
        } ${over ? "ring-2 ring-brand" : "ring-line hover:ring-line-strong"}`}
        style={{ aspectRatio: ratio, ...(shown ? { backgroundImage: `url(${JSON.stringify(shown)})` } : {}) }}
      >
        {!shown && (
          <span className="flex flex-col items-center gap-1 px-3 text-xs leading-snug text-muted">
            <Icon name="image" className="size-5" />
            Bấm để chọn ảnh, dán (Ctrl+V) ảnh hoặc link, hoặc kéo thả vào đây
          </span>
        )}
        {shown && (
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-3 pt-6 pb-2 text-left text-[11px] text-white opacity-0 transition-opacity group-hover/img:opacity-100 group-focus-visible/img:opacity-100">
            Bấm để đổi ảnh · Ctrl+V để dán
          </span>
        )}
        {picked && (
          <span className="absolute top-2 left-2 rounded-full bg-brand px-2 py-0.5 text-[11px] font-medium text-on-brand">
            Ảnh mới — chưa lưu
          </span>
        )}
      </div>

      {menu && (
        <div role="menu" className="popover absolute top-3 left-1/2 z-30 w-72 max-w-[calc(100%-1rem)] -translate-x-1/2 p-2">
          {slot.acceptsUpload && (
            <button type="button" role="menuitem" onClick={() => fileRef.current?.click()} className="menu-item">
              <Icon name="plus" /> Tải ảnh lên từ máy
            </button>
          )}
          <div className="mt-1 flex gap-1.5 px-1 pb-1">
            <input
              value={link}
              onChange={(event) => setLink(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  acceptUrl(link);
                }
              }}
              placeholder="Dán link ảnh…"
              aria-label="Link ảnh"
              autoFocus
              className="input input-sm min-w-0 flex-1"
            />
            <button type="button" onClick={() => acceptUrl(link)} disabled={!link.trim()} className="btn btn-primary btn-sm">
              Dùng
            </button>
          </div>
          {picked && (
            <button type="button" role="menuitem" onClick={undo} className="menu-item">
              <Icon name="restore" /> {currentUrl ? "Giữ ảnh cũ" : "Bỏ ảnh vừa chọn"}
            </button>
          )}
          <p className="px-2 pt-1 text-[11px] text-faint">Lưu vào: {slot.targetLabel}</p>
        </div>
      )}

      {picked?.kind === "file" && <p className="mt-1 truncate text-[11px] text-muted">{picked.name}</p>}
      {error && <p className="mt-1 text-[11px] text-danger">{error}</p>}
    </div>
  );
}
