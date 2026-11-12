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
  rot: 0 | 1; // 0 = 正常占地，1 = 占地的长宽对调（横放/竖放）
  back?: boolean; // 背对镜头摆放（用 <素材名>_back.png）
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
  bladder: number; // 如厕，0 = 憋不住了
  hygiene: number; // 清洁
  fun: number;     // 娱乐
  social: number;  // 社交满足
  comfort: number; // 舒适（一直站着、走着会累）
  mood: number;    // 心情（由其他状态综合而来）
  health: number;  // 健康
}

export const NEED_CN: Record<keyof Needs, string> = {
  hunger: "饱腹", energy: "精力", bladder: "如厕", hygiene: "清洁", fun: "娱乐",
  social: "社交", comfort: "舒适", mood: "心情", health: "健康",
};

/** 界面上需求条的顺序（心情单独显示） */
export const NEED_ORDER: (keyof Needs)[] = ["hunger", "energy", "bladder", "hygiene", "fun", "social", "comfort", "health"];

/** 性格五维，0～100。0 偏向左边的词，100 偏向右边的词 */
export interface Traits {
  extraversion: number;      // 内向 ↔ 外向：越外向，越需要社交
  conscientiousness: number; // 随性 ↔ 认真：越认真，工作压力越小、越守作息
  agreeableness: number;     // 直率 ↔ 友善：越友善，越不容易和人起冲突
  neuroticism: number;       // 淡定 ↔ 敏感：越敏感，压力涨得越快
  openness: number;          // 保守 ↔ 好奇：越好奇，越需要娱乐、学东西越快
}

export const TRAIT_CN: Record<keyof Traits, [string, string, string]> = {
  extraversion: ["外向", "内向", "外向"],
  conscientiousness: ["认真", "随性", "认真"],
  agreeableness: ["友善", "直率", "友善"],
  neuroticism: ["敏感", "淡定", "敏感"],
  openness: ["好奇", "保守", "好奇"],
};

/** 技能等级 0～10（小数部分是升级进度） */
export interface Skills {
  cooking: number;
  music: number;
  art: number;
  gaming: number;
  study: number;
  fitness: number;
}

export const SKILL_CN: Record<keyof Skills, string> = {
  cooking: "做饭", music: "音乐", art: "画画", gaming: "游戏", study: "学习", fitness: "运动",
};

export interface Profile {
  age: number;
  birthday: string;  // "MM-DD"，当天会过生日
  job: string;
  hobbies: string;
  likes: string[];    // 喜欢的食物 id
  dislikes: string[]; // 讨厌的食物 id
}

/** 今天的记录，每天零点清空 */
export interface DayStats {
  date: string;
  meals: number;
  sleepMin: number;
  workMin: number;
  funMin: number;
  socialMin: number;
  toilet: number;
  showered: boolean;
}

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
  profile: Profile;
  traits: Traits;
  skills: Skills;
  needs: Needs;
  stress: number;     // 压力 0～100
  sleepDebt: number;  // 睡眠债（小时）：前几天少睡的时间
  today: DayStats;
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
