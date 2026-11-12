// 场景渲染：地板、墙、家具、食物、角色、气泡，以及镜头（拖动、缩放）。
import { Application, Container, Graphics, Text } from "pixi.js";
import type { FurnitureInst } from "../core/types";
import type { Character } from "../sim/character";
import type { Game } from "../sim/game";
import { FLOOR_BY, FOOD_COLORS } from "./palette";
import { FURNITURE_BY_ID, WALL_STYLES } from "../world/catalog";
import { footprint, key } from "../world/world";
import { ProceduralSkin, type CharSkin } from "./charview";
import { WALL_H, WALL_LOW, shade, toGrid, toScreen } from "./iso";

const WALL_BY = Object.fromEntries(WALL_STYLES.map((w) => [w.id, w]));

export interface Ghost {
  kind: "tile" | "edge" | "furniture" | "rect";
  x: number;
  y: number;
  w?: number;
  h?: number;
  dir?: "N" | "W";
  def?: string;
  rot?: 0 | 1;
  ok: boolean;
}

export class Scene {
  app = new Application();
  camera = new Container();
  private floorG = new Graphics();
  private objects = new Container();
  private ghostG = new Graphics();
  private overlay = new Container();
  private tint = new Graphics();
  private skins = new Map<string, CharSkin>();
  private bubbles = new Map<string, { box: Container; bg: Graphics; text: Text; emote: Text; name: Text }>();
  private builtVersion = -1;
  private builtWallMode = "";
  private staticObjs: Container[] = [];
  selected: string | null = null;
  ghost: Ghost | null = null;
  zoom = 0.7;

  constructor(private game: Game) {}

  async init(host: HTMLElement) {
    await this.app.init({ resizeTo: host, background: 0xeef1f6, antialias: true, resolution: Math.min(window.devicePixelRatio, 2), autoDensity: true });
    host.appendChild(this.app.canvas);
    this.objects.sortableChildren = true;
    this.camera.addChild(this.floorG, this.objects, this.ghostG);
    this.zoom = Math.min(0.7, Math.max(0.35, this.app.screen.width / 1900));
    this.app.stage.addChild(this.camera, this.tint, this.overlay);
    this.camera.scale.set(this.zoom);
    this.centerOn(5, 4);
  }

  setBackground(color: number) {
    this.app.renderer.background.color = color;
  }

  centerOn(gx: number, gy: number) {
    const s = toScreen(gx, gy);
    this.camera.x = this.app.screen.width / 2 - s.x * this.zoom;
    this.camera.y = this.app.screen.height / 2 - s.y * this.zoom;
  }

  panBy(dx: number, dy: number) {
    this.camera.x += dx;
    this.camera.y += dy;
  }

  zoomAt(factor: number, sx: number, sy: number) {
    const z = Math.min(2.2, Math.max(0.25, this.zoom * factor));
    const k = z / this.zoom;
    this.camera.x = sx - (sx - this.camera.x) * k;
    this.camera.y = sy - (sy - this.camera.y) * k;
    this.zoom = z;
    this.camera.scale.set(z);
  }

  /** 屏幕坐标 → 格子坐标（小数） */
  screenToGrid(sx: number, sy: number) {
    return toGrid((sx - this.camera.x) / this.zoom, (sy - this.camera.y) / this.zoom);
  }

  gridToScreen(gx: number, gy: number) {
    const s = toScreen(gx, gy);
    return { x: s.x * this.zoom + this.camera.x, y: s.y * this.zoom + this.camera.y };
  }

  /** 点到了哪个角色 */
  pickCharacter(sx: number, sy: number): Character | null {
    let best: { c: Character; d: number } | null = null;
    for (const c of this.game.chars) {
      const p = this.gridToScreen(c.d.pos.x, c.d.pos.y);
      const dx = sx - p.x, dy = sy - (p.y - 50 * this.zoom);
      const d = Math.hypot(dx, dy * 0.7);
      if (d < 50 * this.zoom && (!best || d < best.d)) best = { c, d };
    }
    return best?.c ?? null;
  }

