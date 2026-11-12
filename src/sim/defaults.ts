// 新存档的默认数据：两个示例角色、默认设置。
import type { Appearance, CharacterData, Settings } from "../core/types";

export const PERSONA_TEMPLATE = `（写下这个角色是什么样的人，AI 会按这段文字扮演 TA）
例：
- 22 岁，自由插画师，在家工作
- 性格：认真、有点逞强，生病了也想把稿子画完
- 说话：简短、温和，偶尔吐槽
- 喜欢：猫、甜食、下雨天；讨厌：被催稿
- 和主人的关系：很信任主人，但不太会撒娇`;

export const SCHEDULE_TEMPLATE = `07:30 起床，洗漱
08:00 吃早饭
09:00 工作
12:00 午饭
13:00 午休
14:00 工作
18:30 晚饭
20:00 自由时间：看电视、打游戏、看书
23:30 洗澡
00:30 睡觉`;

export function randomAppearance(): Appearance {
  const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];
  return {
    skin: pick(["#ffe0cc", "#f6d2b8", "#eec1a0", "#d9a37f"]),
    hair: pick(["#3b2a25", "#6b4532", "#d9a066", "#2d3142", "#c96f7a", "#8aa1c7"]),
    hairStyle: Math.floor(Math.random() * 4),
    outfit: pick(["#7fb3d5", "#f5a3a3", "#9fd3a8", "#c7a6e0", "#f7c873", "#e9eef2"]),
    accent: pick(["#ffffff", "#2d3142", "#f28c8c", "#5a7d9a"]),
    eyes: pick(["#2d2a32", "#4a3a6a", "#3a5a7a", "#6a3a3a"]),
  };
}

export function newCharacter(partial: Partial<CharacterData> & { name: string }): CharacterData {
  return {
    id: "c_" + Math.random().toString(36).slice(2, 9),
    persona: "",
    schedule: "",
    appearance: randomAppearance(),
    needs: { hunger: 80, energy: 80, mood: 70, hygiene: 85, social: 60, health: 100 },
    memories: [],
    relations: { player: { affinity: 30, note: "照顾我的人" } },
    chat: [],
    pos: { x: 1.5, y: 0, z: 0.7 },
    facing: 1,
    emotion: "normal",
    thought: "",
    activity: "发呆",
    createdAt: Date.now(),
    ...partial,
  };
}

export function sampleCharacters(): CharacterData[] {
  const a = newCharacter({
    name: "小溪",
    persona: `- 20 岁，在家做自由插画师
- 性格：认真负责、有点逞强。生病了也想先把工作做完，被人管着才肯休息
- 说话：简短、温柔，偶尔小声吐槽
- 喜欢：甜食、下雨天、给植物浇水
- 和阿槐是室友，觉得阿槐太吵，但其实很依赖他`,
    schedule: SCHEDULE_TEMPLATE,
    pos: { x: 1.5, y: 1, z: 0.7 },
    appearance: { skin: "#ffe0cc", hair: "#6b4532", hairStyle: 1, outfit: "#9fd3a8", accent: "#ffffff", eyes: "#3a5a7a" },
  });
  const b = newCharacter({
    name: "阿槐",
    persona: `- 21 岁，大学生，爱打游戏，会做饭
- 性格：开朗、话多、有点粗线条，喜欢逗小溪
- 说话：活泼，爱用感叹号
- 喜欢：做饭、打游戏、看新闻然后发表奇怪的看法
- 讨厌：早起
- 和小溪是室友，经常因为小事拌嘴，但会默默照顾她`,
    schedule: `09:30 起床
10:00 吃早饭
11:00 上网课
12:30 做午饭
14:00 打游戏
18:00 做晚饭
20:00 看电视或者打游戏
01:00 睡觉`,
    pos: { x: 2.5, y: 1, z: 0.7 },
    appearance: { skin: "#f6d2b8", hair: "#2d3142", hairStyle: 0, outfit: "#f7c873", accent: "#2d3142", eyes: "#2d2a32" },
  });
  a.relations[b.id] = { affinity: 25, note: "吵闹的室友" };
  b.relations[a.id] = { affinity: 35, note: "认真过头的室友" };
  return [a, b];
}

export function defaultSettings(): Settings {
  return {
    ai: {
      provider: "mock",
      apiKey: "",
      baseUrl: "https://api.openai.com/v1",
      fastModel: "claude-haiku-5-5",
      chatModel: "claude-opus-5-5",
      maxCallsPerMinute: 6,
      decisionInterval: 90,
    },
    news: {
      enabled: true,
      feeds: [
        { name: "IT之家", url: "https://www.ithome.com/rss/", category: "科技" },
        { name: "少数派", url: "https://sspai.com/feed", category: "生活" },
      ],
      blockedWords: ["死亡", "遇难", "身亡", "战争", "袭击", "枪击", "爆炸", "地震", "凶杀", "自杀", "坠毁", "政治"],
    },
    timeScale: 1,
  };
}
