// DIY 公寓的户型：在 2D 平面图上拼房间，确认后生成到游戏里的房子。
// 户型只记录「哪里有什么类型的房间、门开在哪」，家具按房间类型自动摆放。
import { FURNITURE_BY_ID } from "./catalog";
import { autoWalls } from "./presets";
import { World, key, wkey } from "./world";

export interface RoomKind {
  id: string;
  name: string;
  w: number; h: number;       // 默认大小
  minW: number; minH: number; // 最小大小
  floor: string;
  wall: string;
  color: string;              // 平面图上的颜色
  window?: boolean;
  outdoor?: boolean;          // 室外：不砌外墙
  /** 默认家具。at 是摆放位置：上边靠墙的左/中/右、中间、中间下面一行、左右两边、四个角 */
  furnish: { def: string; at: "top-left" | "top-center" | "top-right" | "top" | "center" | "below-center" | "left" | "right" | "corner-bl" | "corner-br"; back?: boolean; rot?: 0 | 1 }[];
}

export const ROOM_KINDS: RoomKind[] = [
  {
    id: "living", name: "客厅", w: 6, h: 5, minW: 3, minH: 3, floor: "wood", wall: "cream", color: "#f3d9b8", window: true,
    furnish: [
      { def: "bookshelf", at: "top-left" }, { def: "tv", at: "top-center" }, { def: "plant_big", at: "top-right" },
      { def: "rug", at: "center" }, { def: "coffee_table", at: "center" }, { def: "sofa", at: "below-center", back: true },
      { def: "armchair", at: "right" }, { def: "lamp", at: "corner-bl" }, { def: "low_cabinet", at: "corner-br" },
      { def: "wall_painting", at: "top-left" }, { def: "wall_clock", at: "top-right" },
    ],
  },
  {
    id: "bedroom", name: "卧室", w: 4, h: 4, minW: 2, minH: 2, floor: "carpet", wall: "peach", color: "#f8cfd9", window: true,
    furnish: [
      { def: "wardrobe", at: "top-left" }, { def: "bed", at: "top-right", rot: 1 }, { def: "nightstand", at: "top" },
      { def: "dresser", at: "corner-bl" }, { def: "plant_small", at: "corner-br" }, { def: "wall_clock", at: "top-center" },
    ],
  },
  {
    id: "master", name: "主卧", w: 5, h: 4, minW: 3, minH: 3, floor: "carpet_lilac", wall: "lilac", color: "#e3d6f3", window: true,
    furnish: [
      { def: "wardrobe", at: "top-left" }, { def: "bed_double", at: "top-center" }, { def: "lamp_desk", at: "top-right" },
      { def: "floor_cushion", at: "below-center" }, { def: "beanbag", at: "corner-bl" }, { def: "mirror_stand", at: "corner-br" },
      { def: "wall_shelf", at: "top-center" }, { def: "curtain", at: "top-left" },
    ],
  },
  {
    id: "kitchen", name: "厨房", w: 4, h: 3, minW: 2, minH: 2, floor: "tile", wall: "kitchen", color: "#d6ece2", window: true,
    furnish: [
      { def: "fridge", at: "top-left" }, { def: "stove", at: "top" }, { def: "sink", at: "top" }, { def: "kitchen_counter", at: "top" },
      { def: "microwave_cabinet", at: "top" }, { def: "table", at: "corner-bl" }, { def: "chair", at: "corner-br" },
    ],
  },
  {
    id: "dining", name: "餐厅", w: 4, h: 4, minW: 3, minH: 3, floor: "wood_dark", wall: "cream", color: "#e8c9a8", window: true,
    furnish: [
      { def: "cupboard", at: "top-left" }, { def: "plant_big", at: "top-right" }, { def: "table", at: "center" },
      { def: "chair", at: "left" }, { def: "chair", at: "right" }, { def: "round_table", at: "corner-br" }, { def: "wall_painting", at: "top-center" },
    ],
  },
  {
    id: "bathroom", name: "浴室", w: 3, h: 3, minW: 2, minH: 2, floor: "mosaic", wall: "sky", color: "#cfe5f5",
    furnish: [{ def: "bathtub", at: "top-left" }, { def: "washbasin", at: "top-right" }, { def: "toilet", at: "corner-bl" }, { def: "medicine", at: "right" }],
  },
  {
    id: "laundry", name: "洗衣房", w: 3, h: 2, minW: 2, minH: 2, floor: "tile", wall: "sky", color: "#dde7ef",
    furnish: [{ def: "washing_machine", at: "top-left" }, { def: "laundry_basket", at: "top" }, { def: "towel_rack", at: "top-right" }],
  },
  {
    id: "study", name: "书房", w: 3, h: 4, minW: 2, minH: 2, floor: "mint", wall: "lilac", color: "#cdeadf", window: true,
    furnish: [{ def: "desk", at: "top-right" }, { def: "bookshelf", at: "top-left" }, { def: "office_chair", at: "center" }, { def: "easel", at: "corner-br" }, { def: "plant", at: "corner-bl" }, { def: "wall_shelf", at: "top-left" }],
  },
  {
    id: "music", name: "音乐室", w: 4, h: 4, minW: 3, minH: 3, floor: "wood", wall: "night", color: "#c9cdef", window: true,
    furnish: [
      { def: "upright_piano", at: "top-left" }, { def: "keyboard_stand", at: "top-right" }, { def: "mic_stand", at: "center" },
      { def: "guitar_stand", at: "corner-br" }, { def: "electric_guitar_stand", at: "right" }, { def: "speaker", at: "corner-bl" }, { def: "music_stand", at: "left" }, { def: "wall_poster", at: "top-center" },
    ],
  },
  {
    id: "game", name: "游戏室", w: 4, h: 3, minW: 3, minH: 2, floor: "carpet_blue", wall: "pink", color: "#c9daf2",
    furnish: [{ def: "arcade_machine", at: "top-left" }, { def: "game_tv", at: "top-center" }, { def: "gaming_chair", at: "center", back: true }, { def: "beanbag", at: "corner-bl" }, { def: "floor_cushion", at: "corner-br" }, { def: "wall_poster", at: "top-right" }],
  },
  {
    id: "entry", name: "玄关", w: 2, h: 2, minW: 1, minH: 1, floor: "tile", wall: "cream", color: "#efe6d6",
    furnish: [{ def: "shoe_cabinet", at: "top-left" }, { def: "coat_rack", at: "corner-bl" }, { def: "umbrella_stand", at: "corner-br" }],
  },
  { id: "hall", name: "走廊", w: 4, h: 1, minW: 1, minH: 1, floor: "wood", wall: "cream", color: "#efe2cc", furnish: [] },
  {
    id: "balcony", name: "阳台", w: 3, h: 2, minW: 1, minH: 1, floor: "deck", wall: "cream", color: "#e6d2b4", outdoor: true,
    furnish: [{ def: "plant_big", at: "top-left" }, { def: "patio_table", at: "top-right" }, { def: "flower_bed", at: "corner-bl" }, { def: "bench", at: "corner-br" }],
  },
  {
    id: "yard", name: "院子", w: 4, h: 3, minW: 1, minH: 1, floor: "grass", wall: "cream", color: "#cdeab8", outdoor: true,
    furnish: [{ def: "small_tree", at: "top-left" }, { def: "flower_bed", at: "top-right" }, { def: "bench", at: "corner-bl" }, { def: "mailbox", at: "corner-br" }, { def: "bicycle", at: "center" }],
  },
  { id: "empty", name: "空房间", w: 3, h: 3, minW: 1, minH: 1, floor: "wood", wall: "cream", color: "#ebe6ee", furnish: [] },
];

