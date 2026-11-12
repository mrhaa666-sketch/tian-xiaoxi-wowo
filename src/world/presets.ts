// 内置房间：可以单独盖在任意位置，也有一整套初始小屋。
import type { Wall } from "../core/types";
import { World, key, wkey } from "./world";

export interface RoomPreset {
  id: string;
  name: string;
  w: number;
  h: number;
  floor: string;
  wallStyle: string;
  furniture: { def: string; x: number; y: number; rot?: 0 | 1 }[];
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
      { def: "fridge", x: 0, y: 0 }, { def: "stove", x: 1, y: 0 }, { def: "sink", x: 2, y: 0 },
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
  for (let dx = 0; dx < p.w; dx++) {
    for (let dy = 0; dy < p.h; dy++) {
      const f = world.furnitureAt(ox + dx, oy + dy);
      if (f) world.removeFurniture(f.uid);
      world.setFloor(ox + dx, oy + dy, p.floor, name);
    }
  }
  autoWalls(world, ox, oy, p.w, p.h, p.wallStyle);
  // 南边中间开一扇门，北墙放一扇窗
  const mid = ox + Math.floor(p.w / 2);
  world.setWall(mid, oy + p.h, "N", { kind: "door", style: p.wallStyle });
  if (p.w >= 4 && !world.tile(ox + p.w - 2, oy - 1)) world.setWall(ox + p.w - 2, oy, "N", { kind: "window", style: p.wallStyle });
  for (const f of p.furniture) world.addFurniture(f.def, ox + f.x, oy + f.y, f.rot ?? 0);
  return name;
}

/** 给一块区域的边缘补墙：边的另一侧没有地板、或属于别的房间时就砌墙。已有的门窗保留。 */
export function autoWalls(world: World, ox: number, oy: number, w: number, h: number, style: string) {
  const put = (k: string, wall: Wall) => {
    const old = world.data.walls[k];
    if (old && old.kind !== "wall") return;
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
function room(world: World, name: string, x: number, y: number, w: number, h: number, floor: string, style: string, furniture: { def: string; x: number; y: number; rot?: 0 | 1 }[] = []) {
  for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) world.setFloor(x + dx, y + dy, floor, name);
  autoWalls(world, x, y, w, h, style);
  for (const f of furniture) world.addFurniture(f.def, x + f.x, y + f.y, f.rot ?? 0);
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
    { def: "bookshelf", x: 0, y: 0 }, { def: "tv", x: 2, y: 0 }, { def: "plant", x: 5, y: 0 },
    { def: "rug", x: 2, y: 1 }, { def: "sofa", x: 2, y: 3 }, { def: "lamp", x: 5, y: 4 },
  ]);
  room(world, "厨房", 6, 0, 4, 3, "tile", "sage", [
    { def: "fridge", x: 0, y: 0 }, { def: "stove", x: 1, y: 0 }, { def: "sink", x: 2, y: 0 },
    { def: "table", x: 1, y: 2 }, { def: "chair", x: 3, y: 2 },
  ]);
  room(world, "浴室", 6, 3, 3, 2, "tile", "sky", [{ def: "bathtub", x: 0, y: 0 }, { def: "medicine", x: 2, y: 0 }, { def: "toilet", x: 0, y: 1 }]);
  room(world, "书房", 9, 3, 3, 4, "mint", "sky", [{ def: "bookshelf", x: 0, y: 0 }, { def: "desk", x: 1, y: 0 }, { def: "chair", x: 1, y: 1 }, { def: "plant", x: 2, y: 3 }]);
  room(world, "走廊", 0, 5, 9, 1, "wood", "cream");
  room(world, "卧室A", 0, 6, 4, 4, "carpet", "peach", [{ def: "bed", x: 0, y: 0 }, { def: "wardrobe", x: 3, y: 0 }, { def: "lamp", x: 0, y: 2 }, { def: "plant", x: 3, y: 3 }]);
  room(world, "卧室B", 4, 6, 5, 4, "carpet", "lilac", [{ def: "wardrobe", x: 0, y: 0 }, { def: "bed", x: 4, y: 0 }, { def: "lamp", x: 3, y: 0 }, { def: "rug", x: 1, y: 2 }, { def: "plant", x: 4, y: 3 }]);
  for (let x = 0; x < 12; x++) for (let y = 10; y < 12; y++) world.setFloor(x, y, "grass", "院子");
  for (let x = 9; x < 12; x++) for (let y = 7; y < 10; y++) world.setFloor(x, y, "grass", "院子");
  autoWalls(world, 0, 0, 12, 12, "cream");
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
  win(3, 0, "N", "cream"); win(0, 2, "W", "cream"); win(8, 0, "N", "sage"); win(10, 3, "N", "sky");
  win(0, 8, "W", "peach");
  world.addFurniture("plant", 0, 11);
  world.addFurniture("chair", 10, 9);
  world.rebuildIndex();
}
