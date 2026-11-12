// 角色的画法。现在是代码画的占位 Q 版小人；
// 以后接入「零件 + 骨骼」的角色包时，实现同样的 CharSkin 接口替换掉 ProceduralSkin 即可。
import { Container, Graphics, Sprite, Texture } from "pixi.js";
import { spriteUrl } from "./spriteStore";
import type { Character } from "../sim/character";
import { hex, shade } from "./iso";

export interface CharSkin {
  view: Container;
  update(c: Character, t: number): void;
}

export class ProceduralSkin implements CharSkin {
  view = new Container();
  private inner = new Container();
  private shadow = new Graphics();
  private body = new Graphics();
  private face = new Graphics();
  private lastKey = "";

  constructor() {
    this.view.addChild(this.shadow, this.inner);
    this.inner.addChild(this.body, this.face);
    this.shadow.ellipse(0, 0, 24, 10).fill({ color: 0x000000, alpha: 0.18 });
  }

  update(c: Character, t: number) {
    const a = c.d.appearance;
    const walking = c.moving;
    const pose = c.moving ? "walk" : c.pose;
    const bob = walking ? Math.abs(Math.sin(t * 10)) * 4 : Math.sin(t * 2.2) * 1.2;
    const step = walking ? Math.sin(t * 10) : 0;
    const blink = (t * 1000) % 3800 < 130;

    // 姿势：躺下时整体侧过来，坐下时降低
    this.inner.rotation = pose === "lie" ? -1.35 * c.d.facing : 0;
    this.inner.y = pose === "lie" ? -14 : pose === "sit" ? 8 : 0;
    this.inner.x = pose === "lie" ? -6 * c.d.facing : 0;
    this.inner.scale.x = c.d.facing;
    this.shadow.visible = pose !== "lie";

    const key = [pose, Math.round(bob * 2), Math.round(step * 3), blink, c.back, c.d.emotion, c.d.illness ? 1 : 0, JSON.stringify(a)].join("|");
    if (key === this.lastKey) return;
    this.lastKey = key;

    const g = this.body;
    g.clear();
    const skin = hex(a.skin), hair = hex(a.hair), outfit = hex(a.outfit), accent = hex(a.accent);
    const line = 0x4a3b3b;
    const y0 = -bob;

    // 腿
    if (pose !== "sit") {
      g.roundRect(-10 + step * 3, y0 - 18, 8, 18, 3).fill(shade(outfit, 0.7)).stroke({ width: 1.5, color: line });
      g.roundRect(2 - step * 3, y0 - 18, 8, 18, 3).fill(shade(outfit, 0.7)).stroke({ width: 1.5, color: line });
    }
    // 身体
    g.roundRect(-15, y0 - 46, 30, 32, 10).fill(outfit).stroke({ width: 2, color: line });
    g.roundRect(-4, y0 - 44, 8, 22, 3).fill(accent);
    // 手臂
    const armSwing = walking ? step * 5 : 0;
    g.roundRect(-21, y0 - 42 + armSwing, 7, 18, 3).fill(outfit).stroke({ width: 1.5, color: line });
    g.roundRect(14, y0 - 42 - armSwing, 7, 18, 3).fill(outfit).stroke({ width: 1.5, color: line });
    g.circle(-17.5, y0 - 23 + armSwing, 4).fill(skin);
    g.circle(17.5, y0 - 23 - armSwing, 4).fill(skin);

    // 头
    const hy = y0 - 74;
    // 后发
    if (a.hairStyle === 1) g.roundRect(-26, hy - 6, 52, 46, 18).fill(hair); // 长发
    if (a.hairStyle === 3) g.circle(c.back ? 0 : -22, hy - 20, 12).fill(hair).stroke({ width: 1.5, color: line }); // 马尾
    g.circle(0, hy, 27).fill(c.d.illness ? shade(skin, 0.95) : skin).stroke({ width: 2, color: line });
    // 前发
    if (c.back) {
      g.circle(0, hy - 2, 27).fill(hair).stroke({ width: 2, color: line });
    } else {
      g.moveTo(-28, hy + 2).arc(0, hy, 28, Math.PI, 0).lineTo(28, hy + 2).quadraticCurveTo(14, hy - 10, 4, hy - 2).quadraticCurveTo(-8, hy - 12, -28, hy + 2).fill(hair).stroke({ width: 2, color: line });
      if (a.hairStyle === 2) g.circle(20, hy - 22, 7).fill(shade(hair, 1.15)); // 发饰
    }

    const f = this.face;
    f.clear();
    if (c.back || pose === "lie" && c.d.emotion === "sleepy") {
      if (!c.back) this.drawClosedEyes(f, hy);
      return;
    }
    const eyeC = hex(a.eyes);
    const e = c.d.emotion;
    const ex = 10, ey = hy + 6;
    const sleeping = pose === "lie";
    if (sleeping || blink || e === "sleepy") {
      this.drawClosedEyes(f, hy);
    } else if (e === "happy") {
      for (const sx of [-ex, ex]) f.moveTo(sx - 5, ey + 2).quadraticCurveTo(sx, ey - 5, sx + 5, ey + 2).stroke({ width: 2.5, color: line });
    } else if (e === "surprised") {
      for (const sx of [-ex, ex]) f.circle(sx, ey, 5).fill(0xffffff).stroke({ width: 1.5, color: line }).circle(sx, ey, 3).fill(eyeC);
    } else {
      for (const sx of [-ex, ex]) {
        f.ellipse(sx, ey, 4.5, 6).fill(eyeC);
        f.circle(sx + 1.5, ey - 2.5, 1.6).fill(0xffffff);
      }
      if (e === "angry") for (const [sx, d] of [[-ex, 1], [ex, -1]]) f.moveTo(sx - 6 * d, ey - 11).lineTo(sx + 5 * d, ey - 7).stroke({ width: 2.5, color: line });
      if (e === "sad" || e === "sick") for (const [sx, d] of [[-ex, 1], [ex, -1]]) f.moveTo(sx - 6 * d, ey - 8).lineTo(sx + 5 * d, ey - 11).stroke({ width: 2, color: line });
    }
    // 嘴
    const my = hy + 17;
    if (e === "happy") f.moveTo(-5, my - 1).quadraticCurveTo(0, my + 6, 5, my - 1).fill(0xd96b6b).stroke({ width: 1.5, color: line });
    else if (e === "surprised") f.ellipse(0, my + 1, 3, 4).fill(0x8a3b3b);
    else if (e === "sad" || e === "sick") f.moveTo(-4, my + 2).quadraticCurveTo(0, my - 3, 4, my + 2).stroke({ width: 2, color: line });
    else if (e === "angry") f.moveTo(-5, my + 1).lineTo(5, my).stroke({ width: 2, color: line });
    else f.moveTo(-3, my).quadraticCurveTo(0, my + 3, 3, my).stroke({ width: 2, color: line });
    // 脸红 / 病容
    if (e === "shy" || e === "happy") for (const sx of [-17, 17]) f.ellipse(sx, hy + 13, 5, 3).fill({ color: 0xff8fa3, alpha: 0.55 });
    if (c.d.illness) {
      f.ellipse(0, hy + 10, 22, 6).fill({ color: 0xff6b6b, alpha: 0.25 });
      f.moveTo(22, hy - 8).quadraticCurveTo(28, hy, 22, hy + 4).quadraticCurveTo(17, hy, 22, hy - 8).fill(0x8ecdf5);
    }
  }

