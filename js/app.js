// Apartment Designer — interactive top-down furniture arrangement.
// Per-room layouts persist in localStorage under `apt_layout_v1`.

const STORAGE_KEY     = "apt_layout_v1";
const ACTIVE_ROOM_KEY = "apt_active_room";
const THEME_KEY       = "apt_theme";
const ROOM_OVERRIDES_KEY = "apt_room_overrides_v1";
const NAMED_LAYOUTS_KEY  = "apt_named_layouts_v1";
const PRICES_KEY         = "apt_prices_v1";        // { "groupId:itemId": number }
const UNIT_KEY           = "apt_unit";              // "cm" | "m" | "ft"
const ONBOARDED_KEY      = "apt_onboarded_v1";
const WALL_THICKNESS  = 10;      // cm, visual thickness of walls in plan
const SVG_PADDING     = 40;      // svg viewport padding around the room
const GRID_SNAP       = 5;       // cm snap grid
const HISTORY_LIMIT   = 60;      // undo stack depth
const ZOOM_MIN        = 0.3;
const ZOOM_MAX        = 4.0;
const ZOOM_STEP       = 1.15;
const DEFAULT_WALL_HEIGHT = 270;  // cm, used by 3D view when room has no explicit height

// ---------- State ----------
const state = {
  layouts: loadLayouts(),        // { roomId: [ {instId, itemId, groupId, x, y, rotation}, ... ] }
  activeRoomId: null,
  selectedInstId: null,
  selectedInstIds: new Set(),    // multi-selection (supersets selectedInstId)
  view: { scale: 1, tx: 0, ty: 0 },
  catalogQuery: "",
  catalogCategory: "all",
  history: [],                   // past snapshots (strings)
  future: [],                    // redo snapshots (strings)
  viewMode: "2d",                // "plan" | "2d" | "3d" | "walk"
  measure: { active: false, p1: null, p2: null },
  clipboard: null,               // { inst clone data } for Ctrl+C / Ctrl+V
  prices: loadPrices(),
  sunHour: 13,
  unit: (localStorage.getItem(UNIT_KEY) || "m"),  // "cm" | "m" | "ft"
};

// Convert cm → current unit string. `precise=false` returns short forms suited
// for the header (e.g. "5.00 م"), `precise=true` returns 1-decimal cm/inch
// suitable for the selection panel.
function fmtCm(cmVal, opts = {}) {
  const v = Number(cmVal) || 0;
  const u = state.unit || "m";
  if (u === "cm") return `${Math.round(v)} سم`;
  if (u === "ft") {
    const inch = v / 2.54;
    const ft = Math.floor(inch / 12);
    const inchRem = Math.round(inch - ft * 12);
    if (opts.compact) return `${(v / 30.48).toFixed(2)} ft`;
    return `${ft}'${inchRem}"`;
  }
  // default: meters
  return `${(v / 100).toFixed(2)} م`;
}
function fmtPair(wCm, hCm) {
  const u = state.unit || "m";
  if (u === "cm") return `${Math.round(wCm)} × ${Math.round(hCm)} سم`;
  if (u === "ft") return `${(wCm / 30.48).toFixed(2)} × ${(hCm / 30.48).toFixed(2)} ft`;
  return `${(wCm / 100).toFixed(2)} × ${(hCm / 100).toFixed(2)} م`;
}
function cycleUnit() {
  const order = ["m", "cm", "ft"];
  state.unit = order[(order.indexOf(state.unit) + 1) % order.length];
  try { localStorage.setItem(UNIT_KEY, state.unit); } catch {}
  updateUnitButton();
  drawRoom();
  renderSelection();
  renderCatalog();
}
function updateUnitButton() {
  const btn = document.getElementById("btn-unit");
  if (!btn) return;
  const labels = { m: "م", cm: "سم", ft: "ft" };
  btn.textContent = labels[state.unit] || "م";
  btn.title = `الوحدة: ${labels[state.unit]} — اضغط للتبديل`;
}

function loadPrices() {
  try { return JSON.parse(localStorage.getItem(PRICES_KEY) || "{}"); }
  catch { return {}; }
}
function savePrices() {
  try { localStorage.setItem(PRICES_KEY, JSON.stringify(state.prices)); } catch {}
}
function priceKey(inst) { return `${inst.groupId}:${inst.itemId}`; }
function priceFor(inst) {
  const item = findItem(inst.groupId, inst.itemId);
  if (item && item.price != null) return item.price;      // custom items carry price
  return state.prices[priceKey(inst)] || 0;
}
function setPrice(inst, price) {
  state.prices[priceKey(inst)] = Math.max(0, price | 0);
  savePrices();
}

function loadRoomOverrides() {
  try { return JSON.parse(localStorage.getItem(ROOM_OVERRIDES_KEY) || "{}"); }
  catch { return {}; }
}
function saveRoomOverrides(obj) {
  try { localStorage.setItem(ROOM_OVERRIDES_KEY, JSON.stringify(obj)); } catch {}
}
// Apply overrides in-place to ROOMS at init (keeps the rest of the app oblivious).
function applyRoomOverrides() {
  const ov = loadRoomOverrides();
  ROOMS.forEach(r => {
    const o = ov[r.id];
    if (!o) return;
    if (o.name)   r.name = o.name;
    if (typeof o.width === "number")  r.width = o.width;
    if (typeof o.depth === "number")  r.depth = o.depth;
    if (o.wallColor) r.wallColor = o.wallColor;
    if (o.color) r.color = o.color;
    if (Array.isArray(o.openings)) r.openings = o.openings;
    if (o.plan) r.plan = o.plan;
    if (o.floorTexture) r.floorTexture = o.floorTexture;
    if (o.wallTexture)  r.wallTexture  = o.wallTexture;
  });
}

function allGroups() {
  const groups = FURNITURE_GROUPS.slice();
  const custom = window.CustomItems ? window.CustomItems.group() : null;
  if (custom && custom.items.length) groups.push(custom);
  return groups;
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
  applyRoomOverrides();
  maybeLoadStateFromUrl();
  renderRoomList();
  renderCatalog();
  // Hydrate CustomItems from IndexedDB (or migrate from legacy localStorage)
  // and re-render the catalog once the heavy image data is available.
  if (window.CustomItems && typeof window.CustomItems.init === "function") {
    window.CustomItems.init().then(() => {
      renderCatalog();
      drawRoom();
    });
  }
  bindTopbar();
  bindCatalogSearch();
  bindViewControls();
  bindCustomModal();
  bindRoomModal();
  bindHelpModal();
  bindLayoutsModal();
  bindViewModeToggle();
  bindGlobalKeys();
  bindCatalogTouchDrag();
  bindSunSlider();
  bindMeasure();
  bindShareExportButtons();
  bindOnboarding();

  const last = localStorage.getItem(ACTIVE_ROOM_KEY);
  if (last && ROOMS.find(r => r.id === last)) selectRoom(last);
  else drawRoom();

  updateUndoRedoButtons();
});

// ---------- Persistence ----------
function loadLayouts() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}
function saveLayouts() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.layouts));
  } catch (e) {
    if (e && (e.name === "QuotaExceededError" || e.code === 22)) {
      toast("ذاكرة المتصفح ممتلئة — صدّر التصميم ثم احذف بعض الغرف", "err");
    }
  }
}

// ---------- Undo/Redo ----------
function snapshot() {
  return JSON.stringify(state.layouts);
}
function pushHistory() {
  state.history.push(snapshot());
  if (state.history.length > HISTORY_LIMIT) state.history.shift();
  state.future.length = 0;
  updateUndoRedoButtons();
}
function restore(str) {
  try { state.layouts = JSON.parse(str); } catch { return; }
  saveLayouts();
  // Keep selected inst if still present in active room, else clear
  const items = state.layouts[state.activeRoomId] || [];
  if (!items.find(i => i.instId === state.selectedInstId)) {
    state.selectedInstId = null;
  }
  drawRoom();
  renderSelection();
  updateUndoRedoButtons();
  renderRoomList();
}
function undo() {
  if (!state.history.length) return;
  state.future.push(snapshot());
  const prev = state.history.pop();
  restore(prev);
  toast("تم التراجع");
}
function redo() {
  if (!state.future.length) return;
  state.history.push(snapshot());
  const next = state.future.pop();
  restore(next);
  toast("تمت الإعادة");
}
function updateUndoRedoButtons() {
  const u = document.getElementById("btn-undo");
  const r = document.getElementById("btn-redo");
  if (u) u.disabled = state.history.length === 0;
  if (r) r.disabled = state.future.length === 0;
}

// ---------- Theme ----------
function applyTheme(theme) {
  document.body.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const btn = document.getElementById("btn-theme");
  if (btn) btn.textContent = theme === "dark" ? "☀️" : "🌙";
}
function toggleTheme() {
  applyTheme(document.body.dataset.theme === "dark" ? "light" : "dark");
}

// ---------- Toast ----------
window.toast = toast; // exposed so submodules (e.g. CustomItems) can notify users
function toast(msg, kind = "ok") {
  const host = document.getElementById("toast-host");
  if (!host) return;
  const n = document.createElement("div");
  n.className = "toast" + (kind === "warn" ? " warn" : kind === "err" ? " err" : "");
  n.textContent = msg;
  host.appendChild(n);
  requestAnimationFrame(() => n.classList.add("show"));
  setTimeout(() => { n.classList.remove("show"); setTimeout(() => n.remove(), 220); }, 1500);
}

// ---------- Sidebar: rooms ----------
function renderRoomList() {
  const ul = document.getElementById("room-list");
  ul.innerHTML = "";
  ROOMS.forEach(room => {
    const count = (state.layouts[room.id] || []).length;
    const li = document.createElement("li");
    li.dataset.roomId = room.id;
    li.innerHTML = `
      <span class="room-swatch" style="background:${safeColor(room.color)}"></span>
      <span>${esc(room.name)}</span>
      ${count ? `<span class="room-count">${count}</span>` : ""}
    `;
    li.addEventListener("click", () => selectRoom(room.id));
    ul.appendChild(li);
  });
  markActiveRoom();
}
function markActiveRoom() {
  document.querySelectorAll("#room-list li").forEach(li => {
    li.classList.toggle("active", li.dataset.roomId === state.activeRoomId);
  });
}

// ---------- Sidebar: catalog ----------
// Normalize Arabic text for search: strip diacritics, unify alef/yaa/taa-marbuta.
function normalizeAr(s) {
  if (!s) return "";
  return String(s).toLowerCase()
    .replace(/[\u064B-\u0652\u0670]/g, "")  // remove tashkeel + alef khanjariya
    .replace(/[\u0622\u0623\u0625]/g, "\u0627") // آ أ إ → ا
    .replace(/\u0629/g, "\u0647")             // ة → ه
    .replace(/\u0649/g, "\u064A")             // ى → ي
    .replace(/\u0624/g, "\u0648")             // ؤ → و
    .replace(/\u0626/g, "\u064A")             // ئ → ي
    .replace(/[\u0640]/g, "")                 // tatweel
    .trim();
}

function renderCatalog() {
  const container = document.getElementById("furniture-catalog");
  container.innerHTML = "";
  const q = normalizeAr(state.catalogQuery.trim().toLowerCase());
  const cat = state.catalogCategory || "all";

  // Category chips row
  const chips = document.createElement("div");
  chips.className = "cat-chips";
  const groups = allGroups();
  const chipData = [{ id: "all", label: "الكل" }].concat(groups.map(g => ({ id: g.id, label: g.label })));
  chipData.forEach(c => {
    const b = document.createElement("button");
    b.className = "cat-chip" + (cat === c.id ? " active" : "");
    b.textContent = c.label;
    b.addEventListener("click", () => {
      state.catalogCategory = c.id;
      renderCatalog();
    });
    chips.appendChild(b);
  });
  container.appendChild(chips);

  groups.forEach(group => {
    if (cat !== "all" && cat !== group.id) return;
    const matchingItems = group.items.filter(item =>
      !q
        || normalizeAr(item.name.toLowerCase()).includes(q)
        || item.id.toLowerCase().includes(q)
    );
    if (!matchingItems.length) return;
    const header = document.createElement("div");
    header.className = "cat-group";
    header.textContent = group.label;
    container.appendChild(header);
    matchingItems.forEach(item => {
      const div = document.createElement("div");
      div.className = "cat-item";
      div.dataset.groupId = group.id;
      div.dataset.itemId = item.id;
      div.draggable = true;
      div.title = `${item.name} — ${item.w}×${item.h} سم`;
      const isCustom = group.id === "custom";
      const thumb = isCustom && item.image
        ? `<img class="cat-thumb" src="${esc(item.image)}" alt="" />`
        : `<span class="cat-icon">${esc(item.icon || "📦")}</span>`;
      const actions = isCustom
        ? `<button class="cat-edit" title="تعديل" aria-label="تعديل">✎</button>
           <button class="cat-del"  title="حذف"   aria-label="حذف">✕</button>`
        : "";
      div.innerHTML = `
        ${thumb}
        <span class="cat-name">${esc(item.name)}</span>
        <span class="cat-size">${Number(item.w) || 0}×${Number(item.h) || 0} سم</span>
        ${actions}
      `;
      if (isCustom) {
        div.querySelector(".cat-del").addEventListener("click", e => {
          e.stopPropagation();
          e.preventDefault();
          if (!confirm(`حذف "${item.name}" من الكتالوج؟ (لن يُحذف من الغرف المحفوظة)`)) return;
          window.CustomItems.remove(item.id).then(() => {
            renderCatalog();
            drawRoom();
            toast("تم حذف العنصر", "warn");
          });
        });
        div.querySelector(".cat-edit").addEventListener("click", e => {
          e.stopPropagation();
          e.preventDefault();
          if (window.openCustomEdit) window.openCustomEdit(item);
        });
      }
      div.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/apt-item", JSON.stringify({ groupId: group.id, itemId: item.id }));
        e.dataTransfer.effectAllowed = "copy";
      });
      container.appendChild(div);
    });
  });
  // Count only actual catalog items (chips row is always present).
  if (!container.querySelector(".cat-item")) {
    const msg = document.createElement("div");
    msg.className = "cat-group";
    msg.textContent = "لا توجد نتائج";
    container.appendChild(msg);
  }
}
function bindCatalogSearch() {
  const input = document.getElementById("cat-search");
  input.addEventListener("input", () => {
    state.catalogQuery = input.value;
    renderCatalog();
  });
}

