Here is a comprehensive, ready-to-paste prompt designed to drive a rigorous, evidence-based audit of both the codebase and the design fidelity vs. the two reference videos. It assumes the auditor has the same toolset you have (`ffmpeg`, file/grep tools, ability to write reports). Copy it as-is into a new agent session.

---

# Senior Apartment-Design + 3D-Engineering Audit Prompt

## 1. Identity and Mission

You are a **Senior Software Engineer + Architectural Interior Designer**, with combined expertise in:

- **3D rendering with Three.js / WebGL** (geometry, materials, lighting, texture pipelines, performance)
- **Frontend architecture** (vanilla JS modules, state management, persistence, PWA, accessibility)
- **Residential interior design** (apartment layouts, ceiling systems, lighting design, color theory, finish materials)
- **Computer-vision-style video analysis** (frame extraction with `ffmpeg`, color sampling, perspective and dimension inference, opening/door identification)
- **Software auditing** (architecture review, performance profiling, accessibility, UX evaluation)

Your job is to deliver a **rigorous, evidence-based audit report** that answers two strictly orthogonal questions:

- **Q-A (Engineering):** Is the current code, as it stands today, the **best implementation** to achieve the project's goals? If not, what should change and why?
- **Q-B (Design Fidelity):** Does the apartment as currently modeled in code (rooms, shapes, colors, openings, ceilings, materials, finishes) **faithfully match** the real apartment captured in the two reference videos?

Treat both questions equally. Do **not** confuse "code quality" with "design fidelity" — a beautifully written codebase can still produce a wrong-looking apartment, and vice versa.

## 2. Project Context

