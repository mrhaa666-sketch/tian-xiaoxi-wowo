// 地板、墙、家具和食物的定义。之后换成正式素材时，只需要给定义加上 sprite 字段。
import type { Needs, Pose } from "../core/types";

// 每种地板、墙纸、家具都可以有一张正式素材图（texture / sprite），
// 放在 public/assets/ 下对应的文件夹里；没有图时用代码画的占位图形。

export interface FloorDef {
  id: string;
  name: string;
  color: number;
  line: number;
  texture: string;   // public/assets/floors/<texture>.png
  outdoor?: boolean; // 室外地面：不画墙根阴影
}

export const FLOORS: FloorDef[] = [
  { id: "wood", name: "浅色木地板", color: 0xd9b38c, line: 0xc49a70, texture: "wood_light" },
  { id: "wood_dark", name: "深色木地板", color: 0xa47454, line: 0x8a5f43, texture: "wood_dark" },
  { id: "herringbone", name: "人字拼地板", color: 0xd8a868, line: 0xbf8f52, texture: "wood_herringbone" },
  { id: "tile", name: "白瓷砖", color: 0xe8ecef, line: 0xc9d1d8, texture: "tile_white" },
  { id: "checker_pink", name: "粉白格瓷砖", color: 0xf6d6dc, line: 0xe6b7c2, texture: "tile_checker_pink" },
  { id: "mint", name: "薄荷格瓷砖", color: 0xbfe3d4, line: 0xa3d0bd, texture: "tile_checker_mint" },
  { id: "mosaic", name: "蓝色马赛克", color: 0xc6e0f0, line: 0xa8cbe0, texture: "tile_mosaic_blue" },
  { id: "tatami", name: "榻榻米", color: 0xd6dfa6, line: 0x9fb06a, texture: "tatami" },
  { id: "carpet", name: "粉地毯", color: 0xf2c4cf, line: 0xe6aebb, texture: "carpet_pink" },
  { id: "carpet_blue", name: "雾蓝地毯", color: 0xbfd0e6, line: 0xa5b9d4, texture: "carpet_blue" },
  { id: "carpet_lilac", name: "淡紫地毯", color: 0xdcd0ee, line: 0xc6b6e0, texture: "carpet_lilac" },
  { id: "marble", name: "大理石", color: 0xf1f0ee, line: 0xd8d6d2, texture: "marble" },
  { id: "concrete", name: "水泥地", color: 0xcfcfcf, line: 0xb5b5b5, texture: "concrete" },
  { id: "deck", name: "户外木平台", color: 0xc69a6b, line: 0xa57b50, texture: "wood_deck", outdoor: true },
  { id: "grass", name: "草地", color: 0x9fd18b, line: 0x8cc277, texture: "grass", outdoor: true },
  { id: "stone", name: "石板路", color: 0xc4c0b8, line: 0xa9a49a, texture: "stone_path", outdoor: true },
];

export const WALL_STYLES: { id: string; name: string; color: number; top: number; texture: string }[] = [
  { id: "cream", name: "奶油墙", color: 0xf3ead8, top: 0xfaf5ea, texture: "wall_cream" },
  { id: "pink", name: "粉色条纹", color: 0xf7dbe2, top: 0xfcedf1, texture: "wall_pink_stripe" },
  { id: "sky", name: "天蓝圆点", color: 0xcfe3f2, top: 0xe6f1fa, texture: "wall_sky_dots" },
  { id: "sage", name: "薄荷叶子", color: 0xd3e2cf, top: 0xe8f0e5, texture: "wall_mint_leaf" },
  { id: "lilac", name: "淡紫星星", color: 0xe3dcf0, top: 0xf0ecf7, texture: "wall_lilac_star" },
  { id: "peach", name: "蜜桃小花", color: 0xf6d3c4, top: 0xfbe7de, texture: "wall_peach_flower" },
  { id: "wood", name: "木护墙板", color: 0xd8b48a, top: 0xe8cda9, texture: "wall_wood_panel" },
  { id: "brick", name: "白砖墙", color: 0xeeeae4, top: 0xf7f4f0, texture: "wall_brick_white" },
  { id: "kitchen", name: "厨房瓷砖", color: 0xf2f4f5, top: 0xfafbfb, texture: "wall_tile_kitchen" },
  { id: "night", name: "星空墙", color: 0x3a4a78, top: 0x55669a, texture: "wall_night_sky" },
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
  wallMounted?: boolean; // 挂在后墙上的装饰：不占地，画在墙面上
  category: string;      // 建造菜单里的分类
  interactions: InteractionDef[];
  icon: string;          // 占位图上显示的字
  sprite?: string;       // 素材图文件名（不含 .png），默认等于 id
  states?: ("on" | "occupied")[]; // 有哪些状态图：<sprite>_on.png、<sprite>_occupied.png
}

