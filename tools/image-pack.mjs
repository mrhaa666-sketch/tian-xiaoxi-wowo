// 用一张角色图做立绘文件夹（和游戏里「上传图片」的处理一样）：裁掉透明边、缩到 400 高、找出头的位置、裁出头像。
// 只有一张图的角色，心情由游戏里的情绪标记表示（爱心气泡、生气青筋、Zzz……）。
//
// 用法：node tools/image-pack.mjs --image <图片> --id <立绘名> --out public/packs/chars [--nobg]
//   --nobg  从四条边往里去掉纯色背景（图片本身不透明时用）
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]?.startsWith("--") ? "1" : arr[i + 1] ?? "1"]] : a), []));
if (!args.image || !/^[a-z0-9_-]{1,40}$/.test(args.id ?? "")) throw new Error("需要 --image <图片> 和 --id <小写字母、数字、下划线>");
const OUT_H = 400, AVATAR = 160;

let { data, info } = await sharp(args.image).ensureAlpha().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).raw().toBuffer({ resolveWithObject: true });
const W = info.width, H = info.height;
if (args.nobg) {
  // 从边缘往里漫水，和最近一条边的颜色接近就变透明
  const seen = new Uint8Array(W * H), stack = [];
  const seed = (x, y) => { const p = y * W + x; if (!seen[p]) { seen[p] = 1; stack.push(p); } };
  for (let x = 0; x < W; x++) { seed(x, 0); seed(x, H - 1); }
  for (let y = 0; y < H; y++) { seed(0, y); seed(W - 1, y); }
  while (stack.length) {
    const p = stack.pop(), i = p * 4, x = p % W, y = (p / W) | 0;
    if (data[i + 3] >= 10) {
      const ex = x < W / 2 ? 0 : W - 1, ey = y < H / 2 ? 0 : H - 1;
      const r = Math.abs(x - ex) < Math.abs(y - ey) ? (y * W + ex) * 4 : (ey * W + x) * 4;
      if (Math.abs(data[i] - data[r]) + Math.abs(data[i + 1] - data[r + 1]) + Math.abs(data[i + 2] - data[r + 2]) >= 48) continue;
      data[i + 3] = 0;
    }
    if (x > 0) seed(x - 1, y); if (x < W - 1) seed(x + 1, y); if (y > 0) seed(x, y - 1); if (y < H - 1) seed(x, y + 1);
  }
}
const base = sharp(data, { raw: { width: W, height: H, channels: 4 } }).png();
const trimmed = await sharp(await base.toBuffer()).trim().toBuffer({ resolveWithObject: true });
const k = OUT_H / trimmed.info.height, ow = Math.max(1, Math.round(trimmed.info.width * k));
const img = await sharp(trimmed.data).resize(ow, OUT_H).png().toBuffer();

// 头的位置：上面一段（全身图 32%，半身图 60%）不透明部分的左右边界
const raw = await sharp(img).raw().toBuffer();
const tall = OUT_H / ow > 1.3;
const rows = Math.round(OUT_H * (tall ? 0.32 : 0.6));
let hx0 = ow, hx1 = 0;
for (let y = 0; y < rows; y++) for (let x = 0; x < ow; x++) if (raw[(y * ow + x) * 4 + 3] > 60) { hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x); }
if (hx1 <= hx0) { hx0 = 0; hx1 = ow; }
const headW = hx1 - hx0;
const side = Math.round(Math.min(ow, OUT_H, Math.max(headW * 1.15, tall ? ow * 0.6 : Math.min(ow, OUT_H))));
const ax = Math.max(0, Math.min(ow - side, Math.round((hx0 + hx1) / 2 - side / 2)));
const ay = tall ? 0 : Math.max(0, Math.round((OUT_H - side) / 3));

const dir = path.join(args.out ?? "public/packs/chars", args.id);
fs.rmSync(dir, { recursive: true, force: true });
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, "img.png"), img);
await sharp(img).extract({ left: ax, top: ay, width: side, height: side }).resize(AVATAR, AVATAR).png().toFile(path.join(dir, "avatar_normal.png"));
const manifest = {
  id: args.id, width: ow, height: OUT_H, footX: Math.round(ow / 2), footY: OUT_H,
  frames: { normal: "img" }, poses: [], avatar: { normal: "avatar_normal.png" }, single: true,
  head: { x: Math.round(hx1 - headW * 0.12), y: Math.round(OUT_H * (tall ? 0.04 : 0.08)), size: headW },
};
fs.writeFileSync(path.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2));
console.log(`→ ${dir}（${ow}×${OUT_H}，${tall ? "全身图" : "半身图"}）`);
