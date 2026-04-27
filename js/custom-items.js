// Custom user-uploaded furniture items.
// Persisted in IndexedDB (DB="apt", store="customItems") with a localStorage
// fallback for environments where IDB is unavailable. The previous
// localStorage key `apt_custom_items_v1` is auto-migrated on first load.
//
// Shape: { id, name, icon, w, h, depth, color, sideColor, image (data URL), category }
//   - w, h: top-down footprint in cm (x × y)
//   - depth: height in cm (z)  → used in 3D view
//   - image: base64 data URL (downscaled to max 512px)
//   - sideColor: hex color sampled from image edges, used for the non-image faces in 3D.

const CUSTOM_ITEMS_KEY = "apt_custom_items_v1"; // legacy localStorage key
const IDB_NAME    = "apt";
const IDB_VERSION = 1;
const IDB_STORE   = "customItems";
const MAX_IMG_PX  = 512;

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
      // Best-effort metadata cache in localStorage. If full, drop the images.
      const fullJson = JSON.stringify(this._cache || []);
      localStorage.setItem(CUSTOM_ITEMS_KEY, fullJson);
    } catch (e) {
      try {
        // Strip image data URLs to fit metadata-only into localStorage.
        const slim = (this._cache || []).map(({ image, ...rest }) => rest);
        localStorage.setItem(CUSTOM_ITEMS_KEY, JSON.stringify(slim));
      } catch (e2) {
        if (!idbOk) {
          if (window.toast) window.toast("ذاكرة المتصفح ممتلئة — احذف بعض العناصر المخصصة أو صدّر التصميم ثم أعد الضبط", "err");
          return false;
        }
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

// Sample the average edge color of an image's canvas; used as the box side color in 3D.
function sampleEdgeColor(canvas) {
  const ctx = canvas.getContext("2d");
  const w = canvas.width, h = canvas.height;
  const strip = 2;
  const samples = [];
  try {
    samples.push(ctx.getImageData(0, 0, w, strip));              // top
    samples.push(ctx.getImageData(0, h - strip, w, strip));      // bottom
    samples.push(ctx.getImageData(0, 0, strip, h));              // left
    samples.push(ctx.getImageData(w - strip, 0, strip, h));      // right
  } catch {
    return "#888888";
  }
  let r = 0, g = 0, b = 0, n = 0;
  for (const s of samples) {
    for (let i = 0; i < s.data.length; i += 4) {
      const a = s.data[i + 3];
      if (a < 32) continue;
      r += s.data[i]; g += s.data[i + 1]; b += s.data[i + 2]; n++;
    }
  }
  if (!n) return "#888888";
  r = Math.round(r / n); g = Math.round(g / n); b = Math.round(b / n);
  return "#" + [r, g, b].map(v => v.toString(16).padStart(2, "0")).join("");
}

// Convert a File to a processed custom item payload (image + side color).
async function processCustomImage(file) {
  const img = await loadImageFromFile(file);
  const { dataUrl, canvas } = downscaleImage(img);
  const sideColor = sampleEdgeColor(canvas);
  return { image: dataUrl, sideColor };
}

window.CustomItems = CustomItems;
window.processCustomImage = processCustomImage;
