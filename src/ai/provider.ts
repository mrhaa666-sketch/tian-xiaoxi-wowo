// AI 服务接入层。游戏只认 LLM 接口，具体是 Claude 还是兼容 OpenAI 格式的服务在这里切换。
import Anthropic from "@anthropic-ai/sdk";
import type { AISettings } from "../core/types";
import { postJSON } from "../core/net";
import { dlog } from "../core/log";
import { recordCall } from "./usage";

/** 把 AI 服务返回的错误码翻译成看得懂的话 */
function explainStatus(status: number, text: string, provider: string): { msg: string; kind: AIError["kind"] } {
  const detail = (() => { try { const j = JSON.parse(text); return String(j?.error?.message ?? j?.message ?? "").slice(0, 120); } catch { return text.slice(0, 120); } })();
  if (status === 401 || status === 403) return { msg: provider === "deepseek" ? "DeepSeek 说 API Key 不对：要填 platform.deepseek.com「API keys」里 sk- 开头的那串" : "API Key 不对或没有权限，去设置里检查一下", kind: "auth" };
  if (status === 402) return { msg: provider === "deepseek" ? "DeepSeek 账户余额不足，去 platform.deepseek.com 充值后再试" : "账户余额不足，充值后再试", kind: "auth" };
  if (status === 404) return { msg: `找不到这个模型或地址（检查服务地址和模型名）：${detail}`, kind: "other" };
  if (status === 422 || status === 400) return { msg: `请求参数不对（多半是模型名填错了）：${detail}`, kind: "other" };
  if (status === 429) return { msg: "请求太频繁，被限流了", kind: "rate" };
  if (status >= 500) return { msg: `AI 服务那边出了问题（${status}），稍后会自动重试`, kind: "network" };
  return { msg: `AI 服务出错（${status}）：${detail}`, kind: "other" };
}

export interface LLMRequest {
  tier: "fast" | "chat"; // fast = 日常行为决策，chat = 和主人聊天
  system: string;
  messages: { role: "user" | "assistant"; content: string }[];
  schema: Record<string, unknown>;
  maxTokens?: number;
}

export interface LLM {
  complete(req: LLMRequest): Promise<unknown>;
}

export class AIError extends Error {
  constructor(message: string, public kind: "auth" | "rate" | "refusal" | "network" | "format" | "other") {
    super(message);
  }
}

/** 宽松地从回复里取出 JSON：整段、代码块、或第一个 { 到最后一个 } */
export function parseJSONLoose(text: string): unknown {
  const t = text.trim();
  try { return JSON.parse(t); } catch { /* 继续 */ }
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { try { return JSON.parse(fence[1]); } catch { /* 继续 */ } }
  const a = t.indexOf("{"), b = t.lastIndexOf("}");
  if (a >= 0 && b > a) { try { return JSON.parse(t.slice(a, b + 1)); } catch { /* 继续 */ } }
  throw new AIError("AI 的回复不是有效的 JSON", "format");
}

// 这些模型支持服务端的拒答兜底：一旦被安全分类器拦下，API 会自动换一个模型重试
const FALLBACK_MODELS = /^claude-(opus-5-5|sonnet-5-5|fable-5-[12])$/;

export class AnthropicLLM implements LLM {
  private client: Anthropic;
  private structured = true;

  constructor(private s: AISettings) {
    this.client = new Anthropic({ apiKey: s.apiKey, dangerouslyAllowBrowser: true, maxRetries: 1 });
  }