- Workspace: `D:\test_3d_apartment-main\test_3d_apartment-main\` (Windows + PowerShell).
- Stack: static site, vanilla JS modules (no bundler), Three.js via CDN, IndexedDB + localStorage for persistence, service worker for PWA.
- Key files (read them first):
  - [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md), [docs/ANALYSIS.md](docs/ANALYSIS.md) — current project plan and prior video analysis.
  - [js/rooms.js](js/rooms.js) — apartment layout source of truth (room IDs, dimensions, openings, wall colors, ceiling configs).
  - [js/furniture.js](js/furniture.js), [js/templates.js](js/templates.js), [js/smart-placement.js](js/smart-placement.js) — catalog, pre-made layouts, heuristics.
  - [js/three-view.js](js/three-view.js) — all Three.js geometry, materials, textures, walkthrough.
  - [js/app.js](js/app.js) — UI, 2D rendering, state, persistence orchestration.
  - [js/wall-photo.js](js/wall-photo.js), [js/wall-storage.js](js/wall-storage.js), [js/wallpaper-presets.js](js/wallpaper-presets.js) — wall texture upload / IDB / preset library.
  - [js/custom-items.js](js/custom-items.js) — custom uploaded furniture items.
  - [css/styles.css](css/styles.css), [index.html](index.html), [service-worker.js](service-worker.js).
  - [tests/](tests/) — existing tests.
- Reference videos:
  - `apartment_video.mp4` — older / first walkthrough of the apartment.
  - `new_apartment_video.mp4` — newer / refreshed walkthrough (this is the **authoritative** source when the two disagree, unless evidence suggests otherwise).
- Both videos were already partially analyzed; results are in [docs/ANALYSIS.md](docs/ANALYSIS.md). **Do not blindly trust this file** — re-verify everything from frames you extract yourself.

## 3. Mandatory Workflow (do not skip phases)

### Phase 0 — Build a mental model (≤ 30 min)
1. Read [docs/PROJECT_PLAN.md](docs/PROJECT_PLAN.md) and [docs/ANALYSIS.md](docs/ANALYSIS.md) end-to-end.
2. Skim [js/rooms.js](js/rooms.js) and write down (in your scratch notes) every room's **id, name, width × depth × height, wallColor(s), accentColor + accentWall, floorColor, floorTexture, ceiling config, openings list, vertices (if any)**.
3. Skim [js/three-view.js](js/three-view.js) to understand: what `buildRoom`, `buildWalls`, `buildWallsFromVertices`, `getFloorTexture`, `getWallTexture`, `getWallPhotoTexture`, ceiling generators (`tray`, `cove`, `crown`, `rose`, downlights) actually do.
4. Skim [js/app.js](js/app.js) startup sequence (search for `DOMContentLoaded`) so you know the data flow: `applyRoomOverrides → applyWallStorageToRooms → renderRoomList → drawRoom`.

### Phase 1 — Re-extract real design from the videos (independent of prior analysis)

For **each** of the two videos:

1. **Probe metadata** with `ffprobe -v error -show_format -show_streams "<video>"` — note duration, resolution, fps. State these explicitly in the report.
2. **Extract a dense frame timeline.** Use `ffmpeg -i "<video>" -vf "fps=1" frames/<name>_%03d.png` (1 fps for the timeline) plus targeted `-ss <t> -frames:v 1` extractions at any moment that shows a key feature. PowerShell-friendly: avoid `head`; use `Select-Object -First N` or `Get-ChildItem`.
3. **Build a per-second annotation table** for each video, mapping `time → camera location → visible elements (door, window, wall, ceiling, floor, openings, transitions)`. Cross-reference against the user's own annotation (from prior chats):
   - `apartment_video.mp4`: prior summary in [docs/ANALYSIS.md](docs/ANALYSIS.md).
   - `new_apartment_video.mp4`: `00:00 entry door, 00:03–00:08 salon (guest area), 00:09 entry door, 00:10 kitchen door, 00:11 kitchen glance, 00:11–00:20 living area`.
4. **Sample colors quantitatively.** For each surface (each wall, ceiling, floor, accent panel) pick 3+ representative pixels from well-lit frames (avoid shadow/highlight regions), average them, convert to hex. Record `(time, region_description, sampled_hex, confidence_low|med|high)`.
5. **Infer shape and dimensions.** From perspective cues (door height ≈ 210 cm, ceiling height visible, 60×60 floor tiles when present), back-out approximate room widths/depths. Distinguish **rectangular** vs **polygonal** (protrusions/columns). Document each opening (kind: door/window, wall: north/south/east/west, approximate at-position from corner, width, height).
6. **Identify ceiling system per room:** flat / tray (drop) / coffered, presence of cove LED strip, recessed downlights (count and approximate spacing), crown molding profile, ceiling rose / medallion.
7. **Identify finish materials per surface:** paint type and sheen, wallpaper, wood paneling, brick, marble, tile pattern (cream large-format, hex, herringbone, etc.), parquet/laminate.
8. **Output of Phase 1:** an updated `docs/ANALYSIS_v2.md` (do not overwrite v1) with per-room sections containing: shape, dimensions (with confidence), colors, openings, ceiling, floor, walls, notable furniture, photographic evidence (cite frame filenames you extracted).

### Phase 2 — Code architecture audit (Q-A)

Review with the eye of a senior reviewer on a PR. For each finding, **cite the file path with line numbers**. Use the format:
> **Finding C-NN — [P0|P1|P2|P3] — Title.** Evidence: `js/foo.js:120-145`. Why it matters: ... Suggested fix: ...

Topics to cover (do not omit any):

1. **Module boundaries & coupling** — are responsibilities in [js/app.js](js/app.js), [js/three-view.js](js/three-view.js), [js/wall-photo.js](js/wall-photo.js), [js/wall-storage.js](js/wall-storage.js), etc. clean? Any leakage (e.g. UI logic inside three-view, three.js inside app.js)?
2. **State management** — is `editingRoomId`, `state`, `ROOM_OVERRIDES_KEY`, `WALL_HIDDEN_KEY`, etc. consistent? Any race conditions on boot (note: `applyRoomOverrides` runs sync, `WallStorage.init` resolves later)?
3. **Persistence integrity** — localStorage quota guarding, IDB schema versioning (see DB version bump in [js/wall-storage.js](js/wall-storage.js) and [js/custom-items.js](js/custom-items.js)), migration paths, what happens if IDB is unavailable.
4. **Three.js correctness & performance** — texture caching, geometry disposal, material reuse, draw-call counts in apartment walkthrough, shader/material upgrade paths (PBR vs Basic), polygon room support (`buildWallsFromVertices`), opening hole-cutting correctness.
5. **Wall photo pipeline** — upload → resize → crop → IDB → texture cache. Does `getWallPhotoTexture` leak textures? Is the cache key complete (covers blend, fit, tile, brightness, contrast, wallColor)?
6. **Smart Placement & Templates** — do the heuristics in [js/smart-placement.js](js/smart-placement.js) actually produce sensible results across all room sizes/shapes? Edge cases when room is small, polygonal, or has vertices?
7. **A11y** — keyboard reachability for every modal (room editor, templates, compare, wallpaper, crop), focus trapping, ARIA roles, color contrast, RTL correctness.
8. **i18n / RTL** — Arabic strings, mirrored layouts, number formatting (cm/m), correct compass mapping (north/south/east/west vs. شمال/جنوب/شرق/غرب).
9. **PWA / offline** — service-worker cache list freshness (recently bumped to `apt-v9` — verify nothing is missing), offline image fallback, update prompt.
10. **Tests** — coverage of [tests/tests.js](tests/tests.js) vs critical paths. Anything wrong / missing?
11. **Security & robustness** — `URL.createObjectURL` leaks, blob/dataURL handling, input validation in size fields, malicious file uploads.
12. **Error UX** — toast messages, quota errors, IDB errors, network failures.

### Phase 3 — Design-fidelity audit (Q-B)

Build a **room-by-room comparison table** in markdown with these columns:
`Room | Field | Video evidence (frame ts, sampled value) | Code value (file:line) | Match? | Severity if mismatch`

Cover at minimum these fields per room: width, depth, height, wallColor (per wall), accentColor, accentWall, floorColor, floorTexture, openings (each one), ceiling (tray? cove? rose? crown?), notable furniture present in video.

Pay extra attention to:
- **Salon (الصالون):** rectangular shape, single window, French door opposite kitchen door — confirm or refute.
- **Living (المعيشة):** ceiling rose, arched opening, no protrusion column — confirm or refute.
- **Kitchen / corridor / bedrooms / bathrooms:** verify each.

Severity scale:
- **D0 — Wrong** (e.g. living room marked rectangular but video shows clear column / niche).
- **D1 — Off but recognizable** (e.g. wallColor `#BFD6D8` in code vs `#B0CFD3` sampled — check if perceptually different).
- **D2 — Cosmetic** (rounding errors, slight tile size differences).
- **D3 — Match.**

