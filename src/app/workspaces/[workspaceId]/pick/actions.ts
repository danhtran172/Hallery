"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { addRelationGalleries } from "@/lib/relation-galleries";
import type { DataSourceObjectResponse } from "@notionhq/client";

export async function addGallery(
  workspaceId: string,
  dataSourceId: string,
  databaseId: string,
  title: string,
) {
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const notion = getNotionClient(workspace.accessToken);

  const dataSource = (await notion.dataSources.retrieve({
    data_source_id: dataSourceId,
  })) as DataSourceObjectResponse;

  // Picked by hand, so it belongs on the dashboard even if a previous relation walk already
  // pulled it in as someone else's target.
  const gallery = await db.gallery.upsert({
    where: { workspaceId_notionDataSourceId: { workspaceId, notionDataSourceId: dataSourceId } },
    update: { autoAdded: false },
    create: {
      workspaceId,
      notionDatabaseId: databaseId,
      notionDataSourceId: dataSourceId,
      name: title || "Untitled",
      propertyConfigs: {
        create: Object.entries(dataSource.properties).map(([name, config], index) => ({
          notionPropertyId: config.id,
          notionPropertyName: name,
          notionPropertyType: config.type,
          sortOrder: index,
        })),
      },
    },
  });

  // Tables this one links to become galleries too, so the relation popup has somewhere to
  // send the user. They stay off the dashboard; see Gallery.autoAdded.
  await addRelationGalleries(notion, workspaceId, dataSourceId, dataSource.properties);

  redirect(`/galleries/${gallery.id}`);
}