// ---------- Topbar ----------
function bindCustomModal() {
  const modal = document.getElementById("custom-modal");
  const openBtn = document.getElementById("btn-add-custom");
  const closeBtn = document.getElementById("custom-modal-close");
  const cancelBtn = document.getElementById("custom-modal-cancel");
  const saveBtn = document.getElementById("custom-modal-save");
  const imgInput = document.getElementById("ci-image");
  const preview = document.getElementById("ci-preview");
  const err = document.getElementById("ci-error");
  const title = document.getElementById("custom-modal-title");
  const editIdInput = document.getElementById("ci-edit-id");
  let processed = null; // { image, sideColor }

  function reset() {
    document.getElementById("ci-name").value = "";
    document.getElementById("ci-w").value = 60;
    document.getElementById("ci-d").value = 60;
    document.getElementById("ci-h").value = 80;
    document.getElementById("ci-cat").value = "common";
    document.getElementById("ci-price").value = "";
    imgInput.value = "";
    preview.innerHTML = `<span class="ph">لم يتم اختيار صورة</span>`;
    err.hidden = true; err.textContent = "";
    processed = null;
    editIdInput.value = "";
    title.textContent = "إضافة عنصر مخصص";
    saveBtn.textContent = "إضافة للكتالوج";
  }
  function open() { reset(); modal.hidden = false; document.getElementById("ci-name").focus(); }
  function openForEdit(item) {
    reset();
    editIdInput.value = item.id;
    title.textContent = "تعديل عنصر مخصص";
    saveBtn.textContent = "حفظ التعديلات";
    document.getElementById("ci-name").value = item.name || "";
    document.getElementById("ci-w").value = item.w;
    document.getElementById("ci-d").value = item.h;
    document.getElementById("ci-h").value = item.depth || 80;
    document.getElementById("ci-cat").value = item.category || "common";
    document.getElementById("ci-price").value = item.price || "";
    if (item.image) preview.innerHTML = `<img src="${esc(item.image)}" alt="معاينة" />`;
    // Keep existing image unless a new file is chosen.
    processed = item.image ? { image: item.image, sideColor: item.sideColor || item.color } : null;
    modal.hidden = false;
  }
  function close() { modal.hidden = true; }
  window.openCustomEdit = openForEdit;

  openBtn.addEventListener("click", open);
  closeBtn.addEventListener("click", close);
  cancelBtn.addEventListener("click", close);
  modal.addEventListener("click", e => { if (e.target === modal) close(); });
  document.addEventListener("keydown", e => { if (e.key === "Escape" && !modal.hidden) close(); });

  imgInput.addEventListener("change", async () => {
    const file = imgInput.files[0];
    if (!file) return;
    try {
      processed = await window.processCustomImage(file);
      preview.innerHTML = `<img src="${esc(processed.image)}" alt="معاينة" />`;
      err.hidden = true;
    } catch {
      processed = null;
      err.textContent = "تعذّر قراءة الصورة";
      err.hidden = false;
    }
  });

  saveBtn.addEventListener("click", async () => {
    const name = document.getElementById("ci-name").value.trim();
    const w = parseInt(document.getElementById("ci-w").value, 10);
    const d = parseInt(document.getElementById("ci-d").value, 10);
    const h = parseInt(document.getElementById("ci-h").value, 10);
    const cat = document.getElementById("ci-cat").value;
    const priceRaw = document.getElementById("ci-price").value.trim();
    const price = priceRaw === "" ? 0 : Math.max(0, parseInt(priceRaw, 10) || 0);
    const editingId = editIdInput.value;
    if (!name) { err.textContent = "اكتب اسمًا للعنصر"; err.hidden = false; return; }
    if (!processed) { err.textContent = "ارفع صورة للعنصر"; err.hidden = false; return; }
    if (!(w > 0 && d > 0 && h > 0)) { err.textContent = "الأبعاد غير صالحة"; err.hidden = false; return; }

    if (editingId) {
      const ok = await window.CustomItems.update(editingId, {
        name, w, h: d, depth: h, category: cat, price,
        color: processed.sideColor, sideColor: processed.sideColor, image: processed.image,
      });
      if (ok) {
        renderCatalog();
        drawRoom();
        renderSelection();
        toast("تم تحديث العنصر");
        close();
      }
    } else {
      const id = "c_" + Math.random().toString(36).slice(2, 9);
      const item = {
        id, name, icon: "📷",
        w, h: d, depth: h,
        color: processed.sideColor, sideColor: processed.sideColor,
        image: processed.image,
        category: cat,
        price,
      };
      if (await window.CustomItems.add(item)) {
        renderCatalog();
        toast("تمت الإضافة للكتالوج");
        close();
      }
    }
  });
}

function bindViewModeToggle() {
  document.getElementById("btn-mode-plan").addEventListener("click", () => setViewMode("plan"));
  document.getElementById("btn-mode-2d").addEventListener("click", () => setViewMode("2d"));
  document.getElementById("btn-mode-3d").addEventListener("click", () => setViewMode("3d"));
  document.getElementById("btn-mode-walk").addEventListener("click", () => setViewMode("walk"));
}
function setViewMode(mode) {
  if (mode === state.viewMode) return;
  state.viewMode = mode;
  ["plan", "2d", "3d", "walk"].forEach(m => {
    const btn = document.getElementById("btn-mode-" + m);
    if (!btn) return;
    btn.classList.toggle("active", mode === m);
    btn.setAttribute("aria-pressed", mode === m);
  });
  ["2d", "3d", "plan", "walk"].forEach(m => {
    const el = document.getElementById("stage-help-" + m);
    if (el) el.hidden = mode !== m;
  });
  // zoom controls apply to 2D and plan
  ["btn-zoom-in", "btn-zoom-out", "btn-zoom-fit"].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.disabled = (mode !== "2d" && mode !== "plan");
  });
  drawRoom();
}

function bindTopbar() {
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (!state.activeRoomId) return;
    if (!confirm("هل أنت متأكد من مسح جميع العفش من هذه الغرفة؟")) return;
    pushHistory();
    state.layouts[state.activeRoomId] = [];
    state.selectedInstId = null;
    saveLayouts();
    drawRoom();
    renderSelection();
    renderRoomList();
    toast("تم المسح", "warn");
  });
  document.getElementById("btn-save").addEventListener("click", () => {
    saveLayouts();
    toast("تم الحفظ");
  });
  document.getElementById("btn-export").addEventListener("click", exportJSON);
  document.getElementById("btn-import").addEventListener("change", importJSON);
  document.getElementById("btn-undo").addEventListener("click", undo);
  document.getElementById("btn-redo").addEventListener("click", redo);
  document.getElementById("btn-theme").addEventListener("click", toggleTheme);
  document.getElementById("btn-print").addEventListener("click", openPdfReport);
  const unitBtn = document.getElementById("btn-unit");
  if (unitBtn) {
    unitBtn.addEventListener("click", cycleUnit);
    updateUnitButton();
  }
}

