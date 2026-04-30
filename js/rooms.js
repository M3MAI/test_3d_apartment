// Room definitions based on the apartment video analysis.
// Dimensions are in centimeters; approximate — adjust as needed.
// openings: doors and windows drawn on the room walls.
//   wall: "top" | "right" | "bottom" | "left"
//   at:   cm from the start of the wall (near origin corner)
//   size: cm width of the opening
//   kind: "door" | "window"
//
// wallColors: per-wall color overrides. Keys: "top" | "right" | "bottom" | "left".
//   Falls back to wallColor (ambient) if a wall isn't specified.
//   When wallColors is defined, accentColor/accentWall are still respected for
//   backward compat but wallColors takes priority.

// Helper: resolves the color for a given wall, respecting wallColors > accentColor > wallColor.
function resolveWallColor(room, wallId) {
  if (room.wallColors && room.wallColors[wallId]) return room.wallColors[wallId];
  if (room.accentColor && room.accentWall === wallId) return room.accentColor;
  return room.wallColor || "#eeeeee";
}

const ROOMS = [
  {
    id: "salon",
    name: "الصالون (Reception)",
    // New video (new_apartment_video.mp4 @ 00:03-00:08) — deep re-analysis from
    // 22 extracted frames:
    //   - Clean rectangular footprint (no protrusion / column).
    //   - Three light celadon-mint walls + ONE denim-blue accent wall.
    //   - The accent wall holds a wide WHITE TRIPLE-PANEL FRENCH DOOR with
    //     louvered shutters — this is the salon's main entrance, facing the
    //     foyer corridor (kitchen door is opposite across the corridor).
    //   - Tray ceiling + warm-LED cove + recessed downlights + crown molding.
    //   - Cream ceramic floor tiles.
    //   - Exactly ONE window (balcony casement) on the left wall.
    color: "#BFD6D8",
    wallColor: "#BFD6D8",
    wallColors: {
      top:    "#6892B0",        // accent wall (denim) — holds the French door (faces foyer)
      bottom: "#BFD6D8",        // mint
      left:   "#BFD6D8",        // mint (balcony side)
      right:  "#BFD6D8",        // mint
    },
    floorColor: "#E8DCC8",
    floorTexture: "tile-cream",
    ceiling: { tray: true, cove: true, coveColor: "#FFCE7A", downlights: 8, height: 270 },
    description: "صالون استقبال الضيوف — حوائط مينت/سيلادون + حائط أزرق ديم يحمل الباب الفرنسي الأبيض ثلاثي البانوهات (يقابل باب المطبخ عبر ممر المدخل)، سقف معلق ساقط بشريط LED أصفر دافئ + سبوتات مدفونة + كورنيش، شباك بلكونة وحيد على الحائط الغربي.",
    plan: { x: 0, y: 0 },
    width: 500,
    depth: 400,
    openings: [
      { wall: "top",    at: 160, size: 180, kind: "door",   label: "الباب الفرنسي (يقابل باب المطبخ)" },
      { wall: "bottom", at: 50,  size: 200, kind: "door",   label: "فتحة على المعيشة" },
      { wall: "left",   at: 150, size: 180, kind: "window", label: "شباك البلكونة" },
    ],
    allowedCategories: ["living", "common"]
  },
  {
    id: "living",
    name: "الصالة المعيشة",
    // New video (new_apartment_video.mp4 @ 00:13-00:20) — deep re-analysis:
    //   - Rectangular footprint (no column / protrusion — vertices removed).
    //   - Multiple denim-blue walls (top + left) + mint side walls.
    //   - DISTINCTIVE FEATURE: an ornate plaster CEILING ROSE (medallion) at
    //     the center of the tray drop — set ceiling.rose=true.
    //   - Tray ceiling + warm-LED cove + recessed downlights + crown molding.
    //   - One window (white double-shutter casement) on the left wall.
    //   - Cream ceramic floor tiles.
    //   - An arched opening on a corner connects to the inner corridor (frames
    //     15-16, 22) — represented as a wide wall opening on the right wall.
    color: "#BFD6D8",
    wallColor: "#BFD6D8",
    wallColors: {
      top:    "#6892B0",        // denim (faces salon — accent)
      bottom: "#BFD6D8",        // mint (back)
      left:   "#6892B0",        // denim (balcony / window side — accent)
      right:  "#BFD6D8",        // mint (corridor / arched opening side)
    },
    floorColor: "#E8DCC8",
    floorTexture: "tile-cream",
    ceiling: { tray: true, cove: true, coveColor: "#FFCE7A", downlights: 8, height: 270, rose: true },
    description: "صالة المعيشة — حوائط أزرق ديم (شمال + غرب) وحوائط مينت (جنوب + شرق)، سقف معلق ساقط بشريط LED + سبوتات + روزة جبس مزخرفة في المنتصف، شباك واحد على الحائط الغربي، فتحة مقوّسة على الممر الداخلي.",
    plan: { x: 0, y: 410 },
    width: 500,
    depth: 350,
    openings: [
      { wall: "top",    at: 50,  size: 200, kind: "door",   label: "فتحة على الصالون" },
      { wall: "right",  at: 80,  size: 110, kind: "door",   label: "فتحة مقوّسة على الممر" },
      { wall: "left",   at: 120, size: 130, kind: "window", label: "شباك" },
    ],
    allowedCategories: ["living", "common"]
  },

  {
    id: "bedroom_blue",
    name: "غرفة نوم زرقاء",
    // Photo-accurate (bedroom_blue.jpg): ONE wall vivid cerulean/teal blue,
    // three other walls clean white.
    color: "#2C7DA0",
    wallColor: "#F5F5F5",
    accentColor: "#2C7DA0",
    accentWall: "top",
    wallColors: {
      top:    "#2C7DA0",   // accent cerulean blue wall
      bottom: "#F5F5F5",
      left:   "#F5F5F5",
      right:  "#F5F5F5",
    },
    floorColor: "#e8e8e8",
    description: "غرفة نوم بحائط أزرق بترولي مميز على واحد من الجدران والباقي أبيض.",
    plan: { x: 460, y: 570 },
    width: 400,
    depth: 350,
    openings: [
      { wall: "right",  at: 100, size: 90,  kind: "door",   label: "باب" },
      { wall: "top",    at: 150, size: 130, kind: "window", label: "شباك" }
    ],
    allowedCategories: ["bedroom", "common"]
  },
  {
    id: "bedroom_teal",
    name: "غرفة أطفال (تركواز)",
    // Photo-accurate (bedroom_teal.jpg): medium turquoise/teal blue walls
    // with a window — NOT sage green. Actual teal-blue like #4A9FB5.
    color: "#4A9FB5",
    wallColor: "#4A9FB5",
    wallColors: {
      top:    "#4A9FB5",
      bottom: "#F5F5F5",
      left:   "#4A9FB5",
      right:  "#F5F5F5",
    },
    floorColor: "#e8e8e8",
    description: "غرفة أصغر مناسبة للأطفال بلون تركواز مميز.",
    plan: { x: 870, y: 620 },
    width: 350,
    depth: 300,
    openings: [
      { wall: "right",  at: 100, size: 90,  kind: "door",   label: "باب" },
      { wall: "bottom", at: 130, size: 120, kind: "window", label: "شباك" }
    ],
    allowedCategories: ["bedroom", "common"]
  },
  {
    id: "bedroom_master",
    name: "غرفة ماستر (عنابي)",
    // Photo-accurate (bedroom_burgundy.jpg): side walls are warm rose/mauve pink,
    // back wall (visible through door) is plain white. Using mauve for the
    // accent sides, white for back/front.
    color: "#C4A0A5",
    wallColor: "#F5F5F5",
    accentColor: "#C4A0A5",
    accentWall: "left",
    wallColors: {
      top:    "#F5F5F5",
      bottom: "#F5F5F5",
      left:   "#C4A0A5",   // rose/mauve side wall
      right:  "#C4A0A5",   // rose/mauve side wall
    },
    floorColor: "#e8dfd0",
    description: "غرفة نوم رئيسية بجدران وردية دافئة (موف) والباقي أبيض.",
    plan: { x: 0, y: 570 },
    width: 450,
    depth: 350,
    openings: [
      { wall: "right", at: 120, size: 90,  kind: "door",   label: "باب" },
      { wall: "left",  at: 160, size: 130, kind: "window", label: "شباك" }
    ],
    allowedCategories: ["bedroom", "common"]
  },
  {
    id: "kitchen",
    name: "المطبخ",
    // Photo-accurate (kitchen.jpg): light sky blue walls matching the hallway,
    // with a green tile dado band on one wall.
    color: "#A8C4DE",
    wallColor: "#A8C4DE",
    accentColor: "#2E7D52",
    accentWall: "bottom",
    wallColors: {
      top:    "#A8C4DE",
      bottom: "#2E7D52",   // green dado tile wall
      left:   "#A8C4DE",
      right:  "#A8C4DE",
    },
    floorColor: "#ece3d2",
    description: "المطبخ — جدران سماوي فاتح وشريط بلاط أخضر.",
    plan: { x: 970, y: 0 },
    width: 300,
    depth: 250,
    openings: [
      { wall: "right", at: 80,  size: 85,  kind: "door",   label: "باب" },
      { wall: "top",   at: 120, size: 100, kind: "window", label: "شباك" }
    ],
    allowedCategories: ["kitchen", "common"]
  },
  {
    id: "bathroom_main",
    name: "الحمام الرئيسي",
    // Photo-accurate (salon_blue.jpg / bathroom_main.jpg): white/cream tiled walls
    // with a GREEN tile band on one wall around the bathtub.
    color: "#2E7D52",
    wallColor: "#F0EDE8",
    accentColor: "#2E7D52",
    accentWall: "left",
    wallColors: {
      top:    "#F0EDE8",
      bottom: "#F0EDE8",
      left:   "#2E7D52",   // green tile accent wall
      right:  "#F0EDE8",
    },
    floorColor: "#e8e8e8",
    description: "حمام كامل بالبانيو — جدران بيضاء وبلاط أخضر مميز حول البانيو.",
    plan: { x: 510, y: 360 },
    width: 250,
    depth: 200,
    openings: [
      { wall: "right", at: 60, size: 75, kind: "door",   label: "باب" },
      { wall: "top",   at: 80, size: 60, kind: "window", label: "شباك" }
    ],
    allowedCategories: ["bathroom", "common"]
  },
  {
    id: "wc",
    name: "توالت صغير",
    // Photo-accurate (wc_small.jpg): very pale lavender/white walls.
    color: "#D5D0DB",
    wallColor: "#E8E4F0",
    wallColors: {
      top:    "#E8E4F0",
      bottom: "#E8E4F0",
      left:   "#E8E4F0",
      right:  "#E8E4F0",
    },
    floorColor: "#e8e8e8",
    description: "توالت خدمي صغير ببلاط أبيض مائل للافندر.",
    plan: { x: 800, y: 360 },
    width: 150,
    depth: 150,
    openings: [
      { wall: "right", at: 30, size: 70, kind: "door", label: "باب" }
    ],
    allowedCategories: ["bathroom"]
  }
];
