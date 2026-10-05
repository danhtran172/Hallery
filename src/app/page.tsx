import Link from "next/link";
import { db } from "@/lib/db";
import { galleryPreviews, type GalleryPreview } from "@/lib/gallery-preview";
import { relativeTime } from "@/lib/relative-time";
import { WorkspaceActions } from "@/components/workspace-actions";
import { GalleryGlyph } from "@/components/gallery-glyph";
import { Icon, LogoMark } from "@/components/icons";
import { SearchButton } from "@/components/search-button";
import { NOTION_INTEGRATIONS_URL } from "@/lib/notion-url";

export default async function Home() {
  const workspaces = await db.workspace.findMany({
    // autoAdded galleries are relation targets, reachable from the gallery that links to
    // them rather than listed here — otherwise one database drags a dozen along with it.
    include: {
      galleries: {
        where: { parentGalleryId: null, autoAdded: false, deletedAt: null },
        orderBy: { sortOrder: "asc" },
        select: { id: true, name: true, icon: true, _count: { select: { subGalleries: { where: { deletedAt: null } } } } },
      },
    },
    orderBy: { createdAt: "asc" },
  });

  if (workspaces.length === 0) return <Welcome />;

  const galleryIds = workspaces.flatMap((workspace) => workspace.galleries.map((gallery) => gallery.id));
  const previews = await galleryPreviews(galleryIds);
  const totalItems = [...previews.values()].reduce((sum, preview) => sum + (preview.itemCount ?? 0), 0);

  return (
    <div className="mx-auto w-full max-w-6xl px-5 py-8 sm:px-10 sm:py-12">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">Hallery</p>
          <h1 className="display mt-2 text-4xl text-ink sm:text-5xl">Gallery của bạn</h1>
          <p className="mt-3 text-sm text-muted">
            {galleryIds.length} gallery
            {totalItems > 0 && ` · ${totalItems.toLocaleString("vi-VN")} item`}
            {` · ${workspaces.length} workspace`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SearchButton />
          <Link href="/connect" className="btn btn-secondary">
            <Icon name="plug" />
            Kết nối workspace
          </Link>
        </div>
      </header>

      <div className="flex flex-col gap-12">
        {workspaces.map((workspace) => (
          <section key={workspace.id} aria-labelledby={`ws-${workspace.id}`}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <h2 id={`ws-${workspace.id}`} className="flex items-baseline gap-2.5">
                <span className="display text-xl text-ink">{workspace.name}</span>
                <span className="text-xs text-faint">{workspace.galleries.length} gallery</span>
              </h2>
              <WorkspaceActions workspaceId={workspace.id} name={workspace.name} galleryCount={workspace.galleries.length} />
            </div>

            <ul className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {workspace.galleries.map((gallery) => (
                <li key={gallery.id}>
                  <GalleryTile
                    id={gallery.id}
                    name={gallery.name}
                    icon={gallery.icon}
                    subCount={gallery._count.subGalleries}
                    preview={previews.get(gallery.id)}
                  />
                </li>
              ))}
              <li>
                <Link
                  href={`/workspaces/${workspace.id}/pick`}
                  className="group flex h-full min-h-48 flex-col items-center justify-center gap-3 rounded-3xl border-2 border-dashed border-line-strong p-6 text-sm text-muted transition-colors hover:border-brand hover:bg-brand-soft/50 hover:text-brand-ink"
                >
                  <span className="flex size-11 items-center justify-center rounded-2xl bg-subtle transition-colors group-hover:bg-surface">
                    <Icon name="plus" className="size-5" />
                  </span>
                  {workspace.galleries.length === 0 ? "Chọn database đầu tiên làm gallery" : "Thêm gallery"}
                </Link>
              </li>
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}

function GalleryTile({
  id,
  name,
  icon,
  subCount,
  preview,
}: {
  id: string;
  name: string;
  icon: string | null;
  subCount: number;
  preview: GalleryPreview | undefined;
}) {
  const meta = [
    preview?.itemCount != null ? `${preview.itemCount.toLocaleString("vi-VN")} item` : "Chưa mở lần nào",
    subCount > 0 ? `${subCount} gallery con` : null,
  ].filter(Boolean);

  return (
    <Link
      href={`/galleries/${id}`}
      className="group flex h-full flex-col rounded-3xl bg-surface p-2 shadow-card ring-1 ring-line transition-[box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:shadow-lift"
    >
      <Mosaic name={name} icon={icon} covers={preview?.covers ?? []} />
      <div className="flex items-center gap-3 px-2.5 pt-3 pb-2">
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink">{name}</p>
          <p className="mt-0.5 flex items-center gap-1.5 truncate text-xs text-muted">
            {preview?.syncError && (
              <span title="Lần đồng bộ gần nhất gặp lỗi" className="size-1.5 shrink-0 rounded-full bg-warn" />
            )}
            {meta.join(" · ")}
            {preview?.syncedAt && <span className="text-faint">· {relativeTime(preview.syncedAt)}</span>}
          </p>
        </div>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-subtle text-muted transition-colors group-hover:bg-brand group-hover:text-on-brand">
          <Icon name="chevron-right" className="size-4" />
        </span>
      </div>
    </Link>
  );
}

/** Up to four covers, laid out so one, two, three or four all fill the frame. */
function Mosaic({ name, icon, covers }: { name: string; icon: string | null; covers: string[] }) {
  if (covers.length === 0) {
    return (
      <div className="flex aspect-[16/10] items-center justify-center rounded-[1.1rem] bg-subtle">
        <GalleryGlyph name={name} icon={icon} size="lg" />
      </div>
    );
  }
  const layout =
    covers.length === 1
      ? "grid-cols-1"
      : covers.length === 2
        ? "grid-cols-2"
        : covers.length === 3
          ? "grid-cols-[2fr_1fr] grid-rows-2 [&>*:first-child]:row-span-2"
          : "grid-cols-2 grid-rows-2";
  return (
    <div className={`grid aspect-[16/10] gap-1 overflow-hidden rounded-[1.1rem] bg-subtle ${layout}`}>
      {covers.map((src) => (
        // eslint-disable-next-line @next/next/no-img-element -- local, already-resized WebP from the cover cache
        <img key={src} src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
      ))}
    </div>
  );
}

/** First run: nothing connected yet, so the whole page is the way in. */
function Welcome() {
  const steps = [
    {
      title: "Tạo integration trong Notion",
      body: "Notion → Settings → Integrations → New integration, rồi copy Internal Integration Secret.",
      href: NOTION_INTEGRATIONS_URL,
    },
    { title: "Chia sẻ database", body: "Mở database trong Notion → ••• → Connections → chọn integration vừa tạo." },
    { title: "Dán secret vào Hallery", body: "Chọn database muốn xem — mỗi database thành một gallery." },
  ];

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col justify-center px-5 py-12 sm:px-10">
      <div className="grid items-center gap-10 lg:grid-cols-[1.1fr_1fr]">
        <div>
          <span className="flex items-center gap-2.5 text-ink">
            <LogoMark className="size-9" />
            <span className="display text-2xl">Hallery</span>
          </span>
          <h1 className="display mt-8 text-4xl leading-[1.05] text-ink sm:text-6xl">
            Database Notion,
            <br />
            <span className="text-brand-ink">thành gallery.</span>
          </h1>
          <p className="mt-5 max-w-md text-base leading-relaxed text-ink-soft">
            Bạn tự quyết mỗi property hiển thị ra sao, card bố trí thế nào. Dữ liệu vẫn nằm ở Notion — Hallery không bao
            giờ đổi cấu trúc database.
          </p>
          <Link href="/connect" className="btn btn-primary mt-8 h-11 px-6 text-[15px]">
            Bắt đầu kết nối
            <Icon name="chevron-right" />
          </Link>
        </div>

        <ol className="flex flex-col gap-3">
          {steps.map((step, index) => (
            <li key={step.title} className="flex gap-4 rounded-3xl bg-surface p-5 shadow-card ring-1 ring-line">
              <span className="display flex size-9 shrink-0 items-center justify-center rounded-2xl bg-brand-soft text-base text-brand-ink">
                {index + 1}
              </span>
              <div className="min-w-0">
                <p className="font-medium text-ink">{step.title}</p>
                <p className="mt-1 text-sm leading-relaxed text-muted">{step.body}</p>
                {step.href && (
                  <a href={step.href} target="_blank" rel="noreferrer" className="link mt-2 inline-flex items-center gap-1 text-sm">
                    Mở trang Integrations
                    <Icon name="external" className="size-3.5" />
                  </a>
                )}
              </div>
            </li>
          ))}
        </ol>
      </div>
    </div>
  );
}
