// 房间感知：角色对所在房间的感受（美观、明亮、热闹、凌乱），以及注意到的值得一提的事。
import { FOOD_BY_ID, FURNITURE_BY_ID } from "../world/catalog";
import { footprint, key } from "../world/world";
import type { Character } from "./character";
import type { Game } from "./game";

export interface RoomSense {
  room: string;
  beauty: number;  // 美观 0～100
  light: number;   // 明亮 0～100
  lively: number;  // 热闹 0～100
  clutter: number; // 凌乱 0～100
  score: number;   // 综合舒服程度 0～100
  people: string[];  // 同一个房间里的其他人
  notable: string[]; // 注意到的事
}

// 能让房间变好看的东西
const DECOR = new Set([
  "plant", "plant_big", "plant_small", "rug", "lamp", "lamp_desk", "fish_tank", "cat_tower", "flower_bed", "small_tree",
  "wall_clock", "wall_painting", "wall_poster", "wall_shelf", "curtain", "christmas_tree", "red_lantern", "mirror_stand",
]);
// 开着会让房间热闹的东西
const NOISY = new Set(["tv", "game_tv", "arcade_machine", "speaker", "stove", "washing_machine"]);

export function senseRoom(game: Game, c: Character): RoomSense {
  const w = game.world;
  const room = c.room;
  const tiles = Object.entries(w.data.tiles).filter(([, t]) => t.room === room).map(([k]) => k);
  const tileSet = new Set(tiles);
  const area = Math.max(1, tiles.length);
  const inRoom = w.data.furniture.filter((f) => tileSet.has(key(f.x, f.y)));
  const outdoor = tiles.some((k) => ["grass", "deck", "stone"].includes(w.data.tiles[k].floor));

  // 美观：装饰越多越好看，家具占地太多会显得挤
  const decor = inRoom.filter((f) => DECOR.has(f.def)).length;
  let blocked = 0;
  for (const f of inRoom) { const d = FURNITURE_BY_ID[f.def]; if (!d.walkable && !d.wallMounted) { const fp = footprint(f); blocked += fp.w * fp.h; } }
  const density = blocked / area;
  let beauty = 35 + Math.min(45, decor * 9) + (outdoor ? 15 : 0) - (density > 0.5 ? (density - 0.5) * 80 : 0);

  // 明亮：白天看窗户（室外一直亮），晚上看灯
  const hour = new Date().getHours();
  const day = hour >= 7 && hour < 18;
  const hasWindow = Object.entries(w.data.walls).some(([k, wall]) => {
    if (wall.kind !== "window") return false;
    const [x, y, dir] = k.split(",");
    const a = key(Number(x), Number(y));
    const b = dir === "N" ? key(Number(x), Number(y) - 1) : key(Number(x) - 1, Number(y));
    return tileSet.has(a) || tileSet.has(b);
  });
  const lampOn = inRoom.some((f) => (f.def === "lamp" || f.def === "lamp_desk") && f.state?.on);
  let light = day ? (outdoor ? 95 : hasWindow ? 85 : 55) : outdoor ? 25 : 35;
  if (lampOn) light = Math.max(light, day ? 90 : 75);

  // 热闹：有别人、电视音乐开着
  const others = game.chars.filter((o) => o !== c && o.room === room);
  const noisyOn = inRoom.filter((f) => NOISY.has(f.def) && f.state?.on);
  const lively = Math.min(100, others.length * 30 + noisyOn.length * 25);

  // 凌乱：桌上放着没人吃的饭
  const foods = w.data.foods.filter((fd) => inRoom.some((f) => f.uid === fd.furniture));
  const clutter = Math.min(100, foods.length * 15 + (density > 0.7 ? 20 : 0));

  beauty = Math.max(0, Math.min(100, beauty));
  // 外向的人喜欢热闹，内向的人喜欢安静
  const wantLively = c.d.traits.extraversion / 100;
  const livelyFit = 100 - Math.abs(lively - wantLively * 80);
  const score = Math.round(beauty * 0.35 + light * 0.3 + (100 - clutter) * 0.2 + livelyFit * 0.15);

  // 注意到的事
  const notable: string[] = [];
  for (const f of noisyOn) {
    if (["tv", "game_tv", "arcade_machine", "speaker"].includes(f.def) && !game.occupantOf(f.uid)) notable.push(`${FURNITURE_BY_ID[f.def].name}开着，但没人在用`);
  }
  for (const fd of foods) {
    const name = FOOD_BY_ID[fd.kind]?.name ?? "饭";
    if (fd.forChar === c.id) notable.push(`餐桌上有给你的${name}`);
    else if (!fd.forChar) notable.push(`餐桌上放着${name}`);
  }
  for (const o of others) {
    if (o.hidden && o.run?.interaction?.pose === "lie") notable.push(`${o.name}在睡觉，要小声一点`);
    else if (o.d.illness) notable.push(`${o.name}看起来不太舒服`);
    else if (o.d.needs.mood < 30) notable.push(`${o.name}好像心情不好`);
  }
  if (!day && !lampOn && !outdoor && light < 40) notable.push("房间里有点暗");
  if (inRoom.some((f) => f.state?.festival)) notable.push("房间里摆着节日装饰");

  return {
    room, beauty: Math.round(beauty), light: Math.round(light), lively: Math.round(lively), clutter: Math.round(clutter), score,
    people: others.map((o) => o.name), notable,
  };
}
