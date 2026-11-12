// 场景渲染：娃娃屋的房间盒子、家具立牌、角色立牌、气泡，以及镜头（拖动、缩放）。
import { Application, Container, Graphics, Text } from "pixi.js";
import type { FurnitureInst, RoomInst, Vec3 } from "../core/types";
import type { Character } from "../sim/character";
import type { Game } from "../sim/game";
import { FLOORS, FOODS, FURNITURE_BY_ID, ROOM_TYPE_BY_ID, WALL_STYLES } from "../world/catalog";
import { ProceduralSkin, type CharSkin } from "./charview";
import { CELL_H, CELL_W, SLAB, hex, project, rectOf, roomRect, shade, unproject, type RoomRect } from "./iso";
import { drawStandee } from "./standees";

const FLOOR_BY = Object.fromEntries(FLOORS.map((f) => [f.id, f]));
const WALL_BY = Object.fromEntries(WALL_STYLES.map((w) => [w.id, w]));
const FOOD_COLOR = Object.fromEntries(FOODS.map((f) => [f.id, f.color])) as Record<string, number>;
const CHAR_SCALE = 1.55;
const FONT = "Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif";

export type Ghost =
  | { kind: "room"; gx: number; gy: number; w: number; ok: boolean }
  | { kind: "furniture"; room: string; x: number; z: number; def: string; ok: boolean }
  | { kind: "highlight-furniture"; uid: string }
  | { kind: "highlight-room"; uid: string; ok: boolean };

function skyColor(h: number) {
  if (h >= 20 || h < 5) return 0x26304f;
  if (h >= 18) return 0xf2b48c;
  if (h < 7) return 0xf6c9a8;
  return 0xbfe3f5;
}

export class Scene {
  app = new Application();
  camera = new Container();
  private backdrop = new Graphics();
  private roomLayer = new Container();
  private objects = new Container();
  private ghostG = new Graphics();
  private overlay = new Container();
  private tint = new Graphics();
  private skins = new Map<string, CharSkin>();
  private bubbles = new Map<string, { box: Container; bg: Graphics; text: Text; emote: Text; name: Text }>();
  private furnViews = new Map<string, { box: Container; shadow: Graphics; g: Graphics; key: string }>();
  private builtVersion = -1;
  private builtHour = -1;
  selected: string | null = null;
  ghost: Ghost | null = null;
  zoom = 0.6;
  /** 镜头模式：全景（整栋房子）或单间（一个房间铺满画面） */
  view: { mode: "all" } | { mode: "room"; uid: string } = { mode: "all" };
  private camTarget: { x: number; y: number; zoom: number } | null = null;

  constructor(private game: Game) {}

  async init(host: HTMLElement) {
    await this.app.init({ resizeTo: host, background: 0xeef1f6, antialias: true, resolution: Math.min(window.devicePixelRatio, 2), autoDensity: true });
    host.appendChild(this.app.canvas);
    this.objects.sortableChildren = true;
    this.camera.addChild(this.backdrop, this.roomLayer, this.objects, this.ghostG);
    this.app.stage.addChild(this.camera, this.tint, this.overlay);
    this.zoom = Math.min(0.62, Math.max(0.28, this.app.screen.width / 2600));
    this.camera.scale.set(this.zoom);
    this.centerOnHouse();
  }

  /** 让世界里的一块矩形区域铺满画面（留出界面占用的边距） */
  private fitRect(x0: number, y0: number, x1: number, y1: number, instant = false) {
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const narrow = sw < 760;
    const padL = narrow ? 12 : 250, padR = narrow ? 12 : (this.selected ? 370 : 24), padT = 76, padB = narrow ? 120 : 30;
    const aw = Math.max(100, sw - padL - padR), ah = Math.max(100, sh - padT - padB);
    const zoom = Math.min(1.6, aw / (x1 - x0), ah / (y1 - y0));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const t = { zoom, x: padL + aw / 2 - cx * zoom, y: padT + ah / 2 - cy * zoom };
    if (instant) { this.zoom = t.zoom; this.camera.x = t.x; this.camera.y = t.y; this.camera.scale.set(t.zoom); this.camTarget = null; }
    else this.camTarget = t;
  }

