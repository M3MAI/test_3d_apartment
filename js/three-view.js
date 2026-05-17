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
import { PointerLockControls } from "three/addons/controls/PointerLockControls.js";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const WALL_HEIGHT   = 270;     // cm — default ceiling height when room.height is missing
const WALL_THICK_3D = 10;      // cm
function wallH(room) {
  return (room && Number.isFinite(room.height) && room.height >= 200) ? room.height : WALL_HEIGHT;
}

// ---------- Renderer profile (mobile/tablet performance) ----------
// Conservative profile: keeps every visual feature (antialias, shadows, env
// map) and only tunes two things — the device pixel ratio cap, and the size
// of the shadow map. That avoids the mobile crash modes we hit when toggling
// `powerPreference` or disabling features the rest of the scene assumes are
// on. A localStorage override key `apt_3d_quality` ("low" | "high") lets a
// user force either tier; otherwise we auto-detect mobile-like environments.
function isMobileLike() {
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const small  = Math.min(window.innerWidth || 9999, window.innerHeight || 9999) < 900;
  const lowCores = (navigator.hardwareConcurrency || 8) <= 4;
  const lowMem   = (navigator.deviceMemory || 8) <= 4;
  return coarse && (small || lowCores || lowMem);
}
function isTabletLike() {
  // Tablets: touch-primary but with larger screens (>= 768px short side) and
  // decent hardware. They can handle more than phones but less than desktops.
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const shortSide = Math.min(window.innerWidth || 9999, window.innerHeight || 9999);
  const isLargeTouch = coarse && shortSide >= 768;
  const decentHW = (navigator.hardwareConcurrency || 8) >= 4 && (navigator.deviceMemory || 8) >= 4;
  return isLargeTouch && decentHW;
}
function getRendererProfile() {
  let forced = null;
  try { forced = localStorage.getItem("apt_3d_quality"); } catch (_) {}
  const isPhone = forced ? (forced === "low") : isMobileLike();
  const isTablet = !isPhone && (forced ? false : isTabletLike());
  const low = isPhone;
  const mid = isTablet;
  return {
    low,
    mid,
    // Cap DPR: 1.0 on phones (huge perf win), 1.5 on tablets, 2 on desktop.
    pixelRatio: Math.min(window.devicePixelRatio || 1, low ? 1.0 : mid ? 1.5 : 2),
    // Shadow maps: small on phones, medium on tablets, large on desktop.
    shadowMapSize: low ? 256 : mid ? 512 : 1024,
    aptShadowMapSize: low ? 512 : mid ? 1024 : 2048,
    // On phones, disable shadows on GLB meshes entirely; on tablets keep them.
    glbShadows: !low,
    // On phones, downgrade GLB PBR materials to cheaper Lambert shading.
    // On tablets, keep Standard materials but downscale textures to 1024px.
    simplifyGlbMaterials: low,
    // Max texture size for GLB models on this tier.
    glbMaxTextureSize: low ? 512 : mid ? 1024 : 2048,
  };
}
// Expose a console-friendly toggle: AptThreeView.setQuality("low"|"high"|"auto").
// Reload-required (settings bake into the renderer at scene-build time).
function setQuality(level) {
  try {
    if (level === "auto") localStorage.removeItem("apt_3d_quality");
    else                  localStorage.setItem("apt_3d_quality", level);
  } catch (_) {}
  return getRendererProfile();
}

let ctx = null;                // per-show rendering context  (room-level 3D)
let aptCtx = null;             // per-show apartment walkthrough context
const _collRay = new THREE.Raycaster(); // reusable raycaster for wall collision (#1)
const _glbCache = new Map();           // GLB model cache — parses once, clones on reuse

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
  hideApartment();
  hideRoomOnly();
}

// Tears down only the room-level 3D context (leaves apartment walkthrough intact).
function hideRoomOnly() {
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

function hideApartment() {
  if (!aptCtx) return;
  if (aptCtx.resizeObs) aptCtx.resizeObs.disconnect();
  if (aptCtx.raf) cancelAnimationFrame(aptCtx.raf);
  if (aptCtx.cleanup) aptCtx.cleanup();
  if (aptCtx.controls && aptCtx.controls.dispose) aptCtx.controls.dispose();
  disposeObj(aptCtx.scene);
  if (aptCtx.renderer) {
    aptCtx.renderer.dispose();
    aptCtx.renderer.domElement.remove();
  }
  aptCtx = null;
}

function isActiveFor(roomId) {
  return !!(ctx && ctx.roomId === roomId);
}

// ---------- Show / build scene ----------
function show(container, opts) {
  hide(); // idempotent
  const { room, items, findItem, onSelect, onDrop, onMove } = opts;
  const initialCollisions = opts.collisionSet || new Set();
  const initialBlocked = opts.blockedSet || new Set();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bgColorFromTheme());

  const camera = new THREE.PerspectiveCamera(
    45,
    Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
    1,
    8000
  );
  const profile = getRendererProfile();
  const renderer = new THREE.WebGLRenderer({
    antialias: !profile.low,    // disable AA on mobile — big fill-rate savings
    preserveDrawingBuffer: !profile.low,  // allow GPU double-buffering on mobile
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(profile.pixelRatio);
  renderer.setSize(container.clientWidth || 800, container.clientHeight || 500);
  renderer.shadowMap.enabled = true;
  // BasicShadowMap is ~3× cheaper than the default PCFShadowMap; good enough
  // for overview mode and drastically reduces GPU cost with GLB models.
  if (profile.low) renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  // Environment map for PBR/GLB materials (makes them show true colors)
  const pmremGen = new THREE.PMREMGenerator(renderer);
  pmremGen.compileEquirectangularShader();
  scene.environment = pmremGen.fromScene(new RoomEnvironment()).texture;
  pmremGen.dispose();

  // Lights
  scene.add(new THREE.AmbientLight(0xffffff, 0.8));
  const key = new THREE.DirectionalLight(0xffffff, 0.85);
  key.position.set(room.width * 0.6, WALL_HEIGHT * 2, room.depth * 0.4);
  key.castShadow = true;
  key.shadow.mapSize.set(profile.shadowMapSize, profile.shadowMapSize);
  key.shadow.camera.left   = -room.width;
  key.shadow.camera.right  =  room.width;
  key.shadow.camera.top    =  room.depth;
  key.shadow.camera.bottom = -room.depth;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xffffff, 0.25);
  fill.position.set(-room.width * 0.3, WALL_HEIGHT * 1.5, -room.depth * 0.3);
  scene.add(fill);

  // Floor — use explicit floorColor if defined; otherwise a neutral tile color
  // so the wall color stays distinct from the floor (the old code used
  // wallColor for both, which made the floor blend into the walls). When the
  // room has a custom polygon (room.vertices), the floor follows that shape;
  // when room.floorTexture === "tile-cream", a procedural tile texture is used.
  const useTile = room.floorTexture === "tile-cream";
  const floorMatOpts = useTile
    ? { map: getTileCreamTexture(room.width, room.depth) }
    : { color: hexToInt(room.floorColor || "#e6ddcf") };
  const floorMat = new THREE.MeshBasicMaterial(floorMatOpts);
  let floor;
  if (room.vertices && room.vertices.length >= 3) {
    const fGeo = new THREE.ShapeGeometry(shapeFromVertices(room.vertices));
    floor = new THREE.Mesh(fGeo, floorMat);
    floor.rotation.x = Math.PI / 2;
    floor.position.set(0, 0, 0);
  } else {
    const floorGeo = new THREE.PlaneGeometry(room.width, room.depth);
    floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(room.width / 2, 0, room.depth / 2);
  }
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

  // Tray ceiling + cove LED + downlights (room.ceiling flag in rooms.js)
  const ceilingGroup = buildCeiling(scene, room, /*useStandard*/ false, 0, 0);

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
    // Wall visibility controls — managed externally via setWallVisibility().
    // manualHidden: ids that user toggled OFF (always hidden until toggled on).
    // autoHide: when true, also hide whichever wall faces the camera.
    manualHidden: new Set(opts.initialHidden || []),
    autoHide: opts.autoHide !== false,
  };

  renderItems(ctx, items);
  applyCollisionTint(ctx, initialCollisions, initialBlocked);
  attachPointerHandlers(ctx, container);
  attachDomDropHandlers(ctx, container);

  // Resize
  ctx.resizeObs = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
    _needsRender = true;   // resize needs a re-render
  });
  ctx.resizeObs.observe(container);

  // Animate + near-wall culling
  const roomCenter = new THREE.Vector3(room.width / 2, WALL_HEIGHT / 2, room.depth / 2);
  let _lastAutoHideId = null;
  let _frameCount = 0;
  let _needsRender = true;
  // Mark dirty when controls change (orbit/pan/zoom) or when items update
  controls.addEventListener("change", () => { _needsRender = true; });
  // Expose a way to force re-render from outside (e.g. after item move)
  ctx._markDirty = () => { _needsRender = true; };
  const loop = () => {
    ctx.raf = requestAnimationFrame(loop);
    // Skip expensive controls.update + render when the tab/canvas is hidden.
    // Browsers throttle RAF when hidden but still fire it; the early-return
    // prevents bursty GPU work after long background periods on mobile.
    if (document.hidden) return;
    _frameCount++;
    controls.update();  // fires 'change' event if damping is still active → sets _needsRender

    // Skip GPU work entirely when scene hasn't changed (no camera move,
    // no item update, no resize). This is the single biggest idle-power
    // savings — a static 3D view drops from 60 render() calls/sec to 0.
    if (!_needsRender) return;

    // Wall visibility: combine manual hides (Set) with optional auto-hide of
    // whichever wall faces the camera. Only recompute when camera moved.
    let autoHideId = null;
    if (ctx.autoHide) {
      const cx = camera.position.x - roomCenter.x;
      const cz = camera.position.z - roomCenter.z;
      if (Math.abs(cx) >= Math.abs(cz)) autoHideId = cx >= 0 ? "right" : "left";
      else                              autoHideId = cz >= 0 ? "bottom" : "top";
    }
    if (autoHideId !== _lastAutoHideId) {
      _lastAutoHideId = autoHideId;
      wallList.forEach(m => {
        const id = m.userData.wallId;
        const manual = ctx.manualHidden.has(id);
        m.visible = !manual && id !== autoHideId;
      });
    }

    // Hide the ceiling when the camera looks from above (so the user can see
    // inside the room from the orbit overview). Show it once the camera dips
    // below ~110% of ceiling height — i.e. when looking horizontally or up.
    if (ceilingGroup) {
      const H = wallH(room);
      ceilingGroup.visible = camera.position.y < H * 1.1;
    }

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

    // Billboard cutouts: rotate to face camera
    ctx.instMeshes.forEach((mesh) => {
      if (mesh.userData._isBillboard) {
        mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z);
      }
    });

    renderer.render(scene, camera);
    _needsRender = false;
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
  // Rebuild on anything that changes geometry/materials (including dimension overrides)
  return [inst.groupId, inst.itemId,
    inst.overrideW || item.w,
    inst.overrideH || item.h,
    inst.overrideDepth || item.depth || "",
    item.color || "",
    item.image ? "img" : "flat",
    item.hasAlpha ? "alpha" : "",
    item.useBox ? "box" : "bb",
    item.imageSide ? "side" : "",
    item.imageTop ? "top" : "",
    item.autoSide ? "as" : "",
    item.autoTop ? "at" : "",
    item.glbData ? "glb" : "",
  ].join("|");
}