export const KIND_BY_ID = Object.fromEntries(ROOM_KINDS.map((k) => [k.id, k])) as Record<string, RoomKind>;

export interface PlanRoom {
  id: string;
  kind: string;
  name: string;
  x: number; y: number; w: number; h: number;
}

export interface Plan {
  rooms: PlanRoom[];
  doors: string[]; // 墙边的 key（"x,y,N" 或 "x,y,W"），和 World 的墙用同一种写法
}

let idSeq = 0;
export const planId = () => `pr${Date.now().toString(36)}${(idSeq++).toString(36)}`;

// ———————————————————— 几何 ————————————————————

export function overlaps(a: { x: number; y: number; w: number; h: number }, b: { x: number; y: number; w: number; h: number }) {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

export function roomAt(plan: Plan, x: number, y: number) {
  return plan.rooms.find((r) => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h);
}

/** 两个房间之间共用的墙边（按顺序排好） */
export function sharedEdges(a: PlanRoom, b: PlanRoom): string[] {
  const out: string[] = [];
  // a 在 b 上面 / 下面：横向的墙（N 边）
  if (a.y + a.h === b.y || b.y + b.h === a.y) {
    const y = a.y + a.h === b.y ? b.y : a.y;
    for (let x = Math.max(a.x, b.x); x < Math.min(a.x + a.w, b.x + b.w); x++) out.push(wkey(x, y, "N"));
  }
  // a 在 b 左边 / 右边：竖向的墙（W 边）
  if (a.x + a.w === b.x || b.x + b.w === a.x) {
    const x = a.x + a.w === b.x ? b.x : a.x;
    for (let y = Math.max(a.y, b.y); y < Math.min(a.y + a.h, b.y + b.h); y++) out.push(wkey(x, y, "W"));
  }
  return out;
}

/** 房间朝外（另一侧没有房间）的墙边 */
export function exteriorEdges(plan: Plan, r: PlanRoom): { key: string; side: "top" | "bottom" | "left" | "right" }[] {
  const out: { key: string; side: "top" | "bottom" | "left" | "right" }[] = [];
  for (let x = r.x; x < r.x + r.w; x++) {
    if (!roomAt(plan, x, r.y - 1)) out.push({ key: wkey(x, r.y, "N"), side: "top" });
    if (!roomAt(plan, x, r.y + r.h)) out.push({ key: wkey(x, r.y + r.h, "N"), side: "bottom" });
  }
  for (let y = r.y; y < r.y + r.h; y++) {
    if (!roomAt(plan, r.x - 1, y)) out.push({ key: wkey(r.x, y, "W"), side: "left" });
    if (!roomAt(plan, r.x + r.w, y)) out.push({ key: wkey(r.x + r.w, y, "W"), side: "right" });
  }
  return out;
}

// 开门的「代价」：走廊、客厅、玄关这种公共空间便宜，卧室、浴室这种私密房间贵。
// 两个房间之间开门的代价 = 两边代价之和，按代价从低到高连通所有房间。
const DOOR_COST: Record<string, number> = {
  hall: 0, living: 1, entry: 1, dining: 2, yard: 2, balcony: 2, kitchen: 3, empty: 3,
  study: 4, game: 4, music: 4, bedroom: 5, master: 5, laundry: 5, bathroom: 6,
};

/**
 * 整理门：
 * 1. 去掉已经不在两个房间之间的门（外墙上保留一扇大门）。
 * 2. 只补必要的门：保证每个房间都能走到，优先往走廊、客厅这些公共空间开门。
 *    玩家自己加的门都保留。
 * 3. 保证有一扇通向外面的大门（优先玄关、其次客厅，开在房间下边）。
 */
export function ensureDoors(plan: Plan) {
  const rs = plan.rooms;
  const edgeRooms = new Map<string, [number, number]>(); // 墙边 → 两边房间的下标
  const pairs: { a: number; b: number; edges: string[] }[] = [];
  for (let i = 0; i < rs.length; i++) {
    for (let j = i + 1; j < rs.length; j++) {
      const edges = sharedEdges(rs[i], rs[j]);
      if (!edges.length) continue;
      edges.forEach((e) => edgeRooms.set(e, [i, j]));
      pairs.push({ a: i, b: j, edges });
    }
  }
  const indoor = rs.filter((r) => !KIND_BY_ID[r.kind]?.outdoor);
  const ext = new Set<string>();
  for (const r of indoor) for (const e of exteriorEdges(plan, r)) ext.add(e.key);

  // 1. 去掉无效的门
  const doors = new Set<string>();
  let hasFront = false;
  for (const d of plan.doors) {
    if (edgeRooms.has(d)) doors.add(d);
    else if (ext.has(d) && !hasFront) { doors.add(d); hasFront = true; }
  }

  // 2. 用并查集按现有的门把房间连起来，再按代价补门
  const parent = rs.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const union = (a: number, b: number) => { parent[find(a)] = find(b); };
  for (const d of doors) { const p = edgeRooms.get(d); if (p) union(p[0], p[1]); }
  const cost = (i: number) => DOOR_COST[rs[i].kind] ?? 3;
  pairs.sort((x, y) => cost(x.a) + cost(x.b) - (cost(y.a) + cost(y.b)) || y.edges.length - x.edges.length);
  for (const p of pairs) {
    if (find(p.a) === find(p.b)) continue;
    doors.add(p.edges[Math.floor((p.edges.length - 1) / 2)]);
    union(p.a, p.b);
  }

  // 3. 大门：有院子或阳台连着时，可以从那里出门
  const touchesOutdoor = rs.some((r) => KIND_BY_ID[r.kind]?.outdoor && indoor.some((o) => sharedEdges(r, o).length));
  if (!hasFront && !touchesOutdoor && indoor.length) {
    const pick = indoor.find((r) => r.kind === "entry") ?? indoor.find((r) => r.kind === "living") ?? indoor[0];
    const edges = exteriorEdges(plan, pick);
    const prefer = edges.filter((e) => e.side === "bottom");
    const list = prefer.length ? prefer : edges;
    if (list.length) doors.add(list[Math.floor((list.length - 1) / 2)].key);
  }
  plan.doors = [...doors];
}

/** 新放一个房间时，给它找一个不重名的名字 */
export function uniqueName(plan: Plan, base: string, except?: string) {
  const names = new Set(plan.rooms.filter((r) => r.id !== except).map((r) => r.name));
  if (!names.has(base)) return base;
  for (let i = 2; ; i++) if (!names.has(`${base}${i}`)) return `${base}${i}`;
}

// ———————————————————— 和游戏里的房子互相转换 ————————————————————

/** 从现在的房子读出户型。不规则的房间（比如 L 形的院子）拆成几个矩形。 */
export function planFromWorld(world: World): Plan {
  const byName = new Map<string, Set<string>>();
  for (const [k, t] of Object.entries(world.data.tiles)) {
    const name = t.room ?? "房间";
    if (!byName.has(name)) byName.set(name, new Set());
    byName.get(name)!.add(k);
  }
  const guess = (name: string) => ROOM_KINDS.find((k) => name.includes(k.name))?.id ?? (name.includes("卧") ? "bedroom" : "empty");
  const rooms: PlanRoom[] = [];
  for (const [name, tiles] of byName) {
    let part = 0;
    while (tiles.size) {
      // 取最上、最左的一格，向右尽量延伸，再向下按整行延伸
      const [sx, sy] = [...tiles].map((k) => k.split(",").map(Number)).sort((a, b) => a[1] - b[1] || a[0] - b[0])[0];
      let w = 1;
      while (tiles.has(key(sx + w, sy))) w++;
      let h = 1;
      while ([...Array(w).keys()].every((i) => tiles.has(key(sx + i, sy + h)))) h++;
      for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) tiles.delete(key(sx + dx, sy + dy));
      part++;
      rooms.push({ id: planId(), kind: guess(name), name: part === 1 ? name : `${name}${part}`, x: sx, y: sy, w, h });
    }
  }
  const doors = Object.entries(world.data.walls).filter(([, w]) => w.kind === "door").map(([k]) => k);
  const plan = { rooms, doors };
  ensureDoors(plan);
  return plan;
}

