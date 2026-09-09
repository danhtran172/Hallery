# P0.1 — Stabilize the Existing Layout Builder

## Purpose

Hallery will keep its current version-4 grid layout system and make that system safe and predictable across Gallery cards, Card Detail, and the create form. This design supersedes the older proposal to replace the editor with a nested layout tree. Existing saved layouts remain valid and no database migration is required.

The work stays inside Hallery's metadata and presentation layers. It does not create, change, or remove any Notion property.

## Scope

P0.1 includes:

- a fixed title treatment for all three views;
- responsive single-column rendering on narrow screens;
- lossless layout and grid shape changes;
- clear empty, unplaced, and missing-property states;
- protection against leaving the editor with unsaved changes; and
- compatibility with every currently stored version-4 card layout.

It excludes layout templates, a new nested-tree model, arbitrary divider dragging, new property editors, and database schema changes.

## Preserve the Current Layout Model

`CardLayout` version 4 remains the persisted contract in `Gallery.displayConfig`. Gallery cards, Card Detail, and the create form continue to store independent layouts using the same arrangements, regions, and grids.

Existing `__title__` references remain parseable so old JSON never fails. Resolution ignores those references in Gallery and Card Detail because those views render the title in a fixed layer. The form also stops treating title as a draggable layout field and instead renders its title input in a fixed position. Saving a layout may omit obsolete title references, but loading an older layout does not require a migration.

All other property references remain keyed by Notion property ID.

## Fixed Title Treatment

The title is not shown in the property tray and cannot be dragged, removed, merged, or covered by another field.

- **Gallery card:** when a cover exists, the title is fixed against the top edge of the cover. A shallow dark-to-transparent gradient sits behind it, and the title is white with enough contrast for unknown images. When the cover is disabled or unavailable, the title becomes the first fixed header in the content area.
- **Card Detail:** when a cover exists, the title uses the same top-cover overlay treatment at page scale. When no cover exists, it remains a fixed heading above the property layout.
- **Create form:** title is a fixed first input above the configurable property grid. It remains writable and participates in its existing required/default behavior, but it is not draggable.

The fixed title layer does not consume one of the three optional cover-overlay field slots.

## Responsive Rendering

The saved desktop structure is unchanged. CSS controls presentation at narrow widths:

- the Gallery card list becomes one card per row;
- side-by-side cover/content arrangements stack vertically;
- two-column property grids become one column;
- Card Detail uses its configured width only as a maximum and never overflows the viewport; and
- create-form grids collapse to one column.

Responsive behavior is derived at render time and is never written back into the layout JSON.

## Lossless Layout Changes

Every shape-changing operation uses one preservation rule: read fields in current visual order, create the target boxes, preserve fields for boxes that still exist, and append every overflow field to the final available box. Arrangement changes also carry fields out of disappearing regions into the final surviving region.

No property may disappear because the user changes arrangement, column count, row count, or merge state. The editor reports when fields were consolidated into another box. Duplicate property references remain resolved only once, following current behavior.

## Builder Feedback

The editor distinguishes three conditions:

1. **Unplaced live properties:** a persistent count explains that these properties will not appear in the selected view.
2. **Missing Notion properties:** saved references that no longer resolve appear as muted cards with their stored ID and an explicit remove action. They are not silently erased on load.
3. **Empty layout:** the canvas and real Card Detail show a Vietnamese instructional state. A cover does not suppress that message.

Gallery, Detail, and Form each calculate their own count. Switching tabs does not discard a draft.

## Unsaved-Change Protection

The editor stores a serialized baseline of all saveable state and compares it with the current draft. This includes the three layouts, cover shapes and sources, detail width, form defaults, and per-view property display settings.

When the draft differs from the baseline:

- reload and tab/window close use `beforeunload`;
- internal anchor navigation, including the global sidebar and the editor's back link, asks for confirmation before navigation; and
- a successful save replaces the baseline so leaving no longer warns.

Cancelling a layout-choice popup does not dirty the editor. Returning a draft to its exact initial values clears the warning.

## Error Handling and Compatibility

- Invalid saved JSON continues to fall back to the existing default layout without crashing.
- A property newly added in Notion appears in the tray after the normal property-inventory sync.
- A deleted property remains visible as missing metadata in the builder but is skipped by Gallery and Detail renderers.
- A failed save keeps the draft and the unsaved warning active.
- Layout save remains one Hallery-side transaction and performs no Notion API call.

## Verification

The implementation is complete when all of the following pass:

1. Existing version-4 layouts load without visual field loss.
2. Gallery and Detail titles render on the top of their covers with a light gradient, and no title is draggable in those views.
3. No-cover variants render the title as a fixed content header.
4. The create form always renders its title input first.
5. Reducing rows/columns and changing arrangements preserves every live property.
6. Narrow viewport tests show one-column cards, stacked side layouts, and one-column property grids.
7. Empty, unplaced, and missing-property states show the specified guidance.
8. Sidebar navigation, back navigation, reload, and close warn only while the editor is dirty.
9. `npm run lint` and `npm run build` pass.
10. The production build is tested against the local Game Station Gallery with cover and no-cover layouts.

