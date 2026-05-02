# ANALYSIS v2 — Independent Re-Analysis of Reference Videos

> Per AUDIT_PROMPT.md §3 Phase 1. Re-derived from frames extracted in this audit run; NOT a copy of `docs/ANALYSIS.md`. All claims cite a specific PNG file under `docs/AUDIT_FRAMES/`.
>
> Color samples: rough RGB averages from a single inspection of well-lit regions, taken visually (no automated sampler). Confidence flag reflects how clearly the surface was lit and free of glare/shadow when sampled. Treat all values as ±10 per channel.

---

## 0. Video Metadata (from `ffprobe`)

| Field | `apartment_video.mp4` | `new_apartment_video.mp4` |
|---|---|---|
| Resolution | 848×480 (landscape) | 1920×1080 with `rotation=-90` (portrait, displays 1080×1920) |
| Duration | 72.033 s | 21.517 s |
| Frame rate | 30 fps | ~28.16 fps avg (355/12 r_frame_rate) |
| Codec / profile | H.264 Baseline | H.264 High |
| Bit rate | ~1.22 Mbps | ~16.82 Mbps |
| Recorded by | unknown | Android 15 device, 2026-04-29 18:51 UTC |
| File size | 11.6 MB | 46 MB |

**Authoritative video** (per AUDIT_PROMPT.md §5 rule 9): `new_apartment_video.mp4` — newer, much higher quality, recently shot.

`apartment_video.mp4` is held sideways for most of its duration, producing tilted/rotated frames (this is the camera operator filming in portrait while holding the phone in landscape, or vice versa). Treat its color samples and shape inference with lower confidence.

Per-second frame timeline: 72 frames in `docs/AUDIT_FRAMES/old/t_001.png` … `t_072.png`; 22 frames in `docs/AUDIT_FRAMES/new/t_001.png` … `t_022.png`.

---

## 1. New Video — Per-Second Annotation Table

User-supplied annotation cross-referenced with the actual frames.

| t | Frame | Scene | Notes |
|---|---|---|---|
| 0–1 | `t_001.png` | Entry door / foyer | Looking in from outside; dark wood entry door with metal grilles; mint corridor walls; visible inset tray ceiling with ~5 downlights; cream tile floor extending deep |
| 2 | `t_002.png` | Foyer → salon transition | Both wall colors visible simultaneously — denim blue at LEFT, mint at RIGHT; tray ceiling visible; doorway in centre leads deeper; cream tile |
| 3–5 | `t_003`–`t_005` | Salon (mint walls) | Wide mint wall with cornice, downlights along inset border; nothing on walls except junction box and switchplate |
| 6 | `t_006.png` | Salon — French door | Denim accent wall at LEFT bears a wide white triple-panel French door with horizontal louvered/shuttered glass; warm cove LED clearly glowing; tray ceiling with 3 visible downlights; cream tile floor |
| 7–8 | `t_007`–`t_008` | Salon corner | Junction of denim accent wall and mint wall; cove LED + downlights continue over both |
| 9 | `t_009` | Pan back toward entry | Brief transition |
| 10 | `t_010.png` | Kitchen door | Mint wall with two downlights; dark wood door swung inward revealing kitchen interior; switchplate on near wall |
| 11 | `t_011.png` | Kitchen glance through doorway | Dark cabinets, a small white-framed window above what appears to be a counter, possibly stovetop; floor still cream tile but slightly different shade in shadow |
| 12 | `t_012` | Pan back to corridor / approaching living | |
| 13 | `t_013.png` | **Living room — distinguishing shot** | Large central plaster **ceiling rose** clearly visible; tray ceiling + warm cove LED + ~5 downlights along perimeter; white-framed double window with horizontal louvers on a denim wall; cream tile floor |
| 14 | `t_014` | Living room continued | |
| 15 | `t_015.png` | **Arched opening** | Curved (segmental-arch) opening in a denim wall, white painted frame ~12-15 cm wide; leads into a darker corridor with cream tile continuing |
| 16–17 | `t_016`–`t_017.png` | Living mint wall | Long mint wall with cornice and downlights; small marble-veining visible in tile floor at bottom |
| 18 | `t_018` | Living back wall | |
| 19 | `t_019.png` | Living window | Wide centred white-framed double window with horizontal blinds on a denim wall, ceiling rose at top of frame |
| 20 | `t_020.png` | Living corner | Denim wall meeting mint wall; tray ceiling continues across both |
| 21–22 | `t_021`–`t_022.png` | Toward inner corridor / bedrooms | Inner corridor with mint walls, multiple dark wood bedroom doors visible on the right; cream tile floor continues |

