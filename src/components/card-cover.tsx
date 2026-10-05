"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveCoverPosition } from "@/app/galleries/[galleryId]/cover-position-actions";
import { Icon } from "@/components/icons";
import { toast } from "@/components/toaster";

// The source URL arrives after the preview API resolves it, so next/image cannot optimize
// this two-stage load without starting the full image early.
/* eslint-disable @next/next/no-img-element */

/**
 * Card cover image, with Ctrl-drag to reposition.
 *
 * Each source starts with a tiny local WebP preview, then fades into a local 320px card
 * derivative after that preview appears. Resolution stays near the viewport so a 90-card
 * gallery never starts 90 image jobs at once or downloads 90 originals.
 *
 * Painted as a background image on purpose: some Notion cover URLs refuse to be
 * hotlinked, and a background degrades to the plain block instead of a broken icon.
 *
 * Props are primitives, not an options object — this component's effect depends on
 * them, and a fresh object identity each render would tear down the in-flight fetch.
 */
export function CardCover({
  ratio,
  round,
  galleryId,
  viewId,
  pageId,
  initialX,
  initialY,
  hasSource,
  initialPreviewUrl,
  initialImageUrl,
}: {
  ratio: string;
  /** Crop the frame to a circle. Only ever paired with a 1:1 ratio. */
  round?: boolean;
  galleryId: string;
  /** Used by the lazy cover endpoint when this view has its own cover source. */
  viewId: string;
  pageId: string;
  initialX: number;
  initialY: number;
  /**
   * Whether the page has a picture at all, from the Gallery's batch manifest. Undefined
   * means not known yet (a content image nobody has looked for). Only the flag travels:
   * the signed URL behind it was 1.6 KB per card of payload the browser never used.
   */
  hasSource?: boolean;
  /** A source-matched local 64px WebP preview from the same manifest. */
  initialPreviewUrl?: string;
  /** A source-matched local 320px WebP card derivative from the same manifest. */
  initialImageUrl?: string;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
  // Distinguishes "this item has no picture" from "the picture could not be fetched" —
  // the two look identical as a grey block, and only one of them is worth retrying.
  const [failed, setFailed] = useState(false);
  const [retrying, setRetrying] = useState(false);
  const [pos, setPos] = useState({ x: initialX, y: initialY });
  const [ctrlHeld, setCtrlHeld] = useState(false);
  const [dragging, setDragging] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const fullUrlRef = useRef<string | null>(null);
  const requestedFullRef = useRef<string | null>(null);
  // Mirrors `pos` so the drag-end handler can read the final value without reaching
  // into a state updater — updaters must stay pure, and a server action inside one
  // fires a Router update mid-render.
  const posRef = useRef({ x: initialX, y: initialY });

  const loadFullImage = useCallback((url: string | null) => {
    if (!url) return;
    if (requestedFullRef.current === url) return;
    requestedFullRef.current = url;
    const image = new Image();
    image.onload = () => {
      setResolved(url);
      setFailed(false);
    };
    image.onerror = () => setFailed(true);
    image.src = url;
  }, []);

  /** Re-asks for the cover, telling the server to drop any cooldown it is holding. */
  const retry = useCallback(async () => {
    setRetrying(true);
    setFailed(false);
    requestedFullRef.current = null;
    try {
      const res = await fetch(
        `/api/galleries/${galleryId}/cover-preview?pageId=${encodeURIComponent(pageId)}&view=${encodeURIComponent(viewId)}&retry=1`,
      );
      const data = res.ok ? await res.json() : null;
      const imageUrl = data?.cardUrl ?? data?.fullUrl ?? null;
      fullUrlRef.current = imageUrl;
      setPreviewUrl(data?.previewUrl ?? null);
      if (data?.previewUrl) setFailed(false);
      else if (imageUrl) loadFullImage(imageUrl);
      else setFailed(true);
    } catch {
      setFailed(true);
    } finally {
      setRetrying(false);
    }
  }, [galleryId, pageId, viewId, loadFullImage]);

  // Resolve any cover lazily, once the card is near the viewport. A source-matched
  // manifest entry skips this API call entirely; only cold and content-image cards need it.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();

        if (hasSource !== undefined) {
          fullUrlRef.current = initialImageUrl ?? null;
          if (initialPreviewUrl && fullUrlRef.current) {
            setPreviewUrl(initialPreviewUrl);
            setFailed(false);
            return;
          }
          if (!hasSource) return;
        }

        fetch(`/api/galleries/${galleryId}/cover-preview?pageId=${encodeURIComponent(pageId)}&view=${encodeURIComponent(viewId)}`)
          .then((res) => {
            // 503: the lookup failed, which is worth a retry button. 404 means no picture.
            if (res.status === 503) throw new Error("Cover lookup unavailable");
            return res.ok ? res.json() : null;
          })
          .then((data) => {
            if (cancelled || !data) return;
            const imageUrl = data.cardUrl ?? data.fullUrl ?? null;
            fullUrlRef.current = imageUrl;
            setPreviewUrl(data.previewUrl ?? null);
            // No preview and no image URL means the page simply has no picture; an image
            // URL that will not load is the case worth offering a retry for.
            if (!data.previewUrl) loadFullImage(imageUrl);
          })
          .catch(() => {
            if (!cancelled) setFailed(true);
          });
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [galleryId, initialImageUrl, initialPreviewUrl, pageId, hasSource, viewId, loadFullImage]);

  // Ctrl arms repositioning; without it the cover stays click-through so the card link works.
  useEffect(() => {
    const sync = (e: KeyboardEvent) => setCtrlHeld(e.ctrlKey || e.metaKey);
    const clear = () => setCtrlHeld(false);
    window.addEventListener("keydown", sync);
    window.addEventListener("keyup", sync);
    window.addEventListener("blur", clear);
    return () => {
      window.removeEventListener("keydown", sync);
      window.removeEventListener("keyup", sync);
      window.removeEventListener("blur", clear);
    };
  }, []);

  const onPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!(e.ctrlKey || e.metaKey) || !resolved) return;
      e.preventDefault();
      e.stopPropagation();

      const node = ref.current;
      if (!node) return;
      const rect = node.getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, px: pos.x, py: pos.y };
      node.setPointerCapture(e.pointerId);
      setDragging(true);

      // Dragging down should reveal more of the image's top, hence the inverted delta.
      const onMove = (ev: PointerEvent) => {
        const dx = ((ev.clientX - start.x) / rect.width) * 100;
        const dy = ((ev.clientY - start.y) / rect.height) * 100;
        const next = {
          x: Math.min(100, Math.max(0, start.px - dx)),
          y: Math.min(100, Math.max(0, start.py - dy)),
        };
        posRef.current = next;
        setPos(next);
      };

      const onUp = () => {
        node.removeEventListener("pointermove", onMove);
        node.removeEventListener("pointerup", onUp);
        setDragging(false);
        saveCoverPosition(galleryId, pageId, posRef.current.x, posRef.current.y).catch(() =>
          toast("Không lưu được vị trí ảnh — sẽ trở lại chỗ cũ khi tải lại trang.", "error"),
        );
      };

      node.addEventListener("pointermove", onMove);
      node.addEventListener("pointerup", onUp);
    },
    [galleryId, pageId, pos.x, pos.y, resolved],
  );

  const armed = ctrlHeld && !!resolved;

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      className={`relative w-full shrink-0 overflow-hidden bg-subtle ${round ? "rounded-full" : "rounded-[inherit]"} ${
        armed ? `z-20 ${dragging ? "cursor-grabbing" : "cursor-grab"} ring-2 ring-brand ring-inset` : "pointer-events-none"
      }`}
      style={{
        aspectRatio: ratio,
      }}
    >
      {previewUrl && (
        <img
          src={previewUrl}
          alt=""
          className={`absolute inset-0 h-full w-full scale-105 object-cover blur-lg transition-opacity duration-300 ${
            resolved ? "opacity-0" : "opacity-100"
          }`}
          style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
          onLoad={() => loadFullImage(fullUrlRef.current)}
          onError={() => loadFullImage(fullUrlRef.current)}
        />
      )}
      {resolved && (
        <img
          src={resolved}
          alt=""
          className="absolute inset-0 h-full w-full object-cover opacity-100 transition-opacity duration-300"
          style={{ objectPosition: `${pos.x}% ${pos.y}%` }}
        />
      )}
      {failed && !resolved && (
        <div className="pointer-events-auto absolute inset-0 z-30 flex flex-col items-center justify-center gap-1.5 bg-subtle p-2 text-center">
          <Icon name="image" className="size-5 text-faint" />
          <span className="text-[11px] leading-snug text-muted">Không tải được ảnh</span>
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              void retry();
            }}
            disabled={retrying}
            className="rounded-full bg-surface px-2.5 py-1 text-[11px] text-ink-soft ring-1 ring-line-strong hover:text-ink disabled:opacity-50"
          >
            {retrying ? "Đang thử…" : "Thử lại"}
          </button>
        </div>
      )}

      {/* Only while Ctrl is held: as a permanent hover hint it sat on every picture. */}
      {armed && (
        <span className="pointer-events-none absolute top-2 left-2 rounded-full bg-black/65 px-2.5 py-1 text-[11px] text-white backdrop-blur">
          Kéo để chỉnh vị trí ảnh
        </span>
      )}
    </div>
  );
}
