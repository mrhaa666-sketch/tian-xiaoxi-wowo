// 安卓版专用：后台常驻、角色消息变成手机通知、在通知里直接回复、被系统杀掉后的兜底。
// （电脑上开发预览时这些都不启用。）
import { App } from "@capacitor/app";
import { BackgroundRunner } from "@capacitor/background-runner";
import { Capacitor, registerPlugin } from "@capacitor/core";
import { LocalNotifications } from "@capacitor/local-notifications";
import { Directory, Encoding, Filesystem } from "@capacitor/filesystem";
import { Share } from "@capacitor/share";
import { dlog } from "../core/log";
import type { Brain } from "../ai/brain";
import type { Character } from "../sim/character";
import type { Game } from "../sim/game";
import type { UI } from "../ui/app";

/** 自己写的原生插件：开 / 关前台服务（通知栏的常驻消息），请求不被省电策略限制 */
interface KeepAlivePlugin {
  start(opts: { title: string; text: string; big?: string }): Promise<void>;
  updateWidget(opts: { title: string; body: string; time: string }): Promise<void>;
  stop(): Promise<void>;
  requestIgnoreBatteryOptimizations(): Promise<{ granted: boolean }>;
  status(): Promise<PermStatus>;
  openExactAlarmSettings(): Promise<{ opened: boolean }>;
  openNotificationSettings(): Promise<{ opened: boolean }>;
  openAutostartSettings(): Promise<{ opened: boolean }>;
}
export interface PermStatus { notifications: boolean; battery: boolean; exactAlarm: boolean; manufacturer: string; sdk: number }

/** 给「后台权限」引导页用的操作 */
export interface PermissionApi {
  status(): Promise<PermStatus>;
  requestNotifications(): Promise<void>;
  requestBattery(): Promise<void>;
  openExactAlarm(): Promise<void>;
  openAutostart(): Promise<boolean>;
  /** 一键：依次弹出能弹的系统授权窗口，不能弹的打开对应设置页（每一项回到应用后再进行下一项） */
  requestAll(): Promise<void>;
}

/** 等主人从系统设置页回到应用（最多等 2 分钟） */
function waitForReturn(): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => { if (!done) { done = true; resolve(); } };
    void App.addListener("appStateChange", ({ isActive }) => { if (isActive) setTimeout(finish, 400); }).then((h) => setTimeout(() => { h.remove(); finish(); }, 120_000));
  });
}
const KeepAlive = registerPlugin<KeepAlivePlugin>("KeepAlive");

const RUNNER = "com.tianxiaoxi.wowo.check";
// 频道等级建好后改不了：旧的「chars」换成新的，加上弹出横幅、声音、震动、锁屏显示
const CHANNEL = "chars_v2";

export const isAndroid = () => Capacitor.getPlatform() === "android";

let notifySeq = Math.floor(Date.now() / 1000) % 100000;

/** 角色的消息变成一条手机通知 */
async function notify(c: Character, text: string) {
  await LocalNotifications.schedule({
    notifications: [{
      id: ++notifySeq,
      title: c.name,
      body: text,
      channelId: CHANNEL,
      actionTypeId: "reply",
      group: `wowo-${c.id}`,
      largeBody: text,
      summaryText: "小窝里的消息",
      autoCancel: true,
      extra: { charId: c.id },
    }],
  }).catch(() => {});
}

/** 交给后台小程序的资料：被系统杀掉后，它靠这些继续给主人发消息 */
function snapshot(game: Game) {
  return {
    savedAt: Date.now(),
    phone: game.settings.phone,
    ai: game.settings.ai,
    chars: game.chars.map((c) => ({
      id: c.id, name: c.name, callPlayer: c.d.lore.callPlayer, speechStyle: c.d.lore.speechStyle,
      catchphrases: c.d.lore.catchphrases, persona: c.d.persona.slice(0, 600), schedule: c.d.schedule,
      chronotype: c.d.lore.chronotype, extraversion: c.d.traits.extraversion, lastTold: game.lastMessageAt(c),
    })),
  };
}

