// Apartment Designer — interactive top-down furniture arrangement.
// State per room is persisted in localStorage under key `apt_layout_v1`.

const STORAGE_KEY = "apt_layout_v1";
const WALL_THICKNESS = 10;      // cm, visual thickness of walls in plan
const SVG_PADDING = 40;          // svg viewport padding around the room
const GRID_SNAP = 5;             // cm snap grid

// ---------- State ----------
const state = {
  layouts: loadLayouts(),       // { roomId: [ {instId, itemId, groupId, x, y, rotation}, ... ] }
  activeRoomId: null,
  selectedInstId: null
};

// ---------- Init ----------
document.addEventListener("DOMContentLoaded", () => {
  renderRoomList();
  renderCatalog();
  bindTopbar();

  // Restore last active room
  const last = localStorage.getItem("apt_active_room");
  if (last && ROOMS.find(r => r.id === last)) {
    selectRoom(last);
  }
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

// ---------- Sidebar: rooms ----------
function renderRoomList() {
  const ul = document.getElementById("room-list");
  ul.innerHTML = "";
  ROOMS.forEach(room => {
    const li = document.createElement("li");
    li.dataset.roomId = room.id;
    li.innerHTML = `<span class="room-swatch" style="background:${room.color}"></span><span>${room.name}</span>`;
    li.addEventListener("click", () => selectRoom(room.id));
    ul.appendChild(li);
  });
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
  FURNITURE_GROUPS.forEach(group => {
    const header = document.createElement("div");
    header.className = "cat-group";
    header.textContent = group.label;
    container.appendChild(header);
    group.items.forEach(item => {
      const div = document.createElement("div");
      div.className = "cat-item";
      div.dataset.groupId = group.id;
      div.dataset.itemId = item.id;
      div.draggable = true;
      div.innerHTML = `
        <span class="cat-icon">${item.icon}</span>
        <span class="cat-name">${item.name}</span>
        <span class="cat-size">${item.w}×${item.h} سم</span>
      `;
      div.addEventListener("dragstart", e => {
        e.dataTransfer.setData("text/apt-item", JSON.stringify({ groupId: group.id, itemId: item.id }));
        e.dataTransfer.effectAllowed = "copy";
      });
      container.appendChild(div);
    });
  });
}

// ---------- Topbar ----------
function bindTopbar() {
  document.getElementById("btn-reset").addEventListener("click", () => {
    if (!state.activeRoomId) return;
    if (!confirm("هل أنت متأكد من مسح جميع العفش من هذه الغرفة؟")) return;
    state.layouts[state.activeRoomId] = [];
    state.selectedInstId = null;
    saveLayouts();
    drawRoom();
    renderSelection();
  });
  document.getElementById("btn-save").addEventListener("click", () => {
    saveLayouts();
    flash("تم الحفظ");
  });
  document.getElementById("btn-export").addEventListener("click", exportJSON);
  document.getElementById("btn-import").addEventListener("change", importJSON);
}

function flash(msg) {
  const n = document.createElement("div");
  n.textContent = msg;
  n.style.cssText = "position:fixed;top:70px;left:50%;transform:translateX(-50%);background:#10b981;color:#fff;padding:8px 16px;border-radius:6px;z-index:9999;font-family:inherit;font-size:14px;box-shadow:0 4px 12px rgba(0,0,0,.2);";
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 1500);
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
      if (typeof data !== "object") throw new Error();
      state.layouts = data;
      saveLayouts();
      drawRoom();
      flash("تم الاستيراد");
    } catch {
      alert("ملف غير صالح");
    }
  };
  reader.readAsText(file);
  e.target.value = "";
}

