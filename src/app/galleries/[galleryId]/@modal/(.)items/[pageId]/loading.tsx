import { ItemDetailModal } from "@/components/item-detail-modal";

/** Shown the instant a card is clicked, while the item renders on the server. */
export default function ItemDetailModalLoading() {
  return (
    <ItemDetailModal>
      <div aria-busy="true" aria-label="Đang tải item" className="flex flex-col gap-5 pr-10">
        <div className="skeleton h-8 w-2/3 rounded-lg" />
        <div className="flex gap-2">
          <div className="skeleton h-8 w-16 rounded-md" />
          <div className="skeleton h-8 w-32 rounded-md" />
        </div>
        <div className="flex flex-col gap-5 sm:flex-row">
          <div className="skeleton aspect-[3/4] w-full rounded-xl sm:w-2/5" />
          <div className="flex flex-1 flex-col gap-3">
            {Array.from({ length: 5 }, (_, index) => (
              <div key={index} className="skeleton h-10 rounded-lg" />
            ))}
          </div>
        </div>
      </div>
    </ItemDetailModal>
  );
}
