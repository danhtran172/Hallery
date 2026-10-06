"use client";

import { useEffect, useRef, type RefObject } from "react";
import { useDismiss } from "./use-dismiss";

/** How to ask the popup that is open right now to close; it answers whether it did. */
let active: (() => boolean) | null = null;

/**
 * Popups that take turns: only one is open at a time, and opening the next first asks the
 * open one to close. `tryClose` closes and returns true — or, holding unconfirmed choices,
 * stays open (and says so to the user) and returns false. A press outside or Escape asks too.
 */
export function usePopupTurn(ref: RefObject<HTMLElement | null>, open: boolean, tryClose: () => boolean) {
  const latest = useRef(tryClose);
  useEffect(() => {
    latest.current = tryClose;
  });
  useEffect(() => {
    if (!open) return;
    const ask = () => latest.current();
    active = ask;
    return () => {
      if (active === ask) active = null;
    };
  }, [open]);
  useDismiss(ref, open, () => {
    latest.current();
  });
}

/** Call before opening a popup: false while another popup refuses to give way. */
export function claimPopupTurn(): boolean {
  return active === null || active();
}
