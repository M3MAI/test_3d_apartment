# Test Plan — PR #5

**Preview:** https://test-3d-apartment-xovprerj.devinapps.com (commit 20edc89)

## Scope
Verify the 4 auto-fixes + 4 follow-up Devin Review fixes (walk-mode rebuild, Escape handler, PNG buffer, XSS) + 3 highest-signal new features. Short, adversarial.

---

## Fix Verifications

### F1 — Collision tint clears when items separated (`js/three-view.js:308`)
**Before:** falsy check (`!_origEmissive`) trapped black-emissive materials; second collision would overwrite the "original" with the already-red value, so red became permanent.

**Steps:**
1. Open 3D mode in any room.
2. Drag from catalog into 3D → drop one bed.
3. Drag a second item (e.g. drawer) so it overlaps the bed → both turn red.
4. Drag the drawer far away so it no longer overlaps.
5. Drag it back to overlap again, then away a second time.

**Pass:** After step 4 the bed & drawer both return to their original colors (no red emissive). After step 5 second cycle also clears to original. **Fail:** Any item stays tinted red after separation, or subsequent overlaps leave a deeper red.

### F2 — Walkthrough entry / exit preserves both contexts correctly
**Before (two separate bugs):**
- (a) `hide()` was called on walk-mode entry, destroying `aptCtx` and forcing a full scene rebuild every time.
- (b) The global Escape handler called `drawRoom()` unconditionally, which in 3D/walk modes destroyed the live Three.js scene.

**Steps:**
1. Enter 3D mode on Room A (e.g. صالون رسمي).
2. Click 🚶 جولة → click "ابدأ الجولة".
3. Press Escape. Expect to still be in walk mode (pointer lock released but scene intact — no black canvas).
4. Exit walk to 3D → back to walk → back to 3D (3 cycles total).
5. In 3D mode with a selection, press Escape.

**Pass:**
- No console errors about "Too many active WebGL contexts", "Context Lost", or three.js disposal warnings across all switches.
- In step 3: pressing Escape in walk mode does NOT blank the canvas; the apartment walkthrough scene remains visible.
- In step 5: pressing Escape in 3D mode does NOT destroy the room scene (camera stays where it was).

**Fail:** Console shows WebGL context warnings; canvas goes blank after Escape in walk/3d; camera snaps back to default after Escape.

### F2b — PNG screenshot captures real content (preserveDrawingBuffer)
**Before:** WebGL renderer created without `preserveDrawingBuffer: true`; calling `toDataURL()` after frame could return blank/partial image.

**Steps:**
1. Enter 3D mode on Room A.
2. Drag a couple of furniture items into the scene (or use seeded ones).
3. Click the 📸 (screenshot) button.
4. Open the downloaded PNG file.

**Pass:** PNG file opens and shows the rendered room with walls, floor, and at least one furniture mesh visible (NOT blank / all-black / all-white).
**Fail:** Blank white or black image, or PNG fails to download.

### F3 — Catalog shows "لا توجد نتائج" when search yields zero items
**Before:** chips container was appended unconditionally so `!container.children.length` was always false — empty-state message never shown.

**Steps:**
1. In the sidebar catalog search box, type `zzzxxxqqq` (a guaranteed non-match).

**Pass:** The catalog area displays exactly the text **"لا توجد نتائج"** under the chips row.
**Fail:** Empty space (chips still visible but no items and no message), or some stale items shown.

### F4 — Room editor fields render in 2 columns (`css/styles.css`)
**Before:** global `.fields-row` redeclaration later in the file forced 3-col grid everywhere, including the room editor where rows are designed for 2 fields.

**Steps:**
1. Click `✎ الغرفة` on any room to open the room editor modal.
2. Inspect the "الاسم / لون الجدار" row and the "العرض W / العمق D" row.

**Pass:** Each row lays out the 2 fields in two equal columns (1fr 1fr) filling the width of the modal body. The W/D inputs appear side-by-side, not squished into the left 2/3.
**Fail:** Fields hugging the left, large blank gap on the right (3-col grid bleed-through).

---

## New-Feature Primary Flows

### N1 — Apartment overview mode (🏘️) lists all rooms and enters on click
**Steps:**
1. Click `🏘️ الشقة`.
2. Observe the canvas shows multiple room rectangles with names (Reception, Salon, Master, Kitchen…).
3. Click one room rectangle (e.g. "صالون رسمي").

**Pass:** Canvas displays ≥6 named room blocks. Clicking a block switches view mode to 2D on that specific room (`#room-title` updates to the clicked room name).
**Fail:** Canvas blank, only one room shown, click does nothing.

### N2 — Share link encodes + decodes state
**Steps:**
1. In 2D on "صالون رسمي", drag a **كنبة** into the room; note its rough position.
2. Click `🔗` share. A toast should say link copied.
3. Open the copied URL in a new incognito/private tab.

**Pass:** New tab loads the same room with the کنبة present in a similar position; `#item-count` shows "1 قطعة".
**Fail:** New tab loads empty room or default state only.

### N3 — Measure tool computes distance between two points
**Steps:**
1. In 2D on any room, click `📏 قياس` button (or press `M`).
2. Click two points along the room width (approx. 0.5 m and 3.5 m along the floor).
3. Observe the pink dashed line and label.

**Pass:** A pink dashed line appears between the two clicks with a label showing a numeric distance in cm (e.g. "≈ 300 سم" — within ±10% of actual). Label is human-readable.
**Fail:** No line, no label, or label shows obviously wrong value (negative/NaN).

---

## Regression spot-check
- Drag any catalog item into 2D → it renders ✓
- `Ctrl+Z` undoes last drop ✓
- Dark theme toggle works ✓

---

## Pass criteria for the overall PR test
All 4 fixes (F1–F4) pass AND all 3 primary flows (N1–N3) pass. Any fix failure is a blocker.
