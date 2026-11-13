// 内置房间：可以单独盖在任意位置，也有一整套初始小屋。
import type { Wall } from "../core/types";
import { LEVEL_SPAN, World, footprint, key, levelName, levelOf, wkey } from "./world";
import { FURNITURE_BY_ID } from "./catalog";

export interface RoomPreset {
  id: string;
  name: string;
  w: number;
  h: number;
  floor: string;
  wallStyle: string;
  furniture: { def: string; x: number; y: number; rot?: 0 | 1; back?: boolean; flip?: boolean }[];
  /** 不是方方正正的房间：只铺这些格子（各自的地板）；不写就铺满 w×h */
  tiles?: { x: number; y: number; floor: string }[];
  /** 精确的墙、门、窗（相对房间左上角）；不写就自动围墙、南边开门、北墙开窗 */
  walls?: { x: number; y: number; dir: "N" | "W"; kind: Wall["kind"]; style: string }[];
  custom?: boolean; // 从房间包导入的
}

export const ROOM_PRESETS: RoomPreset[] = [
  {
    id: "bedroom", name: "卧室", w: 4, h: 4, floor: "carpet", wallStyle: "peach",
    furniture: [
      { def: "bed", x: 0, y: 0 }, { def: "wardrobe", x: 3, y: 0 }, { def: "lamp", x: 2, y: 0 }, { def: "plant", x: 3, y: 3 },
    ],
  },
  {
    id: "living", name: "客厅", w: 5, h: 4, floor: "wood", wallStyle: "cream",
    furniture: [
      { def: "rug", x: 1, y: 1 }, { def: "sofa", x: 2, y: 3 }, { def: "tv", x: 1, y: 0 }, { def: "plant", x: 4, y: 0 }, { def: "bookshelf", x: 0, y: 0 },
    ],
  },
  {
    id: "kitchen", name: "厨房", w: 4, h: 4, floor: "tile", wallStyle: "sage",
    furniture: [
      { def: "fridge", x: 0, y: 0 }, { def: "stove", x: 1, y: 0 }, { def: "sink", x: 2, y: 0 }, { def: "kitchen_counter", x: 3, y: 0 },
      { def: "table", x: 1, y: 2 }, { def: "chair", x: 1, y: 3 }, { def: "chair", x: 2, y: 3 },
    ],
  },
  {
    id: "bathroom", name: "浴室", w: 3, h: 3, floor: "tile", wallStyle: "sky",
    furniture: [{ def: "bathtub", x: 0, y: 0 }, { def: "toilet", x: 2, y: 2 }, { def: "medicine", x: 2, y: 0 }],
  },
  {
    id: "study", name: "书房", w: 3, h: 3, floor: "mint", wallStyle: "sky",
    furniture: [{ def: "desk", x: 0, y: 0 }, { def: "bookshelf", x: 2, y: 0 }, { def: "chair", x: 0, y: 1 }, { def: "plant", x: 2, y: 2 }],
  },
  {
    id: "stairwell", name: "楼梯间", w: 2, h: 3, floor: "wood", wallStyle: "cream",
    furniture: [{ def: "stairs", x: 0, y: 0 }],
  },
];

/** 在 (ox, oy) 处盖一个预设房间，房间名重复时自动加编号。 */
export function stampPreset(world: World, p: RoomPreset, ox: number, oy: number, roomName?: string) {
  let name = roomName ?? p.name;
  const existing = world.rooms();
  if (!roomName && existing.includes(name)) {
    let i = 2;
    while (existing.includes(`${p.name}${i}`)) i++;
    name = `${p.name}${i}`;
  }
  const cells = p.tiles ?? Array.from({ length: p.w * p.h }, (_, i) => ({ x: i % p.w, y: Math.floor(i / p.w), floor: p.floor }));
  for (const c of cells) {
    const f = world.furnitureAt(ox + c.x, oy + c.y);
    if (f) world.removeFurniture(f.uid);
    world.setFloor(ox + c.x, oy + c.y, c.floor, name);
  }
  if (p.walls) {
    for (const w of p.walls) world.setWall(ox + w.x, oy + w.y, w.dir, { kind: w.kind, style: w.style });
  } else {
    autoWalls(world, ox, oy, p.w, p.h, p.wallStyle);
    // 南边中间开一扇门，北墙放一扇窗
    const mid = ox + Math.floor(p.w / 2);
    world.setWall(mid, oy + p.h, "N", { kind: "door", style: p.wallStyle });
    if (p.w >= 4 && !world.tile(ox + p.w - 2, oy - 1)) world.setWall(ox + p.w - 2, oy, "N", { kind: "window", style: p.wallStyle });
  }
  for (const f of p.furniture) {
    const inst = world.addFurniture(f.def, ox + f.x, oy + f.y, f.rot ?? 0);
    if (inst && f.back) inst.back = true;
    if (inst && f.flip) inst.flip = true;
    if (inst) ensureLanding(world, inst);
  }
  return name;
}

