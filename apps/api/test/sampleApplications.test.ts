import { afterAll, beforeAll, expect, it } from 'vitest';
import { APPLICATION_STAGES } from '../src/db/schema.js';
import { registerUser, setupTestApp, type TestApp } from './helpers.js';

let t: TestApp;
beforeAll(async () => { t = await setupTestApp(); });
afterAll(async () => { await t.close(); });

it('loads a private Dinh Dieu demo tracker once, preserving profile, CVs and existing applications', async () => {
  const { call } = await registerUser(t, 'dinh-dieu-demo@example.test');
  const other = await registerUser(t, 'other-demo@example.test');
  const profileBefore = await call('GET', '/api/profile');
  const resumesBefore = await call('GET', '/api/resumes');
  const jobList = await call('GET', '/api/jobs?limit=1');
  const original = await call('POST', '/api/applications', { jobId: jobList.items[0].id, notes: 'Keep this existing application.' });

  const result = await call('POST', '/api/applications/sample', {});
  expect(result).toMatchObject({ inserted: 10, existing: 0, total: 10, candidateName: 'Dinh Dieu' });
  const apps = await call('GET', '/api/applications');
  expect(apps).toHaveLength(11);
  expect(apps.find((a: { id: number }) => a.id === original.id).notes).toBe('Keep this existing application.');
  const demo = apps.filter((a: { source: string }) => a.source === 'Demo — Dinh Dieu');
  expect(new Set(demo.map((a: { stage: string }) => a.stage))).toEqual(new Set(APPLICATION_STAGES));
  expect(demo.every((a: { jobSnapshot: { isDemo: boolean; url: string | null }; jobId: number | null }) => a.jobSnapshot.isDemo && a.jobSnapshot.url == null && a.jobId == null)).toBe(true);
  expect((await call('GET', '/api/profile'))).toEqual(profileBefore);
  expect((await call('GET', '/api/resumes'))).toEqual(resumesBefore);
  expect(await other.call('GET', '/api/applications')).toEqual([]);
  await other.call('GET', `/api/applications/${result.applicationIds[0]}`, undefined, 404);

  const accepted = demo.find((a: { outcome: string }) => a.outcome === 'accepted');
  const detail = await call('GET', `/api/applications/${accepted.id}`);
  expect(detail.events.findIndex((e: { toStage: string }) => e.toStage === 'offer')).toBeLessThan(detail.events.findIndex((e: { toStage: string }) => e.toStage === 'closed'));
  const interview = demo.find((a: { stage: string }) => a.stage === 'interview');
  const interviewDetail = await call('GET', `/api/applications/${interview.id}`);
  expect(interviewDetail.rounds.length).toBeGreaterThan(0);
  expect(interviewDetail.nextActions.length).toBeGreaterThan(0);
  const analytics = await call('GET', '/api/applications/analytics');
  expect(analytics.total).toBe(11);
  expect(analytics.medianDaysToResponse).toBeGreaterThanOrEqual(0);

  const again = await Promise.all([call('POST', '/api/applications/sample', {}), call('POST', '/api/applications/sample', {})]);
  expect(again.every((r) => r.inserted === 0 && r.total === 10)).toBe(true);
  expect(await call('GET', '/api/applications')).toHaveLength(11);
});
