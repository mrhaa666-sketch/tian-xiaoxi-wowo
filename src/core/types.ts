// 全局共享的数据结构。存档就是这些结构的 JSON。

// 房子由「房间模块」拼成：每个房间占一层楼里的一格或几格，像娃娃屋一样左右并排、往上叠。
// 坐标约定：x 是横向位置（以格为单位，可为小数），y 是楼层（0 = 一楼），z 是房间里的纵深（0 = 贴着后墙，1 = 最靠近镜头）。

export interface RoomInst {
  uid: string;
  type: string;      // 房间类型 id
  name: string;      // 给玩家和 AI 看的名字，例如「卧室A」
  gx: number;        // 最左边那一格的位置
  gy: number;        // 楼层
  w: number;         // 占几格宽
  wall: string;      // 墙纸
  floor: string;     // 地板
}

export interface FurnitureInst {
  uid: string;
  def: string;   // 家具定义 id
  room: string;  // 所在房间 uid
  x: number;     // 房间内的横向中心（相对房间左边，以格为单位）
  z: number;     // 立牌底边所在的纵深（0 = 贴着后墙，1 = 最靠近镜头）
  state?: Record<string, string | number | boolean>;
}

export interface FoodItem {
  uid: string;
  kind: string;       // 食物 id
  furniture?: string; // 放在哪件家具上
  forChar?: string;   // 主人指定给谁
}

export interface WorldData {
  rooms: RoomInst[];
  furniture: FurnitureInst[];
  foods: FoodItem[];
}

export interface Vec3 { x: number; y: number; z: number }

export type Emotion =
  | "normal" | "happy" | "sad" | "angry" | "surprised" | "shy" | "sick" | "sleepy";

export const EMOTIONS: Emotion[] = ["normal", "happy", "sad", "angry", "surprised", "shy", "sick", "sleepy"];

export const EMOTION_CN: Record<Emotion, string> = {
  normal: "平静", happy: "开心", sad: "难过", angry: "生气",
  surprised: "惊讶", shy: "害羞", sick: "难受", sleepy: "困",
};

export interface Needs {
  hunger: number;  // 饱腹，0 = 饿坏了
  energy: number;  // 精力
  mood: number;    // 心情
  hygiene: number; // 清洁
  social: number;  // 社交满足
  health: number;  // 健康
}

export const NEED_CN: Record<keyof Needs, string> = {
  hunger: "饱腹", energy: "精力", mood: "心情", hygiene: "清洁", social: "社交", health: "健康",
};

export interface Illness {
  name: string;     // 感冒、发烧、肚子疼
  severity: number; // 0-100，降到 0 就痊愈
  since: number;
}

export interface Appearance {
  skin: string;
  hair: string;
  hairStyle: number; // 0-3
  outfit: string;
  accent: string;
  eyes: string;
}

export interface Memory {
  t: number;
  text: string;
  weight: number; // 1 普通，2 重要，3 非常重要
}

export interface Relation {
  affinity: number; // -100..100
  note: string;     // AI 写下的一句印象
}

export interface ChatMsg {
  t: number;
  from: "player" | "char";
  text: string;
}

/** 计划里的一步。由 AI 或本地逻辑生成，由行为执行器执行。 */
export interface PlanStep {
  do: "goto" | "use" | "talk" | "say" | "tell_player" | "idle" | "wander" | "eat";
  target?: string;      // 家具 uid、房间名、角色 id
  interaction?: string; // 家具交互 id
  minutes?: number;
  line?: string;
  emotion?: Emotion;
}

export type Pose = "stand" | "walk" | "sit" | "lie" | "use" | "eat";

export interface CharacterData {
  id: string;
  name: string;
  persona: string;  // 性格 / 人设提示词
  schedule: string; // 玩家写的作息表
  appearance: Appearance;
  needs: Needs;
  illness?: Illness;
  memories: Memory[];
  relations: Record<string, Relation>; // key 为角色 id，"player" 为主人
  chat: ChatMsg[]; // 与主人的聊天记录
  // 运行时状态（也会存档，方便恢复）
  pos: Vec3;
  facing: 1 | -1;
  emotion: Emotion;
  thought: string;
  activity: string; // 现在在做什么，给 UI 和 AI 看
  createdAt: number;
}

export interface NewsItem {
  title: string;
  summary: string;
  source: string;
  link?: string;
  t: number;
}

export interface AISettings {
  provider: "mock" | "anthropic" | "openai";
  apiKey: string;
  baseUrl: string; // 兼容 OpenAI 格式的服务地址
  fastModel: string; // 日常行为
  chatModel: string; // 聊天
  maxCallsPerMinute: number;
  decisionInterval: number; // 同一个角色两次自主决策的最短间隔（秒）
}

export interface NewsSettings {
  enabled: boolean;
  feeds: { name: string; url: string; category: string }[];
  blockedWords: string[];
}

export interface Settings {
  ai: AISettings;
  news: NewsSettings;
  timeScale: number; // 调试用：需求变化和动作时长的倍率
}

export interface LogEntry {
  t: number;
  kind: "event" | "say" | "thought" | "system" | "player" | "festival" | "news";
  who?: string;
  text: string;
}

export interface SaveData {
  version: number;
  world: WorldData;
  characters: CharacterData[];
  settings: Settings;
  log: LogEntry[];
  firedCues: Record<string, string>; // 作息提醒去重：key -> 日期
  firedFestivals: Record<string, string>;
  news: NewsItem[];
  newsFetchedAt: number;
  lastSeen: number;
}
