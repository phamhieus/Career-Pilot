import { zodResolver } from '@hookform/resolvers/zod';
import { useQuery } from '@tanstack/react-query';
import { Check, FileUp, FlaskConical, MessagesSquare, Plus, Trash2, Upload } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { AiMetaNote, Button, ButtonLink, Card, cx, EmptyState, ErrorState, Field, Input, Loading, Modal, Notice, PageHeader, Pill, Select, SKILL_STATUS, SkillStatusPill, Tabs, Textarea } from '../components/ui';
import { api } from '../lib/api';
import { useAction, useMeta } from '../lib/hooks';
import type { ProfileItem, ProfileResponse } from '../lib/types';

type Tab = 'basics' | 'experience' | 'skills' | 'preferences' | 'constraints';
const MARKETS = ['vietnam', 'singapore', 'japan', 'remote', 'global'] as const;
const MODES = ['remote', 'hybrid', 'onsite'] as const;
const FAMILIES = [['software-engineering', 'Software Engineering'], ['ai-data', 'AI & Data'], ['cloud-devops', 'Cloud & DevOps'], ['cybersecurity', 'Cybersecurity'], ['business-analysis', 'Business Analysis'], ['product-management', 'Product'], ['project-delivery', 'Project & Delivery'], ['ux-research', 'UX & Research'], ['ui-product-design', 'UI & Product Design'], ['quality-engineering', 'Quality'], ['tech-leadership', 'Leadership & Architecture']];

export default function Profile() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState<Tab>(() => (['basics', 'experience', 'skills', 'preferences', 'constraints'].includes(params.get('tab') ?? '') ? (params.get('tab') as Tab) : 'basics'));
  useEffect(() => { if (tab === 'skills') void api.post('/onboarding/seen', { key: 'skills' }).catch(() => undefined); }, [tab]);
  const q = useQuery({ queryKey: ['profile'], queryFn: () => api.get<ProfileResponse>('/profile') });
  const sample = useAction(() => api.post('/profile/sample'), [['profile'], ['dashboard'], ['matching'], ['onboarding']]);
  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const data = q.data!;
  const pending = data.items.filter((i) => !i.confirmed).length;

  return (
    <>
      <PageHeader eyebrow="You" title="Career" highlight="profile" subtitle="Everything CareerPilot computes starts here. Skills keep their evidence status: self-reported, CV claim, assessed or app-verified."
        actions={<>
          <ButtonLink to="/interviews/new?mode=discovery" variant="ghost" icon={<MessagesSquare className="size-4" />}>Discovery interview</ButtonLink>
          {data.items.length === 0 && <Button variant="text" icon={<FlaskConical className="size-4" />} loading={sample.isPending} onClick={() => sample.mutate(undefined)}>Load sample backend profile</Button>}
        </>} />
      <div className="mb-6 grid gap-4 md:grid-cols-[1fr_auto] md:items-center">
        <div className="flex flex-wrap gap-2">
          {data.completeness.checks.map((c) => <Pill key={c.key} tone={c.done ? 'green' : 'neutral'}>{c.done && <Check className="size-3" />}{c.label}</Pill>)}
        </div>
        <div className="text-body-sm text-muted">{data.completeness.score}% complete</div>
      </div>
      {pending > 0 && <Notice tone="warn" className="mb-4">{pending} imported item(s) need your confirmation before they are used in matching or CVs.</Notice>}
      <div className="mb-6 overflow-x-auto"><Tabs value={tab} onChange={setTab} items={[{ value: 'basics', label: 'Basics' }, { value: 'experience', label: `Experience (${data.items.length})` }, { value: 'skills', label: `Skills (${data.skills.length})` }, { value: 'preferences', label: 'Interests & values' }, { value: 'constraints', label: 'Constraints & goals' }]} /></div>
      {tab === 'basics' && <Basics key={`${data.profile.headline}|${data.profile.summary.length}|${data.profile.currentRoleSlug}`} data={data} />}
      {tab === 'experience' && <Experience items={data.items} />}
      {tab === 'skills' && <Skills data={data} />}
      {tab === 'preferences' && <Preferences data={data} />}
      {tab === 'constraints' && <Constraints data={data} />}
    </>
  );
}

