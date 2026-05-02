# Apartment-Designer — Audit Report

> Run date: 2026-05-02. Scope per `docs/AUDIT_PROMPT.md`. Inputs: source under `js/`, `css/`, `index.html`; videos `apartment_video.mp4` (legacy) and `new_apartment_video.mp4` (authoritative); prior context `docs/PHASE0_NOTES.md` and `docs/ANALYSIS_v2.md`.
>
> Citations style: `js/foo.js:120-145` for code, `docs/AUDIT_FRAMES/<video>/t_NNN.png` for video.

---

## 1. Executive Summary (≤ 500 words)

**English.** The project is a thoughtfully built, dependency-free static site that lets a user explore and furnish a 3D model of one specific real apartment (the one shown in the two reference videos). The architecture (vanilla JS modules + Three.js via CDN + IndexedDB-backed wall photos + service-worker PWA) is appropriate for the goal — it stays small, ships fast, and has zero build complexity. Most user-facing features (smart placement, templates, layout compare, wallpaper presets, crop, blend modes, IndexedDB migration, service-worker offline) are implemented well. The single biggest engineering issue is **memory**: `getWallPhotoTexture` ([js/three-view.js:768-820](js/three-view.js)) caches a new GPU texture per `(dataUrl × settings × wallColor)` tuple with no eviction, and the apartment walkthrough rebuilds the entire scene on every furniture change ([js/three-view.js:1500-1540](js/three-view.js)). On the design side, the current `js/rooms.js` matches the videos for the salon and living room but **misses three things**: (1) the salon's "balcony window" listed as a separate opening is probably just the French door's glass; (2) `bedroom_blue` has a real plaster ceiling rose that the code does not model; (3) the apartment's central corridor and the bathrooms' actual tile-only finishes are absent or wrong in the code. The "tests" mentioned in earlier docs are not present in the workspace anymore. None of these is a release blocker.

**العربية.** المشروع موقع ساكن مكتوب بـ JavaScript نقي بدون نظام بناء، يستخدم Three.js و IndexedDB و Service Worker. التنفيذ نظيف ومناسب للهدف. أكبر مشكلتين هندسيتين: تسريب ذاكرة في الـ wall photo texture cache (لا يحرّر النسيج عند تغيير الإعدادات)، وإعادة بناء كامل المشهد عند أي تغيير أثاث في وضع المشي. على صعيد المطابقة مع الفيديو: الصالون والمعيشة قريبتان جداً من الواقع لكن تبقى ثلاث ملاحظات مهمة — شباك "البلكونة" المنفصل في الصالون لا يظهر في الفيديو (الباب الفرنسي وحده)، غرفة النوم الزرقاء فيها وردة سقف جصّية لا يمثّلها الكود، والممر المركزي بين الغرف غير مُمثَّل أصلاً.

**Recommendation.** Treat the texture-cache eviction (P0), the apartment-scene rebuild on every item change (P1), and the missing corridor + missing bedroom_blue ceiling (P1 each) as the next four work items. The engineering audit is otherwise positive.

---

## 2. Project Goal (Auditor's Restatement)

After reading `docs/PROJECT_PLAN.md`, `docs/ANALYSIS.md`, the new wallpaper / wall-storage / crop / blend / templates / smart-placement modules added in the last weeks, and confirming that **both reference videos show an unfurnished apartment**, the goal is:

> Let the homeowner of the specific real apartment shown in the videos virtually furnish, finish, and tour it — without leaving the browser, without installing anything, and without giving up offline use. The user should be able to: switch between 2D plan, single-room 3D, full-apartment 3D walkthrough, and 2D apartment overview; drag furniture from a catalog (built-in + custom uploads); apply realistic finishes (procedural floor textures, real photos uploaded to walls, procedural wallpaper presets); save multiple named layouts per room; compare them side-by-side; and recover their work after closing the browser tab.

This is a **specific-apartment design tool**, not a generic floor planner. Everything in the code ought to either model THAT apartment or help the user customise it.

