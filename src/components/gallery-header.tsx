"use client";

import Link from "next/link";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { renameGallery } from "@/app/sidebar-actions";
import { setGalleryViewType } from "@/app/galleries/[galleryId]/view-actions";
import { Icon, type IconName } from "@/components/icons";
import { toast } from "@/components/toaster";
import { useDismiss } from "@/lib/use-dismiss";
import type { ViewType } from "@/lib/table-layout";

const VIEW_TYPES: { value: ViewType; label: string; icon: IconName }[] = [
  { value: "gallery", label: "Gallery", icon: "grid" },
  { value: "table", label: "Bảng", icon: "table" },
];

export type SettingsLink = { href: string; label: string; icon: IconName; hint: string };

/**
 * The Gallery's title row. The title renames in place; everything about how the Gallery
 * looks sits behind one "Tuỳ chỉnh" menu, so the header stays a title and two actions.
 * The menu opens on the view's type — cards or a table — and the settings under it follow
 * that type, switching the moment another is picked.
 */
export function GalleryHeader({
  galleryId,
  viewId,
  viewType,
  name,
  crumbs,
  meta,
  settingsByType,
  notionUrl,
  actions,
}: {
  galleryId: string;
  viewId: string;
  viewType: ViewType;
  name: string;
  crumbs: React.ReactNode;
  meta: React.ReactNode;
  settingsByType: Record<ViewType, SettingsLink[]>;
  notionUrl: string;
  actions: React.ReactNode;
}) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  useDismiss(menuRef, open, () => setOpen(false));
  // Shows the new name at once; the server's answer replaces it either way.
  const [shown, setShown] = useState(name);
  const [lastName, setLastName] = useState(name);
  if (lastName !== name) {
    setLastName(name);
    setShown(name);
  }
  // The picked type shows at once; the server's answer (or a failure) settles it.
  const [type, setType] = useState(viewType);
  const [lastType, setLastType] = useState(`${viewId}:${viewType}`);
  if (lastType !== `${viewId}:${viewType}`) {
    setLastType(`${viewId}:${viewType}`);
    setType(viewType);
  }
  const [switching, startSwitch] = useTransition();
  const settings = settingsByType[type];

  function switchType(next: ViewType) {
    if (next === type) return;
    setType(next);
    startSwitch(async () => {
      try {
        const result = await setGalleryViewType(galleryId, viewId, next);
        if (result.error) {
          setType(viewType);
          toast(result.error, "error");
        } else router.refresh();
      } catch {
        setType(viewType);
        toast("Không đổi được dạng hiển thị. Thử lại sau giây lát.", "error");
      }
    });
  }

  function rename(next: string) {
    setRenaming(false);
    if (!next.trim() || next.trim() === name) return;
    setShown(next.trim());
    startTransition(async () => {
      const result = await renameGallery(galleryId, next);
      if (result.error) {
        setShown(name);
        toast(result.error, "error");
      } else router.refresh();
    });
  }

  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
      {/* Full width until there is room beside the actions — shrinking instead of wrapping
          squeezed the title to two letters on a phone. */}
      <div className="w-full min-w-0 sm:w-auto sm:flex-1">
        {crumbs}
        {renaming ? (
          <input
            autoFocus
            defaultValue={shown}
            aria-label="Tên gallery"
            onBlur={(event) => rename(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") rename(event.currentTarget.value);
              if (event.key === "Escape") setRenaming(false);
            }}
            className="display mt-1.5 w-full max-w-xl rounded-xl bg-subtle px-2 text-3xl text-ink outline-none ring-2 ring-brand/40 sm:text-4xl"
          />
        ) : (
          <h1
            onDoubleClick={() => setRenaming(true)}
            title="Bấm đúp để đổi tên"
            className={`display mt-1.5 truncate text-3xl text-ink sm:text-4xl ${pending ? "opacity-60" : ""}`}
          >
            {shown}
          </h1>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-x-1 gap-y-1 text-sm text-muted">{meta}</div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-haspopup="menu"
            aria-expanded={open}
            className="btn btn-secondary"
          >
            <Icon name="sliders" />
            Tuỳ chỉnh
          </button>
          {open && (
            <div role="menu" className="popover absolute top-full right-0 z-40 mt-2 w-72 p-1.5 max-sm:right-auto max-sm:left-0">
              <div className="px-2 pt-1.5 pb-2">
                <p className="mb-1.5 text-[11px] font-medium text-faint">Dạng hiển thị của view này</p>
                <div role="radiogroup" aria-label="Dạng hiển thị" className={`segmented w-full ${switching ? "opacity-70" : ""}`}>
                  {VIEW_TYPES.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      role="radio"
                      aria-checked={type === option.value}
                      onClick={() => switchType(option.value)}
                      className="flex-1 justify-center"
                    >
                      <Icon name={option.icon} className="size-3.5" />
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mb-1 h-px bg-line" />
              {settings.map((link) => (
                <Link
                  key={link.href}
                  role="menuitem"
                  href={link.href}
                  onClick={() => setOpen(false)}
                  className="menu-item items-start py-2.5"
                >
                  <Icon name={link.icon} />
                  <span className="min-w-0">
                    <span className="block font-medium text-ink">{link.label}</span>
                    <span className="block text-xs text-muted">{link.hint}</span>
                  </span>
                </Link>
              ))}
              <div className="my-1 h-px bg-line" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  setRenaming(true);
                }}
                className="menu-item"
              >
                <Icon name="pencil" />
                Đổi tên gallery
              </button>
              <a role="menuitem" href={notionUrl} target="_blank" rel="noreferrer" className="menu-item">
                <Icon name="external" />
                Mở database trong Notion
              </a>
            </div>
          )}
        </div>
        {actions}
      </div>
    </header>
  );
}