function applyInstTransform(mesh, inst, item) {
  const w = inst.overrideW || item.w;
  const d = inst.overrideH || item.h;
  const h = inst.overrideDepth || item.depth || defaultHeight(item);
  const lift = Number.isFinite(inst.liftedZ) ? inst.liftedZ : 0;
  // GLB models sit on the ground; photo meshes center at h/2
  const yPos = mesh.userData._isGLB ? lift : (h / 2 + lift);
  mesh.position.set(inst.x, yPos, inst.y);
  // Billboard meshes auto-face camera in the render loop — skip manual rotation
  if (!mesh.userData._isBillboard) {
    mesh.rotation.set(
      -((inst.rotationX || 0) * Math.PI) / 180,
      -((inst.rotation  || 0) * Math.PI) / 180,
      -((inst.rotationZ || 0) * Math.PI) / 180
    );
  }
  mesh.userData.rotation = inst.rotation || 0;
}

function updateItems(items, findItem, selectedInstId, collisionSet, blockedSet) {
  if (!ctx) return;
  ctx.findItem = findItem;
  renderItems(ctx, items);
  ctx.selectedInstId = selectedInstId || null;
  applyCollisionTint(ctx, collisionSet || new Set(), blockedSet || new Set());
  if (ctx._markDirty) ctx._markDirty();
}

// Red emissive tint on any mesh whose instId is in the collision set.
// Orange tint (lower priority) for items blocking a door/window.
function applyCollisionTint(ctx, collisionSet, blockedSet = new Set()) {
  ctx.instMeshes.forEach((mesh, instId) => {
    const collides = collisionSet.has(instId);
    const blocks = !collides && blockedSet.has(instId);
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    mats.forEach(m => {
      if (!m) return;
      if (collides || blocks) {
        if (m.userData._origEmissive === undefined) {
          m.userData._origEmissive = (m.emissive && m.emissive.getHex) ? m.emissive.getHex() : 0x000000;
          m.userData._origEmissiveIntensity = m.emissiveIntensity ?? 1;
        }
        if (m.emissive && m.emissive.setHex) m.emissive.setHex(collides ? 0xff3333 : 0xffa040);
        m.emissiveIntensity = collides ? 0.55 : 0.45;
      } else if (m.userData._origEmissive !== undefined) {
        if (m.emissive && m.emissive.setHex) m.emissive.setHex(m.userData._origEmissive);
        m.emissiveIntensity = m.userData._origEmissiveIntensity ?? 1;
        delete m.userData._origEmissive;
        delete m.userData._origEmissiveIntensity;
      }
    });
  });
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

// ---------- Polygon helpers ----------
// Classifies polygon edges into top/bottom/left/right (for openings + textures)
// or null for inner-protrusion edges. Uses bounding-box alignment.
function classifyPolygonEdges(verts) {
  const minX = Math.min(...verts.map(v => v.x));
  const maxX = Math.max(...verts.map(v => v.x));
  const minY = Math.min(...verts.map(v => v.y));
  const maxY = Math.max(...verts.map(v => v.y));
  const TOL = 1; // cm
  return verts.map((a, i) => {
    const b = verts[(i + 1) % verts.length];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const horiz = Math.abs(dy) < 0.5;
    const vert  = Math.abs(dx) < 0.5;
    const midY = (a.y + b.y) / 2;
    const midX = (a.x + b.x) / 2;
    let dir = null;
    if      (horiz && Math.abs(midY - minY) < TOL) dir = "top";
    else if (horiz && Math.abs(midY - maxY) < TOL) dir = "bottom";
    else if (vert  && Math.abs(midX - minX) < TOL) dir = "left";
    else if (vert  && Math.abs(midX - maxX) < TOL) dir = "right";
    return { a, b, dx, dy, len, angle, dir, idx: i };
  });
}

// Maps each opening (which references one of top/bottom/left/right) onto the
// best matching polygon edge whose extent covers the opening range.
// Returns Map<edgeIdx, opening[]>.
function assignOpeningsToEdges(edges, openings) {
  const out = new Map();
  (openings || []).forEach(op => {
    const candidates = edges.filter(e => e.dir === op.wall);
    if (!candidates.length) return;
    // Prefer the edge whose range fully contains [op.at, op.at+op.size].
    const isHoriz = (op.wall === "top" || op.wall === "bottom");
    let best = null;
    for (const e of candidates) {
      const lo = isHoriz ? Math.min(e.a.x, e.b.x) : Math.min(e.a.y, e.b.y);
      const hi = isHoriz ? Math.max(e.a.x, e.b.x) : Math.max(e.a.y, e.b.y);
      if (op.at >= lo - 0.5 && (op.at + op.size) <= hi + 0.5) { best = e; break; }
    }
    if (!best) {
      // Fallback: pick the longest candidate (opening will be clipped).
      best = candidates.reduce((p, c) => c.len > p.len ? c : p);
    }
    if (!out.has(best.idx)) out.set(best.idx, []);
    out.get(best.idx).push(op);
  });
  return out;
}

// Converts an opening's [at, at+size] in wall-frame coords to local edge coords
// (where local x runs from edge.a along the edge direction).
function openingToLocalEdgeRange(op, edge) {
  const isHoriz = (op.wall === "top" || op.wall === "bottom");
  const sign = isHoriz ? (edge.b.x > edge.a.x ? 1 : -1)
                       : (edge.b.y > edge.a.y ? 1 : -1);
  const startCoord = isHoriz ? edge.a.x : edge.a.y;
  const lx1 = (op.at - startCoord) * sign;
  const lx2 = (op.at + op.size - startCoord) * sign;
  let lo = Math.min(lx1, lx2);
  let hi = Math.max(lx1, lx2);
  if (hi <= 0 || lo >= edge.len) return null; // doesn't fall on this edge
  lo = Math.max(0, lo);
  hi = Math.min(edge.len, hi);
  return [lo, hi];
}

// Polygon room footprint helpers — used both for walls iteration and ceiling.
function getRoomEdges(room) {
  if (room.vertices && room.vertices.length >= 3) {
    return classifyPolygonEdges(room.vertices);
  }
  // Fallback: rectangular 4 edges (CCW).
  const w = room.width, d = room.depth;
  return classifyPolygonEdges([
    { x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: d }, { x: 0, y: d }
  ]);
}

// Builds a tile-cream procedural texture (large beige ceramic tiles with grout
// lines). The underlying canvas is built once and shared across all instances,
// but every caller gets its own `Texture` clone so it can set `.repeat`
// independently. (Pre-fix: multiple rooms in the apartment walkthrough mutated
// the same singleton's `.repeat` and the last writer won — see audit C-06.)
let _tileCreamTextureBase = null;
function _getTileCreamBase() {
  if (_tileCreamTextureBase) return _tileCreamTextureBase;
  const canvas = document.createElement("canvas");
  canvas.width = 256; canvas.height = 256;
  const ctx2 = canvas.getContext("2d");
  ctx2.fillStyle = "#e6d9c2";
  ctx2.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 800; i++) {
    const x = Math.random() * 256, y = Math.random() * 256;
    const a = 0.04 + Math.random() * 0.06;
    ctx2.fillStyle = `rgba(180,160,120,${a})`;
    ctx2.fillRect(x, y, 1, 1);
  }
  ctx2.strokeStyle = "#c8b896";
  ctx2.lineWidth = 2;
  ctx2.beginPath();
  ctx2.moveTo(128, 0); ctx2.lineTo(128, 256);
  ctx2.moveTo(0, 128); ctx2.lineTo(256, 128);
  ctx2.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  _tileCreamTextureBase = tex;
  return tex;
}
// Returns a fresh Texture sharing the cached canvas source. Caller may set
// `.repeat` freely without affecting other rooms.
function getTileCreamTexture(roomWidth, roomDepth) {
  const base = _getTileCreamBase();
  const tex = base.clone();
  tex.needsUpdate = true;
  if (roomWidth && roomDepth) {
    tex.repeat.set(Math.max(1, roomWidth / 120), Math.max(1, roomDepth / 120));
  }
  return tex;
}

