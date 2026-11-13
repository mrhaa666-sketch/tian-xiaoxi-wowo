// 网格世界：地板、墙、家具、食物，以及寻路。世界没有边界，格子按需存在。
import type { FoodItem, FurnitureInst, Tile, Wall, WorldData } from "../core/types";
import { FURNITURE_BY_ID, type FurnitureDef, type InteractionDef } from "./catalog";

export const key = (x: number, y: number) => `${x},${y}`;
export const wkey = (x: number, y: number, d: "N" | "W") => `${x},${y},${d}`;

/**
 * 楼层：楼上的格子放在同一张网格里，往下错开 LEVEL_SPAN 格（离得很远，画面上看不到彼此）。
 * 楼梯连着楼上同一个位置。第 0 层是一楼。
 */
export const LEVEL_SPAN = 1000;
export const levelOf = (y: number) => Math.floor((y + LEVEL_SPAN / 2) / LEVEL_SPAN);
export const levelName = (l: number) => (l >= 0 ? `${l + 1}楼` : `地下${-l}层`);

let uidCounter = 0;
export function uid(prefix: string) {
  uidCounter++;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

export function footprint(f: { def: string; rot: 0 | 1 }) {
  const d = FURNITURE_BY_ID[f.def];
  return f.rot === 0 ? { w: d.w, h: d.h } : { w: d.h, h: d.w };
}

export class World {
  data: WorldData;
  /** 被家具挡住的格子 → 家具 uid */
  private blocked = new Map<string, string>();
  /** 楼梯占的格子 */
  private stairs = new Set<string>();
  version = 0; // 结构变化时递增，渲染层据此重建

  constructor(data: WorldData) {
    this.data = data;
    this.rebuildIndex();
  }

  rebuildIndex() {
    this.blocked.clear();
    this.stairs.clear();
    for (const f of this.data.furniture) {
      if (!FURNITURE_BY_ID[f.def]?.stairs) continue;
      const { w, h } = footprint(f);
      for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) this.stairs.add(key(f.x + dx, f.y + dy));
    }
    for (const f of this.data.furniture) {
      const def = FURNITURE_BY_ID[f.def];
      if (!def || def.walkable || def.wallMounted) continue;
      const { w, h } = footprint(f);
      for (let dx = 0; dx < w; dx++) for (let dy = 0; dy < h; dy++) this.blocked.set(key(f.x + dx, f.y + dy), f.uid);
    }
    this.version++;
  }

  tile(x: number, y: number): Tile | undefined {
    return this.data.tiles[key(x, y)];
  }

  wall(x: number, y: number, d: "N" | "W"): Wall | undefined {
    return this.data.walls[wkey(x, y, d)];
  }

  furnitureAt(x: number, y: number): FurnitureInst | undefined {
    const id = this.blocked.get(key(x, y));
    if (id) return this.getFurniture(id);
    // 可行走家具（地毯）和墙饰
    return this.data.furniture.find((f) => {
      const { w, h } = footprint(f);
      return x >= f.x && x < f.x + w && y >= f.y && y < f.y + h;
    });
  }

  getFurniture(uid: string) {
    return this.data.furniture.find((f) => f.uid === uid);
  }

  walkable(x: number, y: number) {
    return !!this.tile(x, y) && !this.blocked.has(key(x, y));
  }

  /** 两个相邻格子之间能否通过（检查墙和门） */
  passable(ax: number, ay: number, bx: number, by: number) {
    let w: Wall | undefined;
    if (bx === ax + 1 && by === ay) w = this.wall(bx, by, "W");
    else if (bx === ax - 1 && by === ay) w = this.wall(ax, ay, "W");
    else if (by === ay + 1 && bx === ax) w = this.wall(bx, by, "N");
    else if (by === ay - 1 && bx === ax) w = this.wall(ax, ay, "N");
    return !w || w.kind === "door";
  }

  /** A* 寻路，4 方向。返回包含终点、不含起点的格子列表；找不到返回 null。 */
  findPath(sx: number, sy: number, tx: number, ty: number, allowEndBlocked = false, limit = 4000): { x: number; y: number }[] | null {
    if (sx === tx && sy === ty) return [];
    if (!allowEndBlocked && !this.walkable(tx, ty)) return null;
    const open: { x: number; y: number; g: number; f: number }[] = [{ x: sx, y: sy, g: 0, f: 0 }];
    const came = new Map<string, string>();
    const gScore = new Map<string, number>([[key(sx, sy), 0]]);
    let steps = 0;
    while (open.length && steps++ < limit) {
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur.x === tx && cur.y === ty) {
        const path: { x: number; y: number }[] = [];
        let k = key(tx, ty);
        while (k !== key(sx, sy)) {
          const [x, y] = k.split(",").map(Number);
          path.unshift({ x, y });
          k = came.get(k)!;
        }
        return path;
      }
      const ck = key(cur.x, cur.y);
      // 楼梯：踩在楼梯上可以到楼上同一个位置；楼上的楼梯口可以下来
      const portals: [number, number][] = [];
      if (this.stairs.has(ck)) portals.push([0, LEVEL_SPAN]);
      if (this.stairs.has(key(cur.x, cur.y - LEVEL_SPAN))) portals.push([0, -LEVEL_SPAN]);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], ...portals]) {
        const nx = cur.x + dx, ny = cur.y + dy;
        const isEnd = nx === tx && ny === ty;
        const portal = Math.abs(dy) === LEVEL_SPAN;
        if (!(this.walkable(nx, ny) || (isEnd && allowEndBlocked && this.tile(nx, ny)))) continue;
        if (!portal && !this.passable(cur.x, cur.y, nx, ny)) continue;
        const g = cur.g + (portal ? 4 : 1);
        const nk = key(nx, ny);
        if (g >= (gScore.get(nk) ?? Infinity)) continue;
        gScore.set(nk, g);
        came.set(nk, key(cur.x, cur.y));
        // 估算距离时把楼层分开算：同一层按格子数，差几层每层算 4 步
        const dl = Math.abs(levelOf(ty) - levelOf(ny));
        const ly = (ty - levelOf(ty) * LEVEL_SPAN) - (ny - levelOf(ny) * LEVEL_SPAN);
        open.push({ x: nx, y: ny, g, f: g + Math.abs(tx - nx) + Math.abs(ly) + dl * 4 });
      }
    }
    return null;
  }

  /** 家具周围可以站人的格子（不隔墙） */
  accessSpots(f: FurnitureInst) {
    const { w, h } = footprint(f);
    const spots: { x: number; y: number }[] = [];
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        const cx = f.x + dx, cy = f.y + dy;
        for (const [ox, oy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = cx + ox, ny = cy + oy;
          if (nx >= f.x && nx < f.x + w && ny >= f.y && ny < f.y + h) continue;
          if (!this.walkable(nx, ny) || !this.passable(cx, cy, nx, ny)) continue;
          if (!spots.some((s) => s.x === nx && s.y === ny)) spots.push({ x: nx, y: ny });
        }
      }
    }
    return spots;
  }

  /** 家具的中心点（格子坐标，可为小数），角色躺/坐上去时用 */
  centerOf(f: FurnitureInst) {
    const { w, h } = footprint(f);
    return { x: f.x + w / 2, y: f.y + h / 2 };
  }

  canPlace(defId: string, x: number, y: number, rot: 0 | 1, ignoreUid?: string) {
    const def = FURNITURE_BY_ID[defId];
    const { w, h } = rot === 0 ? { w: def.w, h: def.h } : { w: def.h, h: def.w };
    for (let dx = 0; dx < w; dx++) {
      for (let dy = 0; dy < h; dy++) {
        const tx = x + dx, ty = y + dy;
        if (!this.tile(tx, ty)) return false;
        for (const other of this.data.furniture) {
          if (other.uid === ignoreUid) continue;
          const fp = footprint(other);
          if (tx < other.x || tx >= other.x + fp.w || ty < other.y || ty >= other.y + fp.h) continue;
          const od = FURNITURE_BY_ID[other.def];
          // 挂在墙上的装饰和地上的家具互不影响，但两件墙饰不能挂在同一格
          if (!!od.wallMounted !== !!def.wallMounted) continue;
          if (od.wallMounted && def.wallMounted) return false;
          // 地毯上可以放家具，家具上不能放地毯以外的东西；楼梯上不能放东西
          if (!(od.walkable && !def.walkable) || od.stairs || def.stairs) return false;
        }
        // 多格家具内部不能被墙隔开
        if (dx > 0 && this.wall(tx, ty, "W")) return false;
        if (dy > 0 && this.wall(tx, ty, "N")) return false;
      }
    }
    return true;
  }

  addFurniture(defId: string, x: number, y: number, rot: 0 | 1 = 0): FurnitureInst | null {
    if (!this.canPlace(defId, x, y, rot)) return null;
    const f: FurnitureInst = { uid: uid("f"), def: defId, x, y, rot };
    this.data.furniture.push(f);
    this.rebuildIndex();
    return f;
  }

  removeFurniture(uidStr: string) {
    this.data.furniture = this.data.furniture.filter((f) => f.uid !== uidStr);
    this.data.foods = this.data.foods.filter((fd) => fd.furniture !== uidStr);
    this.rebuildIndex();
  }

  setFloor(x: number, y: number, floor: string | null, room?: string) {
    const k = key(x, y);
    if (floor === null) {
      delete this.data.tiles[k];
      // 删除地板时，连同上面的家具一起删
      const f = this.furnitureAt(x, y);
      if (f) this.removeFurniture(f.uid);
    } else {
      this.data.tiles[k] = { floor, room: room ?? this.data.tiles[k]?.room };
    }
    this.version++;
  }

  setWall(x: number, y: number, d: "N" | "W", wall: Wall | null) {
    const k = wkey(x, y, d);
    if (wall) this.data.walls[k] = wall;
    else delete this.data.walls[k];
    this.version++;
  }

  roomOf(x: number, y: number) {
    return this.tile(Math.floor(x), Math.floor(y))?.room ?? "空地";
  }

  rooms(level?: number): string[] {
    const s = new Set<string>();
    for (const [k, t] of Object.entries(this.data.tiles)) {
      if (!t.room) continue;
      if (level !== undefined && levelOf(Number(k.slice(k.indexOf(",") + 1))) !== level) continue;
      s.add(t.room);
    }
    return [...s];
  }

  /** 有哪些楼层（从低到高） */
  levels(): number[] {
    const s = new Set<number>();
    for (const k of Object.keys(this.data.tiles)) s.add(levelOf(Number(k.slice(k.indexOf(",") + 1))));
    if (!s.size) s.add(0);
    return [...s].sort((a, b) => a - b);
  }

  /** 某个房间在几楼 */
  levelOfRoom(room: string) {
    for (const [k, t] of Object.entries(this.data.tiles)) if (t.room === room) return levelOf(Number(k.slice(k.indexOf(",") + 1)));
    return 0;
  }

  /** 房间里一个随机的可行走格子 */
  randomTileIn(room?: string) {
    const all = Object.entries(this.data.tiles)
      .filter(([, t]) => !room || t.room === room)
      .map(([k]) => k.split(",").map(Number) as [number, number])
      .filter(([x, y]) => this.walkable(x, y));
    if (!all.length) return null;
    const [x, y] = all[Math.floor(Math.random() * all.length)];
    return { x, y };
  }

  foodsOn(furnitureUid: string): FoodItem[] {
    return this.data.foods.filter((f) => f.furniture === furnitureUid);
  }

  /** 生成给 AI 看的家具清单 */
  describeFurniture(): { uid: string; name: string; room: string; interactions: InteractionDef[]; def: FurnitureDef; inst: FurnitureInst }[] {
    return this.data.furniture
      .map((inst) => {
        const def = FURNITURE_BY_ID[inst.def];
        return { uid: inst.uid, name: def.name, room: this.roomOf(inst.x, inst.y), interactions: def.interactions, def, inst };
      })
      .filter((x) => x.interactions.length > 0);
  }
}