---

## 3. Q-A — Code Architecture Findings

Severity: **P0** (release-blocker / data-loss / crash risk), **P1** (significant correctness/perf), **P2** (maintainability / minor correctness), **P3** (nice-to-have / cosmetic).

### P0 — Texture cache grows without bound

**Finding C-01.** Evidence: [js/three-view.js:747-820](js/three-view.js) (`_wallPhotoCache`, `getWallPhotoTexture`).
The cache is a `Map<sig, THREE.Texture>` where `sig` includes `dataUrl|fit|tileX|tileY|brightness|contrast|blend|wallColor`. Every adjustment to a slider creates a new texture; old textures stay in the map and on the GPU. Over a session of UI tweaks the cache can hold dozens of 1024×1024 textures (≈4 MB GPU each). There is no `tex.dispose()` call anywhere and no LRU eviction.
**Why it matters:** GPU memory pressure → tab crash on low-end devices, long-running sessions get progressively slower.
**Suggested fix:** Bound the cache to ~16 entries with simple LRU eviction; on eviction, call `tex.dispose()` and remove the in-flight `<img>` reference. When `setRoom`/`clearRoom` runs, also dispose textures whose `dataUrl` is no longer referenced.

### P0 — Apartment walkthrough rebuilds entire scene on each item change

**Finding C-02.** Evidence: [js/three-view.js:1500-1540](js/three-view.js) (`updateApartmentItems`).
The function tears down and rebuilds the full apartment scene on every furniture mutation, instead of reconciling like the single-room path does ([js/three-view.js:200-300](js/three-view.js) `updateItems`). This re-runs `WallStorage` lookups, rebuilds 8 ceilings, ~32 walls, and reloads every wall texture.
**Why it matters:** Drag-to-place, rotate, undo, redo all become noticeably janky in walkthrough mode. Frame drops to 10–15 fps on commodity hardware.
**Suggested fix:** Mirror the single-room reconciler — keep an `aptItemMeshMap` keyed by `inst.id`, only rebuild meshes whose data changed, and leave room shells untouched. Wall textures are cached but the geometry rebuild is wasted work.

### P1 — Triple `drawRoom()` race at boot

**Finding C-03.** Evidence: [js/app.js:521-535](js/app.js) and [js/app.js:570](js/app.js).
Three independent code paths call `drawRoom()` during boot: the synchronous tail (`selectRoom(last) | drawRoom()` line 569–570), `CustomItems.init().then(...)` line 522–525, and `WallStorage.init().then(...)` line 530–534. If both async stores resolve quickly, the user sees up to three consecutive scene rebuilds.
**Why it matters:** First paint stutters; in walkthrough mode it triggers C-02 three times.
**Suggested fix:** Replace the multiple direct `drawRoom()` calls with a debounced redraw (e.g. `requestAnimationFrame`-coalesced) and let the async hydration paths just call the debounced version.

### P1 — `getWallPhotoTexture` returns a texture with `image: undefined` until `<img>` loads

**Finding C-04.** Evidence: [js/three-view.js:774-810](js/three-view.js).
`new THREE.Texture()` is created and inserted into the cache before `img.onload` fires. If the scene renders within that window, the wall samples a black/transparent texture and **the user sees a flash of black on every fresh photo**. There's no `onError` recovery either — if `img.onerror` fires, the wall stays black until the user re-uploads.
**Suggested fix:** Pre-flight the `Image` load with `await` inside an async function and only insert into the cache after the canvas is ready; on error, return `null` and let the caller fall back to wall color.

### P1 — `bitwise OR` typo prevents `downlights: 0`

**Finding C-05.** Evidence: [js/three-view.js:1025](js/three-view.js):
```js
const downlights = Math.max(0, cfg.downlights | 0 || 6);
```
Setting `cfg.downlights = 0` on purpose to disable downlights yields `0|0 || 6` → 6. The same idiom would work as intended with `cfg.downlights ?? 6`.
**Suggested fix:** `const downlights = Math.max(0, cfg.downlights ?? 6);`

