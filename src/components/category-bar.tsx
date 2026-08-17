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
}: {
  galleryId: string;
  axes: CategoryAxisRecord[];
  activeAxis: CategoryAxisRecord;
  buckets: CategoryBucket[];
  activeValue: string | null;
  partialCounts: boolean;
}) {
  const base = `/galleries/${galleryId}`;
  const hrefFor = (axisId: string, value: string | null) => {
    const params = new URLSearchParams({ axis: axisId });
    if (value) params.set("value", value);
    return `${base}?${params}`;
  };

  return (
    <div className="mb-6 flex flex-col gap-3">
      {axes.length > 1 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-stone-500">Phân loại theo</span>
          {axes.map((axis) => (
            <Link
              key={axis.id}
              href={hrefFor(axis.id, null)}
              aria-current={axis.id === activeAxis.id ? "true" : undefined}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                axis.id === activeAxis.id
                  ? "border-stone-400 bg-stone-100 font-medium text-stone-800"
                  : "border-stone-200 text-stone-500 hover:border-stone-300"
              }`}
            >
              {axis.displayLabel ?? axis.notionPropertyName}
            </Link>
          ))}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href={hrefFor(activeAxis.id, null)}
          className={`rounded-full border px-3 py-1 text-xs ${
            activeValue === null
              ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800"
              : "border-stone-200 text-stone-600 hover:border-stone-300"
          }`}
        >
          Tất cả
        </Link>
        {buckets.map((bucket) => {
          const active = bucket.value === activeValue;
          return (
            <Link
              key={bucket.value}
              // Clicking the active chip clears the filter, so the strip toggles.
              href={hrefFor(activeAxis.id, active ? null : bucket.value)}
              className={`rounded-full border px-3 py-1 text-xs ${
                active
                  ? "border-emerald-600 bg-emerald-50 font-medium text-emerald-800"
                  : "border-stone-200 text-stone-600 hover:border-stone-300"
              }`}
            >
              {bucket.label}
              <span className="ml-1.5 tabular-nums text-stone-400">
                {bucket.count}
                {partialCounts ? "+" : ""}
              </span>
            </Link>
          );
        })}
      </div>

      {axisAllowsMultiple(activeAxis.sourceType) && (
        <p className="text-[11px] text-stone-400">
          Một item có thể thuộc nhiều phân loại, nên tổng các số trên lớn hơn số item.
        </p>
      )}
    </div>
  );
}
