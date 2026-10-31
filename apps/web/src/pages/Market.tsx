import { useQuery } from '@tanstack/react-query';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useState } from 'react';
import { ExternalLink } from 'lucide-react';
import { Link } from 'react-router';
import { Card, cx, DemoBadge, EmptyState, ErrorState, fmtDate, Loading, Modal, Notice, PageHeader, Pill, Section, Select, Stat, Tabs } from '../components/ui';
import { api, qs } from '../lib/api';
import { useMeta } from '../lib/hooks';

interface KV { key: string; value: number }
interface MarketData {
  totals: { postings: number; active: number; withJdText: number; demo: number; duplicatesMerged: number };
  historical: { postingsByMonth: KV[]; roleAggregates: { roleKey: string; series: { period: string; value: number }[]; months: number }[]; note: string };
  current: {
    volumeByRole: KV[]; topSkills: { slug: string; name: string; required: number; preferred: number; share: number }[]; certifications: { id: string; name: string; required: number; preferred: number; mentioned: number; total: number }[];
    seniority: KV[]; markets: KV[]; workModes: KV[]; salary: { currency: string; postings: number; medianMidpoint: number }[]; salaryNote: string;
    emerging: { status: string; reason: string; skills: { slug: string; name: string; recentShare: number; priorShare: number }[] }; skillCoverageNote: string; sampleNote: string | null;
  };
  forecast: { status: 'ok' | 'insufficient'; reason: string; points?: { period: string; value: number; low: number; high: number }[] };
  coverage: { sources: { key: string; name: string; websiteUrl: string | null; isDemo: boolean; lastSyncAt: string | null; lastSyncStatus: string | null; postings: number }[]; websites: { name: string; url: string; postings: number }[]; origins: KV[]; medianDaysSinceSeen: number | null };
}
type Dimension = 'total' | 'month' | 'role' | 'skill' | 'cert' | 'seniority' | 'market' | 'workMode' | 'salary' | 'source' | 'origin';
interface Drill { dimension: Dimension; key: string }
interface Filters { role: string; market: string; includeDemo: boolean }
interface Breakdown { key: string; value: number; label?: string }
interface DrillData {
  title: string; description: string; count: number; base: number; share: number; detail: { label: string; value: string }[];
  breakdown: Record<'role' | 'skill' | 'cert' | 'seniority' | 'market' | 'workMode' | 'company', Breakdown[]>;
  postings: { id: number; title: string; company: string; market: string | null; seniority: string | null; workMode: string | null; status: string; isDemo: boolean; postedAt: string | null; daysSinceSeen: number; source: string | null; originSite: string | null; url: string | null }[];
}

const AXIS = { fontSize: 12, fill: 'var(--cp-muted)' };
const tooltipStyle = { contentStyle: { background: 'var(--cp-surface)', border: '1px solid var(--cp-line)', borderRadius: 8, fontSize: 12, color: 'var(--cp-ink)' }, cursor: { fill: 'rgba(0,117,222,0.06)' } };
const clickable = 'cursor-pointer transition-colors hover:border-primary/40 focus-visible:outline-2 focus-visible:outline-primary';

