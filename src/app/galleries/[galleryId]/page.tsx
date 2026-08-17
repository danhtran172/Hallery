import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { getPageIcon, getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { PropertyValue } from "@/components/property-value";
import { parseDisplayConfig } from "@/lib/display-config";
import { isFullDataSource, isFullPage } from "@notionhq/client";

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
  const titlePropertyName = dataSource ? getTitlePropertyName(dataSource.properties) : null;

  const queryRes = await notion.dataSources.query({
    data_source_id: gallery.notionDataSourceId,
    page_size: 100,
  });
  const pages = queryRes.results.filter(isFullPage);

  // Show up to 4 non-title properties per card by default; Phase 1 will make this configurable.
  const visibleProps = gallery.propertyConfigs
    .filter((p) => p.notionPropertyType !== "title" && !p.hidden)
    .slice(0, 4);

  return (
    <div className="mx-auto max-w-5xl px-6 py-12">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <Link href="/" className="text-xs text-stone-500 hover:underline">
            ← Tất cả gallery
          </Link>
          <h1 className="mt-1 text-2xl font-semibold text-stone-900">{gallery.name}</h1>
          <p className="text-sm text-stone-500">{pages.length} item</p>
        </div>
        <Link
          href={`/galleries/${galleryId}/settings/display`}
          className="text-xs text-stone-500 hover:underline"
        >
          Cài đặt hiển thị
        </Link>
      </div>

      {pages.length === 0 ? (
        <p className="rounded-md border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500">
          Database này chưa có item nào.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {pages.map((page) => {
            const title = getPageTitle(page, titlePropertyName);
            const icon = getPageIcon(page);
            return (
              <div
                key={page.id}
                className="relative flex flex-col gap-2 rounded-lg border border-stone-200 p-4 hover:border-emerald-600 hover:shadow-sm"
              >
                <Link
                  href={`/galleries/${galleryId}/items/${page.id}`}
                  aria-label={title}
                  className="absolute inset-0"
                />
                <div className="pointer-events-none relative flex flex-col gap-2">
                  <div className="flex items-center gap-2">
                    {icon && <span className="text-lg leading-none">{icon.length <= 4 ? icon : "📄"}</span>}
                    <span className="font-medium text-stone-900">{title}</span>
                  </div>
                  <dl className="flex flex-col gap-1 text-sm text-stone-600">
                    {visibleProps.map((cfg) => (
                      <div key={cfg.id} className="flex items-baseline gap-2">
                        <dt className="w-24 shrink-0 truncate text-xs text-stone-400">{cfg.notionPropertyName}</dt>
                        <dd className="min-w-0 flex-1 [&_a]:pointer-events-auto">
                          <PropertyValue
                            value={page.properties[cfg.notionPropertyName]}
                            displayConfig={parseDisplayConfig(cfg.displayConfig)}
                          />
                        </dd>
                      </div>
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