const basicsSchema = z.object({ headline: z.string().max(200), summary: z.string().max(3000), currentRoleSlug: z.string(), yearsExperience: z.string().regex(/^\d{0,2}(\.\d)?$/, 'Enter a number'), location: z.string().max(120) });
function Basics({ data }: { data: ProfileResponse }) {
  const meta = useMeta();
  const p = data.profile;
  const { register, handleSubmit, formState } = useForm<z.infer<typeof basicsSchema>>({ resolver: zodResolver(basicsSchema), defaultValues: { headline: p.headline, summary: p.summary, currentRoleSlug: p.currentRoleSlug ?? '', yearsExperience: p.yearsExperience?.toString() ?? '', location: p.location } });
  const save = useAction((v: object) => api.patch('/profile', v), [['profile'], ['dashboard']]);
  return (
    <Card>
      <form className="grid gap-5 md:grid-cols-2" onSubmit={handleSubmit((v) => save.mutate({ ...v, currentRoleSlug: v.currentRoleSlug || null, yearsExperience: v.yearsExperience ? Number(v.yearsExperience) : null }))}>
        <Field label="Headline" className="md:col-span-2"><Input placeholder="e.g. Backend Developer moving into AI engineering" {...register('headline')} /></Field>
        <Field label="Professional summary" hint="Used as the source for CV summaries — only facts you can back up." className="md:col-span-2"><Textarea rows={4} {...register('summary')} /></Field>
        <Field label="Current role"><Select {...register('currentRoleSlug')}><option value="">—</option>{meta.data?.roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select></Field>
        <Field label="Years of experience" error={formState.errors.yearsExperience?.message}><Input inputMode="decimal" {...register('yearsExperience')} /></Field>
        <Field label="Location"><Input {...register('location')} /></Field>
        <div className="flex items-end justify-end gap-3 md:col-span-2">{save.isSuccess && <span className="text-body-sm text-teal">Saved</span>}<Button variant="primary" type="submit" loading={save.isPending}>Save basics</Button></div>
      </form>
    </Card>
  );
}

function Experience({ items }: { items: ProfileItem[] }) {
  const [editing, setEditing] = useState<Partial<ProfileItem> | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const del = useAction((id: number) => api.del(`/profile/items/${id}`), [['profile']]);
  const confirm = useAction((id: number) => api.patch(`/profile/items/${id}`, { confirmed: true }), [['profile'], ['matching']]);
  const kinds = ['work', 'project', 'education', 'certification'] as const;
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-2">
        <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setEditing({ kind: 'work', highlights: [], skillSlugs: [] })}>Add entry</Button>
        <Button variant="ghost" icon={<FileUp className="size-4" />} onClick={() => setImportOpen(true)}>Import CV</Button>
      </div>
      {items.length === 0 && <EmptyState icon={<Upload className="size-5" />} title="No experience yet">Import your CV (PDF, DOCX or text) or add entries manually. Imported entries stay unconfirmed until you review them.</EmptyState>}
      {kinds.map((k) => items.filter((i) => i.kind === k).length > 0 && (
        <div key={k} className="mb-6">
          <h3 className="mb-2 text-body-sm font-semibold uppercase tracking-wider text-muted">{k === 'work' ? 'Work experience' : `${k}s`}</h3>
          <div className="flex flex-col gap-3">
            {items.filter((i) => i.kind === k).map((it) => (
              <Card key={it.id} className={cx(!it.confirmed && 'border-marigold')}>
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold">{it.title}{it.organization && <span className="font-normal text-ink-2"> · {it.organization}</span>}</div>
                    <div className="text-caption text-muted">{[it.startDate, it.endDate ?? (it.startDate ? 'present' : null)].filter(Boolean).join(' – ')} · {it.source === 'cv_import' ? 'imported from CV' : it.source}</div>
                  </div>
                  <div className="flex gap-1">
                    {!it.confirmed && <Button variant="ghost" onClick={() => confirm.mutate(it.id)} icon={<Check className="size-4" />}>Confirm</Button>}
                    <Button variant="text" onClick={() => setEditing(it)}>Edit</Button>
                    <Button variant="text" aria-label="Delete" onClick={() => window.confirm('Delete this entry?') && del.mutate(it.id)}><Trash2 className="size-4" /></Button>
                  </div>
                </div>
                {it.description && <p className="mt-2 text-body-sm text-ink-2">{it.description}</p>}
                {it.highlights.length > 0 && <ul className="mt-2 list-disc pl-5 text-body-sm">{it.highlights.map((h) => <li key={h}>{h}</li>)}</ul>}
                {it.skillSlugs.length > 0 && <div className="mt-3 flex flex-wrap gap-1">{it.skillSlugs.map((s) => <Pill key={s}>{s}</Pill>)}</div>}
              </Card>
            ))}
          </div>
        </div>
      ))}
      <ItemModal item={editing} onClose={() => setEditing(null)} />
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />
    </>
  );
}

