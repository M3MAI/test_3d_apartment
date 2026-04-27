// DWG importer — converts an AutoCAD DWG file into the apartment's room
// override format by translating LibreDWG's `DwgDatabase` entities into the
// same shape the DXF parser produces, then delegating to the shared
// `DxfImport.buildRoomFromEntities()`.
//
// LibreDWG (GPL-3.0) is loaded lazily from a CDN the first time the user
// picks a DWG file — this keeps the initial PWA payload small (~3MB WASM is
// only fetched on demand). After load the wasm module + glue are cached by
// the browser HTTP cache and the Service Worker's runtime cache.
//
// Public API on `window.DwgImport`:
//   importRoomFromDwg(file: File|Blob): Promise<RoomOverride>
//   loadLibrary(): Promise<void>   // explicit prefetch (optional)
//   isLoaded(): boolean

(function () {
  const CDN_URL =
    "https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.0/+esm";

  let _modulePromise = null;
  let _LibreDwg = null;
  let _Dwg_File_Type = null;
  let _instance = null;

  // Some Emscripten WASM modules try to read import.meta or import scripts
  // from a relative path. Help them by providing the package's wasm dir.
  const WASM_BASE =
    "https://cdn.jsdelivr.net/npm/@mlightcad/libredwg-web@0.7.0/wasm/";

  async function loadLibrary() {
    if (_instance) return _instance;
    if (_modulePromise) return _modulePromise;

    _modulePromise = (async () => {
      try {
        // Dynamic ESM import — works in modern browsers.
        const mod = await import(/* webpackIgnore: true */ CDN_URL);
        _LibreDwg = mod.LibreDwg || mod.default?.LibreDwg;
        _Dwg_File_Type = mod.Dwg_File_Type || mod.default?.Dwg_File_Type;
        if (!_LibreDwg || !_Dwg_File_Type) {
          throw new Error("حُمِّلت LibreDWG لكن لم نجد LibreDwg / Dwg_File_Type");
        }
        // Tell LibreDWG where the .wasm lives (jsdelivr serves it next to the JS).
        _instance = await _LibreDwg.create(WASM_BASE);
        return _instance;
      } catch (err) {
        // Clear cache so the next call retries (e.g. user reconnects to wifi).
        _modulePromise = null;
        throw err;
      }
    })();

    return _modulePromise;
  }

  function isLoaded() { return !!_instance; }

  // ----- Translation: DwgDatabase → DXF-style entity list ---------------------
  function translateEntities(db) {
    const out = [];
    const list = (db && db.entities) || [];
    for (const e of list) {
      if (!e || !e.type) continue;
      const layer = (e.layer || "0");

      if (e.type === "LWPOLYLINE" || e.type === "POLYLINE") {
        // libredwg-web uses bit 512 to mean "closed". Our shared room builder
        // expects DXF semantics where bit 1 is closed — translate.
        const isClosed = ((e.flag || 0) & 512) !== 0;
        const verts = (e.vertices || []).map(v => ({
          x: Number(v.x) || 0,
          y: Number(v.y) || 0,
        }));
        out.push({
          type: "LWPOLYLINE",
          layer,
          flags: isClosed ? 1 : 0,
          vertices: verts,
        });
      } else if (e.type === "LINE") {
        const a = e.startPoint || {};
        const b = e.endPoint || {};
        out.push({
          type: "LINE",
          layer,
          x1: Number(a.x) || 0,
          y1: Number(a.y) || 0,
          x2: Number(b.x) || 0,
          y2: Number(b.y) || 0,
        });
      } else if (e.type === "TEXT") {
        const p = e.startPoint || {};
        out.push({
          type: "TEXT",
          layer,
          x1: Number(p.x) || 0,
          y1: Number(p.y) || 0,
          text: String(e.text || ""),
        });
      } else if (e.type === "MTEXT") {
        const p = e.insertionPoint || {};
        out.push({
          type: "MTEXT",
          layer,
          x1: Number(p.x) || 0,
          y1: Number(p.y) || 0,
          text: String(e.text || ""),
        });
      }
      // INSERT, ARC, CIRCLE, … intentionally ignored — same coverage as the
      // DXF Phase 1 parser.
    }
    return out;
  }

  function getInsunits(db) {
    return (db && db.header && Number(db.header.INSUNITS)) || 0;
  }

  // ----- Public: read a DWG File and return a room override -----------------
  async function importRoomFromDwg(file) {
    if (!window.DxfImport || !window.DxfImport.buildRoomFromEntities) {
      throw new Error("مكتبة DXF غير مُحمَّلة");
    }
    const lib = await loadLibrary();

    const buf = new Uint8Array(await file.arrayBuffer());
    const dwg = lib.dwg_read_data(buf, _Dwg_File_Type.DWG);
    if (!dwg) throw new Error("تعذّر فتح ملف DWG");

    let db;
    try {
      db = lib.convert(dwg);
    } finally {
      try { lib.dwg_free(dwg); } catch (_) { /* ignore */ }
    }
    if (!db) throw new Error("تعذّر تحويل بيانات DWG");

    const entities = translateEntities(db);
    return window.DxfImport.buildRoomFromEntities(entities, getInsunits(db));
  }

  window.DwgImport = {
    importRoomFromDwg,
    loadLibrary,
    isLoaded,
    // exposed for tests / debugging
    _translateEntities: translateEntities,
  };
})();