/** 按户型重新生成房子：清空原来的地板、墙和家具，每个房间按类型摆上默认家具 */
export function applyPlan(world: World, plan: Plan) {
  // 新房间可能加在原来房子的左边或上面（坐标是负数），先整体挪回从 0 开始
  if (plan.rooms.length) {
    const dx = -Math.min(...plan.rooms.map((r) => r.x)), dy = -Math.min(...plan.rooms.map((r) => r.y));
    if (dx || dy) {
      for (const r of plan.rooms) { r.x += dx; r.y += dy; }
      plan.doors = plan.doors.map((k) => { const [x, y, d] = k.split(","); return `${Number(x) + dx},${Number(y) + dy},${d}`; });
    }
  }
  ensureDoors(plan);
  world.data.tiles = {};
  world.data.walls = {};
  world.data.furniture = [];
  world.data.foods = [];
  world.rebuildIndex();
  if (!plan.rooms.length) return;

  for (const r of plan.rooms) {
    const k = KIND_BY_ID[r.kind] ?? KIND_BY_ID.empty;
    for (let x = r.x; x < r.x + r.w; x++) for (let y = r.y; y < r.y + r.h; y++) world.setFloor(x, y, k.floor, r.name);
  }
  // 先砌墙（每个房间用自己的墙纸）
  for (const r of plan.rooms) autoWalls(world, r.x, r.y, r.w, r.h, (KIND_BY_ID[r.kind] ?? KIND_BY_ID.empty).wall);
  // 室外房间（院子、阳台）：朝外的那一面和彼此之间不要墙
  const outdoorAt = (x: number, y: number) => {
    const r = roomAt(plan, x, y);
    return !r || !!KIND_BY_ID[r.kind]?.outdoor;
  };
  for (const k of Object.keys(world.data.walls)) {
    const [xs, ys, d] = k.split(",");
    const x = Number(xs), y = Number(ys);
    const [ax, ay] = d === "N" ? [x, y - 1] : [x - 1, y];
    if (outdoorAt(x, y) && outdoorAt(ax, ay)) delete world.data.walls[k];
  }
  // 门
  for (const d of plan.doors) {
    const [xs, ys, dir] = d.split(",");
    const style = world.data.walls[d]?.style ?? "cream";
    world.setWall(Number(xs), Number(ys), dir as "N" | "W", { kind: "door", style });
  }
  // 窗：朝外的上边墙中间
  for (const r of plan.rooms) {
    const k = KIND_BY_ID[r.kind];
    if (!k?.window) continue;
    const tops = exteriorEdges(plan, r).filter((e) => e.side === "top" && world.data.walls[e.key]?.kind === "wall");
    if (tops.length) {
      const pick = tops[Math.floor((tops.length - 1) / 2)].key;
      world.data.walls[pick] = { kind: "window", style: world.data.walls[pick].style };
    }
  }
  world.version++;
  for (const r of plan.rooms) furnish(world, plan, r);
  world.rebuildIndex();
}

