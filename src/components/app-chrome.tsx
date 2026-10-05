"use client";

import { CommandPalette } from "@/components/command-palette";
import { Toaster } from "@/components/toaster";

/** Everything app-wide that floats above the pages: the Ctrl+K palette and toasts. */
export function AppChrome() {
  return (
    <>
      <CommandPalette />
      <Toaster />
    </>
  );
}
