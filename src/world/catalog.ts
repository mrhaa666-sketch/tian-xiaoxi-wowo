// 房间、地板、墙纸、家具和食物的定义。之后换正式素材时，给定义加上图片字段即可。
import type { Needs, Pose } from "../core/types";

export interface FloorDef {
  id: string;
  name: string;
  color: number;
  line: number;
}

export const FLOORS: FloorDef[] = [
  { id: "wood", name: "木地板", color: 0xd9b38c, line: 0xbf9670 },
  { id: "tile", name: "白瓷砖", color: 0xe8ecef, line: 0xc4ccd4 },
  { id: "carpet", name: "粉地毯", color: 0xf2c4cf, line: 0xe2a9b7 },
  { id: "mint", name: "薄荷地板", color: 0xbfe3d4, line: 0x9fcdb9 },
  { id: "grass", name: "草地", color: 0x9fd18b, line: 0x86bf70 },
];

export const WALL_STYLES: { id: string; name: string; color: number; top: number }[] = [
  { id: "cream", name: "米白墙", color: 0xf3ead8, top: 0xfaf5ea },
  { id: "sky", name: "天蓝墙", color: 0xcfe3f2, top: 0xe6f1fa },
  { id: "peach", name: "蜜桃墙", color: 0xf6d3c4, top: 0xfbe7de },
  { id: "sage", name: "鼠尾草墙", color: 0xd3e2cf, top: 0xe8f0e5 },
  { id: "lilac", name: "淡紫墙", color: 0xe3dcf0, top: 0xf0ecf7 },
];

export interface InteractionDef {
  id: string;
  name: string;       // 给玩家和 AI 看的名字
  pose: Pose;
  onTop?: boolean;    // 角色坐到/躺到家具上（躺下时角色隐藏，由家具画出「有人」的样子）
  minutes: [number, number]; // AI 可选的持续时长范围（游戏分钟）
  perMinute: Partial<Needs>; // 每分钟对需求的影响
  turnsOn?: boolean;  // 使用时家具切换为「开」
  news?: boolean;     // 使用时可以看到新闻
  tags?: string[];
}

// 家具是「立牌」：一张正面的图，立在房间里某个 (x, z) 位置，按透视缩放。
export interface FurnitureDef {
  id: string;
  name: string;
  w: number;      // 宽度（格）
  d: number;      // 立牌底座的纵深，用来决定角色站在前面还是后面
  h: number;      // 高度（像素，按最靠前的大小）
  color: number;
  top?: number;
  zone: "wall" | "floor" | "any"; // 建议摆放的位置，只用于默认摆放
  category: "卧室" | "客厅" | "厨房" | "书房" | "卫浴" | "装饰";
  interactions: InteractionDef[];
  icon: string;   // 占位图上显示的字
}

const I = (d: InteractionDef) => d;