/** 门两侧的格子：不能摆家具，保证走得通 */
function doorTiles(plan: Plan) {
  const s = new Set<string>();
  for (const d of plan.doors) {
    const [xs, ys, dir] = d.split(",");
    const x = Number(xs), y = Number(ys);
    s.add(key(x, y));
    s.add(dir === "N" ? key(x, y - 1) : key(x - 1, y));
  }
  return s;
}

/** 房间里从门口能走到的格子 */
function reachableIn(world: World, r: PlanRoom, starts: [number, number][]) {
  const seen = new Set<string>();
  const queue = starts.filter(([x, y]) => world.walkable(x, y));
  for (const [x, y] of queue) seen.add(key(x, y));
  while (queue.length) {
    const [x, y] = queue.shift()!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < r.x || ny < r.y || nx >= r.x + r.w || ny >= r.y + r.h) continue;
      const k = key(nx, ny);
      if (seen.has(k) || !world.walkable(nx, ny) || !world.passable(x, y, nx, ny)) continue;
      seen.add(k);
      queue.push([nx, ny]);
    }
  }
  return seen;
}

/**
 * 按房间类型摆家具。每件家具先试它的首选位置，放不下就按离首选位置的远近试房间里的其他位置；
 * 每放一件都检查：门口没被堵、从门口仍然能走到每一件已经摆好的家具。实在放不下就不放。
 */
