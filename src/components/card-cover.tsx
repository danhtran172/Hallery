"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { saveCoverPosition } from "@/app/galleries/[galleryId]/cover-position-actions";

// The source URL arrives after the preview API resolves it, so next/image cannot optimize
// this two-stage load without starting the full image early.
/* eslint-disable @next/next/no-img-element */

/**
 * Card cover image, with Ctrl-drag to reposition.
 *
 * Each source starts with a tiny local WebP preview, then fades into the full image only
 * after that preview appears. Resolution stays near the viewport so a 90-card gallery
 * never starts 90 image jobs at once.
 *
 * Painted as a background image on purpose: some Notion cover URLs refuse to be
 * hotlinked, and a background degrades to the plain block instead of a broken icon.
 *
 * Props are primitives, not an options object — this component's effect depends on
 * them, and a fresh object identity each render would tear down the in-flight fetch.
 */
export function CardCover({
  ratio,
  galleryId,
  pageId,
  initialX,
  initialY,
}: {
  ratio: string;
  galleryId: string;
  pageId: string;
  initialX: number;
  initialY: number;
}) {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [resolved, setResolved] = useState<string | null>(null);
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
    if (!url || requestedFullRef.current === url) return;
    requestedFullRef.current = url;
    const image = new Image();
    image.onload = () => setResolved(url);
    image.src = url;
  }, []);

  // Resolve any cover lazily, once the card is near the viewport.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    let cancelled = false;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries.some((e) => e.isIntersecting)) return;
        observer.disconnect();

        fetch(`/api/galleries/${galleryId}/cover-preview?pageId=${encodeURIComponent(pageId)}`)
          .then((res) => (res.ok ? res.json() : null))
          .then((data) => {
            if (cancelled || !data) return;
            fullUrlRef.current = data.fullUrl ?? null;
            setPreviewUrl(data.previewUrl ?? null);
            if (!data.previewUrl) loadFullImage(data.fullUrl ?? null);
          })
          .catch(() => {});
      },
      { rootMargin: "300px" },
    );
    observer.observe(node);

    return () => {
      cancelled = true;
      observer.disconnect();
    };
  }, [galleryId, pageId, loadFullImage]);

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
        void saveCoverPosition(galleryId, pageId, posRef.current.x, posRef.current.y);
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
      className={`relative w-full shrink-0 overflow-hidden bg-stone-100 ${
        armed ? `z-20 ${dragging ? "cursor-grabbing" : "cursor-grab"} ring-2 ring-emerald-500` : "pointer-events-none"
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
      {resolved && (
        <span
          className={`pointer-events-none absolute bottom-2 left-2 rounded bg-black/65 px-2 py-1 text-[11px] text-white transition-opacity ${
            armed ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {armed ? "Kéo để chỉnh vị trí ảnh" : "Giữ Ctrl rồi kéo để chỉnh vị trí ảnh"}
        </span>
      )}
    </div>
  );
}
