import type { PageObjectResponse, RichTextItemResponse } from "@notionhq/client";
import Link from "next/link";
import { formatDateByGranularity, formatDateRange, formatDuration, type DisplayConfig } from "@/lib/display-config";
import { displayUrl, looksLikeUrl, notionPageUrl, safeHref } from "@/lib/notion-url";
import type { RenderContext } from "@/lib/property-render";
import { NativeButton } from "@/components/native-button";

type PropertyValueResponse = PageObjectResponse["properties"][string];
type RollupItem = { type: string; [key: string]: unknown };

/**
 * Everything clickable inside a card has to rise above the card's whole-surface link (z-10)
 * and opt back into pointer events, which the card's content area turns off.
 */
const INTERACTIVE = "g-ia";

/** Default renderer per Notion property type, customized by an optional Hallery display config. */
export function PropertyValue({
  value,
  displayConfig,
  context,
}: {
  value: PropertyValueResponse;
  displayConfig?: DisplayConfig;
  context?: RenderContext;
}) {
  const cfg = displayConfig ?? {};
  switch (value.type) {
    case "title":
      return value.title.length ? <RichText items={value.title} /> : <Empty />;
    case "rich_text":
      return value.rich_text.length ? (
        <span>
          {cfg.prefix}
          <RichText items={value.rich_text} />
          {cfg.suffix}
        </span>
      ) : (
        <Empty />
      );
    case "number":
      return <NumberValue value={value.number} cfg={cfg} />;
    case "select":
      return value.select ? <SelectOption name={value.select.name} color={value.select.color} cfg={cfg} /> : <Empty />;
    case "status":
      return value.status ? <SelectOption name={value.status.name} color={value.status.color} cfg={cfg} /> : <Empty />;
    case "multi_select":
      if (!value.multi_select.length) return <Empty />;
      if (cfg.kind === "text") {
        return <span>{value.multi_select.map((opt) => withAffixes(opt.name, cfg)).join(", ")}</span>;
      }
      return (
        <span className="inline-flex max-w-full flex-wrap gap-1">
          {value.multi_select.map((opt) => (
            <Pill key={opt.id ?? opt.name} color={opt.color}>
              {withAffixes(opt.name, cfg)}
            </Pill>
          ))}
        </span>
      );
    case "date":
      return value.date ? <span>{formatDateRange(value.date, cfg.kind)}</span> : <Empty />;
    case "checkbox":
      return <CheckboxValue checked={value.checkbox} />;
    case "url":
      return <UrlValue url={value.url} cfg={cfg} />;
    case "email":
      return value.email ? <ExternalLink href={`mailto:${value.email}`} text={value.email} newTab={false} /> : <Empty />;
    case "phone_number":
      return value.phone_number ? (
        <ExternalLink href={`tel:${value.phone_number.replace(/[^\d+]/g, "")}`} text={value.phone_number} newTab={false} />
      ) : (
        <Empty />
      );
    case "people":
      return value.people.length ? (
        <span>{value.people.map((p) => ("name" in p && p.name ? p.name : "Người dùng")).join(", ")}</span>
      ) : (
        <Empty />
      );
    case "files":
      return <FilesValue files={value.files} propertyId={value.id} context={context} />;
    case "relation":
      return (
        <RelationValue
          ids={value.relation.map((entry) => entry.id)}
          // Notion cuts a page's relation list at 25 and flags the rest; the SDK types omit it.
          hasMore={Boolean((value as { has_more?: boolean }).has_more)}
          context={context}
        />
      );
    case "rollup":
      return <RollupValue rollup={value.rollup as RollupItem} cfg={cfg} />;
    case "formula":
      return <FormulaValue formula={value.formula as RollupItem} cfg={cfg} />;
    // System timestamps always carry a time nobody typed, so they read as a day.
    case "created_time":
      return <span title={formatDateByGranularity(value.created_time, "full")}>{formatDay(value.created_time, cfg.kind)}</span>;
    case "last_edited_time":
      return (
        <span title={formatDateByGranularity(value.last_edited_time, "full")}>{formatDay(value.last_edited_time, cfg.kind)}</span>
      );
    case "created_by":
      return <span>{"name" in value.created_by && value.created_by.name ? value.created_by.name : "—"}</span>;
    case "last_edited_by":
      return <span>{"name" in value.last_edited_by && value.last_edited_by.name ? value.last_edited_by.name : "—"}</span>;
    case "unique_id":
      return (
        <span className="tabular-nums">
          {value.unique_id.prefix ? `${value.unique_id.prefix}-` : ""}
          {value.unique_id.number}
        </span>
      );
    case "button":
      return <ButtonValue propertyId={value.id} context={context} />;
    case "verification":
      return value.verification ? (
        <span>{value.verification.state === "verified" ? "✓ Đã xác minh" : "Chưa xác minh"}</span>
      ) : (
        <Empty />
      );
    case "place": {
      const place = value.place;
      if (!place) return <Empty />;
      const text = place.name || place.address || `${place.lat}, ${place.lon}`;
      return <ExternalLink href={`https://www.google.com/maps?q=${place.lat},${place.lon}`} text={text} />;
    }
    default:
      return <Empty />;
  }
}

