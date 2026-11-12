// 界面：顶栏、角色列表、角色详情（状态/聊天/关系/记忆）、日志与矛盾、建造栏、弹窗。
import type { Brain } from "../ai/brain";
import { EMOTION_CN, NEED_CN, type CharacterData, type Needs } from "../core/types";
import { describeNow, hhmm } from "../core/time";
import type { Character } from "../sim/character";
import { PERSONA_TEMPLATE, SCHEDULE_TEMPLATE, defaultSettings, newCharacter, randomAppearance } from "../sim/defaults";
import { Game } from "../sim/game";
import { FLOORS, FOODS, FURNITURE, WALL_STYLES } from "../world/catalog";
import { ROOM_PRESETS } from "../world/presets";

export const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

const NEED_COLORS: Record<keyof Needs, string> = {
  hunger: "#e9876b", energy: "#5b8def", mood: "#e6b422", hygiene: "#4fb3bf", social: "#b07cc6", health: "#4fae74",
};

export type BuildTool = "floor" | "wall" | "door" | "window" | "furniture" | "room" | "erase";

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

export class UI {
  root: HTMLElement;
  stage: HTMLElement;
  selected: string | null = null;
  tab: "status" | "chat" | "relations" | "memory" = "status";
  build: BuildState = { on: false, tool: "floor", floor: "wood", wallStyle: "cream", furniture: "bed", room: "bedroom", roomName: "新房间", rot: 0, autoWalls: true };
  logCollapsed = false;
  private typing = new Set<string>();
  private els: Record<string, HTMLElement> = {};
  onSelect?: (id: string | null) => void;
  onSettingsChanged?: () => void;

  constructor(host: HTMLElement, private game: Game, private brain: Brain) {
    this.root = host;
    host.innerHTML = `
      <div id="stage"></div>
      <div class="topbar">
        <div class="brand panel">恬小溪窝窝</div>
        <div class="clock panel" id="clock"></div>
        <span class="chip" id="aistatus" role="button" tabindex="0" title="打开设置"></span>
        <div class="spacer"></div>
        <button class="btn" id="btn-walls" title="切换墙的显示方式"></button>
        <button class="btn" id="btn-build">建造</button>
        <button class="btn" id="btn-settings">设置</button>
      </div>
      <div class="roster panel" id="roster"></div>
      <div class="detail panel" id="detail" hidden></div>
      <div class="logbox panel" id="logbox"></div>
      <div class="buildbar panel" id="buildbar" hidden></div>
      <div id="toast-host"></div>
      <div id="modal-host"></div>`;
    for (const id of ["stage", "clock", "aistatus", "roster", "detail", "logbox", "buildbar", "toast-host", "modal-host", "btn-walls", "btn-build", "btn-settings"]) {
      this.els[id] = host.querySelector("#" + id)! as HTMLElement;
    }
    this.stage = this.els.stage;
    this.els["btn-build"].onclick = () => { this.build.on = !this.build.on; this.renderBuild(); };
    this.els["btn-settings"].onclick = () => this.openSettings();
    this.els.aistatus.onclick = () => this.openSettings();
    this.els["btn-walls"].onclick = () => {
      game.settings.wallMode = game.settings.wallMode === "cutaway" ? "full" : "cutaway";
      this.renderTop();
    };
    game.onPlayerMessage((c, text) => this.toast(c, text));
    this.renderAll();
  }

  renderAll() {
    this.renderTop();
    this.renderRoster();
    this.renderDetail();
    this.renderLog();
    this.renderBuild();
  }

  // ———————————————————— 顶栏 ————————————————————

  renderTop() {
    const t = describeNow(new Date());
    const fest = this.game.todayFestivals.map((f) => `<span class="chip festival">${esc(f)}</span>`).join("");
    this.els.clock.innerHTML = `<span class="time">${t.time}</span><span class="sub">${t.date} · ${t.lunar}${t.jieqi ? " · " + t.jieqi : ""}</span>${fest}`;
    const s = this.brain.status;
    const st = this.els.aistatus;
    st.className = "chip " + (s.mode === "mock" ? "mock" : s.mode === "error" ? "error" : "");
    st.textContent = s.mode === "online" ? `AI 在线 · ${s.callsLastMinute}/${this.game.settings.ai.maxCallsPerMinute} 次/分${s.thinking ? " · 思考中" : ""}` : s.message;
    this.els["btn-walls"].textContent = this.game.settings.wallMode === "cutaway" ? "墙：矮" : "墙：高";
  }

