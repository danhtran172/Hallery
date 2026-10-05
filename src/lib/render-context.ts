import { isFullDataSource, type DataSourceObjectResponse, type PageObjectResponse } from "@notionhq/client";
import { db } from "@/lib/db";
import { parseDisplayConfig } from "@/lib/display-config";
import { getGalleryNotionSnapshot, normalizeNotionId, peekGalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { parseNativeButton, type NativeButtonConfig } from "@/lib/native-button";
import { getPageTitle, getTitlePropertyName } from "@/lib/notion-schema";
import { notionPageUrl } from "@/lib/notion-url";
import { itemHref, type RelationLink } from "@/lib/property-render";
import { relationTargetsOf } from "@/lib/relation-galleries";

/**
 * Resolves the pages a set of relation values point at.
 *
 * Titles come from the linked table's own Gallery snapshot when Hallery manages that table —
 * no extra Notion request — and the link then opens the item inside Hallery. A linked table
 * Hallery cannot read (not shared with the integration) still gets a working link, to Notion.
 *
 * `crawl` lets the Card Detail fetch a linked table it has not loaded yet; the Gallery grid
 * never waits on that and uses whatever is already cached.
 */
export async function buildRelationLinks({
  workspaceId,
  dataSource,
  pages,
  crawl,
}: {
  workspaceId: string;
  dataSource: DataSourceObjectResponse | null;
  pages: PageObjectResponse[];
  crawl: boolean;
}): Promise<Record<string, RelationLink>> {
  if (!dataSource) return {};
  const targets = relationTargetsOf(dataSource.properties);
  if (targets.length === 0) return {};

  const relationIds = new Set(targets.map((target) => target.propertyId));
  const wanted = new Set<string>();
  for (const page of pages) {
    for (const value of Object.values(page.properties)) {
      if (value.type === "relation" && relationIds.has(value.id)) {
        for (const entry of value.relation) wanted.add(normalizeNotionId(entry.id));
      }
    }
  }
  if (wanted.size === 0) return {};

  const galleries = await db.gallery.findMany({
    where: {
      workspaceId,
      deletedAt: null,
      notionDataSourceId: { in: [...new Set(targets.map((target) => target.dataSourceId))] },
    },
    include: { workspace: { select: { accessToken: true } } },
  });

  const links: Record<string, RelationLink> = {};
  for (const gallery of galleries) {
    const snapshot = crawl
      ? await getGalleryNotionSnapshot({
          galleryId: gallery.id,
          dataSourceId: gallery.notionDataSourceId,
          accessToken: gallery.workspace.accessToken,
        }).catch(() => null)
      : await peekGalleryNotionSnapshot(gallery.id);
    if (!snapshot || !isFullDataSource(snapshot.dataSourceRes)) continue;
    const titleProperty = getTitlePropertyName(snapshot.dataSourceRes.properties);
    for (const id of wanted) {
      const page = snapshot.pageById.get(id);
      if (page) links[id] = { title: getPageTitle(page, titleProperty), href: itemHref(gallery.id, page.id), internal: true };
    }
  }

  for (const id of wanted) {
    links[id] ??= { title: null, href: notionPageUrl(id), internal: false };
  }
  return links;
}

/** Native button configs for a Gallery's button properties, with their labels resolved. */
export function buildButtonConfigs(
  properties: { notionPropertyId: string; notionPropertyName: string; notionPropertyType: string; displayConfig: string; disabled: boolean }[],
): Record<string, NativeButtonConfig> {
  const buttons: Record<string, NativeButtonConfig> = {};
  for (const property of properties) {
    if (property.notionPropertyType !== "button" || property.disabled) continue;
    const display = parseDisplayConfig(property.displayConfig);
    const config = parseNativeButton(display.button);
    if (!config) continue;
    buttons[property.notionPropertyId] = {
      ...config,
      label: config.label || display.nameOverride?.trim() || property.notionPropertyName,
    };
  }
  return buttons;
}
