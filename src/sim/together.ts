// 一起做事：一个人开始弹琴、打游戏、看电视、做饭时，可能会叫上旁边闲着的人一起；
// 团体日常：同一个团体（比如同一个乐队）的人，到了约好的时间会聚到一起做团体的事。
import type { FurnitureInst, PlanStep } from "../core/types";
import { FURNITURE_BY_ID, type InteractionDef } from "../world/catalog";
import type { Character } from "./character";
import type { Game } from "./game";
import { dateKey } from "../core/time";

export type TogetherKind = "music" | "screen" | "cook" | "group";
const KIND_CN: Record<TogetherKind, string> = { music: "一起玩音乐", screen: "一起看 / 一起玩", cook: "一起做饭", group: "团体活动" };
const KIND_EMOTE: Record<TogetherKind, string> = { music: "🎵", screen: "🎮", cook: "🍳", group: "✨" };

export interface Together { kind: TogetherKind; label: string; ids: string[]; room: string; until: number }

/** 这件事适合叫人一起吗？是哪一类 */
export function kindOf(f: FurnitureInst, it: InteractionDef): TogetherKind | null {
  const def = FURNITURE_BY_ID[f.def];
  const tags = def?.tags ?? [];
  const itags = it.tags ?? [];
  if (itags.includes("music") || tags.includes("作曲") || (tags.includes("音乐") && it.pose !== "lie")) return "music";
  if (itags.includes("cook")) return "cook";
  if (it.id === "watch" || it.id === "game" || it.id === "arcade" || tags.includes("游戏") || tags.includes("看电视")) return "screen";
  return null;
}

