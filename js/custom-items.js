// Custom user-uploaded furniture items.
// Persisted in IndexedDB (DB="apt", store="customItems") with a localStorage
// fallback for environments where IDB is unavailable. The previous
// localStorage key `apt_custom_items_v1` is auto-migrated on first load.
//
// Shape: { id, name, icon, w, h, depth, color, sideColor, image (data URL), category }
//   - w, h: top-down footprint in cm (x × y)
//   - depth: height in cm (z)  → used in 3D view
//   - image: base64 data URL (downscaled to max 768px)
//   - sideColor: hex color sampled from image edges, used for the non-image faces in 3D.

const CUSTOM_ITEMS_KEY = "apt_custom_items_v1"; // legacy localStorage key
const IDB_NAME    = "apt";
// Bumped from 1 → 2 to add the shared `wallPhotos` store used by
// js/wall-storage.js. Both modules open the same DB, so the version must
// match; both upgrade handlers create their own store if missing.
const IDB_VERSION = 2;
const IDB_STORE   = "customItems";
const MAX_IMG_PX  = 768;

// ---------- IndexedDB helpers ----------
function idbOpen() {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
    const req = indexedDB.open(IDB_NAME, IDB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(IDB_STORE)) {
        db.createObjectStore(IDB_STORE, { keyPath: "id" });
      }
      // Wall photos store — created defensively here too in case wall-storage.js
      // hasn't run yet (e.g. older script ordering).
      if (!db.objectStoreNames.contains("wallPhotos")) {
        db.createObjectStore("wallPhotos", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
function idbAll() {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readonly");
    const st = tx.objectStore(IDB_STORE);
    const req = st.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  }));
}
function idbReplaceAll(items) {
  return idbOpen().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(IDB_STORE, "readwrite");
    const st = tx.objectStore(IDB_STORE);
    st.clear().onerror = () => reject(tx.error);
    items.forEach(it => st.put(it));
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  }));
}

