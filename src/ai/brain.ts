// AI 调度：什么时候问 AI、问完怎么执行。
// 原则：只在「有事发生」或「手上的事做完了」时才调用，并受每分钟次数上限约束；
// 额度不够或出错时由本地模拟大脑接手，角色永远不会卡住。
import { EMOTIONS, type Emotion, type PlanStep } from "../core/types";
import { FURNITURE_BY_ID } from "../world/catalog";
import type { Character } from "../sim/character";
import { clamp } from "../sim/character";
import type { Game, GameEvent } from "../sim/game";
import { mockChat, mockDecide, type Decision } from "./mock";
import { CHARACTER_SCHEMA, CHARACTER_SYSTEM, CHAT_SCHEMA, CHAT_SYSTEM, DECISION_SCHEMA, DECISION_SYSTEM, buildContext } from "./prompts";
import { FOODS, FURNITURE } from "../world/catalog";
import { AIError, makeLLM, type LLM } from "./provider";

export type AIStatus = { mode: "mock" | "online" | "error"; message: string; callsLastMinute: number; thinking: number };

export class Brain {
  private llm: LLM | null = null;
  private inFlight = new Set<string>();
  private lastDecision = new Map<string, number>();
  /** 闲下来以后，歇到这个时间再决定下一件事（慢悠悠时歇得久，匆忙时几乎不歇） */
  private restUntil = new Map<string, number>();
  private callTimes: number[] = [];
  private pauseUntil = 0;
  status: AIStatus = { mode: "mock", message: "本地模拟模式", callsLastMinute: 0, thinking: 0 };
  onStatus?: () => void;

  constructor(private game: Game) {
    this.reconfigure();
  }

  reconfigure() {
    this.llm = makeLLM(this.game.settings.ai);
    this.pauseUntil = 0;
    this.setStatus(this.llm ? "online" : "mock", this.llm ? "AI 已连接" : "本地模拟模式");
  }

  private setStatus(mode: AIStatus["mode"], message: string) {
    this.status = { ...this.status, mode, message };
    this.onStatus?.();
  }

  private canCall() {
    const now = Date.now();
    this.callTimes = this.callTimes.filter((t) => now - t < 60_000);
    this.status.callsLastMinute = this.callTimes.length;
    return !!this.llm && now > this.pauseUntil && this.callTimes.length < this.game.settings.ai.maxCallsPerMinute && this.inFlight.size < 2;
  }

  /** 每帧调用：挑出需要做决定的角色 */
  tick() {
    const now = Date.now();
    for (const c of this.game.chars) {
      if (this.inFlight.has(c.id)) continue;
      const box = this.game.inbox.get(c.id) ?? [];
      const urgent = box.some((e) => e.priority >= 2);
      const last = this.lastDecision.get(c.id) ?? 0;
      if (!c.idle) this.restUntil.delete(c.id);
      else if (!this.restUntil.has(c.id)) {
        const base = { slow: 28_000, normal: 14_000, fast: 4_000 }[c.pace];
        this.restUntil.set(c.id, now + base * (0.7 + Math.random() * 0.6));
      }
      const rested = now >= (this.restUntil.get(c.id) ?? 0);
      const interval = this.game.settings.ai.decisionInterval * 1000;
      // 正在睡觉/工作这类长动作时，只有急事才会打断
      const busyLong = !!c.run && c.run.phase === "act" && c.run.endsAt - performance.now() > 30_000;
      if (Date.now() < c.forcedUntil && !urgent) continue;
      const wantAI = urgent ? now - last > 3_000 : c.idle && rested && now - last > interval;
      if (wantAI && (!busyLong || box.some((e) => e.priority >= 3))) {
        if (this.canCall()) {
          void this.decide(c);
          continue;
        }
      }
      // 没有 AI 可用、或额度暂时用完时，闲下来就用本地规则安排
      if (c.idle && (!this.llm || !this.canCall())) {
        if (rested && now - last > 4_000) this.decideLocally(c);
      } else if (!this.llm && urgent && now - last > 3_500) {
        this.decideLocally(c);
      }
    }
  }

  private takeInbox(c: Character): GameEvent[] {
    const box = this.game.inbox.get(c.id) ?? [];
    this.game.inbox.set(c.id, []);
    return box;
  }

  private decideLocally(c: Character) {
    const events = this.takeInbox(c);
    this.lastDecision.set(c.id, Date.now());
    this.apply(c, mockDecide(this.game, c, events), events);
  }

  private async decide(c: Character) {
    const events = this.takeInbox(c);
    this.inFlight.add(c.id);
    this.lastDecision.set(c.id, Date.now());
    this.callTimes.push(Date.now());
    this.status.thinking = this.inFlight.size;
    c.showEmote("…", 30);
    this.onStatus?.();
    try {
      const raw = await this.llm!.complete({
        tier: "fast",
        system: DECISION_SYSTEM,
        messages: [{ role: "user", content: buildContext(this.game, c, events) }],
        schema: DECISION_SCHEMA,
      });
      if (this.status.mode !== "online") this.setStatus("online", "AI 已连接");
      this.apply(c, this.sanitize(raw), events);
    } catch (e) {
      this.handleError(e);
      // 失败的消息放回去，交给本地规则处理
      this.game.inbox.set(c.id, [...events, ...(this.game.inbox.get(c.id) ?? [])]);
      this.decideLocally(c);
    } finally {
      this.inFlight.delete(c.id);
      this.status.thinking = this.inFlight.size;
      if (c.emote?.icon === "…") c.emote = null;
      this.onStatus?.();
    }
  }

