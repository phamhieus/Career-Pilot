// Starts the API and the web dev server together (cross-platform, no extra dependencies).
import { spawn } from 'node:child_process';

const run = (name, args) => {
  const child = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', args, { stdio: ['ignore', 'pipe', 'pipe'], shell: process.platform === 'win32' });
  const prefix = (chunk) => chunk.toString().split(/\r?\n/).filter(Boolean).map((l) => `[${name}] ${l}`).join('\n');
  child.stdout.on('data', (c) => console.log(prefix(c)));
  child.stderr.on('data', (c) => console.error(prefix(c)));
  child.on('exit', (code) => { console.log(`[${name}] exited with ${code}`); process.exit(code ?? 0); });
  return child;
};

const children = [run('api', ['run', 'dev', '-w', 'apps/api']), run('web', ['run', 'dev', '-w', 'apps/web'])];
const stop = () => { for (const c of children) c.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
