// 手机界面：竖屏。顶部状态栏 + 视角切换，中间是房子，底部是角色头像条和导航栏。
// 角色详情、建造、动态从底部弹出（抽屉）；聊天、设置、编辑角色是全屏页面。
// 电脑上运行时，整个游戏显示在屏幕中央一个手机大小的框里。
import type { Brain } from "../ai/brain";
import { EMOTION_CN, NEED_CN, NEED_ORDER, SKILL_CN, TRAIT_CN, type CharacterData, type Needs, type Skills, type Traits } from "../core/types";
import { describeNow, hhmm } from "../core/time";
import type { Character } from "../sim/character";
import { PERSONA_TEMPLATE, SCHEDULE_TEMPLATE, defaultSettings, newCharacter, randomAppearance } from "../sim/defaults";
import { Game } from "../sim/game";
import { FLOORS, FOODS, FURNITURE, WALL_STYLES } from "../world/catalog";
import { ROOM_PRESETS } from "../world/presets";
import { applyPlan, planFromWorld, type Plan } from "../world/floorplan";
import { Planner } from "./planner";

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

export type BuildTool = "floor" | "wall" | "door" | "window" | "furniture" | "turn" | "room" | "erase";

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
  private els: Record<string, HTMLElement> = {};
  onSelect?: (id: string | null) => void;
  /** 视角切换：全景、某个房间、前后切换 */
  onView?: (v: { mode: "all" } | { mode: "room"; name: string } | { mode: "step"; dir: 1 | -1 }) => void;
  view: { mode: "all" } | { mode: "room"; name: string } = { mode: "all" };
  onSettingsChanged?: () => void;
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
    const sel = vb.querySelector<HTMLSelectElement>("#v-room")!;
    sel.onchange = () => (sel.value ? this.onView?.({ mode: "room", name: sel.value }) : this.onView?.({ mode: "all" }));

    this.els.tabbar.querySelectorAll<HTMLElement>("[data-nav]").forEach((b) => (b.onclick = () => this.nav(b.dataset.nav!)));
    this.els.grab.onclick = () => { this.sheetFull = !this.sheetFull; this.layoutSheet(); };
    game.onPlayerMessage((c, text) => this.toast(c, text));
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
    const ai = s.mode === "online" ? `<span class="chip ai on" title="AI 在线">AI${s.thinking ? " 思考中" : ""}</span>`
      : s.mode === "error" ? `<span class="chip ai err" title="${esc(s.message)}">AI 出错</span>`
      : `<span class="chip ai" title="本地模拟模式">本地</span>`;
    const fest = this.game.todayFestivals.slice(0, 2).map((f) => `<span class="chip fest">${esc(f)}</span>`).join("");
    const html = fest + ai;
    if (this.els.chips.innerHTML !== html) this.els.chips.innerHTML = html;
    const unread = this.game.conflicts.some((c) => !c.resolved);
    this.els["feed-dot"].hidden = !unread;
  }

  /** 视角条：全景时「全景」高亮，单间时下拉框显示当前房间 */
  renderView() {
    const vb = this.els.viewbar;
    vb.querySelector("#v-all")!.classList.toggle("on", this.view.mode === "all");
    const sel = vb.querySelector<HTMLSelectElement>("#v-room")!;
    const cur = this.view.mode === "room" ? this.view.name : "";
    const html = `<option value="">选择房间</option>` + this.game.world.rooms().map((r) => `<option value="${esc(r)}">${esc(r)}</option>`).join("");
    if (sel.innerHTML !== html) sel.innerHTML = html;
    sel.value = cur;
  }

  // ———————————————————— 角色头像条 ————————————————————

  private avatar(d: CharacterData, size = 44) {
    const a = d.appearance;
    const ring = d.illness ? "#e86a6a" : d.needs.mood > 60 ? "#5cc58a" : d.needs.mood > 35 ? "#f2c14e" : "#e88a6a";
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
    body.innerHTML = `<div class="sheet-head"><h2>角色</h2><button class="btn primary small" id="p-add">＋ 新角色</button></div><div class="people">${cards}</div>`;
    body.querySelectorAll<HTMLElement>(".person").forEach((el) => (el.onclick = () => this.select(el.dataset.id!)));
    body.querySelector<HTMLElement>("#p-add")!.onclick = () => this.openEditor(null);
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
      const mem = [...c.d.memories].reverse();
      tb.innerHTML = mem.length
        ? mem.map((m) => `<div class="row-item">${"★".repeat(m.weight)} ${esc(m.text)}<br><small>${new Date(m.t).toLocaleString("zh-CN")}</small></div>`).join("")
        : `<p class="empty">还没有记住什么事。和 TA 聊聊天，或者让 TA 过一阵子日常生活吧。</p>`;
    }
    this.renderDetail(true);
  }

  private statusLive(c: Character) {
    const d = c.d;
    const bar = (label: string, v: number, color: string, extra = "") =>
      `<div class="need"><span>${label}</span><span class="bar"><b style="width:${Math.max(0, Math.min(100, v))}%;background:${color}"></b></span><span class="v">${extra || Math.round(v)}</span></div>`;
    const needs = NEED_ORDER.map((k) => bar(NEED_CN[k], d.needs[k], NEED_COLORS[k])).join("");
    const mood = d.needs.mood;
    const moodWord = mood >= 80 ? "很开心" : mood >= 60 ? "不错" : mood >= 40 ? "一般" : mood >= 20 ? "低落" : "很糟";
    const stressWord = d.stress >= 70 ? "压力很大" : d.stress >= 40 ? "有点压力" : "放松";
    const ill = d.illness ? `<div class="sick">🤒 ${esc(d.illness.name)}，严重程度 ${Math.round(d.illness.severity)}。躺床休息、吃药、喝粥会好得快。</div>` : "";
    const td = d.today;
    const h = (m: number) => (m / 60).toFixed(1);
    const plan = c.queue.length ? `<div class="plan">接下来：${c.queue.map((s) => esc(c.describeStep(s))).join(" → ")}</div>` : "";
    return `${ill}
      <div class="mood-row">
        <div class="big-stat"><b>${Math.round(mood)}</b><span>心情 · ${moodWord}</span><i style="--p:${mood}%;--c:${NEED_COLORS.mood}"></i></div>
        <div class="big-stat"><b>${Math.round(d.stress)}</b><span>压力 · ${stressWord}</span><i style="--p:${d.stress}%;--c:${d.stress >= 70 ? "#e86a6a" : "#b9a3d6"}"></i></div>
        <div class="big-stat"><b>${d.sleepDebt.toFixed(1)}<small>h</small></b><span>睡眠债</span><i style="--p:${Math.min(100, d.sleepDebt * 10)}%;--c:#6b9bf2"></i></div>
      </div>
      <h4 class="sec">需求</h4><div class="needs">${needs}</div>
      <h4 class="sec">今天</h4>
      <div class="today">
        <span>🍚 吃了 <b>${td.meals}</b> 顿</span><span>😴 睡了 <b>${h(td.sleepMin)}</b> 小时</span>
        <span>💼 工作 <b>${h(td.workMin)}</b> 小时</span><span>🎮 玩了 <b>${h(td.funMin)}</b> 小时</span>
        <span>💬 聊天 <b>${Math.round(td.socialMin)}</b> 句</span><span>🛁 ${td.showered ? "洗过澡了" : "还没洗澡"}</span>
      </div>${plan}`;
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
    const tools: [BuildTool, string][] = [["furniture", "家具"], ["turn", "翻面"], ["room", "房间"], ["floor", "地板"], ["wall", "墙"], ["door", "门"], ["window", "窗"], ["erase", "拆除"]];
    let opts = "";
    let hint = "";
    if (b.tool === "furniture") {
      const cats = [...new Set(FURNITURE.map((f) => f.category))];
      opts = `<div class="chips-row">${cats.map((c) => `<button class="chip-btn ${this.furnCat === c ? "on" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`).join("")}</div>
        <div class="items">${FURNITURE.filter((f) => f.category === this.furnCat).map((f) => `<button class="item ${b.furniture === f.id ? "on" : ""}" data-furn="${f.id}">
          <span class="thumb" style="--c:${hexColor(f.color)}"><img alt="" src="${asset("furniture", f.sprite ?? f.id)}" onerror="this.remove()"></span><span>${esc(f.name)}</span></button>`).join("")}</div>`;
      hint = this.furnCat === "墙饰" || this.furnCat === "节日"
        ? "墙饰点靠墙那一格就会挂到后墙上。室内墙默认是矮墙沿，挂上去看不到，可以挂在房子最外面的高墙上，或者在设置里把墙改成高墙。"
        : "点地板放下家具。";
    } else if (b.tool === "turn") {
      hint = "点一件家具，让它转过身背对镜头（再点一次转回来）。";
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

  openEditor(c: Character | null) {
    const d: CharacterData = c ? c.d : newCharacter({ name: "", appearance: randomAppearance() });
    const a = d.appearance;
    const p = this.page(`
      <header class="page-head"><button class="icon-btn" data-close aria-label="返回">${icon("back")}</button><h2>${c ? "编辑" + esc(c.name) : "创建新角色"}</h2>
        <button class="btn small primary" id="e-save">${c ? "保存" : "搬进来"}</button></header>
      <div class="page-body">
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
        <h3 class="group">性格</h3>
        <div class="help" style="margin-bottom:8px">性格会影响需求变化的快慢，也会告诉 AI 这个角色是什么样的人。</div>
        ${(Object.keys(TRAIT_CN) as (keyof Traits)[]).map((k) => `<div class="slider"><span>${TRAIT_CN[k][1]}</span><input type="range" min="0" max="100" step="5" data-trait="${k}" value="${d.traits[k]}" aria-label="${TRAIT_CN[k][1]}到${TRAIT_CN[k][2]}" /><span>${TRAIT_CN[k][2]}</span></div>`).join("")}
        <h3 class="group">外观</h3>
        <div class="field"><label>占位小人的颜色（以后会换成角色包）</label>
          <div class="colors">
            ${[["skin", "肤色"], ["hair", "发色"], ["outfit", "衣服"], ["accent", "点缀"], ["eyes", "瞳色"]].map(([k, n]) => `<label>${n}<input type="color" data-color="${k}" value="${(a as unknown as Record<string, string>)[k]}" /></label>`).join("")}
            <label>发型<select id="e-hair">${["短发", "长发", "短发+发饰", "马尾"].map((n, i) => `<option value="${i}" ${a.hairStyle === i ? "selected" : ""}>${n}</option>`).join("")}</select></label>
          </div></div>
      </div>`);
    const $ = <T extends HTMLElement>(s: string) => p.querySelector<T>(s)!;
    $("#e-fill").onclick = () => { $<HTMLTextAreaElement>("#e-schedule").value = SCHEDULE_TEMPLATE; };
    p.querySelectorAll<HTMLElement>(".taste-chip").forEach((b) => (b.onclick = () => {
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
      d.profile.likes = [...p.querySelectorAll<HTMLElement>(".taste-chip.like")].map((x) => x.dataset.food!);
      d.profile.dislikes = [...p.querySelectorAll<HTMLElement>(".taste-chip.dislike")].map((x) => x.dataset.food!);
      p.querySelectorAll<HTMLInputElement>("[data-trait]").forEach((i) => (d.traits[i.dataset.trait as keyof Traits] = Number(i.value)));
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
            <option value="openai" ${ai.provider === "openai" ? "selected" : ""}>兼容 OpenAI 格式的服务</option>
          </select><div class="help">兼容 OpenAI 格式：DeepSeek、通义、本地 Ollama 等。</div></div>
        <div class="field"><label for="s-key">API Key</label><input id="s-key" type="password" value="${esc(ai.apiKey)}" autocomplete="off" />
          <div class="help">只保存在这台设备上，只会发给你选择的 AI 服务。</div></div>
        <div class="field" id="s-base-wrap"><label for="s-base">服务地址</label><input id="s-base" value="${esc(ai.baseUrl)}" inputmode="url" /><div class="help">例如 https://api.deepseek.com/v1</div></div>
        <div class="field"><label for="s-fast">日常行为用的模型</label><input id="s-fast" value="${esc(ai.fastModel)}" /><div class="help">调用最频繁，建议用便宜快速的</div></div>
        <div class="field"><label for="s-chat">聊天用的模型</label><input id="s-chat" value="${esc(ai.chatModel)}" /></div>
        <div class="grid2">
          <div class="field"><label for="s-rate">每分钟最多调用</label><input id="s-rate" type="number" inputmode="numeric" min="1" max="60" value="${ai.maxCallsPerMinute}" /></div>
          <div class="field"><label for="s-interval">闲下来多久问 AI（秒）</label><input id="s-interval" type="number" inputmode="numeric" min="10" max="3600" value="${ai.decisionInterval}" /></div>
        </div>
        <h3 class="group">新闻</h3>
        <label class="switch"><input type="checkbox" id="s-news" ${s.news.enabled ? "checked" : ""} /><span>角色看电视、上网时能看到真实新闻</span></label>
        <div class="field"><label for="s-feeds">新闻来源（每行：名称 | 分类 | RSS 地址）</label>
          <textarea id="s-feeds" style="min-height:80px">${esc(s.news.feeds.map((f) => `${f.name} | ${f.category} | ${f.url}`).join("\n"))}</textarea></div>
        <div class="field"><label for="s-block">屏蔽词（逗号分隔）</label><input id="s-block" value="${esc(s.news.blockedWords.join("，"))}" /></div>
        <h3 class="group">画面和测试</h3>
        <label class="switch"><input type="checkbox" id="s-walls" ${s.wallMode === "full" ? "checked" : ""} /><span>房间之间的墙显示成高墙</span></label>
        <div class="field"><label for="s-scale">时间倍率（测试用）</label><input id="s-scale" type="number" inputmode="numeric" min="1" max="600" value="${s.timeScale}" />
          <div class="help">1 = 和现实同步。调大后饥饿、困倦和动作时长都会加快；作息和节日仍按现实时钟。</div></div>
        <button class="btn danger block" id="s-reset">重置存档</button>
      </div>`);
    const $ = <T extends HTMLElement>(sel: string) => p.querySelector<T>(sel)!;
    const syncBase = () => ($("#s-base-wrap").hidden = $<HTMLSelectElement>("#s-provider").value !== "openai");
    syncBase();
    $<HTMLSelectElement>("#s-provider").onchange = () => {
      syncBase();
      const def = defaultSettings().ai;
      if ($<HTMLSelectElement>("#s-provider").value === "anthropic" && !/^claude/.test($<HTMLInputElement>("#s-fast").value)) {
        $<HTMLInputElement>("#s-fast").value = def.fastModel;
        $<HTMLInputElement>("#s-chat").value = def.chatModel;
      }
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
      s.news.enabled = $<HTMLInputElement>("#s-news").checked;
      s.news.feeds = $<HTMLTextAreaElement>("#s-feeds").value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((q) => q.length >= 3 && q[2]).map(([name, category, url]) => ({ name, category, url }));
      s.news.blockedWords = $<HTMLInputElement>("#s-block").value.split(/[,，\s]+/).filter(Boolean);
      s.wallMode = $<HTMLInputElement>("#s-walls").checked ? "full" : "cutaway";
      s.timeScale = Math.min(600, Math.max(1, Number($<HTMLInputElement>("#s-scale").value) || 1));
      this.game.newsFetchedAt = 0;
      p.close();
      this.onSettingsChanged?.();
      this.game.save();
      this.renderTop();
      this.flash("设置已保存");
    };
  }
}
