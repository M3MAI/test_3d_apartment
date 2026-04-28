// ==========================================================================
// Color Picker from Photo — click on an image to sample pixel colors
// ==========================================================================
(function () {
  "use strict";

  let overlay = null;
  let canvas = null;
  let ctx2d = null;
  let img = null;
  let callback = null;
  let magnifier = null;
  let colorPreview = null;
  let hexLabel = null;

  function open(imageUrl, cb) {
    callback = cb;
    close(); // clean up any previous

    // Create overlay
    overlay = document.createElement("div");
    overlay.className = "color-picker-overlay";
    overlay.innerHTML = `
      <div class="cp-toolbar">
        <span class="cp-title">🔍 انقر على الصورة لاختيار اللون</span>
        <button class="btn sm ghost cp-close-btn">✕ إغلاق</button>
      </div>
      <div class="cp-canvas-wrap">
        <canvas class="cp-canvas"></canvas>
        <div class="cp-magnifier" hidden>
          <canvas class="cp-mag-canvas" width="120" height="120"></canvas>
          <div class="cp-color-info">
            <div class="cp-swatch"></div>
            <span class="cp-hex">#000000</span>
          </div>
        </div>
        <div class="cp-crosshair" hidden></div>
      </div>
      <div class="cp-hint">حرّك الماوس فوق الصورة ثم انقر لاختيار اللون</div>
    `;
    document.body.appendChild(overlay);

    // Get refs
    canvas = overlay.querySelector(".cp-canvas");
    ctx2d = canvas.getContext("2d", { willReadFrequently: true });
    magnifier = overlay.querySelector(".cp-magnifier");
    colorPreview = overlay.querySelector(".cp-swatch");
    hexLabel = overlay.querySelector(".cp-hex");
    const crosshair = overlay.querySelector(".cp-crosshair");

    // Load image to canvas
    img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      // Scale to fit viewport
      const maxW = window.innerWidth * 0.9;
      const maxH = window.innerHeight * 0.75;
      const scale = Math.min(1, maxW / img.width, maxH / img.height);
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      ctx2d.drawImage(img, 0, 0, canvas.width, canvas.height);
    };
    img.onerror = () => {
      canvas.width = 400;
      canvas.height = 200;
      ctx2d.fillStyle = "#333";
      ctx2d.fillRect(0, 0, 400, 200);
      ctx2d.fillStyle = "#fff";
      ctx2d.font = "16px Cairo, sans-serif";
      ctx2d.textAlign = "center";
      ctx2d.fillText("فشل تحميل الصورة", 200, 100);
    };
    img.src = imageUrl;

    // Events
    const wrap = overlay.querySelector(".cp-canvas-wrap");
    wrap.addEventListener("mousemove", onMove);
    wrap.addEventListener("click", onClick);
    wrap.addEventListener("mouseleave", () => {
      magnifier.hidden = true;
      crosshair.hidden = true;
    });
    overlay.querySelector(".cp-close-btn").addEventListener("click", close);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
  }

  function onMove(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) {
      magnifier.hidden = true;
      return;
    }

    // Sample pixel
    const pixel = ctx2d.getImageData(x, y, 1, 1).data;
    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);

    // Update magnifier
    magnifier.hidden = false;
    const magCanvas = magnifier.querySelector(".cp-mag-canvas");
    const magCtx = magCanvas.getContext("2d");
    magCtx.imageSmoothingEnabled = false;
    magCtx.clearRect(0, 0, 120, 120);
    // Draw zoomed region (10x magnification, 12px source → 120px display)
    const srcSize = 12;
    magCtx.drawImage(canvas, x - srcSize / 2, y - srcSize / 2, srcSize, srcSize, 0, 0, 120, 120);
    // Draw crosshair in center
    magCtx.strokeStyle = "rgba(255,255,255,0.8)";
    magCtx.lineWidth = 1;
    magCtx.strokeRect(50, 50, 20, 20);

    colorPreview.style.background = hex;
    hexLabel.textContent = hex;

    // Position magnifier near cursor but keep in viewport
    const wrapRect = canvas.closest(".cp-canvas-wrap").getBoundingClientRect();
    let mx = e.clientX - wrapRect.left + 20;
    let my = e.clientY - wrapRect.top - 80;
    if (mx + 140 > wrapRect.width) mx = e.clientX - wrapRect.left - 160;
    if (my < 0) my = e.clientY - wrapRect.top + 20;
    magnifier.style.left = mx + "px";
    magnifier.style.top = my + "px";

    // Crosshair
    const crosshair = overlay.querySelector(".cp-crosshair");
    crosshair.hidden = false;
    crosshair.style.left = (e.clientX - wrapRect.left) + "px";
    crosshair.style.top = (e.clientY - wrapRect.top) + "px";
  }

  function onClick(e) {
    const rect = canvas.getBoundingClientRect();
    const x = Math.round(e.clientX - rect.left);
    const y = Math.round(e.clientY - rect.top);
    if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;

    const pixel = ctx2d.getImageData(x, y, 1, 1).data;
    const hex = rgbToHex(pixel[0], pixel[1], pixel[2]);

    if (callback) callback(hex);
    close();
  }

  function onKey(e) {
    if (e.key === "Escape") close();
  }

  function close() {
    if (overlay) {
      overlay.remove();
      overlay = null;
    }
    document.removeEventListener("keydown", onKey);
    callback = null;
  }

  function rgbToHex(r, g, b) {
    return "#" + [r, g, b].map(c => c.toString(16).padStart(2, "0")).join("");
  }

  // Public API
  window.ColorPicker = { open, close };
})();
