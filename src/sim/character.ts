// 角色的运行时：需求变化、生病、执行计划（走路、用家具、说话）。
// AI 只决定「接下来做什么」，具体怎么走、怎么用家具由这里负责。
import type { CharacterData, Emotion, FurnitureInst, Needs, PlanStep, Pose } from "../core/types";
import { FOOD_BY_ID, FURNITURE_BY_ID, type InteractionDef } from "../world/catalog";
import type { Game } from "./game";

const SPEED = 2.4; // 格/秒

interface Running {
  step: PlanStep;
  phase: "path" | "act";
  path: { x: number; y: number }[];
  furniture?: FurnitureInst;
  interaction?: InteractionDef;
  endsAt: number; // performance.now() 毫秒
  started: boolean;
  returnTo?: { x: number; y: number }; // 躺/坐到家具上之后，结束时回到的格子
}

export const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));

export class Character {
  d: CharacterData;
  queue: PlanStep[] = [];
  run: Running | null = null;
  pose: Pose = "stand";
  moving = false;
  hidden = false; // 躺在床上、泡在浴缸里时，角色本身不画，由家具立牌画出「有人」
  back = false; // 朝向屏幕里面（往上走）
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
  get tile() { return { x: Math.floor(this.d.pos.x), y: Math.floor(this.d.pos.y) }; }
  get room() { return this.game.world.roomOf(this.d.pos.x, this.d.pos.y); }
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

  /** 用新计划替换当前计划。正在做的事会被打断。 */
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

