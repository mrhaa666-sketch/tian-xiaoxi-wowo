// 把世界计划 Spine 小人的「无五官身体图」和「五官表情图」合成成游戏用的立牌和头像。
//
// 用法：
//   node tools/sd-compose.mjs --skel <v2_sd_main.skel> --faces <五官文件夹> --bodies <身体文件夹> --out public/packs/chars \
//        --map 朝比奈真冬=mafuyu,宵崎奏=kanade,晓山瑞希=mizuki
//
// 输入（GPT 用 Spine 4.1 渲染出来的图）：
//   <五官文件夹>/<角色>/face_*.png + info.txt（写着裁框和每张图用的动画、秒数）
//   <身体文件夹>/<角色>/*.png，<身体文件夹>/info.txt（写着裁框和每张图用的动画、秒数）
//
// 原理：两组图都来自同一个 1408×1408 渲染画布。用骨骼文件算出每一帧 F_head（头）骨骼的位置和角度，
// 把五官从它自己那一帧的头部姿态，旋转平移到身体那一帧的头部姿态上；再只在脸部皮肤上显示五官，
// 这样刘海会自然挡在眼睛前面。
//
// 骨骼坐标 → 画布像素的换算（--k --ox --oy）是根据这套渲染拟合出来的：像素 = 原点 + k × 骨骼坐标（y 轴向下）。
// 换了渲染设置（画布大小、缩放）时需要重新拟合。
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import * as spine from "@esotericsoftware/spine-core";

const args = Object.fromEntries(process.argv.slice(2).reduce((a, v, i, arr) => (v.startsWith("--") ? [...a, [v.slice(2), arr[i + 1]]] : a), []));
const K = Number(args.k ?? 1.76), OX = Number(args.ox ?? 736.3), OY = Number(args.oy ?? 1172.3);
const OUT_H = Number(args.height ?? 320); // 立牌输出高度（像素）
const AVATAR = 160;
const nameMap = Object.fromEntries((args.map ?? "").split(",").filter(Boolean).map((s) => s.split("=")));

// ———— 骨骼：不需要贴图，给每个附件一个假的贴图区域即可 ————
const fakeRegion = { u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1, degrees: 0, offsetX: 0, offsetY: 0, originalWidth: 1, originalHeight: 1, texture: null, page: {} };
const loader = {
  newRegionAttachment: (skin, name, p) => { const a = new spine.RegionAttachment(name, p); a.region = fakeRegion; return a; },
  newMeshAttachment: (skin, name, p) => { const a = new spine.MeshAttachment(name, p); a.region = fakeRegion; return a; },
  newBoundingBoxAttachment: (skin, name) => new spine.BoundingBoxAttachment(name),
  newPathAttachment: (skin, name) => new spine.PathAttachment(name),
  newPointAttachment: (skin, name) => new spine.PointAttachment(name),
  newClippingAttachment: (skin, name) => new spine.ClippingAttachment(name),
};
const data = new spine.SkeletonBinary(loader).readSkeletonData(new Uint8Array(fs.readFileSync(args.skel)));
const sk = new spine.Skeleton(data);
const state = new spine.AnimationState(new spine.AnimationStateData(data));
function headAt(anim, t) {
  if (!data.findAnimation(anim)) throw new Error(`骨骼里没有动画 ${anim}`);
  sk.setToSetupPose(); state.clearTracks(); state.setAnimation(0, anim, false); state.update(t); state.apply(sk); sk.updateWorldTransform();
  const h = sk.findBone("F_head");
  return { x: OX + K * h.worldX, y: OY - K * h.worldY, r: h.getWorldRotationX(), s: h.getWorldScaleX() };
}

// ———— 读 info.txt ————
function readInfo(file) {
  const txt = fs.readFileSync(file, "utf8").replace(/^﻿/, "");
  const box = txt.match(/裁框\s*\((\d+),\s*(\d+),\s*(\d+),\s*(\d+)\)/);
  const frames = {};
  for (const m of txt.matchAll(/^(?:[^\s/]+\/)?([\w-]+)\.png\s+(\S+)\s+([\d.]+)\s*秒/gm)) frames[m[1]] = { anim: m[2], t: Number(m[3]) };
  return { box: box ? box.slice(1, 5).map(Number) : null, frames, txt };
}
function framesFor(txt, char) {
  // 身体的 info.txt 把三个角色写在一起：「角色/文件.png 动画 秒」
  const frames = {};
  for (const m of txt.matchAll(/^([^\s/]+)\/([\w-]+)\.png\s+(\S+)\s+([\d.]+)\s*秒/gm)) if (m[1] === char) frames[m[2]] = { anim: m[3], t: Number(m[4]) };
  return frames;
}