const CustomItems = {
  _cache: null,
  _ready: false,
  // Async — call once at app boot to hydrate from IDB (or migrate from
  // localStorage). Until this resolves, `all()` returns whatever it can read
  // from localStorage synchronously so first paint isn't blocked.
  async init() {
    if (this._ready) return this._cache;
    // Synchronous fallback first, so callers that fire before init() resolves
    // don't get an empty list.
    try {
      const raw = localStorage.getItem(CUSTOM_ITEMS_KEY);
      this._cache = raw ? JSON.parse(raw) : [];
    } catch { this._cache = []; }

    try {
      const fromIdb = await idbAll();
      if (fromIdb && fromIdb.length) {
        this._cache = fromIdb;
      } else if (this._cache.length) {
        // Migrate legacy localStorage payload into IDB (one-shot).
        try { await idbReplaceAll(this._cache); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      // IDB unavailable — keep localStorage cache.
    }
    this._ready = true;
    // Force-slim localStorage to free quota (old versions stored full images)
    try {
      const slim = (this._cache || []).map(it => {
        const { image, imageSide, imageTop, autoSide, autoTop, glbData, _rawImage, ...meta } = it;
        return meta;
      });
      localStorage.setItem(CUSTOM_ITEMS_KEY, JSON.stringify(slim));
    } catch { /* ignore */ }
    return this._cache;
  },
  all() {
    if (this._cache) return this._cache;
    try {
      const raw = localStorage.getItem(CUSTOM_ITEMS_KEY);
      this._cache = raw ? JSON.parse(raw) : [];
    } catch { this._cache = []; }
    return this._cache;
  },
  async _save() {
    // Write to IDB primarily (no quota issues); fall back to localStorage if
    // IDB unavailable. Keep a thin metadata copy in localStorage so cold-load
    // can paint immediately before init() resolves.
    let idbOk = false;
    try {
      await idbReplaceAll(this._cache || []);
      idbOk = true;
    } catch (e) { /* IDB unavailable */ }
    try {
      // Best-effort metadata cache in localStorage (for cold-load painting).
      // Strip ALL heavy data — images, GLB, auto-textures.
      // Full data lives in IndexedDB which has 50MB+ quota.
      const slim = (this._cache || []).map(it => {
        const { image, imageSide, imageTop, autoSide, autoTop, glbData, _rawImage, ...meta } = it;
        return meta;
      });
      localStorage.setItem(CUSTOM_ITEMS_KEY, JSON.stringify(slim));
    } catch (e) {
      // Even metadata didn't fit — that's OK if IDB worked
      if (!idbOk) {
        if (window.toast) window.toast("ذاكرة المتصفح ممتلئة — احذف بعض العناصر المخصصة أو صدّر التصميم ثم أعد الضبط", "err");
        return false;
      }
    }
    return idbOk || true;
  },
  async add(item) {
    this.all();
    this._cache.push(item);
    const ok = await this._save();
    if (!ok) {
      this._cache.pop();
      return false;
    }
    return true;
  },
  async update(id, patch) {
    this.all();
    const idx = this._cache.findIndex(i => i.id === id);
    if (idx === -1) return false;
    const prev = this._cache[idx];
    this._cache[idx] = { ...prev, ...patch, id };
    const ok = await this._save();
    if (!ok) {
      this._cache[idx] = prev;
      return false;
    }
    return true;
  },
  async remove(id) {
    this.all();
    this._cache = this._cache.filter(i => i.id !== id);
    await this._save();
  },
  find(id) {
    return this.all().find(i => i.id === id);
  },
  async clear() {
    this._cache = [];
    await this._save();
  },
  group() {
    // Synthesize a FURNITURE_GROUPS-compatible entry.
    return { id: "custom", label: "عناصر مخصصة", items: this.all() };
  }
};

// ---------- Image helpers ----------
function loadImageFromFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = reader.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Downscale image to at most MAX_IMG_PX on the longest side. Returns data URL.
function downscaleImage(img) {
  const maxSide = Math.max(img.width, img.height);
  const scale = maxSide > MAX_IMG_PX ? MAX_IMG_PX / maxSide : 1;
  const w = Math.round(img.width * scale);
  const h = Math.round(img.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  ctx.drawImage(img, 0, 0, w, h);
  return { dataUrl: canvas.toDataURL("image/jpeg", 0.88), canvas, ctx };
}

// Sample the dominant furniture color from the CENTER of the image (not edges).
// Edges often contain background/room pixels giving wrong colors. The center
// region (inner 50%) is much more likely to contain the actual furniture.
function sampleEdgeColor(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  // Sample from the center 50% of the image
  const x0 = Math.round(w * 0.25), y0 = Math.round(h * 0.25);
  const cw = Math.round(w * 0.5), ch = Math.round(h * 0.5);
  let imgData;
  try {
    imgData = ctx.getImageData(x0, y0, cw, ch);
  } catch {
    return "#888888";
  }
  const d = imgData.data;
  let r = 0, g = 0, b = 0, n = 0;
  // Sample every 4th pixel for performance
  for (let i = 0; i < d.length; i += 16) {
    const a = d[i + 3];
    if (a < 32) continue;
    r += d[i]; g += d[i + 1]; b += d[i + 2]; n++;
  }
  if (!n) return "#888888";
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

// ---------- Background removal (Enhancement A) ----------
// Flood-fill from the 4 corners to detect and remove the background.
// `tolerance` (0–100): how aggressively to match background pixels.
// Returns a PNG data URL with transparent background.
function removeBackground(canvas, tolerance = 30) {
  const w = canvas.width, h = canvas.height;
  const ctx = canvas.getContext("2d");
  const imgData = ctx.getImageData(0, 0, w, h);
  const d = imgData.data;

  // Sample background color from the 4 corners (average of 3×3 blocks)
  function sampleCorner(cx, cy) {
    let r = 0, g = 0, b = 0, n = 0;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        const px = Math.max(0, Math.min(w - 1, cx + dx));
        const py = Math.max(0, Math.min(h - 1, cy + dy));
        const i = (py * w + px) * 4;
        r += d[i]; g += d[i+1]; b += d[i+2]; n++;
      }
    }
    return [r/n, g/n, b/n];
  }
  const corners = [
    sampleCorner(1, 1),
    sampleCorner(w - 2, 1),
    sampleCorner(1, h - 2),
    sampleCorner(w - 2, h - 2),
  ];
  // Average all corners to get background color
  const bgR = corners.reduce((s, c) => s + c[0], 0) / 4;
  const bgG = corners.reduce((s, c) => s + c[1], 0) / 4;
  const bgB = corners.reduce((s, c) => s + c[2], 0) / 4;

  // Flood-fill from corners using a BFS queue
  const visited = new Uint8Array(w * h);
  const transparent = new Uint8Array(w * h); // 1 = mark as transparent
  const tolSq = tolerance * tolerance * 3; // squared colour distance threshold
  const queue = [];

  function matches(idx) {
    const i = idx * 4;
    if (d[i+3] < 10) return true; // already transparent
    const dr = d[i] - bgR, dg = d[i+1] - bgG, db = d[i+2] - bgB;
    return (dr*dr + dg*dg + db*db) < tolSq;
  }

  // Seed from edges (not just 4 corners, but all border pixels)
  for (let x = 0; x < w; x++) {
    const topIdx = x;
    const botIdx = (h-1) * w + x;
    if (matches(topIdx)) { queue.push(topIdx); visited[topIdx] = 1; }
    if (matches(botIdx)) { queue.push(botIdx); visited[botIdx] = 1; }
  }
  for (let y = 1; y < h - 1; y++) {
    const leftIdx = y * w;
    const rightIdx = y * w + w - 1;
    if (matches(leftIdx)) { queue.push(leftIdx); visited[leftIdx] = 1; }
    if (matches(rightIdx)) { queue.push(rightIdx); visited[rightIdx] = 1; }
  }

  // BFS flood fill
  while (queue.length > 0) {
    const idx = queue.shift();
    transparent[idx] = 1;
    const x = idx % w, y = (idx - x) / w;
    const neighbors = [];
    if (x > 0) neighbors.push(idx - 1);
    if (x < w - 1) neighbors.push(idx + 1);
    if (y > 0) neighbors.push(idx - w);
    if (y < h - 1) neighbors.push(idx + w);
    for (const n of neighbors) {
      if (!visited[n] && matches(n)) {
        visited[n] = 1;
        queue.push(n);
      }
      visited[n] = 1; // mark visited even if not matching
    }
  }

  // Morphological smoothing: erode 1px then dilate 1px to clean jagged edges
  const eroded = new Uint8Array(transparent);
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const i = y * w + x;
      if (transparent[i] === 0) continue;
      // Erode: if any 4-neighbor is opaque, mark this pixel opaque
      if (transparent[i-1]===0 || transparent[i+1]===0 || transparent[i-w]===0 || transparent[i+w]===0) {
        eroded[i] = 0;
      }
    }
  }
  const dilated = new Uint8Array(eroded);
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const i = y * w + x;
      if (eroded[i] === 1) continue;
      // Dilate: if any 4-neighbor is transparent, mark this pixel transparent
      if (eroded[i-1]===1 || eroded[i+1]===1 || eroded[i-w]===1 || eroded[i+w]===1) {
        dilated[i] = 1;
      }
    }
  }

  // Apply transparency
  for (let i = 0; i < w * h; i++) {
    if (dilated[i]) {
      d[i*4 + 3] = 0; // set alpha to 0
    }
  }
  ctx.putImageData(imgData, 0, 0);

  // Edge feathering: slight alpha blend on the boundary for anti-aliasing
  const feathered = ctx.getImageData(0, 0, w, h);
  const fd = feathered.data;
  for (let y = 1; y < h-1; y++) {
    for (let x = 1; x < w-1; x++) {
      const i = (y * w + x) * 4;
      if (fd[i+3] === 0) continue;
      // Count transparent neighbors
      let tCount = 0;
      if (fd[((y-1)*w+x)*4+3] === 0) tCount++;
      if (fd[((y+1)*w+x)*4+3] === 0) tCount++;
      if (fd[(y*w+x-1)*4+3] === 0) tCount++;
      if (fd[(y*w+x+1)*4+3] === 0) tCount++;
      if (tCount > 0 && tCount < 4) {
        fd[i+3] = Math.round(fd[i+3] * (1 - tCount * 0.2));
      }
    }
  }
  ctx.putImageData(feathered, 0, 0);

  return canvas.toDataURL("image/png"); // PNG to preserve alpha
}

