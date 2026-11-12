// 入口：组装游戏、AI、画面和界面，处理鼠标/触摸输入和存档。
import { Brain } from "./ai/brain";
import { getNews } from "./ai/news";
import { Game } from "./sim/game";
import { Scene, type Ghost } from "./render/scene";
import { UI } from "./ui/app";
import { FURNITURE_BY_ID } from "./world/catalog";
import { ROOM_PRESETS, autoWalls, stampPreset } from "./world/presets";

async function boot() {
  const game = Game.load();
  game.newsProvider = getNews;
  const brain = new Brain(game);
  const ui = new UI(document.getElementById("app")!, game, brain);
  const scene = new Scene(game);
  await scene.init(ui.stage);

  const setView = () => { ui.view = scene.view; ui.renderView(); };
  ui.onView = (v) => {
    if (v.mode === "all") scene.showAll();
    else if (v.mode === "room") scene.showRoom(v.name);
    else scene.stepRoom(v.dir);
    setView();
  };
  ui.onSelect = (id) => {
    scene.selected = id;
    // 单间模式下选中角色：跳到 TA 所在的房间；全景模式下重新排版给详情面板让位
    const c = id ? game.byId(id) : null;
    if (scene.view.mode === "room" && c && game.world.rooms().includes(c.room)) scene.showRoom(c.room);
    else scene.refit();
    setView();
  };
  window.addEventListener("resize", () => setTimeout(() => scene.refit(true), 50));
  ui.onSettingsChanged = () => brain.reconfigure();
  brain.onStatus = () => ui.renderTop();

  // 日志和列表变化时节流刷新界面
  let dirty = false;
  game.onChange(() => (dirty = true));

  // ———————————————————— 主循环 ————————————————————
  let last = performance.now();
  let uiAcc = 0;
  scene.app.ticker.add(() => {
    const now = performance.now();
    const dt = Math.min(0.25, (now - last) / 1000);
    last = now;
    game.tick(dt);
    brain.tick();
    scene.update(now / 1000);
    // 单间模式下，选中的角色走到别的房间时镜头跟过去
    if (scene.view.mode === "room" && scene.selected) {
      const c = game.byId(scene.selected);
      if (c && !c.moving && c.room !== scene.view.name && game.world.rooms().includes(c.room)) { scene.showRoom(c.room); setView(); }
    }
    uiAcc += dt;
    if (uiAcc > 0.5) {
      uiAcc = 0;
      ui.renderTop();
      ui.renderDetail(true);
      if (dirty) {
        dirty = false;
        ui.renderRoster();
        ui.renderView();
        if (!ui.build.on) ui.renderLog();
      }
    }
  });

  // ———————————————————— 存档 ————————————————————
  setInterval(() => game.save(), 10_000);
  document.addEventListener("visibilitychange", () => {
    game.playerWatching = document.visibilityState === "visible";
    if (!game.playerWatching) game.save();
    last = performance.now();
  });
  window.addEventListener("beforeunload", () => game.save());

  // ———————————————————— 输入 ————————————————————
  const canvas = scene.app.canvas;
  const pointers = new Map<number, { x: number; y: number }>();
  let dragStart: { x: number; y: number; moved: boolean; button: number } | null = null;
  let paintStart: { x: number; y: number } | null = null;
  let pinchDist = 0;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** 鼠标指向的格子和最近的边 */
  const hoverInfo = (sx: number, sy: number) => {
    const g = scene.screenToGrid(sx, sy);
    const tx = Math.floor(g.x), ty = Math.floor(g.y);
    const fx = g.x - tx, fy = g.y - ty;
    const opts = [
      { d: fy, x: tx, y: ty, dir: "N" as const },
      { d: 1 - fy, x: tx, y: ty + 1, dir: "N" as const },
      { d: fx, x: tx, y: ty, dir: "W" as const },
      { d: 1 - fx, x: tx + 1, y: ty, dir: "W" as const },
    ].sort((a, b) => a.d - b.d);
    return { tx, ty, edge: opts[0] };
  };

  const updateGhost = (sx: number, sy: number) => {
    const b = ui.build;
    if (!b.on) { scene.ghost = null; return; }
    const { tx, ty, edge } = hoverInfo(sx, sy);
    const w = game.world;
    let gh: Ghost | null = null;
    if (b.tool === "floor") {
      if (paintStart) {
        const x0 = Math.min(paintStart.x, tx), y0 = Math.min(paintStart.y, ty);
        gh = { kind: "rect", x: x0, y: y0, w: Math.abs(tx - paintStart.x) + 1, h: Math.abs(ty - paintStart.y) + 1, ok: true };
      } else gh = { kind: "tile", x: tx, y: ty, ok: true };
    } else if (b.tool === "wall" || b.tool === "door" || b.tool === "window") {
      gh = { kind: "edge", x: edge.x, y: edge.y, dir: edge.dir, ok: true };
    } else if (b.tool === "furniture") {
      gh = { kind: "furniture", x: tx, y: ty, def: b.furniture, rot: b.rot, ok: w.canPlace(b.furniture, tx, ty, b.rot) };
    } else if (b.tool === "room") {
      const p = ROOM_PRESETS.find((r) => r.id === b.room)!;
      gh = { kind: "rect", x: tx, y: ty, w: p.w, h: p.h, ok: true };
    } else if (b.tool === "erase") {
      const f = w.furnitureAt(tx, ty);
      if (f) {
        const def = FURNITURE_BY_ID[f.def];
        gh = { kind: "furniture", x: f.x, y: f.y, def: f.def, rot: f.rot, ok: false };
        void def;
      } else if (edge.d < 0.2 && w.wall(edge.x, edge.y, edge.dir)) gh = { kind: "edge", x: edge.x, y: edge.y, dir: edge.dir, ok: false };
      else gh = { kind: "tile", x: tx, y: ty, ok: !w.tile(tx, ty) };
    }
    scene.ghost = gh;
  };

  const applyBuild = (sx: number, sy: number) => {
    const b = ui.build;
    const w = game.world;
    const { tx, ty, edge } = hoverInfo(sx, sy);
    if (b.tool === "wall" || b.tool === "door" || b.tool === "window") {
      const cur = w.wall(edge.x, edge.y, edge.dir);
      const kind = b.tool;
      if (cur && cur.kind === kind) w.setWall(edge.x, edge.y, edge.dir, null);
      else w.setWall(edge.x, edge.y, edge.dir, { kind, style: b.wallStyle });
    } else if (b.tool === "furniture") {
      if (!w.addFurniture(b.furniture, tx, ty, b.rot)) return;
    } else if (b.tool === "room") {
      const p = ROOM_PRESETS.find((r) => r.id === b.room)!;
      const name = stampPreset(w, p, tx, ty);
      game.log("player", `盖了一间${name}`);
      for (const c of game.chars) game.emit(c, `主人在家里新盖了一间${name}。`, 1);
    } else if (b.tool === "erase") {
      const f = w.furnitureAt(tx, ty);
      if (f) {
        const user = game.occupantOf(f.uid);
        if (user) user.stopCurrent();
        w.removeFurniture(f.uid);
      } else if (edge.d < 0.2 && w.wall(edge.x, edge.y, edge.dir)) w.setWall(edge.x, edge.y, edge.dir, null);
      else if (!game.chars.some((c) => c.tile.x === tx && c.tile.y === ty)) w.setFloor(tx, ty, null);
    }
    game.changed();
  };

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  // 双击房间：进入单间
  canvas.addEventListener("dblclick", (e) => {
    if (ui.build.on) return;
    const r = canvas.getBoundingClientRect();
    const g = scene.screenToGrid(e.clientX - r.left, e.clientY - r.top);
    const room = game.world.tile(Math.floor(g.x), Math.floor(g.y))?.room;
    if (room) { scene.showRoom(room); setView(); }
  });
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      dragStart = null;
      paintStart = null;
      return;
    }
    dragStart = { ...p, moved: false, button: e.button };
    if (ui.build.on && e.button === 0 && ui.build.tool === "floor") {
      const { tx, ty } = hoverInfo(p.x, p.y);
      paintStart = { x: tx, y: ty };
    }
  });
  canvas.addEventListener("pointermove", (e) => {
    const p = local(e);
    const prev = pointers.get(e.pointerId);
    if (pointers.size === 2 && prev) {
      pointers.set(e.pointerId, p);
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) scene.zoomAt(d / pinchDist, (a.x + b.x) / 2, (a.y + b.y) / 2);
      scene.panBy((p.x - prev.x) / 2, (p.y - prev.y) / 2);
      pinchDist = d;
      return;
    }
    if (prev) pointers.set(e.pointerId, p);
    if (dragStart && prev) {
      const far = Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > 6;
      const panning = !ui.build.on || dragStart.button !== 0 || (ui.build.tool !== "floor");
      if (far && panning) {
        dragStart.moved = true;
        scene.panBy(p.x - prev.x, p.y - prev.y);
      }
    }
    updateGhost(p.x, p.y);
  });
  const end = (e: PointerEvent) => {
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    const ds = dragStart;
    dragStart = null;
    if (ui.build.on && paintStart && e.button === 0) {
      const { tx, ty } = hoverInfo(p.x, p.y);
      const x0 = Math.min(paintStart.x, tx), y0 = Math.min(paintStart.y, ty);
      const x1 = Math.max(paintStart.x, tx), y1 = Math.max(paintStart.y, ty);
      paintStart = null;
      if ((x1 - x0 + 1) * (y1 - y0 + 1) <= 400) {
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) game.world.setFloor(x, y, ui.build.floor, ui.build.roomName);
        if (ui.build.autoWalls) autoWalls(game.world, x0, y0, x1 - x0 + 1, y1 - y0 + 1, ui.build.wallStyle);
        game.changed();
      }
      updateGhost(p.x, p.y);
      return;
    }
    if (!ds || ds.moved || ds.button !== 0) return;
    if (ui.build.on) {
      applyBuild(p.x, p.y);
      updateGhost(p.x, p.y);
      return;
    }
    const c = scene.pickCharacter(p.x, p.y);
    ui.select(c ? c.id : null);
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); dragStart = null; paintStart = null; });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = local(e);
    scene.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, p.x, p.y);
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    if (e.key === "r" || e.key === "R") ui.build.rot = ui.build.rot ? 0 : 1;
    if (!ui.build.on && (e.key === "ArrowLeft" || e.key === "ArrowRight")) { scene.stepRoom(e.key === "ArrowLeft" ? -1 : 1); setView(); }
    if (e.key === "Escape") { if (ui.build.on) { ui.build.on = false; ui.renderBuild(); } else ui.select(null); }
  });

  // 方便在浏览器控制台里调试
  (window as unknown as { wowo: unknown }).wowo = { game, brain, scene, ui };
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="padding:20px;white-space:pre-wrap">游戏启动失败：${String(e)}</pre>`;
});
