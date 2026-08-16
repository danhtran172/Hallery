import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { isFullDataSource } from "@notionhq/client";
import { addGallery } from "./actions";

export default async function PickDatabasePage({
  params,
}: PageProps<"/workspaces/[workspaceId]/pick">) {
  const { workspaceId } = await params;
  const workspace = await db.workspace.findUnique({ where: { id: workspaceId } });
  if (!workspace) notFound();
  const notion = getNotionClient(workspace.accessToken);

  const alreadyAdded = await db.gallery.findMany({
    where: { workspaceId },
    select: { notionDataSourceId: true },
  });
  const addedIds = new Set(alreadyAdded.map((g) => g.notionDataSourceId));

  const results = await notion.search({
    filter: { property: "object", value: "data_source" },
    page_size: 50,
  });

  const dataSources = results.results.filter(isFullDataSource);

  return (
    <div className="mx-auto max-w-2xl px-6 py-16">
      <p className="mb-1 text-sm font-medium uppercase tracking-wide text-emerald-700">{workspace.name}</p>
      <h1 className="mb-2 text-2xl font-semibold text-stone-900">Chọn database làm Gallery</h1>
      <p className="mb-8 text-sm text-stone-600">
        Chỉ thấy database nào đã được share với integration trong Notion. Nếu không thấy DB cần dùng, vào database
        đó trên Notion → &quot;Connections&quot; → thêm integration.
      </p>

      {dataSources.length === 0 && (
        <p className="rounded-md border border-dashed border-stone-300 px-4 py-6 text-sm text-stone-500">
          Chưa có database nào được share với integration này.
        </p>
      )}

      <ul className="flex flex-col gap-2">
        {dataSources.map((ds) => {
          const title = ds.title.map((t) => t.plain_text).join("") || "Untitled";
          const databaseId =
            ds.database_parent.type === "database_id" ? ds.database_parent.database_id : ds.id;
          const added = addedIds.has(ds.id);
          return (
            <li
              key={ds.id}
              className="flex items-center justify-between gap-4 rounded-md border border-stone-200 px-4 py-3"
            >
              <span className="text-sm font-medium text-stone-800">{title}</span>
              {added ? (
                <span className="text-xs text-stone-400">Đã thêm</span>
              ) : (
                <form action={addGallery.bind(null, workspaceId, ds.id, databaseId, title)}>
                  <button
                    type="submit"
                    className="rounded-md bg-emerald-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-800"
                  >
                    Thêm làm Gallery
                  </button>
                </form>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