/** 在这个房间里给同伴找件家具：玩音乐找别的乐器、没有就坐着听；看电视打游戏找沙发椅子；做饭找水槽料理台 */
function companionSpot(game: Game, room: string, kind: TogetherKind, taken: Set<string>): { f: FurnitureInst; it: InteractionDef } | null {
  const w = game.world;
  const cands: { f: FurnitureInst; it: InteractionDef; score: number }[] = [];
  for (const f of w.data.furniture) {
    if (taken.has(f.uid) || game.occupantOf(f.uid) || w.roomOf(f.x, f.y) !== room) continue;
    const def = FURNITURE_BY_ID[f.def];
    if (!def) continue;
    for (const it of def.interactions) {
      if (it.id === "toggle" || it.tags?.includes("toilet")) continue;
      let score = 0;
      if (kind === "music" || kind === "group") score = (it.tags?.includes("music") || (def.tags ?? []).includes("音乐") ? 3 : 0) + (it.pose === "sit" ? 1 : 0);
      if (kind === "screen") score = it.pose === "sit" ? 3 : 0;
      if (kind === "cook") score = it.tags?.includes("cook") ? 3 : it.id === "wash" ? 2 : 0;
      if (kind === "group" && it.pose === "lie") score = 0;
      if (score > 0) cands.push({ f, it, score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  return cands[0] ?? null;
}

const free = (c: Character) => (c.idle || c.ambient) && !c.hidden && !c.held && Date.now() >= c.forcedUntil && !c.d.illness;

/** 一个人开始做事时：看看要不要叫上别人 */
export function maybeInvite(game: Game, host: Character, f: FurnitureInst, it: InteractionDef, minutes: number) {
  const step = host.run?.step as (PlanStep & { with?: string }) | undefined;
  if (step?.with) return; // 自己就是被叫来的
  const kind = kindOf(f, it);
  if (!kind) return;
  // 越外向越爱叫人
  if (Math.random() > 0.25 + host.d.traits.extraversion / 200) return;
  const room = game.world.roomOf(f.x, f.y);
  const level = Math.floor((f.y + 500) / 1000);
  const sameGroup = (o: Character) => !!host.d.lore.group && o.d.lore.group === host.d.lore.group;
  const pool = game.chars.filter((o) => o !== host && free(o) && Math.floor((o.d.pos.y + 500) / 1000) === level)
    .map((o) => ({ o, s: (host.d.relations[o.id]?.affinity ?? 0) + (sameGroup(o) ? 40 : 0) + (o.room === room ? 20 : 0) - Math.hypot(o.d.pos.x - f.x, o.d.pos.y - f.y) * 2 + o.d.traits.extraversion / 5 }))
    .filter((x) => x.s > 0 && (host.d.relations[x.o.id]?.affinity ?? 0) > -10)
    .sort((a, b) => b.s - a.s).slice(0, kind === "cook" ? 1 : 3);
  const taken = new Set([f.uid]);
  const joined: Character[] = [];
  for (const { o } of pool) {
    const spot = companionSpot(game, room, kind, taken);
    if (!spot) break;
    taken.add(spot.f.uid);
    o.setPlan([{ do: "use", target: spot.f.uid, interaction: spot.it.id, minutes: Math.max(spot.it.minutes[0], Math.min(spot.it.minutes[1], minutes)), with: host.id } as PlanStep], false, false);
    joined.push(o);
  }
  if (!joined.length) return;
  const label = `${KIND_CN[kind]}（${it.name}）`;
  startTogether(game, kind, label, [host, ...joined], room, minutes);
  const names = joined.map((o) => o.name).join("、");
  game.log("event", `${host.name}叫上${names}${KIND_CN[kind]}`, host.id);
  for (const o of joined) game.emit(o, `${host.name}在${room}${it.name}，叫你一起，你答应了，正走过去。`, 1);
  game.emit(host, `你${it.name}的时候叫上了${names}一起。`, 1);
}

export function startTogether(game: Game, kind: TogetherKind, label: string, members: Character[], room: string, minutes: number) {
  const until = Date.now() + (minutes * 60_000) / game.settings.timeScale + 60_000;
  const t: Together = { kind, label, ids: members.map((m) => m.id), room, until };
  for (const m of members) { game.together.set(m.id, t); m.showEmote(KIND_EMOTE[kind], 4); }
}

/** 正在和谁一起做什么（过期或者人散了就不算） */
export function togetherOf(game: Game, c: Character): { t: Together; others: Character[] } | null {
  const t = game.together.get(c.id);
  if (!t) return null;
  if (Date.now() > t.until) { game.together.delete(c.id); return null; }
  const others = t.ids.filter((id) => id !== c.id).map((id) => game.byId(id)).filter((o): o is Character => !!o && o.room === c.room);
  return others.length && c.room === t.room ? { t, others } : null;
}

// ———————————————————— 团体日常 ————————————————————

/** 团体日常一行：「HH:MM 内容」 */
export function parseRoutine(text: string) {
  return text.split("\n").map((l) => l.trim().match(/^(\d{1,2}):(\d{2})\s+(.+)$/)).filter((m): m is RegExpMatchArray => !!m)
    .map((m) => ({ h: Number(m[1]), m: Number(m[2]), text: m[3].trim() }));
}

/** 从活动内容猜要用的家具标签 */
const WORDS: [RegExp, string[]][] = [
  [/排练|合奏|乐队|演奏|作曲|做歌|作业|编曲|混音/, ["音乐", "作曲"]],
  [/唱|歌|练声/, ["唱歌", "音乐"]],
  [/跳舞|晨练|运动|训练/, ["运动"]],
  [/表演|演出|节目|剧/, ["热闹", "节日", "宽敞"]],
  [/游戏|玩/, ["游戏"]],
  [/吃|饭|下午茶|茶/, ["吃饭", "喝茶"]],
  [/看|电视|录像|电影/, ["看电视"]],
];

function pickRoom(game: Game, text: string, members: Character[]) {
  const want = WORDS.filter(([re]) => re.test(text)).flatMap(([, t]) => t);
  const level = Math.floor((members[0].d.pos.y + 500) / 1000);
  const score = new Map<string, number>();
  for (const f of game.world.data.furniture) {
    if (Math.floor((f.y + 500) / 1000) !== level) continue;
    const tags = FURNITURE_BY_ID[f.def]?.tags ?? [];
    const s = tags.filter((t) => want.includes(t)).length;
    if (!s) continue;
    const r = game.world.roomOf(f.x, f.y);
    if (game.ownersOf(r).length && !game.ownersOf(r).some((o) => members.includes(o))) continue; // 不去别人的房间
    score.set(r, (score.get(r) ?? 0) + s);
  }
  return [...score].sort((a, b) => b[1] - a[1])[0]?.[0] ?? (game.world.rooms().includes("客厅") ? "客厅" : game.world.rooms()[0]);
}

/** 每 20 秒看一次：有没有团体到了约好的时间 */
export function checkGroupRoutines(game: Game, fired: Record<string, string>) {
  const now = new Date();
  const mins = now.getHours() * 60 + now.getMinutes();
  const groups = new Map<string, Character[]>();
  for (const c of game.chars) if (c.d.lore.group) { const g = groups.get(c.d.lore.group) ?? []; g.push(c); groups.set(c.d.lore.group, g); }
  for (const [name, all] of groups) {
    if (all.length < 2) continue;
    const routine = all.map((c) => c.d.lore.groupRoutine).find((r) => r?.trim()) ?? "";
    for (const r of parseRoutine(routine)) {
      const at = r.h * 60 + r.m;
      const diff = (mins - at + 1440) % 1440;
      if (diff > 15) continue; // 到点后 15 分钟内都算
      const key = `group:${name}:${r.h}:${r.m}`;
      if (fired[key] === dateKey(now)) continue;
      fired[key] = dateKey(now);
      const members = all.filter((c) => !c.hidden && !c.d.illness && Date.now() >= c.forcedUntil);
      if (members.length < 2) continue;
      const room = pickRoom(game, r.text, members);
      const taken = new Set<string>();
      const minutes = 60;
      for (const c of members) {
        const spot = companionSpot(game, room, "group", taken);
        if (spot) { taken.add(spot.f.uid); c.setPlan([{ do: "use", target: spot.f.uid, interaction: spot.it.id, minutes: Math.max(spot.it.minutes[0], Math.min(spot.it.minutes[1], minutes)), with: "group" } as PlanStep], true); }
        else c.setPlan([{ do: "goto", target: room }, { do: "idle", minutes: 40 }], true);
        // 团体时间先专心待一会儿（AI 只能让 TA 说话，不会中途走开）；主人在聊天里叫 TA 可以打断
        c.forcedUntil = Date.now() + Math.min(10 * 60_000, (minutes * 60_000) / game.settings.timeScale);
        game.emit(c, `现在是${name}的团体时间：「${r.text}」。大家在${room}集合，${members.filter((o) => o !== c).map((o) => o.name).join("、")}都会来。`, 2);
      }
      startTogether(game, "group", `${name}：${r.text}`, members, room, minutes);
      game.log("event", `${name}的大家在${room}集合：${r.text}`);
    }
  }
}
