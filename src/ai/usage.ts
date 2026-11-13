// AI 用量：每天调用了多少次、用了多少 token，按主人填的单价估算花费；可以设每天的上限。
const KEY = "wowo-ai-usage";
export interface DayUsage { calls: number; inTok: number; outTok: number; chat: number; decide: number; embed: number; embedTok: number }
type Store = Record<string, DayUsage>;

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const empty = (): DayUsage => ({ calls: 0, inTok: 0, outTok: 0, chat: 0, decide: 0, embed: 0, embedTok: 0 });

let store: Store = {};
try { store = JSON.parse(localStorage.getItem(KEY) ?? "{}") ?? {}; } catch { store = {}; }
let timer: ReturnType<typeof setTimeout> | null = null;
function persist() {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    // 只留最近 30 天
    const keys = Object.keys(store).sort();
    for (const k of keys.slice(0, Math.max(0, keys.length - 30))) delete store[k];
    try { localStorage.setItem(KEY, JSON.stringify(store)); } catch { /* 存不下就算了 */ }
  }, 2000);
}
const cur = () => (store[today()] ??= empty());

/** 记一次对话模型的调用 */
export function recordCall(kind: "chat" | "decide", inTok: number, outTok: number) {
  const u = cur();
  u.calls++; u[kind]++; u.inTok += inTok || 0; u.outTok += outTok || 0;
  persist();
}
/** 记一次向量模型的调用 */
export function recordEmbed(tokens: number) {
  const u = cur();
  u.embed++; u.embedTok += tokens || 0;
  persist();
}

export const usageToday = () => ({ ...cur() });
export function usageDays(n = 7): [string, DayUsage][] {
  return Object.entries(store).sort((a, b) => b[0].localeCompare(a[0])).slice(0, n);
}

/** 按每百万 token 的单价（元）估算花费 */
export function estimateCost(u: DayUsage, priceIn: number, priceOut: number) {
  return (u.inTok * priceIn + u.outTok * priceOut) / 1_000_000;
}

/** 今天是不是已经到上限了（0 = 不限） */
export function overLimit(maxCalls: number, maxCost: number, priceIn: number, priceOut: number) {
  const u = cur();
  if (maxCalls > 0 && u.calls >= maxCalls) return `今天已经调用了 ${u.calls} 次，到了设置里的上限`;
  if (maxCost > 0 && (priceIn > 0 || priceOut > 0) && estimateCost(u, priceIn, priceOut) >= maxCost) return `今天估算已经花了 ${estimateCost(u, priceIn, priceOut).toFixed(2)} 元，到了设置里的上限`;
  return null;
}
