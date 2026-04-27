// DXF importer — converts an AutoCAD DXF file into the apartment's room
// override format (width/depth + openings).
//
// We implement a *minimal* DXF parser inline (no external dependency, keeps
// the PWA offline-capable) that reads only the entity types this app needs:
//
//   * LWPOLYLINE (closed) on layer WALLS  → room outline
//   * LINE on layer DOORS / WINDOWS       → openings (mapped to nearest wall)
//   * TEXT / MTEXT on layer ROOM_NAMES    → room label
//   * INSERT (block) on layer FURNITURE_* → optional furniture seeds
//
// AutoCAD layer naming (documented in docs/AUTOCAD.md):
//   WALLS, DOORS, WINDOWS, ROOM_NAMES, FURNITURE_*
//
// All public API is exposed on `window.DxfImport`.

(function () {
  // ----- DXF parser ---------------------------------------------------------
  // DXF is a flat list of (group-code, value) pairs. We tokenize once into an
  // array of {code:Number, value:String} pairs, then walk it.
  function tokenize(text) {
    const lines = text.split(/\r?\n/);
    const tokens = [];
    for (let i = 0; i + 1 < lines.length; i += 2) {
      const code = parseInt(lines[i].trim(), 10);
      const value = lines[i + 1] != null ? lines[i + 1] : "";
      if (Number.isNaN(code)) continue;
      tokens.push({ code, value });
    }
    return tokens;
  }

  // Read entities + relevant header variables. Returns
  // { header:{insunits}, entities:[ {type, layer, ...} ] }.
  function parseDxf(text) {
    const tokens = tokenize(text);
    const header = { insunits: 0 };
    const entities = [];

    let i = 0;
    let section = null;
    let curEntity = null;
    let curVar = null;

    function pushEntity() {
      if (curEntity) entities.push(curEntity);
      curEntity = null;
    }

    while (i < tokens.length) {
      const { code, value } = tokens[i];

      if (code === 0) {
        const v = value.trim();
        if (v === "SECTION") {
          // The next 2/<name> determines the section type.
          if (tokens[i + 1] && tokens[i + 1].code === 2) {
            section = tokens[i + 1].value.trim();
            i += 2;
            continue;
          }
        } else if (v === "ENDSEC") {
          pushEntity();
          section = null;
        } else if (section === "ENTITIES" || section === "BLOCKS") {
          pushEntity();
          if (v === "EOF") break;
          curEntity = { type: v, layer: "0", vertices: [] };
        } else if (section === "HEADER") {
          curVar = null;
        }
        i++;
        continue;
      }

      if (section === "HEADER") {
        // Header pattern: 9 / $VARNAME, then a typed value (70 / int).
        if (code === 9) curVar = value.trim();
        else if (curVar === "$INSUNITS" && code === 70) {
          header.insunits = parseInt(value, 10) || 0;
        }
        i++;
        continue;
      }

      if ((section === "ENTITIES" || section === "BLOCKS") && curEntity) {
        if (code === 8) curEntity.layer = value.trim();
        else if (code === 1) curEntity.text = value;       // TEXT/MTEXT content
        else if (code === 2 && curEntity.type === "INSERT") curEntity.blockName = value.trim();
        else if (code === 10) {
          if (curEntity.type === "LWPOLYLINE" || curEntity.type === "POLYLINE") {
            curEntity.vertices.push({ x: parseFloat(value), y: 0 });
          } else {
            curEntity.x1 = parseFloat(value);
          }
        } else if (code === 20) {
          if ((curEntity.type === "LWPOLYLINE" || curEntity.type === "POLYLINE") && curEntity.vertices.length) {
            curEntity.vertices[curEntity.vertices.length - 1].y = parseFloat(value);
          } else {
            curEntity.y1 = parseFloat(value);
          }
        } else if (code === 11) curEntity.x2 = parseFloat(value);
        else if (code === 21) curEntity.y2 = parseFloat(value);
        else if (code === 70 && curEntity.type === "LWPOLYLINE") curEntity.flags = parseInt(value, 10) || 0;
      }

      i++;
    }
    pushEntity();
    return { header, entities };
  }

  // ----- Unit detection -----------------------------------------------------
  // AutoCAD $INSUNITS values → centimetre conversion factor.
  // 0=unitless, 1=in, 2=ft, 4=mm, 5=cm, 6=m
  function unitToCm(insunits) {
    switch (insunits) {
      case 1: return 2.54;     // inches
      case 2: return 30.48;    // feet
      case 4: return 0.1;      // mm
      case 5: return 1;        // cm
      case 6: return 100;      // m
      default: return 1;       // assume cm if unspecified
    }
  }

  // ----- Geometry helpers ---------------------------------------------------
  function bboxOfPolyline(pts) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pts.forEach(p => {
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    });
    return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
  }

  // Snap a (centre x, centre y, length) opening to the room's nearest wall.
  // Room is treated as the rectangle (0,0) → (W, D). Returns
  // { wall: 'top'|'bottom'|'left'|'right', at:cm, size:cm } or null.
  function openingToWall(cx, cy, length, W, D) {
    const dTop    = cy;
    const dBottom = D - cy;
    const dLeft   = cx;
    const dRight  = W - cx;
    const min = Math.min(dTop, dBottom, dLeft, dRight);
    let wall, at;
    if (min === dTop)         { wall = "top";    at = cx - length / 2; }
    else if (min === dBottom) { wall = "bottom"; at = cx - length / 2; }
    else if (min === dLeft)   { wall = "left";   at = cy - length / 2; }
    else                      { wall = "right";  at = cy - length / 2; }
    const wallLen = (wall === "top" || wall === "bottom") ? W : D;
    at   = Math.max(0, Math.min(wallLen - length, at));
    return { wall, at: Math.round(at), size: Math.round(length) };
  }

  // ----- Per-room import ----------------------------------------------------
  // Pick the largest closed LWPOLYLINE on the WALLS layer as the room outline.
  function pickRoomOutline(entities) {
    let best = null, bestArea = 0;
    entities.forEach(e => {
      if (e.type !== "LWPOLYLINE") return;
      if (e.layer.toUpperCase() !== "WALLS") return;
      // Treat as closed if flags & 1 OR the polyline visually closes (first ≈ last).
      const isClosed = (e.flags & 1) || (
        e.vertices.length >= 3 &&
        Math.hypot(e.vertices[0].x - e.vertices.at(-1).x,
                   e.vertices[0].y - e.vertices.at(-1).y) < 1
      );
      if (!isClosed) return;
      const bb = bboxOfPolyline(e.vertices);
      const area = bb.w * bb.h;
      if (area > bestArea) { bestArea = area; best = { entity: e, bbox: bb }; }
    });
    return best;
  }

  // Convert raw DXF entities into a single-room override payload.
  // { width, depth, openings: [...], hint: "..." }
  function importRoomFromDxf(text) {
    const { header, entities } = parseDxf(text);
    const k = unitToCm(header.insunits);

    const outline = pickRoomOutline(entities);
    if (!outline) {
      throw new Error("لم نجد جدراناً على الطبقة WALLS — تأكّد من رسم محيط الغرفة كـ LWPOLYLINE مغلق.");
    }
    const { bbox } = outline;
    // Translate everything so the room's bottom-left becomes (0, 0).
    const ox = bbox.minX, oy = bbox.minY;
    const W = Math.max(50, Math.round(bbox.w * k));
    const D = Math.max(50, Math.round(bbox.h * k));

    // Detect a name from the largest TEXT/MTEXT inside the bbox on ROOM_NAMES.
    let name = null;
    entities.forEach(e => {
      if (e.type !== "TEXT" && e.type !== "MTEXT") return;
      if ((e.layer || "").toUpperCase() !== "ROOM_NAMES") return;
      const x = (e.x1 || 0), y = (e.y1 || 0);
      if (x >= bbox.minX && x <= bbox.maxX && y >= bbox.minY && y <= bbox.maxY) {
        name = (e.text || "").trim() || name;
      }
    });

    // Map LINE entities on DOORS/WINDOWS to openings on the nearest wall.
    const openings = [];
    entities.forEach(e => {
      if (e.type !== "LINE") return;
      const layer = (e.layer || "").toUpperCase();
      const kind = layer === "DOORS" ? "door"
                 : layer === "WINDOWS" ? "window"
                 : null;
      if (!kind) return;
      const ax = (e.x1 - ox) * k;
      const ay = (e.y1 - oy) * k;
      const bx = (e.x2 - ox) * k;
      const by = (e.y2 - oy) * k;
      const cx = (ax + bx) / 2;
      const cy = (ay + by) / 2;
      const length = Math.hypot(bx - ax, by - ay);
      const op = openingToWall(cx, cy, length, W, D);
      if (op) openings.push({ kind, ...op });
    });

    return {
      width: W, depth: D, openings,
      name: name || null,
      stats: {
        wallCount: 1,
        openingCount: openings.length,
        unit: header.insunits,
        unitLabel: ["unitless", "in", "ft", "?", "mm", "cm", "m"][header.insunits] || "unitless",
      },
    };
  }

  window.DxfImport = { parseDxf, importRoomFromDxf, unitToCm };
})();
