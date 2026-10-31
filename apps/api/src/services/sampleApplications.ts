import { and, eq, sql } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { applicationEvents, interviewRounds, jobApplications, users, type ApplicationOutcome, type ApplicationStage } from '../db/schema.js';
import { addDays } from '../lib/dates.js';

const SAMPLE_SET = 'dinh-dieu-tracker-v1';
export const SAMPLE_TRACKER_SOURCE = 'Demo — Dinh Dieu';
interface SampleApplication {
  key: string; title: string; company: string; skills: string[]; location: string; notes: string;
  steps: [ApplicationStage, number][]; outcome?: ApplicationOutcome; followUpDays?: number;
  rounds?: { name: string; type: string; days: number; status: 'scheduled' | 'completed'; notes: string }[];
}

/** Fictional candidate and employers, designed to exercise every tracker stage. */
export const SAMPLE_APPLICATIONS: SampleApplication[] = [
  { key: 'saved', title: 'Backend Engineer (Java / Spring Boot)', company: 'Lotus Commerce (Demo)', location: 'Ho Chi Minh City · Hybrid', skills: ['java', 'api-design', 'sql'], steps: [['saved', -1]], notes: 'Dinh Dieu: shortlist this role; compare the Java requirements and prepare a role-specific CV.' },
  { key: 'applied', title: 'Full-stack Engineer', company: 'Harbor Studio (Demo)', location: 'Remote · Vietnam', skills: ['javascript', 'api-design', 'sql'], steps: [['saved', -6], ['applied', -4]], followUpDays: 3, notes: 'Dinh Dieu: application submitted in this fictional scenario. Follow up if there is no reply by the reminder date.' },
  { key: 'screening', title: 'Backend Engineer (Platform)', company: 'Mekong Platform (Demo)', location: 'Ho Chi Minh City · Hybrid', skills: ['api-design', 'containers', 'git'], steps: [['saved', -13], ['applied', -11], ['screening', -7]], followUpDays: 1, notes: 'Dinh Dieu: recruiter requested availability and a short introduction. Prepare examples of API ownership.', rounds: [{ name: 'Recruiter introduction', type: 'hr', days: 1, status: 'scheduled', notes: 'Demo agenda: motivation, availability and experience.' }] },
  { key: 'assessment', title: 'Backend Developer (API Services)', company: 'Bamboo Services (Demo)', location: 'Da Nang · Remote', skills: ['api-design', 'testing', 'sql'], steps: [['saved', -12], ['applied', -10], ['screening', -7], ['assessment', -3]], followUpDays: 2, notes: 'Dinh Dieu: fictional take-home API exercise. Include validation, unit tests and setup instructions.', rounds: [{ name: 'API take-home review', type: 'assessment', days: 2, status: 'scheduled', notes: 'Build a small order API and explain design choices. This is a demo exercise.' }] },
  { key: 'interview', title: 'AI Application Engineer', company: 'Lantern AI (Demo)', location: 'Ho Chi Minh City · Hybrid', skills: ['python', 'llm-applications', 'rag'], steps: [['saved', -18], ['applied', -16], ['screening', -12], ['interview', -5]], followUpDays: 1, notes: 'Dinh Dieu: prepare a chatbot walkthrough and explain retrieval, evaluation and fallback behavior.', rounds: [{ name: 'HR screening', type: 'hr', days: -12, status: 'completed', notes: 'Fictional feedback: clear motivation for moving from backend to AI.' }, { name: 'Technical interview — LLM feature', type: 'technical', days: 1, status: 'scheduled', notes: 'Review Python, API integration and evaluation.' }] },
  { key: 'system-design', title: 'Senior Backend Engineer', company: 'Orchid Payments (Demo)', location: 'Ho Chi Minh City · Onsite', skills: ['java', 'system-design', 'message-queues'], steps: [['saved', -24], ['applied', -22], ['screening', -18], ['assessment', -14], ['interview', -9]], followUpDays: 3, notes: 'Dinh Dieu: discuss idempotent payments, retries and Kafka delivery semantics in the final technical round.', rounds: [{ name: 'Backend coding round', type: 'technical', days: -10, status: 'completed', notes: 'Demo feedback: improve explanations of edge cases.' }, { name: 'Payment system design', type: 'system_design', days: 3, status: 'scheduled', notes: 'Prepare a design with reliability and observability trade-offs.' }] },
  { key: 'offer', title: 'Platform Engineer', company: 'Nimbus Operations (Demo)', location: 'Remote · Vietnam', skills: ['containers', 'ci-cd', 'linux'], steps: [['saved', -30], ['applied', -28], ['screening', -24], ['interview', -16], ['offer', -2]], followUpDays: 4, notes: 'Dinh Dieu: fictional offer received. Compare learning opportunities, work mode and responsibilities before deciding.', rounds: [{ name: 'Platform technical interview', type: 'technical', days: -16, status: 'completed', notes: 'Demo feedback: good automation examples.' }, { name: 'Team conversation', type: 'leadership', days: -7, status: 'completed', notes: 'Demo discussion about ownership and collaboration.' }] },
  { key: 'accepted', title: 'Software Engineer — Backend', company: 'Riverstone Digital (Demo)', location: 'Ho Chi Minh City · Hybrid', skills: ['java', 'sql', 'testing'], steps: [['saved', -40], ['applied', -38], ['screening', -33], ['interview', -25], ['offer', -9], ['closed', -3]], outcome: 'accepted', notes: 'Dinh Dieu: offer accepted only within this fictional scenario. Use this record to test the accepted outcome and timeline.', rounds: [{ name: 'Technical interview', type: 'technical', days: -25, status: 'completed', notes: 'Fictional completed interview.' }] },
  { key: 'rejected', title: 'Cloud Engineer (AWS)', company: 'Bluekite Cloud (Demo)', location: 'Singapore · Hybrid', skills: ['aws', 'iac', 'networking'], steps: [['saved', -34], ['applied', -32], ['screening', -27], ['interview', -22], ['closed', -18]], outcome: 'rejected', notes: 'Dinh Dieu: fictional feedback highlighted AWS networking and Terraform depth. Capture learning goals before the next attempt.', rounds: [{ name: 'Cloud architecture round', type: 'technical', days: -22, status: 'completed', notes: 'Demo feedback: strengthen VPC routing and IaC troubleshooting.' }] },
  { key: 'no-response', title: 'Backend Engineer (Integrations)', company: 'Coral Connect (Demo)', location: 'Remote · Asia', skills: ['api-design', 'message-queues', 'git'], steps: [['saved', -37], ['applied', -35], ['closed', -8]], outcome: 'no_response', notes: 'Dinh Dieu: fictional application closed after no response. No recruiter response or interview should appear in its history.' },
];

