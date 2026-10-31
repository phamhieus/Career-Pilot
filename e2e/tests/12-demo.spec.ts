import { expect, type Locator, type Page, test } from '@playwright/test';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { api, demoAiJobId, GOOD_ANSWER, PASSWORD, uniqueEmail } from './helpers';
import { explain, focusSection } from './demo-presentation';

// The 3-minute demo path (docs/DEMO.md), scene by scene. A normal run is a fast rehearsal that proves every
// click in the script still works; `npm run demo:auto` replays it in a visible browser at presenting pace.
const recordingDir = process.env.DEMO_RECORD_DIR;
const DEMO = process.env.DEMO === '1' || !!recordingDir;
const beat = (page: Page, ms: number) => (DEMO ? page.waitForTimeout(ms) : Promise.resolve());
test.use({ colorScheme: 'dark', video: recordingDir ? { mode: 'on', size: { width: 1440, height: 900 } } : 'off' });

test.describe('Demo script (3 minutes)', () => {
  test.skip(!!process.env.CI && !DEMO, 'rehearsal runs locally');
  test.setTimeout(DEMO ? 300_000 : 120_000);

  test('DEMO-01 new user → discovery → matching → market → mock interview → roadmap', async ({ page: initialPage }) => {
    let page = initialPage;
    const scenes: { title: string; seconds: number; file: string }[] = [];
    let current: { title: string; seconds: number; started: number } | undefined;
    const finishScene = async () => {
      if (!current) return;
      await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
      const elapsed = Date.now() - current.started;
      if (DEMO && elapsed < current.seconds * 1000) await page.waitForTimeout(current.seconds * 1000 - elapsed);
      if (recordingDir) {
        const file = resolve(recordingDir, `scene-${scenes.length + 1}.webm`);
        const video = page.video()!;
        await page.close();
        await video.saveAs(file);
        scenes.push({ title: current.title, seconds: current.seconds, file });
      }
    };
    const scene = async (title: string, seconds: number) => {
      await finishScene();
      if (recordingDir) page = await initialPage.context().newPage();
      current = { title, seconds, started: Date.now() };
    };
    const caption = (title: string, body: string) => explain(page, current!.title, title, body);
    const tour = async (stops: { target: Locator; title: string; body: string }[]) => {
      for (const [index, stop] of stops.entries()) {
        await caption(stop.title, stop.body);
        await focusSection(stop.target, DEMO);
        const remaining = current!.seconds * 1000 - (Date.now() - current!.started);
        // Spend the former idle time showing sections. Rehearsal exercises the same targets without delays.
        await beat(page, Math.max(2500, remaining / (stops.length - index)));
      }
    };
    // A sample profile must never be used, even accidentally, in the new-user demo.
    await page.context().route('**/api/profile/sample', route => route.abort());
    await page.context().addInitScript(() => {
      localStorage.setItem('cp-theme', 'dark');
    });

    // Scene 1 (0:00–0:30) — a deliberately paced first visit and registration.
    await scene('New account and empty profile', 30);
    await page.goto('/');
    await caption('Your next career move starts here', 'Explore careers, understand your skill gaps and turn a direction into a practical learning plan.');
    await beat(page, 3000);
    const typeField = async (field: Locator, value: string) => {
      await focusSection(field, DEMO);
      if (DEMO) await field.pressSequentially(value, { delay: 100 });
      else await field.fill(value);
      await beat(page, 700);
    };
    await caption('Create your own starting point', 'Enter your name, email and password. Minh is joining with a completely empty account.');
    await typeField(page.getByRole('textbox', { name: 'Display name' }), 'Minh Nguyen');
    await typeField(page.getByRole('textbox', { name: 'Email' }), uniqueEmail('minh'));
    await typeField(page.getByLabel('Password'), PASSWORD);
    await caption('One account for the whole journey', 'Your profile, career comparisons, learning and interview practice will stay connected in one workspace.');
    await beat(page, 1800);
    await page.getByRole('button', { name: 'Create account' }).last().click();
    await expect(page).toHaveURL(/\/welcome$/);
    await expect(page.getByText('0/15 done')).toBeVisible();
    // Shared market catalog only; no personal records are preloaded.
    await api(page, 'post', '/api/jobs/sources/cert-trends/sync', {});
    await tour([
      { target: page.getByRole('heading', { name: /Welcome, Minh/ }), title: 'A guided starting point', body: 'The checklist starts at zero. Each step connects your profile, career options, learning and applications.' },
      { target: page.getByRole('heading', { name: 'Set up your profile' }), title: 'Build your own profile', body: 'Import a CV or add your background yourself. This walkthrough does not load a sample profile.' },
      { target: page.locator('main h2').last(), title: 'See the journey ahead', body: 'Scroll through the guide: explore careers, find a job, close skill gaps and prepare to apply.' },
    ]);

    // Scene 2 (0:30–1:10) — career discovery: background, then multiple choice.
    await scene('Discovery from self-reported background', 40);
    await page.goto('/interviews/new?mode=discovery');
    await caption('Find a direction before choosing a role', 'Career discovery starts with your background, preferences and the time you can commit to learning.');
    await page.getByRole('button', { name: 'Build blueprint' }).click();
    await expect(page.getByText('Your background')).toBeVisible();
    await page.getByRole('radio', { name: 'Working in tech' }).check();
    await page.getByText('Optional background details', { exact: true }).click();
    await page.getByLabel('Current or most recent tech role').selectOption('backend-engineer');
    await page.getByLabel('Years of work experience').fill('5');
    await beat(page, 2500);
    await page.getByRole('button', { name: 'Continue' }).click();
    await caption('Eight questions about you', 'Choose the work you enjoy, your interests and values. These answers are self-reported, not verified skills.');
    const picks = [['Building things', 'Researching and exploring'], ['Analyzing data'], ['I built or coded something'], ['Planning and coordinating'], ['Learning and growth', 'Impact'], ['AI & data', 'Cloud & DevOps'], ['Change career paths'], ['10–15 hours a week']];
    for (const [i, options] of picks.entries()) {
      await expect(page.getByText(`Question ${i + 1}`, { exact: true })).toBeVisible();
      for (const o of options) await page.getByRole(i === 7 ? 'radio' : 'checkbox', { name: new RegExp(`^${o}`) }).check();
      await beat(page, 1500);
      await page.getByRole('button', { name: 'Next' }).click();
    }
    await expect(page.getByText('Suggested profile updates')).toBeVisible();
    await beat(page, 3000);
    await page.getByRole('button', { name: 'Apply to my profile' }).click();
    await expect(page.getByText(/Applied —/)).toBeVisible();
    await tour([
      { target: page.getByRole('heading', { name: 'Top 3 Career Matches' }), title: 'Explore suggested directions', body: 'The top three career matches are starting points for exploration, not a guarantee of job readiness.' },
      { target: page.getByRole('heading', { name: 'Potential Skill Gaps' }), title: 'Turn uncertainty into a next step', body: 'Potential gaps identify skills to assess. Missing evidence does not automatically mean a missing skill.' },
      { target: page.getByText('Suggested profile updates', { exact: true }), title: 'Review before applying', body: 'Only the suggestions you approve are applied to your profile. Your answers remain available below.' },
    ]);

    // Scene 3 (1:10–1:40) — honest matching and evidence.
    await scene('Role matching and unknown skills', 30);
    await page.goto('/matching?role=ai-engineer');
    await caption('Compare a role with your evidence', 'Matching separates capability, interests, growth potential and market opportunity. It is not a hiring probability.');
    for (const d of ['Capability fit', 'Interest & work fit', 'Growth potential', 'Market opportunity']) await expect(page.getByText(d, { exact: true })).toBeVisible();
    await expect(page.getByText(/Critical skill gate: (blocked|needs evidence)/)).toBeVisible();
    await expect(page.getByRole('row').filter({ hasText: 'Retrieval-Augmented Generation' }).getByText('Unknown').first()).toBeVisible();
    await tour([
      { target: page.getByText('Capability fit', { exact: true }), title: 'Four dimensions, four explanations', body: 'Read each dimension independently. Strong interest does not replace evidence of technical capability.' },
      { target: page.getByRole('heading', { name: 'Skills you can carry into this role' }), title: 'Understand transferable skills', body: 'Recorded skills can support a transition. A previous job title alone does not prove those skills.' },
      { target: page.getByRole('row').filter({ hasText: 'Retrieval-Augmented Generation' }), title: 'Unknown is an honest result', body: 'The comparison table shows requirements, your evidence and the next step. RAG remains unknown until assessed.' },
      { target: page.getByRole('link', { name: 'View skill roadmap', exact: true }), title: 'Move from comparison to action', body: 'Open a roadmap, create a learning plan or browse jobs for the role when you are ready.' },
    ]);

    // Scene 4 (1:40–2:05) — market evidence.
    await scene('Market evidence', 25);
    await page.goto('/market');
    await caption('Inspect the evidence behind market numbers', 'This recording uses a local market snapshot. Demo jobs are excluded from market statistics by default.');
    await page.getByRole('button', { name: /^Active/ }).click();
    const dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: 'Active postings' })).toBeVisible();
    await beat(page, 2500);
    await dialog.locator('ul button').first().click();
    await expect(dialog.getByRole('link').first()).toBeVisible();
    await caption('Drill down to the source', 'Open a total, choose a breakdown and inspect the original postings behind the count.');
    await beat(page, 3000);
    await page.keyboard.press('Escape');
    await tour([
      { target: page.getByRole('heading', { name: 'Historical observations' }), title: 'Read historical observations', body: 'Charts summarize ingested postings over time. They describe this dataset, not the entire job market.' },
      { target: page.getByRole('heading', { name: 'Current market signals' }), title: 'Explore current demand', body: 'Compare role and skill signals, then click a figure to inspect its underlying evidence.' },
      { target: page.getByRole('heading', { name: 'Source coverage & freshness' }), title: 'Check coverage and freshness', body: 'Review the sources and collection dates before drawing conclusions. Forecasts are shown separately from observations.' },
    ]);

    // Scene 5 (2:05–2:45) — a labeled demo job, then job-specific practice.
    await scene('Job match and mock interview', 40);
    await page.goto(`/jobs/${await demoAiJobId(page)}`);
    await caption('Practice for a specific job', 'This clearly labeled Demo posting illustrates how job requirements connect to your evidence and interview practice.');
    await expect(page.getByRole('heading', { name: 'Your match' })).toBeVisible();
    await beat(page, 4000);
    await page.getByRole('link', { name: 'Mock interview', exact: true }).click();
    await page.getByLabel('Round').selectOption('technical');
    await page.getByRole('button', { name: 'Build blueprint' }).click();
    await page.getByRole('button', { name: 'Start interview' }).click();
    await caption('Answer one question at a time', 'The interview follows the selected job and round. Model answers stay hidden while the session is active.');
    await expect(page.getByText('Question 1', { exact: true })).toBeVisible();
    await page.getByRole('textbox', { name: 'Your answer' }).fill(GOOD_ANSWER);
    await beat(page, 2000);
    await page.getByRole('button', { name: 'Submit answer' }).click();
    await expect(page.getByText('Question 2', { exact: true }).or(page.getByText('Follow-up', { exact: true })).first()).toBeVisible();
    await page.getByRole('button', { name: 'End & get report' }).click();
    await expect(page.getByText('Practice score').first()).toBeVisible();
    await expect(page.getByText(/AI coaching/).first()).toBeVisible();
    await tour([
      { target: page.getByText('Rubric breakdown', { exact: true }), title: 'Understand the practice score', body: 'The report breaks the score into rubric criteria. This practice result does not verify production experience.' },
      { target: page.getByText(/AI coaching/).first(), title: 'Get actionable coaching', body: 'Coaching suggests clearer structure and stronger examples. It explains the result without changing the score. AI is mocked in this recording.' },
      { target: page.getByRole('heading', { name: 'Transcript & question-by-question feedback' }), title: 'Review each answer in context', body: 'Scroll through the transcript, feedback and model answers to see what to improve before the next attempt.' },
      { target: page.getByText('Coach tip', { exact: true }).first(), title: 'Choose a focus for the next attempt', body: 'Use the per-question tips to improve your answer, then return for another focused practice session.' },
    ]);

    // Scene 6 (2:45–3:00) — the plan: roadmap for the gaps.
    await scene('Roadmap and next steps', 15);
    await page.goto('/roadmap/ai-engineer');
    await expect(page.locator('h1').first()).toBeVisible();
    await expect(page.locator('.react-flow__node').first()).toBeVisible();
    await caption('See how the skills connect', 'The roadmap links prerequisites, projects and assessments. Highlighted nodes show the required skills to work on.');
    await focusSection(page.locator('.react-flow'), DEMO);
    await beat(page, 2500);
    await page.locator('.react-flow__node').filter({ hasText: 'Python' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await tour([
      { target: page.getByRole('dialog').getByText('Learning outcome', { exact: true }), title: 'Open a skill to see the work ahead', body: 'Each node explains what to learn, a practice task and how the skill will be assessed.' },
      { target: page.getByRole('dialog').getByText('Resources', { exact: true }), title: 'Finish with a concrete next step', body: 'Use the curated resources and assessment action to turn this career direction into a learning plan.' },
    ]);
    await finishScene();
    if (recordingDir) writeFileSync(resolve(recordingDir, 'scenes.json'), JSON.stringify(scenes, null, 2));
  });
});
