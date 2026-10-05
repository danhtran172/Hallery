import Link from "next/link";
import type { CategoryAxisRecord, CategoryBucket } from "@/lib/category";
import { axisAllowsMultiple } from "@/lib/category";

/**
 * Filter strip above the gallery grid. Every option is a link, so the active filter lives
 * in the URL — shareable, and back/forward behave the way people expect.
 */
export function CategoryBar({
  galleryId,
  axes,
  activeAxis,
  buckets,
  activeValue,
  partialCounts,
  preserved,
}: {
  galleryId: string;
  axes: CategoryAxisRecord[];
  activeAxis: CategoryAxisRecord;
  buckets: CategoryBucket[];
  activeValue: string | null;
  partialCounts: boolean;
  /** The rest of the Gallery's URL state — the view above all — kept across a category change. */
  preserved: Record<string, string>;
}) {
  const base = `/galleries/${galleryId}`;
  const hrefFor = (axisId: string, value: string | null) => {
    const params = new URLSearchParams(preserved);
    params.set("axis", axisId);
    if (value) params.set("value", value);
    return `${base}?${params}`;
  };

  return (
    <div className="mb-5 flex flex-col gap-3">
      {axes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Phân loại theo</span>
          {axes.map((axis) => (
            <Link
              key={axis.id}
              href={hrefFor(axis.id, null)}
              scroll={false}
              aria-current={axis.id === activeAxis.id ? "true" : undefined}
              className={`btn btn-sm ${axis.id === activeAxis.id ? "btn-secondary border-muted text-ink" : "btn-ghost"}`}
            >
              {axis.displayLabel ?? axis.notionPropertyName}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-1.5">
        <Chip href={hrefFor(activeAxis.id, null)} active={activeValue === null}>
          Tất cả
        </Chip>
        {buckets.map((bucket) => {
          const active = bucket.value === activeValue;
          return (
            // Clicking the active chip clears the filter, so the strip toggles.
            <Chip key={bucket.value} href={hrefFor(activeAxis.id, active ? null : bucket.value)} active={active}>
              {bucket.label}
              <span className="ml-1.5 text-faint tabular-nums">
                {bucket.count}
                {partialCounts ? "+" : ""}
              </span>
            </Chip>
          );
        })}
      </div>

      {axisAllowsMultiple(activeAxis.sourceType) && (
        <p className="text-[11px] text-faint">Một item có thể thuộc nhiều phân loại, nên tổng các số trên lớn hơn số item.</p>
      )}
    </div>
  );
}

function Chip({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "true" : undefined}
      className={`rounded-full border px-3 py-1 text-xs transition-colors ${
        active
          ? "border-brand bg-brand-soft font-medium text-brand-hover"
          : "border-line text-ink-soft hover:border-line-strong hover:bg-canvas"
      }`}
    >
      {children}
    </Link>
  );
}