function furnish(world: World, plan: Plan, r: PlanRoom) {
  const kind = KIND_BY_ID[r.kind];
  if (!kind) return;
  const reserved = doorTiles(plan);
  const inRoom = (x: number, y: number) => x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h;
  // 起点：这个房间里挨着门的格子；没有门（不应该发生）就用房间里第一格
  let starts = [...reserved].map((k) => k.split(",").map(Number) as [number, number]).filter(([x, y]) => inRoom(x, y));
  if (!starts.length) starts = [[r.x, r.y]];
  const placed: string[] = [];

  const allReachable = () => {
    // 从其中一个门口出发，要能走到其他所有门口和每一件家具
    const reach = reachableIn(world, r, [starts[0]]);
    if (starts.some(([x, y]) => !reach.has(key(x, y)))) return false;
    return placed.every((id) => {
      const f = world.getFurniture(id);
      if (!f || FURNITURE_BY_ID[f.def].walkable || FURNITURE_BY_ID[f.def].wallMounted) return true;
      return world.accessSpots(f).some((sp) => reach.has(key(sp.x, sp.y)));
    });
  };

  for (const item of kind.furnish) {
    const d = FURNITURE_BY_ID[item.def];
    if (!d) continue;
    const rot = item.rot ?? 0;
    const w = rot ? d.h : d.w, h = rot ? d.w : d.h;
    if (w > r.w || h > r.h) continue;
    const cx = r.x + Math.floor((r.w - w) / 2), cy = r.y + Math.floor((r.h - h) / 2);
    const right = r.x + r.w - w, bottom = r.y + r.h - h;
    const pref: Record<string, [number, number]> = {
      "top-left": [r.x, r.y], "top-center": [cx, r.y], "top-right": [right, r.y], top: [r.x, r.y],
      center: [cx, cy], "below-center": [cx, Math.min(bottom, cy + 1)], left: [r.x, cy], right: [right, cy],
      "corner-bl": [r.x, bottom], "corner-br": [right, bottom],
    };
    const [px, py] = pref[item.at];
    // 候选位置：靠墙的家具优先贴着上边墙，其余按离首选位置的距离
    const candidates: [number, number][] = [];
    for (let x = r.x; x <= right; x++) for (let y = r.y; y <= bottom; y++) candidates.push([x, y]);
    const wallItem = item.at.startsWith("top");
    candidates.sort((a, b) => {
      const da = Math.abs(a[0] - px) + Math.abs(a[1] - py) * (wallItem ? 3 : 1);
      const db = Math.abs(b[0] - px) + Math.abs(b[1] - py) * (wallItem ? 3 : 1);
      return da - db;
    });
    for (const [x, y] of candidates) {
      let blocked = false;
      if (!d.walkable) for (let dx = 0; dx < w && !blocked; dx++) for (let dy = 0; dy < h; dy++) if (reserved.has(key(x + dx, y + dy))) { blocked = true; break; }
      if (blocked) continue;
      // 墙饰只挂在房间上边朝外的实墙上（室内墙默认显示成矮墙沿，挂不住）
      if (d.wallMounted && (y !== r.y || world.wall(x, y, "N")?.kind !== "wall" || roomAt(plan, x, y - 1))) continue;
      const f = world.addFurniture(item.def, x, y, rot);
      if (!f) continue;
      placed.push(f.uid);
      if (d.walkable || d.wallMounted || allReachable()) {
        if (item.back) f.back = true;
        break;
      }
      placed.pop();
      world.removeFurniture(f.uid);
    }
  }
}
