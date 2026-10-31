import { config } from '../config.js';
import { createContext } from '../context.js';
import { seedDatabase } from '../seed/index.js';
import { openDatabase } from './client.js';

const handle = await openDatabase({ url: config.databaseUrl, pgliteDir: config.pgliteDataDir });
const result = await seedDatabase(createContext(handle.db, config), { demoJobs: !process.argv.includes('--no-demo') });
console.log(`Seeded ${result.roles} roles and ${result.skills} skills (${handle.kind}).`);
await handle.close();
