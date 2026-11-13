// 家具包和房间包：自己做的家具（带图片、能做的事、标签）和整间房的布局，可以导入导出。
// 格式说明见 docs/家具包和房间包格式.md。
// 自制家具的设定存在本机（localStorage），图片存在浏览器数据库里（和角色立绘放在一起）。
import type { Needs, Pose, Wall } from "../core/types";
import { FLOORS, FURNITURE, FURNITURE_BY_ID, WALL_STYLES, type FurnitureDef, type InteractionDef } from "./catalog";
import { FURNITURE_TAGS } from "./tags";
import { ROOM_PRESETS, type RoomPreset } from "./presets";
import { deleteSprites, readSprites, saveSprites, spriteUrl } from "../render/spriteStore";
import { notifyAssetsChanged, setAssetOverride } from "../render/assets";
import type { World } from "./world";
import { key } from "./world";

export const FURNITURE_PACK = "wowo-furniture-pack";
export const ROOM_PACK = "wowo-room-pack";
const FKEY = "wowo-custom-furniture";
const RKEY = "wowo-custom-rooms";
const IMAGE_SLOTS = ["base", "back", "on", "occupied"] as const;
type ImageSlot = (typeof IMAGE_SLOTS)[number];

/** 存在本机的自制家具：定义 + 有哪些图片 */
type StoredFurniture = FurnitureDef & { images: ImageSlot[] };

const BUILTIN_FURNITURE = new Set(FURNITURE.map((f) => f.id));
const BUILTIN_SPRITES = new Set(FURNITURE.map((f) => f.sprite ?? f.id));
const BUILTIN_ROOMS = new Set(ROOM_PRESETS.map((r) => r.id));

const read = <T>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 存不下就算了 */ } };

const spriteKey = (id: string) => `furn_${id}`;

function register(def: StoredFurniture) {
  const i = FURNITURE.findIndex((f) => f.id === def.id);
  if (i >= 0) FURNITURE.splice(i, 1, def); else FURNITURE.push(def);
  FURNITURE_BY_ID[def.id] = def;
  for (const slot of IMAGE_SLOTS) {
    const name = slot === "base" ? def.id : `${def.id}_${slot}`;
    setAssetOverride("furniture", name, def.images.includes(slot) ? spriteUrl(spriteKey(def.id), `${slot}.png`) : null);
  }
}

function registerRoom(r: RoomPreset) {
  const i = ROOM_PRESETS.findIndex((p) => p.id === r.id);
  if (i >= 0) ROOM_PRESETS.splice(i, 1, r); else ROOM_PRESETS.push(r);
}

/** 启动时把之前导入的自制家具和房间装回来（要在读存档之前） */
export function loadCustomHome() {
  for (const d of read<StoredFurniture>(FKEY)) if (d?.id && !BUILTIN_FURNITURE.has(d.id)) register(d);
  for (const r of read<RoomPreset>(RKEY)) if (r?.id && !BUILTIN_ROOMS.has(r.id)) registerRoom(r);
}

export const customFurniture = () => FURNITURE.filter((f) => f.custom);
export const customRooms = () => ROOM_PRESETS.filter((r) => r.custom);

// ———————————————————— 清理导入的数据 ————————————————————

const str = (v: unknown, max: number) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const int = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.round(v))) : d);
const num = (v: unknown, lo: number, hi: number, d: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d);
const color = (v: unknown, d: number) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? parseInt(v.slice(1), 16) : typeof v === "number" ? v & 0xffffff : d);
const ID = /^[a-z0-9_]{1,30}$/;
const NEEDS: (keyof Needs)[] = ["hunger", "energy", "bladder", "hygiene", "fun", "social", "comfort", "mood", "health"];
const POSES: Pose[] = ["stand", "sit", "lie", "use", "eat"];
const IMAGE = /^data:image\/(png|webp|jpeg);base64,[A-Za-z0-9+/=]+$/;
const TAG_SET = new Set(FURNITURE_TAGS);

export function cleanTags(v: unknown): string[] {
  return Array.isArray(v) ? [...new Set(v.filter((t): t is string => typeof t === "string" && TAG_SET.has(t)))].slice(0, 8) : [];
}

