import Link from "next/link";
import { RETURN_PARAM, galleryHrefFromReturn } from "@/lib/gallery-query";
import { Icon, type IconName } from "@/components/icons";

export type SettingsSection = "display" | "card" | "category";

const SECTIONS: { id: SettingsSection; label: string; path: string; icon: IconName }[] = [
  { id: "display", label: "Hiển thị", path: "display", icon: "eye" },
  { id: "card", label: "Bố cục card", path: "card", icon: "layout" },
  { id: "category", label: "Phân loại", path: "category", icon: "tag" },
];

/** The query a settings screen carries: the view being edited and the way back to the grid. */
export function settingsQuery(viewId: string | undefined, back: string | undefined, extra?: Record<string, string>) {
  const params = new URLSearchParams();
  if (viewId) params.set("view", viewId);
  if (back) params.set(RETURN_PARAM, back);
  for (const [key, value] of Object.entries(extra ?? {})) params.set(key, value);
  const query = params.toString();
  return query ? `?${query}` : "";
}

/** The href of one settings screen, keeping the view and the Gallery state to return to. */
export function settingsHref(galleryId: string, section: SettingsSection, viewId?: string, back?: string, extra?: Record<string, string>) {
  return `/galleries/${galleryId}/settings/${section}${settingsQuery(viewId, back, extra)}`;
}

/**
 * One header for a Gallery's three settings screens: the way back, and tabs between them.
 * The view travels along, so whatever view the reader came from is the one being edited, and
 * "back" returns to the Gallery exactly as it was — search, category and all.
 */
export function SettingsHeader({
  galleryId,
  galleryName,
  viewId,
  back,
  active,
  description,
  compact,
}: {
  galleryId: string;
  galleryName: string;
  viewId?: string;
  /** The Gallery's own query string when the reader came from it. */
  back?: string;
  active: SettingsSection;
  description?: React.ReactNode;
  /** Tighter spacing for full-height editors. */
  compact?: boolean;
}) {
  const backHref = back ? galleryHrefFromReturn(galleryId, back) : `/galleries/${galleryId}${viewId ? `?view=${viewId}` : ""}`;
  return (
    <header className={compact ? "mb-4 shrink-0" : "mb-8"}>
      <Link
        href={backHref}
        className="inline-flex items-center gap-1 rounded-full py-1 pr-2 text-[13px] text-muted transition-colors hover:text-ink"
      >
        <Icon name="arrow-left" className="size-4" />
        {galleryName}
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className={`display ${compact ? "text-2xl" : "text-3xl"} text-ink`}>
          {SECTIONS.find((section) => section.id === active)?.label}
        </h1>
        <nav aria-label="Cài đặt gallery" className="segmented">
          {SECTIONS.map((section) => (
            <Link
              key={section.id}
              href={settingsHref(galleryId, section.id, viewId, back)}
              aria-current={section.id === active ? "page" : undefined}
            >
              <Icon name={section.icon} className="size-3.5" />
              {section.label}
            </Link>
          ))}
        </nav>
      </div>
      {description && <p className="mt-3 max-w-3xl text-sm leading-relaxed text-ink-soft">{description}</p>}
    </header>
  );
}
