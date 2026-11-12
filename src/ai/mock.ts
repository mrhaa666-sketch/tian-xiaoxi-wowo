// 本地模拟大脑：没有填 API Key、AI 被限流或出错时，用简单规则让角色继续生活。
import type { Emotion, PlanStep } from "../core/types";
import { pickOption, scoreOptions } from "../sim/autonomy";
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


const STUBBORN = /逞强|硬撑|工作狂|责任|认真|不服输/;

export function mockDecide(game: Game, c: Character, events: GameEvent[]): Decision {
  const n = c.d.needs;
  const plan: PlanStep[] = [];
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
  if (step.do === "talk") {
    const other = game.byId(step.target ?? "");
    const lines = ["你在干嘛呀？", "今天过得怎么样？", "要不要一起吃点东西？", "好无聊啊。", ...c.d.lore.catchphrases];
    step.line = pick(lines);
    return { thought: `想找${other?.name ?? "人"}说说话。`, emotion, plan: [step] };
  }
  const thoughts: Record<string, string[]> = {
    肚子饿: ["肚子饿了。", "先吃点东西吧。"], 困了: ["好困……", "该睡了。"], 想上厕所: ["要去一下厕所。"], 想洗干净: ["身上黏黏的，去洗洗。"],
    无聊: ["好无聊，找点事做。", "来点有意思的吧。"], 想坐一会儿: ["站累了，坐一会儿。"], 身体不舒服: ["头好晕，还是躺一下吧。"],
    该干正事了: ["按计划该干正事了。"], 想把事情做完: ["咳……再做一点就好。"], 作息上写着: ["到点了。"], 喜欢做的事: ["做点喜欢的事吧。"], 最喜欢的家具: ["还是这里最舒服。"],
  };
  const thought = pick(thoughts[choice.why] ?? ["做点什么好呢。", "随便打发一下时间吧。"]);
  const plan2: PlanStep[] = [step];
  if (choice.why === "想把事情做完") plan2.push({ do: "say", line: pick(["咳……再做一点就好。", ...c.d.lore.catchphrases]) });
  return { thought, emotion, plan: plan2 };
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