function ItemModal({ item, onClose }: { item: Partial<ProfileItem> | null; onClose: () => void }) {
  const meta = useMeta();
  const [form, setForm] = useState<Partial<ProfileItem>>({});
  const [key, setKey] = useState<number | undefined>();
  if (item && key !== (item.id ?? -1)) { setForm(item); setKey(item.id ?? -1); }
  const save = useAction((v: Partial<ProfileItem>) => (item?.id ? api.patch(`/profile/items/${item.id}`, v) : api.post('/profile/items', v)), [['profile'], ['matching']], () => { setKey(undefined); onClose(); });
  const set = (k: keyof ProfileItem, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  return (
    <Modal open={!!item} onClose={() => { setKey(undefined); onClose(); }} title={item?.id ? 'Edit entry' : 'Add entry'} wide>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate({ kind: form.kind, title: form.title, organization: form.organization ?? '', startDate: form.startDate || null, endDate: form.endDate || null, description: form.description ?? '', highlights: (form.highlights ?? []).filter(Boolean), skillSlugs: form.skillSlugs ?? [], confirmed: true }); }}>
        <Field label="Type"><Select value={form.kind} onChange={(e) => set('kind', e.target.value)}>{['work', 'project', 'education', 'certification'].map((k) => <option key={k}>{k}</option>)}</Select></Field>
        <Field label="Title"><Input required value={form.title ?? ''} onChange={(e) => set('title', e.target.value)} /></Field>
        <Field label="Organization"><Input value={form.organization ?? ''} onChange={(e) => set('organization', e.target.value)} /></Field>
        <div className="grid grid-cols-2 gap-3"><Field label="Start (YYYY-MM)"><Input pattern="\d{4}(-\d{2})?" value={form.startDate ?? ''} onChange={(e) => set('startDate', e.target.value)} /></Field><Field label="End"><Input pattern="\d{4}(-\d{2})?" placeholder="present" value={form.endDate ?? ''} onChange={(e) => set('endDate', e.target.value)} /></Field></div>
        <Field label="Description" className="md:col-span-2"><Textarea rows={2} value={form.description ?? ''} onChange={(e) => set('description', e.target.value)} /></Field>
        <Field label="Highlights (one per line)" hint="Concrete, true statements. These become CV bullets with evidence links." className="md:col-span-2"><Textarea rows={4} value={(form.highlights ?? []).join('\n')} onChange={(e) => set('highlights', e.target.value.split('\n'))} /></Field>
        <Field label="Skills used" hint="Leave empty to detect from the text." className="md:col-span-2">
          <SkillPicker value={form.skillSlugs ?? []} onChange={(v) => set('skillSlugs', v)} options={meta.data?.skills ?? []} />
        </Field>
        {save.error && <p className="text-body-sm text-vermillion md:col-span-2">{(save.error as Error).message}</p>}
        <div className="flex justify-end md:col-span-2"><Button variant="primary" type="submit" loading={save.isPending}>Save</Button></div>
      </form>
    </Modal>
  );
}

