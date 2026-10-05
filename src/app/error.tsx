"use client";

import { ErrorScreen } from "@/components/error-screen";

/** Last-resort screen for an unexpected failure below the root layout. */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
