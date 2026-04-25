// Room definitions based on the apartment video analysis.
// Dimensions are in centimeters; approximate — adjust as needed.
// openings: doors and windows drawn on the room walls.
//   wall: "top" | "right" | "bottom" | "left"
//   at:   cm from the start of the wall (near origin corner)
//   size: cm width of the opening
//   kind: "door" | "window"

const ROOMS = [
  {
    id: "salon",
    name: "الصالون (Reception)",
    // Video-accurate: all four walls are a soft powder / dusty blue (frames 8-11).
    // `color` = the swatch shown in the room picker + 2D stage fill. `wallColor`
    // = ambient wall tone used in 3D walls. `accentColor` = optional feature wall.
    color: "#b7ccde",
    wallColor: "#b7ccde",
    floorColor: "#e6ddcf",
    description: "الغرفة الفاخرة بسقف معلق وإضاءة LED مدفونة. تستخدم لاستقبال الضيوف.",
    plan: { x: 0, y: 0 },
    width: 500,
    depth: 400,
    openings: [
      { wall: "top",    at: 200, size: 90, kind: "door",   label: "باب" },
      { wall: "bottom", at: 180, size: 140, kind: "window", label: "شباك" },
      { wall: "right",  at: 150, size: 120, kind: "window", label: "شباك" }
    ],
    allowedCategories: ["living", "common"]
  },
  {
    id: "living",
    name: "الصالة المعيشة",
    // Not distinctly colored in the video — plain cream/off-white, like the hallway.
    color: "#ede4d4",
    wallColor: "#ede4d4",
    floorColor: "#e6ddcf",
    description: "غرفة المعيشة اليومية والتلفزيون.",
    plan: { x: 510, y: 0 },
    width: 450,
    depth: 350,
    openings: [
      { wall: "top",    at: 200, size: 90,  kind: "door",   label: "باب" },
      { wall: "bottom", at: 150, size: 160, kind: "window", label: "شباك" }
    ],
    allowedCategories: ["living", "common"]
  },
  {
    id: "bedroom_blue",
    name: "غرفة نوم زرقاء",
    // Video-accurate: deep teal-blue ACCENT wall (frame 14 right crop #06365a),
    // three other walls are plain white. Use the accent for the room swatch so
    // it's easy to recognise, and a white for the ambient wallColor.
    color: "#1f5b82",
    wallColor: "#f2f2f2",
    accentColor: "#1f5b82",
    accentWall: "top",
    floorColor: "#e6ddcf",
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
    // Video-accurate: sage / dusty-green walls (frame 30). Softer than true teal.
    color: "#8fa88a",
    wallColor: "#d6e0d4",
    floorColor: "#e6ddcf",
    description: "غرفة أصغر مناسبة للأطفال بلون بساجي/تركواز فاتح.",
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
    // Video-accurate: deep BURGUNDY/MAROON accent wall (frame 29 #72062a),
    // rest of the room is plain white.
    color: "#6e1d36",
    wallColor: "#f2f2f2",
    accentColor: "#6e1d36",
    accentWall: "top",
    floorColor: "#d9a0a8",
    description: "غرفة نوم رئيسية بحائط عنابي قوي على حائط واحد والباقي أبيض، وأرضية سجاد عنابي.",
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
    // Video-accurate: cream/beige sandstone walls with a dark-olive-green
    // dado tile strip at the bottom (frame 7).
    color: "#d6b891",
    wallColor: "#e8d6bc",
    accentColor: "#4d7e5e",
    accentWall: "bottom",
    floorColor: "#ece3d2",
    description: "المطبخ — سيراميك كريمي وشريط بلاط أخضر زيتي أسفل الحائط.",
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
    // Video-accurate: pale gray-blue walls (frame 31) with a GREEN feature
    // tile band around the bathtub / sink wall (frame 7 dado).
    color: "#4d7e5e",
    wallColor: "#dfe4e6",
    accentColor: "#4d7e5e",
    accentWall: "left",
    floorColor: "#ebecee",
    description: "حمام كامل بالبانيو — جدران رمادية-زرقاء فاتحة وبلاط أخضر مميز حول البانيو.",
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
    // Video-accurate: plain white/very-light-gray tiled walls (frames 34-35).
    color: "#d8dbe0",
    wallColor: "#eff1f5",
    floorColor: "#ebecee",
    description: "توالت خدمي صغير ببلاط أبيض.",
    plan: { x: 800, y: 360 },
    width: 150,
    depth: 150,
    openings: [
      { wall: "right", at: 30, size: 70, kind: "door", label: "باب" }
    ],
    allowedCategories: ["bathroom"]
  }
];
