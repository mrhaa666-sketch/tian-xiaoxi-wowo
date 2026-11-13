// 天气和温度：按手机位置查天气预报（Open-Meteo，免费、不用 Key），算出每个房间的室温，
// 再按角色怕冷怕热、正在做什么算出 TA 觉得冷不冷。
import type { WeatherKind, WeatherNow, WeatherSettings } from "../core/types";
import { WEATHER_CN } from "../core/types";
import { fetchText } from "../core/net";
import { dlog } from "../core/log";
import { FLOORS, FURNITURE_BY_ID } from "../world/catalog";
import type { World } from "../world/world";
import type { Character } from "./character";

/** WMO 天气代码 → 游戏里的天气 */
function kindOf(code: number): WeatherKind {
  if (code === 0 || code === 1) return "sunny";
  if (code === 2 || code === 3) return "cloudy";
  if (code === 45 || code === 48) return "fog";
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return "snow";
  if (code >= 95) return "storm";
  return "rain";
}

async function getJSON(url: string): Promise<unknown> {
  // Open-Meteo 允许网页直接请求；不行再走转发
  try {
    const r = await fetch(url);
    if (r.ok) return await r.json();
  } catch { /* 换一种方式 */ }
  return JSON.parse(await fetchText(url));
}

/** 用城市名查经纬度（不想开定位时用） */
export async function geocode(name: string): Promise<{ lat: number; lon: number; place: string } | null> {
  try {
    const j = await getJSON(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`) as { results?: { latitude: number; longitude: number; name: string; admin1?: string }[] };
    const r = j.results?.[0];
    return r ? { lat: r.latitude, lon: r.longitude, place: [r.admin1, r.name].filter((x, i, a) => x && a.indexOf(x) === i).join(" ") } : null;
  } catch { return null; }
}

/** 向手机要位置（会弹出系统授权） */
export function locate(): Promise<{ lat: number; lon: number } | null> {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: +p.coords.latitude.toFixed(2), lon: +p.coords.longitude.toFixed(2) }),
      (e) => { dlog("warn", "天气", `拿不到位置：${e.message}`); resolve(null); },
      { enableHighAccuracy: false, timeout: 15_000, maximumAge: 3 * 3600_000 },
    );
  });
}

export async function fetchForecast(lat: number, lon: number): Promise<Omit<WeatherNow, "source" | "place"> | null> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code&hourly=temperature_2m,weather_code&forecast_hours=12&timezone=auto`;
    const j = await getJSON(url) as { current?: { temperature_2m: number; weather_code: number }; hourly?: { time: string[]; temperature_2m: number[]; weather_code: number[] } };
    if (!j.current) return null;
    const h = j.hourly;
    return {
      kind: kindOf(j.current.weather_code), temp: Math.round(j.current.temperature_2m * 10) / 10, updatedAt: Date.now(),
      hours: h ? h.time.map((t, i) => ({ t: Date.parse(t), kind: kindOf(h.weather_code[i]), temp: h.temperature_2m[i] })) : undefined,
    };
  } catch (e) {
    dlog("warn", "天气", `查天气失败：${e instanceof Error ? e.message : String(e)}`);
    return null;
  }
}

/** 没有天气预报时按季节和钟点估一个温度（北半球） */
export function seasonTemp(d = new Date()) {
  const month = [3, 5, 10, 16, 21, 26, 29, 28, 24, 18, 11, 5][d.getMonth()];
  const h = d.getHours() + d.getMinutes() / 60;
  return Math.round(month + 4 * Math.cos(((h - 15) / 24) * Math.PI * 2));
}

export function weatherFromSettings(s: WeatherSettings): WeatherNow {
  return { kind: s.manual, temp: s.manualTemp, updatedAt: Date.now(), source: "manual" };
}

export const weatherLine = (w: WeatherNow) => `${WEATHER_CN[w.kind]} ${Math.round(w.temp)}°C${w.place ? `（${w.place}）` : ""}`;

const OUTDOOR = new Set(FLOORS.filter((f) => f.outdoor).map((f) => f.id));

/** 每个房间现在的温度 */
export function roomTemps(world: World, outside: number): Map<string, number> {
  const out = new Map<string, number>();
  const info = new Map<string, { tiles: number; outdoor: number }>();
  for (const t of Object.values(world.data.tiles)) {
    const r = t.room ?? "";
    const i = info.get(r) ?? { tiles: 0, outdoor: 0 };
    i.tiles++;
    if (OUTDOOR.has(t.floor)) i.outdoor++;
    info.set(r, i);
  }
  // 室内：房子挡风保温，比外面温和得多；室外就是外面的温度
  for (const [r, i] of info) {
    const indoor = i.outdoor < i.tiles / 2;
    out.set(r, indoor ? outside * 0.45 + 19 * 0.55 : outside);
  }
  // 开着的取暖器、被炉让房间变暖，空调把房间调到 24 度左右
  const heat = new Map<string, number>();
  const ac = new Set<string>();
  for (const f of world.data.furniture) {
    const def = FURNITURE_BY_ID[f.def];
    if (!def || !f.state?.on) continue;
    const r = world.tile(f.x, f.y)?.room ?? "";
    if (def.climate) ac.add(r);
    else if (def.warmth) heat.set(r, (heat.get(r) ?? 0) + def.warmth * Math.min(1, 12 / Math.max(4, info.get(r)?.tiles ?? 12)));
  }
  for (const [r, v] of out) {
    let t = v + Math.min(10, heat.get(r) ?? 0);
    if (ac.has(r)) t = t + (24 - t) * 0.8;
    out.set(r, Math.round(t * 10) / 10);
  }
  return out;
}

/** 角色觉得的温度：房间温度 + 体质 + 正在做的事（盖着被子、泡澡、烤火都暖和） */
export function feltTemp(c: Character, roomTemp: number) {
  let t = roomTemp;
  const heat = c.d.lore.heat;
  if (heat === "cold") t -= 3;
  if (heat === "hot") t += 3;
  const act = c.run?.phase === "act" ? c.run.interaction : undefined;
  if (act?.tags?.includes("warm")) t += 6;
  else if (act?.pose === "lie" && act.onTop) t += 5; // 盖着被子
  if (act?.id === "bath" || act?.id === "shower") t += 8;
  if (c.d.illness) t -= 2;
  return Math.round(t);
}

export type Feeling = "freezing" | "cold" | "cool" | "ok" | "warm" | "hot";
export function feeling(t: number): Feeling {
  return t < 8 ? "freezing" : t < 15 ? "cold" : t < 18 ? "cool" : t <= 27 ? "ok" : t <= 31 ? "warm" : "hot";
}
export const FEELING_CN: Record<Feeling, string> = { freezing: "冻得发抖", cold: "很冷", cool: "有点凉", ok: "刚好", warm: "有点热", hot: "热得受不了" };
