// 存档备份：整个家（房子、角色、记忆、聊天、设置、自制家具）导出成一个文件，换手机或者重装后导回来。
// 另外每天自动在本机留一份备份（不含立绘图片），最多留 7 份，可以随时回到某一天。
import type { SaveData } from "./types";
import { dumpSprites, restoreSprites } from "../render/spriteStore";

export const BACKUP_FORMAT = "wowo-backup";
const SAVE_KEY = "wowo-save-v1";
/** 存档以外、也属于「这个家」的本机数据 */
const EXTRA_KEYS = ["wowo-custom-furniture", "wowo-custom-rooms", "wowo-furniture-tags", "wowo-perm-guide"];
const DB = "wowo-backups";
const STORE = "daily";
const KEEP = 7;

export interface BackupFile {
  format: typeof BACKUP_FORMAT;
  version: 1;
  createdAt: number;
  save: SaveData;
  extras: Record<string, string>;
  /** 立绘和自制家具图片：「<id>/<文件名>」→ data: 地址（导出时可以不带） */
  sprites?: Record<string, string>;
}

function readExtras() {
  const out: Record<string, string> = {};
  for (const k of EXTRA_KEYS) { try { const v = localStorage.getItem(k); if (v != null) out[k] = v; } catch { /* 读不了就算了 */ } }
  return out;
}

export async function makeBackup(save: SaveData, withSprites: boolean): Promise<BackupFile> {
  return {
    format: BACKUP_FORMAT, version: 1, createdAt: Date.now(), save, extras: readExtras(),
    ...(withSprites ? { sprites: await dumpSprites() } : {}),
  };
}

/** 检查一个文件是不是能用的备份，能用就返回它 */
export function parseBackup(raw: unknown): BackupFile | null {
  const b = raw as Partial<BackupFile> | null;
  if (!b || b.format !== BACKUP_FORMAT || !b.save || typeof b.save !== "object") return null;
  const s = b.save as Partial<SaveData>;
  if (!s.world || !Array.isArray(s.characters)) return null;
  return b as BackupFile;
}

/** 用备份覆盖现在的家（调用后要重新加载页面） */
export async function applyBackup(b: BackupFile) {
  localStorage.setItem(SAVE_KEY, JSON.stringify({ ...b.save, lastSeen: Date.now() }));
  for (const k of EXTRA_KEYS) {
    if (b.extras?.[k] != null) localStorage.setItem(k, b.extras[k]);
    else localStorage.removeItem(k);
  }
  if (b.sprites) await restoreSprites(b.sprites);
}

// ———————————————————— 每天的自动备份（存在浏览器数据库里） ————————————————————

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const dayKey = (t = Date.now()) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

export interface DailyInfo { day: string; createdAt: number; chars: string[] }

export async function listDaily(): Promise<DailyInfo[]> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const out: DailyInfo[] = [];
      const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor(null, "prev");
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve(out);
        const b = cur.value as BackupFile;
        out.push({ day: String(cur.key), createdAt: b.createdAt, chars: b.save.characters.map((c) => c.name) });
        cur.continue();
      };
      req.onerror = () => resolve(out);
    });
  } catch { return []; }
}

export async function loadDaily(day: string): Promise<BackupFile | null> {
  try {
    const db = await open();
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(day);
      req.onsuccess = () => resolve((req.result as BackupFile) ?? null);
      req.onerror = () => resolve(null);
    });
  } catch { return null; }
}

/** 今天还没备份过就备份一份（同一天里会覆盖成最新的），只留最近 7 天 */
export async function autoBackup(save: SaveData) {
  try {
    const db = await open();
    const b = await makeBackup(save, false);
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      st.put(b, dayKey());
      const keys = st.getAllKeys();
      keys.onsuccess = () => {
        const all = (keys.result as string[]).sort();
        for (const k of all.slice(0, Math.max(0, all.length - KEEP))) st.delete(k);
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* 隐私模式等情况下没有数据库 */ }
}
