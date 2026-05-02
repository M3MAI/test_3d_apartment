# Phase 0 — Mental Model Notes
> Compiled per AUDIT_PROMPT.md §3 Phase 0. These are scratch notes, not a final report.
> All citations reference source files directly.

---

## 1. Project Summary (from PROJECT_PLAN.md + ANALYSIS.md)

**Goal:** A static site (no build step) that lets a homeowner:
- View a 3D model of a specific real apartment (sourced from two walkthrough videos).
- Drag & drop furniture from a catalog into rooms.
- Switch between 4 modes: Apartment Map, 2D, 3D, First-Person Walkthrough.
- Save layouts (localStorage), export JSON/PNG/GLB, offline-capable (PWA).

**Stack:** HTML/CSS/Vanilla JS modules, Three.js via CDN, IndexedDB (wall photos + custom items), localStorage (layouts + room overrides), Service Worker (offline).

**Key correction already issued by user:** The salon has a **rectangular** footprint — no protrusion/column.

---

## 2. Room-by-Room Spec (from js/rooms.js)

### Helper
```
resolveWallColor(room, wallId):
  wallColors[wallId] > accentColor (if accentWall===wallId) > wallColor > "#eeeeee"
```

---

### Room 1 — `salon` / الصالون (Reception)
| Field | Value |
|---|---|
| id | `salon` |
| name | الصالون (Reception) |
| width × depth | 500 × 400 cm |
| height | from `ceiling.height = 270` (overrides WALL_HEIGHT default 270) |
| wallColor | `#BFD6D8` (mint/celadon) |
| wallColors | top:`#6892B0` (denim blue) · bottom/left/right:`#BFD6D8` |
| accentColor/accentWall | none (wallColors takes full priority) |
| floorColor | `#E8DCC8` |
| floorTexture | `"tile-cream"` |
| ceiling | `{ tray:true, cove:true, coveColor:"#FFCE7A", downlights:8, height:270 }` |
| plan | `{ x:0, y:0 }` |
| openings | top@160 size180 door "الباب الفرنسي" · bottom@50 size200 door "فتحة على المعيشة" · left@150 size180 window "شباك البلكونة" |
| vertices | none — rectangular |
| allowedCategories | `["living","common"]` |

**Notes (from video/ANALYSIS):** 3 mint walls + 1 denim accent (top/north) holding the French triple-panel door. Balcony window on left (west). Tray ceiling + warm LED cove + ~6-8 downlights + crown molding.

---

### Room 2 — `living` / الصالة المعيشة
| Field | Value |
|---|---|
| id | `living` |
| name | الصالة المعيشة |
| width × depth | 500 × 350 cm |
| height | 270 cm (from `ceiling.height` implicit via WALL_HEIGHT) |
| wallColor | `#BFD6D8` |
| wallColors | top:`#6892B0` · bottom:`#BFD6D8` · left:`#6892B0` · right:`#BFD6D8` |
| floorColor | `#E8DCC8` |
| floorTexture | `"tile-cream"` |
| ceiling | `{ tray:true, cove:true, coveColor:"#FFCE7A", downlights:8, height:270, rose:true }` |
| plan | `{ x:0, y:410 }` |
| openings | top@50 size200 door "فتحة على الصالون" · right@80 size110 door "فتحة مقوّسة على الممر" · left@120 size130 window "شباك" |
| vertices | none — rectangular |
| allowedCategories | `["living","common"]` |

**Notes:** Distinctive feature = **ceiling rose** (`rose:true`). Two denim walls (top+left) + two mint walls (bottom+right). Arched opening on right wall to inner corridor.

---

### Room 3 — `bedroom_blue` / غرفة نوم زرقاء
| Field | Value |
|---|---|
| id | `bedroom_blue` |
| name | غرفة نوم زرقاء |
| width × depth | 400 × 350 cm |
| wallColor | `#F5F5F5` (white) |
| accentColor | `#2C7DA0` (cerulean) |
| accentWall | `"top"` |
| wallColors | top:`#2C7DA0` · bottom/left/right:`#F5F5F5` |
| floorColor | `#e8e8e8` |
| floorTexture | none |
| ceiling | none |
| plan | `{ x:460, y:570 }` |
| openings | right@100 size90 door · top@150 size130 window |

