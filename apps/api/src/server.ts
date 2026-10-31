import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import fastifyStatic from '@fastify/static';
import { config } from './config.js';
import { openDatabase } from './db/client.js';
import { createContext } from './context.js';
import { seedDatabase } from './seed/index.js';
import { buildApp } from './app.js';
import { startJobSyncScheduler } from './services/jobs/providers.js';

const handle = await openDatabase({ url: config.databaseUrl, pgliteDir: config.pgliteDataDir });
const ctx = createContext(handle.db, config);
const seeded = await seedDatabase(ctx);
const app = await buildApp(ctx, { logger: true });

// Serve the built frontend in production if present.
const webDist = resolve(process.cwd(), '../web/dist');
if (config.isProduction && existsSync(webDist)) {
  await app.register(fastifyStatic, { root: webDist });
  app.setNotFoundHandler((req, reply) => (req.url.startsWith('/api') ? reply.code(404).send({ error: { code: 'not_found', message: 'Not found' } }) : reply.sendFile('index.html')));
}

const stopSync = startJobSyncScheduler(ctx, (m) => app.log.info(m));
await app.listen({ port: config.port, host: '0.0.0.0' });
app.log.info(`CareerPilot API on :${config.port} — db=${handle.kind}, ai=${ctx.ai.status().provider}, catalog=${seeded.roles} roles/${seeded.skills} skills`);

const shutdown = async () => {
  stopSync();
  await app.close();
  await handle.close();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
