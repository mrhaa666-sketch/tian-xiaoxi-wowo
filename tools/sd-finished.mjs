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
  talk: ["pose_talk"], blink: ["blink", "face_sleepy"],
  // 背影：往远处走时两张交替，背对镜头用家具时用第一张
  back: ["back_walk_a"], backStep: ["back_walk_b"],
};

/**
 * 做一张专门眨眼用的图：以平常的那张为底，把「困」那张（闭着眼）对齐后，只把有差别的眼睛一带贴上来。
 * 直接换成「困」那张会抽搐：那是另一帧，身体和头的位置差了好几个像素。
 */
async function makeBlink(dir) {
  const base = path.join(dir, "pose_idle.png"), eyes = path.join(dir, "face_sleepy.png");
  if (!fs.existsSync(base) || !fs.existsSync(eyes)) return false;
  const A = await sharp(base).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const B = (await sharp(eyes).ensureAlpha().raw().toBuffer());
  const W = A.info.width, H = A.info.height, a = A.data;
  // 头的范围：平常那张不透明部分的上面 45%
  let top = H, bottom = 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (a[(y * W + x) * 4 + 3] > 40) { if (y < top) top = y; if (y > bottom) bottom = y; }
  const hy1 = Math.round(top + (bottom - top) * 0.45);
  // 找最对得上的平移：比较头部的颜色（头发、脸的边缘），透明的地方也算进去
  let best = { dx: 0, dy: 0, e: Infinity };
  for (let dy = -16; dy <= 16; dy++) for (let dx = -16; dx <= 16; dx++) {
    let e = 0;
    for (let y = top; y < hy1; y += 2) for (let x = 0; x < W; x += 2) {
      const i = (y * W + x) * 4, sx = x - dx, sy = y - dy;
      const j = sx >= 0 && sy >= 0 && sx < W && sy < H ? (sy * W + sx) * 4 : -1;
      const aa = a[i + 3] / 255, ba = j < 0 ? 0 : B[j + 3] / 255;
      for (let c = 0; c < 3; c++) e += Math.abs(a[i + c] * aa - (j < 0 ? 0 : B[j + c] * ba));
    }
    if (e < best.e) best = { dx, dy, e };
  }
  // 对齐后颜色差别大的地方（眼睛）做蒙版，膨胀一点再羽化
  const at = (x, y) => { const sx = x - best.dx, sy = y - best.dy; return sx >= 0 && sy >= 0 && sx < W && sy < H ? (sy * W + sx) * 4 : -1; };
  const m = new Float32Array(W * H);
  for (let y = top; y < hy1; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, j = at(x, y);
    if (j < 0 || a[i + 3] < 200 || B[j + 3] < 200) continue;
    const d = Math.abs(a[i] - B[j]) + Math.abs(a[i + 1] - B[j + 1]) + Math.abs(a[i + 2] - B[j + 2]);
    if (d > 70) m[y * W + x] = 1;
  }
  // 去掉零星的点（头发边缘的细微差别），只留成片的区域
  const keep = new Float32Array(W * H);
  for (let y = 2; y < H - 2; y++) for (let x = 2; x < W - 2; x++) {
    if (!m[y * W + x]) continue;
    let n = 0;
    for (let yy = -2; yy <= 2; yy++) for (let xx = -2; xx <= 2; xx++) n += m[(y + yy) * W + x + xx];
    if (n >= 8) keep[y * W + x] = 1;
  }
  // 每一块有差别的地方（每只眼睛、嘴）单独处理：头可能转了一点，两只眼睛移动的距离不一样，
  // 所以每块再在附近找一次最合适的位置（比较四周一圈皮肤），然后整块换掉（眼白和皮肤颜色接近，只换有差别的像素会留轮廓）
  const seen = new Uint8Array(W * H);
  const out = Buffer.from(a);
  const px = (buf, i) => [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (!keep[p0] || seen[p0]) continue;
    let bx0 = W, by0 = H, bx1 = 0, by1 = 0, n = 0;
    const st = [p0]; seen[p0] = 1;
    while (st.length) {
      const p = st.pop(), x = p % W, y = (p / W) | 0; n++;
      bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); by0 = Math.min(by0, y); by1 = Math.max(by1, y);
      for (let yy = -3; yy <= 3; yy++) for (let xx = -3; xx <= 3; xx++) {
        const q = (y + yy) * W + x + xx;
        if (q >= 0 && q < W * H && keep[q] && !seen[q]) { seen[q] = 1; st.push(q); }
      }
    }
    if (n < 15) continue;
    // 框要扩多少不一定：扩大能把眼白、眼线一起换掉（头转了的时候需要），但可能切到头发。
    // 几种大小都试，每种在整体偏移附近找这块自己的偏移，取框外一圈最对得上的
    const ring = 5, size = Math.max(bx1 - bx0, by1 - by0);
    let lb = { dx: best.dx, dy: best.dy, e: Infinity, X0: 0, X1: 0, Y0: 0, Y1: 0 };
    for (const pad of [...new Set([3, Math.round(size * 0.25), Math.round(size * 0.45)])].filter((v) => v >= 3)) {
      const X0 = Math.max(0, bx0 - pad), X1 = Math.min(W - 1, bx1 + pad), Y0 = Math.max(0, by0 - pad), Y1 = Math.min(H - 1, by1 + pad);
      for (let ly = -10; ly <= 10; ly++) for (let lx = -10; lx <= 10; lx++) {
        const ox = best.dx + lx, oy = best.dy + ly;
        let e = 0, cnt = 0;
        for (let y = Y0 - ring; y <= Y1 + ring; y++) for (let x = X0 - ring; x <= X1 + ring; x++) {
          if (x >= X0 && x <= X1 && y >= Y0 && y <= Y1) continue;
          if (x < 0 || y < 0 || x >= W || y >= H) continue;
          const sx = x - ox, sy = y - oy;
          if (sx < 0 || sy < 0 || sx >= W || sy >= H) { e += 300; cnt++; continue; }
          const i = (y * W + x) * 4, j = (sy * W + sx) * 4;
          e += Math.abs(a[i] - B[j]) + Math.abs(a[i + 1] - B[j + 1]) + Math.abs(a[i + 2] - B[j + 2]) + Math.abs(a[i + 3] - B[j + 3]);
          cnt++;
        }
        e /= Math.max(1, cnt);
        if (e < lb.e) lb = { dx: ox, dy: oy, e, X0, X1, Y0, Y1 };
      }
    }
    const { X0, X1, Y0, Y1 } = lb;
    // 整块贴上，边缘 2 像素羽化
    for (let y = Y0; y <= Y1; y++) for (let x = X0; x <= X1; x++) {
      const sx = x - lb.dx, sy = y - lb.dy;
      if (sx < 0 || sy < 0 || sx >= W || sy >= H) continue;
      const edge = Math.min(x - X0, X1 - x, y - Y0, Y1 - y);
      const k = Math.min(1, (edge + 1) / 3);
      const i = (y * W + x) * 4, j = (sy * W + sx) * 4;
      const A4 = px(out, i), B4 = px(B, j);
      for (let c = 0; c < 4; c++) out[i + c] = Math.round(A4[c] * (1 - k) + B4[c] * k);
    }
  }
  await sharp(out, { raw: { width: W, height: H, channels: 4 } }).png().toFile(path.join(dir, "blink.png"));
  return best;
}

for (const char of fs.readdirSync(args.in).filter((n) => fs.statSync(path.join(args.in, n)).isDirectory())) {
  if (only && !only.includes(char)) continue;
  const id = nameMap[char] ?? char;
  const dir = path.join(args.in, char);
  const bl = await makeBlink(dir);
  if (bl) console.log(`${char}：眨眼图已生成（闭眼那张偏移了 ${bl.dx},${bl.dy} 像素，已对齐）`);
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
