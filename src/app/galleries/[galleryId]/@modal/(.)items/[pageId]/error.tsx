"use client";

import { ErrorScreen } from "@/components/error-screen";
import { ItemDetailModal } from "@/components/item-detail-modal";

/** A failing item stays inside its popup; the Gallery behind it is untouched. */
export default function ItemModalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <ItemDetailModal>
      <ErrorScreen error={error} retry={retry} title="Item này chưa tải được" compact />
    </ItemDetailModal>
  );
}
