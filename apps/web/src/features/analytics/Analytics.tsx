import { BarChart3, Clock3, Layers3, TrendingUp } from 'lucide-react';
import {
  Badge, Card, CardHead, EmptyState, PageHead, Progress, Skeleton, useAsync,
} from '../../components/ui.js';
import { PageError, PageLoading } from '../../components/PageStates.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import type { ComparisonData, MeetingAnalytics, PlanLimits, UtilizationWorkspace } from '../../types.js';

interface UsageRecord { metric: string; value: number; at: string }
interface UsageResponse {
  usage: UsageRecord[];
  entitlements: { limits: PlanLimits; usage: Record<string, number>; remaining: Record<string, number> };
}

export function Analytics() {
  const { t } = useI18n();
  const { me } = useAuth();
  const orgId = me?.activeOrgId ?? '';

  const { data, loading, error } = useAsync(async () => {
    const [utilization, meetings, comparisons, usage] = await Promise.all([
      api<{ workspaces: UtilizationWorkspace[] }>(`/orgs/${orgId}/analytics/utilization`),
      api<MeetingAnalytics>(`/orgs/${orgId}/analytics/meetings`),
      api<ComparisonData>(`/orgs/${orgId}/analytics/comparisons`),
      api<UsageResponse>(`/orgs/${orgId}/analytics/usage`),
    ]);
    return { ...utilization, ...meetings, ...comparisons, ...usage };
  }, [orgId]);

  if (loading) return <PageLoading />;
  if (error || !data) return <PageError message={error ?? t('loading')} />;

  const comparisonRows: Array<{ key: keyof ComparisonData['deltas']; label: string; suffix?: string }> = [
    { key: 'attendanceSessions', label: t('attendanceSessions') },
    { key: 'avgConnectedSeconds', label: t('confirmedTime'), suffix: 's' },
    { key: 'meetings', label: t('meetingCount') },
  ];

  const deltaText = (value: number) => `${value > 0 ? '+' : ''}${value}`;
  const deltaTone = (value: number) => value > 0 ? 'success' : value < 0 ? 'danger' : 'muted';

  const quotaKeys: Array<keyof PlanLimits> = ['members', 'rooms', 'workspaces', 'meetingsPerMonth'];

  return (
    <div className="rise">
      <PageHead title={t('analytics')} subtitle={t('analyticsSub')} />

      <Card style={{ marginBottom: 20 }}>
        <CardHead title={t('utilization')} subtitle={`${data.workspaces.length} ${t('workspaces').toLowerCase()}`}
          icon={<Layers3 size={16} />} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('workspace')}</th><th>{t('room')}</th><th className="numeric">{t('scheduledHours')}</th>
            <th className="numeric">{t('meetingCount')}</th><th className="numeric">{t('attendanceSessions')}</th></tr></thead>
          <tbody>
            {data.workspaces.map((workspace) => workspace.rooms.map((room) => (
              <tr key={room.id}>
                <td className="cell-strong">{workspace.name}</td>
                <td>{room.name}</td>
                <td className="numeric mono">{room.scheduledHours}</td>
                <td className="numeric mono">{room.meetingCount}</td>
                <td className="numeric mono">{room.attendanceSessions}</td>
              </tr>
            )))}
            {!data.workspaces.some((workspace) => workspace.rooms.length) && <tr><td colSpan={5}>
              <EmptyState icon={<Layers3 size={22} />} title={t('noAnalytics')} description={t('noDataHint')} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <CardHead title={t('meetingUsage')} icon={<BarChart3 size={16} />} />
        <div className="grid grid-4 card-body">
          <div className="stat-card panel"><div className="stat-card__label">{t('meetings')}</div>
            <div className="stat-card__value">{data.totals.meetings}</div></div>
          <div className="stat-card panel"><div className="stat-card__label">{t('status_live')}</div>
            <div className="stat-card__value">{data.totals.live}</div></div>
          <div className="stat-card panel"><div className="stat-card__label">{t('status_ended')}</div>
            <div className="stat-card__value">{data.totals.ended}</div></div>
          <div className="stat-card panel"><div className="stat-card__label">{t('confirmedTime')}</div>
            <div className="stat-card__value">{data.totals.minutes}<span className="small muted"> m</span></div></div>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('date')}</th><th className="numeric">{t('meetingCount')}</th>
            <th className="numeric">{t('confirmedTime')}</th></tr></thead>
          <tbody>
            {data.byDay.map((day) => (
              <tr key={day.day}>
                <td className="small mono">{day.day}</td>
                <td className="numeric mono">{day.count}</td>
                <td className="numeric mono">{day.minutes} m</td>
              </tr>
            ))}
            {!data.byDay.length && <tr><td colSpan={3}>
              <EmptyState icon={<Clock3 size={22} />} title={t('noAnalytics')} description={t('noMeetingsHint')} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <CardHead title={t('comparisons')} subtitle={`${t('currentPeriod')} / ${t('previousPeriod')}`}
          icon={<TrendingUp size={16} />} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('change')}</th><th className="numeric">{t('currentPeriod')}</th>
            <th className="numeric">{t('previousPeriod')}</th><th className="numeric">{t('change')}</th></tr></thead>
          <tbody>
            {comparisonRows.map((row) => {
              const current = data.current[row.key];
              const previous = data.previous[row.key];
              const delta = data.deltas[row.key];
              return <tr key={row.key}>
                <td className="cell-strong">{row.label}</td>
                <td className="numeric mono">{current}{row.suffix}</td>
                <td className="numeric mono">{previous}{row.suffix}</td>
                <td className="numeric"><Badge tone={deltaTone(delta)}>{deltaText(delta)}{row.suffix}</Badge></td>
              </tr>;
            })}
          </tbody>
        </table></div>
      </Card>

      <Card>
        <CardHead title={t('usageEvents')} subtitle={`${data.usage.length} ${t('all').toLowerCase()}`} />
        <div className="grid grid-2 card-body">
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('kind')}</th><th className="numeric">{t('usage')}</th><th>{t('date')}</th></tr></thead>
            <tbody>
              {data.usage.map((record, index) => (
                <tr key={`${record.metric}-${record.at}-${index}`}>
                  <td className="mono small">{record.metric}</td>
                  <td className="numeric mono">{record.value}</td>
                  <td className="small mono">{new Date(record.at).toLocaleString()}</td>
                </tr>
              ))}
              {!data.usage.length && <tr><td colSpan={3}>
                <EmptyState icon={<BarChart3 size={22} />} title={t('noAnalytics')} description={t('noDataHint')} />
              </td></tr>}
            </tbody>
          </table></div>
          <div className="stack" style={{ gap: 12 }}>
            {quotaKeys.map((key) => {
              const limit = data.entitlements.limits[key] ?? 0;
              const used = data.entitlements.usage[key] ?? 0;
              const left = data.entitlements.remaining[key] ?? 0;
              return <div key={key}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small strong">{key}</span>
                  <span className="small mono">{used} / {limit} <span className="muted">({t('remaining')}: {left})</span></span>
                </div>
                <Progress value={limit > 0 ? Math.min(100, (used / limit) * 100) : 0} />
              </div>;
            })}
          </div>
        </div>
      </Card>
    </div>
  );
}