// ---------- Room rendering ----------
function selectRoom(roomId) {
  state.activeRoomId = roomId;
  state.selectedInstId = null;
  localStorage.setItem("apt_active_room", roomId);
  if (!state.layouts[roomId]) state.layouts[roomId] = [];
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
    return;
  }

  document.getElementById("room-title").textContent = room.name;
  document.getElementById("room-dims").textContent = `${(room.width/100).toFixed(2)} × ${(room.depth/100).toFixed(2)} م`;

  const items = state.layouts[room.id] || [];
  document.getElementById("item-count").textContent = `${items.length} قطعة`;

  const vbW = room.width + SVG_PADDING * 2;
  const vbH = room.depth + SVG_PADDING * 2;

  container.innerHTML = `
    <div class="room-svg-wrap">
      <svg class="room-svg" viewBox="0 0 ${vbW} ${vbH}" preserveAspectRatio="xMidYMid meet">
        ${renderRoomShell(room)}
        <g id="fur-layer">${items.map(renderFurniture).join("")}</g>
      </svg>
    </div>
  `;

  const svg = container.querySelector("svg");
  setupDrop(svg, room);
  setupFurnitureInteractions(svg, room);
}

function renderRoomShell(room) {
  const px = SVG_PADDING;
  const py = SVG_PADDING;
  const w = room.width;
  const h = room.depth;

  // Compass label (top = north of the drawn room)
  let parts = [];

  // Floor
  parts.push(`<rect x="${px}" y="${py}" width="${w}" height="${h}" fill="${room.wallColor}" stroke="${room.color}" stroke-width="${WALL_THICKNESS}" />`);

  // Grid (every 50cm)
  let grid = "";
  for (let gx = 50; gx < w; gx += 50) {
    grid += `<line x1="${px+gx}" y1="${py}" x2="${px+gx}" y2="${py+h}" stroke="rgba(0,0,0,.05)" />`;
  }
  for (let gy = 50; gy < h; gy += 50) {
    grid += `<line x1="${px}" y1="${py+gy}" x2="${px+w}" y2="${py+gy}" stroke="rgba(0,0,0,.05)" />`;
  }
  parts.push(`<g>${grid}</g>`);

  // Openings
  (room.openings || []).forEach(op => {
    parts.push(renderOpening(room, op, px, py));
  });

  // Dimensions labels
  parts.push(`<text x="${px + w/2}" y="${py - 12}" text-anchor="middle" fill="#6b7490" font-size="14">${(w/100).toFixed(2)} م</text>`);
  parts.push(`<text x="${px - 20}" y="${py + h/2}" text-anchor="middle" fill="#6b7490" font-size="14" transform="rotate(-90 ${px - 20} ${py + h/2})">${(h/100).toFixed(2)} م</text>`);

  // North indicator
  parts.push(`<g transform="translate(${px + w - 30} ${py + 30})">
    <circle r="16" fill="#fff" stroke="#6b7490" />
    <text y="-2" text-anchor="middle" font-size="10" fill="#6b7490">شمال</text>
    <text y="10" text-anchor="middle" font-size="12" fill="#2e5cff">↑</text>
  </g>`);

  return parts.join("");
}

function renderOpening(room, op, px, py) {
  const t = WALL_THICKNESS;
  let x, y, w, h, labelX, labelY;
  switch (op.wall) {
    case "top":
      x = px + op.at; y = py - t/2; w = op.size; h = t * 1.4;
      labelX = x + w/2; labelY = y - 4;
      break;
    case "bottom":
      x = px + op.at; y = py + room.depth - t*0.7; w = op.size; h = t * 1.4;
      labelX = x + w/2; labelY = y + h + 12;
      break;
    case "left":
      x = px - t/2; y = py + op.at; w = t * 1.4; h = op.size;
      labelX = x + w + 18; labelY = y + h/2 + 4;
      break;
    case "right":
      x = px + room.width - t*0.7; y = py + op.at; w = t * 1.4; h = op.size;
      labelX = x - 22; labelY = y + h/2 + 4;
      break;
  }
  const color = op.kind === "door" ? "var(--door)" : "var(--window)";
  const arc = op.kind === "door"
    ? renderDoorSwing(room, op, px, py)
    : "";
  return `
    <g>
      <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#fff" stroke="${color}" stroke-width="2" />
      ${arc}
      <text x="${labelX}" y="${labelY}" text-anchor="middle" font-size="10" fill="${color}">${op.label || (op.kind === "door" ? "باب" : "شباك")}</text>
    </g>`;
}

