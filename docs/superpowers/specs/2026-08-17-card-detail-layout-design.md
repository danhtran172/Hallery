# Phase 2 — Card Detail Layout Builder

## Purpose

Hallery will let each Gallery define the presentation of its Card Detail screen without changing a Notion database or property schema. The same saved layout renders both read mode and inline edit mode. This keeps Hallery's shadow-schema boundary intact while providing the product's defining customization.

## Scope

Phase 2 includes:

- a versioned, Gallery-owned Card Detail layout;
- a two-level layout builder with property drag and drop;
- a shared read/edit renderer;
- reuse of the existing display-configuration controls from the builder; and
- reusable layout templates.

It excludes Gallery-card layouts, freeform divider dragging, responsive layouts beyond stacking cells on narrow screens, and any change to Notion schema.

## Data model

`Gallery.detailLayout` will be a string column with a default empty value. An empty or invalid layout always means the default layout, so existing Galleries retain their current detail experience without any data migration.

```ts
type LayoutKind =
  | "single"
  | "two-col"
  | "two-col-split-left"
  | "two-col-split-right"
  | "stack";

type LayoutCell = {
  id: string;
  props?: string[]; // Notion property IDs only
  kind?: LayoutKind;
  ratio?: [number, number];
  cells?: LayoutCell[];
};

type DetailLayout = {
  version: 1;
  root: {
    kind: LayoutKind;
    ratio?: [number, number];
    cells: LayoutCell[];
  };
};
```

The root is level one. Its cells either contain properties or one level-two layout. Level-two cells only contain property IDs; the model parser and Builder both reject a third split level. Kinds require one (`single`), two (`two-col`, `stack`), or three (the split variants) cells. Two-column layouts permit only `[50,50]`, `[60,40]`, `[40,60]`, `[70,30]`, and `[30,70]`; `single` and `stack` use no ratio.

Property IDs, rather than names, preserve layouts when a Notion property is renamed. The title property is deliberately absent: it remains the heading above every detail layout.

`LayoutTemplate` stores a name and the same JSON layout, without a Gallery foreign key:

```prisma
model LayoutTemplate {
  id        String   @id @default(cuid())
  name      String
  layout    String
  createdAt DateTime @default(now())
}
```

## Layout parsing and safety

`src/lib/detail-layout.ts` will own parsing, validation, default construction, conversion between cell counts, and template remapping. It accepts a Gallery layout plus ordered `PropertyConfig` records.

Malformed JSON, an unsupported version, invalid kinds or ratios, duplicate/unknown property references, and nesting beyond depth two fall back safely to the default `single` layout. The server logs the fallback diagnostic but never makes a detail page fail. The default puts every non-title property in `sortOrder` order.

Changing a layout kind never discards property IDs. The conversion recreates the target cells in a stable order and appends properties from removed cells to the final remaining cell. A UI notice reports when this consolidation occurred.

When a property disappears in Notion, rendering skips it. The Builder instead shows a muted missing-property card with an explicit removal action, so the user can clean up saved metadata intentionally. Newly discovered properties remain in the property tray until placed.

## Rendering

`ItemDetail` will receive the ordered field records, title, and parsed layout. A recursive `DetailLayoutRenderer` renders each split with CSS Grid and the stored ratio. On a narrow viewport all columns stack while retaining each cell's local property order.

The renderer has a single `editing` mode:

- In view mode each property uses `PropertyValue`.
- In edit mode each property uses the existing type-aware input control.

The title remains outside the renderer and is still non-editable during Phase 2, matching the current screen behavior. Unplaced fields are excluded from both modes. If every layout cell is empty, the renderer shows an instructional empty state rather than a blank page. The current Notion save action stays unchanged and receives the same form field names, so the write boundary is unchanged.

## Display configuration reuse

The type-specific controls in `settings/display/page.tsx` will move into a client-safe reusable `PropertyDisplayConfigPanel`. It takes the property metadata, initial config, and its existing save action. The display settings page keeps its current behavior by rendering that component; the Builder's gear button opens it in a local panel for the selected property. This creates one configuration source of truth rather than two divergent forms.

## Builder

The new route `/galleries/[galleryId]/settings/layout` retrieves only the stored Gallery and `PropertyConfig` metadata. It makes no Notion API request.

The page contains:

1. A searchable property tray for unplaced properties, including a property-type badge.
2. A live canvas that uses the same layout grid conventions as the renderer.
3. A control bar for the root kind, its fixed ratio, and eligible child-cell splits.
4. Explicit Save and Cancel controls plus an unsaved-changes warning before navigating away.

`@dnd-kit/core` provides sortable property cards and droppable cells. It is selected because nested droppables and keyboard accessibility are core requirements; native HTML drag-and-drop makes this interaction unreliable. Dragging may reorder properties within a cell or move them between a cell and the tray. The remove control is an equivalent non-drag interaction.

Only an unsplit root cell can be turned into a nested layout. Every level-two cell displays a disabled split control with the explanation that two layout levels is the supported maximum. Applying a kind change runs the safe consolidation rule before the user saves.

The Builder reports the number of unplaced properties with the clear consequence: those fields will not appear in Card Detail. It also renders the known missing-property card described above.

## Templates

"Save as template" persists a named copy of the current in-memory layout only after the user supplies a name. "Apply template" shows available templates. For a target Gallery, each template property ID maps to a target property of the same saved source name. To retain source-name information without changing the JSON contract, template creation writes a `propertyNames` mapping alongside the versioned layout metadata; the renderer ignores that optional map. Unmatched properties are removed from the applied layout and reported as a count. Target properties not referenced by the template remain in the tray.

Templates never write any metadata back to Notion and do not mutate another Gallery until its user clicks Save.

## Error handling

- Missing Gallery returns the existing 404 behavior.
- A failed layout save leaves the canvas state untouched and shows a Vietnamese error message.
- Invalid persisted layouts render the default and are not silently overwritten.
- Missing Notion properties are skipped at render time and exposed for removal in the Builder.
- No Notion mutation or additional Notion API request is introduced by this phase.

## Delivery slices and verification

1. Add the additive Prisma schema/migration and layout parser. Refactor read-only detail rendering to use the parsed default layout, then lint and build.
2. Add the shared renderer and make inline editing use it; verify existing Notion writes through one test page only.
3. Add the builder with explicit save, DnD, split/ratio controls, and display configuration reuse. Test a three-cell `two-col-split-right` layout on the 90-item Game Station data source.
4. Add templates and cross-Gallery name mapping. Verify mismatch reporting, then run lint and production build.

Every slice is committed independently. The completion test is that a saved `two-col-split-right` layout survives reload, renders its column ratio in detail and edit mode, preserves properties when the cell count shrinks, and leaves unconfigured Galleries unchanged.