function exportJSON() {
  const blob = new Blob([JSON.stringify(state.layouts, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "apartment-layout.json";
  a.click();
  URL.revokeObjectURL(url);
}
function importJSON(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const data = JSON.parse(reader.result);
      if (typeof data !== "object" || Array.isArray(data)) throw new Error();
      pushHistory();
      state.layouts = data;
      saveLayouts();
      state.selectedInstId = null;
      drawRoom();
      renderSelection();
      renderRoomList();
      toast("تم الاستيراد");
    } catch {
      toast("ملف JSON غير صالح", "err");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

// ---------- Room rendering ----------
function selectRoom(roomId) {
  state.activeRoomId = roomId;
  state.selectedInstId = null;
  localStorage.setItem(ACTIVE_ROOM_KEY, roomId);
  if (!state.layouts[roomId]) state.layouts[roomId] = [];
  state.view = { scale: 1, tx: 0, ty: 0 };
  markActiveRoom();
  drawRoom();
  renderSelection();
}
function getRoom() {
  return ROOMS.find(r => r.id === state.activeRoomId);
}

function drawRoom() {
  const container = document.getElementById("room-container");

  // Apartment overview — all rooms at once, not tied to active room.
  if (state.viewMode === "plan") {
    if (window.AptThreeView) window.AptThreeView.hide();
    drawOverview(container);
    return;
  }

  // First-person walkthrough — whole apartment in 3D with WASD.
  if (state.viewMode === "walk") {
    // Only tear down the room-level 3D context; leave aptCtx intact so
    // drawWalkthrough() can take its incremental-update path.
    if (window.AptThreeView && window.AptThreeView.hideRoomOnly) {
      window.AptThreeView.hideRoomOnly();
    }
    drawWalkthrough(container);
    return;
  }

  const room = getRoom();
  if (!room) {
    if (window.AptThreeView) window.AptThreeView.hide();
    container.innerHTML = `<div class="placeholder"><div class="placeholder-icon">🏘️</div><p>اختر غرفة من القائمة لبدء تصميمها</p></div>`;
    document.getElementById("room-title").textContent = "اختر غرفة للبدء";
    document.getElementById("room-dims").textContent = "";
    document.getElementById("item-count").textContent = "0 قطعة";
    setCollisionIndicator(0);
    setBlockedIndicator(0);
    return;
  }

  document.getElementById("room-title").textContent = room.name;
  document.getElementById("room-dims").textContent = fmtPair(room.width, room.depth);

  const items = state.layouts[room.id] || [];
  document.getElementById("item-count").textContent = `${items.length} قطعة`;
  updateRoomStats(room, items);

  const vbW = room.width + SVG_PADDING * 2;
  const vbH = room.depth + SVG_PADDING * 2;

  const collisions = detectCollisions(items);
  setCollisionIndicator(collisions.size);
  const { blocked, violated: violatedOpenings } = detectDoorBlocks(room, items);
  setBlockedIndicator(blocked.size);

  if (state.viewMode === "3d") {
    if (!window.AptThreeView) {
      container.innerHTML = `<div class="placeholder"><div class="placeholder-icon">⏳</div><p>جارٍ تحميل محرك 3D…</p></div>`;
      // Retry shortly once the ES module finishes loading.
      setTimeout(() => { if (state.viewMode === "3d") drawRoom(); }, 200);
      return;
    }
    // If the 3D scene is already mounted for this room, reconcile items in
    // place (keeps camera & selection smooth across edits). Otherwise, build.
    if (window.AptThreeView.isActiveFor(room.id)) {
      window.AptThreeView.updateItems(items, findItem, state.selectedInstId, collisions, blocked);
    } else {
      container.innerHTML = `<div class="three-wrap" id="three-wrap"></div>`;
      window.AptThreeView.show(document.getElementById("three-wrap"), {
        room, items, findItem, collisionSet: collisions, blockedSet: blocked,
        onSelect: (instId) => {
          state.selectedInstId = instId;
          renderSelection();
        },
        onDrop: ({ groupId, itemId, x, y }) => {
          addItemAtRoomCoords(room, groupId, itemId, x, y);
        },
        onMove: ({ instId, x, y }) => {
          const inst = (state.layouts[room.id] || []).find(i => i.instId === instId);
          if (!inst) return;
          pushHistory();
          inst.x = x;
          inst.y = y;
          fitWithinRoom(inst);
          saveLayouts();
          renderSelection();
          renderRoomList();
          // Reconcile mesh transforms (but leave camera alone)
          const nextItems = state.layouts[room.id] || [];
          const nextCollisions = detectCollisions(nextItems);
          setCollisionIndicator(nextCollisions.size);
          const nextBlocked = detectDoorBlocks(room, nextItems).blocked;
          setBlockedIndicator(nextBlocked.size);
          window.AptThreeView.updateItems(nextItems, findItem, state.selectedInstId, nextCollisions, nextBlocked);
        },
      });
    }
    return;
  }

  if (window.AptThreeView) window.AptThreeView.hide();

  container.innerHTML = `
    <div class="room-svg-wrap">
      ${state.measure.active ? `<div class="measure-hint">أداة القياس — انقر نقطتين، M للإيقاف</div>` : ""}
      <svg class="room-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet">
        ${renderDefs()}
        <g id="viewport" transform="${viewportTransform(vbW, vbH)}">
          ${renderRoomShell(room)}
          <g id="clearance-layer">${renderDoorClearances(room, violatedOpenings)}</g>
          <g id="fur-layer">${items.map(inst => renderFurniture(inst, collisions, blocked)).join("")}</g>
          ${renderMeasureOverlay(room)}
        </g>
      </svg>
    </div>
  `;
  updateZoomLabel();

  const svg = container.querySelector("svg");
  setupDrop(svg, room);
  setupFurnitureInteractions(svg, room);
  setupZoomPan(svg, container);
  if (state.measure.active) setupMeasureClicks(svg, room);
}

// ---------- Measure overlay (2D) ----------
function renderMeasureOverlay(room) {
  const { p1, p2 } = state.measure;
  if (!p1) return "";
  const ox = SVG_PADDING, oy = SVG_PADDING;
  if (!p2) {
    return `<circle class="measure-dot" cx="${ox + p1.x}" cy="${oy + p1.y}" r="6" />`;
  }
  const dx = p2.x - p1.x, dy = p2.y - p1.y;
  const dist = Math.hypot(dx, dy);
  const mx = ox + (p1.x + p2.x) / 2;
  const my = oy + (p1.y + p2.y) / 2;
  return `
    <line class="measure-line" x1="${ox + p1.x}" y1="${oy + p1.y}" x2="${ox + p2.x}" y2="${oy + p2.y}" />
    <circle class="measure-dot" cx="${ox + p1.x}" cy="${oy + p1.y}" r="6" />
    <circle class="measure-dot" cx="${ox + p2.x}" cy="${oy + p2.y}" r="6" />
    <text class="measure-label" x="${mx}" y="${my - 10}" text-anchor="middle">${fmtCm(dist)}</text>
  `;
}
function setupMeasureClicks(svg, room) {
  svg.addEventListener("click", e => {
    if (!state.measure.active) return;
    const pt = clientToRoomCoords(svg, e.clientX, e.clientY, room);
    if (!pt) return;
    if (!state.measure.p1 || state.measure.p2) {
      state.measure.p1 = pt;
      state.measure.p2 = null;
    } else {
      state.measure.p2 = pt;
    }
    drawRoom();
  }, { capture: true });
}
function clientToRoomCoords(svg, clientX, clientY, room) {
  const rect = svg.getBoundingClientRect();
  const vbW = room.width + SVG_PADDING * 2;
  const vbH = room.depth + SVG_PADDING * 2;
  // Account for preserveAspectRatio=xMidYMid meet
  const scale = Math.min(rect.width / vbW, rect.height / vbH);
  const renderedW = vbW * scale;
  const renderedH = vbH * scale;
  const offX = (rect.width - renderedW) / 2;
  const offY = (rect.height - renderedH) / 2;
  const svgX = (clientX - rect.left - offX) / scale;
  const svgY = (clientY - rect.top - offY) / scale;
  // Undo viewport transform
  const { scale: s, tx, ty } = state.view;
  const cx = vbW / 2, cy = vbH / 2;
  const localX = (svgX - (cx + tx)) / s + cx;
  const localY = (svgY - (cy + ty)) / s + cy;
  return { x: localX - SVG_PADDING, y: localY - SVG_PADDING };
}

function renderDefs() { return ""; }

function viewportTransform(vbW, vbH) {
  const { scale, tx, ty } = state.view;
  const cx = vbW / 2, cy = vbH / 2;
  // scale around center, then translate
  return `translate(${cx + tx} ${cy + ty}) scale(${scale}) translate(${-cx} ${-cy})`;
}

// ---------- Apartment overview (all rooms in a single floor plan) ----------
function apartmentBounds() {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  ROOMS.forEach(r => {
    const px = (r.plan && r.plan.x) || 0;
    const py = (r.plan && r.plan.y) || 0;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px + r.width);
    maxY = Math.max(maxY, py + r.depth);
  });
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function drawOverview(container) {
  document.getElementById("room-title").textContent = "مخطط الشقة الكامل";
  const bounds = apartmentBounds();
  document.getElementById("room-dims").textContent = fmtPair(bounds.w, bounds.h);
  const totalItems = ROOMS.reduce((s, r) => s + (state.layouts[r.id] || []).length, 0);
  document.getElementById("item-count").textContent = `${totalItems} قطعة (${ROOMS.length} غرف)`;
  // Cross-room collisions are not meaningful; clear the indicator.
  setCollisionIndicator(0);
  setBlockedIndicator(0);

  const pad = 60;
  const vbW = bounds.w + pad * 2;
  const vbH = bounds.h + pad * 2;

  const roomSvgs = ROOMS.map(r => renderOverviewRoom(r, bounds, pad)).join("");

  container.innerHTML = `
    <div class="room-svg-wrap plan-wrap">
      <svg class="room-svg plan-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet">
        <g id="viewport" transform="${viewportTransform(vbW, vbH)}">
          <rect x="0" y="0" width="${vbW}" height="${vbH}" fill="var(--panel)" opacity="0.35" />
          ${roomSvgs}
        </g>
      </svg>
    </div>
  `;
  updateZoomLabel();

  const svg = container.querySelector("svg");
  setupZoomPan(svg, container);
  // Click a room → switch to 2D editing mode for that room.
  svg.querySelectorAll("[data-plan-room]").forEach(g => {
    g.addEventListener("click", (e) => {
      if (e.shiftKey || e.button === 1) return; // reserved for pan
      const id = g.getAttribute("data-plan-room");
      selectRoom(id);
      setViewMode("2d");
    });
  });
}

function renderOverviewRoom(room, bounds, pad) {
  const ox = (room.plan && room.plan.x) || 0;
  const oy = (room.plan && room.plan.y) || 0;
  const x = pad + ox - bounds.minX;
  const y = pad + oy - bounds.minY;
  const items = state.layouts[room.id] || [];
  const parts = [];
  parts.push(`<rect x="${x}" y="${y}" width="${room.width}" height="${room.depth}" fill="${safeColor(room.wallColor, "#f3eee4")}" stroke="${safeColor(room.color, "#888")}" stroke-width="${WALL_THICKNESS}" rx="2" />`);
  // Accent wall stripe (mirror of the single-room view — feature wall only)
  if (room.accentColor && room.accentColor !== room.wallColor) {
    const stripe = 10;
    const ac = safeColor(room.accentColor, "#8a1f3c");
    const aw = room.accentWall || "top";
    if (aw === "top")    parts.push(`<rect x="${x}" y="${y}" width="${room.width}" height="${stripe}" fill="${ac}" opacity="0.85" />`);
    if (aw === "bottom") parts.push(`<rect x="${x}" y="${y + room.depth - stripe}" width="${room.width}" height="${stripe}" fill="${ac}" opacity="0.85" />`);
    if (aw === "left")   parts.push(`<rect x="${x}" y="${y}" width="${stripe}" height="${room.depth}" fill="${ac}" opacity="0.85" />`);
    if (aw === "right")  parts.push(`<rect x="${x + room.width - stripe}" y="${y}" width="${stripe}" height="${room.depth}" fill="${ac}" opacity="0.85" />`);
  }
  // Openings
  (room.openings || []).forEach(op => {
    const t = WALL_THICKNESS;
    let rx, ry, rw, rh;
    switch (op.wall) {
      case "top":    rx = x + op.at; ry = y - t/2; rw = op.size; rh = t * 1.4; break;
      case "bottom": rx = x + op.at; ry = y + room.depth - t*0.7; rw = op.size; rh = t * 1.4; break;
      case "left":   rx = x - t/2; ry = y + op.at; rw = t * 1.4; rh = op.size; break;
      case "right":  rx = x + room.width - t*0.7; ry = y + op.at; rw = t * 1.4; rh = op.size; break;
    }
    const color = op.kind === "door" ? "var(--door)" : "var(--window)";
    parts.push(`<rect x="${rx}" y="${ry}" width="${rw}" height="${rh}" fill="var(--panel)" stroke="${color}" stroke-width="2" />`);
  });
  // Furniture (simplified — small rects with color)
  items.forEach(inst => {
    const item = findItem(inst.groupId, inst.itemId);
    if (!item) return;
    const fx = x + inst.x;
    const fy = y + inst.y;
    const rot = inst.rotation || 0;
    if (inst.groupId === "custom" && item.image) {
      parts.push(`<g transform="translate(${fx} ${fy}) rotate(${rot})">
        <image x="${-item.w/2}" y="${-item.h/2}" width="${item.w}" height="${item.h}" preserveAspectRatio="xMidYMid slice" href="${esc(item.image)}" />
      </g>`);
    } else {
      const opa = item.opacity ?? 1;
      parts.push(`<rect x="${fx - item.w/2}" y="${fy - item.h/2}" width="${item.w}" height="${item.h}" fill="${safeColor(item.color, "#bbb")}" opacity="${opa}" transform="rotate(${rot} ${fx} ${fy})" rx="2" />`);
    }
  });
  // Room label
  parts.push(`<text x="${x + room.width/2}" y="${y + room.depth/2 + 6}" text-anchor="middle" font-size="24" font-weight="700" fill="var(--muted)" style="pointer-events:none">${esc(room.name)}</text>`);
  parts.push(`<text x="${x + room.width/2}" y="${y + room.depth/2 + 32}" text-anchor="middle" font-size="16" fill="var(--muted)" opacity="0.7" style="pointer-events:none">${fmtPair(room.width, room.depth)} — ${items.length} قطعة</text>`);
  // Hit target for clicking into the room
  return `<g class="plan-room" data-plan-room="${esc(room.id)}" style="cursor:pointer">
    ${parts.join("")}
    <rect class="plan-room-hit" x="${x}" y="${y}" width="${room.width}" height="${room.depth}" fill="transparent" />
  </g>`;
}

function drawWalkthrough(container) {
  document.getElementById("room-title").textContent = "جولة داخل الشقة";
  const bounds = apartmentBounds();
  document.getElementById("room-dims").textContent = fmtPair(bounds.w, bounds.h);
  const totalItems = ROOMS.reduce((s, r) => s + (state.layouts[r.id] || []).length, 0);
  document.getElementById("item-count").textContent = `${totalItems} قطعة`;
  setCollisionIndicator(0);
  setBlockedIndicator(0);

  if (!window.AptThreeView) {
    container.innerHTML = `<div class="placeholder"><div class="placeholder-icon">⏳</div><p>جارٍ تحميل محرك 3D…</p></div>`;
    setTimeout(() => { if (state.viewMode === "walk") drawRoom(); }, 200);
    return;
  }

  if (window.AptThreeView.isActiveApartment && window.AptThreeView.isActiveApartment()) {
    // Re-sync items across rooms
    window.AptThreeView.updateApartmentItems(gatherAllItems(), findItem);
    return;
  }

  container.innerHTML = `<div class="three-wrap walk-wrap" id="three-wrap"></div>`;
  window.AptThreeView.showApartment(document.getElementById("three-wrap"), {
    rooms: ROOMS,
    itemsByRoom: gatherAllItems(),
    findItem,
  });
}

function gatherAllItems() {
  const map = {};
  ROOMS.forEach(r => { map[r.id] = state.layouts[r.id] || []; });
  return map;
}

function renderRoomShell(room) {
  const px = SVG_PADDING;
  const py = SVG_PADDING;
  const w = room.width;
  const h = room.depth;
  const parts = [];

  parts.push(`<rect x="${px}" y="${py}" width="${w}" height="${h}" fill="${safeColor(room.wallColor, "#f3eee4")}" stroke="${safeColor(room.color, "#888")}" stroke-width="${WALL_THICKNESS}" />`);

  // Accent wall stripe — shows where the feature-wall color lives in real life
  // (e.g. the teal wall in the blue bedroom, the burgundy wall in the master).
  if (room.accentColor && room.accentColor !== room.wallColor) {
    const stripe = 14;
    const ac = safeColor(room.accentColor, "#8a1f3c");
    const aw = room.accentWall || "top";
    if (aw === "top")    parts.push(`<rect x="${px}" y="${py}" width="${w}" height="${stripe}" fill="${ac}" opacity="0.85" />`);
    if (aw === "bottom") parts.push(`<rect x="${px}" y="${py + h - stripe}" width="${w}" height="${stripe}" fill="${ac}" opacity="0.85" />`);
    if (aw === "left")   parts.push(`<rect x="${px}" y="${py}" width="${stripe}" height="${h}" fill="${ac}" opacity="0.85" />`);
    if (aw === "right")  parts.push(`<rect x="${px + w - stripe}" y="${py}" width="${stripe}" height="${h}" fill="${ac}" opacity="0.85" />`);
  }

  let grid = "";
  for (let gx = 50; gx < w; gx += 50) {
    grid += `<line x1="${px+gx}" y1="${py}" x2="${px+gx}" y2="${py+h}" stroke="var(--grid-line)" />`;
  }
  for (let gy = 50; gy < h; gy += 50) {
    grid += `<line x1="${px}" y1="${py+gy}" x2="${px+w}" y2="${py+gy}" stroke="var(--grid-line)" />`;
  }
  parts.push(`<g>${grid}</g>`);

  (room.openings || []).forEach(op => parts.push(renderOpening(room, op, px, py)));

  parts.push(`<text x="${px + w/2}" y="${py - 12}" text-anchor="middle" fill="var(--muted)" font-size="14">${fmtCm(w)}</text>`);
  parts.push(`<text x="${px - 20}" y="${py + h/2}" text-anchor="middle" fill="var(--muted)" font-size="14" transform="rotate(-90 ${px - 20} ${py + h/2})">${fmtCm(h)}</text>`);

  parts.push(`<g transform="translate(${px + w - 30} ${py + 30})">
    <circle r="16" fill="var(--panel)" stroke="var(--muted)" />
    <text y="-2" text-anchor="middle" font-size="10" fill="var(--muted)">شمال</text>
    <text y="10" text-anchor="middle" font-size="12" fill="var(--accent)">↑</text>
  </g>`);

  return parts.join("");
}

function renderOpening(room, op, px, py) {
  const t = WALL_THICKNESS;
  let x, y, w, h, labelX, labelY;
  switch (op.wall) {
    case "top":    x = px + op.at; y = py - t/2; w = op.size; h = t * 1.4; labelX = x + w/2; labelY = y - 4; break;
    case "bottom": x = px + op.at; y = py + room.depth - t*0.7; w = op.size; h = t * 1.4; labelX = x + w/2; labelY = y + h + 12; break;
    case "left":   x = px - t/2; y = py + op.at; w = t * 1.4; h = op.size; labelX = x + w + 18; labelY = y + h/2 + 4; break;
    case "right":  x = px + room.width - t*0.7; y = py + op.at; w = t * 1.4; h = op.size; labelX = x - 22; labelY = y + h/2 + 4; break;
  }
  const color = op.kind === "door" ? "var(--door)" : "var(--window)";
  const arc = op.kind === "door" ? renderDoorSwing(room, op, px, py) : "";
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="var(--panel)" stroke="${color}" stroke-width="2" />
      ${arc}
      <text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="10" fill="${color}">${esc(op.label || (op.kind === "door" ? "باب" : "شباك"))}</text>
    </g>`;
}

function renderDoorSwing(room, op, px, py) {
  const size = op.size;
  let cx, cy, sweep = 1;
  switch (op.wall) {
    case "top":    cx = px + op.at;           cy = py;                break;
    case "bottom": cx = px + op.at + size;    cy = py + room.depth;   break;
    case "left":   cx = px;                   cy = py + op.at + size; break;
    case "right":  cx = px + room.width;      cy = py + op.at;        break;
  }
  let ex, ey;
  switch (op.wall) {
    case "top":    ex = cx;        ey = cy + size; break;
    case "bottom": ex = cx;        ey = cy - size; break;
    case "left":   ex = cx + size; ey = cy;        break;
    case "right":  ex = cx - size; ey = cy;        break;
  }
  const sx = op.wall === "top" ? cx + size : op.wall === "bottom" ? cx - size : cx;
  const sy = op.wall === "left" ? cy - size : op.wall === "right" ? cy + size : cy;
  return `<path d="M ${sx} ${sy} A ${size} ${size} 0 0 ${sweep} ${ex} ${ey}" fill="none" stroke="rgba(157,88,51,.3)" stroke-dasharray="3,3" />`;
}

function renderFurniture(inst, collisionSet, blockedSet) {
  const item = findItem(inst.groupId, inst.itemId);
  if (!item) return "";
  const cx = SVG_PADDING + inst.x;
  const cy = SVG_PADDING + inst.y;
  const w = item.w;
  const h = item.h;
  const classes = ["furniture"];
  const isSelected = inst.instId === state.selectedInstId
    || (state.selectedInstIds && state.selectedInstIds.has(inst.instId));
  if (isSelected) classes.push("selected");
  if (collisionSet && collisionSet.has(inst.instId)) classes.push("collides");
  if (blockedSet && blockedSet.has(inst.instId)) classes.push("blocks-door");
  const opacity = item.opacity ?? 1;
  const isCustom = inst.groupId === "custom" && item.image;
  const rot = inst.rotation || 0;
  // For custom items: render the uploaded image directly inside the body, plus
  // a subtle colored stroke. For built-ins: filled rect with the library color.
  const body = isCustom
    ? `<image class="fur-body" x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" href="${esc(item.image)}" opacity="${opacity}"></image>
       <rect class="fur-frame" x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" fill="none" stroke="${safeColor(item.sideColor || item.color, '#555')}" stroke-width="2" rx="4" />`
    : `<rect class="fur-body" x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" fill="${safeColor(item.color, '#bbb')}" opacity="${opacity}" rx="4" />`;
  const labelFill = isCustom ? "rgba(255,255,255,.95)" : "#fff";
  const labelStroke = isCustom ? "rgba(0,0,0,.55)" : "none";
  return `
    <g class="${classes.join(" ")}" data-inst-id="${esc(inst.instId)}" transform="translate(${cx} ${cy}) rotate(${rot})">
      ${body}
      <g transform="rotate(${-rot})" style="pointer-events:none">
        ${isCustom ? "" : `<text class="fur-icon" x="0" y="6" fill="${labelFill}">${esc(item.icon || "📦")}</text>`}
        <text class="fur-label" x="0" y="${Math.min(h, w)/2 - 6}" fill="${labelFill}" stroke="${labelStroke}" stroke-width=".5" paint-order="stroke">${esc(item.name)}</text>
      </g>
    </g>`;
}

function findItem(groupId, itemId) {
  const group = allGroups().find(g => g.id === groupId);
  if (!group) return null;
  return group.items.find(i => i.id === itemId);
}

// ---------- Collision detection (OBB/SAT) ----------
function detectCollisions(items) {
  const collisions = new Set();
  const boxes = items.map(inst => {
    const item = findItem(inst.groupId, inst.itemId);
    if (!item) return null;
    return obb(inst.x, inst.y, item.w, item.h, inst.rotation || 0, inst.instId);
  }).filter(Boolean);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (obbOverlap(boxes[i], boxes[j])) {
        collisions.add(boxes[i].id);
        collisions.add(boxes[j].id);
      }
    }
  }
  return collisions;
}
function obb(cx, cy, w, h, angleDeg, id) {
  const a = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(a), sin = Math.sin(a);
  const hx = w / 2, hy = h / 2;
  const corners = [
    [+hx, +hy], [-hx, +hy], [-hx, -hy], [+hx, -hy]
  ].map(([x, y]) => [cx + x * cos - y * sin, cy + x * sin + y * cos]);
  return { id, corners, axes: [[cos, sin], [-sin, cos]] };
}
function obbOverlap(a, b) {
  const axes = [...a.axes, ...b.axes];
  for (const [ax, ay] of axes) {
    let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
    for (const [x, y] of a.corners) { const p = x * ax + y * ay; if (p < aMin) aMin = p; if (p > aMax) aMax = p; }
    for (const [x, y] of b.corners) { const p = x * ax + y * ay; if (p < bMin) bMin = p; if (p > bMax) bMax = p; }
    if (aMax < bMin - 0.5 || bMax < aMin - 0.5) return false; // small epsilon to avoid float false positives
  }
  return true;
}
function setCollisionIndicator(n) {
  const el = document.getElementById("collision-indicator");
  if (!el) return;
  if (n === 0) {
    el.className = "collision-none";
    el.textContent = "لا تداخل";
  } else {
    el.className = "collision-warn";
    el.textContent = `⚠ ${n} متداخلة`;
  }
}

// ---------- Door clearance: detect items blocking doors / windows ----------
// For each opening, build a clearance rectangle inside the room (door swing
// area for doors, smaller buffer for windows). Any item whose OBB overlaps
// that rectangle is flagged as "blocking".
const DOOR_CLEARANCE_DEPTH = 80;   // cm in front of a door
const WINDOW_CLEARANCE_DEPTH = 25; // cm in front of a window (lighter buffer)
function clearanceRectForOpening(room, op) {
  const depth = op.kind === "door" ? DOOR_CLEARANCE_DEPTH : WINDOW_CLEARANCE_DEPTH;
  const t = WALL_THICKNESS;
  // Each rect is described as { x, y, w, h } in room-local coordinates
  // (i.e. relative to room origin, not SVG_PADDING).
  switch (op.wall) {
    case "top":    return { x: op.at,                  y: 0,                       w: op.size, h: depth };
    case "bottom": return { x: op.at,                  y: room.depth - depth,      w: op.size, h: depth };
    case "left":   return { x: 0,                      y: op.at,                   w: depth,    h: op.size };
    case "right":  return { x: room.width - depth,     y: op.at,                   w: depth,    h: op.size };
  }
  return null;
}
function rectAsObb(r) {
  // Axis-aligned rect → OBB structure for obbOverlap()
  return obb(r.x + r.w/2, r.y + r.h/2, r.w, r.h, 0, "_clearance");
}
function detectDoorBlocks(room, items) {
  const blocked = new Set();
  const violated = []; // openings whose clearance is violated (for highlight)
  if (!room || !room.openings || !room.openings.length) return { blocked, violated };
  const itemBoxes = items.map(inst => {
    const item = findItem(inst.groupId, inst.itemId);
    if (!item) return null;
    return { inst, box: obb(inst.x, inst.y, item.w, item.h, inst.rotation || 0, inst.instId) };
  }).filter(Boolean);
  for (const op of room.openings) {
    const r = clearanceRectForOpening(room, op);
    if (!r) continue;
    const clearance = rectAsObb(r);
    let hit = false;
    for (const { inst, box } of itemBoxes) {
      if (obbOverlap(clearance, box)) { blocked.add(inst.instId); hit = true; }
    }
    if (hit) violated.push(op);
  }
  return { blocked, violated };
}
function setBlockedIndicator(n) {
  const el = document.getElementById("blocked-indicator");
  if (!el) return;
  if (n === 0) {
    el.className = "blocked-none";
    el.textContent = "🚪 سالك";
    el.title = "لا توجد قطع تحجب الأبواب أو الشبابيك";
  } else {
    el.className = "blocked-warn";
    el.textContent = `🚪 ${n} يحجب`;
    el.title = `${n} قطعة تحجب باب أو شباك — أبعدها`;
  }
}
function renderDoorClearances(room, violatedOpenings) {
  if (!room || !room.openings) return "";
  const ox = SVG_PADDING, oy = SVG_PADDING;
  const violatedSet = new Set(violatedOpenings.map(o => `${o.wall}|${o.at}|${o.size}|${o.kind}`));
  return room.openings.map(op => {
    const r = clearanceRectForOpening(room, op);
    if (!r) return "";
    const isViolated = violatedSet.has(`${op.wall}|${op.at}|${op.size}|${op.kind}`);
    if (op.kind !== "door" && !isViolated) return ""; // only show window clearance when violated
    const cls = "door-clearance" + (isViolated ? " violated" : "");
    return `<rect class="${cls}" x="${ox + r.x}" y="${oy + r.y}" width="${r.w}" height="${r.h}" rx="2" />`;
  }).join("");
}

// ---------- Touch drag from catalog (mobile) ----------
// HTML5 drag-and-drop does not fire on most touch devices, so we wire up a
// custom touch-based flow: long-press / move on a .cat-item creates a floating
// ghost that follows the finger; release over the room SVG drops the item.
function bindCatalogTouchDrag() {
  const cat = document.getElementById("furniture-catalog");
  if (!cat) return;
  let active = null; // { el, ghost, groupId, itemId, startX, startY, moved }
  const DRAG_THRESHOLD = 6;

  cat.addEventListener("touchstart", (e) => {
    if (e.touches.length !== 1) return;
    const item = e.target.closest(".cat-item");
    if (!item) return;
    if (e.target.closest(".cat-del") || e.target.closest(".cat-edit")) return;
    const t = e.touches[0];
    active = {
      el: item,
      ghost: null,
      groupId: item.dataset.groupId,
      itemId: item.dataset.itemId,
      startX: t.clientX,
      startY: t.clientY,
      moved: false,
    };
  }, { passive: true });

  document.addEventListener("touchmove", (e) => {
    if (!active) return;
    const t = e.touches[0];
    const dx = t.clientX - active.startX;
    const dy = t.clientY - active.startY;
    if (!active.moved && Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
    if (!active.moved) {
      active.moved = true;
      active.ghost = active.el.cloneNode(true);
      active.ghost.classList.add("cat-item--dragging");
      const rect = active.el.getBoundingClientRect();
      active.ghost.style.width = rect.width + "px";
      document.body.appendChild(active.ghost);
    }
    e.preventDefault(); // stop page scrolling while dragging
    active.ghost.style.left = (t.clientX - 40) + "px";
    active.ghost.style.top = (t.clientY - 30) + "px";
  }, { passive: false });

  document.addEventListener("touchend", () => {
    if (!active) return;
    const a = active;
    active = null;
    if (!a.ghost) return;
    const rect = a.ghost.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    a.ghost.remove();
    // Find element under the drop point, ignoring the ghost itself
    const target = document.elementFromPoint(cx, cy);
    const room = getRoom();
    if (!room) return;
    // 2D: dropped onto the room SVG
    const svg = target && target.closest ? target.closest("svg.room-svg") : null;
    if (svg) {
      const pt = svgPointInRoom(svg, cx, cy);
      addItemAtRoomCoords(room, a.groupId, a.itemId, pt.x - SVG_PADDING, pt.y - SVG_PADDING);
      return;
    }
    // 3D: dropped onto the Three.js canvas inside the 3D wrap
    const threeWrap = target && target.closest ? target.closest(".three-wrap") : null;
    if (threeWrap && window.AptThreeView && window.AptThreeView.isActiveFor(room.id)) {
      const pt3 = window.AptThreeView.screenToRoomCoords(cx, cy);
      if (pt3) addItemAtRoomCoords(room, a.groupId, a.itemId, pt3.x, pt3.y);
    }
  });

  document.addEventListener("touchcancel", () => {
    if (active && active.ghost) active.ghost.remove();
    active = null;
  });
}

// ---------- Shared: add a new inst at room coordinates ----------
// Used by 2D drop (via setupDrop), catalog touch drop, and 3D drop.
function addItemAtRoomCoords(room, groupId, itemId, rawX, rawY) {
  const item = findItem(groupId, itemId);
  if (!item) return null;
  const x = clamp(snap(rawX), item.w / 2, room.width - item.w / 2);
  const y = clamp(snap(rawY), item.h / 2, room.depth - item.h / 2);
  pushHistory();
  const inst = {
    instId: "i_" + Math.random().toString(36).slice(2, 9),
    groupId, itemId, x, y, rotation: 0
  };
  state.layouts[room.id] = state.layouts[room.id] || [];
  state.layouts[room.id].push(inst);
  state.selectedInstId = inst.instId;
  saveLayouts();
  drawRoom();
  renderSelection();
  renderRoomList();
  return inst;
}

// ---------- Drag & drop from catalog ----------
function setupDrop(svg, room) {
  svg.addEventListener("dragover", e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
  });
  svg.addEventListener("drop", e => {
    e.preventDefault();
    const data = e.dataTransfer.getData("text/apt-item");
    if (!data) return;
    const { groupId, itemId } = JSON.parse(data);
    const item = findItem(groupId, itemId);
    if (!item) return;
    const pt = svgPointInRoom(svg, e.clientX, e.clientY);
    const x = clamp(snap(pt.x - SVG_PADDING), item.w/2, room.width - item.w/2);
    const y = clamp(snap(pt.y - SVG_PADDING), item.h/2, room.depth - item.h/2);
    pushHistory();
    const inst = {
      instId: "i_" + Math.random().toString(36).slice(2, 9),
      groupId, itemId, x, y, rotation: 0
    };
    state.layouts[room.id].push(inst);
    state.selectedInstId = inst.instId;
    saveLayouts();
    drawRoom();
    renderSelection();
    renderRoomList();
  });
}

function svgPointInRoom(svg, clientX, clientY) {
  // Convert screen -> svg viewport coords, then undo the viewport transform.
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  const raw = pt.matrixTransform(svg.getScreenCTM().inverse());
  const vbW = svg.viewBox.baseVal.width;
  const vbH = svg.viewBox.baseVal.height;
  const { scale, tx, ty } = state.view;
  const cx = vbW / 2, cy = vbH / 2;
  // inverse of translate(cx+tx, cy+ty) scale(s) translate(-cx, -cy)
  return {
    x: (raw.x - cx - tx) / scale + cx,
    y: (raw.y - cy - ty) / scale + cy,
  };
}
function snap(v) { return Math.round(v / GRID_SNAP) * GRID_SNAP; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Escape user-controlled strings before inlining them into innerHTML / SVG
// templates. Rooms, items, and layouts can be seeded from URL share payloads,
// so we sanitize every string that reaches the DOM via innerHTML.
function esc(s) {
  if (s == null) return "";
  const d = document.createElement("div");
  d.textContent = String(s);
  return d.innerHTML;
}
// Validate a CSS color — allow only #rgb/#rrggbb hex to avoid CSS injection
// via share URLs. Falls back to a neutral color when the input is invalid.
function safeColor(c, fallback = "#888") {
  if (typeof c !== "string") return fallback;
  return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c.trim()) ? c.trim() : fallback;
}

// ---------- Furniture interactions: move/select ----------
function setupFurnitureInteractions(svg, room) {
  svg.addEventListener("mousedown", onDown);
  svg.addEventListener("touchstart", onDown, { passive: false });

  function onDown(e) {
    // Middle-button is reserved for pan.
    if (e.button === 1) return;
    const g = e.target.closest(".furniture");
    // Shift+click on empty canvas falls through to setupZoomPan (panning).
    if (e.shiftKey && e.button === 0 && !g) return;
    if (!g) {
      // Click on empty canvas clears single + multi selection.
      if (state.selectedInstId !== null || state.selectedInstIds.size) {
        state.selectedInstId = null;
        state.selectedInstIds.clear();
        drawRoom();
        renderSelection();
      }
      return;
    }
    const instId = g.dataset.instId;
    // Shift+click on a furniture node toggles multi-selection without dragging.
    if (e.shiftKey && e.button === 0) {
      e.preventDefault();
      if (state.selectedInstIds.has(instId)) {
        state.selectedInstIds.delete(instId);
        if (state.selectedInstId === instId) {
          state.selectedInstId = state.selectedInstIds.size
            ? [...state.selectedInstIds][state.selectedInstIds.size - 1]
            : null;
        }
      } else {
        // Carry the previously focused item into the set so the first
        // shift+click after a normal click extends rather than replaces.
        if (state.selectedInstId && !state.selectedInstIds.has(state.selectedInstId)) {
          state.selectedInstIds.add(state.selectedInstId);
        }
        state.selectedInstIds.add(instId);
        state.selectedInstId = instId;
      }
      drawRoom();
      renderSelection();
      return;
    }
    const prevSelected = state.selectedInstId;
    state.selectedInstId = instId;
    // Plain (non-shift) click on furniture clears the multi-selection unless
    // the user clicked an item already in the set (then keep the set so they
    // can drag the lead item without losing selection).
    if (!state.selectedInstIds.has(instId)) state.selectedInstIds.clear();
    renderSelection();
    if (prevSelected !== instId) {
      document.querySelectorAll(".furniture.selected").forEach(n => n.classList.remove("selected"));
      g.classList.add("selected");
    }

    const inst = state.layouts[room.id].find(i => i.instId === instId);
    if (!inst) return;
    const item = findItem(inst.groupId, inst.itemId);
    const startPt = svgPointInRoom(svg, e.touches ? e.touches[0].clientX : e.clientX, e.touches ? e.touches[0].clientY : e.clientY);
    const startX = inst.x, startY = inst.y;
    let moved = false;
    const preSnapshot = snapshot();

    // Snapshot initial positions of all multi-selected items so we can move
    // the whole group together when the dragged item is in the set.
    const groupDrag = state.selectedInstIds && state.selectedInstIds.has(instId)
      && state.selectedInstIds.size > 1;
    const groupItems = groupDrag
      ? state.layouts[room.id].filter(i => state.selectedInstIds.has(i.instId) && i.instId !== instId)
        .map(o => ({ inst: o, sx: o.x, sy: o.y }))
      : [];

    function onMove(ev) {
      ev.preventDefault();
      const p = svgPointInRoom(svg, ev.touches ? ev.touches[0].clientX : ev.clientX, ev.touches ? ev.touches[0].clientY : ev.clientY);
      let dx = p.x - startPt.x;
      let dy = p.y - startPt.y;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) moved = true;
      const rot0 = (inst.rotation || 0) % 180;
      const effW0 = rot0 === 90 ? item.h : item.w;
      const effH0 = rot0 === 90 ? item.w : item.h;
      let nx = clamp(snap(startX + dx), effW0/2, room.width  - effW0/2);
      let ny = clamp(snap(startY + dy), effH0/2, room.depth  - effH0/2);

      const altSnap = ev.altKey || ev.metaKey;
      let snappedRotation = inst.rotation || 0;

      // --- Wall snap (Alt+drag): choose nearest wall, align item flush to it ---
      if (altSnap) {
        const dT = ny - effH0/2;                    // distance from top wall
        const dB = (room.depth - ny) - effH0/2;     // bottom
        const dL = nx - effW0/2;                    // left
        const dR = (room.width - nx) - effW0/2;     // right
        const min = Math.min(dT, dB, dL, dR);
        // Pick snappedRotation first, then compute effective dims for THAT rotation
        // so the item ends up flush with the wall (previous code used pre-rotation dims).
        if      (min === dT) snappedRotation = 0;
        else if (min === dB) snappedRotation = 180;
        else if (min === dL) snappedRotation = 90;
        else                 snappedRotation = 270;
        const snapRotMod = snappedRotation % 180;
        const effWSnap = snapRotMod === 90 ? item.h : item.w;
        const effHSnap = snapRotMod === 90 ? item.w : item.h;
        if      (snappedRotation === 0)   ny = effHSnap/2;
        else if (snappedRotation === 180) ny = room.depth - effHSnap/2;
        else if (snappedRotation === 90)  nx = effWSnap/2;
        else                              nx = room.width - effWSnap/2;
      }

      // --- Alignment guides: snap to other items' centers/edges within 6cm ---
      const guides = [];
      const SNAP_TOL = 6; // cm
      const others = (state.layouts[room.id] || []).filter(i => i.instId !== instId);
      others.forEach(o => {
        const oi = findItem(o.groupId, o.itemId);
        if (!oi) return;
        const or = (o.rotation || 0) % 180;
        const ow = or === 90 ? oi.h : oi.w;
        const oh = or === 90 ? oi.w : oi.h;
        // Vertical guides (match x centers)
        if (Math.abs(nx - o.x) < SNAP_TOL) { nx = o.x; guides.push({ x: o.x, vert: true }); }
        // Left edges
        if (Math.abs((nx - effW0/2) - (o.x - ow/2)) < SNAP_TOL) { nx = o.x - ow/2 + effW0/2; guides.push({ x: o.x - ow/2, vert: true }); }
        // Right edges
        if (Math.abs((nx + effW0/2) - (o.x + ow/2)) < SNAP_TOL) { nx = o.x + ow/2 - effW0/2; guides.push({ x: o.x + ow/2, vert: true }); }
        // Horizontal guides (match y centers)
        if (Math.abs(ny - o.y) < SNAP_TOL) { ny = o.y; guides.push({ y: o.y, vert: false }); }
        if (Math.abs((ny - effH0/2) - (o.y - oh/2)) < SNAP_TOL) { ny = o.y - oh/2 + effH0/2; guides.push({ y: o.y - oh/2, vert: false }); }
        if (Math.abs((ny + effH0/2) - (o.y + oh/2)) < SNAP_TOL) { ny = o.y + oh/2 - effH0/2; guides.push({ y: o.y + oh/2, vert: false }); }
      });

      inst.x = nx;
      inst.y = ny;
      if (snappedRotation !== (inst.rotation || 0)) inst.rotation = snappedRotation;
      // Re-clamp using possibly-new rotation
      const rot2 = (inst.rotation || 0) % 180;
      const effW = rot2 === 90 ? item.h : item.w;
      const effH = rot2 === 90 ? item.w : item.h;
      inst.x = clamp(inst.x, effW/2, room.width  - effW/2);
      inst.y = clamp(inst.y, effH/2, room.depth  - effH/2);

      const g2 = svg.querySelector(`.furniture[data-inst-id="${instId}"]`);
      if (g2) g2.setAttribute("transform", `translate(${SVG_PADDING + inst.x} ${SVG_PADDING + inst.y}) rotate(${inst.rotation || 0})`);
      // Apply same delta to other multi-selected items (no Alt-snap or guides).
      if (groupItems.length) {
        const realDx = inst.x - startX;
        const realDy = inst.y - startY;
        groupItems.forEach(({ inst: o, sx, sy }) => {
          const oi = findItem(o.groupId, o.itemId);
          if (!oi) return;
          const or = (o.rotation || 0) % 180;
          const ow = or === 90 ? oi.h : oi.w;
          const oh = or === 90 ? oi.w : oi.h;
          o.x = clamp(snap(sx + realDx), ow/2, room.width  - ow/2);
          o.y = clamp(snap(sy + realDy), oh/2, room.depth  - oh/2);
          const og = svg.querySelector(`.furniture[data-inst-id="${o.instId}"]`);
          if (og) og.setAttribute("transform", `translate(${SVG_PADDING + o.x} ${SVG_PADDING + o.y}) rotate(${o.rotation || 0})`);
        });
      }
      drawAlignGuides(svg, guides, room);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
      drawAlignGuides(svg, [], room); // clear
      if (moved) {
        // push the pre-drag state to history so undo reverts the drag
        state.history.push(preSnapshot);
        if (state.history.length > HISTORY_LIMIT) state.history.shift();
        state.future.length = 0;
        saveLayouts();
        drawRoom();
        renderSelection();
        updateUndoRedoButtons();
      }
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }
}

// ---------- Zoom & Pan ----------
function setupZoomPan(svg, container) {
  // Wheel zoom (Ctrl or plain wheel both supported)
  svg.addEventListener("wheel", e => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    zoomAt(svg, e.clientX, e.clientY, factor);
  }, { passive: false });

  // Middle-mouse or Shift+drag pan.
  // Shift+click on a furniture node is reserved for multi-select; only treat
  // shift+drag on empty canvas as pan.
  let panning = null;
  svg.addEventListener("mousedown", e => {
    const onFurniture = e.target.closest(".furniture");
    const shouldPan = e.button === 1 || (e.button === 0 && e.shiftKey && !onFurniture);
    if (!shouldPan) return;
    e.preventDefault();
    panning = { startX: e.clientX, startY: e.clientY, tx: state.view.tx, ty: state.view.ty };
    container.classList.add("panning");
  });
  document.addEventListener("mousemove", e => {
    if (!panning) return;
    const dx = e.clientX - panning.startX;
    const dy = e.clientY - panning.startY;
    // Convert client-space drag to viewBox-space
    const ctm = svg.getScreenCTM();
    if (!ctm) return;
    const scaleX = ctm.a, scaleY = ctm.d;
    state.view.tx = panning.tx + dx / scaleX;
    state.view.ty = panning.ty + dy / scaleY;
    applyViewportTransform(svg);
  });
  document.addEventListener("mouseup", () => {
    if (panning) {
      panning = null;
      container.classList.remove("panning");
    }
  });

  // Spacebar pan-ready cursor
  document.addEventListener("keydown", e => {
    if (e.code === "Space") container.classList.add("pan-ready");
  });
  document.addEventListener("keyup", e => {
    if (e.code === "Space") container.classList.remove("pan-ready");
  });
}
function zoomAt(svg, clientX, clientY, factor) {
  const prev = state.view.scale;
  const next = clamp(prev * factor, ZOOM_MIN, ZOOM_MAX);
  if (next === prev) return;
  // Keep the point under the cursor stable while zooming
  const vbW = svg.viewBox.baseVal.width;
  const vbH = svg.viewBox.baseVal.height;
  const cx = vbW / 2, cy = vbH / 2;
  const rawPt = svgRawPoint(svg, clientX, clientY);
  const beforeX = (rawPt.x - cx - state.view.tx) / prev;
  const beforeY = (rawPt.y - cy - state.view.ty) / prev;
  state.view.scale = next;
  state.view.tx = rawPt.x - cx - beforeX * next;
  state.view.ty = rawPt.y - cy - beforeY * next;
  applyViewportTransform(svg);
}
function svgRawPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX; pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function applyViewportTransform(svg) {
  const vbW = svg.viewBox.baseVal.width;
  const vbH = svg.viewBox.baseVal.height;
  const vp = svg.querySelector("#viewport");
  if (vp) vp.setAttribute("transform", viewportTransform(vbW, vbH));
  updateZoomLabel();
}
function updateZoomLabel() {
  const el = document.getElementById("zoom-level");
  if (el) el.textContent = Math.round(state.view.scale * 100) + "%";
}
function bindViewControls() {
  document.getElementById("btn-zoom-in").addEventListener("click", () => programmaticZoom(ZOOM_STEP));
  document.getElementById("btn-zoom-out").addEventListener("click", () => programmaticZoom(1 / ZOOM_STEP));
  document.getElementById("btn-zoom-fit").addEventListener("click", fitView);
}
function programmaticZoom(factor) {
  const svg = document.querySelector(".room-svg");
  if (!svg) return;
  const rect = svg.getBoundingClientRect();
  zoomAt(svg, rect.left + rect.width/2, rect.top + rect.height/2, factor);
}
function fitView() {
  state.view = { scale: 1, tx: 0, ty: 0 };
  const svg = document.querySelector(".room-svg");
  if (svg) applyViewportTransform(svg);
}

// ---------- Selection details panel ----------
function renderSelection() {
  const panel = document.getElementById("selection-info");
  if (!state.activeRoomId) {
    panel.className = "empty";
    panel.textContent = "اختر قطعة لعرض تفاصيلها";
    return;
  }
  // Multi-selection summary panel
  if (state.selectedInstIds && state.selectedInstIds.size > 1) {
    panel.className = "";
    const ids = [...state.selectedInstIds];
    const items = (state.layouts[state.activeRoomId] || []).filter(i => ids.includes(i.instId));
    const cost = items.reduce((s, i) => s + priceFor(i), 0);
    panel.innerHTML = `
      <div class="sel-row"><span>محدّد</span><b>${items.length} قطعة</b></div>
      <div class="sel-row"><span>الإجمالي</span><b>${cost ? Number(cost).toLocaleString("ar-EG") + " ج.م" : "—"}</b></div>
      <div class="sel-actions">
        <button class="btn" data-multi-action="rotate"    title="دوران 90° للجميع">⟳ 90°</button>
        <button class="btn" data-multi-action="duplicate" title="تكرار الجميع">📋 تكرار</button>
        <button class="btn danger" data-multi-action="delete" title="حذف الجميع (Del)">✕ حذف</button>
        <button class="btn ghost" data-multi-action="clear" title="إلغاء التحديد">إلغاء</button>
      </div>
      <small class="hint" style="display:block;margin-top:8px">Shift+Click على قطعة لإضافتها/إزالتها من التحديد</small>
    `;
    panel.querySelectorAll("[data-multi-action]").forEach(btn => {
      btn.addEventListener("click", () => handleMultiAction(btn.dataset.multiAction));
    });
    return;
  }
  if (!state.selectedInstId) {
    panel.className = "empty";
    panel.textContent = "اختر قطعة لعرض تفاصيلها";
    return;
  }
  const inst = state.layouts[state.activeRoomId].find(i => i.instId === state.selectedInstId);
  if (!inst) {
    panel.className = "empty";
    panel.textContent = "اختر قطعة لعرض تفاصيلها";
    return;
  }
  const item = findItem(inst.groupId, inst.itemId);
  panel.className = "";
  const curPrice = priceFor(inst);
  const priceReadOnly = item.price != null;  // custom items carry price; don't edit here
  panel.innerHTML = `
    <div class="sel-row"><span>الاسم</span><b>${esc(item.icon || "📦")} ${esc(item.name)}</b></div>
    <div class="sel-row"><span>الأبعاد</span><b>${fmtPair(Number(item.w) || 0, Number(item.h) || 0)}</b></div>
    <div class="sel-row"><span>الموقع</span><b>X: ${fmtCm(Number(inst.x) || 0)} , Y: ${fmtCm(Number(inst.y) || 0)}</b></div>
    <div class="sel-row">
      <span>الدوران</span>
      <input class="rot-input" type="number" min="0" max="359" step="15" value="${inst.rotation || 0}" aria-label="زاوية الدوران" />
    </div>
    <div class="sel-row">
      <span>الارتفاع عن الأرض <small>سم</small></span>
      <input class="lift-input" type="number" min="0" max="280" step="5" value="${Number(inst.liftedZ) || 0}" aria-label="الارتفاع عن الأرض" title="ارفع القطعة عن الأرض (مثال: لوحة على الحائط، رفّ معلَّق)" />
    </div>
    <div class="sel-row">
      <span>السعر <small>ج.م</small></span>
      <input class="price-input" type="number" min="0" step="10" value="${curPrice || ""}" placeholder="0" aria-label="السعر" ${priceReadOnly ? "disabled" : ""} />
    </div>
    <div class="sel-actions">
      <button class="btn" data-action="rotate"      title="دوران 90° (R)">⟳ 90°</button>
      <button class="btn" data-action="rotate-fine" title="دوران 15° (Shift+R)">⟳ 15°</button>
      <button class="btn" data-action="duplicate"   title="تكرار (D)">📋 تكرار</button>
      <button class="btn" data-action="front"       title="للأمام">⬆</button>
      <button class="btn" data-action="back"        title="للخلف">⬇</button>
      <button class="btn danger" data-action="delete" title="حذف (Del)">✕ حذف</button>
    </div>
  `;
  const priceInput = panel.querySelector(".price-input");
  if (priceInput && !priceReadOnly) {
    priceInput.addEventListener("change", () => {
      const v = parseInt(priceInput.value, 10) || 0;
      setPrice(inst, v);
      updateRoomStats(getRoom(), state.layouts[state.activeRoomId] || []);
    });
  }
  panel.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleSelAction(btn.dataset.action, inst));
  });
  const rotInput = panel.querySelector(".rot-input");
  rotInput.addEventListener("change", () => {
    const v = parseInt(rotInput.value, 10);
    if (!Number.isFinite(v)) return;
    pushHistory();
    inst.rotation = ((v % 360) + 360) % 360;
    fitWithinRoom(inst);
    saveLayouts();
    drawRoom();
    renderSelection();
  });
  const liftInput = panel.querySelector(".lift-input");
  if (liftInput) {
    liftInput.addEventListener("change", () => {
      const v = parseInt(liftInput.value, 10);
      if (!Number.isFinite(v)) return;
      pushHistory();
      inst.liftedZ = Math.max(0, Math.min(280, v));
      saveLayouts();
      drawRoom();
      renderSelection();
    });
  }
}

