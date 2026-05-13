# Phase 1 roadmap notes — source of truth, alignment, contract, regression

Companion to [`3D_WEBSITE_TARGET_AND_OPINION.md`](3D_WEBSITE_TARGET_AND_OPINION.md). Captures the decisions and concrete deliverables for the first roadmap phase: locking the apartment's geometry, defining the save/share contract, and listing the regression checks that need to run after any geometry change.

Scope: this is a **plan document**, not a code change. Implementations called out below are deferred until the homeowner provides tape-measure data.

---

## 1. Geometry source of truth (phase1-source)

**Recommendation: manual edits to [`../js/rooms.js`](../js/rooms.js) backed by tape-measure data.** Keep DXF import (see [`../js/dxf-import.js`](../js/dxf-import.js) + [`AUTOCAD.md`](AUTOCAD.md)) as an optional path for users who already have CAD drawings.

Reasoning:

- The current numbers in `js/rooms.js` are **video-derived approximations** (`±20 cm` per room per the project README; many fields marked `D?` / unverified in [`AUDIT_REPORT.md`](AUDIT_REPORT.md) §4).
- The room editor + `applyRoomOverrides` already cover the supported fields without a build step (`width`, `depth`, `height`, `wallColor`, `wallColors`, `openings`, `plan`, `vertices`, `ceiling`).
- DXF is a *populator* of the same data model; maintaining a parallel CAD file as the truth doubles the work surface for one apartment.

### Rooms to validate, priority order

| # | Room id | Current size (cm) | Why it ranks here |
| --- | --- | --- | --- |
| 1 | `corridor` | 150 × 760 | Acts as the spine — all other rooms' `plan.x/y` align to it. Fix this first. |
| 2 | `salon` | 500 × 400 | Primary guest space, fully visible in the new video. |
| 3 | `living` | 500 × 350 | Same as above; ceiling rose + arched opening are signature features. |
| 4 | `bedroom_master` | 450 × 350 | Largest private room. |
| 5 | `bedroom_blue` | 400 × 350 | Has the cerulean accent wall + plaster rose. |
| 6 | `kitchen` | 300 × 250 | Footprint is unverified per audit `D?`. |
| 7 | `bathroom_main` | 250 × 200 | Wet block; current `plan.x` overlaps the corridor (see §2). |
| 8 | `bedroom_teal` | 350 × 300 | Audit lists multiple `D?` rows. |
| 9 | `wc` | 150 × 150 | Audit lists multiple `D?` rows; overlaps corridor today. |

### Fields to capture per room

- Outside dimensions: `width`, `depth`, ceiling `height` (cm).
- Every opening on every wall: `wall`, `at` (cm from origin corner), `size`, `kind` (`door` / `window`), `arched` (boolean).
- Door swing direction — not modelled today but worth logging for later.
- Ceiling features that already have data-model support: `tray`, `cove` + `coveColor`, `downlights`, `rose`.

---

## 2. Plan {x,y} + openings audit (phase1-align)

### Declared coordinate system

From the comment block at the top of [`../js/rooms.js`](../js/rooms.js):

```text
Salon       : x=0,    y=0      (500×400)
Living      : x=0,    y=410    (500×350)
Corridor    : x=510,  y=0      (150×760)
Kitchen     : x=670,  y=0      (300×250)
Master BR   : x=0,    y=770    (450×350)
Bathroom M  : x=510,  y=410    (250×200)
WC          : x=510,  y=620    (150×150)
Bedroom Blue: x=670,  y=410    (400×350)
Bedroom Teal: x=670,  y=770    (350×300)
```

The 10 cm gaps between most adjacent rooms read as `WALL_THICKNESS` and are fine. Three real conflicts remain.

### Conflicts found

| # | Conflict | Bounding boxes (cm) | Overlap |
| --- | --- | --- | --- |
| C1 | `bathroom_main` overlaps `corridor` | `x∈[510,760] y∈[410,610]` vs `x∈[510,660] y∈[0,760]` | 150 × 200 cm at `x∈[510,660] y∈[410,610]` |
| C2 | `wc` overlaps `corridor` | `x∈[510,660] y∈[620,770]` vs `x∈[510,660] y∈[0,760]` | 150 × 140 cm at `x∈[510,660] y∈[620,760]` |
| C3 | `bedroom_master` door opens into living, not corridor | master top wall is at `x∈[0,450]`; door `top@180 size 90` opens at `x∈[180,270]` | corridor only exists at `x∈[510,660]`; this door physically lands inside the living room |

The 2D apartment overview ([`drawOverview`](../js/app.js) around line 1571) draws rooms in `ROOMS` array order — bathroom (8th) and WC (9th) are painted on top of corridor (1st), so the visual overview hides the overlap, but the topology is wrong and walk-mode collision is unreliable. The corridor finding was raised as a structural risk in [`AUDIT_REPORT.md`](AUDIT_REPORT.md) §7.4.

### Proposed re-anchoring (preserves every room's size)

```text
salon          : x=0,    y=0      (500×400)   — unchanged
living         : x=0,    y=410    (500×350)   — unchanged
corridor       : x=510,  y=0      (150×760)   — unchanged
kitchen        : x=670,  y=0      (300×250)   — unchanged
bathroom_main  : x=670,  y=260    (250×200)   — moved east of corridor
wc             : x=670,  y=470    (150×150)   — moved east of corridor
bedroom_blue   : x=830,  y=470    (400×350)   — shifted to fit alongside wc
bedroom_teal   : x=670,  y=830    (350×300)   — shifted south to clear the new wet block
bedroom_master : x=0,    y=770    (450×350)   — unchanged
```

Opening edits that follow from the re-anchor:

