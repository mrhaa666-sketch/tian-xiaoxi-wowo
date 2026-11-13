// 手机界面：竖屏。顶部状态栏 + 视角切换，中间是房子，底部是角色头像条和导航栏。
// 角色详情、建造、动态从底部弹出（抽屉）；聊天、设置、编辑角色是全屏页面。
// 电脑上运行时，整个游戏显示在屏幕中央一个手机大小的框里。
import type { Brain } from "../ai/brain";
import { WEATHER_CN, type WeatherKind } from "../core/types";
import { geocode, locate, weatherLine, FEELING_CN, feeling } from "../sim/climate";
import { CHRONOTYPE_CN, EMOTION_CN, NEED_CN, SICK_CN, type Lore, NEED_ORDER, SKILL_CN, TRAIT_CN, type CharacterData, type Needs, type Skills, type Traits } from "../core/types";
import { describeNow, hhmm } from "../core/time";
import type { Character } from "../sim/character";
import { PERSONA_TEMPLATE, SCHEDULE_TEMPLATE, defaultSettings, newCharacter, randomAppearance } from "../sim/defaults";
import { Game } from "../sim/game";
import { FLOORS, FOODS, FURNITURE, FURNITURE_BY_ID, WALL_STYLES } from "../world/catalog";
import { ROOM_PRESETS } from "../world/presets";
import { levelName } from "../world/world";
import { assetUrl } from "../render/assets";
import { customFurniture, customRooms, exportFurniturePack, exportRoom, importHomePack, removeCustomFurniture, removeCustomRoom, setFurnitureTags } from "../world/homepack";
import { TAG_GROUPS } from "../world/tags";
import { applyPlan, planFromWorld, type Plan } from "../world/floorplan";
import { Planner } from "./planner";
import { scoreOptions } from "../sim/autonomy";
import { cleanEntry, exportPack, importPack, type PackCharacter } from "../sim/pack";
import { processUpload, type UploadResult } from "../render/upload";
import { saveSprites, spriteUrl } from "../render/spriteStore";
import type { PermissionApi } from "../platform/android";
import { currentHour, daylightAt } from "../render/daylight";
import { clearLog, formatLog } from "../core/log";

const PALETTES: [string, string, string][] = [
  ["pink", "樱花粉", "#e8789a"], ["purple", "薰衣草紫", "#9a7ae0"], ["blue", "天空蓝", "#5f9ee8"],
  ["green", "薄荷绿", "#4fb592"], ["orange", "蜜桃橙", "#ee9a5a"], ["berry", "莓果红", "#d2557a"],
];
import { DEEPSEEK_BASE } from "../ai/provider";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const NEED_COLORS: Record<keyof Needs, string> = {
  hunger: "#f08a6c", energy: "#6b9bf2", bladder: "#e3b23c", hygiene: "#4fc1c9", fun: "#f28ab8",
  social: "#c08ae0", comfort: "#8fb86b", mood: "#f2c14e", health: "#5cc58a",
};

const hexColor = (n: number) => "#" + n.toString(16).padStart(6, "0");
const asset = (kind: string, name: string) => `${import.meta.env.BASE_URL}assets/${kind}/${name}.png`;

// 简单的线条图标
const ICONS: Record<string, string> = {
  home: '<path d="M4 11.5 12 5l8 6.5V20a1 1 0 0 1-1 1h-4.5v-5.5h-5V21H5a1 1 0 0 1-1-1z"/>',
  people: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19.5c.6-3.3 2.8-5 5.5-5s4.9 1.7 5.5 5"/><circle cx="17" cy="9.5" r="2.4"/><path d="M15.8 14.6c2.3.1 4 1.6 4.6 4.4"/>',
  build: '<path d="M14.5 5.5 18.5 9.5 9 19H5v-4z"/><path d="m12.5 7.5 4 4"/>',
  feed: '<path d="M5 6h14M5 11h14M5 16h9"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
  close: '<path d="M6 6l12 12M18 6 6 18"/>',
  chat: '<path d="M5 6h14v9H10l-4 3.5V15H5z"/>',
  send: '<path d="M4 12 20 5l-4 15-4-6z"/>',
  left: '<path d="M14 6l-6 6 6 6"/>',
  right: '<path d="M10 6l6 6-6 6"/>',
  grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
};
const icon = (name: string) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;

export type BuildTool = "floor" | "wall" | "door" | "window" | "furniture" | "turn" | "mirror" | "room" | "erase";

export interface BuildState {
  on: boolean;
  tool: BuildTool;
  floor: string;
  wallStyle: string;
  furniture: string;
  room: string;
  roomName: string;
  rot: 0 | 1;
  autoWalls: boolean;
}

type Sheet = null | "people" | "detail" | "build" | "feed";

export class UI {
  root: HTMLElement;
  stage: HTMLElement;
  selected: string | null = null;
  tab: "status" | "profile" | "relations" | "memory" = "status";
  build: BuildState = { on: false, tool: "furniture", floor: "wood", wallStyle: "cream", furniture: "sofa", room: "bedroom", roomName: "新房间", rot: 0, autoWalls: true };
  furnCat = "卧室";
  sheet: Sheet = null;
  sheetFull = false;
  chatOpen: string | null = null;
  private typing = new Set<string>();
  els: Record<string, HTMLElement> = {};
  onSelect?: (id: string | null) => void;
  /** 视角切换：全景、某个房间、前后切换 */
  /** 现在看的楼层，切换楼层 */
  level = 0;
  onLevel?: (level: number) => void;
  onView?: (v: { mode: "all" } | { mode: "room"; name: string } | { mode: "step"; dir: 1 | -1 }) => void;
  view: { mode: "all" } | { mode: "room"; name: string } = { mode: "all" };
  onSettingsChanged?: () => void;
  /** 安卓版：设置保存后（开关后台常驻） */
  onSettingsSaved?: () => void;
  /** 安卓版：请求不被省电策略限制，返回是否已允许 */
  requestBatteryExemption?: () => Promise<boolean>;
  /** 安卓版：后台权限的检查和申请 */
  permissions?: PermissionApi;
  /** 后台权限引导页打开时，回到应用后刷新状态 */
  refreshPermissionGuide?: () => void;
  /** 底部抽屉打开/关闭后，画面要重新排版 */
  onLayout?: () => void;
  /** 户型应用到房子之后 */
  onPlanApplied?: () => void;

