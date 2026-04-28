# Improvement Plan + AutoCAD Integration Roadmap

> الهدف: نقل الموقع من "أداة لطيفة" إلى **أداة يعتمد عليها فعليًا** لتخطيط الشقّة قبل شراء الأثاث، مع إمكانية استيراد مخطط معماري حقيقي من AutoCAD.

## Section 1 — Audit of current state

### What already works well
- 8 rooms with video-accurate wall colors + accent walls (5 rooms), in both 2D and 3D
- Full 3D editor: drag / select / move / rotate / delete inside the scene
- Keyboard shortcuts, undo/redo (60 steps), copy/paste across rooms
- Walkthrough mode (WASD + mouse), share-by-URL, PNG snapshot, GLB export, PWA
- Catalog of ~40 items + custom upload (image + dimensions) + later editing
- Collision detection, Alt+drag wall snap, measure tool, A/B/C layout slots

### UX gaps (prioritized)

| # | Gap | Impact | Effort |
|---|------|--------|--------|
| H1 | No smart units — cm only; can't switch to m/ft | Medium | Small |
| H2 | No room-height / ceiling field — every wall is 270 cm | Medium | Small |
| H3 | 3D collision is invisible — items can be placed inside each other with no red highlight (unlike 2D) | High | Medium |
| H4 | Opening editor is primitive — no visual preview while editing, hard to place a door precisely | High | Medium |
| H5 | No real 3D model library — every furniture piece is a textured box | High | Large |
| H6 | No per-item Z / lift-from-floor — bed and lamp are at the same height | Medium | Small |
| H7 | localStorage is tight (~5MB) — uploading 8 large images can fill it | Medium | Medium |
| H8 | No polished PDF export with floor plan + item list + total cost | High | Medium |
| H9 | No night-mode lighting simulation — only one sun-hour slider | Low | Medium |
| H10 | No "ventilation / door blocked" check — you can place a bed in front of the only door | High | Small |
| H11 | No "neighbours / outside" layer in apartment plan | Low | Medium |
| H12 | No working multi-select (advertised but unimplemented) | Medium | Medium |
| H13 | Arabic search isn't normalized (separates "كنبة" from "كنبه") | Low | Small |
| H14 | No saved camera "views" (e.g. "kitchen angle", "TV angle") | Low | Small |

### Performance notes
- The full-apartment 3D scene is rebuilt from scratch on every toggle — `buildApartment` deserves an object pool for repeated furniture
- Catalog thumbnails don't use `loading="lazy"`
- `js/app.js` exceeded 2000 lines — would benefit from being split into ESM modules (`state.js`, `render-2d.js`, `interactions.js`, `clipboard.js`, …) for maintainability

## Section 2 — Recommended improvement package (one PR)

### 🥇 Tier 1 — usage reliability
1. **Vent / corridor / door check** (H10) — orange warning circle around items that block the only door, plus a header counter "ممرّ ضيّق"
2. **Editable room height** (H2) — field in the room editor, used by 3D walls and walkthrough
3. **Per-item Z + lift-from-floor** (H6) — detail panel gains `z` and `liftedZ`; useful for floating shelves, wall art
4. **3D collision warning** (H3) — translucent red overlay on overlapping items + tooltip "متداخلة مع X"
5. **Comprehensive PDF export** (H8) — A4 sheet with apartment branding + 2D floor plan + furniture table with prices + grand total

### 🥈 Tier 2 — editing power
6. **True multi-select** (H12) — Shift+Click on furniture (with brief cooldown vs. Shift+drag pan), bulk move/delete/rotate
7. **Visual openings editor** (H4) — drag the door directly on the wall instead of typing numbers
8. **Optional real 3D library** (H5) — integrate Sketchfab Free Models API or Poly Haven; replace the textured cube with a real GLB when an API key is provided
9. **Day/night simulation** (H9) — "night mode" toggle that dims the sun and turns on internal lights attached to lamp items
10. **Saved camera views** (H14) — `+ View` button stores current camera, click later to fly back

### 🥉 Tier 3 — operational weight
11. **Migrate storage to IndexedDB** (H7) — raises the cap from 5 MB to hundreds of MB
12. **Unit system** (H1) — m / cm / ft, preference saved
13. **Arabic search normalization** (H13) — equates diacritics, ta-marbuta, alefs
14. **Split `app.js` into ESM modules** — internal hygiene only, no user-facing change