  async complete(req: LLMRequest): Promise<unknown> {
    const model = req.tier === "chat" ? this.s.chatModel : this.s.fastModel;
    const fallback = FALLBACK_MODELS.test(model);
    try {
      const res = await this.client.beta.messages.create({
        model,
        max_tokens: req.maxTokens ?? 4000,
        // 系统提示词是固定的，标记为可缓存，降低重复调用的费用
        system: [{ type: "text", text: this.structured ? req.system : req.system + formatHint(req.schema), cache_control: { type: "ephemeral" } }],
        messages: req.messages,
        output_config: {
          effort: "low",
          ...(this.structured ? { format: { type: "json_schema", schema: req.schema } } : {}),
        },
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      recordCall(req.tier === "chat" ? "chat" : "decide", (res.usage?.input_tokens ?? 0) + (res.usage?.cache_read_input_tokens ?? 0) + (res.usage?.cache_creation_input_tokens ?? 0), res.usage?.output_tokens ?? 0);
      if (res.stop_reason === "refusal") throw new AIError("AI 拒绝了这次请求", "refusal");
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return parseJSONLoose(text);
    } catch (e) {
      dlog("error", "AI", `Claude ${model}：${e instanceof Error ? e.message : String(e)}`);
      if (e instanceof AIError) throw e;
      if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) throw new AIError("API Key 无效或没有权限", "auth");
      if (e instanceof Anthropic.RateLimitError) throw new AIError("请求太频繁，被限流了", "rate");
      if (e instanceof Anthropic.BadRequestError && this.structured && /output_config|format|schema/i.test(e.message)) {
        // 个别模型不支持结构化输出：关掉后重试一次，改为靠提示词约束格式
        this.structured = false;
        return this.complete(req);
      }
      if (e instanceof Anthropic.APIConnectionError) throw new AIError("连不上 AI 服务，检查一下网络", "network");
      if (e instanceof Anthropic.APIError) throw new AIError(`AI 服务出错：${e.message}`, "other");
      throw new AIError(String(e), "other");
    }
  }
}

/** 把 JSON Schema 写成模型能看懂的格式说明（给不支持结构化输出的服务用） */
export function describeSchema(schema: Record<string, unknown>, indent = ""): string {
  const sc = schema as { type?: string; properties?: Record<string, Record<string, unknown>>; items?: Record<string, unknown>; enum?: string[] };
  if (sc.enum) return sc.enum.map((x) => JSON.stringify(x)).join(" | ");
  if (sc.type === "array") return `[ ${describeSchema(sc.items ?? {}, indent)}, ... ]`;
  if (sc.type === "object" && sc.properties) {
    const inner = indent + "  ";
    return "{\n" + Object.entries(sc.properties).map(([k, v]) => `${inner}"${k}": ${describeSchema(v, inner)}`).join(",\n") + `\n${indent}}`;
  }
  return sc.type === "integer" ? "整数" : sc.type === "number" ? "数字" : sc.type === "string" ? "字符串" : "值";
}

export function formatHint(schema: Record<string, unknown>) {
  return `\n\n【输出格式】只输出一个 JSON 对象，不要输出其他文字，也不要用代码块包起来。字段必须全部给出，字段名必须和下面完全一致：\n${describeSchema(schema)}`;
}

export const DEEPSEEK_BASE = "https://api.deepseek.com";

export class OpenAICompatLLM implements LLM {
  private jsonMode = true;
  /** 用 JSON 模式时回过空回复的请求类型（聊天 / 做决定）：之后这一类不再用 JSON 模式 */
  private noJson = new Set<LLMRequest["tier"]>();
  constructor(private s: AISettings) {}

