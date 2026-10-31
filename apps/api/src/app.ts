import Fastify from 'fastify';
import cookie from '@fastify/cookie';
import multipart from '@fastify/multipart';
import type { AppContext } from './context.js';
import { AppError } from './lib/errors.js';
import { userForToken } from './services/auth.js';
import { assistRoutes } from './routes/assist.js';
import { coreRoutes } from './routes/core.js';
import { SESSION_COOKIE } from './routes/helpers.js';
import { workRoutes } from './routes/work.js';

export async function buildApp(ctx: AppContext, opts: { logger?: boolean } = {}) {
  const app = Fastify({ logger: opts.logger ? { level: 'info', redact: ['req.headers.cookie', 'req.headers.authorization'] } : false, bodyLimit: 2 * 1024 * 1024 });
  await app.register(cookie);
  await app.register(multipart, { limits: { fileSize: ctx.config.uploads.maxBytes, files: 1 } });

  app.decorateRequest('user', null);
  app.addHook('onRequest', async (req, reply) => {
    req.user = await userForToken(ctx, req.cookies[SESSION_COOKIE]);
    // Same-origin CSRF guard for cookie-authenticated mutations.
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin) {
      const host = req.headers['x-forwarded-host'] ?? req.headers.host;
      const origin = new URL(req.headers.origin).host;
      if (origin !== host && !ctx.config.appOrigins.some((o) => new URL(o).host === origin)) return reply.code(403).send({ error: { code: 'forbidden_origin', message: 'Cross-origin request blocked' } });
    }
  });
  app.addHook('onSend', async (_req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('referrer-policy', 'same-origin');
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof AppError) return reply.code(err.status).send({ error: { code: err.code, message: err.message, details: err.details } });
    const e = err as { statusCode?: number; code?: string; message: string };
    if (e.code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(413).send({ error: { code: 'file_too_large', message: `File exceeds ${Math.round(ctx.config.uploads.maxBytes / 1024 / 1024)} MB` } });
    if (e.statusCode && e.statusCode < 500) return reply.code(e.statusCode).send({ error: { code: e.code ?? 'bad_request', message: e.message } });
    req.log.error(err);
    return reply.code(500).send({ error: { code: 'internal', message: 'Unexpected server error' } });
  });

  app.get('/api/health', async () => ({ ok: true }));
  coreRoutes(app, ctx);
  workRoutes(app, ctx);
  assistRoutes(app, ctx);
  return app;
}