/** A timestamp as its local calendar day, in the configured granularity. */
function formatDay(iso: string, kind: string | undefined): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  return formatDateByGranularity(day, kind);
}

function withAffixes(text: string, cfg: DisplayConfig) {
  return `${cfg.prefix ?? ""}${text}${cfg.suffix ?? ""}`;
}

function Empty() {
  return <span className="text-faint">—</span>;
}

function ExternalLink({ href, text, newTab = true }: { href: string; text: string; newTab?: boolean }) {
  return (
    <a
      href={href}
      {...(newTab ? { target: "_blank", rel: "noreferrer" } : {})}
      className="g-ia g-a"
    >
      {text}
    </a>
  );
}

/* ── Text ──────────────────────────────────────────────────────────────── */

const TEXT_COLORS: Record<string, string> = {
  gray: "text-stone-500",
  brown: "text-amber-800",
  orange: "text-orange-600",
  yellow: "text-yellow-600",
  green: "text-emerald-700",
  blue: "text-sky-700",
  purple: "text-purple-700",
  pink: "text-pink-600",
  red: "text-red-600",
  gray_background: "bg-stone-100",
  brown_background: "bg-amber-50",
  orange_background: "bg-orange-50",
  yellow_background: "bg-yellow-50",
  green_background: "bg-emerald-50",
  blue_background: "bg-sky-50",
  purple_background: "bg-purple-50",
  pink_background: "bg-pink-50",
  red_background: "bg-red-50",
};

/**
 * Notion rich text with its formatting and links intact. Flattening it to plain text threw
 * away the one thing a text property is often for — a link — and mentions of other pages
 * became dead words.
 */
export function RichText({ items }: { items: RichTextItemResponse[] }) {
  return (
    <>
      {items.map((item, index) => {
        const { bold, italic, strikethrough, underline, code, color } = item.annotations;
        const className = [
          bold && "font-semibold",
          italic && "italic",
          strikethrough && "line-through",
          underline && "underline",
          code && "rounded bg-stone-100 px-1 font-mono text-[0.9em]",
          TEXT_COLORS[color],
        ]
          .filter(Boolean)
          .join(" ");
        const text = item.plain_text;
        const href = safeHref(item.href);
        if (href) {
          const internal = href.startsWith("/");
          return (
            <a
              key={index}
              href={href}
              {...(internal ? {} : { target: "_blank", rel: "noreferrer" })}
              className={`g-ia g-a ${className}`}
            >
              {text}
            </a>
          );
        }
        return className ? (
          <span key={index} className={className}>
            {text}
          </span>
        ) : (
          <span key={index}>{text}</span>
        );
      })}
    </>
  );
}

/* ── Select-like ───────────────────────────────────────────────────────── */

function SelectOption({ name, color, cfg }: { name: string; color: string; cfg: DisplayConfig }) {
  if (cfg.kind === "text") return <span>{withAffixes(name, cfg)}</span>;
  return <Pill color={color}>{withAffixes(name, cfg)}</Pill>;
}

