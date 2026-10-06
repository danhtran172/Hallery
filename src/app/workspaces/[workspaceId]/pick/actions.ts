"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { importGallery } from "@/lib/gallery-import";
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
  const gallery = await importGallery(notion, {
    workspaceId,
    dataSource,
    databaseId,
    name: title,
    icon: getDataSourceEmoji(dataSource),
  });

  revalidatePath("/", "layout");
  redirect(`/galleries/${gallery.id}`);
}
