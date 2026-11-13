// 自主选家具：每件家具的每种用法都「告诉」角色自己能满足什么，
// 角色结合自己的需求、性格、爱好、技能、喜欢的家具和距离，给每个选择打分，挑最想做的事。
import type { Needs, PlanStep } from "../core/types";
import { currentScheduleItem, parseSchedule } from "../core/time";
import { FOOD_BY_ID, FURNITURE_BY_ID, type InteractionDef } from "../world/catalog";
import type { Character } from "./character";
import type { Game } from "./game";

export interface Option {
  step: PlanStep;
  label: string;  // 给玩家看的，例如「看电视（客厅）」
  score: number;
  why: string;    // 主要原因，例如「娱乐」「肚子饿」
}

/** 需求越低越迫切：数值 100 时几乎不在意，低于 30 时非常在意 */
function urgency(v: number) {
  const u = Math.max(0, Math.min(1, (100 - v) / 100));
  return u * u * 3 + u * 0.3;
}

const NEED_WORD: Partial<Record<keyof Needs, string>> = {
  hunger: "肚子饿", energy: "困了", bladder: "想上厕所", hygiene: "想洗干净", fun: "无聊", social: "想找人说话", comfort: "想坐一会儿", health: "身体不舒服",
};

// 爱好里出现这些词，对应的家具用法会更有吸引力
const HOBBY_HINTS: [RegExp, (id: string, def: string, tags: string[]) => boolean][] = [
  [/游戏/, (id) => ["game", "arcade"].includes(id)],
  [/画/, (_, __, tags) => tags.includes("art")],
  [/音乐|弹|唱|吉他|钢琴/, (_, __, tags) => tags.includes("music")],
  [/做饭|料理|烹饪/, (_, __, tags) => tags.includes("cook")],
  [/看书|读书|阅读/, (id) => id === "read"],
  [/植物|浇花|花/, (id) => id === "water"],
  [/电视|追剧|新闻/, (id) => id === "watch" || id === "news"],
  [/泡澡|洗澡/, (id) => id === "bath"],
];

function interactionGain(c: Character, it: InteractionDef, minutes: number) {
  const n = c.d.needs;
  let total = 0;
  let best: { k: keyof Needs; v: number } | null = null;
  const add = (k: keyof Needs, amount: number) => {
    if (amount <= 0) return;
    const v = Math.min(amount, 100 - n[k]) * urgency(n[k]);
    total += v;
    if (!best || v > best.v) best = { k, v };
  };
  for (const [k, per] of Object.entries(it.perMinute)) if (k !== "mood") add(k as keyof Needs, (per as number) * minutes);
  const funny = (it.perMinute.mood ?? 0) >= 0.15 || it.tags?.includes("music");
  if (funny) add("fun", (1.2 + (it.perMinute.mood ?? 0) * 3) * minutes);
  if (it.pose === "sit" || it.pose === "lie") add("comfort", 0.8 * minutes);
  if (it.tags?.includes("sick") && c.d.illness) { total += 30; best = { k: "health", v: 30 }; }
  return { total, best: best as { k: keyof Needs; v: number } | null };
}