function fitWithinRoom(inst) {
  const room = getRoom();
  if (!room) return;
  const item = findItem(inst.groupId, inst.itemId);
  const rot = (inst.rotation || 0) % 180;
  const effW = rot === 90 ? item.h : item.w;
  const effH = rot === 90 ? item.w : item.h;
  inst.x = clamp(inst.x, effW/2, room.width  - effW/2);
  inst.y = clamp(inst.y, effH/2, room.depth  - effH/2);
}

function handleMultiAction(action) {
  const room = getRoom();
  if (!room) return;
  const items = state.layouts[room.id];
  if (!items) return;
  const ids = [...state.selectedInstIds];
  if (!ids.length) return;
  const targets = items.filter(i => ids.includes(i.instId));
  if (!targets.length) return;
  pushHistory();
  if (action === "rotate") {
    targets.forEach(t => { t.rotation = ((t.rotation || 0) + 90) % 360; fitWithinRoom(t); });
  } else if (action === "duplicate") {
    const newIds = [];
    targets.forEach(t => {
      const copy = { ...t, instId: "i_" + Math.random().toString(36).slice(2, 9), x: t.x + 30, y: t.y + 30 };
      fitWithinRoom(copy);
      items.push(copy);
      newIds.push(copy.instId);
    });
    state.selectedInstIds = new Set(newIds);
    state.selectedInstId = newIds[newIds.length - 1] || null;
  } else if (action === "delete") {
    const toDelete = new Set(ids);
    state.layouts[room.id] = items.filter(i => !toDelete.has(i.instId));
    state.selectedInstIds.clear();
    state.selectedInstId = null;
  } else if (action === "clear") {
    state.selectedInstIds.clear();
    if (state.selectedInstId && !ids.includes(state.selectedInstId)) {
      // keep focused item
    }
  }
  saveLayouts();
  drawRoom();
  renderSelection();
  renderRoomList();
}

