// Furniture catalog. Dimensions are in centimeters (top-down footprint).
// category: living | bedroom | kitchen | bathroom | common
// w = width (along the x axis when rotation = 0)
// h = depth (along the y axis when rotation = 0)

const FURNITURE_GROUPS = [
  {
    id: "living",
    label: "صالون ومعيشة",
    items: [
      { id: "sofa3",      name: "كنبة 3 مقاعد",   icon: "🛋️", w: 220, h: 90,  color: "#6e81a8" },
      { id: "sofa2",      name: "كنبة 2 مقعد",    icon: "🛋️", w: 160, h: 90,  color: "#7a8fb8" },
      { id: "sofa_l",     name: "ركنة L",          icon: "🛋️", w: 280, h: 180, color: "#556e99" },
      { id: "armchair",   name: "فوتيه",           icon: "💺", w: 90,  h: 90,  color: "#8a99b8" },
      { id: "coffee",     name: "ترابيزة قهوة",    icon: "🫖", w: 110, h: 60,  color: "#a8844a" },
      { id: "tv_unit",    name: "وحدة تلفزيون",    icon: "📺", w: 180, h: 45,  color: "#4a4a4a" },
      { id: "tv",         name: "شاشة تلفزيون",    icon: "📺", w: 130, h: 12,  color: "#222" },
      { id: "bookshelf",  name: "مكتبة",           icon: "📚", w: 140, h: 35,  color: "#7a5a3a" },
      { id: "dine_tbl",   name: "طاولة سفرة",      icon: "🍽️", w: 160, h: 90,  color: "#a8844a" },
      { id: "dine_chair", name: "كرسي سفرة",       icon: "🪑", w: 45,  h: 45,  color: "#7a5a3a" },
      { id: "rug",        name: "سجادة",           icon: "🟫", w: 240, h: 160, color: "#b08868", opacity: .5 },
      { id: "plant",      name: "نبات",            icon: "🪴", w: 40,  h: 40,  color: "#4a8a3a" }
    ]
  },
  {
    id: "bedroom",
    label: "غرف النوم",
    items: [
      { id: "bed_single", name: "سرير مفرد",       icon: "🛏️", w: 100, h: 200, color: "#9ca8c4" },
      { id: "bed_double", name: "سرير دوبل",       icon: "🛏️", w: 160, h: 200, color: "#7e8fb8" },
      { id: "bed_king",   name: "سرير كينج",       icon: "🛏️", w: 200, h: 200, color: "#6e81a8" },
      { id: "nightstand", name: "كومودينو",        icon: "🗄️", w: 50,  h: 45,  color: "#8a6a4a" },
      { id: "wardrobe",   name: "دولاب",           icon: "🚪", w: 200, h: 60,  color: "#7a5a3a" },
      { id: "dresser",    name: "تسريحة",          icon: "💄", w: 120, h: 45,  color: "#a8844a" },
      { id: "desk",       name: "مكتب دراسة",      icon: "✏️", w: 120, h: 60,  color: "#8a6a4a" },
      { id: "chair",      name: "كرسي",            icon: "🪑", w: 45,  h: 45,  color: "#7a5a3a" },
      { id: "tv",         name: "شاشة تلفزيون",    icon: "📺", w: 110, h: 12,  color: "#222" }
    ]
  },
  {
    id: "kitchen",
    label: "المطبخ",
    items: [
      { id: "fridge",     name: "ثلاجة",           icon: "🧊", w: 70,  h: 70,  color: "#d0d6e0" },
      { id: "stove",      name: "بوتاجاز",         icon: "🍳", w: 60,  h: 60,  color: "#3a3a3a" },
      { id: "sink",       name: "حوض مطبخ",        icon: "🚰", w: 80,  h: 60,  color: "#a8b4c0" },
      { id: "counter",    name: "رخامة مطبخ",      icon: "🧱", w: 120, h: 60,  color: "#c8b898" },
      { id: "cabinet",    name: "وحدة علوية",      icon: "🗄️", w: 100, h: 30,  color: "#8a6a4a" },
      { id: "microwave",  name: "ميكروويف",        icon: "🍲", w: 55,  h: 40,  color: "#444" },
      { id: "dine_tbl",   name: "طاولة طعام",      icon: "🍽️", w: 100, h: 70,  color: "#a8844a" },
      { id: "dine_chair", name: "كرسي طعام",       icon: "🪑", w: 45,  h: 45,  color: "#7a5a3a" }
    ]
  },
  {
    id: "bathroom",
    label: "الحمامات",
    items: [
      { id: "bathtub",    name: "بانيو",           icon: "🛁", w: 170, h: 75,  color: "#a8c4d4" },
      { id: "toilet",     name: "كرسي حمام",       icon: "🚽", w: 40,  h: 65,  color: "#e6ecf2" },
      { id: "bath_sink",  name: "حوض",             icon: "🚿", w: 60,  h: 45,  color: "#b8c4d0" },
      { id: "shower",     name: "كابينة شاور",     icon: "🚿", w: 90,  h: 90,  color: "#9ab4c8" },
      { id: "washer",     name: "غسالة",           icon: "🧺", w: 60,  h: 60,  color: "#d0d6e0" },
      { id: "heater",     name: "سخان",            icon: "♨️", w: 50,  h: 25,  color: "#b8b8b8" }
    ]
  },
  {
    id: "common",
    label: "عام",
    items: [
      { id: "lamp",       name: "إضاءة أرضية",     icon: "💡", w: 30,  h: 30,  color: "#e8c06a" },
      { id: "ac",         name: "تكييف سبليت",     icon: "❄️", w: 90,  h: 20,  color: "#ddd" },
      { id: "curtain",    name: "ستارة",           icon: "🪟", w: 140, h: 15,  color: "#c8b8a0", opacity: .7 },
      { id: "door_mat",   name: "سجادة مدخل",      icon: "🟫", w: 80,  h: 40,  color: "#a88868", opacity: .5 }
    ]
  }
];