---

## 2. Old Video — Coverage Map

The old video is much longer (72 s) and visits more rooms but is held at unusable angles for several segments. High-value frames identified:

| t | Frame | Likely room | Confidence |
|---|---|---|---|
| 5 | `t_005.png` | Salon — French door (sideways view) | high |
| 10 | `t_010.png` | Bathroom or kitchen — cream tiles with toilet visible | medium |
| 25 | `t_025.png` | Bedroom door (corridor side) | medium |
| 30 | `t_030.png` | **Bedroom (likely `bedroom_blue`)** — saturated cerulean accent wall + plaster ceiling rose | high |
| 35 | `t_035.png` | Bedroom (cerulean accent again) — pipe stub in baseboard | high |
| 40 | `t_040.png` | Empty room — possibly `bedroom_master` or `bedroom_teal` (white walls, dark wood door frame) | low |
| 45 | `t_045.png` | Empty room — pinkish tint on right wall (likely `bedroom_master` mauve) | medium |
| 50 | `t_050.png` | Bedroom with **deep red carpet covering** + window | medium (red is temporary covering, not a design choice) |
| 55 | `t_055.png` | Same red-carpet bedroom from another angle | medium |
| 60 | `t_060.png` | Inner corridor with bedroom doors | high |
| 65 | `t_065.png` | Bathroom — grey-blue tile floor + toilet base | high |
| 70 | `t_070.png` | Small bathroom — cream/grey wall tiles, sink, toilet, small window | high |

---

## 3. Per-Room Independent Re-Analysis

> For each room, this section reports what the videos actually show, NOT what `js/rooms.js` claims. The two are reconciled in `docs/AUDIT_REPORT.md` §4 (Q-B fidelity matrix).

### 3.1. Salon (الصالون)

**Frames:** `new/t_001`, `new/t_002`, `new/t_003`–`t_008`, `old/t_005`.

