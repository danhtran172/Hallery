/**
 * The sidebar's shape, and the two moves that change it.
 *
 * A sub-gallery is a gallery whose parent is another gallery — there is no separate folder
 * type. Nesting one under another is therefore the same act as grouping them, and every
 * "group" can be opened and read like anything else in the list.
 *
 * The reordering and nesting live here as pure functions rather than inside the drag
 * handler: dnd-kit ignores synthetic pointer events, so a dragged move cannot be exercised
 * by automation, and the part that can be checked should not be buried where it cannot.
 */

export type GalleryNode = {
  id: string;
  name: string;
  icon: string | null;
  parentGalleryId: string | null;
  sortOrder: number;
  /** Reached by following a relation rather than picked; listed under the gallery that found it. */
  autoAdded: boolean;
};

export type GalleryTreeNode = GalleryNode & { children: GalleryTreeNode[] };

/**
 * Groups the flat rows into a tree, ordered by sortOrder then name.
 *
 * A node whose parent is missing — trashed, or belonging to another workspace — is lifted
 * to the top rather than dropped, because a gallery that silently disappears from the
 * sidebar is worse than one that shows up in the wrong place.
 */
export function buildGalleryTree(rows: GalleryNode[]): GalleryTreeNode[] {
  const byId = new Map(rows.map((row) => [row.id, { ...row, children: [] as GalleryTreeNode[] }]));
  const roots: GalleryTreeNode[] = [];

  for (const node of byId.values()) {
    const parent = node.parentGalleryId ? byId.get(node.parentGalleryId) : undefined;
    if (parent && parent.id !== node.id) parent.children.push(node);
    else roots.push(node);
  }

  const sort = (nodes: GalleryTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));
    nodes.forEach((node) => sort(node.children));
  };
  sort(roots);
  return roots;
}

/** Every id at or beneath a node, so a move can refuse to put a gallery inside itself. */
export function descendantIds(rows: GalleryNode[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const row of rows) {
    if (!row.parentGalleryId) continue;
    const list = childrenOf.get(row.parentGalleryId) ?? [];
    list.push(row.id);
    childrenOf.set(row.parentGalleryId, list);
  }

  const seen = new Set<string>([rootId]);
  const queue = [rootId];
  while (queue.length) {
    for (const child of childrenOf.get(queue.shift()!) ?? []) {
      if (seen.has(child)) continue;
      seen.add(child);
      queue.push(child);
    }
  }
  return seen;
}

/**
 * Whether one gallery may become a child of another.
 *
 * Refused when it would make a cycle — dropping a gallery onto its own descendant would
 * detach the whole branch from the tree and it would vanish from the sidebar.
 */
export function canNest(rows: GalleryNode[], dragId: string, targetId: string): boolean {
  if (dragId === targetId) return false;
  if (!rows.some((row) => row.id === targetId)) return false;
  // The descendant set already contains every case that would close a loop, direct child
  // included — an earlier version special-cased that one as harmless and let it through.
  return !descendantIds(rows, dragId).has(targetId);
}

export type SortAssignment = { id: string; sortOrder: number; parentGalleryId: string | null };

/**
 * Moves a gallery under a new parent and puts it last among its new siblings.
 *
 * Returns a fresh ordering for every gallery that shifted, rather than one changed row:
 * stored sortOrder arrives with ties and gaps, so rewriting a level from its positions is
 * the only way the result is the order that was asked for.
 */
export function nestUnder(
  rows: GalleryNode[],
  dragId: string,
  parentId: string | null,
): SortAssignment[] {
  if (parentId !== null && !canNest(rows, dragId, parentId)) return [];

  const moved = rows.find((row) => row.id === dragId);
  if (!moved || moved.parentGalleryId === parentId) return [];

  const siblings = rows
    .filter((row) => row.id !== dragId && row.parentGalleryId === parentId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));

  return [...siblings, moved].map((row, index) => ({
    id: row.id,
    sortOrder: index,
    parentGalleryId: parentId,
  }));
}

/**
 * Reorders one gallery among its siblings, placing it where another currently sits.
 *
 * Only used within a level: moving across levels is nesting, which is the other function.
 */
export function reorderBeside(rows: GalleryNode[], dragId: string, targetId: string): SortAssignment[] {
  const moved = rows.find((row) => row.id === dragId);
  const target = rows.find((row) => row.id === targetId);
  if (!moved || !target || dragId === targetId) return [];
  if (moved.parentGalleryId !== target.parentGalleryId) return [];

  const level = rows
    .filter((row) => row.parentGalleryId === moved.parentGalleryId)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "vi"));

  const from = level.findIndex((row) => row.id === dragId);
  const to = level.findIndex((row) => row.id === targetId);
  if (from === -1 || to === -1) return [];

  const next = [...level];
  const [entry] = next.splice(from, 1);
  next.splice(to, 0, entry);

  return next.map((row, index) => ({
    id: row.id,
    sortOrder: index,
    parentGalleryId: row.parentGalleryId,
  }));
}

/** Case- and accent-insensitive enough for a Vietnamese sidebar filter. */
export function matchesName(name: string, query: string): boolean {
  const fold = (text: string) =>
    text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  return fold(name).includes(fold(query));
}

/** Keeps a node when it matches, or when anything beneath it does. */
export function filterTree(nodes: GalleryTreeNode[], query: string): GalleryTreeNode[] {
  if (query.trim() === "") return nodes;
  return nodes.flatMap((node) => {
    const children = filterTree(node.children, query);
    if (children.length || matchesName(node.name, query)) return [{ ...node, children }];
    return [];
  });
}