function cleanInteraction(v: unknown): InteractionDef | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const id = str(o.id, 20);
  const name = str(o.name, 20);
  if (!ID.test(id) || !name) return null;
  const per: Partial<Needs> = {};
  const pm = (o.perMinute ?? {}) as Record<string, unknown>;
  for (const k of NEEDS) if (typeof pm[k] === "number") per[k] = num(pm[k], -10, 10, 0);
  const m = Array.isArray(o.minutes) ? o.minutes : [];
  const lo = int(m[0], 1, 600, 5), hi = int(m[1], lo, 600, Math.max(lo, 30));
  return {
    id, name, pose: POSES.includes(o.pose as Pose) ? (o.pose as Pose) : "use", minutes: [lo, hi], perMinute: per,
    ...(o.onTop ? { onTop: true } : {}), ...(o.turnsOn ? { turnsOn: true } : {}), ...(o.news ? { news: true } : {}),
    ...(Array.isArray(o.tags) ? { tags: o.tags.filter((t): t is string => typeof t === "string").slice(0, 5).map((t) => t.slice(0, 12)) } : {}),
  };
}

function cleanFurniture(v: unknown, problems: string[]): { def: StoredFurniture; files: Record<string, string> } | null {
  const o = (v ?? {}) as Record<string, unknown>;
  let id = str(o.id, 30).toLowerCase();
  const name = str(o.name, 20);
  if (!ID.test(id) || !name) { problems.push(`有一件家具没有写好 id（小写字母、数字、下划线）或名字，跳过了`); return null; }
  if (BUILTIN_FURNITURE.has(id) || BUILTIN_SPRITES.has(id)) id = `x_${id}`; // 和内置家具撞名：自动加前缀
  const imgs = (o.images ?? {}) as Record<string, unknown>;
  const files: Record<string, string> = {};
  for (const slot of IMAGE_SLOTS) {
    const d = imgs[slot];
    if (typeof d === "string" && IMAGE.test(d) && d.length < 6_000_000) files[`${slot}.png`] = d;
    else if (d) problems.push(`${name}的 ${slot} 图片格式不对（要 data:image/png;base64,…），没用上`);
  }
  const interactions = (Array.isArray(o.interactions) ? o.interactions : []).map(cleanInteraction).filter((x): x is InteractionDef => !!x).slice(0, 8);
  const images = IMAGE_SLOTS.filter((s) => files[`${s}.png`]);
  const states = (["on", "occupied"] as const).filter((s) => images.includes(s));
  const layer = o.charLayer === "above" || o.charLayer === "below" ? o.charLayer : undefined;
  return {
    files,
    def: {
      id, name, custom: true, images,
      w: int(o.w, 1, 4, 1), h: int(o.h, 1, 4, 1), height: int(o.height, 2, 300, 80),
      color: color(o.color, 0xc8b4a0), category: str(o.category, 8) || "自制", icon: name.slice(0, 2),
      interactions,
      ...(o.walkable ? { walkable: true } : {}), ...(o.wallMounted ? { wallMounted: true } : {}),
      ...(states.length ? { states } : {}),
      ...(typeof o.standeeWidth === "number" ? { standeeWidth: int(o.standeeWidth, 20, 600, 96) } : {}),
      ...(layer ? { charLayer: layer } : {}),
      ...(o.stairs ? { stairs: true } : {}),
      tags: cleanTags(o.tags),
      ...(typeof o.warmth === "number" ? { warmth: num(o.warmth, -10, 10, 0) } : {}),
    },
  };
}

function cleanRoom(v: unknown, problems: string[]): RoomPreset | null {
  const o = (v ?? {}) as Record<string, unknown>;
  let id = str(o.id, 30).toLowerCase();
  const name = str(o.name, 12);
  if (!ID.test(id) || !name) { problems.push("有一个房间没有写好 id 或名字，跳过了"); return null; }
  if (BUILTIN_ROOMS.has(id)) id = `x_${id}`;
  const w = int(o.w, 1, 24, 4), h = int(o.h, 1, 24, 4);
  const floorOk = (f: unknown) => typeof f === "string" && FLOORS.some((x) => x.id === f);
  const styleOk = (s: unknown) => typeof s === "string" && WALL_STYLES.some((x) => x.id === s);
  const floor = floorOk(o.floor) ? (o.floor as string) : "wood";
  const wallStyle = styleOk(o.wallStyle) ? (o.wallStyle as string) : "cream";
  const furniture: RoomPreset["furniture"] = [];
  for (const f of Array.isArray(o.furniture) ? o.furniture : []) {
    const r = (f ?? {}) as Record<string, unknown>;
    let def = str(r.def, 30);
    if (!FURNITURE_BY_ID[def] && FURNITURE_BY_ID[`x_${def}`]?.custom) def = `x_${def}`;
    if (!FURNITURE_BY_ID[def]) { problems.push(`${name}里用到的家具「${def}」不认识，没放`); continue; }
    const x = int(r.x, 0, w - 1, 0), y = int(r.y, 0, h - 1, 0);
    furniture.push({ def, x, y, ...(r.rot === 1 ? { rot: 1 as const } : {}), ...(r.back ? { back: true } : {}), ...(r.flip ? { flip: true } : {}) });
  }
  const tiles = Array.isArray(o.tiles)
    ? (o.tiles as Record<string, unknown>[]).map((t) => ({ x: int(t?.x, 0, w - 1, 0), y: int(t?.y, 0, h - 1, 0), floor: floorOk(t?.floor) ? (t.floor as string) : floor })).slice(0, w * h)
    : undefined;
  const walls = Array.isArray(o.walls)
    ? (o.walls as Record<string, unknown>[]).filter((x) => (x?.dir === "N" || x?.dir === "W") && ["wall", "door", "window"].includes(x?.kind as string))
      .map((x) => ({ x: int(x.x, 0, w, 0), y: int(x.y, 0, h, 0), dir: x.dir as "N" | "W", kind: x.kind as Wall["kind"], style: styleOk(x.style) ? (x.style as string) : wallStyle })).slice(0, 400)
    : undefined;
  return { id, name, w, h, floor, wallStyle, furniture, custom: true, ...(tiles ? { tiles } : {}), ...(walls ? { walls } : {}) };
}