---

### Room 4 — `bedroom_teal` / غرفة أطفال (تركواز)
| Field | Value |
|---|---|
| id | `bedroom_teal` |
| name | غرفة أطفال (تركواز) |
| width × depth | 350 × 300 cm |
| wallColor | `#4A9FB5` (teal) |
| wallColors | top/left:`#4A9FB5` · bottom/right:`#F5F5F5` |
| floorColor | `#e8e8e8` |
| floorTexture | none |
| ceiling | none |
| plan | `{ x:870, y:620 }` |
| openings | right@100 size90 door · bottom@130 size120 window |

---

### Room 5 — `bedroom_master` / غرفة ماستر (عنابي)
| Field | Value |
|---|---|
| id | `bedroom_master` |
| name | غرفة ماستر (عنابي) |
| width × depth | 450 × 350 cm |
| wallColor | `#F5F5F5` |
| accentColor | `#C4A0A5` (rose/mauve) |
| accentWall | `"left"` |
| wallColors | top/bottom:`#F5F5F5` · left/right:`#C4A0A5` |
| floorColor | `#e8dfd0` |
| floorTexture | none |
| ceiling | none |
| plan | `{ x:0, y:570 }` |
| openings | right@120 size90 door · left@160 size130 window |

---

### Room 6 — `kitchen` / المطبخ
| Field | Value |
|---|---|
| id | `kitchen` |
| name | المطبخ |
| width × depth | 300 × 250 cm |
| wallColor | `#A8C4DE` (sky blue) |
| accentColor | `#2E7D52` (green dado tile) |
| accentWall | `"bottom"` |
| wallColors | top/left/right:`#A8C4DE` · bottom:`#2E7D52` |
| floorColor | `#ece3d2` |
| floorTexture | none |
| ceiling | none |
| plan | `{ x:970, y:0 }` |
| openings | right@80 size85 door · top@120 size100 window |

---

### Room 7 — `bathroom_main` / الحمام الرئيسي
| Field | Value |
|---|---|
| id | `bathroom_main` |
| name | الحمام الرئيسي |
| width × depth | 250 × 200 cm |
| wallColor | `#F0EDE8` (cream) |
| accentColor | `#2E7D52` (green tile) |
| accentWall | `"left"` |
| wallColors | top/bottom/right:`#F0EDE8` · left:`#2E7D52` |
| floorColor | `#e8e8e8` |
| floorTexture | none |
| ceiling | none |
| plan | `{ x:510, y:360 }` |
| openings | right@60 size75 door · top@80 size60 window |

---

### Room 8 — `wc` / توالت صغير
| Field | Value |
|---|---|
| id | `wc` |
| name | توالت صغير |
| width × depth | 150 × 150 cm |
| wallColor | `#E8E4F0` (pale lavender) |
| wallColors | all four walls:`#E8E4F0` |
| floorColor | `#e8e8e8` |
| floorTexture | none |
| ceiling | none |
| plan | `{ x:800, y:360 }` |
| openings | right@30 size70 door |

---

## 3. js/three-view.js — Key Functions

### Constants
- `WALL_HEIGHT = 270` cm — default when `room.height` is missing or invalid.
- `WALL_THICK_3D = 10` cm — extrusion depth for all wall meshes.
- `wallH(room)` — returns `room.height` if finite and ≥ 200, else `WALL_HEIGHT`.

