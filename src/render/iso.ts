// 正面斜俯视投影：镜头正对房间、从前上方往下看。
// 一格地板在屏幕上是 TW × TH 的矩形（纵向有透视压缩），墙是竖直立起来的。
export const TW = 128;
export const TH = 80;
export const WALL_H = 170;
export const WALL_LOW = 30;

export function toScreen(x: number, y: number) {
  return { x: x * TW, y: y * TH };
}

export function toGrid(sx: number, sy: number) {
  return { x: sx / TW, y: sy / TH };
}

export function shade(color: number, f: number) {
  const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 255) * f)));
  const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 255) * f)));
  const b = Math.min(255, Math.max(0, Math.round((color & 255) * f)));
  return (r << 16) | (g << 8) | b;
}

export function hex(s: string) {
  return parseInt(s.replace("#", ""), 16);
}
