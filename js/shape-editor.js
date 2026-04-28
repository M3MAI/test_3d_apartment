// ==========================================================================
// Room Shape Editor — enables custom polygon room shapes
// ==========================================================================
(function () {
  "use strict";

  let active = false;
  let roomId = null;
  let vertices = [];
  let dragIdx = -1;
  let svg = null;
  let room = null;
  let onSave = null;

  /**
   * Initialize shape editing for a room.
   * @param {SVGElement} svgEl - The SVG element
   * @param {Object} roomData - Room data with width, depth, and optional vertices
   * @param {Function} saveCb - Callback with new vertices array
   */
  function startEditing(svgEl, roomData, saveCb) {
    svg = svgEl;
    room = roomData;
    onSave = saveCb;
    active = true;
    roomId = roomData.id;

    // Initialize vertices from room data or default rectangle
    if (roomData.vertices && roomData.vertices.length >= 3) {
      vertices = roomData.vertices.map(v => ({ ...v }));
    } else {
      // Default rectangle
      vertices = [
        { x: 0, y: 0 },
        { x: roomData.width, y: 0 },
        { x: roomData.width, y: roomData.depth },
        { x: 0, y: roomData.depth },
      ];
    }

    render();
    attachEvents();
  }

  function stopEditing() {
    active = false;
    detachEvents();
    const layer = svg && svg.querySelector("#shape-editor-layer");
    if (layer) layer.remove();
  }

  function getVertices() {
    return vertices.map(v => ({ ...v }));
  }

  function isActive() { return active; }

  // ---------- Rendering ----------
  function render() {
    if (!svg || !active) return;
    const P = 40; // SVG_PADDING

    let layer = svg.querySelector("#shape-editor-layer");
    const viewport = svg.querySelector("#viewport");
    if (!viewport) return;
    if (!layer) {
      layer = document.createElementNS("http://www.w3.org/2000/svg", "g");
      layer.id = "shape-editor-layer";
      viewport.appendChild(layer);
    }
    layer.innerHTML = "";

    // Draw polygon outline
    const points = vertices.map(v => `${P + v.x},${P + v.y}`).join(" ");
    const polygon = document.createElementNS("http://www.w3.org/2000/svg", "polygon");
    polygon.setAttribute("points", points);
    polygon.setAttribute("class", "shape-polygon");
    layer.appendChild(polygon);

    // Draw edges with midpoint "add vertex" handles
    vertices.forEach((v, i) => {
      const next = vertices[(i + 1) % vertices.length];
      // Edge line (already part of polygon, but we add midpoint handles)
      const mx = (v.x + next.x) / 2;
      const my = (v.y + next.y) / 2;
      
      // Midpoint handle (click to add vertex)
      const midCircle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      midCircle.setAttribute("cx", P + mx);
      midCircle.setAttribute("cy", P + my);
      midCircle.setAttribute("r", 5);
      midCircle.setAttribute("class", "shape-midpoint");
      midCircle.dataset.afterIdx = i;
      layer.appendChild(midCircle);
    });

    // Draw vertex handles
    vertices.forEach((v, i) => {
      const circle = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      circle.setAttribute("cx", P + v.x);
      circle.setAttribute("cy", P + v.y);
      circle.setAttribute("r", 7);
      circle.setAttribute("class", "shape-vertex");
      circle.dataset.idx = i;
      layer.appendChild(circle);

      // Coordinates label
      const label = document.createElementNS("http://www.w3.org/2000/svg", "text");
      label.setAttribute("x", P + v.x);
      label.setAttribute("y", P + v.y - 12);
      label.setAttribute("class", "shape-label");
      label.setAttribute("text-anchor", "middle");
      label.textContent = `${Math.round(v.x)},${Math.round(v.y)}`;
      layer.appendChild(label);
    });

    // Area display
    const area = polygonArea(vertices);
    const areaLabel = document.createElementNS("http://www.w3.org/2000/svg", "text");
    const cx = vertices.reduce((s, v) => s + v.x, 0) / vertices.length;
    const cy = vertices.reduce((s, v) => s + v.y, 0) / vertices.length;
    areaLabel.setAttribute("x", P + cx);
    areaLabel.setAttribute("y", P + cy);
    areaLabel.setAttribute("class", "shape-area-label");
    areaLabel.setAttribute("text-anchor", "middle");
    areaLabel.setAttribute("dominant-baseline", "middle");
    areaLabel.textContent = `${(area / 10000).toFixed(2)} م²`;
    layer.appendChild(areaLabel);
  }

  // ---------- Events ----------
  let boundDown, boundMove, boundUp, boundContext;

  function attachEvents() {
    boundDown = onDown.bind(null);
    boundMove = onMove.bind(null);
    boundUp = onUp.bind(null);
    boundContext = onContext.bind(null);
    svg.addEventListener("mousedown", boundDown);
    svg.addEventListener("mousemove", boundMove);
    svg.addEventListener("mouseup", boundUp);
    svg.addEventListener("contextmenu", boundContext);
  }

  function detachEvents() {
    if (!svg) return;
    svg.removeEventListener("mousedown", boundDown);
    svg.removeEventListener("mousemove", boundMove);
    svg.removeEventListener("mouseup", boundUp);
    svg.removeEventListener("contextmenu", boundContext);
  }

  function onDown(e) {
    // Vertex drag
    const vertex = e.target.closest(".shape-vertex");
    if (vertex) {
      e.preventDefault();
      e.stopPropagation();
      dragIdx = parseInt(vertex.dataset.idx, 10);
      return;
    }
    // Midpoint click → add vertex
    const midpoint = e.target.closest(".shape-midpoint");
    if (midpoint) {
      e.preventDefault();
      e.stopPropagation();
      const afterIdx = parseInt(midpoint.dataset.afterIdx, 10);
      const next = vertices[(afterIdx + 1) % vertices.length];
      const mx = (vertices[afterIdx].x + next.x) / 2;
      const my = (vertices[afterIdx].y + next.y) / 2;
      vertices.splice(afterIdx + 1, 0, { x: Math.round(mx), y: Math.round(my) });
      render();
      if (onSave) onSave(getVertices());
      return;
    }
  }

  function onMove(e) {
    if (dragIdx < 0) return;
    e.preventDefault();
    const P = 40;
    const pt = svgPoint(svg, e.clientX, e.clientY);
    let x = Math.round(pt.x - P);
    let y = Math.round(pt.y - P);

    // Snap to 5cm grid
    x = Math.round(x / 5) * 5;
    y = Math.round(y / 5) * 5;

    // Constrained angles with Shift
    if (e.shiftKey && vertices.length > 1) {
      const prev = vertices[(dragIdx - 1 + vertices.length) % vertices.length];
      const dx = x - prev.x;
      const dy = y - prev.y;
      const angle = Math.atan2(dy, dx);
      const snapped = Math.round(angle / (Math.PI / 4)) * (Math.PI / 4);
      const dist = Math.sqrt(dx * dx + dy * dy);
      x = prev.x + Math.round(Math.cos(snapped) * dist / 5) * 5;
      y = prev.y + Math.round(Math.sin(snapped) * dist / 5) * 5;
    }

    vertices[dragIdx].x = x;
    vertices[dragIdx].y = y;
    render();
  }

  function onUp() {
    if (dragIdx >= 0) {
      dragIdx = -1;
      if (onSave) onSave(getVertices());
    }
  }

  function onContext(e) {
    // Right-click to delete vertex (min 3 vertices)
    const vertex = e.target.closest(".shape-vertex");
    if (vertex && vertices.length > 3) {
      e.preventDefault();
      const idx = parseInt(vertex.dataset.idx, 10);
      vertices.splice(idx, 1);
      render();
      if (onSave) onSave(getVertices());
    }
  }

  function svgPoint(svgEl, clientX, clientY) {
    const pt = svgEl.createSVGPoint();
    pt.x = clientX;
    pt.y = clientY;
    const ctm = svgEl.querySelector("#viewport").getScreenCTM();
    return ctm ? pt.matrixTransform(ctm.inverse()) : pt;
  }

  // ---------- Utilities ----------
  function polygonArea(verts) {
    let area = 0;
    for (let i = 0; i < verts.length; i++) {
      const j = (i + 1) % verts.length;
      area += verts[i].x * verts[j].y;
      area -= verts[j].x * verts[i].y;
    }
    return Math.abs(area) / 2;
  }

  function pointInPolygon(x, y, verts) {
    let inside = false;
    for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
      const xi = verts[i].x, yi = verts[i].y;
      const xj = verts[j].x, yj = verts[j].y;
      if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
    return inside;
  }

  function polygonToWalls(verts) {
    const walls = [];
    for (let i = 0; i < verts.length; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % verts.length];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const length = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      walls.push({ start: a, end: b, length, angle, index: i });
    }
    return walls;
  }

  // Public API
  window.ShapeEditor = {
    startEditing,
    stopEditing,
    getVertices,
    isActive,
    polygonArea,
    pointInPolygon,
    polygonToWalls,
  };
})();
