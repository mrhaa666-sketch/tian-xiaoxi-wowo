// 地板、墙、家具和食物的定义。之后换成正式素材时，只需要给定义加上 sprite 字段。
import type { Needs, Pose } from "../core/types";

export interface FloorDef {
  id: string;
  name: string;
  color: number;
  line: number;
  outdoor?: boolean; // 室外地面：不画墙根阴影
}

export const FLOORS: FloorDef[] = [
  { id: "wood", name: "木地板", color: 0xd9b38c, line: 0xc49a70 },
  { id: "tile", name: "白瓷砖", color: 0xe8ecef, line: 0xc9d1d8 },
  { id: "carpet", name: "粉地毯", color: 0xf2c4cf, line: 0xe6aebb },
  { id: "mint", name: "薄荷地板", color: 0xbfe3d4, line: 0xa3d0bd },
  { id: "grass", name: "草地", color: 0x9fd18b, line: 0x8cc277, outdoor: true },
  { id: "stone", name: "石板路", color: 0xc4c0b8, line: 0xa9a49a, outdoor: true },
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
  onTop?: boolean;    // 角色是否移动到家具上（躺床、坐沙发）
  minutes: [number, number]; // AI 可选的持续时长范围（游戏分钟 = 现实秒 × timeScale / 60）
  perMinute: Partial<Needs>; // 每分钟对需求的影响
  turnsOn?: boolean;  // 使用时家具切换为「开」
  news?: boolean;     // 使用时可以看到新闻
  tags?: string[];
}

export interface FurnitureDef {
  id: string;
  name: string;
  w: number; // 占地（rot=0 时 x 方向）
  h: number;
  height: number; // 占位方块的高度（像素）
  color: number;
  top?: number;
  walkable?: boolean;
  wallMounted?: boolean;
  category: "卧室" | "客厅" | "厨房" | "书房" | "卫浴" | "装饰";
  interactions: InteractionDef[];
  icon: string; // 占位图上显示的字
}

const I = (d: InteractionDef) => d;