  /** 全景：整栋房子 */
  showAll(instant = false) {
    this.view = { mode: "all" };
    const rooms = this.game.world.data.rooms;
    if (!rooms.length) return;
    const minX = Math.min(...rooms.map((r) => r.gx)), maxX = Math.max(...rooms.map((r) => r.gx + r.w));
    const maxY = Math.max(...rooms.map((r) => r.gy));
    this.fitRect(minX * CELL_W - 30, -(maxY + 1) * CELL_H - 30, maxX * CELL_W + 30, 40, instant);
  }

  /** 单间：一个房间铺满画面 */
  showRoom(uid: string, instant = false) {
    const r = this.game.world.getRoom(uid);
    if (!r) return this.showAll(instant);
    this.view = { mode: "room", uid };
    const rr = rectOf(r);
    this.fitRect(rr.L - 10, rr.T - 10, rr.R + 10, rr.B + SLAB + 10, instant);
  }

  /** 单间模式下按左右顺序切换房间（先同一层，再换楼层） */
  stepRoom(dir: 1 | -1) {
    const rooms = [...this.game.world.data.rooms].sort((a, b) => b.gy - a.gy || a.gx - b.gx);
    if (!rooms.length) return;
    const cur = this.view.mode === "room" ? rooms.findIndex((r) => r.uid === (this.view as { uid: string }).uid) : -1;
    const next = rooms[(cur + dir + rooms.length) % rooms.length];
    this.showRoom(next.uid);
  }

  /** 重新套用当前的镜头模式（窗口大小变化、面板开合时） */
  refit(instant = false) {
    if (this.view.mode === "room") this.showRoom(this.view.uid, instant);
    else this.showAll(instant);
  }

  centerOnHouse() {
    this.showAll(true);
  }

  panBy(dx: number, dy: number) {
    this.camTarget = null;
    this.camera.x += dx;
    this.camera.y += dy;
  }

  zoomAt(factor: number, sx: number, sy: number) {
    this.camTarget = null;
    const z = Math.min(1.8, Math.max(0.18, this.zoom * factor));
    const k = z / this.zoom;
    this.camera.x = sx - (sx - this.camera.x) * k;
    this.camera.y = sy - (sy - this.camera.y) * k;
    this.zoom = z;
    this.camera.scale.set(z);
  }

  /** 屏幕坐标 → 世界像素坐标 */
  toWorld(sx: number, sy: number) {
    return { x: (sx - this.camera.x) / this.zoom, y: (sy - this.camera.y) / this.zoom };
  }

  toScreen(wx: number, wy: number) {
    return { x: wx * this.zoom + this.camera.x, y: wy * this.zoom + this.camera.y };
  }

  /** 世界里一点（角色位置）→ 世界像素坐标和缩放。上下楼时楼层是小数，按楼层插值。 */
  posToWorld(p: Vec3) {
    const room = this.game.world.roomOfPos(p) ?? this.game.world.roomAt(p.x, Math.floor(p.y)) ?? this.game.world.roomAt(p.x, Math.ceil(p.y));
    const gx = room?.gx ?? Math.floor(p.x), w = room?.w ?? 1;
    const rr = roomRect(gx, w, p.y);
    return project(rr, (p.x - gx) / w, p.z);
  }