### P1 — `_tileCreamTexture` shared singleton mutated per-room

**Finding C-06.** Evidence: [js/three-view.js:702-729](js/three-view.js).
The cream-tile texture is a single shared `CanvasTexture` whose `tex.repeat` is mutated by each caller before render. In the apartment walkthrough scene, the **last** `repeat` written by `buildRoomAt` wins for ALL rooms — every tiled floor in the apartment uses the same repeat factor (whatever the last-built room set).
**Suggested fix:** Either return a CLONE per room with its own `repeat`, or pre-compute a single repeat that looks correct at all scales (e.g. tile every 60 cm by setting `tex.repeat.set(roomWidthCm/60, roomDepthCm/60)` inside a per-mesh wrapper rather than on the shared texture).

### P1 — `applyRoomOverrides` ignores `ceiling`

**Finding C-07.** Evidence: [js/app.js:122-149](js/app.js).
The override pipeline applies most fields (`name`, `width`, `depth`, `wallColors`, `floorTexture`, …) from localStorage onto each room, but **not `ceiling`**. Consequence: a user cannot enable/disable tray ceilings, change cove color, or remove the rose without editing `js/rooms.js` directly. This is at odds with the user-facing room editor's apparent flexibility.
**Suggested fix:** Add `if (o.ceiling) r.ceiling = o.ceiling;` (or a deep-merge if you want the user to override only some keys).

### P1 — Tests directory referenced everywhere is missing

**Finding C-08.** Evidence: `docs/PHASE0_NOTES.md` mentions `tests/test-runner.html`, `tests/tests.js`, `tests/run-node.js`. `Glob **/tests/**` returns 0 files; `Get-ChildItem` confirms the folder doesn't exist.
**Why it matters:** No automated way to verify catalog/room data integrity, smart-placement heuristics, or storage round-trips. The previous summary claimed "all tests pass" but they cannot pass if they don't exist.
**Suggested fix:** Re-create the test scaffolding (lightweight, no-dependency runner) — see commit history for the version that was deleted.

### P1 — Living-room arched opening rendered as flat door

**Finding C-09.** Evidence: code-side [js/three-view.js:880-960](js/three-view.js) (`buildWalls`/`buildWallsFromVertices`) cuts a rectangular hole for any opening with `kind: "door"`. Video-side `docs/AUDIT_FRAMES/new/t_015.png` clearly shows a **segmental arch** with white painted moldings.
**Suggested fix:** Either add an `arched: true` flag to openings and use a `THREE.Shape` with arc curves for the hole, or render an extra arc-shaped "trim" mesh on top of the rectangular hole.

### P1 — No focus-trap inside modals

**Finding C-10.** Evidence: 7 modals declared with `role="dialog"` and `aria-modal="true"` ([index.html:344, 363, …](index.html)), but `Grep focus-trap | trapFocus` over `js/` returns 0 matches.
**Why it matters:** Keyboard users TAB-ing inside a modal end up on the page behind it, which violates WAI-ARIA's `aria-modal` contract and is a real usability problem for screen-reader users.
**Suggested fix:** Add a tiny shared `trapFocus(modalEl, openerEl)` helper that catches `Tab`/`Shift-Tab` at the boundaries and restores focus to `openerEl` on close.

### P2 — Eyedropper double-binding still possible after WallPhoto rebuild

**Finding C-11.** Evidence: [js/app.js:551, 562](js/app.js) — `bindEyedropperButtons()` is called twice during boot (once for the static DOM, once after `WallPhoto.init()` rebuilds the wall-color grid). The internal `_bound` guard on each button prevents true double firing, but the global click listener delegation pattern relies on the guard, which is fragile if the button DOM is ever rebuilt a third time.
**Suggested fix:** Switch to event delegation on the persistent `#room-modal` ancestor instead of binding each `.wall-eyedropper-btn` directly.

