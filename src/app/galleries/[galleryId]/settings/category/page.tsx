import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot, type GalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { isNotionAccessError } from "@/lib/notion-errors";
import { NotionProblemState } from "@/components/notion-problem";
import { SettingsHeader } from "@/components/settings-header";
import { SELECT_AXIS_TYPES, listAxisCandidates } from "@/lib/category";
import { CategoryForm } from "./category-form";

export const metadata: Metadata = { title: "Phân loại" };

export default async function CategorySettingsPage({
  params,
  searchParams,
}: PageProps<"/galleries/[galleryId]/settings/category">) {
  const { galleryId } = await params;
  const { view: viewParam } = await searchParams;
  const viewId = typeof viewParam === "string" ? viewParam : undefined;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: { workspace: true, categoryAxes: { orderBy: { sortOrder: "asc" } } },
  });
  if (!gallery) notFound();

  let dataSource: GalleryNotionSnapshot["dataSourceRes"];
  try {
    ({ dataSourceRes: dataSource } = await getGalleryNotionSnapshot({
      galleryId,
      dataSourceId: gallery.notionDataSourceId,
      accessToken: gallery.workspace.accessToken,
    }));
  } catch (error) {
    if (!isNotionAccessError(error)) throw error;
    return (
      <NotionProblemState
        problem={error.problem}
        title={gallery.name}
        context={{
          workspaceId: gallery.workspaceId,
          notionDatabaseId: gallery.notionDatabaseId,
          retryHref: `/galleries/${galleryId}/settings/category`,
        }}
      />
    );
  }
  const candidates = isFullDataSource(dataSource) ? listAxisCandidates(dataSource) : [];

  const chosenIds = new Set(gallery.categoryAxes.map((axis) => axis.notionPropertyId));
  const liveIds = new Set(candidates.map((candidate) => candidate.id));
  const orphans = gallery.categoryAxes.filter((axis) => !liveIds.has(axis.notionPropertyId));

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
      <SettingsHeader
        galleryId={galleryId}
        galleryName={gallery.name}
        viewId={viewId}
        active="category"
        description="Chọn property dùng để phân loại item. Mỗi property được chọn thành một thanh lọc phía trên Gallery."
      />

      {orphans.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {orphans.map((axis) => axis.notionPropertyName).join(", ")} không còn tồn tại trong Notion. Bỏ tích rồi lưu
          để gỡ khỏi danh sách.
        </div>
      )}

      {candidates.length === 0 && orphans.length === 0 ? (
        <p className="empty-state">
          Database này chưa có property nào dùng được để phân loại. Cần một property kiểu Select, Multi-select hoặc
          Status.
        </p>
      ) : (
        <CategoryForm
          galleryId={galleryId}
          candidates={candidates.map((candidate) => ({ ...candidate, chosen: chosenIds.has(candidate.id) }))}
        />
      )}

      <p className="mt-8 text-xs text-faint">
        Trục kiểu {SELECT_AXIS_TYPES.join(" / ")} không tốn thêm request nào — giá trị đã có sẵn trong dữ liệu Gallery
        vừa tải.
      </p>
    </div>
  );
}
