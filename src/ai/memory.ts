// 长期记忆：每个角色有自己的知识库（AI 记下的事 + 主人手动写的资料）。
// 聊天和做决定时，用向量模型（embedding）找出和眼前的事最相关的几条，放进提示词。
// 没配向量模型时，按文字相似度找，也能用。向量存在浏览器数据库里，不占存档。
import type { AISettings, Memory } from "../core/types";
import type { Character } from "../sim/character";
import { postJSON } from "../core/net";
import { dlog } from "../core/log";

const DB = "wowo-memvec";
const STORE = "vec";
export const MEMORY_CAP = 300;    // AI 自己记的事最多留多少条
export const KNOWLEDGE_CAP = 500; // 主人写的资料最多多少条

const memKey = (charId: string, m: Memory) => `${charId}|${m.t}|${m.text.length}`;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 两段文字有多像：按相邻两个字的重合程度（中文没有空格分词，这样最简单） */
function lexical(a: string, b: string) {
  const grams = (s: string) => {
    const t = s.replace(/[\s，。！？、,.!?：:；;「」“”"'（）()…~～-]/g, "").toLowerCase();
    const g = new Set<string>();
    for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2));
    if (t.length === 1) g.add(t);
    return g;
  };
  const A = grams(a), B = grams(b);
  if (!A.size || !B.size) return 0;
  let n = 0;
  for (const x of A) if (B.has(x)) n++;
  return (2 * n) / (A.size + B.size);
}

function cosine(a: Float32Array, b: Float32Array) {
  let d = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? d / Math.sqrt(na * nb) : 0;
}

export class MemoryBank {
  private vecs = new Map<string, Float32Array>();
  private db: Promise<IDBDatabase | null>;
  private failUntil = 0;
  private queryCache = new Map<string, Float32Array>();
  status = "";

  constructor(private settings: () => AISettings) {
    this.db = open().catch(() => null);
    void this.load();
  }