  private handleError(e: unknown) {
    const err = e instanceof AIError ? e : new AIError(String(e), "other");
    console.warn("AI 调用失败：", err);
    if (err.kind === "auth") {
      this.pauseUntil = Date.now() + 10 * 60_000;
      this.setStatus("error", "API Key 无效，已暂停 AI（去设置里检查）");
    } else if (err.kind === "rate") {
      this.pauseUntil = Date.now() + 60_000;
      this.setStatus("error", "被限流了，1 分钟后再试");
    } else if (err.kind === "network") {
      this.pauseUntil = Date.now() + 30_000;
      this.setStatus("error", err.message);
    } else {
      this.setStatus("error", err.message.slice(0, 60));
    }
  }

  /** 校验 AI 返回的内容，丢掉引用了不存在的家具/角色的步骤 */
  private sanitize(raw: unknown): Decision {
    const r = (raw ?? {}) as Record<string, unknown>;
    const steps = Array.isArray(r.plan) ? r.plan : [];
    const plan: PlanStep[] = [];
    for (const s of steps.slice(0, 5) as Record<string, unknown>[]) {
      const step = this.sanitizeStep(s);
      if (step) plan.push(step);
    }
    const emotion = EMOTIONS.includes(r.emotion as Emotion) ? (r.emotion as Emotion) : "normal";
    const rc = Array.isArray(r.relation_changes) ? (r.relation_changes as { target: string; delta: number; note: string }[]) : [];
    const cf = r.conflict as { with?: string; reason?: string } | undefined;
    return {
      thought: String(r.thought ?? "").slice(0, 120),
      emotion,
      plan,
      pace: ["slow", "normal", "fast"].includes(r.pace as string) ? (r.pace as Decision["pace"]) : undefined,
      memory: String(r.memory ?? "").slice(0, 200),
      relation_changes: rc.filter((x) => x && typeof x.target === "string"),
      conflict: cf?.with && cf.reason ? { with: cf.with, reason: cf.reason } : undefined,
    };
  }

  private sanitizeStep(s: Record<string, unknown>): PlanStep | null {
    const kinds = ["goto", "use", "eat", "talk", "say", "tell_player", "idle", "wander"];
    const d = String(s.do ?? "");
    if (!kinds.includes(d)) return null;
    const step: PlanStep = { do: d as PlanStep["do"] };
    const target = String(s.target ?? "");
    const line = String(s.line ?? "").slice(0, 80);
    const minutes = Number(s.minutes) || undefined;
    if (target) step.target = target;
    if (line) step.line = line;
    if (minutes) step.minutes = minutes;
    if (d === "use") {
      const f = this.game.world.getFurniture(target);
      if (!f) return null;
      const def = FURNITURE_BY_ID[f.def];
      const it = def.interactions.find((i) => i.id === s.interaction) ?? def.interactions[0];
      if (!it) return null;
      step.interaction = it.id;
    }
    if (d === "talk" && !this.game.byId(target)) return null;
    if ((d === "say" || d === "tell_player" || d === "talk") && !line) return null;
    return step;
  }

  private apply(c: Character, dec: Decision, events: GameEvent[]) {
    const g = this.game;
    if (dec.thought) {
      c.d.thought = dec.thought;
      g.log("thought", dec.thought, c.id);
    }
    c.setEmotion(dec.emotion);
    if (dec.pace) c.pace = dec.pace;
    if (dec.memory) this.remember(c, dec.memory, events.some((e) => e.priority >= 3) ? 2 : 1);
    for (const ch of dec.relation_changes ?? []) {
      const rel = c.d.relations[ch.target];
      if (!rel) continue;
      rel.affinity = clamp(rel.affinity + clamp(Number(ch.delta) || 0, -10, 10), -100, 100);
      if (ch.note) rel.note = ch.note.slice(0, 40);
    }
    if (dec.conflict) g.reportConflict(c, dec.conflict.with, dec.conflict.reason);

    // 主动找主人：主人不在看、或者十分钟内刚说过，就不打扰
    // （回应主人做的事，比如喂饭、赶去睡觉、调解，不受这个限制）
    let plan = dec.plan;
    const aboutPlayer = events.some((e) => e.text.includes("主人"));
    if (!aboutPlayer && (!g.playerWatching || Date.now() - c.lastTold < 10 * 60_000)) {
      plan = plan.filter((s) => s.do !== "tell_player");
    }
    // 被主人强制安排时：只执行说话，不起身
    if (Date.now() < c.forcedUntil) {
      for (const s of plan) {
        if (s.do === "tell_player" && s.line) g.tellPlayer(c, s.line);
        else if ((s.do === "say" || s.do === "talk") && s.line) { c.say(s.line); g.log("say", s.line, c.id); }
      }
      g.changed();
      return;
    }
    // 正在做长动作且没有急事时，新计划排在后面，不打断
    const urgent = events.some((e) => e.priority >= 3);
    const interrupt = urgent || c.idle || !c.run || c.run.phase === "path";
    if (plan.length) c.setPlan(plan, interrupt);
    g.changed();
  }

