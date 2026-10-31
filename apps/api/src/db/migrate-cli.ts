import { config } from '../config.js';
import { openDatabase } from './client.js';

const handle = await openDatabase({ url: config.databaseUrl, pgliteDir: config.pgliteDataDir });
console.log(`Migrations applied (${handle.kind}).`);
await handle.close();
