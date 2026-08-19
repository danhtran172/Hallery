import { db } from "@/lib/db";
import { GallerySidebar } from "@/components/gallery-sidebar";

/**
 * Wraps the app in its sidebar.
 *
 * A server component so the gallery list is fetched where the data is, rather than the
 * client asking for it on every navigation. The sidebar itself is interactive, so it stays
 * a client component below this one.
 *
 * Auto-added galleries appear here even though they are kept off the dashboard: the point
 * of the dashboard is a short list of what was chosen deliberately, while the sidebar is
 * where everything reachable belongs.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  // Every workspace, not just the first: the sidebar has to list whatever the reader might
  // be looking at, and a gallery missing from it looks deleted.
  const [galleries, trashed] = await Promise.all([
    db.gallery.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, icon: true, parentGalleryId: true, sortOrder: true, autoAdded: true },
    }),
    db.gallery.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, name: true },
      orderBy: { deletedAt: "desc" },
    }),
  ]);

  if (galleries.length === 0 && trashed.length === 0) return <>{children}</>;

  return (
    <div className="flex min-h-full flex-1">
      <GallerySidebar galleries={galleries} trashed={trashed} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