export const FURNITURE: FurnitureDef[] = [
  {
    id: "bed", name: "单人床", w: 0.42, d: 0.42, h: 50, color: 0x9bb7e0, top: 0xffffff, zone: "wall", category: "卧室", icon: "",
    interactions: [
      I({ id: "sleep", name: "睡觉", pose: "lie", onTop: true, minutes: [30, 480], perMinute: { energy: 0.35, health: 0.08 }, tags: ["rest"] }),
      I({ id: "nap", name: "小睡", pose: "lie", onTop: true, minutes: [10, 40], perMinute: { energy: 0.3, mood: 0.05 }, tags: ["rest"] }),
      I({ id: "rest", name: "躺着养病", pose: "lie", onTop: true, minutes: [20, 240], perMinute: { energy: 0.2, health: 0.25 }, tags: ["rest", "sick"] }),
    ],
  },
  {
    id: "wardrobe", name: "衣柜", w: 0.22, d: 0.16, h: 175, color: 0xb98b62, zone: "wall", category: "卧室", icon: "衣柜",
    interactions: [I({ id: "change", name: "换衣服", pose: "use", minutes: [2, 5], perMinute: { mood: 0.6, hygiene: 0.5 } })],
  },
  {
    id: "lamp", name: "落地灯", w: 0.08, d: 0.08, h: 140, color: 0xf2d27a, zone: "any", category: "卧室", icon: "",
    interactions: [I({ id: "toggle", name: "开关灯", pose: "use", minutes: [1, 1], perMinute: {} })],
  },
  {
    id: "sofa", name: "沙发", w: 0.45, d: 0.22, h: 70, color: 0xe58f8f, zone: "any", category: "客厅", icon: "",
    interactions: [
      I({ id: "sit", name: "坐着发呆", pose: "sit", onTop: true, minutes: [5, 40], perMinute: { energy: 0.08, mood: 0.05 } }),
      I({ id: "nap", name: "在沙发上打盹", pose: "lie", onTop: true, minutes: [10, 40], perMinute: { energy: 0.22 }, tags: ["rest"] }),
    ],
  },
  {
    id: "tv", name: "电视", w: 0.3, d: 0.12, h: 110, color: 0x8a6a50, zone: "wall", category: "客厅", icon: "",
    interactions: [
      I({ id: "watch", name: "看电视", pose: "stand", minutes: [10, 60], perMinute: { mood: 0.25, energy: -0.03 }, turnsOn: true }),
      I({ id: "news", name: "看新闻", pose: "stand", minutes: [5, 20], perMinute: { mood: 0.05 }, turnsOn: true, news: true }),
    ],
  },
  {
    id: "rug", name: "地毯", w: 0.5, d: 0.35, h: 2, color: 0xc9b6e4, zone: "floor", category: "装饰", icon: "",
    interactions: [],
  },
  {
    id: "plant", name: "盆栽", w: 0.1, d: 0.1, h: 70, color: 0xc77c4e, zone: "any", category: "装饰", icon: "",
    interactions: [I({ id: "water", name: "浇花", pose: "use", minutes: [1, 3], perMinute: { mood: 0.8 } })],
  },
  {
    id: "fridge", name: "冰箱", w: 0.18, d: 0.18, h: 180, color: 0xdfe8ee, zone: "wall", category: "厨房", icon: "冰箱",
    interactions: [I({ id: "snack", name: "拿零食吃", pose: "eat", minutes: [2, 5], perMinute: { hunger: 4, mood: 0.5 } })],
  },
  {
    id: "stove", name: "灶台", w: 0.24, d: 0.2, h: 95, color: 0xcfd5db, zone: "wall", category: "厨房", icon: "",
    interactions: [I({ id: "cook", name: "做饭", pose: "use", minutes: [10, 40], perMinute: { mood: 0.15, energy: -0.05 }, turnsOn: true, tags: ["cook"] })],
  },
  {
    id: "sink", name: "水槽", w: 0.22, d: 0.2, h: 95, color: 0xbcd3e0, zone: "wall", category: "厨房", icon: "",
    interactions: [I({ id: "wash", name: "洗碗", pose: "use", minutes: [3, 10], perMinute: { hygiene: 0.3, mood: -0.05 } })],
  },
  {
    id: "table", name: "餐桌", w: 0.36, d: 0.22, h: 80, color: 0xc89b6d, zone: "floor", category: "厨房", icon: "",
    interactions: [I({ id: "eat", name: "吃饭", pose: "eat", minutes: [5, 20], perMinute: { hunger: 5, mood: 0.2 }, tags: ["eat"] })],
  },
  {
    id: "chair", name: "椅子", w: 0.1, d: 0.1, h: 60, color: 0xb3845a, zone: "any", category: "厨房", icon: "",
    interactions: [I({ id: "sit", name: "坐下", pose: "sit", onTop: true, minutes: [3, 30], perMinute: { energy: 0.05 } })],
  },
  {
    id: "desk", name: "电脑桌", w: 0.34, d: 0.2, h: 85, color: 0x8a9bb0, zone: "any", category: "书房", icon: "",
    interactions: [
      I({ id: "work", name: "工作", pose: "sit", minutes: [20, 180], perMinute: { energy: -0.12, mood: -0.04 }, turnsOn: true, tags: ["work"] }),
      I({ id: "browse", name: "上网冲浪", pose: "sit", minutes: [10, 60], perMinute: { mood: 0.2, energy: -0.03 }, turnsOn: true, news: true }),
      I({ id: "game", name: "打游戏", pose: "sit", minutes: [15, 90], perMinute: { mood: 0.35, energy: -0.06 }, turnsOn: true }),
    ],
  },
  {
    id: "bookshelf", name: "书架", w: 0.22, d: 0.14, h: 175, color: 0x9a6b45, zone: "wall", category: "书房", icon: "",
    interactions: [I({ id: "read", name: "看书", pose: "stand", minutes: [10, 60], perMinute: { mood: 0.15, energy: -0.02 } })],
  },
  {
    id: "bathtub", name: "浴缸", w: 0.4, d: 0.3, h: 65, color: 0xf4f7f9, zone: "wall", category: "卫浴", icon: "",
    interactions: [I({ id: "bath", name: "泡澡", pose: "lie", onTop: true, minutes: [10, 40], perMinute: { hygiene: 3, mood: 0.3, energy: 0.05 } })],
  },
  {
    id: "toilet", name: "马桶", w: 0.12, d: 0.16, h: 75, color: 0xf4f7f9, zone: "wall", category: "卫浴", icon: "",
    interactions: [I({ id: "use", name: "上厕所", pose: "sit", onTop: true, minutes: [2, 5], perMinute: { hygiene: -0.2, mood: 0.3 } })],
  },
  {
    id: "medicine", name: "药箱", w: 0.14, d: 0.1, h: 80, color: 0xffffff, zone: "wall", category: "卫浴", icon: "",
    interactions: [I({ id: "medicine", name: "吃药", pose: "use", minutes: [1, 2], perMinute: { health: 6 }, tags: ["sick"] })],
  },
];