  // ———————————————————— 静态部分：地板、墙、家具 ————————————————————

  private rebuildStatic() {
    const w = this.game.world;
    const cutaway = this.game.settings.wallMode === "cutaway";
    this.builtVersion = w.version;
    this.builtWallMode = this.game.settings.wallMode;
    for (const o of this.staticObjs) o.destroy({ children: true });
    this.staticObjs = [];

    const fg = this.floorG;
    fg.clear();
    for (const [k, t] of Object.entries(w.data.tiles)) {
      const [x, y] = k.split(",").map(Number);
      const fl = FLOOR_BY[t.floor] ?? FLOOR_BY.wood;
      const pts = [toScreen(x, y), toScreen(x + 1, y), toScreen(x + 1, y + 1), toScreen(x, y + 1)];
      fg.poly(pts.flatMap((p) => [p.x, p.y])).fill((x + y) % 2 ? fl.color : shade(fl.color, 0.97)).stroke({ width: 1, color: fl.line, alpha: 0.6 });
    }

    // 墙
    for (const [k, wall] of Object.entries(w.data.walls)) {
      const [xs, ys, d] = k.split(",");
      const x = Number(xs), y = Number(ys);
      const dir = d as "N" | "W";
      const behindEmpty = dir === "N" ? !w.tile(x, y - 1) : !w.tile(x - 1, y);
      const frontEmpty = !w.tile(x, y);
      if (behindEmpty && frontEmpty) continue;
      const isBack = behindEmpty && !frontEmpty;
      const h = cutaway && !isBack ? WALL_LOW : WALL_H;
      const style = WALL_BY[wall.style] ?? WALL_STYLES[0];
      const a = toScreen(x, y);
      const b = dir === "N" ? toScreen(x + 1, y) : toScreen(x, y + 1);
      const g = new Graphics();
      const base = dir === "N" ? style.color : shade(style.color, 0.9);
      const lerp = (u: number, v: number) => ({ x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u - v });
      const quad = (u0: number, u1: number, v0: number, v1: number) => {
        const p = [lerp(u0, v0), lerp(u1, v0), lerp(u1, v1), lerp(u0, v1)];
        return p.flatMap((q) => [q.x, q.y]);
      };
      if (wall.kind === "door") {
        g.poly(quad(0, 0.12, 0, h)).fill(base).poly(quad(0.88, 1, 0, h)).fill(base);
        if (h > WALL_LOW) g.poly(quad(0.12, 0.88, h * 0.78, h)).fill(base);
        g.poly(quad(0.12, 0.88, 0, 3)).fill(0xb98b62);
      } else {
        g.poly(quad(0, 1, 0, h)).fill(base).stroke({ width: 1, color: shade(base, 0.85) });
        g.poly(quad(0, 1, h, h + 6)).fill(style.top);
        if (wall.kind === "window" && h > WALL_LOW) {
          const hour = new Date().getHours();
          const sky = hour >= 19 || hour < 6 ? 0x2f3d66 : hour < 8 || hour >= 17 ? 0xf6c59a : 0xa9d8f5;
          g.poly(quad(0.2, 0.8, h * 0.35, h * 0.8)).fill(sky).stroke({ width: 4, color: 0xffffff });
          g.poly(quad(0.49, 0.51, h * 0.35, h * 0.8)).fill(0xffffff);
        } else if (wall.kind === "window") {
          g.poly(quad(0.2, 0.8, h, h + 6)).fill(0xa9d8f5);
        }
      }
      // 墙要画在它后面那一格的东西之后、前面那一格之前
      g.zIndex = (x + y) * 10 - (dir === "N" ? 4 : 4) + (dir === "N" ? 0.1 : 0);
      this.objects.addChild(g);
      this.staticObjs.push(g);
    }
  }

