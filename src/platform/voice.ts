// 语音朗读：角色发来的消息、聊天回复、画面上说的话可以读出来。
// 安卓版用系统的文字转语音（插件），网页版用浏览器自带的 speechSynthesis。每个角色的音高、语速略有不同。
import { Capacitor } from "@capacitor/core";
import { TextToSpeech, QueueStrategy } from "@capacitor-community/text-to-speech";
import type { CharacterData } from "../core/types";

export type VoiceMode = "off" | "player" | "all";

/** 按名字和年龄给每个角色一个固定的声音（音高、语速） */
export function voiceOf(d: CharacterData) {
  let h = 0;
  for (const ch of d.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const r = (h % 1000) / 1000;
  const young = d.profile.age > 0 && d.profile.age < 16;
  const pitch = Math.max(0.7, Math.min(1.5, (young ? 1.2 : 1.0) + (r - 0.5) * 0.35));
  const rate = 0.95 + ((h >> 10) % 100) / 1000; // 0.95～1.05
  return { pitch, rate };
}

const native = () => Capacitor.isNativePlatform();
let chain: Promise<void> = Promise.resolve();

/** 读一句话（排队，不会互相打断） */
export function speak(text: string, d?: CharacterData) {
  const clean = text.replace(/[（(][^）)]*[）)]/g, "").replace(/[～~]/g, "").trim();
  if (!clean) return;
  const v = d ? voiceOf(d) : { pitch: 1, rate: 1 };
  chain = chain.then(async () => {
    try {
      if (native()) {
        await TextToSpeech.speak({ text: clean.slice(0, 300), lang: "zh-CN", rate: v.rate, pitch: v.pitch, volume: 1, category: "playback", queueStrategy: QueueStrategy.Add });
      } else if ("speechSynthesis" in window) {
        await new Promise<void>((resolve) => {
          const u = new SpeechSynthesisUtterance(clean.slice(0, 300));
          u.lang = "zh-CN"; u.rate = v.rate; u.pitch = v.pitch;
          u.onend = () => resolve(); u.onerror = () => resolve();
          speechSynthesis.speak(u);
          setTimeout(resolve, 20_000);
        });
      }
    } catch { /* 没有语音引擎就算了 */ }
  });
}

export async function stopSpeaking() {
  try { if (native()) await TextToSpeech.stop(); else speechSynthesis?.cancel(); } catch { /* 忽略 */ }
}
