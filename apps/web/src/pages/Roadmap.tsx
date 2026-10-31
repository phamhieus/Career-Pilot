import { useQuery } from '@tanstack/react-query';
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { BookOpen, ClipboardCheck, ExternalLink, FolderKanban, Lightbulb, Lock, ShieldCheck } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Button, ButtonLink, Card, cx, Drawer, ErrorState, Loading, Notice, PageHeader, Pill, SkillStatusPill } from '../components/ui';
import { api } from '../lib/api';
import { useAction } from '../lib/hooks';
import type { Resource } from '../lib/types';

interface RNode {
  key: string; type: 'skill' | 'concept' | 'project' | 'assessment' | 'group'; label: string; group: string | null; skillSlug: string | null; description: string; learningOutcome: string;
  estimatedHours: number; practiceTask: string; verificationMethod: string; x: number; y: number; resources: Resource[];
  status: 'not_started' | 'learning' | 'assessment_required' | 'app_verified' | 'completed'; prerequisites: string[]; locked: boolean;
  requirement: { level: number; critical: boolean } | null; gap: boolean; evidence: { status: string; proficiency: number | null; reason: string } | null;
  tasks: { id: number; title: string; status: string; type: string }[];
}
interface RoadmapData { role: { slug: string; name: string }; roadmap: { title: string; description: string; curated: boolean }; planId: number | null; nodes: RNode[]; edges: { from: string; to: string }[] }

const STATUS = {
  not_started: { label: 'Not started', cls: 'border-line bg-surface', dot: 'bg-black/20 dark:bg-white/30' },
  learning: { label: 'Learning', cls: 'border-marigold bg-marigold/10', dot: 'bg-marigold' },
  assessment_required: { label: 'Assessment required', cls: 'border-signal-blue bg-sky-tint dark:bg-primary-soft', dot: 'bg-signal-blue' },
  app_verified: { label: 'App-verified', cls: 'border-teal bg-teal/10', dot: 'bg-teal' },
  completed: { label: 'Completed', cls: 'border-mocha bg-mocha/10', dot: 'bg-mocha' },
} as const;
const TYPE_ICON = { skill: null, concept: <Lightbulb className="size-3.5" />, project: <FolderKanban className="size-3.5" />, assessment: <ClipboardCheck className="size-3.5" />, group: null };

type NodeData = { n: RNode; highlightGaps: boolean; dim: boolean; groupCount?: number };
function RoadmapNode({ data }: NodeProps<Node<NodeData>>) {
  const { n } = data;
  const st = STATUS[n.status];
  if (n.type === 'group') {
    return <div className="rounded-lg border-2 border-dashed border-signal-blue bg-surface px-4 py-2.5 text-body-sm font-semibold"><Handle type="target" position={Position.Left} className="!opacity-0" />{n.label}<span className="ml-2 text-caption font-normal text-muted">{data.groupCount} nodes · click to expand</span><Handle type="source" position={Position.Right} className="!opacity-0" /></div>;
  }
  return (
    <div className={cx('w-[230px] rounded-lg border px-3 py-2 transition-all duration-200', st.cls, data.dim && 'opacity-30', data.highlightGaps && n.gap && 'ring-2 ring-coral/60', n.type === 'project' && 'border-dashed')}>
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-black/30" />
      <div className="flex items-center gap-1.5">
        <span className={cx('size-2 shrink-0 rounded-full', st.dot)} />
        {TYPE_ICON[n.type]}
        <span className="truncate text-body-sm font-medium">{n.label}</span>
        {n.locked && n.status === 'not_started' && <Lock className="ml-auto size-3 shrink-0 text-faint" />}
        {n.status === 'app_verified' && <ShieldCheck className="ml-auto size-3.5 shrink-0 text-teal" />}
      </div>
      <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted">
        <span>{n.type}</span><span>· ~{Math.round(n.estimatedHours)}h</span>{n.requirement?.critical && <span className="font-medium text-vermillion">· critical</span>}
      </div>
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-black/30" />
    </div>
  );
}
const nodeTypes = { rm: RoadmapNode };