/** 给一块区域的边缘补墙：边的另一侧没有地板、或属于别的房间时就砌墙。已有的门窗保留。 */
export function autoWalls(world: World, ox: number, oy: number, w: number, h: number, style: string, keepExisting = false) {
  const put = (k: string, wall: Wall) => {
    const old = world.data.walls[k];
    if (old && (old.kind !== "wall" || keepExisting)) return;
    world.data.walls[k] = wall;
  };
  for (let x = ox; x < ox + w; x++) {
    for (let y = oy; y < oy + h; y++) {
      const t = world.data.tiles[key(x, y)];
      if (!t) continue;
      const diff = (nx: number, ny: number) => {
        const n = world.data.tiles[key(nx, ny)];
        return !n || n.room !== t.room;
      };
      const wall: Wall = { kind: "wall", style };
      if (diff(x, y - 1)) put(wkey(x, y, "N"), wall);
      else if (world.data.walls[wkey(x, y, "N")]?.kind === "wall") delete world.data.walls[wkey(x, y, "N")];
      if (diff(x - 1, y)) put(wkey(x, y, "W"), wall);
      else if (world.data.walls[wkey(x, y, "W")]?.kind === "wall") delete world.data.walls[wkey(x, y, "W")];
      if (diff(x + 1, y)) put(wkey(x + 1, y, "W"), wall);
      if (diff(x, y + 1)) put(wkey(x, y + 1, "N"), wall);
    }
  }
  world.version++;
}

/** 按坐标盖一个指定大小的房间（不自动开门），返回房间名 */
function room(world: World, name: string, x: number, y: number, w: number, h: number, floor: string, style: string, furniture: { def: string; x: number; y: number; rot?: 0 | 1; back?: boolean }[] = []) {
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) world.setFloor(x + dx, y + dy, floor, name);
  autoWalls(world, x, y, w, h, style);
  for (const f of furniture) {
    const inst = world.addFurniture(f.def, x + f.x, y + f.y, f.rot ?? 0);
    if (inst && f.back) inst.back = true;
  }
  return name;
}

/**
 * 新存档的初始小屋：像真实的房子一样，房间有行有列、大小不一。
 *
 *   x→ 0 1 2 3 4 5 | 6 7 8 9 | 10 11
 *   y0 [   客厅 6×5 ][ 厨房 4×3 ]
 *   y3 [            ][浴室3×2][  书房 3×4 ]
 *   y5 [      走廊 9×1      ]
 *   y6 [ 卧室A 4×4 ][ 卧室B 5×4 ]
 *   y10   院子
 */
