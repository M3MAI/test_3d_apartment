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
    color: "#7ba8d4",
    wallColor: "#c6d6ea",
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
    color: "#e4d5b7",
    wallColor: "#f0e3c9",
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
    color: "#2a6fa6",
    wallColor: "#c8dbea",
    description: "غرفة نوم بحائط أزرق بترولي مميز.",
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
    color: "#4aa5a0",
    wallColor: "#d2e9e6",
    description: "غرفة أصغر مناسبة للأطفال بلون تركواز.",
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
    color: "#8a1f3c",
    wallColor: "#e8cad3",
    description: "غرفة نوم رئيسية بحائط عنابي قوي.",
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
    color: "#d8b38a",
    wallColor: "#f2e3ce",
    description: "المطبخ — سيراميك كريمي وشباك خلفي.",
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
    color: "#6fa8a4",
    wallColor: "#dfece9",
    description: "حمام كامل بالبانيو — بلاط أخضر مميز.",
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
    color: "#c0c4cf",
    wallColor: "#e8ebf2",
    description: "توالت خدمي صغير.",
    plan: { x: 800, y: 360 },
    width: 150,
    depth: 150,
    openings: [
      { wall: "right", at: 30, size: 70, kind: "door", label: "باب" }
    ],
    allowedCategories: ["bathroom"]
  }
];