function handleSelAction(action, inst) {
  const room = getRoom();
  const items = state.layouts[room.id];
  const idx = items.indexOf(inst);
  if (idx === -1) return;
  pushHistory();
  if (action === "rotate") {
    inst.rotation = ((inst.rotation || 0) + 90) % 360;
    fitWithinRoom(inst);
  } else if (action === "rotate-fine") {
    inst.rotation = ((inst.rotation || 0) + 15) % 360;
    fitWithinRoom(inst);
  } else if (action === "duplicate") {
    const copy = { ...inst, instId: "i_" + Math.random().toString(36).slice(2, 9), x: inst.x + 30, y: inst.y + 30 };
    fitWithinRoom(copy);
    items.push(copy);
    state.selectedInstId = copy.instId;
  } else if (action === "front") {
    if (idx < items.length - 1) { items.splice(idx, 1); items.push(inst); }
  } else if (action === "back") {
    if (idx > 0) { items.splice(idx, 1); items.unshift(inst); }
  } else if (action === "delete") {
    items.splice(idx, 1);
    state.selectedInstId = null;
  }
  saveLayouts();
  drawRoom();
  renderSelection();
  renderRoomList();
}

// ---------- Global keyboard shortcuts ----------
function bindGlobalKeys() {
  document.addEventListener("keydown", e => {
    const target = e.target;
    const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);

    // Undo/Redo (Ctrl/Cmd)
    if ((e.ctrlKey || e.metaKey) && !typing) {
      const k = e.key.toLowerCase();
      if (k === "z" && !e.shiftKey) { e.preventDefault(); undo(); return; }
      if (k === "y" || (k === "z" && e.shiftKey)) { e.preventDefault(); redo(); return; }
    }

    if (typing) return;

    // In walkthrough mode the scene owns movement keys (WASD, arrows, space,
    // shift). Also skip the editing shortcuts (D duplicate, R rotate, Delete,
    // M measure, F fit) so strafing/running/etc. don't accidentally mutate
    // or rebuild the scene. Only `?` (help) still works in walk mode, handled
    // before this guard if we ever want it.
    if (state.viewMode === "walk") {
      if (e.key === "?" || (e.shiftKey && e.key === "/")) {
        e.preventDefault(); toggleHelpModal(true);
      }
      return;
    }

    // Fit view
    if (e.key === "f" || e.key === "F") { e.preventDefault(); fitView(); return; }
    // Zoom keyboard
    if (e.key === "+" || e.key === "=") { e.preventDefault(); programmaticZoom(ZOOM_STEP); return; }
    if (e.key === "-" || e.key === "_") { e.preventDefault(); programmaticZoom(1 / ZOOM_STEP); return; }
    // Help overlay
    if (e.key === "?" || (e.shiftKey && e.key === "/")) { e.preventDefault(); toggleHelpModal(true); return; }
    // Measure tool
    if (e.key === "m" || e.key === "M") { e.preventDefault(); toggleMeasure(); return; }
    // Copy/Paste & Select All (Ctrl)
    if (e.ctrlKey || e.metaKey) {
      const k = e.key.toLowerCase();
      if (k === "c") { e.preventDefault(); copySelection(); return; }
      if (k === "v") { e.preventDefault(); pasteClipboard(); return; }
      if (k === "a") { e.preventDefault(); selectAll(); return; }
    }
    // Escape: clear selection / close modals. Skip drawRoom rebuild in 3D/walk
    // modes so Three.js controls (OrbitControls, PointerLockControls) can
    // handle Escape without destroying the scene.
    if (e.key === "Escape") {
      closeAllModals();
      if (state.viewMode === "walk" || state.viewMode === "3d") return;
      state.selectedInstId = null;
      state.selectedInstIds.clear();
      state.measure = { active: false, p1: null, p2: null };
      drawRoom();
      renderSelection();
      return;
    }

    // Multi-selection shortcuts (>1 selected): operate on the whole set first.
    const multi = state.selectedInstIds && state.selectedInstIds.size > 1;
    if (multi) {
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); handleMultiAction("delete"); return; }
      if (e.key === "r" || e.key === "R") { e.preventDefault(); handleMultiAction("rotate"); return; }
      if (e.key === "d" || e.key === "D") { e.preventDefault(); handleMultiAction("duplicate"); return; }
      if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
        e.preventDefault();
        const step = e.shiftKey ? 25 : GRID_SNAP;
        const room = getRoom();
        if (!room) return;
        const items = state.layouts[room.id] || [];
        const ids = state.selectedInstIds;
        const targets = items.filter(i => ids.has(i.instId));
        pushHistory();
        targets.forEach(inst => {
          if (e.key === "ArrowLeft")  inst.x -= step;
          if (e.key === "ArrowRight") inst.x += step;
          if (e.key === "ArrowUp")    inst.y -= step;
          if (e.key === "ArrowDown")  inst.y += step;
          fitWithinRoom(inst);
        });
        saveLayouts();
        drawRoom();
        renderSelection();
        return;
      }
    }

    // Selected-item shortcuts
    if (!state.selectedInstId || !state.activeRoomId) return;
    const inst = state.layouts[state.activeRoomId].find(i => i.instId === state.selectedInstId);
    if (!inst) return;
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); handleSelAction("delete", inst); }
    else if (e.key === "r" || e.key === "R") {
      e.preventDefault();
      handleSelAction(e.shiftKey ? "rotate-fine" : "rotate", inst);
    }
    else if (e.key === "d" || e.key === "D") { e.preventDefault(); handleSelAction("duplicate", inst); }
    // Arrow keys nudge by 5cm (shift = 25cm)
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      e.preventDefault();
      const step = e.shiftKey ? 25 : GRID_SNAP;
      pushHistory();
      if (e.key === "ArrowLeft")  inst.x -= step;
      if (e.key === "ArrowRight") inst.x += step;
      if (e.key === "ArrowUp")    inst.y -= step;
      if (e.key === "ArrowDown")  inst.y += step;
      fitWithinRoom(inst);
      saveLayouts();
      drawRoom();
      renderSelection();
    }
  });
}

