// 把玩家上传的一张角色图整理成立绘：（可选）去掉纯色背景 → 裁掉透明边 → 缩到合适大小 → 找出头的位置 → 裁出头像。
// 只有一张图的角色，心情靠头顶的情绪标记（爱心气泡、生气十字……）来表现，见 charview.ts。

export interface UploadResult {
  files: Record<string, string>; // 文件名 → data: 地址（和角色包里的立绘一样，可以直接存进浏览器）
  preview: string;               // 头像的 data: 地址，给界面预览用
}

const OUT_H = 400;   // 立绘高度（像素），够手机三倍屏用
const AVATAR = 160;

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("图片读不出来")); };
    img.src = url;
  });
}

/** 从四条边往里「漫水」，把和边缘颜色接近、连在一起的像素变透明（适合纯色或接近纯色的背景） */
function removeBackground(data: ImageData) {
  const { width: w, height: h, data: px } = data;
  const seen = new Uint8Array(w * h);
  const stack: number[] = [];
  const near = (i: number, r: number, g: number, b: number) => Math.abs(px[i] - r) + Math.abs(px[i + 1] - g) + Math.abs(px[i + 2] - b) < 48;
  const seed = (x: number, y: number) => {
    const p = y * w + x;
    if (!seen[p]) { seen[p] = 1; stack.push(p); }
  };
  for (let x = 0; x < w; x++) { seed(x, 0); seed(x, h - 1); }
  for (let y = 0; y < h; y++) { seed(0, y); seed(w - 1, y); }
  while (stack.length) {
    const p = stack.pop()!;
    const i = p * 4;
    if (px[i + 3] < 10) { /* 已经透明 */ } else {
      // 和自己所在边缘附近的颜色比：取最近一条边上同一行/列的颜色
      const x = p % w, y = (p / w) | 0;
      const ex = x < w / 2 ? 0 : w - 1, ey = y < h / 2 ? 0 : h - 1;
      const ref = Math.abs(x - ex) < Math.abs(y - ey) ? (y * w + ex) * 4 : (ey * w + x) * 4;
      if (!near(i, px[ref], px[ref + 1], px[ref + 2])) continue;
      px[i + 3] = 0;
    }
    const x = p % w, y = (p / w) | 0;
    if (x > 0) seed(x - 1, y);
    if (x < w - 1) seed(x + 1, y);
    if (y > 0) seed(x, y - 1);
    if (y < h - 1) seed(x, y + 1);
  }
}

function opaqueBounds(data: ImageData) {
  const { width: w, height: h, data: px } = data;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[(y * w + x) * 4 + 3] > 24) {
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
  }
  return x1 < 0 ? null : { x0, y0, x1: x1 + 1, y1: y1 + 1 };
}

export async function processUpload(file: Blob, removeBg: boolean): Promise<UploadResult> {
  const img = await loadImage(file);
  // 先缩到最长边不超过 1200，处理快一些
  const k0 = Math.min(1, 1200 / Math.max(img.naturalWidth, img.naturalHeight));
  const W = Math.max(1, Math.round(img.naturalWidth * k0)), H = Math.max(1, Math.round(img.naturalHeight * k0));
  const c = document.createElement("canvas");
  c.width = W; c.height = H;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, W, H);
  const data = ctx.getImageData(0, 0, W, H);
  if (removeBg) { removeBackground(data); ctx.putImageData(data, 0, 0); }
  const b = opaqueBounds(data) ?? { x0: 0, y0: 0, x1: W, y1: H };
  const bw = b.x1 - b.x0, bh = b.y1 - b.y0;

  // 立绘：裁掉透明边，缩到固定高度
  const k = OUT_H / bh;
  const ow = Math.max(1, Math.round(bw * k));
  const out = document.createElement("canvas");
  out.width = ow; out.height = OUT_H;
  const octx = out.getContext("2d")!;
  octx.imageSmoothingQuality = "high";
  octx.drawImage(c, b.x0, b.y0, bw, bh, 0, 0, ow, OUT_H);

  // 头的位置：从最上面往下 30% 的范围里，不透明部分的左右边界
  const od = octx.getImageData(0, 0, ow, OUT_H);
  const tall = OUT_H / ow > 1.3; // 竖长的图当成全身，否则当成半身或头像
  const headRows = Math.round(OUT_H * (tall ? 0.32 : 0.6));
  let hx0 = ow, hx1 = 0;
  for (let y = 0; y < headRows; y++) for (let x = 0; x < ow; x++) if (od.data[(y * ow + x) * 4 + 3] > 60) { if (x < hx0) hx0 = x; if (x > hx1) hx1 = x; }
  if (hx1 <= hx0) { hx0 = 0; hx1 = ow; }
  const headW = hx1 - hx0;

  // 头像：全身图取上面一块正方形，半身图取中间
  const side = Math.round(Math.min(ow, OUT_H, Math.max(headW * 1.15, tall ? ow * 0.6 : Math.min(ow, OUT_H))));
  const ax = Math.max(0, Math.min(ow - side, Math.round((hx0 + hx1) / 2 - side / 2)));
  const ay = tall ? 0 : Math.max(0, Math.round((OUT_H - side) / 3));
  const av = document.createElement("canvas");
  av.width = AVATAR; av.height = AVATAR;
  const actx = av.getContext("2d")!;
  actx.imageSmoothingQuality = "high";
  actx.drawImage(out, ax, ay, side, side, 0, 0, AVATAR, AVATAR);

  const manifest = {
    id: "", width: ow, height: OUT_H, footX: Math.round(ow / 2), footY: OUT_H,
    frames: { normal: "img" }, poses: [] as string[], avatar: { normal: "avatar_normal.png" },
    single: true,
    // 情绪标记放在头的右上角
    head: { x: Math.round(hx1 - headW * 0.12), y: Math.round(OUT_H * (tall ? 0.04 : 0.08)), size: headW },
  };
  const json = JSON.stringify(manifest);
  const preview = av.toDataURL("image/png");
  return {
    files: {
      "img.png": out.toDataURL("image/png"),
      "avatar_normal.png": preview,
      "manifest.json": `data:application/json;base64,${btoa(unescape(encodeURIComponent(json)))}`,
    },
    preview,
  };
}
