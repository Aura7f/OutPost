import { lazy, Suspense, useEffect } from 'react';
import { Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from '@/components/app-shell';
import {
  FullScreenLoader,
  ProtectedRoute,
  RedirectIfAuthenticated,
  RequireTeam,
} from '@/components/route-guards';

const LandingPage = lazy(() =>
  import('@/pages/landing').then((module) => ({ default: module.LandingPage })),
);
const LoginPage = lazy(() =>
  import('@/pages/auth/login').then((module) => ({ default: module.LoginPage })),
);
const SignupPage = lazy(() =>
  import('@/pages/auth/signup').then((module) => ({ default: module.SignupPage })),
);
const ForgotPasswordPage = lazy(() =>
  import('@/pages/auth/forgot-password').then((module) => ({
    default: module.ForgotPasswordPage,
  })),
);
const ResetPasswordPage = lazy(() =>
  import('@/pages/auth/reset-password').then((module) => ({
    default: module.ResetPasswordPage,
  })),
);
const AuthCallbackPage = lazy(() =>
  import('@/pages/auth/callback').then((module) => ({ default: module.AuthCallbackPage })),
);
const VerifyEmailPage = lazy(() =>
  import('@/pages/auth/verify-email').then((module) => ({ default: module.VerifyEmailPage })),
);
const OnboardingPage = lazy(() =>
  import('@/pages/onboarding').then((module) => ({ default: module.OnboardingPage })),
);
const AcceptInvitationPage = lazy(() =>
  import('@/pages/accept-invitation').then((module) => ({
    default: module.AcceptInvitationPage,
  })),
);
const SharedReportPage = lazy(() =>
  import('@/pages/shared-report').then((module) => ({ default: module.SharedReportPage })),
);
const NotFoundPage = lazy(() =>
  import('@/pages/not-found').then((module) => ({ default: module.NotFoundPage })),
);

const OverviewPage = lazy(() =>
  import('@/pages/overview').then((module) => ({ default: module.OverviewPage })),
);
const ProjectsPage = lazy(() =>
  import('@/pages/projects').then((module) => ({ default: module.ProjectsPage })),
);
const ProjectDetailPage = lazy(() =>
  import('@/pages/project-detail').then((module) => ({ default: module.ProjectDetailPage })),
);
const MonitorsPage = lazy(() =>
  import('@/pages/monitors').then((module) => ({ default: module.MonitorsPage })),
);
const MonitorDetailPage = lazy(() =>
  import('@/pages/monitor-detail').then((module) => ({ default: module.MonitorDetailPage })),
);
const ErrorsPage = lazy(() =>
  import('@/pages/errors').then((module) => ({ default: module.ErrorsPage })),
);
const ErrorDetailPage = lazy(() =>
  import('@/pages/error-detail').then((module) => ({ default: module.ErrorDetailPage })),
);
const IncidentsPage = lazy(() =>
  import('@/pages/incidents').then((module) => ({ default: module.IncidentsPage })),
);
const IncidentDetailPage = lazy(() =>
  import('@/pages/incident-detail').then((module) => ({ default: module.IncidentDetailPage })),
);
const DatabasesPage = lazy(() =>
  import('@/pages/databases').then((module) => ({ default: module.DatabasesPage })),
);
const HeartbeatPage = lazy(() =>
  import('@/pages/heartbeat').then((module) => ({ default: module.HeartbeatPage })),
);
const IntegrationsPage = lazy(() =>
  import('@/pages/integrations').then((module) => ({ default: module.IntegrationsPage })),
);
const ReportsPage = lazy(() =>
  import('@/pages/reports').then((module) => ({ default: module.ReportsPage })),
);
const ReportDetailPage = lazy(() =>
  import('@/pages/report-detail').then((module) => ({ default: module.ReportDetailPage })),
);
const AlertsPage = lazy(() =>
  import('@/pages/alerts').then((module) => ({ default: module.AlertsPage })),
);
const TeamPage = lazy(() => import('@/pages/team').then((module) => ({ default: module.TeamPage })));
const SettingsPage = lazy(() =>
  import('@/pages/settings').then((module) => ({ default: module.SettingsPage })),
);

function ScrollToTop() {
  const { pathname } = useLocation();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return null;
}

export function App() {
  return (
    <>
      <ScrollToTop />
      <Suspense fallback={<FullScreenLoader label="Loading page" />}>
        <Routes>
          {/* Public marketing and authentication */}
          <Route path="/" element={<LandingPage />} />
          <Route
            path="/login"
            element={
              <RedirectIfAuthenticated>
                <LoginPage />
              </RedirectIfAuthenticated>
            }
          />
          <Route
            path="/signup"
            element={
              <RedirectIfAuthenticated>
                <SignupPage />
              </RedirectIfAuthenticated>
            }
          />
          <Route
            path="/forgot-password"
            element={
              <RedirectIfAuthenticated>
                <ForgotPasswordPage />
              </RedirectIfAuthenticated>
            }
          />
          {/* Recovery links establish a session before this screen, so it stays public. */}
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/invitations/:token" element={<AcceptInvitationPage />} />
          <Route path="/share/reports/:token" element={<SharedReportPage />} />

          {/* Authenticated but not necessarily attached to a workspace */}
          <Route
            path="/onboarding"
            element={
              <ProtectedRoute>
                <OnboardingPage />
              </ProtectedRoute>
            }
          />

          {/* Workspace application */}
          <Route
            element={
              <ProtectedRoute>
                <RequireTeam>
                  <AppShell />
                </RequireTeam>
              </ProtectedRoute>
            }
          >
            <Route path="/overview" element={<OverviewPage />} />
            <Route path="/projects" element={<ProjectsPage />} />
            <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
            <Route path="/monitors" element={<MonitorsPage />} />
            <Route path="/monitors/:monitorId" element={<MonitorDetailPage />} />
            <Route path="/errors" element={<ErrorsPage />} />
            <Route path="/errors/:groupId" element={<ErrorDetailPage />} />
            <Route path="/incidents" element={<IncidentsPage />} />
            <Route path="/incidents/:incidentId" element={<IncidentDetailPage />} />
            <Route path="/databases" element={<DatabasesPage />} />
            <Route path="/heartbeat" element={<HeartbeatPage />} />
            <Route path="/integrations" element={<IntegrationsPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/reports/:reportId" element={<ReportDetailPage />} />
            <Route path="/alerts" element={<AlertsPage />} />
            <Route path="/team" element={<TeamPage />} />
            <Route path="/settings" element={<SettingsPage />} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </Suspense>
    </>
  );
}
