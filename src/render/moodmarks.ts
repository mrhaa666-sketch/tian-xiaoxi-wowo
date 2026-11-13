// 情绪标记：角色只有一张图（或者缺某种表情的图）时，在头的右上角画一个小标记来表示心情。
// 全部用矢量画，放大缩小都清楚，不需要额外的图片素材。
//
//   开心  带爱心的聊天气泡        生气  红色「井」字青筋（💢）
//   害羞  往上飘的小爱心 + 腮红线   难过  蓝色眼泪 + 头顶的阴沉竖线
//   惊讶  黄色感叹号 + 迸出的短线    生病  紫色晕眩螺旋 + 冷汗
//   困    往上飘的 Zzz             平常  不画
import { Graphics, Text } from "pixi.js";

export const MOOD_MARK_CN: Record<string, string> = {
  happy: "带爱心的聊天气泡", angry: "红色生气十字", shy: "飘起来的小爱心", sad: "眼泪和阴沉线",
  surprised: "感叹号", sick: "晕眩螺旋和冷汗", sleepy: "Zzz",
};

const LINE = 0x4a3b3b;

function heart(g: Graphics, x: number, y: number, s: number, color: number, alpha = 1) {
  g.moveTo(x, y + s * 0.9)
    .bezierCurveTo(x - s * 1.4, y - s * 0.1, x - s * 0.7, y - s * 1.1, x, y - s * 0.35)
    .bezierCurveTo(x + s * 0.7, y - s * 1.1, x + s * 1.4, y - s * 0.1, x, y + s * 0.9)
    .fill({ color, alpha });
}

function drop(g: Graphics, x: number, y: number, s: number, color: number) {
  g.moveTo(x, y - s).bezierCurveTo(x + s * 0.9, y + s * 0.1, x + s * 0.7, y + s, x, y + s)
    .bezierCurveTo(x - s * 0.7, y + s, x - s * 0.9, y + s * 0.1, x, y - s).fill(color).stroke({ width: s * 0.18, color: 0xffffff, alpha: 0.9 });
}

/**
 * 在 (0,0)（头的右上角）附近画情绪标记。u 是基本大小（像素），t 是时间（秒），用来做小动画。
 * text 用来写 Zzz 和感叹号，由调用方创建一次、反复使用。
 */
export function drawMoodMark(g: Graphics, text: Text, emo: string, t: number, u: number) {
  g.clear();
  text.visible = false;
  const bob = Math.sin(t * 3) * u * 0.08;
  switch (emo) {
    case "happy": {
      // 白色圆角气泡 + 小尾巴 + 粉色爱心
      const w = u * 2.1, h = u * 1.7, x = u * 0.2, y = -h - u * 0.2 + bob;
      g.roundRect(x, y, w, h, u * 0.6).fill(0xffffff).stroke({ width: u * 0.12, color: 0xe58aa6 });
      g.poly([x + u * 0.25, y + h - u * 0.1, x + u * 0.75, y + h - u * 0.1, x - u * 0.15, y + h + u * 0.45]).fill(0xffffff);
      g.moveTo(x + u * 0.25, y + h).lineTo(x - u * 0.15, y + h + u * 0.45).lineTo(x + u * 0.75, y + h).stroke({ width: u * 0.12, color: 0xe58aa6 });
      const beat = 1 + Math.max(0, Math.sin(t * 6)) * 0.12;
      heart(g, x + w / 2, y + h / 2 + u * 0.05, u * 0.55 * beat, 0xff5c8a);
      break;
    }
    case "angry": {
      // 四段向内弯的红色弧线，组成青筋符号，一跳一跳
      const s = u * (0.75 + Math.max(0, Math.sin(t * 8)) * 0.12), cx = u * 0.6, cy = -u * 0.5;
      for (const [dx, dy, a0] of [[-1, -1, 0], [1, -1, Math.PI / 2], [1, 1, Math.PI], [-1, 1, Math.PI * 1.5]] as const) {
        const px = cx + dx * s * 0.62, py = cy + dy * s * 0.62;
        g.arc(px, py, s * 0.42, a0, a0 + Math.PI / 2).stroke({ width: u * 0.28, color: 0xe8433a, cap: "round" });
      }
      break;
    }
    case "shy": {
      // 两颗往上飘的小爱心 + 三道腮红斜线
      for (let i = 0; i < 2; i++) {
        const p = (t * 0.6 + i * 0.5) % 1;
        heart(g, u * (0.3 + i * 0.8), -u * (0.2 + p * 1.6), u * 0.32, 0xff7aa2, 1 - p);
      }
      for (let i = 0; i < 3; i++) g.moveTo(-u * (0.6 - i * 0.28), u * 0.9).lineTo(-u * (0.45 - i * 0.28), u * 0.55).stroke({ width: u * 0.1, color: 0xff6f91, alpha: 0.85 });
      break;
    }
    case "sad": {
      // 头顶的阴沉竖线 + 一滴眼泪
      for (let i = 0; i < 4; i++) g.moveTo(-u * 1.6 + i * u * 0.45, -u * 0.6).lineTo(-u * 1.6 + i * u * 0.45, -u * (0.05 + (i % 2) * 0.2)).stroke({ width: u * 0.12, color: 0x6b74c9, alpha: 0.75 });
      drop(g, u * 0.4, u * 0.3 + ((t * 0.8) % 1) * u * 0.6, u * 0.32, 0x7fc4f5);
      break;
    }
    case "surprised": {
      text.visible = true;
      text.text = "!";
      text.style.fontSize = u * 1.6;
      text.style.fill = 0xffc93c;
      text.style.stroke = { color: LINE, width: u * 0.22 };
      text.anchor.set(0.5, 1);
      text.position.set(u * 0.5, u * 0.2 + bob);
      for (const a of [-0.9, -0.3, 0.3]) g.moveTo(u * 0.5 + Math.sin(a) * u * 1.2, -u * 0.7 - Math.cos(a) * u * 1.2).lineTo(u * 0.5 + Math.sin(a) * u * 1.6, -u * 0.7 - Math.cos(a) * u * 1.6).stroke({ width: u * 0.14, color: 0xffb02e, cap: "round" });
      break;
    }
    case "sick": {
      // 慢慢转的紫色螺旋 + 冷汗
      const cx = u * 0.6, cy = -u * 0.5, rot = t * 2.5;
      g.moveTo(cx, cy);
      for (let a = 0; a < Math.PI * 4; a += 0.25) {
        const r = u * 0.08 + a * u * 0.06;
        g.lineTo(cx + Math.cos(a + rot) * r, cy + Math.sin(a + rot) * r);
      }
      g.stroke({ width: u * 0.12, color: 0x9a6bd1, cap: "round" });
      drop(g, -u * 0.5, u * 0.2, u * 0.26, 0x9fd6f7);
      break;
    }
    case "sleepy": {
      text.visible = true;
      text.anchor.set(0, 1);
      const p = (t * 0.35) % 1;
      text.text = p < 0.33 ? "z" : p < 0.66 ? "z Z" : "z Z Z";
      text.style.fontSize = u * 0.9;
      text.style.fill = 0x8fa2ff;
      text.style.stroke = { color: 0xffffff, width: u * 0.18 };
      text.position.set(u * 0.1, -u * 0.1 - p * u * 0.4);
      break;
    }
  }
}
