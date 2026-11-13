// 本地模拟大脑：没有填 API Key、AI 被限流或出错时，用简单规则让角色继续生活。
import type { Emotion, Pace, PlanStep } from "../core/types";
import { pickOption, scoreOptions } from "../sim/autonomy";
import type { Character } from "../sim/character";
import type { Game, GameEvent } from "../sim/game";

export interface Decision {
  thought: string;
  emotion: Emotion;
  plan: PlanStep[];
  pace?: Pace;
  memory?: string;
  relation_changes?: { target: string; delta: number; note: string }[];
  conflict?: { with: string; reason: string };
}

const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];


const STUBBORN = /逞强|硬撑|工作狂|责任|认真|不服输/;

export function mockDecide(game: Game, c: Character, events: GameEvent[]): Decision {
  const n = c.d.needs;
  const plan: PlanStep[] = [];
  let emotion: Emotion = n.mood > 85 ? "happy" : n.mood < 35 ? "sad" : "normal";

  // 先回应别人跟自己说的话
  const talk = [...events].reverse().find((e) => e.from && e.priority >= 3);
  if (talk && Math.random() < 0.8) {
    const other = game.byId(talk.from!);
    if (other) {
      plan.push({ do: "talk", target: other.id, line: pick(["嗯嗯，知道啦。", "真的吗？", "哈哈，你说得对。", "好吧好吧。", "等我一下哦。"]) });
      return { thought: `${other.name}在跟我说话。`, emotion, plan };
    }
  }
  const told = events.find((e) => /^主人对.*说：「/.test(e.text));
  if (told) {
    const text = told.text.replace(/^.*?「/, "").replace(/」.*$/, "");
    const r = mockChat(c, text);
    return { thought: "主人在跟我说话。", emotion: r.emotion, plan: [{ do: "tell_player", line: r.reply.replace(/（现在是本地模拟模式.*?）/, "") }, ...r.plan] };
  }
  // 主人不在：给主人发条消息（没接 AI 时用这些句子）
  const away = events.find((e) => e.text.startsWith("主人现在不在"));
  if (away && Math.random() < 0.75) {
    const line = phoneLine(c, away.text);
    return { thought: "给主人发条消息吧。", emotion, plan: [{ do: "tell_player", line }] };
  }
  const fed = events.find((e) => e.text.includes("主人给你准备了"));
  if (fed) {
    plan.push({ do: "eat", minutes: 10 }, { do: "tell_player", line: "谢谢，很好吃。" });
    return { thought: "主人给我准备了饭。", emotion: "happy", plan };
  }
  const order = events.find((e) => e.text.startsWith("主人让你去"));
  if (order) {
    const lazy = c.d.needs.energy < 25 || c.d.needs.mood < 30;
    const line = pick(lazy ? ["……好吧。", "等我一下嘛。", "唔，知道了。"] : ["好～", "知道啦。", "这就去。", "嗯，好。", ...c.d.lore.catchphrases.slice(0, 1)]);
    return { thought: "主人让我去做点事。", emotion, plan: [{ do: "say", line }] };
  }
  const bed = events.find((e) => e.text.includes("赶回了床上"));
  if (bed) {
    const sb = c.d.lore.sickBehavior;
    plan.push({ do: "tell_player", line: sb === "stubborn" || STUBBORN.test(c.d.persona) ? "……知道了，就躺一会儿。" : sb === "clingy" ? `${c.d.lore.callPlayer || "主人"}陪我一会儿嘛……` : "好，我乖乖躺着。" });
    return { thought: "被主人赶回床上了。", emotion: "shy", plan };
  }

  // 其余的事交给自主打分：需求、性格、爱好、作息、喜欢的家具、距离都考虑在内
  const opts = scoreOptions(game, c);
  const choice = pickOption(opts);
  if (c.d.illness) emotion = "sick";
  else if (c.d.stress > 70) emotion = "sad";
  if (!choice) return { thought: "发会儿呆吧。", emotion, plan: [{ do: "idle", minutes: 2 }] };
  const step = { ...choice.step };
  // 快慢：累了、生病、心情差就慢；很急（快憋不住、饿坏了）就快；外向的人平时也走得快一点
  const n2 = c.d.needs;
  const pace: Pace = c.d.illness || n2.energy < 30 || n2.mood < 30 ? "slow"
    : n2.bladder < 15 || n2.hunger < 15 ? "fast"
    : Math.random() < 0.35 + (50 - c.d.traits.extraversion) / 200 ? "slow" : "normal";
  if (step.do === "talk") {
    const other = game.byId(step.target ?? "");
    const lines = ["你在干嘛呀？", "今天过得怎么样？", "要不要一起吃点东西？", "好无聊啊。", ...c.d.lore.catchphrases];
    step.line = pick(lines);
    return { thought: `想找${other?.name ?? "人"}说说话。`, emotion, plan: [step], pace };
  }
  const thoughts: Record<string, string[]> = {
    肚子饿: ["肚子饿了。", "先吃点东西吧。"], 困了: ["好困……", "该睡了。"], 想上厕所: ["要去一下厕所。"], 想洗干净: ["身上黏黏的，去洗洗。"],
    无聊: ["好无聊，找点事做。", "来点有意思的吧。"], 想坐一会儿: ["站累了，坐一会儿。"], 身体不舒服: ["头好晕，还是躺一下吧。"],
    该干正事了: ["按计划该干正事了。"], 想把事情做完: ["咳……再做一点就好。"], 作息上写着: ["到点了。"], 喜欢做的事: ["做点喜欢的事吧。"], 最喜欢的家具: ["还是这里最舒服。"],
  };
  const thought = pick(thoughts[choice.why] ?? ["做点什么好呢。", "随便打发一下时间吧。"]);
  const plan2: PlanStep[] = [step];
  if (choice.why === "想把事情做完") plan2.push({ do: "say", line: pick(["咳……再做一点就好。", ...c.d.lore.catchphrases]) });
  return { thought, emotion, plan: plan2, pace };
}