  // ———————————————————— 角色列表 ————————————————————

  renderRoster() {
    const cards = this.game.chars.map((c) => {
      const a = c.d.appearance;
      const bars = (["hunger", "energy", "mood"] as (keyof Needs)[]).map((k) => `<span title="${NEED_CN[k]}"><b style="width:${c.d.needs[k]}%;background:${NEED_COLORS[k]}"></b></span>`).join("");
      return `<button class="card ${this.selected === c.id ? "sel" : ""}" data-id="${c.id}">
        <div class="avatar" style="background:${a.skin}"><i style="background:${a.hair}"></i></div>
        <div style="min-width:0"><div class="nm">${esc(c.name)}${c.d.illness ? '<span title="生病了">🤒</span>' : ""}</div>
        <div class="act">${esc(c.d.activity)}</div><div class="minibars">${bars}</div></div></button>`;
    }).join("");
    this.els.roster.innerHTML = cards + `<button class="card add-card" id="add-char">＋ 创建新角色</button>`;
    this.els.roster.querySelectorAll<HTMLElement>(".card[data-id]").forEach((el) => (el.onclick = () => this.select(el.dataset.id!)));
    this.els.roster.querySelector<HTMLElement>("#add-char")!.onclick = () => this.openEditor(null);
  }

  select(id: string | null) {
    this.selected = id;
    this.onSelect?.(id);
    this.renderRoster();
    this.renderDetail();
  }

  // ———————————————————— 角色详情 ————————————————————

