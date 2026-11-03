import { useQuery } from '@tanstack/react-query';
import { Background, Controls, Handle, MarkerType, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import { ButtonLink, Card, cx, Drawer, ErrorState, Loading, PageHeader, Pill } from '../components/ui';
import { api } from '../lib/api';

interface MapData {
  families: { slug: string; name: string }[];
  nodes: { slug: string; name: string; family: string }[];
  edges: { from: string; to: string; difficulty: number; typicalMonths: number; rationale: string; transferableSkills: string[] }[];
}
const FAMILY_COLORS = ['#097fe8', '#f64932', '#ffb110', '#62aef0', '#b18164', '#0f8a7e', '#e89d01', '#02093a', '#e32d14', '#6b7280', 'var(--cp-primary)'];
const DIFF_COLOR = ['', '#0f8a7e', '#62aef0', '#ffb110', '#f64932', '#e32d14'];
const DIFF = ['', 'Adjacent', 'Moderate', 'Significant', 'Major', 'Pivot'];

type RoleNodeData = { name: string; color: string; dim: boolean; selected: boolean; current: boolean };
function RoleNode({ data }: NodeProps<Node<RoleNodeData>>) {
  return (
    <div className={cx('rounded-full border bg-surface px-3.5 py-1.5 text-body-sm font-medium shadow-nav transition-opacity duration-200', data.dim && 'opacity-25', data.selected ? 'border-primary ring-2 ring-primary/30' : 'border-line')} style={{ borderLeft: `4px solid ${data.color}` }}>
      <Handle type="target" position={Position.Left} className="!opacity-0" />
      {data.name}{data.current && <span className="ml-1.5 text-caption text-primary">· you</span>}
      <Handle type="source" position={Position.Right} className="!opacity-0" />
    </div>
  );
}
function FamilyLabel({ data }: NodeProps<Node<RoleNodeData>>) {
  return <div className="w-[300px] text-caption font-semibold tracking-wider uppercase" style={{ color: data.color }}>{data.name}</div>;
}
const nodeTypes = { role: RoleNode, family: FamilyLabel };

export default function CareerMap() {
  const q = useQuery({ queryKey: ['career-map'], queryFn: () => api.get<MapData>('/career-map') });
  const profile = useQuery({ queryKey: ['profile'], queryFn: () => api.get<{ profile: { currentRoleSlug: string | null } }>('/profile') });
  const [selected, setSelected] = useState<string | null>(null);
  const current = profile.data?.profile.currentRoleSlug ?? null;

  const { nodes, edges } = useMemo(() => {
    if (!q.data) return { nodes: [], edges: [] };
    const focus = selected ?? null;
    const neighbors = new Set(focus ? q.data.edges.filter((e) => e.from === focus || e.to === focus).flatMap((e) => [e.from, e.to]) : []);
    const cols = 4;
    const famIndex = new Map(q.data.families.map((f, i) => [f.slug, i]));
    const nodes: Node<RoleNodeData>[] = [];
    for (const f of q.data.families) {
      const i = famIndex.get(f.slug)!;
      const roles = q.data.nodes.filter((n) => n.family === f.slug);
      const x0 = (i % cols) * 330;
      const y0 = Math.floor(i / cols) * 300;
      nodes.push({ id: `fam-${f.slug}`, type: 'family', position: { x: x0, y: y0 - 34 }, data: { name: f.name, color: FAMILY_COLORS[i], dim: false, selected: false, current: false }, draggable: false, selectable: false });
      roles.forEach((r, j) => nodes.push({ id: r.slug, type: 'role', position: { x: x0 + (j % 2) * 20, y: y0 + j * 46 }, data: { name: r.name, color: FAMILY_COLORS[i], dim: !!focus && !neighbors.has(r.slug), selected: focus === r.slug, current: current === r.slug } }));
    }
    const edges: Edge[] = q.data.edges.filter((e) => !focus || e.from === focus || e.to === focus).map((e) => ({
      id: `${e.from}-${e.to}`, source: e.from, target: e.to, animated: !!focus && e.from === focus,
      style: { stroke: DIFF_COLOR[e.difficulty], strokeWidth: focus ? 2 : 1, opacity: focus ? 1 : 0.35 },
      markerEnd: { type: MarkerType.ArrowClosed, color: DIFF_COLOR[e.difficulty] },
    }));
    return { nodes, edges };
  }, [q.data, selected, current]);

  const sel = q.data?.nodes.find((n) => n.slug === selected);
  const outgoing = q.data?.edges.filter((e) => e.from === selected) ?? [];
  const incoming = q.data?.edges.filter((e) => e.to === selected) ?? [];
  const name = (s: string) => q.data?.nodes.find((n) => n.slug === s)?.name ?? s;

  return (
    <div className="mx-auto max-w-[1440px]">
      <PageHeader eyebrow="Explore" title="Career" highlight="Map" subtitle="Roles are nodes; arrows are realistic transitions. Click a role to see adjacent moves, difficulty and transferable skills." actions={current && <button onClick={() => setSelected(current)} className="rounded-md bg-primary-soft px-[15px] py-[6px] text-body-sm font-medium text-primary">Focus my current role</button>} />
      <div className="mb-3 flex flex-wrap gap-2 text-caption">{[1, 2, 3, 4].map((d) => <span key={d} className="inline-flex items-center gap-1.5"><span className="h-0.5 w-5" style={{ background: DIFF_COLOR[d] }} />{DIFF[d]}</span>)}</div>
      {q.isLoading && <Loading />}
      {q.error && <ErrorState error={q.error} retry={q.refetch} />}
      {q.data && (
        <Card padded={false} className="h-[72vh] overflow-hidden">
          <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes} fitView minZoom={0.3} onNodeClick={(_, n) => !n.id.startsWith('fam-') && setSelected(n.id === selected ? null : n.id)} onPaneClick={() => setSelected(null)} nodesConnectable={false} proOptions={{ hideAttribution: true }}>
            <Background gap={24} size={1} color="var(--cp-line)" />
            <Controls showInteractive={false} />
            <MiniMap pannable zoomable bgColor="var(--cp-surface)" maskColor="rgba(127,127,127,0.12)" nodeColor={(n) => (n.data as RoleNodeData).color || 'transparent'} />
          </ReactFlow>
        </Card>
      )}
      <Drawer open={!!sel} onClose={() => setSelected(null)} title={sel?.name}>
        {sel && (
          <div className="flex flex-col gap-5">
            <div className="flex gap-2"><ButtonLink to={`/atlas/${sel.slug}`} variant="ghost">Role profile</ButtonLink><ButtonLink to={`/matching?role=${sel.slug}`} variant="text">My match</ButtonLink></div>
            <div>
              <div className="mb-2 text-body-sm font-medium text-muted">Can move to</div>
              {outgoing.length === 0 && <p className="text-body-sm text-muted">No mapped transitions.</p>}
              {outgoing.map((e) => (
                <div key={e.to} className="mb-3 border-b border-line pb-3 last:border-0">
                  <div className="flex items-center justify-between"><Link to={`/atlas/${e.to}`} className="font-medium text-primary">{name(e.to)}</Link><Pill>{DIFF[e.difficulty]} · ~{e.typicalMonths} mo</Pill></div>
                  <p className="mt-1 text-caption text-ink-2">{e.rationale}</p>
                  {e.transferableSkills.length > 0 && <div className="mt-2 flex flex-wrap gap-1">{e.transferableSkills.map((s) => <Pill key={s} tone="green">{s}</Pill>)}</div>}
                </div>
              ))}
            </div>
            <div>
              <div className="mb-2 text-body-sm font-medium text-muted">Common entry points</div>
              <div className="flex flex-wrap gap-1.5">{incoming.map((e) => <button key={e.from} onClick={() => setSelected(e.from)} className="rounded-full bg-black/[0.05] px-2.5 py-0.5 text-caption dark:bg-white/10">{name(e.from)}</button>)}</div>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
