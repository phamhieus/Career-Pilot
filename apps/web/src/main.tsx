import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { lazy, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import { AppShell } from './components/Layout';
import { Loading } from './components/ui';
import { ApiError } from './lib/api';
import { useMe } from './lib/hooks';
import Landing from './pages/Landing';
import './index.css';

const Dashboard = lazy(() => import('./pages/Dashboard'));
const Welcome = lazy(() => import('./pages/Welcome'));
const Atlas = lazy(() => import('./pages/Atlas'));
const RoleDetail = lazy(() => import('./pages/RoleDetail'));
const CareerMap = lazy(() => import('./pages/CareerMap'));
const Roadmap = lazy(() => import('./pages/Roadmap'));
const Profile = lazy(() => import('./pages/Profile'));
const Matching = lazy(() => import('./pages/Matching'));
const Jobs = lazy(() => import('./pages/Jobs'));
const JobDetail = lazy(() => import('./pages/JobDetail'));
const Market = lazy(() => import('./pages/Market'));
const Assessments = lazy(() => import('./pages/Assessments'));
const AssessmentAttempt = lazy(() => import('./pages/AssessmentAttempt'));
const Learning = lazy(() => import('./pages/Learning'));
const LearningPlan = lazy(() => import('./pages/LearningPlan'));
const Interviews = lazy(() => import('./pages/Interviews'));
const InterviewNew = lazy(() => import('./pages/InterviewNew'));
const InterviewSession = lazy(() => import('./pages/InterviewSession'));
const Resumes = lazy(() => import('./pages/Resumes'));
const ResumeEditor = lazy(() => import('./pages/ResumeEditor'));
const Applications = lazy(() => import('./pages/Applications'));
const ApplicationDetail = lazy(() => import('./pages/ApplicationDetail'));
const SettingsPage = lazy(() => import('./pages/Settings'));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, e) => !(e instanceof ApiError && e.status < 500) && n < 2, refetchOnWindowFocus: false, staleTime: 15_000 },
  },
});

function Gate() {
  const me = useMe();
  if (me.isLoading) return <div className="mx-auto max-w-3xl p-10"><Loading /></div>;
  if (!me.data) return <Landing />;
  return <AppShell />;
}

const router = createBrowserRouter([
  {
    path: '/',
    element: <Gate />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <Dashboard /> },
      { path: 'welcome', element: <Welcome /> },
      { path: 'atlas', element: <Atlas /> },
      { path: 'atlas/:roleSlug', element: <RoleDetail /> },
      { path: 'career-map', element: <CareerMap /> },
      { path: 'roadmap/:roleSlug', element: <Roadmap /> },
      { path: 'profile', element: <Profile /> },
      { path: 'matching', element: <Matching /> },
      { path: 'jobs', element: <Jobs /> },
      { path: 'jobs/:id', element: <JobDetail /> },
      { path: 'market', element: <Market /> },
      { path: 'assessments', element: <Assessments /> },
      { path: 'assessments/attempts/:id', element: <AssessmentAttempt /> },
      { path: 'learning', element: <Learning /> },
      { path: 'learning/:planId', element: <LearningPlan /> },
      { path: 'interviews', element: <Interviews /> },
      { path: 'interviews/new', element: <InterviewNew /> },
      { path: 'interviews/:id', element: <InterviewSession /> },
      { path: 'resume', element: <Resumes /> },
      { path: 'resume/:id', element: <ResumeEditor /> },
      { path: 'applications', element: <Applications /> },
      { path: 'applications/:id', element: <ApplicationDetail /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: '*', element: <Navigate to="/dashboard" replace /> },
    ],
  },
]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
