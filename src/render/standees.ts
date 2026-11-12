// 家具立牌的占位画法：每件家具画成一张正面稍带俯视的平面图。
// 以后换正式素材时，这里改成贴图片即可（使用中的状态换另一张图）。
// 坐标约定：原点在立牌底边中点，向上为负；w、h 是立牌在最前排时的像素大小。
import type { Graphics } from "pixi.js";
import { shade } from "./iso";

export interface StandeeState {
  on?: boolean;
  sleeper?: { hair: number; skin: number }; // 床/浴缸里躺着的人
  foods?: number[];                          // 桌上的食物颜色
}

const LINE = 0x5a4a44;

export function drawStandee(g: Graphics, id: string, color: number, w: number, h: number, st: StandeeState) {
  const L = -w / 2, R = w / 2;
  const dark = shade(color, 0.8), light = shade(color, 1.12);
  const stroke = { width: 2, color: LINE, alpha: 0.75 };
  switch (id) {
    case "bed": {
      // 床头板、床垫、被子
      g.roundRect(L, -h - 26, 18, h + 26, 5).fill(shade(0xb98b62, 1)).stroke(stroke);
      g.roundRect(L + 10, -h, w - 10, h - 8, 8).fill(0xffffff).stroke(stroke);
      g.rect(L + 14, -10, 6, 10).fill(dark).rect(R - 10, -10, 6, 10).fill(dark);
      g.ellipse(L + 34, -h + 2, 18, 9).fill(0xf7f4ef).stroke({ width: 1.5, color: 0xcfc7bd });
      if (st.sleeper) {
        g.circle(L + 36, -h - 6, 14).fill(st.sleeper.hair).stroke(stroke);
        g.ellipse(L + 38, -h - 2, 10, 7).fill(st.sleeper.skin);
        g.moveTo(L + 33, -h - 2).lineTo(L + 37, -h - 2).moveTo(L + 41, -h - 2).lineTo(L + 45, -h - 2).stroke({ width: 1.5, color: LINE });
        g.roundRect(L + 46, -h - 10, w - 52, h, 12).fill(color).stroke(stroke);
      } else {
        g.roundRect(L + 56, -h + 2, w - 62, h - 12, 8).fill(color).stroke(stroke);
      }
      break;
    }
    case "wardrobe":
      g.roundRect(L, -h, w, h - 6, 4).fill(color).stroke(stroke);
      g.moveTo(0, -h + 6).lineTo(0, -12).stroke({ width: 2, color: dark });
      g.circle(-6, -h / 2, 3).fill(0xe8d3a0).circle(6, -h / 2, 3).fill(0xe8d3a0);
      g.rect(L + 4, -6, 6, 6).fill(dark).rect(R - 10, -6, 6, 6).fill(dark);
      break;
    case "lamp":
      if (st.on) g.circle(0, -h + 14, 46).fill({ color: 0xffe9a8, alpha: 0.35 });
      g.rect(-2, -h + 20, 4, h - 24).fill(0x8a7a6a);
      g.ellipse(0, -3, 12, 4).fill(0x8a7a6a);
      g.poly([-16, -h + 22, 16, -h + 22, 10, -h, -10, -h]).fill(st.on ? 0xfff2b8 : color).stroke(stroke);
      break;
    case "sofa":
      g.roundRect(L + 8, -h, w - 16, h * 0.6, 10).fill(color).stroke(stroke);
      g.roundRect(L + 4, -h * 0.5, w - 8, h * 0.4, 8).fill(light).stroke(stroke);
      g.roundRect(L, -h * 0.7, 16, h * 0.62, 7).fill(dark).stroke(stroke);
      g.roundRect(R - 16, -h * 0.7, 16, h * 0.62, 7).fill(dark).stroke(stroke);
      g.rect(L + 10, -8, 6, 8).fill(LINE).rect(R - 16, -8, 6, 8).fill(LINE);
      break;
    case "tv":
      g.roundRect(L, -h * 0.35, w, h * 0.35, 4).fill(color).stroke(stroke);
      g.roundRect(L + 6, -h, w - 12, h * 0.6, 5).fill(0x2f3340).stroke(stroke);
      g.roundRect(L + 11, -h + 5, w - 22, h * 0.6 - 10, 3).fill(st.on ? 0x9fe0ff : 0x444a58);
      if (st.on) g.circle(L + 26, -h + 18, 6).fill({ color: 0xffffff, alpha: 0.6 });
      break;
    case "plant":
      g.poly([L + 4, -h * 0.45, R - 4, -h * 0.45, R - 8, 0, L + 8, 0]).fill(color).stroke(stroke);
      g.circle(0, -h * 0.75, 14).fill(0x5aa95e).circle(-11, -h * 0.55, 11).fill(0x6fbf73).circle(11, -h * 0.58, 11).fill(0x4f9a53).circle(0, -h * 1.05, 10).fill(0x6fbf73);
      break;
    case "fridge":
      g.roundRect(L, -h, w, h, 8).fill(color).stroke(stroke);
      g.moveTo(L + 2, -h * 0.62).lineTo(R - 2, -h * 0.62).stroke({ width: 2, color: shade(color, 0.75) });
      g.roundRect(R - 12, -h + 14, 4, 26, 2).fill(0x9aa5ad).roundRect(R - 12, -h * 0.55, 4, 34, 2).fill(0x9aa5ad);
      break;
    case "stove":
    case "sink":
      g.roundRect(L, -h, w, h, 4).fill(color).stroke(stroke);
      g.rect(L - 2, -h - 6, w + 4, 8).fill(shade(color, 1.08)).stroke(stroke);
      g.rect(L + 8, -h + 14, w / 2 - 12, h - 22).fill(shade(color, 0.92)).rect(4, -h + 14, w / 2 - 12, h - 22).fill(shade(color, 0.92));
      if (id === "stove") {
        g.ellipse(-w / 4, -h - 4, 14, 4).fill(0x444444).ellipse(w / 4, -h - 4, 14, 4).fill(0x444444);
        if (st.on) g.ellipse(-w / 4, -h - 9, 10, 6).fill({ color: 0xff8a3d, alpha: 0.9 });
      } else {
        g.ellipse(0, -h - 3, w * 0.28, 4).fill(0x9fc3d6);
        g.rect(-2, -h - 26, 4, 22).fill(0x9aa5ad).rect(-2, -h - 26, 14, 4).fill(0x9aa5ad);
      }
      break;
    case "table":
    case "desk":
      g.rect(L + 6, -h + 8, 6, h - 8).fill(dark).rect(R - 12, -h + 8, 6, h - 8).fill(dark);
      g.roundRect(L, -h, w, 12, 3).fill(color).stroke(stroke);
      if (id === "desk") {
        // 显示器放在桌子一侧，坐在桌后的人不会被挡住脸
        const mx = L + 30;
        g.rect(mx - 3, -h - 12, 6, 12).fill(0x555a66);
        g.roundRect(mx - 26, -h - 46, 52, 36, 4).fill(0x2f3340).stroke(stroke);
        g.roundRect(mx - 22, -h - 42, 44, 28, 2).fill(st.on ? 0xa8e6cf : 0x444a58);
        g.roundRect(R - 46, -h - 5, 30, 6, 2).fill(0xdfe3ea);
      }
      (st.foods ?? []).forEach((c, i) => {
        const fx = -w * 0.2 + i * 26;
        g.ellipse(fx, -h - 2, 13, 5).fill(0xffffff).stroke({ width: 1.5, color: 0xaaaaaa });
        g.ellipse(fx, -h - 6, 9, 5).fill(c);
      });
      break;
    case "chair":
      g.roundRect(L + 2, -h - 30, w - 4, 34, 4).fill(color).stroke(stroke);
      g.roundRect(L, -h + 4, w, 9, 3).fill(light).stroke(stroke);
      g.rect(L + 3, -h + 12, 5, h - 12).fill(dark).rect(R - 8, -h + 12, 5, h - 12).fill(dark);
      break;
    case "bookshelf": {
      g.roundRect(L, -h, w, h, 3).fill(color).stroke(stroke);
      const books = [0xe58f8f, 0x7fb3d5, 0xf7c873, 0x9fd3a8, 0xc7a6e0];
      for (let row = 0; row < 4; row++) {
        const y = -h + 8 + row * ((h - 12) / 4);
        g.rect(L + 5, y + (h - 12) / 4 - 4, w - 10, 4).fill(dark);
        for (let i = 0; i < 6; i++) g.rect(L + 7 + i * ((w - 14) / 6), y + 4, (w - 14) / 6 - 2, (h - 12) / 4 - 9).fill(books[(i + row) % books.length]);
      }
      break;
    }
    case "bathtub":
      g.roundRect(L, -h, w, h - 6, 16).fill(color).stroke(stroke);
      g.rect(L + 12, -6, 8, 6).fill(0xc9a96e).rect(R - 20, -6, 8, 6).fill(0xc9a96e);
      if (st.sleeper) {
        g.circle(L + 34, -h - 6, 13).fill(st.sleeper.hair).stroke(stroke);
        g.ellipse(L + 36, -h - 2, 9, 6).fill(st.sleeper.skin);
        for (const [bx, by, r] of [[0, -h, 9], [14, -h - 4, 7], [-14, -h - 2, 6], [28, -h + 1, 8]]) g.circle(bx, by, r).fill({ color: 0xffffff, alpha: 0.95 });
      }
      break;
    case "toilet":
      g.roundRect(L + 4, -h, w - 8, h * 0.45, 4).fill(color).stroke(stroke);
      g.roundRect(L, -h * 0.55, w, h * 0.3, 8).fill(color).stroke(stroke);
      g.poly([L + 6, -h * 0.28, R - 6, -h * 0.28, R - 10, 0, L + 10, 0]).fill(shade(color, 0.95)).stroke(stroke);
      break;
    case "medicine":
      g.roundRect(L, -h, w, h * 0.7, 5).fill(color).stroke(stroke);
      g.rect(-4, -h + 10, 8, 22).fill(0xe05a5a).rect(-11, -h + 17, 22, 8).fill(0xe05a5a);
      g.rect(-1.5, -h * 0.3, 3, h * 0.3).fill(0x9aa5ad);
      break;
    default:
      g.roundRect(L, -h, w, h, 6).fill(color).stroke(stroke);
  }
}
