"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ButtonFace, ConfirmDialog } from "@/components/native-button";
import { ButtonFormDesigner } from "@/components/button-form-designer";
import { Icon, type IconName } from "@/components/icons";
import { TITLE_FIELD_ID, type CardLayout } from "@/lib/card-layout";
import { useDismiss } from "@/lib/use-dismiss";
import {
  createHalleryButton,
  deleteHalleryButton,
  loadButtonEditorData,
  loadGalleryFields,
  saveNativeButton,
  type EditorProperty,
  type GalleryFields,
} from "@/app/galleries/[galleryId]/button-settings-actions";
import {
  BUTTON_COLORS,
  BUTTON_COLOR_CLASSES,
  BUTTON_COLOR_LABELS,
  CONFIRM_LIMITS,
  OP_LABELS,
  PREFILL_LABELS,
  SOURCE_LABELS,
  STEP_HINTS,
  STEP_LABELS,
  copyableFrom,
  isOpenStep,
  opTakesValue,
  opsFor,
  sourceTakesValue,
  sourcesFor,
  type AddValue,
  type AddValueSource,
  type ButtonAction,
  type ButtonColor,
  type ButtonConfirm,
  type ButtonOp,
  type ButtonStep,
  type ButtonStepKind,
  type NativeButtonConfig,
} from "@/lib/native-button";

type Loaded = GalleryFields | "loading" | { error: string };

/**
 * Everything a button is: how it looks, what it asks, and the steps it runs — edit this
 * record, edit the records linked to it, add a record to a gallery, open a record or a
 * form. Buttons live only in Hallery: Notion's own cannot be read or pressed through its API.
 */
