// 娃娃屋式的房子：房间模块左右并排、往上叠楼层。负责房间/家具的增删、角色站位和寻路。
import type { FoodItem, FurnitureInst, RoomInst, Vec3, WorldData } from "../core/types";
import { FURNITURE_BY_ID, ROOM_TYPE_BY_ID, type FurnitureDef, type InteractionDef } from "./catalog";

/** 角色在房间之间走动时走的那条「过道」的纵深 */
export const WALKWAY_Z = 0.9;

let uidCounter = 0;
export function uid(prefix: string) {
  uidCounter++;
  return `${prefix}_${Date.now().toString(36)}${uidCounter.toString(36)}`;
}

/** 立牌在世界里的位置：横向范围、底边纵深、高度 */
export interface Standee {
  x0: number; x1: number; // 世界横坐标
  z: number;
  h: number;
  room: RoomInst;
}

export class World {
  data: WorldData;
  version = 0; // 结构变化时递增，渲染层据此重建

  constructor(data: WorldData) {
    this.data = data;
  }

  // ———————————————————— 房间 ————————————————————

  getRoom(id: string) {
    return this.data.rooms.find((r) => r.uid === id);
  }

  roomByName(name: string) {
    return this.data.rooms.find((r) => r.name === name);
  }

  roomAt(x: number, y: number): RoomInst | undefined {
    const fy = Math.round(y);
    return this.data.rooms.find((r) => r.gy === fy && x >= r.gx && x < r.gx + r.w);
  }

  roomOfPos(p: Vec3) {
    return this.roomAt(Math.min(p.x, Math.floor(p.x) + 0.999), p.y);
  }

  roomName(p: Vec3) {
    return this.roomOfPos(p)?.name ?? "外面";
  }

  rooms(): string[] {
    return this.data.rooms.map((r) => r.name);
  }

  cellFree(gx: number, gy: number, ignore?: string) {
    return !this.data.rooms.some((r) => r.uid !== ignore && r.gy === gy && gx >= r.gx && gx < r.gx + r.w);
  }

  /** 能不能在这里盖房间：格子要空着，二楼以上下面要有房间撑着 */
  canPlaceRoom(gx: number, gy: number, w: number) {
    if (gy < 0) return false;
    for (let i = 0; i < w; i++) {
      if (!this.cellFree(gx + i, gy)) return false;
      if (gy > 0 && this.cellFree(gx + i, gy - 1)) return false;
    }
    return true;
  }

  addRoom(typeId: string, gx: number, gy: number, name?: string, w?: number): RoomInst | null {
    const t = ROOM_TYPE_BY_ID[typeId];
    if (!t) return null;
    const width = w ?? t.w;
    if (!this.canPlaceRoom(gx, gy, width)) return null;
    let nm = name ?? t.name;
    if (!name && this.rooms().includes(nm)) {
      let i = 2;
      while (this.rooms().includes(`${t.name}${i}`)) i++;
      nm = `${t.name}${i}`;
    }
    const room: RoomInst = { uid: uid("r"), type: typeId, name: nm, gx, gy, w: width, wall: t.wall, floor: t.floor };
    this.data.rooms.push(room);
    for (const f of t.furniture) this.addFurniture(f.def, room.uid, f.x * width, f.z);
    this.version++;
    return room;
  }

  /** 拆房间：上面还有房间时不能拆 */
  canRemoveRoom(r: RoomInst) {
    for (let i = 0; i < r.w; i++) if (!this.cellFree(r.gx + i, r.gy + 1)) return false;
    return true;
  }

  removeRoom(id: string) {
    const r = this.getRoom(id);
    if (!r || !this.canRemoveRoom(r)) return false;
    for (const f of this.data.furniture.filter((f) => f.room === id)) this.removeFurniture(f.uid);
    this.data.rooms = this.data.rooms.filter((x) => x.uid !== id);
    this.version++;
    return true;
  }

  // ———————————————————— 家具 ————————————————————

  getFurniture(id: string) {
    return this.data.furniture.find((f) => f.uid === id);
  }

  standeeOf(f: FurnitureInst): Standee | null {
    const def = FURNITURE_BY_ID[f.def];
    const room = this.getRoom(f.room);
    if (!def || !room) return null;
    const cx = room.gx + f.x;
    return { x0: cx - def.w / 2, x1: cx + def.w / 2, z: f.z, h: def.h, room };
  }

  /** 立牌可以自由摆放，只要在房间范围内 */
  canPlaceFurniture(defId: string, roomId: string, x: number, z: number) {
    const def = FURNITURE_BY_ID[defId];
    const room = this.getRoom(roomId);
    if (!def || !room) return false;
    return x - def.w / 2 >= 0.02 && x + def.w / 2 <= room.w - 0.02 && z >= 0.02 && z <= 0.95;
  }

