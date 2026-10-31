import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, RefreshCw, Sparkles } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router';
import { api } from '../lib/api';
import { AiMetaNote, Card, Loading } from './ui';

interface SuggestionsResponse {
  suggestions: { title: string; detail: string; link?: string }[];
  meta: { mode: string; provider: string; model?: string | null; fallbackReason?: string };
}

/** AI-phrased next steps grounded in platform facts; falls back to rule-based suggestions (labeled). */
export function AiSuggestions({ url, title = 'AI suggestions' }: { url: string; title?: string }) {
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const q = useQuery({ queryKey: ['suggestions', url], queryFn: () => api.get<SuggestionsResponse>(url), staleTime: 10 * 60_000 });
  const refresh = async () => {
    setRefreshing(true);
    try { qc.setQueryData(['suggestions', url], await api.get<SuggestionsResponse>(`${url}?refresh=true`)); } finally { setRefreshing(false); }
  };
  return (
    <Card>
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="size-4 text-marigold" />
        <span className="font-semibold">{title}</span>
        <button onClick={refresh} disabled={refreshing || q.isLoading} aria-label="Refresh suggestions" className="ml-auto rounded-md p-1 text-muted hover:text-ink disabled:opacity-40"><RefreshCw className={refreshing ? 'size-4 animate-spin' : 'size-4'} /></button>
      </div>
      {q.isLoading ? <Loading rows={2} /> : q.error ? <p className="text-body-sm text-muted">Suggestions are unavailable right now.</p> : (
        <>
          <ul className="flex flex-col gap-3">
            {q.data!.suggestions.map((s) => (
              <li key={s.title} className="flex items-start gap-2">
                <ArrowRight className="mt-0.5 size-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-body-sm font-medium">{s.link ? <Link to={s.link} className="hover:text-primary">{s.title}</Link> : s.title}</div>
                  <div className="text-caption text-ink-2">{s.detail}</div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3"><AiMetaNote meta={q.data!.meta} /></div>
        </>
      )}
    </Card>
  );
}
