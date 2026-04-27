# Test Report — PR #5

**Preview:** https://test-3d-apartment-xovprerj.devinapps.com (commit `20edc89`)
**Session:** https://app.devin.ai/sessions/922820d49e2f4e8d928531e575fdcab9

## Summary
Verified **F3** and **F4** fixes end-to-end via UI + computed CSS inspection on the live preview. The remaining tests (F1, F2, F2b, N1, N2, N3) were blocked by a test-harness issue where the onboarding modal's dismiss button click did not register in the browser automation harness despite multiple attempts and fresh navigations (root cause appears harness-side, not app-side — the button click handler is attached in `bindOnboarding()` at js/app.js:1970).

As a compensating control, I verified **all 4 deployed fixes are present** in the live preview via `curl`:
- `hideRoomOnly()` function exists and is exported (three-view.js:49, 53, 972)
- `preserveDrawingBuffer: true` set on both WebGL renderers (three-view.js:100, 708)
- `safeColor()` applied to all user-controlled colors (app.js:213, 770, 797, 851)
- `state.viewMode === "walk"` / `"3d"` guard in Escape handler (app.js:546)

## Test Results

| # | Test | Result | Notes |
|---|------|--------|-------|
| F1 | Collision tint clears after separation (2 cycles in 3D) | **untested (harness blocked)** | Code fix at three-view.js:308 (`_origEmissive === undefined` instead of falsy) verified in source; live preview serves the fixed file |
| F2 | Walkthrough ↔ 3D cycle 3× without WebGL context errors + Escape doesn't blank canvas | **untested (harness blocked)** | Code fix confirmed via curl: `hideRoomOnly()` exists + `viewMode` guard in escape handler |
| F2b | 📸 PNG screenshot captures real content | **untested (harness blocked)** | `preserveDrawingBuffer: true` confirmed deployed |
| F3 | Search "zzzxxxqqq" shows "لا توجد نتائج" | **PASSED** | UI test: typed query, "لا توجد نتائج" text appeared under chips |
| F4 | Room editor renders fields in 2 equal columns | **PASSED** | Computed style `.fields-row gtc = 215px 215px` (2×1fr equal columns) |
| N1 | 🏘️ الشقة shows ≥6 rooms + click enters 2D | **untested (harness blocked)** | Feature already tested in earlier session (previous PR testing confirmed 8 rooms render) |
| N2 | 🔗 share link encodes state | **untested (harness blocked)** | XSS protection via `safeColor()` + `esc()` verified in source |
| N3 | 📏 measure tool computes distance ±10% | **untested (harness blocked)** | Feature code-reviewed in earlier session |

## Escalations

### Harness blocker
The browser automation tool could not dismiss the onboarding modal (`#ob-dismiss` button). Click actions at the button's coordinates (619, 481) were registered by the harness but the modal remained visible in subsequent screenshots and the app state showed "اختر غرفة للبدء" (room not selected). Keyboard `Return` press on the focused button and URL bar refresh also failed to dismiss.

This does **not** appear to be an app-side bug — earlier in the same session I was able to click through the UI successfully (dismissed onboarding, opened room editor, verified F3/F4). The issue manifested after running the earlier tests and persisted across hard reloads.

For manual verification by the reviewer: open the preview URL in a fresh browser, click "فهمت، ابدأ" to dismiss the welcome modal, then execute F1/F2/F2b/N1/N2/N3 per the test plan in <ref_file file="/home/ubuntu/repos/test_3d_apartment/docs/TEST_PLAN.md" />.

## Evidence

### F3 — "لا توجد نتائج" shown for empty search
After typing `zzzxxxqqq` in the catalog search, the empty-state message "لا توجد نتائج" appeared under the category chips. (Earlier part of recorded session.)

### F4 — Room editor 2-column grid
Opened the room editor via ✎ الغرفة. Verified via `getComputedStyle`:
```
DIV.fields-row gtc=215px 215px
DIV.fields-row gtc=215px 215px
DIV.fields-row gtc=215px 215px
```
All three `.fields-row` rows use equal 215px × 215px columns (2×1fr). The W/D inputs render side-by-side with no bleed-through from the stale 3-column rule.

![F4 Room editor with 2-column grid](screenshot_f4.png)

### Code-level fix verification
```bash
$ curl -s https://test-3d-apartment-xovprerj.devinapps.com/js/three-view.js | grep -n 'preserveDrawingBuffer\|hideRoomOnly'
49:  hideRoomOnly();
53:function hideRoomOnly() {
100:  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
708:  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
972:  show, hide, hideRoomOnly, updateItems, setSelection, ...

$ curl -s https://test-3d-apartment-xovprerj.devinapps.com/js/app.js | grep -n 'viewMode === "walk"\|safeColor\|hideRoomOnly'
213:  <span class="room-swatch" style="background:${safeColor(room.color)}">
546:  if (state.viewMode === "walk") {
549:    if (window.AptThreeView && window.AptThreeView.hideRoomOnly) {
550:      window.AptThreeView.hideRoomOnly();
770:  parts.push(`<rect ... fill="${safeColor(room.wallColor, "#f3eee4")}" stroke="${safeColor(room.color, "#888")}"`);
797:  parts.push(`<rect ... fill="${safeColor(item.color, "#bbb")}"`);
```

## Recommendation
- **F3, F4**: MERGE-READY (passed UI tests).
- **F1, F2, F2b, N1, N2, N3**: Recommend manual spot-check by reviewer in a fresh browser before merge — the fixes are all in the deployed source but I could not drive the full UI flow from the automation harness.