  async complete(req: LLMRequest, retried = false): Promise<unknown> {
    const model = req.tier === "chat" ? this.s.chatModel : this.s.fastModel;
    const base = (this.s.provider === "deepseek" ? this.s.baseUrl || DEEPSEEK_BASE : this.s.baseUrl).replace(/\/+$/, "");
    const url = base + "/chat/completions";
    const format = formatHint(req.schema);
    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 2000,
      messages: [{ role: "system", content: req.system + format }, ...req.messages],
    };
    const useJson = this.jsonMode && !this.noJson.has(req.tier) && !retried;
    if (useJson) body.response_format = { type: "json_object" };
    const host = (() => { try { return new URL(url).host; } catch { return url; } })();
    const t0 = Date.now();
    let r;
    try {
      r = await postJSON(url, { "content-type": "application/json", authorization: `Bearer ${this.s.apiKey}` }, body);
    } catch (e) {
      if (e instanceof Error && e.message === "NO_PROXY") {
        dlog("error", "AI", `${host}：电脑上预览时要用 npm run dev 打开才能连 AI`);
        throw new AIError("电脑上预览时要用 npm run dev 打开才能连 AI", "network");
      }
      dlog("error", "AI", `${host} ${model}：连不上（${e instanceof Error ? e.message : String(e)}）`);
      throw new AIError("连不上 AI 服务，检查一下网络和服务地址", "network");
    }
    dlog(r.status < 400 ? "info" : "error", "AI", `${host} ${model} ${req.tier === "chat" ? "聊天" : "做决定"} → ${r.status}，${Date.now() - t0}ms${r.status >= 400 ? `：${r.text.slice(0, 300)}` : ""}`);
    if (r.status === 400 && this.jsonMode) {
      dlog("warn", "AI", "这个模型不支持 JSON 模式，改为只靠提示词约束格式");
      this.jsonMode = false;
      return this.complete(req);
    }
    if (r.status >= 400) { const ex = explainStatus(r.status, r.text, this.s.provider); throw new AIError(ex.msg, ex.kind); }
    const usage = (r.json as { usage?: { prompt_tokens?: number; completion_tokens?: number } })?.usage;
    recordCall(req.tier === "chat" ? "chat" : "decide", usage?.prompt_tokens ?? 0, usage?.completion_tokens ?? 0);
    const choice = (r.json as { choices?: { message?: { content?: string }; finish_reason?: string }[] })?.choices?.[0];
    const content = choice?.message?.content ?? "";
    // DeepSeek 的 JSON 模式偶尔只回一串空格和换行（聊天时更常见）：不用 JSON 模式马上重试一次，成功了这一类以后就不用 JSON 模式
    if (!content.trim() && useJson) {
      dlog("warn", "AI", `${model} 回了空回复（${choice?.finish_reason ?? "没有结束原因"}），不用 JSON 模式重试一次`);
      const res = await this.complete(req, true);
      this.noJson.add(req.tier);
      dlog("info", "AI", `重试成功，${req.tier === "chat" ? "聊天" : "做决定"}以后不用 JSON 模式`);
      return res;
    }
    try {
      return parseJSONLoose(content);
    } catch (e) {
      const props = (req.schema as { properties?: Record<string, unknown> }).properties ?? {};
      // 聊天时模型有时直接回一句话、没包成 JSON：把这句话当成回复，不算失败
      if ("reply" in props && content.trim()) {
        dlog("warn", "AI", `回复没按 JSON 格式，直接当成聊天回复：${content.slice(0, 80)}`);
        return { reply: content.trim().replace(/^["“]|["”]$/g, "") };
      }
      // 做决定时：把它的回复贴回去，提醒它只输出 JSON，再试一次
      if (!retried && content.trim()) {
        dlog("warn", "AI", `回复不是有效的 JSON，提醒它按格式重来一次：${content.slice(0, 80)}`);
        return this.complete({ ...req, messages: [...req.messages, { role: "assistant", content }, { role: "user", content: "格式不对。请只输出一个 JSON 对象，字段按【输出格式】里的要求，不要加任何其他文字。" }] }, true);
      }
      dlog("error", "AI", `回复不是有效的 JSON：${content.slice(0, 300) || "（空回复）"}`);
      throw e;
    }
  }
}

export function makeLLM(s: AISettings): LLM | null {
  if (s.provider === "mock" || !s.apiKey) return null;
  return s.provider === "anthropic" ? new AnthropicLLM(s) : new OpenAICompatLLM(s);
}