const I = (d: InteractionDef) => d;

export const FURNITURE: FurnitureDef[] = [
  {
    id: "bed", name: "单人床", w: 1, h: 2, height: 22, color: 0x9bb7e0, top: 0xffffff, category: "卧室", icon: "床", sprite: "bed_single", states: ["occupied"],
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
    id: "lamp", name: "落地灯", w: 1, h: 1, height: 90, color: 0xf2d27a, category: "卧室", icon: "灯", sprite: "lamp_floor", states: ["on"],
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
    id: "tv", name: "电视", w: 1, h: 1, height: 60, color: 0x444b5a, category: "客厅", icon: "TV", states: ["on"],
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
    id: "stove", name: "灶台", w: 1, h: 1, height: 52, color: 0xcfd5db, category: "厨房", icon: "灶", states: ["on"],
    interactions: [I({ id: "cook", name: "做饭", pose: "use", minutes: [10, 40], perMinute: { mood: 0.15, energy: -0.05 }, turnsOn: true, tags: ["cook"] })],
  },
  {
    id: "sink", name: "水槽", w: 1, h: 1, height: 52, color: 0xbcd3e0, category: "厨房", icon: "水",
    interactions: [I({ id: "wash", name: "洗碗", pose: "use", minutes: [3, 10], perMinute: { hygiene: 0.3, mood: -0.05 } })],
  },
  {
    id: "table", name: "餐桌", w: 2, h: 1, height: 44, color: 0xc89b6d, category: "厨房", icon: "桌", sprite: "dining_table",
    interactions: [I({ id: "eat", name: "吃饭", pose: "eat", minutes: [5, 20], perMinute: { hunger: 5, mood: 0.2 }, tags: ["eat"] })],
  },
  {
    id: "chair", name: "椅子", w: 1, h: 1, height: 30, color: 0xb3845a, category: "厨房", icon: "椅", sprite: "dining_chair",
    interactions: [I({ id: "sit", name: "坐下", pose: "sit", onTop: true, minutes: [3, 30], perMinute: { energy: 0.05 } })],
  },
  {
    id: "desk", name: "电脑桌", w: 2, h: 1, height: 50, color: 0x8a9bb0, category: "书房", icon: "电脑", states: ["on"],
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
    states: ["occupied"], id: "bathtub", name: "浴缸", w: 2, h: 1, height: 30, color: 0xf4f7f9, category: "卫浴", icon: "浴",
    interactions: [I({ id: "bath", name: "泡澡", pose: "lie", onTop: true, minutes: [10, 40], perMinute: { hygiene: 3, mood: 0.3, energy: 0.05 } })],
  },
  {
    id: "toilet", name: "马桶", w: 1, h: 1, height: 36, color: 0xf4f7f9, category: "卫浴", icon: "厕",
    interactions: [I({ id: "use", name: "上厕所", pose: "sit", onTop: true, minutes: [2, 5], perMinute: { bladder: 30, hygiene: -0.2 }, tags: ["toilet"] })],
  },
  {
    id: "medicine", name: "药箱", w: 1, h: 1, height: 46, color: 0xffffff, category: "卫浴", icon: "药",
    interactions: [I({ id: "medicine", name: "吃药", pose: "use", minutes: [1, 2], perMinute: { health: 6 }, tags: ["sick"] })],
  },
];

// ———————————————————— 扩展家具（对应「素材生成提示词」里的素材包） ————————————————————