  addFurniture(defId: string, roomId: string, x: number, z: number): FurnitureInst | null {
    if (!this.canPlaceFurniture(defId, roomId, x, z)) return null;
    const f: FurnitureInst = { uid: uid("f"), def: defId, room: roomId, x, z };
    this.data.furniture.push(f);
    this.version++;
    return f;
  }

  removeFurniture(id: string) {
    this.data.furniture = this.data.furniture.filter((f) => f.uid !== id);
    this.data.foods = this.data.foods.filter((fd) => fd.furniture !== id);
    this.version++;
  }

  foodsOn(furnitureUid: string): FoodItem[] {
    return this.data.foods.filter((f) => f.furniture === furnitureUid);
  }

  /** 家具在世界里的大致位置（用来比远近） */
  posOf(f: FurnitureInst): Vec3 {
    const room = this.getRoom(f.room);
    return room ? { x: room.gx + f.x, y: room.gy, z: f.z } : { x: 0, y: 0, z: 0.5 };
  }

  /** 使用家具时角色站的位置 */
  spotFor(f: FurnitureInst, it?: InteractionDef): Vec3 | null {
    const room = this.getRoom(f.room);
    if (!room) return null;
    const x = room.gx + f.x;
    const def = FURNITURE_BY_ID[f.def];
    if (it?.onTop) {
      // 坐上去：站在立牌稍后一点，下半身被立牌挡住，看起来就是坐着；躺下时角色隐藏
      return { x, y: room.gy, z: Math.max(0.01, f.z - (it.pose === "lie" ? def.d / 2 : 0.025)) };
    }
    // 摆在房间中间的家具（餐桌、电脑桌）：站到后面，面朝镜头；靠墙的家具：站到前面
    if (f.z > 0.3) return { x, y: room.gy, z: Math.max(0.03, f.z - def.d - 0.03) };
    return { x, y: room.gy, z: Math.min(0.95, f.z + 0.12) };
  }

  randomSpotIn(roomName?: string): Vec3 | null {
    const list = roomName ? this.data.rooms.filter((r) => r.name === roomName) : this.data.rooms.filter((r) => !ROOM_TYPE_BY_ID[r.type]?.stairs);
    if (!list.length) return null;
    const r = list[Math.floor(Math.random() * list.length)];
    return { x: r.gx + 0.15 + Math.random() * (r.w - 0.3), y: r.gy, z: 0.55 + Math.random() * 0.35 };
  }

  // ———————————————————— 寻路 ————————————————————

  private neighbors(r: RoomInst): RoomInst[] {
    const out: RoomInst[] = [];
    const t = ROOM_TYPE_BY_ID[r.type];
    for (const o of this.data.rooms) {
      if (o === r) continue;
      if (o.gy === r.gy && (o.gx === r.gx + r.w || o.gx + o.w === r.gx)) out.push(o);
      if (t?.stairs && ROOM_TYPE_BY_ID[o.type]?.stairs && o.gx === r.gx && Math.abs(o.gy - r.gy) === 1) out.push(o);
    }
    return out;
  }

  /** 从 from 走到 to 的路点（不含起点）。房间之间不连通时返回 null。 */
  findPath(from: Vec3, to: Vec3): Vec3[] | null {
    const a = this.roomOfPos(from), b = this.roomOfPos(to);
    if (!a || !b) return null;
    if (a === b) return [to];
    const prev = new Map<RoomInst, RoomInst>();
    const queue = [a];
    const seen = new Set([a]);
    while (queue.length) {
      const r = queue.shift()!;
      if (r === b) break;
      for (const n of this.neighbors(r)) {
        if (seen.has(n)) continue;
        seen.add(n);
        prev.set(n, r);
        queue.push(n);
      }
    }
    if (!seen.has(b)) return null;
    const chain: RoomInst[] = [b];
    while (chain[0] !== a) chain.unshift(prev.get(chain[0])!);
    const pts: Vec3[] = [{ x: from.x, y: a.gy, z: WALKWAY_Z }];
    for (let i = 0; i < chain.length - 1; i++) {
      const r = chain[i], n = chain[i + 1];
      if (n.gy === r.gy) {
        const edge = n.gx > r.gx ? n.gx : r.gx;
        pts.push({ x: edge, y: r.gy, z: WALKWAY_Z });
      } else {
        const sx = r.gx + r.w / 2;
        pts.push({ x: sx, y: r.gy, z: 0.4 }, { x: sx, y: n.gy, z: 0.4 });
      }
    }
    pts.push({ x: to.x, y: b.gy, z: WALKWAY_Z }, to);
    return pts;
  }

  /** 给 AI 看的家具清单 */
  describeFurniture(): { uid: string; name: string; room: string; interactions: InteractionDef[]; def: FurnitureDef; inst: FurnitureInst }[] {
    return this.data.furniture
      .map((inst) => {
        const def = FURNITURE_BY_ID[inst.def];
        return { uid: inst.uid, name: def.name, room: this.getRoom(inst.room)?.name ?? "?", interactions: def.interactions, def, inst };
      })
      .filter((x) => x.interactions.length > 0);
  }
}