  private drawClosedEyes(f: Graphics, hy: number) {
    for (const sx of [-10, 10]) f.moveTo(sx - 5, hy + 7).quadraticCurveTo(sx, hy + 10, sx + 5, hy + 7).stroke({ width: 2.2, color: 0x4a3b3b });
  }
}

// ———————————————————— 角色立绘（世界计划小人等，由 tools/sd-compose.mjs 合成） ————————————————————

export interface SpriteManifest {
  id: string;
  width: number;
  height: number;
  footX: number;
  footY: number;
  // 合成方式：身体 × 表情（tools/sd-compose.mjs）
  bodies?: string[];
  faces?: string[];
  emotionBody?: Record<string, string>;
  // 整图方式：每个状态直接对应一张完整的图（tools/sd-finished.mjs）
  frames?: Record<string, string>;
  poses?: string[];
  avatar: Record<string, string>;
}

const manifests = new Map<string, Promise<SpriteManifest | null>>();
/** 读取 packs/chars/<id>/manifest.json；没有就返回 null */
export function loadManifest(id: string): Promise<SpriteManifest | null> {
  let p = manifests.get(id);
  if (!p) {
    p = fetch(spriteUrl(id, "manifest.json"))
      .then((r) => (r.ok && (r.headers.get("content-type") ?? "").includes("json") ? r.json() : null))
      .catch(() => null);
    manifests.set(id, p);
  }
  return p;
}

