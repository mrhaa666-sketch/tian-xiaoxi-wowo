// 入口：组装游戏、AI、画面和界面，处理鼠标/触摸输入和存档。
import { Brain } from "./ai/brain";
import { getNews } from "./ai/news";
import { Game } from "./sim/game";
import { Scene, type Ghost } from "./render/scene";
import type { Character } from "./sim/character";
import type { FurnitureInst } from "./core/types";
import { UI } from "./ui/app";
import { FURNITURE_BY_ID } from "./world/catalog";
import { initSpriteStore } from "./render/spriteStore";
import { initAndroid } from "./platform/android";
import { ROOM_PRESETS, autoWalls, ensureLanding, stampPreset } from "./world/presets";
import { loadCustomHome, loadTagOverrides } from "./world/homepack";
import { autoBackup } from "./core/backup";
import { speak } from "./platform/voice";
import { levelName } from "./world/world";

async function boot() {
  await initSpriteStore();
  // 导入过的自制家具和房间、改过的家具标签，要在读存档之前装好
  loadCustomHome();
  loadTagOverrides();
  const game = Game.load();
  void game.refreshWeather(true);
  game.newsProvider = getNews;
  const brain = new Brain(game);
  const ui = new UI(document.getElementById("app")!, game, brain);
  void ui.loadLocalPacks();
  const scene = new Scene(game);
  scene.insets = () => ui.insets();
  await scene.init(ui.stage);
  ui.onLayout = () => scene.refit();
  ui.onPlanApplied = () => { scene.showAll(); setView(); };
  // 手机竖屏放不下整栋房子的细节：一开始先看第一个角色所在的房间
  const first = game.chars[0];
  if (first && game.world.rooms().includes(first.room)) scene.showRoom(first.room, true);

  const setView = () => { ui.view = scene.view; ui.level = scene.level; ui.renderView(); };
  setView();
  game.onWeather = () => ui.renderTop();
  ui.onLevel = (l) => { scene.showLevel(l); setView(); };
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
  // 安卓版：后台常驻、手机通知（网页版里什么都不做）
  void initAndroid(game, brain, ui);
  brain.onStatus = () => ui.renderTop();
  game.onDiaryDue = (c, day) => { void brain.writeDiary(c, day); };
  // 语音朗读：对主人说的话；选了「全部」时，正在看的房间里、或者选中的人说的话也读
  game.onSay = (c, text, toPlayer) => {
    const mode = game.settings.look.voice ?? "off";
    if (mode === "off") return;
    if (toPlayer || (mode === "all" && game.playerWatching && (scene.selected === c.id || (scene.view.mode === "room" && scene.view.name === c.room)))) speak(text, c.d);
  };

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
        ui.renderLog();
      }
    }
  });

  // ———————————————————— 存档 ————————————————————
  setInterval(() => game.save(), 10_000);
  // 每天自动在本机留一份备份（启动一分钟后，以及之后每小时检查一次）
  setTimeout(() => void autoBackup(game.toSave()), 60_000);
  setInterval(() => void autoBackup(game.toSave()), 3600_000);
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
  // 长按：拎起家具或角色，拖到别处放下；长按家具不动直接松手，弹出删除 / 镜像 / 翻面
  let pressTimer: ReturnType<typeof setTimeout> | null = null;
  const cancelPress = () => { if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; } };
  type Grab =
    | { kind: "furn"; f: FurnitureInst; offX: number; offY: number; x: number; y: number; moved: boolean; sx: number; sy: number }
    | { kind: "char"; c: Character; from: { x: number; y: number } };
  let grab: Grab | null = null;
  const toPhone = (sx: number, sy: number) => {
    const r = canvas.getBoundingClientRect(), pr = ui.els.phone.getBoundingClientRect();
    return { x: sx + r.left - pr.left, y: sy + r.top - pr.top };
  };
  let pressChar: Character | null = null; // 按下那一刻手指下的人（人在走动，等长按生效时可能已经走开了）
  const longPress = (sx: number, sy: number) => {
    pressTimer = null;
    const g = scene.screenToGrid(sx, sy);
    const c = pressChar ?? scene.pickCharacter(sx, sy);
    pressChar = null;
    if (c) {
      grab = { kind: "char", c, from: { ...c.d.pos } };
      c.setPlan([], true);
      c.held = true;
      c.back = false;
      moveGrab(sx, sy); // 人立刻到手指下面
    } else {
      const f = scene.pickFurniture(sx, sy) ?? game.world.furnitureAt(Math.floor(g.x), Math.floor(g.y)) ?? null;
      if (!f) return;
      grab = { kind: "furn", f, offX: Math.floor(g.x) - f.x, offY: Math.floor(g.y) - f.y, x: f.x, y: f.y, moved: false, sx, sy };
      scene.ghost = { kind: "furniture", x: f.x, y: f.y, def: f.def, rot: f.rot, ok: true };
    }
    ui.closeFurnitureMenu();
    if (dragStart) dragStart.moved = true; // 松手时不再当成点击
    paintStart = null;
    navigator.vibrate?.(20);
  };
  const moveGrab = (sx: number, sy: number) => {
    if (!grab) return;
    // 拖到屏幕边上：画面跟着往那边移，手机上也能拖到远处的房间
    const W = scene.app.screen.width, H = scene.app.screen.height, m = 48;
    const ex = sx < m ? m - sx : sx > W - m ? -(sx - (W - m)) : 0;
    const ey = sy < 110 ? 110 - sy : sy > H - 170 ? -(sy - (H - 170)) : 0;
    if (ex || ey) scene.panBy(ex * 0.25, ey * 0.25);
    const g = scene.screenToGrid(sx, sy);
    if (grab.kind === "char") {
      // 人跟着手指走（手指按在头上，脚在下面一点）
      const p = scene.screenToGrid(sx, sy + 40 * scene.zoom);
      grab.c.d.pos = { x: p.x, y: p.y };
      return;
    }
    grab.x = Math.floor(g.x) - grab.offX;
    grab.y = Math.floor(g.y) - grab.offY;
    // 手指抖一下不算拖：真的挪到别的格子才算
    if (grab.x !== grab.f.x || grab.y !== grab.f.y) grab.moved = true;
    const f = grab.f;
    scene.ghost = { kind: "furniture", x: grab.x, y: grab.y, def: f.def, rot: f.rot, ok: game.world.canPlace(f.def, grab.x, grab.y, f.rot, f.uid) };
  };
  const furnitureMenu = (f: FurnitureInst, sx: number, sy: number) => {
    const name = FURNITURE_BY_ID[f.def]?.name ?? "家具";
    const w = game.world;
    const p = toPhone(sx, sy);
    const stopUser = () => { const occ = game.occupantOf(f.uid); if (occ) occ.setPlan([], true); };
    ui.showActionMenu(name, [
      { label: "镜像", note: "左右翻过来", act: () => { f.flip = !f.flip; game.changed(); } },
      { label: "翻面", note: "朝里 / 朝外", act: () => { f.back = !f.back; game.changed(); } },
      { label: "人物图层", note: f.layer === "above" ? "现在：人在前面" : f.layer === "below" ? "现在：人在后面" : "现在：自动", act: () => {
        // 自动 → 人在前 → 人在后 → 自动
        f.layer = f.layer === undefined ? "above" : f.layer === "above" ? "below" : undefined;
        if (!f.layer) delete f.layer;
        ui.flash(f.layer === "above" ? "用这件家具时，人画在家具前面" : f.layer === "below" ? "用这件家具时，人画在家具后面（被挡住一部分）" : "恢复自动");
        game.changed();
      } },
      { label: "转向", note: "横放 / 竖放", act: () => {
        const rot = (f.rot ? 0 : 1) as 0 | 1;
        if (!w.canPlace(f.def, f.x, f.y, rot, f.uid)) { ui.flash("这里转不开"); return; }
        stopUser(); f.rot = rot; w.rebuildIndex(); game.changed();
      } },
      { label: "删除", danger: true, act: () => ui.confirm(`要把这件${name}删掉吗？`, () => {
        stopUser();
        w.removeFurniture(f.uid);
        game.log("player", `删掉了${name}`);
        game.changed();
        ui.flash(`删掉了${name}`);
      }) },
    ], p.x, p.y);
  };
  const dropGrab = (sx: number, sy: number, cancelled = false) => {
    const gr = grab;
    grab = null;
    if (!gr) return;
    const w = game.world;
    if (gr.kind === "char") {
      const c = gr.c;
      c.held = false;
      const t = { x: Math.floor(c.d.pos.x), y: Math.floor(c.d.pos.y) };
      if (cancelled || !w.walkable(t.x, t.y)) {
        c.d.pos = gr.from;
        if (!cancelled) ui.flash("那里放不下人");
        return;
      }
      c.d.pos = { x: t.x + 0.5, y: t.y + 0.5 };
      navigator.vibrate?.(10);
      const room = w.roomOf(c.d.pos.x, c.d.pos.y);
      const fromRoom = w.roomOf(gr.from.x, gr.from.y);
      if (Math.hypot(c.d.pos.x - gr.from.x, c.d.pos.y - gr.from.y) > 1) {
        game.emit(c, room && room !== fromRoom ? `主人把你直接抱到了${room}。` : `主人把你挪了个位置。`, 2);
        game.log("player", `把${c.name}抱到了${room || "别处"}`);
      }
      game.changed();
      return;
    }
    scene.ghost = null;
    const f = gr.f;
    if (cancelled) return;
    // 没拖动，或者拖了一圈又放回原处：弹菜单（删除在这里）
    if (!gr.moved || (gr.x === f.x && gr.y === f.y)) { furnitureMenu(f, sx, sy); return; }
    if (!w.canPlace(f.def, gr.x, gr.y, f.rot, f.uid)) { ui.flash("那里放不下"); return; }
    const occ = game.occupantOf(f.uid);
    if (occ) occ.setPlan([], true); // 正在用的人先停下
    f.x = gr.x; f.y = gr.y;
    w.rebuildIndex();
    ensureLanding(w, f);
    navigator.vibrate?.(10);
    game.log("player", `把${FURNITURE_BY_ID[f.def]?.name ?? "家具"}挪了个地方`);
    game.changed();
  };

  let lastTap: { t: number; x: number; y: number } | null = null;
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
    } else if (b.tool === "turn" || b.tool === "mirror") {
      const f = w.furnitureAt(tx, ty);
      if (f) gh = { kind: "furniture", x: f.x, y: f.y, def: f.def, rot: f.rot, ok: true };
    } else if (b.tool === "erase") {
      const f = w.furnitureAt(tx, ty);
      if (f) {
        gh = { kind: "furniture", x: f.x, y: f.y, def: f.def, rot: f.rot, ok: false };
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
      const f = w.addFurniture(b.furniture, tx, ty, b.rot);
      if (!f) return;
      // 楼梯：楼上同一个位置自动铺好楼梯口
      if (ensureLanding(w, f)) ui.flash(`${levelName(game.world.levels().slice(-1)[0])}出现了楼梯口，点上方的楼层按钮可以上去接着盖`);
    } else if (b.tool === "turn") {
      const f = w.furnitureAt(tx, ty);
      if (f) f.back = !f.back;
    } else if (b.tool === "mirror") {
      const f = w.furnitureAt(tx, ty);
      if (f) f.flip = !f.flip;
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
      cancelPress();
      dropGrab(0, 0, true);
      dragStart = null;
      paintStart = null;
      return;
    }
    dragStart = { ...p, moved: false, button: e.button };
    cancelPress();
    if (e.button === 0) {
      pressChar = scene.pickCharacter(p.x, p.y);
      pressTimer = setTimeout(() => longPress(p.x, p.y), 550);
    }
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
    if (grab) { if (prev) moveGrab(p.x, p.y); return; }
    if (dragStart && prev) {
      const far = Math.hypot(p.x - dragStart.x, p.y - dragStart.y) > (e.pointerType === "touch" ? 10 : 6);
      const panning = !ui.build.on || dragStart.button !== 0 || (ui.build.tool !== "floor");
      if (far) cancelPress();
      if (far && panning) {
        dragStart.moved = true;
        scene.panBy(p.x - prev.x, p.y - prev.y);
      }
    }
    updateGhost(p.x, p.y);
  });
  const end = (e: PointerEvent) => {
    cancelPress();
    const p = local(e);
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    const ds = dragStart;
    dragStart = null;
    if (grab) { dropGrab(p.x, p.y); return; }
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
    // 点到猫：蹭你一下
    const pet = !c && !ui.build.on ? scene.pickPet(p.x, p.y) : null;
    if (pet) {
      pet.showEmote(pet.asleep ? "💤" : "💕", 3);
      ui.flash(pet.asleep ? `${pet.d.name}睡得正香，轻轻摸了摸它` : pet.d.hunger < 40 ? `${pet.d.name}喵喵叫，好像饿了` : `${pet.d.name}蹭了蹭你的手`);
      navigator.vibrate?.(8);
      return;
    }
    // 手机上双击空地：进入那个房间（电脑上有 dblclick）
    if (!c && e.pointerType === "touch") {
      const now = performance.now();
      if (lastTap && now - lastTap.t < 320 && Math.hypot(p.x - lastTap.x, p.y - lastTap.y) < 30) {
        lastTap = null;
        const g = scene.screenToGrid(p.x, p.y);
        const room = game.world.tile(Math.floor(g.x), Math.floor(g.y))?.room;
        if (room) { scene.showRoom(room); setView(); return; }
      }
      lastTap = { t: now, x: p.x, y: p.y };
    }
    // 已经选中了一个角色、这次点的是家具：弹出这件家具能做的事，安排 TA 去做
    if (!c && ui.selected) {
      const f = scene.pickFurniture(p.x, p.y);
      const who = game.byId(ui.selected);
      if (f && who) {
        const r = canvas.getBoundingClientRect(), pr = ui.els.phone.getBoundingClientRect();
        if (ui.showFurnitureMenu(who, f.uid, p.x + r.left - pr.left, p.y + r.top - pr.top)) return;
      }
    }
    ui.select(c ? c.id : null);
  };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", (e) => { cancelPress(); dropGrab(0, 0, true); pointers.delete(e.pointerId); dragStart = null; paintStart = null; });
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