export function ButtonEditor({
  galleryId,
  propertyId,
  propertyName,
  initial,
  onDone,
}: {
  galleryId: string;
  propertyId: string;
  propertyName: string;
  initial: NativeButtonConfig | null;
  /** Called after a save or delete, for a popup to close itself. */
  onDone?: () => void;
}) {
  const router = useRouter();
  const [label, setLabel] = useState(initial?.label ?? propertyName);
  const [icon, setIcon] = useState(initial?.icon ?? "");
  const [color, setColor] = useState<ButtonColor>(initial?.color ?? "default");
  const [asks, setAsks] = useState(Boolean(initial?.confirm));
  const [confirm, setConfirm] = useState<ButtonConfirm>(initial?.confirm ?? {});
  const [steps, setSteps] = useState<ButtonStep[]>(initial?.steps ?? []);
  const [previewing, setPreviewing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [status, setStatus] = useState<{ ok: boolean; message: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const [self, setSelf] = useState<Loaded>("loading");
  const [galleries, setGalleries] = useState<{ id: string; name: string; icon: string | null }[]>([]);
  const [others, setOthers] = useState<Record<string, Loaded>>({});
  const requested = useRef(new Set<string>());

  useEffect(() => {
    let live = true;
    loadButtonEditorData(galleryId).then((data) => {
      if (!live) return;
      if (data.error !== null) {
        setSelf({ error: data.error });
        return;
      }
      setSelf(data.self);
      setGalleries(data.galleries);
    });
    return () => {
      live = false;
    };
  }, [galleryId]);

  // Other galleries' fields, fetched once each, as soon as a step points at them.
  const selfProperties = typeof self === "object" && "properties" in self ? self.properties : null;
  const wanted = [
    ...new Set(
      steps.flatMap((step) => {
        if (step.kind === "add") return step.galleryId ? [step.galleryId] : [];
        if (step.kind === "edit_related") {
          const target = selfProperties?.find((property) => property.id === step.relationPropertyId)?.relationGalleryId;
          return target ? [target] : [];
        }
        return [];
      }),
    ),
  ].filter((id) => id !== galleryId);
  const wantedKey = wanted.join("|");
  useEffect(() => {
    for (const id of wantedKey ? wantedKey.split("|") : []) {
      if (requested.current.has(id)) continue;
      requested.current.add(id);
      loadGalleryFields(galleryId, id).then((result) =>
        setOthers((current) => ({ ...current, [id]: result.error !== null ? { error: result.error } : result.fields })),
      );
    }
  }, [galleryId, wantedKey]);

  function fieldsOf(id: string | null | undefined): Loaded | null {
    if (!id) return null;
    if (id === galleryId) return self;
    return others[id] ?? "loading";
  }

  const touch = () => {
    setDirty(true);
    setStatus(null);
  };
  const editConfirm = (patch: Partial<ButtonConfirm>) => {
    setConfirm((current) => ({ ...current, ...patch }));
    touch();
  };
  const changeSteps = (next: ButtonStep[]) => {
    setSteps(next);
    touch();
  };
  const replaceStep = (index: number, step: ButtonStep) => changeSteps(steps.map((entry, i) => (i === index ? step : entry)));
  const moveStep = (index: number, by: -1 | 1) => {
    const next = [...steps];
    const [moved] = next.splice(index, 1);
    next.splice(index + by, 0, moved);
    changeSteps(next);
  };

  const shownLabel = label.trim() || propertyName;
  const hasAdd = steps.some((step) => step.kind === "add");
  const selfFields = typeof self === "object" && "properties" in self ? self : null;
  const hasRelation = Boolean(selfFields?.properties.some((property) => property.type === "relation"));

  function addStep(kind: ButtonStepKind) {
    const step: ButtonStep =
      kind === "edit_this"
        ? { kind, actions: [] }
        : kind === "edit_related"
          ? {
              kind,
              relationPropertyId: selfFields?.properties.find((property) => property.type === "relation")?.id ?? "",
              actions: [],
            }
          : kind === "add"
            ? { kind, galleryId: "", values: [] }
            : { kind, target: hasAdd ? "added" : "this" };
    // Opening happens after everything else and only once: a new opener replaces the old
    // one, and other steps go in before it.
    const opener = steps.find(isOpenStep);
    const rest = steps.filter((entry) => !isOpenStep(entry));
    changeSteps(isOpenStep(step) ? [...rest, step] : [...rest, step, ...(opener ? [opener] : [])]);
  }

  function save() {
    const cleaned = steps
      .map((step): ButtonStep | null => {
        const keep = (action: ButtonAction) => !opTakesValue(action.op) || (action.value ?? "").trim() !== "";
        if (step.kind === "edit_this") {
          const actions = step.actions.filter(keep);
          return actions.length ? { ...step, actions } : null;
        }
        if (step.kind === "edit_related") {
          const actions = step.actions.filter(keep);
          return actions.length && step.relationPropertyId ? { ...step, actions } : null;
        }
        if (step.kind === "add") {
          if (!step.galleryId) return null;
          return { ...step, values: step.values.filter((value) => !sourceTakesValue(value.source) || (value.value ?? "") !== "") };
        }
        return step;
      })
      .filter((step): step is ButtonStep => step !== null);
    startTransition(async () => {
      const result = await saveNativeButton(galleryId, propertyId, {
        label: label.trim() || undefined,
        icon: icon.trim() || undefined,
        color,
        confirm: asks ? confirm : undefined,
        steps: cleaned,
      });
      if (result.error) {
        setStatus({ ok: false, message: result.error });
        return;
      }
      setSteps(cleaned);
      setDirty(false);
      setStatus({ ok: true, message: cleaned.length ? "Đã lưu." : "Đã lưu — nút chưa có bước nào nên chưa bấm được." });
      router.refresh();
      onDone?.();
    });
  }

  function remove() {
    if (!window.confirm(`Xoá nút “${shownLabel}”? Nút sẽ biến khỏi mọi card và Card Detail.`)) return;
    startTransition(async () => {
      const result = await deleteHalleryButton(galleryId, propertyId);
      if (result.error) {
        setStatus({ ok: false, message: result.error });
        return;
      }
      router.refresh();
      onDone?.();
    });
  }

  return (
    <div className="flex flex-col gap-5" data-dirty={dirty || undefined}>
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-line-strong px-4 py-3">
        <span className="text-xs text-faint">Xem trước</span>
        <ButtonFace label={shownLabel} icon={icon.trim() || undefined} color={color} />
        <ButtonFace label={shownLabel} icon={icon.trim() || undefined} color={color} compact />
        {asks && (
          <button type="button" onClick={() => setPreviewing(true)} className="btn btn-ghost btn-sm ml-auto">
            Xem hộp hỏi lại
          </button>
        )}
        {previewing && (
          <ConfirmDialog
            label={shownLabel}
            confirm={confirm}
            onCancel={() => setPreviewing(false)}
            onConfirm={() => setPreviewing(false)}
          />
        )}
      </div>

      <div className="flex gap-3">
        <div className="w-20 shrink-0">
          <label className="field-label" htmlFor={`button-icon-${propertyId}`}>
            Biểu tượng
          </label>
          <input
            id={`button-icon-${propertyId}`}
            value={icon}
            onChange={(event) => {
              setIcon(event.target.value);
              touch();
            }}
            placeholder="✓"
            className="input input-sm text-center"
          />
        </div>
        <div className="min-w-0 flex-1">
          <label className="field-label" htmlFor={`button-label-${propertyId}`}>
            Chữ trên nút
          </label>
          <input
            id={`button-label-${propertyId}`}
            value={label}
            maxLength={80}
            onChange={(event) => {
              setLabel(event.target.value);
              touch();
            }}
            placeholder={propertyName}
            className="input input-sm"
          />
        </div>
      </div>

      <div>
        <span className="field-label">Màu</span>
        <div role="radiogroup" aria-label="Màu nút" className="flex flex-wrap gap-1.5">
          {BUTTON_COLORS.map((entry) => (
            <button
              key={entry}
              type="button"
              role="radio"
              aria-checked={color === entry}
              onClick={() => {
                setColor(entry);
                touch();
              }}
              className={`btn btn-sm px-3 ${BUTTON_COLOR_CLASSES[entry]} ${
                color === entry ? "outline-2 outline-offset-2 outline-brand" : ""
              }`}
            >
              {BUTTON_COLOR_LABELS[entry]}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-3">
        <label className="flex items-center gap-2 text-sm text-ink-soft">
          <input
            type="checkbox"
            checked={asks}
            onChange={(event) => {
              setAsks(event.target.checked);
              touch();
            }}
            className="accent-brand"
          />
          Hỏi lại trước khi chạy
        </label>
        {asks && (
          <div className="grid gap-3 rounded-2xl bg-subtle p-3.5 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor={`confirm-title-${propertyId}`}>
                Câu hỏi
              </label>
              <input
                id={`confirm-title-${propertyId}`}
                value={confirm.title ?? ""}
                maxLength={CONFIRM_LIMITS.title}
                onChange={(event) => editConfirm({ title: event.target.value })}
                placeholder={`Chạy “${shownLabel}”?`}
                className="input input-sm"
              />
            </div>
            <div className="sm:col-span-2">
              <label className="field-label" htmlFor={`confirm-message-${propertyId}`}>
                Lời nhắn thêm <span className="font-normal text-faint">(tuỳ chọn)</span>
              </label>
              <textarea
                id={`confirm-message-${propertyId}`}
                value={confirm.message ?? ""}
                maxLength={CONFIRM_LIMITS.message}
                rows={2}
                onChange={(event) => editConfirm({ message: event.target.value })}
                placeholder="vd. Status sẽ chuyển sang Đã đọc và ghi ngày hôm nay."
                className="input h-auto py-2 text-sm"
              />
            </div>
            <div>
              <label className="field-label" htmlFor={`confirm-ok-${propertyId}`}>
                Chữ nút đồng ý
              </label>
              <input
                id={`confirm-ok-${propertyId}`}
                value={confirm.confirmLabel ?? ""}
                maxLength={CONFIRM_LIMITS.confirmLabel}
                onChange={(event) => editConfirm({ confirmLabel: event.target.value })}
                placeholder="Chạy"
                className="input input-sm"
              />
            </div>
            <div>
              <label className="field-label" htmlFor={`confirm-cancel-${propertyId}`}>
                Chữ nút huỷ
              </label>
              <input
                id={`confirm-cancel-${propertyId}`}
                value={confirm.cancelLabel ?? ""}
                maxLength={CONFIRM_LIMITS.cancelLabel}
                onChange={(event) => editConfirm({ cancelLabel: event.target.value })}
                placeholder="Huỷ"
                className="input input-sm"
              />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-2.5">
        <span className="field-label mb-0">Khi bấm, lần lượt:</span>
        {self === "loading" && <p className="text-xs text-faint">Đang đọc cấu trúc database…</p>}
        {typeof self === "object" && "error" in self && <p className="text-xs text-danger">{self.error}</p>}
        {selfFields && steps.length === 0 && <p className="text-xs text-faint">Chưa có bước nào.</p>}
        {selfFields &&
          steps.map((step, index) => (
            <div key={index} className="rounded-2xl border border-line p-3">
              <div className="mb-2.5 flex items-center gap-1.5">
                <span className="flex size-5 items-center justify-center rounded-full bg-subtle text-[11px] text-muted">
                  {index + 1}
                </span>
                <span className={`flex size-6 items-center justify-center rounded-lg ${STEP_TONES[step.kind]}`}>
                  <Icon name={STEP_ICONS[step.kind]} className="size-3.5" />
                </span>
                <span className="text-sm font-medium text-ink">{STEP_LABELS[step.kind]}</span>
                <span className="ml-auto flex items-center">
                  {!isOpenStep(step) && (
                    <>
                      <button
                        type="button"
                        aria-label="Đưa bước lên"
                        disabled={index === 0}
                        onClick={() => moveStep(index, -1)}
                        className="btn btn-ghost btn-sm btn-icon"
                      >
                        <Icon name="arrow-up" />
                      </button>
                      <button
                        type="button"
                        aria-label="Đưa bước xuống"
                        disabled={index + 1 >= steps.length || isOpenStep(steps[index + 1])}
                        onClick={() => moveStep(index, 1)}
                        className="btn btn-ghost btn-sm btn-icon"
                      >
                        <Icon name="arrow-down" />
                      </button>
                    </>
                  )}
                  <button
                    type="button"
                    aria-label="Bỏ bước này"
                    onClick={() => changeSteps(steps.filter((_, i) => i !== index))}
                    className="btn btn-ghost btn-sm btn-icon"
                  >
                    <Icon name="x" />
                  </button>
                </span>
              </div>
              <StepBody
                step={step}
                self={selfFields}
                galleries={galleries}
                fieldsOf={fieldsOf}
                addTarget={[...steps.slice(0, index)].reverse().find((entry) => entry.kind === "add")}
                onChange={(next) => replaceStep(index, next)}
              />
            </div>
          ))}
        {selfFields && (
          <StepPicker
            onPick={addStep}
            disabled={{
              edit_related: hasRelation ? null : "Gallery này không có property relation",
            }}
            replacesOpener={steps.some(isOpenStep)}
          />
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-3">
        <button type="button" onClick={save} disabled={pending || !dirty} className="btn btn-primary btn-sm">
          {pending ? "Đang lưu…" : "Lưu nút"}
        </button>
        {status && (
          <span role="status" className={`text-xs ${status.ok ? "text-brand-ink" : "text-danger"}`}>
            {status.message}
          </span>
        )}
        <button type="button" onClick={remove} disabled={pending} className="btn btn-ghost btn-sm ml-auto text-danger">
          <Icon name="trash" /> Xoá nút
        </button>
      </div>
    </div>
  );
}

function StepBody({
  step,
  self,
  galleries,
  fieldsOf,
  addTarget,
  onChange,
}: {
  step: ButtonStep;
  self: GalleryFields;
  galleries: { id: string; name: string; icon: string | null }[];
  fieldsOf: (id: string | null | undefined) => Loaded | null;
  /** The nearest earlier "add" step — what a form on the added record opens. */
  addTarget: ButtonStep | undefined;
  onChange: (step: ButtonStep) => void;
}) {
  switch (step.kind) {
    case "edit_this":
      return <ActionRows properties={self.properties} actions={step.actions} onChange={(actions) => onChange({ ...step, actions })} />;
    case "edit_related": {
      const relations = self.properties.filter((property) => property.type === "relation");
      const relation = relations.find((property) => property.id === step.relationPropertyId);
      const target = fieldsOf(relation?.relationGalleryId);
      return (
        <div className="flex flex-col gap-2">
          <label className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            Mọi record nối qua
            <select
              value={step.relationPropertyId}
              onChange={(event) => onChange({ ...step, relationPropertyId: event.target.value, actions: [] })}
              className="input input-sm w-auto"
            >
              {!relation && <option value={step.relationPropertyId}>— chọn relation —</option>}
              {relations.map((property) => (
                <option key={property.id} value={property.id}>
                  {property.name}
                  {property.relationGalleryName ? ` → ${property.relationGalleryName}` : ""}
                </option>
              ))}
            </select>
          </label>
          {relation && !relation.relationGalleryId && (
            <p className="text-xs text-warn">
              Bảng mà “{relation.name}” trỏ tới chưa có trong Hallery (chưa share cho integration, hoặc đã xoá).
            </p>
          )}
          <LoadedFields loaded={target}>
            {(fields) => (
              <ActionRows properties={fields.properties} actions={step.actions} onChange={(actions) => onChange({ ...step, actions })} />
            )}
          </LoadedFields>
          <p className="text-[11px] text-faint">Tối đa 50 record mỗi lần bấm — mỗi record tốn 1–2 request tới Notion.</p>
        </div>
      );
    }
    case "add": {
      const target = fieldsOf(step.galleryId);
      return (
        <div className="flex flex-col gap-2">
          <label className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            Thêm vào
            <select
              value={step.galleryId}
              onChange={(event) => onChange({ ...step, galleryId: event.target.value, values: [] })}
              className="input input-sm w-auto min-w-48"
            >
              <option value="">— chọn gallery —</option>
              {galleries.map((gallery) => (
                <option key={gallery.id} value={gallery.id}>
                  {gallery.icon && !gallery.icon.startsWith("http") ? `${gallery.icon} ` : ""}
                  {gallery.name}
                  {gallery.id === self.galleryId ? " (gallery này)" : ""}
                </option>
              ))}
            </select>
          </label>
          <LoadedFields loaded={target}>
            {(fields) => (
              <ValueRows
                target={fields}
                self={self}
                values={step.values}
                onChange={(values) => onChange({ ...step, values })}
              />
            )}
          </LoadedFields>
        </div>
      );
    }
    case "open_view":
    case "open_form": {
      const formGalleryId = step.target === "added" && addTarget?.kind === "add" ? addTarget.galleryId : self.galleryId;
      const target = step.kind === "open_form" ? fieldsOf(formGalleryId) : null;
      return (
        <div className="flex flex-col gap-2.5">
          <label className="flex flex-wrap items-center gap-2 text-xs text-ink-soft">
            {step.kind === "open_view" ? "Mở Card Detail của" : "Mở form của"}
            <select
              value={step.target}
              // A form arranged for one gallery means nothing on another, so switching drops it.
              onChange={(event) => onChange({ kind: step.kind, target: event.target.value === "added" ? "added" : "this" })}
              className="input input-sm w-auto"
            >
              <option value="this">record đang bấm</option>
              <option value="added" disabled={!addTarget}>
                record vừa thêm
              </option>
            </select>
          </label>
          {step.kind === "open_form" && step.target === "added" && addTarget?.kind === "add" && !addTarget.galleryId && (
            <p className="text-xs text-faint">Chọn gallery ở bước “Thêm record” trước.</p>
          )}
          {step.kind === "open_form" && (
            <LoadedFields loaded={target}>
              {(fields) => <FormSummary fields={fields} step={step} onChange={onChange} />}
            </LoadedFields>
          )}
        </div>
      );
    }
  }
}

const STEP_ICONS: Record<ButtonStepKind, IconName> = {
  edit_this: "pencil",
  edit_related: "link",
  add: "plus",
  open_view: "eye",
  open_form: "layout",
};

const STEP_TONES: Record<ButtonStepKind, string> = {
  edit_this: "bg-sky-100 text-sky-800",
  edit_related: "bg-purple-100 text-purple-800",
  add: "bg-emerald-100 text-emerald-800",
  open_view: "bg-amber-100 text-amber-900",
  open_form: "bg-orange-100 text-orange-800",
};

const STEP_ORDER: ButtonStepKind[] = ["edit_this", "edit_related", "add", "open_view", "open_form"];

/** "+ Thêm bước": a pane of the step kinds, each with its icon and what it does. */
function StepPicker({
  onPick,
  disabled,
  replacesOpener,
}: {
  onPick: (kind: ButtonStepKind) => void;
  /** Kinds that cannot be added here, with the reason shown in their place. */
  disabled: Partial<Record<ButtonStepKind, string | null>>;
  /** An opening step exists; picking another replaces it. */
  replacesOpener: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));
  return (
    <div ref={ref} className="relative self-start">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="btn btn-secondary btn-sm"
      >
        <Icon name="plus" /> Thêm bước
      </button>
      {open && (
        <div role="menu" className="popover absolute top-full left-0 z-30 mt-1 w-80 p-1.5">
          {STEP_ORDER.map((kind) => {
            const reason = disabled[kind];
            const replaces = replacesOpener && (kind === "open_view" || kind === "open_form");
            return (
              <button
                key={kind}
                type="button"
                role="menuitem"
                disabled={Boolean(reason)}
                onClick={() => {
                  setOpen(false);
                  onPick(kind);
                }}
                className="menu-item items-start"
              >
                <span className={`mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg ${STEP_TONES[kind]}`}>
                  <Icon name={STEP_ICONS[kind]} className="!size-4 !text-current" />
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="font-medium text-ink">{STEP_LABELS[kind]}</span>
                  <span className="text-xs text-muted">
                    {reason ?? (replaces ? "Thay cho bước mở hiện có — mỗi nút chỉ mở một thứ" : STEP_HINTS[kind])}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function LoadedFields({ loaded, children }: { loaded: Loaded | null; children: (fields: GalleryFields) => React.ReactNode }) {
  if (!loaded) return null;
  if (loaded === "loading") return <p className="text-xs text-faint">Đang đọc cấu trúc gallery…</p>;
  if ("error" in loaded) return <p className="text-xs text-danger">{loaded.error}</p>;
  return <>{children(loaded)}</>;
}

/** Property changes on one record, or on each linked record. */
function ActionRows({
  properties,
  actions,
  onChange,
}: {
  properties: EditorProperty[];
  actions: ButtonAction[];
  onChange: (actions: ButtonAction[]) => void;
}) {
  const writable = properties.filter((property) => opsFor(property.type).length > 0);
  const byId = new Map(writable.map((property) => [property.id, property]));
  return (
    <div className="flex flex-col gap-1.5">
      {actions.map((action, index) => {
        const property = byId.get(action.propertyId);
        const ops = property ? opsFor(property.type) : [];
        const replace = (patch: Partial<ButtonAction>) =>
          onChange(actions.map((entry, i) => (i === index ? { ...entry, ...patch } : entry)));
        return (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Property"
              value={action.propertyId}
              onChange={(event) => {
                const next = byId.get(event.target.value);
                replace({ propertyId: event.target.value, op: next ? opsFor(next.type)[0] : "set", value: "" });
              }}
              className="input input-sm w-auto min-w-36 flex-1"
            >
              {!property && <option value={action.propertyId}>(property đã mất)</option>}
              {writable.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
            <select
              aria-label="Thay đổi"
              value={action.op}
              onChange={(event) => replace({ op: event.target.value as ButtonOp, value: "" })}
              className="input input-sm w-auto"
            >
              {ops.map((op) => (
                <option key={op} value={op}>
                  {OP_LABELS[op]}
                </option>
              ))}
            </select>
            {opTakesValue(action.op) &&
              (property?.options?.length && action.op !== "increment" ? (
                <select
                  aria-label="Giá trị"
                  value={action.value ?? ""}
                  onChange={(event) => replace({ value: event.target.value })}
                  className="input input-sm w-auto min-w-32"
                >
                  <option value="">— chọn —</option>
                  {property.options.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  aria-label="Giá trị"
                  value={action.value ?? ""}
                  onChange={(event) => replace({ value: event.target.value })}
                  inputMode={action.op === "increment" || property?.type === "number" ? "decimal" : undefined}
                  placeholder={action.op === "increment" ? "vd. 1 hoặc -1" : "Giá trị"}
                  className="input input-sm w-32"
                />
              ))}
            <button
              type="button"
              aria-label="Bỏ thay đổi này"
              onClick={() => onChange(actions.filter((_, i) => i !== index))}
              className="btn btn-ghost btn-sm btn-icon"
            >
              <Icon name="x" />
            </button>
          </div>
        );
      })}
      {writable.length > 0 ? (
        <button
          type="button"
          onClick={() => onChange([...actions, { propertyId: writable[0].id, op: opsFor(writable[0].type)[0], value: "" }])}
          className="btn btn-ghost btn-sm self-start"
        >
          <Icon name="plus" /> Thêm thay đổi
        </button>
      ) : (
        <p className="text-xs text-faint">Không có property nào ghi được.</p>
      )}
    </div>
  );
}

/** The values a newly added record starts with. */
function ValueRows({
  target,
  self,
  values,
  onChange,
}: {
  target: GalleryFields;
  self: GalleryFields;
  values: AddValue[];
  onChange: (values: AddValue[]) => void;
}) {
  const fillable = target.properties.filter((property) => sourcesFor(property.type).length > 0);
  const byId = new Map(fillable.map((property) => [property.id, property]));
  const unused = fillable.filter((property) => !values.some((value) => value.propertyId === property.id));
  return (
    <div className="flex flex-col gap-1.5">
      {values.length === 0 && <p className="text-xs text-faint">Record mới sẽ trống. Thêm giá trị bên dưới.</p>}
      {values.map((entry, index) => {
        const property = byId.get(entry.propertyId);
        const sources = property ? sourcesFor(property.type) : [];
        const replace = (patch: Partial<AddValue>) =>
          onChange(values.map((value, i) => (i === index ? { ...value, ...patch } : value)));
        const copyFrom = property
          ? self.properties.filter((candidate) => copyableFrom(property.type).includes(candidate.type))
          : [];
        return (
          <div key={index} className="flex flex-wrap items-center gap-1.5">
            <select
              aria-label="Property của record mới"
              value={entry.propertyId}
              onChange={(event) => {
                const next = byId.get(event.target.value);
                replace({ propertyId: event.target.value, source: next ? sourcesFor(next.type)[0] : "fixed", value: "" });
              }}
              className="input input-sm w-auto min-w-36 flex-1"
            >
              {!property && <option value={entry.propertyId}>(property đã mất)</option>}
              {fillable.map((candidate) => (
                <option key={candidate.id} value={candidate.id}>
                  {candidate.name}
                </option>
              ))}
            </select>
            <span className="text-xs text-faint">=</span>
            <select
              aria-label="Lấy giá trị từ"
              value={entry.source}
              onChange={(event) => replace({ source: event.target.value as AddValueSource, value: "" })}
              className="input input-sm w-auto"
            >
              {sources.map((source) => (
                <option key={source} value={source}>
                  {SOURCE_LABELS[source]}
                </option>
              ))}
            </select>
            {entry.source === "copy" && (
              <select
                aria-label="Chép từ property"
                value={entry.value ?? ""}
                onChange={(event) => replace({ value: event.target.value })}
                className="input input-sm w-auto min-w-32"
              >
                <option value="">— chọn —</option>
                {copyFrom.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.name}
                  </option>
                ))}
              </select>
            )}
            {entry.source === "fixed" && property && <FixedValue property={property} value={entry.value ?? ""} onChange={(value) => replace({ value })} />}
            {entry.source === "this" && property?.relationGalleryId && property.relationGalleryId !== self.galleryId && (
              <span className="text-[11px] text-warn">relation này trỏ tới “{property.relationGalleryName}”, không phải gallery này</span>
            )}
            <button
              type="button"
              aria-label="Bỏ giá trị này"
              onClick={() => onChange(values.filter((_, i) => i !== index))}
              className="btn btn-ghost btn-sm btn-icon"
            >
              <Icon name="x" />
            </button>
          </div>
        );
      })}
      {unused.length > 0 && (
        <button
          type="button"
          onClick={() => onChange([...values, { propertyId: unused[0].id, source: sourcesFor(unused[0].type)[0], value: "" }])}
          className="btn btn-ghost btn-sm self-start"
        >
          <Icon name="plus" /> Thêm giá trị
        </button>
      )}
    </div>
  );
}

function FixedValue({ property, value, onChange }: { property: EditorProperty; value: string; onChange: (value: string) => void }) {
  if (property.type === "checkbox") {
    return (
      <select aria-label="Giá trị" value={value} onChange={(event) => onChange(event.target.value)} className="input input-sm w-auto">
        <option value="">— chọn —</option>
        <option value="true">Đã tick</option>
        <option value="false">Chưa tick</option>
      </select>
    );
  }
  if (property.type === "date") {
    return <input aria-label="Ngày" type="date" value={value} onChange={(event) => onChange(event.target.value)} className="input input-sm w-auto" />;
  }
  if ((property.type === "select" || property.type === "status") && property.options?.length) {
    return (
      <select aria-label="Giá trị" value={value} onChange={(event) => onChange(event.target.value)} className="input input-sm w-auto min-w-32">
        <option value="">— chọn —</option>
        {property.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    );
  }
  return (
    <input
      aria-label="Giá trị"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      inputMode={property.type === "number" ? "decimal" : undefined}
      placeholder={property.type === "multi_select" ? "option 1, option 2" : "Giá trị"}
      className="input input-sm w-40"
    />
  );
}

/** Field ids a form layout shows, in reading order. */
function formFieldIdsOf(layout: CardLayout): string[] {
  return Object.values(layout.regions).flatMap((grid) => grid.boxes.flatMap((box) => box.fields.map((field) => field.id)));
}

/** What the form will show, and the way into the designer that arranges it. */
function FormSummary({
  fields,
  step,
  onChange,
}: {
  fields: GalleryFields;
  step: Extract<ButtonStep, { kind: "open_form" }>;
  onChange: (step: ButtonStep) => void;
}) {
  const [designing, setDesigning] = useState(false);
  const names = new Map(fields.properties.map((property) => [property.id, property.name]));
  const shown = formFieldIdsOf(step.layout ?? fields.formLayout)
    .map((id) => (id === TITLE_FIELD_ID ? "Tiêu đề" : names.get(id)))
    .filter((name): name is string => Boolean(name));
  const presets = Object.entries(step.prefill ?? {}).map(([id, preset]) => {
    const name = id === TITLE_FIELD_ID ? "Tiêu đề" : (names.get(id) ?? id);
    const shownValue =
      preset.mode === "static"
        ? preset.value === "true"
          ? "đã tick"
          : preset.value === "false"
            ? "chưa tick"
            : `“${preset.value ?? ""}”`
        : PREFILL_LABELS[preset.mode].toLowerCase();
    return `${name} = ${shownValue}`;
  });
  return (
    <div className="flex flex-col gap-2 rounded-xl bg-subtle p-3">
      <p className="text-xs text-ink-soft">
        {step.layout ? (
          <b className="font-medium text-ink">Form riêng của nút</b>
        ) : (
          <>
            <b className="font-medium text-ink">Form sửa của “{fields.name}”</b> — theo Card Detail, đổi theo nó
          </>
        )}
        {" · "}
        {shown.length} field
        {presets.length > 0 && ` · ${presets.length} điền sẵn`}
      </p>
      {presets.length > 0 && <p className="text-[11px] text-brand-ink">Điền sẵn: {presets.join(" · ")}</p>}
      {shown.length > 0 && <p className="line-clamp-2 text-[11px] text-faint">{shown.join(" · ")}</p>}
      <button type="button" onClick={() => setDesigning(true)} className="btn btn-secondary btn-sm self-start">
        <Icon name="layout" /> Chỉnh form
      </button>
      {designing && (
        <ButtonFormDesigner
          fields={fields}
          initial={step.layout ?? fields.formLayout}
          initialPrefill={step.prefill}
          onApply={(layout, prefill) => {
            onChange({ kind: "open_form", target: step.target, ...(layout ? { layout } : {}), ...(prefill ? { prefill } : {}) });
            setDesigning(false);
          }}
          onClose={() => setDesigning(false)}
        />
      )}
    </div>
  );
}

/** The editor in a popup, so a button is set up without leaving the layout it sits in. */
export function ButtonEditorDialog({
  galleryId,
  propertyId,
  propertyName,
  initial,
  onClose,
}: {
  galleryId: string;
  propertyId: string;
  propertyName: string;
  initial: NativeButtonConfig | null;
  onClose: () => void;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const latestClose = useRef(onClose);
  useEffect(() => {
    latestClose.current = onClose;
  });

  const requestClose = () => {
    const dirty = panelRef.current?.querySelector("[data-dirty]");
    if (dirty && !window.confirm("Bỏ các thay đổi chưa lưu của nút này?")) return;
    latestClose.current();
  };
  const requestCloseRef = useRef(requestClose);
  useEffect(() => {
    requestCloseRef.current = requestClose;
  });

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // A question or the form designer on top answers Escape for itself.
      if (event.key !== "Escape" || document.querySelector("[role=alertdialog], [data-form-designer]")) return;
      event.stopPropagation();
      requestCloseRef.current();
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);

  return createPortal(
    <div
      role="presentation"
      className="fixed inset-0 z-[60] flex animate-fade-in items-start justify-center overflow-y-auto bg-scrim p-2 backdrop-blur-sm sm:p-8"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) requestClose();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={`Cấu hình nút ${propertyName}`}
        className="my-auto w-full max-w-2xl animate-rise-in rounded-[1.75rem] bg-surface p-5 shadow-pop ring-1 ring-line sm:p-6"
      >
        <div className="mb-4 flex items-center gap-2">
          <h2 className="text-base font-semibold text-ink">Cấu hình nút</h2>
          <span className="truncate text-sm text-muted">{propertyName}</span>
          <button type="button" aria-label="Đóng" onClick={requestClose} className="btn btn-ghost btn-sm btn-icon ml-auto">
            <Icon name="x" />
          </button>
        </div>
        <ButtonEditor
          galleryId={galleryId}
          propertyId={propertyId}
          propertyName={propertyName}
          initial={initial}
          onDone={onClose}
        />
      </div>
    </div>,
    document.body,
  );
}

/** "+ Nút mới": creates a Hallery-only button and hands its id back for configuring. */
export function NewButtonButton({ galleryId, onCreated }: { galleryId: string; onCreated: (propertyId: string) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <span className="inline-flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await createHalleryButton(galleryId);
            if (result.error !== null) {
              setError(result.error);
              return;
            }
            setError(null);
            router.refresh();
            onCreated(result.propertyId);
          })
        }
        className="btn btn-ghost btn-sm h-7 px-2 text-xs"
      >
        <Icon name="plus" /> {pending ? "Đang tạo…" : "Nút mới"}
      </button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