// ---------------------------------------------------------------------------
// Wall photo texture cache.
//
// Builds a CanvasTexture from a (possibly large) data-URL once per
// (dataUrl + settings) signature, and reuses it on every rebuild. This avoids
// the previous behaviour of creating a brand-new TextureLoader on every call,
// which leaked GPU memory and slowed scene rebuilds noticeably for rooms with
// 4 wall photos.
//
// Settings shape: { fit: 'cover'|'stretch'|'tile', tileX, tileY, brightness, contrast }
//   * cover    — texture stretched once to cover the wall, UV (1,1).
//   * stretch  — same as cover (alias) — kept for future planar warping.
//   * tile     — repeat texture tileX × tileY across the wall.
//   * brightness/contrast — applied via offscreen canvas filter once on creation.
// ---------------------------------------------------------------------------
// LRU-bounded wall-photo texture cache.
//
// Why LRU + dispose: the previous implementation was an unbounded `Map` which
// leaked GPU memory whenever the user tweaked sliders (every brightness/
// contrast/blend tweak creates a new cache entry; old textures were never
// disposed). The cache now caps at WALL_PHOTO_CACHE_MAX entries; on insertion
// the oldest entry is evicted and its `THREE.Texture` is disposed.
//
// Sizing: the worst realistic in-flight count is 8 rooms × 4 walls = 32
// distinct textures, but in practice most rooms reuse defaults / share photos.
// 24 is generous without being wasteful.
const WALL_PHOTO_CACHE_MAX = 24;
const _wallPhotoCache = new Map();
function _wallPhotoCacheTouch(key) {
  // LRU bump: re-insert moves the entry to the tail of the Map iteration order.
  const v = _wallPhotoCache.get(key);
  _wallPhotoCache.delete(key);
  _wallPhotoCache.set(key, v);
  return v;
}
function _wallPhotoCacheInsert(key, tex) {
  _wallPhotoCache.set(key, tex);
  while (_wallPhotoCache.size > WALL_PHOTO_CACHE_MAX) {
    const oldestKey = _wallPhotoCache.keys().next().value;
    const oldestTex = _wallPhotoCache.get(oldestKey);
    _wallPhotoCache.delete(oldestKey);
    if (oldestTex && typeof oldestTex.dispose === "function") {
      try { oldestTex.dispose(); } catch (_) { /* already disposed */ }
    }
  }
}
function _wallPhotoSig(dataUrl, settings, wallColor) {
  // Hash data URL by (length + first/last 32 chars) — collision-resistant
  // enough for practical use, far cheaper than hashing the entire string.
  const head = dataUrl.slice(0, 32), tail = dataUrl.slice(-32);
  const len = dataUrl.length;
  const s = settings || {};
  return `${len}|${head}|${tail}|${s.fit||"cover"}|${s.tileX||1}|${s.tileY||1}|${s.brightness||0}|${s.contrast||0}|${s.blend||"normal"}|${wallColor||""}`;
}
// Map our blend keywords to the corresponding canvas globalCompositeOperation.
const _BLEND_OPS = {
  normal:       null,
  multiply:     "multiply",
  screen:       "screen",
  overlay:      "overlay",
  "soft-light": "soft-light",
  "hard-light": "hard-light",
  darken:       "darken",
  lighten:      "lighten",
  color:        "color",   // tint by hue+sat of wall color
};
// 1×1 white placeholder canvas reused across all in-flight wall-photo textures.
// Without it, a freshly created THREE.Texture has `image: undefined` which the
// shader samples as transparent black — producing a brief "flash of black" on
// every wall while the real <img> loads. Seeding with white-pixel preserves
// the wall's solid color (multiplied with map=#ffffff) until the photo is in.
let _wallPhotoPlaceholder = null;
function _getWallPhotoPlaceholder() {
  if (_wallPhotoPlaceholder) return _wallPhotoPlaceholder;
  const c = document.createElement("canvas");
  c.width = 1; c.height = 1;
  const cx = c.getContext("2d");
  cx.fillStyle = "#ffffff";
  cx.fillRect(0, 0, 1, 1);
  _wallPhotoPlaceholder = c;
  return c;
}
function getWallPhotoTexture(dataUrl, settings, wallColor) {
  if (!dataUrl) return null;
  const key = _wallPhotoSig(dataUrl, settings, wallColor);
  if (_wallPhotoCache.has(key)) return _wallPhotoCacheTouch(key);
  // Build asynchronously on an Image, then bake to a canvas with filter
  // and optional blend mode against the wall's solid color.
  // The texture is created up-front (seeded with a 1×1 white pixel so it's
  // not flash-of-black) so callers get a stable reference for material
  // assignment; its real .image is swapped in once the <img> resolves.
  const tex = new THREE.Texture(_getWallPhotoPlaceholder());
  tex.needsUpdate = true;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.RepeatWrapping;
  const img = new Image();
  img.onload = () => {
    const w = img.width, h = img.height;
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx2 = canvas.getContext("2d");
    const s = settings || {};
    const blendOp = _BLEND_OPS[s.blend || "normal"];
    // For non-trivial blends we paint the wall color underneath, then
    // composite the (filtered) photo on top with the chosen blend mode.
    if (blendOp && wallColor) {
      ctx2.fillStyle = wallColor;
      ctx2.fillRect(0, 0, w, h);
      const b = Math.max(-50, Math.min(50, s.brightness || 0));
      const c = Math.max(-50, Math.min(50, s.contrast || 0));
      if (b !== 0 || c !== 0) {
        ctx2.filter = `brightness(${100 + b}%) contrast(${100 + c}%)`;
      }
      ctx2.globalCompositeOperation = blendOp;
      ctx2.drawImage(img, 0, 0, w, h);
      ctx2.globalCompositeOperation = "source-over";
      ctx2.filter = "none";
    } else {
      const b = Math.max(-50, Math.min(50, s.brightness || 0));
      const c = Math.max(-50, Math.min(50, s.contrast || 0));
      if (b !== 0 || c !== 0) {
        ctx2.filter = `brightness(${100 + b}%) contrast(${100 + c}%)`;
      }
      ctx2.drawImage(img, 0, 0, w, h);
    }
    tex.image = canvas;
    tex.needsUpdate = true;
  };
  img.onerror = () => {
    // The texture stays at its 1×1 white placeholder. Tag it so we can drop
    // failed entries from the cache on the next sweep instead of holding
    // onto unusable textures.
    tex.userData = tex.userData || {};
    tex.userData.loadFailed = true;
  };
  img.src = dataUrl;
  const fit = (settings && settings.fit) || "cover";
  if (fit === "tile") {
    const tx = Math.max(1, Math.min(20, (settings && settings.tileX) || 2));
    const ty = Math.max(1, Math.min(20, (settings && settings.tileY) || 2));
    tex.repeat.set(tx, ty);
  } else {
    tex.repeat.set(1, 1);
  }
  _wallPhotoCacheInsert(key, tex);
  return tex;
}
// Public for testability/debug.
if (typeof window !== "undefined") {
  window._aptWallPhotoCache = _wallPhotoCache;
}

// ---------------------------------------------------------------------------
// Opening hole geometry — shared between rectangular and polygon wall builders.
// ---------------------------------------------------------------------------
// Adds a `THREE.Path` for one opening to the `holes` array.
//   lo, hi : start/end of the opening along the wall's local axis (cm)
//   H      : wall height (cm)
//   op     : the opening object — uses op.kind ("door"|"window") and
//            optionally op.arched (segmental arch top instead of flat lintel).
//
// Door height ≈ 210 cm, window sill 90 cm + top 220 cm. When `op.arched` is
// true on a door, the top edge becomes a parabolic arch with rise = min(50, width/4).
function _addOpeningHole(holes, op, lo, hi, H) {
  const isDoor = op.kind === "door";
  const y0 = isDoor ? 0 : 90;
  const y1 = isDoor ? Math.min(210, H - 10) : Math.min(220, H - 10);
  const hole = new THREE.Path();
  if (op.arched && isDoor) {
    const archRise = Math.min(50, (hi - lo) / 4);
    const archStart = Math.max(y0 + 1, y1 - archRise);
    const mid = (lo + hi) / 2;
    hole.moveTo(lo, y0);
    hole.lineTo(hi, y0);
    hole.lineTo(hi, archStart);
    // Quadratic Bezier from (hi, archStart) over (mid, archStart + 2*archRise)
    // to (lo, archStart). The curve's apex is at (mid, archStart + archRise) = (mid, y1).
    hole.quadraticCurveTo(mid, archStart + 2 * archRise, lo, archStart);
    hole.lineTo(lo, y0);
  } else {
    hole.moveTo(lo, y0);
    hole.lineTo(hi, y0);
    hole.lineTo(hi, y1);
    hole.lineTo(lo, y1);
    hole.lineTo(lo, y0);
  }
  holes.push(hole);
}

// Renders a white plaster arch-trim (surround molding) over an arched door opening.
// Traces the same quadratic-bezier arch used by _addOpeningHole and wraps it in a
// TubeGeometry — matching the white gypsum border in the real apartment (new/t_015).
function _buildArchTrim(scene, op, lo, hi, wallMeshPos, wallAngle, useStandard) {
  if (!op.arched) return;
  const archRise  = Math.min(50, (hi - lo) / 4);
  const archStart = Math.max(1, 210 - archRise);
  const mid = (lo + hi) / 2;
  const pts = [];
  for (let y = 0; y <= archStart; y += 12) pts.push(new THREE.Vector3(lo, y, 0));
  for (let i = 0; i <= 16; i++) {
    const t2 = i / 16;
    const bx = (1-t2)*(1-t2)*lo + 2*(1-t2)*t2*mid + t2*t2*hi;
    const by = (1-t2)*(1-t2)*archStart + 2*(1-t2)*t2*(archStart+2*archRise) + t2*t2*archStart;
    pts.push(new THREE.Vector3(bx, by, 0));
  }
  for (let y = archStart; y >= 0; y -= 12) pts.push(new THREE.Vector3(hi, y, 0));
  const curve    = new THREE.CatmullRomCurve3(pts, false, "catmullrom", 0.05);
  const tubeGeom = new THREE.TubeGeometry(curve, pts.length * 3, 4, 4, false);
  const mat = useStandard
    ? new THREE.MeshStandardMaterial({ color: 0xfafafa, roughness: 0.85 })
    : new THREE.MeshBasicMaterial({ color: 0xfafafa });
  const trimMesh = new THREE.Mesh(tubeGeom, mat);
  trimMesh.position.copy(wallMeshPos);
  trimMesh.rotation.y = wallAngle;
  trimMesh.userData.ceilingPart = true;
  scene.add(trimMesh);
}

// Builds a Shape from polygon vertices (in cm).
function shapeFromVertices(verts) {
  const shape = new THREE.Shape();
  shape.moveTo(verts[0].x, verts[0].y);
  for (let i = 1; i < verts.length; i++) shape.lineTo(verts[i].x, verts[i].y);
  shape.lineTo(verts[0].x, verts[0].y);
  return shape;
}

