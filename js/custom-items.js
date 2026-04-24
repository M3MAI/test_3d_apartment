// Custom user-uploaded furniture items.
// Persisted in localStorage as `apt_custom_items_v1`.
// Shape: { id, name, icon, w, h, depth, color, sideColor, image (data URL), category }
//   - w, h: top-down footprint in cm (x × y)
//   - depth: height in cm (z)  → used in 3D view
//   - image: base64 data URL (downscaled to max 512px)
//   - sideColor: hex color sampled from image edges, used for the non-image faces in 3D.

const CUSTOM_ITEMS_KEY = "apt_custom_items_v1";
const MAX_IMG_PX = 512;

const CustomItems = {
  _cache: null,
  all() {
    if (this._cache) return this._cache;
    try {
      const raw = localStorage.getItem(CUSTOM_ITEMS_KEY);
      this._cache = raw ? JSON.parse(raw) : [];
    } catch { this._cache = []; }
    return this._cache;
  },
  _save() {
    localStorage.setItem(CUSTOM_ITEMS_KEY, JSON.stringify(this._cache || []));
  },
  add(item) {
    this.all();
    this._cache.push(item);
    this._save();
  },
  remove(id) {
    this.all();
    this._cache = this._cache.filter(i => i.id !== id);
    this._save();
  },
  find(id) {
    return this.all().find(i => i.id === id);
  },
  clear() {
    this._cache = [];
    this._save();
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
