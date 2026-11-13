// 宠物猫：在家里自己溜达、找软的地方睡觉、偶尔跟着喜欢的人走；会饿，家里的人会去喂它、逗它玩。
import type { PetData } from "../core/types";
import { FURNITURE_BY_ID } from "../world/catalog";
import { LEVEL_SPAN, levelOf } from "../world/world";
import type { Game } from "./game";
import type { Character } from "./character";

export const PET_COLORS: { id: string; name: string; body: number; patch?: number }[] = [
  { id: "orange", name: "橘猫", body: 0xf2a65a },
  { id: "white", name: "白猫", body: 0xf7f4ef },
  { id: "black", name: "黑猫", body: 0x3a3540 },
  { id: "gray", name: "灰猫", body: 0x9aa0aa },
  { id: "calico", name: "三花", body: 0xf7f4ef, patch: 0xf2a65a },
  { id: "cream", name: "奶牛猫", body: 0xf7f4ef, patch: 0x3a3540 },
];
export const PET_COLOR = Object.fromEntries(PET_COLORS.map((c) => [c.id, c])) as Record<string, (typeof PET_COLORS)[number]>;

const SPEED = 0.9; // 格/秒

export class Pet {
  path: { x: number; y: number }[] = [];
  moving = false;
  facing: 1 | -1 = 1;
  emote: { icon: string; until: number } | null = null;
  private nextThink = 0;
  constructor(public d: PetData, private game: Game) {}

  get tile() { return { x: Math.floor(this.d.pos.x), y: Math.floor(this.d.pos.y) }; }
  get room() { return this.game.world.roomOf(this.d.pos.x, this.d.pos.y); }
  get asleep() { return this.d.state === "nap"; }
  showEmote(icon: string, seconds = 3) { this.emote = { icon, until: performance.now() + seconds * 1000 }; }

  update(dt: number) {
    const now = performance.now();
    if (this.emote && now > this.emote.until) this.emote = null;
    const m = (dt * this.game.settings.timeScale) / 60;
    this.d.hunger = Math.max(0, this.d.hunger - 0.05 * m);
    // 跟着人走：目标一直在动，隔一会儿重新找路
    if (this.d.state === "follow" && this.d.follow) {
      const who = this.game.byId(this.d.follow);
      if (!who || who.hidden) this.d.state = "idle";
      else if (now > this.nextThink && Math.hypot(who.d.pos.x - this.d.pos.x, who.d.pos.y - this.d.pos.y) > 1.6) {
        this.goTo(Math.floor(who.d.pos.x), Math.floor(who.d.pos.y) + 1);
        this.nextThink = now + 2500;
      }
    }
    if (this.path.length) { this.walk(dt); return; }
    this.moving = false;
    if (now < this.nextThink) return;
    this.think(now);
  }

  private walk(dt: number) {
    const next = this.path[0];
    if (Math.abs(next.y + 0.5 - this.d.pos.y) > 100) { this.d.pos = { x: next.x + 0.5, y: next.y + 0.5 }; this.path.shift(); return; }
    const dx = next.x + 0.5 - this.d.pos.x, dy = next.y + 0.5 - this.d.pos.y;
    const dist = Math.hypot(dx, dy), step = SPEED * dt;
    this.moving = true;
    if (Math.abs(dx) > 0.01) this.facing = dx > 0 ? 1 : -1;
    if (dist <= step) { this.d.pos = { x: next.x + 0.5, y: next.y + 0.5 }; this.path.shift(); }
    else { this.d.pos.x += (dx / dist) * step; this.d.pos.y += (dy / dist) * step; }
  }

  goTo(x: number, y: number) {
    const w = this.game.world;
    if (!w.walkable(x, y)) return false;
    const p = w.findPath(this.tile.x, this.tile.y, x, y, false, 1500);
    if (!p) return false;
    this.path = p.slice(0, 40);
    if (this.d.state === "nap") this.d.state = "idle";
    return true;
  }

  /** 下一步做什么：睡觉、溜达、跟着喜欢的人 */
  private think(now: number) {
    const w = this.game.world;
    const hour = new Date().getHours();
    const r = Math.random();
    if (this.d.state === "nap" && r < 0.7) { this.nextThink = now + 20_000 + Math.random() * 40_000; return; }
    // 猫一天大部分时间在睡觉
    if (r < (hour >= 22 || hour < 7 ? 0.6 : 0.35)) {
      const soft = w.data.furniture.filter((f) => levelOf(f.y) === levelOf(this.d.pos.y) && (FURNITURE_BY_ID[f.def]?.tags ?? []).some((t) => ["柔软", "毛绒", "猫咪", "暖和"].includes(t)));
      const f = soft[Math.floor(Math.random() * soft.length)];
      const spot = f && (FURNITURE_BY_ID[f.def]?.walkable ? { x: f.x, y: f.y } : w.accessSpots(f)[0]);
      if (spot && this.goTo(spot.x, spot.y)) { this.d.state = "nap"; this.nextThink = now + 30_000; return; }
      this.d.state = "nap"; this.nextThink = now + 25_000; return;
    }
    if (r < 0.55 && this.d.favorite) {
      const who = this.game.byId(this.d.favorite);
      if (who && !who.hidden && levelOf(who.d.pos.y) === levelOf(this.d.pos.y)) { this.d.state = "follow"; this.d.follow = who.id; this.nextThink = now + 30_000; return; }
    }
    // 在附近溜达
    this.d.state = "idle";
    for (let i = 0; i < 8; i++) {
      const x = this.tile.x + Math.round((Math.random() - 0.5) * 10), y = this.tile.y + Math.round((Math.random() - 0.5) * 8);
      if (this.goTo(x, y)) break;
    }
    this.nextThink = now + 6_000 + Math.random() * 10_000;
  }

  /** 有人来逗它 / 喂它 */
  playedWith(c: Character) {
    this.d.state = "idle";
    this.path = [];
    this.facing = c.d.pos.x > this.d.pos.x ? 1 : -1;
    this.showEmote("💕", 4);
    // 常来陪它的人会变成它最喜欢的人
    const love = (this.d.love ??= {});
    love[c.id] = (love[c.id] ?? 0) + 1;
    this.d.favorite = Object.entries(love).sort((a, b) => b[1] - a[1])[0][0];
    this.nextThink = performance.now() + 15_000;
  }
  fed(c: Character) { this.d.hunger = 100; this.showEmote("😋", 4); this.playedWith(c); }
}

export function newPet(game: Game, name: string, color: string): PetData {
  const t = game.world.randomTileIn(game.world.rooms().includes("客厅") ? "客厅" : undefined) ?? { x: 1, y: 1 };
  return { id: `pet_${Date.now().toString(36)}`, name: name.slice(0, 10) || "团子", color, pos: { x: t.x + 0.5, y: t.y + 0.5 }, hunger: 80, state: "idle" };
}

export { LEVEL_SPAN };
