// 把角色设定和立绘文件夹打包成一个可以直接导入的角色包文件。
// 用法：node tools/make-pack.mjs --json <角色包.json> --name <角色名> --sprites <立绘文件夹> --out <输出文件>
import fs from "node:fs";
import path from "node:path";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const src = JSON.parse(fs.readFileSync(args.json, "utf8"));
const list = Array.isArray(src.characters) ? src.characters : [src];
const ch = list.find((c) => c.name === args.name);
if (!ch) throw new Error(`${args.json} 里没有叫「${args.name}」的角色`);
const dir = args.sprites;
const id = path.basename(dir);
const files = {};
for (const f of fs.readdirSync(dir).filter((f) => /^[\w-]+\.(png|json)$/.test(f) && !f.startsWith("_"))) {
  const type = f.endsWith(".json") ? "application/json" : "image/png";
  files[f] = `data:${type};base64,${fs.readFileSync(path.join(dir, f)).toString("base64")}`;
}
if (!files["manifest.json"]) throw new Error(`${dir} 里没有 manifest.json`);
// 打包成单个角色时，和别人的初始关系也保留（导入时家里有这个人才生效）
const out = { format: "wowo-character-pack", version: 1, characters: [{ ...ch, sprites: { id, files } }] };
fs.writeFileSync(args.out, JSON.stringify(out));
console.log(`${args.name}：${Object.keys(files).length} 个立绘文件，${(fs.statSync(args.out).size / 1024 / 1024).toFixed(1)}MB → ${args.out}`);
