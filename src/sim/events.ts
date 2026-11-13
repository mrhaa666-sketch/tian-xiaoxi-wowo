// 人和人之间会发生的事：有人生病时别人来照顾、吵架过一阵会去和好、生日晚上大家聚在一起庆祝、
// 关系变好到一定程度时「成了好朋友」。另外每个人睡前会写一篇日记。
import type { Character } from "./character";
import type { Game } from "./game";
import { FURNITURE_BY_ID } from "../world/catalog";
import { dateKey } from "../core/time";
import { startTogether } from "./together";

const HOUR = 3600_000;
const busy = (c: Character) => c.hidden || c.held || Date.now() < c.forcedUntil;
const nameOf = (game: Game, id: string) => game.byId(id)?.name ?? "";

/** 稍后要做的小事（比如粥煮好了端过去） */
interface Later { at: number; fn: () => void }
const laters: Later[] = [];
export function later(ms: number, fn: () => void) { laters.push({ at: Date.now() + ms, fn }); }
function runLaters() {
  const now = Date.now();
  for (let i = laters.length - 1; i >= 0; i--) if (laters[i].at <= now) { const l = laters.splice(i, 1)[0]; try { l.fn(); } catch { /* 忽略 */ } }
}

/** 生病的人：关系好的人去煮粥、过来看看 */
function careForSick(game: Game, fired: Record<string, string>) {
  for (const sick of game.chars) {
    const ill = sick.d.illness;
    if (!ill || ill.severity < 30) continue;
    const key = `care:${sick.id}`;
    if (fired[key] && Date.now() - Number(fired[key]) < 3 * HOUR) continue;
    const helper = game.chars.filter((o) => o !== sick && !o.d.illness && !busy(o) && (o.idle || o.ambient))
      .map((o) => ({ o, s: (o.d.relations[sick.id]?.affinity ?? 0) + o.d.traits.agreeableness / 4 + (o.d.lore.group && o.d.lore.group === sick.d.lore.group ? 15 : 0) }))
      .filter((x) => x.s >= 35).sort((a, b) => b.s - a.s)[0]?.o;
    if (!helper) continue;
    fired[key] = String(Date.now());
    const stove = game.world.data.furniture.find((f) => FURNITURE_BY_ID[f.def]?.interactions.some((i) => i.tags?.includes("cook")) && !game.occupantOf(f.uid));
    const steps: Parameters<Character["setPlan"]>[0] = [];
    if (stove) steps.push({ do: "use", target: stove.uid, interaction: FURNITURE_BY_ID[stove.def].interactions.find((i) => i.tags?.includes("cook"))!.id, minutes: 15 });
    steps.push({ do: "talk", target: sick.id, line: stove ? "给你煮了粥，趁热喝一点。" : "还难受吗？好好休息。" });
    helper.setPlan(steps, false);
    game.emit(helper, `${sick.name}生病了（${ill.name}），你决定去照顾 TA${stove ? "：先煮一碗粥，再端过去看看 TA" : "，过去看看 TA"}。`, 2);
    game.emit(sick, `${helper.name}知道你生病了，说要来照顾你。`, 1);
    game.log("event", `${helper.name}去照顾生病的${sick.name}`, helper.id);
    if (stove) later((15 * 60_000) / game.settings.timeScale, () => { if (sick.d.illness) game.feed(sick, "porridge", helper.name); });
    const r = sick.d.relations[helper.id];
    if (r) r.affinity = Math.min(100, r.affinity + 4);
  }
}

/** 吵架过了一阵：脾气好的一方主动去和好 */
function makeUp(game: Game) {
  for (const cf of game.conflicts) {
    if (cf.resolved || Date.now() - cf.t < 0.75 * HOUR) continue;
    const a = game.byId(cf.a), b = game.byId(cf.b);
    if (!a || !b) { cf.resolved = true; continue; }
    if (Math.random() > 0.15) continue;
    const [first, second] = a.d.traits.agreeableness >= b.d.traits.agreeableness ? [a, b] : [b, a];
    if (busy(first) || !(first.idle || first.ambient)) continue;
    cf.resolved = true;
    first.setPlan([{ do: "talk", target: second.id, line: "之前的事……是我不好。" }], false);
    for (const [x, y] of [[first, second], [second, first]] as const) {
      const r = x.d.relations[y.id];
      if (r) { r.affinity = Math.min(100, r.affinity + 6); r.note = "吵过架，但和好了"; }
    }
    game.emit(first, `你和${second.name}之前因为「${cf.reason}」闹了矛盾。过了一阵你冷静下来，决定去找 TA 和好。`, 2);
    game.emit(second, `${first.name}来找你和好了（之前因为「${cf.reason}」闹过矛盾）。`, 2);
    game.log("event", `${first.name}去找${second.name}和好了`, first.id);
    game.changed();
  }
}

