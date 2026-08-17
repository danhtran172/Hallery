import Link from "next/link";
import { notFound } from "next/navigation";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { getNotionClient } from "@/lib/notion";
import { SELECT_AXIS_TYPES, listAxisCandidates } from "@/lib/category";
import { saveCategoryAxes } from "./actions";

export default async function CategorySettingsPage({
  params,
}: PageProps<"/galleries/[galleryId]/settings/category">) {
  const { galleryId } = await params;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, categoryAxes: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();

  const notion = getNotionClient(gallery.workspace.accessToken);
  const dataSource = await notion.dataSources.retrieve({ data_source_id: gallery.notionDataSourceId });
  const candidates = isFullDataSource(dataSource) ? listAxisCandidates(dataSource) : [];

  const chosenIds = new Set(gallery.categoryAxes.map((axis) => axis.notionPropertyId));
  const liveIds = new Set(candidates.map((candidate) => candidate.id));
  const orphans = gallery.categoryAxes.filter((axis) => !liveIds.has(axis.notionPropertyId));

  return (
    <div className="mx-auto max-w-2xl px-6 py-12">
      <Link href={`/galleries/${galleryId}`} className="text-xs text-stone-500 hover:underline">
        ← {gallery.name}
      </Link>
      <h1 className="mt-2 mb-1 text-2xl font-semibold text-stone-900">Phân loại</h1>
      <p className="mb-8 text-sm text-stone-600">
        Chọn property dùng để phân loại item. Mỗi property được chọn thành một cách xem, hiện thành thanh lọc phía
        trên Gallery.
      </p>

      {orphans.length > 0 && (
        <div className="mb-6 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {orphans.map((axis) => axis.notionPropertyName).join(", ")} không còn tồn tại trong Notion. Bỏ tích rồi lưu
          để gỡ khỏi danh sách.
        </div>
      )}

      {candidates.length === 0 && orphans.length === 0 ? (
        <p className="rounded-md border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-500">
          Database này chưa có property nào dùng được để phân loại. Cần một property kiểu Select, Multi-select,
          Status hoặc Relation.
        </p>
      ) : (
        <form action={saveCategoryAxes.bind(null, galleryId)} className="flex flex-col gap-5">
          <div className="flex flex-col gap-2 rounded-lg border border-stone-200 p-5">
            {candidates.map((candidate) => {
              const isRelation = candidate.type === "relation";
              return (
                <label key={candidate.id} className="flex items-start gap-3 text-sm text-stone-700">
                  <input
                    type="checkbox"
                    name="axis"
                    value={`${candidate.id}|${candidate.type}|${candidate.name}`}
                    defaultChecked={chosenIds.has(candidate.id)}
                    disabled={isRelation}
                    className="mt-1"
                  />
                  <span>
                    {candidate.name}
                    <span className="ml-2 font-mono text-xs text-stone-400">{candidate.type}</span>
                    {isRelation && (
                      <span className="block text-xs text-stone-400">
                        Trục liên kết chưa hỗ trợ — sẽ làm ở bước sau của Phase 3.
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>

          <p className="text-xs text-stone-500">
            Thứ tự trong danh sách này là thứ tự hiện trên Gallery. Với Multi-select, một item có thể thuộc nhiều
            phân loại, nên tổng số của các phân loại sẽ lớn hơn tổng số item.
          </p>

          <button
            type="submit"
            className="self-start rounded-md bg-emerald-700 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-800"
          >
            Lưu
          </button>
        </form>
      )}

      <p className="mt-8 text-xs text-stone-400">
        Trục kiểu {SELECT_AXIS_TYPES.join(" / ")} không tốn thêm request nào — giá trị đã có sẵn trong dữ liệu
        Gallery vừa tải.
      </p>
    </div>
  );
}