// ==========================================================================
// Clipboard (Ctrl+C / Ctrl+V across rooms)
// ==========================================================================
function copySelection() {
  if (!state.activeRoomId || !state.selectedInstId) { toast("لا يوجد تحديد للنسخ", "warn"); return; }
  const inst = (state.layouts[state.activeRoomId] || []).find(i => i.instId === state.selectedInstId);
  if (!inst) return;
  state.clipboard = JSON.parse(JSON.stringify(inst));
  toast("تم النسخ — Ctrl+V للصق");
}
function pasteClipboard() {
  if (!state.clipboard) { toast("الحافظة فارغة", "warn"); return; }
  if (!state.activeRoomId) { toast("اختر غرفة أولاً", "warn"); return; }
  const room = getRoom();
  pushHistory();
  const arr = state.layouts[room.id] || (state.layouts[room.id] = []);
  const copy = {
    ...state.clipboard,
    instId: "i_" + Math.random().toString(36).slice(2, 9),
    x: (state.clipboard.x || room.width / 2) + 40,
    y: (state.clipboard.y || room.depth / 2) + 40,
  };
  fitWithinRoom(copy);
  arr.push(copy);
  state.selectedInstId = copy.instId;
  saveLayouts();
  drawRoom();
  renderSelection();
  renderRoomList();
  toast("تم اللصق");
}
function selectAll() {
  if (!state.activeRoomId) return;
  const items = state.layouts[state.activeRoomId] || [];
  state.selectedInstIds = new Set(items.map(i => i.instId));
  state.selectedInstId = items.length ? items[items.length - 1].instId : null;
  drawRoom();
  renderSelection();
}

