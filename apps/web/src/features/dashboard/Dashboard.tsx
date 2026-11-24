import {
  ArrowRight, CalendarPlus, ClipboardCheck, Clock3, Gauge, Monitor, Users, UserCheck,
} from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Button, Card, CardHead, EmptyState, PageHead, Progress, Skeleton, StatusBadge, useAsync } from '../../components/ui.js';
import { PageError, PageLoading } from '../../components/PageStates.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import type { AttendanceRow, Member, ReportSummary, TeamStat, TrendPoint, Workspace } from '../../types.js';

const today = () => new Date().toISOString().slice(0, 10);
const daysBack = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

export function Dashboard() {
  const { t } = useI18n();
  const { me } = useAuth();
  const navigate = useNavigate();
  const orgId = me?.activeOrgId ?? '';
  const query = `?from=${daysBack(13)}&to=${today()}`;

  const { data, loading, error } = useAsync(async () => {
    const [summary, members, workspaces, attendance, presence] = await Promise.all([
      api<{ summary: ReportSummary; teams: TeamStat[]; trend: TrendPoint[] }>(`/orgs/${orgId}/reports/summary${query}`),
      api<{ members: Member[] }>(`/orgs/${orgId}/members`),
      api<{ workspaces: Workspace[] }>(`/orgs/${orgId}/workspaces`),
      api<{ sessions: AttendanceRow[] }>(`/orgs/${orgId}/attendance?from=${daysBack(1)}&to=${today()}`),
      api<{ online: Array<{ userId: string; name: string; roomName: string }> }>(`/orgs/${orgId}/world/presence`),
    ]);
    return { ...summary, members, workspaces, attendance, presence };
  }, [orgId]);

  if (loading) return <PageLoading />;
  if (error || !data) return <PageError message={error ?? t('loading')} />;

  const s = data.summary;
  const stats = [
    { label: t('expected'), value: s.expected, icon: <CalendarPlus size={19} />, tone: 'var(--primary)', foot: `${data.members.members.length} ${t('members').toLowerCase()}` },
    { label: t('present'), value: s.present, icon: <UserCheck size={19} />, tone: 'var(--success)', foot: `${s.onTime} ${t('onTime')}` },
    { label: t('punctuality'), value: `${s.punctualityRate}%`, icon: <Gauge size={19} />, tone: 'var(--info)', foot: `${s.late} ${t('late')}` },
    { label: t('confirmedTime'), value: s.confirmedConnectedLabel, icon: <Clock3 size={19} />, tone: 'var(--accent)', foot: `${data.presence.online.length} ${t('online')}` },
  ];

  const tooltipStyle = { borderRadius: 10, border: '1px solid var(--border)', fontSize: 12, boxShadow: 'var(--shadow-md)' };

  return (
    <div className="rise">
      <PageHead title={t('dashboard')} subtitle={t('dashSub')} actions={
        <>
          <Button icon={<Monitor size={16} />} onClick={() => navigate('/app/office')}>{t('openOffice')}</Button>
          <Button variant="primary" icon={<CalendarPlus size={16} />} onClick={() => navigate('/app/schedules')}>{t('newSchedule')}</Button>
        </>
      } />
      {me?.organization?.settings?.demo && <div className="info-banner" style={{ marginBottom: 20 }}>
        <ClipboardCheck size={16} />{t('demoData')} — {t('demoDataHint')}.
      </div>}

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        {stats.map((stat) => (
          <Card className="stat-card" key={stat.label}>
            <div className="stat-card__top">
              <div className="stat-card__icon" style={{ color: stat.tone, background: `${stat.tone}18` }}>{stat.icon}</div>
              <span className="small muted">{stat.foot}</span>
            </div>
            <div className="stat-card__value">{stat.value}</div>
            <div className="stat-card__label">{stat.label}</div>
          </Card>
        ))}
      </div>

      <div className="grid grid-32">
        <div className="stack">
          <Card className="chart-card">
            <CardHead title={t('trend')} subtitle={`${daysBack(13)} — ${today()}`} />
            <div style={{ height: 220, marginTop: 18 }}>
              {data.trend.length ? <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={data.trend} margin={{ left: -20, right: 8, top: 8 }}>
                  <defs><linearGradient id="grad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.32} />
                    <stop offset="100%" stopColor="var(--primary)" stopOpacity={0.02} />
                  </linearGradient></defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: 'var(--muted)' }} tickFormatter={(v: string) => v.slice(5)} />
                  <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} allowDecimals={false} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Area type="monotone" dataKey="total" stroke="var(--primary)" fill="url(#grad)" strokeWidth={2} name={t('expected')} />
                  <Area type="monotone" dataKey="onTime" stroke="var(--success)" fill="transparent" strokeWidth={2} name={t('onTime')} />
                </AreaChart>
              </ResponsiveContainer> : <EmptyState icon={<Gauge size={22} />} title={t('noReports')} description={t('noDataHint')} />}
            </div>
          </Card>

          <Card>
            <CardHead title={t('recentActivity')} subtitle={t('attSub')} action={
              <button className="btn btn-ghost btn-sm" onClick={() => navigate('/app/attendance')}>{t('view')} <ArrowRight size={14} /></button>} />
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>{t('member')}</th><th>{t('status')}</th><th>{t('confirmedTime')}</th><th>{t('date')}</th></tr></thead>
                <tbody>
                  {data.attendance.sessions.slice(0, 6).map((row) => (
                    <tr key={row.id}>
                      <td className="cell-strong">{row.memberName}<div className="small muted">{row.team}</div></td>
                      <td><StatusBadge status={row.status} /></td>
                      <td className="numeric mono">{Math.round(row.confirmedConnectedSeconds / 60)} min</td>
                      <td className="small muted mono">{row.scheduled?.startsAt?.slice(0, 10) ?? '—'}</td>
                    </tr>
                  ))}
                  {!data.attendance.sessions.length && <tr><td colSpan={4}><EmptyState title={t('noActivity')} description={t('presenceNote')} /></td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>

        <div className="stack">
          <Card className="chart-card">
            <CardHead title={t('teamPulse')} subtitle={t('scheduledVsAttended')} />
            <div style={{ height: 190, marginTop: 12 }}>
              {data.teams.length ? <ResponsiveContainer width="100%" height="100%">
                <BarChart data={data.teams} layout="vertical" margin={{ left: 0, right: 16 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                  <YAxis type="category" dataKey="team" width={80} tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                  <Tooltip contentStyle={tooltipStyle} />
                  <Bar dataKey="punctualityRate" fill="var(--primary)" radius={[0, 6, 6, 0]} name={t('punctuality')} />
                </BarChart>
              </ResponsiveContainer> : <EmptyState title={t('noData')} />}
            </div>
          </Card>

          <Card>
            <CardHead title={t('liveNow')} subtitle={t('presenceNote')} action={<span className="badge badge-success">{data.presence.online.length}</span>} />
            <div className="card-body" style={{ paddingTop: 8 }}>
              <div className="row" style={{ marginBottom: 10 }}><Users size={16} className="muted" /><span className="small muted">{data.members.members.length} {t('members').toLowerCase()}</span></div>
              {data.presence.online.length ? data.presence.online.map((p) => (
                <div key={p.userId} className="presence-item">
                  <span className="avatar sm" style={{ background: '#0e7c7b' }}>{p.name[0]}</span>
                  <div><div className="presence-item__name">{p.name}</div><div className="presence-item__room">{p.roomName}</div></div>
                  <span className="badge badge-success" style={{ marginInlineStart: 'auto' }}>{t('online')}</span>
                </div>
              )) : <EmptyState icon={<Users size={22} />} title={t('noActivity')} description={t('officeSub')}
                action={<Button size="sm" onClick={() => navigate('/app/office')}>{t('openOffice')}</Button>} />}
              <div className="divider" />
              <div className="small muted">{t('workspaces')}: {data.workspaces.workspaces.length}</div>
              <div style={{ marginTop: 8 }}><Progress value={s.punctualityRate} /></div>
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
}
