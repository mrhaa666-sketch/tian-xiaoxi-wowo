// 户型设计（DIY 公寓）：全屏的 2D 平面图编辑器。
// 从下面挑房间类型，点一下或拖一下放到格子上；拖动房间挪位置，拖右下角的圆点改大小；
// 「门」模式下点房间之间的墙加门、去门。点「应用」后整套户型生成到游戏里。
import { ROOM_KINDS, KIND_BY_ID, ensureDoors, overlaps, planId, roomAt, sharedEdges, exteriorEdges, uniqueName, type Plan, type PlanRoom } from "../world/floorplan";
import { wkey } from "../world/world";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

type Mode = { t: "select" } | { t: "place"; kind: string } | { t: "door" };
type Drag =
  | { t: "pan"; sx: number; sy: number; ox: number; oy: number }
  | { t: "move"; id: string; dx: number; dy: number; orig: PlanRoom; moved: boolean }
  | { t: "resize"; id: string; orig: PlanRoom }
  | { t: "draw"; x0: number; y0: number; x1: number; y1: number }
  | { t: "tap"; sx: number; sy: number };

export class Planner {
  private canvas!: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private mode: Mode = { t: "select" };
  private sel: string | null = null;
  private cell = 26;
  private ox = 0;
  private oy = 0;
  private drag: Drag | null = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private invalid = false;