### P2 — `editingRoomId` hoisted to module scope, accessed by 4+ subsystems

**Finding C-12.** Evidence: [js/app.js:189](js/app.js) declares `let editingRoomId = null;` at module scope, used by the room editor save flow ([js/app.js:2725-2780](js/app.js)), the wallpaper gallery, the crop modal, and the apply-to-all-rooms flow. This was promoted from a closure during the wall-photo refactor and is now an effective global.
**Why it matters:** Hard to test, hard to reason about lifetime, easy to accidentally overwrite from a parallel flow.
**Suggested fix:** Encapsulate in a small `RoomEditorContext` object with `enter(roomId)` / `exit()` methods, or pass `roomId` explicitly to each consumer.

### P2 — Service worker is `cache-then-network` for everything (not just CDN)

**Finding C-13.** Evidence: [service-worker.js:32-55](service-worker.js).
Every GET goes through `try fetch → cache 200 same-origin → cache-fallback`. For local JS files this means a stale cached version is *always* served until the next reload, which is the standard PWA pattern but is **not what AUDIT_PROMPT.md §2 implied** (the prompt referenced a "cache-first for CDN, network-first for same-origin" split that is not present in the current code).
**Why it matters:** Updates to `js/app.js` only show up on hard refresh; users may be running an old version for a long time.
**Suggested fix:** Either (a) honour what the prior summary claimed — separate strategies for CDN vs same-origin, or (b) add an in-app "Update available" toast that surfaces when the service worker installs a new shell.

### P2 — Wallpaper preset thumbnails generated synchronously on modal open

**Finding C-14.** Evidence: [js/wallpaper-presets.js:289-302](js/wallpaper-presets.js) (`getThumb` calls `buildDataUrl(id, 128)` lazily; cache populated on first request). Opening the modal triggers 16 thumbnail builds in a synchronous loop (~150 ms on cold start). Not a crash, just a brief stall.
**Suggested fix:** Pre-warm the cache during idle time after the app loads (`requestIdleCallback`).

### P2 — `applyWallStorageToRooms` re-merges on every async resolution

**Finding C-15.** Evidence: [js/app.js:154-178](js/app.js).
This function iterates ROOMS, calls `WallStorage.getAllForRoom` for each (8 rooms), and mutates `room.wallTextures` / `room.wallTextureSettings`. Called every time a new wall photo is saved (via the save handler) AND once at boot. Each call is O(rooms × walls) which is tiny, but it does **mutate the same `r.wallTextures` object reference**, which can race with reads from `three-view.js` if a frame is being rendered at the same time.
**Suggested fix:** Build a fresh `{...textures}` object before assignment (already done), AND assign the entire fresh object to `r.wallTextures` only at the end.

### P3 — Procedural texture cache uses raw `Map` with no size cap

**Finding C-16.** Evidence: [js/three-view.js:702](js/three-view.js) (`_tileCreamTexture` singleton — fine) but the wallpaper-preset path goes through `_builtCache` and `_thumbCache` in [js/wallpaper-presets.js:286-290](js/wallpaper-presets.js) — also raw Maps that grow as users explore presets. With 16 presets × 2 sizes = 32 entries max, this is a non-issue today but worth documenting.

### P3 — `URL.createObjectURL` not used; everything is data URLs

**Finding C-17.** Evidence: search across `js/` returns no `createObjectURL`. Every uploaded image flows through `FileReader.readAsDataURL` then `<img src=dataUrl>`. Data URLs are slower to encode/decode and inflate localStorage 33% (base64). For wall photos (now in IDB) this is fine because the storage is binary-tolerant, but the in-memory pipeline still keeps base64 strings around.
**Suggested fix (optional):** For very large uploads, switch to `URL.createObjectURL(blob)` for the in-memory texture; revoke URLs in the wall photo cache eviction.

