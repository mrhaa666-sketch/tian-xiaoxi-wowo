// 角色的画法。现在是代码画的占位 Q 版小人；
// 以后接入「零件 + 骨骼」的角色包时，实现同样的 CharSkin 接口替换掉 ProceduralSkin 即可。
import { Container, Graphics } from "pixi.js";
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
