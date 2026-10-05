"use client";

import { Icon } from "@/components/icons";

/**
 * Loads the same address again — with every query parameter it had. A link back to the
 * bare route used to drop the view, search and the way back to the gallery.
 */
export function RetryButton({ className = "btn btn-secondary" }: { className?: string }) {
  return (
    <button type="button" onClick={() => window.location.reload()} className={className}>
      <Icon name="refresh" />
      Thử lại
    </button>
  );
}
