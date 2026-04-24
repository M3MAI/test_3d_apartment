// 3D preview & editor (Three.js). Builds a scene from the current room +
// placed furniture and exposes an editing API so app.js can drop/move/rotate
// items directly in the 3D scene.
//
// API (window.AptThreeView):
//   show(container, { room, items, findItem, onSelect, onDrop, onMove })
//     - builds the scene once for a room
//   updateItems(items, findItem, selectedInstId)
//     - reconciles furniture meshes in place (keeps camera + selection smooth)
//   setSelection(instId)
//     - moves the selection outline to the given instance
//   isActiveFor(roomId) -> bool
//     - true iff the scene is currently mounted for the given room
//   screenToRoomCoords(clientX, clientY) -> { x, y } | null
//     - hit-tests a client point against the room floor; returns room coords
//   hide()
//     - tears down the scene and releases GPU resources

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const WALL_HEIGHT   = 270;     // cm
const WALL_THICK_3D = 10;      // cm

let ctx = null;                // per-show rendering context

// ---------- Disposal ----------
function disposeObj(obj) {
  if (!obj) return;
  obj.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    if (o.material) {
      const mats = Array.isArray(o.material) ? o.material : [o.material];
      mats.forEach(m => {
        for (const k of Object.keys(m)) {
          if (m[k] && m[k].isTexture) m[k].dispose();
        }
        m.dispose();
      });
    }
  });
}

function hide() {
  if (!ctx) return;
  if (ctx.resizeObs) ctx.resizeObs.disconnect();
  if (ctx.raf) cancelAnimationFrame(ctx.raf);
  detachPointerHandlers(ctx);
  if (ctx.controls) ctx.controls.dispose();
  disposeObj(ctx.scene);
  if (ctx.renderer) {
    ctx.renderer.dispose();
    ctx.renderer.domElement.remove();
  }
  ctx = null;
}

function isActiveFor(roomId) {
  return !!(ctx && ctx.roomId === roomId);
}

