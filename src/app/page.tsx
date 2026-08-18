import Link from "next/link";
import { db } from "@/lib/db";

export default async function Home() {
  const workspaces = await db.workspace.findMany({
    // autoAdded galleries are relation targets, reachable from the gallery that links to
    // them rather than listed here — otherwise one database drags a dozen along with it.
    include: {
      galleries: {
        where: { parentGalleryId: null, autoAdded: false },
        orderBy: { sortOrder: "asc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  return (
    <div className="mx-auto max-w-3xl px-6 py-16">
      <p className="mb-1 text-sm font-medium uppercase tracking-wide text-emerald-700">Hallery</p>
      <h1 className="mb-8 text-2xl font-semibold text-stone-900">Gallery của bạn</h1>

      {workspaces.length === 0 ? (
        <div className="rounded-lg border border-dashed border-stone-300 px-6 py-12 text-center">
          <p className="mb-4 text-sm text-stone-600">Chưa kết nối workspace Notion nào.</p>
          <Link
            href="/connect"
            className="inline-block rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Kết nối Notion
          </Link>
        </div>
      ) : (
        <div className="flex flex-col gap-8">
          {workspaces.map((ws) => (
            <div key={ws.id}>
              <div className="mb-2 flex items-center justify-between">
                <h2 className="text-sm font-semibold text-stone-700">{ws.name}</h2>
                <Link href={`/workspaces/${ws.id}/pick`} className="text-xs text-emerald-700 hover:underline">
                  + Thêm gallery
                </Link>
              </div>
              {ws.galleries.length === 0 ? (
                <p className="text-sm text-stone-400">Chưa có gallery nào.</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {ws.galleries.map((g) => (
                    <li key={g.id}>
                      <Link
                        href={`/galleries/${g.id}`}
                        className="block rounded-md border border-stone-200 px-4 py-3 text-sm font-medium text-stone-800 hover:border-emerald-600"
                      >
                        {g.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
          <Link href="/connect" className="text-xs text-stone-500 hover:underline">
            + Kết nối thêm workspace khác
          </Link>
        </div>
      )}
    </div>
  );
}
