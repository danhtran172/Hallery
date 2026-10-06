import type { Client, DataSourceObjectResponse } from "@notionhq/client";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { defaultViewCreate } from "@/lib/gallery-view";
import { propertyConfigsCreate } from "@/lib/native-button";

type DataSourceProperties = DataSourceObjectResponse["properties"];

/** A table reachable from a gallery through one of its relation properties. */
export type RelationTarget = {
  dataSourceId: string;
  databaseId: string;
  /** The relation property that points here, for labelling the popup entry. */
  propertyName: string;
  propertyId: string;
};

/**
 * How far the walk follows relations. The owner asked for two levels: a gallery's own
 * relation targets, and theirs. Relations fan out fast and each new table costs a request,
 * so the depth is a hard stop rather than a default.
 */
export const MAX_RELATION_DEPTH = 2;

/**
 * Ceiling on how many tables one walk will fetch. A database wired to a dozen others turns
 * two levels into a hundred-odd requests at Notion's ~3/s, which is a minute of waiting for
 * tables the user may never open. Hitting the cap stops the walk; nothing already added is
 * lost, and re-adding later picks up where it stopped.
 */
export const MAX_RELATION_FETCHES = 24;

export function relationTargetsOf(properties: DataSourceProperties): RelationTarget[] {
  const targets: RelationTarget[] = [];
  for (const [name, config] of Object.entries(properties)) {
    if (config.type !== "relation") continue;
    targets.push({
      dataSourceId: config.relation.data_source_id,
      databaseId: config.relation.database_id,
      propertyName: name,
      propertyId: config.id,
    });
  }
  return targets;
}

function titleOf(dataSource: DataSourceObjectResponse): string {
  return dataSource.title.map((t) => t.plain_text).join("") || "Untitled";
}

/**
 * Creates a gallery for a data source, or leaves an existing one exactly as it is.
 *
 * Existing rows are deliberately untouched: a gallery the user picked by hand carries
 * `autoAdded: false` plus their display and layout work, and a later relation walk arriving
 * at the same table must not quietly demote or overwrite any of it.
 */
async function upsertGallery(
  workspaceId: string,
  dataSource: DataSourceObjectResponse,
  databaseId: string,
  autoAdded: boolean,
) {
  return db.gallery.upsert({
    where: { workspaceId_notionDataSourceId: { workspaceId, notionDataSourceId: dataSource.id } },
    update: {},
    create: {
      workspaceId,
      notionDatabaseId: databaseId,
      notionDataSourceId: dataSource.id,
      name: titleOf(dataSource),
      autoAdded,
      views: defaultViewCreate(),
      propertyConfigs: propertyConfigsCreate(dataSource.properties),
    },
  });
}

export type RelationWalkResult = {
  /** Data source ids that now have a gallery, whether this walk created it or not. */
  reached: string[];
  /** Tables the integration cannot see, so the user can go share them in Notion. */
  unreachable: RelationTarget[];
  /** True when MAX_RELATION_FETCHES stopped the walk before it ran out of tables. */
  truncated: boolean;
};

/**
 * Follows a gallery's relations and gives every table it finds a gallery of its own.
 *
 * Two things make this less obvious than a recursive descent. Notion's `dual_property`
 * relations point back at their source, so an unguarded walk bounces between two tables
 * forever — hence visiting by data source id. And a relation may target a database that was
 * never shared with the integration, which answers 404; that is normal, not a failure, so it
 * is collected and reported instead of aborting the add the user actually asked for.
 */
export async function addRelationGalleries(
  notion: Client,
  workspaceId: string,
  rootDataSourceId: string,
  rootProperties: DataSourceProperties,
): Promise<RelationWalkResult> {
  const visited = new Set<string>([rootDataSourceId]);
  const unreachable: RelationTarget[] = [];
  const reached: string[] = [];
  let fetches = 0;
  let truncated = false;

  let frontier = relationTargetsOf(rootProperties);

  for (let depth = 0; depth < MAX_RELATION_DEPTH && frontier.length > 0; depth++) {
    const next: RelationTarget[] = [];

    for (const target of frontier) {
      if (visited.has(target.dataSourceId)) continue;
      visited.add(target.dataSourceId);

      if (fetches >= MAX_RELATION_FETCHES) {
        truncated = true;
        break;
      }

      let dataSource: DataSourceObjectResponse;
      try {
        fetches++;
        const res = await notion.dataSources.retrieve({ data_source_id: target.dataSourceId });
        if (!isFullDataSource(res)) continue;
        dataSource = res;
      } catch {
        // Almost always object_not_found: the target database was never shared with this
        // integration. Nothing to do about it from here — surface it and move on.
        unreachable.push(target);
        continue;
      }

      await upsertGallery(workspaceId, dataSource, target.databaseId, true);
      reached.push(target.dataSourceId);
      next.push(...relationTargetsOf(dataSource.properties));
    }

    if (truncated) break;
    frontier = next;
  }

  return { reached, unreachable, truncated };
}

/** Galleries in this workspace for the tables a gallery's relations point at. */
export async function listRelationGalleries(
  workspaceId: string,
  properties: DataSourceProperties,
) {
  const targets = relationTargetsOf(properties);
  if (targets.length === 0) return [];

  const galleries = await db.gallery.findMany({
    where: { workspaceId, notionDataSourceId: { in: targets.map((t) => t.dataSourceId) } },
    select: { id: true, name: true, icon: true, notionDataSourceId: true, deletedAt: true },
  });
  const byDataSource = new Map(galleries.map((g) => [g.notionDataSourceId, g]));

  // A target without a Gallery is one the integration cannot read. It is still listed, so
  // the reader learns the table exists and how to share it, instead of it silently missing.
  // A trashed one is listed as such — it used to read as "not shared", which no amount of
  // sharing in Notion could fix.
  return targets.map((target) => {
    const gallery = byDataSource.get(target.dataSourceId);
    return gallery
      ? { ...target, galleryId: gallery.id, name: gallery.name, icon: gallery.icon, trashed: Boolean(gallery.deletedAt) }
      : { ...target, galleryId: null, name: target.propertyName, icon: null, trashed: false };
  });
}
