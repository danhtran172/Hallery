import Link from "next/link";
import type { PageObjectResponse } from "@notionhq/client";
import { CardCover } from "@/components/card-cover";
import { CardGrid, type GridProperty } from "@/components/card-grid";
import { CardPendingOverlay } from "@/components/link-pending";
import { CARD_WIDTH_FACTOR, type CardKind, type ResolvedCardLayout } from "@/lib/card-layout";
import { propertyById } from "@/lib/page-properties";
import type { RenderContext } from "@/lib/property-render";

export type CardCoverModel = {
  /** CSS aspect-ratio, e.g. "16 / 9". */
  ratio: string;
  round: boolean;
  /** Changes whenever the picture does, so the lazy image restarts cleanly. */
  key: string;
  /** False: no picture. Undefined: unknown until the content-image lookup runs. */
  hasSource: boolean | undefined;
  previewUrl?: string;
  imageUrl?: string;
  posX: number;
  posY: number;
};

/**
 * One Gallery card: a whole-card link to the item, with the cover and the arranged
 * properties drawn above it. The content layer ignores the pointer so a click anywhere opens
 * the item — except on links and buttons inside it, which opt back in and sit higher.
 */
export function GalleryCard({
  page,
  title,
  icon,
  href,
  layout,
  kind,
  cover,
  galleryId,
  viewId,
  context,
}: {
  page: PageObjectResponse;
  title: string;
  icon: string | null;
  href: string;
  layout: ResolvedCardLayout<GridProperty>;
  kind: CardKind;
  /** Null when this view shows no cover. */
  cover: CardCoverModel | null;
  galleryId: string;
  viewId: string;
  context: RenderContext;
}) {
  const valueOf = (propertyId: string) => propertyById(page, propertyId);
  const region = (id: string) =>
    layout.regions[id] ? (
      <CardGrid grid={layout.regions[id]} title={title} valueOf={valueOf} context={context} />
    ) : null;

  const coverBlock = cover && (
    <div
      // A top cover has no explicit width. It must stretch across the card;
      // `self-start` makes a landscape aspect-ratio box shrink to zero.
      className={`g-mat ${layout.sideBySide ? "self-start" : "w-full"}`}
      style={layout.sideBySide ? { width: `${layout.ratio[0]}%` } : undefined}
    >
      <div className={`g-pic${cover.round ? " !rounded-full" : ""}`}>
      <CardCover
        key={cover.key}
        ratio={cover.ratio}
        round={cover.round}
        galleryId={galleryId}
        viewId={viewId}
        pageId={page.id}
        initialX={cover.posX}
        initialY={cover.posY}
        hasSource={cover.hasSource}
        initialPreviewUrl={cover.previewUrl}
        initialImageUrl={cover.imageUrl}
      />
      {layout.overlay.length > 0 && (
        // Above the card-wide link so overlaid links stay clickable, and on a scrim because
        // the image underneath is unknowable.
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 bg-gradient-to-t from-black/75 via-black/40 to-transparent p-2 [&_dd]:text-white [&_dt]:!text-white/60 [&_p]:!text-white">
          <CardGrid
            grid={{
              cols: 1,
              rows: 1,
              boxes: [{ id: "overlay", colSpan: 1, rowSpan: 1, merged: false, fields: layout.overlay }],
            }}
            title={title}
            valueOf={valueOf}
            context={context}
          />
        </div>
      )}
      </div>
    </div>
  );

  return (
    <div
      className="group g-card"
      // Fixed per kind rather than stretching, so a gallery of mixed layouts still lines up —
      // but never wider than the row, which a 1.2× card would be on a one-column phone.
      style={{ width: `min(100%, calc(var(--card-base) * ${CARD_WIDTH_FACTOR[kind]}))` }}
    >
      <Link href={href} prefetch={false} scroll={false} aria-label={title} className="g-card-link">
        <CardPendingOverlay />
      </Link>

      {layout.sideBySide ? (
        <>
          <div className="flex">
            {layout.cover === "left" && coverBlock}
            <div className="g-body min-w-0 flex-1 p-3.5">{region("main")}</div>
            {layout.cover === "right" && coverBlock}
          </div>
          {layout.regions.below && <div className="g-body px-3.5 pb-3.5">{region("below")}</div>}
        </>
      ) : (
        <>
          {coverBlock}
          {Object.keys(layout.regions).length > 0 && (
            <div className={`g-body flex flex-col gap-2 ${cover ? "px-3.5 pt-3 pb-3.5" : "p-4"}`}>
              <CardIcon icon={icon} />
              {Object.keys(layout.regions).map((id) => (
                <div key={id}>{region(id)}</div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

/** An emoji icon as text; an image icon as a picture rather than its URL spelled out. */
function CardIcon({ icon }: { icon: string | null }) {
  if (!icon) return null;
  if (!/^https?:\/\//.test(icon)) return <span className="text-lg leading-none">{icon}</span>;
  return (
    <span
      aria-hidden
      className="size-5 rounded bg-contain bg-center bg-no-repeat"
      style={{ backgroundImage: `url(${JSON.stringify(icon)})` }}
    />
  );
}
