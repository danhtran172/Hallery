"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Defers the second half of a card batch until the browser has painted the first half.
 * It deliberately keeps no loading chrome: the first cards already communicate progress,
 * and popping in the remaining cards avoids blocking their covers and hydration.
 */
export function DeferredCards({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Give the first 25 cards a head start for hydration and cover requests before
    // mounting the rest of the same 50-card batch.
    const timer = window.setTimeout(() => setReady(true), 150);
    return () => window.clearTimeout(timer);
  }, []);

  return ready ? <>{children}</> : null;
}