  private async load() {
    const db = await this.db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        this.vecs.set(String(cur.key), cur.value as Float32Array);
        cur.continue();
      };
      req.onerror = () => resolve();
    });
  }

  get enabled() { const s = this.settings(); return !!s.embedBaseUrl.trim() && !!s.embedModel.trim() && !!(s.embedKey || s.apiKey); }

  /** 调向量模型（兼容 OpenAI 的 /embeddings） */
  async embed(texts: string[]): Promise<Float32Array[] | null> {
    if (!this.enabled || !texts.length || Date.now() < this.failUntil) return null;
    const s = this.settings();
    const url = s.embedBaseUrl.trim().replace(/\/+$/, "").replace(/\/embeddings$/, "") + "/embeddings";
    try {
      const r = await postJSON(url, { "content-type": "application/json", authorization: `Bearer ${s.embedKey || s.apiKey}` }, { model: s.embedModel.trim(), input: texts.map((t) => t.slice(0, 2000)) });
      const data = (r.json as { data?: { embedding: number[]; index?: number }[] } | null)?.data;
      if (r.status !== 200 || !Array.isArray(data)) throw new Error(`向量模型返回 ${r.status}：${r.text.slice(0, 120)}`);
      const sorted = data.slice().sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      this.status = `向量模型正常（${sorted[0]?.embedding.length ?? 0} 维）`;
      return sorted.map((d) => Float32Array.from(d.embedding));
    } catch (e) {
      this.failUntil = Date.now() + 5 * 60_000;
      this.status = `向量模型出错：${e instanceof Error ? e.message : String(e)}`;
      dlog("warn", "记忆", this.status);
      return null;
    }
  }

  private async put(entries: [string, Float32Array][]) {
    for (const [k, v] of entries) this.vecs.set(k, v);
    const db = await this.db;
    if (!db) return;
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      for (const [k, v] of entries) tx.objectStore(STORE).put(v, k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  }

  private async drop(keys: string[]) {
    for (const k of keys) this.vecs.delete(k);
    const db = await this.db;
    if (!db || !keys.length) return;
    const tx = db.transaction(STORE, "readwrite");
    for (const k of keys) tx.objectStore(STORE).delete(k);
  }

  /** 记下一件事（或主人写的一条资料） */
  add(c: Character, text: string, weight = 1, kind: Memory["kind"] = "memory") {
    const t = text.trim();
    if (!t) return;
    const list = c.d.memories;
    // 一模一样的事不重复记
    const same = list.find((m) => m.text === t);
    if (same) { same.weight = Math.max(same.weight, weight); same.t = Date.now(); return; }
    const m: Memory = { t: Date.now(), text: t.slice(0, 600), weight, ...(kind === "knowledge" ? { kind } : {}) };
    list.push(m);
    this.prune(c);
    if (this.enabled) void this.embed([m.text]).then((v) => { if (v?.[0]) void this.put([[memKey(c.id, m), v[0]]]); });
  }

  remove(c: Character, m: Memory) {
    const i = c.d.memories.indexOf(m);
    if (i >= 0) c.d.memories.splice(i, 1);
    void this.drop([memKey(c.id, m)]);
  }

  /** 太多时先丢最旧、最不重要的「记下的事」，主人写的资料不动 */
  private prune(c: Character) {
    const mems = c.d.memories.filter((m) => m.kind !== "knowledge");
    if (mems.length <= MEMORY_CAP) return;
    const victims = mems.slice().sort((a, b) => a.weight - b.weight || a.t - b.t).slice(0, mems.length - MEMORY_CAP);
    c.d.memories = c.d.memories.filter((m) => !victims.includes(m));
    void this.drop(victims.map((m) => memKey(c.id, m)));
  }

  /** 给还没有向量的记忆补上（换了向量模型、或者以前没开时用） */
  async backfill(c: Character, onProgress?: (done: number, total: number) => void) {
    if (!this.enabled) return 0;
    const todo = c.d.memories.filter((m) => !this.vecs.has(memKey(c.id, m)));
    let done = 0;
    for (let i = 0; i < todo.length; i += 16) {
      const batch = todo.slice(i, i + 16);
      const v = await this.embed(batch.map((m) => m.text));
      if (!v) break;
      await this.put(batch.map((m, j) => [memKey(c.id, m), v[j]] as [string, Float32Array]));
      done += batch.length;
      onProgress?.(done, todo.length);
    }
    return done;
  }

  hasVector(c: Character, m: Memory) { return this.vecs.has(memKey(c.id, m)); }

  /** 找出和 query 最相关的几条记忆 */
  async recall(c: Character, query: string, k = 6): Promise<Memory[]> {
    const list = c.d.memories;
    if (!list.length || !query.trim()) return [];
    let qv: Float32Array | null = null;
    if (this.enabled) {
      const q = query.slice(-600);
      qv = this.queryCache.get(q) ?? (await this.embed([q]))?.[0] ?? null;
      if (qv) { this.queryCache.set(q, qv); if (this.queryCache.size > 50) this.queryCache.delete(this.queryCache.keys().next().value!); }
    }
    const now = Date.now();
    const scored = list.map((m) => {
      const v = qv && this.vecs.get(memKey(c.id, m));
      const sim = v && qv ? cosine(qv, v) : lexical(query, m.text) * 0.9;
      // 重要的、主人写的、最近的稍微加一点分
      const bonus = (m.weight - 1) * 0.03 + (m.kind === "knowledge" ? 0.04 : 0) + Math.max(0, 0.03 - (now - m.t) / (30 * 86400_000) * 0.03);
      return { m, s: sim + bonus, sim };
    });
    const threshold = qv ? 0.3 : 0.08;
    return scored.filter((x) => x.sim >= threshold).sort((a, b) => b.s - a.s).slice(0, k).map((x) => x.m);
  }
}