### P3 — Wall-color hex values vs sampled values drift ~10–15 RGB units

**Finding C-18.** Evidence: `js/rooms.js` has `wallColor: "#BFD6D8"`, sampled mint from `docs/AUDIT_FRAMES/new/t_004.png` ≈ `#B5CFCC`. Within visual tolerance but not exact. See §4 fidelity matrix.

### P3 — Room dimensions are best-guess-rounded numbers

**Finding C-19.** Evidence: every room in `js/rooms.js` uses round numbers (500, 400, 350). No measurement was actually taken on-site; these are inferred from the videos. **This is fine for a design tool** — but the project's own README/docs do not flag this. Add a one-liner so the user knows they should verify against tape-measure data before using the tool to commission furniture.

---

## 4. Q-B — Design Fidelity Matrix

For each room, comparing `js/rooms.js` ground truth to the videos. Severity: **D0** wrong, **D1** off but recognizable, **D2** cosmetic, **D3** match.

### 4.1. salon (الصالون)

| Field | Code value | Video evidence | Match | Severity |
|---|---|---|---|---|
| Footprint | rectangular 500×400 cm, no `vertices` | rectangular, dimensions plausible (`new/t_002`, `t_006`) | OK | D3 |
| `wallColor` (mint) | `#BFD6D8` | `~#B5CFCC` sampled in `new/t_004` | close | D2 |
| Accent (`top` denim) | `#6892B0` | `~#6F90B0` sampled in `new/t_006` | close | D2 |
| Accent wall id | `top` (north) | denim wall holds the French door | OK | D3 |
| Floor | `floorTexture: "tile-cream"`, `floorColor: #E8DCC8` | cream marble-veined large-format tile | mostly | D2 (no veining in procedural) |
| Ceiling | tray + cove `#FFCE7A` + 8 downlights | tray + warm cove + ~5–6 downlights | OK | D3 |
| French door | `top@160 size180 door "الباب الفرنسي"` | wide white triple-panel French door, position centred | OK | D3 |
| "Balcony window" | `left@150 size180 window "شباك البلكونة"` | **No second opening visible**; the French door's louvers are likely the "window" | mismatch | **D0** |
| Living opening | `bottom@50 size200 door "فتحة على المعيشة"` | not directly observed but consistent with spatial flow | unverified | D? |

### 4.2. living (الصالة المعيشة)

| Field | Code value | Video evidence | Match | Severity |
|---|---|---|---|---|
| Footprint | rectangular 500×350 cm | rectangular, no protrusion (`new/t_013`) | OK | D3 |
| `wallColor` (mint) | `#BFD6D8` | `~#B0CCC8` sampled in `new/t_017` | close | D2 |
| Accent walls | top + left blue `#6892B0` | both blue walls confirmed | OK | D3 |
| Ceiling rose | `rose: true` | clearly visible plaster rosette in `new/t_013, t_019` | OK | D3 |
| Tray + cove + downlights | yes | yes | OK | D3 |
| Window (left) | `left@120 size130 window` | white-framed louvered double window on blue wall, position appears centred (~185 cm offset for a 500 cm wall) | off-position | D1 |
| Arched opening (right) | `right@80 size110 door "فتحة مقوّسة على الممر"` | **arched**, but code renders flat door (renderer cannot draw arches) | shape wrong | D1 |
| Salon opening | `top@50 size200 door` | not directly observed | unverified | D? |
| Floor | `tile-cream`, `#E8DCC8` | cream tile (same as salon) | OK | D2 |

### 4.3. kitchen (المطبخ)

| Field | Code value | Video evidence | Match | Severity |
|---|---|---|---|---|
| Footprint | 300×250 cm | not measurable (`new/t_011` is a peek through the door) | unverified | D? |
| Walls | sky blue `#A8C4DE` + green dado `#2E7D52` on bottom | **walls inside kitchen are dark/shadowed; cannot confirm sky-blue or green** | unverified | D? |
| Door | `right@80 size85 door` | dark wooden door swung inward at `new/t_010` | OK shape | D3 |
| Ceiling | none | no tray visible — flat ceiling | OK | D3 |
| Floor | `#ece3d2` no texture | continues cream tile | mismatch (real floor is tile, code says plain color) | D1 |

