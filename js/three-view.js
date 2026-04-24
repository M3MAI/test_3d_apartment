// 3D preview (Three.js). Builds a scene from the current room + placed furniture.
// Exposes `window.AptThreeView = { show(container, { room, items, findItem, onSelect }), hide() }`.

import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const WALL_HEIGHT   = 270;     // cm
const WALL_THICK_3D = 10;      // cm
const FLOOR_MARGIN  = 40;      // cm of room padding shown around the plan

let ctx = null;                // per-show rendering context

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
  if (ctx.onClick) ctx.renderer.domElement.removeEventListener("click", ctx.onClick);
  if (ctx.controls) ctx.controls.dispose();
  disposeObj(ctx.scene);
  if (ctx.renderer) {
    ctx.renderer.dispose();
    ctx.renderer.domElement.remove();
  }
  ctx = null;
}

function show(container, opts) {
  hide(); // idempotent
  const { room, items, findItem, onSelect } = opts;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(bgColorFromTheme());

  const camera = new THREE.PerspectiveCamera(
    45,
    Math.max(container.clientWidth, 1) / Math.max(container.clientHeight, 1),
    1,
    5000
  );
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(container.clientWidth || 800, container.clientHeight || 500);
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // Lights
  const amb = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(amb);
  const key = new THREE.DirectionalLight(0xffffff, 0.9);
  key.position.set(room.width * 0.6, WALL_HEIGHT * 2, room.depth * 0.4);
  key.castShadow = true;
  key.shadow.mapSize.set(1024, 1024);
  key.shadow.camera.left   = -room.width;
  key.shadow.camera.right  =  room.width;
  key.shadow.camera.top    =  room.depth;
  key.shadow.camera.bottom = -room.depth;
  scene.add(key);

  // Floor (wallColor matches the 2D view's floor tint)
  const floorMat = new THREE.MeshStandardMaterial({ color: hexToInt(room.wallColor), roughness: 0.95 });
  const floorGeo = new THREE.PlaneGeometry(room.width, room.depth);
  const floor = new THREE.Mesh(floorGeo, floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(room.width / 2, 0, room.depth / 2);
  floor.receiveShadow = true;
  scene.add(floor);

  // Grid on floor (every 50cm)
  const grid = new THREE.GridHelper(Math.max(room.width, room.depth), Math.max(room.width, room.depth) / 50, 0x999999, 0xcccccc);
  grid.position.set(room.width / 2, 0.2, room.depth / 2);
  grid.material.opacity = 0.35;
  grid.material.transparent = true;
  scene.add(grid);

  // Walls (with door/window holes)
  buildWalls(scene, room);

  // Furniture
  const selectables = [];
  items.forEach(inst => {
    const item = findItem(inst.groupId, inst.itemId);
    if (!item) return;
    const mesh = buildFurnitureMesh(inst, item);
    if (!mesh) return;
    mesh.userData.instId = inst.instId;
    scene.add(mesh);
    selectables.push(mesh);
  });

  // Orbit camera positioned above the room for a good starting overview.
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
  controls.maxPolarAngle = Math.PI * 0.49;   // prevent going under the floor
  controls.minDistance = 120;
  controls.maxDistance = diag * 3;
  controls.enableDamping = true;
  controls.update();

  // Track the walls so we can hide whichever is closest to the camera
  // (so the camera never looks through a solid wall).
  const wallList = [];
  scene.traverse(o => { if (o.userData && o.userData.wallId) wallList.push(o); });

  // Click → select
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  function onClick(e) {
    const rect = renderer.domElement.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(selectables, true);
    if (!hits.length) return;
    let o = hits[0].object;
    while (o && !o.userData.instId) o = o.parent;
    if (o && o.userData.instId && onSelect) onSelect(o.userData.instId);
  }
  renderer.domElement.addEventListener("click", onClick);

  // Resize handling
  const resizeObs = new ResizeObserver(() => {
    const w = container.clientWidth;
    const h = container.clientHeight;
    if (!w || !h) return;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    renderer.setSize(w, h);
  });
  resizeObs.observe(container);

  // Animate (with near-wall culling for visibility from any orbit angle)
  const roomCenter = new THREE.Vector3(room.width / 2, WALL_HEIGHT / 2, room.depth / 2);
  const camToCenter = new THREE.Vector3();
  let raf;
  const loop = () => {
    raf = requestAnimationFrame(loop);
    controls.update();

    // Hide the single wall that sits between the camera and the room center.
    // (Never hide more than one at a time, so we always keep context.)
    camToCenter.copy(roomCenter).sub(camera.position).normalize();
    let hideId = null;
    // Angle from camera toward room center projected on horizontal plane.
    const cx = camera.position.x - roomCenter.x;
    const cz = camera.position.z - roomCenter.z;
    // Determine dominant side: wall adjacent to the camera gets hidden.
    if (Math.abs(cx) >= Math.abs(cz)) {
      hideId = cx >= 0 ? "right" : "left";
    } else {
      hideId = cz >= 0 ? "bottom" : "top";
    }
    wallList.forEach(m => { m.visible = (m.userData.wallId !== hideId); });

    renderer.render(scene, camera);
  };
  loop();

  ctx = { scene, camera, renderer, controls, raf, resizeObs, onClick, selectables };
}

function bgColorFromTheme() {
  return document.body.dataset.theme === "dark" ? 0x0c1020 : 0xeef1f8;
}
function hexToInt(str) {
  if (!str) return 0x888888;
  const s = str.trim().replace("#", "");
  const hex = s.length === 3 ? s.split("").map(c => c + c).join("") : s;
  return parseInt(hex, 16) || 0x888888;
}

// ---------- Walls with openings (extruded 2D shape with holes per opening) ----------
function buildWalls(scene, room) {
  const t = WALL_THICK_3D;
  const walls = [
    // segment along +x (top wall = north, y=0)
    { length: room.width, anchor: [0, 0, 0], axis: "x", wall: "top" },
    // segment along +x (bottom wall = south, y=room.depth)
    { length: room.width, anchor: [0, 0, room.depth - t], axis: "x", wall: "bottom" },
    // segment along +z (left wall = west, x=0)
    { length: room.depth, anchor: [0, 0, 0], axis: "z", wall: "left" },
    // segment along +z (right wall = east, x=room.width)
    { length: room.depth, anchor: [room.width - t, 0, 0], axis: "z", wall: "right" },
  ];
  const wallColor = lighter(hexToInt(room.wallColor || "#cccccc"), 0.92);
  const mat = new THREE.MeshStandardMaterial({
    color: wallColor,
    roughness: 0.9,
    side: THREE.DoubleSide,
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
      // X along wall = `at`, vertical Y depends on kind (doors from floor, windows elevated)
      const x0 = o.at;
      const x1 = o.at + o.size;
      const y0 = o.kind === "door" ? 0 : 90;               // window sill at 90cm
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
    // Orient the wall: extruded along +Z, we need top/bottom walls facing along Y.
    if (w.axis === "x") {
      // top wall at z=0, bottom wall at z=room.depth-t; extrude direction already along z
      mesh.position.set(w.anchor[0], 0, w.anchor[2]);
    } else {
      // left/right walls — rotate 90° around Y so the shape's X axis runs along the room's depth
      mesh.rotation.y = -Math.PI / 2;
      // After rotation, local +z points to -x; shift so mesh sits at x = anchor[0]..anchor[0]+t
      mesh.position.set(w.anchor[0] + t, 0, w.anchor[2]);
    }
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.wallId = w.wall;
    scene.add(mesh);
  });
}

function darker(colorInt, factor) {
  const r = Math.round(((colorInt >> 16) & 0xff) * factor);
  const g = Math.round(((colorInt >> 8) & 0xff) * factor);
  const b = Math.round((colorInt & 0xff) * factor);
  return (r << 16) | (g << 8) | b;
}
function lighter(colorInt, amount) {
  // Mix toward white by `amount` (0..1). amount=0 returns original; amount=1 returns white.
  const r = Math.round(((colorInt >> 16) & 0xff) + (255 - ((colorInt >> 16) & 0xff)) * amount);
  const g = Math.round(((colorInt >> 8)  & 0xff) + (255 - ((colorInt >> 8)  & 0xff)) * amount);
  const b = Math.round(( colorInt        & 0xff) + (255 - ( colorInt        & 0xff)) * amount);
  return (r << 16) | (g << 8) | b;
}

// ---------- Furniture mesh ----------
function buildFurnitureMesh(inst, item) {
  const w = item.w;
  const d = item.h;                                // 2D "h" is top-down depth
  const h = item.depth || defaultHeight(item);     // real 3D height
  const geom = new THREE.BoxGeometry(w, h, d);

  const isCustom = inst.groupId === "custom" && item.image;
  let materials;
  if (isCustom) {
    const sideColor = hexToInt(item.sideColor || item.color || "#888888");
    const sideMat = new THREE.MeshStandardMaterial({ color: sideColor, roughness: 0.85 });
    const tex = new THREE.TextureLoader().load(
      item.image,
      undefined,
      undefined,
      (err) => { console.warn("Texture load failed:", err); }
    );
    tex.colorSpace = THREE.SRGBColorSpace;
    // emissive keeps the texture visible even when lighting on that face is weak
    const frontMat = new THREE.MeshStandardMaterial({
      map: tex,
      roughness: 0.9,
      emissive: 0xffffff,
      emissiveMap: tex,
      emissiveIntensity: 0.25,
    });
    // Put the image on both +z (front) and -z (back) so it's visible from either side
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
  mesh.position.set(inst.x, h / 2, inst.y);
  mesh.rotation.y = -((inst.rotation || 0) * Math.PI) / 180;
  return mesh;
}

// Sensible default heights for built-in items (cm) when they don't define depth explicitly.
function defaultHeight(item) {
  const id = item.id;
  const byId = {
    // living
    sofa3: 85, sofa2: 85, sofa_l: 85, armchair: 85, coffee: 42,
    tv_unit: 50, tv: 70, bookshelf: 200, dine_tbl: 75, dine_chair: 90, rug: 1, plant: 80,
    // bedroom
    bed_single: 50, bed_double: 50, bed_king: 50, nightstand: 55,
    wardrobe: 220, dresser: 80, desk: 75, chair: 90,
    // kitchen
    fridge: 180, stove: 90, sink: 90, counter: 90, upper_cab: 70, microwave: 30,
    dine_tbl2: 75, dine_chair2: 90,
    // bathroom
    bathtub: 55, toilet: 80, basin: 85, shower: 210, washer: 85, heater: 55,
    // common
    floor_lamp: 160, ac_split: 25, curtain: 250, entry_rug: 1
  };
  if (byId[id]) return byId[id];
  // Fallback: taller for narrow items, shorter for flat items
  const minSide = Math.min(item.w, item.h);
  return minSide < 30 ? 40 : 70;
}

window.AptThreeView = { show, hide };
