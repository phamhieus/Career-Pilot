import { useQueryClient } from '@tanstack/react-query';
import {
  BookOpenCheck, Briefcase, ChartLine, ClipboardCheck, Compass, FileText, GraduationCap, LayoutDashboard, LogOut, Menu, Mic,
  Moon, Network, Settings, Sun, Target, User, X,
} from 'lucide-react';
import { Suspense, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import { api } from '../lib/api';
import { useMe, useMeta, useTheme } from '../lib/hooks';
import { GuideBar, SidebarGuide } from './Guide';
import { cx, Loading, Pill } from './ui';

const NAV: { group: string; items: { to: string; label: string; icon: ReactNode; badge?: string }[] }[] = [
  { group: '', items: [{ to: '/dashboard', label: 'Dashboard', icon: <LayoutDashboard className="size-4" /> }] },
  { group: 'Explore', items: [
    { to: '/atlas', label: 'Career Atlas', icon: <Compass className="size-4" /> },
    { to: '/career-map', label: 'Career Map', icon: <Network className="size-4" /> },
    { to: '/market', label: 'Job Market', icon: <ChartLine className="size-4" /> },
  ] },
  { group: 'You', items: [
    { to: '/profile', label: 'Profile & Skills', icon: <User className="size-4" /> },
    { to: '/matching', label: 'Role Matching', icon: <Target className="size-4" /> },
  ] },
  { group: 'Grow', items: [
    { to: '/learning', label: 'Learning Plan', icon: <GraduationCap className="size-4" /> },
    { to: '/assessments', label: 'Assessments', icon: <ClipboardCheck className="size-4" /> },
    { to: '/interviews', label: 'Mock Interviews', icon: <Mic className="size-4" />, badge: 'Voice' },
  ] },
  { group: 'Apply', items: [
    { to: '/jobs', label: 'Jobs', icon: <Briefcase className="size-4" /> },
    { to: '/resume', label: 'CV Builder', icon: <FileText className="size-4" /> },
    { to: '/applications', label: 'Applications', icon: <BookOpenCheck className="size-4" /> },
  ] },
];

export function Logo() {
  return (
    <div className="flex items-center gap-2">
      <svg viewBox="0 0 32 32" className="size-7" aria-hidden><rect width="32" height="32" rx="8" fill="var(--cp-primary)" /><path d="M9 21l7-11 7 11" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /><circle cx="16" cy="22" r="2.2" fill="#ffb110" /></svg>
      <span className="font-display text-[17px] font-bold tracking-tight">CareerPilot</span>
    </div>
  );
}

const navCls = (active: boolean) => cx('flex min-h-10 items-center gap-3 rounded-[10px] px-3 text-body-sm transition-colors duration-200', active ? 'bg-primary-soft font-semibold text-primary-ink' : 'font-medium text-muted hover:bg-black/[0.04] hover:text-ink dark:hover:bg-white/5');

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <nav aria-label="Main" className="flex h-full flex-col gap-5 overflow-y-auto px-3 py-5">
      <div className="px-3"><Logo /></div>
      <SidebarGuide onNavigate={onNavigate} />
      {NAV.map((g) => (
        <div key={g.group || 'root'} className="flex flex-col gap-0.5">
          {g.group && <div className="px-3 pb-1 text-caption font-semibold uppercase tracking-wider text-muted">{g.group}</div>}
          {g.items.map((it) => (
            <NavLink key={it.to} to={it.to} onClick={onNavigate} className={({ isActive }) => navCls(isActive)}>
              {it.icon}<span className="flex-1">{it.label}</span>
              {it.badge && <span className="rounded-full bg-accent-soft px-2 py-0.5 text-[11px] font-bold uppercase text-accent-ink">{it.badge}</span>}
            </NavLink>
          ))}
        </div>
      ))}
      <div className="mt-auto">
        <NavLink to="/settings" onClick={onNavigate} className={({ isActive }) => navCls(isActive)}>
          <Settings className="size-4" />Settings
        </NavLink>
      </div>
    </nav>
  );
}

export function AppShell() {
  const [open, setOpen] = useState(false);
  const { theme, setTheme } = useTheme();
  const me = useMe();
  const meta = useMeta();
  const qc = useQueryClient();
  const loc = useLocation();
  const fullBleed = loc.pathname.startsWith('/roadmap') || loc.pathname.startsWith('/career-map');
  const logout = async () => {
    await api.post('/auth/logout');
    qc.clear();
    window.location.href = '/';
  };
  const dark = theme === 'dark' || (theme === 'system' && document.documentElement.dataset.theme === 'dark');
  return (
    <div className="flex min-h-screen">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-surface focus:px-3 focus:py-2">Skip to content</a>
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 border-r border-line lg:block"><Sidebar /></aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-black/30 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-64 bg-canvas" onClick={(e) => e.stopPropagation()}><Sidebar onNavigate={() => setOpen(false)} /></aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line bg-canvas/90 px-4 backdrop-blur md:px-8">
          <button className="rounded-md p-1.5 lg:hidden" aria-label={open ? 'Close menu' : 'Open menu'} onClick={() => setOpen(!open)}>{open ? <X className="size-5" /> : <Menu className="size-5" />}</button>
          <div className="lg:hidden"><Logo /></div>
          <div className="ml-auto flex items-center gap-2">
            {meta.data && (
              <NavLink to="/settings" title="AI provider settings">{meta.data.ai.configured
                ? <Pill tone="blue">AI<span className="hidden sm:inline">: {meta.data.ai.provider} · {meta.data.ai.model}</span></Pill>
                : <Pill tone="yellow">Heuristic<span className="hidden sm:inline"> mode · add AI key</span></Pill>}</NavLink>
            )}
            <button aria-label="Toggle dark mode" onClick={() => setTheme(dark ? 'light' : 'dark')} className="rounded-md p-2 text-muted transition-colors hover:text-ink">{dark ? <Sun className="size-4" /> : <Moon className="size-4" />}</button>
            {me.data && (
              <div className="flex items-center gap-2">
                <span className="hidden size-8 items-center justify-center rounded-full border-2 border-signal-blue bg-surface text-caption font-semibold sm:flex" aria-hidden>{me.data.displayName.slice(0, 1).toUpperCase()}</span>
                <button onClick={logout} aria-label="Sign out" className="rounded-md p-2 text-muted hover:text-ink"><LogOut className="size-4" /></button>
              </div>
            )}
          </div>
        </header>
        <GuideBar />
        <main id="main" className={cx('w-full flex-1', fullBleed ? 'px-4 py-6 md:px-8' : 'mx-auto max-w-[1240px] px-4 py-8 md:px-8 md:py-10')}>
          <Suspense fallback={<Loading rows={4} />}><Outlet /></Suspense>
        </main>
      </div>
    </div>
  );
}

