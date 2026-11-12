import { defineConfig, type Plugin } from "vite";

/**
 * 开发用本地代理：浏览器直接请求别的网站会被跨域限制拦下，
 * 所以新闻 RSS 和兼容 OpenAI 格式的 AI 服务都经由这里转发。
 * 只在 `npm run dev` 时存在，只监听本机。安卓版改用原生网络请求，不需要它。
 */
function devProxy(): Plugin {
  return {
    name: "wowo-dev-proxy",
    configureServer(server) {
      server.middlewares.use("/api/fetch", async (req, res) => {
        try {
          const url = new URL(req.url ?? "", "http://x").searchParams.get("url") ?? "";
          if (!/^https?:\/\//.test(url)) throw new Error("只支持 http/https 地址");
          const r = await fetch(url, { headers: { "user-agent": "wowo-game/0.1" } });
          res.statusCode = r.status;
          res.setHeader("content-type", r.headers.get("content-type") ?? "text/plain");
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          res.statusCode = 502;
          res.end(String(e));
        }
      });
      server.middlewares.use("/api/proxy", async (req, res) => {
        try {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const { url, headers, body } = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (!/^https?:\/\//.test(url)) throw new Error("只支持 http/https 地址");
          const r = await fetch(url, { method: "POST", headers, body });
          res.statusCode = r.status;
          res.setHeader("content-type", r.headers.get("content-type") ?? "application/json");
          res.end(Buffer.from(await r.arrayBuffer()));
        } catch (e) {
          res.statusCode = 502;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [devProxy()],
  server: { host: "127.0.0.1", port: 5173 },
});