  /** 屏幕上这一点落在哪个房间、房间里的什么位置 */
  pickRoom(sx: number, sy: number): { room: RoomInst; x: number; z: number; onWall: boolean } | null {
    const p = this.toWorld(sx, sy);
    for (const r of this.game.world.data.rooms) {
      const rr = rectOf(r);
      if (p.x < rr.L || p.x > rr.R || p.y < rr.T || p.y > rr.B + SLAB) continue;
      const u = unproject(rr, p.x, p.y);
      return { room: r, x: Math.max(0, Math.min(1, u.u)) * r.w, z: u.z, onWall: u.onWall };
    }
    return null;
  }

  /** 屏幕上这一点所在的空格子（用于盖新房间） */
  cellAt(sx: number, sy: number) {
    const p = this.toWorld(sx, sy);
    return { gx: Math.floor(p.x / CELL_W), gy: Math.floor(-p.y / CELL_H) };
  }

  pickCharacter(sx: number, sy: number): Character | null {
    let best: { c: Character; d: number } | null = null;
    for (const c of this.game.chars) {
      if (c.hidden) continue;
      const w = this.posToWorld(c.d.pos);
      const s = this.toScreen(w.x, w.y - 55 * w.s * CHAR_SCALE);
      const d = Math.hypot(sx - s.x, (sy - s.y) * 0.6);
      if (d < 55 * CHAR_SCALE * this.zoom * w.s && (!best || d < best.d)) best = { c, d };
    }
    return best?.c ?? null;
  }

  pickFurniture(sx: number, sy: number): FurnitureInst | null {
    const p = this.toWorld(sx, sy);
    let best: { f: FurnitureInst; z: number } | null = null;
    for (const f of this.game.world.data.furniture) {
      const b = this.furnitureBounds(f);
      if (!b) continue;
      if (p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1 && (!best || f.z > best.z)) best = { f, z: f.z };
    }
    return best?.f ?? null;
  }

  private furnitureBounds(f: FurnitureInst) {
    const def = FURNITURE_BY_ID[f.def];
    const room = this.game.world.getRoom(f.room);
    if (!def || !room) return null;
    const pr = project(rectOf(room), f.x / room.w, f.z);
    const w = def.w * CELL_W * pr.s, h = (def.h + 30) * pr.s;
    return { x0: pr.x - w / 2, x1: pr.x + w / 2, y0: pr.y - h, y1: pr.y + 6 };
  }

  // ———————————————————— 房间 ————————————————————

  private rebuildRooms() {
    const w = this.game.world;
    this.builtVersion = w.version;
    const hour = new Date().getHours();
    this.builtHour = hour;
    this.roomLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    const rooms = w.data.rooms;

    // 背景：天空和地面
    const bd = this.backdrop;
    bd.clear();
    this.app.renderer.background.color = skyColor(hour);
    if (rooms.length) {
      const minX = Math.min(...rooms.map((r) => r.gx)) - 3, maxX = Math.max(...rooms.map((r) => r.gx + r.w)) + 3;
      bd.rect(minX * CELL_W, -SLAB, (maxX - minX) * CELL_W, 400).fill(0x8fb874);
      bd.rect(minX * CELL_W, -SLAB + 26, (maxX - minX) * CELL_W, 380).fill(0x7a5c45);
    }
    for (const r of rooms) {
      const v = this.drawRoom(r, hour);
      v.label = r.uid;
      this.roomLayer.addChild(v);
    }
  }