  constructor(private root: HTMLElement, private plan: Plan, private onApply: (plan: Plan) => void, private confirm: (text: string, ok: () => void) => void, private flash: (t: string) => void) {
    root.innerHTML = `
      <header class="page-head"><button class="icon-btn" data-close aria-label="返回"><svg class="ic" viewBox="0 0 24 24"><path d="M15 5 8 12l7 7"/></svg></button>
        <h2>户型设计</h2><button class="btn small primary" id="pl-apply">应用</button></header>
      <div class="pl-stage"><canvas id="pl-canvas"></canvas>
        <div class="pl-zoom"><button class="icon-btn" id="pl-in" aria-label="放大">＋</button><button class="icon-btn" id="pl-out" aria-label="缩小">－</button><button class="icon-btn" id="pl-fit" aria-label="看全部">⤢</button></div>
        <div class="pl-info" id="pl-info"></div></div>
      <div class="pl-panel" id="pl-panel"></div>`;
    this.canvas = root.querySelector("#pl-canvas")!;
    this.ctx = this.canvas.getContext("2d")!;
    root.querySelector<HTMLElement>("#pl-apply")!.onclick = () => this.apply();
    root.querySelector<HTMLElement>("#pl-in")!.onclick = () => this.zoomBy(1.25);
    root.querySelector<HTMLElement>("#pl-out")!.onclick = () => this.zoomBy(0.8);
    root.querySelector<HTMLElement>("#pl-fit")!.onclick = () => this.fit();
    this.bindPointer();
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement!);
    requestAnimationFrame(() => { this.resize(); this.fit(); });
    this.renderPanel();
  }

  // ———————————————————— 坐标 ————————————————————

  private toCell(sx: number, sy: number) {
    return { x: (sx - this.ox) / this.cell, y: (sy - this.oy) / this.cell };
  }

  private resize() {
    const p = this.canvas.parentElement!;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = p.clientWidth * dpr;
    this.canvas.height = p.clientHeight * dpr;
    this.canvas.style.width = p.clientWidth + "px";
    this.canvas.style.height = p.clientHeight + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.draw();
  }

  private fit() {
    const p = this.canvas.parentElement!;
    const rs = this.plan.rooms;
    if (!rs.length) { this.cell = 26; this.ox = p.clientWidth / 2; this.oy = p.clientHeight / 3; this.draw(); return; }
    const x0 = Math.min(...rs.map((r) => r.x)) - 1, y0 = Math.min(...rs.map((r) => r.y)) - 1;
    const x1 = Math.max(...rs.map((r) => r.x + r.w)) + 1, y1 = Math.max(...rs.map((r) => r.y + r.h)) + 1;
    this.cell = Math.max(12, Math.min(44, Math.min(p.clientWidth / (x1 - x0), p.clientHeight / (y1 - y0))));
    this.ox = (p.clientWidth - (x1 - x0) * this.cell) / 2 - x0 * this.cell;
    this.oy = (p.clientHeight - (y1 - y0) * this.cell) / 2 - y0 * this.cell;
    this.draw();
  }

  private zoomBy(k: number, cx?: number, cy?: number) {
    const p = this.canvas.parentElement!;
    const px = cx ?? p.clientWidth / 2, py = cy ?? p.clientHeight / 2;
    const c = Math.max(10, Math.min(60, this.cell * k));
    this.ox = px - ((px - this.ox) * c) / this.cell;
    this.oy = py - ((py - this.oy) * c) / this.cell;
    this.cell = c;
    this.draw();
  }

  // ———————————————————— 绘制 ————————————————————

  private draw() {
    const ctx = this.ctx;
    const W = this.canvas.clientWidth, H = this.canvas.clientHeight;
    const c = this.cell;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = "#f7f3ee";
    ctx.fillRect(0, 0, W, H);
    // 网格
    ctx.strokeStyle = "rgba(120,100,130,0.12)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    const gx0 = Math.floor(-this.ox / c), gy0 = Math.floor(-this.oy / c);
    for (let x = gx0; x * c + this.ox < W; x++) { ctx.moveTo(x * c + this.ox + 0.5, 0); ctx.lineTo(x * c + this.ox + 0.5, H); }
    for (let y = gy0; y * c + this.oy < H; y++) { ctx.moveTo(0, y * c + this.oy + 0.5); ctx.lineTo(W, y * c + this.oy + 0.5); }
    ctx.stroke();

    const rect = (r: { x: number; y: number; w: number; h: number }) => [r.x * c + this.ox, r.y * c + this.oy, r.w * c, r.h * c] as const;
    // 房间
    for (const r of this.plan.rooms) {
      const k = KIND_BY_ID[r.kind] ?? KIND_BY_ID.empty;
      const [x, y, w, h] = rect(r);
      ctx.fillStyle = k.color;
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = k.outdoor ? "rgba(90,140,80,0.6)" : "#6b5a66";
      ctx.lineWidth = k.outdoor ? 1.5 : 3;
      if (k.outdoor) ctx.setLineDash([6, 4]);
      ctx.strokeRect(x, y, w, h);
      ctx.setLineDash([]);
      if (c >= 14) {
        ctx.fillStyle = "#4a3f4f";
        ctx.font = `700 ${Math.max(10, Math.min(15, c * 0.5))}px "Noto Sans SC", sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(r.name, x + w / 2, y + h / 2 - (h > c * 1.5 ? 7 : 0), w - 4);
        if (h > c * 1.5) {
          ctx.font = `${Math.max(9, Math.min(12, c * 0.4))}px "Noto Sans SC", sans-serif`;
          ctx.fillStyle = "rgba(74,63,79,0.6)";
          ctx.fillText(`${r.w}×${r.h}`, x + w / 2, y + h / 2 + 10);
        }
      }
    }
    // 门：墙上的一个缺口
    for (const d of this.plan.doors) {
      const [xs, ys, dir] = d.split(",");
      const x = Number(xs) * c + this.ox, y = Number(ys) * c + this.oy;
      ctx.fillStyle = "#fff";
      ctx.strokeStyle = "#e8789a";
      ctx.lineWidth = 2;
      if (dir === "N") { ctx.fillRect(x + c * 0.18, y - 3, c * 0.64, 6); ctx.strokeRect(x + c * 0.18, y - 3, c * 0.64, 6); }
      else { ctx.fillRect(x - 3, y + c * 0.18, 6, c * 0.64); ctx.strokeRect(x - 3, y + c * 0.18, 6, c * 0.64); }
    }
    // 选中的房间
    const s = this.plan.rooms.find((r) => r.id === this.sel);
    if (s) {
      const [x, y, w, h] = rect(s);
      ctx.strokeStyle = this.invalid ? "#e06464" : "#e8789a";
      ctx.lineWidth = 3;
      ctx.strokeRect(x - 2, y - 2, w + 4, h + 4);
      ctx.fillStyle = this.invalid ? "#e06464" : "#e8789a";
      ctx.beginPath();
      ctx.arc(x + w, y + h, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.font = "700 12px sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("↘", x + w, y + h);
    }
    // 正在画的新房间
    if (this.drag?.t === "draw" && this.mode.t === "place") {
      const d = this.drag;
      const r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0) + 1, h: Math.abs(d.y1 - d.y0) + 1 };
      const [x, y, w, h] = rect(r);
      const bad = this.plan.rooms.some((o) => overlaps(o, r));
      ctx.fillStyle = bad ? "rgba(224,100,100,0.3)" : "rgba(232,120,154,0.25)";
      ctx.fillRect(x, y, w, h);
      ctx.strokeStyle = bad ? "#e06464" : "#e8789a";
      ctx.lineWidth = 2;
      ctx.strokeRect(x, y, w, h);
    }
    const info = this.root.querySelector("#pl-info")!;
    const area = this.plan.rooms.reduce((a, r) => a + r.w * r.h, 0);
    info.textContent = `${this.plan.rooms.length} 个房间 · ${area} 格`;
  }

  // ———————————————————— 操作 ————————————————————

  private bindPointer() {
    const cv = this.canvas;
    const local = (e: PointerEvent) => { const r = cv.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    cv.addEventListener("pointerdown", (e) => {
      cv.setPointerCapture(e.pointerId);
      const p = local(e);
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        this.pinch = Math.hypot(a.x - b.x, a.y - b.y);
        this.drag = null;
        return;
      }
      const g = this.toCell(p.x, p.y);
      const cx = Math.floor(g.x), cy = Math.floor(g.y);
      const s = this.plan.rooms.find((r) => r.id === this.sel);
      if (this.mode.t === "place") { this.drag = { t: "draw", x0: cx, y0: cy, x1: cx, y1: cy }; this.draw(); return; }
      if (this.mode.t === "door") { this.drag = { t: "tap", sx: p.x, sy: p.y }; return; }
      if (s) {
        const hx = (s.x + s.w) * this.cell + this.ox, hy = (s.y + s.h) * this.cell + this.oy;
        if (Math.hypot(p.x - hx, p.y - hy) < 22) { this.drag = { t: "resize", id: s.id, orig: { ...s } }; return; }
      }
      const r = roomAt(this.plan, cx, cy);
      if (r) {
        this.sel = r.id;
        this.drag = { t: "move", id: r.id, dx: g.x - r.x, dy: g.y - r.y, orig: { ...r }, moved: false };
        this.renderPanel();
        this.draw();
        return;
      }
      this.drag = { t: "pan", sx: p.x, sy: p.y, ox: this.ox, oy: this.oy };
    });
    cv.addEventListener("pointermove", (e) => {
      const p = local(e);
      const prev = this.pointers.get(e.pointerId);
      if (!prev) return;
      this.pointers.set(e.pointerId, p);
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch) this.zoomBy(d / this.pinch, (a.x + b.x) / 2, (a.y + b.y) / 2);
        this.ox += (p.x - prev.x) / 2; this.oy += (p.y - prev.y) / 2;
        this.pinch = d;
        this.draw();
        return;
      }
      const d = this.drag;
      if (!d) return;
      const g = this.toCell(p.x, p.y);
      if (d.t === "pan") { this.ox = d.ox + p.x - d.sx; this.oy = d.oy + p.y - d.sy; }
      else if (d.t === "draw") { d.x1 = Math.floor(g.x); d.y1 = Math.floor(g.y); }
      else if (d.t === "move" || d.t === "resize") {
        const r = this.plan.rooms.find((x) => x.id === d.id)!;
        if (d.t === "move") {
          const nx = Math.round(g.x - d.dx), ny = Math.round(g.y - d.dy);
          if (nx !== r.x || ny !== r.y) d.moved = true;
          r.x = nx; r.y = ny;
        } else {
          const k = KIND_BY_ID[r.kind] ?? KIND_BY_ID.empty;
          r.w = Math.max(k.minW, Math.round(g.x) - r.x);
          r.h = Math.max(k.minH, Math.round(g.y) - r.y);
        }
        this.invalid = this.plan.rooms.some((o) => o.id !== r.id && overlaps(o, r));
      }
      this.draw();
    });
    const end = (e: PointerEvent) => {
      const p = local(e);
      this.pointers.delete(e.pointerId);
      if (this.pointers.size < 2) this.pinch = 0;
      const d = this.drag;
      this.drag = null;
      if (!d) return;
      if (d.t === "draw" && this.mode.t === "place") {
        const k = KIND_BY_ID[this.mode.kind];
        let r = { x: Math.min(d.x0, d.x1), y: Math.min(d.y0, d.y1), w: Math.abs(d.x1 - d.x0) + 1, h: Math.abs(d.y1 - d.y0) + 1 };
        // 只是点了一下：用这种房间的默认大小
        if (r.w === 1 && r.h === 1 && (k.minW > 1 || k.minH > 1 || k.w > 1 || k.h > 1)) r = { x: d.x0, y: d.y0, w: k.w, h: k.h };
        r.w = Math.max(k.minW, r.w); r.h = Math.max(k.minH, r.h);
        if (this.plan.rooms.some((o) => overlaps(o, r))) { this.flash("和别的房间重叠了，换个位置"); this.draw(); return; }
        const room: PlanRoom = { id: planId(), kind: k.id, name: uniqueName(this.plan, k.name), ...r };
        this.plan.rooms.push(room);
        this.sel = room.id;
        this.mode = { t: "select" };
        this.changed();
        return;
      }
      if (d.t === "move" || d.t === "resize") {
        const r = this.plan.rooms.find((x) => x.id === d.id)!;
        if (this.invalid) { Object.assign(r, d.orig); this.flash("和别的房间重叠了"); }
        this.invalid = false;
        this.changed();
        return;
      }
      if (d.t === "tap" && this.mode.t === "door" && Math.hypot(p.x - d.sx, p.y - d.sy) < 8) this.toggleDoor(p.x, p.y);
      this.draw();
    };
    cv.addEventListener("pointerup", end);
    cv.addEventListener("pointercancel", (e) => { this.pointers.delete(e.pointerId); this.drag = null; });
    cv.addEventListener("wheel", (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); this.zoomBy(e.deltaY < 0 ? 1.1 : 0.9, e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  }

  /** 点到的墙边上加门或去门（只能开在房间之间，或者房间朝外的墙上） */
  private toggleDoor(sx: number, sy: number) {
    const g = this.toCell(sx, sy);
    const tx = Math.floor(g.x), ty = Math.floor(g.y);
    const fx = g.x - tx, fy = g.y - ty;
    const opts = [
      { d: fy, k: wkey(tx, ty, "N") }, { d: 1 - fy, k: wkey(tx, ty + 1, "N") },
      { d: fx, k: wkey(tx, ty, "W") }, { d: 1 - fx, k: wkey(tx + 1, ty, "W") },
    ].sort((a, b) => a.d - b.d);
    const k = opts[0].k;
    const valid = new Set<string>();
    const rs = this.plan.rooms;
    for (let i = 0; i < rs.length; i++) {
      for (let j = i + 1; j < rs.length; j++) sharedEdges(rs[i], rs[j]).forEach((e) => valid.add(e));
      if (!KIND_BY_ID[rs[i].kind]?.outdoor) exteriorEdges(this.plan, rs[i]).forEach((e) => valid.add(e.key));
    }
    if (!valid.has(k)) { this.flash("门只能开在房间的墙上"); return; }
    const i = this.plan.doors.indexOf(k);
    if (i >= 0) this.plan.doors.splice(i, 1);
    else this.plan.doors.push(k);
    this.draw();
  }

  private changed() {
    ensureDoors(this.plan);
    this.renderPanel();
    this.draw();
  }

  private apply() {
    if (!this.plan.rooms.some((r) => !KIND_BY_ID[r.kind]?.outdoor)) { this.flash("至少要有一个室内房间"); return; }
    this.confirm("会按这个户型重新生成整个房子，家具按房间类型重新摆放。确定吗？", () => this.onApply(this.plan));
  }

  // ———————————————————— 下方面板 ————————————————————

  private renderPanel() {
    const panel = this.root.querySelector<HTMLElement>("#pl-panel")!;
    const s = this.plan.rooms.find((r) => r.id === this.sel);
    const m = this.mode;
    const hint = m.t === "place" ? `在格子上点一下放下${KIND_BY_ID[m.kind].name}，或者拖出一个范围。`
      : m.t === "door" ? "点房间之间的墙加门，再点一次去掉。如果去掉后有房间走不到，会自动补一扇门。"
      : s ? "拖动房间挪位置，拖右下角的圆点改大小。" : "点下面的房间类型开始拼，点已有的房间可以修改。";
    const selPanel = s ? `<div class="pl-sel">
        <input id="pl-name" value="${esc(s.name)}" maxlength="10" aria-label="房间名" />
        <select id="pl-kind" aria-label="房间类型">${ROOM_KINDS.map((k) => `<option value="${k.id}" ${k.id === s.kind ? "selected" : ""}>${k.name}</option>`).join("")}</select>
        <button class="btn small danger" id="pl-del">删除</button>
        <button class="btn small" id="pl-done">完成</button></div>` : "";
    panel.innerHTML = `${selPanel}
      <div class="chips-row">
        <button class="chip-btn ${m.t === "select" ? "on" : ""}" id="pl-select">选择</button>
        <button class="chip-btn ${m.t === "door" ? "on" : ""}" id="pl-door">门</button>
        ${ROOM_KINDS.map((k) => `<button class="chip-btn kind ${m.t === "place" && m.kind === k.id ? "on" : ""}" data-kind="${k.id}"><i style="background:${k.color}"></i>${k.name}</button>`).join("")}
      </div>
      <p class="hint">${hint}</p>`;
    panel.querySelector<HTMLElement>("#pl-select")!.onclick = () => { this.mode = { t: "select" }; this.renderPanel(); };
    panel.querySelector<HTMLElement>("#pl-door")!.onclick = () => { this.mode = { t: "door" }; this.sel = null; this.renderPanel(); this.draw(); };
    panel.querySelectorAll<HTMLElement>("[data-kind]").forEach((b) => (b.onclick = () => { this.mode = { t: "place", kind: b.dataset.kind! }; this.sel = null; this.renderPanel(); this.draw(); }));
    if (s) {
      const name = panel.querySelector<HTMLInputElement>("#pl-name")!;
      name.onchange = () => { s.name = uniqueName(this.plan, name.value.trim() || KIND_BY_ID[s.kind].name, s.id); name.value = s.name; this.draw(); };
      panel.querySelector<HTMLSelectElement>("#pl-kind")!.onchange = (e) => {
        const old = KIND_BY_ID[s.kind];
        s.kind = (e.target as HTMLSelectElement).value;
        const k = KIND_BY_ID[s.kind];
        if (s.name.startsWith(old.name)) s.name = uniqueName(this.plan, k.name, s.id);
        s.w = Math.max(s.w, k.minW); s.h = Math.max(s.h, k.minH);
        if (this.plan.rooms.some((o) => o.id !== s.id && overlaps(o, s))) { s.kind = old.id; this.flash("换成这个类型会太大，和别的房间重叠"); }
        this.changed();
      };
      panel.querySelector<HTMLElement>("#pl-del")!.onclick = () => { this.plan.rooms = this.plan.rooms.filter((r) => r.id !== s.id); this.sel = null; this.changed(); };
      panel.querySelector<HTMLElement>("#pl-done")!.onclick = () => { this.sel = null; this.renderPanel(); this.draw(); };
    }
  }
}