  private furnitureViews = new Map<string, { box: Container; g: Graphics; label: Text; stateKey: string }>();

  private drawFurniture(f: FurnitureInst) {
    const def = FURNITURE_BY_ID[f.def];
    if (!def) return;
    const stateKey = JSON.stringify(f.state ?? {}) + f.x + "," + f.y + f.rot + this.game.world.foodsOn(f.uid).length;
    let v = this.furnitureViews.get(f.uid);
    if (v && v.stateKey === stateKey) return;
    if (!v) {
      const box = new Container();
      const g = new Graphics();
      const label = new Text({ text: def.icon, style: { fontFamily: "Noto Sans SC, sans-serif", fontSize: 18, fill: 0x4a3b3b, fontWeight: "700" } });
      label.anchor.set(0.5);
      label.alpha = 0.55;
      box.addChild(g, label);
      v = { box, g, label, stateKey: "" };
      this.furnitureViews.set(f.uid, v);
      this.objects.addChild(box);
    }
    v.stateKey = stateKey;
    const g = v.g;
    g.clear();
    const { w, h } = footprint(f);
    const H = def.height;
    const A = toScreen(f.x, f.y), B = toScreen(f.x + w, f.y), C = toScreen(f.x + w, f.y + h), D = toScreen(f.x, f.y + h);
    const inset = def.walkable ? 0 : 0.08;
    const lerp = (p: { x: number; y: number }, q: { x: number; y: number }, u: number) => ({ x: p.x + (q.x - p.x) * u, y: p.y + (q.y - p.y) * u });
    // 往里收一点，家具之间留出缝
    const a = lerp(A, C, inset), c = lerp(C, A, inset), b = lerp(B, D, inset), d = lerp(D, B, inset);
    const up = (p: { x: number; y: number }) => ({ x: p.x, y: p.y - H });
    const on = f.state?.on;
    const top = def.top ?? shade(def.color, 1.12);
    g.poly([d, c, up(c), up(d)].flatMap((p) => [p.x, p.y])).fill(shade(def.color, 0.82)).stroke({ width: 1.5, color: shade(def.color, 0.6) });
    g.poly([c, b, up(b), up(c)].flatMap((p) => [p.x, p.y])).fill(shade(def.color, 0.68)).stroke({ width: 1.5, color: shade(def.color, 0.55) });
    g.poly([up(a), up(b), up(c), up(d)].flatMap((p) => [p.x, p.y])).fill(top).stroke({ width: 1.5, color: shade(def.color, 0.6) });
    // 家具细节
    if (f.def === "bed") {
      const pil = lerp(up(a), up(c), 0.18);
      g.ellipse(pil.x, pil.y, 22, 10).fill(0xffffff).stroke({ width: 1, color: 0xcccccc });
      g.poly([lerp(up(a), up(d), 0.45), lerp(up(b), up(c), 0.45), up(c), up(d)].flatMap((p) => [p.x, p.y])).fill(def.color);
    }
    if ((f.def === "tv" || f.def === "desk") && on) {
      const s = lerp(up(a), up(c), 0.5);
      g.roundRect(s.x - 18, s.y - 30, 36, 24, 3).fill(0x9fe0ff).stroke({ width: 2, color: 0x333333 });
    }
    if (f.def === "stove" && on) {
      const s = lerp(up(a), up(c), 0.5);
      g.ellipse(s.x, s.y, 12, 6).fill({ color: 0xff8a3d, alpha: 0.9 });
    }
    if (f.def === "lamp" && on) {
      const s = lerp(a, c, 0.5);
      g.ellipse(s.x, s.y, 70, 35).fill({ color: 0xffe9a8, alpha: 0.25 });
    }
    if (f.def === "plant") {
      const s = up(lerp(a, c, 0.5));
      g.circle(s.x, s.y - 14, 20).fill(0x5aa95e).circle(s.x - 12, s.y - 4, 13).fill(0x6fbf73).circle(s.x + 12, s.y - 6, 13).fill(0x4f9a53);
    }
    // 桌上的食物
    const foods = this.game.world.foodsOn(f.uid);
    foods.forEach((food, i) => {
      const s = up(lerp(a, c, 0.35 + i * 0.2));
      g.ellipse(s.x, s.y, 13, 7).fill(0xffffff).stroke({ width: 1.5, color: 0xaaaaaa });
      g.ellipse(s.x, s.y - 3, 9, 5).fill(FOOD_COLORS[food.kind] ?? 0xf2a65a);
    });
    const center = up(lerp(a, c, 0.5));
    v.label.position.set(center.x, center.y);
    v.label.visible = !!def.icon && f.def !== "plant";
    // 深度：取家具最靠前的那一格
    v.box.zIndex = def.walkable ? -1000 : (f.x + w - 1 + f.y + h - 1) * 10 + 1;
  }

