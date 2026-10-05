"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import type { SearchResults } from "@/lib/global-search";
import { appearanceStore, resolveTheme } from "@/lib/appearance";
import { Icon, type IconName } from "@/components/icons";

export const OPEN_SEARCH_EVENT = "hallery:open-search";

/** Opens the palette from anywhere — the sidebar's search box, the mobile bar. */
export function openSearch() {
  window.dispatchEvent(new Event(OPEN_SEARCH_EVENT));
}

type Entry = {
  key: string;
  section: string;
  label: string;
  hint?: string;
  icon?: string | null;
  glyph: IconName;
  run: () => void;
};

/**
 * Ctrl+K: jump to any gallery or item, or run a handful of app-wide commands. Searches the
 * snapshots already on disk, so results arrive as fast as the keys are pressed.
 */
export function CommandPalette() {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResults>({ galleries: [], items: [] });
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  const close = useCallback(() => {
    setOpen(false);
    setQuery("");
    setActive(0);
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      }
    };
    const onOpen = () => setOpen(true);
    document.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SEARCH_EVENT, onOpen);
    return () => {
      document.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SEARCH_EVENT, onOpen);
    };
  }, []);

  // A new route means the reader picked something, or navigated another way.
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    if (open) close();
  }

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`, { signal: controller.signal });
        if (response.ok) {
          setResults((await response.json()) as SearchResults);
          setActive(0);
        }
      } catch {
        // Aborted by the next keystroke, or the server is restarting — the list just waits.
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query ? 120 : 0);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [open, query]);

  useEffect(() => {
    if (!open) return;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = overflow;
    };
  }, [open]);

  const entries = useMemo<Entry[]>(() => {
    const go = (href: string) => () => router.push(href);
    const list: Entry[] = [
      ...results.galleries.map((gallery) => ({
        key: `g:${gallery.id}`,
        section: "Gallery",
        label: gallery.name,
        hint: gallery.workspace,
        icon: gallery.icon,
        glyph: "grid" as const,
        run: go(`/galleries/${gallery.id}`),
      })),
      ...results.items.map((item) => ({
        // The same Notion page can sit in two galleries (one database added from two
        // workspaces), so the gallery is part of the key.
        key: `i:${item.galleryId}:${item.pageId}`,
        section: "Item",
        label: item.title,
        hint: item.galleryName,
        icon: item.icon,
        glyph: "image" as const,
        run: go(`/galleries/${item.galleryId}/items/${item.pageId}`),
      })),
    ];
    const commands: Entry[] = [
      { key: "c:home", section: "Lệnh", label: "Về trang chủ", glyph: "home", run: go("/") },
      { key: "c:connect", section: "Lệnh", label: "Kết nối workspace Notion", glyph: "plug", run: go("/connect") },
      {
        key: "c:theme",
        section: "Lệnh",
        label: "Đổi chế độ sáng / tối",
        glyph: "moon",
        run: () => {
          const current = resolveTheme(appearanceStore.theme());
          appearanceStore.setTheme(current === "dark" ? "light" : "dark");
          close();
        },
      },
    ];
    const needle = query.trim().toLowerCase();
    return [...list, ...commands.filter((command) => !needle || command.label.toLowerCase().includes(needle))];
  }, [results, query, router, close]);

  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active]);

  if (!open) return null;

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((index) => Math.min(entries.length - 1, index + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(0, index - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      entries[active]?.run();
    } else if (event.key === "Escape") {
      event.preventDefault();
      close();
    }
  };

  let lastSection = "";

  return (
    <div
      className="fixed inset-0 z-[60] flex animate-fade-in items-start justify-center bg-scrim p-3 pt-[10vh] backdrop-blur-sm"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) close();
      }}
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Tìm kiếm"
        className="flex max-h-[70vh] w-full max-w-xl animate-rise-in flex-col overflow-hidden rounded-3xl bg-surface shadow-pop ring-1 ring-line"
      >
        <div className="flex items-center gap-3 border-b border-line px-5">
          <Icon name="search" className="size-5 shrink-0 text-faint" />
          <input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Tìm gallery, item, hoặc lệnh…"
            aria-label="Tìm kiếm"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={entries[active] ? `palette-${entries[active].key}` : undefined}
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-faint"
          />
          {loading && <span className="size-4 shrink-0 animate-spin rounded-full border-2 border-brand/25 border-t-brand" />}
          <kbd className="kbd">Esc</kbd>
        </div>

        <div ref={listRef} id="palette-list" role="listbox" className="min-h-0 flex-1 overflow-y-auto p-2">
          {query && !loading && results.galleries.length === 0 && results.items.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-muted">Không tìm thấy “{query}”.</p>
          )}
          {entries.map((entry, index) => {
            const header = entry.section !== lastSection ? entry.section : null;
            lastSection = entry.section;
            return (
              <div key={entry.key}>
                {header && <p className="px-3 pt-3 pb-1.5 text-[11px] font-semibold tracking-wide text-faint uppercase">{header}</p>}
                <button
                  type="button"
                  id={`palette-${entry.key}`}
                  role="option"
                  aria-selected={index === active}
                  data-index={index}
                  onMouseMove={() => setActive(index)}
                  onClick={entry.run}
                  className={`flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left text-sm transition-colors ${
                    index === active ? "bg-brand-soft text-ink" : "text-ink-soft"
                  }`}
                >
                  <EntryIcon icon={entry.icon} glyph={entry.glyph} />
                  <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                  {entry.hint && <span className="max-w-[40%] shrink-0 truncate text-xs text-faint">{entry.hint}</span>}
                  {index === active && <Icon name="chevron-right" className="size-4 shrink-0 text-faint" />}
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex items-center gap-4 border-t border-line px-5 py-2.5 text-[11px] text-faint">
          <span className="flex items-center gap-1">
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">↓</kbd> chọn
          </span>
          <span className="flex items-center gap-1">
            <kbd className="kbd">Enter</kbd> mở
          </span>
          <span className="ml-auto">Tìm trong dữ liệu đã đồng bộ</span>
        </div>
      </div>
    </div>
  );
}

function EntryIcon({ icon, glyph }: { icon?: string | null; glyph: IconName }) {
  if (icon && /^https?:\/\//.test(icon)) {
    return (
      <span
        aria-hidden
        className="size-7 shrink-0 rounded-lg bg-subtle bg-contain bg-center bg-no-repeat"
        style={{ backgroundImage: `url(${JSON.stringify(icon)})` }}
      />
    );
  }
  return (
    <span aria-hidden className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-subtle text-sm text-muted">
      {icon ? icon : <Icon name={glyph} className="size-4" />}
    </span>
  );
}