// ==========================================================================
// Undo/Redo button state
// ==========================================================================
function updateUndoRedoButtons() {
  const u = document.getElementById("btn-undo");
  const r = document.getElementById("btn-redo");
  if (u) u.disabled = state.history.length === 0;
  if (r) r.disabled = state.future.length === 0;
}

// ==========================================================================
// Close any visible modal
// ==========================================================================
function closeAllModals() {
  ["custom-modal", "room-modal", "help-modal", "layouts-modal"].forEach(id => {
    const m = document.getElementById(id);
    if (m) m.hidden = true;
  });
}

// ==========================================================================
// Room editor modal
// ==========================================================================
function bindRoomModal() {
  const modal = document.getElementById("room-modal");
  const openBtn = document.getElementById("btn-edit-room");
  const closeBtn = document.getElementById("room-modal-close");
  const cancelBtn = document.getElementById("room-modal-cancel");
  const saveBtn = document.getElementById("room-modal-save");
  const resetBtn = document.getElementById("room-modal-reset");
  const addDoorBtn = document.getElementById("re-add-door");
  const addWinBtn = document.getElementById("re-add-window");

  let editingRoomId = null;

  openBtn.addEventListener("click", () => {
    const room = getRoom();
    if (!room) { toast("اختر غرفة أولاً", "warn"); return; }
    editingRoomId = room.id;
    document.getElementById("re-name").value  = room.name;
    document.getElementById("re-w").value     = room.width;
    document.getElementById("re-d").value     = room.depth;
    document.getElementById("re-height").value = room.height || 270;
    document.getElementById("re-wall").value  = room.wallColor || "#cccccc";
    document.getElementById("re-floor").value = room.floorTexture || "default";
    document.getElementById("re-wallmat").value = room.wallTexture || "default";
    document.getElementById("re-error").hidden = true;
    renderOpeningsList(JSON.parse(JSON.stringify(room.openings || [])));
    modal.hidden = false;
  });

  closeBtn.addEventListener("click", () => modal.hidden = true);
  cancelBtn.addEventListener("click", () => modal.hidden = true);
  modal.addEventListener("click", e => { if (e.target === modal) modal.hidden = true; });

  addDoorBtn.addEventListener("click", () => addOpeningRow({ wall: "top", at: 50, size: 90, kind: "door", label: "باب" }));
  addWinBtn.addEventListener("click",  () => addOpeningRow({ wall: "top", at: 50, size: 120, kind: "window", label: "شباك" }));

  resetBtn.addEventListener("click", () => {
    if (!editingRoomId) return;
    if (!confirm("إرجاع الغرفة لأبعادها الافتراضية؟")) return;
    const ov = loadRoomOverrides();
    delete ov[editingRoomId];
    saveRoomOverrides(ov);
    // Reload page so ROOMS reflects defaults cleanly.
    location.reload();
  });

  saveBtn.addEventListener("click", () => {
    if (!editingRoomId) return;
    const name = document.getElementById("re-name").value.trim();
    const w = parseInt(document.getElementById("re-w").value, 10);
    const d = parseInt(document.getElementById("re-d").value, 10);
    const h = parseInt(document.getElementById("re-height").value, 10) || 270;
    if (!name || !(w > 0) || !(d > 0) || !(h >= 200 && h <= 500)) {
      const err = document.getElementById("re-error");
      err.textContent = "تحقق من الأبعاد والاسم (السقف بين 200 و500 سم)";
      err.hidden = false;
      return;
    }
    const wallColor = document.getElementById("re-wall").value;
    const floorTexture = document.getElementById("re-floor").value;
    const wallTexture  = document.getElementById("re-wallmat").value;
    const openings = readOpeningsList();
    const room = ROOMS.find(r => r.id === editingRoomId);
    if (!room) return;
    room.name = name;
    room.width = w;
    room.depth = d;
    room.height = h;
    room.wallColor = wallColor;
    room.floorTexture = floorTexture;
    room.wallTexture = wallTexture;
    room.openings = openings;
    // Persist override
    const ov = loadRoomOverrides();
    ov[editingRoomId] = { name, width: w, depth: d, height: h, wallColor, floorTexture, wallTexture, openings, plan: room.plan };
    saveRoomOverrides(ov);
    modal.hidden = true;
    // Force full 3D rebuild since room geometry changed
    if (window.AptThreeView && window.AptThreeView.isActiveFor(room.id)) window.AptThreeView.hide();
    renderRoomList();
    drawRoom();
    toast("تم حفظ تعديلات الغرفة");
  });
}

function renderOpeningsList(openings) {
  const host = document.getElementById("re-openings");
  host.innerHTML = "";
  openings.forEach(op => addOpeningRow(op));
}
function addOpeningRow(op) {
  const host = document.getElementById("re-openings");
  const row = document.createElement("div");
  row.className = "opening-row";
  row.innerHTML = `
    <select data-k="kind">
      <option value="door" ${op.kind === "door" ? "selected" : ""}>باب</option>
      <option value="window" ${op.kind === "window" ? "selected" : ""}>شباك</option>
    </select>
    <select data-k="wall">
      <option value="top"    ${op.wall === "top"    ? "selected" : ""}>شمال</option>
      <option value="bottom" ${op.wall === "bottom" ? "selected" : ""}>جنوب</option>
      <option value="left"   ${op.wall === "left"   ? "selected" : ""}>غرب</option>
      <option value="right"  ${op.wall === "right"  ? "selected" : ""}>شرق</option>
    </select>
    <label>موضع <input type="number" data-k="at"   min="0" step="5" value="${Number(op.at) || 0}" /></label>
    <label>عرض  <input type="number" data-k="size" min="30" step="5" value="${Number(op.size) || 80}" /></label>
    <button class="btn sm danger" data-k="del">✕</button>
  `;
  row.querySelector('[data-k="del"]').addEventListener("click", () => row.remove());
  host.appendChild(row);
}
function readOpeningsList() {
  const host = document.getElementById("re-openings");
  return Array.from(host.children).map(row => {
    const get = k => row.querySelector(`[data-k="${k}"]`).value;
    return {
      kind: get("kind"),
      wall: get("wall"),
      at: parseInt(get("at"), 10) || 0,
      size: parseInt(get("size"), 10) || 80,
      label: get("kind") === "door" ? "باب" : "شباك",
    };
  });
}

// ==========================================================================
// Help / shortcuts modal
// ==========================================================================
function bindHelpModal() {
  const modal = document.getElementById("help-modal");
  document.getElementById("btn-help").addEventListener("click", () => toggleHelpModal(true));
  document.getElementById("help-modal-close").addEventListener("click", () => toggleHelpModal(false));
  modal.addEventListener("click", e => { if (e.target === modal) toggleHelpModal(false); });
}
function toggleHelpModal(on) {
  document.getElementById("help-modal").hidden = !on;
}

// ==========================================================================
// Named layouts per room (A / B / C savepoints)
// ==========================================================================
function loadNamedLayouts() {
  try { return JSON.parse(localStorage.getItem(NAMED_LAYOUTS_KEY) || "{}"); }
  catch { return {}; }
}
function saveNamedLayouts(obj) {
  try { localStorage.setItem(NAMED_LAYOUTS_KEY, JSON.stringify(obj)); } catch {}
}
function bindLayoutsModal() {
  const modal = document.getElementById("layouts-modal");
  const openBtn = document.getElementById("btn-room-layouts");
  const closeBtn = document.getElementById("layouts-modal-close");
  const saveBtn = document.getElementById("btn-save-layout");

  openBtn.addEventListener("click", () => {
    if (!state.activeRoomId) { toast("اختر غرفة أولاً", "warn"); return; }
    renderNamedLayoutsList();
    modal.hidden = false;
  });
  closeBtn.addEventListener("click", () => modal.hidden = true);
  modal.addEventListener("click", e => { if (e.target === modal) modal.hidden = true; });
  saveBtn.addEventListener("click", () => {
    const name = document.getElementById("layout-name").value.trim() || ("ترتيب " + new Date().toLocaleString("ar-EG"));
    const all = loadNamedLayouts();
    const arr = all[state.activeRoomId] || (all[state.activeRoomId] = []);
    arr.push({
      id: "L" + Date.now(),
      name,
      savedAt: Date.now(),
      items: JSON.parse(JSON.stringify(state.layouts[state.activeRoomId] || [])),
    });
    if (arr.length > 20) arr.shift(); // cap
    saveNamedLayouts(all);
    document.getElementById("layout-name").value = "";
    renderNamedLayoutsList();
    toast("تم حفظ الترتيب");
  });
}
function renderNamedLayoutsList() {
  const host = document.getElementById("layouts-list");
  const all = loadNamedLayouts();
  const arr = all[state.activeRoomId] || [];
  if (arr.length === 0) {
    host.innerHTML = `<p class="hint">لم تحفظ أي ترتيبات بعد.</p>`;
    return;
  }
  host.innerHTML = arr.map(l => `
    <div class="layout-row" data-id="${esc(l.id)}">
      <div class="layout-info">
        <b>${esc(l.name)}</b>
        <span class="muted">${l.items.length} قطعة · ${new Date(l.savedAt).toLocaleDateString("ar-EG")}</span>
      </div>
      <div>
        <button class="btn sm primary" data-act="load">تحميل</button>
        <button class="btn sm danger"  data-act="del">✕</button>
      </div>
    </div>
  `).join("");
  host.querySelectorAll(".layout-row").forEach(row => {
    const id = row.dataset.id;
    row.querySelector('[data-act="load"]').addEventListener("click", () => {
      const all2 = loadNamedLayouts();
      const entry = (all2[state.activeRoomId] || []).find(l => l.id === id);
      if (!entry) return;
      pushHistory();
      state.layouts[state.activeRoomId] = JSON.parse(JSON.stringify(entry.items));
      saveLayouts();
      drawRoom();
      renderRoomList();
      renderSelection();
      toast(`تم تحميل "${entry.name}"`);
      document.getElementById("layouts-modal").hidden = true;
    });
    row.querySelector('[data-act="del"]').addEventListener("click", () => {
      if (!confirm("حذف هذا الترتيب؟")) return;
      const all2 = loadNamedLayouts();
      all2[state.activeRoomId] = (all2[state.activeRoomId] || []).filter(l => l.id !== id);
      saveNamedLayouts(all2);
      renderNamedLayoutsList();
    });
  });
}

// ==========================================================================
// Sun / time-of-day slider
// ==========================================================================
function bindSunSlider() {
  const el = document.getElementById("sun-hour");
  if (!el) return;
  el.value = state.sunHour;
  const apply = () => {
    state.sunHour = parseFloat(el.value);
    if (window.AptThreeView && window.AptThreeView.setSunHour) {
      window.AptThreeView.setSunHour(state.sunHour);
    }
  };
  el.addEventListener("input", apply);
}

// ==========================================================================
// Measure tool (click two points to measure distance in 2D)
// ==========================================================================
function bindMeasure() {
  const btn = document.getElementById("btn-measure");
  if (btn) btn.addEventListener("click", toggleMeasure);
}
function toggleMeasure() {
  state.measure.active = !state.measure.active;
  state.measure.p1 = null;
  state.measure.p2 = null;
  const btn = document.getElementById("btn-measure");
  if (btn) btn.classList.toggle("active", state.measure.active);
  if (state.measure.active) toast("انقر نقطتين في الغرفة للقياس (M للإيقاف)");
  drawRoom();
}