  private drawRoom(r: RoomInst, hour: number) {
    const box = new Container();
    const g = new Graphics();
    const label = new Text({ text: r.name, style: { fontFamily: FONT, fontSize: 18, fill: 0xffffff, fontWeight: "700" } });
    box.addChild(g, label);
    const t = ROOM_TYPE_BY_ID[r.type];
    const rr = rectOf(r);
    const wallC = WALL_BY[r.wall]?.color ?? 0xf3ead8;
    const floor = FLOOR_BY[r.floor] ?? FLOOR_BY.wood;
    const w = this.game.world;
    const leftOpen = !!w.roomAt(r.gx - 0.5, r.gy), rightOpen = !!w.roomAt(r.gx + r.w + 0.5, r.gy);
    const poly = (pts: number[][]) => pts.flat();

    if (t?.outdoor) {
      // 院子：没有墙和天花板，只有栅栏和草地
      g.rect(rr.L, rr.T, rr.R - rr.L, rr.backB - rr.T).fill({ color: skyColor(hour), alpha: 0.0001 });
      g.poly(poly([[rr.backL, rr.backB], [rr.backR, rr.backB], [rr.R, rr.B], [rr.L, rr.B]])).fill(floor.color);
      for (let x = rr.backL; x <= rr.backR; x += 26) g.roundRect(x - 5, rr.backB - 54, 10, 56, 4).fill(0xffffff).stroke({ width: 1.5, color: 0xd8d2c8 });
      g.rect(rr.backL, rr.backB - 40, rr.backR - rr.backL, 6).fill(0xffffff);
    } else {
      // 天花板、两侧墙、后墙、地板
      g.poly(poly([[rr.L, rr.T], [rr.R, rr.T], [rr.backR, rr.backT], [rr.backL, rr.backT]])).fill(shade(wallC, 0.62));
      g.poly(poly([[rr.L, rr.T], [rr.backL, rr.backT], [rr.backL, rr.backB], [rr.L, rr.B]])).fill(shade(wallC, 0.84));
      g.poly(poly([[rr.R, rr.T], [rr.backR, rr.backT], [rr.backR, rr.backB], [rr.R, rr.B]])).fill(shade(wallC, 0.78));
      g.rect(rr.backL, rr.backT, rr.backR - rr.backL, rr.backB - rr.backT).fill(wallC);
      // 护墙板
      g.rect(rr.backL, rr.backB - 34, rr.backR - rr.backL, 34).fill(shade(wallC, 0.93));
      g.rect(rr.backL, rr.backB - 36, rr.backR - rr.backL, 3).fill(shade(wallC, 1.05));
      // 侧墙上的门洞（隔壁有房间时）
      const doorway = (side: "L" | "R") => {
        const x0 = side === "L" ? rr.L : rr.R, x1 = side === "L" ? rr.backL : rr.backR;
        const at = (k: number) => ({ x: x0 + (x1 - x0) * k, y: rr.B + (rr.backB - rr.B) * k });
        const a = at(0.18), b = at(0.55);
        const hgt = (k: number) => (CELL_H - SLAB) * 0.5 * (1 - 0.25 * k);
        g.poly(poly([[a.x, a.y], [b.x, b.y], [b.x, b.y - hgt(0.55)], [a.x, a.y - hgt(0.18)]])).fill(shade(wallC, 0.55));
      };
      if (leftOpen) doorway("L");
      if (rightOpen) doorway("R");
      // 窗户
      if (t?.window) {
        const wx = (rr.backL + rr.backR) / 2, wy = rr.backT + (rr.backB - rr.backT) * 0.38;
        const ww = Math.min(110, (rr.backR - rr.backL) * 0.3), wh = (rr.backB - rr.backT) * 0.4;
        g.roundRect(wx - ww / 2 - 6, wy - wh / 2 - 6, ww + 12, wh + 12, 6).fill(0xffffff);
        g.rect(wx - ww / 2, wy - wh / 2, ww, wh).fill(skyColor(hour));
        g.rect(wx - 2, wy - wh / 2, 4, wh).fill(0xffffff).rect(wx - ww / 2, wy - 2, ww, 4).fill(0xffffff);
        if (hour >= 20 || hour < 5) g.circle(wx + ww / 4, wy - wh / 4, 8).fill(0xfff6c8);
      }
      // 楼梯：贴着后墙的一排台阶，通向天花板
      if (t?.stairs) {
        const n = 9;
        for (let i = 0; i < n; i++) {
          const k = i / n;
          const x = rr.backL + 24 + k * (rr.backR - rr.backL - 60);
          const y = rr.backB - k * (rr.backB - rr.backT + 30);
          g.rect(x, y - 20, (rr.backR - rr.backL - 60) / n + 6, 20).fill(0xc89b6d).stroke({ width: 1.5, color: 0x8a6a50 });
        }
      }
      g.poly(poly([[rr.backL, rr.backB], [rr.backR, rr.backB], [rr.R, rr.B], [rr.L, rr.B]])).fill(floor.color);
    }
    // 地板的木纹线，朝后墙收拢
    for (let i = 1; i < 8 * r.w; i++) {
      const u = i / (8 * r.w);
      const a = project(rr, u, 0), b = project(rr, u, 1);
      g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 1, color: floor.line, alpha: 0.6 });
    }
    // 楼板
    g.rect(rr.L, rr.B, rr.R - rr.L, SLAB).fill(0x9a7656);
    g.rect(rr.L, rr.B, rr.R - rr.L, 3).fill(0xc29a72);
    // 外框
    g.rect(rr.L, rr.T, rr.R - rr.L, rr.B + SLAB - rr.T).stroke({ width: 3, color: 0x6e5644, alpha: t?.outdoor ? 0 : 1 });
    label.position.set(rr.L + 12, rr.T + 6);
    label.alpha = 0.85;
    return box;
  }

  // ———————————————————— 家具立牌 ————————————————————

  private drawFurniture(f: FurnitureInst) {
    const def = FURNITURE_BY_ID[f.def];
    const room = this.game.world.getRoom(f.room);
    if (!def || !room) return;
    const occ = this.game.occupantOf(f.uid);
    const lying = occ && occ.hidden ? occ : null;
    const foods = this.game.world.foodsOn(f.uid).map((x) => FOOD_COLOR[x.kind] ?? 0xf2a65a);
    const key = [f.room, f.x.toFixed(3), f.z.toFixed(3), f.state?.on ? 1 : 0, lying?.id ?? "", foods.join(","), room.gx, room.gy, room.w].join("|");
    let v = this.furnViews.get(f.uid);
    if (!v) {
      const box = new Container();
      const shadow = new Graphics();
      const g = new Graphics();
      box.addChild(shadow, g);
      v = { box, shadow, g, key: "" };
      this.furnViews.set(f.uid, v);
      this.objects.addChild(box);
    }
    if (v.key === key) return;
    v.key = key;
    const pr = project(rectOf(room), f.x / room.w, f.z);
    v.box.position.set(pr.x, pr.y);
    v.box.scale.set(pr.s);
    const w = def.w * CELL_W;
    v.shadow.clear();
    v.g.clear();
    if (f.def === "rug") {
      // 地毯直接贴在地板上，按透视画成梯形
      const rr = rectOf(room);
      const u0 = (f.x - def.w / 2) / room.w, u1 = (f.x + def.w / 2) / room.w;
      const z0 = Math.max(0, f.z - def.d), z1 = f.z;
      const pts = [project(rr, u0, z0), project(rr, u1, z0), project(rr, u1, z1), project(rr, u0, z1)];
      v.box.position.set(0, 0);
      v.box.scale.set(1);
      v.g.poly(pts.flatMap((p) => [p.x, p.y])).fill(def.color).stroke({ width: 3, color: shade(def.color, 1.1) });
      v.box.zIndex = -1;
      return;
    }
    v.shadow.ellipse(0, 0, w * 0.55, 10).fill({ color: 0x000000, alpha: 0.13 });
    const sleeper = lying ? { hair: hex(lying.d.appearance.hair), skin: hex(lying.d.appearance.skin) } : undefined;
    drawStandee(v.g, f.def, def.color, w, def.h, { on: !!f.state?.on, sleeper, foods });
    v.box.zIndex = Math.round(f.z * 1000) + 1;
  }

  // ———————————————————— 每帧 ————————————————————

  update(t: number) {
    // 镜头平滑移动到目标
    if (this.camTarget) {
      const k = 0.18, ct = this.camTarget;
      this.zoom += (ct.zoom - this.zoom) * k;
      this.camera.x += (ct.x - this.camera.x) * k;
      this.camera.y += (ct.y - this.camera.y) * k;
      this.camera.scale.set(this.zoom);
      if (Math.abs(ct.zoom - this.zoom) < 0.002 && Math.abs(ct.x - this.camera.x) < 0.5 && Math.abs(ct.y - this.camera.y) < 0.5) this.camTarget = null;
    }
    const w = this.game.world;
    if (w.version !== this.builtVersion || new Date().getHours() !== this.builtHour) {
      this.rebuildRooms();
      for (const [id, v] of this.furnViews) if (!w.getFurniture(id)) { v.box.destroy({ children: true }); this.furnViews.delete(id); }
      for (const v of this.furnViews.values()) v.key = "";
    }
    for (const f of w.data.furniture) this.drawFurniture(f);

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
      const p = this.posToWorld(c.d.pos);
      skin.view.position.set(p.x, p.y);
      skin.view.scale.set(p.s * CHAR_SCALE);
      skin.view.visible = !c.hidden;
      skin.view.zIndex = Math.round(c.d.pos.z * 1000);
      this.updateBubble(c);
    }
    this.applyFocus();
    this.drawGhost();
    this.drawTint();
  }

  /** 单间模式：其他房间和里面的东西调暗，突出当前房间 */
  private applyFocus() {
    const focus = this.view.mode === "room" ? this.view.uid : null;
    const a = (roomUid: string | undefined) => (!focus || roomUid === focus ? 1 : 0.35);
    for (const c of this.roomLayer.children) c.alpha = a(c.label);
    for (const f of this.game.world.data.furniture) {
      const v = this.furnViews.get(f.uid);
      if (v) v.box.alpha = a(f.room);
    }
    for (const c of this.game.chars) {
      const al = a(this.game.world.roomOfPos(c.d.pos)?.uid);
      const s = this.skins.get(c.id);
      if (s) s.view.alpha = al;
      const b = this.bubbles.get(c.id);
      if (b) b.box.alpha = al;
    }
  }

  private updateBubble(c: Character) {
    let b = this.bubbles.get(c.id);
    if (!b) {
      const box = new Container();
      const bg = new Graphics();
      const text = new Text({ text: "", style: { fontFamily: FONT, fontSize: 14, fill: 0x2e2a33, wordWrap: true, wordWrapWidth: 170, breakWords: true, lineHeight: 19 } });
      const emote = new Text({ text: "", style: { fontSize: 22, fontFamily: "sans-serif" } });
      const name = new Text({ text: "", style: { fontFamily: FONT, fontSize: 12, fill: 0xffffff, fontWeight: "700" } });
      emote.anchor.set(0.5, 1);
      name.anchor.set(0.5, 0);
      box.addChild(bg, text, emote, name);
      this.overlay.addChild(box);
      b = { box, bg, text, emote, name };
      this.bubbles.set(c.id, b);
    }
    // 躺着时气泡挂在床上
    let anchor = c.d.pos;
    if (c.hidden && c.usingFurniture) {
      const f = this.game.world.getFurniture(c.usingFurniture);
      if (f) anchor = this.game.world.posOf(f);
    }
    const p = this.posToWorld(anchor);
    const headH = (c.hidden ? 60 : 118) * p.s * CHAR_SCALE;
    const top = this.toScreen(p.x, p.y - headH);
    b.box.position.set(top.x, top.y);
    b.emote.text = c.emote?.icon ?? "";
    b.emote.position.set(0, -4);
    const sel = this.selected === c.id;
    b.name.text = c.name;
    b.name.visible = sel || this.zoom < 0.4;
    b.name.position.set(0, headH * this.zoom + 6);
    b.bg.clear();
    if (b.name.visible) {
      const nw = b.name.width + 12;
      b.bg.roundRect(-nw / 2, b.name.y - 2, nw, 18, 9).fill({ color: sel ? 0x3f7f86 : 0x2e2a33, alpha: 0.85 });
    }
    if (c.speech) {
      b.text.text = c.speech.text;
      const tw = b.text.width, th = b.text.height, pad = 8;
      const by = -th - pad * 2 - (c.emote ? 26 : 8);
      b.text.position.set(-tw / 2, by + pad);
      b.bg.roundRect(-tw / 2 - pad, by, tw + pad * 2, th + pad * 2, 10).fill({ color: 0xffffff, alpha: 0.96 }).stroke({ width: 1.5, color: 0xc9c2d6 });
      b.bg.poly([-6, by + th + pad * 2, 6, by + th + pad * 2, 0, by + th + pad * 2 + 8]).fill(0xffffff);
      b.text.visible = true;
      b.emote.position.set(0, by - 2);
    } else {
      b.text.visible = false;
    }
    if (sel && !c.hidden) {
      const foot = this.toScreen(p.x, p.y);
      b.bg.ellipse(foot.x - top.x, foot.y - top.y, 34 * this.zoom * p.s, 10 * this.zoom * p.s).stroke({ width: 2.5, color: 0x3f7f86, alpha: 0.9 });
    }
  }

  private drawGhost() {
    const g = this.ghostG;
    g.clear();
    const gh = this.ghost;
    if (!gh) return;
    if (gh.kind === "room") {
      const rr = roomRect(gh.gx, gh.w, gh.gy);
      const color = gh.ok ? 0x3fae6a : 0xe05a5a;
      g.rect(rr.L, rr.T, rr.R - rr.L, rr.B + SLAB - rr.T).fill({ color, alpha: 0.2 }).stroke({ width: 4, color });
    } else if (gh.kind === "highlight-room") {
      const r = this.game.world.getRoom(gh.uid);
      if (r) {
        const rr = rectOf(r);
        const color = gh.ok ? 0x3f7f86 : 0xe05a5a;
        g.rect(rr.L, rr.T, rr.R - rr.L, rr.B + SLAB - rr.T).stroke({ width: 5, color });
      }
    } else if (gh.kind === "highlight-furniture") {
      const f = this.game.world.getFurniture(gh.uid);
      const b = f && this.furnitureBounds(f);
      if (b) g.roundRect(b.x0 - 4, b.y0 - 4, b.x1 - b.x0 + 8, b.y1 - b.y0 + 8, 8).stroke({ width: 3, color: 0xe05a5a });
    } else {
      const room = this.game.world.getRoom(gh.room);
      const def = FURNITURE_BY_ID[gh.def];
      if (!room || !def) return;
      const pr = project(rectOf(room), gh.x / room.w, gh.z);
      const color = gh.ok ? 0x3fae6a : 0xe05a5a;
      const w = def.w * CELL_W * pr.s, h = def.h * pr.s;
      g.roundRect(pr.x - w / 2, pr.y - h, w, h, 6).fill({ color, alpha: 0.3 }).stroke({ width: 2, color });
      g.ellipse(pr.x, pr.y, w * 0.55, 8 * pr.s).stroke({ width: 2, color });
    }
  }

  private drawTint() {
    const now = new Date();
    const h = now.getHours() + now.getMinutes() / 60;
    let alpha = 0;
    let color = 0x1d2b5c;
    if (h >= 21 || h < 5) alpha = 0.22;
    else if (h >= 19) alpha = 0.12;
    else if (h >= 17) { alpha = 0.08; color = 0xf2994a; }
    else if (h < 7) alpha = 0.1;
    this.tint.clear();
    if (alpha > 0) this.tint.rect(0, 0, this.app.screen.width, this.app.screen.height).fill({ color, alpha });
  }
}

export type { RoomRect };
