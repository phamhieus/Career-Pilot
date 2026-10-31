import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api } from './api';

export interface Me { id: number; email: string; displayName: string }
export interface Meta {
  ai: { configured: boolean; provider: string; model: string | null };
  taskDimensions: { key: string; label: string; description: string }[];
  workValues: { key: string; label: string }[];
  skills: { slug: string; name: string; category: string }[];
  roles: { slug: string; name: string }[];
}

export const useMe = () => useQuery({ queryKey: ['me'], queryFn: () => api.get<{ user: Me | null }>('/auth/me').then((r) => r.user), staleTime: 60_000 });
export const useMeta = () => useQuery({ queryKey: ['meta'], queryFn: () => api.get<Meta>('/meta'), staleTime: 5 * 60_000 });

/** Mutation that invalidates the given query keys on success. */
export function useAction<TVars, TResult>(fn: (v: TVars) => Promise<TResult>, invalidate: QueryKey[] = [], onSuccess?: (r: TResult) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async (r) => {
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
      onSuccess?.(r);
    },
  });
}

export type Theme = 'light' | 'dark' | 'system';
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try { return (localStorage.getItem('cp-theme') as Theme) || 'system'; } catch { return 'system'; }
  });
  useEffect(() => {
    const apply = () => {
      const dark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
      document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    };
    apply();
    try { localStorage.setItem('cp-theme', theme); } catch { /* storage unavailable */ }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    mq.addEventListener('change', apply);
    return () => mq.removeEventListener('change', apply);
  }, [theme]);
  return { theme, setTheme };
}