async function rgba(file) { const { data: d, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true }); return { d, w: info.width, h: info.height }; }

/** 脸部皮肤蒙版：在预计的脸中心附近找肤色像素，再向外漫水填充，碰到线稿和头发就停 */
function skinMask(img, cx, cy, radius) {
  const { d, w, h } = img;
  const at = (x, y) => (y * w + x) * 4;
  // 先取肤色：中心附近最亮、偏暖的颜色
  const counts = new Map();
  for (let y = Math.max(0, cy - 40); y < Math.min(h, cy + 40); y++) for (let x = Math.max(0, cx - 40); x < Math.min(w, cx + 40); x++) {
    const i = at(x, y); const [r, g, b, a] = [d[i], d[i + 1], d[i + 2], d[i + 3]];
    if (a > 240 && r > 235 && r >= g && g >= b && r - b < 50) { const k = `${r >> 2},${g >> 2},${b >> 2}`; counts.set(k, (counts.get(k) ?? 0) + 1); }
  }
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!top) throw new Error("找不到脸部肤色");
  const base = top[0].split(",").map((v) => Number(v) * 4 + 2);
  const near = (i, tol) => d[i + 3] > 200 && Math.abs(d[i] - base[0]) + Math.abs(d[i + 1] - base[1]) + Math.abs(d[i + 2] - base[2]) <= tol;
  const m = new Uint8Array(w * h);
  const stack = [];
  for (let y = Math.max(0, cy - 70); y < Math.min(h, cy + 70); y++) for (let x = Math.max(0, cx - 70); x < Math.min(w, cx + 70); x++) {
    if ((x - cx) ** 2 + (y - cy) ** 2 < 70 * 70 && near(at(x, y), 16)) { m[y * w + x] = 1; stack.push(y * w + x); }
  }
  while (stack.length) {
    const p = stack.pop(); const x = p % w, y = (p / w) | 0;
    for (const [X, Y] of [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]]) {
      if (X < 0 || Y < 0 || X >= w || Y >= h) continue;
      const q = Y * w + X;
      if (m[q] || (X - cx) ** 2 + (Y - cy) ** 2 > radius * radius || !near(q * 4, 36)) continue;
      m[q] = 1; stack.push(q);
    }
  }
  // 膨胀 1 像素，盖住线稿边上的抗锯齿
  const out = Buffer.alloc(w * h);
  for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) { const p = y * w + x; if (m[p] || m[p - 1] || m[p + 1] || m[p - w] || m[p + w]) out[p] = 255; }
  return out;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
/** 皮肤蒙版的范围（去掉两头 2% 的零星像素） */
function skinBox(mask) {
  const xs = [], ys = [];
  for (let p = 0; p < 512 * 512; p++) if (mask[p]) { xs.push(p % 512); ys.push((p / 512) | 0); }
  xs.sort((a, b) => a - b); ys.sort((a, b) => a - b);
  const q = (arr, t) => arr[Math.min(arr.length - 1, Math.floor(arr.length * t))];
  const x0 = q(xs, 0.02), x1 = q(xs, 0.98), y0 = q(ys, 0.02), y1 = q(ys, 0.98);
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}
function alphaCentroid(raw) {
  let sx = 0, sy = 0, n = 0;
  for (let p = 0; p < 512 * 512; p++) { const a = raw[p * 4 + 3]; if (a > 20) { sx += (p % 512) * a; sy += ((p / 512) | 0) * a; n += a; } }
  return n ? { x: sx / n, y: sy / n } : null;
}

// 身体 → 默认表情、各种心情用哪个身体姿势
const EMOTION_BODY = { normal: ["talk"], happy: ["joy", "talk"], sad: ["doubt"], angry: ["angry", "doubt"], surprised: ["surprise"], shy: ["doubt"], sick: ["doubt"], sleepy: ["talk"] };

