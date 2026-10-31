import { ExternalLink, ListVideo } from 'lucide-react';
import { useId, useState } from 'react';
import { parseYouTubeUrl } from '../lib/youtube';
import { Button, Input, Pill, Select } from './ui';

export interface YouTubeLearningSource { id: string; title: string; provider: string; url: string; sourceUrl?: string; language?: string }

export function YouTubeLearningPlayer({ sources, storageKey, label }: { sources: YouTubeLearningSource[]; storageKey: string; label: string }) {
  const fieldId = useId();
  const valid = sources.filter((s) => parseYouTubeUrl(s.url));
  const [selection, setSelection] = useState(() => {
    try { return JSON.parse(localStorage.getItem(storageKey) ?? 'null') as { id?: string; customUrl?: string } | null; } catch { return null; }
  });
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const selected = valid.find((s) => s.id === selection?.id) ?? valid[0];
  const custom = selection?.customUrl ? parseYouTubeUrl(selection.customUrl) : null;
  const embed = custom ?? (selected ? parseYouTubeUrl(selected.url) : null);
  const title = custom ? 'Your YouTube playlist or video' : selected?.title ?? label;
  const save = (next: { id?: string; customUrl?: string }) => {
    setSelection(next);
    try { localStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Playback still works without browser storage. */ }
  };
  return <div role="region" aria-label={`YouTube learning player for ${label}`} className="flex min-w-0 flex-col gap-3">
    {valid.length > 0 && <div><label htmlFor={fieldId} className="mb-1 block text-caption font-medium">Choose a course series for {label}</label><Select id={fieldId} value={custom ? 'custom' : selected?.id} onChange={(e) => { save({ id: e.target.value }); setError(''); }}>
      {custom && <option value="custom">Your selected YouTube playlist or video</option>}{valid.map((s) => <option key={s.id} value={s.id}>{s.title} — {s.provider}</option>)}
    </Select></div>}
    {embed && <>
      <div className="flex flex-wrap items-center gap-2 text-body-sm"><ListVideo className="size-4 text-primary" /><span className="font-medium">{title}</span><Pill tone="blue">{embed.kind === 'playlist' ? 'Series / playlist' : 'Video'}</Pill>{!custom && selected?.language && <Pill>{selected.language}</Pill>}</div>
      <iframe key={embed.embedUrl} src={embed.embedUrl} title={`YouTube ${embed.kind}: ${title}`} loading="lazy" referrerPolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowFullScreen className="aspect-video min-h-[200px] w-full rounded-lg border-0 bg-black" />
      <div className="flex flex-wrap items-center justify-between gap-2 text-caption"><span className="text-muted">{embed.kind === 'playlist' ? 'Use the playlist menu inside the player to choose a lesson and continue in order.' : 'Watch here, then apply the lesson in your practical task.'}</span><a href={embed.watchUrl} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 text-primary hover:underline">Open on YouTube<ExternalLink className="size-3" /></a></div>
      {!custom && selected?.sourceUrl && <a href={selected.sourceUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-caption text-primary hover:underline">Course source / outline<ExternalLink className="size-3" /></a>}
    </>}
    {!embed && <p className="text-caption text-muted">No series has been selected for this topic yet. Add a YouTube playlist below to watch it here.</p>}
    <details className="rounded-md border border-line p-3"><summary className="cursor-pointer text-caption font-medium text-primary">{embed ? 'Use another YouTube playlist or video' : 'Add a YouTube playlist or video'}</summary><div className="mt-3 flex flex-col gap-2">
      <label htmlFor={`${fieldId}-url`} className="text-caption">YouTube playlist or video URL</label><Input id={`${fieldId}-url`} type="url" placeholder="https://www.youtube.com/playlist?list=…" value={draft} onChange={(e) => { setDraft(e.target.value); setError(''); }} />
      <Button variant="ghost" className="self-start" disabled={!draft.trim()} onClick={() => { const parsed = parseYouTubeUrl(draft); if (!parsed) { setError('Enter a valid HTTPS YouTube playlist or video link.'); return; } save({ customUrl: parsed.watchUrl }); setDraft(''); setError(''); }}>Watch here</Button>
      {error && <p role="alert" className="text-caption text-vermillion">{error}</p>}
      <p className="text-caption text-muted">Your selection is remembered in this browser. Playback stays controlled by YouTube; if a publisher disables embedding, use “Open on YouTube”.</p>
    </div></details>
  </div>;
}
