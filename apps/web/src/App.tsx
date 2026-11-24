import { Compass } from 'lucide-react';
import { lazy, Suspense, useEffect, type ReactNode } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { AppShell } from './components/AppShell.js';
import { EmptyState, Spinner } from './components/ui.js';
import { AccessRedeem, InvitationRedeem } from './features/auth/Redeem.js';
import { ForgotPassword, Login, Onboarding, Register } from './features/auth/AuthScreens.js';
import { Attendance } from './features/attendance/Attendance.js';
import { Invitations } from './features/invitations/Invitations.js';
import { Landing } from './features/landing/Landing.js';
import { Members } from './features/members/Members.js';
import { Schedules } from './features/schedules/Schedules.js';
import { Settings } from './features/settings/Settings.js';
import { useAuth } from './lib/auth.js';
import { useI18n } from './lib/i18n.js';
import { rememberReturnTo } from './lib/redirect.js';

const Dashboard = lazy(() => import('./features/dashboard/Dashboard.js').then((m) => ({ default: m.Dashboard })));
const VirtualOffice = lazy(() => import('./features/office/VirtualOffice.js').then((m) => ({ default: m.VirtualOffice })));
const Reports = lazy(() => import('./features/reports/Reports.js').then((m) => ({ default: m.Reports })));
const Teams = lazy(() => import('./features/teams/Teams.js').then((m) => ({ default: m.Teams })));
const Meetings = lazy(() => import('./features/meetings/Meetings.js').then((m) => ({ default: m.Meetings })));
const Recordings = lazy(() => import('./features/recordings/Recordings.js').then((m) => ({ default: m.Recordings })));
const Integrations = lazy(() => import('./features/integrations/Integrations.js').then((m) => ({ default: m.Integrations })));
const Billing = lazy(() => import('./features/billing/Billing.js').then((m) => ({ default: m.Billing })));
const Analytics = lazy(() => import('./features/analytics/Analytics.js').then((m) => ({ default: m.Analytics })));
const Messaging = lazy(() => import('./features/messaging/Messaging.js').then((m) => ({ default: m.Messaging })));
const NotificationsPage = lazy(() => import('./features/notifications/Notifications.js').then((m) => ({ default: m.Notifications })));
const AIInsights = lazy(() => import('./features/ai/AIInsights.js').then((m) => ({ default: m.AIInsights })));
const Admin = lazy(() => import('./features/admin/Admin.js').then((m) => ({ default: m.Admin })));
const Customization = lazy(() => import('./features/customization/Customization.js').then((m) => ({ default: m.Customization })));

function RequireAuth({ children }: { children: ReactNode }) {
  const { me, loading } = useAuth();
  const location = useLocation();
  useEffect(() => {
    if (!loading && !me) rememberReturnTo(`${location.pathname}${location.search}`);
  }, [loading, me, location.pathname, location.search]);
  if (loading) return <Spinner />;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function AppPage({ titleKey, children }: { titleKey: string; children: ReactNode }) {
  const { t } = useI18n();
  return <AppShell title={t(titleKey)}>{children}</AppShell>;
}

function SkipLink() {
  const { t } = useI18n();
  return <a className="skip-link" href="#main-content">{t('skipToContent')}</a>;
}

function PublicPage({ children }: { children: ReactNode }) {
  return <main id="main-content" className="public-main" tabIndex={-1}>{children}</main>;
}

function NotFound() {
  const { t } = useI18n();
  return (
    <div className="app-skeleton">
      <EmptyState icon={<Compass size={26} />} title={t('unknownRoute')} description={t('unknownRouteHint')}
        action={<Link to="/" className="btn btn-primary btn-sm">{t('backHome')}</Link>} />
    </div>
  );
}

export function App() {
  return (
    <>
    <SkipLink />
    <Suspense fallback={<div className="app-skeleton"><Spinner /></div>}>
    <Routes>
      <Route path="/" element={<PublicPage><Landing /></PublicPage>} />
      <Route path="/login" element={<PublicPage><Login /></PublicPage>} />
      <Route path="/register" element={<PublicPage><Register /></PublicPage>} />
      <Route path="/forgot-password" element={<PublicPage><ForgotPassword /></PublicPage>} />
      <Route path="/invite/:token" element={<PublicPage><InvitationRedeem /></PublicPage>} />
      <Route path="/access/:token" element={<PublicPage><AccessRedeem /></PublicPage>} />
      <Route path="/guest/:token" element={<PublicPage><AccessRedeem guest /></PublicPage>} />
      <Route path="/onboarding" element={<RequireAuth><PublicPage><Onboarding /></PublicPage></RequireAuth>} />
      <Route path="/app" element={<RequireAuth><AppPage titleKey="dashboard"><Dashboard /></AppPage></RequireAuth>} />
      <Route path="/app/office" element={<RequireAuth><AppPage titleKey="office"><VirtualOffice /></AppPage></RequireAuth>} />
      <Route path="/app/schedules" element={<RequireAuth><AppPage titleKey="schedules"><Schedules /></AppPage></RequireAuth>} />
      <Route path="/app/attendance" element={<RequireAuth><AppPage titleKey="attendance"><Attendance /></AppPage></RequireAuth>} />
      <Route path="/app/reports" element={<RequireAuth><AppPage titleKey="reports"><Reports /></AppPage></RequireAuth>} />
      <Route path="/app/members" element={<RequireAuth><AppPage titleKey="members"><Members /></AppPage></RequireAuth>} />
      <Route path="/app/invitations" element={<RequireAuth><AppPage titleKey="invitations"><Invitations /></AppPage></RequireAuth>} />
      <Route path="/app/teams" element={<RequireAuth><AppPage titleKey="teams"><Teams /></AppPage></RequireAuth>} />
      <Route path="/app/meetings" element={<RequireAuth><AppPage titleKey="meetings"><Meetings /></AppPage></RequireAuth>} />
      <Route path="/app/recordings" element={<RequireAuth><AppPage titleKey="recordings"><Recordings /></AppPage></RequireAuth>} />
      <Route path="/app/integrations" element={<RequireAuth><AppPage titleKey="integrations"><Integrations /></AppPage></RequireAuth>} />
      <Route path="/app/messaging" element={<RequireAuth><AppPage titleKey="messages"><Messaging /></AppPage></RequireAuth>} />
      <Route path="/app/notifications" element={<RequireAuth><AppPage titleKey="notifications"><NotificationsPage /></AppPage></RequireAuth>} />
      <Route path="/app/ai" element={<RequireAuth><AppPage titleKey="ai"><AIInsights /></AppPage></RequireAuth>} />
      <Route path="/app/billing" element={<RequireAuth><AppPage titleKey="billing"><Billing /></AppPage></RequireAuth>} />
      <Route path="/app/analytics" element={<RequireAuth><AppPage titleKey="analytics"><Analytics /></AppPage></RequireAuth>} />
      <Route path="/app/customization" element={<RequireAuth><AppPage titleKey="customization"><Customization /></AppPage></RequireAuth>} />
      <Route path="/app/admin" element={<RequireAuth><AppPage titleKey="admin"><Admin /></AppPage></RequireAuth>} />
      <Route path="/app/settings" element={<RequireAuth><AppPage titleKey="settings"><Settings /></AppPage></RequireAuth>} />
      <Route path="*" element={<PublicPage><NotFound /></PublicPage>} />
    </Routes>
    </Suspense>
    </>
  );
}
