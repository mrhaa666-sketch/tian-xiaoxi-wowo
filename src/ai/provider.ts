// AI 服务接入层。游戏只认 LLM 接口，具体是 Claude 还是兼容 OpenAI 格式的服务在这里切换。
import Anthropic from "@anthropic-ai/sdk";
import type { AISettings } from "../core/types";
import { postJSON } from "../core/net";

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
        system: [{ type: "text", text: req.system, cache_control: { type: "ephemeral" } }],
        messages: req.messages,
        output_config: {
          effort: "low",
          ...(this.structured ? { format: { type: "json_schema", schema: req.schema } } : {}),
        },
        ...(fallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
      });
      if (res.stop_reason === "refusal") throw new AIError("AI 拒绝了这次请求", "refusal");
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
      return parseJSONLoose(text);
    } catch (e) {
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

export class OpenAICompatLLM implements LLM {
  private jsonMode = true;
  constructor(private s: AISettings) {}

  async complete(req: LLMRequest): Promise<unknown> {
    const model = req.tier === "chat" ? this.s.chatModel : this.s.fastModel;
    const url = this.s.baseUrl.replace(/\/+$/, "") + "/chat/completions";
    const body: Record<string, unknown> = {
      model,
      max_tokens: req.maxTokens ?? 2000,
      messages: [{ role: "system", content: req.system + "\n\n只输出一个 JSON 对象，不要输出其他文字。" }, ...req.messages],
    };
    if (this.jsonMode) body.response_format = { type: "json_object" };
    let r;
    try {
      r = await postJSON(url, { "content-type": "application/json", authorization: `Bearer ${this.s.apiKey}` }, body);
    } catch {
      throw new AIError("连不上 AI 服务，检查一下网络和服务地址", "network");
    }
    if (r.status === 400 && this.jsonMode) {
      this.jsonMode = false;
      return this.complete(req);
    }
    if (r.status === 401 || r.status === 403) throw new AIError("API Key 无效或没有权限", "auth");
    if (r.status === 429) throw new AIError("请求太频繁，被限流了", "rate");
    if (r.status >= 400) throw new AIError(`AI 服务出错（${r.status}）：${r.text.slice(0, 200)}`, "other");
    const content = (r.json as { choices?: { message?: { content?: string } }[] })?.choices?.[0]?.message?.content ?? "";
    return parseJSONLoose(content);
  }
}

export function makeLLM(s: AISettings): LLM | null {
  if (s.provider === "mock" || !s.apiKey) return null;
  return s.provider === "anthropic" ? new AnthropicLLM(s) : new OpenAICompatLLM(s);
}
