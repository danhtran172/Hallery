"use client";

import { useCallback, useEffect, useRef, useSyncExternalStore, type ReactNode } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Icon } from "@/components/icons";
import { confirmLeave } from "@/lib/unsaved-guard";

/**
 * The cards behind the popup, in the order the Gallery shows them. Read from the page rather
 * than sent along: the grid is still mounted under the popup, so its links already are the
 * ordered list — no payload, and it always matches what the reader just saw.
 */
function cardHrefs(): string[] {
  return [...document.querySelectorAll<HTMLAnchorElement>("a.g-card-link")].map((anchor) => anchor.getAttribute("href") ?? "");
}

const pathOf = (href: string) => href.split("?")[0];

const noSubscription = () => () => {};

/** Previous and next card around the open item, as one comparable string. */
function neighbourSnapshot(pathname: string): string {
  const hrefs = cardHrefs();
  const index = hrefs.findIndex((href) => pathOf(href) === pathname);
  return JSON.stringify({
    prev: index > 0 ? hrefs[index - 1] : null,
    next: index >= 0 && index < hrefs.length - 1 ? hrefs[index + 1] : null,
    index,
    total: hrefs.length,
  });
}

type Neighbours = { prev: string | null; next: string | null; index: number; total: number };

function parseNeighbours(snapshot: string): Neighbours {
  return snapshot ? (JSON.parse(snapshot) as Neighbours) : { prev: null, next: null, index: -1, total: 0 };
}

/**
 * The Card Detail as a popup over the Gallery. Closing goes back in history, which returns
 * to the Gallery exactly as it was — scroll, filters and all — since it never left. ‹ › and
 * the arrow keys step through the cards behind it, replacing rather than pushing, so Back
 * still means "close".
 */
export function ItemDetailModal({ children }: { children: ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const dialogRef = useRef<HTMLElement>(null);
  // The grid behind is the store; re-read on every render, which each step causes anyway.
  // The snapshot is a string so an unchanged grid compares equal.
  const snapshot = useSyncExternalStore(
    noSubscription,
    () => neighbourSnapshot(pathname),
    () => "",
  );
  const neighbours = parseNeighbours(snapshot);

  const close = useCallback(() => {
    if (confirmLeave()) router.back();
  }, [router]);

  const go = useCallback(
    (href: string | null) => {
      if (!href || !confirmLeave()) return;
      router.replace(href, { scroll: false });
    },
    [router],
  );

  // Each item starts at its top.
  useEffect(() => {
    dialogRef.current?.scrollTo({ top: 0 });
  }, [pathname]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // Inside a field, Escape and the arrows belong to the field.
      const target = event.target;
      if (target instanceof Element && target.closest("input, textarea, select, [contenteditable=true]")) return;
      if (event.key === "Escape") close();
      else if (event.key === "ArrowLeft") go(neighbours.prev);
      else if (event.key === "ArrowRight") go(neighbours.next);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [close, go, neighbours]);

  useEffect(() => {
    // The page behind stays put while the popup scrolls on its own.
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    const previousFocus = document.activeElement as HTMLElement | null;
    dialogRef.current?.focus({ preventScroll: true });
    return () => {
      document.body.style.overflow = overflow;
      previousFocus?.focus?.({ preventScroll: true });
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-50 flex animate-fade-in items-start justify-center overflow-y-auto bg-scrim p-2 backdrop-blur-sm sm:items-center sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="presentation"
    >
      <section
        ref={dialogRef}
        tabIndex={-1}
        aria-label="Chi tiết item"
        aria-modal="true"
        className="relative my-auto max-h-full w-full max-w-5xl animate-rise-in overflow-y-auto rounded-[1.75rem] bg-surface shadow-pop ring-1 ring-line outline-none sm:max-h-[calc(100dvh-4rem)]"
        role="dialog"
      >
        <div className="sticky top-0 z-20 flex items-center justify-end gap-1 bg-surface/90 px-3 py-3 backdrop-blur-md sm:px-4">
          {neighbours.total > 1 && neighbours.index >= 0 && (
            <div className="mr-auto flex items-center gap-1 pl-1">
              <button
                type="button"
                onClick={() => go(neighbours.prev)}
                disabled={!neighbours.prev}
                aria-label="Item trước"
                title="Item trước (←)"
                className="btn btn-ghost btn-sm btn-icon"
              >
                <Icon name="chevron-left" />
              </button>
              <span className="min-w-14 text-center text-xs text-faint tabular-nums">
                {neighbours.index + 1} / {neighbours.total}
              </span>
              <button
                type="button"
                onClick={() => go(neighbours.next)}
                disabled={!neighbours.next}
                aria-label="Item sau"
                title="Item sau (→)"
                className="btn btn-ghost btn-sm btn-icon"
              >
                <Icon name="chevron-right" />
              </button>
            </div>
          )}
          <button
            aria-label="Đóng"
            title="Đóng (Esc)"
            className="btn btn-secondary btn-sm btn-icon"
            onClick={close}
            type="button"
          >
            <Icon name="x" />
          </button>
        </div>
        <div className="px-5 pt-1 pb-6 sm:px-9 sm:pb-9">{children}</div>
      </section>
    </div>
  );
}
