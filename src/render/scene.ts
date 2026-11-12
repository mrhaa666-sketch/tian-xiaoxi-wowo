// 场景渲染：地板、墙、家具、食物、角色、气泡，以及镜头（拖动、缩放）。
import { Application, Container, FillPattern, Graphics, Matrix, Sprite, Text, type Texture } from "pixi.js";
import { getTexture, onAssetsChanged } from "./assets";
import type { FurnitureInst } from "../core/types";
import type { Character } from "../sim/character";
import type { Game } from "../sim/game";
import { FLOOR_BY, FOOD_COLORS } from "./palette";
import { FURNITURE_BY_ID, WALL_STYLES } from "../world/catalog";
import { footprint, key } from "../world/world";
import { ProceduralSkin, type CharSkin } from "./charview";
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
  private skins = new Map<string, CharSkin>();
  private bubbles = new Map<string, { box: Container; bg: Graphics; text: Text; emote: Text; name: Text }>();
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
    await this.app.init({ resizeTo: host, background: 0xeef1f6, antialias: true, resolution: Math.min(window.devicePixelRatio, 2), autoDensity: true });
    host.appendChild(this.app.canvas);
    this.objects.sortableChildren = true;
    this.camera.addChild(this.floorLayer, this.objects, this.ghostG);
    this.zoom = Math.min(0.7, Math.max(0.35, this.app.screen.width / 1900));
    this.app.stage.addChild(this.camera, this.tint, this.overlay);
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

  // ———————————————————— 静态部分：地板、墙、家具 ————————————————————

  private rebuildStatic() {
    const w = this.game.world;
    const cutaway = this.game.settings.wallMode === "cutaway";
    this.builtVersion = w.version;
    this.builtWallMode = this.game.settings.wallMode;
    for (const o of this.staticObjs) o.destroy({ children: true });
    this.staticObjs = [];
    this.floorLayer.removeChildren().forEach((c) => c.destroy({ children: true }));

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
      const label = new Text({ text: room, style: { fontFamily: "Noto Sans SC, sans-serif", fontSize: 20, fill: 0xffffff, fontWeight: "700", stroke: { color: 0x5a4a44, width: 4 } } });
      label.anchor.set(0.5);
      const p = toScreen(cx, cy);
      label.position.set(p.x, p.y);
      label.alpha = 0.9;
      const holder = new Container();
      holder.label = room;
      holder.addChild(label);
      this.floorLayer.addChild(holder);
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
            const hour = new Date().getHours();
            const sky = hour >= 19 || hour < 6 ? 0x2f3d66 : hour < 8 || hour >= 17 ? 0xf6c59a : 0xa9d8f5;
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
        if (wall.kind === "window" && h > WALL_LOW) rect(sx - half + 2, y0 + 0.25 * TH - h * 0.7, sx + half - 2, y0 + 0.75 * TH - h * 0.7, 0xa9d8f5);
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

  private tilesBox(filter?: (room: string | undefined) => boolean) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [k, t] of Object.entries(this.game.world.data.tiles)) {
      if (filter && !filter(t.room)) continue;
      const [x, y] = k.split(",").map(Number);
      for (const p of [toScreen(x, y), toScreen(x + 1, y), toScreen(x + 1, y + 1), toScreen(x, y + 1)]) {
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y);
      }
    }
    return { x0, y0: y0 - WALL_H, x1, y1 };
  }

  showAll(instant = false) {
    this.view = { mode: "all" };
    const b = this.tilesBox();
    if (Number.isFinite(b.x0)) this.fitRect(b.x0 - 20, b.y0, b.x1 + 20, b.y1 + 20, instant);
  }

  showRoom(name: string, instant = false) {
    const b = this.tilesBox((r) => r === name);
    if (!Number.isFinite(b.x0)) return this.showAll(instant);
    this.view = { mode: "room", name };
    this.fitRect(b.x0 - 30, b.y0, b.x1 + 30, b.y1 + 30, instant);
  }

  /** 单间模式下按顺序切换房间 */
  stepRoom(dir: 1 | -1) {
    const rooms = this.game.world.rooms();
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
    const stateKey = [this.game.settings.wallMode, f.x, f.y, f.rot, f.back ? 1 : 0, f.state?.on ? 1 : 0, lying?.id ?? "", foodItems.map((x) => x.kind).join(","), art?.tex.uid ?? 0, foodTex.map((t) => (t ? 1 : 0)).join("")].join("|");
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
    const mirror = f.rot === 1 && w === 1 ? -1 : 1;
    let topY = -sh; // 立牌顶面大概的位置，用来放食物
    if (art) {
      // 有素材图：按立牌宽度缩放，高度按图片比例
      v.g.visible = false;
      v.sprite.visible = true;
      v.sprite.texture = art.tex;
      v.sprite.anchor.set(0.5, 1);
      v.sprite.position.set(0, 0);
      const k = sw / art.tex.width;
      v.sprite.scale.set(k * mirror, k);
      topY = -art.tex.height * k * 0.62;
      // 有人躺着、但没有专门的「有人」图时，在床上叠一个小脑袋
      if (lying && art.variant !== "occupied") this.drawSleeperHead(v.extras, lying, -sw * 0.3, -art.tex.height * k * 0.55);
      else if (lying) this.drawSleeperHead(v.extras, lying, -sw * 0.3, -art.tex.height * k * 0.62);
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
  private drawSleeperHead(parent: Container, c: Character, x: number, y: number) {
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
      skin.view.visible = !c.hidden;
      // 坐在家具上时排在立牌后面，下半身被挡住，看起来就是坐着
      skin.view.zIndex = c.d.pos.y * 10 + (onTop ? -2 : 0);
      this.updateBubble(c);
    }
    this.applyFocus();
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
      // 气泡别超出屏幕左右边缘
      const half = tw / 2 + pad + 6, sw = this.app.screen.width;
      const shift = Math.min(0, sw - (b.box.x + half)) + Math.max(0, half - b.box.x);
      if (shift) { b.text.x += shift; b.bg.clear(); if (b.name.visible) { const nw = b.name.width + 12; b.bg.roundRect(-nw / 2, b.name.y - 2, nw, 18, 9).fill({ color: sel ? 0x3f7f86 : 0x2e2a33, alpha: 0.85 }); }
        b.bg.roundRect(-tw / 2 - pad + shift, by, tw + pad * 2, th + pad * 2, 10).fill({ color: 0xffffff, alpha: 0.96 }).stroke({ width: 1.5, color: 0xc9c2d6 });
        b.bg.poly([-6, by + th + pad * 2, 6, by + th + pad * 2, 0, by + th + pad * 2 + 8]).fill(0xffffff); }
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