  remember(c: Character, text: string, weight = 1) {
    c.d.memories.push({ t: Date.now(), text, weight });
    // 记忆太多时，先丢掉最旧的普通记忆
    if (c.d.memories.length > 40) {
      const idx = c.d.memories.findIndex((m) => m.weight <= 1);
      c.d.memories.splice(idx >= 0 ? idx : 0, 1);
    }
  }

  /** 主人和角色聊天 */
  /** AI 有没有接上（本地模拟模式下不能用 AI 生成角色） */
  get hasAI() { return !!this.llm; }

  /** 让 AI 按玩家的描述生成一整套角色设定（返回未清洗的原始数据，由调用方清洗） */
  async generateCharacter(request: string): Promise<unknown> {
    if (!this.llm) throw new AIError("还没有接上 AI：先在「设置」里选 AI 服务并填上 API Key", "auth");
    const foods = FOODS.filter((f) => !["birthday_cake", "tangyuan", "zongzi", "mooncake"].includes(f.id)).map((f) => `${f.id}=${f.name}`).join("、");
    const furn = FURNITURE.filter((f) => f.interactions.some((i) => i.id !== "toggle")).map((f) => `${f.id}=${f.name}`).join("、");
    const rooms = this.game.world.rooms().join("、");
    return this.llm.complete({
      tier: "chat",
      system: CHARACTER_SYSTEM,
      maxTokens: 4000,
      schema: CHARACTER_SCHEMA,
      messages: [{ role: "user", content: `玩家想做的角色：${request}\n\n可选的食物 id：${foods}\n可选的家具 id：${furn}\n家里的房间：${rooms}` }],
    });
  }

  async chat(c: Character, text: string): Promise<string> {
    const g = this.game;
    c.d.chat.push({ t: Date.now(), from: "player", text });
    g.log("player", `对${c.name}说：${text}`);
    let res: { reply: string; emotion: Emotion; plan: PlanStep[]; memory?: string; affinity_delta?: number };
    if (this.llm && Date.now() > this.pauseUntil) {
      try {
        this.callTimes.push(Date.now());
        const history = c.d.chat.slice(-16);
        const msgs: { role: "user" | "assistant"; content: string }[] = [
          { role: "user", content: `（角色资料和当前处境，不是主人说的话）\n${buildContext(g, c, [])}` },
          { role: "assistant", content: "（我记住了，接下来用这个角色的身份和主人聊天。）" },
        ];
        for (const m of history) {
          const role = m.from === "player" ? "user" : "assistant";
          const last = msgs[msgs.length - 1];
          if (last.role === role) last.content += "\n" + m.text;
          else msgs.push({ role, content: m.text });
        }
        if (msgs[msgs.length - 1].role !== "user") msgs.push({ role: "user", content: text });
        const raw = (await this.llm.complete({ tier: "chat", system: CHAT_SYSTEM, messages: msgs, schema: CHAT_SCHEMA })) as Record<string, unknown>;
        const plan = (Array.isArray(raw.plan) ? raw.plan : []).map((s) => this.sanitizeStep(s as Record<string, unknown>)).filter(Boolean) as PlanStep[];
        res = {
          reply: String(raw.reply ?? "……"),
          emotion: EMOTIONS.includes(raw.emotion as Emotion) ? (raw.emotion as Emotion) : "normal",
          plan,
          memory: String(raw.memory ?? ""),
          affinity_delta: Number(raw.affinity_delta) || 0,
        };
      } catch (e) {
        this.handleError(e);
        res = { reply: "（AI 暂时连不上）" + mockChat(c, text).reply, emotion: "normal", plan: [] };
      }
    } else {
      res = mockChat(c, text);
    }
    c.d.chat.push({ t: Date.now(), from: "char", text: res.reply });
    if (c.d.chat.length > 200) c.d.chat.splice(0, c.d.chat.length - 200);
    c.say(res.reply);
    c.setEmotion(res.emotion);
    if (res.memory) this.remember(c, res.memory, 2);
    const rel = c.d.relations.player;
    if (rel && res.affinity_delta) rel.affinity = clamp(rel.affinity + clamp(res.affinity_delta, -5, 5), -100, 100);
    c.d.needs.social = clamp(c.d.needs.social + 5);
    // 主人在聊天里提的要求可以解除强制安排（比如「起来吧」）
    if (res.plan.length) { c.forcedUntil = 0; c.setPlan(res.plan, true); }
    g.log("say", `对主人：${res.reply}`, c.id);
    g.changed();
    return res.reply;
  }
}