### Entry Points (exposed on `window.AptThreeView`)
| Function | Purpose |
|---|---|
| `show(container, opts)` | Mounts single-room 3D scene with OrbitControls; pointer-lock drag for furniture. |
| `hide()` / `hideRoomOnly()` / `hideApartment()` | Tears down scene(s), disposes GPU resources. |
| `updateItems(items, findItem, selectedInstId, …)` | Reconciles furniture meshes without rebuilding walls/floor/ceiling. |
| `setSelection(instId)` | Moves BoxHelper outline. |
| `isActiveFor(roomId)` | Returns `true` iff single-room scene is mounted for that id. |
| `screenToRoomCoords(clientX, clientY)` | Raycasts against floor, returns `{x,y}` in cm. |
| `showApartment(container, {rooms, itemsByRoom, findItem})` | Full apartment walkthrough with PointerLockControls + WASD. |
| `isActiveApartment()` | Returns `true` iff apartment walkthrough is mounted. |
| `updateApartmentItems(…)` | Rebuilds entire apartment scene (simple approach). |
| `screenshotPNG()` | Returns PNG data-URL from current renderer. |
| `exportGLB()` | Async GLTF binary export. |
| `setSunHour(hour)` | Moves directional light along arc (6am–6pm), adjusts intensity + ambient. |
| `setWallVisibility(wallId, visible)` | Adds/removes `ctx.manualHidden` set entries. |
| `setAutoHideWalls(enabled)` | Toggles near-camera wall culling. |
| `getWallVisibilityState()` | Returns `{visible: {top,right,bottom,left}, autoHide}`. |

