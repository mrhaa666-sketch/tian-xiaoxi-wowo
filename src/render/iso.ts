// 娃娃屋的透视投影：每个房间是一个正面斜俯视的盒子。
// 房间内部坐标：u = 横向（0 左 ~ 1 右），z = 纵深（0 后墙 ~ 1 镜头前），投影成屏幕坐标。
import type { RoomInst } from "../core/types";

export const CELL_W = 420;  // 一格房间的宽度（像素）
export const CELL_H = 320;  // 一层楼的高度（像素，含楼板）
export const SLAB = 16;     // 楼板厚度
export const INSET = 46;    // 后墙相对房间外框往里缩进的距离（透视的强弱）
export const CEIL = 34;     // 天花板在画面上的厚度
export const FLOOR_BACK = 0.6; // 后墙底边在房间高度中的位置

export interface RoomRect {
  L: number; R: number; T: number; B: number; // 外框（B 是地板前沿）
  backL: number; backR: number; backT: number; backB: number; // 后墙
}

export function roomRect(gx: number, w: number, gy: number): RoomRect {
  const L = gx * CELL_W, R = (gx + w) * CELL_W;
  const T = -(gy + 1) * CELL_H;
  const B = -gy * CELL_H - SLAB;
  return { L, R, T, B, backL: L + INSET, backR: R - INSET, backT: T + CEIL, backB: T + (CELL_H - SLAB) * FLOOR_BACK };
}

export function rectOf(r: RoomInst, gy = r.gy) {
  return roomRect(r.gx, r.w, gy);
}

/** 房间内一点 (u, z) 在地板上的屏幕坐标，以及该处的缩放 */
export function project(rr: RoomRect, u: number, z: number) {
  const inset = INSET * (1 - z);
  const x = rr.L + inset + u * (rr.R - rr.L - 2 * inset);
  const y = rr.backB + (rr.B - rr.backB) * z;
  return { x, y, s: 0.74 + 0.26 * z };
}

/** 屏幕坐标反推房间内的 (u, z)；点在后墙上时 z 记为 0 */
export function unproject(rr: RoomRect, sx: number, sy: number) {
  const z = Math.max(0, Math.min(1, (sy - rr.backB) / (rr.B - rr.backB)));
  const inset = INSET * (1 - z);
  const u = (sx - rr.L - inset) / (rr.R - rr.L - 2 * inset);
  return { u, z, onWall: sy < rr.backB };
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