export const FURNITURE_BY_ID = Object.fromEntries(FURNITURE.map((f) => [f.id, f])) as Record<string, FurnitureDef>;

export interface RoomTypeDef {
  id: string;
  name: string;
  w: number; // 默认宽度（格）
  floor: string;
  wall: string;
  window?: boolean;
  stairs?: boolean;  // 楼梯间：连通上下楼
  outdoor?: boolean; // 院子：没有墙和天花板
  furniture: { def: string; x: number; z: number }[]; // x 是相对房间宽度的比例，z 是纵深
}

export const ROOM_TYPES: RoomTypeDef[] = [
  {
    id: "bedroom", name: "卧室", w: 1, floor: "carpet", wall: "peach", window: true,
    furniture: [{ def: "bed", x: 0.27, z: 0.06 }, { def: "lamp", x: 0.55, z: 0.06 }, { def: "wardrobe", x: 0.8, z: 0.06 }, { def: "plant", x: 0.85, z: 0.5 }],
  },
  {
    id: "living", name: "客厅", w: 2, floor: "wood", wall: "cream", window: true,
    furniture: [
      { def: "bookshelf", x: 0.12, z: 0.06 }, { def: "tv", x: 0.42, z: 0.06 }, { def: "plant", x: 0.62, z: 0.06 },
      { def: "rug", x: 0.42, z: 0.5 }, { def: "sofa", x: 0.42, z: 0.5 }, { def: "lamp", x: 0.9, z: 0.06 },
    ],
  },
  {
    id: "kitchen", name: "厨房", w: 1, floor: "tile", wall: "sage", window: true,
    furniture: [{ def: "fridge", x: 0.14, z: 0.06 }, { def: "stove", x: 0.4, z: 0.06 }, { def: "sink", x: 0.66, z: 0.06 }, { def: "table", x: 0.5, z: 0.5 }],
  },
  {
    id: "bathroom", name: "浴室", w: 1, floor: "tile", wall: "sky",
    furniture: [{ def: "bathtub", x: 0.3, z: 0.06 }, { def: "medicine", x: 0.62, z: 0.06 }, { def: "toilet", x: 0.84, z: 0.06 }],
  },
  {
    id: "study", name: "书房", w: 1, floor: "mint", wall: "lilac", window: true,
    furniture: [{ def: "bookshelf", x: 0.18, z: 0.06 }, { def: "desk", x: 0.55, z: 0.5 }, { def: "plant", x: 0.85, z: 0.06 }],
  },
  { id: "stairs", name: "楼梯间", w: 1, floor: "wood", wall: "cream", stairs: true, furniture: [] },
  { id: "yard", name: "院子", w: 1, floor: "grass", wall: "cream", outdoor: true, furniture: [{ def: "plant", x: 0.2, z: 0.06 }, { def: "chair", x: 0.6, z: 0.5 }] },
  { id: "empty", name: "空房间", w: 1, floor: "wood", wall: "cream", furniture: [] },
];

export const ROOM_TYPE_BY_ID = Object.fromEntries(ROOM_TYPES.map((r) => [r.id, r])) as Record<string, RoomTypeDef>;

export interface FoodDef {
  id: string;
  name: string;
  hunger: number;
  mood: number;
  color: number;
}

export const FOODS: FoodDef[] = [
  { id: "rice", name: "一碗热饭", hunger: 45, mood: 5, color: 0xffffff },
  { id: "noodle", name: "番茄鸡蛋面", hunger: 50, mood: 8, color: 0xf2a65a },
  { id: "bread", name: "面包", hunger: 25, mood: 3, color: 0xe0b170 },
  { id: "fruit", name: "水果拼盘", hunger: 18, mood: 10, color: 0xf27a7a },
  { id: "porridge", name: "白粥（病号餐）", hunger: 30, mood: 4, color: 0xf5f0e1 },
  { id: "cake", name: "小蛋糕", hunger: 15, mood: 18, color: 0xf7b8d2 },
];

export const FOOD_BY_ID = Object.fromEntries(FOODS.map((f) => [f.id, f])) as Record<string, FoodDef>;
