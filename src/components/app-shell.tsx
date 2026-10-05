import { connection } from "next/server";
import { db } from "@/lib/db";
import { GallerySidebar } from "@/components/gallery-sidebar";
import { AppChrome } from "@/components/app-chrome";

/**
 * Wraps the app in its frame: the sidebar on the tinted canvas, the page on a rounded sheet.
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
  // The gallery list lives in SQLite, which Next cannot see changing. Without this the
  // production build froze the dashboard and sidebar at whatever existed at build time.
  await connection();

  // A failing sidebar query must not take every page down with it — the root layout sits
  // above every error boundary, so a throw here would leave only Next's bare error screen.
  const lists = await Promise.all([
    db.gallery.findMany({
      where: { deletedAt: null },
      select: { id: true, name: true, icon: true, parentGalleryId: true, sortOrder: true, autoAdded: true },
    }),
    db.gallery.findMany({
      where: { deletedAt: { not: null } },
      select: { id: true, name: true },
      orderBy: { deletedAt: "desc" },
    }),
    db.workspace.findMany({ select: { id: true, name: true }, orderBy: { createdAt: "asc" } }),
  ]).catch((error) => {
    console.error("Sidebar query failed", error);
    return null;
  });

  if (!lists || (lists[0].length === 0 && lists[1].length === 0)) {
    return (
      <>
        <main className="flex min-h-dvh flex-1 flex-col">{children}</main>
        <AppChrome />
      </>
    );
  }

  const [galleries, trashed, workspaces] = lists;
  return (
    <div className="flex min-h-dvh flex-1 flex-col md:flex-row md:p-2 md:pl-0">
      <GallerySidebar galleries={galleries} trashed={trashed} workspaces={workspaces} />
      <main className="sheet flex flex-col">{children}</main>
      <AppChrome />
    </div>
  );
}