const bodyInfo = readInfo(path.join(args.bodies, "info.txt"));
const outRoot = args.out;
for (const char of fs.readdirSync(args.faces).filter((n) => fs.statSync(path.join(args.faces, n)).isDirectory())) {
  const id = nameMap[char] ?? char;
  const fInfo = readInfo(path.join(args.faces, char, "info.txt"));
  const bFrames = framesFor(bodyInfo.txt, char);
  const FB = fInfo.box, BB = bodyInfo.box;
  const fs_ = (FB[2] - FB[0]) / 512, bs = (BB[2] - BB[0]) / 512;
  const faces = Object.keys(fInfo.frames).filter((f) => fs.existsSync(path.join(args.faces, char, f + ".png")));
  const bodies = Object.keys(bFrames).filter((b) => fs.existsSync(path.join(args.bodies, char, b + ".png")));
  const outDir = path.join(outRoot, id);
  fs.mkdirSync(outDir, { recursive: true });

  // 所有身体共用一个裁剪框（保证换姿势时脚不跳）
  let x0 = 512, y0 = 512, x1 = 0, y1 = 0;
  for (const b of bodies) {
    const t = await sharp(path.join(args.bodies, char, b + ".png")).trim().toBuffer({ resolveWithObject: true });
    x0 = Math.min(x0, -t.info.trimOffsetLeft); y0 = Math.min(y0, -t.info.trimOffsetTop);
    x1 = Math.max(x1, -t.info.trimOffsetLeft + t.info.width); y1 = Math.max(y1, -t.info.trimOffsetTop + t.info.height);
  }
  x0 = Math.max(0, x0 - 4); y0 = Math.max(0, y0 - 4); x1 = Math.min(512, x1 + 4); y1 = Math.min(512, y1 + 4);
  const scale = OUT_H / (y1 - y0);
  const outW = Math.round((x1 - x0) * scale);
  // 脚底：骨骼原点
  const footX = ((OX - BB[0]) / bs - x0) * scale, footY = ((OY - BB[1]) / bs - y0) * scale;

  const manifest = { id, name: char, width: outW, height: OUT_H, footX: Math.round(footX), footY: Math.round(footY), bodies, faces, emotionBody: {}, avatar: {} };
  for (const [emo, prefs] of Object.entries(EMOTION_BODY)) manifest.emotionBody[emo] = prefs.find((p) => bodies.includes(p)) ?? bodies[0];

  // 以默认姿势（说话）为基准，记下五官相对脸部皮肤范围的位置；其他姿势（比如抬头）按皮肤范围的变化把五官挪过去、压扁
  const ref = manifest.emotionBody.normal;
  const ordered = [ref, ...bodies.filter((b) => b !== ref)];
  for (const b of ordered) {
    const bodyFile = path.join(args.bodies, char, b + ".png");
    const body = await rgba(bodyFile);
    const hb = headAt(bFrames[b].anim, bFrames[b].t);
    // 脸中心（头部局部坐标里拟合出来的偏移，换算到这一帧）
    const rad = (hb.r * Math.PI) / 180, vx = 70.98, vy = -4.32;
    const fcx = Math.round((hb.x + K * (Math.cos(rad) * vx - Math.sin(rad) * vy) - BB[0]) / bs);
    const fcy = Math.round((hb.y - K * (Math.sin(rad) * vx + Math.cos(rad) * vy) - BB[1]) / bs);
    const mask = skinMask(body, fcx, fcy, 170);
    if (args.debug) { await sharp(mask, { raw: { width: 512, height: 512, channels: 1 } }).png().toFile(path.join(outDir, `_mask_${b}.png`)); console.log(b, "脸中心", fcx, fcy); }
    let headBox = null;
    for (const f of faces) {
      const hf = headAt(fInfo.frames[f].anim, fInfo.frames[f].t);
      // 五官图（画布坐标）→ 绕自己的头骨旋转到身体那一帧的角度 → 平移到身体的头骨位置 → 身体图坐标
      const dr = -(hb.r - hf.r); // 画布 y 轴向下，角度方向相反
      const faceSize = Math.round(512 * fs_);
      const faceCanvas = await sharp(path.join(args.faces, char, f + ".png")).resize(faceSize, faceSize).toBuffer();
      const pad = faceSize; // 旋转时留足空间
      const big = await sharp({ create: { width: faceSize + pad * 2, height: faceSize + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: faceCanvas, left: pad, top: pad }]).png().toBuffer();
      // 让头骨位置处在大图正中心，旋转后中心不变
      const pivX = hf.x - FB[0] + pad, pivY = hf.y - FB[1] + pad;
      const side = Math.ceil(Math.max(pivX, pivY, faceSize + pad * 2 - pivX, faceSize + pad * 2 - pivY)) * 2;
      const centered = await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: big, left: Math.round(side / 2 - pivX), top: Math.round(side / 2 - pivY) }]).png().toBuffer();
      const rotated = await sharp(centered).rotate(dr, { background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer({ resolveWithObject: true });
      // 旋转后图变大，中心仍是头骨。缩放到身体图比例，并把中心放到身体的头骨位置
      const rs = 1 / bs;
      const rw = Math.round(rotated.info.width * rs), rh = Math.round(rotated.info.height * rs);
      const scaled = await sharp(rotated.data).resize(rw, rh).toBuffer();
      const left = Math.round((hb.x - BB[0]) / bs - rw / 2), top = Math.round((hb.y - BB[1]) / bs - rh / 2);
      // 先在透明底上摆好，再裁到 512 并乘上皮肤蒙版
      const layerBig = await sharp({ create: { width: 512 + rw * 2, height: 512 + rh * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
        .composite([{ input: scaled, left: left + rw, top: top + rh }]).png().toBuffer();
      let layer = await sharp(layerBig).extract({ left: rw, top: rh, width: 512, height: 512 }).raw().toBuffer();
      // 个别姿势（比如抬头）按骨骼算出的五官位置不准时，用 --dy-<角色id>-<姿势> / --dx-<角色id>-<姿势> 手动挪（像素，正数向下 / 向右）
      const mdx = Math.round(Number(args[`dx-${id}-${b}`] ?? 0)), mdy = Math.round(Number(args[`dy-${id}-${b}`] ?? 0));
      if (mdx || mdy) {
        const padded = await sharp({ create: { width: 712, height: 712, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
          .composite([{ input: await sharp(layer, { raw: { width: 512, height: 512, channels: 4 } }).png().toBuffer(), left: 100 + mdx, top: 100 + mdy }]).png().toBuffer();
        layer = await sharp(padded).extract({ left: 100, top: 100, width: 512, height: 512 }).raw().toBuffer();
      }
      for (let p = 0; p < 512 * 512; p++) layer[p * 4 + 3] = Math.round((layer[p * 4 + 3] * mask[p]) / 255);
      const faceLayer = await sharp(layer, { raw: { width: 512, height: 512, channels: 4 } }).png().toBuffer();
      const composed = await sharp(bodyFile).composite([{ input: faceLayer }]).png().toBuffer();
      const emo = f.replace(/^face_/, "");
      await sharp(composed).extract({ left: x0, top: y0, width: x1 - x0, height: y1 - y0 }).resize(outW, OUT_H).png({ palette: true, quality: 92, effort: 8 }).toFile(path.join(outDir, `${b}__${emo}.png`));
      // 头像：用默认身体，以脸为中心裁正方形
      if (b === manifest.emotionBody.normal) {
        if (!headBox) {
          // 用皮肤蒙版的实际范围找脸的中心（比预计位置准）
          let sx = 0, sy = 0, n = 0;
          for (let p = 0; p < 512 * 512; p++) if (mask[p]) { sx += p % 512; sy += (p / 512) | 0; n++; }
          const cx = n ? Math.round(sx / n) : fcx, cy = n ? Math.round(sy / n) : fcy;
          const half = 105;
          headBox = { left: Math.max(0, cx - half), top: Math.max(0, cy - half - 20), size: half * 2 };
        }
        await sharp(composed).extract({ left: headBox.left, top: headBox.top, width: Math.min(headBox.size, 512 - headBox.left), height: Math.min(headBox.size, 512 - headBox.top) })
          .resize(AVATAR, AVATAR, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(outDir, `avatar_${emo}.png`));
        manifest.avatar[emo] = `avatar_${emo}.png`;
      }
    }
    console.log(`${char} · ${b}：已合成 ${faces.length} 种表情`);
  }
  fs.writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 2));
  console.log(`→ ${outDir}`);
}
