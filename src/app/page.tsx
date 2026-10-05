import Link from "next/link";
import { db } from "@/lib/db";
import { WorkspaceActions } from "@/components/workspace-actions";

export default async function Home() {
  const workspaces = await db.workspace.findMany({
    // autoAdded galleries are relation targets, reachable from the gallery that links to
    // them rather than listed here — otherwise one database drags a dozen along with it.
    include: {
      galleries: {
        where: { parentGalleryId: null, autoAdded: false, deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, icon: true, notionCache: { select: { lastSyncError: true } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (workspaces.length === 0) return <Welcome />;

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10 sm:px-6 sm:py-14">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow">Hallery</p>
          <h1 className="mt-1 text-2xl font-semibold text-ink">Gallery của bạn</h1>
        </div>
        <Link href="/connect" className="btn btn-secondary">
          + Kết nối workspace khác
        </Link>
      </div>

      <div className="flex flex-col gap-10">
        {workspaces.map((workspace) => (
          <section key={workspace.id}>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2">
              <h2 className="text-sm font-semibold text-ink-soft">
                {workspace.name}
                <span className="ml-2 font-normal text-faint">{workspace.galleries.length} gallery</span>
              </h2>
              <WorkspaceActions workspaceId={workspace.id} name={workspace.name} galleryCount={workspace.galleries.length} />
            </div>
            {workspace.galleries.length === 0 ? (
              <div className="empty-state flex flex-col items-center gap-3 py-8">
                <p>Workspace này chưa có gallery nào.</p>
                <Link href={`/workspaces/${workspace.id}/pick`} className="btn btn-primary btn-sm">
                  Chọn database làm gallery
                </Link>
              </div>
            ) : (
              <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {workspace.galleries.map((gallery) => (
                  <li key={gallery.id}>
                    <Link
                      href={`/galleries/${gallery.id}`}
                      className="panel flex items-center gap-3 px-4 py-3.5 transition-colors hover:border-brand/60 hover:bg-canvas"
                    >
                      <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-brand-soft text-base">
                        {gallery.icon && !gallery.icon.startsWith("http") ? gallery.icon : gallery.name.slice(0, 1).toUpperCase()}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium text-ink">{gallery.name}</span>
                        {gallery.notionCache?.lastSyncError && (
                          <span className="block text-xs text-amber-700">Lần đồng bộ gần nhất gặp lỗi</span>
                        )}
                      </span>
                      <span aria-hidden className="text-faint">→</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}

/** First run: nothing connected yet, so the whole page is the way in. */
function Welcome() {
  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center px-4 py-16 sm:px-6">
      <p className="eyebrow">Hallery</p>
      <h1 className="mt-2 text-3xl font-semibold text-ink">Gallery cho dữ liệu Notion của bạn</h1>
      <p className="mt-3 text-base leading-relaxed text-ink-soft">
        Biến database Notion thành gallery — bạn tự quyết mỗi property hiển thị ra sao, card bố trí thế nào. Dữ liệu
        vẫn nằm ở Notion; Hallery không bao giờ đổi cấu trúc database.
      </p>
      <ol className="mt-8 flex flex-col gap-2 text-sm text-ink-soft">
        {["Tạo một integration trong Notion và copy secret", "Chia sẻ database với integration", "Dán secret vào Hallery, chọn database"].map(
          (step, index) => (
            <li key={step} className="flex items-center gap-3">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-xs font-semibold text-brand">
                {index + 1}
              </span>
              {step}
            </li>
          ),
        )}
      </ol>
      <Link href="/connect" className="btn btn-primary mt-8 h-10 self-start px-5">
        Bắt đầu kết nối Notion
      </Link>
    </div>
  );
}
