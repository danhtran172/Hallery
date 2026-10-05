"use client";

import { useLinkStatus } from "next/link";

/**
 * Feedback for a clicked link while its route renders. Card and sidebar links skip
 * prefetching on purpose (a Gallery would otherwise fetch dozens of items on load), so the
 * click itself is the first request — and without this the screen sat still until it
 * landed, which read as "nothing happened". Renders nothing at rest, so a grid of cards
 * pays for it only in the one card that was clicked.
 */
export function CardPendingOverlay() {
  const { pending } = useLinkStatus();
  if (!pending) return null;
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute inset-0 flex animate-[hallery-fade-in_150ms_ease-out_100ms_both] items-center justify-center rounded-xl bg-white/50"
    >
      <Spinner />
    </span>
  );
}

export function LinkSpinner() {
  const { pending } = useLinkStatus();
  return pending ? <Spinner small /> : null;
}

export function Spinner({ small }: { small?: boolean }) {
  return (
    <span
      role="status"
      aria-label="Đang tải"
      className={`inline-block shrink-0 animate-spin rounded-full border-2 border-brand/25 border-t-brand ${
        small ? "size-3" : "size-6"
      }`}
    />
  );
}
