import Link from "next/link";

export type SettingsSection = "display" | "card" | "category";

const SECTIONS: { id: SettingsSection; label: string; path: string }[] = [
  { id: "display", label: "Hiển thị", path: "display" },
  { id: "card", label: "Bố cục card", path: "card" },
  { id: "category", label: "Phân loại", path: "category" },
];

/**
 * One header for a Gallery's three settings screens: the way back, and tabs between them.
 * The view travels along, so whatever view the reader came from is the one being edited and
 * the one they return to.
 */
export function SettingsHeader({
  galleryId,
  galleryName,
  viewId,
  active,
  description,
  compact,
}: {
  galleryId: string;
  galleryName: string;
  viewId?: string;
  active: SettingsSection;
  description?: React.ReactNode;
  /** Tighter spacing for full-height editors. */
  compact?: boolean;
}) {
  const query = viewId ? `?view=${viewId}` : "";
  return (
    <header className={compact ? "mb-4 shrink-0" : "mb-8"}>
      <Link href={`/galleries/${galleryId}${query}`} className="text-xs text-muted hover:text-ink hover:underline">
        ← {galleryName}
      </Link>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-3">
        <h1 className={`${compact ? "text-xl" : "text-2xl"} font-semibold text-ink`}>
          {SECTIONS.find((section) => section.id === active)?.label}
        </h1>
        <nav aria-label="Cài đặt gallery" className="flex max-w-full items-center overflow-x-auto rounded-lg border border-line p-0.5">
          {SECTIONS.map((section) => (
            <Link
              key={section.id}
              href={`/galleries/${galleryId}/settings/${section.path}${query}`}
              aria-current={section.id === active ? "page" : undefined}
              className={`btn btn-sm ${section.id === active ? "bg-brand-soft text-brand-hover" : "btn-ghost"}`}
            >
              {section.label}
            </Link>
          ))}
        </nav>
      </div>
      {description && <p className="mt-2 max-w-3xl text-sm text-ink-soft">{description}</p>}
    </header>
  );
}
