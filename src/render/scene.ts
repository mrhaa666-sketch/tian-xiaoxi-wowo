// 场景渲染：地板、墙、家具、食物、角色、气泡，以及镜头（拖动、缩放）。
import { Application, Container, FillGradient, FillPattern, Graphics, Matrix, Sprite, Text, Texture } from "pixi.js";
import { currentHour, daylightAt, withWeather, type Daylight } from "./daylight";
import { spriteUrl } from "./spriteStore";

/** 文字按屏幕的实际清晰度渲染，不然在手机上会发糊、有颗粒 */
const TEXT_RES = Math.min(3, Math.max(2, window.devicePixelRatio || 1));
import { getTexture, onAssetsChanged } from "./assets";
import type { FurnitureInst } from "../core/types";
import type { Character } from "../sim/character";
import type { Game } from "../sim/game";
import { FLOOR_BY, FOOD_COLORS } from "./palette";
import { FLOORS, FURNITURE_BY_ID, WALL_STYLES } from "../world/catalog";
import { PET_COLOR, type Pet } from "../sim/pets";
const OUTDOOR_FLOORS = new Set(FLOORS.filter((f) => f.outdoor).map((f) => f.id));
import { LEVEL_SPAN, footprint, key, levelOf } from "../world/world";
import { ProceduralSkin, SpriteSkin, takeStale, type CharSkin } from "./charview";
import { drawStandee } from "./standees";
import { TH, TW, WALL_H, WALL_LOW, hex, shade, toGrid, toScreen } from "./iso";

/** 立牌高度（像素） */
const STANDEE_H: Record<string, number> = {
  bed: 46, wardrobe: 150, lamp: 125, sofa: 62, tv: 95, plant: 64, fridge: 150, stove: 82, sink: 82,
  table: 66, chair: 56, desk: 74, bookshelf: 150, bathtub: 56, toilet: 66, medicine: 72,
};