// ---------- Show / build scene ----------
function show(container, opts) {
  hide(); // idempotent
  const { room, items, findItem, onSelect, onDrop, onMove } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bgColorFromTheme());

  const camera = new THREE.PerspectiveCamera(
    45,
    Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
    1,
    8000
  );
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth || 800, container.clientHeight || 500);
  renderer.shadowMap.enabled = true;
  renderer.domElement.style.touchAction = "none"; // we drive gestures ourselves
  container.appendChild(renderer.domElement);

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(room.width * 0.6, WALL_HEIGHT * 2, room.depth * 0.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left   = -room.width;
  key.shadow.camera.right  =  room.width;
  key.shadow.camera.top    =  room.depth;
  key.shadow.camera.bottom = -room.depth;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(-room.width * 0.3, WALL_HEIGHT * 1.5, -room.depth * 0.3);
  scene.add(fill);

  // Floor (wallColor matches 2D view)
  const floorMat = new THREE.MeshStandardMaterial({
    color: hexToInt(room.wallColor), roughness: 0.95,
  });
  const floorGeo = new THREE.PlaneGeometry(room.width, room.depth);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(room.width / 2, 0, room.depth / 2);
  floor.receiveShadow = true;
  floor.name = "room-floor";
  scene.add(floor);

  // Grid (every 50cm)
  const grid = new THREE.GridHelper(
    Math.max(room.width, room.depth),
    Math.max(room.width, room.depth) / 50,
    0x999999, 0xcccccc
  );
  grid.position.set(room.width / 2, 0.2, room.depth / 2);
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  // Walls + track the set so we can hide whichever faces the camera
  buildWalls(scene, room);
  const wallList = [];
  scene.traverse(o => { if (o.userData && o.userData.wallId) wallList.push(o); });

  // Furniture container (so we never mix up walls/floor with items)
  const furnitureGroup = new THREE.Group();
  furnitureGroup.name = "furniture";
  scene.add(furnitureGroup);

  // Ghost / placement preview group
  const ghostGroup = new THREE.Group();
  ghostGroup.name = "ghost";
  scene.add(ghostGroup);

  // Selection helper (outline follows whichever mesh is selected)
  const selectionHelper = new THREE.BoxHelper(new THREE.Object3D(), 0xff5a5a);
  selectionHelper.material.depthTest = false;
  selectionHelper.material.transparent = true;
  selectionHelper.visible = false;
  scene.add(selectionHelper);

  // Orbit camera positioned for a good starting overview
  const center = new THREE.Vector3(room.width / 2, 60, room.depth / 2);
  const diag = Math.hypot(room.width, room.depth);
  camera.position.set(
    room.width / 2 + diag * 0.6,
    WALL_HEIGHT * 2.2,
    room.depth / 2 + diag * 0.8
  );
  camera.lookAt(center);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(center);
  controls.maxPolarAngle = Math.PI * 0.49; // prevent going under the floor
  controls.minDistance = 120;
  controls.maxDistance = diag * 3;
  controls.enableDamping = true;
  controls.update();

  // Build the editing context now so pointer handlers can see it
  ctx = {
    roomId: room.id, room,
    scene, camera, renderer, controls,
    raf: 0, resizeObs: null,
    floor, wallList, furnitureGroup, ghostGroup, selectionHelper,
    instMeshes: new Map(),  // instId -> mesh
    findItem,
    onSelect, onDrop, onMove,
    drag: null,             // pointer drag state
    hoverGhost: null,       // external-drop preview
    selectedInstId: null,
  };

  renderItems(ctx, items);
  attachPointerHandlers(ctx, container);
  attachDomDropHandlers(ctx, container);

  // Resize
  ctx.resizeObs = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  ctx.resizeObs.observe(container);

  // Animate + near-wall culling
  const roomCenter = new THREE.Vector3(room.width / 2, WALL_HEIGHT / 2, room.depth / 2);
  const loop = () => {
    ctx.raf = requestAnimationFrame(loop);
    controls.update();

    // Hide the single wall closest to the camera so we always see inside.
    const cx = camera.position.x - roomCenter.x;
    const cz = camera.position.z - roomCenter.z;
    let hideId;
    if (Math.abs(cx) >= Math.abs(cz)) hideId = cx >= 0 ? "right" : "left";
    else                              hideId = cz >= 0 ? "bottom" : "top";
    wallList.forEach(m => { m.visible = (m.userData.wallId !== hideId); });

    // Keep selection outline attached to the currently selected mesh
    if (ctx.selectedInstId) {
      const mesh = ctx.instMeshes.get(ctx.selectedInstId);
      if (mesh) {
        selectionHelper.setFromObject(mesh);
        selectionHelper.visible = true;
      } else {
        selectionHelper.visible = false;
      }
    } else {
      selectionHelper.visible = false;
    }

    renderer.render(scene, camera);
  };
  loop();
}

// ---------- Item reconciliation ----------
function renderItems(ctx, items) {
  const seen = new Set();
  items.forEach(inst => {
    seen.add(inst.instId);
    const existing = ctx.instMeshes.get(inst.instId);
    const item = ctx.findItem(inst.groupId, inst.itemId);
    if (!item) {
      if (existing) removeMesh(ctx, inst.instId);
      return;
    }
    if (existing && existing.userData.signature === meshSignature(inst, item)) {
      // Only transform needs updating
      applyInstTransform(existing, inst, item);
    } else {
      // Rebuild mesh for this inst
      if (existing) removeMesh(ctx, inst.instId);
      const mesh = buildFurnitureMesh(inst, item);
      if (!mesh) return;
      mesh.userData.instId = inst.instId;
      mesh.userData.signature = meshSignature(inst, item);
      ctx.instMeshes.set(inst.instId, mesh);
      ctx.furnitureGroup.add(mesh);
    }
  });
  // Remove meshes whose instances no longer exist
  for (const [instId] of ctx.instMeshes) {
    if (!seen.has(instId)) removeMesh(ctx, instId);
  }
}