export function SkillPicker({ value, onChange, options }: { value: string[]; onChange: (v: string[]) => void; options: { slug: string; name: string }[] }) {
  const [q, setQ] = useState('');
  const matches = q ? options.filter((o) => o.name.toLowerCase().includes(q.toLowerCase()) && !value.includes(o.slug)).slice(0, 6) : [];
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">{value.map((v) => <button type="button" key={v} onClick={() => onChange(value.filter((x) => x !== v))} className="rounded-full bg-sky-tint px-2.5 py-0.5 text-caption text-[#005bb0] dark:bg-primary-soft dark:text-primary">{options.find((o) => o.slug === v)?.name ?? v} ×</button>)}</div>
      <Input placeholder="Type to add a skill…" value={q} onChange={(e) => setQ(e.target.value)} />
      {matches.length > 0 && <div className="flex flex-wrap gap-1">{matches.map((m) => <button type="button" key={m.slug} onClick={() => { onChange([...value, m.slug]); setQ(''); }} className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-caption dark:bg-white/10">+ {m.name}</button>)}</div>}
    </div>
  );
}

function ImportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [text, setText] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const run = useAction(() => {
    if (file) { const f = new FormData(); f.append('file', file); return api.upload<ImportResult>('/profile/import-cv', f); }
    return api.post<ImportResult>('/profile/import-cv', { text });
  }, [['profile']]);
  type ImportResult = { items: ProfileItem[]; extractedSkills: string[]; aiMeta: { mode: string; provider: string; fallbackReason?: string } };
  return (
    <Modal open={open} onClose={() => { run.reset(); onClose(); }} title="Import CV" wide>
      {run.data ? (
        <div className="flex flex-col gap-3">
          <Notice>Extracted {run.data.items.length} entries and {run.data.extractedSkills.length} skill claims. Entries are <b>unconfirmed</b> until you review them; skills are marked “CV claim”.</Notice>
          <AiMetaNote meta={run.data.aiMeta} />
          <div className="flex justify-end"><Button variant="primary" onClick={() => { run.reset(); onClose(); }}>Review entries</Button></div>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <Field label="Upload PDF, DOCX or TXT (max 5 MB)"><Input type="file" accept=".pdf,.docx,.txt,.md" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></Field>
          <div className="text-center text-caption text-muted">or paste text</div>
          <Textarea rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Paste your CV text…" disabled={!!file} />
          <p className="text-caption text-muted">CV content is treated as untrusted input: it is parsed for facts only and never executed as instructions.</p>
          {run.error && <p className="text-body-sm text-vermillion">{(run.error as Error).message}</p>}
          <div className="flex justify-end"><Button variant="primary" loading={run.isPending} disabled={!file && text.trim().length < 50} onClick={() => run.mutate(undefined)}>Extract</Button></div>
        </div>
      )}
    </Modal>
  );
}

function Skills({ data }: { data: ProfileResponse }) {
  const meta = useMeta();
  const [adding, setAdding] = useState<string[]>([]);
  const rate = useAction(({ slug, rating }: { slug: string; rating: number }) => api.put(`/profile/skills/${slug}`, { rating }), [['profile'], ['matching']]);
  const remove = useAction((slug: string) => api.del(`/profile/skills/${slug}`), [['profile'], ['matching']]);
  const [open, setOpen] = useState<string | null>(null);
  const byCat = new Map<string, typeof data.skills>();
  for (const s of data.skills) byCat.set(s.category, [...(byCat.get(s.category) ?? []), s]);
  return (
    <>
      <Card className="mb-6">
        <div className="mb-2 font-semibold">Add self-reported skills</div>
        <div className="grid gap-3 md:grid-cols-[1fr_auto] md:items-start">
          <SkillPicker value={adding} onChange={setAdding} options={meta.data?.skills ?? []} />
          <Button variant="primary" disabled={!adding.length} loading={rate.isPending} onClick={async () => { for (const slug of adding) await rate.mutateAsync({ slug, rating: 3 }); setAdding([]); }}>Add at level 3</Button>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-caption text-muted">{Object.entries(SKILL_STATUS).filter(([k]) => k !== 'unknown').map(([k, v]) => <span key={k} className="inline-flex items-center gap-1.5"><SkillStatusPill status={k} />{v.help}</span>)}</div>
      </Card>
      {data.skills.length === 0 && <EmptyState title="No skills yet">Add skills above, import a CV, or take an assessment.</EmptyState>}
      {[...byCat.entries()].map(([cat, list]) => (
        <div key={cat} className="mb-6">
          <h3 className="mb-2 text-body-sm font-semibold uppercase tracking-wider text-muted">{cat}</h3>
          <Card padded={false}>
            {list.map((s) => (
              <div key={s.slug} className="border-b border-line px-5 py-3 last:border-0">
                <div className="flex flex-wrap items-center gap-3">
                  <button className="min-w-40 text-left font-medium hover:text-primary" onClick={() => setOpen(open === s.slug ? null : s.slug)}>{s.name}</button>
                  <SkillStatusPill status={s.status} />
                  <span className="text-caption text-muted">{s.proficiency != null ? `level ${s.proficiency}` : 'level unknown'}</span>
                  <div className="ml-auto flex items-center gap-1" role="radiogroup" aria-label={`Self-rating for ${s.name}`}>
                    <span className="mr-1 text-caption text-muted">self-rating</span>
                    {[1, 2, 3, 4, 5].map((r) => <button key={r} role="radio" aria-checked={s.selfRating === r} onClick={() => rate.mutate({ slug: s.slug, rating: r })} className={cx('size-6 rounded-full text-caption transition-colors', s.selfRating === r ? 'bg-marigold font-semibold text-black' : 'bg-black/[0.04] hover:bg-black/10 dark:bg-white/10')}>{r}</button>)}
                    {s.selfRating != null && <button aria-label="Remove self-rating" onClick={() => remove.mutate(s.slug)} className="ml-1 rounded-md p-1 text-faint hover:text-vermillion"><Trash2 className="size-3.5" /></button>}
                  </div>
                </div>
                {open === s.slug && (
                  <div className="mt-3 rounded-md bg-surface-2 p-3 text-body-sm">
                    <p className="mb-2 text-ink-2">{s.reason}</p>
                    <ul className="flex flex-col gap-1">{s.evidence.map((e) => <li key={e.id} className="flex flex-wrap gap-2 text-caption"><Pill>{e.type.replace('_', ' ')}</Pill>{e.score != null && <span>score {Math.round(e.score * 100)}%</span>}{e.gradingMethod && <span className="text-muted">graded: {e.gradingMethod.replace('_', ' ')}</span>}<span className="text-muted">{e.notes}</span><span className="ml-auto text-faint">{new Date(e.createdAt).toLocaleDateString()}</span></li>)}</ul>
                  </div>
                )}
              </div>
            ))}
          </Card>
        </div>
      ))}
    </>
  );
}

function Preferences({ data }: { data: ProfileResponse }) {
  const meta = useMeta();
  const [aff, setAff] = useState<Record<string, number>>(data.profile.taskAffinity);
  const [values, setValues] = useState<string[]>(data.profile.workValues);
  const [interests, setInterests] = useState<string[]>(data.profile.interests);
  const save = useAction(() => api.patch('/profile', { taskAffinity: aff, workValues: values, interests }), [['profile'], ['matching']]);
  const toggle = (arr: string[], v: string, set: (x: string[]) => void, max = 11) => set(arr.includes(v) ? arr.filter((x) => x !== v) : arr.length < max ? [...arr, v] : arr);
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Card>
        <div className="mb-1 font-semibold">How much do you enjoy…</div>
        <p className="mb-4 text-body-sm text-ink-2">1 = drains you, 5 = energizes you. Leave unrated if unsure — unknown is fine.</p>
        <div className="flex flex-col gap-4">
          {meta.data?.taskDimensions.map((d) => (
            <div key={d.key}>
              <div className="flex items-center justify-between text-body-sm"><span className="font-medium">{d.label}</span><span className="text-muted">{aff[d.key] ?? '—'}</span></div>
              <div className="text-caption text-muted">{d.description}</div>
              <input aria-label={d.label} type="range" min={1} max={5} value={aff[d.key] ?? 3} onChange={(e) => setAff({ ...aff, [d.key]: Number(e.target.value) })} className="mt-1 w-full accent-[#0075de]" />
            </div>
          ))}
        </div>
      </Card>
      <div className="flex flex-col gap-6">
        <Card>
          <div className="mb-3 font-semibold">Work values <span className="font-normal text-muted">(pick up to 5)</span></div>
          <div className="flex flex-wrap gap-2">{meta.data?.workValues.map((v) => <button key={v.key} onClick={() => toggle(values, v.key, setValues, 5)} className={cx('rounded-full px-3 py-1 text-body-sm transition-colors', values.includes(v.key) ? 'bg-marigold font-medium text-black' : 'bg-black/[0.05] dark:bg-white/10')}>{v.label}</button>)}</div>
        </Card>
        <Card>
          <div className="mb-3 font-semibold">Career families you’re curious about</div>
          <div className="flex flex-wrap gap-2">{FAMILIES.map(([k, l]) => <button key={k} onClick={() => toggle(interests, k, setInterests)} className={cx('rounded-full px-3 py-1 text-body-sm transition-colors', interests.includes(k) ? 'bg-sky-wash font-medium text-black' : 'bg-black/[0.05] dark:bg-white/10')}>{l}</button>)}</div>
        </Card>
        <Notice>CareerPilot never infers or uses age, gender, nationality, health or other protected characteristics to rank careers.</Notice>
        <div className="flex justify-end gap-3">{save.isSuccess && <span className="self-center text-body-sm text-teal">Saved</span>}<Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save preferences</Button></div>
      </div>
    </div>
  );
}

function Constraints({ data }: { data: ProfileResponse }) {
  const meta = useMeta();
  const p = data.profile;
  const [f, setF] = useState({ weeklyLearningHours: p.weeklyLearningHours?.toString() ?? '', studyDaysPerWeek: p.studyDaysPerWeek, deadline: p.deadline ?? '', salaryMin: p.salaryMin?.toString() ?? '', salaryCurrency: p.salaryCurrency ?? 'USD', monthlyBudget: p.monthlyBudget?.toString() ?? '', preferredLanguage: p.preferredLanguage, learningStyle: p.learningStyle ?? '', goals: p.goals, markets: p.markets, workModes: p.workModes, targetRoleSlugs: p.targetRoleSlugs });
  const save = useAction(() => api.patch('/profile', {
    weeklyLearningHours: f.weeklyLearningHours ? Number(f.weeklyLearningHours) : null, studyDaysPerWeek: Number(f.studyDaysPerWeek), deadline: f.deadline || null,
    salaryMin: f.salaryMin ? Number(f.salaryMin) : null, salaryCurrency: f.salaryCurrency || null, monthlyBudget: f.monthlyBudget ? Number(f.monthlyBudget) : null,
    preferredLanguage: f.preferredLanguage, learningStyle: f.learningStyle || null, goals: f.goals, markets: f.markets, workModes: f.workModes, targetRoleSlugs: f.targetRoleSlugs,
  }), [['profile'], ['matching'], ['dashboard']]);
  const toggle = (k: 'markets' | 'workModes' | 'targetRoleSlugs', v: string) => setF((x) => ({ ...x, [k]: x[k].includes(v) ? x[k].filter((y) => y !== v) : [...x[k], v] }));
  return (
    <Card>
      <div className="grid gap-5 md:grid-cols-3">
        <Field label="Learning hours per week"><Input type="number" min={1} max={80} value={f.weeklyLearningHours} onChange={(e) => setF({ ...f, weeklyLearningHours: e.target.value })} /></Field>
        <Field label="Study days per week"><Input type="number" min={1} max={7} value={f.studyDaysPerWeek} onChange={(e) => setF({ ...f, studyDaysPerWeek: Number(e.target.value) })} /></Field>
        <Field label="Target deadline"><Input type="date" value={f.deadline} onChange={(e) => setF({ ...f, deadline: e.target.value })} /></Field>
        <Field label="Minimum salary (your expectation)"><div className="flex gap-2"><Input type="number" value={f.salaryMin} onChange={(e) => setF({ ...f, salaryMin: e.target.value })} /><Select className="w-24" value={f.salaryCurrency} onChange={(e) => setF({ ...f, salaryCurrency: e.target.value })}>{['USD', 'VND', 'SGD', 'EUR', 'JPY'].map((c) => <option key={c}>{c}</option>)}</Select></div></Field>
        <Field label="Monthly learning budget"><Input type="number" value={f.monthlyBudget} onChange={(e) => setF({ ...f, monthlyBudget: e.target.value })} /></Field>
        <Field label="Preferred language"><Select value={f.preferredLanguage} onChange={(e) => setF({ ...f, preferredLanguage: e.target.value })}><option value="en">English</option><option value="vi">Tiếng Việt</option></Select></Field>
        <Field label="Learning style"><Select value={f.learningStyle} onChange={(e) => setF({ ...f, learningStyle: e.target.value })}><option value="">—</option><option value="reading">Reading docs</option><option value="video">Video courses</option><option value="project">Project-based</option><option value="mixed">Mixed</option></Select></Field>
        <div className="md:col-span-3"><div className="mb-2 text-body-sm font-medium">Preferred markets</div><div className="flex flex-wrap gap-2">{MARKETS.map((m) => <button key={m} onClick={() => toggle('markets', m)} className={cx('rounded-full px-3 py-1 text-body-sm capitalize', f.markets.includes(m) ? 'bg-sky-wash text-black' : 'bg-black/[0.05] dark:bg-white/10')}>{m}</button>)}</div></div>
        <div className="md:col-span-3"><div className="mb-2 text-body-sm font-medium">Work modes</div><div className="flex flex-wrap gap-2">{MODES.map((m) => <button key={m} onClick={() => toggle('workModes', m)} className={cx('rounded-full px-3 py-1 text-body-sm capitalize', f.workModes.includes(m) ? 'bg-sky-wash text-black' : 'bg-black/[0.05] dark:bg-white/10')}>{m}</button>)}</div></div>
        <div className="md:col-span-3"><div className="mb-2 text-body-sm font-medium">Target roles (up to 5)</div><div className="flex flex-wrap gap-2">{meta.data?.roles.map((r) => <button key={r.slug} onClick={() => toggle('targetRoleSlugs', r.slug)} className={cx('rounded-full px-3 py-1 text-body-sm', f.targetRoleSlugs.includes(r.slug) ? 'bg-marigold text-black' : 'bg-black/[0.05] dark:bg-white/10')}>{r.name}</button>)}</div></div>
        <Field label="Career goals" className="md:col-span-3"><Textarea rows={3} value={f.goals} onChange={(e) => setF({ ...f, goals: e.target.value })} /></Field>
      </div>
      {save.error && <p className="mt-3 text-body-sm text-vermillion">{(save.error as Error).message}</p>}
      <div className="mt-5 flex justify-end gap-3">{save.isSuccess && <span className="self-center text-body-sm text-teal">Saved</span>}<Button variant="primary" loading={save.isPending} onClick={() => save.mutate(undefined)}>Save</Button></div>
    </Card>
  );
}