export function buildStarterHouse(world: World) {
  room(world, "客厅", 0, 0, 6, 5, "wood", "cream", [
    { def: "bookshelf", x: 0, y: 0 }, { def: "tv", x: 2, y: 0 }, { def: "plant_big", x: 5, y: 0 },
    { def: "rug", x: 2, y: 1 }, { def: "coffee_table", x: 2, y: 2 }, { def: "sofa", x: 2, y: 3, back: true },
    { def: "armchair", x: 4, y: 2 }, { def: "lamp", x: 5, y: 4 }, { def: "low_cabinet", x: 0, y: 4 },
    { def: "wall_painting", x: 1, y: 0 }, { def: "wall_clock", x: 4, y: 0 },
  ]);
  room(world, "厨房", 6, 0, 4, 3, "tile", "kitchen", [
    { def: "fridge", x: 0, y: 0 }, { def: "stove", x: 1, y: 0 }, { def: "sink", x: 2, y: 0 }, { def: "kitchen_counter", x: 3, y: 0 },
    { def: "table", x: 1, y: 2 }, { def: "chair", x: 3, y: 2 },
  ]);
  room(world, "浴室", 6, 3, 3, 2, "tile", "sky", [{ def: "bathtub", x: 0, y: 0 }, { def: "medicine", x: 2, y: 0 }, { def: "toilet", x: 0, y: 1 }]);
  room(world, "书房", 9, 3, 3, 4, "mint", "sky", [{ def: "bookshelf", x: 0, y: 0 }, { def: "desk", x: 1, y: 0 }, { def: "chair", x: 1, y: 1 }, { def: "plant", x: 2, y: 3 }]);
  room(world, "走廊", 0, 5, 9, 1, "wood", "cream");
  room(world, "卧室A", 0, 6, 4, 4, "carpet", "peach", [{ def: "bed", x: 2, y: 1, rot: 1 }, { def: "nightstand", x: 1, y: 1 }, { def: "wardrobe", x: 3, y: 0 }, { def: "dresser", x: 0, y: 3 }, { def: "plant_small", x: 3, y: 3 }]);
  room(world, "卧室B", 4, 6, 5, 4, "carpet_lilac", "lilac", [{ def: "wardrobe", x: 0, y: 0 }, { def: "lamp_desk", x: 1, y: 0 }, { def: "bed_double", x: 3, y: 0 }, { def: "floor_cushion", x: 1, y: 2 }, { def: "beanbag", x: 0, y: 3 }, { def: "mirror_stand", x: 2, y: 3 }, { def: "plant_big", x: 4, y: 3 }]);
  for (let x = 0; x < 12; x++) for (let y = 10; y < 12; y++) world.setFloor(x, y, "grass", "院子");
  for (let x = 9; x < 12; x++) for (let y = 7; y < 10; y++) world.setFloor(x, y, "grass", "院子");
  autoWalls(world, 0, 0, 12, 12, "cream", true); // 只补缺的墙，不改各房间已有的墙纸
  // 门
  const door = (x: number, y: number, d: "N" | "W", style: string) => world.setWall(x, y, d, { kind: "door", style });
  door(6, 1, "W", "cream");  // 客厅 ↔ 厨房
  door(2, 5, "N", "cream");  // 客厅 ↔ 走廊
  door(7, 5, "N", "sky");    // 走廊 ↔ 浴室
  door(9, 5, "W", "sky");    // 走廊 ↔ 书房
  door(1, 6, "N", "peach");  // 走廊 ↔ 卧室A
  door(6, 6, "N", "lilac");  // 走廊 ↔ 卧室B
  door(10, 7, "N", "sky");   // 书房 ↔ 院子
  door(2, 10, "N", "peach"); // 卧室A ↔ 院子（后门）
  // 窗
  const win = (x: number, y: number, d: "N" | "W", style: string) => world.setWall(x, y, d, { kind: "window", style });
  win(3, 0, "N", "cream"); win(0, 2, "W", "cream"); win(8, 0, "N", "kitchen"); win(10, 3, "N", "sky");
  win(0, 8, "W", "peach");
  // 院子
  world.addFurniture("small_tree", 0, 11);
  world.addFurniture("flower_bed", 3, 10);
  world.addFurniture("mailbox", 5, 11);
  world.addFurniture("bicycle", 7, 11);
  world.addFurniture("bench", 10, 9);
  world.addFurniture("patio_table", 11, 11);
  world.rebuildIndex();
}

/**
 * 放了楼梯以后：楼上同一个位置没有地板的话，铺一块「楼梯口」并围上墙，在楼梯口放一个下楼的标记。
 * 返回是否新铺了楼上的地板。
 */
export function ensureLanding(world: World, f: { def: string; x: number; y: number; rot: 0 | 1 }) {
  if (!FURNITURE_BY_ID[f.def]?.stairs) return false;
  const { w, h } = footprint(f);
  const up = levelOf(f.y) + 1;
  const room = `${levelName(up)}楼梯口`;
  let made = false;
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) {
    const x = f.x + dx, y = f.y + dy + LEVEL_SPAN;
    if (!world.tile(x, y)) { world.setFloor(x, y, "wood", room); made = true; }
    const there = world.furnitureAt(x, y);
    if (there && !FURNITURE_BY_ID[there.def]?.walkable) world.removeFurniture(there.uid);
  }
  if (made) {
    autoWalls(world, f.x, f.y + LEVEL_SPAN, w, h, "cream", true);
    // 楼梯口朝南开个门，方便以后接着往外盖房间
    world.setWall(f.x, f.y + LEVEL_SPAN + h, "N", { kind: "door", style: "cream" });
  }
  if (!world.data.furniture.some((o) => o.def === "stairs_down" && o.x === f.x && o.y === f.y + LEVEL_SPAN)) world.addFurniture("stairs_down", f.x, f.y + LEVEL_SPAN, f.rot);
  return made;
}
