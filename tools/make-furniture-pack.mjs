// 把家具设定（JSON）和图片文件夹打包成一个可以直接导入的家具包。
// 用法：node tools/make-furniture-pack.mjs --json 家具设定.json --images 图片文件夹 --out 家具包.json
// 图片按家具 id 命名：<id>.png（正面）、<id>_back.png（背面）、<id>_on.png（开着）、<id>_occupied.png（有人躺着）。
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
if (!args.json || !args.out) {
  console.error("用法：node tools/make-furniture-pack.mjs --json 家具设定.json [--images 图片文件夹] --out 家具包.json");
  process.exit(1);
}
const src = JSON.parse(fs.readFileSync(args.json, "utf8"));
const pack = { format: src.format ?? "wowo-furniture-pack", version: 1, furniture: src.furniture ?? [], rooms: src.rooms ?? [] };
const slots = { base: "", back: "_back", on: "_on", occupied: "_occupied" };
for (const f of pack.furniture) {
  if (!args.images) break;
  f.images = f.images ?? {};
  for (const [slot, suffix] of Object.entries(slots)) {
    const file = path.join(args.images, `${f.id}${suffix}.png`);
    if (fs.existsSync(file)) f.images[slot] = `data:image/png;base64,${fs.readFileSync(file).toString("base64")}`;
  }
  console.log(`${f.name}：${Object.keys(f.images).join("、") || "没有图片（会用代码画的占位图）"}`);
}
fs.writeFileSync(args.out, JSON.stringify(pack, null, 1));
console.log(`→ ${args.out}（${pack.furniture.length} 件家具，${pack.rooms.length} 个房间，${(fs.statSync(args.out).size / 1024).toFixed(0)} KB）`);
