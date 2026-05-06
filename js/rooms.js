// Room definitions based on the apartment video analysis.
// Dimensions are in centimeters; approximate — adjust as needed.
// openings: doors and windows drawn on the room walls.
//   wall: "top" | "right" | "bottom" | "left"
//   at:   cm from the start of the wall (near origin corner)
//   size: cm width of the opening
//   kind: "door" | "window"
//   arched: true → segmental-arch top on a door opening (living room only)
//
// wallColors: per-wall color overrides. Keys: "top" | "right" | "bottom" | "left".
//   Falls back to wallColor (ambient) if a wall isn't specified.
//   When wallColors is defined, accentColor/accentWall are still respected for
//   backward compat but wallColors takes priority.
//
// ceiling: { tray, cove, coveColor, downlights, rose }
//   tray:       true → drop tray ceiling + 4 white side strips
//   cove:       true → warm-amber LED cove strip around tray perimeter
//   coveColor:  hex string for the LED glow (default #FFCE7A warm amber)
//   downlights: number of recessed spots inside the tray (0 = none)
//   rose:       true → ornate plaster ceiling rose medallion at centre
//
// SOURCE: apartment_video.mp4 (72 s, 848×480) + new_apartment_video.mp4 (21 s, 1080×1920)
// All claims cross-referenced against docs/AUDIT_FRAMES/ (94 extracted frames).
// See docs/ANALYSIS_v2.md and docs/AUDIT_REPORT.md for full audit trail.

// Helper: resolves the color for a given wall, respecting wallColors > accentColor > wallColor.
function resolveWallColor(room, wallId) {
  if (room.wallColors && room.wallColors[wallId]) return room.wallColors[wallId];
  if (room.accentColor && room.accentWall === wallId) return room.accentColor;
  return room.wallColor || "#eeeeee";
}

// ---------------------------------------------------------------------------
// PLAN COORDINATE SYSTEM (all values in cm)
//
//   Salon       : x=0,    y=0      (500×400)
//   Living      : x=0,    y=410    (500×350)
//   Corridor    : x=510,  y=0      (150×760)  ← new: links entry→salon→living→bedrooms
//   Kitchen     : x=670,  y=0      (300×250)
//   Master BR   : x=0,    y=770    (450×350)
//   Bathroom M  : x=510,  y=410    (250×200)
//   WC          : x=510,  y=620    (150×150)
//   Bedroom Blue: x=670,  y=410    (400×350)
//   Bedroom Teal: x=670,  y=770    (350×300)
//
//  y↓  (depth grows downward in the plan view)
//  x→
// ---------------------------------------------------------------------------