const PILL_COLORS: Record<string, string> = {
  default: "bg-stone-100 text-stone-700",
  gray: "bg-stone-200 text-stone-700",
  brown: "bg-amber-100 text-amber-900",
  orange: "bg-orange-100 text-orange-800",
  yellow: "bg-yellow-100 text-yellow-800",
  green: "bg-emerald-100 text-emerald-800",
  blue: "bg-sky-100 text-sky-800",
  purple: "bg-purple-100 text-purple-800",
  pink: "bg-pink-100 text-pink-800",
  red: "bg-red-100 text-red-800",
};

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span
      className={`inline-block max-w-full truncate rounded px-2 py-0.5 align-middle text-xs font-medium ${
        PILL_COLORS[color] ?? PILL_COLORS.default
      }`}
    >
      {children}
    </span>
  );
}

/* ── Number ────────────────────────────────────────────────────────────── */

function NumberValue({ value, cfg }: { value: number | null; cfg: DisplayConfig }) {
  if (value === null) return <Empty />;
  if (cfg.kind === "rate") {
    const max = cfg.max && cfg.max > 0 ? Math.min(Math.round(cfg.max), 10) : 5;
    const filled = Math.max(0, Math.min(max, Math.round(value)));
    return (
      <span role="img" aria-label={`${value}/${max}`} title={`${value}/${max}`} className="tracking-tight text-amber-500">
        {"★".repeat(filled)}
        <span className="text-stone-300">{"★".repeat(max - filled)}</span>
      </span>
    );
  }
  if (cfg.kind === "duration") return <span>{formatDuration(value)}</span>;
  if (cfg.kind === "with_text") return <span>{withAffixes(formatNumber(value), cfg)}</span>;
  return <span className="tabular-nums">{formatNumber(value)}</span>;
}

/** Thousands grouped the Vietnamese way (1.234,5), without inventing decimals. */
function formatNumber(value: number): string {
  return value.toLocaleString("vi-VN", { maximumFractionDigits: 10 });
}

function CheckboxValue({ checked }: { checked: boolean }) {
  return (
    <span
      role="img"
      aria-label={checked ? "Đã tick" : "Chưa tick"}
      className={`inline-flex size-4 items-center justify-center rounded border align-middle text-[10px] leading-none ${
        checked ? "border-brand bg-brand text-white" : "border-line-strong bg-surface"
      }`}
    >
      {checked ? "✓" : ""}
    </span>
  );
}

/* ── Links ─────────────────────────────────────────────────────────────── */

function UrlValue({ url, cfg }: { url: string | null; cfg: DisplayConfig }) {
  const href = safeHref(url);
  if (!url) return <Empty />;
  // A value that cannot be a link is still information — show it rather than a dead anchor.
  if (!href) return <span>{url}</span>;
  if (cfg.kind === "button") {
    return (
      <a href={href} target="_blank" rel="noreferrer" className="g-ia btn btn-primary btn-sm max-w-full">
        <span className="truncate">{cfg.label?.trim() || displayUrl(href).split("/")[0]}</span>
        <span aria-hidden>↗</span>
      </a>
    );
  }
  return <ExternalLink href={href} text={displayUrl(href)} />;
}

type FileEntry = Extract<PropertyValueResponse, { type: "files" }>["files"][number];

