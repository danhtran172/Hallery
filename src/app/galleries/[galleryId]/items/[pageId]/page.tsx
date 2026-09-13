import { RETURN_PARAM, galleryHrefFromReturn } from "@/lib/gallery-query";
import { ItemDetailView } from "./item-detail-view";

export default async function ItemDetailPage({
  params,
  searchParams,
}: PageProps<"/galleries/[galleryId]/items/[pageId]">) {
  const { galleryId, pageId } = await params;
  const { [RETURN_PARAM]: back } = await searchParams;
  const galleryHref = galleryHrefFromReturn(galleryId, back);
  return <ItemDetailView galleryId={galleryId} pageId={pageId} galleryHref={galleryHref} />;
}
