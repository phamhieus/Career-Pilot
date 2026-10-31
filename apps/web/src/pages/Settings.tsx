import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, Eye, EyeOff, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { AccentCard, Button, Card, cx, ErrorState, Field, Input, Loading, Notice, PageHeader, Pill, Section, Tabs } from '../components/ui';
import { api, download } from '../lib/api';
import { useAction, useMe, useTheme, type Theme } from '../lib/hooks';

export default function Settings() {
  const me = useMe();
  const { theme, setTheme } = useTheme();
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState('');
  const [deleting, setDeleting] = useState(false);
  const del = async () => {
    setDeleting(true);
    await api.del('/me');
    qc.clear();
    window.location.href = '/';
  };
  return (
    <>
      <PageHeader eyebrow="Settings" title="Settings & privacy" />
      <Section title="Appearance"><Card><Tabs<Theme> value={theme} onChange={setTheme} items={[{ value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }, { value: 'system', label: 'System' }]} /></Card></Section>
      <Section title="AI provider" description="Used for mock interviews, rubric grading, CV/JD parsing, CV rewriting and suggestions. Your key is stored encrypted on the server and never sent back to the browser.">
        <AiProviderSettings />
      </Section>
      <Section title="Your data">
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <div className="mb-1 font-semibold">Export</div>
            <p className="mb-3 text-body-sm text-ink-2">Download your profile, evidence, assessments, interviews, plans, CVs and applications as JSON.</p>
            <Button variant="ghost" icon={<Download className="size-4" />} onClick={() => download('/me/export', 'careerpilot-data.json')}>Export my data</Button>
          </Card>
          <Card>
            <div className="mb-1 font-semibold">Voice & audio</div>
            <p className="text-body-sm text-ink-2">CareerPilot never uploads or stores audio. Dictation (browser speech recognition or tools like Wispr Flow) turns speech into text on your device; only the text answer is saved.</p>
          </Card>
        </div>
        <AccentCard tone="peach" className="mt-4">
          <div className="mb-1 font-semibold">Delete account</div>
          <p className="mb-3 text-body-sm">Permanently deletes your account and all personal data, including private job imports. This cannot be undone.</p>
          <div className="flex flex-col gap-2 md:flex-row md:items-end">
            <Field label={`Type ${me.data?.email ?? 'your email'} to confirm`} className="md:w-96"><Input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
            <Button variant="danger" icon={<Trash2 className="size-4" />} disabled={confirm !== me.data?.email} loading={deleting} onClick={del}>Delete everything</Button>
          </div>
        </AccentCard>
      </Section>
    </>
  );
}

interface AiSettings {
  source: 'user' | 'server' | 'none';
  user: { provider: string; model: string; baseUrl: string; keyHint: string; updatedAt: string } | null;
  server: { provider: string; model: string | null; configured: boolean };
  providers: { key: 'openai' | 'deepseek' | 'openai-compatible'; label: string; defaultBaseUrl: string; defaultModel: string; models: string[] }[];
}