const ROOMS = [

  // ── 1. CORRIDOR / FOYER (الممر والمدخل) ─────────────────────────────────
  // new/t_001.png: Dark wood ornate entry door; mint corridor walls; narrow
  // tray ceiling running the full length; ~5 white recessed downlights;
  // continuous cream tile floor.
  // new/t_022.png: inner end of corridor — dark-wood bedroom doors on right,
  // arched opening from living room visible at left.
  {
    id: "corridor",
    name: "الممر والمدخل",
    color: "#BFD6D8",
    wallColor: "#BFD6D8",        // same celadon mint as the public rooms
    wallColors: {
      top:    "#BFD6D8",
      bottom: "#BFD6D8",
      left:   "#BFD6D8",
      right:  "#BFD6D8",
    },
    floorColor: "#E8DCC8",
    floorTexture: "tile-cream",
    // Narrow tray running the corridor length: 5 downlights, no cove LED,
    // no rose. Crown molding continues from salon/living.
    ceiling: { tray: true, cove: false, downlights: 5, height: 270 },
    description: "الممر الرئيسي للشقة — جدران مينت سيلادون، سقف معلق ضيق بـ 5 سبوتات مدفونة، بلاط كريم متواصل من الصالون حتى الغرف. الباب الرئيسي: خشب داكن مع زخارف حديدية.",
    plan: { x: 510, y: 0 },
    width: 150,
    depth: 760,
    openings: [
      // Entry (apartment front door) — top wall, centred
      { wall: "top",    at: 25,  size: 100, kind: "door",   label: "الباب الرئيسي" },
      // Salon French door opens into corridor — left wall
      { wall: "left",   at: 160, size: 180, kind: "door",   label: "باب الصالون (فرنسي)" },
      // Kitchen door — right wall, facing the salon door
      { wall: "right",  at: 60,  size: 85,  kind: "door",   label: "باب المطبخ" },
      // Passage to living room via arched opening — left wall, lower
      { wall: "left",   at: 490, size: 110, kind: "door",   arched: true, label: "فتحة مقوّسة للمعيشة" },
      // Bedroom corridor continues downward — bottom wall (open pass-through)
      { wall: "bottom", at: 20,  size: 110, kind: "door",   label: "ممر الغرف" },
    ],
    allowedCategories: ["common"],
  },

  // ── 2. SALON / RECEPTION (الصالون) ───────────────────────────────────────
  // new/t_003–t_008: Clean rectangular footprint; three mint walls + ONE
  // denim-blue accent wall (top/north) holding the white triple-panel French
  // door. Tray + warm amber cove + 8 downlights + crown molding. No rose.
  // new/t_006: French door clearly a 3-panel white door with horizontal
  // louvered glass panels and brass handle.
  // Balcony window: left/west wall @150 cm, 180 cm wide (white louvered).
  {
    id: "salon",
    name: "الصالون (Reception)",
    color: "#BFD6D8",
    wallColor: "#BFD6D8",
    wallColors: {
      top:    "#BFD6D8",   // mint (exterior north wall)
      bottom: "#BFD6D8",   // mint (passage to living)
      left:   "#BFD6D8",   // mint (balcony / window side)
      right:  "#6892B0",   // denim-blue accent — holds the French door (faces corridor)
    },
    floorColor: "#E8DCC8",
    floorTexture: "tile-cream",
    ceiling: { tray: true, cove: true, coveColor: "#FFCE7A", downlights: 8, height: 270 },
    description: "صالون استقبال الضيوف — حائط أزرق ديم يحمل الباب الفرنسي الأبيض الثلاثي البانوهات (يقابل باب المطبخ عبر الممر)، 3 حوائط مينت، سقف ساقط + شريط LED أصفر دافئ + 8 سبوتات + كورنيش، شباك بلكونة على الحائط الغربي.",
    plan: { x: 0, y: 0 },
    width: 500,
    depth: 400,
    openings: [
      // French door on the denim accent wall (right) — faces the corridor.
      // Corridor left@160 aligns with salon right@160.
      { wall: "right",  at: 160, size: 180, kind: "door",   label: "الباب الفرنسي (3 بانوهات — يقابل باب المطبخ)" },
      // Wide passage opening to the living room (south/bottom wall)
      { wall: "bottom", at: 50,  size: 200, kind: "door",   label: "فتحة على المعيشة" },
      // Balcony casement window — west (left) wall, exterior.
      // Centred on the 400 cm wall: (400 - 120) / 2 = 140 cm from corner.
      { wall: "left",   at: 140, size: 120, kind: "window", label: "شباك البلكونة (أبيض — زجاج بلوزي)" },
    ],
    allowedCategories: ["living", "common"],
  },

  // ── 3. LIVING ROOM (الصالة المعيشة) ──────────────────────────────────────
  // new/t_013: Large ornate plaster ceiling rose at centre — the room's
  // signature feature. Tray ceiling + warm amber cove + downlights.
  // new/t_015: Segmental-arch opening (denim wall, right side) to corridor.
  // new/t_019: Double-panel white louvered window on denim left wall,
  // visually centred on the wall (adjusted to 185 cm from corner).
  // Two denim walls (top + left); two mint walls (bottom + right).
  {
    id: "living",
    name: "الصالة المعيشة",
    color: "#BFD6D8",
    wallColor: "#BFD6D8",
    wallColors: {
      top:    "#6892B0",   // denim (faces salon — shared opening)
      bottom: "#BFD6D8",   // mint (back wall)
      left:   "#6892B0",   // denim (window side — balcony direction)
      right:  "#BFD6D8",   // mint (corridor side — arched opening)
    },
    floorColor: "#E8DCC8",
    floorTexture: "tile-cream",
    // rose: true → the large ornate plaster medallion clearly visible in new/t_013 & t_019
    ceiling: { tray: true, cove: true, coveColor: "#FFCE7A", downlights: 8, height: 270, rose: true },
    description: "صالة المعيشة — حوائط ديم زرقاء (شمال + غرب) + مينت (جنوب + شرق)، سقف ساقط + LED + 8 سبوتات + روزة جبس مزخرفة في المنتصف، شباك مزدوج مغزلي على الحائط الغربي، فتحة مقوّسة بإطار أبيض على الممر.",
    plan: { x: 0, y: 410 },
    width: 500,
    depth: 350,
    openings: [
      // Wide passage from salon (top wall)
      { wall: "top",   at: 50,  size: 200, kind: "door",   label: "فتحة على الصالون" },
      // Segmental-arch opening to corridor (right/east wall).
      // arched:true triggers the quadratic-bezier arch in _addOpeningHole().
      // Position: 80 cm from the south corner; width 110 cm.
      { wall: "right", at: 80,  size: 110, kind: "door",   arched: true, label: "فتحة مقوّسة على الممر — قوس جبسي أبيض" },
      // Double-panel louvered window on denim left wall.
      // Adjusted to appear centred: (500 - 130) / 2 ≈ 185 cm from corner.
      { wall: "left",  at: 185, size: 130, kind: "window", label: "شباك مزدوج (مغزلي أبيض — وسط الحائط الديم)" },
    ],
    allowedCategories: ["living", "common"],
  },

  // ── 4. MASTER BEDROOM (غرفة ماستر — عنابي/موف) ────────────────────────────
  // old/t_045: White walls with a pinkish-mauve tint on the right edge.
  // old/t_050–055: White walls (temporary red carpet covering the cream tile floor).
  // Side walls (left + right) are warm rose/mauve; front/back are plain white.
  // Flat ceiling — no tray, no cove. (Unverified whether a rose exists.)
  {
    id: "bedroom_master",
    name: "غرفة ماستر (عنابي)",
    color: "#C4A0A5",
    wallColor: "#F5F5F5",
    accentColor: "#C4A0A5",
    accentWall: "left",
    wallColors: {
      top:    "#F5F5F5",
      bottom: "#F5F5F5",
      left:   "#C4A0A5",   // rose/mauve accent side
      right:  "#C4A0A5",   // rose/mauve accent side
    },
    floorColor: "#E8DCC8",
    floorTexture: "tile-cream",
    // No tray/cove confirmed. Ceiling rose unverified (old video sideways).
    description: "غرفة النوم الرئيسية — حائطا الجانبين وردي موف دافئ، الحائطان الأمامي والخلفي أبيض. البلاط كريم رخامي (السجادة الحمراء في الفيديو مؤقتة للمناسبة فقط).",
    plan: { x: 0, y: 770 },
    width: 450,
    depth: 350,
    openings: [
      // Door on top wall → faces corridor end (corridor bottom at y=760, master top at y=770)
      { wall: "top",   at: 180, size: 90,  kind: "door",   label: "باب خشب داكن" },
      // Window on left wall → exterior west (balcony side)
      { wall: "left",  at: 160, size: 130, kind: "window", label: "شباك أبيض بمغازل" },
    ],
    allowedCategories: ["bedroom", "common"],
  },

  // ── 5. BEDROOM — BLUE (غرفة نوم زرقاء) ─────────────────────────────────
  // old/t_030: Deep cerulean/teal accent wall (top), white walls, plaster
  // ceiling rose visible — this is the DEFINITIVE frame for this room.
  // old/t_035: Same cerulean wall + white-framed louvered window + pipe stub.
  // Ceiling: flat with ornate plaster rose (no tray, no cove).
  // Floor: same cream tile as rest of apartment (NOT grey).
  {
    id: "bedroom_blue",
    name: "غرفة نوم زرقاء",
    color: "#2C7DA0",
    wallColor: "#F5F5F5",
    accentColor: "#2C7DA0",
    accentWall: "right",
    wallColors: {
      top:    "#F5F5F5",
      bottom: "#F5F5F5",
      left:   "#F5F5F5",
      right:  "#2C7DA0",   // deep cerulean accent — holds the window (exterior east wall)
    },
    floorColor: "#E8DCC8",
    floorTexture: "tile-cream",
    // Rose clearly visible in old/t_030 and old/t_035. No tray / no cove.
    ceiling: { rose: true },
    description: "غرفة نوم بحائط بترولي زرقاء مميز (أعمق تشبعاً من الديم في الصالون) + 3 جدران بيضاء. روزة سقف جبسية واضحة في الفيديو. بلاط كريم رخامي متواصل.",
    plan: { x: 670, y: 410 },
    width: 400,
    depth: 350,
    openings: [
      // Door on left wall → faces corridor (corridor right at x=660, bedroom left at x=670)
      { wall: "left",  at: 100, size: 90,  kind: "door",   label: "باب خشب داكن" },
      // Window on right wall → exterior east (outside)
      { wall: "right", at: 150, size: 130, kind: "window", label: "شباك (مغزلي أبيض)" },
    ],
    allowedCategories: ["bedroom", "common"],
  },

  // ── 6. BEDROOM — TEAL (غرفة أطفال تركواز) ────────────────────────────────
  // LOW CONFIDENCE: no frame unambiguously shows a teal wall. Color scheme
  // retained from prior analysis (Phase 0 + ANALYSIS.md). Floor corrected to
  // cream tile (same as rest of apartment).
  {
    id: "bedroom_teal",
    name: "غرفة أطفال (تركواز)",
    color: "#4A9FB5",
    wallColor: "#4A9FB5",
    wallColors: {
      top:    "#4A9FB5",
      bottom: "#F5F5F5",
      left:   "#4A9FB5",
      right:  "#F5F5F5",
    },
    floorColor: "#E8DCC8",
    floorTexture: "tile-cream",
    description: "غرفة صغيرة مناسبة للأطفال بلون تركواز مميز على حائطين (ثقة منخفضة — لا إطار واضح من الفيديو). بلاط كريم متواصل.",
    plan: { x: 670, y: 770 },
    width: 350,
    depth: 300,
    openings: [
      // Door on left wall → faces corridor
      { wall: "left",   at: 100, size: 90,  kind: "door",   label: "باب خشب داكن" },
      // Window on bottom wall → exterior south (outside)
      { wall: "bottom", at: 130, size: 120, kind: "window", label: "شباك" },
    ],
    allowedCategories: ["bedroom", "common"],
  },

  // ── 7. KITCHEN (المطبخ) ───────────────────────────────────────────────────
  // new/t_010: Dark wood kitchen door on the right wall of the corridor.
  // new/t_011: Peek inside — dark wooden upper cabinets, small high window,
  // cream tile floor. Walls: sky-blue paint (LOW confidence for the green dado).
  // Kitchen door faces the salon's French door across the corridor.
  {
    id: "kitchen",
    name: "المطبخ",
    color: "#A8C4DE",
    wallColor: "#A8C4DE",
    accentColor: "#2E7D52",
    accentWall: "bottom",
    wallColors: {
      top:    "#A8C4DE",
      bottom: "#2E7D52",   // green tile dado (unverified — plausible from prior analysis)
      left:   "#A8C4DE",
      right:  "#A8C4DE",
    },
    floorColor: "#E8DCC8",
    floorTexture: "tile-cream",
    description: "المطبخ — جدران سماوي فاتح + شريط بلاط أخضر (غير مؤكد). خزائن خشب داكن. باب خشب داكن يواجه الباب الفرنسي للصالون عبر الممر.",
    plan: { x: 670, y: 0 },
    width: 300,
    depth: 250,
    openings: [
      // Door faces the corridor (left wall when placed at x=670)
      { wall: "left",  at: 80,  size: 85,  kind: "door",   label: "باب المطبخ (خشب داكن — يواجه الصالون)" },
      { wall: "top",   at: 120, size: 100, kind: "window", label: "شباك صغير عالٍ" },
    ],
    allowedCategories: ["kitchen", "common"],
  },

  // ── 8. MAIN BATHROOM (الحمام الرئيسي) ────────────────────────────────────
  // old/t_065: Grey-blue mosaic floor tile (distinct from cream apartment tile).
  // old/t_070: Cream/grey-beige wall tiles uniformly on all walls — NO green
  // dado observed in any frame. The previous green accent is removed.
  // Fixtures: wall-mounted sink, toilet, shower stub.
  {
    id: "bathroom_main",
    name: "الحمام الرئيسي",
    // color swatch = the neutral cream tile seen on all 4 walls
    color: "#D8D0C4",
    wallColor: "#F0EDE8",
    wallColors: {
      top:    "#F0EDE8",   // cream/beige wall tile — uniform on all 4 walls
      bottom: "#F0EDE8",   // (the green accent was NOT observed in any video frame)
      left:   "#F0EDE8",
      right:  "#F0EDE8",
    },
    // Floor: grey-blue mosaic tile (old/t_065) — distinct from apartment's cream tile.
    floorColor: "#C8CBD0",
    description: "حمام كامل — بلاط جداري كريم/رمادي بيج متجانس على 4 حوائط (لا يوجد بلاط أخضر في أي إطار من الفيديو)، بلاط أرضية رمادي أزرق فسيفساء، دش + مرحاض + حوض.",
    plan: { x: 510, y: 410 },
    width: 250,
    depth: 200,
    openings: [
      // Door on left wall → faces corridor
      { wall: "left",  at: 60, size: 75, kind: "door",   label: "باب" },
      // Window on right wall → exterior / ventilation
      { wall: "right", at: 80, size: 60, kind: "window", label: "شباك صغير" },
    ],
    allowedCategories: ["bathroom", "common"],
  },

  // ── 9. SMALL WC (توالت صغير) ─────────────────────────────────────────────
  // LOW CONFIDENCE — not separately identifiable in any video frame.
  // Pale lavender/white walls retained from prior analysis.
  {
    id: "wc",
    name: "توالت صغير",
    color: "#D5D0DB",
    wallColor: "#E8E4F0",
    wallColors: {
      top:    "#E8E4F0",
      bottom: "#E8E4F0",
      left:   "#E8E4F0",
      right:  "#E8E4F0",
    },
    floorColor: "#e8e8e8",
    description: "توالت خدمي صغير — بلاط أبيض مائل للافندر (ثقة منخفضة، لا إطار مستقل من الفيديو).",
    plan: { x: 510, y: 620 },
    width: 150,
    depth: 150,
    openings: [
      // Door on left wall → faces corridor
      { wall: "left", at: 30, size: 70, kind: "door", label: "باب" },
    ],
    allowedCategories: ["bathroom"],
  },
];