function renderDoorSwing(room, op, px, py) {
  // Arc showing door swing (visual hint only)
  const size = op.size;
  let cx, cy, sweep = 0;
  switch (op.wall) {
    case "top":    cx = px + op.at;           cy = py;                sweep = 1; break;
    case "bottom": cx = px + op.at + size;    cy = py + room.depth;   sweep = 1; break;
    case "left":   cx = px;                   cy = py + op.at + size; sweep = 1; break;
    case "right":  cx = px + room.width;      cy = py + op.at;        sweep = 1; break;
  }
  let ex, ey;
  switch (op.wall) {
    case "top":    ex = cx;               ey = cy + size; break;
    case "bottom": ex = cx;               ey = cy - size; break;
    case "left":   ex = cx + size;        ey = cy;        break;
    case "right":  ex = cx - size;        ey = cy;        break;
  }
  const sx = op.wall === "top" ? cx + size : op.wall === "bottom" ? cx - size : op.wall === "left" ? cx : op.wall === "right" ? cx : cx;
  const sy = op.wall === "top" ? cy : op.wall === "bottom" ? cy : op.wall === "left" ? cy - size : op.wall === "right" ? cy + size : cy;
  return `<path d="M ${sx} ${sy} A ${size} ${size} 0 0 ${sweep} ${ex} ${ey}" fill="none" stroke="rgba(157,88,51,.3)" stroke-dasharray="3,3" />`;
}

function renderFurniture(inst) {
  const item = findItem(inst.groupId, inst.itemId);
  if (!item) return "";
  const cx = SVG_PADDING + inst.x;
  const cy = SVG_PADDING + inst.y;
  const w = item.w;
  const h = item.h;
  const selectedClass = inst.instId === state.selectedInstId ? "selected" : "";
  const opacity = item.opacity ?? 1;
  return `
    <g class="furniture ${selectedClass}" data-inst-id="${inst.instId}" transform="translate(${cx} ${cy}) rotate(${inst.rotation || 0})">
      <rect class="fur-body" x="${-w/2}" y="${-h/2}" width="${w}" height="${h}" fill="${item.color}" opacity="${opacity}" rx="4" />
      <text class="fur-icon" x="0" y="6">${item.icon}</text>
      <text class="fur-label" x="0" y="${h/2 - 6}">${item.name}</text>
    </g>`;
}

function findItem(groupId, itemId) {
  const group = FURNITURE_GROUPS.find(g => g.id === groupId);
  if (!group) return null;
  return group.items.find(i => i.id === itemId);
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
    const pt = svgPoint(svg, e.clientX, e.clientY);
    const x = clamp(snap(pt.x - SVG_PADDING), item.w/2, room.width - item.w/2);
    const y = clamp(snap(pt.y - SVG_PADDING), item.h/2, room.depth - item.h/2);
    const inst = {
      instId: "i_" + Math.random().toString(36).slice(2, 9),
      groupId, itemId,
      x, y,
      rotation: 0
    };
    state.layouts[room.id].push(inst);
    state.selectedInstId = inst.instId;
    saveLayouts();
    drawRoom();
    renderSelection();
  });
}