function removeMesh(ctx, instId) {
  const m = ctx.instMeshes.get(instId);
  if (!m) return;
  ctx.furnitureGroup.remove(m);
  disposeObj(m);
  ctx.instMeshes.delete(instId);
}

function meshSignature(inst, item) {
  // Rebuild on anything that changes geometry/materials
  return [inst.groupId, inst.itemId, item.w, item.h, item.depth || "", item.color || "", item.image ? "img" : "flat"].join("|");
}

function applyInstTransform(mesh, inst, item) {
  const h = item.depth || defaultHeight(item);
  mesh.position.set(inst.x, h / 2, inst.y);
  mesh.rotation.y = -((inst.rotation || 0) * Math.PI) / 180;
  mesh.userData.rotation = inst.rotation || 0;
}

function updateItems(items, findItem, selectedInstId) {
  if (!ctx) return;
  ctx.findItem = findItem;
  renderItems(ctx, items);
  ctx.selectedInstId = selectedInstId || null;
}

function setSelection(instId) {
  if (!ctx) return;
  ctx.selectedInstId = instId || null;
}

function screenToRoomCoords(clientX, clientY) {
  if (!ctx) return null;
  const p = intersectFloor(ctx, clientX, clientY);
  if (!p) return null;
  return { x: p.x, y: p.z };
}

// ---------- Pointer interactions (select / drag to move) ----------
function attachPointerHandlers(ctx, container) {
  const el = ctx.renderer.domElement;
  const MOVE_THRESHOLD = 5;    // px before a drag starts

  ctx._onPointerDown = (e) => {
    // Only primary button / single finger — let Orbit handle the rest.
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // Ignore secondary fingers while a drag is already in progress (pinch/pan).
    if (ctx.drag) return;
    const hit = pickFurniture(ctx, e.clientX, e.clientY);
    if (!hit) {
      // Clicking on empty floor or background = deselect
      ctx.drag = { kind: "deselect-candidate", startX: e.clientX, startY: e.clientY };
      return;
    }
    // Start potential drag on furniture
    el.setPointerCapture(e.pointerId);
    e.preventDefault();
    ctx.controls.enabled = false;
    const inst = findInstInContext(ctx, hit.userData.instId);
    ctx.drag = {
      kind: "furniture",
      pointerId: e.pointerId,
      instId: hit.userData.instId,
      startX: e.clientX,
      startY: e.clientY,
      startPos: inst ? { x: inst.x, y: inst.y } : null,
      moved: false,
    };
    // Immediately select so highlight feedback is instant
    ctx.selectedInstId = hit.userData.instId;
    if (ctx.onSelect) ctx.onSelect(hit.userData.instId);
  };

  ctx._onPointerMove = (e) => {
    if (!ctx.drag) return;
    const d = ctx.drag;
    if (d.kind === "deselect-candidate") return;
    if (d.kind !== "furniture") return;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (!d.moved && Math.hypot(dx, dy) < MOVE_THRESHOLD) return;
    d.moved = true;
    const p = intersectFloor(ctx, e.clientX, e.clientY);
    if (!p) return;
    const mesh = ctx.instMeshes.get(d.instId);
    const inst = findInstInContext(ctx, d.instId);
    if (!mesh || !inst) return;
    const item = ctx.findItem(inst.groupId, inst.itemId);
    if (!item) return;
    const rot = (inst.rotation || 0) % 180;
    const effW = rot === 90 ? item.h : item.w;
    const effD = rot === 90 ? item.w : item.h;
    const nx = clamp(snap(p.x), effW / 2, ctx.room.width - effW / 2);
    const ny = clamp(snap(p.z), effD / 2, ctx.room.depth - effD / 2);
    mesh.position.x = nx;
    mesh.position.z = ny;
    d.commitX = nx;
    d.commitY = ny;
  };

  ctx._onPointerUp = (e) => {
    if (!ctx.drag) return;
    const d = ctx.drag;
    ctx.drag = null;
    ctx.controls.enabled = true;
    try { el.releasePointerCapture(e.pointerId); } catch {}
    if (d.kind === "deselect-candidate") {
      // Treat as click only if finger didn't move much
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (Math.hypot(dx, dy) < MOVE_THRESHOLD) {
        ctx.selectedInstId = null;
        if (ctx.onSelect) ctx.onSelect(null);
      }
      return;
    }
    if (d.kind === "furniture") {
      if (d.moved && d.commitX != null && d.commitY != null) {
        if (ctx.onMove) ctx.onMove({ instId: d.instId, x: d.commitX, y: d.commitY });
      } else {
        // No drag → pure click/tap = ensure selected
        if (ctx.onSelect) ctx.onSelect(d.instId);
      }
    }
  };

  el.addEventListener("pointerdown", ctx._onPointerDown);
  el.addEventListener("pointermove", ctx._onPointerMove);
  el.addEventListener("pointerup", ctx._onPointerUp);
  el.addEventListener("pointercancel", ctx._onPointerUp);
}

