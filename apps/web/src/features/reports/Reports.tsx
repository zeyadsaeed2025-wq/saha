import { Download, FileBarChart2, Filter, TrendingUp } from 'lucide-react';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Badge, Button, Card, CardHead, EmptyState, Input, PageHead, Select, Skeleton, StatusBadge, useAsync } from '../../components/ui.js';
import { api, downloadCsv } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { useToast } from '../../lib/toast.js';
import { formatDuration } from '../../lib/format.js';
import type { Member, MemberReport, ReportSummary, SessionReportRow, TeamStat, TrendPoint, Workspace } from '../../types.js';

const back = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

export function Reports() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const canExport = me?.role === 'org_admin' || me?.role === 'super_admin';
  const [filters, setFilters] = useState({ from: back(29), to: back(0), team: '', role: '', memberId: '', status: '', workspaceId: '' });
  const [tab, setTab] = useState<'members' | 'sessions'>('members');
  const set = (key: keyof typeof filters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  const query = Object.entries(filters).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');

  const { data, loading, error } = useAsync(async () => {
    const [summary, members, sessions, memberList, workspaces] = await Promise.all([
      api<{ summary: ReportSummary; teams: TeamStat[]; trend: TrendPoint[] }>(`/orgs/${orgId}/reports/summary?${query}`),
      api<{ members: MemberReport[] }>(`/orgs/${orgId}/reports/members?${query}`),
      api<{ sessions: SessionReportRow[] }>(`/orgs/${orgId}/reports/sessions?${query}`),
      api<{ members: Member[] }>(`/orgs/${orgId}/members`),
      api<{ workspaces: Workspace[] }>(`/orgs/${orgId}/workspaces`),
    ]);
    return { ...summary, members, sessions, memberList, workspaces };
  }, [orgId, query]);

  const exportCsv = async () => {
    try {
      await downloadCsv(`/orgs/${orgId}/reports/export.csv?${query}`, `saha-attendance-${filters.from}-${filters.to}.csv`);
      notify(t('saved'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : 'Export failed', 'error'); }
  };

  if (loading) return <div className="stack"><Skeleton height={90} />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={140} />)}</div>;
  if (error || !data) return <div className="error-banner">{error ?? t('loading')}</div>;

  const s = data.summary;
  const cards = [
    { label: t('expected'), value: s.expected, tone: 'primary' },
    { label: t('present'), value: s.present, tone: 'success' },
    { label: t('late'), value: s.late, tone: 'warning' },
    { label: t('absentCount'), value: s.absent, tone: 'danger' },
    { label: t('excused'), value: s.excused, tone: 'info' },
    { label: t('pending'), value: s.pendingReview, tone: 'accent' },
    { label: t('confirmedTime'), value: s.confirmedConnectedLabel, tone: 'primary' },
    { label: t('punctuality'), value: `${s.punctualityRate}%`, tone: 'success' },
  ];
  const tooltipStyle = { borderRadius: 10, border: '1px solid var(--border)', fontSize: 12 };
  const teams = [...new Set(data.memberList.members.map((m) => m.team))];

  return (
    <div className="rise">
      <PageHead title={t('reportsTitle')} subtitle={t('reportsSub')} actions={
        canExport && <Button variant="primary" icon={<Download size={16} />} onClick={exportCsv}>{t('exportCsv')}</Button>
      } />

      <Card className="card-body" style={{ marginBottom: 20 }}>
        <div className="toolbar" style={{ margin: 0 }}>
          <Filter size={16} className="muted" />
          <Input type="date" value={filters.from} onChange={(e) => set('from', e.target.value)} dir="ltr" />
          <Input type="date" value={filters.to} onChange={(e) => set('to', e.target.value)} dir="ltr" />
          <Select value={filters.team} onChange={(e) => set('team', e.target.value)} aria-label={t('team')}>
            <option value="">{t('all')} · {t('team')}</option>
            {teams.map((team) => <option key={team} value={team}>{team}</option>)}
          </Select>
          <Select value={filters.role} onChange={(e) => set('role', e.target.value)} aria-label={t('role')}>
            <option value="">{t('all')} · {t('role')}</option>
            {['org_admin', 'mentor', 'student'].map((role) => <option key={role} value={role}>{role}</option>)}
          </Select>
          <Select value={filters.memberId} onChange={(e) => set('memberId', e.target.value)} aria-label={t('member')}>
            <option value="">{t('all')} · {t('member')}</option>
            {data.memberList.members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
          </Select>
          <Select value={filters.status} onChange={(e) => set('status', e.target.value)} aria-label={t('status')}>
            <option value="">{t('all')} · {t('status')}</option>
            {['on_time', 'late', 'absent', 'partial', 'excused', 'pending_review'].map((key) =>
              <option key={key} value={key}>{t(`status_${key}`)}</option>)}
          </Select>
          <Select value={filters.workspaceId} onChange={(e) => set('workspaceId', e.target.value)} aria-label={t('workspace')}>
            <option value="">{t('all')} · {t('workspace')}</option>
            {data.workspaces.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </Select>
          <Button size="sm" onClick={() => setFilters({ from: back(29), to: back(0), team: '', role: '', memberId: '', status: '', workspaceId: '' })}>
            {t('refresh')}
          </Button>
        </div>
      </Card>

      <div className="grid grid-4" style={{ marginBottom: 20 }}>
        {cards.map((card) => <Card className="stat-card" key={card.label}>
          <div className="stat-card__label">{card.label}</div>
          <div className="stat-card__value" style={{ color: `var(--${card.tone})` }}>{card.value}</div>
        </Card>)}
      </div>

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <Card className="chart-card">
          <CardHead title={t('byTeam')} subtitle={t('punctuality')} />
          <div style={{ height: 220, marginTop: 16 }}>
            {data.teams.length ? <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.teams}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="team" tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="punctualityRate" fill="var(--primary)" radius={[6, 6, 0, 0]} name={t('punctuality')} />
              </BarChart>
            </ResponsiveContainer> : <EmptyState title={t('noReports')} />}
          </div>
        </Card>
        <Card className="chart-card">
          <CardHead title={t('trend')} subtitle={`${filters.from} — ${filters.to}`} icon={<TrendingUp size={16} />} />
          <div style={{ height: 220, marginTop: 16 }}>
            {data.trend.length ? <ResponsiveContainer width="100%" height="100%">
              <LineChart data={data.trend}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
                <XAxis dataKey="day" tickFormatter={(v: string) => v.slice(5)} tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                <YAxis tick={{ fontSize: 10, fill: 'var(--muted)' }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Line type="monotone" dataKey="total" stroke="var(--primary)" strokeWidth={2} dot={false} name={t('expected')} />
                <Line type="monotone" dataKey="onTime" stroke="var(--success)" strokeWidth={2} dot={false} name={t('onTime')} />
              </LineChart>
            </ResponsiveContainer> : <EmptyState title={t('noReports')} />}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title={t('membersReport')} action={<div className="tabs">
          <button className={`tab ${tab === 'members' ? 'active' : ''}`} onClick={() => setTab('members')}>{t('members')}</button>
          <button className={`tab ${tab === 'sessions' ? 'active' : ''}`} onClick={() => setTab('sessions')}>{t('sessions')}</button>
        </div>} />
        <div className="table-wrap"><table className="table">
          <thead>{tab === 'members' ? <tr><th>{t('member')}</th><th>{t('team')}</th><th>{t('scheduledVsAttended')}</th>
            <th className="numeric">{t('punctuality')}</th><th className="numeric">{t('confirmedTime')}</th><th className="numeric">{t('lateness')}</th></tr>
            : <tr><th>{t('date')}</th><th>{t('member')}</th><th>{t('ruleTitle')}</th><th>{t('status')}</th>
              <th className="numeric">{t('confirmedTime')}</th><th className="numeric">{t('earlyLeave')}</th></tr>}</thead>
          <tbody>
            {tab === 'members' ? data.members.members.map((m) => (
              <tr key={m.userId}>
                <td className="cell-strong">{m.memberName}<div className="small muted">{m.role}</div></td>
                <td>{m.team}</td>
                <td className="mono">{m.attended}/{m.scheduled}</td>
                <td className="numeric"><Badge tone={m.punctualityRate >= 80 ? 'success' : m.punctualityRate >= 50 ? 'warning' : 'danger'}>{m.punctualityRate}%</Badge></td>
                <td className="numeric mono">{m.connectedLabel}</td>
                <td className="numeric mono">{Math.round(m.latenessSeconds / 60)}m</td>
              </tr>
            )) : data.sessions.sessions.map((row) => (
              <tr key={row.id}>
                <td className="mono small">{row.day}</td>
                <td className="cell-strong">{row.memberName}<div className="small muted">{row.team}</div></td>
                <td>{row.title}</td>
                <td><StatusBadge status={row.status} /></td>
                <td className="numeric mono">{formatDuration(row.connectedSeconds)}</td>
                <td className="numeric mono">{Math.round(row.earlyLeaveSeconds / 60)}m</td>
              </tr>
            ))}
            {((tab === 'members' && !data.members.members.length) || (tab === 'sessions' && !data.sessions.sessions.length)) &&
              <tr><td colSpan={6}><EmptyState icon={<FileBarChart2 size={22} />} title={t('noReports')} description={t('noDataHint')} /></td></tr>}
          </tbody>
        </table></div>
        <div className="pagination">
          <span>{tab === 'members' ? data.members.members.length : data.sessions.sessions.length} {t('all').toLowerCase()}</span>
          <span className="small">CSV · UTF-8 · {t('verifiedOnly')}</span>
        </div>
      </Card>
    </div>
  );
}