const IMAGE_FILE = /\.(png|jpe?g|gif|webp|avif|bmp|svg)(\?|#|$)/i;

function FilesValue({
  files,
  propertyId,
  context,
}: {
  files: FileEntry[];
  propertyId: string;
  context?: RenderContext;
}) {
  if (!files.length) return <Empty />;

  // Notion-hosted files carry a signed URL that dies within the hour, so they go through
  // Hallery, which asks Notion for a fresh one at the moment of the click.
  const hrefOf = (file: FileEntry, index: number) =>
    file.type === "external"
      ? safeHref(file.external.url)
      : context
        ? `/api/galleries/${context.galleryId}/files?page=${encodeURIComponent(context.pageId)}&prop=${encodeURIComponent(propertyId)}&i=${index}`
        : file.file.url;
  const nameOf = (file: FileEntry) => file.name || "Tệp";

  if (context?.surface === "card") {
    const first = files[0];
    const href = hrefOf(first, 0);
    return (
      <span className="inline-flex max-w-full items-center gap-1">
        {href ? <ExternalLink href={href} text={`📎 ${nameOf(first)}`} /> : <span>📎 {nameOf(first)}</span>}
        {files.length > 1 && <span className="shrink-0 text-xs text-muted">+{files.length - 1}</span>}
      </span>
    );
  }

  return (
    <span className="flex flex-col gap-2">
      {files.some((file) => IMAGE_FILE.test(file.name) || IMAGE_FILE.test(file.type === "external" ? file.external.url : file.file.url)) && (
        <span className="flex flex-wrap gap-2">
          {files.map((file, index) => {
            const url = file.type === "external" ? file.external.url : file.file.url;
            if (!IMAGE_FILE.test(file.name) && !IMAGE_FILE.test(url)) return null;
            const href = hrefOf(file, index);
            return href ? (
              <a
                key={index}
                href={href}
                target="_blank"
                rel="noreferrer"
                aria-label={nameOf(file)}
                // A background rather than <img>: an expired or hotlink-blocked URL degrades to
                // a grey tile instead of a broken-image icon.
                className={`${INTERACTIVE} block size-20 rounded-lg border border-line bg-stone-100 bg-cover bg-center`}
                style={{ backgroundImage: `url(${JSON.stringify(href)})` }}
              />
            ) : null;
          })}
        </span>
      )}
      <span className="flex flex-col gap-0.5">
        {files.map((file, index) => {
          const href = hrefOf(file, index);
          return href ? (
            <ExternalLink key={index} href={href} text={`📎 ${nameOf(file)}`} />
          ) : (
            <span key={index}>📎 {nameOf(file)}</span>
          );
        })}
      </span>
    </span>
  );
}

function RelationValue({ ids, hasMore, context }: { ids: string[]; hasMore?: boolean; context?: RenderContext }) {
  if (!ids.length) return <Empty />;
  const compact = context?.surface === "card";
  const shown = compact ? ids.slice(0, 3) : ids;
  const links = shown.map((id) => context?.relations?.[id] ?? { title: null, href: notionPageUrl(id), internal: false });
  const unknown = links.filter((link) => link.title === null).length;

  return (
    <span className="inline-flex max-w-full flex-wrap items-center gap-1">
      {links.map((link, index) => {
        const label = link.title ?? `Mục ${index + 1}`;
        const className = `${INTERACTIVE} inline-flex max-w-full items-center gap-1 truncate rounded-md border border-line bg-surface px-1.5 py-0.5 text-xs text-ink-soft hover:border-brand hover:text-brand`;
        return link.internal ? (
          <Link key={index} href={link.href} scroll={false} className={className}>
            <span className="truncate">{label}</span>
          </Link>
        ) : (
          <a key={index} href={link.href} target="_blank" rel="noreferrer" className={className} title="Mở trong Notion">
            <span className="truncate">{label}</span>
            <span aria-hidden>↗</span>
          </a>
        );
      })}
      {(ids.length > shown.length || hasMore) && (
        <span className="text-xs text-muted">
          +{ids.length - shown.length}
          {hasMore ? "…" : ""}
        </span>
      )}
      {!compact && unknown > 0 && (
        <span className="basis-full text-xs text-faint">
          Bảng liên kết chưa chia sẻ với integration nên Hallery chưa đọc được tên.
        </span>
      )}
    </span>
  );
}

/* ── Computed ──────────────────────────────────────────────────────────── */

/** One element of a rollup's array, which carries the shape of the property it came from. */
function RollupItemValue({ item }: { item: RollupItem }) {
  switch (item.type) {
    case "title":
    case "rich_text": {
      const parts = item[item.type] as RichTextItemResponse[];
      return parts.length ? <RichText items={parts} /> : null;
    }
    case "number":
      return item.number === null ? null : <span>{formatNumber(item.number as number)}</span>;
    case "select":
    case "status": {
      const option = item[item.type] as { name: string; color: string } | null;
      return option ? <Pill color={option.color}>{option.name}</Pill> : null;
    }
    case "multi_select":
      return (
        <>
          {(item.multi_select as { name: string; color: string }[]).map((option) => (
            <Pill key={option.name} color={option.color}>
              {option.name}
            </Pill>
          ))}
        </>
      );
    case "date": {
      const date = item.date as { start: string; end: string | null } | null;
      return date ? <span>{formatDateRange(date, undefined)}</span> : null;
    }
    case "checkbox":
      return <CheckboxValue checked={Boolean(item.checkbox)} />;
    case "url": {
      const href = safeHref(item.url as string | null);
      return href ? <ExternalLink href={href} text={displayUrl(href)} /> : null;
    }
    case "people":
      return <span>{(item.people as { name?: string }[]).map((person) => person.name ?? "Người dùng").join(", ")}</span>;
    case "formula":
      return <FormulaValue formula={item.formula as RollupItem} cfg={{}} />;
    default:
      return null;
  }
}

function RollupValue({ rollup, cfg }: { rollup: RollupItem; cfg: DisplayConfig }) {
  if (rollup.type === "number") return <NumberValue value={(rollup.number as number | null) ?? null} cfg={cfg} />;
  if (rollup.type === "date") {
    const d = rollup.date as { start: string; end: string | null } | null;
    return d ? <span>{formatDateRange(d, cfg.kind)}</span> : <Empty />;
  }
  if (rollup.type === "array") {
    const items = (rollup.array as RollupItem[]).filter((item) => !isEmptyRollupItem(item));
    if (!items.length) return <Empty />;
    return (
      <span className="inline-flex max-w-full flex-wrap items-center gap-x-1.5 gap-y-1">
        {items.map((item, index) => (
          <span key={index} className="inline-flex items-center gap-1">
            <RollupItemValue item={item} />
            {index < items.length - 1 && !["select", "status", "multi_select"].includes(item.type) && (
              <span className="text-faint">,</span>
            )}
          </span>
        ))}
      </span>
    );
  }
  return <Empty />;
}

function isEmptyRollupItem(item: RollupItem): boolean {
  const inner = item[item.type];
  if (inner === null || inner === undefined) return true;
  if (Array.isArray(inner)) return inner.length === 0;
  return false;
}

function FormulaValue({ formula, cfg }: { formula: RollupItem; cfg: DisplayConfig }) {
  if (formula.type === "string") {
    const text = formula.string as string | null;
    if (!text) return <Empty />;
    // A formula that builds a URL is meant to be followed, not read.
    if (looksLikeUrl(text)) {
      const href = safeHref(text);
      if (href) return <UrlValue url={href} cfg={cfg.kind === "button" ? cfg : { kind: "link" }} />;
    }
    return <span>{withAffixes(text, cfg)}</span>;
  }
  if (formula.type === "number") return <NumberValue value={(formula.number as number | null) ?? null} cfg={cfg} />;
  if (formula.type === "boolean") return <CheckboxValue checked={Boolean(formula.boolean)} />;
  if (formula.type === "date") {
    const d = formula.date as { start: string; end: string | null } | null;
    return d ? <span>{formatDateRange(d, cfg.kind)}</span> : <Empty />;
  }
  return <Empty />;
}

/* ── Buttons ───────────────────────────────────────────────────────────── */

function ButtonValue({ propertyId, context }: { propertyId: string; context?: RenderContext }) {
  // The label arrives resolved (own label → renamed → Notion name) from the server.
  const config = context?.buttons?.[propertyId];
  if (config && context) {
    return (
      <NativeButton
        galleryId={context.galleryId}
        pageId={context.pageId}
        propertyId={propertyId}
        label={config.label || "Chạy"}
        confirm={config.confirm}
        compact={context.surface === "card"}
      />
    );
  }
  // Notion exposes no way to press its own buttons, so an unconfigured one is honest about it.
  return (
    <span
      title="Nút Notion không chạy được qua API. Gán hành động cho nó trong Cài đặt hiển thị."
      className="inline-flex items-center rounded-md border border-dashed border-line-strong px-2 py-0.5 text-xs text-faint"
    >
      Nút chưa cấu hình
    </span>
  );
}
