// Apartment Designer — interactive top-down furniture arrangement.
// Per-room layouts persist in localStorage under `apt_layout_v1`.

const STORAGE_KEY     = "apt_layout_v1";
const ACTIVE_ROOM_KEY = "apt_active_room";
const THEME_KEY       = "apt_theme";
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
  view: { scale: 1, tx: 0, ty: 0 },
  catalogQuery: "",
  history: [],                   // past snapshots (strings)
  future: [],                    // redo snapshots (strings)
  viewMode: "2d",                // "2d" | "3d"
};

function allGroups() {
  const groups = FURNITURE_GROUPS.slice();
  const custom = window.CustomItems ? window.CustomItems.group() : null;
  if (custom && custom.items.length) groups.push(custom);
  return groups;
}

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  applyTheme(localStorage.getItem(THEME_KEY) || "light");
  renderRoomList();
  renderCatalog();
  bindTopbar();
  bindCatalogSearch();
  bindViewControls();
  bindCustomModal();
  bindViewModeToggle();
  bindGlobalKeys();

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
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.layouts));
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
  allGroups().forEach(group => {
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
      const delBtn = isCustom ? `<button class="cat-del" title="حذف" aria-label="حذف">✕</button>` : "";
      div.innerHTML = `
        ${thumb}
        <span class="cat-name">${item.name}</span>
        <span class="cat-size">${item.w}×${item.h} سم</span>
        ${delBtn}
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
      }
      div.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/apt-item", JSON.stringify({ groupId: group.id, itemId: item.id }));
        e.dataTransfer.effectAllowed = "copy";
      });
      container.appendChild(div);
    });
  });
  if (!container.children.length) {
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
  let processed = null; // { image, sideColor }

  function reset() {
    document.getElementById("ci-name").value = "";
    document.getElementById("ci-w").value = 60;
    document.getElementById("ci-d").value = 60;
    document.getElementById("ci-h").value = 80;
    document.getElementById("ci-cat").value = "common";
    imgInput.value = "";
    preview.innerHTML = `<span class="ph">لم يتم اختيار صورة</span>`;
    err.hidden = true; err.textContent = "";
    processed = null;
  }
  function open() { reset(); modal.hidden = false; document.getElementById("ci-name").focus(); }
  function close() { modal.hidden = true; }

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
    if (!name) { err.textContent = "اكتب اسمًا للعنصر"; err.hidden = false; return; }
    if (!processed) { err.textContent = "ارفع صورة للعنصر"; err.hidden = false; return; }
    if (!(w > 0 && d > 0 && h > 0)) { err.textContent = "الأبعاد غير صالحة"; err.hidden = false; return; }
    const id = "c_" + Math.random().toString(36).slice(2, 9);
    const item = {
      id, name, icon: "📷",
      w, h: d, depth: h,           // w × h (top-down footprint) + depth (vertical)
      color: processed.sideColor, sideColor: processed.sideColor,
      image: processed.image,
      category: cat,
    };
    window.CustomItems.add(item);
    renderCatalog();
    toast("تمت الإضافة للكتالوج");
    close();
  });
}

function bindViewModeToggle() {
  document.getElementById("btn-mode-2d").addEventListener("click", () => setViewMode("2d"));
  document.getElementById("btn-mode-3d").addEventListener("click", () => setViewMode("3d"));
}
function setViewMode(mode) {
  if (mode === state.viewMode) return;
  state.viewMode = mode;
  document.getElementById("btn-mode-2d").classList.toggle("active", mode === "2d");
  document.getElementById("btn-mode-3d").classList.toggle("active", mode === "3d");
  document.getElementById("btn-mode-2d").setAttribute("aria-pressed", mode === "2d");
  document.getElementById("btn-mode-3d").setAttribute("aria-pressed", mode === "3d");
  document.getElementById("stage-help-2d").hidden = mode !== "2d";
  document.getElementById("stage-help-3d").hidden = mode !== "3d";
  // zoom controls apply to 2D only
  ["btn-zoom-in", "btn-zoom-out", "btn-zoom-fit"].forEach(id => {
    document.getElementById(id).disabled = mode !== "2d";
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
  const room = getRoom();
  if (!room) {
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

  const vbW = room.width + SVG_PADDING * 2;
  const vbH = room.depth + SVG_PADDING * 2;

  const collisions = detectCollisions(items);
  setCollisionIndicator(collisions.size);

  if (state.viewMode === "3d") {
    // 3D view renders into the same container via the separate module.
    container.innerHTML = `<div class="three-wrap" id="three-wrap"></div>`;
    if (window.AptThreeView) {
      window.AptThreeView.show(document.getElementById("three-wrap"), {
        room, items, findItem,
        onSelect: (instId) => { state.selectedInstId = instId; renderSelection(); }
      });
    } else {
      container.innerHTML = `<div class="placeholder"><div class="placeholder-icon">⏳</div><p>جارٍ تحميل محرك 3D…</p></div>`;
      // Retry shortly once the ES module finishes loading.
      setTimeout(() => { if (state.viewMode === "3d") drawRoom(); }, 200);
    }
    return;
  }

  if (window.AptThreeView) window.AptThreeView.hide();

  container.innerHTML = `
    <div class="room-svg-wrap">
      <svg class="room-svg" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet">
        ${renderDefs()}
        <g id="viewport" transform="${viewportTransform(vbW, vbH)}">
          ${renderRoomShell(room)}
          <g id="fur-layer">${items.map(inst => renderFurniture(inst, collisions)).join("")}</g>
        </g>
      </svg>
    </div>
  `;
  updateZoomLabel();

  const svg = container.querySelector("svg");
  setupDrop(svg, room);
  setupFurnitureInteractions(svg, room);
  setupZoomPan(svg, container);
}

function renderDefs() { return ""; }

function viewportTransform(vbW, vbH) {
  const { scale, tx, ty } = state.view;
  const cx = vbW / 2, cy = vbH / 2;
  // scale around center, then translate
  return `translate(${cx + tx} ${cy + ty}) scale(${scale}) translate(${-cx} ${-cy})`;
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
      const rot = (inst.rotation || 0) % 180;
      const effW = rot === 90 ? item.h : item.w;
      const effH = rot === 90 ? item.w : item.h;
      inst.x = clamp(snap(startX + dx), effW/2, room.width  - effW/2);
      inst.y = clamp(snap(startY + dy), effH/2, room.depth  - effH/2);
      const g2 = svg.querySelector(`.furniture[data-inst-id="${instId}"]`);
      if (g2) g2.setAttribute("transform", `translate(${SVG_PADDING + inst.x} ${SVG_PADDING + inst.y}) rotate(${inst.rotation || 0})`);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
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
  panel.innerHTML = `
    <div class="sel-row"><span>الاسم</span><b>${item.icon} ${item.name}</b></div>
    <div class="sel-row"><span>الأبعاد</span><b>${item.w}×${item.h} سم</b></div>
    <div class="sel-row"><span>الموقع</span><b>X: ${inst.x} , Y: ${inst.y}</b></div>
    <div class="sel-row">
      <span>الدوران</span>
      <input class="rot-input" type="number" min="0" max="359" step="15" value="${inst.rotation || 0}" aria-label="زاوية الدوران" />
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