  // ———————————————————— 每帧 ————————————————————

  update(t: number) {
    const w = this.game.world;
    if (w.version !== this.builtVersion || this.game.settings.wallMode !== this.builtWallMode) {
      this.rebuildStatic();
      for (const [id, v] of this.furnitureViews) if (!w.getFurniture(id)) { v.box.destroy({ children: true }); this.furnitureViews.delete(id); }
    }
    for (const f of w.data.furniture) this.drawFurniture(f);

    // 角色
    const alive = new Set(this.game.chars.map((c) => c.id));
    for (const [id, s] of this.skins) if (!alive.has(id)) { s.view.destroy({ children: true }); this.skins.delete(id); }
    for (const [id, b] of this.bubbles) if (!alive.has(id)) { b.box.destroy({ children: true }); this.bubbles.delete(id); }
    for (const c of this.game.chars) {
      let skin = this.skins.get(c.id);
      if (!skin) {
        skin = new ProceduralSkin();
        this.skins.set(c.id, skin);
        this.objects.addChild(skin.view);
      }
      skin.update(c, t);
      const p = toScreen(c.d.pos.x, c.d.pos.y);
      skin.view.position.set(p.x, p.y);
      const onTop = c.run?.phase === "act" && c.run.interaction?.onTop;
      skin.view.zIndex = (c.d.pos.x + c.d.pos.y - 1) * 10 + (onTop ? 6 : 5);
      this.updateBubble(c);
    }
    this.drawGhost();
    this.drawTint();
  }

  private updateBubble(c: Character) {
    let b = this.bubbles.get(c.id);
    if (!b) {
      const box = new Container();
      const bg = new Graphics();
      const text = new Text({ text: "", style: { fontFamily: "Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif", fontSize: 14, fill: 0x2e2a33, wordWrap: true, wordWrapWidth: 170, breakWords: true, lineHeight: 19 } });
      const emote = new Text({ text: "", style: { fontSize: 22, fontFamily: "sans-serif" } });
      const name = new Text({ text: "", style: { fontFamily: "Noto Sans SC, sans-serif", fontSize: 12, fill: 0xffffff, fontWeight: "700" } });
      emote.anchor.set(0.5, 1);
      name.anchor.set(0.5, 0);
      box.addChild(bg, text, emote, name);
      this.overlay.addChild(box);
      b = { box, bg, text, emote, name };
      this.bubbles.set(c.id, b);
    }
    const head = this.gridToScreen(c.d.pos.x, c.d.pos.y);
    const topY = head.y - (c.pose === "lie" ? 50 : 112) * this.zoom;
    b.box.position.set(head.x, topY);
    b.emote.text = c.emote?.icon ?? "";
    b.emote.position.set(0, -4);
    const sel = this.selected === c.id;
    b.name.text = c.name;
    b.name.visible = sel || this.zoom < 0.5;
    b.name.position.set(0, (c.pose === "lie" ? 60 : 118) * this.zoom);
    b.bg.clear();
    if (b.name.visible) {
      const nw = b.name.width + 12;
      b.bg.roundRect(-nw / 2, b.name.y - 2, nw, 18, 9).fill({ color: sel ? 0x3f7f86 : 0x2e2a33, alpha: 0.85 });
    }
    if (c.speech) {
      b.text.text = c.speech.text;
      const tw = b.text.width, th = b.text.height;
      const pad = 8;
      const by = -th - pad * 2 - (c.emote ? 26 : 8);
      b.text.position.set(-tw / 2, by + pad);
      b.bg.roundRect(-tw / 2 - pad, by, tw + pad * 2, th + pad * 2, 10).fill({ color: 0xffffff, alpha: 0.96 }).stroke({ width: 1.5, color: 0xc9c2d6 });
      b.bg.poly([-6, by + th + pad * 2, 6, by + th + pad * 2, 0, by + th + pad * 2 + 8]).fill(0xffffff);
      b.text.visible = true;
      b.emote.position.set(0, by - 2);
    } else {
      b.text.visible = false;
    }
    if (sel) {
      const ring = this.gridToScreen(c.d.pos.x, c.d.pos.y);
      b.bg.ellipse(ring.x - head.x, ring.y - topY, 30 * this.zoom, 14 * this.zoom).stroke({ width: 2.5, color: 0x3f7f86, alpha: 0.9 });
    }
  }