function HBar({ data, height = 280, onSelect }: { data: { key: string; name: string; value: number }[]; height?: number; onSelect: (key: string) => void }) {
  if (!data.length) return <p className="text-body-sm text-muted">No data.</p>;
  return (
    <ResponsiveContainer width="100%" height={Math.max(height, data.length * 26)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16 }} barCategoryGap={4}>
        <CartesianGrid horizontal={false} stroke="var(--cp-line)" />
        <XAxis type="number" tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="name" tick={AXIS} width={150} axisLine={false} tickLine={false} />
        <Tooltip {...tooltipStyle} />
        <Bar dataKey="value" name="Postings" fill="#0075de" radius={[0, 4, 4, 0]} maxBarSize={14} cursor="pointer" onClick={(_, i) => onSelect(data[i].key)} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export default function Market() {
  const meta = useMeta();
  const [role, setRole] = useState('');
  const [market, setMarket] = useState('');
  const [includeDemo, setIncludeDemo] = useState(false);
  const [view, setView] = useState<'charts' | 'table'>('charts');
  const q = useQuery({ queryKey: ['market', role, market, includeDemo], queryFn: () => api.get<MarketData>(`/market${qs({ role, market, includeDemo })}`) });

  return (
    <>
      <PageHeader eyebrow="Explore" title="Job" highlight="market" subtitle="Historical observations, current signals and forecast scenarios are kept separate. Everything reflects ingested sources only. Click any bar, figure or tag for details." />
      <div className="mb-6 flex flex-col gap-3 md:flex-row md:items-center">
        <Select aria-label="Role" className="md:w-60" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All roles</option>{meta.data?.roles.map((r) => <option key={r.slug} value={r.slug}>{r.name}</option>)}</Select>
        <Select aria-label="Market" className="md:w-44" value={market} onChange={(e) => setMarket(e.target.value)}><option value="">All markets</option>{['vietnam', 'singapore', 'japan', 'remote', 'global'].map((m) => <option key={m} value={m}>{m}</option>)}</Select>
        <label className="inline-flex items-center gap-2 text-body-sm"><input type="checkbox" checked={includeDemo} onChange={(e) => setIncludeDemo(e.target.checked)} />Include demo postings</label>
        <div className="md:ml-auto"><Tabs value={view} onChange={setView} items={[{ value: 'charts', label: 'Charts' }, { value: 'table', label: 'Tables' }]} /></div>
      </div>
      {q.isLoading && <Loading rows={5} />}
      {q.error && <ErrorState error={q.error} retry={q.refetch} />}
      {q.data && <MarketSources coverage={q.data.coverage} />}
      {q.data && q.data.totals.postings === 0 && <EmptyState title="No market data yet">Sync the Cert Trends source on the Jobs page to load real postings. Demo postings are excluded unless you include them.</EmptyState>}
      {q.data && q.data.totals.postings > 0 && <MarketBody d={q.data} view={view} filters={{ role, market, includeDemo }} />}
    </>
  );
}

function WebsiteLink({ url, children }: { url: string; children: React.ReactNode }) {
  return <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex max-w-full items-center gap-1 break-all text-body-sm text-primary hover:underline">{children}<ExternalLink className="size-3.5 shrink-0" /></a>;
}

function MarketSources({ coverage }: { coverage: MarketData['coverage'] }) {
  return (
    <Section title="Job websites" description="Original websites that publish the vacancies. Counts reflect the current filters.">
      <div>
        <Card>
          <h3 className="mb-3 font-semibold">Original job websites</h3>
          {coverage.websites.length ? <ul className="flex max-h-72 flex-col gap-3 overflow-y-auto">
            {coverage.websites.map((s) => <li key={s.url}>
              <div className="flex flex-wrap items-center gap-2"><WebsiteLink url={s.url}>{s.name}</WebsiteLink><Pill>{s.postings} postings</Pill></div>
              <div className="break-all text-caption text-muted">{s.url}</div>
            </li>)}
          </ul> : <p className="text-body-sm text-muted">No original website links in the current selection. Sync a source or change the filters to see real postings.</p>}
          <p className="mt-3 text-caption text-muted">Only websites recorded in the imported posting URLs appear here. Open a chart detail to view individual original postings.</p>
        </Card>
      </div>
    </Section>
  );
}

function MarketBody({ d, view, filters }: { d: MarketData; view: 'charts' | 'table'; filters: Filters }) {
  const [drill, setDrill] = useState<Drill | null>(null);
  const open = (dimension: Dimension) => (key: string) => setDrill({ dimension, key });
  const months = d.historical.postingsByMonth.map((m) => ({ key: m.key, name: m.key, value: m.value }));
  const table = (rows: (string | number)[][], head: string[], onRow?: (i: number) => void) => (
    <table className="w-full text-body-sm"><thead><tr className="border-b border-line text-left text-caption text-muted">{head.map((h) => <th key={h} className="py-1.5 font-medium">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} onClick={onRow && (() => onRow(i))} className={cx('border-b border-line last:border-0', onRow && 'cursor-pointer hover:bg-surface-2')}>{r.map((c, j) => <td key={j} className="py-1.5">{c}</td>)}</tr>)}</tbody></table>
  );
  const stat = (key: string, label: string, value: string | number, hint?: string) => (
    <button type="button" onClick={() => open('total')(key)} className={cx('card p-6 text-left', clickable)}><Stat label={label} value={value} hint={hint} /></button>
  );
  return (
    <>
      {d.current.sampleNote && <Notice className="mb-4">{d.current.sampleNote}</Notice>}
      {filters.includeDemo && d.totals.demo > 0 && <Notice tone="demo" className="mb-4">{d.totals.demo} fictional demo posting(s) are included in these figures.</Notice>}
      <div className="mb-10 grid grid-cols-2 gap-6 md:grid-cols-5">
        {stat('postings', 'Postings', d.totals.postings, 'deduplicated')}
        {stat('active', 'Active', d.totals.active)}
        {stat('withJdText', 'With JD text', d.totals.withJdText)}
        {stat('duplicatesMerged', 'Duplicates merged', d.totals.duplicatesMerged)}
        {stat('freshness', 'Median freshness', d.coverage.medianDaysSinceSeen != null ? `${d.coverage.medianDaysSinceSeen}d` : '—', 'since last seen')}
      </div>

      <Section title="Historical observations" description={d.historical.note}>
        <Card>
          <div className="mb-2 text-body-sm font-medium">Postings by month</div>
          {view === 'charts' ? (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={months} margin={{ left: -16 }}>
                <CartesianGrid vertical={false} stroke="var(--cp-line)" />
                <XAxis dataKey="name" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} allowDecimals={false} />
                <Tooltip {...tooltipStyle} />
                <Bar dataKey="value" name="Postings" fill="#0075de" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer" onClick={(_, i) => open('month')(months[i].key)} />
              </BarChart>
            </ResponsiveContainer>
          ) : table(months.map((m) => [m.name, m.value]), ['Month', 'Postings'], (i) => open('month')(months[i].key))}
          {d.historical.roleAggregates.length > 0 && (
            <div className="mt-5 border-t border-line pt-4">
              <div className="mb-2 text-body-sm font-medium">Cert Trends role demand (titles counted over every posting on fully-enumerated boards — unfiltered)</div>
              {table(d.historical.roleAggregates.map((r) => [r.roleKey, `${r.months} month(s) with data`, r.series.filter((s) => s.value > 0).map((s) => `${s.period}: ${s.value}`).join(' · ') || '—']), ['Role key', 'Coverage', 'Series'])}
            </div>
          )}
        </Card>
      </Section>

      <Section title="Current market signals" description={d.current.skillCoverageNote}>
        <div className="grid gap-4 lg:grid-cols-2">
          <Card><div className="mb-2 text-body-sm font-medium">Volume by role</div>{view === 'charts' ? <HBar data={d.current.volumeByRole.map((x) => ({ key: x.key, name: x.key, value: x.value }))} onSelect={open('role')} /> : table(d.current.volumeByRole.map((x) => [x.key, x.value]), ['Role', 'Active postings'], (i) => open('role')(d.current.volumeByRole[i].key))}</Card>
          <Card><div className="mb-2 text-body-sm font-medium">Certification demand</div>{view === 'charts' ? <HBar data={d.current.certifications.map((c) => ({ key: c.id, name: c.name, value: c.total }))} onSelect={open('cert')} /> : table(d.current.certifications.map((c) => [c.name, c.required, c.preferred, c.mentioned]), ['Certification', 'Required', 'Preferred', 'Mentioned'], (i) => open('cert')(d.current.certifications[i].id))}</Card>
          <Card><div className="mb-2 text-body-sm font-medium">Skills mentioned in postings</div>{view === 'charts' ? <HBar data={d.current.topSkills.map((s) => ({ key: s.slug, name: s.name, value: s.required + s.preferred }))} onSelect={open('skill')} /> : table(d.current.topSkills.map((s) => [s.name, s.required, s.preferred, `${s.share}%`]), ['Skill', 'Required', 'Preferred', 'Share'], (i) => open('skill')(d.current.topSkills[i].slug))}</Card>
          <Card>
            <div className="mb-3 text-body-sm font-medium">Seniority · markets · work mode</div>
            {([['Seniority', 'seniority', d.current.seniority], ['Market', 'market', d.current.markets], ['Work mode', 'workMode', d.current.workModes]] as const).map(([label, dim, rows]) => (
              <div key={label} className="mb-4"><div className="mb-1 text-caption text-muted">{label}</div><div className="flex flex-wrap gap-1.5">{rows.map((r) => <button key={r.key} type="button" onClick={() => open(dim)(r.key)} className="rounded-full hover:opacity-80"><Pill>{r.key}: {r.value}</Pill></button>)}</div></div>
            ))}
            <div className="mb-1 text-caption text-muted">Salary observations</div>
            {d.current.salary.length ? table(d.current.salary.map((s) => [s.currency, s.postings, s.medianMidpoint.toLocaleString()]), ['Currency', 'Postings', 'Median midpoint'], (i) => open('salary')(d.current.salary[i].currency)) : <p className="text-body-sm text-muted">{d.current.salaryNote}</p>}
          </Card>
        </div>
        <Card className="mt-4">
          <div className="mb-1 text-body-sm font-medium">Emerging skill signals</div>
          <p className="text-body-sm text-ink-2">{d.current.emerging.reason}</p>
          {d.current.emerging.skills.length > 0 && <div className="mt-2">{table(d.current.emerging.skills.map((s) => [s.name, `${s.priorShare}%`, `${s.recentShare}%`]), ['Skill', 'Prior 60 days', 'Last 30 days'], (i) => open('skill')(d.current.emerging.skills[i].slug))}</div>}
        </Card>
      </Section>

      <Section title="Forecast scenarios" description="Statistical trend only — never an AI-invented number.">
        {d.forecast.status === 'insufficient' ? (
          <Card className="border-dashed"><div className="font-semibold">Insufficient historical data</div><p className="mt-1 text-body-sm text-ink-2">{d.forecast.reason}</p></Card>
        ) : (
          <Card>
            <p className="mb-3 text-body-sm text-ink-2">{d.forecast.reason}</p>
            <ResponsiveContainer width="100%" height={240}>
              <ComposedChart data={d.forecast.points!.map((p) => ({ ...p, band: [p.low, p.high] }))} margin={{ left: -16 }}>
                <CartesianGrid vertical={false} stroke="var(--cp-line)" />
                <XAxis dataKey="period" tick={AXIS} axisLine={false} tickLine={false} />
                <YAxis tick={AXIS} axisLine={false} tickLine={false} />
                <Tooltip {...tooltipStyle} />
                <Area dataKey="band" name="80% interval" fill="#62aef0" fillOpacity={0.25} stroke="none" />
                <Line dataKey="value" name="Trend" stroke="#0075de" strokeWidth={2} dot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </Card>
        )}
      </Section>

      <Section title="Source coverage & freshness">
        <Card>
          {table(d.coverage.sources.map((s) => [s.name + (s.isDemo ? ' (demo)' : ''), s.postings, s.lastSyncAt ? fmtDate(s.lastSyncAt) : 'never', s.lastSyncStatus ?? '—']), ['Source', 'Postings', 'Last sync', 'Status'], (i) => open('source')(d.coverage.sources[i].key))}
          <div className="mt-4 flex flex-wrap items-center gap-1.5 text-caption text-muted">Upstream sites: {d.coverage.origins.map((o) => <button key={o.key} type="button" onClick={() => open('origin')(o.key)} className="rounded-full hover:opacity-80"><Pill>{o.key} ({o.value})</Pill></button>)}</div>
        </Card>
      </Section>

      {drill && <DrillModal drill={drill} filters={filters} onClose={() => setDrill(null)} onDrill={setDrill} />}
    </>
  );
}

