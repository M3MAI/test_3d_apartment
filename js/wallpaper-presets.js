// Wallpaper presets — procedural canvas patterns generated on the fly so the
// app stays self-contained (no external image hosting, no copyright issues,
// no extra HTTP requests). Each preset draws a tileable pattern into a
// 512×512 canvas and returns a JPEG data URL ready to feed back into the
// regular wall-photo pipeline (same shape as a user upload).
//
// Public API on window.WallpaperPresets:
//   list()                       — array of { id, name, icon, swatch?, build }
//   getById(id)                  — preset descriptor.
//   buildDataUrl(id)             — synchronous JPEG data URL.
//   getThumb(id)                 — small 128px data URL for gallery thumbs.
//   buildSettings(id)            — sensible default fit/tile settings.
//
// To add a new preset, just push another entry to PRESETS; no changes
// elsewhere needed.

(function () {
  "use strict";

  // ---------- low-level drawing helpers ----------
  function rgba(r, g, b, a) { return `rgba(${r|0},${g|0},${b|0},${a})`; }
  function hexToRgb(h) {
    h = h.replace("#", "");
    if (h.length === 3) h = h.split("").map(c => c + c).join("");
    return {
      r: parseInt(h.slice(0, 2), 16),
      g: parseInt(h.slice(2, 4), 16),
      b: parseInt(h.slice(4, 6), 16),
    };
  }
  function noise(c, w, h, count, baseRgb, alphaMin, alphaMax) {
    for (let i = 0; i < count; i++) {
      const x = Math.random() * w, y = Math.random() * h;
      const a = alphaMin + Math.random() * (alphaMax - alphaMin);
      c.fillStyle = `rgba(${baseRgb},${a.toFixed(3)})`;
      c.fillRect(x, y, 1, 1);
    }
  }

  // ---------- per-preset builders ----------
  // Solid paint with very fine noise — closest to a real matte wall.
  function buildPaint(c, size, baseHex, accentRgb) {
    c.fillStyle = baseHex;
    c.fillRect(0, 0, size, size);
    noise(c, size, size, 1500, accentRgb, 0.02, 0.06);
  }

  function buildBrick(c, size) {
    c.fillStyle = "#7a3d2c";
    c.fillRect(0, 0, size, size);
    const bw = size / 4, bh = size / 8;
    c.fillStyle = "#1f1410";
    for (let row = 0; row < 8; row++) {
      const offset = (row % 2 === 0) ? 0 : bw / 2;
      for (let col = -1; col < 5; col++) {
        const x = col * bw + offset;
        const y = row * bh;
        c.fillRect(x - 1, y, 2, bh);
      }
      c.fillRect(0, row * bh - 1, size, 2);
    }
    // Brick variation
    for (let row = 0; row < 8; row++) {
      const offset = (row % 2 === 0) ? 0 : bw / 2;
      for (let col = -1; col < 5; col++) {
        const x = col * bw + offset + 1;
        const y = row * bh + 1;
        c.fillStyle = `rgba(${180 + Math.random() * 30},${90 + Math.random() * 30},${60 + Math.random() * 30},0.35)`;
        c.fillRect(x, y, bw - 2, bh - 2);
      }
    }
  }

  function buildConcrete(c, size) {
    c.fillStyle = "#bdbdb6"; c.fillRect(0, 0, size, size);
    noise(c, size, size, 2000, "70,70,70", 0.05, 0.18);
    noise(c, size, size, 800,  "240,240,240", 0.02, 0.10);
    // Subtle diagonal trowel marks
    c.strokeStyle = "rgba(0,0,0,0.04)";
    for (let i = 0; i < 6; i++) {
      c.beginPath();
      c.moveTo(0, Math.random() * size);
      c.lineTo(size, Math.random() * size);
      c.stroke();
    }
  }

  function buildWoodPanel(c, size, base, dark) {
    c.fillStyle = base;
    c.fillRect(0, 0, size, size);
    // Vertical plank seams every size/4
    c.fillStyle = dark;
    for (let i = 1; i < 4; i++) {
      const x = i * size / 4;
      c.fillRect(x - 1, 0, 2, size);
    }
    c.fillRect(0, 0, 1, size);
    c.fillRect(size - 1, 0, 1, size);
    // Wood grain streaks
    c.strokeStyle = dark;
    c.lineWidth = 1;
    for (let i = 0; i < 60; i++) {
      const x = Math.random() * size;
      const y = Math.random() * size;
      c.globalAlpha = 0.08 + Math.random() * 0.18;
      c.beginPath();
      c.moveTo(x, y);
      c.lineTo(x + (Math.random() - 0.5) * 4, y + 30 + Math.random() * 70);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  function buildHerringbone(c, size, baseA, baseB, dark) {
    // 8x8 grid of alternating rotated rectangles.
    const cell = size / 4;
    for (let r = 0; r < 4; r++) {
      for (let cIdx = 0; cIdx < 4; cIdx++) {
        const horiz = (r + cIdx) % 2 === 0;
        c.save();
        c.translate(cIdx * cell, r * cell);
        c.fillStyle = horiz ? baseA : baseB;
        c.fillRect(0, 0, cell, cell);
        c.strokeStyle = dark;
        c.lineWidth = 1;
        if (horiz) {
          for (let yy = cell / 4; yy < cell; yy += cell / 4) {
            c.beginPath(); c.moveTo(0, yy); c.lineTo(cell, yy); c.stroke();
          }
        } else {
          for (let xx = cell / 4; xx < cell; xx += cell / 4) {
            c.beginPath(); c.moveTo(xx, 0); c.lineTo(xx, cell); c.stroke();
          }
        }
        c.restore();
      }
    }
  }

  function buildChevron(c, size, lightHex, darkHex) {
    const stripeH = size / 8;
    c.fillStyle = lightHex; c.fillRect(0, 0, size, size);
    c.fillStyle = darkHex;
    for (let i = 0; i < 8; i++) {
      if (i % 2 === 0) {
        c.beginPath();
        c.moveTo(0, i * stripeH);
        c.lineTo(size / 2, i * stripeH + stripeH / 2);
        c.lineTo(size, i * stripeH);
        c.lineTo(size, i * stripeH + stripeH);
        c.lineTo(size / 2, i * stripeH + stripeH * 1.5);
        c.lineTo(0, i * stripeH + stripeH);
        c.closePath();
        c.fill();
      }
    }
  }

  function buildStripes(c, size, dirVertical, lightHex, darkHex) {
    c.fillStyle = lightHex; c.fillRect(0, 0, size, size);
    c.fillStyle = darkHex;
    const sw = size / 8;
    for (let i = 0; i < 8; i += 2) {
      if (dirVertical) c.fillRect(i * sw, 0, sw, size);
      else             c.fillRect(0, i * sw, size, sw);
    }
  }

  function buildDamask(c, size, baseHex, accentHex) {
    c.fillStyle = baseHex; c.fillRect(0, 0, size, size);
    c.fillStyle = accentHex;
    const cellW = size / 2;
    const cellH = size / 2;
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 2; col++) {
        const cx = col * cellW + cellW / 2 + (row % 2 === 0 ? 0 : cellW / 2);
        const cy = row * cellH + cellH / 2;
        // Stylised flower: 4-petal rosette.
        c.save();
        c.translate(cx, cy);
        for (let p = 0; p < 4; p++) {
          c.rotate(Math.PI / 2);
          c.beginPath();
          c.ellipse(0, -cellH / 4, cellW / 8, cellH / 4, 0, 0, Math.PI * 2);
          c.fill();
        }
        c.beginPath();
        c.arc(0, 0, cellW / 12, 0, Math.PI * 2);
        c.fill();
        c.restore();
      }
    }
  }

  function buildHexagonal(c, size, baseHex, edgeHex) {
    c.fillStyle = baseHex; c.fillRect(0, 0, size, size);
    const r = size / 8;
    const dx = r * Math.sqrt(3);
    const dy = r * 1.5;
    c.strokeStyle = edgeHex;
    c.lineWidth = 1.5;
    for (let row = -1; row * dy < size + dy; row++) {
      for (let col = -1; col * dx < size + dx; col++) {
        const cx = col * dx + (row % 2 === 0 ? 0 : dx / 2);
        const cy = row * dy;
        c.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = Math.PI / 3 * i + Math.PI / 6;
          const x = cx + r * Math.cos(a);
          const y = cy + r * Math.sin(a);
          if (i === 0) c.moveTo(x, y);
          else c.lineTo(x, y);
        }
        c.closePath();
        c.stroke();
      }
    }
  }

  function buildFabric(c, size, baseHex) {
    c.fillStyle = baseHex; c.fillRect(0, 0, size, size);
    // Cross-hatch weave.
    const lineSpacing = 4;
    c.strokeStyle = "rgba(0,0,0,0.10)";
    c.lineWidth = 1;
    for (let i = 0; i < size; i += lineSpacing) {
      c.beginPath(); c.moveTo(i, 0); c.lineTo(i, size); c.stroke();
    }
    c.strokeStyle = "rgba(255,255,255,0.06)";
    for (let i = 0; i < size; i += lineSpacing) {
      c.beginPath(); c.moveTo(0, i); c.lineTo(size, i); c.stroke();
    }
    noise(c, size, size, 4000, "60,45,30", 0.04, 0.10);
  }

  function buildMarble(c, size) {
    const grd = c.createLinearGradient(0, 0, size, size);
    grd.addColorStop(0, "#f5f3ee");
    grd.addColorStop(1, "#e8e4dc");
    c.fillStyle = grd; c.fillRect(0, 0, size, size);
    c.strokeStyle = "rgba(120,110,100,0.25)";
    for (let i = 0; i < 8; i++) {
      c.lineWidth = 0.5 + Math.random() * 1.6;
      c.beginPath();
      let x = Math.random() * size, y = Math.random() * size;
      c.moveTo(x, y);
      for (let j = 0; j < 30; j++) {
        x += (Math.random() - 0.5) * 28;
        y += (Math.random() - 0.5) * 28;
        c.lineTo(x, y);
      }
      c.stroke();
    }
  }

  // ---------- registry ----------
  const PRESETS = [
    {
      id: "paint-warm",  name: "دهان دافئ",      icon: "🟫", swatch: "#e9dcc4",
      build: (c, s) => buildPaint(c, s, "#e9dcc4", "180,160,120"),
      defaultFit: "stretch",
    },
    {
      id: "paint-mint",  name: "دهان منت",        icon: "🟩", swatch: "#bfd6d8",
      build: (c, s) => buildPaint(c, s, "#bfd6d8", "100,140,140"),
      defaultFit: "stretch",
    },
    {
      id: "paint-blue",  name: "دهان أزرق هادئ",  icon: "🟦", swatch: "#a4bedd",
      build: (c, s) => buildPaint(c, s, "#a4bedd", "60,100,160"),
      defaultFit: "stretch",
    },
    {
      id: "paint-grey",  name: "دهان رمادي",      icon: "⬜", swatch: "#cfd1d4",
      build: (c, s) => buildPaint(c, s, "#cfd1d4", "100,100,100"),
      defaultFit: "stretch",
    },
    {
      id: "brick-red",   name: "طوب أحمر",        icon: "🧱", swatch: "#7a3d2c",
      build: (c, s) => buildBrick(c, s),
      defaultFit: "tile", defaultTile: 3,
    },
    {
      id: "concrete",    name: "خرسانة عارية",    icon: "🪨", swatch: "#bdbdb6",
      build: (c, s) => buildConcrete(c, s),
      defaultFit: "tile", defaultTile: 2,
    },
    {
      id: "wood-light",  name: "خشب فاتح",        icon: "🪵", swatch: "#c8a779",
      build: (c, s) => buildWoodPanel(c, s, "#c8a779", "#7a5a3a"),
      defaultFit: "tile", defaultTile: 2,
    },
    {
      id: "wood-dark",   name: "خشب داكن",        icon: "🟫", swatch: "#7a5a3a",
      build: (c, s) => buildWoodPanel(c, s, "#7a5a3a", "#3d2a18"),
      defaultFit: "tile", defaultTile: 2,
    },
    {
      id: "herringbone", name: "هيرنجبون",        icon: "▦",  swatch: "#a07050",
      build: (c, s) => buildHerringbone(c, s, "#a07050", "#8b5e3c", "rgba(0,0,0,0.25)"),
      defaultFit: "tile", defaultTile: 2,
    },
    {
      id: "chevron",     name: "شيفرون",          icon: "⌃",  swatch: "#e8e0d0",
      build: (c, s) => buildChevron(c, s, "#e8e0d0", "#6892b0"),
      defaultFit: "tile", defaultTile: 2,
    },
    {
      id: "stripes-v",   name: "خطوط رأسية",      icon: "│",  swatch: "#f0e8d8",
      build: (c, s) => buildStripes(c, s, true, "#f0e8d8", "#9aaeb8"),
      defaultFit: "tile", defaultTile: 1,
    },
    {
      id: "stripes-h",   name: "خطوط أفقية",      icon: "≡",  swatch: "#f0e8d8",
      build: (c, s) => buildStripes(c, s, false, "#f0e8d8", "#9aaeb8"),
      defaultFit: "tile", defaultTile: 1,
    },
    {
      id: "damask",      name: "دمشقي كلاسيكي",   icon: "❀",  swatch: "#e8d8b0",
      build: (c, s) => buildDamask(c, s, "#e8d8b0", "rgba(120,80,40,0.4)"),
      defaultFit: "tile", defaultTile: 2,
    },
    {
      id: "hexagonal",   name: "خلايا سداسية",    icon: "⬡",  swatch: "#f0eee8",
      build: (c, s) => buildHexagonal(c, s, "#f0eee8", "rgba(80,80,80,0.6)"),
      defaultFit: "tile", defaultTile: 3,
    },
    {
      id: "fabric",      name: "نسيج قماش",       icon: "🧵", swatch: "#9a7a5a",
      build: (c, s) => buildFabric(c, s, "#9a7a5a"),
      defaultFit: "tile", defaultTile: 4,
    },
    {
      id: "marble",      name: "رخام",            icon: "🪨", swatch: "#f5f3ee",
      build: (c, s) => buildMarble(c, s),
      defaultFit: "stretch",
    },
  ];

  const _builtCache = new Map();   // id → full-size data URL
  const _thumbCache = new Map();   // id → 128px data URL

  function buildDataUrl(id, size) {
    size = size || 512;
    const key = `${id}:${size}`;
    if (_builtCache.has(key)) return _builtCache.get(key);
    const preset = PRESETS.find(p => p.id === id);
    if (!preset) return null;
    const canvas = document.createElement("canvas");
    canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d");
    preset.build(ctx, size);
    const url = canvas.toDataURL("image/jpeg", 0.88);
    _builtCache.set(key, url);
    return url;
  }
  function getThumb(id) {
    if (_thumbCache.has(id)) return _thumbCache.get(id);
    const url = buildDataUrl(id, 128);
    _thumbCache.set(id, url);
    return url;
  }
  function buildSettings(id) {
    const preset = PRESETS.find(p => p.id === id);
    if (!preset) return null;
    const fit = preset.defaultFit || "stretch";
    const tile = preset.defaultTile || 2;
    return { fit, tileX: tile, tileY: tile, brightness: 0, contrast: 0, blend: "normal" };
  }
  function list() { return PRESETS.slice(); }
  function getById(id) { return PRESETS.find(p => p.id === id); }

  // Pre-builds all 16 thumbnails during browser idle time so the gallery modal
  // opens with zero stutter. Each preset takes ~10 ms; we yield between
  // builds to keep the main thread responsive (audit C-14).
  function prewarmThumbs() {
    const ids = PRESETS.map(p => p.id);
    let i = 0;
    const idle = window.requestIdleCallback || function (cb) { return setTimeout(() => cb({ timeRemaining: () => 16 }), 16); };
    function step(deadline) {
      while (i < ids.length && deadline.timeRemaining() > 4) {
        if (!_thumbCache.has(ids[i])) getThumb(ids[i]);
        i++;
      }
      if (i < ids.length) idle(step);
    }
    idle(step);
  }

  window.WallpaperPresets = { list, getById, buildDataUrl, getThumb, buildSettings, prewarmThumbs };
})();
