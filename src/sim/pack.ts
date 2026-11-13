// 角色包：可以提前写好、导入导出的角色文件（JSON）。格式说明见 docs/角色包格式.md。
import type { Appearance, CharacterData, Lore, Profile, Skills, Traits } from "../core/types";
import { FOOD_BY_ID, FURNITURE_BY_ID } from "../world/catalog";
import { defaultLore, newCharacter, randomAppearance } from "./defaults";
import type { Game } from "./game";
import { readSprites, saveSprites } from "../render/spriteStore";

/** 角色包里自带的立绘：id 是立绘名，files 是「文件名 → data: 地址」 */
export interface PackSprites { id: string; files: Record<string, string> }

export const PACK_FORMAT = "wowo-character-pack";

export interface PackCharacter {
  name: string;
  persona?: string;
  schedule?: string;
  profile?: Partial<Profile>;
  lore?: Partial<Lore>;
  traits?: Partial<Traits>;
  skills?: Partial<Skills>;
  appearance?: Partial<Appearance>;
  /** 立绘：写立绘文件夹名（放在 packs/chars/ 里），或者直接把立绘图片打包进来 */
  sprites?: string | PackSprites;
}

export interface CharacterPack {
  format: typeof PACK_FORMAT;
  version: 1;
  characters: PackCharacter[];
}

/** 导出：只导出「设定」和立绘，不导出聊天记录、记忆这类游戏过程中产生的东西 */
export async function exportPack(game: Game, chars: CharacterData[]): Promise<CharacterPack> {
  const sprites = new Map<string, PackSprites>();
  for (const d of chars) if (d.sprites && !sprites.has(d.sprites)) {
    const files = await readSprites(d.sprites);
    if (files) sprites.set(d.sprites, { id: d.sprites, files });
  }
  return {
    format: PACK_FORMAT,
    version: 1,
    characters: chars.map((d) => {
      // 和其他角色的关系按名字写进 presetRelations，导入到别的存档时还能对上
      const rel = Object.entries(d.relations).filter(([id]) => id !== "player").map(([id, r]) => ({ name: game.byId(id)?.name ?? "", affinity: Math.round(r.affinity), note: r.note })).filter((r) => r.name && !(r.affinity === 0 && ["刚认识", "新来的"].includes(r.note)));
      return {
        name: d.name, persona: d.persona, schedule: d.schedule, profile: d.profile,
        lore: { ...d.lore, presetRelations: rel.length ? rel : d.lore.presetRelations },
        traits: d.traits, skills: d.skills, appearance: d.appearance, ...(d.sprites ? { sprites: sprites.get(d.sprites) ?? d.sprites } : {}),
      };
    }),
  };
}

const str = (v: unknown, max = 2000) => (typeof v === "string" ? v.slice(0, max) : undefined);
const num = (v: unknown, lo: number, hi: number) => (typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : undefined);
const strList = (v: unknown, max = 20) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, max).map((x) => x.slice(0, 200)) : undefined);
const pickDefined = <T extends object>(o: T) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;

const SPRITE_ID = /^[a-z0-9_-]{1,40}$/;
function cleanSprites(v: unknown): PackCharacter["sprites"] {
  if (typeof v === "string") return SPRITE_ID.test(v) ? v : undefined;
  const o = v as { id?: unknown; files?: unknown } | null;
  if (!o || typeof o.id !== "string" || !SPRITE_ID.test(o.id) || !o.files || typeof o.files !== "object") return undefined;
  const files: Record<string, string> = {};
  for (const [name, data] of Object.entries(o.files as Record<string, unknown>)) {
    // 只收立绘图片和清单，文件名不能带路径
    if (!/^[\w-]+\.(png|json)$/.test(name) || typeof data !== "string") continue;
    if (!/^data:(image\/png|application\/json);base64,[A-Za-z0-9+/=]+$/.test(data)) continue;
    files[name] = data;
  }
  return files["manifest.json"] ? { id: o.id, files } : o.id;
}

