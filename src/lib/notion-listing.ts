import { isFullDataSource, isFullPage, type DataSourceObjectResponse } from "@notionhq/client";
import { getNotionClient } from "@/lib/notion";
import { classifyNotionError, type NotionProblem } from "@/lib/notion-errors";

/** Enough for any real workspace; a runaway search still stops. */
const MAX_SEARCH_PAGES = 10;

/** Every data source the integration can see, in Notion's search order. */
export async function listSharedDataSources(accessToken: string): Promise<DataSourceObjectResponse[] | NotionProblem> {
  const notion = getNotionClient(accessToken);
  const found: DataSourceObjectResponse[] = [];
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const response = await notion.search({
        filter: { property: "object", value: "data_source" },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      found.push(...response.results.filter(isFullDataSource));
      if (!response.has_more || !response.next_cursor) break;
      cursor = response.next_cursor;
    }
    return found;
  } catch (error) {
    return classifyNotionError(error);
  }
}

/** The database a data source belongs to — the id Notion links and `databases.*` speak. */
export function databaseIdOf(source: DataSourceObjectResponse): string {
  return source.database_parent.type === "database_id" ? source.database_parent.database_id : source.id;
}

export function dataSourceTitle(source: DataSourceObjectResponse): string {
  return source.title.map((t) => t.plain_text).join("") || "Untitled";
}

/** A Notion page a new database can be created inside. */
export type ParentPage = { id: string; title: string; icon: string | null; editedAt: string };

/**
 * Pages shared with the integration that can hold a new database.
 *
 * Search returns database rows as pages too; those are records, not places — a database
 * made "inside" one would land in a row's body — so only free-standing pages are kept.
 */
export async function listParentPages(accessToken: string): Promise<ParentPage[] | NotionProblem> {
  const notion = getNotionClient(accessToken);
  const found: ParentPage[] = [];
  try {
    let cursor: string | undefined;
    for (let page = 0; page < MAX_SEARCH_PAGES; page += 1) {
      const response = await notion.search({
        filter: { property: "object", value: "page" },
        page_size: 100,
        ...(cursor ? { start_cursor: cursor } : {}),
      });
      for (const result of response.results) {
        if (!isFullPage(result) || result.in_trash) continue;
        if (result.parent.type === "data_source_id" || result.parent.type === "database_id") continue;
        const titleProperty = Object.values(result.properties).find((value) => value.type === "title");
        const title = titleProperty?.type === "title" ? titleProperty.title.map((t) => t.plain_text).join("") : "";
        found.push({
          id: result.id,
          title: title || "Untitled",
          icon: result.icon?.type === "emoji" ? result.icon.emoji : null,
          editedAt: result.last_edited_time,
        });
      }
      if (!response.has_more || !response.next_cursor) break;
      cursor = response.next_cursor;
    }
    return found.sort((a, b) => Date.parse(b.editedAt) - Date.parse(a.editedAt));
  } catch (error) {
    return classifyNotionError(error);
  }
}