- `bathroom_main` door becomes `wall: "left", at: ~60` against the new `x=670` (= `corridor.right + WALL_THICKNESS`).
- `wc` door likewise on `wall: "left"`.
- `bedroom_master` top-wall door currently opens into living; either move the door to face a corridor extension or rename the label to reflect that this room opens off the living room (which matches the visible apartment in the videos better than the current claim of corridor access).

This is a **proposal**, not a code change. Apply once tape measurements (§1) confirm the corridor's actual extent and the relative position of the wet block.

---

## 3. Mode-switch + walkthrough regression checklist (phase2-regress)

Anchor the regression to the named scenarios already in [`TEST_PLAN.md`](TEST_PLAN.md) so we don't duplicate criteria.

| Scenario | Origin | Why it matters here |
| --- | --- | --- |
| F2 — walkthrough entry/exit + Escape | [`TEST_PLAN.md`](TEST_PLAN.md) | Any `plan.x` / `plan.y` change triggers a full apartment scene rebuild in [`showApartment`](../js/three-view.js); F2 confirms the rebuild is non-destructive across 3D ↔ walk cycles. |
| F2b — `screenshotPNG` non-blank | [`TEST_PLAN.md`](TEST_PLAN.md) | Confirms `preserveDrawingBuffer` still survives ceiling / wall rebuilds. |
| N1 — apartment overview click-to-enter | [`TEST_PLAN.md`](TEST_PLAN.md) | Every repositioned room must still pick up its own click in [`drawOverview`](../js/app.js). |

Additional manual checks specific to plan-coordinate changes:

1. **No overlap in overview.** In 🏘️ mode, `document.querySelectorAll('[data-plan-room]')` followed by reading each element's bounding box should show **no pairwise intersection**.
2. **Walk-mode collisions.** Walk from salon → living → corridor → each repositioned room. No walking through walls and no doors landing in mid-air.
3. **Per-room 3D view.** For `bathroom_main`, `wc`, `bedroom_blue`, `bedroom_teal` — enter single-room 3D and verify each opening's `wall` value matches its visible side after the move.
4. **Override round-trip.** Open the room editor for any repositioned room → change something trivial → save → reload → the `plan.x` / `plan.y` written into `RoomOverride` survives `applyRoomOverrides`.

---

## 4. JSON export / import contract (phase4-contract)

### Current schema (v3)

From [`exportJSON`](../js/app.js) the file looks like:

```typescript
type Project = {
  _format: "apt-designer-project";
  _version: 3;
  _date: string;                                  // ISO 8601, informational
  layouts:    { [roomId: string]: ItemInstance[] };
  overrides:  { [roomId: string]: RoomOverride };
  prices:     { [itemId: string]: number };
  customItems: CustomItem[];                      // image data URLs included
  wallPhotos:  { [roomId: string]: { textures, settings } };  // v3, see below
};
```

`RoomOverride` consumed by [`applyRoomOverrides`](../js/app.js) accepts (all optional): `name`, `width`, `depth`, `height`, `wallColor`, `wallColors`, `color`, `accentColor`, `accentWall`, `floorColor`, `floorTexture`, `wallTexture`, `wallTextures` (legacy), `wallTextureSettings` (legacy), `openings`, `plan`, `vertices`, and `ceiling` (shallow-merged over the room default).

### Wall photos round-trip (v3, landed)

Wall photos live in IndexedDB through [`../js/wall-storage.js`](../js/wall-storage.js). Before `_version: 3`, the export path did not read from `WallStorage`, so a project exported on one machine and imported on a fresh browser lost every per-wall photo. As of the current build:

- `exportJSON` pulls `WallStorage.getDefault()` (under the reserved key `__default__`) plus `WallStorage.getAllForRoom(roomId)` for every room, and includes only entries with at least one texture to keep file size down.
- `importJSON` walks `data.wallPhotos`, calling `setDefault` for the reserved key and `setRoom` for each room, then `applyWallStorageToRooms()` to hydrate the in-memory `ROOMS` state.

Importing a `_version: 2` file still works — the `wallPhotos` block is simply absent and the import path skips it.

Caveat: data URLs are roughly 33 % larger than the underlying binary, so a project with many photos can produce a multi-MB export. Worth a one-line UI note if you add visible file-size feedback later.

### Round-trip test

1. Add a custom item with an image, change `wallColors` + `ceiling` on a room, upload a wall photo, export.
2. Open the file in a fresh incognito window, import.
3. Confirm: layouts, custom items in catalog, ceiling / wall colors per room, **and** the wall photo on its originating wall all restored.

---

## 5. Doc-link verification (docs-links)

The roadmap flagged `[*.md](*.md)` references in [`3D_WEBSITE_TARGET_AND_OPINION.md`](3D_WEBSITE_TARGET_AND_OPINION.md) as broken. On verification they are **not broken**: the source file is inside `docs/`, so relative names like `PROJECT_PLAN.md`, `AUTOCAD.md`, `ANALYSIS.md`, `ANALYSIS_v2.md`, `IMPROVEMENT_PLAN.md` resolve correctly to the files in the same directory. All five targets exist on disk.

The `js/...` references in that doc are plain backtick text (not markdown links). They could be upgraded to clickable links (`[js/rooms.js](../js/rooms.js)`) for navigability, but that is cosmetic and out of scope here.

The optional README pointer is deferred: [`../README.md`](../README.md) currently contains double-encoded mojibake Arabic (UTF-8 bytes re-encoded as Windows-1252). A clean re-encoding pass should land before adding new lines, otherwise the new lines will sit inside an already-broken file.

---

*Last updated: companion to the roadmap. Update when phase 1 starts landing real measurements.*
