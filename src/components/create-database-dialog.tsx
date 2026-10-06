"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createNotionDatabase, loadParentPages } from "@/app/database-actions";
import { Icon } from "@/components/icons";
import { ModalFrame } from "@/components/modal-frame";
import type { ParentPage } from "@/lib/notion-listing";
import {
  NEW_DATABASE_DEFAULTS,
  NEW_PROPERTY_TYPES,
  validateNewDatabase,
  type NewProperty,
  type NewPropertyType,
} from "@/lib/new-database";

const parentKey = (workspaceId: string) => `hallery:new-db-parent:${workspaceId}`;

function rememberedParent(workspaceId: string): string | null {
  try {
    return window.localStorage.getItem(parentKey(workspaceId));
  } catch {
    return null;
  }
}

function rememberParent(workspaceId: string, pageId: string) {
  try {
    window.localStorage.setItem(parentKey(workspaceId), pageId);
  } catch {
    // Only a convenience: next time the first page is preselected instead.
  }
}

/**
 * Creates a database in Notion and opens it as a gallery — on its own, or as a tab of
 * `parentGallery` when started from a gallery's view bar.
 */
export function CreateDatabaseDialog({
  workspaceId,
  parentGallery,
  onClose,
}: {
  workspaceId: string;
  parentGallery?: { id: string; name: string };
  onClose: () => void;
}) {
  const router = useRouter();
  const [pages, setPages] = useState<ParentPage[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parentPageId, setParentPageId] = useState("");
  const [title, setTitle] = useState("");
  const [icon, setIcon] = useState("");
  const [titleName, setTitleName] = useState(NEW_DATABASE_DEFAULTS.titleName);
  const [properties, setProperties] = useState<NewProperty[]>(NEW_DATABASE_DEFAULTS.properties);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  /** Bumped by "Tải lại" after the owner shares a page in Notion. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let live = true;
    loadParentPages(workspaceId)
      .then((result) => {
        if (!live) return;
        if ("error" in result) {
          setLoadError(result.error);
          return;
        }
        setPages(result.pages);
        const remembered = rememberedParent(workspaceId);
        const pick = result.pages.find((page) => page.id === remembered) ?? result.pages[0];
        if (pick) setParentPageId(pick.id);
      })
      .catch(() => live && setLoadError("Không tải được danh sách trang từ Notion. Thử lại sau."));
    return () => {
      live = false;
    };
  }, [workspaceId, attempt]);

  function reload() {
    setPages(null);
    setLoadError(null);
    setAttempt((value) => value + 1);
  }

  const dirty = title.trim() !== "" || icon.trim() !== "";

  function requestClose() {
    if (pending) return;
    if (dirty && !window.confirm("Bỏ database đang tạo dở?")) return;
    onClose();
  }

  function updateProperty(index: number, patch: Partial<NewProperty>) {
    setProperties((list) => list.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)));
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const input = { parentPageId, title, icon, titleName, properties };
    const checked = validateNewDatabase(input);
    if (!checked.ok) {
      setError(checked.error);
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await createNotionDatabase(workspaceId, checked.value, parentGallery?.id ?? null);
        if ("error" in result) {
          setError(result.error);
          return;
        }
        rememberParent(workspaceId, parentPageId);
        onClose();
        router.push(`/galleries/${result.galleryId}`);
      } catch {
        setError("Không tạo được database. Thử lại sau giây lát.");
      }
    });
  }

  return (
    <ModalFrame
      title="Tạo database mới"
      subtitle={
        parentGallery ? (
          <>
            Tạo trong Notion, rồi thêm làm tab của <b className="font-medium text-ink-soft">{parentGallery.name}</b>.
          </>
        ) : (
          "Tạo trong Notion, rồi mở ngay làm gallery."
        )
      }
      onClose={requestClose}
      width="max-w-xl"
    >
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-[4.5rem_1fr] gap-3">
          <div>
            <label className="field-label" htmlFor="new-db-icon">
              Icon
            </label>
            <input
              id="new-db-icon"
              value={icon}
              onChange={(event) => setIcon(event.target.value)}
              placeholder="🖼️"
              aria-describedby="new-db-icon-hint"
              className="input text-center text-lg"
            />
          </div>
          <div>
            <label className="field-label" htmlFor="new-db-title">
              Tên database
            </label>
            <input
              id="new-db-title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              autoFocus
              required
              maxLength={200}
              placeholder="VD: Bộ sưu tập sách"
              className="input text-base font-medium"
            />
          </div>
        </div>
        <p id="new-db-icon-hint" className="-mt-2 text-xs text-faint">
          Icon là một emoji, có thể để trống.
        </p>

        <div>
          <label className="field-label" htmlFor="new-db-parent">
            Đặt trong trang Notion
          </label>
          {loadError ? (
            <div className="flex items-start gap-2 rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
              <p className="flex-1">{loadError}</p>
              <button type="button" onClick={reload} className="btn btn-secondary btn-sm">
                Tải lại
              </button>
            </div>
          ) : !pages ? (
            <p className="input flex items-center text-faint">Đang tải các trang…</p>
          ) : pages.length === 0 ? (
            <div className="flex items-start gap-2 rounded-xl bg-subtle px-3.5 py-2.5 text-sm text-muted">
              <p className="flex-1">
                Integration chưa được chia sẻ trang nào — Notion chỉ cho tạo database bên trong một trang. Mở một trang trong
                Notion → <b>•••</b> → <b>Connections</b> → thêm integration, rồi bấm Tải lại.
              </p>
              <button type="button" onClick={reload} className="btn btn-secondary btn-sm">
                Tải lại
              </button>
            </div>
          ) : (
            <select
              id="new-db-parent"
              value={parentPageId}
              onChange={(event) => setParentPageId(event.target.value)}
              className="input"
            >
              {pages.map((page) => (
                <option key={page.id} value={page.id}>
                  {page.icon ? `${page.icon} ` : ""}
                  {page.title}
                </option>
              ))}
            </select>
          )}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="field-label">Cột</legend>
          <div className="flex items-center gap-2">
            <input
              value={titleName}
              onChange={(event) => setTitleName(event.target.value)}
              aria-label="Tên cột tiêu đề"
              className="input input-sm flex-1"
            />
            <span className="flex h-8 w-36 shrink-0 items-center rounded-lg bg-subtle px-2.5 text-[13px] text-muted">Tiêu đề</span>
            <span className="size-8 shrink-0" aria-hidden />
          </div>
          {properties.map((property, index) => (
            <div key={index} className="flex items-center gap-2">
              <input
                value={property.name}
                onChange={(event) => updateProperty(index, { name: event.target.value })}
                aria-label={`Tên cột ${index + 2}`}
                placeholder="Tên cột"
                className="input input-sm flex-1"
              />
              <select
                value={property.type}
                onChange={(event) => updateProperty(index, { type: event.target.value as NewPropertyType })}
                aria-label={`Kiểu cột ${property.name || index + 2}`}
                className="input input-sm w-36 shrink-0"
              >
                {NEW_PROPERTY_TYPES.map((entry) => (
                  <option key={entry.type} value={entry.type}>
                    {entry.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setProperties((list) => list.filter((_, at) => at !== index))}
                aria-label={`Bỏ cột ${property.name || index + 2}`}
                className="btn btn-ghost btn-sm btn-icon size-8 text-muted"
              >
                <Icon name="x" />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setProperties((list) => [...list, { name: "", type: "rich_text" }])}
            className="btn btn-ghost btn-sm self-start text-muted"
          >
            <Icon name="plus" />
            Thêm cột
          </button>
          <p className="text-xs text-faint">
            Cột “Ảnh / tệp” đầu tiên sẽ làm ảnh bìa của card. Sau khi tạo, Hallery không sửa cấu trúc database này nữa —
            thêm cột về sau thì làm trong Notion.
          </p>
        </fieldset>

        {error && (
          <p role="alert" className="rounded-xl bg-danger-soft px-3.5 py-2.5 text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex gap-2">
          <button type="submit" disabled={pending || !pages || pages.length === 0} className="btn btn-primary">
            <Icon name="database" />
            {pending ? "Đang tạo…" : "Tạo database"}
          </button>
          <button type="button" onClick={requestClose} disabled={pending} className="btn btn-secondary">
            Huỷ
          </button>
        </div>
      </form>
    </ModalFrame>
  );
}