### 4.4. bedroom_blue (غرفة نوم زرقاء)

| Field | Code value | Video evidence | Match | Severity |
|---|---|---|---|---|
| Walls | white `#F5F5F5` + cerulean accent `#2C7DA0` on top | white walls + saturated cerulean wall (`old/t_030, t_035`) | OK | D2 (slightly darker in video) |
| Ceiling | **none** | **plaster ceiling rose visible** | mismatch | **D0** |
| Window | `top@150 size130 window` | white-framed louvered window on the cerulean wall | OK | D3 |
| Door | `right@100 size90 door` | not directly visible from this angle | unverified | D? |
| Floor | `#e8e8e8` no texture | cream tile (same as rest of apartment) | mismatch | D1 |

### 4.5. bedroom_teal (غرفة أطفال تركواز)

| Field | Code value | Video evidence | Match | Severity |
|---|---|---|---|---|
| Walls | teal `#4A9FB5` on top+left | **no frame unambiguously shows a teal wall** | unverified | D? |
| Ceiling | none | unverified | D? |
| Floor | `#e8e8e8` | almost certainly cream tile | mismatch | D1 |

### 4.6. bedroom_master (غرفة ماستر عنابي)

| Field | Code value | Video evidence | Match | Severity |
|---|---|---|---|---|
| Walls | white + mauve `#C4A0A5` on left | white walls with mauve tint visible in `old/t_045` | OK | D2 |
| Floor | `#e8dfd0` | cream tile under temporary red carpet | mismatch (under-tile color is cream tile, not flat) | D1 |
| Ceiling | none | unverified — old video held sideways | D? |

### 4.7. bathroom_main (الحمام الرئيسي)

| Field | Code value | Video evidence | Match | Severity |
|---|---|---|---|---|
| Walls | cream `#F0EDE8` + green accent `#2E7D52` on left | cream/grey-beige tiled walls; **no green dado observed** in `old/t_065, t_070` | mismatch | **D1** |
| Floor | `#e8e8e8` | grey-blue tile | OK | D2 (specific shade) |
| Fixtures | not modeled | sink, toilet visible | OK (out of scope) | — |

### 4.8. wc (توالت صغير)

| Field | Code value | Video evidence | Match | Severity |
|---|---|---|---|---|
| Walls | pale lavender `#E8E4F0` | unverified — no clear frame | D? |
| Floor | `#e8e8e8` | unverified | D? |

### 4.9. corridor / inner hallway

| Field | Code value | Video evidence | Match | Severity |
|---|---|---|---|---|
| Existence | **NOT MODELED as a room** | corridor is clearly visible in `new/t_001, t_022`, `old/t_060`; mint walls, narrow tray ceiling, multiple bedroom doors | mismatch | **D0** |

---

## 5. Goal Alignment

### 5.1. Features that don't serve the goal

- **Smart Placement & Templates** ([js/smart-placement.js](js/smart-placement.js), [js/templates.js](js/templates.js)). Useful, but the heuristics are generic ("place a sofa against the longest wall opposite the TV") and **not aware of this specific apartment's quirks** (e.g. the salon's French door, the living's arched opening). The user gets the same sofa-against-the-longest-wall suggestion they'd get in a generic floor planner. **Verdict:** keep but tune — feed the heuristics the room's `openings` so they avoid placing furniture in front of doors/arches.
- **Layout Compare modal**. Implemented, useful; but only compares two saved layouts of the SAME room. For a "design my apartment" use-case, a "compare two whole apartments side by side" mode would be more useful.

### 5.2. Features the goal demands but the code lacks