type Mini = [id: string, name: string, w: number, h: number, height: number, color: number, category: string, interactions?: InteractionDef[], extra?: Partial<FurnitureDef>];
const sit = (name = "坐下"): InteractionDef => ({ id: "sit", name, pose: "sit", onTop: true, minutes: [5, 40], perMinute: { energy: 0.06, mood: 0.04 } });
const sleepSet: InteractionDef[] = [
  { id: "sleep", name: "睡觉", pose: "lie", onTop: true, minutes: [30, 480], perMinute: { energy: 0.35, health: 0.08 }, tags: ["rest"] },
  { id: "nap", name: "小睡", pose: "lie", onTop: true, minutes: [10, 40], perMinute: { energy: 0.3, mood: 0.05 }, tags: ["rest"] },
  { id: "rest", name: "躺着养病", pose: "lie", onTop: true, minutes: [20, 240], perMinute: { energy: 0.2, health: 0.25 }, tags: ["rest", "sick"] },
];
const play = (id: string, name: string, mood = 0.35): InteractionDef => ({ id, name, pose: "use", minutes: [10, 60], perMinute: { mood, energy: -0.04 }, tags: ["music"] });

const EXTRA: Mini[] = [
  // 卧室和客厅
  ["bed_double", "双人床", 2, 2, 26, 0xf2c4cf, "卧室", sleepSet, { states: ["occupied"] }],
  ["dresser", "梳妆台", 1, 1, 80, 0xffffff, "卧室", [{ id: "makeup", name: "打扮一下", pose: "use", minutes: [5, 20], perMinute: { mood: 0.4, hygiene: 0.2 } }]],
  ["nightstand", "床头柜", 1, 1, 40, 0xb98b62, "卧室"],
  ["lamp_desk", "台灯", 1, 1, 40, 0xf7efd6, "卧室", [{ id: "toggle", name: "开关灯", pose: "use", minutes: [1, 1], perMinute: {} }], { states: ["on"] }],
  ["armchair", "单人扶手椅", 1, 1, 40, 0x9fd3c0, "客厅", [sit("坐着休息")]],
  ["coffee_table", "茶几", 2, 1, 28, 0xc89b6d, "客厅", [{ id: "tea", name: "喝茶", pose: "use", minutes: [5, 20], perMinute: { mood: 0.2, energy: 0.03 } }]],
  ["low_cabinet", "矮柜", 2, 1, 40, 0xc89b6d, "客厅"],
  ["plant_big", "大盆栽", 1, 1, 110, 0x5aa95e, "装饰", [{ id: "water", name: "浇花", pose: "use", minutes: [1, 3], perMinute: { mood: 0.8 } }]],
  ["plant_small", "小多肉", 1, 1, 30, 0x8fcf8a, "装饰", [{ id: "water", name: "浇花", pose: "use", minutes: [1, 3], perMinute: { mood: 0.8 } }]],
  ["beanbag", "懒人沙发", 1, 1, 36, 0xf7e3a1, "客厅", [sit("窝在懒人沙发里"), { id: "nap", name: "打盹", pose: "sit", onTop: true, minutes: [10, 40], perMinute: { energy: 0.2 }, tags: ["rest"] }]],
  ["floor_cushion", "坐垫", 1, 1, 14, 0xd8c7f0, "客厅", [sit("坐在垫子上")]],
  ["clothes_rack", "挂衣架", 1, 1, 100, 0xa9b4c2, "卧室", [{ id: "change", name: "换衣服", pose: "use", minutes: [2, 5], perMinute: { mood: 0.6, hygiene: 0.5 } }]],
  ["mirror_stand", "全身镜", 1, 1, 110, 0xd8e8f2, "卧室", [{ id: "mirror", name: "照镜子", pose: "use", minutes: [1, 5], perMinute: { mood: 0.5 } }]],
  // 厨房、餐厅、浴室、洗衣
  ["kitchen_counter", "料理台", 1, 1, 52, 0xe8e1d6, "厨房", [{ id: "cook", name: "备菜做饭", pose: "use", minutes: [10, 40], perMinute: { mood: 0.15, energy: -0.05 }, tags: ["cook"] }]],
  ["microwave_cabinet", "微波炉柜", 1, 1, 100, 0xe8e1d6, "厨房", [{ id: "heat", name: "热点吃的", pose: "eat", minutes: [2, 6], perMinute: { hunger: 5, mood: 0.3 } }]],
  ["cupboard", "碗柜", 1, 1, 110, 0xc89b6d, "厨房"],
  ["round_table", "小圆桌", 1, 1, 44, 0xffffff, "厨房", [{ id: "eat", name: "吃饭", pose: "eat", minutes: [5, 20], perMinute: { hunger: 5, mood: 0.2 }, tags: ["eat"] }]],
  ["bar_stool", "吧台凳", 1, 1, 46, 0xe58f8f, "厨房", [sit()]],
  ["shower", "淋浴间", 1, 1, 120, 0xd9ecf5, "卫浴", [{ id: "shower", name: "洗澡", pose: "use", minutes: [5, 20], perMinute: { hygiene: 4, mood: 0.2 }, turnsOn: true }], { states: ["on"] }],
  ["washbasin", "洗手台", 1, 1, 90, 0xffffff, "卫浴", [{ id: "wash", name: "洗漱", pose: "use", minutes: [2, 8], perMinute: { hygiene: 2, mood: 0.1 } }]],
  ["washing_machine", "洗衣机", 1, 1, 56, 0xf4f7f9, "卫浴", [{ id: "laundry", name: "洗衣服", pose: "use", minutes: [3, 10], perMinute: { hygiene: 0.5, mood: 0.05 }, turnsOn: true }], { states: ["on"] }],
  ["laundry_basket", "洗衣篮", 1, 1, 30, 0xd9b38c, "卫浴"],
  ["towel_rack", "毛巾架", 1, 1, 80, 0xd8d2c8, "卫浴"],
  // 书房、音乐室、游戏角
  ["office_chair", "电脑椅", 1, 1, 60, 0xf2ede4, "书房", [sit()]],
  ["gaming_chair", "电竞椅", 1, 1, 80, 0x3d4a5a, "书房", [sit()]],
  ["bookshelf_low", "矮书柜", 2, 1, 50, 0x9a6b45, "书房", [{ id: "read", name: "看书", pose: "stand", minutes: [10, 60], perMinute: { mood: 0.15, energy: -0.02 } }]],
  ["easel", "画架", 1, 1, 100, 0xc89b6d, "书房", [{ id: "paint", name: "画画", pose: "use", minutes: [20, 120], perMinute: { mood: 0.3, energy: -0.08 }, tags: ["work", "art"] }]],
  ["upright_piano", "立式钢琴", 2, 1, 80, 0x6b4532, "音乐", [play("piano", "弹钢琴")]],
  ["keyboard_stand", "电子琴", 2, 1, 50, 0xf2f2f2, "音乐", [play("keyboard", "弹电子琴"), { id: "compose", name: "作曲", pose: "use", minutes: [20, 120], perMinute: { mood: 0.2, energy: -0.1 }, tags: ["work", "music"] }]],
  ["guitar_stand", "木吉他", 1, 1, 80, 0xd9a066, "音乐", [play("guitar", "弹吉他")]],
  ["electric_guitar_stand", "电吉他", 1, 1, 80, 0x8fd3d8, "音乐", [play("eguitar", "弹电吉他", 0.4)]],
  ["speaker", "音箱", 1, 1, 80, 0x2f3340, "音乐", [{ id: "listen", name: "听音乐", pose: "stand", minutes: [5, 40], perMinute: { mood: 0.3 }, tags: ["music"] }]],
  ["mic_stand", "麦克风架", 1, 1, 100, 0xa9b4c2, "音乐", [play("sing", "唱歌", 0.45)]],
  ["music_stand", "乐谱架", 1, 1, 80, 0x8a8f99, "音乐"],
  ["headphone_desk", "耳机小桌", 1, 1, 50, 0xc89b6d, "音乐", [{ id: "listen", name: "戴耳机听歌", pose: "use", minutes: [10, 60], perMinute: { mood: 0.3 }, tags: ["music"] }]],
  ["game_tv", "游戏机电视", 1, 1, 60, 0x444b5a, "客厅", [{ id: "game", name: "打游戏", pose: "stand", minutes: [15, 90], perMinute: { mood: 0.35, energy: -0.06 }, turnsOn: true }], { states: ["on"] }],
  ["arcade_machine", "街机", 1, 1, 110, 0x9fc6f0, "客厅", [{ id: "arcade", name: "打街机", pose: "use", minutes: [10, 40], perMinute: { mood: 0.4, energy: -0.05 }, turnsOn: true }], { states: ["on"] }],
  // 玄关、户外
  ["shoe_cabinet", "鞋柜", 2, 1, 44, 0xffffff, "玄关"],
  ["coat_rack", "衣帽架", 1, 1, 100, 0xb98b62, "玄关"],
  ["umbrella_stand", "伞桶", 1, 1, 50, 0xa9b4c2, "玄关"],
  ["bench", "长椅", 2, 1, 40, 0xc89b6d, "户外", [sit("坐在长椅上")]],
  ["patio_table", "遮阳伞桌", 1, 1, 100, 0xffffff, "户外", [{ id: "tea", name: "在外面喝茶", pose: "use", minutes: [10, 30], perMinute: { mood: 0.3 } }]],
  ["flower_bed", "花坛", 2, 1, 30, 0x6fbf73, "户外", [{ id: "water", name: "照顾花草", pose: "use", minutes: [3, 15], perMinute: { mood: 0.6 } }]],
  ["small_tree", "小树", 1, 1, 130, 0x5aa95e, "户外"],
  ["bicycle", "自行车", 2, 1, 50, 0xa8dcc8, "户外"],
  ["mailbox", "信箱", 1, 1, 70, 0xe05a5a, "户外", [{ id: "mail", name: "看看信箱", pose: "use", minutes: [1, 2], perMinute: { mood: 0.5 } }]],
  ["cat_tower", "猫爬架", 1, 1, 120, 0xd9b38c, "装饰"],
  ["fish_tank", "鱼缸", 1, 1, 60, 0x9fd8f0, "装饰", [{ id: "watch", name: "看鱼", pose: "stand", minutes: [3, 15], perMinute: { mood: 0.4 } }]],
  ["christmas_tree", "圣诞树", 1, 1, 140, 0x3f9a5a, "节日"],
  // 挂在墙上的装饰
  ["wall_clock", "挂钟", 1, 1, 40, 0xfaf5ea, "墙饰", [], { wallMounted: true }],
  ["wall_painting", "挂画", 1, 1, 50, 0xa9d8f5, "墙饰", [], { wallMounted: true }],
  ["wall_poster", "海报", 1, 1, 70, 0xf2b6d0, "墙饰", [], { wallMounted: true }],
  ["wall_shelf", "墙上搁板", 1, 1, 40, 0xc89b6d, "墙饰", [], { wallMounted: true }],
  ["curtain", "窗帘", 1, 1, 110, 0xf7c9d6, "墙饰", [], { wallMounted: true }],
  ["red_lantern", "红灯笼", 1, 1, 70, 0xd9453b, "节日", [], { wallMounted: true }],
];

