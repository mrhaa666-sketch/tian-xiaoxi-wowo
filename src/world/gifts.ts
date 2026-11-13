// 送给角色的小礼物。每件礼物有几个标签（和家具标签同一套），角色按自己喜欢 / 讨厌的标签和爱好决定喜不喜欢。
import type { Character } from "../sim/character";

export interface GiftDef { id: string; name: string; icon: string; tags: string[]; hobby?: RegExp }

export const GIFTS: GiftDef[] = [
  { id: "plush", name: "毛绒玩偶", icon: "🧸", tags: ["可爱", "毛绒", "柔软", "少女心"] },
  { id: "flowers", name: "一束花", icon: "💐", tags: ["植物", "浪漫", "自然", "彩色"], hobby: /花|植物|园艺/ },
  { id: "cookies", name: "手作饼干", icon: "🍪", tags: ["甜点", "手作", "零食", "温馨"], hobby: /点心|甜/ },
  { id: "headphones", name: "新耳机", icon: "🎧", tags: ["音乐", "电子产品", "现代"], hobby: /音乐|作曲|编曲|听/ },
  { id: "sketchbook", name: "画册和彩铅", icon: "🎨", tags: ["绘画", "手作", "彩色"], hobby: /画/ },
  { id: "novel", name: "一本小说", icon: "📖", tags: ["阅读", "书香", "安静"], hobby: /书|阅读|看书/ },
  { id: "game", name: "游戏卡带", icon: "🎮", tags: ["游戏", "电子产品", "热闹"], hobby: /游戏/ },
  { id: "scarf", name: "围巾", icon: "🧣", tags: ["暖和", "布艺", "柔软"] },
  { id: "candle", name: "香薰蜡烛", icon: "🕯️", tags: ["治愈", "温馨", "安静", "夜晚"] },
  { id: "starlamp", name: "星空投影灯", icon: "🌌", tags: ["星空", "夜晚", "梦幻", "浪漫"] },
  { id: "hairpin", name: "发饰", icon: "🎀", tags: ["打扮", "可爱", "少女心", "粉色"], hobby: /打扮|时尚/ },
  { id: "bottle", name: "运动水壶", icon: "🥤", tags: ["运动", "简约", "清爽"], hobby: /运动|跳舞|晨练/ },
  { id: "tea", name: "茶叶礼盒", icon: "🍵", tags: ["喝茶", "古典", "安静"], hobby: /茶/ },
  { id: "score", name: "空白乐谱本", icon: "🎼", tags: ["作曲", "音乐", "书香"], hobby: /作曲|编曲|乐/ },
  { id: "succulent", name: "小多肉", icon: "🪴", tags: ["植物", "小巧", "治愈", "绿色"], hobby: /花|植物/ },
  { id: "catcharm", name: "猫咪挂件", icon: "🐱", tags: ["猫咪", "动物", "可爱", "小巧"], hobby: /动物|猫/ },
  { id: "makeup", name: "化妆品", icon: "💄", tags: ["打扮", "少女心", "粉色", "高级感"], hobby: /打扮|化妆/ },
  { id: "camera", name: "拍立得", icon: "📷", tags: ["科技", "怀旧", "手作"], hobby: /拍|视频|自拍/ },
  { id: "mic", name: "麦克风", icon: "🎤", tags: ["唱歌", "音乐", "热闹"], hobby: /唱/ },
  { id: "toolkit", name: "小工具箱", icon: "🧰", tags: ["工作", "科技", "手作", "金属"], hobby: /机关|做/ },
  { id: "pillow", name: "软软的抱枕", icon: "🛋️", tags: ["柔软", "休息", "舒服", "慵懒"] },
  { id: "keychain", name: "手工钥匙扣", icon: "🔑", tags: ["手作", "小巧", "可爱"] },
];
export const GIFT_BY_ID = Object.fromEntries(GIFTS.map((g) => [g.id, g])) as Record<string, GiftDef>;

/** 这件礼物 TA 有多喜欢：大于 0 喜欢，等于 0 一般，小于 0 不喜欢 */
export function giftScore(c: Character, g: GiftDef) {
  const l = c.d.lore;
  let s = g.tags.filter((t) => l.likedTags.includes(t)).length * 2 - g.tags.filter((t) => l.dislikedTags.includes(t)).length * 3;
  if (g.hobby && g.hobby.test(c.d.profile.hobbies + c.d.lore.likesTopics)) s += 3;
  if (g.tags.includes("暖和") && l.heat === "cold") s += 2;
  // 同样的东西送太多次就没那么开心了
  const times = (c.d.gifts ?? []).filter((x) => x.id === g.id).length;
  return s - times * 2;
}
export const giftWord = (s: number) => (s >= 5 ? "特别喜欢" : s >= 2 ? "很喜欢" : s >= 0 ? "还不错" : "不太喜欢");
