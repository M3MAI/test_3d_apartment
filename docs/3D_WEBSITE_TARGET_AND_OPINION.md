# Target: your apartment as a 3D website (vision and opinion)

This note captures a practical goal for the project and a recommended order of work. It complements the Arabic-focused developer overview in [`PROJECT_PLAN.md`](PROJECT_PLAN.md).

## Goal

Build a **3D website** that represents **your real apartment** (or a close digital twin), with as much useful interaction as you are willing to implement: navigate the space, place furniture, save layouts, export visuals, and refine look and accuracy over time.

## Two levels of “my apartment”

| Level | What it needs | Feels like |
| --- | --- | --- |
| **Digital twin** | Measured walls, doors, windows, heights; optional textures from photos | Familiar and spatially convincing |
| **Stylized model** | Approximate layout and proportions | Nice demo, less “this is my home” |

Both are valid. Accuracy is what turns a generic planner into *your* apartment.

## Stack opinion (languages and runtime)

For an **interactive 3D site** in the browser, **HTML/CSS/JavaScript plus Three.js** (as in this repo) is an appropriate and common choice. You do not need a different front-end language to reach the goal; the hard parts are **layout data, UX, and performance**, not “JS vs Python” for the page itself.

**Optional later upgrade:** when the codebase becomes painful to change safely, add **TypeScript** and a small bundler (for example **Vite**) for types, imports, and stable dependency versions. That is an evolution, not a prerequisite.

## Phased functionality (recommended order)

Work in layers so each phase feels “done” before the next.

1. **Single floor, truthful footprint**  
   Correct-ish room polygons, wall thickness, door and window openings. Use measurements, or DXF import (see [`AUTOCAD.md`](AUTOCAD.md) and `js/dxf-import.js`), or edit room data in `js/rooms.js` / shape tools as documented in `PROJECT_PLAN.md`.

2. **Stable 3D navigation**  
   Reliable camera in plan, 3D, and walk-style modes (`js/three-view.js`).

3. **Furniture and layout state**  
   Drag, rotate, snap, undo/redo, persistence (`js/app.js`, `js/furniture.js`).

4. **Save and share**  
   JSON export/import, URL or cloud save if you add a backend later.

5. **Look and atmosphere**  
   Wall and floor materials, lighting, time-of-day; optional photos as textures.

6. **Advanced (only if you still want more)**  
   Examples: multi-floor stacking, WebXR preview, 360° panoramas, deeper CAD/BIM pipelines. Each adds significant complexity.

## Opinion on scope

Trying to implement “everything” at once usually delays the moment the project feels real. Prefer **one floor with believable geometry** over scattered half-finished features. Simple geometry that matches your tape measure often beats flashy rendering with wrong proportions.

## Related files in this repo

- [`PROJECT_PLAN.md`](PROJECT_PLAN.md) — structure and main modules  
- [`ANALYSIS.md`](ANALYSIS.md) / [`ANALYSIS_v2.md`](ANALYSIS_v2.md) — reference from the source video  
- [`IMPROVEMENT_PLAN.md`](IMPROVEMENT_PLAN.md) — prior improvement ideas  

---

*Last updated: conversation-derived project note.*
