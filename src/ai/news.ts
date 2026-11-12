// 新闻：从玩家设置的 RSS 源抓取标题和摘要，过滤掉沉重话题，缓存两小时。
// 角色用电视、电脑这类家具时，从这里拿几条给 AI 当素材。
import type { NewsItem } from "../core/types";
import { fetchText } from "../core/net";
import type { Game } from "../sim/game";

const CACHE_MS = 2 * 3600_000;

function stripHtml(s: string) {
  const div = document.createElement("div");
  div.innerHTML = s;
  return (div.textContent ?? "").replace(/\s+/g, " ").trim();
}

export function parseFeed(xml: string, source: string): NewsItem[] {
  const doc = new DOMParser().parseFromString(xml, "text/xml");
  const items = [...doc.querySelectorAll("item, entry")];
  return items.slice(0, 20).map((it) => {
    const get = (sel: string) => it.querySelector(sel)?.textContent ?? "";
    const link = it.querySelector("link")?.getAttribute("href") ?? get("link");
    const date = Date.parse(get("pubDate") || get("updated") || get("published"));
    return {
      title: stripHtml(get("title")).slice(0, 100),
      summary: stripHtml(get("description") || get("summary") || get("content")).slice(0, 160),
      source,
      link,
      t: Number.isFinite(date) ? date : Date.now(),
    };
  }).filter((n) => n.title);
}

export async function getNews(game: Game): Promise<NewsItem[]> {
  const s = game.settings.news;
  if (Date.now() - game.newsFetchedAt > CACHE_MS || !game.news.length) {
    const all: NewsItem[] = [];
    await Promise.all(s.feeds.map(async (f) => {
      try {
        all.push(...parseFeed(await fetchText(f.url), f.name));
      } catch (e) {
        console.warn(`新闻源 ${f.name} 获取失败`, e);
      }
    }));
    if (all.length) {
      game.news = all.sort((a, b) => b.t - a.t).slice(0, 60);
      game.newsFetchedAt = Date.now();
    }
  }
  const blocked = s.blockedWords.filter(Boolean);
  return game.news.filter((n) => !blocked.some((w) => n.title.includes(w) || n.summary.includes(w)));
}