export const FURNITURE: FurnitureDef[] = [
  {
    id: "bed", name: "单人床", w: 1, h: 2, height: 22, color: 0x9bb7e0, top: 0xffffff, category: "卧室", icon: "床",
    interactions: [
      I({ id: "sleep", name: "睡觉", pose: "lie", onTop: true, minutes: [30, 480], perMinute: { energy: 0.35, health: 0.08 }, tags: ["rest"] }),
      I({ id: "nap", name: "小睡", pose: "lie", onTop: true, minutes: [10, 40], perMinute: { energy: 0.3, mood: 0.05 }, tags: ["rest"] }),
      I({ id: "rest", name: "躺着养病", pose: "lie", onTop: true, minutes: [20, 240], perMinute: { energy: 0.2, health: 0.25 }, tags: ["rest", "sick"] }),
    ],
  },
  {
    id: "wardrobe", name: "衣柜", w: 1, h: 1, height: 110, color: 0xb98b62, category: "卧室", icon: "柜",
    interactions: [I({ id: "change", name: "换衣服", pose: "use", minutes: [2, 5], perMinute: { mood: 0.6, hygiene: 0.5 } })],
  },
  {
    id: "lamp", name: "落地灯", w: 1, h: 1, height: 90, color: 0xf2d27a, category: "卧室", icon: "灯",
    interactions: [I({ id: "toggle", name: "开关灯", pose: "use", minutes: [1, 1], perMinute: {} })],
  },
  {
    id: "sofa", name: "沙发", w: 2, h: 1, height: 34, color: 0xe58f8f, category: "客厅", icon: "沙发",
    interactions: [
      I({ id: "sit", name: "坐着发呆", pose: "sit", onTop: true, minutes: [5, 40], perMinute: { energy: 0.08, mood: 0.05 } }),
      I({ id: "nap", name: "在沙发上打盹", pose: "lie", onTop: true, minutes: [10, 40], perMinute: { energy: 0.22 }, tags: ["rest"] }),
    ],
  },
  {
    id: "tv", name: "电视", w: 1, h: 1, height: 60, color: 0x444b5a, category: "客厅", icon: "TV",
    interactions: [
      I({ id: "watch", name: "看电视", pose: "stand", minutes: [10, 60], perMinute: { mood: 0.25, energy: -0.03 }, turnsOn: true }),
      I({ id: "news", name: "看新闻", pose: "stand", minutes: [5, 20], perMinute: { mood: 0.05 }, turnsOn: true, news: true }),
    ],
  },
  {
    id: "rug", name: "地毯", w: 2, h: 2, height: 2, color: 0xc9b6e4, walkable: true, category: "装饰", icon: "",
    interactions: [],
  },
  {
    id: "plant", name: "盆栽", w: 1, h: 1, height: 70, color: 0x6fbf73, category: "装饰", icon: "植",
    interactions: [I({ id: "water", name: "浇花", pose: "use", minutes: [1, 3], perMinute: { mood: 0.8 } })],
  },
  {
    id: "fridge", name: "冰箱", w: 1, h: 1, height: 120, color: 0xdfe8ee, category: "厨房", icon: "冰箱",
    interactions: [I({ id: "snack", name: "拿零食吃", pose: "eat", minutes: [2, 5], perMinute: { hunger: 4, mood: 0.5 } })],
  },
  {
    id: "stove", name: "灶台", w: 1, h: 1, height: 52, color: 0xcfd5db, category: "厨房", icon: "灶",
    interactions: [I({ id: "cook", name: "做饭", pose: "use", minutes: [10, 40], perMinute: { mood: 0.15, energy: -0.05 }, turnsOn: true, tags: ["cook"] })],
  },
  {
    id: "sink", name: "水槽", w: 1, h: 1, height: 52, color: 0xbcd3e0, category: "厨房", icon: "水",
    interactions: [I({ id: "wash", name: "洗碗", pose: "use", minutes: [3, 10], perMinute: { hygiene: 0.3, mood: -0.05 } })],
  },
  {
    id: "table", name: "餐桌", w: 2, h: 1, height: 44, color: 0xc89b6d, category: "厨房", icon: "桌",
    interactions: [I({ id: "eat", name: "吃饭", pose: "eat", minutes: [5, 20], perMinute: { hunger: 5, mood: 0.2 }, tags: ["eat"] })],
  },
  {
    id: "chair", name: "椅子", w: 1, h: 1, height: 30, color: 0xb3845a, category: "厨房", icon: "椅",
    interactions: [I({ id: "sit", name: "坐下", pose: "sit", onTop: true, minutes: [3, 30], perMinute: { energy: 0.05 } })],
  },
  {
    id: "desk", name: "电脑桌", w: 2, h: 1, height: 50, color: 0x8a9bb0, category: "书房", icon: "电脑",
    interactions: [
      I({ id: "work", name: "工作", pose: "sit", minutes: [20, 180], perMinute: { energy: -0.12, mood: -0.04 }, turnsOn: true, tags: ["work"] }),
      I({ id: "browse", name: "上网冲浪", pose: "sit", minutes: [10, 60], perMinute: { mood: 0.2, energy: -0.03 }, turnsOn: true, news: true }),
      I({ id: "game", name: "打游戏", pose: "sit", minutes: [15, 90], perMinute: { mood: 0.35, energy: -0.06 }, turnsOn: true }),
    ],
  },
  {
    id: "bookshelf", name: "书架", w: 1, h: 1, height: 120, color: 0x9a6b45, category: "书房", icon: "书",
    interactions: [I({ id: "read", name: "看书", pose: "stand", minutes: [10, 60], perMinute: { mood: 0.15, energy: -0.02 } })],
  },
  {
    id: "bathtub", name: "浴缸", w: 2, h: 1, height: 30, color: 0xf4f7f9, category: "卫浴", icon: "浴",
    interactions: [I({ id: "bath", name: "泡澡", pose: "lie", onTop: true, minutes: [10, 40], perMinute: { hygiene: 3, mood: 0.3, energy: 0.05 } })],
  },
  {
    id: "toilet", name: "马桶", w: 1, h: 1, height: 36, color: 0xf4f7f9, category: "卫浴", icon: "厕",
    interactions: [I({ id: "use", name: "上厕所", pose: "sit", onTop: true, minutes: [2, 5], perMinute: { hygiene: -0.2, mood: 0.3 } })],
  },
  {
    id: "medicine", name: "药箱", w: 1, h: 1, height: 46, color: 0xffffff, category: "卫浴", icon: "药",
    interactions: [I({ id: "medicine", name: "吃药", pose: "use", minutes: [1, 2], perMinute: { health: 6 }, tags: ["sick"] })],
  },
];

export const FURNITURE_BY_ID = Object.fromEntries(FURNITURE.map((f) => [f.id, f])) as Record<string, FurnitureDef>;

export interface FoodDef {
  id: string;
  name: string;
  hunger: number; // 吃完增加的饱腹
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
