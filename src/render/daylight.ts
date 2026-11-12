// 一天里的光线：按钟点在几个关键时刻之间平滑过渡。
// 天空颜色、整体调色（给整栋房子）、窗外颜色、星星和灯光的强度都从这里取。

export interface Daylight {
  hour: number;
  name: string;          // 清晨、正午、傍晚……
  skyTop: number;        // 天空上方颜色
  skyBottom: number;     // 天空下方颜色
  mul: [number, number, number]; // 整体调色：红绿蓝各乘多少
  window: number;        // 窗外的颜色
  stars: number;         // 星星的亮度 0～1
  night: number;         // 夜的程度 0～1：决定室内灯光、萤火虫
  sun: number;           // 太阳的亮度 0～1
}

type Key = { h: number; name: string; top: number; bottom: number; mul: [number, number, number]; win: number; stars: number; night: number; sun: number };

// 关键时刻（24 小时制）
const KEYS: Key[] = [
  { h: 0, name: "深夜", top: 0x0b1030, bottom: 0x1d2752, mul: [0.5, 0.55, 0.8], win: 0x1d2752, stars: 1, night: 1, sun: 0 },
  { h: 4.5, name: "黎明前", top: 0x141a42, bottom: 0x3b3f74, mul: [0.55, 0.58, 0.8], win: 0x2f3666, stars: 0.8, night: 1, sun: 0 },
  { h: 6, name: "日出", top: 0x5b6cb8, bottom: 0xffc6b4, mul: [0.94, 0.88, 0.98], win: 0xf5c4c8, stars: 0.15, night: 0.3, sun: 0.7 },
  { h: 7.5, name: "清晨", top: 0x8fc2f0, bottom: 0xffe2c4, mul: [1.0, 0.96, 0.94], win: 0xc6e4f7, stars: 0, night: 0, sun: 0.9 },
  { h: 10, name: "上午", top: 0x6fb6f2, bottom: 0xd8eefc, mul: [1.02, 1.02, 1.0], win: 0xa9d8f5, stars: 0, night: 0, sun: 1 },
  { h: 13, name: "正午", top: 0x5aaef5, bottom: 0xcfeafd, mul: [1.06, 1.05, 1.0], win: 0x9dd4f7, stars: 0, night: 0, sun: 1 },
  { h: 16, name: "下午", top: 0x76b4ec, bottom: 0xf3e6c8, mul: [1.03, 1.0, 0.94], win: 0xb4d9ef, stars: 0, night: 0, sun: 0.9 },
  { h: 17.6, name: "傍晚", top: 0x7a6fb8, bottom: 0xffa06a, mul: [1.06, 0.84, 0.72], win: 0xffad7a, stars: 0, night: 0.2, sun: 0.8 },
  { h: 18.8, name: "黄昏", top: 0x3e3d82, bottom: 0xd07a8a, mul: [0.8, 0.68, 0.78], win: 0xb76f8e, stars: 0.35, night: 0.6, sun: 0.2 },
  { h: 20, name: "夜晚", top: 0x111842, bottom: 0x2b3468, mul: [0.56, 0.6, 0.84], win: 0x232c5c, stars: 0.9, night: 1, sun: 0 },
  { h: 24, name: "深夜", top: 0x0b1030, bottom: 0x1d2752, mul: [0.5, 0.55, 0.8], win: 0x1d2752, stars: 1, night: 1, sun: 0 },
];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function mix(a: number, b: number, t: number) {
  const r = lerp((a >> 16) & 255, (b >> 16) & 255, t), g = lerp((a >> 8) & 255, (b >> 8) & 255, t), bl = lerp(a & 255, b & 255, t);
  return (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(bl);
}

export function daylightAt(hour: number): Daylight {
  const h = ((hour % 24) + 24) % 24;
  let i = 0;
  while (i < KEYS.length - 2 && KEYS[i + 1].h <= h) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = (h - a.h) / (b.h - a.h);
  return {
    hour: h,
    name: t < 0.5 ? a.name : b.name,
    skyTop: mix(a.top, b.top, t),
    skyBottom: mix(a.bottom, b.bottom, t),
    mul: [lerp(a.mul[0], b.mul[0], t), lerp(a.mul[1], b.mul[1], t), lerp(a.mul[2], b.mul[2], t)],
    window: mix(a.win, b.win, t),
    stars: lerp(a.stars, b.stars, t),
    night: lerp(a.night, b.night, t),
    sun: lerp(a.sun, b.sun, t),
  };
}

/** 现在几点（带小数）。previewHour 不为空时用它（设置里的「画面时间」预览） */
export function currentHour(previewHour: number | null | undefined) {
  if (previewHour != null) return previewHour;
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}