### Internal Builders
| Function | What it does |
|---|---|
| `buildWalls(scene, room)` | Rectangular 4-wall path. Each wall = `ExtrudeGeometry(Shape + holes)`. Holes = openings (doors 0–210 cm, windows 90–220 cm). Calls `buildCrownMolding` if `room.ceiling`. |
| `buildWallsFromVertices(scene, room, useStd, offX, offZ, collidables)` | Polygon path. `classifyPolygonEdges` assigns `top/bottom/left/right/null` per edge. `assignOpeningsToEdges` maps openings to best edge. Each edge gets its own wall mesh. |
| `buildRoomAt(scene, room, offX, offZ, collidables)` | Used in apartment walkthrough. Delegates to `buildWallsFromVertices` (if vertices) or inline rectangular build. Uses `MeshStandardMaterial` (vs `MeshBasicMaterial` in single-room). Also calls `buildCeiling`. |
| `buildCeiling(scene, room, useStd, offX, offZ)` | Returns `null` if `!room.ceiling`. Builds: flat white ceiling (`ShapeGeometry`), tray drop (inset 60 cm, 25 cm drop), tray sides, cove LED strips, downlights on perimeter, ceiling rose + chandelier hook. Returns `THREE.Group`. |
| `buildCrownMolding(scene, room, useStd, offX, offZ)` | White 8 cm tall `BoxGeometry` along each edge, 4 cm below ceiling, 2.5 cm inward. |
| `buildFurnitureMesh(inst, item)` | `BoxGeometry` with size from `inst.override*` or item defaults. Custom items get image texture on front/back faces; built-ins get `MeshStandardMaterial`. |
| `getTileCreamTexture()` | Singleton `CanvasTexture`: beige (#e6d9c2), speckle, 2×2 grout lines. Cached in `_tileCreamTexture`. |
| `getWallPhotoTexture(dataUrl, settings, wallColor)` | Cached by `_wallPhotoSig`. Builds `THREE.Texture` from `Image` asynchronously with brightness/contrast filter + blend mode on canvas. Supports `fit: cover|tile`. |
| `getCeilingRoseTexture()` | Singleton `CanvasTexture`: ornate plaster rosette (concentric rings, radial flutes, petals, center boss). Transparent PNG overlay. |

### Polygon Helpers
- `classifyPolygonEdges(verts)` — classifies each edge as top/bottom/left/right/null based on bounding-box alignment (TOL = 1 cm).
- `assignOpeningsToEdges(edges, openings)` — maps each opening to the polygon edge whose extent contains it; falls back to longest candidate.
- `openingToLocalEdgeRange(op, edge)` — converts opening `[at, at+size]` to local edge coordinates.
- `shapeFromVertices(verts)` — creates `THREE.Shape` from cm vertex array.
- `getRoomEdges(room)` — returns polygon edges (from vertices) or synthesises rectangular 4 edges.

### Material Strategy
| Context | Material |
|---|---|
| Single-room walls | `MeshBasicMaterial` — exact hex color, unaffected by lighting |
| Apartment walkthrough walls | `MeshStandardMaterial` + `lighter()` (+15% brightness) |
| Furniture built-in | `MeshStandardMaterial` |
| Furniture custom (image) | Multi-material array: 6 faces, image texture on front+back |
| Floor (single-room) | `MeshBasicMaterial` (tile-cream) or flat color |
| Floor (walkthrough) | `MeshStandardMaterial` |
| Ceiling surfaces | Basic (single-room) or Standard (walkthrough) |
| Cove LED | Always `MeshBasicMaterial` (self-illuminated appearance) |

### Scene Management
- Two independent context objects: `ctx` (single room) and `aptCtx` (apartment walkthrough).
- `disposeObj(obj)` traverses hierarchy disposing geometry + textures + materials.
- Render loop (`requestAnimationFrame`): wall visibility (manual hide + auto-hide nearest wall), ceiling visibility (hidden when camera is above `H × 1.1`), selection BoxHelper update.
- Resize handled via `ResizeObserver` on the container.

---

## 4. js/app.js — Startup Sequence (DOMContentLoaded)

```
DOMContentLoaded (line 513)
  │
  ├─ applyTheme()                    — reads THEME_KEY from localStorage
  ├─ applyRoomOverrides()  [SYNC]    — mutates ROOMS[] from localStorage
  │                                    overrides (name, width, depth, height,
  │                                    wallColor, wallColors, accentColor,
  │                                    accentWall, floorColor, openings, plan,
  │                                    floorTexture, wallTexture, wallTextures,
  │                                    wallTextureSettings, vertices)
  ├─ maybeLoadStateFromUrl()         — loads shared JSON from URL hash
  ├─ renderRoomList()      [SYNC]    — builds left-panel room list
  ├─ renderCatalog()       [SYNC]    — builds furniture catalog
  │
  ├─ CustomItems.init()    [ASYNC]   — hydrates custom items from IDB
  │    └→ renderCatalog() + drawRoom()
  │
  ├─ WallStorage.init()    [ASYNC]   — hydrates wall photos from IDB
  │    └→ applyWallStorageToRooms() + drawRoom()
  │                                    (merges per-wall photos + per-wall
  │                                    settings + app-level default wallpaper)
  │
  ├─ bindTopbar(), bindCatalogSearch(), bindViewControls(), …  [all SYNC]
  ├─ WallPhoto.init() + bindEyedropperButtons() + bindWallpaperGallery()
  ├─ bindOnboarding()
  │
  └─ selectRoom(lastActiveRoomId) OR drawRoom()  — first paint
       │
       └─ drawRoom() dispatches to:
            ├─ showApartment() [walk/overview modes]
            ├─ AptThreeView.show() [3d mode]
            └─ render2D() [2d mode — SVG]
```

### Key State Variables (module-level in app.js)
| Variable | Description |
|---|---|
| `state` | `{ layouts, history, future, viewMode, selectedInstIds, activeRoomId }` |
| `editingRoomId` | Room currently open in the Room Editor modal |
| `_activeWallpaperWall` | Wall id captured when wallpaper gallery opens |
| `STORAGE_KEY` | localStorage key for furniture layouts |
| `ROOM_OVERRIDES_KEY` | localStorage key for room attribute overrides |
| `ACTIVE_ROOM_KEY` | localStorage key for last-selected room id |
| `THEME_KEY` | localStorage key for dark/light theme |

### `applyRoomOverrides()` (lines 122–149)
Reads `ROOM_OVERRIDES_KEY` from localStorage, iterates `ROOMS[]`, mutates each room in-place. Applies: `name`, `width`, `depth`, `height`, `wallColor`, `wallColors`, `color`, `accentColor`, `accentWall`, `floorColor`, `openings`, `plan`, `floorTexture`, `wallTexture`, `wallTextures`, `wallTextureSettings`, `vertices`. **Does NOT apply `ceiling`** — ceiling config is immutable from `rooms.js`.

### `applyWallStorageToRooms()` (lines 154–178)
Called after `WallStorage.init()` resolves (async). Iterates `ROOMS[]`, merges:
1. Per-room textures + settings from IDB.
2. App-level default wallpaper (for walls not already set).
If neither exists for a room, skips (doesn't clobber legacy overrides).

### `drawRoom()` (line 1102)
Central render dispatcher. Reads `state.viewMode`:
- `"overview"` → `AptThreeView.showApartment(...)` (or reconciles if active)
- `"walk"` → same as overview
- `"3d"` → `AptThreeView.show(container, { room, items, … })` (or `updateItems` if already mounted for same room)
- `"2d"` → `render2D(container, room, items)` — SVG path based on `room.vertices` or rectangle

### Wall Color Resolution Priority
`wallColors[wallId]` > `accentColor` (when `accentWall === wallId`) > `wallColor` > `"#eeeeee"`
Implemented both in `rooms.js` (`resolveWallColor`) and referenced inside `buildWalls` / `buildWallsFromVertices` / `buildRoomAt`.

---

## 5. Potential Issues Spotted (to be verified in Phases 2-3)

| # | Location | Observation |
|---|---|---|
| 1 | `buildCeiling` (three-view.js:1025) | `cfg.downlights \| 0` uses bitwise-OR instead of `\|\| 0` — `cfg.downlights = 8` works correctly but is non-idiomatic; falsy zero value would incorrectly fall back to 6. |
| 2 | `getWallPhotoTexture` (three-view.js:768) | Texture is created and cached **before** `img.onload` fires. On first call the texture's `.image` is undefined; `needsUpdate` is set inside the callback. If the scene renders before load, the wall may flash. No explicit error state on `img.onerror`. |
| 3 | `updateApartmentItems` (three-view.js:1506) | Tears down + rebuilds the entire walkthrough scene on every item change. This re-runs `WallStorage` textures and ceiling, re-creating all GPU resources. |
| 4 | `applyRoomOverrides` (app.js:122) | Does **not** apply `ceiling` overrides — ceiling is hardcoded in `rooms.js` and cannot be changed by the user at runtime without editing the source file. |
| 5 | Startup race (app.js:513–573) | `WallStorage.init()` and `CustomItems.init()` both call `drawRoom()` independently. If both resolve quickly they trigger two consecutive scene rebuilds. No debounce. |
| 6 | `buildWalls` vs `buildRoomAt` duplication | The rectangular wall-building logic is duplicated between `buildWalls` (single-room) and the `else` branch inside `buildRoomAt`. The polygon path (`buildWallsFromVertices`) is shared, but the rectangular path is not. |
| 7 | `_tileCreamTexture` singleton (three-view.js:702) | Shared across all rooms and both single-room and walkthrough scenes. `tex.repeat` is mutated per room. Last mutation wins. For the apartment scene, the last-visited room's repeat applies to all tiles. |
| 8 | `resolveWallColor` definition location | Defined in `rooms.js` but called inside `three-view.js` via `typeof resolveWallColor === "function"` guard — relies on global scope. If modules are ever bundled, this will break. |
| 9 | `ceiling.height` field | Salon/living define `ceiling.height: 270` inside the ceiling config object, but `wallH(room)` reads `room.height` (top-level), not `room.ceiling.height`. So the height override is silently ignored. Both rooms already have default 270 cm so it's correct by coincidence. |
| 10 | `buildCrownMolding` inward normal direction | Uses CCW polygon assumption (`dxN = -sin(angle)`, `dyN = cos(angle)`). If vertices are CW, molding appears on the outside. No winding-order check. |

---

## 6. Reference Video Annotation (from ANALYSIS.md)

### apartment_video.mp4 (~72 s)
Room appearance order: Entry/Hall → Salon (Reception) → Living → Bedroom Blue → Bedroom Teal → Bedroom Master → Kitchen → Bathroom Main → WC.

### new_apartment_video.mp4 (authoritative)
| Time | Scene |
|---|---|
| 00:00 | Entry door |
| 00:03–00:08 | Salon — 3 mint walls + 1 denim, tray ceiling, French door, balcony window |
| 00:09 | Entry door (revisit) |
| 00:10 | Kitchen door |
| 00:11 | Kitchen glance |
| 00:11–00:20 | Living — ceiling rose, arched opening, tray ceiling |

---

*End of Phase 0 notes — ready to proceed to Phase 1 (video frame extraction and independent re-analysis).*
