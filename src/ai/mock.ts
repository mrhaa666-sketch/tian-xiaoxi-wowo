// 本地模拟大脑：没有填 API Key、AI 被限流或出错时，用简单规则让角色继续生活。
import type { Emotion, PlanStep } from "../core/types";
import { currentScheduleItem, parseSchedule, periodOf } from "../core/time";
import { FURNITURE_BY_ID } from "../world/catalog";
import type { Character } from "../sim/character";
import type { Game, GameEvent } from "../sim/game";

export interface Decision {
  thought: string;
  emotion: Emotion;
  plan: PlanStep[];
  memory?: string;
  relation_changes?: { target: string; delta: number; note: string }[];
  conflict?: { with: string; reason: string };
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

function find(game: Game, c: Character, def: string, interaction?: string): PlanStep | null {
  const list = game.world.data.furniture.filter((f) => f.def === def && !game.occupantOf(f.uid));
  if (!list.length) return null;
  list.sort((a, b) => Math.hypot(a.x - c.d.pos.x, a.y - c.d.pos.y) - Math.hypot(b.x - c.d.pos.x, b.y - c.d.pos.y));
  const it = interaction ?? FURNITURE_BY_ID[def].interactions[0]?.id;
  return { do: "use", target: list[0].uid, interaction: it };
}

const STUBBORN = /逞强|硬撑|工作狂|责任|认真|不服输/;

export function mockDecide(game: Game, c: Character, events: GameEvent[]): Decision {
  const n = c.d.needs;
  const period = periodOf(new Date());
  const plan: PlanStep[] = [];
  let thought = "";
  let emotion: Emotion = n.mood > 70 ? "happy" : n.mood < 35 ? "sad" : "normal";

  // 先回应别人跟自己说的话
  const talk = [...events].reverse().find((e) => e.from && e.priority >= 3);
  if (talk && Math.random() < 0.8) {
    const other = game.byId(talk.from!);
    if (other) {
      plan.push({ do: "talk", target: other.id, line: pick(["嗯嗯，知道啦。", "真的吗？", "哈哈，你说得对。", "好吧好吧。", "等我一下哦。"]) });
      return { thought: `${other.name}在跟我说话。`, emotion, plan };
    }
  }
  const fed = events.find((e) => e.text.includes("主人给你准备了"));
  if (fed) {
    plan.push({ do: "eat", minutes: 10 }, { do: "tell_player", line: "谢谢，很好吃。" });
    return { thought: "主人给我准备了饭。", emotion: "happy", plan };
  }
  const bed = events.find((e) => e.text.includes("赶回了床上"));
  if (bed) {
    plan.push({ do: "tell_player", line: STUBBORN.test(c.d.persona) ? "……知道了，就躺一会儿。" : "好，我乖乖躺着。" });
    return { thought: "被主人赶回床上了。", emotion: "shy", plan };
  }

  if (c.d.illness) {
    emotion = "sick";
    if (STUBBORN.test(c.d.persona) && Math.random() < 0.6) {
      const w = find(game, c, "desk", "work");
      if (w) {
        plan.push({ ...w, minutes: 60 }, { do: "say", line: "咳……再做一点就好。" });
        return { thought: "这点小病，先把事情做完再说。", emotion, plan };
      }
    }
    const med = find(game, c, "medicine");
    if (med && c.d.illness.severity > 50) plan.push(med);
    const rest = find(game, c, "bed", "rest");
    if (rest) plan.push({ ...rest, minutes: 90 });
    return { thought: "头好晕，还是躺一下吧。", emotion, plan };
  }

  const cur = currentScheduleItem(parseSchedule(c.d.schedule), new Date())?.text ?? "";
  const lateNight = period === "深夜" && !/游戏|熬夜/.test(cur);

  if (n.energy < 25 || lateNight || /睡/.test(cur)) {
    const s = find(game, c, "bed", "sleep");
    if (s) {
      plan.push({ ...s, minutes: n.energy < 25 || lateNight ? 300 : 60 });
      return { thought: "好困，睡觉吧。", emotion: "sleepy", plan };
    }
  }
  if (n.hunger < 35 || (/饭|早餐|午餐|晚餐/.test(cur) && n.hunger < 70)) {
    if (game.findFoodFor(c)) plan.push({ do: "eat", minutes: 10 });
    else if (Math.random() < 0.5) {
      const cook = find(game, c, "stove", "cook");
      if (cook) plan.push({ ...cook, minutes: 20 }, { do: "eat", minutes: 10 });
    }
    if (!plan.length) {
      const snack = find(game, c, "fridge", "snack");
      if (snack) plan.push(snack);
    }
    if (plan.length) return { thought: "肚子饿了。", emotion, plan };
  }
  if (n.hygiene < 35 || /洗澡/.test(cur)) {
    const b = find(game, c, "bathtub", "bath");
    if (b) return { thought: "该洗个澡了。", emotion, plan: [{ ...b, minutes: 20 }] };
  }
  if (n.social < 35 && game.chars.length > 1 && Math.random() < 0.7) {
    const other = pick(game.chars.filter((o) => o !== c));
    plan.push({ do: "talk", target: other.id, line: pick(["你在干嘛呀？", "今天过得怎么样？", "要不要一起吃点东西？", "好无聊啊。"]) });
    return { thought: `想找${other.name}说说话。`, emotion, plan };
  }
  if (/工作|上课|网课|学习/.test(cur)) {
    const w = find(game, c, "desk", "work");
    if (w) return { thought: "按计划该干正事了。", emotion, plan: [{ ...w, minutes: 60 }] };
  }

  const fun: (PlanStep | null)[] = [
    find(game, c, "tv", Math.random() < 0.3 ? "news" : "watch"),
    find(game, c, "bookshelf", "read"),
    find(game, c, "desk", Math.random() < 0.5 ? "game" : "browse"),
    find(game, c, "plant", "water"),
    find(game, c, "sofa", "sit"),
    { do: "wander" },
    { do: "idle", minutes: 2 },
  ];
  const choice = pick(fun.filter(Boolean) as PlanStep[]);
  plan.push({ ...choice, minutes: choice.minutes ?? 15 + Math.random() * 20 });
  thought = pick(["做点什么好呢。", "随便打发一下时间吧。", "今天还挺平静的。", "有点无聊。"]);
  return { thought, emotion, plan };
}

export function mockChat(c: Character, text: string): { reply: string; emotion: Emotion; plan: PlanStep[] } {
  if (/吃饭|饿/.test(text)) return { reply: "嗯，我这就去吃。", emotion: "happy", plan: [{ do: "eat", minutes: 10 }] };
  if (/睡|休息/.test(text)) return { reply: c.d.illness ? "知道了……我去躺着。" : "还不困嘛，等会儿。", emotion: "sleepy", plan: [] };
  if (/喜欢|爱/.test(text)) return { reply: "……突然说这个干嘛。", emotion: "shy", plan: [] };
  if (/你好|在吗|hi|hello/i.test(text)) return { reply: `在的。我在${c.d.activity}。`, emotion: "normal", plan: [] };
  return {
    reply: pick(["嗯，这样啊。", "我想想……", "你说得有道理。", "哈哈，真的吗？"]) + "（现在是本地模拟模式，在设置里填上 API Key 我就能真的听懂你了）",
    emotion: "normal",
    plan: [],
  };
}
