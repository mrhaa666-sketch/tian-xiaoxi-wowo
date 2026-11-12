// 素材加载：public/assets/<分类>/<文件名>.png 存在就用图片，不存在就返回 null，由调用方画占位图形。
// 每个文件只请求一次；图片加载完成后通知画面重画。
import { Assets, Texture } from "pixi.js";

export type AssetKind = "furniture" | "floors" | "walls" | "food";

const cache = new Map<string, Texture | null>();
const loading = new Set<string>();
const listeners = new Set<() => void>();

export function onAssetsChanged(fn: () => void) {
  listeners.add(fn);
}

/** 取一张素材图。还没加载过就开始加载，这一次先返回 null。 */
export function getTexture(kind: AssetKind, name: string): Texture | null {
  const key = `${kind}/${name}`;
  const hit = cache.get(key);
  if (hit !== undefined) return hit;
  if (!loading.has(key)) {
    loading.add(key);
    void load(key);
  }
  return null;
}

async function load(key: string) {
  const url = `${import.meta.env.BASE_URL}assets/${key}.png`;
  try {
    // 先问一下文件在不在，避免为缺失的图片报一堆加载错误
    const head = await fetch(url, { method: "HEAD" });
    const type = head.headers.get("content-type") ?? "";
    if (!head.ok || !type.startsWith("image/")) {
      cache.set(key, null);
      return;
    }
    const tex = await Assets.load<Texture>(url);
    tex.source.scaleMode = "linear";
    cache.set(key, tex);
    for (const fn of listeners) fn();
  } catch {
    cache.set(key, null);
  }
}