function detachPointerHandlers(ctx) {
  const el = ctx.renderer && ctx.renderer.domElement;
  if (!el) return;
  if (ctx._onPointerDown) el.removeEventListener("pointerdown", ctx._onPointerDown);
  if (ctx._onPointerMove) el.removeEventListener("pointermove", ctx._onPointerMove);
  if (ctx._onPointerUp)   el.removeEventListener("pointerup", ctx._onPointerUp);
  if (ctx._onPointerUp)   el.removeEventListener("pointercancel", ctx._onPointerUp);
  if (ctx._onDragOver)    el.removeEventListener("dragover", ctx._onDragOver);
  if (ctx._onDragLeave)   el.removeEventListener("dragleave", ctx._onDragLeave);
  if (ctx._onDrop)        el.removeEventListener("drop", ctx._onDrop);
}

function findInstInContext(ctx, instId) {
  // App state lookup would be nicer, but we don't have it here;
  // the mesh position is authoritative for the current drag cycle,
  // while the last-known inst w/h comes via findItem.
  const mesh = ctx.instMeshes.get(instId);
  if (!mesh) return null;
  return {
    instId,
    groupId: mesh.userData.groupId,
    itemId:  mesh.userData.itemId,
    x: mesh.position.x,
    y: mesh.position.z,
    rotation: mesh.userData.rotation || 0,
  };
}

// ---------- HTML5 DnD from catalog into the 3D canvas (desktop) ----------
function attachDomDropHandlers(ctx, container) {
  const el = ctx.renderer.domElement;

  ctx._onDragOver = (e) => {
    if (!e.dataTransfer.types.includes("text/apt-item")) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "copy";
    // Update placement ghost
    const raw = e.dataTransfer.getData("text/apt-item");
    // dragover rarely exposes getData; fall back to a simple floor marker
    const p = intersectFloor(ctx, e.clientX, e.clientY);
    updateExternalGhost(ctx, p, raw);
  };
  ctx._onDragLeave = () => { clearExternalGhost(ctx); };
  ctx._onDrop = (e) => {
    const data = e.dataTransfer.getData("text/apt-item");
    if (!data) return;
    e.preventDefault();
    clearExternalGhost(ctx);
    let parsed;
    try { parsed = JSON.parse(data); } catch { return; }
    const p = intersectFloor(ctx, e.clientX, e.clientY);
    if (!p) return;
    if (ctx.onDrop) ctx.onDrop({ groupId: parsed.groupId, itemId: parsed.itemId, x: p.x, y: p.z });
  };

  el.addEventListener("dragover", ctx._onDragOver);
  el.addEventListener("dragleave", ctx._onDragLeave);
  el.addEventListener("drop", ctx._onDrop);
}