function svgPoint(svg, clientX, clientY) {
  const pt = svg.createSVGPoint();
  pt.x = clientX;
  pt.y = clientY;
  return pt.matrixTransform(svg.getScreenCTM().inverse());
}
function snap(v) { return Math.round(v / GRID_SNAP) * GRID_SNAP; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ---------- Furniture interactions: move/select ----------
function setupFurnitureInteractions(svg, room) {
  svg.addEventListener("mousedown", onDown);
  svg.addEventListener("touchstart", onDown, { passive: false });

  function onDown(e) {
    const g = e.target.closest(".furniture");
    if (!g) {
      state.selectedInstId = null;
      drawRoom();
      renderSelection();
      return;
    }
    const instId = g.dataset.instId;
    state.selectedInstId = instId;
    renderSelection();
    // Update selected class without full redraw to avoid recreating drag target
    document.querySelectorAll(".furniture.selected").forEach(n => n.classList.remove("selected"));
    g.classList.add("selected");

    const inst = state.layouts[room.id].find(i => i.instId === instId);
    if (!inst) return;
    const item = findItem(inst.groupId, inst.itemId);
    const startPt = svgPoint(svg, e.touches ? e.touches[0].clientX : e.clientX, e.touches ? e.touches[0].clientY : e.clientY);
    const startX = inst.x, startY = inst.y;

    function onMove(ev) {
      ev.preventDefault();
      const p = svgPoint(svg, ev.touches ? ev.touches[0].clientX : ev.clientX, ev.touches ? ev.touches[0].clientY : ev.clientY);
      let dx = p.x - startPt.x;
      let dy = p.y - startPt.y;
      const rot = (inst.rotation || 0) % 180;
      const effW = rot === 90 ? item.h : item.w;
      const effH = rot === 90 ? item.w : item.h;
      inst.x = clamp(snap(startX + dx), effW/2, room.width  - effW/2);
      inst.y = clamp(snap(startY + dy), effH/2, room.depth  - effH/2);
      // Redraw only this element's transform for smooth drag
      const g2 = svg.querySelector(`.furniture[data-inst-id="${instId}"]`);
      if (g2) g2.setAttribute("transform", `translate(${SVG_PADDING + inst.x} ${SVG_PADDING + inst.y}) rotate(${inst.rotation || 0})`);
    }
    function onUp() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onUp);
      saveLayouts();
      renderSelection();
    }
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onUp);
  }
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
    <div class="sel-row"><span>الدوران</span><b>${inst.rotation || 0}°</b></div>
    <div class="sel-actions">
      <button class="btn" data-action="rotate">⟳ تدوير 90°</button>
      <button class="btn" data-action="duplicate">📋 تكرار</button>
      <button class="btn" data-action="front">⬆ للأمام</button>
      <button class="btn" data-action="back">⬇ للخلف</button>
      <button class="btn danger" data-action="delete">✕ حذف</button>
    </div>
  `;
  panel.querySelectorAll("[data-action]").forEach(btn => {
    btn.addEventListener("click", () => handleSelAction(btn.dataset.action, inst));
  });
}

function handleSelAction(action, inst) {
  const room = getRoom();
  const items = state.layouts[room.id];
  const idx = items.indexOf(inst);
  const item = findItem(inst.groupId, inst.itemId);
  if (action === "rotate") {
    inst.rotation = ((inst.rotation || 0) + 90) % 360;
    // Ensure it fits within room after rotation
    const rot = inst.rotation % 180;
    const effW = rot === 90 ? item.h : item.w;
    const effH = rot === 90 ? item.w : item.h;
    inst.x = clamp(inst.x, effW/2, room.width  - effW/2);
    inst.y = clamp(inst.y, effH/2, room.depth  - effH/2);
  } else if (action === "duplicate") {
    const copy = { ...inst, instId: "i_" + Math.random().toString(36).slice(2, 9), x: inst.x + 30, y: inst.y + 30 };
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
}

// Keyboard shortcuts
document.addEventListener("keydown", e => {
  if (!state.selectedInstId || !state.activeRoomId) return;
  const inst = state.layouts[state.activeRoomId].find(i => i.instId === state.selectedInstId);
  if (!inst) return;
  const target = e.target;
  if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA")) return;
  if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); handleSelAction("delete", inst); }
  else if (e.key === "r" || e.key === "R") { e.preventDefault(); handleSelAction("rotate", inst); }
  else if (e.key === "d" || e.key === "D") { e.preventDefault(); handleSelAction("duplicate", inst); }
});