function AiProviderSettings() {
  const q = useQuery({ queryKey: ['ai-settings'], queryFn: () => api.get<AiSettings>('/settings/ai') });
  const [form, setForm] = useState<{ provider: string; model: string; baseUrl: string; apiKey: string } | null>(null);
  const [showKey, setShowKey] = useState(false);
  const inv = [['ai-settings'], ['meta']];
  const save = useAction(() => api.put<AiSettings>('/settings/ai', { provider: f.provider, model: f.model || undefined, baseUrl: f.baseUrl || undefined, apiKey: f.apiKey || undefined }), inv, () => setForm((x) => (x ? { ...x, apiKey: '' } : x)));
  const test = useAction(() => api.post<{ ok: boolean; error?: string; provider: string; model: string | null; latencyMs: number }>('/settings/ai/test'), []);
  const remove = useAction(() => api.del<AiSettings>('/settings/ai'), inv, () => setForm(null));
  if (q.isLoading) return <Loading rows={2} />;
  if (q.error) return <ErrorState error={q.error} retry={q.refetch} />;
  const d = q.data!;
  const f = form ?? { provider: d.user?.provider ?? 'deepseek', model: d.user?.model ?? '', baseUrl: d.user?.baseUrl ?? '', apiKey: '' };
  const preset = d.providers.find((p) => p.key === f.provider)!;
  const set = (patch: Partial<typeof f>) => setForm({ ...f, ...patch });
  const effective = d.source === 'user' ? `${d.user!.provider} · ${d.user!.model}` : d.source === 'server' ? `${d.server.provider} · ${d.server.model} (server default)` : null;

  return (
    <Card>
      <div className="mb-5 flex flex-wrap items-center gap-2 text-body-sm">
        <span className="text-ink-2">Currently used:</span>
        {effective ? <Pill tone="blue">{effective}</Pill> : <Pill tone="yellow">None — heuristic mode</Pill>}
        {d.user && <span className="text-caption text-muted">your key {d.user.keyHint}</span>}
      </div>
      <form className="grid gap-4 md:grid-cols-2" onSubmit={(e) => { e.preventDefault(); save.mutate(undefined); }}>
        <fieldset className="md:col-span-2">
          <legend className="mb-1.5 text-body-sm font-medium">Provider</legend>
          <div role="radiogroup" aria-label="AI provider" className="grid gap-2 sm:grid-cols-3">
            {d.providers.map((p) => (
              <button type="button" role="radio" aria-checked={f.provider === p.key} key={p.key} onClick={() => set({ provider: p.key, model: '', baseUrl: '' })} className={cx('rounded-md border px-3 py-2.5 text-left text-body-sm transition-colors', f.provider === p.key ? 'border-primary bg-primary-soft font-medium' : 'border-line hover:border-primary/40')}>
                {p.label}
                {p.defaultModel && <div className="text-caption font-normal text-muted">default {p.defaultModel}</div>}
              </button>
            ))}
          </div>
        </fieldset>
        <Field label="API key" hint={d.user ? `Leave empty to keep your saved key (${d.user.keyHint}).` : f.provider === 'deepseek' ? 'Create one at platform.deepseek.com → API keys.' : f.provider === 'openai' ? 'Create one at platform.openai.com → API keys.' : 'Key for your OpenAI-compatible endpoint.'}>
          <div className="flex gap-2">
            <Input type={showKey ? 'text' : 'password'} autoComplete="off" spellCheck={false} placeholder={d.user ? d.user.keyHint : 'sk-…'} value={f.apiKey} onChange={(e) => set({ apiKey: e.target.value })} />
            <Button type="button" variant="text" aria-label={showKey ? 'Hide key' : 'Show key'} onClick={() => setShowKey(!showKey)}>{showKey ? <EyeOff className="size-4" /> : <Eye className="size-4" />}</Button>
          </div>
        </Field>
        <Field label="Model" hint={preset.defaultModel ? `Leave empty for ${preset.defaultModel}.` : 'Required for custom endpoints.'}>
          <Input list="ai-models" placeholder={preset.defaultModel || 'model-name'} value={f.model} onChange={(e) => set({ model: e.target.value })} />
          <datalist id="ai-models">{preset.models.map((m) => <option key={m} value={m} />)}</datalist>
        </Field>
        {f.provider === 'openai-compatible' && (
          <Field label="Base URL" hint="Public HTTPS endpoint ending in /v1 (requests go to …/chat/completions)." className="md:col-span-2">
            <Input type="url" placeholder="https://your-gateway.example.com/v1" value={f.baseUrl} onChange={(e) => set({ baseUrl: e.target.value })} />
          </Field>
        )}
        {(save.error || remove.error) && <p className="text-body-sm text-vermillion md:col-span-2">{((save.error || remove.error) as Error).message}</p>}
        {test.data && (
          <Notice tone={test.data.ok ? 'info' : 'warn'} className="md:col-span-2">
            {test.data.ok ? <>Connection works — {test.data.provider} · {test.data.model} responded in {test.data.latencyMs} ms.</> : <>Connection failed: {test.data.error}</>}
          </Notice>
        )}
        <div className="flex flex-wrap items-center justify-end gap-2 md:col-span-2">
          {save.isSuccess && !save.isPending && <span className="text-body-sm text-teal">Saved</span>}
          {d.user && <Button type="button" variant="danger" loading={remove.isPending} onClick={() => window.confirm('Remove your saved key and use the server default?') && remove.mutate(undefined)}>Remove my key</Button>}
          <Button type="button" variant="ghost" loading={test.isPending} disabled={d.source === 'none'} onClick={() => test.mutate(undefined)}>Test connection</Button>
          <Button type="submit" variant="primary" loading={save.isPending} disabled={!d.user && !f.apiKey}>Save</Button>
        </div>
      </form>
      <p className="mt-4 text-caption text-muted">AI handles language tasks only. Scores, verification rules, plan scheduling and permissions are computed by the backend. Requests are logged without their content. Usage is billed by your provider.</p>
    </Card>
  );
}