/** 导入家具包 / 房间包（两种可以写在同一个文件里）。返回导入了什么和遇到的问题。 */
export async function importHomePack(raw: unknown): Promise<{ furniture: string[]; rooms: string[]; problems: string[] }> {
  const root = (raw ?? {}) as Record<string, unknown>;
  const problems: string[] = [];
  const out = { furniture: [] as string[], rooms: [] as string[], problems };
  if (root.format && root.format !== FURNITURE_PACK && root.format !== ROOM_PACK) {
    problems.push(root.format === "wowo-character-pack" ? "这是角色包，请到「角色」里导入" : "文件格式不认识");
    return out;
  }
  const stored = read<StoredFurniture>(FKEY);
  for (const item of (Array.isArray(root.furniture) ? root.furniture : []).slice(0, 100)) {
    const c = cleanFurniture(item, problems);
    if (!c) continue;
    if (Object.keys(c.files).length) await saveSprites(spriteKey(c.def.id), c.files);
    const i = stored.findIndex((d) => d.id === c.def.id);
    if (i >= 0) stored.splice(i, 1, c.def); else stored.push(c.def);
    register(c.def);
    out.furniture.push(c.def.name);
  }
  write(FKEY, stored);
  const rooms = read<RoomPreset>(RKEY);
  for (const item of (Array.isArray(root.rooms) ? root.rooms : []).slice(0, 50)) {
    const r = cleanRoom(item, problems);
    if (!r) continue;
    const i = rooms.findIndex((x) => x.id === r.id);
    if (i >= 0) rooms.splice(i, 1, r); else rooms.push(r);
    registerRoom(r);
    out.rooms.push(r.name);
  }
  write(RKEY, rooms);
  if (!out.furniture.length && !out.rooms.length && !problems.length) problems.push("文件里没有找到家具（furniture）或房间（rooms）");
  notifyAssetsChanged();
  return out;
}

/** 删掉一件自制家具（家里摆着的也一起拿走） */
export async function removeCustomFurniture(world: World, id: string) {
  const def = FURNITURE_BY_ID[id];
  if (!def?.custom) return;
  for (const f of world.data.furniture.filter((x) => x.def === id)) world.removeFurniture(f.uid);
  const i = FURNITURE.findIndex((f) => f.id === id);
  if (i >= 0) FURNITURE.splice(i, 1);
  delete FURNITURE_BY_ID[id];
  write(FKEY, read<StoredFurniture>(FKEY).filter((d) => d.id !== id));
  await deleteSprites(spriteKey(id));
}

export function removeCustomRoom(id: string) {
  const i = ROOM_PRESETS.findIndex((r) => r.id === id && r.custom);
  if (i >= 0) ROOM_PRESETS.splice(i, 1);
  write(RKEY, read<RoomPreset>(RKEY).filter((r) => r.id !== id));
}