/** 生日：晚上七点大家聚到放蛋糕的地方庆祝 */
function birthdayParty(game: Game, fired: Record<string, string>) {
  const now = new Date();
  if (now.getHours() < 19 || now.getHours() >= 22) return;
  const md = `${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  for (const star of game.chars) {
    if (star.d.profile.birthday !== md) continue;
    const key = `party:${star.id}`;
    if (fired[key] === dateKey(now)) continue;
    fired[key] = dateKey(now);
    const cake = game.world.data.foods.find((f) => f.kind === "birthday_cake" && f.forChar === star.id);
    const table = cake?.furniture ? game.world.getFurniture(cake.furniture) : game.world.data.furniture.find((f) => FURNITURE_BY_ID[f.def]?.interactions.some((i) => i.tags?.includes("eat")));
    const room = table ? game.world.roomOf(table.x, table.y) : game.world.rooms().includes("客厅") ? "客厅" : star.room;
    const guests = game.chars.filter((o) => !o.hidden && !o.d.illness);
    for (const o of guests) {
      o.setPlan([{ do: "goto", target: room }, ...(o === star ? [] : [{ do: "talk" as const, target: star.id, line: "生日快乐！" }]), { do: "idle", minutes: 20 }], true);
      o.forcedUntil = Date.now() + 5 * 60_000;
      game.emit(o, o === star ? `大家在${room}给你过生日。` : `大家在${room}给${star.name}过生日，去祝 TA 生日快乐吧。`, 2);
    }
    startTogether(game, "group", `给${star.name}过生日`, guests, room, 60);
    game.log("festival", `大家在${room}给${star.name}过生日`);
  }
}

/** 关系到了一定程度：成了好朋友 / 最好的朋友 */
function milestones(game: Game, fired: Record<string, string>) {
  for (const a of game.chars) for (const b of game.chars) {
    if (a.id >= b.id) continue;
    const x = a.d.relations[b.id]?.affinity ?? 0, y = b.d.relations[a.id]?.affinity ?? 0;
    const both = Math.min(x, y);
    for (const [th, word] of [[60, "好朋友"], [85, "最好的朋友"]] as const) {
      const key = `bond:${a.id}:${b.id}:${th}`;
      if (both < th || fired[key]) continue;
      fired[key] = dateKey(new Date());
      game.log("event", `${a.name}和${b.name}成了${word}`);
      game.emit(a, `你和${b.name}已经是${word}了。`, 1);
      game.emit(b, `你和${a.name}已经是${word}了。`, 1);
      a.showEmote("💞", 4); b.showEmote("💞", 4);
    }
  }
}

/** 日记：晚上九点以后、去睡觉或者到了半夜，每人每天写一篇（凌晨写的算前一天） */
function diaries(game: Game, fired: Record<string, string>) {
  const now = new Date();
  const h = now.getHours() + now.getMinutes() / 60;
  if (!(h >= 21 || h < 4)) return;
  const day = dateKey(h < 4 ? new Date(now.getTime() - 5 * HOUR) : now);
  for (const c of game.chars) {
    const key = `diary:${c.id}`;
    if (fired[key] === day) continue;
    const sleeping = c.hidden && c.run?.interaction?.tags?.includes("rest");
    if (!sleeping && !(h >= 23.5 || h < 4)) continue;
    fired[key] = day;
    game.onDiaryDue?.(c, day);
  }
}

export function checkRelEvents(game: Game, fired: Record<string, string>) {
  runLaters();
  careForSick(game, fired);
  makeUp(game);
  birthdayParty(game, fired);
  milestones(game, fired);
  diaries(game, fired);
}

/** 没接 AI 时，按今天的记录写一篇简单的日记 */
export function templateDiary(game: Game, c: Character, day: string) {
  const td = c.d.today;
  const bits: string[] = [];
  const mine = game.logs.filter((l) => dateKey(new Date(l.t)) === day && (l.who === c.id || l.text.includes(c.name)) && l.kind !== "thought");
  const ev = mine.filter((l) => l.kind === "event" || l.kind === "festival").slice(-3).map((l) => l.text.replace(c.name, "我"));
  if (ev.length) bits.push(`今天${ev.join("，")}。`);
  if (td.meals >= 3) bits.push("三顿饭都好好吃了。"); else if (td.meals === 0) bits.push("今天好像忘了吃饭。");
  if (td.funMin > 90) bits.push("玩得挺开心的。");
  if (td.workMin > 180) bits.push("做了很久的事，有点累。");
  if (c.d.illness) bits.push(`身体不太舒服（${c.d.illness.name}），希望明天能好一点。`);
  const best = Object.entries(c.d.relations).filter(([id]) => id !== "player").sort((a, b) => b[1].affinity - a[1].affinity)[0];
  if (best && best[1].affinity > 30) bits.push(`和${nameOf(game, best[0]) || "大家"}待在一起的时候很安心。`);
  const chat = c.d.chat.filter((m) => dateKey(new Date(m.t)) === day && m.from === "player").length;
  if (chat) bits.push(`${c.d.lore.callPlayer || "主人"}今天跟我说了 ${chat} 句话。`);
  if (!bits.length) bits.push("平平淡淡的一天。");
  return bits.join("");
}
