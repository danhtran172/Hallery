import { ItemDetailModal } from "@/components/item-detail-modal";

/** Shown the instant a card is clicked, while the item renders on the server. */
export default function ItemDetailModalLoading() {
  return (
    <ItemDetailModal>
      <div aria-busy="true" aria-label="Đang tải item" className="flex flex-col gap-5 pt-2">
        <div className="skeleton h-9 w-2/3 rounded-xl" />
        <div className="flex gap-2">
          <div className="skeleton h-9 w-20 rounded-full" />
          <div className="skeleton h-9 w-36 rounded-full" />
        </div>
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="skeleton aspect-[3/4] w-full rounded-3xl sm:w-2/5" />
          <div className="flex flex-1 flex-col gap-3">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="skeleton h-11 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    </ItemDetailModal>
  );
}