/** Add sample applications to the signed-in account, without editing its profile or CVs.
 * The per-user lock and event keys make repeat/double-click requests idempotent.
 */
export async function loadSampleApplications(ctx: AppContext, userId: number) {
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Ho_Chi_Minh', year: 'numeric', month: '2-digit', day: '2-digit' }).format(ctx.now());
  const at = (offset: number) => new Date(`${addDays(today, offset)}T09:00:00+07:00`);
  return ctx.db.transaction(async (tx) => {
    await tx.select({ id: users.id }).from(users).where(eq(users.id, userId)).for('update');
    const existing = await tx.select({ id: jobApplications.id, data: applicationEvents.data }).from(jobApplications)
      .innerJoin(applicationEvents, eq(applicationEvents.applicationId, jobApplications.id))
      .where(and(eq(jobApplications.userId, userId), eq(applicationEvents.type, 'sample_created'), sql`${applicationEvents.data}->>'sampleSet' = ${SAMPLE_SET}`));
    const keys = new Set(existing.map((row) => row.data.sampleKey));
    const ids = existing.map((row) => row.id);
    let inserted = 0;
    for (const sample of SAMPLE_APPLICATIONS) {
      if (keys.has(sample.key)) continue;
      const last = sample.steps.at(-1)!;
      const applied = sample.steps.find(([stage]) => stage === 'applied');
      const [application] = await tx.insert(jobApplications).values({
        userId, jobId: null, resumeVersionId: null, source: SAMPLE_TRACKER_SOURCE,
        stage: last[0], outcome: sample.outcome ?? null, appliedAt: applied ? at(applied[1]) : null,
        createdAt: at(sample.steps[0][1]), updatedAt: at(last[1]),
        followUpAt: sample.followUpDays == null ? null : addDays(today, sample.followUpDays),
        notes: `[Fictional demo data — candidate: Dinh Dieu]\n${sample.notes}`,
        contacts: [{ name: 'Minh Anh (Demo)', role: 'Recruiter (fictional)', email: `recruiter@${sample.key}.example`, note: 'Fictional contact; no messages are sent.' }],
        jobSnapshot: { title: sample.title, company: sample.company, url: null, location: sample.location,
          description: `Fictional vacancy for testing the application tracker.\nCandidate: Dinh Dieu.\nCore topics: ${sample.skills.join(', ')}.`, requiredSkills: sample.skills, capturedAt: at(sample.steps[0][1]).toISOString(), isDemo: true },
      }).returning({ id: jobApplications.id });
      ids.push(application.id);
      inserted++;
      await tx.insert(applicationEvents).values(sample.steps.map(([stage, offset], index) => ({
        applicationId: application.id, type: index === 0 ? 'sample_created' : stage === 'closed' ? 'closed' : 'stage_changed',
        fromStage: index ? sample.steps[index - 1][0] : null, toStage: stage, at: at(offset),
        note: index === 0 ? 'Fictional demo tracker created for Dinh Dieu.' : `Demo: ${stage}${stage === 'closed' ? ` (${sample.outcome})` : ''}.`,
        data: index === 0 ? { sampleSet: SAMPLE_SET, sampleKey: sample.key, candidate: 'Dinh Dieu' } : { outcome: sample.outcome ?? null },
      })));
      if (sample.rounds?.length) await tx.insert(interviewRounds).values(sample.rounds.map((round) => ({ applicationId: application.id, name: round.name, type: round.type, scheduledAt: addDays(today, round.days), status: round.status, notes: round.notes })));
    }
    return { inserted, existing: existing.length, total: ids.length, applicationIds: ids, candidateName: 'Dinh Dieu' };
  });
}