// ---------- Walls ----------
function buildWalls(scene, room) {
  if (room.vertices && room.vertices.length >= 3) {
    return buildWallsFromVertices(scene, room, /*useStandard*/ false);
  }
  const t = WALL_THICK_3D;
  const walls = [
    { length: room.width, anchor: [0, 0, 0],                    axis: "x", wall: "top" },
    { length: room.width, anchor: [0, 0, room.depth - t],       axis: "x", wall: "bottom" },
    { length: room.depth, anchor: [0, 0, 0],                    axis: "z", wall: "left" },
    { length: room.depth, anchor: [room.width - t, 0, 0],       axis: "z", wall: "right" },
  ];

  const H = wallH(room);
  walls.forEach(w => {
    // Per-wall color: use resolveWallColor() if available, else fall back to
    // the old wallColor + accentColor logic for backward compat.
    const wallHex = (typeof resolveWallColor === "function")
      ? resolveWallColor(room, w.wall)
      : (room.accentColor && room.accentWall === w.wall
          ? room.accentColor
          : (room.wallColor || "#eeeeee"));
    // Use the exact hex color — MeshBasicMaterial ignores scene lighting
    // so the wall renders the EXACT color from the hex value, no distortion.
    const colorInt = hexToInt(wallHex);
    const matOpts = { color: colorInt, side: THREE.DoubleSide };
    // Wall photo texture: load via cache + honour per-wall fit/tile/brightness
    // settings (room.wallTextureSettings[w.wall]).
    const wallTextures = room.wallTextures || {};
    const wallTexSettings = room.wallTextureSettings || {};
    if (wallTextures[w.wall]) {
      const tex = getWallPhotoTexture(wallTextures[w.wall], wallTexSettings[w.wall], wallHex);
      if (tex) {
        matOpts.map = tex;
        matOpts.color = 0xffffff;
      }
    }
    const mat = new THREE.MeshBasicMaterial(matOpts);

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(w.length, 0);
    shape.lineTo(w.length, H);
    shape.lineTo(0, H);
    shape.lineTo(0, 0);

    const holes = [];
    (room.openings || []).filter(o => o.wall === w.wall).forEach(o => {
      _addOpeningHole(holes, o, o.at, o.at + o.size, H);
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
    // Arch-trim molding for arched openings (white plaster surround).
    (room.openings || []).filter(o => o.wall === w.wall && o.arched).forEach(o => {
      _buildArchTrim(scene, o, o.at, o.at + o.size, mesh.position.clone(), mesh.rotation.y, /*useStandard*/ false);
    });
  });
  // Crown molding (only when ceiling is configured for this room)
  if (room.ceiling) buildCrownMolding(scene, room, /*useStandard*/ false, 0, 0);
}

// Polygon-aware wall builder. For each polygon edge, builds a wall mesh whose
// local +X runs from edge.a to edge.b, with proper opening cutouts.
// useStandard: true -> MeshStandardMaterial (apartment overview),
//              false -> MeshBasicMaterial (single-room view, exact colors).
// offX/offZ: world offset (used by buildRoomAt for the apartment scene).
function buildWallsFromVertices(scene, room, useStandard, offX, offZ, collidables) {
  const t = WALL_THICK_3D;
  const H = wallH(room);
  const ox = offX || 0, oz = offZ || 0;
  const edges = classifyPolygonEdges(room.vertices);
  const opMap = assignOpeningsToEdges(edges, room.openings);

  edges.forEach(e => {
    const wallHex = (typeof resolveWallColor === "function")
      ? resolveWallColor(room, e.dir || "top")
      : (room.wallColor || "#eeeeee");
    const colorInt = useStandard
      ? lighter(hexToInt(wallHex), e.dir && room.accentWall === e.dir && room.accentColor ? 0.0 : 0.15)
      : hexToInt(wallHex);
    const matOpts = useStandard
      ? { color: colorInt, roughness: 0.9, side: THREE.DoubleSide }
      : { color: colorInt, side: THREE.DoubleSide };
    const wallTextures = room.wallTextures || {};
    const wallTexSettings = room.wallTextureSettings || {};
    if (e.dir && wallTextures[e.dir]) {
      const tex = getWallPhotoTexture(wallTextures[e.dir], wallTexSettings[e.dir], wallHex);
      if (tex) {
        matOpts.map = tex;
        matOpts.color = 0xffffff;
      }
    }
    const mat = useStandard
      ? new THREE.MeshStandardMaterial(matOpts)
      : new THREE.MeshBasicMaterial(matOpts);

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(e.len, 0);
    shape.lineTo(e.len, H);
    shape.lineTo(0, H);
    shape.lineTo(0, 0);

    const holes = [];
    (opMap.get(e.idx) || []).forEach(op => {
      const range = openingToLocalEdgeRange(op, e);
      if (!range) return;
      const [lo, hi] = range;
      _addOpeningHole(holes, op, lo, hi, H);
    });
    shape.holes = holes;

    const geom = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: false });
    const mesh = new THREE.Mesh(geom, mat);
    mesh.position.set(ox + e.a.x, 0, oz + e.a.y);
    mesh.rotation.y = -e.angle;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.wallId = e.dir || `inner_${e.idx}`;
    if (room.id) mesh.userData.roomId = room.id;
    scene.add(mesh);
    if (collidables) collidables.push(mesh);
    // Arch-trim molding for arched openings on this polygon edge.
    (opMap.get(e.idx) || []).filter(op => op.arched).forEach(op => {
      const r2 = openingToLocalEdgeRange(op, e); if (!r2) return;
      _buildArchTrim(scene, op, r2[0], r2[1], mesh.position.clone(), mesh.rotation.y, useStandard);
    });
  });

  if (room.ceiling) buildCrownMolding(scene, room, useStandard, ox, oz);
}

// White crown molding (8cm tall) along the top inner edge of every wall.
function buildCrownMolding(scene, room, useStandard, ox, oz) {
  const H = wallH(room);
  const edges = getRoomEdges(room);
  const matOpts = { color: 0xffffff };
  const mat = useStandard
    ? new THREE.MeshStandardMaterial({ ...matOpts, roughness: 0.7 })
    : new THREE.MeshBasicMaterial(matOpts);
  edges.forEach(e => {
    if (e.len < 5) return;
    const geom = new THREE.BoxGeometry(e.len, 8, 5);
    const mesh = new THREE.Mesh(geom, mat);
    // Center the crown along the edge, 4cm below ceiling, 2.5cm into the room
    const dxN = -Math.sin(e.angle); // inward normal (CCW polygon → left of edge)
    const dyN =  Math.cos(e.angle);
    const cx = ox + (e.a.x + e.b.x) / 2 + dxN * 2.5;
    const cz = oz + (e.a.y + e.b.y) / 2 + dyN * 2.5;
    mesh.position.set(cx, H - 4, cz);
    mesh.rotation.y = -e.angle;
    mesh.userData.ceilingPart = true;
    mesh.userData.roomId = room.id;
    scene.add(mesh);
  });
}

// Builds a tray ceiling + cove LED + recessed downlights for the room.
// Activated when room.ceiling is truthy. Group is tagged with userData.ceiling
// so the camera-hide logic can fade it when the camera is near eye-height.
function buildCeiling(scene, room, useStandard, offX, offZ) {
  if (!room.ceiling) return null;
  const ox = offX || 0, oz = offZ || 0;
  const H = wallH(room);
  const cfg = (typeof room.ceiling === "object") ? room.ceiling : {};
  const coveColor = cfg.coveColor || "#FFD27A";
  // Nullish coalescing: explicit `downlights: 0` truly disables them
  // (the previous `cfg.downlights | 0 || 6` masked an explicit 0 → 6).
  const downlights = Math.max(0, Math.floor(cfg.downlights ?? 6));

  const group = new THREE.Group();
  group.name = "ceiling";
  group.userData.ceilingPart = true;
  group.userData.roomId = room.id;

  // Main flat ceiling (white) — uses ShapeGeometry over the polygon footprint.
  const verts = room.vertices && room.vertices.length >= 3
    ? room.vertices
    : [{ x: 0, y: 0 }, { x: room.width, y: 0 },
       { x: room.width, y: room.depth }, { x: 0, y: room.depth }];
  const ceilShape = shapeFromVertices(verts);
  const ceilGeom = new THREE.ShapeGeometry(ceilShape);
  const ceilMat = useStandard
    ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.85, side: THREE.DoubleSide })
    : new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
  const ceilMesh = new THREE.Mesh(ceilGeom, ceilMat);
  ceilMesh.rotation.x = Math.PI / 2;
  ceilMesh.position.set(ox, H, oz);
  group.add(ceilMesh);

  // Tray drop — a rectangle inset 60cm from the bounding box, 25cm below the
  // main ceiling to form the visible drop.
  const minX = Math.min(...verts.map(v => v.x));
  const maxX = Math.max(...verts.map(v => v.x));
  const minY = Math.min(...verts.map(v => v.y));
  const maxY = Math.max(...verts.map(v => v.y));
  const inset = 60;
  const tx0 = minX + inset, tx1 = maxX - inset;
  const ty0 = minY + inset, ty1 = maxY - inset;
  const trayW = Math.max(50, tx1 - tx0);
  const trayD = Math.max(50, ty1 - ty0);
  const trayDrop = 25; // cm
  const trayY = H - trayDrop;

  if (cfg.tray) {
    // Tray bottom (visible white surface)
    const trayGeom = new THREE.PlaneGeometry(trayW, trayD);
    const trayMat = useStandard
      ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const trayMesh = new THREE.Mesh(trayGeom, trayMat);
    trayMesh.rotation.x = Math.PI / 2;
    trayMesh.position.set(ox + (tx0 + tx1) / 2, trayY, oz + (ty0 + ty1) / 2);
    group.add(trayMesh);

    // Tray side strips (4) connecting trayY to H — gives the visible drop edge
    const sideMat = useStandard
      ? new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.8, side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide });
    const sides = [
      { w: trayW, x: ox + (tx0 + tx1) / 2, z: oz + ty0, ry: 0          },
      { w: trayW, x: ox + (tx0 + tx1) / 2, z: oz + ty1, ry: Math.PI    },
      { w: trayD, x: ox + tx0, z: oz + (ty0 + ty1) / 2, ry: -Math.PI/2 },
      { w: trayD, x: ox + tx1, z: oz + (ty0 + ty1) / 2, ry:  Math.PI/2 },
    ];
    sides.forEach(s => {
      const g = new THREE.PlaneGeometry(s.w, trayDrop);
      const m = new THREE.Mesh(g, sideMat);
      m.position.set(s.x, trayY + trayDrop / 2, s.z);
      m.rotation.y = s.ry;
      group.add(m);
    });
  }

  if (cfg.cove) {
    // Cove LED strips: 4 thin self-illuminated planes on the perimeter of the
    // tray drop, lying flat just below the main ceiling, glowing inwards.
    const coveMat = new THREE.MeshBasicMaterial({
      color: hexToInt(coveColor),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.95,
    });
    const stripW = 6; // cm
    const coveY = H - 1;
    const strips = [
      { w: trayW + stripW * 2, d: stripW, x: ox + (tx0 + tx1) / 2, z: oz + ty0 - stripW / 2 },
      { w: trayW + stripW * 2, d: stripW, x: ox + (tx0 + tx1) / 2, z: oz + ty1 + stripW / 2 },
      { w: stripW, d: trayD, x: ox + tx0 - stripW / 2, z: oz + (ty0 + ty1) / 2 },
      { w: stripW, d: trayD, x: ox + tx1 + stripW / 2, z: oz + (ty0 + ty1) / 2 },
    ];
    strips.forEach(s => {
      const g = new THREE.PlaneGeometry(s.w, s.d);
      const m = new THREE.Mesh(g, coveMat);
      m.rotation.x = Math.PI / 2;
      m.position.set(s.x, coveY, s.z);
      group.add(m);
    });
    // Soft uplight bouncing off main ceiling — only when standard materials
    // are in use (basic materials ignore lights anyway).
    if (useStandard) {
      const pl = new THREE.PointLight(hexToInt(coveColor), 0.45, Math.max(trayW, trayD) * 1.5);
      pl.position.set(ox + (tx0 + tx1) / 2, H - 5, oz + (ty0 + ty1) / 2);
      group.add(pl);
    }
  }

  if (downlights > 0 && cfg.tray) {
    // Distribute `downlights` evenly around the tray perimeter.
    const perim = 2 * (trayW + trayD);
    const spacing = perim / downlights;
    const dlMat = new THREE.MeshBasicMaterial({ color: 0xfff4d0 });
    for (let i = 0; i < downlights; i++) {
      let s = (i + 0.5) * spacing;
      let lx, lz;
      if (s < trayW) { lx = tx0 + s; lz = ty0 + 8; }
      else if (s < trayW + trayD) { lx = tx1 - 8; lz = ty0 + (s - trayW); }
      else if (s < trayW * 2 + trayD) { lx = tx1 - (s - trayW - trayD); lz = ty1 - 8; }
      else { lx = tx0 + 8; lz = ty1 - (s - trayW * 2 - trayD); }
      const g = new THREE.CircleGeometry(5, 16);
      const m = new THREE.Mesh(g, dlMat);
      m.rotation.x = Math.PI / 2;
      m.position.set(ox + lx, trayY - 0.5, oz + lz);
      group.add(m);
      if (useStandard) {
        const sp = new THREE.SpotLight(0xffffff, 0.35, 400, Math.PI / 5, 0.4, 1.2);
        sp.position.set(ox + lx, trayY - 1, oz + lz);
        sp.target.position.set(ox + lx, 0, oz + lz);
        group.add(sp);
        group.add(sp.target);
      }
    }
  }

  // Ornate ceiling rose / medallion (a round plaster rosette) at the center of
  // the ceiling. Works in both tray-ceiling rooms (living room) and flat-ceiling
  // rooms (bedroom_blue). When a tray exists the rose sits on the tray bottom;
  // otherwise it sits on the main ceiling (H).
  if (cfg.rose) {
    // Rose radius: 22% of the smaller room dimension (capped to a sensible range)
    const roseSpanW = cfg.tray ? trayW : (Math.max(...verts.map(v => v.x)) - Math.min(...verts.map(v => v.x)));
    const roseSpanD = cfg.tray ? trayD : (Math.max(...verts.map(v => v.y)) - Math.min(...verts.map(v => v.y)));
    const roseR = Math.max(20, Math.min(80, Math.min(roseSpanW, roseSpanD) * 0.18));
    // Position: centred on the tray (if any) or on the full room footprint
    const roseCX = ox + (tx0 + tx1) / 2;
    const roseCZ = oz + (ty0 + ty1) / 2;
    // Y: tray bottom when tray exists; just below main ceiling otherwise
    const roseY = cfg.tray ? trayY - 0.6 : H - 0.6;
    const hookY  = cfg.tray ? trayY - 4   : H - 4;
    const roseTex = getCeilingRoseTexture();
    const roseGeom = new THREE.CircleGeometry(roseR, 64);
    const roseMat = useStandard
      ? new THREE.MeshStandardMaterial({ map: roseTex, roughness: 0.7, transparent: true, side: THREE.DoubleSide })
      : new THREE.MeshBasicMaterial({ map: roseTex, transparent: true, side: THREE.DoubleSide });
    const roseMesh = new THREE.Mesh(roseGeom, roseMat);
    roseMesh.rotation.x = Math.PI / 2;
    roseMesh.position.set(roseCX, roseY, roseCZ);
    group.add(roseMesh);

    // A small chandelier hook (visible dark sphere at the rose center).
    const hookGeom = new THREE.SphereGeometry(2.5, 12, 8);
    const hookMat = new THREE.MeshBasicMaterial({ color: 0x222222 });
    const hookMesh = new THREE.Mesh(hookGeom, hookMat);
    hookMesh.position.set(roseCX, hookY, roseCZ);
    group.add(hookMesh);
  }

  scene.add(group);
  return group;
}

