// 素材加载：public/assets/<分类>/<文件名>.png 存在就用图片，不存在就返回 null，由调用方画占位图形。
// 每个文件只请求一次；图片加载完成后通知画面重画。
import { Assets, Texture } from "pixi.js";

export type AssetKind = "furniture" | "floors" | "walls" | "food";

const cache = new Map<string, Texture | null>();
const loading = new Set<string>();
const listeners = new Set<() => void>();
/** 自制家具的图片：存在浏览器数据库里，用 blob 地址代替 public/assets 下的文件 */
const overrides = new Map<string, string>();

/** 让某张素材改用指定地址（传 null 取消）。已经加载过的会重新加载。 */
export function setAssetOverride(kind: AssetKind, name: string, url: string | null) {
  const key = `${kind}/${name}`;
  if (url) overrides.set(key, url); else overrides.delete(key);
  cache.delete(key);
  loading.delete(key);
}

/** 素材图的地址（界面里的缩略图用） */
export function assetUrl(kind: AssetKind, name: string) {
  return overrides.get(`${kind}/${name}`) ?? `${import.meta.env.BASE_URL}assets/${kind}/${name}.png`;
}

export function notifyAssetsChanged() { for (const fn of listeners) fn(); }

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
  const custom = overrides.get(key);
  const url = custom ?? `${import.meta.env.BASE_URL}assets/${key}.png`;
  try {
    // 先问一下文件在不在，避免为缺失的图片报一堆加载错误
    if (!custom) {
      const head = await fetch(url, { method: "HEAD" });
      const type = head.headers.get("content-type") ?? "";
      if (!head.ok || !type.startsWith("image/")) {
        cache.set(key, null);
        return;
      }
    }
    const tex = await Assets.load<Texture>(custom ? { src: url, loadParser: "loadTextures" } : url);
    tex.source.scaleMode = "linear";
    // 缩小视角时大图被缩得很小，生成逐级缩小图，避免闪烁和锯齿
    tex.source.autoGenerateMipmaps = true;
    tex.source.updateMipmaps();
    cache.set(key, tex);
    for (const fn of listeners) fn();
  } catch {
    cache.set(key, null);
  }
}