  constructor(host: HTMLElement, private game: Game, private brain: Brain) {
    this.root = host;
    host.innerHTML = `
      <div class="phone" id="phone">
        <div id="stage"></div>
        <header class="statusbar">
          <div class="clock"><b id="time"></b><span id="date"></span></div>
          <div class="chips" id="chips"></div>
        </header>
        <div class="viewpill" id="viewbar">
          <button class="pill-btn" id="v-all" aria-label="看整栋房子">${icon("grid")}<span>全景</span></button>
          <button class="pill-btn round" id="v-prev" aria-label="上一个房间">${icon("left")}</button>
          <select id="v-room" aria-label="选择房间"></select>
          <button class="pill-btn round" id="v-next" aria-label="下一个房间">${icon("right")}</button>
          <button class="pill-btn round lv" id="v-level" aria-label="切换楼层" hidden>1F</button>
          <button class="pill-btn round" id="v-names" aria-label="显示名字">名</button>
        </div>
        <div class="dock" id="dock">
          <div class="avatars" id="roster"></div>
          <nav class="tabbar" id="tabbar">
            <button data-nav="home">${icon("home")}<span>小窝</span></button>
            <button data-nav="people">${icon("people")}<span>角色</span></button>
            <button data-nav="build">${icon("build")}<span>建造</span></button>
            <button data-nav="feed">${icon("feed")}<span>动态</span><i class="dot" id="feed-dot" hidden></i></button>
            <button data-nav="settings">${icon("gear")}<span>设置</span></button>
          </nav>
        </div>
        <section class="sheet" id="sheet" hidden>
          <button class="grab" id="grab" aria-label="展开或收起"><i></i></button>
          <div class="sheet-body" id="sheet-body"></div>
        </section>
        <div id="toast-host"></div>
        <div id="page-host"></div>
      </div>`;
    for (const id of ["phone", "stage", "time", "date", "chips", "viewbar", "roster", "dock", "tabbar", "sheet", "sheet-body", "grab", "toast-host", "page-host", "feed-dot"]) {
      this.els[id] = host.querySelector("#" + id)! as HTMLElement;
    }
    this.stage = this.els.stage;

    const vb = this.els.viewbar;
    vb.querySelector<HTMLElement>("#v-all")!.onclick = () => this.onView?.({ mode: "all" });
    vb.querySelector<HTMLElement>("#v-prev")!.onclick = () => this.onView?.({ mode: "step", dir: -1 });
    vb.querySelector<HTMLElement>("#v-next")!.onclick = () => this.onView?.({ mode: "step", dir: 1 });
    vb.querySelector<HTMLElement>("#v-names")!.onclick = () => {
      // 名字：不显示 → 只显示选中的 → 全部显示
      const lk = this.game.settings.look;
      lk.names = lk.names === "none" ? "selected" : lk.names === "selected" ? "all" : "none";
      this.flash({ none: "不显示名字", selected: "只显示选中的人的名字", all: "显示所有人的名字" }[lk.names]);
      this.renderView();
      this.game.save();
    };
    vb.querySelector<HTMLElement>("#v-level")!.onclick = (e) => {
      const lv = this.game.world.levels();
      const top = lv[lv.length - 1];
      const pr = this.els.phone.getBoundingClientRect();
      const ev = e as MouseEvent;
      this.showActionMenu("去几楼", [
        ...lv.slice().reverse().map((l) => ({ label: levelName(l), note: l === this.level ? "现在在这层" : `${this.game.world.rooms(l).length} 个房间`, act: () => this.onLevel?.(l) })),
        ...(this.build.on ? [{ label: `盖${levelName(top + 1)}`, note: "先切过去，再铺地板或放房间", act: () => this.onLevel?.(top + 1) }] : []),
      ], ev.clientX - pr.left, ev.clientY - pr.top + 160);
    };
    const sel = vb.querySelector<HTMLSelectElement>("#v-room")!;
    sel.onchange = () => (sel.value ? this.onView?.({ mode: "room", name: sel.value }) : this.onView?.({ mode: "all" }));

    this.els.tabbar.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) => (b.onclick = () => this.nav(b.dataset.nav!)));
    this.els.grab.onclick = () => { this.sheetFull = !this.sheetFull; this.layoutSheet(); };
    game.onPlayerMessage((c, text) => this.toast(c, text));
    // 外观：配色、深色模式、跟着时间变化
    this.applyLook();
    setInterval(() => this.applyLook(), 60_000);
    window.matchMedia?.("(prefers-color-scheme: dark)").addEventListener?.("change", () => this.applyLook());
    this.renderAll();
  }

  // ———————————————————— 导航和抽屉 ————————————————————

  private nav(to: string) {
    if (to === "home") { this.closeSheet(); this.onView?.({ mode: "all" }); return; }
    if (to === "settings") { this.openSettings(); return; }
    if (to === "build") { this.build.on = this.sheet !== "build"; this.openSheet(this.build.on ? "build" : null); return; }
    const s = to as Sheet;
    this.openSheet(this.sheet === s ? null : s);
  }

  openSheet(s: Sheet) {
    if (this.sheet === "build" && s !== "build") this.build.on = false;
    if (s === "build") this.build.on = true;
    this.sheet = s;
    this.sheetFull = false;
    this.renderSheet();
    this.renderView();
  }

  closeSheet() {
    this.openSheet(null);
  }

  private layoutSheet() {
    const sh = this.els.sheet;
    sh.hidden = !this.sheet;
    sh.className = `sheet sheet-${this.sheet ?? "none"}${this.sheetFull ? " full" : ""}`;
    this.els.tabbar.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) => {
      const n = b.dataset.nav;
      const on = (n === "people" && (this.sheet === "people" || this.sheet === "detail")) || n === this.sheet;
      b.classList.toggle("on", on);
    });
    this.els.dock.classList.toggle("covered", !!this.sheet);
    requestAnimationFrame(() => this.onLayout?.());
  }

  /** 画面上被界面挡住的部分（给镜头排版用） */
  insets() {
    const phone = this.els.phone.getBoundingClientRect();
    const top = this.els.viewbar.getBoundingClientRect().bottom - phone.top + 6;
    const sheet = this.els.sheet;
    const coverTop = !sheet.hidden ? sheet.getBoundingClientRect().top : this.els.dock.getBoundingClientRect().top;
    return { top, bottom: phone.bottom - coverTop + 6, left: 8, right: 8 };
  }

  renderSheet() {
    this.layoutSheet();
    const body = this.els["sheet-body"];
    if (this.sheet === "people") this.renderPeople(body);
    else if (this.sheet === "detail") this.renderDetail();
    else if (this.sheet === "build") this.renderBuild();
    else if (this.sheet === "feed") this.renderLog();
    else body.innerHTML = "";
  }

  /** 让角色去用某件家具（做完提示一句） */
  private doAssign(c: Character, uid: string, itId: string) {
    const err = this.game.assign(c, uid, itId);
    if (err) { this.flash(err); return false; }
    const f = this.game.world.getFurniture(uid)!;
    const it = FURNITURE_BY_ID[f.def].interactions.find((i) => i.id === itId)!;
    this.flash(`${c.name}去${it.name}了`);
    return true;
  }

  /** 安排：按房间列出全家能用的家具和用法 */
  openAssign(c: Character) {
    const w = this.game.world;
    const groups = new Map<string, string[]>();
    for (const f of w.data.furniture) {
      const def = FURNITURE_BY_ID[f.def];
      const its = def?.interactions.filter((i) => i.id !== "toggle") ?? [];
      if (!its.length) continue;
      const occ = this.game.occupantOf(f.uid);
      const busy = occ && occ !== c ? `<span class="as-busy">${esc(occ.name)}在用</span>` : "";
      const hasFood = w.foodsOn(f.uid).some((x) => !x.forChar || x.forChar === c.id);
      const btns = its.map((i) => {
        const off = (occ && occ !== c) || (i.tags?.includes("eat") && !hasFood);
        return `<button class="chip-btn" data-as="${f.uid}|${i.id}" ${off ? "disabled" : ""}>${esc(i.name)}</button>`;
      }).join("");
      const room = w.roomOf(f.x, f.y) || "其他";
      if (!groups.has(room)) groups.set(room, []);
      groups.get(room)!.push(`<div class="as-item"><div class="as-name"><b>${esc(def.name)}</b>${busy}</div><div class="as-btns">${btns}</div></div>`);
    }
    // 角色所在的房间排在最前面
    const rooms = [...groups.keys()].sort((a, b) => (a === c.room ? -1 : b === c.room ? 1 : 0));
    const p = this.page(`
      <header class="page-head"><button class="icon-btn" data-close aria-label="返回">${icon("back")}</button><h2>安排${esc(c.name)}做什么</h2></header>
      <div class="page-body">
        <p class="help" style="margin:0 0 12px">点一下，TA 就会走过去做。也可以在画面上先选中 TA，再点一件家具。</p>
        ${rooms.map((r) => `<h3 class="group">${esc(r)}${r === c.room ? "（TA 在这里）" : ""}</h3><div class="as-list">${groups.get(r)!.join("")}</div>`).join("")}
      </div>`);
    p.querySelectorAll<HTMLButtonElement>("[data-as]").forEach((b) => (b.onclick = () => {
      const [uid, it] = b.dataset.as!.split("|");
      if (this.doAssign(c, uid, it)) p.close();
    }));
  }

  /** 画面上选中角色后点家具：在点的位置弹出这件家具能做的事 */
  showFurnitureMenu(c: Character, uid: string, x: number, y: number) {
    this.closeFurnitureMenu();
    const f = this.game.world.getFurniture(uid);
    const def = f && FURNITURE_BY_ID[f.def];
    const its = def?.interactions.filter((i) => i.id !== "toggle") ?? [];
    if (!f || !def || !its.length) return false;
    const menu = document.createElement("div");
    menu.className = "fmenu";
    menu.innerHTML = `<div class="fmenu-title">让${esc(c.name)}…</div>${its.map((i) => `<button data-fi="${i.id}">${esc(i.name)}<small>${esc(def.name)}</small></button>`).join("")}`;
    const phone = this.els.phone;
    phone.appendChild(menu);
    const r = phone.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(r.width - mw - 8, x - mw / 2))}px`;
    menu.style.top = `${Math.max(60, Math.min(r.height - mh - 120, y - mh - 16))}px`;
    menu.querySelectorAll<HTMLElement>("[data-fi]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); this.doAssign(c, uid, b.dataset.fi!); this.closeFurnitureMenu(); }));
    setTimeout(() => document.addEventListener("pointerdown", this.menuAway, { once: true, capture: true }), 0);
    return true;
  }
  /** 通用的小菜单：在画面上某个位置弹出几个按钮 */
  showActionMenu(title: string, items: { label: string; note?: string; danger?: boolean; act: () => void }[], x: number, y: number) {
    this.closeFurnitureMenu();
    const menu = document.createElement("div");
    menu.className = "fmenu";
    menu.innerHTML = `<div class="fmenu-title">${esc(title)}</div>${items.map((it, i) => `<button data-mi="${i}"${it.danger ? ' class="danger"' : ""}>${esc(it.label)}${it.note ? `<small>${esc(it.note)}</small>` : ""}</button>`).join("")}`;
    const phone = this.els.phone;
    phone.appendChild(menu);
    const r = phone.getBoundingClientRect();
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    menu.style.left = `${Math.max(8, Math.min(r.width - mw - 8, x - mw / 2))}px`;
    menu.style.top = `${Math.max(60, Math.min(r.height - mh - 120, y - mh - 16))}px`;
    menu.querySelectorAll<HTMLElement>("[data-mi]").forEach((b) => (b.onclick = (e) => { e.stopPropagation(); this.closeFurnitureMenu(); items[+b.dataset.mi!].act(); }));
    setTimeout(() => document.addEventListener("pointerdown", this.menuAway, { once: true, capture: true }), 0);
  }
  private menuAway = (e: Event) => { if (!(e.target as HTMLElement).closest?.(".fmenu")) this.closeFurnitureMenu(); else document.addEventListener("pointerdown", this.menuAway, { once: true, capture: true }); };
  closeFurnitureMenu() { this.els.phone.querySelectorAll(".fmenu").forEach((m) => m.remove()); }

  /** 安卓版：把文本存成文件并打开系统分享（发给微信、QQ，或保存到手机） */
  shareFile?: (name: string, text: string) => Promise<boolean>;

  /** 日志：查看、复制、导出 */
  openLog() {
    const ai = this.game.settings.ai;
    const text = () => formatLog({
      版本: "恬小溪窝窝 " + (import.meta.env.MODE === "production" ? "正式构建" : "开发模式"),
      AI: ai.provider === "mock" || !ai.apiKey ? "本地模拟" : `${ai.provider} / ${ai.fastModel} / ${ai.chatModel}${ai.provider !== "anthropic" ? ` / ${ai.baseUrl}` : ""}`,
      AI状态: `${this.brain.status.mode}：${this.brain.status.message}`,
      角色数: String(this.game.chars.length),
    });
    const p = this.page(`
      <header class="page-head"><button class="icon-btn" data-close aria-label="返回">${icon("back")}</button><h2>日志</h2></header>
      <div class="page-body">
        <div class="log-btns"><button class="btn small primary" id="lg-export">导出</button><button class="btn small" id="lg-copy">复制</button><button class="btn small danger" id="lg-clear">清空</button></div>
        <pre class="log-pre" id="lg-text"></pre>
      </div>`);
    const pre = p.querySelector<HTMLElement>("#lg-text")!;
    const show = () => { pre.textContent = text(); };
    show();
    p.querySelector<HTMLElement>("#lg-copy")!.onclick = async () => {
      try { await navigator.clipboard.writeText(text()); this.flash("已复制，可以粘贴发给开发者"); }
      catch { const r = document.createRange(); r.selectNodeContents(pre); const sel = getSelection(); sel?.removeAllRanges(); sel?.addRange(r); this.flash("没能自动复制，已选中，长按复制"); }
    };
    p.querySelector<HTMLElement>("#lg-export")!.onclick = async () => {
      const name = `恬小溪窝窝-日志-${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, "")}.txt`;
      if (this.shareFile && await this.shareFile(name, text())) return;
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([text()], { type: "text/plain" }));
      a.download = name;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    };
    p.querySelector<HTMLElement>("#lg-clear")!.onclick = () => this.confirm("清空所有日志？", () => { clearLog(); show(); });
  }

  /** 按设置给界面换配色、切深色模式、跟着天色染一层底色 */
  applyLook() {
    const lk = this.game.settings.look;
    const root = document.documentElement;
    const dl = daylightAt(currentHour(null));
    root.dataset.palette = lk.palette;
    const dark = lk.mode === "dark" || (lk.mode === "system" && !!window.matchMedia?.("(prefers-color-scheme: dark)").matches) || (lk.mode === "time" && dl.night > 0.5);
    root.dataset.mode = dark ? "dark" : "light";
    if (lk.timeTint) {
      root.dataset.timeTint = "1";
      // 清晨偏粉、白天几乎不染、傍晚偏橙、夜里偏深蓝
      const tint = dl.night > 0.5 ? dl.skyTop : dl.skyBottom;
      const k = dark ? 0.22 : dl.sun > 0.85 && dl.night < 0.05 ? 0.06 : 0.16;
      root.style.setProperty("--time-tint", `#${tint.toString(16).padStart(6, "0")}`);
      root.style.setProperty("--time-k", String(k));
    } else {
      delete root.dataset.timeTint;
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#1b1820" : "#f4f1ec");
  }

  renderAll() {
    this.renderView();
    this.renderTop();
    this.renderRoster();
    this.renderSheet();
  }

  // ———————————————————— 顶部 ————————————————————

  renderTop() {
    const now = new Date();
    const t = describeNow(now);
    this.els.time.textContent = t.time;
    this.els.date.textContent = `${now.getMonth() + 1}月${now.getDate()}日 ${t.date.slice(-3)} · ${t.lunar.replace("农历", "")}`;
    const s = this.brain.status;
    const ai = s.mode === "online" ? `<button class="chip ai on" data-ai-chip title="AI 在线">AI${s.thinking ? " 思考中" : ""}</button>`
      : s.mode === "error" ? `<button class="chip ai err" data-ai-chip title="${esc(s.message)}">AI 出错</button>`
      : `<button class="chip ai" data-ai-chip title="本地模拟模式">本地</button>`;
    const fest = this.game.todayFestivals.slice(0, 2).map((f) => `<span class="chip fest">${esc(f)}</span>`).join("");
    const w = this.game.weather;
    const wIcon = { sunny: "☀️", cloudy: "☁️", rain: "🌧️", snow: "❄️", fog: "🌫️", storm: "⛈️" }[w.kind];
    const weather = `<button class="chip weather" data-w-chip>${wIcon} ${Math.round(w.temp)}°</button>`;
    const html = fest + weather + ai;
    if (this.els.chips.innerHTML !== html) {
      this.els.chips.innerHTML = html;
      // 手机上看不到悬停提示：点一下显示原因
      this.els.chips.querySelector<HTMLElement>("[data-w-chip]")!.onclick = () => {
        const g = this.game;
        const rooms = g.world.rooms().slice(0, 8).map((r) => `${r} ${Math.round(g.tempOf(r))}°`).join("，");
        const src = g.weather.source === "auto" ? "按位置的天气预报" : g.weather.source === "manual" ? "手动设置" : "按季节估的（在设置里开自动天气）";
        const hours = g.weather.hours?.filter((_, i) => i % 2 === 0).slice(0, 6).map((h) => `${new Date(h.t).getHours()}点 ${WEATHER_CN[h.kind]} ${Math.round(h.temp)}°`).join("、");
        this.confirm(`外面：${weatherLine(g.weather)}\n来源：${src}${hours ? `\n接下来：${hours}` : ""}\n\n室内：${rooms}\n\n${g.chars.map((c) => `${c.name}：觉得${FEELING_CN[feeling(g.feltOf(c))]}`).join("\n")}`, () => {});
      };
      this.els.chips.querySelector<HTMLElement>("[data-ai-chip]")!.onclick = () => {
        const st = this.brain.status;
        if (st.mode === "error") this.confirm(`AI 出错了：${st.message}\n\n要看详细的日志吗？`, () => this.openLog());
        else this.flash(st.mode === "online" ? "AI 已连接" : "本地模拟模式（没接 AI），可以在设置里接上");
      };
    }
    const unread = this.game.conflicts.some((c) => !c.resolved);
    this.els["feed-dot"].hidden = !unread;
  }

  /** 视角条：全景时「全景」高亮，单间时下拉框显示当前房间 */
  renderView() {
    const vb = this.els.viewbar;
    vb.querySelector("#v-all")!.classList.toggle("on", this.view.mode === "all");
    const sel = vb.querySelector<HTMLSelectElement>("#v-room")!;
    const cur = this.view.mode === "room" ? this.view.name : "";
    const lvBtn = vb.querySelector<HTMLElement>("#v-level")!;
    const levels = this.game.world.levels();
    lvBtn.hidden = levels.length < 2 && !this.build.on && this.level === 0;
    lvBtn.textContent = this.level >= 0 ? `${this.level + 1}F` : `B${-this.level}`;
    vb.querySelector("#v-names")!.classList.toggle("on", this.game.settings.look.names !== "none");
    const html = `<option value="">选择房间</option>` + this.game.world.rooms(this.level).map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = cur;
  }

  // ———————————————————— 角色头像条 ————————————————————

  private avatar(d: CharacterData, size = 44) {
    const a = d.appearance;
    const ring = d.illness ? "#e86a6a" : d.needs.mood > 60 ? "#5cc58a" : d.needs.mood > 35 ? "#f2c14e" : "#e88a6a";
    if (d.sprites) {
      // 立绘头像：按当前心情换表情，图片加载失败就退回色块头像
      const emo = d.illness ? "sick" : d.emotion;
      const src = spriteUrl(d.sprites, `avatar_${emo}.png`);
      return `<span class="avatar img" style="--s:${size}px;--ring:${ring};background:${a.skin}"><img alt="" src="${src}" onerror="if(!this.dataset.f){this.dataset.f=1;this.src='${spriteUrl(d.sprites, "avatar_normal.png")}'}else{this.remove()}"></span>`;
    }
    return `<span class="avatar" style="--s:${size}px;--ring:${ring};background:${a.skin}"><i style="background:${a.hair}"></i></span>`;
  }

  renderRoster() {
    const items = this.game.chars.map((c) => {
      const badge = c.d.illness ? "🤒" : c.hidden ? "💤" : "";
      return `<button class="ava-btn ${this.selected === c.id ? "sel" : ""}" data-id="${c.id}" aria-label="${esc(c.name)}">
        ${this.avatar(c.d)}${badge ? `<b class="badge">${badge}</b>` : ""}<span>${esc(c.name)}</span></button>`;
    }).join("");
    const html = items + `<button class="ava-btn add" id="add-char" aria-label="创建新角色"><span class="avatar plus" style="--s:44px">＋</span><span>新角色</span></button>`;
    if (this.els.roster.innerHTML !== html) {
      this.els.roster.innerHTML = html;
      this.els.roster.querySelectorAll<HTMLElement>(".ava-btn[data-id]").forEach((el) => (el.onclick = () => this.select(el.dataset.id!)));
      this.els.roster.querySelector<HTMLElement>("#add-char")!.onclick = () => this.openEditor(null);
    }
    if (this.sheet === "people") this.renderPeople(this.els["sheet-body"]);
  }

  private renderPeople(body: HTMLElement) {
    const cards = this.game.chars.map((c) => {
      const bars = (["hunger", "energy", "mood"] as (keyof Needs)[]).map((k) => `<span><b style="width:${c.d.needs[k]}%;background:${NEED_COLORS[k]}"></b></span>`).join("");
      return `<button class="person" data-id="${c.id}">${this.avatar(c.d, 48)}
        <div class="p-main"><div class="p-name">${esc(c.name)}${c.d.illness ? " 🤒" : ""}</div><div class="p-act">${esc(c.room)} · ${esc(c.d.activity)}</div><div class="minibars">${bars}</div></div></button>`;
    }).join("");
    const local = this.localPacks.length ? `<h4 class="sec">本地角色包（packs 文件夹）</h4><div class="local-packs">${this.localPacks.map((x, i) => `<button class="btn small" data-local="${i}">＋ ${esc(x.name)}</button>`).join("")}</div>` : "";
    body.innerHTML = `<div class="sheet-head"><h2>角色</h2><div class="head-btns"><button class="btn small" id="p-msg">发消息</button><button class="btn primary small" id="p-add">＋ 新角色</button></div></div><div class="people">${cards}</div>
      <div class="pack-row"><button class="btn small" id="p-import">导入角色包</button><button class="btn small" id="p-export">导出全部角色</button>
</div>${local}`;
    body.querySelectorAll<HTMLElement>(".person").forEach((el) => (el.onclick = () => this.select(el.dataset.id!)));
    body.querySelector<HTMLElement>("#p-add")!.onclick = () => this.openEditor(null);
    body.querySelector<HTMLElement>("#p-msg")!.onclick = () => this.openMessage();
    body.querySelector<HTMLElement>("#p-import")!.onclick = () => this.packFile().click();
    body.querySelector<HTMLElement>("#p-export")!.onclick = () => this.downloadPack(this.game.chars.map((c) => c.d), "全部角色");
    body.querySelectorAll<HTMLElement>("[data-local]").forEach((b) => (b.onclick = async () => {
      const item = this.localPacks[Number(b.dataset.local)];
      try {
        const r = await fetch(`packs/${item.file}`);
        if (!r.ok) throw new Error(String(r.status));
        this.applyPack(await r.json());
      } catch { this.flash(`读取 ${item.file} 失败`); }
    }));
  }

  /** 选择角色包文件的输入框放在抽屉外面，抽屉刷新时不会被替换掉 */
  private packFile() {
    let el = document.getElementById("pack-file") as HTMLInputElement | null;
    if (!el) {
      el = document.createElement("input");
      el.type = "file"; el.id = "pack-file"; el.hidden = true; // 不限制类型：有的手机会把 .json 标成不可选
      el.onchange = async () => {
        const f = el!.files?.[0];
        if (!f) return;
        try { this.applyPack(JSON.parse(await f.text())); } catch { this.flash("这个文件不是有效的角色包（JSON 格式不对）"); }
        el!.value = "";
      };
      document.body.appendChild(el);
    }
    return el;
  }

  /** 家具包 / 房间包的文件选择框 */
  private homeFile() {
    let el = document.getElementById("home-file") as HTMLInputElement | null;
    if (!el) {
      el = document.createElement("input");
      el.type = "file"; el.id = "home-file"; el.hidden = true;
      el.onchange = async () => {
        const f = el!.files?.[0];
        el!.value = "";
        if (!f) return;
        let raw: unknown;
        try { raw = JSON.parse(await f.text()); } catch { this.flash("这个文件不是有效的家具包 / 房间包（JSON 格式不对）"); return; }
        const r = await importHomePack(raw);
        const msg = [r.furniture.length ? `家具：${r.furniture.join("、")}` : "", r.rooms.length ? `房间：${r.rooms.join("、")}` : ""].filter(Boolean).join("；");
        if (r.furniture.length || r.rooms.length) this.game.log("player", `导入了 ${msg}`);
        if (r.furniture.length) { this.furnCat = FURNITURE_BY_ID[FURNITURE.find((x) => x.name === r.furniture[0])?.id ?? ""]?.category ?? this.furnCat; this.build.tool = "furniture"; }
        else if (r.rooms.length) this.build.tool = "room";
        this.renderBuild();
        this.game.changed();
        // 新家具没写标签：问要不要让 AI 填
        const untagged = customFurniture().filter((d) => r.furniture.includes(d.name) && !d.tags?.length);
        const tail = untagged.length && this.game.settings.ai.provider !== "mock" ? `\n\n${untagged.map((d) => d.name).join("、")}还没有标签，可以在「管理自制」里让 AI 填。` : "";
        if (r.problems.length || tail) this.confirm(`${msg ? `导入了 ${msg}` : "没有导入任何东西"}${r.problems.length ? `\n\n${r.problems.join("\n")}` : ""}${tail}`, () => {});
        else this.flash(`导入了 ${msg}`);
      };
      document.body.appendChild(el);
    }
    return el;
  }

  /** 存一个文本文件：安卓版走系统分享，网页版直接下载 */
  async saveFile(name: string, text: string, type = "application/json") {
    if (this.shareFile && await this.shareFile(name, text)) return;
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  private homeExportMenu(e: MouseEvent) {
    const pr = this.els.phone.getBoundingClientRect();
    const rooms = this.game.world.rooms();
    this.showActionMenu("导出成文件", [
      ...rooms.slice(0, 12).map((room) => ({ label: room, note: "导出成房间包", act: async () => {
        const pack = await exportRoom(this.game.world, room);
        if (pack) { await this.saveFile(`房间包-${room}.json`, JSON.stringify(pack, null, 1)); this.flash(`已导出「${room}」`); }
      } })),
      ...(customFurniture().length ? [{ label: "全部自制家具", note: `${customFurniture().length} 件`, act: async () => {
        await this.saveFile("家具包-自制家具.json", JSON.stringify(await exportFurniturePack(), null, 1)); this.flash("已导出自制家具");
      } }] : []),
    ], e.clientX - pr.left, e.clientY - pr.top + 40);
  }

  /** 管理导入的家具和房间：改标签、让 AI 填标签、删除 */
  openHomeManager() {
    const p = this.page(`
      <header class="page-head"><button class="icon-btn" data-close aria-label="返回">${icon("back")}</button><h2>家具标签和自制内容</h2></header>
      <div class="page-body" id="hm-body"></div>`);
    const body = p.querySelector<HTMLElement>("#hm-body")!;
    const render = () => {
      const furn = customFurniture(), rooms = customRooms();
      body.innerHTML = `
        <h3 class="group">家具标签</h3>
        <div class="help">标签描述家具的风格和用途，角色会喜欢或讨厌某些标签（在角色设定里改）。内置家具已经写好了，可以点开改。</div>
        <div class="field"><select id="hm-pick">${FURNITURE.map((f) => `<option value="${f.id}">${esc(f.name)}${f.custom ? "（自制）" : ""}${f.tags?.length ? "" : " · 没有标签"}</option>`).join("")}</select></div>
        <div id="hm-tags"></div>
        <button class="btn small" id="hm-ai" ${this.game.settings.ai.provider === "mock" ? "disabled" : ""}>让 AI 给没有标签的家具填写</button>
        <h3 class="group">自制家具（${furn.length}）</h3>
        ${furn.length ? furn.map((f) => `<div class="row-item"><span>${esc(f.name)} <small>${f.w}×${f.h} · ${esc(f.category)}</small></span><button class="btn small danger" data-delf="${f.id}">删除</button></div>`).join("") : `<div class="help">还没有。在「建造」里点「导入家具包 / 房间包」。</div>`}
        <h3 class="group">自制房间（${rooms.length}）</h3>
        ${rooms.length ? rooms.map((r) => `<div class="row-item"><span>${esc(r.name)} <small>${r.w}×${r.h}</small></span><button class="btn small danger" data-delr="${r.id}">删除</button></div>`).join("") : `<div class="help">还没有。可以在「导出…」里把家里布置好的房间存成房间包，分享给别人。</div>`}`;
      const pick = body.querySelector<HTMLSelectElement>("#hm-pick")!;
      const showTags = () => {
        const def = FURNITURE_BY_ID[pick.value];
        const box = body.querySelector<HTMLElement>("#hm-tags")!;
        box.innerHTML = TAG_GROUPS.map((g) => `<div class="tag-group"><small>${g.name}</small><div class="taste">${g.tags.map((t) => `<button type="button" class="taste-chip ${def.tags?.includes(t) ? "like" : ""}" data-tag="${t}">${t}</button>`).join("")}</div></div>`).join("");
        box.querySelectorAll<HTMLElement>("[data-tag]").forEach((b) => (b.onclick = () => {
          const t = b.dataset.tag!;
          const cur = new Set(def.tags ?? []);
          if (cur.has(t)) cur.delete(t); else cur.add(t);
          setFurnitureTags(def.id, [...cur]);
          showTags();
        }));
      };
      pick.onchange = showTags;
      showTags();
      body.querySelectorAll<HTMLElement>("[data-delf]").forEach((b) => (b.onclick = () => this.confirm(`删掉「${FURNITURE_BY_ID[b.dataset.delf!]?.name}」？家里摆着的也会一起拿走。`, async () => {
        for (const c of this.game.chars) if (c.run?.furniture?.def === b.dataset.delf) c.setPlan([], true);
        await removeCustomFurniture(this.game.world, b.dataset.delf!); this.game.changed(); render();
      })));
      body.querySelectorAll<HTMLElement>("[data-delr]").forEach((b) => (b.onclick = () => { removeCustomRoom(b.dataset.delr!); render(); }));
      body.querySelector<HTMLElement>("#hm-ai")!.onclick = async () => {
        const todo = FURNITURE.filter((f) => !f.tags?.length);
        if (!todo.length) { this.flash("所有家具都有标签了"); return; }
        this.flash(`正在让 AI 给 ${todo.length} 件家具填标签…`);
        const n = await this.brain.tagFurniture(todo);
        this.flash(n ? `AI 填好了 ${n} 件家具的标签` : "AI 没能填写，看看设置里的 AI 是否可用");
        render();
      };
    };
    render();
  }

  /** packs/index.json 里列出的本地角色包，例如 [{"name":"小溪","file":"xiaoxi.json"}] */
  private localPacks: { name: string; file: string }[] = [];
  async loadLocalPacks() {
    try {
      const r = await fetch("packs/index.json");
      if (!r.ok || !(r.headers.get("content-type") ?? "").includes("json")) return;
      const list = await r.json();
      if (Array.isArray(list)) this.localPacks = list.filter((x) => typeof x?.name === "string" && typeof x?.file === "string" && /^[\w\-.\u4e00-\u9fa5/]+\.json$/.test(x.file) && !x.file.includes(".."));
    } catch { /* 没有本地角色包就算了 */ }
  }

  /** 导入成功后要做的事（比如关掉「创建新角色」页），用一次就清掉 */
  private afterImport: (() => void) | null = null;

  private async applyPack(raw: unknown) {
    const { added, updated, problems } = await importPack(this.game, raw);
    if (updated.length) { this.renderAll(); this.game.save(); }
    if (added.length && this.afterImport) {
      this.afterImport();
      const first = this.game.chars.find((c) => c.name === added[0]);
      if (first) this.select(first.id);
    }
    this.afterImport = null;
    if (added.length) {
      this.game.log("player", `${added.join("、")}搬进来了`);
      this.renderRoster();
      this.game.save();
    }
    const msg = [added.length ? `导入了 ${added.join("、")}` : "", updated.length ? `更新了 ${updated.join("、")} 的立绘` : ""].filter(Boolean).join("，") || "没有导入任何角色";
    if (problems.length) this.confirm(`${msg}。\n\n${problems.join("\n")}`, () => {});
    else this.flash(msg);
  }

  private async downloadPack(chars: CharacterData[], label: string) {
    this.flash("正在打包角色（带立绘的会大一些）…");
    const blob = new Blob([JSON.stringify(await exportPack(this.game, chars), null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `角色包-${label}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    this.flash("角色包已导出");
  }

  select(id: string | null) {
    this.selected = id;
    this.onSelect?.(id);
    this.renderRoster();
    if (id) { this.tab = "status"; this.openSheet("detail"); }
    else if (this.sheet === "detail") this.closeSheet();
  }

  // ———————————————————— 角色详情（底部抽屉） ————————————————————

  renderDetail(onlyLive = false) {
    if (this.chatOpen) this.renderChatLog();
    if (this.sheet !== "detail") return;
    const body = this.els["sheet-body"];
    const c = this.selected ? this.game.byId(this.selected) : null;
    if (!c) { this.closeSheet(); return; }
    if (onlyLive) {
      const live = body.querySelector("#live");
      if (live && this.tab === "status") live.innerHTML = this.statusLive(c);
      const head = body.querySelector("#head-sub");
      if (head) head.textContent = `${EMOTION_CN[c.d.emotion]} · ${c.room} · ${c.d.activity}`;
      const th = body.querySelector("#thought");
      if (th) th.textContent = c.d.thought || "……";
      return;
    }
    const tabs = [["status", "状态"], ["profile", "档案"], ["relations", "关系"], ["memory", "记忆"]] as const;
    body.innerHTML = `
      <div class="d-head">${this.avatar(c.d, 52)}
        <div class="d-title"><h2>${esc(c.name)}</h2><div class="sub" id="head-sub"></div></div>
        <button class="icon-btn" id="d-close" aria-label="关闭">${icon("close")}</button></div>
      <div class="thought"><span>💭</span><span id="thought"></span></div>
      <div class="d-actions">
        <button class="act primary" id="act-chat">${icon("chat")}<span>聊天</span></button>
        <button class="act" id="act-feed">🍚<span>喂饭</span></button>
        <button class="act" id="act-do">🪑<span>安排</span></button>
        <button class="act" id="act-bed">🛏️<span>去休息</span></button>
        <button class="act" id="act-edit">✏️<span>人设</span></button>
      </div>
      <div class="foods" id="foods" hidden>${FOODS.map((f) => `<button class="food" data-food="${f.id}"><img alt="" src="${asset("food", "food_" + f.id)}" onerror="this.remove()"><span>${esc(f.name)}</span></button>`).join("")}</div>
      <div class="seg">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${this.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <div class="tabbody" id="tabbody"></div>`;
    const $ = <T extends HTMLElement>(s: string) => body.querySelector<T>(s)!;
    $("#d-close").onclick = () => this.select(null);
    $("#act-chat").onclick = () => this.openChat(c.id);
    $("#act-feed").onclick = () => { $("#foods").hidden = !$("#foods").hidden; };
    body.querySelectorAll<HTMLElement>("[data-food]").forEach((b) => (b.onclick = () => { this.game.feed(c, b.dataset.food!); $("#foods").hidden = true; this.flash(`给${c.name}准备了${FOODS.find((f) => f.id === b.dataset.food)?.name}`); }));
    $("#act-bed").onclick = () => { this.game.sendToBed(c); this.flash(`让${c.name}回床上休息`); };
    $("#act-edit").onclick = () => this.openEditor(c);
    $("#act-do").onclick = () => this.openAssign(c);
    body.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab as UI["tab"]; this.renderDetail(); }));
    const tb = $("#tabbody");
    if (this.tab === "status") {
      tb.innerHTML = `<div id="live">${this.statusLive(c)}</div>
        <div class="minor"><button class="btn small" id="act-sick">让TA生病（测试）</button><button class="btn small danger" id="act-del">让TA搬走</button></div>`;
      $("#act-sick").onclick = () => c.getSick();
      $("#act-del").onclick = () => this.confirm(`确定要让${c.name}搬走吗？TA的记忆和聊天记录会一起删除。`, () => { this.game.removeCharacter(c.id); this.select(null); this.renderRoster(); });
    } else if (this.tab === "profile") {
      tb.innerHTML = this.profileHtml(c);
    } else if (this.tab === "relations") {
      const rows = Object.entries(c.d.relations).map(([id, r]) => {
        const who = id === "player" ? "主人（你）" : this.game.byId(id)?.name ?? "（已搬走）";
        const cls = r.affinity >= 30 ? "good" : r.affinity <= -20 ? "bad" : "";
        return `<div class="row-item"><div class="ri-top"><b>${esc(who)}</b><span class="aff ${cls}">好感 ${Math.round(r.affinity)}</span></div><small>${esc(r.note || "")}</small></div>`;
      }).join("");
      tb.innerHTML = rows || `<p class="empty">还没有认识的人。</p>`;
    } else {
      this.renderMemoryTab(c, tb);
    }
    this.renderDetail(true);
  }

  /** 记忆 / 知识库：AI 记下的事 + 主人写的资料，可以搜索、添加、删除 */
  private memQuery = "";
  private renderMemoryTab(c: Character, tb: HTMLElement) {
    const bank = this.brain.mem;
    const knowledge = c.d.memories.filter((m) => m.kind === "knowledge").length;
    const own = c.d.memories.length - knowledge;
    const noVec = bank.enabled ? c.d.memories.filter((m) => !bank.hasVector(c, m)).length : 0;
    tb.innerHTML = `
      <div class="help">${esc(c.name)}的长期记忆：TA 自己记下的事 ${own} 条，你写给 TA 的资料 ${knowledge} 条。聊天和做决定时，会${bank.enabled ? "用向量模型" : "按文字相似度"}找出和眼前的事最相关的几条。${bank.enabled ? "" : "（在设置里填上向量模型会找得更准）"}${bank.status ? `<br><small>${esc(bank.status)}</small>` : ""}</div>
      <div class="field"><textarea id="kb-new" style="min-height:56px" placeholder="写一条资料告诉 TA，比如：主人不吃香菜；主人的生日是 3 月 8 日；我们是在高中认识的"></textarea></div>
      <div class="pack-row"><button class="btn small primary" id="kb-add">加进知识库</button>${noVec ? `<button class="btn small" id="kb-fill">给 ${noVec} 条补上向量</button>` : ""}</div>
      <div class="field"><input id="kb-q" placeholder="搜一搜 TA 记得什么" value="${esc(this.memQuery)}" /></div>
      <div id="kb-list"></div>`;
    const list = tb.querySelector<HTMLElement>("#kb-list")!;
    const show = async () => {
      const q = this.memQuery.trim();
      const items = q ? await bank.recall(c, q, 20) : [...c.d.memories].reverse();
      list.innerHTML = items.length
        ? items.map((m) => `<div class="row-item"><span>${m.kind === "knowledge" ? "📌" : "★".repeat(m.weight)} ${esc(m.text)}<br><small>${m.kind === "knowledge" ? "主人写的资料" : new Date(m.t).toLocaleString("zh-CN")}</small></span><button class="btn small danger" data-mdel="${c.d.memories.indexOf(m)}">删</button></div>`).join("")
        : `<p class="empty">${q ? "没找到相关的记忆。" : "还没有记住什么事。和 TA 聊聊天，或者让 TA 过一阵子日常生活吧。"}</p>`;
      list.querySelectorAll<HTMLElement>("[data-mdel]").forEach((b) => (b.onclick = () => {
        const m = c.d.memories[Number(b.dataset.mdel)];
        if (m) { bank.remove(c, m); this.game.save(); void show(); }
      }));
    };
    void show();
    const q = tb.querySelector<HTMLInputElement>("#kb-q")!;
    let timer: ReturnType<typeof setTimeout> | null = null;
    q.oninput = () => { this.memQuery = q.value; if (timer) clearTimeout(timer); timer = setTimeout(() => void show(), 350); };
    tb.querySelector<HTMLElement>("#kb-add")!.onclick = () => {
      const t = tb.querySelector<HTMLTextAreaElement>("#kb-new")!;
      const lines = t.value.split("\n").map((x) => x.trim()).filter(Boolean);
      if (!lines.length) return;
      for (const line of lines) bank.add(c, line, 3, "knowledge");
      this.game.save();
      this.flash(`加了 ${lines.length} 条资料`);
      this.renderMemoryTab(c, tb);
    };
    const fill = tb.querySelector<HTMLButtonElement>("#kb-fill");
    if (fill) fill.onclick = async () => {
      fill.disabled = true;
      const n = await bank.backfill(c, (d, total) => { fill.textContent = `补向量中 ${d}/${total}`; });
      this.flash(n ? `补好了 ${n} 条` : bank.status || "没能补上，检查一下向量模型设置");
      this.renderMemoryTab(c, tb);
    };
  }

  private statusLive(c: Character) {
    const d = c.d;
    const bar = (label: string, v: number, color: string, extra = "") =>
      `<div class="need"><span>${label}</span><span class="bar"><b style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></b></span><span class="v">${extra || Math.round(v)}</span></div>`;
    const needs = NEED_ORDER.map((k) => bar(NEED_CN[k], d.needs[k], NEED_COLORS[k])).join("");
    const mood = d.needs.mood;
    const moodWord = mood >= 80 ? "很开心" : mood >= 60 ? "不错" : mood >= 40 ? "一般" : mood >= 20 ? "低落" : "很糟";
    const stressWord = d.stress >= 70 ? "压力很大" : d.stress >= 40 ? "有点压力" : "放松";
    const felt = this.game.feltOf(c);
    const temp = `<div class="help">🌡 ${esc(c.room)} ${Math.round(this.game.tempOf(c.room))}°C，${esc(c.name)}觉得${FEELING_CN[feeling(felt)]}</div>`;
    const ill = d.illness ? `<div class="sick">🤒 ${esc(d.illness.name)}，严重程度 ${Math.round(d.illness.severity)}。躺床休息、吃药、喝粥会好得快。</div>` : "";
    const td = d.today;
    const h = (m: number) => (m / 60).toFixed(1);
    const plan = c.queue.length ? `<div class="plan">接下来：${c.queue.map((s) => esc(c.describeStep(s))).join(" → ")}</div>` : "";
    return `${ill}${temp}
      <div class="mood-row">
        <div class="big-stat"><b>${Math.round(mood)}</b><span>心情 · ${moodWord}</span><i style="--p:${mood}%;--c:${NEED_COLORS.mood}"></i></div>
        <div class="big-stat"><b>${Math.round(d.stress)}</b><span>压力 · ${stressWord}</span><i style="--p:${d.stress}%;--c:${d.stress >= 70 ? "#e86a6a" : "#b9a3d6"}"></i></div>
        <div class="big-stat"><b>${d.sleepDebt.toFixed(1)}<small>h</small></b><span>睡眠债</span><i style="--p:${Math.min(100, d.sleepDebt * 10)}%;--c:#6b9bf2"></i></div>
      </div>
      <h4 class="sec">需求</h4><div class="needs">${needs}</div>
      ${this.senseHtml(c)}
      <h4 class="sec">今天</h4>
      <div class="today">
        <span>🍚 吃了 <b>${td.meals}</b> 顿</span><span>😴 睡了 <b>${h(td.sleepMin)}</b> 小时</span>
        <span>💼 工作 <b>${h(td.workMin)}</b> 小时</span><span>🎮 玩了 <b>${h(td.funMin)}</b> 小时</span>
        <span>💬 聊天 <b>${Math.round(td.socialMin)}</b> 句</span><span>🛁 ${td.showered ? "洗过澡了" : "还没洗澡"}</span>
      </div>${plan}`;
  }

  /** 所在房间的感觉 + 想做的事 */
  private senseHtml(c: Character) {
    const sn = c.sense;
    const room = sn ? `<h4 class="sec">所在房间 · ${esc(sn.room)} <span class="room-score">舒服程度 ${sn.score}</span></h4>
      <div class="sense">
        ${[["美观", sn.beauty, "#f2a6c0"], ["明亮", sn.light, "#f2c14e"], ["热闹", sn.lively, "#8fb86b"], ["凌乱", sn.clutter, "#c9a27a"]].map(([n, v, col]) => `<div class="sense-item"><span>${n}</span><span class="bar"><b style="width:${v}%;background:${col}"></b></span><span class="v">${v}</span></div>`).join("")}
      </div>
      ${sn.people.length ? `<div class="sense-note">👥 这里还有 ${sn.people.map(esc).join("、")}</div>` : ""}
      ${sn.notable.map((t) => `<div class="sense-note">👀 ${esc(t)}</div>`).join("")}` : "";
    const wants = scoreOptions(this.game, c).slice(0, 4);
    const max = Math.max(1, ...wants.map((w) => w.score));
    const list = wants.map((w) => `<div class="want"><span class="want-l">${esc(w.label)}</span><span class="want-why">${esc(w.why)}</span><span class="bar"><b style="width:${(w.score / max) * 100}%"></b></span></div>`).join("");
    return room + `<h4 class="sec">想做的事</h4><div class="wants">${list}</div>`;
  }

  /** 档案页：基本资料、性格、技能 */
  private profileHtml(c: Character) {
    const d = c.d, p = d.profile;
    const food = (ids: string[]) => ids.map((id) => FOODS.find((f) => f.id === id)?.name).filter(Boolean).join("、") || "—";
    const traits = (Object.keys(TRAIT_CN) as (keyof Traits)[]).map((k) => {
      const [, low, high] = TRAIT_CN[k];
      return `<div class="trait"><span>${low}</span><span class="tbar"><i style="left:${d.traits[k]}%"></i></span><span>${high}</span></div>`;
    }).join("");
    const skills = (Object.keys(SKILL_CN) as (keyof Skills)[]).map((k) => {
      const v = d.skills[k], lv = Math.floor(v);
      return `<div class="skill"><span>${SKILL_CN[k]}</span><span class="pips">${Array.from({ length: 10 }, (_, i) => `<i class="${i < lv ? "on" : i === lv ? "part" : ""}" style="${i === lv ? `--p:${(v - lv) * 100}%` : ""}"></i>`).join("")}</span><b>${lv}</b></div>`;
    }).join("");
    return `<div class="kv-list">
        <div><span>年龄</span><b>${p.age} 岁</b></div>
        <div><span>生日</span><b>${p.birthday ? p.birthday.replace("-", " 月 ") + " 日" : "—"}</b></div>
        <div><span>职业</span><b>${esc(p.job || "—")}</b></div>
        <div><span>爱好</span><b>${esc(p.hobbies || "—")}</b></div>
        <div><span>喜欢吃</span><b>${food(p.likes)}</b></div>
        <div><span>不爱吃</span><b>${food(p.dislikes)}</b></div>
      </div>
      <h4 class="sec">性格</h4><div class="traits">${traits}</div>
      <h4 class="sec">技能</h4><div class="skills">${skills}</div>
      <p class="hint">性格会影响需求变化的快慢和 AI 的行为；技能在做相关的事时慢慢提升。</p>`;
  }

  // ———————————————————— 聊天（全屏页面） ————————————————————

  /**
   * 后台权限引导（安卓版）：逐项检查，能弹系统窗口的直接弹，不能弹的跳到对应的系统设置页。
   * first = 第一次打开应用时自动弹出。
   */
  openPermissionGuide(first: boolean) {
    const api = this.permissions;
    if (!api) return;
    const brandTip = (m: string) =>
      /xiaomi|redmi|poco/.test(m) ? "小米 / 红米：打开「自启动」，再到「省电策略」里选「无限制」。"
      : /huawei|honor/.test(m) ? "华为 / 荣耀：在「应用启动管理」里把它改成「手动管理」，三个开关（自启动、关联启动、后台活动）都打开。"
      : /oppo|realme|oneplus/.test(m) ? "OPPO / 一加 / realme：打开「自启动」，再到「耗电管理」里允许「后台运行」。"
      : /vivo|iqoo/.test(m) ? "vivo / iQOO：在「后台高耗电」里允许它，再打开「自启动」。"
      : /samsung/.test(m) ? "三星：在「电池」里把它设成「不受限制」。"
      : /meizu/.test(m) ? "魅族：在「后台管理」里允许它后台运行。"
      : "在系统设置里找到这个应用，打开「自启动」并允许「后台运行」（不同手机叫法不一样）。";
    const p = this.page(`
      <header class="page-head"><button class="icon-btn" data-close aria-label="返回">${icon("back")}</button><h2>后台权限</h2></header>
      <div class="page-body">
        <p class="perm-intro">${first ? "欢迎来到窝窝！" : ""}想让家里的人在你不看手机的时候也照常生活、给你发消息，需要开几项权限。</p>
        <button class="btn primary block perm-all" id="perm-all">一键获取权限</button>
        <p class="help" style="margin:6px 0 14px">会依次弹出系统的授权窗口，都选「允许」就好；个别项目系统不给弹窗，会直接打开那一页的设置，把开关打开后返回即可。</p>
        <div class="perm-list" id="perm-list"><div class="help">正在检查…</div></div>
        <button class="btn primary block" id="perm-done">${first ? "好了，开始吧" : "完成"}</button>
      </div>`, () => { this.refreshPermissionGuide = undefined; });
    let autostartDone = false;
    try { autostartDone = localStorage.getItem("wowo-autostart") === "1"; } catch { /* 无所谓 */ }
    const render = async () => {
      const st = await api.status().catch(() => null);
      const box = p.querySelector<HTMLElement>("#perm-list");
      if (!st || !box) return;
      const row = (id: string, ok: boolean, title: string, desc: string, btn: string) => `
        <div class="perm-row ${ok ? "ok" : ""}">
          <span class="perm-state">${ok ? "✓" : "!"}</span>
          <div class="perm-text"><b>${title}</b><span>${desc}</span></div>
          ${ok ? `<span class="perm-ok">已开启</span>` : `<button class="btn small primary" data-perm="${id}">${btn}</button>`}
        </div>`;
      box.innerHTML = [
        row("notify", st.notifications, "通知", "角色给你发的消息会变成手机通知。", "开启"),
        row("battery", st.battery, "不受省电限制", "系统省电时不会把窝窝关掉。会弹出系统窗口，选「允许」。", "开启"),
        st.sdk >= 31 ? row("exact", st.exactAlarm, "准时提醒", "到点的消息能准时送到。会打开系统设置，把开关打开。", "去设置") : "",
        autostartDone
          ? row("autostart", true, "自启动和后台运行", brandTip(st.manufacturer), "")
          : `<div class="perm-row">
              <span class="perm-state">!</span>
              <div class="perm-text"><b>自启动和后台运行</b><span>${brandTip(st.manufacturer)}这一项系统不让应用直接检查，设置好以后点「我已设置好」。</span></div>
              <span></span>
              <div class="perm-btns"><button class="btn small primary" data-perm="autostart">去设置</button><button class="btn small" data-perm="autostart-done">我已设置好</button></div>
            </div>`,
      ].join("");
      box.querySelectorAll<HTMLElement>("[data-perm]").forEach((b) => (b.onclick = async () => {
        const k = b.dataset.perm!;
        if (k === "notify") await api.requestNotifications();
        else if (k === "battery") await api.requestBattery();
        else if (k === "exact") await api.openExactAlarm();
        else if (k === "autostart") { const opened = await api.openAutostart(); if (!opened) this.flash("没找到自启动页面，已打开应用详情，请在里面找「自启动」或「电池」"); }
        else if (k === "autostart-done") { autostartDone = true; try { localStorage.setItem("wowo-autostart", "1"); } catch { /* 无所谓 */ } }
        setTimeout(() => void render(), 600);
      }));
    };
    this.refreshPermissionGuide = () => void render();
    p.querySelector<HTMLElement>("#perm-all")!.onclick = async () => {
      const b = p.querySelector<HTMLButtonElement>("#perm-all")!;
      b.disabled = true; b.textContent = "正在获取…";
      try { await api.requestAll(); } finally { b.disabled = false; b.textContent = "一键获取权限"; }
      await render();
      const st = await api.status().catch(() => null);
      if (st && st.notifications && st.battery && (st.sdk < 31 || st.exactAlarm)) this.flash(autostartDone ? "权限都开好了" : "系统权限都开好了，再按下面的提示把「自启动」打开就齐了");
    };
    void render();
    p.querySelector<HTMLElement>("#perm-done")!.onclick = () => {
      try { localStorage.setItem("wowo-perm-guide", "1"); } catch { /* 无所谓 */ }
      p.close();
    };
  }

  /** 发消息：可以发给全体、选几个人，或者只发给一个人（只选一个人时直接进聊天） */
  openMessage(preselect?: string[]) {
    const chars = this.game.chars;
    const picked = new Set(preselect ?? chars.map((c) => c.id));
    const p = this.page(`
      <header class="page-head"><button class="icon-btn" data-close aria-label="返回">${icon("back")}</button><h2>发消息</h2></header>
      <div class="page-body">
        <div class="field"><label>发给谁</label>
          <div class="msg-to">
            <button type="button" class="chip-btn" id="m-all">全部</button>
            ${chars.map((c) => `<button type="button" class="msg-who" data-id="${c.id}" aria-pressed="false">${this.avatar(c.d, 40)}<span>${esc(c.name)}</span></button>`).join("")}
          </div>
          <div class="help" id="m-help"></div></div>
        <div class="field"><label for="m-text">说什么</label><textarea id="m-text" style="min-height:90px" placeholder="例如：今天晚上一起吃火锅吧！"></textarea></div>
        <button class="btn primary block" id="m-send">发送</button>
      </div>`);
    const $ = <T extends HTMLElement>(s: string) => p.querySelector<T>(s)!;
    const sync = () => {
      p.querySelectorAll<HTMLElement>(".msg-who").forEach((b) => { const on = picked.has(b.dataset.id!); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
      $("#m-all").classList.toggle("on", picked.size === chars.length);
      $("#m-help").textContent = picked.size === 0 ? "至少选一个人" : picked.size === 1 ? "只选了一个人：会直接打开和 TA 的聊天" : picked.size === chars.length ? "发给家里所有人，每个人都会按自己的性格回应" : `发给选中的 ${picked.size} 个人`;
      $<HTMLButtonElement>("#m-send").disabled = picked.size === 0;
    };
    p.querySelectorAll<HTMLElement>(".msg-who").forEach((b) => (b.onclick = () => { const id = b.dataset.id!; if (picked.has(id)) picked.delete(id); else picked.add(id); sync(); }));
    $("#m-all").onclick = () => { if (picked.size === chars.length) picked.clear(); else chars.forEach((c) => picked.add(c.id)); sync(); };
    $("#m-send").onclick = () => {
      const text = $<HTMLTextAreaElement>("#m-text").value.trim();
      if (!text) { $<HTMLTextAreaElement>("#m-text").focus(); return; }
      const targets = chars.filter((c) => picked.has(c.id));
      if (!targets.length) return;
      p.close();
      if (targets.length === 1) {
        this.openChat(targets[0].id);
        const input = this.els["page-host"].querySelector<HTMLInputElement>("#chatinput");
        if (input) { input.value = text; input.form?.requestSubmit(); }
        return;
      }
      this.game.messageGroup(targets, text);
      this.flash(`已发给${targets.length === chars.length ? "所有人" : targets.map((c) => c.name).join("、")}，回复会出现在各自的聊天里`);
    };
    sync();
  }

  openChat(id: string) {
    const c = this.game.byId(id);
    if (!c) return;
    this.chatOpen = id;
    const p = this.page(`
      <header class="page-head chat-head"><button class="icon-btn" data-close aria-label="返回">${icon("back")}</button>
        ${this.avatar(c.d, 36)}<div class="d-title"><b>${esc(c.name)}</b><div class="sub" id="chat-sub"></div></div></header>
      <div class="chat-scroll" id="chat-scroll"></div>
      <form class="chatbar" id="chatform"><input id="chatinput" autocomplete="off" placeholder="和${esc(c.name)}说点什么…" enterkeyhint="send" /><button class="send" aria-label="发送">${icon("send")}</button></form>`, () => { this.chatOpen = null; });
    const input = p.querySelector<HTMLInputElement>("#chatinput")!;
    p.querySelector<HTMLFormElement>("#chatform")!.onsubmit = async (e) => {
      e.preventDefault();
      const text = input.value.trim();
      if (!text) return;
      input.value = "";
      this.typing.add(c.id);
      this.renderChatLog(text);
      try { await this.brain.chat(c, text); } finally { this.typing.delete(c.id); this.renderChatLog(); }
    };
    this.renderChatLog();
    setTimeout(() => input.focus(), 50);
  }

  private renderChatLog(pending?: string) {
    const c = this.chatOpen ? this.game.byId(this.chatOpen) : null;
    const box = this.els["page-host"].querySelector<HTMLElement>("#chat-scroll");
    if (!c || !box) return;
    const sub = this.els["page-host"].querySelector("#chat-sub");
    if (sub) sub.textContent = this.typing.has(c.id) ? "正在输入…" : `${c.room} · ${c.d.activity}`;
    const atBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60;
    let lastDay = "";
    const msgs = c.d.chat.slice(-80).map((m) => {
      const day = new Date(m.t).toLocaleDateString("zh-CN");
      const sep = day !== lastDay ? `<div class="day">${day === new Date().toLocaleDateString("zh-CN") ? "今天" : day}</div>` : "";
      lastDay = day;
      return `${sep}<div class="msg ${m.from}"><span>${esc(m.text)}</span><time>${hhmm(new Date(m.t))}</time></div>`;
    }).join("");
    const pend = pending && !c.d.chat.some((m) => m.text === pending && Date.now() - m.t < 2000) ? `<div class="msg player"><span>${esc(pending)}</span></div>` : "";
    const typing = this.typing.has(c.id) ? `<div class="msg char typing"><span>…</span></div>` : "";
    const html = (msgs || `<p class="empty">还没有聊过天。说点什么吧。</p>`) + pend + typing;
    if (box.innerHTML !== html) {
      box.innerHTML = html;
      if (atBottom || pending) box.scrollTop = box.scrollHeight;
    }
  }

  // ———————————————————— 动态（日志和矛盾） ————————————————————

  renderLog() {
    if (this.sheet !== "feed") return;
    const body = this.els["sheet-body"];
    const conflicts = this.game.conflicts.filter((c) => !c.resolved).map((cf) => {
      const a = this.game.byId(cf.a)?.name ?? "?", b = this.game.byId(cf.b)?.name ?? "?";
      return `<div class="conflict"><div><b>${esc(a)}</b> 和 <b>${esc(b)}</b> 闹矛盾了</div><small>${esc(cf.reason)}</small>
        <form class="cf-row" data-cf="${cf.id}"><input placeholder="写下你想对他们说的话…" /><button class="btn small primary">去劝劝</button></form>
        <button type="button" class="link" data-ignore="${cf.id}">先不管</button></div>`;
    }).join("");
    const entries = this.game.logs.slice(-80).reverse().map((l) => {
      const who = l.who ? (this.game.byId(l.who)?.name ?? "") : "";
      const text = l.kind === "thought" ? `${who}在想：${l.text}` : l.kind === "say" ? `${who}：${l.text}` : l.kind === "player" ? `你${l.text}` : l.text;
      return `<div class="log log-${l.kind}"><time>${hhmm(new Date(l.t))}</time><span>${esc(text)}</span></div>`;
    }).join("");
    // 输入时不重绘
    if (body.contains(document.activeElement) && document.activeElement?.tagName === "INPUT") return;
    body.innerHTML = `<div class="sheet-head"><h2>家里的动静</h2></div>${conflicts}<div class="logs">${entries}</div>`;
    body.querySelectorAll<HTMLFormElement>("form[data-cf]").forEach((f) => (f.onsubmit = (e) => {
      e.preventDefault();
      const v = (f.querySelector("input") as HTMLInputElement).value.trim();
      if (v) { this.game.mediate(f.dataset.cf!, v); this.renderLog(); }
    }));
    body.querySelectorAll<HTMLElement>("[data-ignore]").forEach((b) => (b.onclick = () => {
      const cf = this.game.conflicts.find((x) => x.id === b.dataset.ignore);
      if (cf) cf.resolved = true;
      this.renderLog();
    }));
  }

  // ———————————————————— 建造（底部抽屉） ————————————————————

  renderBuild() {
    if (this.sheet !== "build") return;
    const body = this.els["sheet-body"];
    const b = this.build;
    const tools: [BuildTool, string][] = [["furniture", "家具"], ["turn", "翻面"], ["mirror", "镜像"], ["room", "房间"], ["floor", "地板"], ["wall", "墙"], ["door", "门"], ["window", "窗"], ["erase", "拆除"]];
    let opts = "";
    let hint = "";
    if (b.tool === "furniture") {
      const cats = [...new Set(FURNITURE.map((f) => f.category))];
      opts = `<div class="chips-row">${cats.map((c) => `<button class="chip-btn ${this.furnCat === c ? "on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
        <div class="items">${FURNITURE.filter((f) => f.category === this.furnCat && f.id !== "stairs_down").map((f) => `<button class="item ${b.furniture === f.id ? "on" : ""}" data-furn="${f.id}">
          <span class="thumb" style="--c:${hexColor(f.color)}"><img alt="" src="${assetUrl("furniture", f.sprite ?? f.id)}" onerror="this.remove()"></span><span>${esc(f.name)}</span></button>`).join("")}</div>`;
      hint = this.furnCat === "楼梯"
        ? "把楼梯放在楼下，楼上同一个位置会自动出现楼梯口。点画面上方的「1F」切到楼上，接着铺地板、放房间；角色会自己走楼梯上下楼。也可以在「房间」里直接放一间楼梯间。"
        : this.furnCat === "冷暖"
        ? "天冷时角色会去开取暖器、钻被炉，天热时开空调。空调挂在墙上。"
        : this.furnCat === "墙饰" || this.furnCat === "节日"
        ? "墙饰点靠墙那一格就会挂到后墙上。室内墙默认是矮墙沿，挂上去看不到，可以挂在房子最外面的高墙上，或者在设置里把墙改成高墙。"
        : "点地板放下家具。";
    } else if (b.tool === "turn") {
      hint = "点一件家具，让它转过身背对镜头（再点一次转回来）。";
    } else if (b.tool === "mirror") {
      hint = "点一件家具，让它左右镜像翻过来，比如床头换到另一边（再点一次换回来）。";
    } else if (b.tool === "floor") {
      opts = `<div class="items">${FLOORS.map((f) => `<button class="item ${b.floor === f.id ? "on" : ""}" data-floor="${f.id}"><span class="thumb sq" style="--c:${hexColor(f.color)}"><img alt="" src="${asset("floors", f.texture)}" onerror="this.remove()"></span><span>${f.name}</span></button>`).join("")}</div>
        <div class="field-row"><label>房间名<input id="room-name" value="${esc(b.roomName)}" /></label><label class="check"><input type="checkbox" id="auto-walls" ${b.autoWalls ? "checked" : ""}/> 自动围墙</label></div>`;
      hint = "按住拖动铺一片地板。";
    } else if (b.tool === "wall" || b.tool === "door" || b.tool === "window") {
      opts = `<div class="items">${WALL_STYLES.map((w) => `<button class="item ${b.wallStyle === w.id ? "on" : ""}" data-wall="${w.id}"><span class="thumb sq" style="--c:${hexColor(w.color)}"><img alt="" src="${asset("walls", w.texture)}" onerror="this.remove()"></span><span>${w.name}</span></button>`).join("")}</div>`;
      hint = "点格子的边。再点一次已有的墙会拆掉。";
    } else if (b.tool === "room") {
      opts = `<div class="items">${ROOM_PRESETS.map((p) => `<button class="item wide ${b.room === p.id ? "on" : ""}" data-room="${p.id}"><span>${p.name}</span><small>${p.w}×${p.h}</small></button>`).join("")}</div>`;
      hint = "点一下放下整间房，会覆盖那片区域原有的东西。";
    } else {
      hint = "点家具、墙或地板把它拆掉。";
    }
    body.innerHTML = `<div class="sheet-head"><h2>建造</h2><button class="btn small primary" id="build-done">完成</button></div>
      <button class="plan-entry" id="open-plan"><span class="pe-ic">▦</span><span><b>户型设计（DIY 公寓）</b><small>在平面图上拼房间，一键生成整套房子</small></span></button>
      <div class="pack-row"><button class="btn small" id="hp-import">导入家具包 / 房间包</button><button class="btn small" id="hp-export">导出…</button><button class="btn small" id="hp-manage">管理自制</button></div>
      <div class="chips-row tools">${tools.map(([k, n]) => `<button class="chip-btn ${b.tool === k ? "on" : ""}" data-tool="${k}">${n}</button>`).join("")}</div>
      ${opts}<p class="hint">${hint} 两指拖动画面、捏合缩放。</p>`;
    const on = (sel: string, fn: (el: HTMLElement) => void) => body.querySelectorAll<HTMLElement>(sel).forEach((x) => (x.onclick = () => { fn(x); this.renderBuild(); }));
    on("[data-tool]", (x) => (b.tool = x.dataset.tool as BuildTool));
    on("[data-cat]", (x) => (this.furnCat = x.dataset.cat!));
    on("[data-furn]", (x) => (b.furniture = x.dataset.furn!));
    on("[data-floor]", (x) => (b.floor = x.dataset.floor!));
    on("[data-wall]", (x) => (b.wallStyle = x.dataset.wall!));
    on("[data-room]", (x) => (b.room = x.dataset.room!));
    body.querySelector<HTMLElement>("#build-done")!.onclick = () => this.closeSheet();
    body.querySelector<HTMLElement>("#open-plan")!.onclick = () => this.openPlanner();
    body.querySelector<HTMLElement>("#hp-import")!.onclick = () => this.homeFile().click();
    body.querySelector<HTMLElement>("#hp-export")!.onclick = (e) => this.homeExportMenu(e as MouseEvent);
    body.querySelector<HTMLElement>("#hp-manage")!.onclick = () => this.openHomeManager();
    const rn = body.querySelector<HTMLInputElement>("#room-name");
    if (rn) rn.oninput = () => (b.roomName = rn.value.trim() || "新房间");
    const aw = body.querySelector<HTMLInputElement>("#auto-walls");
    if (aw) aw.onchange = () => (b.autoWalls = aw.checked);
  }

  // ———————————————————— 户型设计 ————————————————————

  openPlanner() {
    const plan: Plan = planFromWorld(this.game.world);
    const p = this.page("");
    p.classList.add("planner");
    new Planner(p, plan, (final) => {
      applyPlan(this.game.world, final);
      // 角色挪到新房子里能站的地方，手上的事情作废
      for (const c of this.game.chars) {
        c.stopCurrent();
        c.queue = [];
        c.forcedUntil = 0;
        const t = this.game.world.randomTileIn(final.rooms.find((r) => r.kind === "living")?.name) ?? this.game.world.randomTileIn();
        if (t) c.d.pos = { x: t.x + 0.5, y: t.y + 0.5 };
        this.game.emit(c, "主人把整个家重新装修了一遍，房间和家具的位置都变了。", 2);
      }
      this.game.log("player", "按新的户型重新装修了整个家");
      this.game.changed();
      this.game.save();
      p.close();
      this.closeSheet();
      this.renderAll();
      this.onPlanApplied?.();
      this.flash("新户型已经生成好了");
    }, (t, ok) => this.confirm(t, ok), (t) => this.flash(t));
    p.querySelectorAll<HTMLElement>("[data-close]").forEach((b) => (b.onclick = () => p.close()));
  }

  // ———————————————————— 全屏页面、确认框、提示 ————————————————————

  /** 打开一个全屏页面。带 data-close 的按钮会关闭它。 */
  private page(html: string, onClose?: () => void) {
    const host = this.els["page-host"];
    const el = document.createElement("div") as HTMLDivElement & { close: () => void };
    el.className = "page";
    el.innerHTML = html;
    host.appendChild(el);
    requestAnimationFrame(() => el.classList.add("in"));
    const close = () => { el.classList.remove("in"); setTimeout(() => el.remove(), 220); onClose?.(); };
    el.querySelectorAll<HTMLElement>("[data-close]").forEach((b) => (b.onclick = close));
    el.close = close;
    return el;
  }

  confirm(text: string, ok: () => void) {
    const host = this.els["page-host"];
    const el = document.createElement("div");
    el.className = "dialog-bg";
    el.innerHTML = `<div class="dialog" role="dialog" aria-modal="true"><p>${esc(text)}</p><div class="dialog-btns"><button class="btn" id="no">取消</button><button class="btn primary" id="yes">确定</button></div></div>`;
    host.appendChild(el);
    el.querySelector<HTMLElement>("#no")!.onclick = () => el.remove();
    el.querySelector<HTMLElement>("#yes")!.onclick = () => { el.remove(); ok(); };
  }

  /** 屏幕上方的一句简短提示 */
  flash(text: string) {
    const host = this.els["toast-host"];
    host.innerHTML = `<div class="toast plain" role="status">${esc(text)}</div>`;
    const t = host.firstElementChild!;
    setTimeout(() => { if (host.contains(t)) host.innerHTML = ""; }, 2200);
  }

  /** 角色主动找主人说话 */
  toast(c: Character, text: string) {
    const host = this.els["toast-host"];
    host.innerHTML = `<button class="toast" role="status">${this.avatar(c.d, 34)}<span><b>${esc(c.name)}</b><br>${esc(text)}</span></button>`;
    const t = host.querySelector<HTMLElement>(".toast")!;
    t.onclick = () => { host.innerHTML = ""; this.openChat(c.id); };
    setTimeout(() => { if (host.contains(t)) host.innerHTML = ""; }, 8000);
    if (this.chatOpen === c.id) this.renderChatLog();
  }

  /** 把一份角色设定（AI 生成的）填进人设编辑页 */
  private fillEditor(p: HTMLElement, e: PackCharacter) {
    const set = (id: string, v: string | number | undefined) => { const el = p.querySelector<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>(id); if (el && v !== undefined) el.value = String(v); };
    const nameEl = p.querySelector<HTMLInputElement>("#e-name")!;
    if (!nameEl.value.trim()) nameEl.value = e.name;
    set("#e-persona", e.persona); set("#e-schedule", e.schedule);
    const pr = e.profile ?? {};
    set("#e-age", pr.age); set("#e-bday", pr.birthday ? `2000-${pr.birthday}` : undefined); set("#e-job", pr.job); set("#e-hobby", pr.hobbies);
    if (pr.likes || pr.dislikes) p.querySelectorAll<HTMLElement>(".taste-chip[data-food]").forEach((b) => {
      b.classList.remove("like", "dislike");
      if (pr.likes?.includes(b.dataset.food!)) b.classList.add("like"); else if (pr.dislikes?.includes(b.dataset.food!)) b.classList.add("dislike");
    });
    for (const [k, v] of Object.entries(e.traits ?? {})) set(`[data-trait="${k}"]`, v);
    const l = e.lore ?? {};
    set("#l-self", l.selfName); set("#l-call", l.callPlayer); set("#l-speech", l.speechStyle); set("#l-catch", l.catchphrases?.join("、"));
    set("#l-back", l.backstory); set("#l-goals", l.goals); set("#l-fears", l.fears); set("#l-lt", l.likesTopics); set("#l-dt", l.dislikesTopics);
    set("#l-habits", l.habits); set("#l-chrono", l.chronotype); set("#l-sick", l.sickBehavior); set("#l-conflict", l.conflictStyle);
    if (l.favoriteRoom) {
      const room = p.querySelector<HTMLSelectElement>("#l-room")!;
      if (![...room.options].some((o) => o.value === l.favoriteRoom)) room.add(new Option(l.favoriteRoom, l.favoriteRoom));
      room.value = l.favoriteRoom;
    }
    if (l.favoriteFurniture) p.querySelectorAll<HTMLElement>("[data-fav]").forEach((b) => b.classList.toggle("like", l.favoriteFurniture!.includes(b.dataset.fav!)));
    if (l.likedTags || l.dislikedTags) p.querySelectorAll<HTMLElement>("[data-ftag]").forEach((b) => {
      b.classList.toggle("like", !!l.likedTags?.includes(b.dataset.ftag!));
      b.classList.toggle("dislike", !!l.dislikedTags?.includes(b.dataset.ftag!));
    });
    set("#l-heat", l.heat);
    p.querySelector<HTMLDetailsElement>("details.more")!.open = true;
  }

  openEditor(c: Character | null) {
    const d: CharacterData = c ? c.d : newCharacter({ name: "", appearance: randomAppearance() });
    const a = d.appearance;
    const l = d.lore;
    const p = this.page(`
      <header class="page-head"><button class="icon-btn" data-close aria-label="返回">${icon("back")}</button><h2>${c ? "编辑" + esc(c.name) : "创建新角色"}</h2>
        <button class="btn small primary" id="e-save">${c ? "保存" : "搬进来"}</button></header>
      <div class="page-body">
        ${c ? "" : `<div class="import-card">
          <div><b>已经有角色包了？</b><span>导入就能直接搬进来，设定和立绘都在里面。</span></div>
          <button type="button" class="btn primary" id="e-import">从角色包导入</button>
          ${this.localPacks.length ? `<div class="local-packs">${this.localPacks.map((x, i) => `<button type="button" class="btn small" data-elocal="${i}">＋ ${esc(x.name)}</button>`).join("")}</div>` : ""}
        </div>
        <div class="or-line"><span>或者自己做一个</span></div>`}
        <div class="look-card">
          <div class="look-preview" id="e-look">${d.sprites ? `<img alt="" src="${spriteUrl(d.sprites, "avatar_normal.png")}">` : `<span>还没有形象</span>`}</div>
          <div class="look-side">
            <b>形象</b>
            <span id="e-look-help">${d.sprites ? "已经有立绘了，上传新图片会替换掉。" : "上传一张角色的图片，就会用它在家里走来走去。最好是全身、背景透明的图。"}</span>
            <label class="btn small primary file-btn">上传图片<input type="file" id="e-image" accept="image/*" hidden /></label>
            <label class="check"><input type="checkbox" id="e-nobg" /> 去掉纯色背景</label>
          </div>
        </div>
        <div class="ai-card">
          <b>让 AI 帮你写设定</b>
          <span>告诉 AI 你想做谁，它会写好人设、作息、性格和更多设定，填进下面的表格，你再改。</span>
          <textarea id="e-ai-ask" placeholder="例如：《世界计划》里的宵崎奏；或者：一个爱睡懒觉、嘴硬心软的猫系大学生"></textarea>
          <button type="button" class="btn primary" id="e-ai-go">生成设定</button>
          <div class="help" id="e-ai-status">${this.brain.hasAI ? "" : "需要先在「设置」里接上 AI（Claude、DeepSeek 等）才能用。"}</div>
        </div>
        <div class="field"><label for="e-name">名字</label><input id="e-name" value="${esc(d.name)}" maxlength="12" /></div>
        <div class="field"><label for="e-persona">性格 / 人设</label>
          <div class="help">AI 会按这段文字来扮演 TA。写得越具体，TA 越像一个真实的人：年龄职业、性格、说话方式、喜好、和其他人的关系。</div>
          <textarea id="e-persona" placeholder="${esc(PERSONA_TEMPLATE)}">${esc(d.persona)}</textarea></div>
        <div class="field"><label for="e-schedule">作息表</label>
          <div class="help">每行一条，格式像「07:30 起床」。到点时 TA 会收到提醒，AI 决定要不要照做。</div>
          <textarea id="e-schedule" placeholder="${esc(SCHEDULE_TEMPLATE)}">${esc(d.schedule)}</textarea>
          <button type="button" class="btn small" id="e-fill">填入示例作息</button></div>
        <h3 class="group">基本资料</h3>
        <div class="grid2">
          <div class="field"><label for="e-age">年龄</label><input id="e-age" type="number" inputmode="numeric" min="1" max="120" value="${d.profile.age}" /></div>
          <div class="field"><label for="e-bday">生日</label><input id="e-bday" type="date" value="${d.profile.birthday ? "2000-" + d.profile.birthday : ""}" /></div>
        </div>
        <div class="field"><label for="e-job">职业</label><input id="e-job" value="${esc(d.profile.job)}" placeholder="例如：插画师、大学生" /></div>
        <div class="field"><label for="e-hobby">爱好</label><input id="e-hobby" value="${esc(d.profile.hobbies)}" placeholder="例如：打游戏、做饭" /></div>
        <div class="field"><label>口味</label><div class="help">点一下是喜欢（❤），再点一下是不爱吃（✕），再点取消。吃到喜欢的会特别开心。</div>
          <div class="taste">${FOODS.map((f) => { const st = d.profile.likes.includes(f.id) ? "like" : d.profile.dislikes.includes(f.id) ? "dislike" : ""; return `<button type="button" class="taste-chip ${st}" data-food="${f.id}">${esc(f.name)}</button>`; }).join("")}</div></div>
        <details class="more">
          <summary>更多设定（可选）<span>称呼、说话方式、背景故事、生病时的样子……写得越多越像 TA</span></summary>
          <div class="grid2">
            <div class="field"><label for="l-self">TA 怎么称呼自己</label><input id="l-self" value="${esc(l.selfName)}" maxlength="10" placeholder="例如：我、本小姐" /></div>
            <div class="field"><label for="l-call">TA 怎么称呼你</label><input id="l-call" value="${esc(l.callPlayer)}" maxlength="10" placeholder="例如：主人、你" /></div>
          </div>
          <div class="field"><label for="l-speech">说话方式</label><input id="l-speech" value="${esc(l.speechStyle)}" placeholder="例如：句子很短，不爱用感叹号" /></div>
          <div class="field"><label for="l-catch">口头禅</label><input id="l-catch" value="${esc(l.catchphrases.join("、"))}" placeholder="用顿号或逗号隔开，偶尔才会说" /></div>
          <div class="field"><label for="l-back">背景故事</label><textarea id="l-back" style="min-height:70px" placeholder="TA 从哪里来，经历过什么">${esc(l.backstory)}</textarea></div>
          <div class="grid2">
            <div class="field"><label for="l-goals">目标 / 愿望</label><input id="l-goals" value="${esc(l.goals)}" /></div>
            <div class="field"><label for="l-fears">害怕的东西</label><input id="l-fears" value="${esc(l.fears)}" /></div>
            <div class="field"><label for="l-lt">喜欢聊的话题</label><input id="l-lt" value="${esc(l.likesTopics)}" /></div>
            <div class="field"><label for="l-dt">不想聊的话题</label><input id="l-dt" value="${esc(l.dislikesTopics)}" /></div>
          </div>
          <div class="field"><label for="l-habits">生活习惯</label><input id="l-habits" value="${esc(l.habits)}" placeholder="例如：睡前一定要喝热牛奶" /></div>
          <div class="grid2">
            <div class="field"><label for="l-chrono">作息类型</label><select id="l-chrono">${(Object.keys(CHRONOTYPE_CN) as Lore["chronotype"][]).map((k) => `<option value="${k}" ${l.chronotype === k ? "selected" : ""}>${CHRONOTYPE_CN[k]}</option>`).join("")}</select></div>
            <div class="field"><label for="l-sick">生病时</label><select id="l-sick">${(Object.keys(SICK_CN) as Lore["sickBehavior"][]).map((k) => `<option value="${k}" ${l.sickBehavior === k ? "selected" : ""}>${SICK_CN[k]}</option>`).join("")}</select></div>
          </div>
          <div class="field"><label for="l-conflict">吵架时会怎样</label><input id="l-conflict" value="${esc(l.conflictStyle)}" placeholder="例如：冷战，过一会儿自己来道歉" /></div>
          <div class="field"><label for="l-room">最喜欢待的房间</label><select id="l-room"><option value="">没有特别喜欢的</option>${[...new Set([...this.game.world.rooms(), l.favoriteRoom].filter(Boolean))].map((r) => `<option ${l.favoriteRoom === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select></div>
          <div class="field"><label>最喜欢的家具</label><div class="help">选中的家具 TA 会更常去用。</div>
            <div class="taste">${FURNITURE.filter((f) => f.interactions.some((i) => i.id !== "toggle")).map((f) => `<button type="button" class="taste-chip fav ${l.favoriteFurniture.includes(f.id) ? "like" : ""}" data-fav="${f.id}">${esc(f.name)}</button>`).join("")}</div></div>
          <div class="field"><label for="l-heat">怕冷还是怕热</label><select id="l-heat">${[["normal", "普通"], ["cold", "怕冷"], ["hot", "怕热"]].map(([k, n]) => `<option value="${k}" ${l.heat === k ? "selected" : ""}>${n}</option>`).join("")}</select></div>
          <div class="field"><label>喜欢的家具风格</label><div class="help">点一下是喜欢（❤），再点是讨厌（✕），再点取消。用到、待在有这些标签的家具旁边时心情会变好（或变差），也更常去用。</div>
            ${TAG_GROUPS.map((g) => `<div class="tag-group"><small>${g.name}</small><div class="taste">${g.tags.map((t) => `<button type="button" class="taste-chip ${l.likedTags.includes(t) ? "like" : l.dislikedTags.includes(t) ? "dislike" : ""}" data-ftag="${t}">${t}</button>`).join("")}</div></div>`).join("")}</div>
          <div class="field"><label for="l-rel">和其他角色的初始关系</label><div class="help">每行一条：名字 | 好感（-100～100）| 备注。家里有这个人时才生效。</div>
            <textarea id="l-rel" style="min-height:60px" placeholder="阿槐 | 40 | 从小一起长大">${esc(l.presetRelations.map((r) => `${r.name} | ${r.affinity} | ${r.note}`).join("\n"))}</textarea></div>
          <div class="field"><label for="l-custom">其他设定</label><div class="help">每行一条「名称：内容」，想写什么都可以，会原样告诉 AI。</div>
            <textarea id="l-custom" style="min-height:60px" placeholder="画风：水彩">${esc(l.custom.map((x) => `${x.key}：${x.value}`).join("\n"))}</textarea></div>
        </details>
        <h3 class="group">性格</h3>
        <div class="help" style="margin-bottom:8px">性格会影响需求变化的快慢，也会告诉 AI 这个角色是什么样的人。</div>
        ${(Object.keys(TRAIT_CN) as (keyof Traits)[]).map((k) => `<div class="slider"><span>${TRAIT_CN[k][1]}</span><input type="range" min="0" max="100" step="5" data-trait="${k}" value="${d.traits[k]}" aria-label="${TRAIT_CN[k][1]}到${TRAIT_CN[k][2]}" /><span>${TRAIT_CN[k][2]}</span></div>`).join("")}
        <h3 class="group">外观</h3>
        <div class="field"><label>占位小人的颜色（以后会换成角色包）</label>
          <div class="colors">
            ${[["skin", "肤色"], ["hair", "发色"], ["outfit", "衣服"], ["accent", "点缀"], ["eyes", "瞳色"]].map(([k, n]) => `<label>${n}<input type="color" data-color="${k}" value="${(a as unknown as Record<string, string>)[k]}" /></label>`).join("")}
            <label>发型<select id="e-hair">${["短发", "长发", "短发+发饰", "马尾"].map((n, i) => `<option value="${i}" ${a.hairStyle === i ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          </div></div>
        ${c ? `<button type="button" class="btn block" id="e-export">导出成角色包文件</button><div class="help" style="text-align:center;margin-top:6px">导出的是设定（不含聊天和记忆），可以发给别人或换设备导入。</div>` : ""}
      </div>`);
    const $ = <T extends HTMLElement>(s: string) => p.querySelector<T>(s)!;
    $("#e-fill").onclick = () => { $<HTMLTextAreaElement>("#e-schedule").value = SCHEDULE_TEMPLATE; };
    if (!c) {
      $("#e-import").onclick = () => { this.afterImport = () => p.close(); this.packFile().click(); };
      p.querySelectorAll<HTMLElement>("[data-elocal]").forEach((b) => (b.onclick = async () => {
        const item = this.localPacks[Number(b.dataset.elocal)];
        try {
          const r = await fetch(`packs/${item.file}`);
          if (!r.ok) throw new Error(String(r.status));
          this.afterImport = () => p.close();
          await this.applyPack(await r.json());
        } catch { this.flash(`读取 ${item.file} 失败`); }
      }));
    }
    p.querySelectorAll<HTMLElement>("[data-fav]").forEach((b) => (b.onclick = () => b.classList.toggle("like")));
    p.querySelectorAll<HTMLElement>("[data-ftag]").forEach((b) => (b.onclick = () => {
      if (b.classList.contains("like")) { b.classList.remove("like"); b.classList.add("dislike"); }
      else if (b.classList.contains("dislike")) b.classList.remove("dislike");
      else b.classList.add("like");
    }));
    // —— 上传图片 ——
    let upload: UploadResult | null = null;
    const runUpload = async () => {
      const f = $<HTMLInputElement>("#e-image").files?.[0];
      if (!f) return;
      $("#e-look-help").textContent = "正在处理图片…";
      try {
        upload = await processUpload(f, $<HTMLInputElement>("#e-nobg").checked);
        $("#e-look").innerHTML = `<img alt="" src="${upload.preview}">`;
        $("#e-look-help").textContent = "好了。只有一张图时，TA 的心情会用头顶的小标记表示，比如开心时冒出带爱心的气泡、生气时出现红色的青筋。";
      } catch {
        $("#e-look-help").textContent = "这张图片读不出来，换一张试试。";
      }
    };
    $<HTMLInputElement>("#e-image").onchange = runUpload;
    $<HTMLInputElement>("#e-nobg").onchange = () => { if ($<HTMLInputElement>("#e-image").files?.length) void runUpload(); };
    // —— 让 AI 写设定 ——
    let aiSkills: Partial<Skills> | null = null;
    $("#e-ai-go").onclick = async () => {
      const ask = $<HTMLTextAreaElement>("#e-ai-ask").value.trim();
      const status = $("#e-ai-status");
      if (!ask) { $<HTMLTextAreaElement>("#e-ai-ask").focus(); return; }
      if (!this.brain.hasAI) { status.textContent = "需要先在「设置」里接上 AI（Claude、DeepSeek 等）才能用。"; return; }
      const btn = $<HTMLButtonElement>("#e-ai-go");
      btn.disabled = true; btn.textContent = "生成中…"; status.textContent = "AI 正在写，大概要十几秒到一分钟。";
      try {
        const raw = await this.brain.generateCharacter(ask);
        const e = cleanEntry((raw ?? {}) as Record<string, unknown>);
        if (!e) throw new Error("AI 没有给出角色");
        this.fillEditor(p, e);
        aiSkills = e.skills ?? null;
        status.textContent = "写好了，往下看看，不满意的地方直接改。";
      } catch (err) {
        status.textContent = `没有生成成功：${err instanceof Error ? err.message : String(err)}`;
      } finally { btn.disabled = false; btn.textContent = "重新生成"; }
    };
    if (c) $("#e-export").onclick = () => this.downloadPack([c.d], c.name);
    p.querySelectorAll<HTMLElement>(".taste-chip[data-food]").forEach((b) => (b.onclick = () => {
      const st = b.classList.contains("like") ? "dislike" : b.classList.contains("dislike") ? "" : "like";
      b.classList.remove("like", "dislike");
      if (st) b.classList.add(st);
    }));
    $("#e-save").onclick = () => {
      const name = $<HTMLInputElement>("#e-name").value.trim();
      if (!name) { $<HTMLInputElement>("#e-name").focus(); return; }
      d.name = name;
      d.persona = $<HTMLTextAreaElement>("#e-persona").value.trim();
      d.schedule = $<HTMLTextAreaElement>("#e-schedule").value.trim();
      p.querySelectorAll<HTMLInputElement>("[data-color]").forEach((i) => ((a as unknown as Record<string, string>)[i.dataset.color!] = i.value));
      a.hairStyle = Number($<HTMLSelectElement>("#e-hair").value);
      d.profile.age = Math.max(1, Number($<HTMLInputElement>("#e-age").value) || d.profile.age);
      const bd = $<HTMLInputElement>("#e-bday").value;
      d.profile.birthday = bd ? bd.slice(5) : "";
      d.profile.job = $<HTMLInputElement>("#e-job").value.trim();
      d.profile.hobbies = $<HTMLInputElement>("#e-hobby").value.trim();
      d.profile.likes = [...p.querySelectorAll<HTMLElement>(".taste-chip[data-food].like")].map((x) => x.dataset.food!);
      d.profile.dislikes = [...p.querySelectorAll<HTMLElement>(".taste-chip[data-food].dislike")].map((x) => x.dataset.food!);
      p.querySelectorAll<HTMLInputElement>("[data-trait]").forEach((i) => (d.traits[i.dataset.trait as keyof Traits] = Number(i.value)));
      if (aiSkills) d.skills = { ...d.skills, ...aiSkills };
      const v = (id: string) => $<HTMLInputElement>(id).value.trim();
      l.selfName = v("#l-self"); l.callPlayer = v("#l-call"); l.speechStyle = v("#l-speech");
      l.catchphrases = v("#l-catch").split(/[、,，\n]+/).map((x) => x.trim()).filter(Boolean).slice(0, 10);
      l.backstory = v("#l-back"); l.goals = v("#l-goals"); l.fears = v("#l-fears");
      l.likesTopics = v("#l-lt"); l.dislikesTopics = v("#l-dt"); l.habits = v("#l-habits"); l.conflictStyle = v("#l-conflict");
      l.chronotype = v("#l-chrono") as Lore["chronotype"]; l.sickBehavior = v("#l-sick") as Lore["sickBehavior"];
      l.favoriteRoom = v("#l-room");
      l.favoriteFurniture = [...p.querySelectorAll<HTMLElement>("[data-fav].like")].map((x) => x.dataset.fav!);
      l.likedTags = [...p.querySelectorAll<HTMLElement>("[data-ftag].like")].map((x) => x.dataset.ftag!);
      l.dislikedTags = [...p.querySelectorAll<HTMLElement>("[data-ftag].dislike")].map((x) => x.dataset.ftag!);
      l.heat = v("#l-heat") as Lore["heat"];
      l.presetRelations = v("#l-rel").split("\n").map((line) => line.split(/[|｜]/).map((x) => x.trim())).filter((q) => q[0])
        .map(([name, aff, note]) => ({ name, affinity: Math.max(-100, Math.min(100, Number(aff) || 0)), note: note ?? "" }));
      l.custom = v("#l-custom").split("\n").map((line) => line.split(/[:：]/)).filter((q) => q[0]?.trim())
        .map(([key, ...rest]) => ({ key: key.trim(), value: rest.join("：").trim() }));
      // 初始关系：对家里已有的人立刻生效（不覆盖已经玩出来的关系）
      for (const r of l.presetRelations) {
        const o = this.game.chars.find((x) => x.name === r.name && x.d !== d);
        const cur = o && d.relations[o.id];
        if (o && (!cur || (cur.affinity === 0 && cur.note === "刚认识"))) d.relations[o.id] = { affinity: r.affinity, note: r.note };
      }
      if (upload) {
        const id = `u${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
        void saveSprites(id, upload.files).then(() => { d.sprites = id; this.renderAll(); this.game.save(); });
      }
      p.close();
      if (c) {
        this.game.log("player", `修改了${name}的人设`);
        this.game.emit(c, "主人更新了你的人设或作息，之后按新的来。", 1);
        this.renderAll();
      } else {
        const t = this.game.world.randomTileIn() ?? { x: 2, y: 2 };
        d.pos = { x: t.x + 0.5, y: t.y + 0.5 };
        const nc = this.game.addCharacter(d);
        this.renderRoster();
        this.select(nc.id);
      }
    };
  }

  openSettings() {
    const s = this.game.settings;
    const ai = s.ai;
    const p = this.page(`
      <header class="page-head"><button class="icon-btn" data-close aria-label="返回">${icon("back")}</button><h2>设置</h2><button class="btn small primary" id="s-save">保存</button></header>
      <div class="page-body">
        <h3 class="group">AI</h3>
        <div class="field"><label for="s-provider">AI 服务</label>
          <select id="s-provider">
            <option value="mock" ${ai.provider === "mock" ? "selected" : ""}>本地模拟（不联网、不花钱）</option>
            <option value="anthropic" ${ai.provider === "anthropic" ? "selected" : ""}>Claude（Anthropic 官方 API）</option>
            <option value="deepseek" ${ai.provider === "deepseek" ? "selected" : ""}>DeepSeek</option>
            <option value="openai" ${ai.provider === "openai" ? "selected" : ""}>其他兼容 OpenAI 格式的服务</option>
          </select><div class="help" id="s-provider-help"></div></div>
        <div class="field"><label for="s-key">API Key</label><input id="s-key" type="password" value="${esc(ai.apiKey)}" autocomplete="off" />
          <div class="help">只保存在这台设备上，只会发给你选择的 AI 服务。</div></div>
        <div class="field" id="s-base-wrap"><label for="s-base">服务地址</label><input id="s-base" value="${esc(ai.baseUrl)}" inputmode="url" /><div class="help">例如 https://api.deepseek.com/v1</div></div>
        <div class="field"><label for="s-fast">日常行为用的模型</label><input id="s-fast" value="${esc(ai.fastModel)}" /><div class="help">调用最频繁，建议用便宜快速的</div></div>
        <div class="field"><label for="s-chat">聊天用的模型</label><input id="s-chat" value="${esc(ai.chatModel)}" /></div>
        <div class="grid2">
          <div class="field"><label for="s-rate">每分钟最多调用</label><input id="s-rate" type="number" inputmode="numeric" min="1" max="60" value="${ai.maxCallsPerMinute}" /></div>
          <div class="field"><label for="s-interval">闲下来多久问 AI（秒）</label><input id="s-interval" type="number" inputmode="numeric" min="10" max="3600" value="${ai.decisionInterval}" /></div>
        </div>
        <h3 class="group">长期记忆（向量模型）</h3>
        <div class="help" style="margin-bottom:8px">每个角色有自己的知识库。填上向量模型后，聊天时会按意思找出相关的记忆，比按文字找更准。要用兼容 OpenAI 的 /embeddings 接口，比如硅基流动（https://api.siliconflow.cn/v1，模型 BAAI/bge-m3）或 OpenAI（text-embedding-3-small）。DeepSeek 没有向量模型。地址留空就按文字相似度找。</div>
        <div class="field"><label for="s-ebase">向量模型地址</label><input id="s-ebase" value="${esc(ai.embedBaseUrl)}" inputmode="url" placeholder="https://api.siliconflow.cn/v1" /></div>
        <div class="grid2">
          <div class="field"><label for="s-emodel">模型名</label><input id="s-emodel" value="${esc(ai.embedModel)}" /></div>
          <div class="field"><label for="s-ekey">Key（和上面一样就留空）</label><input id="s-ekey" type="password" value="${esc(ai.embedKey)}" autocomplete="off" /></div>
        </div>
        <h3 class="group">天气</h3>
        <div class="help" style="margin-bottom:8px">自动：按你的位置查天气预报（Open-Meteo），下雨下雪、气温会跟着变，角色会觉得冷或热。不想开定位可以填城市名。</div>
        <div class="field"><label for="s-wmode">天气来源</label><select id="s-wmode"><option value="auto" ${s.weather.mode === "auto" ? "selected" : ""}>自动（按位置的天气预报）</option><option value="manual" ${s.weather.mode === "manual" ? "selected" : ""}>手动</option></select></div>
        <div id="s-wauto" ${s.weather.mode === "auto" ? "" : "hidden"}>
          <div class="pack-row"><button type="button" class="btn small primary" id="s-locate">用手机定位</button><span class="help" id="s-wplace">${s.weather.place ? `现在：${esc(s.weather.place)}` : s.weather.lat != null ? `现在：${s.weather.lat}, ${s.weather.lon}` : "还没定位"}</span></div>
          <div class="field"><label for="s-city">或者填城市</label><div class="pack-row"><input id="s-city" placeholder="例如：上海" style="flex:1" /><button type="button" class="btn small" id="s-citygo">查找</button></div></div>
        </div>
        <div id="s-wman" class="grid2" ${s.weather.mode === "manual" ? "" : "hidden"}>
          <div class="field"><label for="s-wkind">天气</label><select id="s-wkind">${(Object.keys(WEATHER_CN) as WeatherKind[]).map((k) => `<option value="${k}" ${s.weather.manual === k ? "selected" : ""}>${WEATHER_CN[k]}</option>`).join("")}</select></div>
          <div class="field"><label for="s-wtemp">室外温度（°C）</label><input id="s-wtemp" type="number" inputmode="numeric" min="-40" max="50" value="${s.weather.manualTemp}" /></div>
        </div>
        <h3 class="group">新闻</h3>
        <label class="switch"><input type="checkbox" id="s-news" ${s.news.enabled ? "checked" : ""} /><span>角色看电视、上网时能看到真实新闻</span></label>
        <div class="field"><label for="s-feeds">新闻来源（每行：名称 | 分类 | RSS 地址）</label>
          <textarea id="s-feeds" style="min-height:80px">${esc(s.news.feeds.map((f) => `${f.name} | ${f.category} | ${f.url}`).join("\n"))}</textarea></div>
        <div class="field"><label for="s-block">屏蔽词（逗号分隔）</label><input id="s-block" value="${esc(s.news.blockedWords.join("，"))}" /></div>
        <h3 class="group">外观</h3>
        <div class="field"><label>配色</label>
          <div class="palette-pick">${PALETTES.map(([id, name, c]) => `<button type="button" class="pal ${s.look.palette === id ? "on" : ""}" data-pal="${id}" style="--c:${c}" aria-label="${name}"><i></i><span>${name}</span></button>`).join("")}</div></div>
        <div class="field"><label for="s-mode">深色模式</label>
          <select id="s-mode">${[["light", "浅色"], ["dark", "深色"], ["system", "跟随手机系统"], ["time", "跟随时间（天黑后自动变深色）"]].map(([v, n]) => `<option value="${v}" ${s.look.mode === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="field"><label for="s-names">画面上的名字</label>
          <select id="s-names">${[["none", "不显示"], ["selected", "只显示选中的人"], ["all", "全部显示（跟着画面一起缩放）"]].map(([v, n]) => `<option value="${v}" ${s.look.names === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <label class="switch"><input type="checkbox" id="s-tint" ${s.look.timeTint ? "checked" : ""} /><span>界面颜色跟着时间变化（清晨偏粉、傍晚偏橙、夜里偏蓝）</span></label>
        <h3 class="group">手机</h3>
        <div class="help" style="margin-bottom:8px">安卓版才有用。你没在看的时候，角色会按时间和自己的状态给你发消息，消息会变成手机通知，点通知能直接聊天，也能在通知里回复。</div>
        <label class="switch"><input type="checkbox" id="s-keep" ${s.phone.keepAlive ? "checked" : ""} /><span>后台常驻（通知栏会有一条常驻消息，角色在你不看的时候也照常生活）</span></label>
        <div class="field"><label for="s-pro">角色主动发消息</label>
          <select id="s-pro">${[["off", "不发"], ["low", "少一点（同一个人至少隔 4 小时）"], ["normal", "正常（至少隔 2 小时）"], ["high", "多一点（至少隔 1 小时）"]].map(([v, n]) => `<option value="${v}" ${s.phone.proactive === v ? "selected" : ""}>${n}</option>`).join("")}</select></div>
        <div class="grid2">
          <div class="field"><label for="s-qs">免打扰从几点</label><input id="s-qs" type="number" inputmode="numeric" min="0" max="23" value="${s.phone.quietStart}" /></div>
          <div class="field"><label for="s-qe">到几点</label><input id="s-qe" type="number" inputmode="numeric" min="0" max="23" value="${s.phone.quietEnd}" /></div>
        </div>
        <div class="help">两个数一样表示不设免打扰。</div>
        ${this.permissions ? `<button type="button" class="btn primary block" id="s-perm-all">一键获取权限</button><div class="help">依次弹出通知、不受省电限制等系统授权窗口，选「允许」就好。</div>
        <button type="button" class="btn block" id="s-perm" style="margin-top:8px">查看各项权限</button><div class="help">逐项检查有没有开好，包括要手动打开的「自启动」。</div>` : ""}
        <h3 class="group">日志</h3>
        <button type="button" class="btn block" id="s-log">查看和导出日志</button>
        <div class="help">AI 出错、程序报错时会记在这里，导出来发给开发者就能查原因。不会记 API Key 和聊天内容。</div>
        <h3 class="group">画面和测试</h3>
        <label class="switch"><input type="checkbox" id="s-walls" ${s.wallMode === "full" ? "checked" : ""} /><span>房间之间的墙显示成高墙</span></label>
        <div class="field"><label for="s-hour">画面时间</label>
          <select id="s-hour">${[["", "跟着现实时间"], ["6", "日出（6 点）"], ["9", "上午（9 点）"], ["12.5", "正午（12 点半）"], ["17.6", "傍晚（5 点半）"], ["18.8", "黄昏（7 点）"], ["21", "夜晚（9 点）"], ["2", "深夜（2 点）"]].map(([v, n]) => `<option value="${v}" ${String(s.previewHour ?? "") === v ? "selected" : ""}>${n}</option>`).join("")}</select>
          <div class="help">只改画面的天色和灯光，用来预览；角色的作息、节日还是按现实时间。</div></div>
        <div class="field"><label for="s-scale">时间倍率（测试用）</label><input id="s-scale" type="number" inputmode="numeric" min="1" max="600" value="${s.timeScale}" />
          <div class="help">1 = 和现实同步。调大后饥饿、困倦和动作时长都会加快；作息和节日仍按现实时钟。</div></div>
        <button class="btn danger block" id="s-reset">重置存档</button>
      </div>`, () => this.applyLook()); // 没保存就关掉：恢复原来的配色
    const $ = <T extends HTMLElement>(sel: string) => p.querySelector<T>(sel)!;
    const HELP: Record<string, string> = {
      mock: "不调用任何 AI，角色按本地规则生活。",
      anthropic: "在 console.anthropic.com 申请 API Key。",
      deepseek: "在 platform.deepseek.com 申请 API Key。日常行为建议用 deepseek-chat；聊天想让 TA 想得更深，可以换成 deepseek-reasoner（更慢）。",
      openai: "通义、Kimi、本地 Ollama 等，填对服务地址和模型名就行。",
    };
    const syncBase = () => {
      const v = $<HTMLSelectElement>("#s-provider").value;
      $("#s-base-wrap").hidden = v !== "openai" && v !== "deepseek";
      $("#s-provider-help").textContent = HELP[v] ?? "";
    };
    syncBase();
    $<HTMLSelectElement>("#s-provider").onchange = () => {
      syncBase();
      const v = $<HTMLSelectElement>("#s-provider").value;
      const def = defaultSettings().ai;
      const fast = $<HTMLInputElement>("#s-fast"), chat = $<HTMLInputElement>("#s-chat"), base = $<HTMLInputElement>("#s-base");
      if (v === "anthropic" && !/^claude/.test(fast.value)) { fast.value = def.fastModel; chat.value = def.chatModel; }
      if (v === "deepseek") {
        if (!/deepseek/.test(base.value)) base.value = DEEPSEEK_BASE;
        if (!/^deepseek/.test(fast.value)) fast.value = "deepseek-chat";
        if (!/^deepseek/.test(chat.value)) chat.value = "deepseek-chat";
      }
    };
    p.querySelector<HTMLElement>("#s-perm")?.addEventListener("click", () => this.openPermissionGuide(false));
    $("#s-log").onclick = () => this.openLog();
    p.querySelector<HTMLElement>("#s-perm-all")?.addEventListener("click", async (ev) => {
      const b = ev.currentTarget as HTMLButtonElement;
      b.disabled = true; b.textContent = "正在获取…";
      try { await this.permissions?.requestAll(); this.flash("好了。「自启动」系统不让直接弹窗，可以在「查看各项权限」里按提示打开"); }
      finally { b.disabled = false; b.textContent = "一键获取权限"; }
    });
    // 点配色立刻预览
    p.querySelectorAll<HTMLElement>(".pal").forEach((b) => (b.onclick = () => {
      p.querySelectorAll(".pal").forEach((x) => x.classList.remove("on"));
      b.classList.add("on");
      document.documentElement.dataset.palette = b.dataset.pal!;
    }));
    $<HTMLSelectElement>("#s-mode").onchange = () => { const old = s.look.mode; s.look.mode = $<HTMLSelectElement>("#s-mode").value as typeof s.look.mode; this.applyLook(); s.look.mode = old; };
    $<HTMLSelectElement>("#s-wmode").onchange = () => {
      const auto = $<HTMLSelectElement>("#s-wmode").value === "auto";
      $("#s-wauto").hidden = !auto; $("#s-wman").hidden = auto;
    };
    const setPlace = (lat: number, lon: number, place?: string) => {
      s.weather.lat = lat; s.weather.lon = lon; s.weather.place = place;
      $("#s-wplace").textContent = `现在：${place ?? `${lat}, ${lon}`}`;
    };
    $("#s-locate").onclick = async () => {
      $("#s-wplace").textContent = "定位中…";
      const pos = await locate();
      if (!pos) { $("#s-wplace").textContent = "没拿到位置（没给定位权限？可以填城市）"; return; }
      setPlace(pos.lat, pos.lon, "当前位置");
    };
    $("#s-citygo").onclick = async () => {
      const name = $<HTMLInputElement>("#s-city").value.trim();
      if (!name) return;
      $("#s-wplace").textContent = "查找中…";
      const g = await geocode(name);
      if (!g) { $("#s-wplace").textContent = "没找到这个城市"; return; }
      setPlace(g.lat, g.lon, g.place);
    };
    $("#s-reset").onclick = () => this.confirm("会删除所有角色、房子和聊天记录，恢复成初始状态。确定吗？", () => { Game.wipe(); location.reload(); });
    $("#s-save").onclick = () => {
      ai.provider = $<HTMLSelectElement>("#s-provider").value as typeof ai.provider;
      ai.apiKey = $<HTMLInputElement>("#s-key").value.trim();
      ai.baseUrl = $<HTMLInputElement>("#s-base").value.trim();
      ai.fastModel = $<HTMLInputElement>("#s-fast").value.trim();
      ai.chatModel = $<HTMLInputElement>("#s-chat").value.trim();
      ai.maxCallsPerMinute = Math.max(1, Number($<HTMLInputElement>("#s-rate").value) || 6);
      ai.decisionInterval = Math.max(10, Number($<HTMLInputElement>("#s-interval").value) || 90);
      ai.embedBaseUrl = $<HTMLInputElement>("#s-ebase").value.trim();
      ai.embedModel = $<HTMLInputElement>("#s-emodel").value.trim() || "BAAI/bge-m3";
      ai.embedKey = $<HTMLInputElement>("#s-ekey").value.trim();
      s.weather.mode = $<HTMLSelectElement>("#s-wmode").value as typeof s.weather.mode;
      s.weather.manual = $<HTMLSelectElement>("#s-wkind").value as WeatherKind;
      s.weather.manualTemp = Math.max(-40, Math.min(50, Number($<HTMLInputElement>("#s-wtemp").value) || 22));
      void this.game.refreshWeather(true);
      s.news.enabled = $<HTMLInputElement>("#s-news").checked;
      s.news.feeds = $<HTMLTextAreaElement>("#s-feeds").value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((q) => q.length >= 3 && q[2]).map(([name, category, url]) => ({ name, category, url }));
      s.news.blockedWords = $<HTMLInputElement>("#s-block").value.split(/[,，\s]+/).filter(Boolean);
      s.wallMode = $<HTMLInputElement>("#s-walls").checked ? "full" : "cutaway";
      const ph = $<HTMLSelectElement>("#s-hour").value;
      s.previewHour = ph === "" ? null : Number(ph);
      s.timeScale = Math.min(600, Math.max(1, Number($<HTMLInputElement>("#s-scale").value) || 1));
      s.look.mode = $<HTMLSelectElement>("#s-mode").value as typeof s.look.mode;
      s.look.timeTint = $<HTMLInputElement>("#s-tint").checked;
      s.look.names = $<HTMLSelectElement>("#s-names").value as typeof s.look.names;
      const pal = p.querySelector<HTMLElement>(".pal.on")?.dataset.pal;
      if (pal) s.look.palette = pal as typeof s.look.palette;
      this.applyLook();
      s.phone.keepAlive = $<HTMLInputElement>("#s-keep").checked;
      s.phone.proactive = $<HTMLSelectElement>("#s-pro").value as typeof s.phone.proactive;
      const hr = (id: string, dflt: number) => { const v = Number($<HTMLInputElement>(id).value); return Number.isFinite(v) ? Math.min(23, Math.max(0, Math.round(v))) : dflt; };
      s.phone.quietStart = hr("#s-qs", 0); s.phone.quietEnd = hr("#s-qe", 8);
      this.game.newsFetchedAt = 0;
      p.close();
      this.onSettingsChanged?.();
      this.onSettingsSaved?.();
      this.game.save();
      this.renderTop();
      this.flash("设置已保存");
    };
  }
}