// Procedural ornate ceiling-rose texture: concentric rings + radial flutes,
// drawn on a transparent canvas so it can be overlaid on the tray drop.
let _ceilingRoseTexture = null;
function getCeilingRoseTexture() {
  if (_ceilingRoseTexture) return _ceilingRoseTexture;
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 512;
  const c = canvas.getContext("2d");
  const cx = 256, cy = 256;
  c.clearRect(0, 0, 512, 512);
  // Outer ring (subtle rim shadow)
  c.beginPath();
  c.arc(cx, cy, 240, 0, Math.PI * 2);
  c.fillStyle = "rgba(255,255,255,0.96)";
  c.fill();
  c.strokeStyle = "rgba(120,110,90,0.35)";
  c.lineWidth = 3;
  c.stroke();
  // Concentric decorative bands
  const bands = [
    { r: 220, color: "rgba(140,125,95,0.25)", lw: 2 },
    { r: 195, color: "rgba(150,135,100,0.30)", lw: 4 },
    { r: 160, color: "rgba(120,105,80,0.30)", lw: 2 },
    { r: 130, color: "rgba(150,135,100,0.35)", lw: 3 },
    { r: 95,  color: "rgba(120,105,80,0.30)", lw: 2 },
    { r: 65,  color: "rgba(150,135,100,0.40)", lw: 3 },
    { r: 35,  color: "rgba(120,105,80,0.45)", lw: 2 },
  ];
  bands.forEach(b => {
    c.beginPath();
    c.arc(cx, cy, b.r, 0, Math.PI * 2);
    c.strokeStyle = b.color;
    c.lineWidth = b.lw;
    c.stroke();
  });
  // Radial flutes between r=130 and r=200
  const flutes = 24;
  for (let i = 0; i < flutes; i++) {
    const a = (i / flutes) * Math.PI * 2;
    const r1 = 132, r2 = 195;
    c.beginPath();
    c.moveTo(cx + Math.cos(a) * r1, cy + Math.sin(a) * r1);
    c.lineTo(cx + Math.cos(a) * r2, cy + Math.sin(a) * r2);
    c.strokeStyle = "rgba(110,95,75,0.35)";
    c.lineWidth = 1.5;
    c.stroke();
  }
  // Small petals around r=80
  const petals = 12;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    const px = cx + Math.cos(a) * 80;
    const py = cy + Math.sin(a) * 80;
    c.beginPath();
    c.arc(px, py, 8, 0, Math.PI * 2);
    c.fillStyle = "rgba(170,150,115,0.55)";
    c.fill();
    c.strokeStyle = "rgba(110,95,75,0.55)";
    c.lineWidth = 1;
    c.stroke();
  }
  // Center boss
  c.beginPath();
  c.arc(cx, cy, 18, 0, Math.PI * 2);
  c.fillStyle = "rgba(180,160,125,0.7)";
  c.fill();
  c.strokeStyle = "rgba(110,95,75,0.6)";
  c.lineWidth = 1.5;
  c.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  _ceilingRoseTexture = tex;
  return tex;
}

function lighter(colorInt, amount) {
  const r = Math.round(((colorInt >> 16) & 0xff) + (255 - ((colorInt >> 16) & 0xff)) * amount);
  const g = Math.round(((colorInt >> 8)  & 0xff) + (255 - ((colorInt >> 8)  & 0xff)) * amount);
  const b = Math.round(( colorInt        & 0xff) + (255 - ( colorInt        & 0xff)) * amount);
  return (r << 16) | (g << 8) | b;
}

function lighterHex(hexStr, amount) {
  const n = lighter(hexToInt(hexStr || "#888888"), amount);
  return "#" + n.toString(16).padStart(6, "0");
}

