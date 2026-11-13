// 角色立绘的存放处：随角色包导入的立绘存进浏览器自己的数据库（IndexedDB），
// 没有导入过的就去 packs/chars/<id>/ 文件夹里找。
const DB = "wowo-sprites";
const STORE = "files";
const urls = new Map<string, string>(); // "<id>/<文件名>" → blob 地址

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 启动时把存好的立绘都读出来（读不了就算了，退回文件夹） */
export async function initSpriteStore() {
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readonly");
      const req = tx.objectStore(STORE).openCursor();
      req.onsuccess = () => {
        const cur = req.result;
        if (!cur) return resolve();
        urls.set(String(cur.key), URL.createObjectURL(cur.value as Blob));
        cur.continue();
      };
      req.onerror = () => resolve();
    });
  } catch { /* 隐私模式等情况下没有数据库 */ }
}

/** 某个立绘文件的地址 */
export function spriteUrl(id: string, file: string) {
  return urls.get(`${id}/${file}`) ?? `packs/chars/${id}/${file}`;
}

function dataToBlob(data: string): Blob | null {
  const m = data.match(/^data:([\w/+.-]+);base64,(.*)$/);
  if (!m) return null;
  const bin = atob(m[2]);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type: m[1] });
}

/** 保存一套立绘（文件名 → data: 地址）。同名的旧立绘会被替换。 */
export async function saveSprites(id: string, files: Record<string, string>) {
  const blobs = Object.entries(files).map(([name, data]) => [name, dataToBlob(data)] as const).filter((x): x is [string, Blob] => !!x[1]);
  try {
    const db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE, "readwrite");
      const st = tx.objectStore(STORE);
      for (const [name, blob] of blobs) st.put(blob, `${id}/${name}`);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch { /* 存不进去时只在这次打开时有效 */ }
  for (const [name, blob] of blobs) {
    const key = `${id}/${name}`;
    const old = urls.get(key);
    if (old) URL.revokeObjectURL(old);
    urls.set(key, URL.createObjectURL(blob));
  }
}

/** 删掉浏览器里存的某套立绘（之后改用 packs 文件夹里的） */
export async function deleteSprites(id: string) {
  const keys = [...urls.keys()].filter((k) => k.startsWith(`${id}/`));
  try {
    const db = await open();
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, "readwrite");
      for (const k of keys) tx.objectStore(STORE).delete(k);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* 没有数据库就算了 */ }
  for (const k of keys) { URL.revokeObjectURL(urls.get(k)!); urls.delete(k); }
}

/** 读出一套立绘的全部文件（导出角色包用） */
export async function readSprites(id: string): Promise<Record<string, string> | null> {
  try {
    const r = await fetch(spriteUrl(id, "manifest.json"));
    if (!r.ok) return null;
    const m = await r.json() as { bodies?: string[]; faces?: string[]; frames?: Record<string, string>; poses?: string[]; avatar: Record<string, string> };
    const pics = m.frames
      ? [...new Set([...Object.values(m.frames), ...(m.poses ?? [])])].map((n) => `${n}.png`)
      : (m.bodies ?? []).flatMap((b) => (m.faces ?? []).map((f) => `${b}__${f.replace(/^face_/, "")}.png`));
    const names = ["manifest.json", ...pics, ...Object.values(m.avatar)];
    const out: Record<string, string> = {};
    for (const name of names) {
      const res = await fetch(spriteUrl(id, name));
      if (!res.ok) continue;
      const blob = await res.blob();
      out[name] = await new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.readAsDataURL(blob); });
    }
    return out;
  } catch { return null; }
}

const blobToData = (b: Blob) => new Promise<string>((resolve) => { const fr = new FileReader(); fr.onload = () => resolve(String(fr.result)); fr.readAsDataURL(b); });

/** 把数据库里所有的立绘和自制家具图片读出来（备份用）：「<id>/<文件名>」→ data: 地址 */
export async function dumpSprites(): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  try {
    const db = await open();
    const entries = await new Promise<[string, Blob][]>((resolve) => {
      const list: [string, Blob][] = [];
      const req = db.transaction(STORE, "readonly").objectStore(STORE).openCursor();
      req.onsuccess = () => { const cur = req.result; if (!cur) return resolve(list); list.push([String(cur.key), cur.value as Blob]); cur.continue(); };
      req.onerror = () => resolve(list);
    });
    for (const [k, b] of entries) out[k] = await blobToData(b);
  } catch { /* 没有数据库 */ }
  return out;
}

/** 从备份里恢复图片（同名的会被替换） */
export async function restoreSprites(files: Record<string, string>) {
  const byId = new Map<string, Record<string, string>>();
  for (const [k, v] of Object.entries(files)) {
    const i = k.indexOf("/");
    if (i <= 0) continue;
    const id = k.slice(0, i), name = k.slice(i + 1);
    if (!/^[\w-]+$/.test(id) || !/^[\w-]+\.(png|json)$/.test(name)) continue;
    if (!byId.has(id)) byId.set(id, {});
    byId.get(id)![name] = v;
  }
  for (const [id, f] of byId) await saveSprites(id, f);
}