/** 立牌宽度：按占地的格数估算 */
function standeeWidth(def: string, w: number, h: number) {
  // 和占地格数不成比例的家具单独指定宽度（像素）
  const thin: Record<string, number> = {
    lamp: 44, plant: 60, chair: 54, toilet: 64, medicine: 64, lamp_desk: 54, plant_small: 58, plant_big: 84,
    nightstand: 74, floor_cushion: 86, beanbag: 92, mirror_stand: 62, clothes_rack: 92, coffee_table: 150, dresser: 92,
    bar_stool: 48, round_table: 100, microwave_cabinet: 88, washbasin: 84, washing_machine: 88, laundry_basket: 78, towel_rack: 62,
    office_chair: 62, gaming_chair: 66, easel: 80, guitar_stand: 50, electric_guitar_stand: 50, speaker: 62, mic_stand: 40,
    music_stand: 58, headphone_desk: 84, game_tv: 104, arcade_machine: 80, bookshelf_low: 190, keyboard_stand: 190,
    bench: 180, patio_table: 100, flower_bed: 180, small_tree: 112, bicycle: 170, mailbox: 54, cat_tower: 88, fish_tank: 96,
    christmas_tree: 104, shoe_cabinet: 168, coat_rack: 62, umbrella_stand: 48,
    wall_clock: 58, wall_painting: 104, wall_poster: 66, wall_shelf: 108, curtain: 112, red_lantern: 92,
  };
  if (thin[def]) return thin[def];
  const own = FURNITURE_BY_ID[def]?.standeeWidth;
  if (own) return own;
  return 96 + (w - 1) * 118;
}

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
  private floorLayer = new Container();
  private objects = new Container();
  private ghostG = new Graphics();
  private overlay = new Container();
  private tint = new Graphics();
  // 一天里的光线：天空背景、整栋房子的调色、夜里的灯光
  private sky = new Graphics();
  /** 室外地面上的积雪：下雪时慢慢变白，暖和了慢慢化掉 */
  private snowG = new Graphics();
  private snow = 0;
  private snowDrawn = { level: -1, version: -1 };
  private lastT = 0;
  private skyGrad: { key: string; g: FillGradient } | null = null;
  private stars: { x: number; y: number; r: number; p: number }[] = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random() * 0.75, r: 0.6 + Math.random() * 1.4, p: Math.random() * 6.28 }));
  private clouds: { x: number; y: number; s: number; v: number }[] = Array.from({ length: 5 }, () => ({ x: Math.random(), y: 0.08 + Math.random() * 0.35, s: 0.6 + Math.random() * 0.8, v: 0.004 + Math.random() * 0.006 }));
  private lightKey = "";
  private glow = new Graphics();
  private roomLabels: Text[] = [];
  private builtLightHour = -1;
  daylight: Daylight = daylightAt(12);
  private skins = new Map<string, CharSkin>();
  private bubbles = new Map<string, { box: Container; bg: Graphics; sp: Container; sbg: Graphics; text: Text; emote: Text; name: Text; sig?: string }>();
  private builtVersion = -1;
  private builtWallMode = "";
  private staticObjs: Container[] = [];
  selected: string | null = null;
  ghost: Ghost | null = null;
  zoom = 0.7;
  view: { mode: "all" } | { mode: "room"; name: string } = { mode: "all" };
  private camTarget: { x: number; y: number; zoom: number } | null = null;

  constructor(private game: Game) {
    // 素材图加载完成后整体重画
    onAssetsChanged(() => {
      this.builtVersion = -1;
      for (const v of this.furnitureViews.values()) v.stateKey = "";
    });
  }

  private patterns = new Map<string, FillPattern>();

  /** 平铺贴图：一张图铺满 w×h 像素后重复 */
  private pattern(tex: Texture, w: number, h: number) {
    const key = `${tex.uid}:${w}x${h}`;
    let p = this.patterns.get(key);
    if (!p) {
      p = new FillPattern(tex, "repeat");
      p.setTransform(new Matrix().scale(w / tex.width, h / tex.height));
      this.patterns.set(key, p);
    }
    return p;
  }

  async init(host: HTMLElement) {
    await this.app.init({ resizeTo: host, background: 0xeef1f6, antialias: true, resolution: Math.min(window.devicePixelRatio, this.game.settings.look.fps === "saver" ? 1.5 : 2), autoDensity: true });
    host.appendChild(this.app.canvas);
    this.objects.sortableChildren = true;
    this.camera.addChild(this.floorLayer, this.snowG, this.objects, this.ghostG);
    this.zoom = Math.min(0.7, Math.max(0.35, this.app.screen.width / 1900));
    this.glow.blendMode = "add";
    this.app.stage.addChild(this.sky, this.camera, this.glow, this.tint, this.overlay);

    this.camera.scale.set(this.zoom);
    this.rebuildStatic();
    this.showAll(true);
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
    this.camTarget = null;
    this.camera.x += dx;
    this.camera.y += dy;
  }

  zoomAt(factor: number, sx: number, sy: number) {
    this.camTarget = null;
    const z = Math.min(2.4, Math.max(0.12, this.zoom * factor));
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

  /** 屏幕上这个点落在哪件家具的立牌上（按图片本身判断，前面的优先） */
  pickFurniture(sx: number, sy: number): FurnitureInst | null {
    let best: { f: FurnitureInst; z: number } | null = null;
    for (const f of this.game.world.data.furniture) {
      const v = this.furnitureViews.get(f.uid);
      if (!v || !v.box.visible) continue;
      const target = v.sprite.visible ? v.sprite : v.g;
      const b = target.getBounds();
      if (sx < b.minX || sx > b.maxX || sy < b.minY || sy > b.maxY) continue;
      if (!best || v.box.zIndex > best.z) best = { f, z: v.box.zIndex };
    }
    return best?.f ?? null;
  }

  // ———————————————————— 静态部分：地板、墙、家具 ————————————————————

  private rebuildStatic() {
    const w = this.game.world;
    const cutaway = this.game.settings.wallMode === "cutaway";
    this.builtVersion = w.version;
    this.builtWallMode = this.game.settings.wallMode;
    for (const o of this.staticObjs) o.destroy({ children: true });
    this.staticObjs = [];
    this.floorLayer.removeChildren().forEach((c) => c.destroy({ children: true }));
    this.roomLabels = [];

    // 地板：每个房间一张 Graphics，方便单间模式下调暗其他房间
    const byRoom = new Map<string, Graphics>();
    const roomTiles = new Map<string, [number, number][]>();
    for (const [k, t] of Object.entries(w.data.tiles)) {
      const [x, y] = k.split(",").map(Number);
      const room = t.room ?? "";
      let g = byRoom.get(room);
      if (!g) {
        g = new Graphics();
        g.label = room;
        byRoom.set(room, g);
        this.floorLayer.addChild(g);
      }
      if (!roomTiles.has(room)) roomTiles.set(room, []);
      roomTiles.get(room)!.push([x, y]);
      const fl = FLOOR_BY[t.floor] ?? FLOOR_BY.wood;
      const pts = [toScreen(x, y), toScreen(x + 1, y), toScreen(x + 1, y + 1), toScreen(x, y + 1)];
      const ftex = getTexture("floors", fl.texture);
      if (ftex) g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ fill: this.pattern(ftex, 2 * TW, 2 * TH) });
      else g.poly(pts.flatMap((p) => [p.x, p.y])).fill((x + y) % 2 ? fl.color : shade(fl.color, 0.96)).stroke({ width: 1, color: fl.line, alpha: 0.5 });
      // 室内地板在墙根处加一圈阴影，房间的边界更清楚
      const shadeEdge = (nx: number, ny: number, a: { x: number; y: number }, b: { x: number; y: number }) => {
        const n = w.tile(nx, ny);
        if (n && n.room === t.room) return;
        const mid = toScreen(x + 0.5, y + 0.5);
        const k2 = 0.16;
        const a2 = { x: a.x + (mid.x - a.x) * k2, y: a.y + (mid.y - a.y) * k2 }, b2 = { x: b.x + (mid.x - b.x) * k2, y: b.y + (mid.y - b.y) * k2 };
        g!.poly([a.x, a.y, b.x, b.y, b2.x, b2.y, a2.x, a2.y]).fill({ color: 0x000000, alpha: 0.07 });
      };
      if (!FLOOR_BY[t.floor]?.outdoor) {
        shadeEdge(x, y - 1, pts[0], pts[1]);
        shadeEdge(x - 1, y, pts[0], pts[3]);
      }
    }

    // 房间名牌
    for (const [room, tiles] of roomTiles) {
      if (!room) continue;
      const cx = tiles.reduce((a, t) => a + t[0], 0) / tiles.length + 0.5;
      const cy = tiles.reduce((a, t) => a + t[1], 0) / tiles.length + 0.5;
      const owners = this.game.ownersOf(room).map((c) => c.name);
      const label = new Text({ resolution: TEXT_RES, text: owners.length ? `${room}\n${owners.join("·")}的房间` : room, style: { fontFamily: "Noto Sans SC, sans-serif", fontSize: 20, fill: 0xffffff, fontWeight: "700", stroke: { color: 0x5a4a44, width: 4 }, align: "center", lineHeight: 24 } });
      label.anchor.set(0.5);
      const p = toScreen(cx, cy);
      label.position.set(p.x, p.y);
      label.alpha = 0.9;
      const holder = new Container();
      holder.label = room;
      holder.addChild(label);
      this.floorLayer.addChild(holder);
      this.roomLabels.push(label);
    }

    // 墙。镜头正对房间：东西向的墙（N）正面朝向镜头，南北向的墙（W）只看得到一条竖着的墙顶。
    // 房子最后面的外墙（后面没有地板）是高墙，其余的墙在「矮墙」模式下只留一截墙沿，方便看清房间里面。
    const T = 0.1; // 墙厚（格）
    for (const [k, wall] of Object.entries(w.data.walls)) {
      const [xs, ys, d] = k.split(",");
      const x = Number(xs), y = Number(ys);
      const dir = d as "N" | "W";
      const behind = dir === "N" ? w.tile(x, y - 1) : w.tile(x - 1, y);
      const front = w.tile(x, y);
      if (!behind && !front) continue;
      const exterior = !behind || !front;
      const isBack = dir === "N" ? !behind : exterior;
      const h = cutaway && !isBack ? WALL_LOW : WALL_H;
      const style = WALL_BY[wall.style] ?? WALL_STYLES[0];
      const g = new Graphics();
      g.label = (front ?? behind)?.room ?? "";
      const rect = (x0: number, y0: number, x1: number, y1: number, color: number) => g.rect(x0, y0, x1 - x0, y1 - y0).fill(color);
      if (dir === "N") {
        // 正面：从地面立起来的矩形；上面一条墙顶
        const sx = x * TW, sy = y * TH;
        const face = style.color;
        const segs: [number, number, number, number][] = wall.kind === "door"
          ? [[0, 0.16, 0, h], [0.84, 1, 0, h], ...(h > WALL_LOW ? [[0.16, 0.84, h * 0.72, h] as [number, number, number, number]] : [])]
          : [[0, 1, 0, h]];
        const wtex = h > WALL_LOW ? getTexture("walls", style.texture) : null;
        for (const [u0, u1, v0, v1] of segs) {
          if (wtex) g.rect(sx + u0 * TW, sy - v1, (u1 - u0) * TW, v1 - v0).fill({ fill: this.pattern(wtex, 2 * TW, 2 * TW) });
          else rect(sx + u0 * TW, sy - v1, sx + u1 * TW, sy - v0, face);
          if (v0 === 0) rect(sx + u0 * TW, sy - Math.min(10, v1), sx + u1 * TW, sy, shade(face, 0.82));
          rect(sx + u0 * TW, sy - v1 - T * TH, sx + u1 * TW, sy - v1, style.top);
          g.rect(sx + u0 * TW, sy - v1 - T * TH, (u1 - u0) * TW, v1 + T * TH).stroke({ width: 1, color: shade(face, 0.75), alpha: 0.6 });
        }
        if (wall.kind === "door") rect(sx + 0.16 * TW, sy - 3, sx + 0.84 * TW, sy + 2, 0xb98b62);
        if (wall.kind === "window") {
          if (h > WALL_LOW) {
            const sky = this.daylight.window;
            rect(sx + 0.16 * TW, sy - h * 0.82, sx + 0.84 * TW, sy - h * 0.34, 0xffffff);
            rect(sx + 0.21 * TW, sy - h * 0.78, sx + 0.79 * TW, sy - h * 0.38, sky);
            rect(sx + 0.49 * TW, sy - h * 0.78, sx + 0.51 * TW, sy - h * 0.38, 0xffffff);
          } else rect(sx + 0.2 * TW, sy - h - T * TH, sx + 0.8 * TW, sy - h, 0xa9d8f5);
        }
        g.zIndex = y * 10 - 5;
      } else {
        // 侧墙：一条竖着的墙顶，加上靠镜头那一端的端面
        const sx = x * TW, y0 = y * TH;
        const half = (T * TW) / 2;
        const solid: [number, number][] = wall.kind === "door" ? [[0, 0.12], [0.88, 1]] : [[0, 1]];
        for (const [a, b] of solid) {
          rect(sx - half, y0 + a * TH - h, sx + half, y0 + b * TH - h, style.top);
          g.rect(sx - half, y0 + a * TH - h, half * 2, (b - a) * TH).stroke({ width: 1, color: shade(style.color, 0.7), alpha: 0.7 });
          // 墙身：从墙顶垂到地面，颜色稍深
          rect(sx - half, y0 + b * TH - h, sx + half, y0 + b * TH, shade(style.color, 0.8));
        }
        if (wall.kind === "door") rect(sx - half, y0 + 0.12 * TH, sx + half, y0 + 0.88 * TH, 0xb98b62);
        if (wall.kind === "window" && h > WALL_LOW) rect(sx - half + 2, y0 + 0.25 * TH - h * 0.7, sx + half - 2, y0 + 0.75 * TH - h * 0.7, this.daylight.window);
        g.zIndex = (y + 1) * 10 - 6;
      }
      this.objects.addChild(g);
      this.staticObjs.push(g);
    }
  }

  // ———————————————————— 视角：全景 / 单间 ————————————————————

  /** 世界像素范围铺满画面（留出界面占用的边距） */
  /** 画面上被界面挡住的边距，由界面层提供 */
  insets: () => { top: number; bottom: number; left: number; right: number } = () => ({ top: 80, bottom: 140, left: 8, right: 8 });

  /** 世界像素范围铺满画面中没被界面挡住的部分 */
  private fitRect(x0: number, y0: number, x1: number, y1: number, instant = false) {
    const sw = this.app.screen.width, sh = this.app.screen.height;
    const ins = this.insets();
    const aw = Math.max(100, sw - ins.left - ins.right), ah = Math.max(100, sh - ins.top - ins.bottom);
    const zoom = Math.min(1.6, aw / (x1 - x0), ah / (y1 - y0));
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const t = { zoom, x: ins.left + aw / 2 - cx * zoom, y: ins.top + ah / 2 - cy * zoom };
    if (instant) { this.zoom = t.zoom; this.camera.x = t.x; this.camera.y = t.y; this.camera.scale.set(t.zoom); this.camTarget = null; }
    else this.camTarget = t;
  }

  private tilesBox(filter?: (room: string | undefined) => boolean, level?: number) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [k, t] of Object.entries(this.game.world.data.tiles)) {
      if (filter && !filter(t.room)) continue;
      const [x, y] = k.split(",").map(Number);
      if (level !== undefined && levelOf(y) !== level) continue;
      for (const p of [toScreen(x, y), toScreen(x + 1, y), toScreen(x + 1, y + 1), toScreen(x, y + 1)]) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
    }
    return { x0, y0: y0 - WALL_H, x1, y1 };
  }

  /** 现在看的是几楼（0 = 一楼） */
  level = 0;

  showAll(instant = false) {
    this.view = { mode: "all" };
    let b = this.tilesBox(undefined, this.level);
    // 还没盖东西的新楼层：看楼下那一层同样的范围，方便对着楼下的位置盖
    if (!Number.isFinite(b.x0)) {
      const below = this.tilesBox(undefined, this.level - 1);
      if (Number.isFinite(below.x0)) { const dy = toScreen(0, LEVEL_SPAN).y; b = { x0: below.x0, x1: below.x1, y0: below.y0 + dy, y1: below.y1 + dy }; }
    }
    if (Number.isFinite(b.x0)) this.fitRect(b.x0 - 20, b.y0, b.x1 + 20, b.y1 + 20, instant);
  }

  showLevel(l: number, instant = false) {
    this.level = l;
    this.showAll(instant);
  }

  showRoom(name: string, instant = false) {
    const b = this.tilesBox((r) => r === name);
    if (!Number.isFinite(b.x0)) return this.showAll(instant);
    this.level = this.game.world.levelOfRoom(name);
    this.view = { mode: "room", name };
    this.fitRect(b.x0 - 30, b.y0, b.x1 + 30, b.y1 + 30, instant);
  }

  /** 单间模式下按顺序切换房间 */
  stepRoom(dir: 1 | -1) {
    const rooms = this.game.world.rooms(this.level);
    if (!rooms.length) return;
    const cur = this.view.mode === "room" ? rooms.indexOf(this.view.name) : -1;
    this.showRoom(rooms[(cur + dir + rooms.length) % rooms.length]);
  }

  refit(instant = false) {
    if (this.view.mode === "room") this.showRoom(this.view.name, instant);
    else this.showAll(instant);
  }

  /** 单间模式：其他房间调暗 */
  private applyFocus() {
    const focus = this.view.mode === "room" ? this.view.name : null;
    const a = (room: string | undefined) => (!focus || room === focus ? 1 : 0.14);
    for (const c of this.floorLayer.children) c.alpha = a(c.label);
    for (const g of this.staticObjs) g.alpha = a(g.label);
    for (const f of this.game.world.data.furniture) {
      const v = this.furnitureViews.get(f.uid);
      if (v) v.box.alpha = a(this.game.world.tile(f.x, f.y)?.room);
    }
    for (const c of this.game.chars) {
      const al = a(c.room);
      const s = this.skins.get(c.id);
      if (s) s.view.alpha = al;
      const b = this.bubbles.get(c.id);
      if (b) b.box.alpha = al;
    }
  }

  private furnitureViews = new Map<string, { box: Container; shadow: Graphics; g: Graphics; sprite: Sprite; extras: Container; stateKey: string }>();

  /** 家具画成立牌：一张正对镜头的平面图，立在占地范围的中心，脚下有影子 */
  /** 家具对应的素材图：使用中/开着时优先用状态图，没有状态图就用普通图 */
  private furnitureTexture(f: FurnitureInst, lying: boolean) {
    const def = FURNITURE_BY_ID[f.def];
    const name = def.sprite ?? def.id;
    if (lying && def.states?.includes("occupied")) {
      const t = getTexture("furniture", `${name}_occupied`);
      if (t) return { tex: t, variant: "occupied" as const };
    }
    if (f.state?.on && def.states?.includes("on")) {
      const t = getTexture("furniture", `${name}_on`);
      if (t) return { tex: t, variant: "on" as const };
    }
    // 背对镜头的家具用背面图；没有背面图时退回正面图
    if (f.back) {
      const tb = getTexture("furniture", `${name}_back`);
      if (tb) return { tex: tb, variant: "base" as const };
    }
    const t = getTexture("furniture", name);
    return t ? { tex: t, variant: "base" as const } : null;
  }

  /** 家具画成立牌：一张正对镜头的平面图，立在占地范围靠前的位置，脚下有影子 */
  private drawFurniture(f: FurnitureInst) {
    const def = FURNITURE_BY_ID[f.def];
    if (!def) return;
    const occ = this.game.occupantOf(f.uid);
    const lying = occ && occ.hidden ? occ : null;
    const foodItems = this.game.world.foodsOn(f.uid);
    const foods = foodItems.map((x) => FOOD_COLORS[x.kind] ?? 0xf2a65a);
    const art = this.furnitureTexture(f, !!lying);
    const foodTex = foodItems.map((x) => getTexture("food", `food_${x.kind}`));
    const stateKey = [this.game.settings.wallMode, f.x, f.y, f.rot, f.back ? 1 : 0, f.flip ? 1 : 0, f.state?.on ? 1 : 0, lying?.id ?? "", lying ? (this.sleeperHeadTexture(lying, lying.run?.interaction?.id !== "bath") ? 1 : 0) : 0, foodItems.map((x) => x.kind).join(","), art?.tex.uid ?? 0, foodTex.map((t) => (t ? 1 : 0)).join("")].join("|");
    let v = this.furnitureViews.get(f.uid);
    if (v && v.stateKey === stateKey) return;
    if (!v) {
      const box = new Container();
      const shadow = new Graphics();
      const g = new Graphics();
      const sprite = new Sprite();
      sprite.anchor.set(0.5, 1);
      const extras = new Container();
      box.addChild(shadow, g, sprite, extras);
      v = { box, shadow, g, sprite, extras, stateKey: "" };
      this.furnitureViews.set(f.uid, v);
      this.objects.addChild(box);
    }
    v.stateKey = stateKey;
    const { w, h } = footprint(f);
    v.g.clear();
    v.shadow.clear();
    v.extras.removeChildren().forEach((c) => c.destroy());
    v.sprite.visible = false;
    v.g.visible = true;

    if (def.walkable) {
      // 地毯直接铺在地板上
      const pts = [toScreen(f.x + 0.1, f.y + 0.1), toScreen(f.x + w - 0.1, f.y + 0.1), toScreen(f.x + w - 0.1, f.y + h - 0.1), toScreen(f.x + 0.1, f.y + h - 0.1)];
      v.box.position.set(0, 0);
      if (art) {
        v.g.visible = false;
        v.sprite.visible = true;
        v.sprite.texture = art.tex;
        v.sprite.anchor.set(0, 0);
        v.sprite.position.set(pts[0].x, pts[0].y);
        v.sprite.width = pts[1].x - pts[0].x;
        v.sprite.height = pts[3].y - pts[0].y;
      } else if (def.stairs || f.def === "stairs_down") {
        // 楼梯：一级一级的台阶（往上的楼梯越靠后越亮，下楼口画成往下的深色台阶）
        const full = [toScreen(f.x, f.y), toScreen(f.x + w, f.y), toScreen(f.x + w, f.y + h), toScreen(f.x, f.y + h)];
        v.g.poly(full.flatMap((p) => [p.x, p.y])).fill(shade(def.color, 0.85));
        const steps = 7, down = f.def === "stairs_down";
        for (let i = 0; i < steps; i++) {
          const a = i / steps, b2 = (i + 1) / steps;
          const yy = (t: number) => (f.rot ? 0 : t);
          const xx = (t: number) => (f.rot ? t : 0);
          const q = [toScreen(f.x + xx(a) * w, f.y + yy(a) * h), toScreen(f.x + (f.rot ? b2 * w : w), f.y + (f.rot ? 0 : a * h)), toScreen(f.x + (f.rot ? b2 * w : w), f.y + (f.rot ? h : b2 * h)), toScreen(f.x + xx(a) * w, f.y + (f.rot ? h : b2 * h))];
          const k = down ? 0.55 + 0.06 * i : 1.18 - 0.05 * i;
          v.g.poly(q.flatMap((p) => [p.x, p.y])).fill(shade(def.color, k)).stroke({ width: 2, color: shade(def.color, 0.6), alpha: 0.6 });
        }
        if (down) {
          const c = toScreen(f.x + w / 2, f.y + h / 2);
          v.g.poly([c.x - 14, c.y - 6, c.x + 14, c.y - 6, c.x, c.y + 12]).fill({ color: 0xffffff, alpha: 0.85 });
        } else {
          const c = toScreen(f.x + w / 2, f.y + 0.4);
          v.g.poly([c.x - 14, c.y + 6, c.x + 14, c.y + 6, c.x, c.y - 12]).fill({ color: 0xffffff, alpha: 0.85 });
        }
      } else {
        v.g.poly(pts.flatMap((p) => [p.x, p.y])).fill(def.color).stroke({ width: 4, color: shade(def.color, 1.12) });
      }
      v.box.zIndex = -1000;
      return;
    }

    const sw = standeeWidth(f.def, w, h);
    const sh = STANDEE_H[f.def] ?? def.height;
    if (def.wallMounted) {
      // 墙是矮墙沿时（「矮墙」模式下的室内墙）没有地方挂，先不显示
      const tall = !this.game.world.tile(f.x, f.y - 1) || this.game.settings.wallMode === "full";
      v.box.visible = tall && this.game.world.wall(f.x, f.y, "N")?.kind === "wall";
      // 挂在后墙上：贴在这一格的北墙上，图片的中心对准墙面中间偏上的高度
      const c = toScreen(f.x + w / 2, f.y);
      const hpx = art ? (art.tex.height * sw) / art.tex.width : sh;
      v.box.position.set(c.x, c.y - WALL_H * 0.6 + hpx / 2);
      v.box.zIndex = f.y * 10 - 3;
    } else {
      const c = toScreen(f.x + w / 2, f.y + h - 0.15);
      v.box.position.set(c.x, c.y);
      v.box.zIndex = (f.y + h - 0.15) * 10;
      v.shadow.ellipse(0, 2, sw * 0.5, 9).fill({ color: 0x000000, alpha: 0.14 });
    }
    const mirror = (f.rot === 1 && w === 1 ? -1 : 1) * (f.flip ? -1 : 1);
    let topY = -sh; // 立牌顶面大概的位置，用来放食物
    if (art) {
      // 有素材图：按立牌宽度缩放，高度按图片比例
      v.g.visible = false;
      v.sprite.visible = true;
      v.sprite.texture = art.tex;
      v.sprite.anchor.set(0.5, 1);
      v.sprite.position.set(0, 0);
      let k = sw / art.tex.width;
      // 状态图（开灯、开火等）多了光晕或热气时，按原图对齐：家具本身大小不变，光晕和热气往外延伸
      if (art.variant !== "base") {
        const base = getTexture("furniture", def.sprite ?? def.id);
        if (base) {
          const baseH = (base.height * sw) / base.width;
          if (art.tex.height / art.tex.width < base.height / base.width) k = baseH / art.tex.height; // 变宽了：按高度对齐
        }
      }
      v.sprite.scale.set(k * mirror, k);
      topY = -art.tex.height * k * 0.62;
      // 有人躺着、但没有专门的「有人」图时，在床上叠一个小脑袋
      if (lying && art.variant !== "occupied") this.drawSleeperHead(v.extras, lying, -sw * 0.3 * mirror, -art.tex.height * k * 0.55);
      else if (lying) this.drawSleeperHead(v.extras, lying, -sw * 0.3 * mirror, -art.tex.height * k * 0.62);
    } else {
      const sleeper = lying ? { hair: hex(lying.d.appearance.hair), skin: hex(lying.d.appearance.skin) } : undefined;
      drawStandee(v.g, f.def, def.color, sw, sh, { on: !!f.state?.on, sleeper, foods: foodTex.some(Boolean) ? [] : foods });
      v.g.scale.x = mirror;
    }
    // 桌上的食物：有图就用图
    foodItems.forEach((food, i) => {
      const t = foodTex[i];
      if (!t) return;
      const sp = new Sprite(t);
      sp.anchor.set(0.5, 0.85);
      const size = 44;
      sp.scale.set(size / t.width);
      sp.position.set(-sw * 0.2 + i * 40, topY);
      v!.extras.addChild(sp);
    });
  }

  /** 躺在床上/浴缸里的人：画一个小脑袋（以后可以换成角色包里的头像） */
  /** 有立绘的角色躺下 / 泡澡时露出来的头：用自己的头像（睡觉闭眼，泡澡开心） */
  private headTex = new Map<string, Texture | null>();
  private sleeperHeadTexture(c: Character, sleeping: boolean): Texture | null | undefined {
    if (!c.d.sprites) return undefined;
    const key = `${c.d.sprites}/${sleeping ? "sleepy" : "happy"}`;
    if (this.headTex.has(key)) return this.headTex.get(key)!;
    this.headTex.set(key, null);
    const img = new Image();
    img.src = spriteUrl(c.d.sprites, `avatar_${sleeping ? "sleepy" : "happy"}.png`);
    img.decode().then(() => {
      const t = Texture.from(img);
      t.source.autoGenerateMipmaps = true;
      t.source.updateMipmaps();
      this.headTex.set(key, t);
    }).catch(() => {
      // 没有这个表情就用平常的头像
      const alt = new Image();
      alt.src = spriteUrl(c.d.sprites!, "avatar_normal.png");
      alt.decode().then(() => this.headTex.set(key, Texture.from(alt))).catch(() => {});
    });
    return null;
  }

  private drawSleeperHead(parent: Container, c: Character, x: number, y: number, size = 52) {
    const sleeping = c.run?.interaction?.id !== "bath";
    const tex = this.sleeperHeadTexture(c, sleeping);
    if (tex !== undefined) {
      // 有立绘：头像还没加载好就先不画，加载好后会重画
      if (!tex) return;
      const sp = new Sprite(tex);
      sp.anchor.set(0.5, 0.62);
      // 泡澡时头露在水面上，比躺在枕头上的位置高一些
      sp.position.set(x, sleeping ? y : y - size * 0.35);
      sp.scale.set(size / tex.width);
      parent.addChild(sp);
      return;
    }
    const g = new Graphics();
    const hair = hex(c.d.appearance.hair), skin = hex(c.d.appearance.skin);
    g.circle(x, y, 15).fill(hair).stroke({ width: 2, color: 0x5a4a44, alpha: 0.8 });
    g.ellipse(x + 3, y + 4, 10, 7).fill(skin);
    g.moveTo(x - 2, y + 4).lineTo(x + 2, y + 4).moveTo(x + 6, y + 4).lineTo(x + 10, y + 4).stroke({ width: 1.5, color: 0x5a4a44 });
    parent.addChild(g);
  }

  // ———————————————————— 每帧 ————————————————————

  update(t: number) {
    if (this.camTarget) {
      const k = 0.18, ct = this.camTarget;
      this.zoom += (ct.zoom - this.zoom) * k;
      this.camera.x += (ct.x - this.camera.x) * k;
      this.camera.y += (ct.y - this.camera.y) * k;
      this.camera.scale.set(this.zoom);
      if (Math.abs(ct.zoom - this.zoom) < 0.002 && Math.abs(ct.x - this.camera.x) < 0.5 && Math.abs(ct.y - this.camera.y) < 0.5) this.camTarget = null;
    }
    const w = this.game.world;
    this.daylight = withWeather(daylightAt(currentHour(this.game.settings.previewHour)), this.game.weather.kind);
    // 窗外颜色画在墙上，天色变了（每半小时）就重画一次墙
    const lh = Math.round(this.daylight.hour * 2);
    if (lh !== this.builtLightHour) { this.builtLightHour = lh; this.builtVersion = -1; }
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
      // 换了立绘（或去掉立绘）时重建
      const want = c.d.sprites ?? "";
      if (skin && ((skin instanceof SpriteSkin ? skin.spritesId : "") !== want || (want && takeStale(want)))) {
        skin.view.destroy({ children: true });
        this.skins.delete(c.id);
        skin = undefined;
      }
      if (!skin) {
        skin = want ? new SpriteSkin(want) : new ProceduralSkin();
        this.skins.set(c.id, skin);
        this.objects.addChild(skin.view);
      }
      // 不在画面里的人（别的楼层、屏幕外面）：不画、不更新动画，人多时省很多
      const sp = this.gridToScreen(c.d.pos.x, c.d.pos.y);
      const m = 160 * this.zoom, sw = this.app.screen.width, sh = this.app.screen.height;
      if (sp.x < -m || sp.x > sw + m || sp.y < -m || sp.y > sh + m * 2) {
        skin.view.visible = false;
        const bb = this.bubbles.get(c.id);
        if (bb) bb.box.visible = false;
        continue;
      }
      skin.update(c, t);
      const p = toScreen(c.d.pos.x, c.d.pos.y);
      skin.view.position.set(p.x, p.y);
      const onTop = c.run?.phase === "act" && c.run.interaction?.onTop;
      skin.view.visible = !c.hidden;
      // 用家具时画在家具前面还是后面：家具自己能设（摆放时长按改，或家具包里写 charLayer），
      // 没设的话坐 / 躺在家具上时排在后面（下半身被挡住，看起来就是坐着）
      let z = c.d.pos.y * 10 + (onTop ? -2 : 0);
      const uf = c.run?.phase === "act" ? c.run.furniture : undefined;
      const udef = uf && FURNITURE_BY_ID[uf.def];
      if (uf && udef && !udef.wallMounted) {
        const layer = uf.layer ?? udef.charLayer;
        const fz = (uf.y + footprint(uf).h - 0.15) * 10;
        if (layer === "above") z = fz + 0.5;
        else if (layer === "below") z = fz - 0.5;
      }
      skin.view.zIndex = z;
      this.updateBubble(c);
    }
    this.layoutBubbles();
    this.drawPets(t);
    this.applyFocus();
    this.drawGhost();
    this.drawTint();
    // 缩得很小时房间名只剩一团糊掉的小字，干脆不显示（选中房间、放大后再显示）
    for (const l of this.roomLabels) if (!l.destroyed) l.visible = this.zoom > 0.42;
    this.drawSky(t);
    this.applyLight();
    this.drawGlow(t);
  }

  /** 天空：渐变 + 太阳/月亮 + 白天的云 + 夜里的星星 */
  private drawSky(t: number) {
    const dl = this.daylight, W = this.app.screen.width, H = this.app.screen.height;
    const g = this.sky;
    g.clear();
    // 渐变会生成贴图，颜色变了才重建
    const gk = `${dl.skyTop},${dl.skyBottom}`;
    if (this.skyGrad?.key !== gk) {
      this.skyGrad?.g.destroy();
      this.skyGrad = { key: gk, g: new FillGradient({ type: "linear", start: { x: 0, y: 0 }, end: { x: 0, y: 1 }, colorStops: [{ offset: 0, color: dl.skyTop }, { offset: 1, color: dl.skyBottom }], textureSpace: "local" }) };
    }
    g.rect(0, 0, W, H).fill(this.skyGrad.g);
    // 星星（一闪一闪）
    if (dl.stars > 0.02) for (const s of this.stars) g.circle(s.x * W, s.y * H, s.r).fill({ color: 0xffffff, alpha: dl.stars * (0.45 + 0.4 * Math.sin(t * 1.7 + s.p)) });
    // 太阳：6 点从左边升起，18 点从右边落下；月亮反过来
    const h = dl.hour;
    if (h >= 5.5 && h <= 18.8) {
      const p = (h - 5.5) / 13.3, x = W * (0.08 + 0.84 * p), y = H * (0.5 - Math.sin(p * Math.PI) * 0.27);
      const warm = h < 8 || h > 16.5;
      g.circle(x, y, 46).fill({ color: warm ? 0xffb070 : 0xfff4c0, alpha: 0.22 * dl.sun });
      g.circle(x, y, 22).fill({ color: warm ? 0xffc48a : 0xfffbe6, alpha: 0.95 * Math.max(0.3, dl.sun) });
    } else {
      const p = ((h - 18.8 + 24) % 24) / 10.7, x = W * (0.12 + 0.76 * p), y = H * (0.45 - Math.sin(p * Math.PI) * 0.22);
      g.circle(x, y, 36).fill({ color: 0xdfe6ff, alpha: 0.08 });
      g.circle(x, y, 17).fill({ color: 0xf3f1e2, alpha: 0.95 });
      // 月牙：用月亮所在高度的天空颜色挡掉一块
      const k = Math.max(0, Math.min(1, (y - 5) / H));
      const lerp = (a: number, b: number, sh: number) => Math.round(((a >> sh) & 255) + (((b >> sh) & 255) - ((a >> sh) & 255)) * k);
      const skyAt = (lerp(dl.skyTop, dl.skyBottom, 16) << 16) | (lerp(dl.skyTop, dl.skyBottom, 8) << 8) | lerp(dl.skyTop, dl.skyBottom, 0);
      g.circle(x + 7, y - 5, 15).fill(skyAt);
    }
    this.drawWeather(g, t, W, H);
    this.drawSeason(g, t, W, H);
    this.updateSnow(t);
    // 白天的云慢慢飘
    if (dl.night < 0.5 && this.game.weather.kind !== "rain" && this.game.weather.kind !== "storm") for (const c of this.clouds) {
      const x = (((c.x + t * c.v * 0.1) % 1.3) - 0.15) * W, y = c.y * H, s = c.s * 34;
      const a = (1 - dl.night * 2) * 0.75;
      g.ellipse(x, y, s * 1.6, s * 0.6).fill({ color: 0xffffff, alpha: a });
      g.ellipse(x - s * 0.8, y + s * 0.15, s, s * 0.45).fill({ color: 0xffffff, alpha: a });
      g.ellipse(x + s * 0.9, y + s * 0.1, s * 1.1, s * 0.5).fill({ color: 0xffffff, alpha: a });
    }
  }

  private updateSnow(t: number) {
    const dt = Math.min(1, Math.max(0, t - this.lastT));
    this.lastT = t;
    const w = this.game.weather;
    if (w.kind === "snow") this.snow = Math.min(1, this.snow + dt / 90);          // 一分半钟积满
    else if (w.temp > 2) this.snow = Math.max(0, this.snow - dt / (w.temp > 8 ? 60 : 240)); // 暖和就化
    const level = Math.round(this.snow * 20) / 20;
    const world = this.game.world;
    if (level === this.snowDrawn.level && world.version === this.snowDrawn.version) return;
    this.snowDrawn = { level, version: world.version };
    const g = this.snowG;
    g.clear();
    if (level <= 0) return;
    for (const [k, tile] of Object.entries(world.data.tiles)) {
      if (!OUTDOOR_FLOORS.has(tile.floor)) continue;
      const [x, y] = k.split(",").map(Number);
      const pts = [toScreen(x, y), toScreen(x + 1, y), toScreen(x + 1, y + 1), toScreen(x, y + 1)];
      // 每格积雪厚薄有一点不一样，看起来自然一些
      const n = ((x * 73856093) ^ (y * 19349663)) >>> 0;
      const a = Math.min(0.92, level * (0.75 + (n % 100) / 400));
      g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color: 0xf6f9ff, alpha: a });
    }
  }

  // ———————————————————— 宠物 ————————————————————
  private petViews = new Map<string, { box: Container; g: Graphics; emote: Text; key: string }>();

  private drawPets(t: number) {
    const seen = new Set<string>();
    const sw = this.app.screen.width, sh = this.app.screen.height;
    for (const p of this.game.pets) {
      seen.add(p.d.id);
      let v = this.petViews.get(p.d.id);
      if (!v) {
        const box = new Container();
        const g = new Graphics();
        const emote = new Text({ resolution: TEXT_RES, text: "", style: { fontSize: 20, fontFamily: "sans-serif" } });
        emote.anchor.set(0.5, 1);
        box.addChild(g, emote);
        this.objects.addChild(box);
        v = { box, g, emote, key: "" };
        this.petViews.set(p.d.id, v);
      }
      const sp = this.gridToScreen(p.d.pos.x, p.d.pos.y);
      if (sp.x < -100 || sp.x > sw + 100 || sp.y < -100 || sp.y > sh + 100) { v.box.visible = false; continue; }
      v.box.visible = true;
      const s = toScreen(p.d.pos.x, p.d.pos.y);
      v.box.position.set(s.x, s.y);
      v.box.zIndex = p.d.pos.y * 10 + 0.1;
      const step = p.moving ? Math.floor(t * 6) % 2 : 0;
      const key = `${p.d.color}|${p.asleep ? "z" : p.moving ? "w" + step : "s"}|${p.facing}`;
      if (key !== v.key) { v.key = key; drawCat(v.g, PET_COLOR[p.d.color] ?? PET_COLOR.orange, p.asleep ? "sleep" : p.moving ? "walk" : "sit", p.facing, step); }
      v.emote.text = p.emote?.icon ?? (p.asleep ? "💤" : "");
      v.emote.alpha = p.emote ? 1 : 0.6;
      v.emote.position.set(0, p.asleep ? -26 : -50);
    }
    for (const [id, v] of this.petViews) if (!seen.has(id)) { v.box.destroy({ children: true }); this.petViews.delete(id); }
  }

  /** 点到的是不是宠物 */
  pickPet(sx: number, sy: number) {
    let best: { p: Pet; d: number } | null = null;
    for (const p of this.game.pets) {
      const q = this.gridToScreen(p.d.pos.x, p.d.pos.y);
      const d = Math.hypot(sx - q.x, sy - (q.y - 18 * this.zoom));
      if (d < 34 * this.zoom && (!best || d < best.d)) best = { p, d };
    }
    return best?.p ?? null;
  }

  /** 同时说话的人站得近时，气泡会叠在一起：从下往上排，挡住了就把上面那个往上挪 */
  private layoutBubbles() {
    const list: { sp: Container; k: number; x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const [id, b] of this.bubbles) {
      if (!b.box.visible || !b.text.visible) continue;
      const c = this.game.byId(id);
      if (!c?.speech) continue;
      const r = b.sbg.getBounds();
      list.push({ sp: b.sp, k: b.box.scale.y, x0: r.x, x1: r.x + r.width, y0: r.y, y1: r.y + r.height });
    }
    if (list.length < 2) return;
    // 越靠下（离镜头越近）的越先放，挪的是后面的
    list.sort((a, b) => b.y1 - a.y1);
    const gap = 4;
    for (let i = 1; i < list.length; i++) {
      const cur = list[i];
      for (let pass = 0; pass < 6; pass++) {
        let moved = false;
        for (let j = 0; j < i; j++) {
          const o = list[j];
          if (cur.x1 <= o.x0 || cur.x0 >= o.x1 || cur.y1 + gap <= o.y0 || cur.y0 >= o.y1 + gap) continue;
          const dy = cur.y1 + gap - o.y0;
          cur.sp.y -= dy / cur.k; cur.y0 -= dy; cur.y1 -= dy;
          moved = true;
        }
        if (!moved) break;
      }
    }
  }

  /** 季节的小东西：春天飘樱花瓣，秋天飘落叶（晴天、多云时） */
  private drawSeason(g: Graphics, t: number, W: number, H: number) {
    const m = new Date().getMonth() + 1;
    const kind = this.game.weather.kind;
    if (kind !== "sunny" && kind !== "cloudy") return;
    const spring = m >= 3 && m <= 5, autumn = m >= 9 && m <= 11;
    if (!spring && !autumn) return;
    for (let i = 0; i < 26; i++) {
      const d = this.drops[i];
      const y = ((d.y + t * 0.035 * d.v) % 1.1 - 0.05) * H;
      const x = ((d.x + Math.sin(t * 0.6 + d.s * 9) * 0.04 + t * 0.01) % 1) * W;
      const r = 3 + d.s * 3;
      const color = spring ? (d.s > 0.5 ? 0xffc6d9 : 0xffe1ea) : (d.s > 0.5 ? 0xe8893c : 0xd9a441);
      g.ellipse(x, y, r * 1.4, r * 0.8).fill({ color, alpha: 0.8 });
    }
  }

  /** 下雨、下雪、起雾、打雷（画在房子后面的天空上，像是窗外的天气） */
  private drops = Array.from({ length: 140 }, () => ({ x: Math.random(), y: Math.random(), v: 0.6 + Math.random() * 0.6, s: Math.random() }));
  private drawWeather(g: Graphics, t: number, W: number, H: number) {
    const kind = this.game.weather.kind;
    if (kind === "rain" || kind === "storm") {
      const n = kind === "storm" ? 140 : 90;
      for (let i = 0; i < n; i++) {
        const d = this.drops[i];
        const y = ((d.y + t * 0.9 * d.v) % 1.1 - 0.05) * H, x = ((d.x - t * 0.08 * d.v) % 1 + 1) % 1 * W;
        g.moveTo(x, y).lineTo(x - 4, y + 16).stroke({ width: 1.4, color: 0xdfe8f5, alpha: 0.35 + d.s * 0.3 });
      }
      // 打雷：偶尔闪一下
      if (kind === "storm" && Math.sin(t * 0.7) > 0.995 && Math.random() < 0.5) g.rect(0, 0, W, H).fill({ color: 0xffffff, alpha: 0.35 });
    } else if (kind === "snow") {
      for (let i = 0; i < 110; i++) {
        const d = this.drops[i];
        const y = ((d.y + t * 0.05 * d.v) % 1.05) * H, x = (d.x + Math.sin(t * 0.8 + d.s * 6) * 0.015) * W;
        g.circle(x, y, 1.5 + d.s * 2).fill({ color: 0xffffff, alpha: 0.75 });
      }
    } else if (kind === "fog") {
      for (let i = 0; i < 4; i++) g.ellipse(((i * 0.33 + t * 0.006) % 1.3 - 0.15) * W, H * (0.3 + i * 0.15), W * 0.5, H * 0.08).fill({ color: 0xffffff, alpha: 0.18 });
    }
  }

  /**
   * 整栋房子的调色（清晨偏粉、傍晚偏橙、夜里偏暗蓝）。
   * 直接给整个镜头容器染色（相当于乘上一个颜色），不用滤镜：滤镜要先画到一张中间图上，手机上会出锯齿。
   * 染色只能变暗不能变亮，所以正午保持原色。
   */
  private applyLight() {
    const [r, g, b] = this.daylight.mul.map((v) => Math.min(1, v));
    const key = `${r.toFixed(3)},${g.toFixed(3)},${b.toFixed(3)}`;
    if (key === this.lightKey) return;
    this.lightKey = key;
    this.camera.tint = (Math.round(r * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(b * 255);
  }

  /** 夜里的灯光：有人醒着的房间开灯，台灯落地灯有光晕，院子里有萤火虫 */
  private drawGlow(t: number) {
    const g = this.glow, dl = this.daylight;
    g.clear();
    g.position.set(this.camera.x, this.camera.y);
    g.scale.set(this.zoom);
    if (dl.night < 0.05) return;
    const w = this.game.world;
    const rooms = this.roomBoxes();
    const lit = new Set(this.game.chars.filter((c) => !c.hidden).map((c) => c.room));
    // 看单个房间时，旁边调暗的房间不画灯光，免得光晕叠在画面上
    const only = this.view.mode === "room" ? this.view.name : null;
    for (const [name, r] of rooms) {
      if (r.outdoor || !lit.has(name) || (only && name !== only)) continue;
      // 天花板的灯：整间房暖暖的
      const a = toScreen(r.x0, r.y0), b = toScreen(r.x1, r.y1);
      g.rect(a.x, a.y - WALL_H * 0.3, b.x - a.x, b.y - a.y + WALL_H * 0.3).fill({ color: 0xffa94d, alpha: 0.22 * dl.night });
      const c = toScreen((r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2);
      g.ellipse(c.x, c.y, (b.x - a.x) * 0.42, (b.y - a.y) * 0.42).fill({ color: 0xffc070, alpha: 0.14 * dl.night });
    }
    for (const f of w.data.furniture) {
      if (only && w.roomOf(f.x, f.y) !== only) continue;
      const glowColor = (f.def === "lamp" || f.def === "lamp_desk") && f.state?.on ? 0xffc46a : f.def === "red_lantern" ? 0xff5a40 : f.def === "christmas_tree" ? 0xfff0a0 : f.def === "fish_tank" ? 0x7fd8ff : 0;
      if (!glowColor) continue;
      const c = toScreen(f.x + 0.5, f.y + 0.6);
      const up = f.def === "lamp" ? 95 : f.def === "red_lantern" ? 130 : 45;
      for (const [rad, al] of [[70, 0.12], [42, 0.16], [20, 0.22]] as const) g.circle(c.x, c.y - up, rad).fill({ color: glowColor, alpha: al * dl.night });
    }
    // 萤火虫
    for (const [name, r] of rooms) {
      if (!r.outdoor || (only && name !== only)) continue;
      const n = Math.round((r.x1 - r.x0) * (r.y1 - r.y0) / 3);
      for (let i = 0; i < n; i++) {
        const sx = r.x0 + ((i * 0.618 + Math.sin(t * 0.3 + i)) % 1 + 1) % 1 * (r.x1 - r.x0);
        const sy = r.y0 + ((i * 0.381 + Math.cos(t * 0.25 + i * 1.7) * 0.3) % 1 + 1) % 1 * (r.y1 - r.y0);
        const p = toScreen(sx, sy);
        const a = (0.5 + 0.5 * Math.sin(t * 2.3 + i * 2.1)) * dl.night;
        g.circle(p.x, p.y - 30 - 20 * Math.sin(t * 0.8 + i), 5).fill({ color: 0xd8ff6a, alpha: 0.18 * a });
        g.circle(p.x, p.y - 30 - 20 * Math.sin(t * 0.8 + i), 1.8).fill({ color: 0xf4ffb0, alpha: 0.9 * a });
      }
    }
  }

  private roomBoxCache: { v: number; m: Map<string, { x0: number; y0: number; x1: number; y1: number; outdoor: boolean }> } | null = null;
  private roomBoxes() {
    const w = this.game.world;
    if (this.roomBoxCache?.v === w.version) return this.roomBoxCache.m;
    const m = new Map<string, { x0: number; y0: number; x1: number; y1: number; outdoor: boolean }>();
    for (const [k, t] of Object.entries(w.data.tiles)) {
      const [x, y] = k.split(",").map(Number);
      const name = t.room ?? "";
      const r = m.get(name) ?? { x0: x, y0: y, x1: x + 1, y1: y + 1, outdoor: false };
      r.x0 = Math.min(r.x0, x); r.y0 = Math.min(r.y0, y); r.x1 = Math.max(r.x1, x + 1); r.y1 = Math.max(r.y1, y + 1);
      if (["grass", "deck", "stone"].includes(t.floor)) r.outdoor = true;
      m.set(name, r);
    }
    this.roomBoxCache = { v: w.version, m };
    return m;
  }

  private updateBubble(c: Character) {
    let b = this.bubbles.get(c.id);
    if (!b) {
      const box = new Container();
      const bg = new Graphics();   // 名字牌、选中圈
      const sp = new Container();  // 说话的气泡和表情（叠在一起时整个往上挪）
      const sbg = new Graphics();
      const text = new Text({ resolution: TEXT_RES, text: "", style: { fontFamily: "Noto Sans SC, PingFang SC, Microsoft YaHei, sans-serif", fontSize: 14, fill: 0x2e2a33, wordWrap: true, wordWrapWidth: 170, breakWords: true, lineHeight: 19 } });
      const emote = new Text({ resolution: TEXT_RES, text: "", style: { fontSize: 22, fontFamily: "sans-serif" } });
      const name = new Text({ resolution: TEXT_RES, text: "", style: { fontFamily: "Noto Sans SC, sans-serif", fontSize: 12, fill: 0xffffff, fontWeight: "700" } });
      emote.anchor.set(0.5, 1);
      name.anchor.set(0.5, 0);
      sp.addChild(sbg, text, emote);
      box.addChild(bg, name, sp);
      this.overlay.addChild(box);
      b = { box, bg, sp, sbg, text, emote, name };
      this.bubbles.set(c.id, b);
    }
    const head = this.gridToScreen(c.d.pos.x, c.d.pos.y);
    const topY = head.y - (c.pose === "lie" ? 50 : 112) * this.zoom;
    b.box.position.set(head.x, topY);
    b.sp.y = 0; // 避让的偏移每帧重新算
    // 没有气泡、表情、名字、选中圈时整个隐藏；内容没变时不重画（重画图形很费时间）
    const mode = this.game.settings.look?.names ?? "selected";
    const sel = this.selected === c.id;
    const showName = mode === "all" || (mode === "selected" && sel);
    b.box.visible = !c.hidden && (!!c.speech || !!c.emote || showName || sel);
    if (!b.box.visible) return;
    const sig = [c.speech?.text ?? "", c.emote?.icon ?? "", showName ? 1 : 0, sel ? 1 : 0, c.pose === "lie" ? 1 : 0, Math.round(this.zoom * 200), c.speech ? Math.round(head.x / 4) : 0].join("|");
    if (b.sig === sig) return;
    b.sig = sig;
    // 名字、气泡都和房子按同样的比例缩放（以默认大小 0.7 为准），缩小看全景时不会比人还大、挤成一团
    const ns = Math.max(0.2, Math.min(1.25, this.zoom / 0.7));
    b.box.scale.set(ns);
    const L = (v: number) => v / ns; // 屏幕上的距离换成气泡里的坐标
    b.emote.text = c.emote?.icon ?? "";
    b.emote.position.set(0, -4);
    b.name.text = c.name;
    b.name.visible = showName;
    b.name.position.set(0, L((c.pose === "lie" ? 60 : 118) * this.zoom));
    b.bg.clear();
    if (b.name.visible) {
      const nw = b.name.width + 12;
      b.bg.roundRect(-nw / 2, b.name.y - 2, nw, 18, 9).fill({ color: sel ? 0x3f7f86 : 0x2e2a33, alpha: 0.85 });
    }
    if (sel) {
      const ring = this.gridToScreen(c.d.pos.x, c.d.pos.y);
      b.bg.ellipse(L(ring.x - head.x), L(ring.y - topY), L(30 * this.zoom), L(14 * this.zoom)).stroke({ width: 2.5 / ns, color: 0x3f7f86, alpha: 0.9 });
    }
    b.sbg.clear();
    if (c.speech) {
      b.text.text = c.speech.text;
      const tw = b.text.width, th = b.text.height;
      const pad = 8;
      const by = -th - pad * 2 - (c.emote ? 26 : 8);
      // 气泡别超出屏幕左右边缘
      const half = (tw / 2 + pad + 6) * ns, sw = this.app.screen.width;
      const shift = L(Math.min(0, sw - (b.box.x + half)) + Math.max(0, half - b.box.x));
      b.text.position.set(-tw / 2 + shift, by + pad);
      b.sbg.roundRect(-tw / 2 - pad + shift, by, tw + pad * 2, th + pad * 2, 10).fill({ color: 0xffffff, alpha: 0.96 }).stroke({ width: 1.5, color: 0xc9c2d6 });
      b.sbg.poly([-6, by + th + pad * 2, 6, by + th + pad * 2, 0, by + th + pad * 2 + 8]).fill(0xffffff);
      b.text.visible = true;
      b.emote.position.set(0, by - 2);
    } else {
      b.text.visible = false;
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
    // 光线改由天空、整体调色和夜里的灯光负责（见 drawSky / applyLight / drawGlow）
    this.tint.clear();
  }

  tileKeyAt(sx: number, sy: number) {
    const g = this.screenToGrid(sx, sy);
    return key(Math.floor(g.x), Math.floor(g.y));
  }
}

/** 画一只小猫（原点在脚底中间）：坐着、走路、蜷成一团睡觉 */
function drawCat(g: Graphics, col: { body: number; patch?: number }, pose: "sit" | "walk" | "sleep", facing: 1 | -1, step: number) {
  g.clear();
  const line = { width: 2.5, color: 0x5a4a44, alpha: 0.85 };
  const body = col.body, patch = col.patch, dark = shade(body, 0.82);
  const f = facing;
  g.ellipse(0, 2, 22, 6).fill({ color: 0x000000, alpha: 0.13 });
  if (pose === "sleep") {
    g.ellipse(0, -11, 22, 13).fill(body).stroke(line);
    if (patch) g.ellipse(-8 * f, -15, 9, 6).fill(patch);
    g.moveTo(-18 * f, -4).quadraticCurveTo(-2 * f, 2, 16 * f, -6).stroke({ width: 5, color: dark, cap: "round" });
    g.circle(12 * f, -16, 10).fill(body).stroke(line);
    g.poly([6 * f, -23, 9 * f, -32, 14 * f, -24]).fill(body).stroke(line);
    g.poly([13 * f, -25, 19 * f, -31, 20 * f, -21]).fill(body).stroke(line);
    g.moveTo(9 * f, -16).lineTo(12 * f, -15).moveTo(15 * f, -16).lineTo(18 * f, -15).stroke({ width: 1.6, color: 0x5a4a44 });
    return;
  }
  const lift = pose === "walk" ? (step ? -2 : 0) : 0;
  // 尾巴
  g.moveTo(-12 * f, -10).quadraticCurveTo(-26 * f, -18, -20 * f, -34).stroke({ width: 5, color: dark, cap: "round" });
  // 身体
  g.ellipse(0, -14 + lift, 15, 13).fill(body).stroke(line);
  if (patch) g.ellipse(-5 * f, -18 + lift, 7, 5).fill(patch);
  // 腿
  const legs = pose === "walk" ? (step ? [-8, 6] : [-4, 9]) : [-6, 6];
  for (const x of legs) g.roundRect(x - 3, -6, 6, 7, 3).fill(body).stroke(line);
  // 头
  const hx = 7 * f, hy = -30 + lift;
  g.poly([hx - 11, hy - 4, hx - 9, hy - 17, hx - 2, hy - 9]).fill(body).stroke(line);
  g.poly([hx + 11, hy - 4, hx + 9, hy - 17, hx + 2, hy - 9]).fill(body).stroke(line);
  g.circle(hx, hy, 12).fill(body).stroke(line);
  if (patch) g.ellipse(hx - 5, hy - 5, 5, 4).fill(patch);
  g.circle(hx - 4, hy, 1.8).fill(0x3a3036).circle(hx + 4, hy, 1.8).fill(0x3a3036);
  g.moveTo(hx - 2, hy + 4).quadraticCurveTo(hx, hy + 6, hx + 2, hy + 4).stroke({ width: 1.4, color: 0x5a4a44 });
  g.ellipse(hx - 7, hy + 3, 2.5, 1.5).fill({ color: 0xff9db5, alpha: 0.7 }).ellipse(hx + 7, hy + 3, 2.5, 1.5).fill({ color: 0xff9db5, alpha: 0.7 });
}