// Convert a File to a processed custom item payload (image + side color).
async function processCustomImage(file, bgRemovalTolerance) {
  const img = await loadImageFromFile(file);
  const { dataUrl, canvas } = downscaleImage(img);
  const sideColor = sampleEdgeColor(canvas);
  let finalImage = dataUrl;
  // Apply background removal if tolerance > 0
  if (bgRemovalTolerance != null && bgRemovalTolerance > 0) {
    finalImage = removeBackground(canvas, bgRemovalTolerance);
  }
  // Auto-generate side and top textures from the front photo edge strips.
  // This makes box mode look 10x better — sides show continuity from photo.
  const autoSide = generateEdgeStrip(canvas, "side");
  const autoTop = generateEdgeStrip(canvas, "top");
  return { image: finalImage, sideColor, hasAlpha: bgRemovalTolerance > 0, autoSide, autoTop };
}

// Generate a texture from an edge strip of the source image.
// mode = "side": takes the left 15% and stretches it to a square.
// mode = "top": takes the top 15% and stretches it to a square.
// This creates visual continuity for box-mode 3D rendering.
function generateEdgeStrip(canvas, mode) {
  const sw = canvas.width, sh = canvas.height;
  const sz = 128; // output texture size
  const out = document.createElement("canvas");
  out.width = sz; out.height = sz;
  const ctx = out.getContext("2d");
  if (mode === "side") {
    // Take left 15% strip, stretch to fill square
    const strip = Math.max(4, Math.round(sw * 0.15));
    ctx.drawImage(canvas, 0, 0, strip, sh, 0, 0, sz, sz);
  } else {
    // Take top 15% strip, stretch to fill square
    const strip = Math.max(4, Math.round(sh * 0.15));
    ctx.drawImage(canvas, 0, 0, sw, strip, 0, 0, sz, sz);
  }
  // Apply a slight blur effect by drawing semi-transparent over itself
  ctx.globalAlpha = 0.3;
  ctx.drawImage(out, -1, -1, sz + 2, sz + 2);
  ctx.drawImage(out, 1, 1, sz + 2, sz + 2);
  ctx.globalAlpha = 1.0;
  return out.toDataURL("image/jpeg", 0.7);
}

// Re-process an existing data URL with background removal (for preview/slider)
async function reprocessWithBgRemoval(dataUrl, tolerance) {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0);
      const sideColor = sampleEdgeColor(canvas);
      const autoSide = generateEdgeStrip(canvas, "side");
      const autoTop = generateEdgeStrip(canvas, "top");
      const result = tolerance > 0 ? removeBackground(canvas, tolerance) : dataUrl;
      resolve({ image: result, sideColor, hasAlpha: tolerance > 0, autoSide, autoTop });
    };
    img.src = dataUrl;
  });
}

window.CustomItems = CustomItems;
window.processCustomImage = processCustomImage;
window.reprocessWithBgRemoval = reprocessWithBgRemoval;
