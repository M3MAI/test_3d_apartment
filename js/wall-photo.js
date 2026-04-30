// Wall Photo controller — manages per-wall texture upload, persistence, and
// runtime preview inside the room editor modal.
//
// Public API exposed on window.WallPhoto:
//   init({ getEyedropper, onChange })   — call once at startup; builds the UI
//                                         inside #re-wall-color-grid.
//   populate(room)                       — load room.wallTextures and
//                                         room.wallTextureSettings into UI.
//   collect()                            — returns { wallTextures,
//                                         wallTextureSettings } from current UI
//                                         state (only walls with a photo).
//   reset()                              — clear all state (for testing).
//
// Per-wall settings shape:
//   { fit: 'cover'|'stretch'|'tile',
//     tileX: number (>=1), tileY: number (>=1),
//     brightness: number (-50..50, default 0),
//     contrast:   number (-50..50, default 0) }
(function () {
  "use strict";

  const WALLS = [
    { id: "top",    label: "↑ شمال",  title: "الحائط الشمالي (أعلى)" },
    { id: "right",  label: "→ شرق",   title: "الحائط الشرقي (يمين)" },
    { id: "bottom", label: "↓ جنوب",  title: "الحائط الجنوبي (أسفل)" },
    { id: "left",   label: "← غرب",   title: "الحائط الغربي (يسار)" },
  ];

  // Maximum dimension (px) when downscaling uploads — keeps localStorage usage
  // sane while preserving enough detail for 3D textures.
  const MAX_PX = 1024;

  // Per-wall state (live UI state, not yet persisted).
  const _state = {
    photos:   { top: null, bottom: null, left: null, right: null }, // dataURL or null
    settings: { top: null, bottom: null, left: null, right: null }, // settings obj or null
  };

  let _onChange = null;

  function defaultSettings() {
    return { fit: "cover", tileX: 2, tileY: 2, brightness: 0, contrast: 0 };
  }

  function init(opts) {
    opts = opts || {};
    _onChange = opts.onChange || null;
    const grid = document.getElementById("re-wall-color-grid");
    if (!grid) return;
    grid.innerHTML = WALLS.map(w => buildWallItemHTML(w)).join("");
    WALLS.forEach(w => bindWallItem(w.id, opts));
    bindClipboardPaste();
  }

  function buildWallItemHTML(w) {
    return `
      <div class="wall-color-item" data-wall="${w.id}" title="${w.title}">
        <span>${w.label}</span>
        <input type="color" id="re-wall-${w.id}" />
        <div class="wall-color-actions">
          <button type="button" class="btn sm ghost wall-photo-btn"     data-action="upload"     data-wall="${w.id}" title="رفع صورة للحائط (📷)">📷</button>
          <button type="button" class="btn sm ghost wall-eyedropper-btn" data-action="eyedropper" data-wall="${w.id}" title="اختيار لون من صورة">🔍</button>
          <button type="button" class="btn sm ghost wall-photo-clear"   data-action="clear"      data-wall="${w.id}" title="إزالة الصورة" hidden>🗑</button>
          <button type="button" class="btn sm ghost wall-photo-toall"   data-action="toall"      data-wall="${w.id}" title="نسخ الصورة لكل الجدران" hidden>📋</button>
        </div>
        <input type="file" id="re-wall-photo-input-${w.id}" accept="image/*" hidden />
        <div class="wall-photo-dropzone" data-wall="${w.id}" tabindex="0" aria-label="اسحب صورة هنا أو اضغط للرفع">
          <img class="wall-photo-preview" id="re-wall-photo-preview-${w.id}" alt="" hidden />
          <span class="wall-photo-empty">📁 اسحب صورة هنا</span>
        </div>
        <div class="wall-photo-options" data-wall="${w.id}" hidden>
          <label class="wpo-row">
            <span>الملاءمة</span>
            <select class="wpo-fit" data-wall="${w.id}">
              <option value="cover">تغطية</option>
              <option value="stretch">تمدّد</option>
              <option value="tile">تكرار</option>
            </select>
          </label>
          <div class="wpo-tile-row" data-wall="${w.id}" hidden>
            <label class="wpo-row-narrow"><span>تكرار X</span><input class="wpo-tilex" type="number" min="1" max="20" step="1" value="2" data-wall="${w.id}" /></label>
            <label class="wpo-row-narrow"><span>تكرار Y</span><input class="wpo-tiley" type="number" min="1" max="20" step="1" value="2" data-wall="${w.id}" /></label>
          </div>
          <label class="wpo-row" title="السطوع: −50 إلى +50">
            <span>سطوع</span>
            <input class="wpo-bright" type="range" min="-50" max="50" step="2" value="0" data-wall="${w.id}" />
            <output class="wpo-bright-val">0</output>
          </label>
          <label class="wpo-row" title="التباين: −50 إلى +50">
            <span>تباين</span>
            <input class="wpo-contrast" type="range" min="-50" max="50" step="2" value="0" data-wall="${w.id}" />
            <output class="wpo-contrast-val">0</output>
          </label>
        </div>
      </div>
    `;
  }

  function bindWallItem(wallId, opts) {
    const root = document.querySelector(`.wall-color-item[data-wall="${wallId}"]`);
    if (!root) return;

    const fileInput = root.querySelector(`#re-wall-photo-input-${wallId}`);
    const preview = root.querySelector(`#re-wall-photo-preview-${wallId}`);
    const empty = root.querySelector(".wall-photo-empty");
    const dropzone = root.querySelector(".wall-photo-dropzone");
    const clearBtn = root.querySelector('[data-action="clear"]');
    const toAllBtn = root.querySelector('[data-action="toall"]');
    const opts_ = root.querySelector(".wall-photo-options");
    const tileRow = root.querySelector(".wpo-tile-row");

    root.querySelector('[data-action="upload"]').addEventListener("click", e => {
      e.preventDefault();
      fileInput.click();
    });
    // The eyedropper button has class .wall-eyedropper-btn — its click
    // handler is registered globally by bindEyedropperButtons() in app.js.
    // We deliberately do NOT bind it here to avoid double-firing.
    clearBtn.addEventListener("click", e => {
      e.preventDefault();
      setPhoto(wallId, null);
      _emit();
    });
    toAllBtn.addEventListener("click", e => {
      e.preventDefault();
      const src = _state.photos[wallId];
      if (!src) return;
      WALLS.forEach(w => {
        setPhoto(w.id, src);
        // Inherit the same settings.
        _state.settings[w.id] = { ..._state.settings[wallId] };
        applySettingsToUI(w.id);
      });
      _emit();
      if (typeof window.toast === "function") window.toast("تم نسخ الصورة لكل الجدران");
    });

    fileInput.addEventListener("change", () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      ingestImageFile(file, wallId);
      fileInput.value = "";
    });
    dropzone.addEventListener("click", () => fileInput.click());
    dropzone.addEventListener("keydown", e => {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fileInput.click(); }
    });
    ["dragenter", "dragover"].forEach(ev =>
      dropzone.addEventListener(ev, e => {
        e.preventDefault();
        dropzone.classList.add("drag-over");
      })
    );
    ["dragleave", "drop"].forEach(ev =>
      dropzone.addEventListener(ev, e => {
        e.preventDefault();
        dropzone.classList.remove("drag-over");
      })
    );
    dropzone.addEventListener("drop", e => {
      const dt = e.dataTransfer;
      if (!dt || !dt.files || dt.files.length === 0) return;
      const file = Array.from(dt.files).find(f => /^image\//.test(f.type));
      if (!file) {
        if (typeof window.toast === "function") window.toast("الملف ليس صورة", "warn");
        return;
      }
      ingestImageFile(file, wallId);
    });

    // Settings change handlers.
    root.querySelector(".wpo-fit").addEventListener("change", e => {
      const s = ensureSettings(wallId);
      s.fit = e.target.value;
      tileRow.hidden = (s.fit !== "tile");
      _emit();
    });
    [".wpo-tilex", ".wpo-tiley"].forEach(sel => {
      root.querySelector(sel).addEventListener("change", e => {
        const s = ensureSettings(wallId);
        const v = Math.max(1, Math.min(20, parseInt(e.target.value, 10) || 1));
        e.target.value = v;
        if (sel.endsWith("x")) s.tileX = v; else s.tileY = v;
        _emit();
      });
    });
    [
      [".wpo-bright",   ".wpo-bright-val",   "brightness"],
      [".wpo-contrast", ".wpo-contrast-val", "contrast"],
    ].forEach(([sel, valSel, key]) => {
      const inp = root.querySelector(sel);
      const out = root.querySelector(valSel);
      inp.addEventListener("input", () => {
        const v = parseInt(inp.value, 10) || 0;
        out.textContent = v;
        const s = ensureSettings(wallId);
        s[key] = v;
        _emit();
      });
    });
  }

  function bindClipboardPaste() {
    document.addEventListener("paste", e => {
      const modal = document.getElementById("room-modal");
      if (!modal || modal.hidden) return;
      const items = e.clipboardData && e.clipboardData.items;
      if (!items) return;
      for (const item of items) {
        if (item.type && item.type.startsWith("image/")) {
          const blob = item.getAsFile();
          if (!blob) continue;
          // Pick the wall whose dropzone is currently focused, else "top".
          const focused = document.activeElement;
          let wallId = "top";
          if (focused && focused.classList && focused.classList.contains("wall-photo-dropzone")) {
            wallId = focused.dataset.wall || "top";
          }
          ingestImageFile(blob, wallId);
          if (typeof window.toast === "function") window.toast(`لُصقت الصورة على الجدار ${wallId}`);
          break;
        }
      }
    });
  }

  function ingestImageFile(file, wallId) {
    resizeImageToDataURL(file, MAX_PX, dataUrl => {
      setPhoto(wallId, dataUrl);
      _emit();
    });
  }

  function setPhoto(wallId, dataUrl) {
    const root = document.querySelector(`.wall-color-item[data-wall="${wallId}"]`);
    if (!root) return;
    _state.photos[wallId] = dataUrl;
    if (!_state.settings[wallId]) _state.settings[wallId] = defaultSettings();

    const preview = root.querySelector(".wall-photo-preview");
    const empty   = root.querySelector(".wall-photo-empty");
    const clearBtn = root.querySelector('[data-action="clear"]');
    const toAllBtn = root.querySelector('[data-action="toall"]');
    const opts_   = root.querySelector(".wall-photo-options");

    if (dataUrl) {
      preview.src = dataUrl;
      preview.hidden = false;
      if (empty) empty.hidden = true;
      clearBtn.hidden = false;
      toAllBtn.hidden = false;
      opts_.hidden = false;
      applySettingsToUI(wallId);
    } else {
      preview.removeAttribute("src");
      preview.hidden = true;
      if (empty) empty.hidden = false;
      clearBtn.hidden = true;
      toAllBtn.hidden = true;
      opts_.hidden = true;
      _state.settings[wallId] = null;
    }
  }

  function ensureSettings(wallId) {
    if (!_state.settings[wallId]) _state.settings[wallId] = defaultSettings();
    return _state.settings[wallId];
  }

  function applySettingsToUI(wallId) {
    const root = document.querySelector(`.wall-color-item[data-wall="${wallId}"]`);
    if (!root) return;
    const s = ensureSettings(wallId);
    root.querySelector(".wpo-fit").value = s.fit;
    root.querySelector(".wpo-tile-row").hidden = (s.fit !== "tile");
    root.querySelector(".wpo-tilex").value = s.tileX;
    root.querySelector(".wpo-tiley").value = s.tileY;
    root.querySelector(".wpo-bright").value = s.brightness;
    root.querySelector(".wpo-bright-val").textContent = s.brightness;
    root.querySelector(".wpo-contrast").value = s.contrast;
    root.querySelector(".wpo-contrast-val").textContent = s.contrast;
  }

  // ----- Public API -----
  function populate(room) {
    if (!room) return;
    const photos = room.wallTextures || {};
    const settings = room.wallTextureSettings || {};
    WALLS.forEach(w => {
      _state.photos[w.id] = photos[w.id] || null;
      _state.settings[w.id] = photos[w.id]
        ? { ...defaultSettings(), ...(settings[w.id] || {}) }
        : null;
      // Sync DOM.
      setPhoto(w.id, _state.photos[w.id]);
    });
  }
  function collect() {
    const wallTextures = {};
    const wallTextureSettings = {};
    WALLS.forEach(w => {
      const id = w.id;
      if (_state.photos[id]) {
        wallTextures[id] = _state.photos[id];
        wallTextureSettings[id] = _state.settings[id] || defaultSettings();
      }
    });
    return { wallTextures, wallTextureSettings };
  }
  function reset() {
    WALLS.forEach(w => { _state.photos[w.id] = null; _state.settings[w.id] = null; });
  }

  function _emit() { if (typeof _onChange === "function") _onChange(); }

  function resizeImageToDataURL(file, maxPx, callback) {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        callback(c.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => {
        if (typeof window.toast === "function") window.toast("تعذّر قراءة الصورة", "err");
      };
      img.src = reader.result;
    };
    reader.onerror = () => {
      if (typeof window.toast === "function") window.toast("تعذّر قراءة الملف", "err");
    };
    reader.readAsDataURL(file);
  }

  window.WallPhoto = { init, populate, collect, reset };
})();
