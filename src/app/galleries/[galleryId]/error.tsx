"use client";

import { ErrorScreen } from "@/components/error-screen";

/**
 * A Gallery's own boundary, so a failure here leaves the sidebar and the rest of the app
 * standing instead of replacing everything under the root layout.
 */
export default function GalleryError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} title="Gallery này chưa tải được" />;
}
