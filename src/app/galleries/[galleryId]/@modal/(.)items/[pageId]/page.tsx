import { ItemDetailModal } from "@/components/item-detail-modal";
import { ItemDetailView } from "@/app/galleries/[galleryId]/items/[pageId]/item-detail-view";

export default async function ItemDetailModalPage({
  params,
}: PageProps<"/galleries/[galleryId]/items/[pageId]">) {
  const { galleryId, pageId } = await params;

  return (
    <ItemDetailModal>
      <ItemDetailView galleryId={galleryId} pageId={pageId} />
    </ItemDetailModal>
  );
}
