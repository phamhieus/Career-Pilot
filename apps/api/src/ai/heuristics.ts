import type { AnswerEvaluation, InterviewTopic, RubricCriterion } from '../db/schema.js';
import type { Taxonomy } from '../services/taxonomy.js';
import { clamp, cleanUntrustedText, containsTerm, normalizeText, round } from '../lib/text.js';

// ---------------------------------------------------------------------------
// Job description parsing
// ---------------------------------------------------------------------------

export interface ParsedJob {
  title: string | null;
  company: string | null;
  seniority: 'intern' | 'junior' | 'middle' | 'senior' | 'lead' | null;
  location: string | null;
  workMode: 'remote' | 'hybrid' | 'onsite' | null;
  minYears: number | null;
  salary: { min: number | null; max: number | null; currency: string } | null;
  requiredSkills: string[];
  preferredSkills: string[];
  unknownRequirements: string[];
  qualifications: string[];
  certifications: string[];
}

const PREFERRED_HEADER = /(nice to have|preferred|bonus|good to have|is a plus|would be a plus|desirable|ưu tiên|điểm cộng)/i;
const REQUIRED_HEADER = /(requirement|qualification|must have|must-have|what you (will )?(need|bring)|you have|skills|yêu cầu|kỹ năng|who you are)/i;
const RESPONSIBILITY_HEADER = /(responsibilit|what you('ll| will) do|the role|about the role|mô tả công việc|nhiệm vụ|trách nhiệm)/i;

export function detectSeniority(text: string): ParsedJob['seniority'] {
  const t = normalizeText(text);
  if (/\b(intern|internship|thuc tap)\b/.test(t)) return 'intern';
  if (/\b(principal|staff|lead|head of|manager)\b/.test(t)) return 'lead';
  if (/\b(senior|sr\.?|snr)\b/.test(t)) return 'senior';
  if (/\b(junior|jr\.?|fresher|entry level|graduate)\b/.test(t)) return 'junior';
  if (/\b(middle|mid level|mid-level|intermediate)\b/.test(t)) return 'middle';
  return null;
}

export function detectWorkMode(text: string): ParsedJob['workMode'] {
  const t = normalizeText(text);
  if (/\bhybrid\b/.test(t)) return 'hybrid';
  if (/\b(fully remote|remote first|remote-first|work from home|wfh)\b/.test(t) || /^remote\b/.test(t) || /\bremote\b/.test(t)) return 'remote';
  if (/\b(on-site|onsite|on site|in office|tai van phong)\b/.test(t)) return 'onsite';
  return null;
}

/** Only extract salary when explicitly present in the text. */
export function detectSalary(text: string): ParsedJob['salary'] {
  const m = text.match(/(USD|VND|SGD|EUR|GBP|JPY|\$|€|£)\s?([\d][\d,.]*)\s?(k|K|m|M|tr|triệu)?\s?(?:-|–|to|đến)\s?(?:USD|VND|SGD|EUR|GBP|JPY|\$|€|£)?\s?([\d][\d,.]*)\s?(k|K|m|M|tr|triệu)?/);
  if (!m) return null;
  const cur = { $: 'USD', '€': 'EUR', '£': 'GBP' }[m[1]] ?? m[1].toUpperCase();
  const mult = (u?: string) => (!u ? 1 : /k/i.test(u) ? 1000 : /m|tr|triệu/i.test(u) ? 1_000_000 : 1);
  const num = (s: string) => Number(s.replace(/[,.](?=\d{3}\b)/g, '').replace(',', '.'));
  const min = Math.round(num(m[2]) * mult(m[3] ?? m[5]));
  const max = Math.round(num(m[4]) * mult(m[5] ?? m[3]));
  if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0) return null;
  return { min, max, currency: cur };
}

export function heuristicParseJob(raw: string, tax: Taxonomy, knownCerts: { id: string; terms: string[] }[] = []): ParsedJob {
  const text = cleanUntrustedText(raw);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  let section: 'none' | 'required' | 'preferred' | 'resp' = 'none';
  const required = new Set<string>();
  const preferred = new Set<string>();
  const qualifications: string[] = [];
  let minYears: number | null = null;

  for (const line of lines) {
    const isHeader = line.length < 60 && !/^[-•*]/.test(line);
    if (isHeader && PREFERRED_HEADER.test(line)) { section = 'preferred'; continue; }
    if (isHeader && REQUIRED_HEADER.test(line)) { section = 'required'; continue; }
    if (isHeader && RESPONSIBILITY_HEADER.test(line)) { section = 'resp'; continue; }
    const found = tax.findSkills(line);
    const linePreferred = PREFERRED_HEADER.test(line) || section === 'preferred';
    for (const s of found) {
      if (linePreferred) { if (!required.has(s)) preferred.add(s); }
      else required.add(s);
    }
    if (section !== 'preferred') {
      const y = line.match(/(\d{1,2})\s*\+?\s*(?:-\s*\d+\s*)?(?:years?|yrs?|năm)/i);
      if (y && (section === 'required' || /experience|kinh nghiệm/i.test(line))) {
        const v = Number(y[1]);
        if (v <= 20) minYears = Math.max(minYears ?? 0, v);
      }
    }
    if (/(degree|bachelor|master'?s|phd|cử nhân|bằng|university)/i.test(line)) qualifications.push(line.replace(/^[-•*]\s*/, '').slice(0, 200));
  }
  for (const s of required) preferred.delete(s);

  const certifications: string[] = [];
  const norm = ` ${normalizeText(text)} `;
  for (const c of knownCerts) if (c.terms.some((t) => containsTerm(norm, t))) certifications.push(c.id);

  const firstLine = lines[0] && lines[0].length < 90 ? lines[0] : null;
  return {
    title: firstLine,
    company: null,
    seniority: detectSeniority(text.slice(0, 400)) ?? (minYears !== null ? (minYears >= 5 ? 'senior' : minYears >= 2 ? 'middle' : 'junior') : null),
    location: null,
    workMode: detectWorkMode(text),
    minYears,
    salary: detectSalary(text),
    requiredSkills: [...required],
    preferredSkills: [...preferred],
    unknownRequirements: [],
    qualifications: qualifications.slice(0, 5),
    certifications,
  };
}

// ---------------------------------------------------------------------------
// CV parsing
// ---------------------------------------------------------------------------

export interface ParsedResumeItem {
  kind: 'work' | 'project' | 'education' | 'certification';
  title: string;
  organization: string;
  startDate: string | null;
  endDate: string | null;
  description: string;
  highlights: string[];
  skillSlugs: string[];
}
export interface ParsedResume {
  name: string | null;
  email: string | null;
  headline: string | null;
  summary: string | null;
  location: string | null;
  items: ParsedResumeItem[];
  skills: string[];
}

const SECTION_PATTERNS: [ParsedResumeItem['kind'] | 'skills' | 'summary', RegExp][] = [
  ['work', /^(work experience|experience|employment|professional experience|work history|kinh nghiệm( làm việc)?)\s*:?$/i],
  ['project', /^(projects?|personal projects|dự án)\s*:?$/i],
  ['education', /^(education|học vấn|academic)\s*:?$/i],
  ['certification', /^(certifications?|certificates|licenses|chứng chỉ)\s*:?$/i],
  ['skills', /^(skills|technical skills|kỹ năng|technologies)\s*:?$/i],
  ['summary', /^(summary|profile|about me|objective|giới thiệu|mục tiêu)\s*:?$/i],
];
const MONTHS: Record<string, string> = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
const DATE_RANGE = /((?:[A-Za-z]{3,9}\.?\s+)?\d{4}|\d{1,2}\/\d{4})\s*(?:-|–|—|to|đến)\s*(present|now|current|hiện tại|(?:[A-Za-z]{3,9}\.?\s+)?\d{4}|\d{1,2}\/\d{4})/i;

function toIsoMonth(s: string): string | null {
  if (/present|now|current|hiện tại/i.test(s)) return null;
  const mm = s.match(/(\d{1,2})\/(\d{4})/);
  if (mm) return `${mm[2]}-${mm[1].padStart(2, '0')}`;
  const named = s.match(/([A-Za-z]{3})[A-Za-z]*\.?\s+(\d{4})/);
  if (named && MONTHS[named[1].toLowerCase()]) return `${named[2]}-${MONTHS[named[1].toLowerCase()]}`;
  const y = s.match(/\d{4}/);
  return y ? `${y[0]}-01` : null;
}

export function heuristicParseResume(raw: string, tax: Taxonomy): ParsedResume {
  const text = cleanUntrustedText(raw, 40000);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const email = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/)?.[0] ?? null;
  const name = lines[0] && lines[0].split(' ').length <= 5 && !/\d|@/.test(lines[0]) ? lines[0] : null;
  const headline = lines[1] && lines[1].length < 80 && !/@|\d{4}/.test(lines[1]) ? lines[1] : null;

  let section: string = 'none';
  const items: ParsedResumeItem[] = [];
  const skillLines: string[] = [];
  const summaryLines: string[] = [];
  let current: ParsedResumeItem | null = null;
  let previousLine = '';

  const push = () => { if (current) items.push(current); current = null; };
  for (const line of lines) {
    const header = SECTION_PATTERNS.find(([, re]) => re.test(line));
    if (header) { push(); section = header[0]; previousLine = ''; continue; }
    if (section === 'skills') { skillLines.push(line); continue; }
    if (section === 'summary') { summaryLines.push(line); continue; }
    if (section === 'none') continue;
    const kind = section as ParsedResumeItem['kind'];
    const range = line.match(DATE_RANGE);
    const bullet = /^[-•*▪◦]/.test(line);
    if (range && !bullet) {
      push();
      const label = line.replace(DATE_RANGE, '').replace(/[|,–—-]+\s*$/, '').trim() || previousLine;
      const [title, org] = label.split(/\s+(?:at|@|\||-|–|,)\s+/);
      current = { kind, title: (title || label || 'Untitled').slice(0, 120), organization: (org ?? '').slice(0, 120), startDate: toIsoMonth(range[1]), endDate: toIsoMonth(range[2]), description: '', highlights: [], skillSlugs: [] };
    } else if (bullet && current) {
      current.highlights.push(line.replace(/^[-•*▪◦]\s*/, '').slice(0, 300));
    } else if (current) {
      if (!current.organization && line.length < 80) current.organization = line;
      else current.description = `${current.description} ${line}`.trim().slice(0, 1000);
    } else if (kind === 'certification' || kind === 'education') {
      items.push({ kind, title: line.slice(0, 160), organization: '', startDate: toIsoMonth(line.match(/\d{4}/)?.[0] ?? ''), endDate: null, description: '', highlights: [], skillSlugs: [] });
    }
    previousLine = line;
  }
  push();
  for (const it of items) it.skillSlugs = tax.findSkills([it.title, it.description, ...it.highlights].join('\n'));
  const skills = [...new Set([...tax.findSkills(skillLines.join('\n')), ...items.flatMap((i) => i.skillSlugs)])];
  return { name, email, headline, summary: summaryLines.join(' ').slice(0, 1200) || null, location: null, items, skills };
}

// ---------------------------------------------------------------------------
// Interview questions & grading
// ---------------------------------------------------------------------------

export interface GeneratedQuestion { question: string; rubric: RubricCriterion[]; idealPoints: string[] }

const BEHAVIORAL: { en: string; vi: string; focus: string }[] = [
  { en: 'Tell me about a time you had to deliver something important under a tight deadline. What did you do and what was the outcome?', vi: 'Hãy kể về một lần bạn phải hoàn thành việc quan trọng trong thời hạn gấp. Bạn đã làm gì và kết quả ra sao?', focus: 'ownership under pressure' },
  { en: 'Describe a disagreement with a colleague or stakeholder. How did you handle it and what did you learn?', vi: 'Hãy mô tả một lần bất đồng với đồng nghiệp hoặc stakeholder. Bạn xử lý thế nào và học được gì?', focus: 'conflict handling' },
  { en: 'Tell me about a mistake you made at work. How did you discover it, fix it and prevent it from happening again?', vi: 'Hãy kể về một sai lầm bạn từng mắc trong công việc. Bạn phát hiện, khắc phục và phòng tránh nó như thế nào?', focus: 'accountability and learning' },
  { en: 'Describe a situation where you had to learn something new quickly to get the job done.', vi: 'Hãy mô tả tình huống bạn phải học nhanh một điều mới để hoàn thành công việc.', focus: 'learning agility' },
];
const LEADERSHIP: { en: string; vi: string }[] = [
  { en: 'Tell me about a time you helped a teammate grow. What did you do specifically and what changed?', vi: 'Hãy kể về một lần bạn giúp đồng đội phát triển. Bạn đã làm gì cụ thể và điều gì thay đổi?' },
  { en: 'Describe a decision you made that was unpopular with your team. How did you make it and communicate it?', vi: 'Hãy mô tả một quyết định không được team ủng hộ. Bạn đưa ra và truyền đạt nó như thế nào?' },
];
const DISCOVERY: { en: string; vi: string }[] = [
  { en: 'What parts of your current or past work give you the most energy, and which parts drain you? Please give concrete examples.', vi: 'Phần nào trong công việc hiện tại hoặc trước đây khiến bạn hứng thú nhất, phần nào khiến bạn mệt mỏi? Hãy nêu ví dụ cụ thể.' },
  { en: 'Which kinds of problems do you enjoy solving: building systems, analyzing data, designing experiences, organizing people and plans, or something else?', vi: 'Bạn thích giải quyết loại vấn đề nào: xây dựng hệ thống, phân tích dữ liệu, thiết kế trải nghiệm, tổ chức con người và kế hoạch, hay điều gì khác?' },
  { en: 'What matters most to you in your next role (for example autonomy, stability, impact, learning, compensation, flexibility)? Why?', vi: 'Điều gì quan trọng nhất với bạn trong vai trò tiếp theo (ví dụ: tự chủ, ổn định, tác động, học hỏi, thu nhập, linh hoạt)? Vì sao?' },
  { en: 'Which tech roles or areas are you curious about, and what do you imagine doing day to day in them?', vi: 'Bạn tò mò về vai trò hoặc lĩnh vực công nghệ nào, và bạn hình dung công việc hằng ngày ở đó như thế nào?' },
  { en: 'What constraints should your plan respect: hours per week for learning, deadline, location or remote preference, budget?', vi: 'Kế hoạch của bạn cần tôn trọng những ràng buộc nào: số giờ học mỗi tuần, thời hạn, địa điểm hoặc làm từ xa, ngân sách?' },
];

// Multiple-choice discovery: each choice maps straight onto a profile field, so no grading or AI is needed.
type Bi = { en: string; vi: string };
const TASK_CHOICES: [string, Bi][] = [
  ['building', { en: 'Building things — writing code, making tools work', vi: 'Xây dựng — viết code, làm ra công cụ chạy được' }],
  ['analysis', { en: 'Analyzing data, numbers and logic', vi: 'Phân tích dữ liệu, con số và logic' }],
  ['design', { en: 'Designing interfaces and experiences', vi: 'Thiết kế giao diện và trải nghiệm' }],
  ['communication', { en: 'Explaining, writing and presenting', vi: 'Giải thích, viết và thuyết trình' }],
  ['organizing', { en: 'Planning and coordinating work', vi: 'Lên kế hoạch và điều phối công việc' }],
  ['research', { en: 'Researching and exploring unknowns', vi: 'Nghiên cứu và khám phá điều chưa biết' }],
  ['operations', { en: 'Keeping systems reliable and running', vi: 'Giữ hệ thống vận hành ổn định' }],
  ['leading', { en: 'Leading and mentoring people', vi: 'Dẫn dắt và hướng dẫn người khác' }],
];
const VALUE_CHOICES: [string, Bi][] = [
  ['autonomy', { en: 'Autonomy', vi: 'Tự chủ' }], ['stability', { en: 'Stability', vi: 'Ổn định' }], ['impact', { en: 'Impact', vi: 'Tác động' }],
  ['creativity', { en: 'Creativity', vi: 'Sáng tạo' }], ['learning', { en: 'Learning and growth', vi: 'Học hỏi và phát triển' }], ['collaboration', { en: 'Collaboration', vi: 'Làm việc nhóm' }],
  ['compensation', { en: 'Compensation', vi: 'Thu nhập' }], ['flexibility', { en: 'Flexibility / remote', vi: 'Linh hoạt / từ xa' }], ['variety', { en: 'Variety', vi: 'Đa dạng' }],
  ['deep_focus', { en: 'Deep, focused work', vi: 'Làm việc tập trung sâu' }],
];
const AREA_CHOICES: [string, Bi][] = [
  ['software-engineering', { en: 'Software engineering', vi: 'Kỹ thuật phần mềm' }], ['ai-data', { en: 'AI & data', vi: 'AI & dữ liệu' }],
  ['cloud-devops', { en: 'Cloud & DevOps', vi: 'Cloud & DevOps' }], ['cybersecurity', { en: 'Cybersecurity', vi: 'An ninh mạng' }],
  ['business-analysis', { en: 'Business analysis', vi: 'Phân tích nghiệp vụ' }], ['product-management', { en: 'Product management', vi: 'Quản lý sản phẩm' }],
  ['project-delivery', { en: 'Project delivery', vi: 'Quản lý dự án' }], ['ux-research', { en: 'UX research', vi: 'Nghiên cứu UX' }],
  ['ui-product-design', { en: 'UI / product design', vi: 'Thiết kế UI / sản phẩm' }], ['quality-engineering', { en: 'Quality engineering / testing', vi: 'Kiểm thử / đảm bảo chất lượng' }],
  ['tech-leadership', { en: 'Tech leadership & architecture', vi: 'Lãnh đạo kỹ thuật & kiến trúc' }],
];
const HOURS_CHOICES: [string, Bi][] = [
  ['hours-lt5', { en: 'Under 5 hours a week', vi: 'Dưới 5 giờ mỗi tuần' }], ['hours-5-10', { en: '5–10 hours a week', vi: '5–10 giờ mỗi tuần' }],
  ['hours-10-15', { en: '10–15 hours a week', vi: '10–15 giờ mỗi tuần' }], ['hours-15plus', { en: 'More than 15 hours a week', vi: 'Hơn 15 giờ mỗi tuần' }],
];
export const DISCOVERY_MCQ: { key: string; label: string; question: Bi; maxSelect: number; choices: [string, Bi][] }[] = [
  { key: 'energy', label: 'Energy and motivation', maxSelect: 3, choices: TASK_CHOICES, question: { en: 'Which kinds of work give you the most energy? Pick up to 3.', vi: 'Loại công việc nào khiến bạn hứng thú nhất? Chọn tối đa 3.' } },
  { key: 'strengths', label: 'Self-reported strengths', maxSelect: 3, choices: [...TASK_CHOICES, ['unsure', { en: 'I am still discovering my strengths', vi: 'Tôi đang tìm hiểu điểm mạnh của mình' }]], question: { en: 'What are your strongest skills? Choose up to 3. You can optionally add an example of using them; these remain self-reported.', vi: 'Bạn thấy mình mạnh nhất ở kỹ năng nào? Chọn tối đa 3. Có thể bổ sung ví dụ; đây vẫn là kỹ năng tự khai, chưa xác minh.' } },
  { key: 'project', label: 'An experience you enjoyed', maxSelect: 2, choices: [
    ['building', { en: 'I built or coded something', vi: 'Tôi xây dựng hoặc lập trình một sản phẩm' }], ['analysis', { en: 'I analyzed data or solved a problem', vi: 'Tôi phân tích dữ liệu hoặc giải quyết vấn đề' }],
    ['design', { en: 'I designed a flow, interface or experience', vi: 'Tôi thiết kế luồng, giao diện hoặc trải nghiệm' }], ['organizing', { en: 'I planned and coordinated the work', vi: 'Tôi lập kế hoạch và điều phối công việc' }],
    ['communication', { en: 'I worked with people or presented ideas', vi: 'Tôi làm việc với mọi người hoặc trình bày ý tưởng' }], ['research', { en: 'I researched and explored a new topic', vi: 'Tôi nghiên cứu một chủ đề mới' }],
    ['team', { en: 'It was a team project; my part is hard to describe', vi: 'Đó là dự án nhóm; tôi chưa rõ cách mô tả phần mình làm' }], ['no-project', { en: 'No project yet / not sure', vi: 'Chưa có dự án / chưa rõ' }],
  ], question: { en: 'Think of a project, class assignment or task you enjoyed. What part did you personally handle? Pick up to 2; a short example is optional.', vi: 'Nghĩ về dự án, bài tập hoặc công việc bạn thích. Bạn trực tiếp làm phần nào? Chọn tối đa 2; không bắt buộc gõ ví dụ.' } },
  { key: 'drain', label: 'What drains you', maxSelect: 3, choices: TASK_CHOICES, question: { en: 'Which kinds of work would you rather avoid? Pick up to 3.', vi: 'Loại công việc nào bạn muốn tránh? Chọn tối đa 3.' } },
  { key: 'values', label: 'Work values', maxSelect: 3, choices: VALUE_CHOICES, question: { en: 'What matters most to you in your next role? Pick up to 3.', vi: 'Điều gì quan trọng nhất với bạn ở vai trò tiếp theo? Chọn tối đa 3.' } },
  { key: 'areas', label: 'Curiosity about roles', maxSelect: 3, choices: AREA_CHOICES, question: { en: 'Which tech areas are you most curious about? Pick up to 3.', vi: 'Bạn tò mò nhất về lĩnh vực công nghệ nào? Chọn tối đa 3.' } },
  { key: 'goals', label: 'Your next 1–3 years', maxSelect: 2, choices: [
    ['first-job', { en: 'Get my first role', vi: 'Tìm công việc đầu tiên' }], ['career-change', { en: 'Change career paths', vi: 'Chuyển ngành hoặc vai trò' }], ['deepen', { en: 'Grow my expertise and move up a level', vi: 'Đào sâu chuyên môn và lên cấp bậc' }], ['lead', { en: 'Move toward leadership', vi: 'Phát triển theo hướng lãnh đạo' }], ['explore', { en: 'Explore before choosing a direction', vi: 'Khám phá trước khi chọn hướng đi' }],
  ], question: { en: 'Where would you like to be in the next 1–3 years? Pick up to 2 goals.', vi: 'Bạn muốn đạt điều gì trong 1–3 năm tới? Chọn tối đa 2 mục tiêu.' } },
  { key: 'hours', label: 'Time for learning', maxSelect: 1, choices: HOURS_CHOICES, question: { en: 'How much time can you realistically put into learning?', vi: 'Thực tế bạn có thể dành bao nhiêu thời gian để học?' } },
];

export function discoveryMcq(topicKey: string, language: string) {
  const q = DISCOVERY_MCQ.find((d) => `discovery:${d.key}` === topicKey);
  if (!q) return null;
  const vi = language === 'vi';
  const choices = q.choices.map(([key, l]) => ({ key, label: vi ? l.vi : l.en }));
  if (q.key === 'drain') choices.push({ key: 'none', label: vi ? 'Chưa rõ / không có loại nào cụ thể' : 'Not sure / nothing specific' });
  if (q.key === 'areas') choices.push({ key: 'unsure', label: vi ? 'Tôi muốn khám phá trước khi chọn' : 'I would like to explore before choosing' });
  if (q.key === 'hours') choices.push({ key: 'unsure', label: vi ? 'Tôi chưa rõ' : 'I am not sure yet' });
  return { question: vi ? q.question.vi : q.question.en, options: { maxSelect: q.maxSelect, choices } };
}

const STAR_RUBRIC: RubricCriterion[] = [
  { criterion: 'Situation & task clarity', weight: 0.2, indicators: ['when', 'project', 'team', 'context', 'goal', 'deadline'] },
  { criterion: 'Personal actions', weight: 0.35, indicators: [' i ', 'i decided', 'i led', 'i built', 'i proposed', 'i talked', 'my role'] },
  { criterion: 'Result & impact', weight: 0.25, indicators: ['result', 'outcome', 'reduced', 'increased', 'delivered', '%', 'saved', 'shipped'] },
  { criterion: 'Reflection & learning', weight: 0.2, indicators: ['learned', 'next time', 'would do', 'lesson', 'improve', 'differently'] },
];

export function skillRubric(skillName: string, terms: string[], outcome: string): RubricCriterion[] {
  const outcomeTerms = normalizeText(outcome).split(' ').filter((w) => w.length > 5).slice(0, 6);
  return [
    { criterion: `Technical accuracy (${skillName})`, weight: 0.35, indicators: [...terms.slice(0, 6), ...outcomeTerms] },
    { criterion: 'Practical application', weight: 0.3, indicators: ['example', 'project', 'in production', 'we used', 'i used', 'implemented', 'built', 'configured'] },
    { criterion: 'Trade-offs & reasoning', weight: 0.2, indicators: ['trade-off', 'tradeoff', 'because', 'instead', 'downside', 'alternative', 'depends'] },
    { criterion: 'Communication', weight: 0.15, indicators: ['first', 'then', 'finally', 'for example', 'in summary'] },
  ];
}

export function heuristicQuestion(input: {
  topic: InterviewTopic;
  difficulty: number;
  language: string;
  askedCount: number;
  skill?: { name: string; terms: string[]; outcome: string; practice: string };
  bankPrompt?: { prompt: string; rubric: RubricCriterion[] } | null;
  followUp?: { focus: string; previousQuestion: string } | null;
}): GeneratedQuestion {
  const vi = input.language === 'vi';
  const t = input.topic;
  if (input.followUp) {
    return {
      question: vi
        ? `Bạn có thể đi sâu hơn về ${input.followUp.focus}? Cụ thể bạn đã làm gì, vì sao, và kết quả đo được là gì?`
        : `Could you go deeper on ${input.followUp.focus}? Specifically, what did you do, why, and what was the measurable result?`,
      rubric: t.kind === 'behavioral' || t.kind === 'leadership' ? STAR_RUBRIC : skillRubric(input.skill?.name ?? t.label, input.skill?.terms ?? [], input.skill?.outcome ?? ''),
      idealPoints: ['Concrete personal actions', 'Reasoning behind choices', 'Measurable outcome'],
    };
  }
  if (t.kind === 'discovery') {
    const q = DISCOVERY[input.askedCount % DISCOVERY.length];
    return { question: vi ? q.vi : q.en, rubric: [{ criterion: 'Specificity', weight: 1, indicators: ['example', 'because', 'when', 'enjoy', 'prefer'] }], idealPoints: [] };
  }
  if (t.kind === 'behavioral') {
    const q = BEHAVIORAL[input.askedCount % BEHAVIORAL.length];
    return { question: vi ? q.vi : q.en, rubric: STAR_RUBRIC, idealPoints: ['Clear situation', 'Personal actions (I, not we)', 'Quantified result', 'Reflection'] };
  }
  if (t.kind === 'leadership') {
    const q = LEADERSHIP[input.askedCount % LEADERSHIP.length];
    return { question: vi ? q.vi : q.en, rubric: STAR_RUBRIC, idealPoints: ['Specific leadership actions', 'Consideration of others', 'Outcome and reflection'] };
  }
  if (input.bankPrompt) return { question: input.bankPrompt.prompt, rubric: input.bankPrompt.rubric, idealPoints: input.bankPrompt.rubric.map((r) => r.criterion) };
  const name = input.skill?.name ?? t.label;
  const rubric = skillRubric(name, input.skill?.terms ?? [], input.skill?.outcome ?? '');
  const d = input.difficulty;
  const question = vi
    ? d <= 2
      ? `Hãy giải thích ${name} là gì, giải quyết vấn đề gì và khi nào bạn sẽ dùng nó.`
      : d === 3
        ? `Hãy mô tả một tình huống cụ thể bạn đã áp dụng ${name}. Bạn đã đưa ra những quyết định gì và vì sao?`
        : `Giả sử bạn cần: "${input.skill?.practice ?? name}". Bạn sẽ tiếp cận thế nào và cân nhắc những đánh đổi nào?`
    : d <= 2
      ? `Explain ${name}: what problem does it solve and when would you use it?`
      : d === 3
        ? `Describe a concrete situation where you applied ${name}. What decisions did you make and why?`
        : `Suppose you need to: "${input.skill?.practice ?? name}". How would you approach it, and what trade-offs would you consider?`;
  return { question, rubric, idealPoints: rubric.map((r) => r.criterion) };
}

/** Deterministic rubric scoring by indicator coverage + answer substance. Low confidence by design. */
export function heuristicGrade(answer: string, rubric: RubricCriterion[]): AnswerEvaluation {
  const clean = cleanUntrustedText(answer, 8000);
  const norm = ` ${normalizeText(clean)} `;
  const words = clean.split(/\s+/).filter(Boolean).length;
  const substance = clamp((words - 15) / 90); // ~105 words → full credit
  const totalWeight = rubric.reduce((s, r) => s + r.weight, 0) || 1;
  const sentences = clean.split(/(?<=[.!?])\s+/).filter((s) => s.length > 20);
  const quotes = new Set<string>();
  const criteria = rubric.map((r) => {
    const hits = r.indicators.filter((ind) => (ind.startsWith(' ') ? norm.includes(ind) : containsTerm(norm, ind)));
    for (const h of hits.slice(0, 1)) {
      const s = sentences.find((x) => containsTerm(` ${normalizeText(x)} `, h.trim()));
      if (s) quotes.add(s.slice(0, 220));
    }
    const coverage = clamp(hits.length / Math.max(2, Math.ceil(r.indicators.length * 0.35)));
    const score = round(clamp(0.65 * coverage + 0.35 * substance) * 4, 1); // 0..4 scale
    return { criterion: r.criterion, score, comment: hits.length ? `Mentions: ${hits.slice(0, 4).map((h) => h.trim()).join(', ')}` : 'No clear evidence for this criterion in the answer.' };
  });
  const overall = round(criteria.reduce((s, c, i) => s + (c.score / 4) * rubric[i].weight, 0) / totalWeight, 2);
  const weakest = [...criteria].sort((a, b) => a.score - b.score)[0];
  return {
    score: overall,
    criteria,
    strengths: criteria.filter((c) => c.score >= 2.8).map((c) => c.criterion),
    gaps: criteria.filter((c) => c.score < 2).map((c) => c.criterion),
    evidenceQuotes: [...quotes].slice(0, 3),
    needsFollowUp: overall < 0.5 || words < 40,
    followUpFocus: weakest ? weakest.criterion.toLowerCase() : undefined,
    method: 'heuristic_rubric',
  };
}

// ---------------------------------------------------------------------------
// Discovery extraction
// ---------------------------------------------------------------------------

export interface DiscoveryExtraction {
  interests: string[];
  workValues: string[];
  taskAffinity: Record<string, number>;
  goals: string;
  constraints: string[];
}

const FAMILY_TERMS: Record<string, string[]> = {
  'software-engineering': ['coding', 'programming', 'software', 'backend', 'frontend', 'developer', 'lập trình'],
  'ai-data': ['ai', 'machine learning', 'data', 'llm', 'analytics', 'dữ liệu'],
  'cloud-devops': ['cloud', 'devops', 'infrastructure', 'kubernetes', 'aws', 'azure'],
  cybersecurity: ['security', 'hacking', 'bảo mật'],
  'business-analysis': ['business analysis', 'requirements', 'process', 'phân tích nghiệp vụ'],
  'product-management': ['product', 'customers', 'sản phẩm'],
  'project-delivery': ['project management', 'planning', 'coordination', 'quản lý dự án'],
  'ux-research': ['user research', 'ux', 'users', 'người dùng'],
  'ui-product-design': ['design', 'ui', 'visual', 'thiết kế'],
  'quality-engineering': ['testing', 'quality', 'qa', 'kiểm thử'],
  'tech-leadership': ['architecture', 'leading', 'mentoring', 'lead'],
};
const VALUE_TERMS: Record<string, string[]> = {
  autonomy: ['autonomy', 'independent', 'own decisions', 'tự chủ'],
  stability: ['stable', 'stability', 'security', 'ổn định'],
  impact: ['impact', 'meaningful', 'difference', 'tác động'],
  creativity: ['creative', 'creativity', 'sáng tạo'],
  learning: ['learn', 'grow', 'growth', 'học'],
  collaboration: ['team', 'collaborat', 'people', 'đồng đội'],
  compensation: ['salary', 'pay', 'money', 'compensation', 'lương', 'thu nhập'],
  flexibility: ['remote', 'flexible', 'flexibility', 'linh hoạt'],
  variety: ['variety', 'different things', 'đa dạng'],
  deep_focus: ['deep work', 'focus', 'quiet', 'tập trung'],
};
const TASK_TERMS: Record<string, string[]> = {
  building: ['build', 'coding', 'code', 'develop', 'implement', 'xây dựng', 'lập trình'],
  analysis: ['analy', 'data', 'numbers', 'logic', 'phân tích'],
  design: ['design', 'visual', 'interface', 'thiết kế'],
  communication: ['present', 'talk', 'writing', 'communicat', 'giao tiếp'],
  organizing: ['plan', 'organiz', 'coordinat', 'tổ chức', 'kế hoạch'],
  research: ['research', 'investigat', 'explor', 'nghiên cứu'],
  operations: ['maintain', 'operat', 'reliab', 'infrastructure', 'vận hành'],
  leading: ['lead', 'mentor', 'manage people', 'coach', 'dẫn dắt'],
};
const NEGATION = /(don'?t|do not|hate|dislike|not (really )?into|avoid|drain|tired of|không thích|ghét)/i;

export function heuristicDiscovery(answers: string[]): DiscoveryExtraction {
  const sentences = answers.join('\n').split(/(?<=[.!?\n])\s*/).filter(Boolean);
  const affinity: Record<string, number> = {};
  const interests = new Set<string>();
  const values = new Set<string>();
  for (const s of sentences) {
    const lower = s.toLowerCase();
    const negative = NEGATION.test(lower);
    for (const [dim, terms] of Object.entries(TASK_TERMS)) if (terms.some((t) => lower.includes(t))) affinity[dim] = negative ? Math.min(affinity[dim] ?? 3, 2) : Math.max(affinity[dim] ?? 3, 4);
    if (negative) continue;
    for (const [fam, terms] of Object.entries(FAMILY_TERMS)) if (terms.some((t) => containsTerm(` ${normalizeText(lower)} `, t))) interests.add(fam);
    for (const [v, terms] of Object.entries(VALUE_TERMS)) if (terms.some((t) => lower.includes(t))) values.add(v);
  }
  const constraints = sentences.filter((s) => /(hours?|giờ|deadline|budget|ngân sách|remote|relocat|months?|tháng)/i.test(s)).map((s) => s.trim().slice(0, 200)).slice(0, 5);
  return { interests: [...interests], workValues: [...values].slice(0, 5), taskAffinity: affinity, goals: '', constraints };
}

/** Deterministic extraction from multiple-choice discovery answers, keyed by topic key. */
export function discoveryFromChoices(answers: { topicKey: string; choices: string[] }[]): DiscoveryExtraction {
  const pick = (key: string) => answers.find((a) => a.topicKey === `discovery:${key}`)?.choices ?? [];
  const energy = pick('energy');
  const taskAffinity: Record<string, number> = {};
  for (const k of pick('drain')) if (TASK_CHOICES.some(([key]) => key === k) && !energy.includes(k)) taskAffinity[k] = 2;
  for (const k of energy) taskAffinity[k] = 5;
  const hours = HOURS_CHOICES.find(([k]) => k === pick('hours')[0]);
  const goals = DISCOVERY_MCQ.find((q) => q.key === 'goals')!.choices.filter(([key]) => pick('goals').includes(key)).map(([, label]) => label.en).join('; ');
  return { interests: pick('areas').filter((k) => AREA_CHOICES.some(([key]) => key === k)), workValues: pick('values'), taskAffinity, goals, constraints: hours ? [`Can study ${hours[1].en.toLowerCase()}`] : [] };
}
