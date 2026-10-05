"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { addRelationGalleries } from "@/lib/relation-galleries";
import { defaultViewCreate } from "@/lib/gallery-view";
import { NOTION_PROBLEM_COPY, classifyNotionError } from "@/lib/notion-errors";
import { getDataSourceEmoji } from "@/lib/notion-schema";

export async function addGallery(
  workspaceId: string,
  dataSourceId: string,
  databaseId: string,
  title: string,
): Promise<{ error: string } | void> {
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) return { error: "Workspace không còn tồn tại trong Hallery." };
  const notion = getNotionClient(workspace.accessToken);

  let dataSource;
  try {
    const response = await notion.dataSources.retrieve({ data_source_id: dataSourceId });
    if (!isFullDataSource(response)) return { error: "Notion không trả về cấu trúc của database này." };
    dataSource = response;
  } catch (error) {
    const problem = classifyNotionError(error);
    return { error: `${NOTION_PROBLEM_COPY[problem].title}. ${NOTION_PROBLEM_COPY[problem].body}` };
  }

  // Picked by hand, so it belongs on the dashboard even if a previous relation walk already
  // pulled it in as someone else's target — and out of the trash if it had been put there.
  const gallery = await db.gallery.upsert({
    where: { workspaceId_notionDataSourceId: { workspaceId, notionDataSourceId: dataSourceId } },
    update: { autoAdded: false, deletedAt: null },
    create: {
      workspaceId,
      notionDatabaseId: databaseId,
      notionDataSourceId: dataSourceId,
      name: title || "Untitled",
      icon: getDataSourceEmoji(dataSource),
      views: defaultViewCreate(),
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
  // send the user. They stay off the dashboard; see Gallery.autoAdded. A table that is not
  // shared is not an error here — the relation menu points it out later.
  await addRelationGalleries(notion, workspaceId, dataSourceId, dataSource.properties).catch(() => null);

  revalidatePath("/", "layout");
  redirect(`/galleries/${gallery.id}`);
}