function updateExternalGhost(ctx, point /*, raw*/) {
  if (!point) { clearExternalGhost(ctx); return; }
  if (!ctx.hoverGhost) {
    const ringGeo = new THREE.RingGeometry(12, 18, 32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0x2a8cff, transparent: true, opacity: 0.7, side: THREE.DoubleSide,
      depthTest: false,
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.rotation.x = -Math.PI / 2;
    ring.renderOrder = 999;
    ctx.hoverGhost = ring;
    ctx.ghostGroup.add(ring);
  }
  ctx.hoverGhost.position.set(point.x, 0.5, point.z);
}
function clearExternalGhost(ctx) {
  if (!ctx.hoverGhost) return;
  ctx.ghostGroup.remove(ctx.hoverGhost);
  disposeObj(ctx.hoverGhost);
  ctx.hoverGhost = null;
}

// ---------- Ray casting helpers ----------
const _raycaster = new THREE.Raycaster();
const _ndc = new THREE.Vector2();
function clientToNdc(ctx, clientX, clientY) {
  const rect = ctx.renderer.domElement.getBoundingClientRect();
  _ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
  _ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
  return _ndc;
}
function intersectFloor(ctx, clientX, clientY) {
  const ndc = clientToNdc(ctx, clientX, clientY);
  _raycaster.setFromCamera(ndc, ctx.camera);
  const hits = _raycaster.intersectObject(ctx.floor, false);
  if (!hits.length) return null;
  return hits[0].point;
}
function pickFurniture(ctx, clientX, clientY) {
  const ndc = clientToNdc(ctx, clientX, clientY);
  _raycaster.setFromCamera(ndc, ctx.camera);
  const hits = _raycaster.intersectObjects(ctx.furnitureGroup.children, true);
  if (!hits.length) return null;
  let o = hits[0].object;
  while (o && !(o.userData && o.userData.instId)) o = o.parent;
  return o || null;
}

// ---------- Theme / util ----------
function bgColorFromTheme() {
  return document.body.dataset.theme === "dark" ? 0x0c1020 : 0xeef1f8;
}
function hexToInt(str) {
  if (!str) return 0x888888;
  const s = str.trim().replace("#", "");
  const hex = s.length === 3 ? s.split("").map(c => c + c).join("") : s;
  return parseInt(hex, 16) || 0x888888;
}
function snap(v) { return Math.round(v / 5) * 5; }
function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// ---------- Walls ----------
function buildWalls(scene, room) {
  const t = WALL_THICK_3D;
  const walls = [
    { length: room.width, anchor: [0, 0, 0],                    axis: "x", wall: "top" },
    { length: room.width, anchor: [0, 0, room.depth - t],       axis: "x", wall: "bottom" },
    { length: room.depth, anchor: [0, 0, 0],                    axis: "z", wall: "left" },
    { length: room.depth, anchor: [room.width - t, 0, 0],       axis: "z", wall: "right" },
  ];
  const wallColor = lighter(hexToInt(room.wallColor || "#cccccc"), 0.92);
  const mat = new THREE.MeshStandardMaterial({
    color: wallColor, roughness: 0.9, side: THREE.DoubleSide,
  });

  walls.forEach(w => {
    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(w.length, 0);
    shape.lineTo(w.length, WALL_HEIGHT);
    shape.lineTo(0, WALL_HEIGHT);
    shape.lineTo(0, 0);

    const holes = [];
    (room.openings || []).filter(o => o.wall === w.wall).forEach(o => {
      const x0 = o.at;
      const x1 = o.at + o.size;
      const y0 = o.kind === "door" ? 0 : 90;
      const y1 = o.kind === "door" ? Math.min(210, WALL_HEIGHT - 10) : Math.min(220, WALL_HEIGHT - 10);
      const hole = new THREE.Path();
      hole.moveTo(x0, y0);
      hole.lineTo(x1, y0);
      hole.lineTo(x1, y1);
      hole.lineTo(x0, y1);
      hole.lineTo(x0, y0);
      holes.push(hole);
    });
    shape.holes = holes;

    const geom = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    const mesh = new THREE.Mesh(geom, mat);
    if (w.axis === "x") {
      mesh.position.set(w.anchor[0], 0, w.anchor[2]);
    } else {
      mesh.rotation.y = -Math.PI / 2;
      mesh.position.set(w.anchor[0] + t, 0, w.anchor[2]);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.wallId = w.wall;
    scene.add(mesh);
  });
}

function lighter(colorInt, amount) {
  const r = Math.round(((colorInt >> 16) & 0xff) + (255 - ((colorInt >> 16) & 0xff)) * amount);
  const g = Math.round(((colorInt >> 8)  & 0xff) + (255 - ((colorInt >> 8)  & 0xff)) * amount);
  const b = Math.round(( colorInt        & 0xff) + (255 - ( colorInt        & 0xff)) * amount);
  return (r << 16) | (g << 8) | b;
}

// ---------- Furniture mesh ----------
function buildFurnitureMesh(inst, item) {
  const w = item.w;
  const d = item.h;                                // 2D "h" = top-down depth
  const h = item.depth || defaultHeight(item);     // real 3D height
  const geom = new THREE.BoxGeometry(w, h, d);

  const isCustom = inst.groupId === "custom" && item.image;
  let materials;
  if (isCustom) {
    const sideColor = hexToInt(item.sideColor || item.color || "#888888");
    const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.85 });
    const tex = new THREE.TextureLoader().load(
      item.image, undefined, undefined,
      (err) => { console.warn("Texture load failed:", err); }
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    const frontMat = new THREE.MeshStandardMaterial({
      map: tex, roughness: 0.9,
      emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.25,
    });
    const frontMatBack = frontMat.clone();
    materials = [sideMat, sideMat.clone(), sideMat.clone(), sideMat.clone(), frontMat, frontMatBack];
  } else {
    const mat = new THREE.MeshStandardMaterial({
      color: hexToInt(item.color || "#888888"),
      roughness: 0.8,
      transparent: (item.opacity ?? 1) < 1,
      opacity: item.opacity ?? 1,
    });
    materials = mat;
  }
  const mesh = new THREE.Mesh(geom, materials);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.groupId = inst.groupId;
  mesh.userData.itemId  = inst.itemId;
  mesh.userData.rotation = inst.rotation || 0;
  mesh.position.set(inst.x, h / 2, inst.y);
  mesh.rotation.y = -((inst.rotation || 0) * Math.PI) / 180;
  return mesh;
}

// Sensible default heights for built-in items (cm) when they don't define depth explicitly.
function defaultHeight(item) {
  const id = item.id;
  const byId = {
    sofa3: 85, sofa2: 85, sofa_l: 85, armchair: 85, coffee: 42,
    tv_unit: 50, tv: 70, bookshelf: 200, dine_tbl: 75, dine_chair: 90, rug: 1, plant: 80,
    bed_single: 50, bed_double: 50, bed_king: 50, nightstand: 55,
    wardrobe: 220, dresser: 80, desk: 75, chair: 90,
    fridge: 180, stove: 90, sink: 90, counter: 90, upper_cab: 70, microwave: 30,
    dine_tbl2: 75, dine_chair2: 90,
    bathtub: 55, toilet: 80, basin: 85, shower: 210, washer: 85, heater: 55,
    floor_lamp: 160, ac_split: 25, curtain: 250, entry_rug: 1,
  };
  if (byId[id]) return byId[id];
  const minSide = Math.min(item.w, item.h);
  return minSide < 30 ? 40 : 70;
}

window.AptThreeView = { show, hide, updateItems, setSelection, isActiveFor, screenToRoomCoords };