const BREAKDOWNS: { key: keyof DrillData['breakdown']; label: string; dimension?: Dimension }[] = [
  { key: 'role', label: 'Roles', dimension: 'role' }, { key: 'skill', label: 'Skills', dimension: 'skill' }, { key: 'cert', label: 'Certifications', dimension: 'cert' },
  { key: 'seniority', label: 'Seniority', dimension: 'seniority' }, { key: 'market', label: 'Markets', dimension: 'market' }, { key: 'workMode', label: 'Work mode', dimension: 'workMode' },
  { key: 'company', label: 'Top companies' },
];

function DrillModal({ drill, filters, onClose, onDrill }: { drill: Drill; filters: Filters; onClose: () => void; onDrill: (d: Drill) => void }) {
  const q = useQuery({ queryKey: ['market-drill', filters, drill], queryFn: () => api.get<DrillData>(`/market/drilldown${qs({ ...filters, ...drill })}`) });
  const d = q.data;
  return (
    <Modal open onClose={onClose} title={d?.title ?? 'Details'} wide>
      {q.isLoading && <Loading rows={4} />}
      {q.error && <ErrorState error={q.error} retry={q.refetch} />}
      {d && (
        <div className="flex flex-col gap-5">
          <p className="text-body-sm text-ink-2">{d.description}</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-md bg-surface-2 p-3"><Stat label="Postings" value={d.count} /></div>
            <div className="rounded-md bg-surface-2 p-3"><Stat label="Share" value={`${d.share}%`} hint={`of ${d.base}`} /></div>
            {d.detail.map((x) => <div key={x.label} className="rounded-md bg-surface-2 p-3"><Stat label={x.label} value={x.value} /></div>)}
          </div>
          {d.count > 0 && (
            <div className="grid gap-4 sm:grid-cols-2">
              {BREAKDOWNS.filter((b) => d.breakdown[b.key].length).map((b) => (
                <div key={b.key}>
                  <div className="mb-1.5 text-caption text-muted">{b.label}</div>
                  <ul className="flex flex-col gap-1">
                    {d.breakdown[b.key].map((x) => {
                      const pct = Math.round((x.value / d.count) * 100);
                      const body = <><span className="relative flex-1 truncate">{x.label ?? x.key}</span><span className="relative text-muted">{x.value} · {pct}%</span><span className="absolute inset-y-0 left-0 rounded bg-primary-soft" style={{ width: `${pct}%` }} /></>;
                      return (
                        <li key={x.key}>
                          {b.dimension
                            ? <button type="button" onClick={() => onDrill({ dimension: b.dimension!, key: x.key })} className="relative flex w-full items-center gap-2 overflow-hidden rounded px-2 py-1 text-left text-body-sm hover:ring-1 hover:ring-primary/40">{body}</button>
                            : <div className="relative flex items-center gap-2 overflow-hidden rounded px-2 py-1 text-body-sm">{body}</div>}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </div>
          )}
          <div>
            <div className="mb-1.5 text-caption text-muted">{d.count > d.postings.length ? `Most recently seen ${d.postings.length} of ${d.count} postings` : 'Postings'}</div>
            {d.postings.length ? (
              <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                {d.postings.map((p) => (
                  <li key={p.id}>
                    <Link to={`/jobs/${p.id}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-body-sm hover:bg-surface-2">
                      <span className="font-medium">{p.title}</span><span className="text-muted">— {p.company}</span>{p.isDemo && <DemoBadge />}
                      <span className="ml-auto flex flex-wrap gap-1 text-caption text-muted">{[p.seniority, p.market, p.workMode].filter(Boolean).map((t, i) => <Pill key={i}>{t}</Pill>)}{p.status !== 'active' && <Pill tone="yellow">{p.status}</Pill>}<span>seen {p.daysSinceSeen}d ago</span></span>
                    </Link>
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 pb-2 text-caption text-muted">
                      <span>{p.originSite ?? p.source ?? 'Source unknown'}</span>
                      {p.url ? <WebsiteLink url={p.url}>Open original posting</WebsiteLink> : <span>{p.isDemo ? 'Fictional demo posting' : 'Original posting URL unavailable'}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <p className="text-body-sm text-muted">No postings.</p>}
          </div>
        </div>
      )}
    </Modal>
  );
}
