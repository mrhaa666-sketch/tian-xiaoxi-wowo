// 网络请求的统一出口。
// 电脑上开发时，跨域请求经由 Vite 的本地代理（/api/fetch、/api/proxy）；
// 安卓版（Capacitor）开启原生 HTTP 后可以直接请求，不受跨域限制。

const isNative = () => !!(window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor?.isNativePlatform?.();

export async function fetchText(url: string): Promise<string> {
  const r = isNative() ? await fetch(url) : await fetch(`/api/fetch?url=${encodeURIComponent(url)}`);
  if (!r.ok) throw new Error(`请求失败 ${r.status}`);
  return r.text();
}

export async function postJSON(url: string, headers: Record<string, string>, body: unknown): Promise<{ status: number; json: unknown; text: string }> {
  const payload = JSON.stringify(body);
  const r = isNative()
    ? await fetch(url, { method: "POST", headers, body: payload })
    : await fetch("/api/proxy", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, headers, body: payload }),
      });
  const text = await r.text();
  // 网页版的请求要经过电脑上 npm run dev 才有的转发地址；在试玩网页、手机浏览器里没有它
  if (!isNative() && r.status === 404 && /^\s*</.test(text)) throw new Error("NO_PROXY");
  let json: unknown = null;
  try { json = JSON.parse(text); } catch { /* 不是 JSON */ }
  return { status: r.status, json, text };
}
