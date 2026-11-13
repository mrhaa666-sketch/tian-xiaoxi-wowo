// 现实时间 → 游戏里的时段、节日、作息提醒。
import { Lunar, Solar } from "lunar-typescript";

export type Period = "深夜" | "清晨" | "上午" | "中午" | "下午" | "傍晚" | "晚上";

export function periodOf(d: Date): Period {
  const h = d.getHours() + d.getMinutes() / 60;
  if (h < 5) return "深夜";
  if (h < 8) return "清晨";
  if (h < 11) return "上午";
  if (h < 13.5) return "中午";
  if (h < 17) return "下午";
  if (h < 19) return "傍晚";
  if (h < 23) return "晚上";
  return "深夜";
}

const WEEK = ["日", "一", "二", "三", "四", "五", "六"];

export function pad(n: number) {
  return n < 10 ? "0" + n : String(n);
}

export function hhmm(d: Date) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function dateKey(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function describeNow(d: Date) {
  const lunar = Lunar.fromDate(d);
  return {
    date: `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 星期${WEEK[d.getDay()]}`,
    time: hhmm(d),
    period: periodOf(d),
    lunar: `农历${lunar.getMonthInChinese()}月${lunar.getDayInChinese()}`,
    jieqi: lunar.getJieQi(),
    weekend: d.getDay() === 0 || d.getDay() === 6,
  };
}

/** 今天的节日。公历节日和农历节日都算，另外补几个常见的。 */
export function festivalsOf(d: Date): string[] {
  const solar = Solar.fromDate(d);
  const lunar = Lunar.fromDate(d);
  const set = new Set<string>([...solar.getFestivals(), ...lunar.getFestivals()]);
  const jq = lunar.getJieQi();
  if (jq === "清明" || jq === "冬至") set.add(jq);
  if (d.getMonth() === 9 && d.getDate() === 31) set.add("万圣节");
  // 除夕：农历腊月最后一天，库里一般已有，这里兜底
  const tomorrow = Lunar.fromDate(new Date(d.getTime() + 86400000));
  if (tomorrow.getMonth() === 1 && tomorrow.getDay() === 1) set.add("除夕");
  return [...set];
}

/** 节日对应的简短氛围说明，给 AI 参考。 */
export function festivalHint(name: string): string {
  const hints: Record<string, string> = {
    春节: "过年了，大家会拜年、吃团圆饭、说吉祥话",
    除夕: "今晚是年夜饭和守岁",
    元宵节: "吃汤圆、看灯",
    端午节: "吃粽子",
    七夕节: "浪漫的日子",
    中秋节: "赏月、吃月饼、想念家人",
    重阳节: "登高、关心长辈",
    元旦节: "新年第一天，许新年愿望",
    情人节: "表达喜欢的日子",
    圣诞节: "交换礼物、装饰圣诞树",
    冬至: "吃饺子或汤圆",
    万圣节: "南瓜灯、变装、「不给糖就捣蛋」",
  };
  return hints[name] ?? "一个特别的日子";
}

export interface ScheduleCue {
  minutes: number; // 一天中的第几分钟
  text: string;
}

/**
 * 解析玩家写的作息表。每行一条，支持「7:30 起床」「07：30-08:00 洗漱吃早饭」这样的格式。
 * 解析不了的行不报错，整段文字依然会原样交给 AI 参考。
 */
export function parseSchedule(src: string): ScheduleCue[] {
  const cues: ScheduleCue[] = [];
  for (const raw of src.split(/\n/)) {
    const m = raw.trim().match(/^(\d{1,2})[:：](\d{2})(?:\s*[-~～到至]\s*\d{1,2}[:：]\d{2})?\s*[，,、 ]?\s*(.+)$/);
    if (!m) continue;
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h > 23 || min > 59) continue;
    cues.push({ minutes: h * 60 + min, text: m[3].trim() });
  }
  return cues.sort((a, b) => a.minutes - b.minutes);
}

/** 根据作息表，现在这一刻「应该」在做什么（最近一条已开始的条目）。 */
export function currentScheduleItem(cues: ScheduleCue[], d: Date): ScheduleCue | undefined {
  if (!cues.length) return undefined;
  const now = d.getHours() * 60 + d.getMinutes();
  let cur: ScheduleCue | undefined;
  for (const c of cues) if (c.minutes <= now) cur = c;
  return cur ?? cues[cues.length - 1]; // 凌晨还没到第一条时，沿用前一天最后一条
}
