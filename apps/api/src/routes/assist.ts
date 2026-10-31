import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { userContext, type AppContext } from '../context.js';
import { aiSettingsInput, deleteAiSettings, getAiSettings, saveAiSettings, testAiSettings } from '../services/aiSettings.js';
import { getOnboarding, markSeen, setOnboardingDismissed } from '../services/onboarding.js';
import { applicationSuggestions, dashboardSuggestions } from '../services/suggestions.js';
import { idParam, parse, requireUser } from './helpers.js';

/** Keys the client may mark as seen for views the server cannot observe (e.g. a profile tab). */
const CLIENT_SEEN_KEYS = ['skills'];

export function assistRoutes(app: FastifyInstance, ctx: AppContext) {
  const uc = (req: FastifyRequest) => userContext(ctx, req.user?.id);

  // ---------------- AI provider settings (per user; key never returned) ----------------
  app.get('/api/settings/ai', async (req) => getAiSettings(ctx, requireUser(req).id));
  app.put('/api/settings/ai', async (req) => saveAiSettings(ctx, requireUser(req).id, parse(aiSettingsInput, req.body)));
  app.delete('/api/settings/ai', async (req) => deleteAiSettings(ctx, requireUser(req).id));
  app.post('/api/settings/ai/test', async (req) => testAiSettings(ctx, requireUser(req).id));

  // ---------------- Guided onboarding ----------------
  app.get('/api/onboarding', async (req) => getOnboarding(ctx, requireUser(req).id));
  app.post('/api/onboarding/seen', async (req) => {
    const { key } = parse(z.object({ key: z.enum(CLIENT_SEEN_KEYS as [string, ...string[]]) }), req.body);
    await markSeen(ctx, requireUser(req).id, key);
    return { ok: true };
  });
  app.post('/api/onboarding/dismiss', async (req) => {
    const { dismissed } = parse(z.object({ dismissed: z.boolean() }), req.body);
    await setOnboardingDismissed(ctx, requireUser(req).id, dismissed);
    return getOnboarding(ctx, requireUser(req).id);
  });

  // ---------------- AI suggestions ----------------
  app.get('/api/suggestions/dashboard', async (req) => {
    const q = parse(z.object({ refresh: z.enum(['true', 'false']).optional() }), req.query);
    return dashboardSuggestions(await uc(req), requireUser(req).id, q.refresh === 'true');
  });
  app.get('/api/applications/:id/suggestions', async (req) => {
    const q = parse(z.object({ refresh: z.enum(['true', 'false']).optional() }), req.query);
    return applicationSuggestions(await uc(req), requireUser(req).id, idParam(req), q.refresh === 'true');
  });
}
