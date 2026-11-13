// 把已经渲染好的整张角色图（每张都是带表情的全身图）整理成游戏用的立绘文件夹。
//
// 用法：
//   node tools/sd-finished.mjs --in <文件夹> --out public/packs/chars --map 朝比奈真冬=mafuyu,宵崎奏=kanade [--only 朝比奈真冬,宵崎奏]
//
// 输入：<文件夹>/<角色>/face_<表情>.png、pose_<姿势>.png，以及 <文件夹>/info.txt（写着共用画布上的裁框）。
// 所有图都来自同一个渲染画布、同一个裁框，所以脚的位置天然对齐；这里只统一裁掉多余的透明边、缩小，并做头像。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const OX = Number(args.ox ?? 736.3), OY = Number(args.oy ?? 1172.3); // 骨骼原点（脚底）在渲染画布上的位置
const OUT_H = Number(args.height ?? 320);
const AVATAR = 160;
const nameMap = Object.fromEntries((args.map ?? "").split(",").filter(Boolean).map((s) => s.split("=")));
const only = args.only ? args.only.split(",") : null;

const info = fs.readFileSync(path.join(args.in, "info.txt"), "utf8");
const box = info.match(/裁框\s*\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/).slice(1, 5).map(Number);
const S = (box[2] - box[0]) / 512;

// 游戏里的状态 → 用哪张图（按顺序找第一张有的）
const FRAMES = {
  normal: ["pose_idle", "face_normal"], happy: ["face_happy"], sad: ["face_sad"], angry: ["face_angry"],
  surprised: ["face_surprised"], shy: ["face_shy"], sick: ["face_sick"], sleepy: ["face_sleepy"],
  talk: ["pose_talk"], blink: ["face_sleepy"],
  // 背影：往远处走时两张交替，背对镜头用家具时用第一张
  back: ["back_walk_a"], backStep: ["back_walk_b"],
};

for (const char of fs.readdirSync(args.in).filter((n) => fs.statSync(path.join(args.in, n)).isDirectory())) {
  if (only && !only.includes(char)) continue;
  const id = nameMap[char] ?? char;
  const dir = path.join(args.in, char);
  const names = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).map((f) => f.replace(/\.png$/, ""));
  // 所有图共用一个裁剪范围
  let x0 = 512, y0 = 512, x1 = 0, y1 = 0;
  for (const n of names) {
    const t = await sharp(path.join(dir, n + ".png")).trim().toBuffer({ resolveWithObject: true });
    x0 = Math.min(x0, -t.info.trimOffsetLeft); y0 = Math.min(y0, -t.info.trimOffsetTop);
    x1 = Math.max(x1, -t.info.trimOffsetLeft + t.info.width); y1 = Math.max(y1, -t.info.trimOffsetTop + t.info.height);
  }
  x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4); x1 = Math.min(512, x1 + 4); y1 = Math.min(512, y1 + 4);
  const k = OUT_H / (y1 - y0), outW = Math.round((x1 - x0) * k);
  const outDir = path.join(args.out, id);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const n of names) {
    await sharp(path.join(dir, n + ".png")).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).resize(outW, OUT_H)
      .png({ palette: true, quality: 92, effort: 8 }).toFile(path.join(outDir, n + ".png"));
  }
  // 头像：用平常的那张找出头的范围（上面 42% 里不透明的部分），所有表情用同一个框
  const ref = names.includes("face_normal") ? "face_normal" : names[0];
  const { data, info: im } = await sharp(path.join(dir, ref + ".png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const bt = await sharp(path.join(dir, ref + ".png")).trim().toBuffer({ resolveWithObject: true });
  const top = -bt.info.trimOffsetTop, hh = Math.round(bt.info.height * 0.42);
  let hx0 = 512, hx1 = 0;
  for (let y = top; y < top + hh; y++) for (let x = 0; x < im.width; x++) if (data[(y * im.width + x) * 4 + 3] > 128) { hx0 = Math.min(hx0, x); hx1 = Math.max(hx1, x); }
  const side = Math.min(512, Math.round(Math.max(hx1 - hx0, hh) * 1.05));
  const ax = Math.max(0, Math.min(512 - side, Math.round((hx0 + hx1) / 2 - side / 2))), ay = Math.max(0, top - Math.round(side * 0.04));
  const avatar = {};
  for (const n of names.filter((n) => n.startsWith("face_"))) {
    const emo = n.replace(/^face_/, "");
    await sharp(path.join(dir, n + ".png")).extract({ left: ax, top: ay, width: side, height: Math.min(side, 512 - ay) })
      .resize(AVATAR, AVATAR, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(outDir, `avatar_${emo}.png`));
    avatar[emo] = `avatar_${emo}.png`;
  }
  const frames = {};
  for (const [state, prefs] of Object.entries(FRAMES)) { const hit = prefs.find((p) => names.includes(p)); if (hit) frames[state] = hit; }
  const manifest = {
    id, name: char, width: outW, height: OUT_H,
    footX: Math.round(((OX - box[0]) / S - x0) * k), footY: Math.round(((OY - box[1]) / S - y0) * k),
    frames, poses: names.filter((n) => n.startsWith("pose_")), avatar,
  };
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`${char} → ${outDir}（${names.length} 张图）`);
}
