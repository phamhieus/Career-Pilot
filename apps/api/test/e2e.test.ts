import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { aiRequestLogs } from '../src/db/schema.js';
import { registerUser, setupTestApp, type TestApp } from './helpers.js';

/** Fake OpenAI-compatible endpoint. Routes by the workflow instructions in the system prompt. */
function mockAi(): { fetch: typeof fetch; calls: string[] } {
  const calls: string[] = [];
  const reply = (obj: unknown) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(obj) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
  const fetchImpl = (async (_url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const sys: string = body.messages[0].content;
    const user: string = body.messages.at(-1).content;
    if (sys.includes('Extract structured facts from a job description')) {
      calls.push('parse_job');
      return reply({ title: 'AI Engineer', company: 'Imported Co', seniority: 'middle', location: 'Remote', workMode: 'remote', minYears: 2, salary: { min: 9999, max: 99999, currency: 'USD' }, requiredSkills: ['Python', 'RAG', 'LLM APIs', 'Quantum Basket Weaving'], preferredSkills: ['Kubernetes'], qualifications: [], certifications: [] });
    }
    if (sys.includes('Grade a candidate answer')) {
      calls.push('grade');
      const rubric = JSON.parse(user.match(/Rubric: (\[.*?\])\nHidden/s)![1]);
      const quote = user.match(/<untrusted_document kind="candidate_answer">\n([^.\n]{10,60})/)?.[1] ?? 'not-in-answer';
      return reply({ criteria: rubric.map((r: { criterion: string }) => ({ criterion: r.criterion, score: 3.5, comment: 'Solid' })), strengths: ['Clear structure'], gaps: [], evidenceQuotes: [quote, 'this quote was never said'], needsFollowUp: false, followUpFocus: null });
    }
    if (sys.includes('You are a fair, professional interviewer')) {
      calls.push('question');
      return reply({ question: `Mock question #${calls.length}: walk me through a relevant project.`, rubric: [{ criterion: 'Depth', weight: 0.6, indicators: ['because'] }, { criterion: 'Clarity', weight: 0.4, indicators: ['first'] }], idealPoints: ['Concrete example', 'Trade-offs'] });
    }
    if (sys.includes('Rewrite CV bullet points')) {
      calls.push('rewrite');
      const doc = JSON.parse(user.replace(/^<untrusted_document[^>]*>\n/, '').replace(/\n<\/untrusted_document>$/, ''));
      // First bullet gets a fabricated metric; the validator must flag it.
      return reply({ bullets: doc.map((b: { id: string; text: string }, i: number) => ({ id: b.id, text: i === 0 ? `${b.text}, improving throughput by 40%` : b.text })) });
    }
    if (sys.includes("Rewrite the candidate's professional summary")) { calls.push('summary'); return reply({ text: 'Backend developer building Java and Spring Boot APIs with PostgreSQL, now focused on AI engineering.' }); }
    if (sys.includes('From a career discovery conversation')) { calls.push('discovery'); return reply({ interests: ['ai-data', 'not-a-family'], workValues: ['learning', 'impact'], taskAffinity: { building: 5, research: 4, bogus: 3 }, goals: 'Move into AI engineering', constraints: ['10 hours per week'] }); }
    if (sys.includes('Write 3 accurate multiple-choice')) { calls.push('mcq'); return reply({ items: [{ prompt: 'Generated question about the skill?', options: ['a', 'b', 'c', 'd'], correctIndex: 1, explanation: 'b', difficulty: 3 }] }); }
    if (sys.includes('Extract a structured CV')) { calls.push('cv'); return reply({ name: 'X', items: [], skills: [] }); }
    if (sys.includes('interview coach')) { calls.push('coach'); return reply({ summary: 'Clear structure; add measurable outcomes.', improvements: ['Quantify results you can stand behind'], questionTips: [{ index: 1, tip: 'Lead with the situation', betterStructure: 'Situation → actions → result' }, { index: 999, tip: 'bogus', betterStructure: '' }], nextFocus: ['RAG evaluation'] }); }
    if (sys.includes('pragmatic career coach')) {
      calls.push('suggest');
      const allowed = JSON.parse(sys.match(/list \(or null\): (\[.*?\])\./)![1]);
      return reply({ suggestions: [{ title: 'Practice the technical round', detail: 'Your next round is technical.', link: allowed[0] }, { title: 'Bad link', detail: 'Points outside the app', link: 'https://evil.example' }] });
    }
    if (sys.includes('Reply with JSON')) { calls.push('ping'); return reply({ ok: true }); }
    throw new Error(`unexpected AI call: ${sys.slice(0, 80)}`);
  }) as typeof fetch;
  return { fetch: fetchImpl, calls };
}

