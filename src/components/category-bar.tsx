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
    <div className="mb-6 flex flex-col gap-2.5">
      {axes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Phân loại theo</span>
          <div className="segmented">
            {axes.map((axis) => (
              <Link
                key={axis.id}
                href={hrefFor(axis.id, null)}
                scroll={false}
                aria-current={axis.id === activeAxis.id ? "page" : undefined}
              >
                {axis.displayLabel ?? axis.notionPropertyName}
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* One scrolling row rather than a wrapping wall — a select with forty options would
          otherwise push the cards off the first screen. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        <Chip href={hrefFor(activeAxis.id, null)} active={activeValue === null}>
          Tất cả
        </Chip>
        {buckets.map((bucket) => {
          const active = bucket.value === activeValue;
          return (
            // Clicking the active chip clears the filter, so the strip toggles.
            <Chip key={bucket.value} href={hrefFor(activeAxis.id, active ? null : bucket.value)} active={active}>
              {bucket.label}
              <span className={`tabular-nums ${active ? "opacity-70" : "text-faint"}`}>
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
    <Link href={href} scroll={false} aria-current={active ? "true" : undefined} className="chip">
      {children}
    </Link>
  );
}