// ==========================================================================
// Share / export buttons (URL, PNG, GLB)
// ==========================================================================
function bindShareExportButtons() {
  document.getElementById("btn-share").addEventListener("click", shareViaUrl);
  document.getElementById("btn-png").addEventListener("click", downloadScreenshot);
  document.getElementById("btn-glb").addEventListener("click", downloadGlb);
}
async function shareViaUrl() {
  // Encode layouts + overrides as compressed base64 → add to URL
  try {
    const payload = {
      v: 1,
      layouts: state.layouts,
      overrides: loadRoomOverrides(),
      prices: state.prices,
    };
    const json = JSON.stringify(payload);
    const b64 = btoa(unescape(encodeURIComponent(json)));
    const url = location.origin + location.pathname + "#s=" + b64;
    try {
      await navigator.clipboard.writeText(url);
      toast("تم نسخ رابط المشاركة إلى الحافظة");
    } catch {
      prompt("انسخ الرابط التالي:", url);
    }
  } catch (e) {
    toast("تعذّر إنشاء رابط المشاركة", "err");
  }
}
function maybeLoadStateFromUrl() {
  const h = location.hash || "";
  const m = h.match(/^#s=(.+)$/);
  if (!m) return;
  try {
    const json = decodeURIComponent(escape(atob(m[1])));
    const data = JSON.parse(json);
    if (!data || !data.layouts) return;
    if (confirm("هل تريد استيراد التصميم المُشارَك من الرابط؟\n(سيستبدل تصميمك الحالي)")) {
      if (data.overrides) saveRoomOverrides(data.overrides);
      if (data.prices)    { state.prices = data.prices; savePrices(); }
      state.layouts = data.layouts;
      saveLayouts();
      // Clear hash so refresh doesn't re-prompt.
      history.replaceState(null, "", location.pathname);
      location.reload();
    }
  } catch (e) { /* ignore malformed */ }
}
function downloadScreenshot() {
  if (!window.AptThreeView || !window.AptThreeView.screenshotPNG) {
    toast("افتح نمط 3D أو جولة أولاً", "warn");
    return;
  }
  const url = window.AptThreeView.screenshotPNG();
  if (!url) { toast("لا توجد لقطة — افتح 3D أولاً", "warn"); return; }
  const a = document.createElement("a");
  a.href = url;
  a.download = `apartment-${Date.now()}.png`;
  a.click();
  toast("تم حفظ اللقطة");
}
async function downloadGlb() {
  if (!window.AptThreeView || !window.AptThreeView.exportGLB) {
    toast("افتح نمط 3D أو جولة أولاً", "warn");
    return;
  }
  try {
    const blob = await window.AptThreeView.exportGLB();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `apartment-${Date.now()}.glb`;
    a.click();
    URL.revokeObjectURL(url);
    toast("تم تصدير GLB");
  } catch (e) {
    toast("تعذّر تصدير GLB", "err");
  }
}

// ==========================================================================
// Comprehensive printable report (Save as PDF from print dialog).
//   - Apartment overview SVG (rooms + furniture in plan view)
//   - Per-room sections: dimensions, item list, room subtotal
//   - Grand total
//   Renders into a hidden new window so the user's app DOM is untouched.
// ==========================================================================
function buildOverviewSvgForPrint() {
  const bounds = apartmentBounds();
  const pad = 40;
  const vbW = bounds.w + pad * 2;
  const vbH = bounds.h + pad * 2;
  const rooms = ROOMS.map(r => renderOverviewRoom(r, bounds, pad)).join("");
  // Inline the few CSS variables used inside renderOverviewRoom so the SVG
  // is self-contained when shown in a brand-new window.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vbW} ${vbH}"
            preserveAspectRatio="xMidYMid meet"
            style="--panel:#fff;--door:#7d3a14;--window:#3066b8;--muted:#444;width:100%;height:100%">
            <rect x="0" y="0" width="${vbW}" height="${vbH}" fill="#fafaf6" />
            ${rooms}
          </svg>`;
}
function gatherReportData() {
  const rooms = ROOMS.map(r => {
    const items = state.layouts[r.id] || [];
    // Group identical (groupId,itemId) into a single line with count
    const lines = new Map();
    items.forEach(inst => {
      const it = findItem(inst.groupId, inst.itemId);
      if (!it) return;
      const k = `${inst.groupId}|${inst.itemId}`;
      const price = priceFor(inst);
      const ent = lines.get(k) || { name: it.name, icon: it.icon || "📦", w: it.w, h: it.h, count: 0, total: 0, unit: price };
      ent.count++;
      ent.total += price;
      lines.set(k, ent);
    });
    const subtotal = items.reduce((s, i) => s + priceFor(i), 0);
    const used = items.reduce((s, i) => {
      const it = findItem(i.groupId, i.itemId);
      return it ? s + (it.w * it.h) : s;
    }, 0);
    const total = r.width * r.depth;
    return {
      room: r, items, lines: [...lines.values()],
      subtotal,
      usedPct: total > 0 ? Math.round((used/total)*100) : 0,
    };
  });
  const grand = rooms.reduce((s, r) => s + r.subtotal, 0);
  const totalItems = rooms.reduce((s, r) => s + r.items.length, 0);
  return { rooms, grand, totalItems };
}
function openPdfReport() {
  const data = gatherReportData();
  const win = window.open("", "_blank");
  if (!win) { toast("امنح إذن النوافذ المنبثقة لإنشاء PDF", "warn"); return; }
  const fmt = (n) => Number(n || 0).toLocaleString("ar-EG");
  const today = new Date().toLocaleDateString("ar-EG", { year: "numeric", month: "long", day: "numeric" });
  const overviewSvg = buildOverviewSvgForPrint();
  const roomSections = data.rooms.map(({ room, items, lines, subtotal, usedPct }) => {
    if (!items.length) {
      return `<section class="room-block">
        <h2>${esc(room.name)}</h2>
        <div class="meta">${fmtPair(room.width, room.depth)}</div>
        <p class="empty">لا توجد قطع في هذه الغرفة.</p>
      </section>`;
    }
    const rows = lines.map(l => `
      <tr>
        <td>${esc(l.icon)} ${esc(l.name)}</td>
        <td class="num">${l.w}×${l.h}</td>
        <td class="num">${l.count}</td>
        <td class="num">${l.unit ? fmt(l.unit) : "—"}</td>
        <td class="num strong">${l.total ? fmt(l.total) + " ج.م" : "—"}</td>
      </tr>`).join("");
    return `<section class="room-block">
      <h2>${esc(room.name)}</h2>
      <div class="meta">${fmtPair(room.width, room.depth)}
        — ارتفاع السقف ${room.height || 270} سم — استخدام ${usedPct}%
        — إجمالي ${items.length} قطعة</div>
      <table>
        <thead><tr><th>القطعة</th><th>الأبعاد (سم)</th><th>العدد</th><th>سعر/قطعة</th><th>الإجمالي</th></tr></thead>
        <tbody>${rows}</tbody>
        <tfoot><tr><td colspan="4">إجمالي الغرفة</td><td class="num strong">${fmt(subtotal)} ج.م</td></tr></tfoot>
      </table>
    </section>`;
  }).join("");
  const html = `<!doctype html>
<html dir="rtl" lang="ar">
<head>
<meta charset="utf-8" />
<title>تقرير الشقة — ${today}</title>
<style>
  @page { size: A4; margin: 14mm; }
  * { box-sizing: border-box; }
  body { font-family: "Cairo", "Tajawal", system-ui, sans-serif; color: #111; margin: 0; }
  header.report-head { display: flex; justify-content: space-between; align-items: center; border-bottom: 2px solid #333; padding-bottom: 10px; margin-bottom: 14px; }
  header.report-head h1 { margin: 0; font-size: 22px; }
  header.report-head .date { color: #555; font-size: 13px; }
  .summary { background: #f5f3ee; border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; margin-bottom: 16px; display: flex; gap: 24px; flex-wrap: wrap; }
  .summary div b { display: block; font-size: 18px; }
  .summary div span { color: #555; font-size: 12px; }
  .overview-wrap { width: 100%; height: 95mm; border: 1px solid #ccc; margin-bottom: 16px; background: #fff; }
  .overview-wrap svg { width: 100%; height: 100%; }
  section.room-block { page-break-inside: avoid; margin-bottom: 14px; border: 1px solid #ddd; border-radius: 6px; padding: 10px 14px; }
  section.room-block h2 { margin: 0 0 4px 0; font-size: 17px; color: #333; }
  section.room-block .meta { color: #666; font-size: 12px; margin-bottom: 8px; }
  section.room-block .empty { color: #999; font-size: 13px; margin: 4px 0; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th, td { padding: 6px 8px; border: 1px solid #ddd; text-align: right; }
  th { background: #efefe9; font-weight: 600; }
  td.num { text-align: center; }
  td.strong { font-weight: 700; }
  tfoot td { background: #fafaf6; font-weight: 600; }
  .grand { margin-top: 18px; border-top: 2px solid #333; padding-top: 10px; display: flex; justify-content: space-between; font-size: 18px; font-weight: 700; }
  .actions { position: fixed; top: 8px; left: 8px; z-index: 9; }
  .actions button { padding: 8px 14px; font: inherit; cursor: pointer; border: 1px solid #444; background: #fff; border-radius: 4px; }
  @media print { .actions { display: none; } }
</style>
</head>
<body>
  <div class="actions"><button onclick="window.print()">🖨️ احفظ كـ PDF</button></div>
  <header class="report-head">
    <h1>تقرير الشقة</h1>
    <div class="date">${esc(today)}</div>
  </header>
  <div class="summary">
    <div><b>${ROOMS.length}</b><span>عدد الغرف</span></div>
    <div><b>${data.totalItems}</b><span>إجمالي القطع</span></div>
    <div><b>${fmt(data.grand)} ج.م</b><span>إجمالي التكلفة</span></div>
  </div>
  <div class="overview-wrap">${overviewSvg}</div>
  ${roomSections}
  <div class="grand">
    <span>الإجمالي العام</span>
    <span>${fmt(data.grand)} ج.م</span>
  </div>
  <script>setTimeout(function(){ try { window.print(); } catch(e){} }, 300);<\/script>
</body>
</html>`;
  win.document.open();
  win.document.write(html);
  win.document.close();
}

// ==========================================================================
// Onboarding (first visit)
// ==========================================================================
function bindOnboarding() {
  const ob = document.getElementById("onboarding");
  if (!ob) return;
  if (!localStorage.getItem(ONBOARDED_KEY)) ob.hidden = false;
  const dismiss = () => {
    ob.hidden = true;
    ob.style.display = "none";
    try { localStorage.setItem(ONBOARDED_KEY, "1"); } catch (_) {}
  };
  const btn = document.getElementById("ob-dismiss");
  if (btn) {
    btn.addEventListener("click", dismiss);
    btn.addEventListener("touchend", e => { e.preventDefault(); dismiss(); }, { passive: false });
  }
  ob.addEventListener("click", e => { if (e.target === ob) dismiss(); });
}

// ==========================================================================
// Alignment guides (pink dashed lines drawn during drag)
// ==========================================================================
function drawAlignGuides(svg, guides, room) {
  let layer = svg.querySelector("#align-guides-layer");
  const viewport = svg.querySelector("#viewport");
  if (!viewport) return;
  if (!layer) {
    layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
    layer.id = "align-guides-layer";
    viewport.appendChild(layer);
  }
  layer.innerHTML = "";
  if (!guides.length) return;
  // Dedupe
  const seen = new Set();
  guides.forEach(g => {
    const key = g.vert ? "v" + g.x : "h" + g.y;
    if (seen.has(key)) return;
    seen.add(key);
    const ln = document.createElementNS("http://www.w3.org/2000/svg", "line");
    ln.setAttribute("class", "align-guide");
    if (g.vert) {
      ln.setAttribute("x1", SVG_PADDING + g.x);
      ln.setAttribute("x2", SVG_PADDING + g.x);
      ln.setAttribute("y1", SVG_PADDING);
      ln.setAttribute("y2", SVG_PADDING + room.depth);
    } else {
      ln.setAttribute("y1", SVG_PADDING + g.y);
      ln.setAttribute("y2", SVG_PADDING + g.y);
      ln.setAttribute("x1", SVG_PADDING);
      ln.setAttribute("x2", SVG_PADDING + room.width);
    }
    layer.appendChild(ln);
  });
}

// ==========================================================================
// Stats (used area %, total cost) — updated from drawRoom()
// ==========================================================================
function updateRoomStats(room, items) {
  const used = items.reduce((s, i) => {
    const it = findItem(i.groupId, i.itemId);
    return it ? s + (it.w * it.h) : s;
  }, 0);
  const total = room.width * room.depth;
  const pct = total > 0 ? Math.round((used / total) * 100) : 0;
  const cost = items.reduce((s, i) => s + priceFor(i), 0);
  const usedEl = document.getElementById("room-used");
  const costEl = document.getElementById("room-cost");
  if (usedEl) {
    usedEl.textContent = pct + "%";
    usedEl.classList.toggle("crowded", pct > 60);
    usedEl.title = `نسبة المساحة المستخدمة — ${used/10000 | 0} م² من ${total/10000 | 0} م²`;
  }
  if (costEl) {
    costEl.textContent = cost > 0 ? (cost.toLocaleString("ar-EG") + " ج.م") : "—";
    costEl.title = `إجمالي التكلفة: ${cost} ج.م`;
  }
}