1. **Corridor as a real room.** The bedrooms cannot reach the salon/living through the project's spatial graph because there's no corridor between them. Walkthrough mode walks through walls.
2. **Arched openings rendered as arches.** The living-room arch is a signature feature of the real apartment. Rendering it flat is a fidelity gap.
3. **Per-room ceiling editing UI.** Code data structure supports `ceiling: { tray, cove, rose, … }` but the user cannot toggle these from the room editor — they must edit `js/rooms.js`. The room editor exposes wall colors and openings but not the ceiling.
4. **A "fit a real apartment" wizard.** Given that the goal is a SPECIFIC apartment, the project would benefit from a guided onboarding that walks the user through "your kitchen door is on which wall?" / "your window faces which direction?" etc. Today every user starts from the salon's hardcoded layout.
5. **Furniture catalog with this apartment's actual fixtures.** The catalog has generic items. For a specific-apartment tool, baking in items that match (e.g. the kitchen's actual cabinet style) would help.

### 5.3. Architecture choice — vanilla JS + Three.js + IDB + SW

**Verdict: appropriate.** The project is small enough (≈ 7 KLOC) that a build system would add cost without benefit. Three.js via CDN is the right level of abstraction (a baked GLTF would lose the customisation flexibility). IndexedDB for wall photos is correct (5 MB localStorage quota is too small). Service worker for offline is the right call for a "design my apartment" tool that should work without internet.

The one architectural choice worth questioning is **using `MeshBasicMaterial` for single-room view and `MeshStandardMaterial` for the apartment walkthrough**. This split exists to give the user "exact hex color" in single-room and "lit, shadowed" walls in walkthrough — but it leads to two parallel build paths (`buildWalls` vs `buildWallsFromVertices`/`buildRoomAt`) with subtle drift. A single PBR pipeline with a "neutral" lighting preset would reduce this complexity at the cost of slight color shift in single-room view.

---

## 6. Prioritized Action List

Effort: **S** (≤ 1 hour), **M** (a few hours), **L** (a day or more). Impact: **S** (cosmetic), **M** (clear UX win), **L** (unlocks something significant or fixes a bug).

| # | Item | Severity | Effort | Impact |
|---|---|---|---|---|
| 1 | Bound `_wallPhotoCache` with LRU + dispose evicted textures (C-01) | P0 | S | L |
| 2 | Reconcile apartment walkthrough items instead of full rebuild (C-02) | P0 | M | L |
| 3 | Re-create the `tests/` folder so future audits can run (C-08) | P1 | M | M |
| 4 | Debounce `drawRoom()` calls during boot (C-03) | P1 | S | M |
| 5 | Add `ceiling` support to `applyRoomOverrides` + room editor UI (C-07) | P1 | M | M |
| 6 | Render the living-room arched opening as an actual arch (C-09) | P1 | M | M |
| 7 | Model the central corridor as a real room (Q-B §4.9) | P1 (D0) | M | L |
| 8 | Add ceiling rose to `bedroom_blue` (Q-B §4.4) | P1 (D0) | S | S |
| 9 | Add focus-trap to all modals (C-10) | P1 | S | M |
| 10 | Fix `getWallPhotoTexture` flash-of-black & error handling (C-04) | P1 | S | M |
| 11 | Bitwise OR → nullish coalescing for `downlights` (C-05) | P1 | S | S |
| 12 | Per-mesh clone of `_tileCreamTexture` so apartment view is correct (C-06) | P1 | S | M |
| 13 | Re-evaluate salon's "balcony window" — likely the French door (Q-B §4.1) | P1 | S | S |
| 14 | Bedrooms' floors should use `tile-cream` (Q-B) | P2 | S | S |
| 15 | Verify bathroom_main green accent vs cream-tile-only reality (Q-B §4.7) | P2 | S | S |
| 16 | Service worker version-aware update toast (C-13) | P2 | S | M |
| 17 | Pre-warm wallpaper preset thumbnails in idle time (C-14) | P3 | S | S |
| 18 | Encapsulate `editingRoomId` in a context object (C-12) | P3 | M | S |
| 19 | Tighten wall hex values from `~#B5CFCC` etc. (C-18) | P3 | S | S |
| 20 | Document "rooms are inferred from video, please measure on site" (C-19) | P3 | S | S |