/** 立绘在场景里的高度（像素），和家具立牌的比例相配 */
const SPRITE_H = 136;

export class SpriteSkin implements CharSkin {
  view = new Container();
  private shadow = new Graphics();
  private sprite = new Sprite();
  private fallback = new ProceduralSkin();
  private m: SpriteManifest | null = null;
  private textures = new Map<string, Texture>();
  private loading = new Set<string>();
  private nextBlink = 0;
  private current = "";

  constructor(public spritesId: string) {
    this.shadow.ellipse(0, 0, 26, 10).fill({ color: 0x000000, alpha: 0.18 });
    this.view.addChild(this.fallback.view);
    void loadManifest(spritesId).then((m) => {
      if (!m) return;
      this.m = m;
      this.sprite.anchor.set(m.footX / m.width, m.footY / m.height);
      this.sprite.scale.set(SPRITE_H / m.height);
      // 先把默认姿势加载好，再从占位小人切过来
      const first = m.frames ? m.frames.normal : `${m.emotionBody!.normal}__normal`;
      void this.tex(first).then(() => {
        this.view.removeChild(this.fallback.view);
        this.fallback.view.destroy({ children: true });
        this.view.addChild(this.shadow, this.sprite);
      });
    });
  }

  private async tex(key: string) {
    const have = this.textures.get(key);
    if (have) return have;
    if (this.loading.has(key)) return null;
    this.loading.add(key);
    try {
      // 立绘可能是存在浏览器里的 blob 地址（没有扩展名），所以自己加载图片再做成贴图
      const img = new Image();
      img.src = spriteUrl(this.spritesId, `${key}.png`);
      await img.decode();
      const t = Texture.from(img);
      this.textures.set(key, t);
      return t;
    } catch { return null; } finally { this.loading.delete(key); }
  }

  update(c: Character, t: number) {
    const m = this.m;
    if (!m || !this.textures.size) { this.fallback.update(c, t); return; }
    const emo = c.d.illness ? "sick" : c.d.emotion;
    const speaking = !!c.speech;
    const now = performance.now();
    if (now > this.nextBlink + 140) this.nextBlink = now + 2500 + Math.random() * 3500;
    const blinking = now > this.nextBlink;
    let key: string;
    if (m.frames) {
      const f = m.frames;
      key = speaking && f.talk ? f.talk : f[emo] ?? f.normal;
      if (blinking && !speaking && key === f.normal && f.blink) key = f.blink;
    } else {
      key = this.composedKey(m, emo, speaking, blinking);
    }
    if (key !== this.current) {
      const tx = this.textures.get(key);
      if (tx) { this.sprite.texture = tx; this.current = key; } else void this.tex(key);
    }
    this.pose(c, t);
  }

  /** 身体 × 表情合成出来的立绘：挑姿势和表情 */
  private composedKey(m: SpriteManifest, emo: string, speaking: boolean, blinking: boolean) {
    const bodies = m.bodies ?? [], faces = m.faces ?? [], eb = m.emotionBody ?? {};
    let body = speaking && bodies.includes("talk") ? "talk" : eb[emo] ?? eb.normal;
    let face = faces.includes(`face_${emo}`) ? emo : "normal";
    // 眨眼：每隔几秒闭眼一下（借用「困」的闭眼表情）
    if (blinking && ["normal", "sad", "surprised"].includes(face) && faces.includes("face_sleepy")) face = "sleepy";
    if (!bodies.includes(body)) body = bodies[0];
    return `${body}__${face}`;
  }

  private pose(c: Character, t: number) {
    // 走路时一上一下；左右翻转（原图朝左）
    const walking = c.moving;
    const bob = walking ? Math.abs(Math.sin(t * 10)) * 5 : Math.sin(t * 2.2) * 0.8;
    this.sprite.y = -bob + (c.pose === "sit" ? 10 : 0);
    this.sprite.scale.x = Math.abs(this.sprite.scale.x) * (c.d.facing > 0 ? -1 : 1);
    this.sprite.rotation = walking ? Math.sin(t * 10) * 0.03 : 0;
    this.shadow.visible = c.pose !== "sit";
  }
}