/** 没接 AI 时，角色给主人发的手机消息 */
function phoneLine(c: Character, why: string): string {
  const you = c.d.lore.callPlayer || "你";
  const h = new Date().getHours();
  const act = c.d.activity && c.d.activity !== "发呆" ? c.d.activity.replace(/（.*）/, "") : "";
  const cp = c.d.lore.catchphrases;
  let pool: string[];
  if (why.includes("生病")) pool = [`${you}……我好像有点不舒服。`, "头好晕，想躺一会儿。", `${you}什么时候回来呀，有点难受。`];
  else if (why.includes("按作息")) { const m = why.match(/该「(.+?)」/); pool = m ? [`我要去${m[1]}啦。`, `${m[1]}的时间到了。`, `${you}，我去${m[1]}了哦。`] : ["到点了。"]; }
  else if (why.includes("早上")) pool = [`早上好，${you}。`, "起床了吗？", "今天天气怎么样？"];
  else if (why.includes("饭点")) pool = [`${you}吃饭了吗？`, h < 15 ? "午饭吃了什么？" : "晚饭吃什么好呢。", "别忘了吃饭。"];
  else if (why.includes("很晚")) pool = [`${you}还没睡吗？`, "早点睡哦。", "晚安。"];
  else if (why.includes("寂寞")) pool = [`${you}在忙吗？`, "家里好安静。", `想和${you}说说话。`];
  else if (why.includes("无聊")) pool = ["好无聊……", `${you}什么时候回来？`, "有没有什么好玩的？"];
  else if (why.includes("心情很好")) pool = ["今天心情不错。", act ? `刚刚在${act}，挺开心的。` : "嘿嘿。"];
  else if (why.includes("心情不太好")) pool = ["……", "有点不开心。", `${you}，能陪我说说话吗？`];
  else pool = act ? [`我在${act}。`, `${you}在做什么呢？`] : [`${you}在做什么呢？`];
  if (cp.length && Math.random() < 0.25) pool = [...pool, ...cp];
  return pool[Math.floor(Math.random() * pool.length)];
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