**Estimated total effort:** one large PR (~3-4 focused sessions, similar to PR #5).

## Section 3 — AutoCAD integration (the requested feature)

### User story
> Draw your apartment in AutoCAD (precise dimensions, openings, sloped walls, columns), export the file, upload it on the site, and have **the floor plan generated automatically** instead of editing values in `js/rooms.js` by hand.

### Format challenges
- **DXF (text)** — easily parseable in the browser. AutoCAD exports it directly (`File → Save As → AutoCAD DXF`).
- **DWG (closed binary)** — AutoCAD's native format. No fully mature open-source JS library, but:
  - **Option A:** ask the user to export DXF (one click in AutoCAD).
  - **Option B:** convert DWG→DXF in the browser via [`@ducflair/dwgdxf`](https://github.com/ducflair/dwgdxf) or [`LibreDWG-WASM`](https://github.com/LibreDWG/libredwg) — adds ~3 MB WASM but works offline.
  - **Option C:** cloud conversion (Aspose.CAD, CloudConvert) — needs a backend and an API key.
- **IFC/BIM** — the standard architectural format (Revit/ArchiCAD). [`web-ifc`](https://github.com/IFCjs/web-ifc) reads it in the browser. Stronger than DXF because it carries semantic info (this *is* a wall, that *is* a door — not just two lines).

### Recommended phased approach

#### Phase 1 — DXF import per room (separate PR)
- **Library:** [`dxf-parser`](https://www.npmjs.com/package/dxf-parser) (most-used, ~1.5 MB)
- **Workflow:**
  1. New button in the room editor: `🗎 استيراد من AutoCAD (DXF)`
  2. User uploads `bedroom.dxf`
  3. Site parses:
     - **Layer `WALLS`** or closed `LWPOLYLINE` entities → room outline (width × depth)
     - **Layer `DOORS`** → door openings
     - **Layer `WINDOWS`** → window openings
     - **Layer `FURNITURE`** (optional) → pre-placed pieces
  4. Preview on site (extracted dimensions, openings) before saving
  5. "Apply" → writes to `state.layouts[roomId]` and `room.openings`
- **Conversions:**
  - DXF unit is usually mm or m; detect from `$INSUNITS` header and convert to cm
  - Rotate 90° if needed to match the front-door orientation
- **Effort:** medium PR (~2 sessions)
- **Value:** **huge** — moves the site from "estimated" to "exact"

#### Phase 2 — full apartment from a single DXF
- DXF carries a layer per room (`KITCHEN`, `LIVING`, …) or named blocks
- Site auto-generates the entire `ROOMS` array, replacing the defaults in `js/rooms.js` with values from your file
- Doors are linked automatically (if a door is on the shared wall between two rooms, it's an internal door)
- **Effort:** large PR (~3 sessions) — needs polygon-to-room detection + shared-wall analysis + plan placement
- **Value:** **decisive** for architects — your whole apartment from one file

#### Phase 3 — DWG and IFC (optional)
- **DWG:** WASM background converter DWG→DXF, then same pipeline as Phase 1/2
- **IFC:** [`web-ifc-three`](https://github.com/IFCjs/web-ifc-three) — renders the building with semantic meaning, reads BIM properties
- **Value:** specialized (engineers) — leave for later

### Architecture sketch (DXF pipeline)

```
┌─────────────┐  1. upload  ┌──────────────┐
│   user      ├────────────►│ dxf-parser   │
│ uploads DXF │             │  (parser)    │
└─────────────┘             └──────┬───────┘
                                   │ JSON entities
                                   ▼
                            ┌──────────────┐
                            │ DXF Mapper   │ ← knows our layer conventions
                            │  (custom)    │   WALLS / DOORS / FURNITURE
                            └──────┬───────┘
                                   │
                          ┌────────┴────────┐
                          ▼                 ▼
                   ROOM { width,       OPENINGS [{wall,
                          depth,                  at, size,
                          openings, }             kind}]
                          ▼
                    apply via
                    `applyRoomOverrides()`
                    and persist in localStorage
```

### Layer convention (documented for users in `docs/AUTOCAD.md`):

| Layer | Meaning | Must be |
|-------|---------|---------|
| `WALLS` | exterior wall outline | closed `LWPOLYLINE` |
| `DOORS` | doors | `LINE` or `ARC` on a wall |
| `WINDOWS` | windows | `LINE` on a wall, length = opening |
| `ROOM_NAMES` | `TEXT`/`MTEXT` inside each room | Arabic name |
| `FURNITURE_*` | (optional) pre-placed furniture | block insertion |

Will ship with an AutoCAD template `apartment-template.dwt` that already has these layers configured — downloadable from the site.

### Sample code (sketch)

```js
// js/dxf-import.js
import DxfParser from 'dxf-parser';

export async function importApartmentDxf(file) {
  const parser = new DxfParser();
  const text = await file.text();
  const dxf = parser.parseSync(text);

  const unit = detectUnit(dxf.header.$INSUNITS); // mm/m/in
  const toCm = makeUnitConverter(unit);

  // 1. every closed LWPOLYLINE on layer WALLS = a room
  const rooms = dxf.entities
    .filter(e => e.layer === 'WALLS' && e.shape === true)
    .map(poly => buildRoomFromPolyline(poly, toCm));

  // 2. room names from ROOM_NAMES texts — closest text to each room centroid
  attachRoomNames(rooms, dxf.entities.filter(e => e.layer === 'ROOM_NAMES'));

  // 3. doors and windows from their lines → snapped to the closest wall
  const openings = dxf.entities.filter(e =>
    ['DOORS', 'WINDOWS'].includes(e.layer)
  );
  attachOpenings(rooms, openings, toCm);

  return rooms;
}
```

## Section 4 — Suggested execution order

| Order | Item | Why now? | Effort |
|-------|------|----------|--------|
| 1 | Door-blocked + narrow-corridor warning | The line between "nice toy" and "tool you trust before buying" — this is what makes the site dependable | Small |
| 2 | Room height + per-item Z/lift | Unlocks key use cases (wall art, hanging shelves) | Small-Medium |
| 3 | 3D collision warning + red overlay | Completes parity with 2D | Medium |
| 4 | Comprehensive PDF export | Print-ready output to take to the furniture store | Medium |
| 5 | DXF import per room | The requested feature — start small to validate the pipeline | Medium |
| 6 | DXF import for whole apartment | Reuses the previous pipeline | Large |
| 7 | True multi-select + Shift+Click | Productivity for serious users | Medium |
| 8 | IndexedDB for images / overrides | Prevents app failure when many images are uploaded | Medium |
| 9 | Real 3D library (Sketchfab) — optional | Visual upgrade, needs API key | Medium |
| 10 | DWG via WASM | Bonus for users who don't export DXF | Medium |
| 11 | Module split + Arabic-normalized search + unit system | Maintenance + polish | Small-Medium |