- **Footprint:** Rectangular as far as visible; no column/protrusion. Camera dwell time at t_003–t_008 strongly suggests width ≈ depth (i.e. roughly square or 5×4 aspect). No reliable dimension can be back-derived without a calibration object; using the door height-≈210 cm rule on `t_006.png`, the French door appears to be ~180–210 cm wide — consistent with code's 180 cm. **Width estimate: 450–500 cm; depth estimate: 350–400 cm.** Confidence: medium.
- **Walls (4 walls assumed):**
  - One denim/blue accent wall holding the French door (= the wall the camera faces in `t_006`). Sampled hex ≈ **`#6F90B0`** (medium confidence; matches code's `#6892B0` within tolerance).
  - Three pale mint/celadon walls. Sampled hex ≈ **`#B5CFCC`** (medium confidence; close to code's `#BFD6D8`, possibly slightly cooler / less saturated).
- **Ceiling:** Tray (drop) ceiling around the perimeter; **warm amber cove LED** glowing along the inner rim of the drop (visible as a continuous gold band in `t_006`); flat white centre panel; ~5–6 recessed downlights aligned along the inside of the cove on the long sides — code's `downlights: 8` is plausible but possibly slightly over-counted.
- **Crown molding / cornice:** Visible thin white cornice at the wall–ceiling junction in `t_004`; subtle, not ornate.
- **Openings:**
  - **French door** (entry to balcony or to apartment exterior — likely a balcony given the "شباك البلكونة" naming convention): wide, three-panel, white frame, **horizontal slatted glass louvers** in upper and lower halves, brass handle in the middle pair. Position: centred on the denim wall. Estimated width 180–220 cm (high confidence).
  - **Opening to living room:** Not directly visible in any new-video salon frame; the camera transitions from salon area at `t_008` to kitchen-door pan at `t_010`, suggesting the salon has an opening on its long side leading toward the centre of the apartment (where the kitchen door also is). Code's `bottom@50 size200` is plausible but **unverified from video alone**.
  - **Balcony window (separate from French door)?** I see only ONE wide opening on the denim wall (the French door). Code lists a separate `left@150 size180 window "شباك البلكونة"` — **no evidence in new video** of a second window on a different (left) wall of the salon. **Possible code-only artifact** (the balcony "window" may simply be the French door's glass panels, not a separate opening).
- **Floor:** Large-format (~30×30 cm or 60×60 cm) **cream/beige tile with light marble-style veining**. Code's procedural `tile-cream` is a reasonable abstraction but does not show veining.
- **Furniture:** None — the apartment is unfurnished in both videos.

### 3.2. Living room (الصالة المعيشة)

**Frames:** `new/t_013.png` (definitive), `new/t_017`, `new/t_019`, `new/t_020`.

- **Footprint:** Rectangular as far as visible; no column/protrusion. Width clearly larger than depth (camera shows long mint wall opposite a shorter denim wall with the central window). Estimate from window-frame proportion: **width ~450–500 cm, depth ~300–360 cm**. Confidence: medium.
- **Walls:**
  - Two denim walls: hex ≈ **`#6F92B0`** (matches salon's denim — almost certainly the same paint).
  - Two mint walls: hex ≈ **`#B0CCC8`** (slightly cooler than salon's mint by visual eye, but probably the same paint with different lighting).
  - The window-bearing wall (= left in code) is denim. The arched-opening wall (= right in code) is also denim.
- **Ceiling:** **Plaster ceiling rose / medallion** in the centre — large concentric rosette pattern, ornate (`t_013`). Tray ceiling + warm amber cove LED + recessed downlights identical to salon. Code's `rose: true` ✓.
- **Openings:**
  - **Centred window** on a denim wall: white frame, horizontal louvered glass (two-panel double-window). Estimated width ~120–140 cm; height ~180–210 cm. Position centred on the long denim wall. ✓ matches code's `left@120 size130 window "شباك"` reasonably.
  - **Arched opening** to corridor on a denim wall (`t_015`): segmental arch, white painted frame ~12–15 cm wide, leading into the central corridor where the bedrooms are. Estimated width ~100–120 cm. ✓ matches code's `right@80 size110 door "فتحة مقوّسة على الممر"` — **but the code models it as a flat door opening; the actual shape is an ARCH and the 3D code does not render arches.**
  - **Opening to salon** on a mint wall (the bottom wall in code): not directly captured in any single new-video frame, but the spatial continuity (camera transitions seamlessly between salon and living) implies a wide opening. Code's `top@50 size200` is plausible.
- **Floor:** Same cream tile as salon. Continuity is intentional — the salon and living share a single tiled surface.
- **Furniture:** None.

### 3.3. Kitchen (المطبخ)

**Frames:** `new/t_010.png` (door), `new/t_011.png` (peek inside), `old/t_010.png` (questionable — may be bathroom).

- **Footprint:** Not directly observable. The peek through the door at `t_011` shows a depth of perhaps 200–300 cm before the back wall (with a small high window). Estimate **width 250–350 cm, depth 200–300 cm**. Confidence: low.
- **Walls:** Inside the kitchen the walls appear darker / muted, possibly a **mid-toned blue-grey** but obscured by shadow and by the dark cabinetry. Cannot reliably sample — the only surface visible at `t_011` is partly painted, partly tiled. Code's `wallColor: "#A8C4DE"` (sky blue) and green dado accent are **plausible but unverified** from current frames.
- **Cabinets / fixtures:** Dark wooden upper cabinets visible at `t_011`. Stovetop or sink suspected at the back. White-framed window high on back wall. Confidence low.
- **Ceiling:** Flat (no visible tray) — code's lack of `ceiling` config is consistent.
- **Openings:** Single door (the one we look through), opening **inward** with dark wood door panel; likely facing the corridor across from the salon door per the user's stated correction.
- **Floor:** Continues cream tile, possibly slightly different shade.

### 3.4. Bedroom — blue (`bedroom_blue` / غرفة نوم زرقاء)

**Frames:** `old/t_030.png` (best — saturated cerulean accent wall), `old/t_035.png` (window with shutters on the cerulean wall + plaster ceiling rose visible).

- **Footprint:** Rectangular as far as observable.
- **Walls:**
  - Three white/off-white walls (~`#F5F4F1`).
  - One **deep cerulean blue accent wall** (~`#1F6FA2`) holding a white-framed window with horizontal louvered shutters. The blue is **noticeably more saturated** than the salon/living denim — clearly a different paint.
- **Ceiling:** **Plaster ceiling rose / medallion** visible (`t_030`, `t_035`) — concentric rosette pattern similar to the living room's rose but smaller. **Code currently has NO ceiling config for this room — this is a documented mismatch.**
- **Openings:** Window on the accent wall; door on an adjacent wall (matches code's `right@100 size90 door · top@150 size130 window`).
- **Floor:** Cream tile (matches the rest of the apartment). Code says `floorColor: "#e8e8e8"` and no `floorTexture` — **the actual floor is cream tile, not plain `#e8e8e8`.**

### 3.5. Bedroom — teal (`bedroom_teal` / غرفة أطفال تركواز)

**Frames:** No frame in either video unambiguously matches a teal/turquoise accent wall. Possibilities: `old/t_040.png` (empty white-walled room — could be the teal room with the accent wall outside the frame), `old/t_045.png`.

- **Confidence: LOW.** Code claims `wallColor: '#4A9FB5'` (teal) on top+left walls. The video does not provide direct evidence either way.

### 3.6. Bedroom — master (`bedroom_master` / غرفة ماستر عنابي)

**Frames:** `old/t_045.png` (white walls with pinkish tint on right edge); possibly `old/t_050.png` and `old/t_055.png` (white walls with deep red carpet).

- **Walls:** Mostly white. There's a pink/mauve tint visible at the right edge of `t_045.png` that is consistent with code's `accentColor: "#C4A0A5"` on the left wall. Confidence: medium.
- **Floor:** **Almost certainly cream tile** under what appears to be a temporary deep-red carpet (`old/t_050`, `t_055`). The carpet is likely a celebration/wedding floor cover, not a design choice. Code's `floorColor: "#e8dfd0"` is plausible for the underlying tile.

### 3.7. Bathroom — main (`bathroom_main` / الحمام الرئيسي)

**Frames:** `old/t_065.png`, `old/t_070.png`.

- **Walls:** **Cream/beige tiled walls** (full-tile, no painted areas visible). The grey-green dado accent claimed in code (`accentColor: "#2E7D52"`) is **NOT observed** in any frame. The walls appear uniformly cream/grey-beige. **Possible mismatch.**
- **Floor:** Grey-blue tile (`old/t_065`) — distinct from the apartment's cream tile, suggesting the bathroom does have a different floor finish. Code's `floorColor: "#e8e8e8"` (light grey) is consistent.
- **Fixtures:** Sink on the right, toilet adjacent. Standard bathroom fixtures.
- **Window:** Small high window with louvered shutters visible at `t_070`.

### 3.8. WC (`wc` / توالت صغير)

**Frames:** Not separately identifiable. May be conflated with bathroom_main in old/t_010 or old/t_070.

- **Confidence: LOW.** Code's pale-lavender wall (`#E8E4F0`) is unverified.

### 3.9. Corridor / inner hallway

**Frames:** `new/t_001.png` (looking in from entry), `new/t_022.png` (passing bedroom doors), `old/t_060.png`.

- **Walls:** Mint/celadon, matching the salon's mint walls.
- **Ceiling:** A **separate, narrower tray-ceiling channel** runs along the corridor — not the same big inset as the salon/living. Code does not model the corridor as a separate room.
- **Openings:** Multiple bedroom doors on the long side (visible at `new/t_022` and `old/t_060`).
- **Code mismatch:** The apartment shell does not include the corridor as a room. Bedrooms are placed at coordinates that imply they share boundaries with the salon/living, but in reality there is a corridor between them. **The 3D model is geometrically incomplete in this respect.** This is a structural fidelity issue rather than a paint/finish issue.

---

## 4. Architectural Common Threads

Items that are CONSISTENT across the entire apartment per the videos:

1. **Floor:** Cream/beige large-format tile with light marble-veining — used in salon, living, corridor, all bedrooms (under any temporary covering), and the kitchen entry. Bathrooms switch to grey/blue tile.
2. **Cornice / crown molding:** Thin white cornice present in salon, living, corridor, and at least bedroom_blue. Not visible / not present in bathrooms.
3. **Tray ceiling system:** Salon and living have the most elaborate version (deep tray + cove LED + downlights + ceiling rose in living). Corridor has a simpler tray channel. Bedrooms are flat with just a ceiling rose in the case of bedroom_blue. Bathrooms are flat.
4. **Wall colors:** Two paints dominate the public spaces: pale mint (`~#B5CFCC`) and denim blue (`~#6F90B0`). Bedrooms break this scheme with their own accent colors (cerulean, teal, mauve). Bathrooms are cream-tiled.
5. **Door style:** Dark wood for interior doors (bedrooms, kitchen, bathrooms); WHITE painted with horizontal louvered glass for the French door and windows.
6. **Lighting:** Recessed white downlights everywhere there is a tray ceiling. Warm cove LED only in salon and living.
7. **Apartment is unfurnished** — both videos. Walls are bare except for switchplates, junction boxes, a few exposed pipe stubs.

---

## 5. Summary of Discrepancies vs. `js/rooms.js`

(Full matrix in `docs/AUDIT_REPORT.md` §4. This is just the headline list.)

| # | Room | Field | Discrepancy | Severity |
|---|---|---|---|---|
| 1 | salon | left wall window | Code lists a separate "balcony window" but the video shows only one opening (the French door) on the relevant wall | D1 (likely off but possible) |
| 2 | living | right wall opening | Real opening is **arched** but code marks it as a flat door (the 3D renderer cannot draw arches) | D1 |
| 3 | bedroom_blue | ceiling | Code has no `ceiling` config but video shows a plaster ceiling rose | D0 (clearly missing) |
| 4 | bedroom_blue | floor | Code says `floorColor: "#e8e8e8"` no texture, but actual floor is the same cream tile as the rest of the apartment | D1 |
| 5 | bedroom_master, bedroom_teal | floor | Same as #4 | D1 |
| 6 | bathroom_main | accentColor green | Not observed in any video frame; cream tile only | D1 (need re-confirmation) |
| 7 | corridor | not modeled | The central corridor connecting bedrooms is not a room in the project — bedrooms share boundaries directly with salon/living | D0 (structural omission) |
| 8 | salon, living | floor texture | Real floor is cream marble-veined tile; code's `tile-cream` is solid cream with grout lines but no veining | D2 (cosmetic) |
| 9 | salon, living | wall color hex | Code values are within ~10–15 RGB units of sampled values — perceptually almost identical, technically slightly off | D2 |
| 10 | living | window position | Code says `left@120` (120 cm from corner). Visually the window appears centred (~ wall_length/2 − 65 cm). For a 500 cm wall, centred = 185 cm offset. Possible drift | D1 |

---

*End of `docs/ANALYSIS_v2.md`.*
