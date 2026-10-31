// Create a private recording account through the running app's API. No database edits or external submissions.
import { randomBytes } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const base = (process.env.DEMO_API_URL || 'http://localhost:4000').replace(/\/$/, '');
const file = resolve(root, '.data/demo-tracker.json');
const marker = 'Demo recording';
const stages = ['saved', 'applied', 'screening', 'assessment', 'interview', 'offer'];
const targets = ['saved', 'saved', 'applied', 'applied', 'screening', 'assessment', 'interview', 'interview', 'offer', 'closed'];
let cookie;
async function api(method, path, body) {
  const response = await fetch(`${base}${path}`, {
    method, signal: AbortSignal.timeout(30000),
    headers: { 'Content-Type': 'application/json', Origin: base, ...(cookie ? { Cookie: cookie } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const setCookie = response.headers.getSetCookie();
  if (setCookie.length) cookie = setCookie.map(value => value.split(';')[0]).join('; ');
  if (!response.ok) throw new Error(`${method} ${path}: ${response.status} ${await response.text()}`);
  return response.json();
}

try {
  let account;
  try { account = JSON.parse(await readFile(file, 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (account && account.api !== base) throw new Error('Existing recording account belongs to another API. Use its original DEMO_API_URL.');
  if (!account) {
    account = { api: base, email: `tracker.demo.${Date.now()}@careerpilot.test`, password: `Demo-${randomBytes(10).toString('hex')}!7aA`, displayName: 'Minh · Tracker Demo' };
    await api('POST', '/api/auth/register', { email: account.email, password: account.password, displayName: account.displayName });
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, JSON.stringify(account, null, 2));
  } else await api('POST', '/api/auth/login', { email: account.email, password: account.password });

  const catalog = await api('GET', '/api/jobs?limit=100&includeDemo=true');
  const demoJobs = catalog.items.filter(job => job.isDemo).sort((a, b) => a.id - b.id).slice(0, 10);
  if (demoJobs.length !== 10) throw new Error(`Expected 10 seeded Demo jobs; found ${demoJobs.length}.`);
  const existing = await api('GET', '/api/applications');
  const date = days => new Date(Date.now() + days * 86400000).toLocaleDateString('en-CA', { timeZone: 'Asia/Ho_Chi_Minh' });
  for (const [index, job] of demoJobs.entries()) {
    if (existing.some(row => row.jobSnapshot.title === job.title && row.jobSnapshot.company === job.company)) continue;
    const app = await api('POST', '/api/applications', {
      jobId: job.id, source: marker,
      notes: 'DEMO DATA: Fictional application for a website walkthrough. No real application was submitted and no company was contacted.',
    });
    const target = targets[index];
    const end = target === 'closed' ? stages.length - 1 : stages.indexOf(target);
    for (let stageIndex = 1; stageIndex <= end; stageIndex++) await api('POST', `/api/applications/${app.id}/stage`, {
      stage: stages[stageIndex], note: `Demo scenario: moved to ${stages[stageIndex]}.`,
    });
    if (target === 'closed') await api('POST', `/api/applications/${app.id}/stage`, { stage: 'closed', outcome: 'accepted', note: 'Demo scenario: fictional offer accepted.' });
    if (['applied', 'screening', 'assessment', 'interview'].includes(target)) await api('PATCH', `/api/applications/${app.id}`, {
      followUpAt: date(index % 3 + 1),
      contacts: [{ name: 'Alex Nguyen (Demo)', role: 'Recruiter (fictional)', email: 'alex@recruiter.example', note: 'Fictional contact for recording only.' }],
    });
    if (['screening', 'assessment', 'interview', 'offer'].includes(target)) {
      const type = target === 'screening' ? 'hr' : target === 'assessment' ? 'assessment' : 'technical';
      const round = await api('POST', `/api/applications/${app.id}/rounds`, {
        name: `${type === 'technical' ? 'Technical interview' : type === 'hr' ? 'Recruiter screening' : 'Take-home assessment'} (Demo)`,
        type, scheduledAt: `${date(2)}T10:00:00+07:00`, notes: 'Fictional event. Explain the approach, trade-offs and how you would measure success.',
      });
      if (target === 'offer') await api('PATCH', `/api/applications/${app.id}/rounds/${round.id}`, { status: 'completed', notes: 'Demo scenario: completed technical round; fictional offer received.' });
    }
    await api('POST', `/api/applications/${app.id}/notes`, { note: `Recording example: ${job.title} at ${job.company}. All details are fictional.` });
  }
  const applications = await api('GET', '/api/applications');
  const demoRows = applications.filter(row => row.source === marker);
  const analytics = await api('GET', '/api/applications/analytics');
  if (demoRows.length !== 10 || demoRows.some(row => !row.jobSnapshot.isDemo)) throw new Error('Tracker verification failed.');
  const counts = Object.fromEntries([...stages, 'closed'].map(stage => [stage, demoRows.filter(row => row.stage === stage).length]));
  const interview = demoRows.find(row => row.stage === 'interview');
  const detail = await api('GET', `/api/applications/${interview.id}`);
  if (!detail.rounds.length || !detail.events.length || analytics.total < 10) throw new Error('Missing interview rounds, timeline or analytics.');
  account.trackerUrl = 'http://localhost:5173/applications';
  account.interviewUrl = `http://localhost:5173/applications/${interview.id}`;
  account.stages = counts;
  account.applications = demoRows.map(row => ({ id: row.id, stage: row.stage, title: row.jobSnapshot.title, company: row.jobSnapshot.company }));
  await writeFile(file, JSON.stringify(account, null, 2));
  console.log(JSON.stringify({ email: account.email, credentialsFile: file, trackerUrl: account.trackerUrl, interviewUrl: account.interviewUrl, count: demoRows.length, stages: counts, verified: ['Demo labels', 'timeline', 'interview round', 'analytics'] }, null, 2));
} catch (error) {
  console.error(`Demo tracker seed failed: ${error.message}`);
  process.exitCode = 1;
}
