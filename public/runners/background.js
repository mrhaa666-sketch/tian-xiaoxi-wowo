// 后台小程序（兜底）：应用被系统杀掉以后，安卓大约每 15 分钟唤醒它一次。
// 它根据应用切到后台时存下的角色资料，决定要不要替某个角色给主人发一条消息（变成手机通知），
// 发出去的消息先存在 inbox 里，主人打开应用时补进聊天记录。
// 应用还活着时（每 5 分钟会报一次平安），这里什么都不做，避免重复发消息。

function readJSON(key, dflt) {
  try { const v = CapacitorKV.get(key); return v && v.value ? JSON.parse(v.value) : dflt; } catch (e) { return dflt; }
}
function writeJSON(key, val) { CapacitorKV.set(key, JSON.stringify(val)); }

addEventListener("sync", (resolve, reject, args) => { writeJSON("state", args); writeJSON("alive", { at: Date.now() }); resolve(); });
addEventListener("heartbeat", (resolve, reject, args) => { writeJSON("alive", { at: (args && args.at) || Date.now() }); resolve(); });
addEventListener("takeInbox", (resolve) => { const inbox = readJSON("inbox", []); writeJSON("inbox", []); resolve({ inbox: inbox }); });

function pick(a) { return a[Math.floor(Math.random() * a.length)]; }

function asleep(c, h) {
  if (c.chronotype === "night") return h >= 4 && h < 10;
  if (c.chronotype === "early") return h >= 22 || h < 6;
  return h >= 1 && h < 7.5;
}

function templateLine(c, h) {
  const you = c.callPlayer || "你";
  // 作息表里刚到点的事
  const lines = (c.schedule || "").split("\n");
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(\d{1,2}):(\d{2})\s*(.+)$/);
    if (m && Math.abs(h - (Number(m[1]) + Number(m[2]) / 60)) < 0.3) return pick([`我要去${m[3].trim()}啦。`, `${you}，${m[3].trim()}的时间到了。`]);
  }
  let pool;
  if (h >= 6.5 && h < 9.5) pool = [`早上好，${you}。`, "起床了吗？"];
  else if ((h >= 11.5 && h < 13) || (h >= 17.5 && h < 19.5)) pool = [`${you}吃饭了吗？`, "别忘了吃饭。"];
  else if (h >= 23 || h < 2) pool = [`${you}还没睡吗？`, "早点睡哦。", "晚安。"];
  else pool = [`${you}在忙吗？`, "家里好安静。", `${you}什么时候回来？`, `${you}在做什么呢？`];
  if (c.catchphrases && c.catchphrases.length && Math.random() < 0.25) pool = pool.concat(c.catchphrases);
  return pick(pool);
}

async function aiLine(ai, c, h) {
  const now = new Date();
  const sys = `你在扮演「${c.name}」。人设：${c.persona}\n说话方式：${c.speechStyle || "自然"}。称呼主人为「${c.callPlayer || "你"}」。`;
  const user = `现在是 ${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}。主人已经有一阵子没打开家里看你了。用手机给主人发一条消息，像真人发微信一样自然，1～2 句、不超过 30 个字，符合你的性格和此刻的时间。只输出消息内容本身。`;
  try {
    if (ai.provider === "anthropic") {
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": ai.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: ai.fastModel, max_tokens: 200, system: sys, messages: [{ role: "user", content: user }] }),
      });
      const j = await r.json();
      const t = j && j.content && j.content[0] && j.content[0].text;
      return t ? t.trim().slice(0, 80) : null;
    }
    const base = (ai.baseUrl || (ai.provider === "deepseek" ? "https://api.deepseek.com" : "")).replace(/\/+$/, "");
    if (!base) return null;
    const r = await fetch(base + "/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: "Bearer " + ai.apiKey },
      body: JSON.stringify({ model: ai.fastModel, max_tokens: 200, messages: [{ role: "system", content: sys }, { role: "user", content: user }] }),
    });
    const j = await r.json();
    const t = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    return t ? t.trim().slice(0, 80) : null;
  } catch (e) {
    return null;
  }
}

addEventListener("check", async (resolve) => {
  try {
    const state = readJSON("state", null);
    const alive = readJSON("alive", { at: 0 });
    if (!state || !state.chars || Date.now() - alive.at < 20 * 60000) { resolve(); return; }
    const ph = state.phone || { proactive: "normal", quietStart: 0, quietEnd: 8 };
    if (ph.proactive === "off") { resolve(); return; }
    const d = new Date();
    const h = d.getHours() + d.getMinutes() / 60;
    const quiet = ph.quietStart !== ph.quietEnd && (ph.quietStart < ph.quietEnd ? h >= ph.quietStart && h < ph.quietEnd : h >= ph.quietStart || h < ph.quietEnd);
    if (quiet) { resolve(); return; }
    const gap = ({ low: 4, normal: 2, high: 1 }[ph.proactive] || 2) * 3600000;
    const inbox = readJSON("inbox", []);
    let sent = 0;
    for (const c of state.chars) {
      if (sent >= 1) break; // 一次最多替一个人发，避免一下子来好几条
      if (asleep(c, h)) continue;
      if (Date.now() - (c.lastTold || 0) < gap * (1.3 - (c.extraversion || 50) / 200)) continue;
      if (Math.random() > 0.35) continue;
      const useAI = state.ai && state.ai.provider !== "mock" && state.ai.apiKey;
      const text = (useAI ? await aiLine(state.ai, c, h) : null) || templateLine(c, h);
      CapacitorNotifications.schedule([{ id: Math.floor(Math.random() * 1e9), title: c.name, body: text }]);
      inbox.push({ charId: c.id, text: text, t: Date.now() });
      c.lastTold = Date.now();
      sent++;
    }
    writeJSON("inbox", inbox.slice(-50));
    writeJSON("state", state);
  } catch (e) {
    console.error("check failed: " + e);
  }
  resolve();
});
