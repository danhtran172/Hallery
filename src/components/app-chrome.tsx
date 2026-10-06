"use client";

import { CommandPalette } from "@/components/command-palette";
import { ServiceWorker } from "@/components/service-worker";
import { Toaster } from "@/components/toaster";

/** Everything app-wide that floats above the pages: the Ctrl+K palette, toasts, and the offline worker. */
export function AppChrome() {
  return (
    <>
      <CommandPalette />
      <Toaster />
      <ServiceWorker />
    </>
  );
}
