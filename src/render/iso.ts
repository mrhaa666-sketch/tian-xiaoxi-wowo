// 等距投影：一格地板在屏幕上是 128×64 的菱形。
export const TW = 128;
export const TH = 64;
export const WALL_H = 150;
export const WALL_LOW = 14;

export function toScreen(x: number, y: number) {
  return { x: (x - y) * (TW / 2), y: (x + y) * (TH / 2) };
}

export function toGrid(sx: number, sy: number) {
  const a = sx / (TW / 2), b = sy / (TH / 2);
  return { x: (a + b) / 2, y: (b - a) / 2 };
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
