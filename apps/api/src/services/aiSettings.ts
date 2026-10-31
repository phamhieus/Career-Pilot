import { eq } from 'drizzle-orm';
import { isIP } from 'node:net';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { userAiSettings } from '../db/schema.js';
import { badRequest } from '../lib/errors.js';
import { encryptSecret } from '../lib/secrets.js';

export const PROVIDERS = [
  { key: 'openai', label: 'OpenAI (ChatGPT)', defaultBaseUrl: 'https://api.openai.com/v1', defaultModel: 'gpt-4.1-mini', models: ['gpt-4.1-mini', 'gpt-4.1', 'gpt-4o-mini', 'gpt-4o'] },
  { key: 'deepseek', label: 'DeepSeek', defaultBaseUrl: 'https://api.deepseek.com/v1', defaultModel: 'deepseek-chat', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { key: 'openai-compatible', label: 'Other OpenAI-compatible API', defaultBaseUrl: '', defaultModel: '', models: [] },
] as const;

export const aiSettingsInput = z.object({
  provider: z.enum(['openai', 'deepseek', 'openai-compatible']),
  apiKey: z.string().trim().min(8).max(300).optional(), // omitted = keep the stored key
  model: z.string().trim().max(100).optional(),
  baseUrl: z.string().trim().max(300).optional(),
});

/** Custom endpoints must be public HTTPS so the server cannot be used to reach internal hosts. */
export function assertSafeBaseUrl(raw: string, allowLocal: boolean) {
  let u: URL;
  try { u = new URL(raw); } catch { throw badRequest('Base URL is not a valid URL'); }
  const host = u.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const local = host === 'localhost' || host.endsWith('.local') || host.endsWith('.internal') || (isIP(host) !== 0 && /^(127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|::1$|f[cd]|fe80)/.test(host));
  if (local && !allowLocal) throw badRequest('Base URL must be a public host');
  if (u.protocol !== 'https:' && !(allowLocal && local)) throw badRequest('Base URL must use HTTPS');
  return u.toString().replace(/\/$/, '');
}

export async function getAiSettings(ctx: AppContext, userId: number) {
  const [row] = await ctx.db.select().from(userAiSettings).where(eq(userAiSettings.userId, userId));
  const server = { provider: ctx.config.ai.provider, model: ctx.config.ai.model || null, configured: !!ctx.config.ai.apiKey && ctx.config.ai.provider !== 'none' };
  return {
    source: row ? 'user' : server.configured ? 'server' : 'none',
    user: row ? { provider: row.provider, model: row.model, baseUrl: row.baseUrl, keyHint: row.keyHint, updatedAt: row.updatedAt } : null,
    server,
    providers: PROVIDERS,
  };
}

export async function saveAiSettings(ctx: AppContext, userId: number, input: z.infer<typeof aiSettingsInput>) {
  const preset = PROVIDERS.find((p) => p.key === input.provider)!;
  const [existing] = await ctx.db.select().from(userAiSettings).where(eq(userAiSettings.userId, userId));
  if (!input.apiKey && !existing) throw badRequest('Enter an API key');
  const baseUrl = assertSafeBaseUrl(input.baseUrl || preset.defaultBaseUrl, !ctx.config.isProduction && input.provider === 'openai-compatible');
  const model = input.model || preset.defaultModel;
  if (!model) throw badRequest('Enter a model name');
  const values = {
    userId, provider: input.provider, model, baseUrl,
    encryptedKey: input.apiKey ? encryptSecret(input.apiKey) : existing!.encryptedKey,
    keyHint: input.apiKey ? `••••${input.apiKey.slice(-4)}` : existing!.keyHint,
    updatedAt: ctx.now(),
  };
  await ctx.db.insert(userAiSettings).values(values).onConflictDoUpdate({ target: userAiSettings.userId, set: values });
  ctx.invalidateAi(userId);
  return getAiSettings(ctx, userId);
}

export async function deleteAiSettings(ctx: AppContext, userId: number) {
  await ctx.db.delete(userAiSettings).where(eq(userAiSettings.userId, userId));
  ctx.invalidateAi(userId);
  return getAiSettings(ctx, userId);
}

/** Sends a tiny structured request with the effective configuration. */
export async function testAiSettings(ctx: AppContext, userId: number) {
  const ai = await ctx.aiFor(userId);
  const started = Date.now();
  const r = await ai.ping();
  return { ...r, ...ai.status(), latencyMs: Date.now() - started };
}
