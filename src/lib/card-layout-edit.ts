import {
  ARRANGEMENTS,
  MAX_OVERLAY_FIELDS,
  makeGrid,
  type CardField,
  type CardLayout,
  type Grid,
} from "@/lib/card-layout";

/*
 * The edits a layout editor makes by hand — drop a field into a box, take it out, flip
 * its label — as pure functions, so the card editor and a button's form designer move
 * fields the same way.
 */

function insert(fields: CardField[], field: CardField, beforeId?: string) {
  const at = beforeId ? fields.findIndex((f) => f.id === beforeId) : -1;
  if (at === -1) fields.push(field);
  else fields.splice(at, 0, field);
}

export function removeFieldEverywhere(current: CardLayout, id: string): CardLayout {
  const strip = (grid: Grid): Grid => ({
    ...grid,
    boxes: grid.boxes.map((box) => ({ ...box, fields: box.fields.filter((f) => f.id !== id) })),
  });
  return {
    ...current,
    overlay: current.overlay.filter((f) => f.id !== id),
    regions: Object.fromEntries(Object.entries(current.regions).map(([key, grid]) => [key, strip(grid)])),
  };
}

/** The field as placed, or a fresh one carrying the label choice made while it sat in the tray. */
export function findLayoutField(current: CardLayout, id: string): CardField {
  const search = (grid: Grid): CardField | undefined => {
    for (const box of grid.boxes) {
      const hit = box.fields.find((f) => f.id === id);
      if (hit) return hit;
    }
    return undefined;
  };
  return (
    current.overlay.find((f) => f.id === id) ??
    Object.values(current.regions).map(search).find(Boolean) ?? {
      id,
      showLabel: current.labelVisibility[id] ?? false,
    }
  );
}

/** The box (or "overlay") a field sits in, or null when it is still in the tray. */
export function findBoxOf(layout: CardLayout, fieldId: string): string | null {
  if (layout.overlay.some((f) => f.id === fieldId)) return "overlay";
  for (const grid of Object.values(layout.regions)) {
    for (const box of grid.boxes) {
      if (box.fields.some((f) => f.id === fieldId)) return box.id;
    }
  }
  return null;
}

/**
 * Moves a field to `target` — a box id, "overlay", or "tray" to take it off — before
 * `beforeId` when given. Dropping into a folded box unfolds it.
 */
export function placeField(current: CardLayout, id: string, target: string, beforeId?: string): CardLayout {
  const field = findLayoutField(current, id);
  const next = removeFieldEverywhere(current, id);

  if (target === "tray") return next;
  if (target === "overlay") {
    if (next.overlay.length >= MAX_OVERLAY_FIELDS) return current;
    const fields = [...next.overlay];
    insert(fields, field, beforeId);
    return { ...next, overlay: fields };
  }

  const drop = (grid: Grid): Grid => ({
    ...grid,
    boxes: grid.boxes.map((box) => {
      if (box.id === target) {
        const fields = [...box.fields];
        insert(fields, field, beforeId);
        // Dropping into a folded box is the clearest way to say "give it back".
        const rest = { ...box, fields };
        delete rest.mergedInto;
        return rest;
      }
      return box;
    }),
  });

  return {
    ...next,
    regions: Object.fromEntries(Object.entries(next.regions).map(([key, grid]) => [key, drop(grid)])),
  };
}

/** Where a drag ended, as dnd-kit names the drop zones, applied to the layout. */
export function applyDrop(current: CardLayout, fieldId: string, overId: string): CardLayout {
  if (overId.startsWith("box:")) return placeField(current, fieldId, overId.slice(4));
  if (overId === "zone:overlay") return placeField(current, fieldId, "overlay");
  if (overId === "zone:tray") return placeField(current, fieldId, "tray");
  if (overId.startsWith("before:")) {
    const beforeId = overId.slice(7);
    return placeField(current, fieldId, findBoxOf(current, beforeId) ?? "tray", beforeId);
  }
  return current;
}

export function setFieldLabel(current: CardLayout, id: string, showLabel: boolean): CardLayout {
  const flip = (fields: CardField[]) => fields.map((f) => (f.id === id ? { ...f, showLabel } : f));
  const walk = (grid: Grid): Grid => ({
    ...grid,
    boxes: grid.boxes.map((box) => ({ ...box, fields: flip(box.fields) })),
  });
  return {
    ...current,
    overlay: flip(current.overlay),
    regions: Object.fromEntries(Object.entries(current.regions).map(([k, g]) => [k, walk(g)])),
    labelVisibility: { ...current.labelVisibility, [id]: showLabel },
  };
}

/**
 * A layout as an edit form draws it: the picture on top when it has one (the form changes
 * it there), then one content frame. Fields from frames and the overlay that disappear
 * move into the last box, so nothing that was laid out is lost.
 */
export function asFormLayout(layout: CardLayout): CardLayout {
  const withPicture = ARRANGEMENTS[layout.arrangement].cover !== "none";
  const grids = Object.values(layout.regions);
  const main = grids[0] ?? makeGrid(1, 1);
  const extra = [...grids.slice(1).flatMap((grid) => grid.boxes.flatMap((box) => box.fields)), ...layout.overlay];
  const boxes = [...main.boxes];
  if (extra.length) {
    const lastOpen = boxes.map((box) => !box.mergedInto).lastIndexOf(true);
    const at = lastOpen === -1 ? boxes.length - 1 : lastOpen;
    boxes[at] = { ...boxes[at], fields: [...boxes[at].fields, ...extra] };
  }
  const arrangement = withPicture ? "cover-top" : "no-cover";
  return {
    ...layout,
    arrangement,
    overlay: [],
    regions: { [ARRANGEMENTS[arrangement].regions[0]]: { ...main, boxes } },
  };
}

/** Puts the picture slot at the top of a form, or takes it away. */
export function setFormPicture(layout: CardLayout, withPicture: boolean): CardLayout {
  return { ...layout, arrangement: withPicture ? "cover-top" : "no-cover" };
}