export default function Roadmap() {
  const { roleSlug } = useParams();
  const navigate = useNavigate();
  const q = useQuery({ queryKey: ['roadmap', roleSlug], queryFn: () => api.get<RoadmapData>(`/roadmaps/${roleSlug}`) });
  const [selected, setSelected] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [highlightGaps, setHighlightGaps] = useState(true);
  const startAssessment = useAction((body: object) => api.post<{ id: number }>('/assessments/blueprints', body).then((bp) => api.post<{ id: number }>(`/assessments/blueprints/${bp.id}/attempts`)), [['assessments']], (a) => navigate(`/assessments/attempts/${a.id}`));

  const groups = useMemo(() => [...new Set((q.data?.nodes ?? []).map((n) => n.group).filter(Boolean) as string[])], [q.data]);
  const sel = q.data?.nodes.find((n) => n.key === selected) ?? null;
  const prereqChain = useMemo(() => {
    if (!sel || !q.data) return new Set<string>();
    const s = new Set<string>([sel.key]);
    const stack = [...sel.prerequisites];
    while (stack.length) { const k = stack.pop()!; if (s.has(k)) continue; s.add(k); stack.push(...(q.data.nodes.find((n) => n.key === k)?.prerequisites ?? [])); }
    return s;
  }, [sel, q.data]);

  const { nodes, edges } = useMemo(() => {
    if (!q.data) return { nodes: [], edges: [] };
    const groupOf = new Map(q.data.nodes.map((n) => [n.key, n.group]));
    const visibleKey = (k: string) => (collapsed.has(groupOf.get(k) ?? '') ? `group:${groupOf.get(k)}` : k);
    const nodes: Node<NodeData>[] = [];
    for (const n of q.data.nodes) if (!collapsed.has(n.group ?? '')) nodes.push({ id: n.key, type: 'rm', position: { x: n.x, y: n.y }, data: { n, highlightGaps, dim: !!sel && !prereqChain.has(n.key) } });
    for (const g of collapsed) {
      const members = q.data.nodes.filter((n) => n.group === g);
      if (!members.length) continue;
      nodes.push({ id: `group:${g}`, type: 'rm', position: { x: members.reduce((s, n) => s + n.x, 0) / members.length, y: members.reduce((s, n) => s + n.y, 0) / members.length }, data: { n: { ...members[0], key: `group:${g}`, type: 'group', label: g.replace(/-/g, ' ') }, highlightGaps, dim: false, groupCount: members.length } });
    }
    const seen = new Set<string>();
    const edges: Edge[] = [];
    for (const e of q.data.edges) {
      const s = visibleKey(e.from), t = visibleKey(e.to);
      if (s === t || seen.has(`${s}>${t}`)) continue;
      seen.add(`${s}>${t}`);
      const onChain = !!sel && prereqChain.has(e.from) && prereqChain.has(e.to);
      edges.push({ id: `${s}>${t}`, source: s, target: t, markerEnd: { type: MarkerType.ArrowClosed }, style: { stroke: onChain ? '#0075de' : undefined, strokeWidth: onChain ? 2 : 1, opacity: sel && !onChain ? 0.25 : 1 } });
    }
    return { nodes, edges };
  }, [q.data, collapsed, highlightGaps, sel, prereqChain]);

  if (q.isLoading) return <Loading rows={5} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data!;
  const counts = Object.keys(STATUS).map((s) => ({ s, n: d.nodes.filter((n) => n.status === s).length }));

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader eyebrow={<Link to={`/atlas/${d.role.slug}`} className="hover:text-ink">{d.role.name}</Link>} title={d.roadmap.title} subtitle={d.roadmap.description} actions={d.planId ? <ButtonLink to={`/learning/${d.planId}`} variant="primary">Open my learning plan</ButtonLink> : <ButtonLink to={`/learning?role=${d.role.slug}`} variant="primary">Create a plan from this roadmap</ButtonLink>} />
      {!d.roadmap.curated && <Notice tone="warn" className="mb-4">This roadmap is auto-generated from the role’s skill matrix and the prerequisite graph; it has not been hand-curated yet.</Notice>}
      <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2">
        {counts.map(({ s, n }) => <span key={s} className="inline-flex items-center gap-1.5 text-caption"><span className={cx('size-2 rounded-full', STATUS[s as keyof typeof STATUS].dot)} />{STATUS[s as keyof typeof STATUS].label} ({n})</span>)}
        <label className="ml-auto inline-flex items-center gap-2 text-caption"><input type="checkbox" checked={highlightGaps} onChange={(e) => setHighlightGaps(e.target.checked)} />Highlight required-skill gaps</label>
      </div>
      <div className="mb-3 flex flex-wrap gap-1.5" aria-label="Groups">
        {groups.map((g) => (
          <button key={g} onClick={() => setCollapsed((c) => { const n = new Set(c); if (n.has(g)) n.delete(g); else n.add(g); return n; })} className={cx('rounded-full px-3 py-1 text-caption font-medium transition-colors', collapsed.has(g) ? 'bg-black/[0.05] text-muted dark:bg-white/10' : 'bg-sky-tint text-[#005bb0] dark:bg-primary-soft dark:text-primary')}>
            {collapsed.has(g) ? '+ ' : '− '}{g.replace(/-/g, ' ')}
          </button>
        ))}
      </div>
      <Card padded={false} className="h-[70vh] overflow-hidden">
        <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.2} nodesConnectable={false} proOptions={{ hideAttribution: true }}
          onNodeClick={(_, n) => { if (n.id.startsWith('group:')) setCollapsed((c) => { const x = new Set(c); x.delete(n.id.slice(6)); return x; }); else setSelected(n.id); }}
          onPaneClick={() => setSelected(null)}>
          <Background gap={24} size={1} color="var(--cp-line)" />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable bgColor="var(--cp-surface)" maskColor="rgba(127,127,127,0.12)" nodeColor={(n) => ({ app_verified: '#0f8a7e', assessment_required: '#097fe8', learning: '#ffb110', completed: '#b18164' } as Record<string, string>)[(n.data as NodeData).n.status] ?? '#d4d4d4'} />
        </ReactFlow>
      </Card>

      <Drawer open={!!sel} onClose={() => setSelected(null)} title={sel?.label}>
        {sel && (
          <div className="flex flex-col gap-5 text-body-sm">
            <div className="flex flex-wrap gap-1.5">
              <Pill>{sel.type}</Pill><Pill tone={sel.status === 'app_verified' ? 'green' : sel.status === 'assessment_required' ? 'blue' : sel.status === 'learning' ? 'yellow' : 'neutral'}>{STATUS[sel.status].label}</Pill>
              {sel.requirement && <Pill tone={sel.requirement.critical ? 'red' : 'neutral'}>{sel.requirement.critical ? 'Critical · ' : ''}level {sel.requirement.level} required</Pill>}
              <Pill>~{Math.round(sel.estimatedHours)} h</Pill>
            </div>
            <p className="text-ink-2">{sel.description}</p>
            {sel.locked && <Notice tone="warn">Prerequisites not yet satisfied: {sel.prerequisites.map((p) => d.nodes.find((n) => n.key === p)?.label ?? p).join(', ')}.</Notice>}
            <div><div className="mb-1 font-semibold">Learning outcome</div><p>{sel.learningOutcome}</p></div>
            <div><div className="mb-1 font-semibold">Practice task</div><p>{sel.practiceTask}</p></div>
            <div><div className="mb-1 font-semibold">Verification</div><p className="text-ink-2">{sel.verificationMethod}</p></div>
            {sel.evidence && <div><div className="mb-1 font-semibold">Your evidence</div><div className="flex items-center gap-2"><SkillStatusPill status={sel.evidence.status} />{sel.evidence.proficiency != null && <span className="text-caption">level {sel.evidence.proficiency}</span>}</div><p className="mt-1 text-caption text-muted">{sel.evidence.reason}</p></div>}
            <div>
              <div className="mb-1 font-semibold">Resources</div>
              {sel.resources.length === 0 ? <p className="text-muted">No curated resource yet for this node.</p> : (
                <ul className="flex flex-col gap-2">{sel.resources.map((r) => <li key={r.id}><a href={r.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline"><BookOpen className="size-3.5" />{r.title}<ExternalLink className="size-3" /></a><div className="text-caption text-muted">{r.provider} · {r.type}{r.free ? ' · free' : ' · paid'}{r.estimatedHours ? ` · ~${r.estimatedHours}h` : ''}</div></li>)}</ul>
              )}
            </div>
            {sel.tasks.length > 0 && <div><div className="mb-1 font-semibold">Plan tasks</div><ul className="flex flex-col gap-1">{sel.tasks.map((t) => <li key={t.id} className="flex items-center justify-between gap-2"><span className={t.status === 'done' || t.status === 'skipped' ? 'text-muted line-through' : ''}>{t.title}</span><Pill>{t.status}</Pill></li>)}</ul></div>}
            {(sel.type === 'skill' || sel.type === 'assessment') && (
              <Button variant="primary" loading={startAssessment.isPending} onClick={() => startAssessment.mutate(sel.type === 'skill' ? { skillSlugs: [sel.skillSlug], level: sel.requirement?.level ?? 3 } : { roleSlug: d.role.slug, roadmapNodeKey: sel.key })}>
                <ClipboardCheck className="size-4" />{sel.type === 'skill' ? 'Assess this skill' : 'Start checkpoint'}
              </Button>
            )}
            {startAssessment.error && <p className="text-vermillion">{(startAssessment.error as Error).message}</p>}
          </div>
        )}
      </Drawer>
    </div>
  );
}
