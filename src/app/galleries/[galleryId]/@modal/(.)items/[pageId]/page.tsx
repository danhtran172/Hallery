import { ItemDetailModal } from "@/components/item-detail-modal";
import { ItemDetailView } from "@/app/galleries/[galleryId]/items/[pageId]/item-detail-view";
import { RETURN_PARAM } from "@/lib/gallery-query";

export default async function ItemDetailModalPage({
  params,
  searchParams,
}: PageProps<"/galleries/[galleryId]/items/[pageId]">) {
  const { galleryId, pageId } = await params;
  const { [RETURN_PARAM]: back } = await searchParams;
  // The card carries the Gallery's state; its view decides which cover the detail shows.
  const viewId = typeof back === "string" ? new URLSearchParams(back).get("view") : null;

  return (
    <ItemDetailModal>
      <ItemDetailView galleryId={galleryId} pageId={pageId} viewId={viewId} />
    </ItemDetailModal>
  );
}
