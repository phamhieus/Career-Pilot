import { eq } from 'drizzle-orm';
import type { AppConfig } from './config.js';
import type { Db } from './db/client.js';
import { userAiSettings } from './db/schema.js';
import { AiService } from './ai/service.js';
import { OpenAiCompatibleClient } from './ai/client.js';
import { decryptSecret } from './lib/secrets.js';
import { Taxonomy } from './services/taxonomy.js';

export interface AppContext {
  db: Db;
  config: AppConfig;
  /** Server-default AI service (environment configuration). */
  ai: AiService;
  /** AI service for a user: their own provider/key when saved in Settings, else the server default. */
  aiFor: (userId: number | null | undefined) => Promise<AiService>;
  invalidateAi: (userId: number) => void;
  fetch: typeof fetch;
  now: () => Date;
  taxonomy: () => Promise<Taxonomy>;
  invalidateTaxonomy: () => void;
}

export function createContext(db: Db, config: AppConfig, opts: { fetch?: typeof fetch; aiFetch?: typeof fetch; now?: () => Date } = {}): AppContext {
  let cached: Promise<Taxonomy> | null = null;
  const aiFetch = opts.aiFetch ?? fetch;
  const defaultAi = new AiService(new OpenAiCompatibleClient(config.ai, db, aiFetch));
  const perUser = new Map<number, Promise<AiService>>();
  const build = async (userId: number) => {
    const [s] = await db.select().from(userAiSettings).where(eq(userAiSettings.userId, userId));
    if (!s) return defaultAi;
    let apiKey = '';
    try { apiKey = decryptSecret(s.encryptedKey); } catch { return defaultAi; }
    return new AiService(new OpenAiCompatibleClient({ ...config.ai, provider: s.provider, apiKey, baseUrl: s.baseUrl, model: s.model }, db, aiFetch));
  };
  return {
    db,
    config,
    ai: defaultAi,
    aiFor: (userId) => {
      if (!userId) return Promise.resolve(defaultAi);
      if (!perUser.has(userId)) perUser.set(userId, build(userId));
      return perUser.get(userId)!;
    },
    invalidateAi: (userId) => { perUser.delete(userId); },
    fetch: opts.fetch ?? fetch,
    now: opts.now ?? (() => new Date()),
    taxonomy: () => (cached ??= Taxonomy.load(db)),
    invalidateTaxonomy: () => { cached = null; },
  };
}

/** Request-scoped context whose `ai` uses the signed-in user's AI settings. */
export async function userContext(ctx: AppContext, userId: number | null | undefined): Promise<AppContext> {
  return { ...ctx, ai: await ctx.aiFor(userId) };
}
