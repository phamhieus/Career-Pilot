import type { z } from 'zod';
import type { AppConfig } from '../config.js';
import type { Db } from '../db/client.js';
import { aiRequestLogs } from '../db/schema.js';

export interface ChatJsonRequest<T> {
  workflow: string;
  system: string;
  user: string;
  schema: z.ZodType<T>;
  temperature?: number;
  maxTokens?: number;
}

export class AiCallError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

const RETRYABLE = new Set(['timeout', 'rate_limited', 'server_error', 'invalid_json', 'schema_mismatch', 'network']);

/**
 * Single OpenAI-compatible Chat Completions client. Works with OpenAI and DeepSeek
 * (both accept `response_format: {type: "json_object"}`) and any compatible gateway.
 */
export class OpenAiCompatibleClient {
  constructor(private cfg: AppConfig['ai'], private db: Db | null, private fetchImpl: typeof fetch = fetch) {}

  get configured() {
    return this.cfg.provider !== 'none' && !!this.cfg.apiKey && !!this.cfg.baseUrl && !!this.cfg.model;
  }
  get provider() {
    return this.cfg.provider;
  }
  get model() {
    return this.cfg.model;
  }

  async chatJson<T>(req: ChatJsonRequest<T>): Promise<T> {
    const started = Date.now();
    let attempts = 0;
    let lastError: AiCallError | null = null;
    let outputChars = 0;
    const messages = [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ];
    while (attempts <= this.cfg.maxRetries) {
      attempts++;
      try {
        const raw = await this.call(messages, req);
        outputChars = raw.length;
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          throw new AiCallError('invalid_json', 'Model returned invalid JSON');
        }
        const result = req.schema.safeParse(parsed);
        if (!result.success) {
          // Give the model one chance to correct itself with the validation error.
          messages.push({ role: 'assistant', content: raw.slice(0, 4000) });
          messages.push({ role: 'user', content: `Your JSON did not match the required schema: ${result.error.message.slice(0, 800)}. Return corrected JSON only.` });
          throw new AiCallError('schema_mismatch', 'Model output failed schema validation');
        }
        await this.log(req, started, attempts, true, null, outputChars);
        return result.data;
      } catch (e) {
        lastError = e instanceof AiCallError ? e : new AiCallError('network', (e as Error).message);
        if (!RETRYABLE.has(lastError.code) || attempts > this.cfg.maxRetries) break;
        await new Promise((r) => setTimeout(r, Math.min(4000, 400 * 2 ** (attempts - 1))));
      }
    }
    await this.log(req, started, attempts, false, lastError?.code ?? 'unknown', outputChars);
    throw lastError ?? new AiCallError('unknown', 'AI call failed');
  }

  private async call(messages: { role: string; content: string }[], req: ChatJsonRequest<unknown>): Promise<string> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.cfg.timeoutMs);
    try {
      const res = await this.fetchImpl(`${this.cfg.baseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST',
        signal: controller.signal,
        headers: { 'content-type': 'application/json', authorization: `Bearer ${this.cfg.apiKey}` },
        body: JSON.stringify({
          model: this.cfg.model,
          messages,
          temperature: req.temperature ?? 0.2,
          max_tokens: req.maxTokens ?? 1800,
          response_format: { type: 'json_object' },
        }),
      });
      if (res.status === 429) throw new AiCallError('rate_limited', 'Rate limited by AI provider');
      if (res.status >= 500) throw new AiCallError('server_error', `AI provider error ${res.status}`);
      if (!res.ok) throw new AiCallError(`http_${res.status}`, `AI provider rejected the request (${res.status})`);
      const body = (await res.json()) as { choices?: { message?: { content?: string } }[] };
      const content = body.choices?.[0]?.message?.content;
      if (!content) throw new AiCallError('invalid_json', 'Empty completion');
      return content.replace(/^```(?:json)?\s*|\s*```$/g, '');
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw new AiCallError('timeout', 'AI request timed out');
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }

  private async log(req: ChatJsonRequest<unknown>, started: number, attempts: number, success: boolean, errorCode: string | null, outputChars: number) {
    if (!this.db) return;
    try {
      await this.db.insert(aiRequestLogs).values({
        workflow: req.workflow,
        provider: this.cfg.provider,
        model: this.cfg.model,
        durationMs: Date.now() - started,
        attempts,
        success,
        errorCode,
        inputChars: req.system.length + req.user.length,
        outputChars,
      });
    } catch {
      /* logging must never break a request */
    }
  }
}