export async function initAndroid(game: Game, brain: Brain, ui: UI) {
  if (!isAndroid()) return;

  // —— 通知 ——
  await LocalNotifications.requestPermissions().catch(() => {});
  await LocalNotifications.deleteChannel({ id: "chars" }).catch(() => {});
  // 最高等级：在屏幕上方弹出横幅、响铃、震动，锁屏上也显示全文
  await LocalNotifications.createChannel({ id: CHANNEL, name: "角色的消息", description: "家里的人发给你的消息（会弹出横幅、响铃、震动）", importance: 5, visibility: 1, vibration: true, lights: true, lightColor: "#E87CA0" }).catch(() => {});
  await LocalNotifications.registerActionTypes({
    types: [{ id: "reply", actions: [{ id: "reply", title: "回复", input: true, inputButtonTitle: "发送", inputPlaceholder: "说点什么…" }] }],
  }).catch(() => {});

  // 主人不在看时，角色说给主人的话都变成通知
  game.onPlayerMessage((c, text) => { if (!game.playerWatching) void notify(c, text); });

  // 点通知：打开和 TA 的聊天；在通知里直接回复：交给 TA，TA 的回复也发成通知
  await LocalNotifications.addListener("localNotificationActionPerformed", async (ev) => {
    const id = (ev.notification.extra as { charId?: string } | undefined)?.charId;
    const c = id ? game.byId(id) : undefined;
    if (!c) return;
    if (ev.actionId === "reply" && ev.inputValue?.trim()) {
      const reply = await brain.chat(c, ev.inputValue.trim());
      if (!game.playerWatching && reply) void notify(c, reply);
    } else {
      ui.openChat(c.id);
    }
  });

  // —— 前台服务：通知栏里一直显示「正在运行」和大家在做什么，也让系统别把应用杀掉 ——
  let lastStatus = "";
  const syncKeepAlive = async (force = true) => {
    if (game.settings.phone.keepAlive) {
      const lines = game.chars.map((c) => `${c.name}${c.hidden ? "💤" : ""}：${c.room} · ${c.d.activity}`);
      const awake = game.chars.filter((c) => !c.hidden).length;
      const text = game.chars.length ? (lines[0] + (lines.length > 1 ? ` 等 ${lines.length} 人` : "")) : "家里还没有人";
      const status = lines.join("\n");
      if (!force && status === lastStatus) return;
      lastStatus = status;
      await KeepAlive.start({ title: `恬静小窝正在运行 · ${awake}/${game.chars.length} 人醒着`, text, big: status || text }).catch(() => {});
    } else {
      lastStatus = "";
      await KeepAlive.stop().catch(() => {});
    }
  };
  await syncKeepAlive();
  // 每分钟刷新一下常驻通知和桌面小组件里大家在做什么
  const syncWidget = () => {
    const awake = game.chars.filter((c) => !c.hidden).length;
    const body = game.chars.slice(0, 8).map((c) => `${c.hidden ? "💤" : "·"} ${c.name}　${c.room} · ${c.d.activity}`).join("\n") + (game.chars.length > 8 ? `\n……还有 ${game.chars.length - 8} 个人` : "");
    const d = new Date();
    void KeepAlive.updateWidget({ title: `小窝里 ${awake}/${game.chars.length} 人醒着`, body: body || "家里还没有人", time: `${d.getHours()}:${String(d.getMinutes()).padStart(2, "0")}` }).catch(() => {});
  };
  syncWidget();
  setInterval(() => { void syncKeepAlive(false); syncWidget(); }, 60_000);
  ui.testNotify = async () => {
    const c = game.chars[0];
    if (!c) return false;
    const perm = await LocalNotifications.checkPermissions().catch(() => ({ display: "denied" }));
    if (perm.display !== "granted") { await ui.permissions?.requestNotifications(); return false; }
    await notify(c, `（测试）${c.d.lore.callPlayer || "主人"}，能看到这条吗？`);
    return true;
  };
  ui.onSettingsSaved = () => { void syncKeepAlive(); };
  ui.requestBatteryExemption = () => KeepAlive.requestIgnoreBatteryOptimizations().then((r) => r.granted).catch(() => false);
  ui.permissions = {
    status: () => KeepAlive.status(),
    requestNotifications: async () => {
      const r = await LocalNotifications.requestPermissions().catch(() => ({ display: "denied" }));
      // 以前点过「不允许」，系统不会再弹窗：直接打开通知设置页
      if (r.display !== "granted") await KeepAlive.openNotificationSettings().catch(() => {});
    },
    requestBattery: async () => { await KeepAlive.requestIgnoreBatteryOptimizations().catch(() => {}); },
    openExactAlarm: async () => { await KeepAlive.openExactAlarmSettings().catch(() => {}); },
    openAutostart: () => KeepAlive.openAutostartSettings().then((r) => r.opened).catch(() => false),
    requestAll: async () => {
      let st = await KeepAlive.status();
      // 1. 通知：系统弹窗
      if (!st.notifications) {
        const r = await LocalNotifications.requestPermissions().catch(() => ({ display: "denied" }));
        dlog("info", "权限", `通知：${r.display}`);
      }
      // 2. 不受省电限制：系统弹窗（会短暂离开应用）
      st = await KeepAlive.status();
      if (!st.battery) { const back = waitForReturn(); await KeepAlive.requestIgnoreBatteryOptimizations().catch(() => {}); await back; }
      // 3. 准时提醒：安卓 12 以上只能打开设置页
      st = await KeepAlive.status();
      if (st.sdk >= 31 && !st.exactAlarm) { const back = waitForReturn(); await KeepAlive.openExactAlarmSettings().catch(() => {}); await back; }
      st = await KeepAlive.status();
      dlog("info", "权限", `一键获取后：通知 ${st.notifications}、省电 ${st.battery}、准时 ${st.exactAlarm}（${st.manufacturer}，安卓 SDK ${st.sdk}）`);
    },
  };
  // 导出日志：存成文件，打开系统分享
  ui.shareFile = async (name, text) => {
    try {
      const f = await Filesystem.writeFile({ path: name, data: text, directory: Directory.Cache, encoding: Encoding.UTF8 });
      await Share.share({ title: name, files: [f.uri], dialogTitle: "导出日志" });
      return true;
    } catch (e) {
      dlog("warn", "日志", `分享失败：${e instanceof Error ? e.message : String(e)}`);
      return false;
    }
  };
  // 第一次打开：主动带主人把后台权限都开好
  let guided = false;
  try { guided = localStorage.getItem("wowo-perm-guide") === "1"; } catch { /* 读不了就当没看过 */ }
  if (!guided) setTimeout(() => ui.openPermissionGuide(true), 1200);

  // —— 切到后台 / 回到前台 ——
  const takeInbox = async () => {
    try {
      const r = await BackgroundRunner.dispatchEvent<{ inbox?: { charId: string; text: string; t: number }[] }>({ label: RUNNER, event: "takeInbox", details: {} });
      for (const m of r?.inbox ?? []) {
        const c = game.byId(m.charId);
        if (!c) continue;
        c.d.chat.push({ t: m.t, from: "char", text: m.text });
        game.log("say", `对主人：${m.text}`, c.id);
      }
      if (r?.inbox?.length) game.changed();
    } catch { /* 后台小程序没跑过 */ }
  };
  const syncRunner = (event: "sync" | "heartbeat") =>
    BackgroundRunner.dispatchEvent({ label: RUNNER, event, details: event === "sync" ? snapshot(game) : { at: Date.now() } }).catch(() => {});

  await takeInbox();
  await App.addListener("appStateChange", async ({ isActive }) => {
    game.playerWatching = isActive;
    if (isActive) { await takeInbox(); ui.refreshPermissionGuide?.(); }
    else { game.save(); await syncRunner("sync"); }
  });

  // —— 在后台继续过日子 ——
  // 切到后台后画面不再刷新，主循环停了；这里用计时器接着推进时间，角色照常做事、给主人发消息。
  let last = performance.now();
  let beat = 0;
  setInterval(() => {
    const now = performance.now();
    const elapsed = Math.min(120, (now - last) / 1000);
    last = now;
    if (game.playerWatching) return;
    for (let t = 0; t < elapsed; t += 0.25) { game.tick(0.25); brain.tick(); }
    // 告诉后台小程序「应用还活着」，它就不用重复发消息
    if (now - beat > 5 * 60_000) { beat = now; void syncRunner("heartbeat"); }
  }, 1000);
}
