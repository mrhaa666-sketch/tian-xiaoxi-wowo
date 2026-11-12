// 入口：组装游戏、AI、画面和界面，处理鼠标/触摸输入和存档。
import { Brain } from "./ai/brain";
import { getNews } from "./ai/news";
import { Game } from "./sim/game";
import { Scene, type Ghost } from "./render/scene";
import { UI } from "./ui/app";
import { ROOM_TYPE_BY_ID } from "./world/catalog";

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
    else if (v.mode === "room") scene.showRoom(v.uid);
    else scene.stepRoom(v.dir);
    setView();
  };
  ui.onSelect = (id) => {
    scene.selected = id;
    // 单间模式下选中角色：跳到 TA 所在的房间；全景模式下重新排版给详情面板让位
    const c = id ? game.byId(id) : null;
    const r = c ? game.world.roomOfPos(c.d.pos) : null;
    if (scene.view.mode === "room" && r) scene.showRoom(r.uid);
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
    // 单间模式下，选中的角色走去别的房间时镜头跟过去
    if (scene.view.mode === "room" && scene.selected) {
      const c = game.byId(scene.selected);
      const r = c && !c.moving ? game.world.roomOfPos(c.d.pos) : null;
      if (r && r.uid !== scene.view.uid) { scene.showRoom(r.uid); setView(); }
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
  let dragging: string | null = null; // 正在拖动的家具
  let pinchDist = 0;

  const local = (e: PointerEvent | WheelEvent) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  /** 鼠标在房间里对应的立牌摆放位置 */
  const placeAt = (sx: number, sy: number) => {
    const hit = scene.pickRoom(sx, sy);
    if (!hit) return null;
    return { room: hit.room, x: hit.x, z: Math.max(0.04, Math.min(0.92, hit.onWall ? 0.05 : hit.z)) };
  };

  const updateGhost = (sx: number, sy: number) => {
    const b = ui.build;
    const w = game.world;
    let gh: Ghost | null = null;
    if (b.on) {
      if (b.tool === "room") {
        const { gx, gy } = scene.cellAt(sx, sy);
        const t = ROOM_TYPE_BY_ID[b.room];
        gh = { kind: "room", gx, gy, w: t.w, ok: w.canPlaceRoom(gx, gy, t.w) };
      } else if (b.tool === "furniture" || (b.tool === "move" && dragging)) {
        const p = placeAt(sx, sy);
        const def = dragging ? w.getFurniture(dragging)?.def : b.furniture;
        if (p && def) gh = { kind: "furniture", room: p.room.uid, x: p.x, z: p.z, def, ok: w.canPlaceFurniture(def, p.room.uid, p.x, p.z) };
      } else if (b.tool === "move" || b.tool === "erase") {
        const f = scene.pickFurniture(sx, sy);
        if (f) gh = { kind: "highlight-furniture", uid: f.uid };
        else if (b.tool === "erase") {
          const r = scene.pickRoom(sx, sy)?.room;
          if (r) gh = { kind: "highlight-room", uid: r.uid, ok: canRemove(r.uid) };
        }
      } else if (b.tool === "edit") {
        const r = scene.pickRoom(sx, sy)?.room;
        if (r) gh = { kind: "highlight-room", uid: r.uid, ok: true };
      }
    }
    scene.ghost = gh;
  };

  const canRemove = (roomUid: string) => {
    const r = game.world.getRoom(roomUid);
    if (!r || !game.world.canRemoveRoom(r)) return false;
    return !game.chars.some((c) => game.world.roomOfPos(c.d.pos) === r);
  };

  const applyBuild = (sx: number, sy: number) => {
    const b = ui.build;
    const w = game.world;
    if (b.tool === "room") {
      const { gx, gy } = scene.cellAt(sx, sy);
      const r = w.addRoom(b.room, gx, gy);
      if (r) {
        game.log("player", `盖了一间${r.name}`);
        for (const c of game.chars) game.emit(c, `主人在家里新盖了一间${r.name}。`, 1);
      }
    } else if (b.tool === "furniture") {
      const p = placeAt(sx, sy);
      if (p) w.addFurniture(b.furniture, p.room.uid, p.x, p.z);
    } else if (b.tool === "edit") {
      const r = scene.pickRoom(sx, sy)?.room;
      if (r) ui.openRoomEditor(r);
    } else if (b.tool === "erase") {
      const f = scene.pickFurniture(sx, sy);
      if (f) {
        game.occupantOf(f.uid)?.stopCurrent();
        w.removeFurniture(f.uid);
      } else {
        const r = scene.pickRoom(sx, sy)?.room;
        if (r && canRemove(r.uid)) {
          w.removeRoom(r.uid);
          game.log("player", `拆掉了${r.name}`);
        }
      }
    }
    game.changed();
  };

  canvas.addEventListener("contextmenu", (e) => e.preventDefault());
  // 全景里双击房间：进入单间
  canvas.addEventListener("dblclick", (e) => {
    if (ui.build.on) return;
    const p = local(e as unknown as PointerEvent);
    const r = scene.pickRoom(p.x, p.y)?.room;
    if (r) { scene.showRoom(r.uid); setView(); }
  });
  canvas.addEventListener("pointerdown", (e) => {
    canvas.setPointerCapture(e.pointerId);
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      dragStart = null;
      dragging = null;
      return;
    }
    dragStart = { ...p, moved: false, button: e.button };
    if (ui.build.on && ui.build.tool === "move" && e.button === 0) {
      const f = scene.pickFurniture(p.x, p.y);
      if (f) {
        dragging = f.uid;
        game.occupantOf(f.uid)?.stopCurrent();
      }
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
    if (dragStart && prev && !dragging && Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > 6) {
      dragStart.moved = true;
      scene.panBy(p.x - prev.x, p.y - prev.y);
    }
    updateGhost(p.x, p.y);
  });
  const end = (e: PointerEvent) => {
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    const ds = dragStart;
    dragStart = null;
    if (dragging) {
      const f = game.world.getFurniture(dragging);
      const at = placeAt(p.x, p.y);
      if (f && at && game.world.canPlaceFurniture(f.def, at.room.uid, at.x, at.z)) {
        f.room = at.room.uid;
        f.x = at.x;
        f.z = at.z;
        game.world.version++;
        game.changed();
      }
      dragging = null;
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
  canvas.addEventListener("pointercancel", (e) => { pointers.delete(e.pointerId); dragStart = null; dragging = null; });
  canvas.addEventListener("wheel", (e) => {
    e.preventDefault();
    const p = local(e);
    scene.zoomAt(e.deltaY < 0 ? 1.1 : 1 / 1.1, p.x, p.y);
  }, { passive: false });
  window.addEventListener("keydown", (e) => {
    if ((e.target as HTMLElement).closest("input, textarea, select")) return;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") { scene.stepRoom(e.key === "ArrowLeft" ? -1 : 1); setView(); }
    if (e.key === "Escape") { if (ui.build.on) { ui.build.on = false; ui.renderBuild(); scene.ghost = null; } else ui.select(null); }
  });

  // 方便在浏览器控制台里调试
  (window as unknown as { wowo: unknown }).wowo = { game, brain, scene, ui };
}

boot().catch((e) => {
  console.error(e);
  document.body.innerHTML = `<pre style="padding:20px;white-space:pre-wrap">游戏启动失败：${String(e)}</pre>`;
});