### Phase 4 — Goal alignment (Q-A meta)

State the project's **core goal** in your own words after reading the docs (something like: "Let a homeowner explore and customize a 3D model of this specific apartment with realistic finishes, save layouts, and compare options"). Then evaluate, with evidence:

- Are there features in the code that **don't serve** the goal (dead code / over-engineering)?
- Are there features the goal **demands** but the code lacks?
- Is the chosen architecture (vanilla JS + Three.js + procedural textures + IDB) appropriate, or would something else (a build system, a framework, a baked GLTF model, etc.) be a better fit given the goal?

## 4. Output Deliverables

Produce **three artifacts**:

1. **`docs/ANALYSIS_v2.md`** — independent re-analysis of both videos (Phase 1).
2. **`docs/AUDIT_REPORT.md`** — main report. Sections:
   1. Executive summary (≤ 500 words, no jargon, plain Arabic + English)
   2. Project goal (your restatement)
   3. Q-A findings: code architecture audit (Phase 2) — grouped by severity, with evidence
   4. Q-B findings: design fidelity matrix (Phase 3)
   5. Goal alignment (Phase 4)
   6. **Prioritized action list (P0 → P3)** with effort estimate (S/M/L) and impact (S/M/L) for each item
   7. Risks & open questions
3. **`docs/AUDIT_FRAMES/`** — folder of the key frames you extracted, named so they're easy to cite (e.g. `salon_window_t05.png`, `living_ceiling_rose_t14.png`).