  private startStep(step: PlanStep) {
    const w = this.game.world;
    const run: Running = { step, phase: "path", path: [], endsAt: 0, started: false };
    if (step.emotion) this.setEmotion(step.emotion);

    const pathTo = (tx: number, ty: number) => w.findPath(this.tile.x, this.tile.y, tx, ty);

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
          run.interaction = FURNITURE_BY_ID[f.def].interactions.find((i) => i.tags?.includes("eat")) ?? FURNITURE_BY_ID[f.def].interactions[0];
        } else {
          f = w.getFurniture(step.target ?? "");
          if (!f) return;
          run.interaction = FURNITURE_BY_ID[f.def].interactions.find((i) => i.id === step.interaction) ?? FURNITURE_BY_ID[f.def].interactions[0];
        }
        if (!run.interaction) return;
        run.furniture = f;
        const occupant = this.game.occupantOf(f.uid);
        if (occupant && occupant !== this) {
          this.game.emit(this, `你想用${FURNITURE_BY_ID[f.def].name}${run.interaction.name}，但${occupant.name}正在用。`, 2);
          this.game.noteContention(this, occupant, FURNITURE_BY_ID[f.def].name);
          return;
        }
        const best = this.nearestSpot(w.accessSpots(f));
        if (!best) {
          this.game.emit(this, `你走不到${FURNITURE_BY_ID[f.def].name}那里。`, 1);
          return;
        }
        run.path = best.path;
        break;
      }
      case "goto": {
        const t = step.target ?? "";
        const f = w.getFurniture(t);
        const other = this.game.chars.find((c) => c.id === t || c.name === t);
        let p: { x: number; y: number }[] | null = null;
        if (f) p = this.nearestSpot(w.accessSpots(f))?.path ?? null;
        else if (other) p = this.nearestSpot(this.spotsAround(other))?.path ?? null;
        else {
          const tile = w.randomTileIn(t);
          if (tile) p = pathTo(tile.x, tile.y);
        }
        if (!p) return;
        run.path = p;
        break;
      }
      case "wander": {
        const tile = w.randomTileIn(Math.random() < 0.7 ? this.room : undefined);
        const p = tile ? pathTo(tile.x, tile.y) : null;
        if (!p) return;
        run.path = p.slice(0, 12);
        break;
      }
      case "talk": {
        const other = this.game.chars.find((c) => c.id === step.target || c.name === step.target);
        if (!other || other === this) return;
        const dist = Math.hypot(other.d.pos.x - this.d.pos.x, other.d.pos.y - this.d.pos.y);
        if (dist > 1.8) run.path = this.nearestSpot(this.spotsAround(other))?.path ?? [];
        break;
      }
      default:
        break;
    }
    this.run = run;
    this.d.activity = this.describeStep(step, run);
  }

  private spotsAround(other: Character) {
    const w = this.game.world;
    const { x, y } = other.tile;
    return [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]
      .map(([dx, dy]) => ({ x: x + dx, y: y + dy }))
      .filter((s) => w.walkable(s.x, s.y));
  }

  private nearestSpot(spots: { x: number; y: number }[]) {
    let best: { path: { x: number; y: number }[]; len: number } | null = null;
    for (const s of spots) {
      const p = this.game.world.findPath(this.tile.x, this.tile.y, s.x, s.y);
      if (p && (!best || p.length < best.len)) best = { path: p, len: p.length };
    }
    return best;
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

  /** 沿路径移动，还在走就返回 true */
  private followPath(path: { x: number; y: number }[], dt: number) {
    if (!path.length) {
      this.moving = false;
      return false;
    }
    const next = path[0];
    const tx = next.x + 0.5, ty = next.y + 0.5;
    const dx = tx - this.d.pos.x, dy = ty - this.d.pos.y;
    const dist = Math.hypot(dx, dy);
    const stepLen = SPEED * dt * (this.d.illness ? 0.7 : 1);
    this.moving = true;
    this.pose = "walk";
    // 屏幕上的左右：x 增大往右下，y 增大往左下
    const sx = dx - dy;
    if (Math.abs(sx) > 0.01) this.d.facing = sx > 0 ? 1 : -1;
    this.back = dx + dy < -0.01;
    if (dist <= stepLen) {
      this.d.pos.x = tx;
      this.d.pos.y = ty;
      path.shift();
    } else {
      this.d.pos.x += (dx / dist) * stepLen;
      this.d.pos.y += (dy / dist) * stepLen;
    }
    return true;
  }

  private beginAct(run: Running, now: number) {
    this.moving = false;
    this.back = false;
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
          this.hidden = it.pose === "lie";
          run.returnTo = { ...this.tile };
          const c = this.game.world.centerOf(f);
          this.d.pos.x = c.x;
          this.d.pos.y = c.y;
        } else {
          const c = this.game.world.centerOf(f);
          const sx = c.x - this.d.pos.x - (c.y - this.d.pos.y);
          if (Math.abs(sx) > 0.05) this.d.facing = sx > 0 ? 1 : -1;
          this.back = c.x + c.y < this.d.pos.x + this.d.pos.y;
        }
        if (it.turnsOn) f.state = { ...f.state, on: true };
        if (f.def === "lamp" && it.id === "toggle") f.state = { ...f.state, on: !f.state?.on };
        if (step.do === "eat" || it.tags?.includes("eat")) this.consumeFood(f);
        if (it.news) this.game.deliverNews(this, FURNITURE_BY_ID[f.def].name);
        if (it.tags?.includes("rest") && this.d.illness) this.showEmote("💤", 4);
        else if (it.pose === "lie") this.showEmote("💤", 4);
        break;
      }
      case "talk": {
        const other = this.game.chars.find((c) => c.id === step.target || c.name === step.target);
        if (other) {
          const sx = other.d.pos.x - this.d.pos.x - (other.d.pos.y - this.d.pos.y);
          if (Math.abs(sx) > 0.05) this.d.facing = sx > 0 ? 1 : -1;
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
      // 做饭完成：在最近的餐桌上放一份饭
      if (completed && run.interaction?.tags?.includes("cook")) this.game.cookedMeal(this);
      if (completed && f.def === "medicine" && this.d.illness) {
        this.d.illness.severity = clamp(this.d.illness.severity - 15);
        this.game.log("event", `${this.name}吃了药`, this.id);
      }
    }
    if (run.returnTo) {
      this.d.pos.x = run.returnTo.x + 0.5;
      this.d.pos.y = run.returnTo.y + 0.5;
    }
    this.hidden = false;
    this.pose = "stand";
    this.moving = false;
    if (!this.queue.length) this.d.activity = "发呆";
  }
}