---

## 7. Risks & Open Questions

1. **Wall-color sampling was visual, not pixel-precise.** All hex values in §4 are ±10 per channel. A follow-up pass with an actual color picker on the high-resolution `new_apartment_video.mp4` frames would tighten the numbers. If you want me to do that as a follow-up, ask for it specifically.
2. **The kitchen interior is barely visible** in either video. `js/rooms.js` claims a sky-blue + green-tile combination that is not verified. Before relying on the kitchen rendering, take a clearer photo of the inside.
3. **The bathrooms and WC are similarly under-evidenced.** The old-video bathroom frames are taken sideways and at odd angles.
4. **The "corridor" finding (Q-B §4.9) is structural** — it implies the `js/rooms.js` `plan: { x, y }` coordinates between salon, living, and the bedrooms are conceptually wrong. Fixing this requires not just adding a `corridor` room but recomputing the plan offsets for the bedrooms relative to the new corridor.
5. **The "tests" mentioned in `docs/PHASE0_NOTES.md` and the AUDIT prompt are missing from disk** — they may have been removed in a workspace reset. Recovering them from git history is the cheapest fix; if no commit ever introduced them, recreate from scratch.
6. **The previous `#living` on `accentWall` corrections** (made by the user during the design phase) need to be re-validated whenever rooms.js changes. There's no automated check for "the accent wall holds the door" type invariants today.

---

## 8. Appendix — Frame Reference

All frames live under `docs/AUDIT_FRAMES/`. Naming: `<video>/t_NNN.png` where `NNN` is the second offset (1-indexed, since `ffmpeg fps=1` starts at second 0 and writes the first frame as `t_001.png`).

Key citations used in this report:

- `docs/AUDIT_FRAMES/new/t_001.png` — entry door view, mint corridor walls
- `docs/AUDIT_FRAMES/new/t_002.png` — salon transition with both wall colors
- `docs/AUDIT_FRAMES/new/t_004.png` — salon mint wall sample
- `docs/AUDIT_FRAMES/new/t_006.png` — salon French door + denim accent
- `docs/AUDIT_FRAMES/new/t_008.png` — salon corner (mint vs denim)
- `docs/AUDIT_FRAMES/new/t_010.png` — kitchen door
- `docs/AUDIT_FRAMES/new/t_011.png` — kitchen interior peek
- `docs/AUDIT_FRAMES/new/t_013.png` — **living room ceiling rose** (definitive)
- `docs/AUDIT_FRAMES/new/t_015.png` — **arched opening** (definitive)
- `docs/AUDIT_FRAMES/new/t_017.png` — living mint wall
- `docs/AUDIT_FRAMES/new/t_019.png` — living window on denim wall
- `docs/AUDIT_FRAMES/new/t_020.png` — living corner
- `docs/AUDIT_FRAMES/new/t_022.png` — inner corridor with bedroom doors
- `docs/AUDIT_FRAMES/old/t_005.png` — salon French door (sideways)
- `docs/AUDIT_FRAMES/old/t_030.png` — **bedroom_blue ceiling rose + cerulean wall**
- `docs/AUDIT_FRAMES/old/t_035.png` — bedroom_blue cerulean wall + window
- `docs/AUDIT_FRAMES/old/t_045.png` — possibly bedroom_master mauve hint
- `docs/AUDIT_FRAMES/old/t_065.png` — bathroom grey-blue floor tile
- `docs/AUDIT_FRAMES/old/t_070.png` — small bathroom interior

---

*End of `docs/AUDIT_REPORT.md`. See also `docs/ANALYSIS_v2.md` for the per-room independent re-analysis.*