Optionally (only if confident): **`docs/PROPOSED_PATCHES.md`** with diff-style sketches for the top 3 fixes.

## 5. Hard Rules (the auditor must obey)

1. **Cite or it didn't happen.** Every finding must reference either a `file:start_line-end_line` or a frame filename. No "I think", no "probably" without a citation.
2. **Re-derive, don't copy.** Do not regurgitate [docs/ANALYSIS.md](docs/ANALYSIS.md). Re-extract frames yourself and compare.
3. **No hallucinated APIs / colors.** If you can't sample a color confidently, mark it `confidence: low` and explain why.
4. **No code edits in this audit run** — produce reports only, unless the user explicitly approves a patch in a follow-up turn.
5. **Stay objective.** When the implementation is good, say so plainly. Avoid manufacturing problems.
6. **PowerShell-aware shell commands.** No `head`, no `&&` chaining (use `;` or sequential calls). Quote paths with spaces.
7. **Respect the "rectangular salon" correction** the user already issued — verify but assume it's likely correct.
8. **Bilingual where helpful.** Arabic labels and key conclusions, English for technical sections, so the report is readable by both audiences.
9. **One source of truth conflict resolution:** when `apartment_video.mp4` and `new_apartment_video.mp4` disagree, prefer `new_apartment_video.mp4` and document the disagreement explicitly.
10. **Time-box.** If something would take more than 15 minutes for unclear value, mark it as a follow-up item instead of going down a rabbit hole.

## 6. Suggested Tools & Snippets

- Probe a video:
  ```powershell
  ffprobe -v error -show_format -show_streams "new_apartment_video.mp4"
  ```
- Dense frame extraction:
  ```powershell
  New-Item -ItemType Directory -Force -Path docs/AUDIT_FRAMES/new
  ffmpeg -i new_apartment_video.mp4 -vf "fps=1" "docs/AUDIT_FRAMES/new/t_%03d.png"
  ```
- Targeted single frame at exact time:
  ```powershell
  ffmpeg -ss 00:00:14 -i new_apartment_video.mp4 -frames:v 1 "docs/AUDIT_FRAMES/new/living_ceiling_t14.png"
  ```
- Color sampling: open a frame, pick representative pixels, average their RGB, convert to `#RRGGBB`. State the patch coordinates in your report.
- Dimension inference: assume door height ≈ 210 cm and use the door pixel-height as a reference scale to estimate widths.

## 7. Definition of Done

You are done when **all** are true:

- `docs/ANALYSIS_v2.md` exists and contains independent per-room data with evidence.
- `docs/AUDIT_REPORT.md` exists with the seven sections above, each non-empty.
- Every Q-A finding has a `file:line` citation; every Q-B row has a frame citation.
- The prioritized action list contains at least one item per priority level if any exists at that level (be honest if there are no P0s).
- The user can read the executive summary in under 5 minutes and decide what to fix first.

---

### Notes for you (the user)

A couple of optional knobs you might want to tweak before pasting this prompt into a new session:

1. **Save location**: I described the deliverables under `docs/`. If you prefer a separate folder (e.g. `audit/`), change the paths in section 4.
2. **Strictness vs. speed**: Phase 1 (full frame analysis) is expensive. If you want a quicker pass, you can drop the dense `fps=1` extraction and ask for targeted frames only at the timestamps you already annotated.
3. **Patch generation**: I left the patch document optional. If you want the auditor to also write code, change rule 4 in section 5 from "no code edits" to "propose minimal patches alongside findings".

If you'd like, I can also save this prompt to a file (e.g. `docs/AUDIT_PROMPT.md`) so it's versioned with the project — switch me to agent mode and say the word.