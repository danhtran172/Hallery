import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { isFullDataSource } from "@notionhq/client";
import { db } from "@/lib/db";
import { getGalleryNotionSnapshot, type GalleryNotionSnapshot } from "@/lib/gallery-notion-cache";
import { isNotionAccessError } from "@/lib/notion-errors";
import { NotionProblemState } from "@/components/notion-problem";
import { SettingsHeader } from "@/components/settings-header";
import { SELECT_AXIS_TYPES, listAxisCandidates } from "@/lib/category";
import { viewTypeOf } from "@/lib/gallery-view";
import { CategoryForm } from "./category-form";

export const metadata: Metadata = { title: "Phân loại" };

export default async function CategorySettingsPage({
  params,
  searchParams,
}: PageProps<"/galleries/[galleryId]/settings/category">) {
  const { galleryId } = await params;
  const { view: viewParam, back } = await searchParams;
  const viewId = typeof viewParam === "string" ? viewParam : undefined;
  const backQuery = typeof back === "string" ? back : undefined;
  const gallery = await db.gallery.findUnique({
    where: { id: galleryId },
    include: {
      workspace: true,
      categoryAxes: { orderBy: { sortOrder: "asc" } },
      views: { orderBy: { sortOrder: "asc" }, select: { id: true, layoutConfig: true } },
    },
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
    <div className="mx-auto w-full max-w-3xl px-5 py-8 sm:px-8 sm:py-10">
      <SettingsHeader
        galleryId={galleryId}
        galleryName={gallery.name}
        viewId={viewId}
        viewType={viewTypeOf(gallery.views.find((view) => view.id === viewId) ?? gallery.views[0])}
        back={backQuery}
        active="category"
        description="Chọn property dùng để phân loại item. Mỗi property được chọn thành một thanh lọc phía trên Gallery."
      />

      {orphans.length > 0 && (
        <div className="notice mb-6">
          {orphans.map((axis) => axis.notionPropertyName).join(", ")} không còn tồn tại trong Notion — bấm Lưu để gỡ
          khỏi thanh phân loại.
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
