import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { PropertyValue } from "@/components/property-value";
import { parseDisplayConfig } from "@/lib/display-config";
import { CardCover } from "@/components/card-cover";
import { CONTENT_IMAGE, parseGalleryConfig, resolveCoverRatio, resolveCoverUrl } from "@/lib/notion-cover";
import { isFullDataSource, isFullPage } from "@notionhq/client";
import { syncPropertyConfigs } from "@/lib/property-config-sync";

export default async function GalleryPage({ params }: PageProps<"/galleries/[galleryId]">) {
  const { galleryId } = await params;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, propertyConfigs: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();

  const notion = getNotionClient(gallery.workspace.accessToken);

  const dataSourceRes = await notion.dataSources.retrieve({ data_source_id: gallery.notionDataSourceId });
  const dataSource = isFullDataSource(dataSourceRes) ? dataSourceRes : null;
  if (dataSource) await syncPropertyConfigs(galleryId, gallery.propertyConfigs, dataSource);
  const titlePropertyName = dataSource ? getTitlePropertyName(dataSource.properties) : null;

  const queryRes = await notion.dataSources.query({
    data_source_id: gallery.notionDataSourceId,
    page_size: 100,
  });
  const pages = queryRes.results.filter(isFullPage);

  // Show up to 4 non-title properties per card by default; Phase 1 will make this configurable.
  const visibleProps = gallery.propertyConfigs
    .filter((p) => p.notionPropertyType !== "title" && !p.hidden && !p.isMissing)
    .slice(0, 4);

  const galleryConfig = parseGalleryConfig(gallery.displayConfig);
  const coverRatio = resolveCoverRatio(galleryConfig);
  const coverSource = galleryConfig.coverSource;

  const positions = new Map(
    (await db.coverPosition.findMany({ where: { galleryId } })).map((p) => [p.notionPageId, p]),
  );

  // Content images already resolved on a previous visit are still known here, so paint
  // them server-side and leave the client to chase only the ones we've never seen.
  const cachedImages =
    coverSource === CONTENT_IMAGE
      ? new Map(
          (
            await db.pageImageCache.findMany({
              where: { notionPageId: { in: pages.map((p) => p.id) }, expiresAt: { gt: new Date() } },
            })
          ).map((c) => [c.notionPageId, c.imageUrl]),
        )
      : new Map<string, string | null>();

  return (
    <div className="w-full px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-stone-500 hover:underline">
            ← Tất cả gallery
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">{gallery.name}</h1>
          <p className="text-sm text-stone-500">{pages.length} item</p>
        </div>
        <div className="flex items-center gap-4">
          <Link
            href={`/galleries/${galleryId}/settings/layout`}
            className="text-xs text-stone-500 hover:underline"
          >
            Bố cục chi tiết
          </Link>
          <Link
            href={`/galleries/${galleryId}/settings/cover`}
            className="text-xs text-stone-500 hover:underline"
          >
            Ảnh bìa
          </Link>
          <Link
            href={`/galleries/${galleryId}/settings/display`}
            className="text-xs text-stone-500 hover:underline"
          >
            Cài đặt hiển thị
          </Link>
        </div>
      </div>

      {pages.length === 0 ? (
        <p className="rounded-md border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500">
          Database này chưa có item nào.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {pages.map((page) => {
            const title = getPageTitle(page, titlePropertyName);
            const icon = getPageIcon(page);
            const coverUrl = coverRatio
              ? (resolveCoverUrl(page, coverSource) ?? cachedImages.get(page.id) ?? null)
              : null;
            return (
              <div
                key={page.id}
                className="group relative flex flex-col overflow-hidden rounded-lg border border-stone-200 hover:border-emerald-600 hover:shadow-sm"
              >
                <Link
                  href={`/galleries/${galleryId}/items/${page.id}`}
                  aria-label={title}
                  className="absolute inset-0 z-10"
                />
                {coverRatio && (
                  <CardCover
                    ratio={coverRatio}
                    url={coverUrl}
                    galleryId={galleryId}
                    pageId={page.id}
                    lazy={coverSource === CONTENT_IMAGE}
                    initialX={positions.get(page.id)?.posX ?? 50}
                    initialY={positions.get(page.id)?.posY ?? 50}
                  />
                )}
                <div className="pointer-events-none relative flex flex-col gap-2 p-4">
                  <div className="flex items-center gap-2">
                    {icon && <span className="text-lg leading-none">{icon.length <= 4 ? icon : "📄"}</span>}
                    <span className="font-medium text-stone-900">{title}</span>
                  </div>
                  <dl className="flex flex-col gap-1 text-sm text-stone-600">
                    {visibleProps.map((cfg) => (
                      (() => {
                        const value = Object.values(page.properties).find((property) => property.id === cfg.notionPropertyId);
                        if (!value) return null;
                        return (
                          <div key={cfg.id} className="flex items-baseline gap-2">
                            <dt className="w-24 shrink-0 truncate text-xs text-stone-400">{cfg.notionPropertyName}</dt>
                            <dd className="min-w-0 flex-1 [&_a]:pointer-events-auto">
                              <PropertyValue value={value} displayConfig={parseDisplayConfig(cfg.displayConfig)} />
                            </dd>
                          </div>
                        );
                      })()
                    ))}
                  </dl>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
