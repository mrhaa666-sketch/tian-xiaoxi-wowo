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
      { def: "bed", x: 0, y: 0 }, { def: "wardrobe", x: 3, y: 0 }, { def: "lamp", x: 1, y: 0 }, { def: "plant", x: 3, y: 3 },
    ],
  },
  {
    id: "living", name: "客厅", w: 5, h: 4, floor: "wood", wallStyle: "cream",
    furniture: [
      { def: "rug", x: 1, y: 1 }, { def: "sofa", x: 1, y: 3 }, { def: "tv", x: 1, y: 0 }, { def: "plant", x: 4, y: 0 }, { def: "bookshelf", x: 0, y: 0 },
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

/** 新存档的初始小屋：客厅、厨房、两间卧室、浴室、书房，外加一小片院子。 */
export function buildStarterHouse(world: World) {
  const get = (id: string) => ROOM_PRESETS.find((p) => p.id === id)!;
  stampPreset(world, get("living"), 0, 0);
  stampPreset(world, get("kitchen"), 5, 0);
  stampPreset(world, get("bedroom"), 0, 4, "卧室A");
  stampPreset(world, get("bedroom"), 4, 4, "卧室B");
  stampPreset(world, get("bathroom"), 8, 4);
  stampPreset(world, get("study"), 9, 0);
  // 房间之间的门
  const door = (x: number, y: number, d: "N" | "W", style: string) => world.setWall(x, y, d, { kind: "door", style });
  door(5, 1, "W", "cream");  // 客厅 ↔ 厨房
  door(9, 2, "W", "sage");   // 厨房 ↔ 书房
  door(1, 4, "N", "cream");  // 客厅 ↔ 卧室A
  door(4, 4, "N", "cream");  // 客厅 ↔ 卧室B
  door(8, 5, "W", "peach");  // 卧室B ↔ 浴室
  door(0, 1, "W", "cream");  // 客厅 ↔ 院子
  // 原本朝外的门改成普通墙，只保留客厅前门
  for (const k of ["2,4,N", "7,4,N", "10,3,N", "9,7,N"]) if (world.data.walls[k]?.kind === "door") world.data.walls[k] = { kind: "wall", style: "cream" };
  // 院子
  for (let x = 0; x < 12; x++) for (let y = 8; y < 10; y++) if (!world.tile(x, y)) world.setFloor(x, y, "grass", "院子");
  for (let x = -2; x < 0; x++) for (let y = 0; y < 10; y++) world.setFloor(x, y, "grass", "院子");
  world.addFurniture("plant", -2, 2);
  world.addFurniture("plant", 11, 9);
  world.rebuildIndex();
}
