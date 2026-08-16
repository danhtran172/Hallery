"use server";

import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
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

  const gallery = await db.gallery.create({
    data: {
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

  redirect(`/galleries/${gallery.id}`);
}
