// 素材处理：把 GPT 生成的原图整理成游戏用的小图。
// 用法：npm run assets -- <解压后的文件夹> <分类>
//   分类：furniture（家具）、floors（地板）、walls（墙纸）、food（食物）
// 处理内容：裁掉透明边（家具和食物）→ 缩小到合适尺寸 → 压缩 PNG，
// 输出到 public/assets/<分类>/，同名文件会被覆盖。
import { readdir, mkdir, stat } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import sharp from "sharp";

const [, , inputDir, kind] = process.argv;
const SIZES = { furniture: 512, food: 256, floors: 512, walls: 512 };
if (!inputDir || !(kind in SIZES)) {
  console.log("用法：npm run assets -- <解压后的文件夹> <furniture|floors|walls|food>");
  process.exit(1);
}
const outDir = join("public", "assets", kind);
await mkdir(outDir, { recursive: true });
const trim = kind === "furniture" || kind === "food";

let before = 0, after = 0, count = 0;
for (const name of (await readdir(inputDir)).sort()) {
  if (extname(name).toLowerCase() !== ".png") continue;
  const src = join(inputDir, name);
  const dst = join(outDir, basename(name).toLowerCase());
  let img = sharp(src).ensureAlpha();
  if (trim) img = img.trim({ threshold: 1 });
  const max = SIZES[kind];
  img = trim
    ? img.resize({ width: max, height: max, fit: "inside", withoutEnlargement: true })
    : img.resize({ width: max, height: max, fit: "fill" });
  await img.png({ compressionLevel: 9, palette: true, quality: 92, effort: 10 }).toFile(dst);
  before += (await stat(src)).size;
  after += (await stat(dst)).size;
  count++;
  console.log(`✓ ${name}`);
}
console.log(`处理了 ${count} 张：${(before / 1048576).toFixed(1)} MB → ${(after / 1048576).toFixed(1)} MB，输出到 ${outDir}`);