/** 改一件家具的标签（AI 填写或手动改），自制家具会存下来，内置家具存在单独的表里 */
export function setFurnitureTags(id: string, tags: string[]) {
  const def = FURNITURE_BY_ID[id];
  if (!def) return;
  def.tags = cleanTags(tags);
  if (def.custom) {
    write(FKEY, read<StoredFurniture>(FKEY).map((d) => (d.id === id ? { ...d, tags: def.tags } : d)));
  } else {
    const all = readTagOverrides();
    all[id] = def.tags;
    try { localStorage.setItem("wowo-furniture-tags", JSON.stringify(all)); } catch { /* 存不下就算了 */ }
  }
}
function readTagOverrides(): Record<string, string[]> {
  try { return JSON.parse(localStorage.getItem("wowo-furniture-tags") ?? "{}") ?? {}; } catch { return {}; }
}
/** 启动时套用改过的内置家具标签 */
export function loadTagOverrides() {
  for (const [id, tags] of Object.entries(readTagOverrides())) if (FURNITURE_BY_ID[id] && Array.isArray(tags)) FURNITURE_BY_ID[id].tags = cleanTags(tags);
}

// ———————————————————— 导出 ————————————————————

async function furnitureEntry(def: FurnitureDef) {
  const { images: _img, custom: _c, icon: _i, ...rest } = def as StoredFurniture;
  const files = def.custom ? await readSprites(spriteKey(def.id)).catch(() => null) : null;
  const images: Record<string, string> = {};
  for (const slot of IMAGE_SLOTS) {
    const d = files?.[`${slot}.png`] ?? (def.custom ? await fetchData(spriteUrl(spriteKey(def.id), `${slot}.png`)) : null);
    if (d) images[slot] = d;
  }
  return { ...rest, color: `#${def.color.toString(16).padStart(6, "0")}`, ...(Object.keys(images).length ? { images } : {}) };
}

async function fetchData(url: string): Promise<string | null> {
  if (!url.startsWith("blob:")) return null;
  try {
    const b = await (await fetch(url)).blob();
    return await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result)); fr.readAsDataURL(b); });
  } catch { return null; }
}

/** 把家里的一个房间导出成房间包（用到的自制家具连图片一起带上） */
export async function exportRoom(world: World, room: string) {
  const cells = Object.entries(world.data.tiles).filter(([, t]) => t.room === room).map(([k, t]) => { const [x, y] = k.split(",").map(Number); return { x, y, floor: t.floor }; });
  if (!cells.length) return null;
  const x0 = Math.min(...cells.map((c) => c.x)), y0 = Math.min(...cells.map((c) => c.y));
  const x1 = Math.max(...cells.map((c) => c.x)), y1 = Math.max(...cells.map((c) => c.y));
  const inRoom = (x: number, y: number) => world.data.tiles[key(x, y)]?.room === room;
  const most = (arr: string[]) => [...arr.reduce((m, v) => m.set(v, (m.get(v) ?? 0) + 1), new Map<string, number>())].sort((a, b) => b[1] - a[1])[0]?.[0];
  const walls: NonNullable<RoomPreset["walls"]> = [];
  for (const [k, w] of Object.entries(world.data.walls)) {
    const [xs, ys, dir] = k.split(","); const x = +xs, y = +ys;
    const touches = inRoom(x, y) || (dir === "N" ? inRoom(x, y - 1) : inRoom(x - 1, y));
    if (touches && x >= x0 && x <= x1 + 1 && y >= y0 && y <= y1 + 1) walls.push({ x: x - x0, y: y - y0, dir: dir as "N" | "W", kind: w.kind, style: w.style });
  }
  const furn = world.data.furniture.filter((f) => inRoom(f.x, f.y));
  const preset = {
    id: `room_${Date.now().toString(36)}`, name: room, w: x1 - x0 + 1, h: y1 - y0 + 1,
    floor: most(cells.map((c) => c.floor)) ?? "wood", wallStyle: most(walls.map((w) => w.style)) ?? "cream",
    tiles: cells.map((c) => ({ x: c.x - x0, y: c.y - y0, floor: c.floor })),
    walls,
    furniture: furn.map((f) => ({ def: f.def, x: f.x - x0, y: f.y - y0, ...(f.rot ? { rot: 1 } : {}), ...(f.back ? { back: true } : {}), ...(f.flip ? { flip: true } : {}) })),
  };
  const customs = [...new Set(furn.map((f) => f.def))].map((id) => FURNITURE_BY_ID[id]).filter((d) => d?.custom);
  return { format: ROOM_PACK, version: 1, furniture: await Promise.all(customs.map(furnitureEntry)), rooms: [preset] };
}

/** 导出全部自制家具 */
export async function exportFurniturePack() {
  return { format: FURNITURE_PACK, version: 1, furniture: await Promise.all(customFurniture().map(furnitureEntry)) };
}
