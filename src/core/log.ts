// 调试日志：记下 AI 请求和出错的原因、程序报错，方便主人导出来发给开发者看。
// 不会记 API Key 和聊天内容。保存在本机浏览器里，最多留最近 400 条。

export interface LogLine { t: number; level: "info" | "warn" | "error"; tag: string; msg: string }

const KEY = "wowo-debug-log";
const MAX = 400;
let lines: LogLine[] = [];
try { lines = JSON.parse(localStorage.getItem(KEY) ?? "[]"); } catch { lines = []; }

let saveTimer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    try { localStorage.setItem(KEY, JSON.stringify(lines.slice(-MAX))); } catch { /* 存不下就算了 */ }
  }, 1000);
}

/** 把看起来像密钥的东西遮掉 */
export function maskSecrets(s: string) {
  return s.replace(/(sk-[A-Za-z0-9_-]{2})[A-Za-z0-9_-]{8,}/g, "$1…").replace(/(Bearer\s+)\S+/gi, "$1…").replace(/("?x-api-key"?\s*[:=]\s*"?)[^"\s,}]+/gi, "$1…");
}

export function dlog(level: LogLine["level"], tag: string, msg: string) {
  lines.push({ t: Date.now(), level, tag, msg: maskSecrets(String(msg)).slice(0, 600) });
  if (lines.length > MAX * 1.2) lines = lines.slice(-MAX);
  persist();
}

export function getLog() { return lines.slice(); }
export function clearLog() { lines = []; persist(); }

/** 导出用的文本：开头是环境信息，后面是日志 */
export function formatLog(extra: Record<string, string>) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const ts = (t: number) => { const d = new Date(t); return `${d.getMonth() + 1}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; };
  const head = [
    "恬小溪窝窝 调试日志",
    `导出时间：${new Date().toLocaleString("zh-CN")}`,
    `设备：${navigator.userAgent}`,
    ...Object.entries(extra).map(([k, v]) => `${k}：${v}`),
    "—".repeat(20),
  ];
  const body = lines.map((l) => `${ts(l.t)} [${l.level === "error" ? "错误" : l.level === "warn" ? "注意" : "信息"}] ${l.tag}：${l.msg}`);
  return [...head, ...(body.length ? body : ["（还没有日志）"])].join("\n");
}

// 程序报错也记下来
window.addEventListener("error", (e) => dlog("error", "程序", `${e.message} @ ${e.filename?.split("/").pop()}:${e.lineno}`));
window.addEventListener("unhandledrejection", (e) => dlog("error", "程序", `未处理的错误：${e.reason instanceof Error ? e.reason.message : String(e.reason)}`));
