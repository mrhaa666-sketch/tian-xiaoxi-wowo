// 角色的运行时：需求变化、生病、执行计划（走路、用家具、说话）。
// AI 只决定「接下来做什么」，具体怎么走、怎么用家具由这里负责。
import type { CharacterData, Emotion, FurnitureInst, Needs, PlanStep, Pose, Vec3 } from "../core/types";
import { FOOD_BY_ID, FURNITURE_BY_ID, type InteractionDef } from "../world/catalog";
import type { Game } from "./game";

const SPEED = 0.9; // 格/秒

interface Running {
  step: PlanStep;
  phase: "path" | "act";
  path: Vec3[];
  furniture?: FurnitureInst;
  interaction?: InteractionDef;
  endsAt: number; // performance.now() 毫秒
  started: boolean;
  returnTo?: Vec3; // 坐/躺到家具上之后，结束时回到的位置
}

export const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export class Character {
  d: CharacterData;
  queue: PlanStep[] = [];
  run: Running | null = null;
  pose: Pose = "stand";
  moving = false;
  hidden = false; // 躺在床上、泡在浴缸里时，角色本身不画，由家具画出「有人」
  speech: { text: string; until: number } | null = null;
  emote: { icon: string; until: number } | null = null;
  usingFurniture: string | null = null;
  lastTold = 0; // 上次主动找主人说话的时间
  forcedUntil = 0; // 被主人强制安排（比如赶回床上）的截止时间，期间 AI 只能让 TA 说话，不能起身
  private sickCheckAcc = 0;

  constructor(d: CharacterData, private game: Game) {
    this.d = d;
  }

  get id() { return this.d.id; }
  get name() { return this.d.name; }
  get room() { return this.game.world.roomName(this.d.pos); }
  get idle() { return !this.run && this.queue.length === 0; }

  setEmotion(e: Emotion | undefined) {
    if (e) this.d.emotion = e;
  }

  say(text: string, seconds = 5) {
    if (!text) return;
    this.speech = { text, until: performance.now() + Math.max(seconds, 2 + text.length * 0.25) * 1000 };
  }

  showEmote(icon: string, seconds = 3) {
    this.emote = { icon, until: performance.now() + seconds * 1000 };
  }

  /** 用新计划替换当前计划。interrupt 为 true 时，正在做的事会被打断。 */
  setPlan(steps: PlanStep[], interrupt = true) {
    if (interrupt) this.stopCurrent();
    this.queue = steps.slice();
  }

  stopCurrent() {
    if (!this.run) return;
    this.finishRun(false);
  }

  // ———————————————————— 每帧更新 ————————————————————

  update(dt: number) {
    const now = performance.now();
    if (this.speech && now > this.speech.until) this.speech = null;
    if (this.emote && now > this.emote.until) this.emote = null;
    this.updateNeeds(dt);
    if (!this.run && this.queue.length) this.startStep(this.queue.shift()!);
    if (this.run) this.updateRun(dt, now);
  }

  private updateNeeds(dt: number) {
    const m = (dt * this.game.settings.timeScale) / 60; // 经过的游戏分钟
    const n = this.d.needs;
    const resting = this.run?.phase === "act" && this.run.interaction?.tags?.includes("rest");
    n.hunger = clamp(n.hunger - 0.1 * m);
    if (!resting) n.energy = clamp(n.energy - (this.d.illness ? 0.12 : 0.07) * m);
    n.hygiene = clamp(n.hygiene - 0.04 * m);
    n.social = clamp(n.social - 0.05 * m);

    // 心情慢慢靠向「当前状态应有的心情」
    let target = 65;
    if (n.hunger < 30) target -= 15;
    if (n.energy < 25) target -= 10;
    if (n.hygiene < 30) target -= 8;
    if (n.social < 25) target -= 8;
    if (this.d.illness) target -= 15;
    n.mood = clamp(n.mood + (target - n.mood) * 0.004 * m);

    // 正在进行的家具交互带来的变化
    if (this.run?.phase === "act" && this.run.interaction) {
      for (const [k, v] of Object.entries(this.run.interaction.perMinute)) {
        const kk = k as keyof Needs;
        if (kk === "health") continue;
        n[kk] = clamp(n[kk] + (v as number) * m);
      }
    }

    // 生病
    const ill = this.d.illness;
    if (ill) {
      const tags = this.run?.phase === "act" ? this.run.interaction?.tags ?? [] : [];
      if (tags.includes("rest") || tags.includes("sick")) ill.severity -= 0.25 * m;
      else if (tags.includes("work")) ill.severity += 0.06 * m; // 带病工作会加重
      else ill.severity += 0.01 * m;
      ill.severity = clamp(ill.severity);
      n.health = clamp(100 - ill.severity);
      if (ill.severity <= 0) {
        this.d.illness = undefined;
        this.game.emit(this, `你的${ill.name}好了，身体舒服多了。`, 2);
        this.game.log("event", `${this.name}的${ill.name}痊愈了`, this.id);
      }
    } else {
      n.health = clamp(n.health + 0.05 * m);
      this.sickCheckAcc += m;
      if (this.sickCheckAcc >= 60) {
        this.sickCheckAcc -= 60;
        let p = 0.004;
        if (n.hygiene < 30) p += 0.02;
        if (n.energy < 20) p += 0.02;
        if (n.hunger < 20) p += 0.015;
        if (Math.random() < p) this.getSick();
      }
    }
  }

  getSick(name?: string) {
    const names = ["感冒", "发烧", "肚子疼", "头疼"];
    const ill = { name: name ?? names[Math.floor(Math.random() * names.length)], severity: 40 + Math.random() * 30, since: Date.now() };
    this.d.illness = ill;
    this.d.emotion = "sick";
    this.showEmote("🤒", 6);
    this.game.log("event", `${this.name}生病了：${ill.name}`, this.id);
    this.game.emit(this, `你生病了（${ill.name}），身体很难受。按你的性格决定怎么办。`, 3);
  }

  // ———————————————————— 执行计划 ————————————————————

  private pathTo(p: Vec3 | null) {
    return p ? this.game.world.findPath(this.d.pos, p) : null;
  }

  private startStep(step: PlanStep) {
    const w = this.game.world;
    const run: Running = { step, phase: "path", path: [], endsAt: 0, started: false };
    if (step.emotion) this.setEmotion(step.emotion);

    switch (step.do) {
      case "use":
      case "eat": {
        let f: FurnitureInst | undefined;
        if (step.do === "eat") {
          const food = this.game.findFoodFor(this);
          f = food ? w.getFurniture(food.furniture ?? "") : undefined;
          if (!f) {
            this.game.emit(this, "你想吃饭，但家里没有做好的饭菜。可以去冰箱拿零食，或者去灶台做饭。", 1);
            return;
          }
          const defs = FURNITURE_BY_ID[f.def].interactions;
          run.interaction = defs.find((i) => i.tags?.includes("eat")) ?? defs[0];
        } else {
          f = w.getFurniture(step.target ?? "");
          if (!f) return;
          const defs = FURNITURE_BY_ID[f.def].interactions;
          run.interaction = defs.find((i) => i.id === step.interaction) ?? defs[0];
        }
        if (!run.interaction) return;
        run.furniture = f;
        const occupant = this.game.occupantOf(f.uid);
        if (occupant && occupant !== this) {
          this.game.emit(this, `你想用${FURNITURE_BY_ID[f.def].name}${run.interaction.name}，但${occupant.name}正在用。`, 2);
          this.game.noteContention(this, occupant, FURNITURE_BY_ID[f.def].name);
          return;
        }
        // 先走到家具前（坐/躺的家具也是先走到前面，开始时再坐上去）
        const spot = w.spotFor(f, run.interaction.onTop ? undefined : run.interaction);
        const p = this.pathTo(spot);
        if (!p) {
          this.game.emit(this, `你走不到${FURNITURE_BY_ID[f.def].name}那里（可能没有楼梯连通）。`, 1);
          return;
        }
        run.path = p;
        break;
      }
      case "goto": {
        const t = step.target ?? "";
        const f = w.getFurniture(t);
        const other = this.game.chars.find((c) => c.id === t || c.name === t);
        let p: Vec3[] | null = null;
        if (f) p = this.pathTo(w.spotFor(f));
        else if (other) p = this.pathTo(this.besideOf(other));
        else p = this.pathTo(w.randomSpotIn(t));
        if (!p) return;
        run.path = p;
        break;
      }
      case "wander": {
        const here = this.room;
        const p = this.pathTo(w.randomSpotIn(Math.random() < 0.7 && w.roomByName(here) ? here : undefined));
        if (!p) return;
        run.path = p;
        break;
      }
      case "talk": {
        const other = this.game.chars.find((c) => c.id === step.target || c.name === step.target);
        if (!other || other === this) return;
        const dist = Math.hypot(other.d.pos.x - this.d.pos.x, (other.d.pos.y - this.d.pos.y) * 3);
        if (dist > 0.45) run.path = this.pathTo(this.besideOf(other)) ?? [];
        break;
      }
      default:
        break;
    }
    this.run = run;
    this.d.activity = this.describeStep(step, run);
  }

  /** 另一个角色身边的位置 */
  private besideOf(other: Character): Vec3 {
    const r = this.game.world.roomOfPos(other.d.pos);
    const side = this.d.pos.x < other.d.pos.x ? -0.28 : 0.28;
    let x = other.d.pos.x + side;
    if (r) x = Math.max(r.gx + 0.08, Math.min(r.gx + r.w - 0.08, x));
    return { x, y: other.d.pos.y, z: Math.min(0.92, Math.max(0.5, other.d.pos.z)) };
  }

  describeStep(step: PlanStep, run?: Running) {
    const fname = run?.furniture ? FURNITURE_BY_ID[run.furniture.def].name : "";
    switch (step.do) {
      case "use": return run?.interaction ? `${run.interaction.name}（${fname}）` : "用家具";
      case "eat": return "吃饭";
      case "goto": return `去${this.game.labelOf(step.target ?? "")}`;
      case "talk": return `和${this.game.labelOf(step.target ?? "")}说话`;
      case "tell_player": return "找主人说话";
      case "wander": return "四处走走";
      case "idle": return "发呆";
      case "say": return "自言自语";
      default: return "发呆";
    }
  }

  private updateRun(dt: number, now: number) {
    const run = this.run!;
    if (run.phase === "path") {
      if (this.followPath(run.path, dt)) return;
      run.phase = "act";
    }
    if (!run.started) {
      run.started = true;
      this.beginAct(run, now);
    }
    if (now >= run.endsAt) this.finishRun(true);
  }

  /** 沿路点移动，还在走就返回 true */
  private followPath(path: Vec3[], dt: number) {
    if (!path.length) {
      this.moving = false;
      return false;
    }
    const p = this.d.pos;
    const next = path[0];
    // 纵深方向在画面上更短，走得快一些；上下楼慢一些
    const dx = next.x - p.x, dy = next.y - p.y, dz = (next.z - p.z) * 0.5;
    const dist = Math.hypot(dx, dy * 1.4, dz);
    const stepLen = SPEED * dt * (this.d.illness ? 0.7 : 1);
    this.moving = true;
    this.pose = "walk";
    if (Math.abs(dx) > 0.01) this.d.facing = dx > 0 ? 1 : -1;
    if (dist <= stepLen || dist < 1e-4) {
      p.x = next.x; p.y = next.y; p.z = next.z;
      path.shift();
    } else {
      const k = stepLen / dist;
      p.x += dx * k; p.y += dy * k; p.z += (next.z - p.z) * k;
    }
    return true;
  }

  private beginAct(run: Running, now: number) {
    this.moving = false;
    const step = run.step;
    const scale = this.game.settings.timeScale;
    const secondsFor = (minutes: number) => (minutes * 60) / scale;
    switch (step.do) {
      case "use":
      case "eat": {
        const it = run.interaction!;
        const f = run.furniture!;
        // 家具可能在路上被别人占了
        const occupant = this.game.occupantOf(f.uid);
        if (occupant && occupant !== this) {
          this.game.emit(this, `你走到${FURNITURE_BY_ID[f.def].name}前，发现${occupant.name}已经在用了。`, 2);
          this.game.noteContention(this, occupant, FURNITURE_BY_ID[f.def].name);
          run.endsAt = now;
          return;
        }
        const minutes = clamp(step.minutes ?? it.minutes[0], it.minutes[0], it.minutes[1]);
        run.endsAt = now + secondsFor(minutes) * 1000;
        this.usingFurniture = f.uid;
        this.pose = it.pose;
        if (it.onTop) {
          run.returnTo = { ...this.d.pos };
          const s = this.game.world.spotFor(f, it);
          if (s) this.d.pos = { ...s };
          this.hidden = it.pose === "lie";
        }
        if (it.turnsOn) f.state = { ...f.state, on: true };
        if (f.def === "lamp" && it.id === "toggle") f.state = { ...f.state, on: !f.state?.on };
        if (step.do === "eat" || it.tags?.includes("eat")) this.consumeFood(f);
        if (it.news) this.game.deliverNews(this, FURNITURE_BY_ID[f.def].name);
        if (it.pose === "lie") this.showEmote("💤", 4);
        break;
      }
      case "talk": {
        const other = this.game.chars.find((c) => c.id === step.target || c.name === step.target);
        if (other) {
          if (Math.abs(other.d.pos.x - this.d.pos.x) > 0.02) this.d.facing = other.d.pos.x > this.d.pos.x ? 1 : -1;
          if (step.line) {
            this.say(step.line);
            this.game.deliverTalk(this, other, step.line);
          }
        }
        run.endsAt = now + Math.max(3, (step.line?.length ?? 6) * 0.25) * 1000;
        break;
      }
      case "say":
        if (step.line) {
          this.say(step.line);
          this.game.log("say", step.line, this.id);
        }
        run.endsAt = now + 3000;
        break;
      case "tell_player":
        if (step.line) this.game.tellPlayer(this, step.line);
        run.endsAt = now + 3000;
        break;
      case "idle":
        this.pose = "stand";
        run.endsAt = now + secondsFor(clamp(step.minutes ?? 1, 0.2, 30)) * 1000;
        break;
      default:
        run.endsAt = now + 500;
    }
  }

  private consumeFood(f: FurnitureInst) {
    const foods = this.game.world.foodsOn(f.uid);
    const food = foods.find((x) => x.forChar === this.id) ?? foods.find((x) => !x.forChar);
    if (!food) return;
    const def = FOOD_BY_ID[food.kind];
    this.game.world.data.foods = this.game.world.data.foods.filter((x) => x !== food);
    this.d.needs.hunger = clamp(this.d.needs.hunger + (def?.hunger ?? 30));
    this.d.needs.mood = clamp(this.d.needs.mood + (def?.mood ?? 3));
    if (this.d.illness && food.kind === "porridge") this.d.illness.severity = clamp(this.d.illness.severity - 10);
    this.showEmote("😋", 3);
    this.game.log("event", `${this.name}吃了${def?.name ?? "饭"}`, this.id);
  }

  private finishRun(completed: boolean) {
    const run = this.run;
    if (!run) return;
    this.run = null;
    const f = run.furniture;
    if (f && this.usingFurniture === f.uid) {
      this.usingFurniture = null;
      if (run.interaction?.turnsOn && !this.game.occupantOf(f.uid)) f.state = { ...f.state, on: false };
      // 做饭完成：在餐桌上放一份饭
      if (completed && run.interaction?.tags?.includes("cook")) this.game.cookedMeal(this);
      if (completed && f.def === "medicine" && this.d.illness) {
        this.d.illness.severity = clamp(this.d.illness.severity - 15);
        this.game.log("event", `${this.name}吃了药`, this.id);
      }
    }
    if (run.returnTo) this.d.pos = { ...run.returnTo };
    this.hidden = false;
    this.pose = "stand";
    this.moving = false;
    if (!this.queue.length) this.d.activity = "发呆";
  }
}