/** 把一个角色条目整理成安全的数据：类型不对、超出范围的值都丢掉或截断 */
export function cleanEntry(e: Record<string, unknown>): PackCharacter | null {
  const name = str(e.name, 20)?.trim();
  if (!name) return null;
  const p = (e.profile ?? {}) as Record<string, unknown>;
  const l = (e.lore ?? {}) as Record<string, unknown>;
  const t = (e.traits ?? {}) as Record<string, unknown>;
  const s = (e.skills ?? {}) as Record<string, unknown>;
  const a = (e.appearance ?? {}) as Record<string, unknown>;
  const foods = (v: unknown) => strList(v)?.filter((id) => FOOD_BY_ID[id]);
  const color = (v: unknown) => (typeof v === "string" && /^#[0-9a-f]{6}$/i.test(v) ? v : undefined);
  return {
    name,
    persona: str(e.persona, 4000),
    schedule: str(e.schedule, 2000),
    profile: pickDefined({
      age: num(p.age, 1, 200), birthday: typeof p.birthday === "string" && /^\d{2}-\d{2}$/.test(p.birthday) ? p.birthday : undefined,
      job: str(p.job, 50), hobbies: str(p.hobbies, 200), likes: foods(p.likes), dislikes: foods(p.dislikes),
    }),
    lore: pickDefined({
      selfName: str(l.selfName, 10), callPlayer: str(l.callPlayer, 10), speechStyle: str(l.speechStyle, 300), catchphrases: strList(l.catchphrases, 10),
      backstory: str(l.backstory, 1500), goals: str(l.goals, 300), fears: str(l.fears, 300), likesTopics: str(l.likesTopics, 300), dislikesTopics: str(l.dislikesTopics, 300),
      habits: str(l.habits, 500), conflictStyle: str(l.conflictStyle, 300), favoriteRoom: str(l.favoriteRoom, 20),
      chronotype: ["early", "normal", "night"].includes(l.chronotype as string) ? (l.chronotype as Lore["chronotype"]) : undefined,
      sickBehavior: ["rest", "stubborn", "clingy", "normal"].includes(l.sickBehavior as string) ? (l.sickBehavior as Lore["sickBehavior"]) : undefined,
      favoriteFurniture: strList(l.favoriteFurniture)?.filter((id) => FURNITURE_BY_ID[id]),
      presetRelations: Array.isArray(l.presetRelations) ? (l.presetRelations as Record<string, unknown>[]).map((r) => ({ name: str(r?.name, 20) ?? "", affinity: num(r?.affinity, -100, 100) ?? 0, note: str(r?.note, 60) ?? "" })).filter((r) => r.name).slice(0, 20) : undefined,
      custom: Array.isArray(l.custom) ? (l.custom as Record<string, unknown>[]).map((c) => ({ key: str(c?.key, 20) ?? "", value: str(c?.value, 300) ?? "" })).filter((c) => c.key).slice(0, 30) : undefined,
    }),
    traits: pickDefined({
      extraversion: num(t.extraversion, 0, 100), conscientiousness: num(t.conscientiousness, 0, 100), agreeableness: num(t.agreeableness, 0, 100),
      neuroticism: num(t.neuroticism, 0, 100), openness: num(t.openness, 0, 100),
    }),
    skills: pickDefined({
      cooking: num(s.cooking, 0, 10), music: num(s.music, 0, 10), art: num(s.art, 0, 10), gaming: num(s.gaming, 0, 10), study: num(s.study, 0, 10), fitness: num(s.fitness, 0, 10),
    }),
    sprites: cleanSprites(e.sprites),
    appearance: pickDefined({ skin: color(a.skin), hair: color(a.hair), outfit: color(a.outfit), accent: color(a.accent), eyes: color(a.eyes), hairStyle: num(a.hairStyle, 0, 3) }),
  };
}

/** 导入角色包（也接受只有一个角色的对象）。返回加进来的角色名和问题列表。 */
export async function importPack(game: Game, raw: unknown): Promise<{ added: string[]; problems: string[] }> {
  const problems: string[] = [];
  const root = (raw ?? {}) as Record<string, unknown>;
  const list: unknown[] = Array.isArray(root.characters) ? root.characters : Array.isArray(raw) ? raw : root.name ? [root] : [];
  if (!list.length) return { added: [], problems: ["文件里没有找到角色。请检查格式是否是角色包（见 docs/角色包格式.md）。"] };
  const added: CharacterData[] = [];
  const renamed = new Map<string, string>(); // 同一批里改过名的角色：原名 → 新名
  for (const item of list.slice(0, 20)) {
    const e = cleanEntry((item ?? {}) as Record<string, unknown>);
    if (!e) { problems.push("有一个角色没有名字，跳过了"); continue; }
    let name = e.name;
    const names = new Set(game.chars.map((c) => c.name));
    for (let i = 2; names.has(name); i++) name = `${e.name}${i}`;
    renamed.set(e.name, name);
    if (name !== e.name) problems.push(`已经有叫「${e.name}」的角色了，新导入的改名为「${name}」`);
    const d = newCharacter({ name, persona: e.persona ?? "", schedule: e.schedule ?? "", appearance: { ...randomAppearance(), ...e.appearance } });
    d.profile = { ...d.profile, ...e.profile };
    d.lore = { ...defaultLore(), ...e.lore };
    if (typeof e.sprites === "string") d.sprites = e.sprites;
    else if (e.sprites) { await saveSprites(e.sprites.id, e.sprites.files); d.sprites = e.sprites.id; }
    d.traits = { ...d.traits, ...e.traits };
    d.skills = { ...d.skills, ...e.skills };
    const t = game.world.randomTileIn();
    if (t) d.pos = { x: t.x + 0.5, y: t.y + 0.5 };
    added.push(game.addCharacter(d).d);
  }
  // 按名字套用和其他角色的初始关系（导入的这批角色之间、以及和已有角色之间）
  for (const d of added) {
    for (const r of d.lore.presetRelations) {
      const target = renamed.get(r.name) ?? r.name;
      const other = game.chars.find((c) => c.name === target && c.id !== d.id);
      if (other) d.relations[other.id] = { affinity: r.affinity, note: r.note };
      else problems.push(`${d.name}的设定里提到「${r.name}」，等${r.name}搬进来以后这条关系会自动生效`);
    }
  }
  // 反过来：早就住在家里的人，设定里提到了新来的人，也一并生效（不覆盖已经玩出来的关系）
  for (const o of game.chars) {
    if (added.includes(o.d)) continue;
    for (const r of o.d.lore.presetRelations) {
      const nd = added.find((d) => d.name === r.name);
      const cur = nd && o.d.relations[nd.id];
      if (nd && (!cur || (cur.affinity === 0 && ["刚认识", "新来的"].includes(cur.note)))) o.d.relations[nd.id] = { affinity: r.affinity, note: r.note };
    }
  }
  return { added: added.map((d) => d.name), problems };
}