for (const [id, name, w, h, height, color, category, interactions = [], extra = {}] of EXTRA) {
  FURNITURE.push({ id, name, w, h, height, color, category, interactions, icon: name.slice(0, 2), ...extra });
}

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
  { id: "onigiri", name: "饭团", hunger: 30, mood: 5, color: 0xf4f1ea },
  { id: "curry", name: "咖喱饭", hunger: 55, mood: 10, color: 0xe2a13e },
  { id: "ramen", name: "拉面", hunger: 55, mood: 12, color: 0xe8b77a },
  { id: "pudding", name: "焦糖布丁", hunger: 12, mood: 16, color: 0xf3c86b },
  { id: "tea", name: "红茶和饼干", hunger: 8, mood: 12, color: 0xb5623a },
  { id: "birthday_cake", name: "生日蛋糕", hunger: 20, mood: 30, color: 0xf7c6d8 },
  { id: "dumplings", name: "饺子", hunger: 50, mood: 15, color: 0xf6efe0 },
  { id: "tangyuan", name: "汤圆", hunger: 30, mood: 15, color: 0xffffff },
  { id: "zongzi", name: "粽子", hunger: 40, mood: 12, color: 0x8fb87a },
  { id: "mooncake", name: "月饼", hunger: 25, mood: 15, color: 0xd9a35b },
];

/** 节日当天自动摆上餐桌的食物 */
export const FESTIVAL_FOODS: Record<string, string> = {
  春节: "dumplings", 除夕: "dumplings", 元宵节: "tangyuan", 端午节: "zongzi", 中秋节: "mooncake",
};

export const FOOD_BY_ID = Object.fromEntries(FOODS.map((f) => [f.id, f])) as Record<string, FoodDef>;
