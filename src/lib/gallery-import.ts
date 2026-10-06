import type { Client, DataSourceObjectResponse } from "@notionhq/client";
import { db } from "@/lib/db";
import { defaultViewCreate } from "@/lib/gallery-view";
import { propertyConfigsCreate } from "@/lib/native-button";
import { addRelationGalleries } from "@/lib/relation-galleries";

/**
 * Makes a data source a Gallery the user asked for — picked, linked as a tab, or just
 * created — and walks its relations like any pick does.
 *
 * An existing Gallery for the same table is reused rather than duplicated: it is promoted
 * off the relation-only list and out of the trash, and, when `parentGalleryId` is given,
 * moved under that gallery so it shows up as one of its tabs.
 */
export async function importGallery(
  notion: Client,
  options: {
    workspaceId: string;
    dataSource: DataSourceObjectResponse;
    databaseId: string;
    name: string;
    icon: string | null;
    parentGalleryId?: string | null;
    /** Seed Gallery.displayConfig for a brand-new row; ignored when the gallery exists. */
    displayConfig?: string;
  },
) {
  const { workspaceId, dataSource, databaseId, parentGalleryId } = options;
  const gallery = await db.gallery.upsert({
    where: { workspaceId_notionDataSourceId: { workspaceId, notionDataSourceId: dataSource.id } },
    update: { autoAdded: false, deletedAt: null, ...(parentGalleryId !== undefined ? { parentGalleryId } : {}) },
    create: {
      workspaceId,
      notionDatabaseId: databaseId,
      notionDataSourceId: dataSource.id,
      name: options.name || "Untitled",
      icon: options.icon,
      parentGalleryId: parentGalleryId ?? null,
      ...(options.displayConfig ? { displayConfig: options.displayConfig } : {}),
      views: defaultViewCreate(),
      propertyConfigs: propertyConfigsCreate(dataSource.properties),
    },
  });

  // Tables this one links to become galleries too, so the relation popup has somewhere to
  // send the user. They stay off the dashboard; see Gallery.autoAdded. A table that is not
  // shared is not an error here — the relation menu points it out later.
  await addRelationGalleries(notion, workspaceId, dataSource.id, dataSource.properties).catch(() => null);
  return gallery;
}