  private drawGhost() {
    const g = this.ghostG;
    g.clear();
    const gh = this.ghost;
    if (!gh) return;
    const color = gh.ok ? 0x3fae6a : 0xe05a5a;
    const diamond = (x: number, y: number, w: number, h: number) =>
      [toScreen(x, y), toScreen(x + w, y), toScreen(x + w, y + h), toScreen(x, y + h)].flatMap((p) => [p.x, p.y]);
    if (gh.kind === "tile") g.poly(diamond(gh.x, gh.y, 1, 1)).fill({ color, alpha: 0.35 }).stroke({ width: 2, color });
    if (gh.kind === "rect") g.poly(diamond(gh.x, gh.y, gh.w ?? 1, gh.h ?? 1)).fill({ color, alpha: 0.25 }).stroke({ width: 2, color });
    if (gh.kind === "edge") {
      const a = toScreen(gh.x, gh.y);
      const b = gh.dir === "N" ? toScreen(gh.x + 1, gh.y) : toScreen(gh.x, gh.y + 1);
      g.poly([a.x, a.y, b.x, b.y, b.x, b.y - 60, a.x, a.y - 60]).fill({ color, alpha: 0.35 }).stroke({ width: 2, color });
    }
    if (gh.kind === "furniture" && gh.def) {
      const def = FURNITURE_BY_ID[gh.def];
      const { w, h } = gh.rot === 1 ? { w: def.h, h: def.w } : { w: def.w, h: def.h };
      g.poly(diamond(gh.x, gh.y, w, h)).fill({ color, alpha: 0.35 }).stroke({ width: 2, color });
      const c = toScreen(gh.x + w / 2, gh.y + h / 2);
      g.moveTo(c.x, c.y).lineTo(c.x, c.y - def.height).stroke({ width: 2, color });
    }
  }

  private drawTint() {
    const h = new Date().getHours() + new Date().getMinutes() / 60;
    let alpha = 0;
    let color = 0x1d2b5c;
    if (h >= 21 || h < 5) alpha = 0.26;
    else if (h >= 19) alpha = 0.16;
    else if (h >= 17) { alpha = 0.1; color = 0xf2994a; }
    else if (h < 7) alpha = 0.12;
    this.tint.clear();
    if (alpha > 0) this.tint.rect(0, 0, this.app.screen.width, this.app.screen.height).fill({ color, alpha });
  }

  tileKeyAt(sx: number, sy: number) {
    const g = this.screenToGrid(sx, sy);
    return key(Math.floor(g.x), Math.floor(g.y));
  }
}