export function scoreOptions(game: Game, c: Character): Option[] {
  const d = c.d;
  const n = d.needs;
  const w = game.world;
  const hour = new Date().getHours();
  const night = hour >= 23 || hour < 6;
  const sched = currentScheduleItem(parseSchedule(d.schedule), new Date())?.text ?? "";
  const pos = c.d.pos;
  const out: Option[] = [];
  const hobbies = `${d.profile.hobbies} ${d.lore.habits}`;

  for (const f of w.data.furniture) {
    const def = FURNITURE_BY_ID[f.def];
    if (!def || !def.interactions.length) continue;
    const occ = game.occupantOf(f.uid);
    if (occ && occ !== c) continue;
    const dist = Math.abs(f.x - pos.x) + Math.abs(f.y - pos.y);
    const roomName = w.roomOf(f.x, f.y);
    for (const it of def.interactions) {
      if (it.id === "toggle" && !(def.warmth || def.climate)) continue;
      // 吃饭：只有桌上有饭时才有意义，按饭的饱腹值算
      if (it.tags?.includes("eat")) {
        const foods = w.foodsOn(f.uid).filter((x) => !x.forChar || x.forChar === c.id);
        if (!foods.length) continue;
        const food = foods.find((x) => x.forChar === c.id) ?? foods[0];
        const fd = FOOD_BY_ID[food.kind];
        let s = Math.min(fd?.hunger ?? 30, 100 - n.hunger) * urgency(n.hunger) + (fd?.mood ?? 0) * 0.5;
        if (d.profile.likes.includes(food.kind)) s *= 1.6;
        if (d.profile.dislikes.includes(food.kind)) s *= 0.4;
        if (food.forChar === c.id) s *= 1.3;
        out.push({ step: { do: "eat", minutes: 10 }, label: `吃${fd?.name ?? "饭"}（${roomName}）`, score: s / (1 + dist * 0.06), why: "肚子饿" });
        continue;
      }
      const minutes = Math.min(it.minutes[1], Math.max(it.minutes[0], 30));
      const g = interactionGain(c, it, minutes);
      let s = g.total;
      let why = g.best ? NEED_WORD[g.best.k] ?? "" : "";
      const tags = it.tags ?? [];
      // 睡觉：困了、到点了、夜里才想睡；夜猫子晚睡，早起型早睡
      if (it.id === "sleep") {
        const sleepy = n.energy < 35 || /睡/.test(sched) || (night && d.lore.chronotype !== "night") || (hour >= 2 && hour < 6);
        if (!sleepy) s *= 0.15;
        if (d.lore.chronotype === "early" && hour >= 22) s *= 1.5;
      }
      // 生病：按人设决定是休息还是硬撑
      if (d.illness) {
        if (tags.includes("rest") || tags.includes("sick")) s *= d.lore.sickBehavior === "stubborn" ? 0.6 : 2;
        if (tags.includes("work") && d.lore.sickBehavior === "stubborn") { s += 25; why = "想把事情做完"; }
      }
      // 工作：作息到点、越认真越想工作
      if (tags.includes("work")) {
        s += /工作|上课|网课|学习|画/.test(sched) ? 40 * (0.5 + d.traits.conscientiousness / 100) : 5;
        if (!why || s > g.total) why = /工作|上课|网课|学习|画/.test(sched) ? "该干正事了" : why;
      }
      // 作息里提到这件事
      if (sched && (sched.includes(it.name) || (it.name.length >= 2 && sched.includes(it.name.slice(0, 2))))) { s *= 1.6; why = "作息上写着"; }
      // 爱好、技能、喜欢的家具、喜欢的房间
      for (const [re, match] of HOBBY_HINTS) if (re.test(hobbies) && match(it.id, f.def, tags)) { s *= 1.5; why = why || "喜欢做的事"; }
      const skillTag = tags.includes("cook") ? "cooking" : tags.includes("music") ? "music" : tags.includes("art") ? "art" : ["game", "arcade"].includes(it.id) ? "gaming" : null;
      if (skillTag) s *= 1 + d.skills[skillTag] * 0.05;
      if (d.lore.favoriteFurniture.includes(f.def)) { s *= 1.4; why = why || "最喜欢的家具"; }
      if (d.lore.favoriteRoom && roomName === d.lore.favoriteRoom) s *= 1.15;
      // 房间归属：自己的房间待着舒服，睡觉一定回自己房间；别人的房间不随便进，更不会睡别人的床
      const owners = w.data.owners?.[roomName];
      if (owners?.length) {
        const rest = it.id === "sleep" || it.id === "nap" || tags.includes("rest");
        if (owners.includes(c.id)) s *= rest ? 1.8 : 1.25;
        else {
          const close = owners.some((id) => (d.relations[id]?.affinity ?? 0) >= 60);
          s *= rest ? (close ? 0.2 : 0.05) : close ? 0.6 : 0.3;
        }
      }
      // 家具标签：喜欢的标签越多越想用，讨厌的就不太想
      const ftags = def.tags ?? [];
      const liked = ftags.filter((t) => d.lore.likedTags.includes(t));
      const hated = ftags.filter((t) => d.lore.dislikedTags.includes(t));
      if (liked.length) { s *= 1 + 0.15 * Math.min(3, liked.length); why = why || `喜欢它${liked.slice(0, 2).join("、")}`; }
      if (hated.length) s *= Math.max(0.3, 1 - 0.25 * hated.length);
      // 冷了想取暖，热了不想烤火
      const felt = game.feltOf(c);
      const warmAct = tags.includes("warm") || (it.id === "toggle" && !!def.warmth && !f.state?.on) || (it.id === "toggle" && !!def.climate && !f.state?.on && (felt < 16 || felt > 28));
      if (warmAct && felt < 16) { s += (16 - felt) * 6; why = "太冷了"; }
      if (it.id === "toggle" && def.climate && felt > 28 && !f.state?.on) { s += (felt - 28) * 6; why = "太热了"; }
      if (tags.includes("warm") && felt > 26) s *= 0.2;
      if (it.id === "toggle" && (def.warmth || def.climate) && f.state?.on && felt >= 18 && felt <= 26) s += 3; // 不冷了，顺手关掉
      // 压力大时更想玩、想休息
      if (d.stress > 60 && ((it.perMinute.mood ?? 0) >= 0.15 || tags.includes("rest"))) s *= 1.4;
      // 有人在睡觉的房间，不想开电视、弹琴
      if ((it.turnsOn || tags.includes("music")) && game.chars.some((o) => o !== c && o.hidden && o.room === roomName)) s *= 0.3;
      s = s / (1 + dist * 0.06) * (0.9 + Math.random() * 0.2);
      if (s <= 0.5) continue;
      out.push({ step: { do: "use", target: f.uid, interaction: it.id, minutes }, label: `${it.name}（${def.name}·${roomName}）`, score: s, why: why || "随便做点什么" });
    }
  }
  // 找人聊天：越外向越想
  for (const o of game.chars) {
    if (o === c || o.hidden) continue;
    const s = Math.min(30, 100 - n.social) * urgency(n.social) * (0.5 + d.traits.extraversion / 100) * (1 + Math.max(0, d.relations[o.id]?.affinity ?? 0) / 100);
    if (s > 0.5) out.push({ step: { do: "talk", target: o.id, line: "" }, label: `找${o.name}聊天`, score: s, why: "想找人说话" });
  }
  // 宠物：饿了去喂，闲着去逗；喜欢猫、喜欢动物的人更爱去
  for (const p of game.pets) {
    if (Math.floor((p.d.pos.y + 500) / 1000) !== Math.floor((c.d.pos.y + 500) / 1000)) continue;
    const fan = d.lore.likedTags.some((t) => t === "猫咪" || t === "动物") ? 1.8 : d.lore.dislikedTags.some((t) => t === "猫咪" || t === "动物") ? 0.2 : 1;
    const dist = Math.hypot(p.d.pos.x - c.d.pos.x, p.d.pos.y - c.d.pos.y);
    if (p.d.hunger < 40) out.push({ step: { do: "pet", target: p.d.id, interaction: "feed", minutes: 3 }, label: `喂${p.d.name}`, score: (50 - p.d.hunger) * 3 * (0.5 + d.traits.agreeableness / 100) / (1 + dist * 0.05), why: `${p.d.name}饿了` });
    if (!p.asleep) out.push({ step: { do: "pet", target: p.d.id, interaction: "play", minutes: 8 }, label: `逗${p.d.name}玩`, score: (100 - n.fun) * 0.9 * fan / (1 + dist * 0.06), why: fan > 1 ? "最喜欢猫了" : "无聊" });
  }
  out.push({ step: { do: "wander" }, label: "四处走走", score: 2 + (n.comfort > 60 ? 1 : 0), why: "随便走走" });
  return out.sort((a, b) => b.score - a.score);
}

/** 从得分最高的几项里按分数随机挑一个，避免每次都做同一件事 */
export function pickOption(opts: Option[]): Option | undefined {
  const top = opts.slice(0, 3);
  const sum = top.reduce((a, o) => a + o.score, 0);
  let r = Math.random() * sum;
  for (const o of top) { r -= o.score; if (r <= 0) return o; }
  return top[0];
}
