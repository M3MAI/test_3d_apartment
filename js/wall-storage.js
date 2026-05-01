// WallStorage — IndexedDB-backed persistence for wall photo data URLs and
// per-wall texture settings. Solves localStorage quota issues (5MB limit
// vs IDB's 50MB+) when users upload many high-resolution wall photos.
//
// Design:
//   * Single DB ("apt") shared with custom-items.js, separate object store.
//   * Synchronous in-memory cache after init() so the rest of the app
//     (especially three-view.js) can keep its synchronous build flow.
//   * Auto-migration: existing room overrides in localStorage that contain
//     wallTextures get moved into IDB on first run, then stripped from the
//     localStorage payload — so the localStorage entry stays small forever.
//   * Settings (fit/tile/brightness/contrast/blend) are stored alongside the
//     photo so they don't need a parallel migration path.
//
// Public API on window.WallStorage:
//   await init()                           — call once at boot.
//   ready()                                — Promise resolving when init done.
//   get(roomId, wallId)                    — dataUrl|null (sync).
//   getSettings(roomId, wallId)            — settings|null (sync).
//   getAllForRoom(roomId)                  — { textures, settings } (sync).
//   await setRoom(roomId, textures, settings)   — write all 4 walls for a room
//                                                  (textures may omit walls).
//   await clearRoom(roomId)                — delete all walls for a room.
//   await setDefault(textures, settings)   — app-level default wallpaper
//                                            applied when a room has no photo.
//   getDefault()                           — { textures, settings }|null.
(function () {
  "use strict";

  const DB_NAME = "apt";
  const DB_VERSION = 2;          // bumped from 1 → 2 to add wallPhotos store
  const STORE_PHOTOS = "wallPhotos";
  const STORE_CUSTOM = "customItems"; // pre-existing (custom-items.js)
  const KEY_DEFAULT = "__default__";

  // In-memory cache keyed by `${roomId}:${wallId}` → { dataUrl, settings }.
  const _cache = new Map();
  let _initPromise = null;
  let _idbAvailable = true;

  function open() {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { reject(new Error("IndexedDB unavailable")); return; }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        // Create both stores if missing — DB_VERSION bump may have happened
        // either because we're a fresh install OR because the user already
        // had v1 with only customItems.
        if (!db.objectStoreNames.contains(STORE_CUSTOM)) {
          db.createObjectStore(STORE_CUSTOM, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(STORE_PHOTOS)) {
          db.createObjectStore(STORE_PHOTOS, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  function txStore(mode) {
    return open().then(db => {
      const tx = db.transaction(STORE_PHOTOS, mode);
      return tx.objectStore(STORE_PHOTOS);
    });
  }
  function getAll() {
    return txStore("readonly").then(st => new Promise((resolve, reject) => {
      const req = st.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    }));
  }
  function putRow(row) {
    return txStore("readwrite").then(st => new Promise((resolve, reject) => {
      const req = st.put(row);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    }));
  }
  function deleteRow(key) {
    return txStore("readwrite").then(st => new Promise((resolve, reject) => {
      const req = st.delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    }));
  }

  function k(roomId, wallId) { return `${roomId}:${wallId}`; }

  // -------------------------------------------------------------------------
  // Migration: pull wallTextures + wallTextureSettings out of the legacy
  // localStorage room overrides and write them into IDB. Then remove the
  // bulky fields from localStorage so it shrinks back to safe sizes.
  // -------------------------------------------------------------------------
  async function migrateFromLocalStorage() {
    const KEY = "apt_room_overrides_v1";
    let raw;
    try { raw = localStorage.getItem(KEY); } catch { return; }
    if (!raw) return;
    let ov;
    try { ov = JSON.parse(raw); } catch { return; }
    if (!ov || typeof ov !== "object") return;
    let migratedAny = false;
    for (const roomId of Object.keys(ov)) {
      const o = ov[roomId];
      if (!o || !o.wallTextures) continue;
      const sets = o.wallTextureSettings || {};
      for (const wallId of Object.keys(o.wallTextures)) {
        const dataUrl = o.wallTextures[wallId];
        if (!dataUrl) continue;
        const settings = sets[wallId] || null;
        try {
          await putRow({ key: k(roomId, wallId), roomId, wallId, dataUrl, settings });
          _cache.set(k(roomId, wallId), { dataUrl, settings });
          migratedAny = true;
        } catch (e) {
          // IDB unavailable mid-flight; bail out gracefully.
          return;
        }
      }
      // Strip from the localStorage record (keeps its footprint small).
      delete o.wallTextures;
      delete o.wallTextureSettings;
    }
    if (migratedAny) {
      try { localStorage.setItem(KEY, JSON.stringify(ov)); } catch {}
      console.info("[WallStorage] migrated wall photos from localStorage to IndexedDB");
    }
  }

  async function init() {
    if (_initPromise) return _initPromise;
    _initPromise = (async () => {
      try {
        // Hydrate cache from IDB.
        const rows = await getAll();
        rows.forEach(r => {
          if (r && r.key && r.dataUrl) {
            _cache.set(r.key, { dataUrl: r.dataUrl, settings: r.settings || null });
          }
        });
        // Migrate any legacy localStorage entries.
        await migrateFromLocalStorage();
      } catch (e) {
        _idbAvailable = false;
        console.warn("[WallStorage] IndexedDB unavailable; falling back to in-memory only", e);
      }
    })();
    return _initPromise;
  }

  function ready() { return _initPromise || Promise.resolve(); }

  function get(roomId, wallId) {
    const row = _cache.get(k(roomId, wallId));
    return row ? row.dataUrl : null;
  }
  function getSettings(roomId, wallId) {
    const row = _cache.get(k(roomId, wallId));
    return row ? (row.settings || null) : null;
  }
  function getAllForRoom(roomId) {
    const textures = {};
    const settings = {};
    ["top", "bottom", "left", "right"].forEach(wallId => {
      const row = _cache.get(k(roomId, wallId));
      if (row && row.dataUrl) {
        textures[wallId] = row.dataUrl;
        if (row.settings) settings[wallId] = row.settings;
      }
    });
    return { textures, settings };
  }
  // Replace ALL walls for a room with the given textures/settings. Walls
  // missing from `textures` are deleted.
  async function setRoom(roomId, textures, settings) {
    textures = textures || {};
    settings = settings || {};
    const ops = [];
    for (const wallId of ["top", "bottom", "left", "right"]) {
      const key = k(roomId, wallId);
      const dataUrl = textures[wallId];
      if (dataUrl) {
        const row = { key, roomId, wallId, dataUrl, settings: settings[wallId] || null };
        _cache.set(key, { dataUrl, settings: row.settings });
        if (_idbAvailable) ops.push(putRow(row).catch(() => { _idbAvailable = false; }));
      } else if (_cache.has(key)) {
        _cache.delete(key);
        if (_idbAvailable) ops.push(deleteRow(key).catch(() => { _idbAvailable = false; }));
      }
    }
    if (ops.length) await Promise.all(ops);
    return true;
  }
  async function clearRoom(roomId) {
    return setRoom(roomId, {}, {});
  }
  // App-level default wallpaper (applied to a wall that has no per-room photo).
  // Stored as roomId="__default__".
  async function setDefault(textures, settings) {
    return setRoom(KEY_DEFAULT, textures, settings);
  }
  function getDefault() {
    return getAllForRoom(KEY_DEFAULT);
  }

  window.WallStorage = {
    init, ready, get, getSettings, getAllForRoom,
    setRoom, clearRoom, setDefault, getDefault,
  };
})();
