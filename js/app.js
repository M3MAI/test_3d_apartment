// Apartment Designer — interactive top-down furniture arrangement.
// Per-room layouts persist in localStorage under `apt_layout_v1`.

const STORAGE_KEY     = "apt_layout_v1";
const ACTIVE_ROOM_KEY = "apt_active_room";
const THEME_KEY       = "apt_theme";
const ROOM_OVERRIDES_KEY = "apt_room_overrides_v1";
const NAMED_LAYOUTS_KEY  = "apt_named_layouts_v1";
const PRICES_KEY         = "apt_prices_v1";        // { "groupId:itemId": number }
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
};

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
      <span class="room-swatch" style="background:${room.color}"></span>
      <span>${room.name}</span>
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
function renderCatalog() {
  const container = document.getElementById("furniture-catalog");
  container.innerHTML = "";
  const q = state.catalogQuery.trim().toLowerCase();
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
      !q || item.name.toLowerCase().includes(q) || item.id.toLowerCase().includes(q)
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
        ? `<img class="cat-thumb" src="${item.image}" alt="" />`
        : `<span class="cat-icon">${item.icon || "📦"}</span>`;
      const actions = isCustom
        ? `<button class="cat-edit" title="تعديل" aria-label="تعديل">✎</button>
           <button class="cat-del"  title="حذف"   aria-label="حذف">✕</button>`
        : "";
      div.innerHTML = `
        ${thumb}
        <span class="cat-name">${item.name}</span>
        <span class="cat-size">${item.w}×${item.h} سم</span>
        ${actions}
      `;
      if (isCustom) {
        div.querySelector(".cat-del").addEventListener("click", e => {
          e.stopPropagation();
          e.preventDefault();
          if (!confirm(`حذف "${item.name}" من الكتالوج؟ (لن يُحذف من الغرف المحفوظة)`)) return;
          window.CustomItems.remove(item.id);
          renderCatalog();
          drawRoom();
          toast("تم حذف العنصر", "warn");
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
    if (item.image) preview.innerHTML = `<img src="${item.image}" alt="معاينة" />`;
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
      preview.innerHTML = `<img src="${processed.image}" alt="معاينة" />`;
      err.hidden = true;
    } catch {
      processed = null;
      err.textContent = "تعذّر قراءة الصورة";
      err.hidden = false;
    }
  });

  saveBtn.addEventListener("click", () => {
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
      const ok = window.CustomItems.update(editingId, {
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
      if (window.CustomItems.add(item)) {
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
  document.getElementById("btn-print").addEventListener("click", () => window.print());
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
    if (window.AptThreeView) window.AptThreeView.hide();
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
    return;
  }

  document.getElementById("room-title").textContent = room.name;
  document.getElementById("room-dims").textContent = `${(room.width/100).toFixed(2)} × ${(room.depth/100).toFixed(2)} م`;

  const items = state.layouts[room.id] || [];
  document.getElementById("item-count").textContent = `${items.length} قطعة`;
  updateRoomStats(room, items);

  const vbW = room.width + SVG_PADDING * 2;
  const vbH = room.depth + SVG_PADDING * 2;

  const collisions = detectCollisions(items);
  setCollisionIndicator(collisions.size);

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
      window.AptThreeView.updateItems(items, findItem, state.selectedInstId, collisions);
    } else {
      container.innerHTML = `<div class="three-wrap" id="three-wrap"></div>`;
      window.AptThreeView.show(document.getElementById("three-wrap"), {
        room, items, findItem, collisionSet: collisions,
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
          window.AptThreeView.updateItems(nextItems, findItem, state.selectedInstId, nextCollisions);
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
          <g id="fur-layer">${items.map(inst => renderFurniture(inst, collisions)).join("")}</g>
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
    <text class="measure-label" x="${mx}" y="${my - 10}" text-anchor="middle">${(dist/100).toFixed(2)} م</text>
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
  document.getElementById("room-dims").textContent = `${(bounds.w/100).toFixed(2)} × ${(bounds.h/100).toFixed(2)} م`;
  const totalItems = ROOMS.reduce((s, r) => s + (state.layouts[r.id] || []).length, 0);
  document.getElementById("item-count").textContent = `${totalItems} قطعة (${ROOMS.length} غرف)`;
  // Cross-room collisions are not meaningful; clear the indicator.
  setCollisionIndicator(0);

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
  parts.push(`<rect x="${x}" y="${y}" width="${room.width}" height="${room.depth}" fill="${room.wallColor}" stroke="${room.color}" stroke-width="${WALL_THICKNESS}" rx="2" />`);
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
        <image x="${-item.w/2}" y="${-item.h/2}" width="${item.w}" height="${item.h}" preserveAspectRatio="xMidYMid slice" href="${item.image}" />
      </g>`);
    } else {
      const opa = item.opacity ?? 1;
      parts.push(`<rect x="${fx - item.w/2}" y="${fy - item.h/2}" width="${item.w}" height="${item.h}" fill="${item.color}" opacity="${opa}" transform="rotate(${rot} ${fx} ${fy})" rx="2" />`);
    }
  });
  // Room label
  parts.push(`<text x="${x + room.width/2}" y="${y + room.depth/2 + 6}" text-anchor="middle" font-size="24" font-weight="700" fill="var(--muted)" style="pointer-events:none">${room.name}</text>`);
  parts.push(`<text x="${x + room.width/2}" y="${y + room.depth/2 + 32}" text-anchor="middle" font-size="16" fill="var(--muted)" opacity="0.7" style="pointer-events:none">${(room.width/100).toFixed(2)} × ${(room.depth/100).toFixed(2)} م — ${items.length} قطعة</text>`);
  // Hit target for clicking into the room
  return `<g class="plan-room" data-plan-room="${room.id}" style="cursor:pointer">
    ${parts.join("")}
    <rect class="plan-room-hit" x="${x}" y="${y}" width="${room.width}" height="${room.depth}" fill="transparent" />
  </g>`;
}

function drawWalkthrough(container) {
  document.getElementById("room-title").textContent = "جولة داخل الشقة";
  const bounds = apartmentBounds();
  document.getElementById("room-dims").textContent = `${(bounds.w/100).toFixed(2)} × ${(bounds.h/100).toFixed(2)} م`;
  const totalItems = ROOMS.reduce((s, r) => s + (state.layouts[r.id] || []).length, 0);
  document.getElementById("item-count").textContent = `${totalItems} قطعة`;
  setCollisionIndicator(0);

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

  parts.push(`<rect x="${px}" y="${py}" width="${w}" height="${h}" fill="${room.wallColor}" stroke="${room.color}" stroke-width="${WALL_THICKNESS}" />`);

  let grid = "";
  for (let gx = 50; gx < w; gx += 50) {
    grid += `<line x1="${px+gx}" y1="${py}" x2="${px+gx}" y2="${py+h}" stroke="var(--grid-line)" />`;
  }
  for (let gy = 50; gy < h; gy += 50) {
    grid += `<line x1="${px}" y1="${py+gy}" x2="${px+w}" y2="${py+gy}" stroke="var(--grid-line)" />`;
  }
  parts.push(`<g>${grid}</g>`);

  (room.openings || []).forEach(op => parts.push(renderOpening(room, op, px, py)));

  parts.push(`<text x="${px + w/2}" y="${py - 12}" text-anchor="middle" fill="var(--muted)" font-size="14">${(w/100).toFixed(2)} م</text>`);
  parts.push(`<text x="${px - 20}" y="${py + h/2}" text-anchor="middle" fill="var(--muted)" font-size="14" transform="rotate(-90 ${px - 20} ${py + h/2})">${(h/100).toFixed(2)} م</text>`);

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
      <text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="10" fill="${color}">${op.label || (op.kind === "door" ? "باب" : "شباك")}</text>
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

function renderFurniture(inst, collisionSet) {
  const item = findItem(inst.groupId, inst.itemId);
  if (!item) return "";
  const cx = SVG_PADDING + inst.x;
  const cy = SVG_PADDING + inst.y;
  const w = item.w;
  const h = item.h;
  const classes = ["furniture"];
  if (inst.instId === state.selectedInstId) classes.push("selected");
  if (collisionSet && collisionSet.has(inst.instId)) classes.push("collides");
  const opacity = item.opacity ?? 1;
  const isCustom = inst.groupId === "custom" && item.image;
  const rot = inst.rotation || 0;
  // For custom items: render the uploaded image directly inside the body, plus
  // a subtle colored stroke. For built-ins: filled rect with the library color.
  const body = isCustom
    ? `<image class="fur-body" x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice" href="${item.image}" opacity="${opacity}"></image>
       <rect class="fur-frame" x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" fill="none" stroke="${item.sideColor || item.color || '#555'}" stroke-width="2" rx="4" />`
    : `<rect class="fur-body" x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" fill="${item.color}" opacity="${opacity}" rx="4" />`;
  const labelFill = isCustom ? "rgba(255,255,255,.95)" : "#fff";
  const labelStroke = isCustom ? "rgba(0,0,0,.55)" : "none";
  return `
    <g class="${classes.join(" ")}" data-inst-id="${inst.instId}" transform="translate(${cx} ${cy}) rotate(${rot})">
      ${body}
      <g transform="rotate(${-rot})" style="pointer-events:none">
        ${isCustom ? "" : `<text class="fur-icon" x="0" y="6" fill="${labelFill}">${item.icon || "📦"}</text>`}
        <text class="fur-label" x="0" y="${Math.min(h, w)/2 - 6}" fill="${labelFill}" stroke="${labelStroke}" stroke-width=".5" paint-order="stroke">${item.name}</text>
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
    if (e.target.closest(".cat-del")) return;
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

// ---------- Furniture interactions: move/select ----------
function setupFurnitureInteractions(svg, room) {
  svg.addEventListener("mousedown", onDown);
  svg.addEventListener("touchstart", onDown, { passive: false });

  function onDown(e) {
    // ignore middle-button (reserved for pan) and shift-click (reserved for pan)
    if (e.button === 1 || (e.shiftKey && e.button === 0)) return;
    const g = e.target.closest(".furniture");
    if (!g) {
      if (state.selectedInstId !== null) {
        state.selectedInstId = null;
        drawRoom();
        renderSelection();
      }
      return;
    }
    const instId = g.dataset.instId;
    const prevSelected = state.selectedInstId;
    state.selectedInstId = instId;
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

      // --- Wall snap (Alt+drag): choose nearest wall, align item to it ---
      if (altSnap) {
        const dT = ny - effH0/2;                    // distance from top wall
        const dB = (room.depth - ny) - effH0/2;     // bottom
        const dL = nx - effW0/2;                    // left
        const dR = (room.width - nx) - effW0/2;     // right
        const min = Math.min(dT, dB, dL, dR);
        if (min === dT)      { ny = effH0/2; snappedRotation = 0; }
        else if (min === dB) { ny = room.depth - effH0/2; snappedRotation = 180; }
        else if (min === dL) { nx = effW0/2; snappedRotation = 90; }
        else                 { nx = room.width - effW0/2; snappedRotation = 270; }
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

  // Middle-mouse or Shift+drag pan
  let panning = null;
  svg.addEventListener("mousedown", e => {
    const shouldPan = e.button === 1 || (e.button === 0 && e.shiftKey);
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
  if (!state.selectedInstId || !state.activeRoomId) {
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
    <div class="sel-row"><span>الاسم</span><b>${item.icon || "📦"} ${item.name}</b></div>
    <div class="sel-row"><span>الأبعاد</span><b>${item.w}×${item.h} سم</b></div>
    <div class="sel-row"><span>الموقع</span><b>X: ${inst.x} , Y: ${inst.y}</b></div>
    <div class="sel-row">
      <span>الدوران</span>
      <input class="rot-input" type="number" min="0" max="359" step="15" value="${inst.rotation || 0}" aria-label="زاوية الدوران" />
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
    // Escape: clear selection / close modals
    if (e.key === "Escape") {
      closeAllModals();
      state.selectedInstId = null;
      state.selectedInstIds.clear();
      state.measure = { active: false, p1: null, p2: null };
      drawRoom();
      renderSelection();
      return;
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
    if (!name || !(w > 0) || !(d > 0)) {
      const err = document.getElementById("re-error");
      err.textContent = "تحقق من الأبعاد والاسم";
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
    room.wallColor = wallColor;
    room.floorTexture = floorTexture;
    room.wallTexture = wallTexture;
    room.openings = openings;
    // Persist override
    const ov = loadRoomOverrides();
    ov[editingRoomId] = { name, width: w, depth: d, wallColor, floorTexture, wallTexture, openings, plan: room.plan };
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
    <label>موضع <input type="number" data-k="at"   min="0" step="5" value="${op.at}" /></label>
    <label>عرض  <input type="number" data-k="size" min="30" step="5" value="${op.size}" /></label>
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
    <div class="layout-row" data-id="${l.id}">
      <div class="layout-info">
        <b>${l.name}</b>
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
// Onboarding (first visit)
// ==========================================================================
function bindOnboarding() {
  const ob = document.getElementById("onboarding");
  if (!ob) return;
  if (!localStorage.getItem(ONBOARDED_KEY)) ob.hidden = false;
  const dismiss = () => {
    ob.hidden = true;
    localStorage.setItem(ONBOARDED_KEY, "1");
  };
  document.getElementById("ob-dismiss").addEventListener("click", dismiss);
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
