// 全局共享的数据结构。存档就是这些结构的 JSON。

export type Dir = "N" | "W"; // 墙只记录格子的北边和西边，南/东边等于相邻格子的北/西边

export interface Tile {
  floor: string; // 地板材质 id
  room?: string; // 所属房间名，例如「卧室」
}

export interface Wall {
  kind: "wall" | "window" | "door";
  style: string;
}

export interface FurnitureInst {
  uid: string;
  def: string; // 家具定义 id
  x: number;
  y: number;
  rot: 0 | 1; // 0 = 朝右下，1 = 朝左下（镜像）
  state?: Record<string, string | number | boolean>;
}

export interface FoodItem {
  uid: string;
  kind: string; // 食物 id
  furniture?: string; // 放在哪件家具上
  x: number;
  y: number;
  forChar?: string; // 主人指定给谁
}

export interface WorldData {
  tiles: Record<string, Tile>; // key = "x,y"
  walls: Record<string, Wall>; // key = "x,y,N" 或 "x,y,W"
  furniture: FurnitureInst[];
  foods: FoodItem[];
}

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
  pos: { x: number; y: number }; // 格子坐标，可以是小数
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
  wallMode: "cutaway" | "full";
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