const fixture = (f: string) => readFileSync(resolve(import.meta.dirname, '../fixtures/cert-trends', f), 'utf8');
const certTrendsFetch = (async (url: string) => {
  const name = url.split('/').pop()!;
  if (!['jobs.json', 'roles.json'].includes(name)) return new Response('nope', { status: 404 });
  return new Response(fixture(name), { status: 200, headers: { 'content-type': 'application/json' } });
}) as unknown as typeof fetch;

const CV_TEXT = `Minh Tran
Backend Developer

Summary
Backend developer building REST APIs with Java and Spring Boot and PostgreSQL.

Experience
Backend Developer at Example Retail Platform  Mar 2021 - Present
- Built REST APIs in Java and Spring Boot for order flows
- Designed PostgreSQL schemas and added indexes
- Containerized services with Docker

Education
B.Sc. Computer Science, Example University 2015 - 2019

Skills
Java, Spring Boot, PostgreSQL, Docker, Redis, Git, Python`;

const ANSWER = 'First I reproduced the problem because users reported slow pages. Then I measured, I proposed caching and we cut latency. I learned to measure before optimizing and would add alerts next time.';

describe('acceptance scenario (backend developer → AI engineer)', () => {
  let t: TestApp;
  let ai: ReturnType<typeof mockAi>;
  beforeAll(async () => {
    ai = mockAi();
    t = await setupTestApp({ aiFetch: ai.fetch, fetch: certTrendsFetch, ai: { provider: 'deepseek', apiKey: 'test-key', baseUrl: 'https://mock.local/v1', model: 'deepseek-chat' } });
  });
  afterAll(async () => { await t?.close(); });

  it('runs the full flow with consistent records', async () => {
    const { call, cookie } = await registerUser(t);
    const ob0 = await call('GET', '/api/onboarding');
    expect(ob0.completed).toBe(0);
    expect(ob0.total).toBe(15);
    expect(ob0.current).toBe(1);

    // 1. Import a CV (mock AI extracts nothing here); then load the labeled sample profile.
    const imported = await call('POST', '/api/profile/import-cv', { text: CV_TEXT });
    expect(imported.aiMeta.mode).toBe('ai');
    // Load the labeled sample profile to get confirmed experience + self-reported skills.
    const prof = await call('POST', '/api/profile/sample');
    expect(prof.items.some((i: { confirmed: boolean; kind: string }) => i.kind === 'work' && i.confirmed)).toBe(true);
    expect(prof.skills.find((s: { slug: string }) => s.slug === 'java').status).toBe('self_reported');
    await call('PATCH', '/api/profile', { weeklyLearningHours: 10, deadline: '2027-10-31' });

    // 2. Discovery interview → suggestions, applied only on confirmation.
    const disc = await call('POST', '/api/interviews', { mode: 'discovery', durationMinutes: 20 });
    expect(disc.blueprint.topics).toHaveLength(8);
    await call('POST', `/api/interviews/${disc.id}/start`, { background: { situation: 'tech', currentRoleSlug: 'no-such-role' } }, 404);
    const discStart = await call('POST', `/api/interviews/${disc.id}/start`, { background: { situation: 'tech', currentRoleSlug: 'backend-engineer', currentTitle: 'Backend dev', yearsExperience: 5, education: 'cs', summary: 'Five years of Java APIs.' } });
    expect(discStart.session.blueprint.context.background).toMatchObject({ situation: 'tech', yearsExperience: 5 });
    expect((await call('GET', '/api/profile')).profile).toMatchObject({ currentRoleSlug: 'backend-engineer', yearsExperience: 5, headline: 'Backend Developer (sample profile)' }); // existing text is kept
    let q = discStart.question;
    expect(q.options.choices.length).toBeGreaterThan(1);
    const picks: Record<string, string[]> = { 'discovery:energy': ['building', 'research'], 'discovery:strengths': ['analysis'], 'discovery:project': ['team'], 'discovery:goals': ['career-change'], 'discovery:drain': ['organizing', 'building'], 'discovery:values': ['learning'], 'discovery:areas': ['cloud-devops'], 'discovery:hours': ['hours-5-10'] };
    await call('POST', `/api/interviews/${disc.id}/answer`, { choices: ['building', 'analysis', 'design', 'research'] }, 400); // over the limit
    let guard = 0;
    while (q && guard++ < 10) {
      const r = await call('POST', `/api/interviews/${disc.id}/answer`, { choices: q.kind === 'follow_up' ? ['building'] : picks[q.topicKey], content: q.topicKey === 'discovery:energy' ? 'I love building things and researching new AI tools.' : '' });
      q = r.nextQuestion;
    }
    const discDetail = await call('GET', `/api/interviews/${disc.id}`);
    expect(discDetail.session.status).toBe('completed');
    expect(discDetail.messages.filter((m: { kind: string }) => m.kind === 'follow_up')).toHaveLength(1);
    const sugg = discDetail.report.profileSuggestions;
    expect(sugg.topMatches).toHaveLength(3);
    expect(sugg.topMatches[0].reasons.length).toBeGreaterThan(0);
    expect(sugg.selfReportedStrengths.length).toBeGreaterThan(0);
    expect(sugg.goals).toBe('Change career paths');
    expect(sugg.interests).toEqual(['cloud-devops', 'ai-data']); // chosen first; invalid family from the note filtered out
    expect(sugg.taskAffinity).toMatchObject({ building: 5, research: 5, organizing: 2 }); // energy beats drain
    expect(sugg.taskAffinity).not.toHaveProperty('bogus');
    expect(sugg.constraints[0]).toBe('Can study 5–10 hours a week');
    await call('POST', '/api/profile/apply-discovery', { interests: sugg.interests, workValues: sugg.workValues, taskAffinity: sugg.taskAffinity });

    // 3. Explore roles.
    const aiRole = await call('GET', '/api/atlas/ai-engineer');
    expect(aiRole.role.details.outlook.observations.length).toBeGreaterThan(0);
    expect(aiRole.requirements.some((r: { critical: boolean }) => r.critical)).toBe(true);
    const cloudRole = await call('GET', '/api/atlas/cloud-engineer');
    expect((await call('GET', '/api/onboarding')).steps.find((s: { key: string }) => s.key === 'roles').done).toBe(true);
    expect(cloudRole.transitionsFrom.some((x: { role: { slug: string } }) => x.role.slug === 'backend-engineer')).toBe(true);

    // 4. Matching: four independent dimensions + evidence gaps.
    const m = await call('GET', '/api/matching/ai-engineer');
    expect(m.dimensions.map((d: { key: string }) => d.key)).toEqual(['capability', 'interest', 'growth', 'market']);
    expect(m.criticalGate.status).not.toBe('clear');
    expect(m.requirements.find((r: { skillSlug: string }) => r.skillSlug === 'rag').state).toBe('unknown');
    expect(m.transferableFrom.roleSlug).toBe('backend-engineer');
    expect(m.capabilityBreakdown.skillPoints + (m.capabilityBreakdown.experiencePoints ?? 0)).toBeCloseTo(m.dimensions[0].score, 0);
    expect(m.skillTransfer.currentRole.slug).toBe('backend-engineer');
    expect(m.skillTransfer.direct.some((s: { skillSlug: string; roleShared: boolean }) => s.skillSlug === 'api-design' && s.roleShared)).toBe(true);
    expect(m.skillTransfer.direct.some((s: { skillSlug: string }) => s.skillSlug === 'rag')).toBe(false);
    expect(m.requirements.find((r: { skillSlug: string }) => r.skillSlug === 'rag')).toMatchObject({ trust: null, levelFit: null });

    // 5. Roadmap.
    const rm = await call('GET', '/api/roadmaps/ai-engineer');
    expect(rm.nodes.length).toBeGreaterThan(15);
    expect(rm.nodes.find((n: { key: string }) => n.key === 'python').status).toBe('assessment_required');
    expect(rm.nodes.find((n: { key: string }) => n.key === 'rag').locked).toBe(true);

    // 6. Jobs: real Cert Trends sync (dedup on re-sync) + labeled demo job + manual import.
    const sync1 = await call('POST', '/api/jobs/sources/cert-trends/sync', {});
    expect(sync1.inserted).toBeGreaterThan(300);
    expect(sync1.observations).toBeGreaterThan(100);
    const sync2 = await call('POST', '/api/jobs/sources/cert-trends/sync', {});
    expect(sync2.inserted).toBe(0);
    expect(sync2.updated).toBe(0);
    expect(sync1.inBatchDuplicates).toBeGreaterThan(0);
    expect(sync2.unchanged).toBe(sync1.inserted + sync1.unchanged + sync1.updated);
    // Market drill-downs agree with the overview figures they open from.
    const mkt = await call('GET', '/api/market');
    const topCert = mkt.current.certifications[0];
    const certDrill = await call('GET', `/api/market/drilldown?dimension=cert&key=${encodeURIComponent(topCert.id)}`);
    expect(certDrill.count).toBe(topCert.total);
    expect(certDrill.breakdown.cert).toEqual([]);
    expect(certDrill.postings.length).toBe(Math.min(25, topCert.total));
    const month = mkt.historical.postingsByMonth.at(-1);
    expect((await call('GET', `/api/market/drilldown?dimension=month&key=${month.key}`)).count).toBe(month.value);
    expect((await call('GET', '/api/market/drilldown?dimension=total&key=active')).count).toBe(mkt.totals.active);
    await call('GET', '/api/market/drilldown?dimension=bogus&key=x', undefined, 400);
    const demoList = await call('GET', '/api/jobs?role=ai-engineer&limit=20');
    const demoJob = demoList.items.find((j: { isDemo: boolean; title: string }) => j.isDemo && j.title.startsWith('AI Engineer'));
    expect(demoJob).toBeTruthy();
    const imp = await call('POST', '/api/jobs/import', { text: 'AI Engineer\nRequirements\n- Python\n- RAG pipelines with a vector database\n- Experience with LLM APIs\nNice to have\n- Kubernetes\n'.repeat(2) });
    const impJob = await call('GET', `/api/jobs/${imp.jobId}`);
    expect(impJob.job.salaryMin).toBeNull(); // AI-claimed salary not present in text → rejected
    expect(impJob.job.unknownRequirements).toContain('Quantum Basket Weaving');
    expect(impJob.job.ownerUserId).not.toBeNull();

    // 7. Job match with critical gaps & a direct link.
    const jd = await call('GET', `/api/jobs/${demoJob.id}`);
    expect(jd.job.isDemo).toBe(true);
    expect(jd.match.unknownRequirements.map((u: { label: string }) => u.label)).toContain('Retrieval-Augmented Generation');
    expect(jd.match.recommendedAssessments.length).toBeGreaterThan(0);
    expect(jd.match.roadmapNodes.some((n: { roleSlug: string }) => n.roleSlug === 'ai-engineer')).toBe(true);

    // 8. Learning plan.
    const plan = await call('POST', '/api/learning', { roleSlug: 'ai-engineer' });
    let detail = await call('GET', `/api/learning/${plan.id}`);
    expect(detail.tasks.length).toBeGreaterThan(10);
    expect(detail.revisions[0].reason).toBe('created');
    expect(detail.plan.learningFormat).toBe('docs');
    expect(detail.learningOptions.length).toBeGreaterThan(0);
    expect(detail.learningOptions[0].youtubeSearchUrl).toMatch(/^https:\/\/www.youtube.com\/results\?search_query=/);
    expect(detail.videoSeries[0].id).toBe('microsoft-genai');
    expect(detail.learningOptions.find((o: { nodeKey: string }) => o.nodeKey === 'python').series.some((s: { id: string }) => s.id === 'cs50-python')).toBe(true);
    const pyTask = detail.tasks.find((x: { skillSlug: string; type: string }) => x.skillSlug === 'python' && x.type === 'practice');

    // 9. Practice task + assessment (MCQ objective + AI-rubric practical).
    await call('PATCH', `/api/learning/tasks/${pyTask.id}`, { status: 'done' });
    const bp = await call('POST', '/api/assessments/blueprints', { skillSlugs: ['python'], level: 3 });
    const attempt = await call('POST', `/api/assessments/blueprints/${bp.id}/attempts`);
    const view = await call('GET', `/api/assessments/attempts/${attempt.id}`);
    expect(view.items.every((i: { correctIndex?: number }) => i.correctIndex === undefined)).toBe(true); // no answer key before grading
    const { ITEMS } = await import('../src/seed/data/assessments.js');
    const answers: Record<string, { choice?: number; text?: string }> = {};
    for (const it of view.items) {
      if (it.type === 'mcq') answers[it.id] = { choice: ITEMS.find((x) => x.prompt === it.prompt)!.correctIndex };
      else answers[it.id] = { text: 'I would use a dataclass with Decimal amounts, validate required fields, collect errors for invalid rows and test with pytest parametrize for edge cases.' };
    }
    const graded = await call('POST', `/api/assessments/attempts/${attempt.id}/submit`, { answers });
    expect(graded.evaluation.passed).toBe(true);
    expect(graded.evaluation.perSkill[0].newStatus).toBe('app_verified');

    // 10. Progress & evidence update + plan revision.
    const profAfter = await call('GET', '/api/profile');
    const py = profAfter.skills.find((s: { slug: string }) => s.slug === 'python');
    expect(py.status).toBe('app_verified');
    expect(py.evidence.some((e: { type: string; gradingMethod: string }) => e.type === 'quiz' && e.gradingMethod === 'objective')).toBe(true);
    detail = await call('GET', `/api/learning/${plan.id}`);
    expect(detail.revisions[0].reason).toBe('assessment_passed');
    expect(detail.tasks.filter((x: { skillSlug: string; status: string }) => x.skillSlug === 'python' && x.status === 'todo')).toHaveLength(0);
    await call('PATCH', `/api/learning/${plan.id}/format`, { learningFormat: 'project' });
    detail = await call('GET', `/api/learning/${plan.id}`);
    expect(detail.plan.learningFormat).toBe('project');
    expect(detail.tasks.some((t: { id: number; status: string }) => t.id === pyTask.id && t.status === 'done')).toBe(true);
    await call('POST', `/api/learning/${plan.id}/replan`, {});
    expect((await call('GET', `/api/learning/${plan.id}`)).plan.learningFormat).toBe('project');
    await call('POST', '/api/onboarding/seen', { key: 'skills' });
    await call('POST', '/api/onboarding/seen', { key: 'not-allowed' }, 400);
    const rm2 = await call('GET', '/api/roadmaps/ai-engineer');
    expect(rm2.nodes.find((n: { key: string }) => n.key === 'python').status).toBe('app_verified');

    // 11. Job-specific mock interview; no model answers revealed until completion.
    const sess = await call('POST', '/api/interviews', { mode: 'job_specific', jobId: demoJob.id, roundType: 'technical', durationMinutes: 12 });
    expect(sess.blueprint.topics.length).toBeGreaterThan(0);
    const started = await call('POST', `/api/interviews/${sess.id}/start`);
    expect(started.question.idealPoints).toBeNull();
    let report;
    for (let i = 0; i < 15; i++) {
      const r = await call('POST', `/api/interviews/${sess.id}/answer`, { content: ANSWER, inputMode: 'text' });
      expect(r.feedback).toBeNull(); // formal mode: no per-answer feedback
      if (r.completed) { report = r; break; }
      const mid = await call('GET', `/api/interviews/${sess.id}`);
      expect(mid.messages.every((x: { idealPoints: unknown; evaluation: unknown }) => x.idealPoints === null && x.evaluation === null)).toBe(true);
    }
    expect(report?.completed).toBe(true);
    const sDetail = await call('GET', `/api/interviews/${sess.id}`);
    expect(sDetail.report.overallScore).toBeGreaterThan(0);
    expect(sDetail.report.caveats[0]).toMatch(/never verify/);
    expect(sDetail.report.coaching.summary).toMatch(/measurable/);
    expect(sDetail.report.coaching.questionTips.map((q: { index: number }) => q.index)).toEqual([1]); // invalid index dropped
    expect(sDetail.messages.some((x: { idealPoints: unknown }) => Array.isArray(x.idealPoints))).toBe(true);
    for (const qf of sDetail.report.questionFeedback) for (const q of qf.quotes) expect(ANSWER).toContain(q); // hallucinated quote removed
    const profAfterInterview = await call('GET', '/api/profile');
    const rag = profAfterInterview.skills.find((s: { slug: string }) => s.slug === 'rag');
    if (rag) expect(rag.status).toBe('assessed'); // interview evidence never verifies

    // 12. Tailored CV from confirmed evidence; fabricated metric is flagged.
    const cv = await call('POST', '/api/resumes', { kind: 'tailored', jobId: demoJob.id });
    expect(cv.version.versionNo).toBe(1);
    const flagged = cv.version.quality.unverifiedClaims;
    expect(flagged.some((f: { issues: string[] }) => f.issues.some((i) => i.includes('40%')))).toBe(true);
    const allBullets = cv.version.content.sections.flatMap((s: any) => s.entries.flatMap((e: any) => e.bullets));
    expect(allBullets.filter((b: any) => b.status === 'supported').every((b: any) => b.evidence.length > 0)).toBe(true);
    // Edit: revert the fabricated bullet, add an unsupported bullet, save → v2.
    const content = structuredClone(cv.version.content);
    const exp = content.sections.find((s: any) => s.type === 'experience');
    const bad = exp.entries.flatMap((e: any) => e.bullets).find((b: any) => b.status === 'needs_confirmation');
    bad.text = bad.originalText;
    exp.entries[0].bullets.push({ id: 'b_user1', text: 'Led a team of 12 engineers', evidence: [] });
    exp.entries[0].bullets[0].locked = true;
    const v2 = await call('POST', `/api/resumes/${cv.resume.id}/versions`, { content, note: 'Edited' });
    expect(v2.versionNo).toBe(2);
    const v2Bullets = v2.content.sections.flatMap((s: any) => s.entries.flatMap((e: any) => e.bullets));
    expect(v2Bullets.find((b: any) => b.id === bad.id).status).toBe('supported');
    expect(v2Bullets.find((b: any) => b.id === 'b_user1').status).toBe('needs_confirmation');
    // Regenerate keeps locked content.
    const v3 = await call('POST', `/api/resumes/${cv.resume.id}/regenerate`);
    expect(v3.versionNo).toBe(3);
    const lockedId = exp.entries[0].bullets[0].id;
    expect(v3.content.sections.flatMap((s: any) => s.entries.flatMap((e: any) => e.bullets)).some((b: any) => b.id === lockedId && b.locked)).toBe(true);

    // 13. Export.
    const pdfRes = await t.app.inject({ method: 'GET', url: `/api/resumes/${cv.resume.id}/export?format=pdf&versionId=${v2.id}`, headers: { cookie } });
    expect(pdfRes.statusCode).toBe(200);
    expect(pdfRes.rawPayload.subarray(0, 4).toString()).toBe('%PDF');
    const docxRes = await t.app.inject({ method: 'GET', url: `/api/resumes/${cv.resume.id}/export?format=docx`, headers: { cookie } });
    expect(docxRes.rawPayload.subarray(0, 2).toString()).toBe('PK');

    // 14. Save job to tracker with the exact CV version.
    const appRow = await call('POST', '/api/applications', { jobId: demoJob.id, resumeVersionId: v2.id });
    expect(appRow.stage).toBe('saved');
    expect(appRow.jobSnapshot.title).toBe(jd.job.title);
    expect(appRow.jobSnapshot.isDemo).toBe(true);
    await call('POST', '/api/applications', { jobId: demoJob.id }, 409);

    // 15. Track & next actions.
    await call('POST', `/api/applications/${appRow.id}/stage`, { stage: 'applied' });
    await call('POST', `/api/applications/${appRow.id}/stage`, { stage: 'interview' });
    await call('POST', `/api/applications/${appRow.id}/rounds`, { name: 'Technical interview', type: 'technical', scheduledAt: '2026-11-05' });
    await call('POST', `/api/applications/${appRow.id}/stage`, { stage: 'closed' }, 400);
    const appDetail = await call('GET', `/api/applications/${appRow.id}`);
    expect(appDetail.events.map((e: { type: string }) => e.type)).toEqual(['created', 'stage_changed', 'stage_changed', 'round_added']);
    expect(appDetail.resume.versionId).toBe(v2.id);
    expect(appDetail.nextActions[0].title).toMatch(/Technical interview/);
    expect(appDetail.interviewSessions.map((s: { id: number }) => s.id)).toContain(sess.id);
    const analytics = await call('GET', '/api/applications/analytics');
    expect(analytics.total).toBe(1);

    const appSugg = await call('GET', `/api/applications/${appRow.id}/suggestions`);
    expect(appSugg.meta.mode).toBe('ai');
    expect(appSugg.suggestions).toHaveLength(2);
    expect(appSugg.suggestions[0].link).toMatch(/^\//);
    expect(appSugg.suggestions[1].link).toBeUndefined(); // off-list link dropped
    const dashSugg = await call('GET', '/api/suggestions/dashboard');
    expect(dashSugg.suggestions.length).toBeGreaterThan(0);
    const obEnd = await call('GET', '/api/onboarding');
    expect(obEnd.steps.filter((s: { done: boolean }) => !s.done).map((s: { key: string }) => s.key)).toEqual([]);
    expect(obEnd.completed).toBe(15);

    // Dashboard ties it together.
    const dash = await call('GET', '/api/dashboard');
    expect(dash.plan.id).toBe(plan.id);
    expect(dash.applications.open).toBe(1);

    // AI request log stores metadata only.
    const logs = await t.ctx.db.select().from(aiRequestLogs).where(eq(aiRequestLogs.success, true));
    expect(logs.length).toBeGreaterThan(5);
    expect(Object.keys(logs[0])).not.toContain('content');
  });

});

describe('authorization, adaptation and fallbacks (heuristic mode)', () => {
  let t: TestApp;
  beforeAll(async () => { t = await setupTestApp(); });
  afterAll(async () => { await t?.close(); });

  it('isolates private data between users', async () => {
    const a = await registerUser(t, 'a@example.com');
    const b = await registerUser(t, 'b@example.com');
    await a.call('POST', '/api/profile/sample');
    const imp = await a.call('POST', '/api/jobs/import', { text: 'Data Engineer\nRequirements\n- SQL\n- Python\n- Airflow pipelines and dbt models in production' });
    const cv = await a.call('POST', '/api/resumes', { kind: 'master' });
    const app = await a.call('POST', '/api/applications', { jobId: imp.jobId, resumeVersionId: cv.version.id });
    await b.call('GET', `/api/jobs/${imp.jobId}`, undefined, 404);
    await b.call('GET', `/api/resumes/${cv.resume.id}`, undefined, 404);
    await b.call('GET', `/api/applications/${app.id}`, undefined, 404);
    await b.call('POST', '/api/applications', { jobId: imp.jobId }, 404);
    const jobsB = await b.call('GET', '/api/jobs?limit=100');
    expect(jobsB.items.some((j: { id: number }) => j.id === imp.jobId)).toBe(false);
    const unauth = await t.app.inject({ method: 'GET', url: '/api/profile' });
    expect(unauth.statusCode).toBe(401);
    const cross = await t.app.inject({ method: 'POST', url: '/api/profile/sample', headers: { cookie: a.cookie, origin: 'https://evil.example' } });
    expect(cross.statusCode).toBe(403);
    // Account deletion removes private data.
    await a.call('DELETE', '/api/me');
    const gone = await t.app.inject({ method: 'GET', url: '/api/profile', headers: { cookie: a.cookie } });
    expect(gone.statusCode).toBe(401);
  });

  it('heuristic grading assesses but never verifies; failures add remedial tasks; missed sessions reschedule', async () => {
    const u = await registerUser(t, 'c@example.com');
    await u.call('POST', '/api/profile/sample');
    const plan = await u.call('POST', '/api/learning', { roleSlug: 'cloud-engineer', weeklyHours: 6 });
    const bp = await u.call('POST', '/api/assessments/blueprints', { skillSlugs: ['networking'], level: 3 });
    const attempt = await u.call('POST', `/api/assessments/blueprints/${bp.id}/attempts`);
    const view = await u.call('GET', `/api/assessments/attempts/${attempt.id}`);
    const answers: Record<string, { choice?: number; text?: string }> = {};
    for (const it of view.items) answers[it.id] = it.type === 'mcq' ? { choice: 3 } : { text: 'Not sure, I would google it and ask a colleague for help with this one.' };
    const graded = await u.call('POST', `/api/assessments/attempts/${attempt.id}/submit`, { answers });
    expect(graded.evaluation.passed).toBe(false);
    expect(graded.evaluation.uncertainties.join(' ')).toMatch(/heuristic/);
    const detail = await u.call('GET', `/api/learning/${plan.id}`);
    expect(detail.tasks.some((x: { type: string; skillSlug: string }) => x.type === 'remedial' && x.skillSlug === 'networking')).toBe(true);
    expect(detail.revisions[0].reason).toBe('assessment_failed');
    await u.call('POST', `/api/assessments/attempts/${attempt.id}/submit`, { answers }, 409);

    // Two weeks pass with nothing done → missed sessions are rescheduled from "today".
    t.setNow(new Date('2026-11-12T09:00:00Z'));
    const res = await u.call('POST', `/api/learning/${plan.id}/reschedule-missed`);
    expect(res.missed).toBeGreaterThan(0);
    const after = await u.call('GET', `/api/learning/${plan.id}`);
    expect(after.revisions[0].reason).toBe('missed_sessions');
    expect(after.tasks.filter((x: { status: string; scheduledDate: string | null }) => x.status === 'todo' && x.scheduledDate && x.scheduledDate < '2026-11-12')).toHaveLength(0);
    // Goal change archives the old plan and keeps history.
    const newPlan = await u.call('POST', '/api/learning', { roleSlug: 'devops-engineer', weeklyHours: 6 });
    const plans = await u.call('GET', '/api/learning');
    expect(plans.find((p: { plan: { id: number } }) => p.plan.id === plan.id).plan.status).toBe('archived');
    expect(plans.find((p: { plan: { id: number } }) => p.plan.id === newPlan.id).plan.status).toBe('active');
    t.setNow(new Date('2026-10-31T09:00:00Z'));
  });

  it('versions CVs and restores previous versions', async () => {
    const u = await registerUser(t, 'd@example.com');
    await u.call('POST', '/api/profile/sample');
    const cv = await u.call('POST', '/api/resumes', { kind: 'master', language: 'vi' });
    expect(cv.version.quality.unverifiedClaims).toEqual([]); // master CV built purely from evidence has no flags
    expect(cv.version.content.sections[0].title).toBe('Giới thiệu');
    const c2 = structuredClone(cv.version.content);
    c2.header.headline = 'Changed headline';
    const v2 = await u.call('POST', `/api/resumes/${cv.resume.id}/versions`, { content: c2 });
    const restored = await u.call('POST', `/api/resumes/${cv.resume.id}/versions/${cv.version.id}/restore`);
    expect(restored.versionNo).toBe(3);
    expect(restored.content.header.headline).toBe(cv.version.content.header.headline);
    const d = await u.call('GET', `/api/resumes/${cv.resume.id}`);
    expect(d.versions.map((v: { versionNo: number }) => v.versionNo)).toEqual([3, 2, 1]);
    expect(v2.versionNo).toBe(2);
    await u.call('POST', `/api/resumes/${cv.resume.id}/versions`, { content: { header: {}, sections: 'nope' } }, 400);
  });

  it('stores per-user AI settings encrypted and uses them for that user only', async () => {
    const seen: { url: string; auth: string }[] = [];
    const aiFetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: String((init.headers as Record<string, string>).authorization) });
      return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ok: true }) } }] }), { status: 200, headers: { 'content-type': 'application/json' } });
    }) as unknown as typeof fetch;
    const t3 = await setupTestApp({ aiFetch, demoJobs: false });
    try {
      const a = await registerUser(t3, 'keys-a@example.com');
      const b = await registerUser(t3, 'keys-b@example.com');
      const before = await a.call('GET', '/api/settings/ai');
      expect(before.source).toBe('none');
      await a.call('PUT', '/api/settings/ai', { provider: 'deepseek' }, 400); // key required first time
      await a.call('PUT', '/api/settings/ai', { provider: 'openai-compatible', apiKey: 'sk-test-1234567890', model: 'm', baseUrl: 'http://example.com/v1' }, 400);
      const saved = await a.call('PUT', '/api/settings/ai', { provider: 'deepseek', apiKey: 'sk-secret-abcd1234' });
      expect(saved.source).toBe('user');
      expect(saved.user).toMatchObject({ provider: 'deepseek', model: 'deepseek-chat', baseUrl: 'https://api.deepseek.com/v1', keyHint: '••••1234' });
      expect(JSON.stringify(saved)).not.toContain('sk-secret');
      const { userAiSettings } = await import('../src/db/schema.js');
      const [row] = await t3.ctx.db.select().from(userAiSettings);
      expect(row.encryptedKey).not.toContain('sk-secret');
      const test = await a.call('POST', '/api/settings/ai/test');
      expect(test).toMatchObject({ ok: true, provider: 'deepseek' });
      expect(seen.at(-1)).toEqual({ url: 'https://api.deepseek.com/v1/chat/completions', auth: 'Bearer sk-secret-abcd1234' });
      expect((await a.call('GET', '/api/meta')).ai).toMatchObject({ configured: true, provider: 'deepseek' });
      expect((await b.call('GET', '/api/meta')).ai.configured).toBe(false); // other users unaffected
      // Changing the model keeps the stored key.
      await a.call('PUT', '/api/settings/ai', { provider: 'deepseek', model: 'deepseek-reasoner' });
      await a.call('POST', '/api/settings/ai/test');
      expect(seen.at(-1)!.auth).toBe('Bearer sk-secret-abcd1234');
      expect((await a.call('DELETE', '/api/settings/ai')).source).toBe('none');
    } finally {
      await t3.close();
    }
  });

  it('degrades to labeled heuristics when the AI provider fails', async () => {
    const failing = (async () => new Response('boom', { status: 503 })) as unknown as typeof fetch;
    const t2 = await setupTestApp({ aiFetch: failing, demoJobs: false, ai: { provider: 'openai', apiKey: 'k', baseUrl: 'https://mock.local/v1', model: 'm' } });
    try {
      const u = await registerUser(t2, 'e@example.com');
      const r = await u.call('POST', '/api/jobs/import', { text: 'Cloud Engineer\nRequirements\n- AWS and Terraform\n- Linux and networking fundamentals for production systems' });
      expect(r.aiMeta.mode).toBe('heuristic');
      expect(r.aiMeta.fallbackReason).toMatch(/server_error/);
      const job = await u.call('GET', `/api/jobs/${r.jobId}`);
      expect(job.job.requiredSkills).toEqual(expect.arrayContaining(['aws', 'iac', 'linux', 'networking']));
    } finally {
      await t2.close();
    }
  });
});
