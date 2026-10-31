// Deterministic stand-ins for external services used during E2E runs:
//  - POST /v1/chat/completions : OpenAI-compatible AI, routed by the workflow instructions in the system prompt
//  - GET  /data/*.json          : the Cert Trends static dataset (bundled snapshot)
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PORT = Number(process.env.MOCK_PORT ?? 4199);
const FIXTURES = resolve(dirname(fileURLToPath(import.meta.url)), '../apps/api/fixtures/cert-trends');
let questionNo = 0;

const untrusted = (text, kind) => {
  const m = text.match(new RegExp(`<untrusted_document kind="${kind}">\\n([\\s\\S]*?)\\n</untrusted_document>`));
  return m ? m[1] : '';
};

function respond(system, user) {
  if (system.includes('Reply with JSON')) return { ok: true };
  if (system.includes('Extract structured facts from a job description')) {
    const doc = untrusted(user, 'job_description');
    const has = (w) => doc.toLowerCase().includes(w);
    return {
      title: doc.split('\n')[0].slice(0, 80) || null, company: null, seniority: has('senior') ? 'senior' : 'middle', location: null,
      workMode: has('remote') ? 'remote' : null, minYears: 2, salary: null,
      requiredSkills: ['Python', has('rag') ? 'RAG' : 'REST API design'].filter(Boolean), preferredSkills: has('kubernetes') ? ['Kubernetes'] : [],
      qualifications: [], certifications: [],
    };
  }
  if (system.includes('Extract a structured CV')) {
    const doc = untrusted(user, 'resume');
    const items = doc.includes('Example Retail Platform')
      ? [{ kind: 'work', title: 'Backend Developer', organization: 'Example Retail Platform', startDate: '2021-03', endDate: null, description: '', highlights: ['Built REST APIs in Java and Spring Boot for order flows'], skills: ['Java', 'REST API design'] }]
      : [];
    return { name: doc.split('\n')[0] ?? null, email: null, headline: 'Backend Developer', summary: null, location: null, items, skills: ['Java', 'PostgreSQL', 'Docker'] };
  }
  if (system.includes('You are a fair, professional interviewer')) {
    questionNo++;
    return { question: `E2E question ${questionNo}: walk me through a relevant project and the decisions you made.`, rubric: [{ criterion: 'Depth', weight: 0.6, indicators: ['because'] }, { criterion: 'Clarity', weight: 0.4, indicators: ['first'] }], idealPoints: ['Concrete example', 'Trade-offs', 'Measurable result'] };
  }
  if (system.includes('Grade a candidate answer')) {
    const rubric = JSON.parse(user.match(/Rubric: (\[[\s\S]*?\])\nHidden/)[1]);
    const answer = untrusted(user, 'candidate_answer');
    return { criteria: rubric.map((r) => ({ criterion: r.criterion, score: 3, comment: 'Solid, could be more specific.' })), strengths: ['Clear structure'], gaps: [], evidenceQuotes: [answer.split('.')[0].slice(0, 60)], needsFollowUp: false, followUpFocus: null };
  }
  if (system.includes('interview coach')) {
    return { summary: 'Good structure overall; add measurable outcomes to your examples.', improvements: ['Quantify results you can stand behind'], questionTips: [{ index: 1, tip: 'Open with the situation in one sentence.', betterStructure: 'Situation → your actions → result → lesson' }], nextFocus: ['Retrieval evaluation'] };
  }
  if (system.includes('pragmatic career coach')) {
    const allowed = JSON.parse(system.match(/list \(or null\): (\[[\s\S]*?\])\./)[1]);
    return { suggestions: [{ title: 'Practice the technical round', detail: 'Rehearse with a job-specific mock interview before the next round.', link: allowed[0] ?? null }, { title: 'Review your critical gaps', detail: 'Focus study time on the skills this job marks as required.', link: null }] };
  }
  if (system.includes('From a career discovery conversation')) {
    return { interests: ['ai-data'], workValues: ['learning', 'impact'], taskAffinity: { building: 5, research: 4 }, goals: 'Move into AI engineering', constraints: ['About 10 hours per week'] };
  }
  if (system.includes('Rewrite CV bullet points')) {
    const bullets = JSON.parse(untrusted(user, 'cv_bullets'));
    // The first bullet gets a fabricated metric so the UI must flag it.
    return { bullets: bullets.map((b, i) => ({ id: b.id, text: i === 0 ? `${b.text}, improving throughput by 40%` : b.text })) };
  }
  if (system.includes("Rewrite the candidate's professional summary")) return { text: 'Backend developer building Java and Spring Boot APIs with PostgreSQL, now focused on AI engineering.' };
  if (system.includes('Write 3 accurate multiple-choice')) return { items: [{ prompt: 'Which statement is correct?', options: ['A', 'B', 'C', 'D'], correctIndex: 1, explanation: 'B is correct.', difficulty: 3 }] };
  return null;
}

createServer(async (req, res) => {
  const send = (status, body, type = 'application/json') => { res.writeHead(status, { 'content-type': type }); res.end(typeof body === 'string' ? body : JSON.stringify(body)); };
  try {
    if (req.method === 'GET' && req.url?.startsWith('/data/')) {
      const name = req.url.slice('/data/'.length);
      if (!['jobs.json', 'roles.json', 'certifications.json'].includes(name)) return send(404, { error: 'not found' });
      return send(200, readFileSync(resolve(FIXTURES, name), 'utf8'));
    }
    if (req.method === 'GET' && req.url === '/health') return send(200, { ok: true });
    if (req.method === 'POST' && req.url === '/v1/chat/completions') {
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw);
      const out = respond(body.messages[0].content, body.messages.at(-1).content);
      if (!out) return send(400, { error: { message: 'Unknown workflow in mock' } });
      return send(200, { choices: [{ message: { content: JSON.stringify(out) } }] });
    }
    send(404, { error: 'not found' });
  } catch (e) {
    send(500, { error: { message: String(e) } });
  }
}).listen(PORT, () => console.log(`mock services on :${PORT}`));