  renderDetail(onlyLive = false) {
    const el = this.els.detail;
    const c = this.selected ? this.game.byId(this.selected) : null;
    if (!c) { el.hidden = true; return; }
    el.hidden = false;
    // 聊天输入时不整体重绘，避免打断输入
    if (onlyLive) {
      const live = el.querySelector("#live");
      if (live && this.tab === "status") live.innerHTML = this.statusLive(c);
      const head = el.querySelector("#head-sub");
      if (head) head.textContent = `${EMOTION_CN[c.d.emotion]} · ${c.room} · ${c.d.activity}`;
      const th = el.querySelector("#thought");
      if (th) th.textContent = c.d.thought ? `💭 ${c.d.thought}` : "💭 ……";
      if (this.tab === "chat") this.renderChatLog(c);
      return;
    }
    const tabs = [["status", "状态"], ["chat", "聊天"], ["relations", "关系"], ["memory", "记忆"]] as const;
    el.innerHTML = `
      <header><div class="avatar" style="background:${c.d.appearance.skin}"><i style="background:${c.d.appearance.hair}"></i></div>
        <div style="flex:1;min-width:0"><h2>${esc(c.name)}</h2><div class="kv" id="head-sub"></div></div>
        <button class="btn small" id="d-close" aria-label="关闭">✕</button></header>
      <div class="thought" id="thought"></div>
      <div class="tabs">${tabs.map(([k, n]) => `<button data-tab="${k}" class="${this.tab === k ? "on" : ""}">${n}</button>`).join("")}</div>
      <div class="tabbody" id="tabbody"></div>
      ${this.tab === "chat" ? `<form class="chatbox" id="chatform"><input id="chatinput" autocomplete="off" placeholder="和${esc(c.name)}说点什么…" /><button class="btn primary">发送</button></form>` : ""}`;
    el.querySelector<HTMLElement>("#d-close")!.onclick = () => this.select(null);
    el.querySelectorAll<HTMLElement>("[data-tab]").forEach((b) => (b.onclick = () => { this.tab = b.dataset.tab as UI["tab"]; this.renderDetail(); }));
    const body = el.querySelector<HTMLElement>("#tabbody")!;
    if (this.tab === "status") {
      body.innerHTML = `<div id="live">${this.statusLive(c)}</div>
        <div class="actions">
          <select class="btn" id="food-sel">${FOODS.map((f) => `<option value="${f.id}">${esc(f.name)}</option>`).join("")}</select>
          <button class="btn primary" id="act-feed">喂饭</button>
          <button class="btn" id="act-bed">赶回床上休息</button>
          <button class="btn" id="act-chat">聊天</button>
        </div>
        <div class="actions">
          <button class="btn small" id="act-edit">编辑人设和作息</button>
          <button class="btn small" id="act-sick" title="测试用：让角色马上生病">让TA生病（测试）</button>
          <button class="btn small danger" id="act-del">删除角色</button>
        </div>`;
      body.querySelector<HTMLElement>("#act-feed")!.onclick = () => this.game.feed(c, (body.querySelector("#food-sel") as HTMLSelectElement).value);
      body.querySelector<HTMLElement>("#act-bed")!.onclick = () => this.game.sendToBed(c);
      body.querySelector<HTMLElement>("#act-chat")!.onclick = () => { this.tab = "chat"; this.renderDetail(); };
      body.querySelector<HTMLElement>("#act-edit")!.onclick = () => this.openEditor(c);
      body.querySelector<HTMLElement>("#act-sick")!.onclick = () => c.getSick();
      body.querySelector<HTMLElement>("#act-del")!.onclick = () => this.confirm(`确定要让${c.name}搬走吗？TA的记忆和聊天记录会一起删除。`, () => { this.game.removeCharacter(c.id); this.select(null); });
    } else if (this.tab === "chat") {
      this.renderChatLog(c);
      const form = el.querySelector<HTMLFormElement>("#chatform")!;
      const input = el.querySelector<HTMLInputElement>("#chatinput")!;
      input.focus();
      form.onsubmit = async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = "";
        this.typing.add(c.id);
        this.renderChatLog(c, text);
        try { await this.brain.chat(c, text); } finally { this.typing.delete(c.id); this.renderChatLog(c); }
      };
    } else if (this.tab === "relations") {
      const rows = Object.entries(c.d.relations).map(([id, r]) => {
        const who = id === "player" ? "主人（你）" : this.game.byId(id)?.name ?? "（已搬走）";
        const color = r.affinity >= 30 ? "var(--good)" : r.affinity <= -20 ? "var(--bad)" : "var(--muted)";
        return `<div class="list-item"><b>${esc(who)}</b> <span style="color:${color}">好感 ${Math.round(r.affinity)}</span><br><small>${esc(r.note || "")}</small></div>`;
      }).join("");
      body.innerHTML = rows || `<div class="kv">还没有认识的人。</div>`;
    } else {
      const mem = [...c.d.memories].reverse();
      body.innerHTML = mem.length
        ? mem.map((m) => `<div class="list-item">${"★".repeat(m.weight)} ${esc(m.text)}<br><small>${new Date(m.t).toLocaleString("zh-CN")}</small></div>`).join("")
        : `<div class="kv">还没有记住什么事。和 TA 聊聊天，或者让 TA 过一阵子日常生活吧。</div>`;
    }
    this.renderDetail(true);
  }

  private statusLive(c: Character) {
    const needs = (Object.keys(NEED_CN) as (keyof Needs)[]).map((k) => {
      const v = Math.round(c.d.needs[k]);
      return `<div class="need"><span>${NEED_CN[k]}</span><span class="bar"><b style="width:${v}%;background:${NEED_COLORS[k]}"></b></span><span class="v">${v}</span></div>`;
    }).join("");
    const ill = c.d.illness ? `<div class="sick">🤒 ${esc(c.d.illness.name)}，严重程度 ${Math.round(c.d.illness.severity)}。躺床休息、吃药、喝粥会好得快。</div>` : "";
    const plan = c.queue.length ? `<div class="kv">接下来：<b>${c.queue.map((s) => esc(c.describeStep(s))).join(" → ")}</b></div>` : "";
    return ill + needs + plan;
  }

  private renderChatLog(c: Character, pending?: string) {
    const body = this.els.detail.querySelector<HTMLElement>("#tabbody");
    if (!body || this.tab !== "chat") return;
    const atBottom = body.scrollHeight - body.scrollTop - body.clientHeight < 40;
    const msgs = c.d.chat.slice(-60).map((m) => `<div class="msg ${m.from}">${esc(m.text)}</div>`).join("");
    const pend = pending && !c.d.chat.some((m) => m.text === pending && Date.now() - m.t < 2000) ? `<div class="msg player">${esc(pending)}</div>` : "";
    const typing = this.typing.has(c.id) ? `<div class="msg char typing">${esc(c.name)}正在输入…</div>` : "";
    const html = `<div class="chatlog">${msgs || `<div class="kv">还没有聊过天。说点什么吧。</div>`}${pend}${typing}</div>`;
    if (body.innerHTML !== html) {
      body.innerHTML = html;
      if (atBottom || pending) body.scrollTop = body.scrollHeight;
    }
  }

  // ———————————————————— 日志与矛盾 ————————————————————

  renderLog() {
    const el = this.els.logbox;
    el.className = "logbox panel" + (this.logCollapsed ? " collapsed" : "");
    const conflicts = this.game.conflicts.filter((c) => !c.resolved).map((cf) => {
      const a = this.game.byId(cf.a)?.name ?? "?", b = this.game.byId(cf.b)?.name ?? "?";
      return `<div class="conflict"><b>${esc(a)}</b> 和 <b>${esc(b)}</b> 闹矛盾了：${esc(cf.reason)}
        <form class="row" data-cf="${cf.id}"><input placeholder="写下你想对他们说的话…" /><button class="btn small primary">去劝劝</button><button type="button" class="btn small" data-ignore="${cf.id}">先不管</button></form></div>`;
    }).join("");
    const entries = this.game.logs.slice(-60).reverse().map((l) => {
      const who = l.who ? (this.game.byId(l.who)?.name ?? "") : "";
      const text = l.kind === "thought" ? `${who}在想：${l.text}` : l.kind === "say" ? `${who}：${l.text}` : l.kind === "player" ? `你${l.text}` : l.text;
      return `<div class="log-${l.kind}"><span class="log-t">${hhmm(new Date(l.t))}</span>${esc(text)}</div>`;
    }).join("");
    el.innerHTML = `<header>家里的动静 <span class="spacer"></span><button class="btn small" id="log-toggle">${this.logCollapsed ? "展开" : "收起"}</button></header>${conflicts}<div class="entries">${entries}</div>`;
    el.querySelector<HTMLElement>("#log-toggle")!.onclick = () => { this.logCollapsed = !this.logCollapsed; this.renderLog(); };
    el.querySelectorAll<HTMLFormElement>("form[data-cf]").forEach((f) => (f.onsubmit = (e) => {
      e.preventDefault();
      const v = (f.querySelector("input") as HTMLInputElement).value.trim();
      if (v) this.game.mediate(f.dataset.cf!, v);
    }));
    el.querySelectorAll<HTMLElement>("[data-ignore]").forEach((b) => (b.onclick = () => {
      const cf = this.game.conflicts.find((x) => x.id === b.dataset.ignore);
      if (cf) cf.resolved = true;
      this.renderLog();
    }));
  }

  // ———————————————————— 建造 ————————————————————

  renderBuild() {
    const el = this.els.buildbar;
    this.els["btn-build"].className = "btn" + (this.build.on ? " active" : "");
    el.hidden = !this.build.on;
    this.els.logbox.hidden = this.build.on;
    if (!this.build.on) return;
    const b = this.build;
    const tools: [BuildTool, string][] = [["room", "预设房间"], ["floor", "地板"], ["wall", "墙"], ["door", "门"], ["window", "窗"], ["furniture", "家具"], ["erase", "拆除"]];
    let opts = "";
    let hint = "";
    if (b.tool === "floor") {
      opts = FLOORS.map((f) => `<button class="btn small ${b.floor === f.id ? "active" : ""}" data-floor="${f.id}"><span class="swatch" style="background:#${f.color.toString(16).padStart(6, "0")}"></span> ${f.name}</button>`).join("")
        + ` <input class="btn small" id="room-name" value="${esc(b.roomName)}" style="width:110px" title="这片地板属于哪个房间" />
        <label class="hint"><input type="checkbox" id="auto-walls" ${b.autoWalls ? "checked" : ""}/> 自动围墙</label>`;
      hint = "按住拖动可以一次铺一片。房间名会告诉角色这是哪里。";
    } else if (b.tool === "wall" || b.tool === "door" || b.tool === "window") {
      opts = WALL_STYLES.map((w) => `<button class="btn small ${b.wallStyle === w.id ? "active" : ""}" data-wall="${w.id}"><span class="swatch" style="background:#${w.color.toString(16).padStart(6, "0")}"></span> ${w.name}</button>`).join("");
      hint = "点格子的边。再点一次已有的墙可以拆掉。";
    } else if (b.tool === "furniture") {
      opts = FURNITURE.map((f) => `<button class="btn small ${b.furniture === f.id ? "active" : ""}" data-furn="${f.id}" title="${f.category}">${f.name}</button>`).join("");
      hint = "点地板放置，按 R 或点「旋转」改朝向。";
      opts += ` <button class="btn small" id="rot">旋转</button>`;
    } else if (b.tool === "room") {
      opts = ROOM_PRESETS.map((p) => `<button class="btn small ${b.room === p.id ? "active" : ""}" data-room="${p.id}">${p.name}（${p.w}×${p.h}）</button>`).join("");
      hint = "点一下放下整间房，会覆盖那片区域原有的地板和家具。";
    } else {
      hint = "点家具、墙或地板把它拆掉（先拆家具，再拆墙，最后拆地板）。";
    }
    el.innerHTML = `<div class="row">${tools.map(([k, n]) => `<button class="btn ${b.tool === k ? "active" : ""}" data-tool="${k}">${n}</button>`).join("")}<span class="spacer"></span><button class="btn small" id="build-done">完成</button></div>
      <div class="row">${opts}</div><div class="hint">${hint} 右键或两指拖动画面。</div>`;
    el.querySelectorAll<HTMLElement>("[data-tool]").forEach((x) => (x.onclick = () => { b.tool = x.dataset.tool as BuildTool; this.renderBuild(); }));
    el.querySelectorAll<HTMLElement>("[data-floor]").forEach((x) => (x.onclick = () => { b.floor = x.dataset.floor!; this.renderBuild(); }));
    el.querySelectorAll<HTMLElement>("[data-wall]").forEach((x) => (x.onclick = () => { b.wallStyle = x.dataset.wall!; this.renderBuild(); }));
    el.querySelectorAll<HTMLElement>("[data-furn]").forEach((x) => (x.onclick = () => { b.furniture = x.dataset.furn!; this.renderBuild(); }));
    el.querySelectorAll<HTMLElement>("[data-room]").forEach((x) => (x.onclick = () => { b.room = x.dataset.room!; this.renderBuild(); }));
    el.querySelector<HTMLElement>("#build-done")!.onclick = () => { b.on = false; this.renderBuild(); };
    const rot = el.querySelector<HTMLElement>("#rot");
    if (rot) rot.onclick = () => { b.rot = b.rot ? 0 : 1; };
    const rn = el.querySelector<HTMLInputElement>("#room-name");
    if (rn) rn.oninput = () => (b.roomName = rn.value.trim() || "新房间");
    const aw = el.querySelector<HTMLInputElement>("#auto-walls");
    if (aw) aw.onchange = () => (b.autoWalls = aw.checked);
  }

  // ———————————————————— 弹窗 ————————————————————

  private modal(html: string) {
    const host = this.els["modal-host"];
    host.innerHTML = `<div class="modal-bg"><div class="modal panel" role="dialog" aria-modal="true">${html}</div></div>`;
    const close = () => (host.innerHTML = "");
    host.querySelector<HTMLElement>(".modal-bg")!.onclick = (e) => { if (e.target === e.currentTarget) close(); };
    return { el: host.querySelector<HTMLElement>(".modal")!, close };
  }

  confirm(text: string, ok: () => void) {
    const m = this.modal(`<h3>确认一下</h3><p>${esc(text)}</p><footer><button class="btn" id="no">取消</button><button class="btn primary" id="yes">确定</button></footer>`);
    m.el.querySelector<HTMLElement>("#no")!.onclick = m.close;
    m.el.querySelector<HTMLElement>("#yes")!.onclick = () => { m.close(); ok(); };
  }

  openEditor(c: Character | null) {
    const d: CharacterData = c ? c.d : newCharacter({ name: "", appearance: randomAppearance() });
    const a = d.appearance;
    const m = this.modal(`
      <h3>${c ? "编辑" + esc(c.name) : "创建新角色"}</h3>
      <div class="field"><label for="e-name">名字</label><input id="e-name" value="${esc(d.name)}" maxlength="12" /></div>
      <div class="field"><label for="e-persona">性格 / 人设</label>
        <div class="help">AI 会按这段文字来扮演 TA。写得越具体，TA 越像一个真实的人：年龄职业、性格、说话方式、喜好、和其他人的关系。</div>
        <textarea id="e-persona" placeholder="${esc(PERSONA_TEMPLATE)}">${esc(d.persona)}</textarea></div>
      <div class="field"><label for="e-schedule">作息表</label>
        <div class="help">每行一条，格式像「07:30 起床」。到点时 TA 会收到提醒，AI 决定要不要照做；整段文字也会交给 AI 参考，可以写备注。</div>
        <textarea id="e-schedule" placeholder="${esc(SCHEDULE_TEMPLATE)}">${esc(d.schedule)}</textarea>
        <button type="button" class="btn small" id="e-fill" style="align-self:flex-start">填入示例作息</button></div>
      <div class="field"><label>外观（占位小人，以后会换成正式素材）</label>
        <div class="colors">
          ${[["skin", "肤色"], ["hair", "发色"], ["outfit", "衣服"], ["accent", "点缀"], ["eyes", "瞳色"]].map(([k, n]) => `<label>${n}<input type="color" data-color="${k}" value="${(a as unknown as Record<string, string>)[k]}" /></label>`).join("")}
          <label>发型<select id="e-hair">${["短发", "长发", "短发+发饰", "马尾"].map((n, i) => `<option value="${i}" ${a.hairStyle === i ? "selected" : ""}>${n}</option>`).join("")}</select></label>
        </div></div>
      <footer><button class="btn" id="e-cancel">取消</button><button class="btn primary" id="e-save">${c ? "保存" : "让 TA 搬进来"}</button></footer>`);
    const $ = <T extends HTMLElement>(s: string) => m.el.querySelector<T>(s)!;
    $("#e-fill").onclick = () => { $<HTMLTextAreaElement>("#e-schedule").value = SCHEDULE_TEMPLATE; };
    $("#e-cancel").onclick = m.close;
    $("#e-save").onclick = () => {
      const name = $<HTMLInputElement>("#e-name").value.trim();
      if (!name) { $<HTMLInputElement>("#e-name").focus(); return; }
      d.name = name;
      d.persona = $<HTMLTextAreaElement>("#e-persona").value.trim();
      d.schedule = $<HTMLTextAreaElement>("#e-schedule").value.trim();
      m.el.querySelectorAll<HTMLInputElement>("[data-color]").forEach((i) => ((a as unknown as Record<string, string>)[i.dataset.color!] = i.value));
      a.hairStyle = Number($<HTMLSelectElement>("#e-hair").value);
      if (c) {
        this.game.log("player", `修改了${name}的人设`);
        this.game.emit(c, "主人更新了你的人设或作息，之后按新的来。", 1);
      } else {
        const t = this.game.world.randomTileIn() ?? { x: 2, y: 2 };
        d.pos = { x: t.x + 0.5, y: t.y + 0.5 };
        const nc = this.game.addCharacter(d);
        this.select(nc.id);
      }
      m.close();
      this.renderAll();
    };
  }

  openSettings() {
    const s = this.game.settings;
    const ai = s.ai;
    const m = this.modal(`
      <h3>设置</h3>
      <div class="field"><label for="s-provider">AI 服务</label>
        <select id="s-provider">
          <option value="mock" ${ai.provider === "mock" ? "selected" : ""}>本地模拟（不联网、不花钱，角色只会简单的固定反应）</option>
          <option value="anthropic" ${ai.provider === "anthropic" ? "selected" : ""}>Claude（Anthropic 官方 API）</option>
          <option value="openai" ${ai.provider === "openai" ? "selected" : ""}>兼容 OpenAI 格式的服务（DeepSeek、通义、Ollama 等）</option>
        </select></div>
      <div class="field"><label for="s-key">API Key</label><input id="s-key" type="password" value="${esc(ai.apiKey)}" autocomplete="off" />
        <div class="help">只保存在这台设备的浏览器里，只会发给你选择的 AI 服务。</div></div>
      <div class="field" id="s-base-wrap"><label for="s-base">服务地址</label><input id="s-base" value="${esc(ai.baseUrl)}" /><div class="help">例如 https://api.deepseek.com/v1 ，本地 Ollama 是 http://127.0.0.1:11434/v1</div></div>
      <div class="grid2">
        <div class="field"><label for="s-fast">日常行为用的模型</label><input id="s-fast" value="${esc(ai.fastModel)}" /><div class="help">调用最频繁，建议用便宜快速的</div></div>
        <div class="field"><label for="s-chat">聊天用的模型</label><input id="s-chat" value="${esc(ai.chatModel)}" /><div class="help">和你打字聊天时用</div></div>
        <div class="field"><label for="s-rate">每分钟最多调用</label><input id="s-rate" type="number" min="1" max="60" value="${ai.maxCallsPerMinute}" /><div class="help">控制费用。超出时角色改用本地规则行动</div></div>
        <div class="field"><label for="s-interval">闲下来多久再问 AI（秒）</label><input id="s-interval" type="number" min="10" max="3600" value="${ai.decisionInterval}" /></div>
      </div>
      <div class="field"><label><input type="checkbox" id="s-news" ${s.news.enabled ? "checked" : ""} /> 角色看电视、上网时能看到真实新闻</label></div>
      <div class="field"><label for="s-feeds">新闻来源（每行一个：名称 | 分类 | RSS 地址）</label>
        <textarea id="s-feeds" style="min-height:70px">${esc(s.news.feeds.map((f) => `${f.name} | ${f.category} | ${f.url}`).join("\n"))}</textarea></div>
      <div class="field"><label for="s-block">屏蔽词（标题或摘要含有这些词的新闻不会给角色看，用逗号分隔）</label><input id="s-block" value="${esc(s.news.blockedWords.join("，"))}" /></div>
      <div class="field"><label for="s-scale">时间倍率（测试用）</label><input id="s-scale" type="number" min="1" max="600" value="${s.timeScale}" />
        <div class="help">1 = 和现实同步。调大后饥饿、困倦和动作时长都会加快，方便测试；作息和节日仍按现实时钟。</div></div>
      <footer><button class="btn danger" id="s-reset">重置存档</button><span class="spacer"></span><button class="btn" id="s-cancel">取消</button><button class="btn primary" id="s-save">保存</button></footer>`);
    const $ = <T extends HTMLElement>(sel: string) => m.el.querySelector<T>(sel)!;
    const syncBase = () => ($("#s-base-wrap").hidden = $<HTMLSelectElement>("#s-provider").value !== "openai");
    syncBase();
    $<HTMLSelectElement>("#s-provider").onchange = () => {
      syncBase();
      const p = $<HTMLSelectElement>("#s-provider").value;
      const def = defaultSettings().ai;
      if (p === "anthropic" && !/^claude/.test($<HTMLInputElement>("#s-fast").value)) {
        $<HTMLInputElement>("#s-fast").value = def.fastModel;
        $<HTMLInputElement>("#s-chat").value = def.chatModel;
      }
    };
    $("#s-cancel").onclick = m.close;
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
      s.news.feeds = $<HTMLTextAreaElement>("#s-feeds").value.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((p) => p.length >= 3 && p[2]).map(([name, category, url]) => ({ name, category, url }));
      s.news.blockedWords = $<HTMLInputElement>("#s-block").value.split(/[,，\s]+/).filter(Boolean);
      s.timeScale = Math.min(600, Math.max(1, Number($<HTMLInputElement>("#s-scale").value) || 1));
      this.game.newsFetchedAt = 0;
      m.close();
      this.onSettingsChanged?.();
      this.game.save();
      this.renderTop();
    };
  }

  toast(c: Character, text: string) {
    const host = this.els["toast-host"];
    host.innerHTML = `<div class="toast panel" role="status"><b>${esc(c.name)}</b><span>${esc(text)}</span></div>`;
    const t = host.querySelector<HTMLElement>(".toast")!;
    t.onclick = () => { host.innerHTML = ""; this.select(c.id); this.tab = "chat"; this.renderDetail(); };
    setTimeout(() => { if (host.contains(t)) host.innerHTML = ""; }, 8000);
    if (this.selected === c.id && this.tab === "chat") this.renderChatLog(c);
  }
}
