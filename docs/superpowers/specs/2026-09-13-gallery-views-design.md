# Gallery Views design

## Goal

Give every gallery one or more persistent, Notion-like views. Each view owns its
own filter, sort, group, and gallery-card layout. A reader can switch views,
create a view based on the current one, or duplicate it without changing any
other view.

## Scope

This increment supports:

- the automatically created default view for every existing gallery;
- switching, creating, renaming, and duplicating views;
- immediate persistence for filter, sort, and group changes;
- independent card layout configuration per view;
- preserving the selected view in the gallery URL and in item return links.

It deliberately does not add view deletion or reordering. A gallery therefore
always retains a view, and these controls can be added later without a migration
or a changed data contract.

## Data model and migration

Add `GalleryView` with a required relation to `Gallery` and cascade deletion.

| Field | Purpose |
| --- | --- |
| `id` | Stable URL and mutation identifier. |
| `galleryId` | Owner gallery. |
| `name` | User-facing view label. |
| `sortOrder` | Display order of tabs. |
| `filterConfig` | Serialized `Filter[]`. |
| `sortConfig` | Serialized `SortKey[]`. |
| `groupBy` | Notion property ID or null. |
| `layoutConfig` | JSON containing the card-specific portion of the former gallery display configuration. |
| timestamps | Normal Prisma audit fields. |

The migration creates one `Mặc định` view per existing gallery. Its layout JSON
copies the card-facing fields from `Gallery.displayConfig`: cover shape and
source, cards-per-row, and card layout. It starts without filters, sorting, or
grouping. The legacy gallery JSON remains responsible for item-detail and
create-form settings, including their layouts and cover settings.

The read boundary accepts an empty/malformed stored JSON config and falls back
to safe gallery defaults. This makes a partially migrated local SQLite database
renderable and prevents a bad row from breaking a gallery.

## Request and persistence flow

The gallery route resolves `?view=<GalleryView.id>` against the owning gallery.
An unknown or absent id uses the first view, then renders its canonical view id
in links and client navigation.

The server combines the selected view's saved filters, sorts and group with the
current gallery data before querying cards. Category filtering remains separate
and composes exactly as it does today.

Changing a filter, sort, or group calls a server action for the selected view.
The action validates that the view belongs to the gallery, sanitizes values that
refer to unavailable properties, writes the new state, revalidates the gallery,
and returns. The client updates the URL only after a successful write. Search
remains transient URL state: the requested feature lists filter, sort and group
as persistent, while search is useful as a temporary lookup rather than a
silent change to the shared view.

Every card and random-item navigation carries `view` alongside the existing
category and pagination return parameters, so returning to the gallery restores
the same view.

## Interface

The gallery header gains a compact view strip immediately above the existing
toolbar. It shows each view as a tab and exposes a small actions menu for the
current view:

- **Tạo view** creates a new named view by copying the current layout, filters,
  sorts and grouping; its default name is `View mới`.
- **Đổi tên** updates the current tab's name in place.
- **Nhân bản** creates the same copy with `<tên hiện tại> copy` as its default
  name.

Both create paths navigate to their newly created view. View-specific card
settings use `view` in their settings link and persist only to that view. The
editor makes no changes to Gallery-level detail, quick-entry, or global property
formatting settings.

## Component boundaries

- `lib/gallery-view.ts` owns parsing, safe defaults, and selecting the view.
- Gallery server actions own mutations and route revalidation.
- A client `GalleryViewBar` owns tab navigation, the compact menu, pending
states, and creation/rename/duplicate prompts.
- `GalleryToolbar` receives the selected view identity and persistence callback;
it no longer treats filter/sort/group as URL-owned source of truth.
- The gallery page selects the view, applies it, and passes its card layout to
the renderer.
- Card layout settings receives `view` and reads/writes only that view's card
configuration.

## Failure handling

- A stale or cross-gallery `view` URL cannot reveal or mutate another gallery;
  it falls back to the gallery's first view.
- Failed automatic saves leave the visible controls at their last confirmed
  state and show a concise error rather than pretending a change persisted.
- View creation and duplication cannot leave a gallery without a view because
  they are additive and run in a database transaction.
- Existing property validation in the card editor remains in place; a saved
  layout cannot revive disabled or missing properties.

## Verification

1. Migration/backfill test: an existing gallery receives a `Mặc định` view with
   the same rendered card layout as before.
2. Query tests: each view independently applies and persists filters, sort
   levels, and grouping; search remains transient.
3. View action tests: create, rename, and duplicate constrain writes to the
   owning gallery and copy the complete card/query state.
4. Manual browser check: switch views, alter a filter, reload, open an item and
   return, edit a card layout, and confirm that another view is unaffected.
5. Run Prisma generation/migration, lint, type checking through the production
   build, and the repository test command if one is introduced or present.