// ---------- Furniture mesh (Enhancements B, C, D) ----------
let _contactShadowTex = null;
function getContactShadowTexture() {
  if (_contactShadowTex) return _contactShadowTex;
  const sz = 64;
  const cvs = document.createElement("canvas");
  cvs.width = sz; cvs.height = sz;
  const c2 = cvs.getContext("2d");
  const grad = c2.createRadialGradient(sz/2, sz/2, 0, sz/2, sz/2, sz/2);
  grad.addColorStop(0, "rgba(0,0,0,0.35)");
  grad.addColorStop(0.6, "rgba(0,0,0,0.12)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  c2.fillStyle = grad;
  c2.fillRect(0, 0, sz, sz);
  _contactShadowTex = new THREE.CanvasTexture(cvs);
  return _contactShadowTex;
}

// Efficient base64 → ArrayBuffer without the atob()+Uint8Array.from() OOM pattern.
// Uses atob() but copies bytes in small chunks to avoid call-stack overflow and
// keeps peak memory to ~1.33× the decoded size (vs ~4× with the old approach).
function _base64ToArrayBuffer(b64) {
  const raw = atob(b64);
  const len = raw.length;
  const buf = new ArrayBuffer(len);
  const view = new Uint8Array(buf);
  // Process in 8KB chunks — avoids call-stack overflow from large spread/apply
  // while remaining far faster than char-by-char iteration.
  const CHUNK = 8192;
  for (let i = 0; i < len; i += CHUNK) {
    const end = Math.min(i + CHUNK, len);
    for (let j = i; j < end; j++) {
      view[j] = raw.charCodeAt(j);
    }
  }
  return buf;
}

// Placeholder box for GLB models that fail to load — keeps the item visible
// and selectable so the user can delete/reposition it.
function _addGlbPlaceholder(container, w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xff8844,
    transparent: true,
    opacity: 0.4,
    wireframe: true,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = h / 2;
  container.add(mesh);
}

// Downscale any textures on a material that exceed maxSize (e.g. 512px).
// GLB models often contain 2K/4K textures that kill mobile GPU memory.
function _downscaleTextures(material, maxSize) {
  if (!material) return;
  const mats = Array.isArray(material) ? material : [material];
  const texKeys = ["map", "normalMap", "roughnessMap", "metalnessMap", "aoMap", "emissiveMap"];
  for (const mat of mats) {
    for (const key of texKeys) {
      const tex = mat[key];
      if (!tex || !tex.image) continue;
      const img = tex.image;
      const w = img.width || img.naturalWidth || 0;
      const h = img.height || img.naturalHeight || 0;
      if (w <= maxSize && h <= maxSize) continue;
      // Downscale using an offscreen canvas
      const scale = maxSize / Math.max(w, h);
      const nw = Math.round(w * scale);
      const nh = Math.round(h * scale);
      try {
        const cvs = document.createElement("canvas");
        cvs.width = nw;
        cvs.height = nh;
        const c = cvs.getContext("2d");
        c.drawImage(img, 0, 0, nw, nh);
        tex.image = cvs;
        tex.needsUpdate = true;
      } catch (_) { /* ignore — texture stays at original size */ }
    }
  }
}

function buildFurnitureMesh(inst, item) {
  const w = inst.overrideW || item.w;
  const d = inst.overrideH || item.h;
  const h = inst.overrideDepth || item.depth || defaultHeight(item);
  const isCustom = inst.groupId === "custom" && item.image;
  const isBillboard = isCustom && !item.useBox && !item.glbData;
  const hasAlpha = isCustom && item.hasAlpha;
  const lift = Number.isFinite(inst.liftedZ) ? inst.liftedZ : 0;

  // --- GLB 3D model support ---
  if (item.glbData) {
    const container = new THREE.Group();
    container.userData.groupId = inst.groupId;
    container.userData.itemId = inst.itemId;
    container.userData.rotation = inst.rotation || 0;
    container.userData._isGLB = true;
    // NOTE: intentionally NOT storing item.glbData on userData — it's a huge
    // binary blob and keeping a reference here would double memory usage.
    container.position.set(inst.x, lift, inst.y);
    container.rotation.set(
      -((inst.rotationX || 0) * Math.PI) / 180,
      -((inst.rotation  || 0) * Math.PI) / 180,
      -((inst.rotationZ || 0) * Math.PI) / 180
    );
    function scaleAndPlaceModel(model) {
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const scaleX = w / (size.x || 1);
      const scaleY = h / (size.y || 1);
      const scaleZ = d / (size.z || 1);
      model.scale.set(scaleX, scaleY, scaleZ);
      const newBox = new THREE.Box3().setFromObject(model);
      const center = newBox.getCenter(new THREE.Vector3());
      const minY = newBox.min.y;
      model.position.sub(center);
      model.position.y -= minY;
      const glbProfile = getRendererProfile();
      model.traverse(child => {
        if (!child.isMesh) return;
        // Shadows are expensive — on mobile, skip them for GLB meshes.
        child.castShadow = glbProfile.glbShadows;
        child.receiveShadow = glbProfile.glbShadows;
        // On mobile, simplify PBR materials to reduce GPU cost while keeping
        // the model's actual colors.  Instead of swapping to Lambert (which
        // strips all PBR data and makes everything gray), we keep Standard
        // but remove the expensive secondary maps.
        if (glbProfile.simplifyGlbMaterials && child.material && child.material.isMeshStandardMaterial) {
          const m = child.material;
          // Drop secondary PBR maps (big GPU texture-sampling cost)
          if (m.normalMap)    { m.normalMap.dispose?.();    m.normalMap = null; }
          if (m.roughnessMap) { m.roughnessMap.dispose?.(); m.roughnessMap = null; }
          if (m.metalnessMap) { m.metalnessMap.dispose?.(); m.metalnessMap = null; }
          if (m.aoMap)        { m.aoMap.dispose?.();        m.aoMap = null; }
          // Flatten metalness/roughness to simple values so lighting is cheaper
          m.metalness = Math.min(m.metalness, 0.3);
          m.roughness = Math.max(m.roughness, 0.6);
          m.needsUpdate = true;
        }
        // Ensure frustum culling is on (Three.js default, but some exporters disable it)
        child.frustumCulled = true;
        // On mobile/tablet, downscale large textures (2K/4K) in GLB models.
        // This is the single largest GPU memory win for imported models.
        if (glbProfile.low || glbProfile.mid) {
          _downscaleTextures(child.material, glbProfile.glbMaxTextureSize);
        }
      });
      container.add(model);
    }

    // Use the item ID as cache key — NOT the glbData blob, which would
    // duplicate megabytes of binary just for the Map key.
    const cacheKey = "glb:" + (inst.itemId || inst.instId);

    try {
      const cached = _glbCache.get(cacheKey);
      if (cached) {
        scaleAndPlaceModel(cached.clone());
      } else {
        const loader = new GLTFLoader();
        // Accept both ArrayBuffer (new format) and base64 string (legacy).
        let buffer;
        if (item.glbData instanceof ArrayBuffer) {
          buffer = item.glbData;
        } else if (typeof item.glbData === "string") {
          // Efficient base64 → ArrayBuffer conversion (chunk-safe, no stack overflow).
          buffer = _base64ToArrayBuffer(item.glbData);
        } else {
          throw new Error("Unsupported glbData type: " + typeof item.glbData);
        }
        loader.parse(buffer, "", (gltf) => {
          _glbCache.set(cacheKey, gltf.scene);
          scaleAndPlaceModel(gltf.scene);
        }, (parseErr) => {
          console.warn("GLB parse error:", parseErr);
          if (typeof window.toast === "function") window.toast("فشل تحميل نموذج 3D", "err");
          // Add a placeholder box so the item is still visible/selectable
          _addGlbPlaceholder(container, w, h, d);
        });
      }
    } catch (loadErr) {
      console.warn("GLB load error:", loadErr);
      if (typeof window.toast === "function") window.toast("تعذّر تحميل نموذج 3D — الملف قد يكون تالفاً", "err");
      _addGlbPlaceholder(container, w, h, d);
    }
    const shGeo = new THREE.PlaneGeometry(w * 0.9, d * 0.9);
    const shMat = new THREE.MeshBasicMaterial({ map: getContactShadowTexture(), transparent: true, opacity: 0.3, depthWrite: false });
    const shMesh = new THREE.Mesh(shGeo, shMat);
    shMesh.rotation.x = -Math.PI / 2;
    shMesh.position.y = 0.5;
    container.add(shMesh);
    return container;
  }

  // --- Photo-based rendering (billboard or box) ---
  const geom = isBillboard ? new THREE.PlaneGeometry(w, h) : new THREE.BoxGeometry(w, h, d);
  let materials;
  if (isCustom) {
    const sideColor = hexToInt(item.sideColor || item.color || "#888888");
    const texLoader = new THREE.TextureLoader();
    const loadTex = (url) => { const t = texLoader.load(url); t.colorSpace = THREE.SRGBColorSpace; return t; };
    const frontTex = loadTex(item.image);
    const frontMatOpts = { map: frontTex };
    if (hasAlpha) { frontMatOpts.transparent = true; frontMatOpts.alphaTest = 0.08; frontMatOpts.side = THREE.DoubleSide; }
    const frontMat = new THREE.MeshBasicMaterial(frontMatOpts);
    if (isBillboard) {
      frontMat.side = THREE.DoubleSide;
      materials = frontMat;
    } else {
      // Use auto-generated edge strip textures if no user-supplied side/top photos
      const sideImgUrl = item.imageSide || item.autoSide;
      const topImgUrl = item.imageTop || item.autoTop;
      let sideTexMat;
      if (sideImgUrl) {
        sideTexMat = new THREE.MeshBasicMaterial({ map: loadTex(sideImgUrl) });
      } else {
        sideTexMat = new THREE.MeshBasicMaterial({ color: sideColor });
      }
      let topTexMat;
      if (topImgUrl) {
        topTexMat = new THREE.MeshBasicMaterial({ map: loadTex(topImgUrl) });
      } else {
        topTexMat = new THREE.MeshBasicMaterial({ color: lighter(sideColor, -0.08) });
      }
      const backMat = frontMat.clone();
      const bottomMat = new THREE.MeshBasicMaterial({ color: lighter(sideColor, -0.15) });
      // [+x, -x, +y, -y, +z, -z] = right, left, top, bottom, front, back
      materials = [sideTexMat, sideTexMat.clone(), topTexMat, bottomMat, frontMat, backMat];
    }
  } else {
    materials = new THREE.MeshStandardMaterial({ color: hexToInt(item.color || "#888888"), roughness: 0.8, transparent: (item.opacity ?? 1) < 1, opacity: item.opacity ?? 1 });
  }
  const mesh = new THREE.Mesh(geom, materials);
  mesh.castShadow = true; mesh.receiveShadow = true;
  mesh.userData.groupId = inst.groupId; mesh.userData.itemId = inst.itemId;
  mesh.userData.rotation = inst.rotation || 0;
  mesh.userData._isBillboard = isBillboard; // flag for camera-facing in render loop
  mesh.position.set(inst.x, h / 2 + lift, inst.y);
  if (!isBillboard) {
    mesh.rotation.set(
      -((inst.rotationX || 0) * Math.PI) / 180,
      -((inst.rotation  || 0) * Math.PI) / 180,
      -((inst.rotationZ || 0) * Math.PI) / 180
    );
  }
  if (isCustom) {
    const shGeo = new THREE.PlaneGeometry(w * 0.9, isBillboard ? w * 0.3 : d * 0.9);
    const shMat = new THREE.MeshBasicMaterial({ map: getContactShadowTexture(), transparent: true, opacity: 0.25, depthWrite: false });
    const shMesh = new THREE.Mesh(shGeo, shMat);
    shMesh.rotation.x = -Math.PI / 2;
    shMesh.position.y = -(h / 2) + 0.5 - lift;
    mesh.add(shMesh);
  }
  return mesh;
}

function defaultHeight(item) {
  const byId = { sofa3: 85, sofa2: 85, sofa_l: 85, armchair: 85, coffee: 42, tv_unit: 50, tv: 70, bookshelf: 200, dine_tbl: 75, dine_chair: 90, rug: 1, plant: 80, bed_single: 50, bed_double: 50, bed_king: 50, nightstand: 55, wardrobe: 220, dresser: 80, desk: 75, chair: 90, fridge: 180, stove: 90, sink: 90, counter: 90, upper_cab: 70, microwave: 30, dine_tbl2: 75, dine_chair2: 90, bathtub: 55, toilet: 80, basin: 85, shower: 210, washer: 85, heater: 55, floor_lamp: 160, ac_split: 25, curtain: 250, entry_rug: 1 };
  if (byId[item.id]) return byId[item.id];
  return Math.min(item.w, item.h) < 30 ? 40 : 70;
}

// ============================================================
// Apartment walkthrough
// ============================================================
function aptBounds(rooms) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  rooms.forEach(r => {
    const px = (r.plan && r.plan.x) || 0;
    const py = (r.plan && r.plan.y) || 0;
    minX = Math.min(minX, px);
    minY = Math.min(minY, py);
    maxX = Math.max(maxX, px + r.width);
    maxY = Math.max(maxY, py + r.depth);
  });
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function showApartment(container, { rooms, itemsByRoom, findItem, startRoomId }) {
  hideApartment();
  const bounds = aptBounds(rooms);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bgColorFromTheme());
  scene.fog = new THREE.Fog(bgColorFromTheme(), 500, 3000);

  const camera = new THREE.PerspectiveCamera(
    75,
    Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
    1, 8000
  );
  const profile = getRendererProfile();
  const renderer = new THREE.WebGLRenderer({
    antialias: !profile.low,
    preserveDrawingBuffer: !profile.low,
    powerPreference: "high-performance",
  });
  renderer.setPixelRatio(profile.pixelRatio);
  renderer.setSize(container.clientWidth || 800, container.clientHeight || 500);
  renderer.shadowMap.enabled = true;
  if (profile.low) renderer.shadowMap.type = THREE.BasicShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.domElement.style.touchAction = "none";
  container.appendChild(renderer.domElement);

  // Environment map for PBR/GLB materials
  const pmremGen = new THREE.PMREMGenerator(renderer);
  pmremGen.compileEquirectangularShader();
  scene.environment = pmremGen.fromScene(new RoomEnvironment()).texture;
  pmremGen.dispose();

  // Lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.7);
  scene.add(ambient);
  const sun = new THREE.DirectionalLight(0xffffff, 1.0);
  sun.position.set(bounds.w * 0.6, WALL_HEIGHT * 4, bounds.h * 0.4);
  sun.castShadow = true;
  sun.shadow.mapSize.set(profile.aptShadowMapSize, profile.aptShadowMapSize);
  sun.shadow.camera.left = -bounds.w;
  sun.shadow.camera.right = bounds.w;
  sun.shadow.camera.top = bounds.h;
  sun.shadow.camera.bottom = -bounds.h;
  scene.add(sun);

  // Unified floor spanning whole apartment (light neutral)
  const floorMat = new THREE.MeshStandardMaterial({ color: 0xd8ccb8, roughness: 0.6, metalness: 0.02 }); // PBR floor (#5)
  const floorGeo = new THREE.PlaneGeometry(bounds.w + 200, bounds.h + 200);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(bounds.w / 2, 0, bounds.h / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  // Build each room with an offset matching its plan coords. Items live in a
  // dedicated group so they can be reconciled (added/removed/updated) without
  // tearing down the whole scene on every layout change.
  const collidables = []; // wall meshes for player collision
  const roomOffsets = new Map(); // roomId -> [ox, oz]
  const furnitureGroup = new THREE.Group();
  furnitureGroup.name = "apt-furniture";
  scene.add(furnitureGroup);
  rooms.forEach(room => {
    const ox = ((room.plan && room.plan.x) || 0) - bounds.minX;
    const oz = ((room.plan && room.plan.y) || 0) - bounds.minY;
    roomOffsets.set(room.id, [ox, oz]);
    buildRoomAt(scene, room, ox, oz, collidables);
  });

  // Camera start: spawn inside the currently selected room, or corridor entrance.
  let startX = bounds.w / 2;
  let startZ = 30; // default: near the corridor entrance (top of plan)
  const startRoom = startRoomId && rooms.find(r => r.id === startRoomId);
  if (startRoom) {
    startX = ((startRoom.plan && startRoom.plan.x) || 0) - bounds.minX + startRoom.width / 2;
    startZ = ((startRoom.plan && startRoom.plan.y) || 0) - bounds.minY + startRoom.depth / 2;
  }
  camera.position.set(startX, 160, startZ);
  camera.lookAt(startX, 160, startZ - 1);

  const controls = new PointerLockControls(camera, renderer.domElement);
  scene.add(controls.getObject());

  // Click-to-lock prompt
  const prompt = document.createElement("div");
  prompt.className = "walk-prompt";
  // Build room-picker buttons so the user can choose where to start.
  const roomBtns = rooms.map(r => {
    const ox = ((r.plan && r.plan.x) || 0) - bounds.minX + r.width / 2;
    const oz = ((r.plan && r.plan.y) || 0) - bounds.minY + r.depth / 2;
    return `<button class="walk-room-btn" data-sx="${ox}" data-sz="${oz}" data-name="${r.name}" style="background:${r.color || '#6892B0'}">${r.name}</button>`;
  }).join("");
  prompt.innerHTML = `<div class="walk-prompt-inner">
    <h3>اختر نقطة الانطلاق</h3>
    <p>W/A/S/D للتحرك • الفأرة للنظر • Shift للجري • Space للقفز • Esc للخروج</p>
    <div class="walk-room-grid">${roomBtns}</div>
  </div>`;
  container.appendChild(prompt);
  // Room-button click → teleport camera to that room, then lock.
  const onPromptClick = (e) => {
    const btn = e.target.closest(".walk-room-btn");
    if (btn) {
      const sx = parseFloat(btn.dataset.sx);
      const sz = parseFloat(btn.dataset.sz);
      camera.position.set(sx, 160, sz);
      camera.lookAt(sx, 160, sz - 1); // face forward
    }
    controls.lock();
  };
  prompt.addEventListener("click", onPromptClick);
  controls.addEventListener("lock", () => { prompt.style.display = "none"; });
  controls.addEventListener("unlock", () => {
    prompt.style.display = "flex";
    // Highlight the room the player is currently in (Enhancement #8)
    const p = camera.position;
    prompt.querySelectorAll(".walk-room-btn").forEach(btn => {
      btn.classList.remove("walk-room-active");
      const sx = parseFloat(btn.dataset.sx);
      const sz = parseFloat(btn.dataset.sz);
      // Find the room by checking if camera is within its bounds
      const match = rooms.find(r => {
        const rx = ((r.plan && r.plan.x) || 0) - bounds.minX;
        const rz = ((r.plan && r.plan.y) || 0) - bounds.minY;
        return p.x >= rx && p.x <= rx + r.width && p.z >= rz && p.z <= rz + r.depth;
      });
      if (match) {
        const mx = ((match.plan && match.plan.x) || 0) - bounds.minX + match.width / 2;
        const mz = ((match.plan && match.plan.y) || 0) - bounds.minY + match.depth / 2;
        if (Math.abs(sx - mx) < 1 && Math.abs(sz - mz) < 1) btn.classList.add("walk-room-active");
      }
    });
  });
  // ── Minimap overlay (Enhancement #4) ──
  const minimap = document.createElement("canvas");
  minimap.className = "walk-minimap";
  minimap.width = 160; minimap.height = 160;
  container.appendChild(minimap);
  const mmCtx2d = minimap.getContext("2d");
  function drawMinimap() {
    const cw = minimap.width, ch = minimap.height;
    const scale = Math.min((cw - 10) / bounds.w, (ch - 10) / bounds.h);
    const padX = (cw - bounds.w * scale) / 2;
    const padY = (ch - bounds.h * scale) / 2;
    mmCtx2d.clearRect(0, 0, cw, ch);
    mmCtx2d.fillStyle = "rgba(0,0,0,0.55)";
    mmCtx2d.fillRect(0, 0, cw, ch);
    // Draw rooms
    rooms.forEach(r => {
      const rx = ((r.plan && r.plan.x) || 0) - bounds.minX;
      const ry = ((r.plan && r.plan.y) || 0) - bounds.minY;
      mmCtx2d.fillStyle = r.color || "#6892B0";
      mmCtx2d.globalAlpha = 0.5;
      mmCtx2d.fillRect(padX + rx * scale, padY + ry * scale, r.width * scale, r.depth * scale);
      mmCtx2d.globalAlpha = 1;
      mmCtx2d.strokeStyle = "#fff";
      mmCtx2d.lineWidth = 0.5;
      mmCtx2d.strokeRect(padX + rx * scale, padY + ry * scale, r.width * scale, r.depth * scale);
    });
    // Player dot + direction arrow
    const p = camera.position;
    const px = padX + p.x * scale;
    const py = padY + p.z * scale;
    mmCtx2d.fillStyle = "#ff4444";
    mmCtx2d.beginPath();
    mmCtx2d.arc(px, py, 4, 0, Math.PI * 2);
    mmCtx2d.fill();
    // Direction arrow from camera facing
    const dir3 = new THREE.Vector3(0, 0, -1);
    dir3.applyQuaternion(camera.quaternion);
    const arrowLen = 14;
    mmCtx2d.strokeStyle = "#ff4444";
    mmCtx2d.lineWidth = 2;
    mmCtx2d.beginPath();
    mmCtx2d.moveTo(px, py);
    mmCtx2d.lineTo(px + dir3.x * arrowLen, py + dir3.z * arrowLen);
    mmCtx2d.stroke();
  }


  // ── Footstep audio (Enhancement #14) ──
  let _audioCtx = null, _footstepEnabled = false, _stepTimer = 0;
  function playFootstep() {
    if (!_audioCtx) _audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = _audioCtx.createOscillator();
    const gain = _audioCtx.createGain();
    osc.type = "triangle";
    osc.frequency.value = 80 + Math.random() * 40;
    gain.gain.setValueAtTime(0.08, _audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, _audioCtx.currentTime + 0.08);
    osc.connect(gain).connect(_audioCtx.destination);
    osc.start(); osc.stop(_audioCtx.currentTime + 0.08);
  }
  // Movement state
  const move = { f: 0, b: 0, l: 0, r: 0, up: false };
  const velocity = new THREE.Vector3();
  const direction = new THREE.Vector3();

  const onKeyDown = (e) => {
    if (e.code === "KeyW" || e.code === "ArrowUp") move.f = 1;
    if (e.code === "KeyS" || e.code === "ArrowDown") move.b = 1;
    if (e.code === "KeyA" || e.code === "ArrowLeft") move.l = 1;
    if (e.code === "KeyD" || e.code === "ArrowRight") move.r = 1;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") move.run = true;
    if (e.code === "Space") move.up = true;
  };
  const onKeyUp = (e) => {
    if (e.code === "KeyW" || e.code === "ArrowUp") move.f = 0;
    if (e.code === "KeyS" || e.code === "ArrowDown") move.b = 0;
    if (e.code === "KeyA" || e.code === "ArrowLeft") move.l = 0;
    if (e.code === "KeyD" || e.code === "ArrowRight") move.r = 0;
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") move.run = false;
    if (e.code === "Space") move.up = false;
  };
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);

  aptCtx = {
    scene, camera, renderer, controls,
    rooms, itemsByRoom, findItem,
    bounds, collidables, sun, ambient,
    prompt,
    furnitureGroup,
    roomOffsets,
    itemMeshes: new Map(), // "roomId/instId" -> mesh
    cleanup: () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("keyup", onKeyUp);
      prompt.removeEventListener("click", onPromptClick);
      prompt.remove();
    },
  };

  reconcileApartmentItems(aptCtx, itemsByRoom, findItem);

  aptCtx.resizeObs = new ResizeObserver(() => {
    const w = container.clientWidth, h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  aptCtx.resizeObs.observe(container);

  let last = performance.now();
  let _aptFrameCount = 0;
  let _aptNeedsRender = true;
  const _aptProfile = getRendererProfile();
  const loop = () => {
    aptCtx.raf = requestAnimationFrame(loop);
    // Skip render + movement integration while the tab is hidden — mobile
    // browsers can leave RAF firing slowly in the background and burst-render
    // when restored, which spikes the GPU.
    if (document.hidden) { last = performance.now(); return; }
    const now = performance.now();
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    _aptFrameCount++;

    let moved = false;
    if (controls.isLocked) {
      const speed = (move.run ? 700 : 300) * dt; // cm/s
      direction.set(move.r - move.l, 0, move.b - move.f);
      direction.normalize();
      if (direction.lengthSq() > 0.001) moved = true;
      // Movement in camera space
      controls.moveRight(direction.x * speed);
      controls.moveForward(-direction.z * speed);
      // Eye height clamp + apartment bounds (soft box)
      const p = controls.getObject().position;
      p.y = 160;
      p.x = Math.max(10, Math.min(bounds.w - 10, p.x));
      p.z = Math.max(10, Math.min(bounds.h - 10, p.z));
      _aptNeedsRender = true;
    }

    // Skip GPU work when nothing changed (pointer unlocked, no resize, etc.)
    if (!_aptNeedsRender && !controls.isLocked) return;

    // Billboard cutouts face camera (throttled on mobile to every 2nd frame)
    const bbThrottle = _aptProfile.low ? 2 : 1;
    if (_aptFrameCount % bbThrottle === 0) {
      furnitureGroup.children.forEach(mesh => {
        if (mesh.userData._isBillboard) {
          mesh.lookAt(camera.position.x, mesh.position.y, camera.position.z);
        }
      });
    }

    renderer.render(scene, camera);

    // Minimap: redraw every 3rd frame (saves canvas 2D overhead on mobile)
    if (_aptFrameCount % 3 === 0) drawMinimap();

    // Reset dirty flag only when pointer is unlocked (when locked, camera
    // is always potentially moving via mouse look, so keep rendering)
    if (!controls.isLocked) _aptNeedsRender = false;
  };
  loop();
}

function isActiveApartment() {
  return !!aptCtx;
}
function updateApartmentItems(itemsByRoom, findItem) {
  if (!aptCtx) return;
  aptCtx.itemsByRoom = itemsByRoom;
  if (findItem) aptCtx.findItem = findItem;
  reconcileApartmentItems(aptCtx, itemsByRoom, aptCtx.findItem);
}

// Adds/removes/updates only the diff vs the currently-rendered furniture set.
// Walls, floors and lights are NOT touched — they live outside `furnitureGroup`.
//
// Key per mesh: `${roomId}/${instId}`. Signature reuses the same shape as the
// single-room reconciler so material/geometry rebuilds happen for the same
// reasons (dimension overrides, color override, etc.) and pure-transform
// changes (position/rotation) only call `applyInstTransform`.
function reconcileApartmentItems(ctx, itemsByRoom, findItem) {
  if (!ctx || !ctx.furnitureGroup) return;
  const seen = new Set();
  const offsets = ctx.roomOffsets;
  const meshes = ctx.itemMeshes;

  Object.keys(itemsByRoom || {}).forEach(roomId => {
    const off = offsets.get(roomId);
    if (!off) return; // unknown room (shouldn't happen)
    const [ox, oz] = off;
    const list = itemsByRoom[roomId] || [];
    list.forEach(inst => {
      const item = findItem(inst.groupId, inst.itemId);
      if (!item) return;
      const key = roomId + "/" + inst.instId;
      seen.add(key);
      const sig = meshSignature(inst, item);
      const existing = meshes.get(key);
      if (existing && existing.userData.signature === sig) {
        applyInstTransform(existing, inst, item);
        existing.position.x += ox;
        existing.position.z += oz;
      } else {
        if (existing) {
          ctx.furnitureGroup.remove(existing);
          disposeObj(existing);
          meshes.delete(key);
        }
        const mesh = buildFurnitureMesh(inst, item);
        if (!mesh) return;
        mesh.userData.instId = inst.instId;
        mesh.userData.roomId = roomId;
        mesh.userData.signature = sig;
        mesh.position.x += ox;
        mesh.position.z += oz;
        meshes.set(key, mesh);
        ctx.furnitureGroup.add(mesh);
      }
    });
  });

  for (const [key, mesh] of meshes) {
    if (seen.has(key)) continue;
    ctx.furnitureGroup.remove(mesh);
    disposeObj(mesh);
    meshes.delete(key);
  }
}

// Build a room (walls + openings) with an offset into a shared scene.
function buildRoomAt(scene, room, offX, offZ, collidables) {
  // Polygon path: room.vertices defines a custom footprint with protrusions.
  if (room.vertices && room.vertices.length >= 3) {
    buildWallsFromVertices(scene, room, /*useStandard*/ true, offX, offZ, collidables);
    // Polygon-shaped floor
    const useTile = room.floorTexture === "tile-cream";
    const fMat = useTile
      ? new THREE.MeshStandardMaterial({ map: getTileCreamTexture(room.width, room.depth), roughness: 0.95 })
      : new THREE.MeshStandardMaterial({
          color: hexToInt(room.floorColor || lighterHex(room.wallColor, 0.25)),
          roughness: 0.95,
        });
    const fGeo = new THREE.ShapeGeometry(shapeFromVertices(room.vertices));
    const fMesh = new THREE.Mesh(fGeo, fMat);
    fMesh.rotation.x = Math.PI / 2;
    fMesh.position.set(offX, 0.5, offZ);
    fMesh.receiveShadow = true;
    scene.add(fMesh);
    // Tray ceiling + cove + downlights for rooms that opt-in
    buildCeiling(scene, room, /*useStandard*/ true, offX, offZ);
    return;
  }

  const t = WALL_THICK_3D;
  const walls = [
    { length: room.width, anchor: [offX, 0, offZ],                          axis: "x", wall: "top" },
    { length: room.width, anchor: [offX, 0, offZ + room.depth - t],         axis: "x", wall: "bottom" },
    { length: room.depth, anchor: [offX, 0, offZ],                          axis: "z", wall: "left" },
    { length: room.depth, anchor: [offX + room.width - t, 0, offZ],         axis: "z", wall: "right" },
  ];

  const H = wallH(room);
  walls.forEach(w => {
    // Per-wall color resolution (same as single-room buildWalls).
    const wallHex = (typeof resolveWallColor === "function")
      ? resolveWallColor(room, w.wall)
      : (room.accentColor && room.accentWall === w.wall
          ? room.accentColor
          : (room.wallColor || "#eeeeee"));
    // Lighten non-accent walls slightly for the walkthrough (PBR material with
    // MeshStandard needs a tiny lift so the dark sides don't look muddy).
    // Accent walls keep their exact hex to preserve colour intent (fix: the
    // previous 0.15 lift was applied unconditionally, washing out the vivid
    // denim / cerulean / teal accent colours).
    const isAccent = room.wallColors
      ? false   // wallColors already encodes the exact per-wall intent; no lift needed
      : (room.accentColor && room.accentWall === w.wall);
    const colorInt = lighter(hexToInt(wallHex), isAccent ? 0.0 : 0.08);
    const mat = new THREE.MeshStandardMaterial({ color: colorInt, roughness: 0.9, side: THREE.DoubleSide });

    const shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(w.length, 0);
    shape.lineTo(w.length, H);
    shape.lineTo(0, H);
    shape.lineTo(0, 0);

    const holes = [];
    (room.openings || []).filter(o => o.wall === w.wall).forEach(o => {
      _addOpeningHole(holes, o, o.at, o.at + o.size, H);
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
    mesh.userData.roomId = room.id;
    scene.add(mesh);
    if (collidables) collidables.push(mesh);
    // Arch-trim molding for arched openings in apartment walkthrough.
    (room.openings || []).filter(o => o.wall === w.wall && o.arched).forEach(o => {
      const tPos = mesh.position.clone();
      _buildArchTrim(scene, o, o.at, o.at + o.size, tPos, mesh.rotation.y, true);
    });
  });

  // Crown molding (rectangular path) — only when ceiling is configured.
  if (room.ceiling) buildCrownMolding(scene, room, /*useStandard*/ true, offX, offZ);

  // Floor tile for this room — uses floorColor or tile-cream texture.
  const useTile = room.floorTexture === "tile-cream";
  const fMat = useTile
    ? new THREE.MeshStandardMaterial({ map: getTileCreamTexture(room.width, room.depth), roughness: 0.95 })
    : new THREE.MeshStandardMaterial({
        color: hexToInt(room.floorColor || lighterHex(room.wallColor, 0.25)),
        roughness: 0.95,
      });
  const fGeo = new THREE.PlaneGeometry(room.width, room.depth);
  const fMesh = new THREE.Mesh(fGeo, fMat);
  fMesh.rotation.x = -Math.PI / 2;
  fMesh.position.set(offX + room.width / 2, 0.5, offZ + room.depth / 2);
  fMesh.receiveShadow = true;
  scene.add(fMesh);

  // Tray ceiling + cove + downlights — rectangular path.
  buildCeiling(scene, room, /*useStandard*/ true, offX, offZ);
}

// ============================================================
// Screenshot / GLB export utilities
// ============================================================
function screenshotPNG() {
  const active = ctx || aptCtx;
  if (!active) return null;
  active.renderer.render(active.scene, active.camera);
  return active.renderer.domElement.toDataURL("image/png");
}

function exportGLB() {
  const active = ctx || aptCtx;
  if (!active) return Promise.reject(new Error("no-3d-scene"));
  return new Promise((resolve, reject) => {
    try {
      const exporter = new GLTFExporter();
      exporter.parse(
        active.scene,
        (result) => {
          const blob = new Blob([result], { type: "model/gltf-binary" });
          resolve(blob);
        },
        (err) => reject(err),
        { binary: true }
      );
    } catch (e) { reject(e); }
  });
}

// Sun/time-of-day control: hour is 0..24
function setSunHour(hour) {
  const active = ctx || aptCtx;
  if (!active) return;
  const sun = active.sun || active.scene.children.find(o => o.isDirectionalLight);
  if (!sun) return;
  // Map hour 6..18 to sun arc above; 18..6 night
  const t = ((hour - 6) / 12); // 0 at 6am, 1 at 6pm
  const clamped = Math.max(0, Math.min(1, t));
  const angle = clamped * Math.PI; // 0..PI
  const radius = 3000;
  const cx = (active.bounds ? active.bounds.w : active.room.width) / 2;
  const cz = (active.bounds ? active.bounds.h : active.room.depth) / 2;
  sun.position.set(cx + Math.cos(angle) * radius, Math.max(200, Math.sin(angle) * radius), cz - radius * 0.3);
  // Night = dim; day = bright
  const dayFactor = (hour >= 6 && hour <= 18) ? Math.sin(clamped * Math.PI) : 0.15;
  sun.intensity = 0.2 + 0.9 * dayFactor;
  // Ambient becomes bluish at night
  const amb = active.ambient || active.scene.children.find(o => o.isAmbientLight);
  if (amb) {
    amb.intensity = 0.35 + 0.4 * dayFactor;
    if (dayFactor < 0.3) amb.color.setHex(0x6b7a94);
    else amb.color.setHex(0xffffff);
  }
}

// Wall visibility controls (single-room 3D view only).
// wallId is one of "top" | "bottom" | "left" | "right".
// `visible: true` removes any manual hide and lets auto-hide take over.
function setWallVisibility(wallId, visible) {
  if (!ctx) return;
  if (visible) ctx.manualHidden.delete(wallId);
  else         ctx.manualHidden.add(wallId);
}
function setAutoHideWalls(enabled) {
  if (!ctx) return;
  ctx.autoHide = !!enabled;
}
function getWallVisibilityState() {
  if (!ctx) return null;
  const all = ["top", "right", "bottom", "left"];
  const visible = {};
  all.forEach(id => { visible[id] = !ctx.manualHidden.has(id); });
  return { visible, autoHide: ctx.autoHide };
}

window.AptThreeView = {
  show, hide, hideRoomOnly, updateItems, setSelection, isActiveFor, screenToRoomCoords,
  showApartment, isActiveApartment, updateApartmentItems, hideApartment,
  screenshotPNG, exportGLB, setSunHour,
  setWallVisibility, setAutoHideWalls, getWallVisibilityState,
  setQuality, getRendererProfile,
};
