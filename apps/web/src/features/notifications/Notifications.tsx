import { BellRing, ClipboardList, MailCheck } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardHead, EmptyState, PageHead, Skeleton, useAsync } from '../../components/ui.js';
import { PageError, PageLoading } from '../../components/PageStates.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { NotificationItem } from '../../types.js';

interface DeliveryLog {
  id: string; channel: string; type: string; status: string;
  provider: string | null; error: string | null; createdAt: string;
}

const statusTone: Record<string, 'success' | 'warning' | 'danger' | 'muted' | 'info'> = {
  sent: 'success', skipped: 'warning', failed: 'danger', pending: 'info',
};

export function Notifications() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const auditAdmin = can(me?.role, 'audit:read');
  const [busy, setBusy] = useState(false);

  const { data, loading, error, setData } = useAsync(async () => {
    const [list, unread, logs] = await Promise.all([
      api<{ notifications: NotificationItem[] }>(`/orgs/${orgId}/notifications`),
      api<{ count: number }>(`/orgs/${orgId}/notifications/unread-count`),
      auditAdmin ? api<{ logs: DeliveryLog[] }>(`/orgs/${orgId}/notifications/logs`) : Promise.resolve({ logs: [] as DeliveryLog[] }),
    ]);
    return { notifications: list.notifications, count: unread.count, logs: logs.logs };
  }, [orgId, auditAdmin]);

  const markRead = async (notification: NotificationItem) => {
    setBusy(true);
    try {
      const result = await api<{ notification: NotificationItem }>(
        `/orgs/${orgId}/notifications/${notification.id}/read`, { method: 'POST' });
      setData((current) => current ? {
        ...current,
        notifications: current.notifications.map((item) => item.id === result.notification.id ? result.notification : item),
        count: Math.max(0, current.count - (notification.readAt ? 0 : 1)),
      } : current);
      notify(t('saved'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  const markAll = async () => {
    setBusy(true);
    try {
      const result = await api<{ updated: number }>(`/orgs/${orgId}/notifications/read-all`, { method: 'POST' });
      const at = new Date().toISOString();
      setData((current) => current ? {
        ...current,
        notifications: current.notifications.map((item) => item.readAt ? item : { ...item, readAt: at }),
        count: 0,
      } : current);
      notify(`${t('markAllRead')}: ${result.updated}`, 'success');
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  const statusLabel = (status: string) => {
    const label = t(`status_${status}`);
    return label === `status_${status}` ? status : label;
  };

  if (loading) return <PageLoading />;
  if (error || !data) return <PageError message={error ?? t('loading')} />;

  return (
    <div className="rise">
      <PageHead title={t('notifications')} subtitle={t('notificationsSub')} actions={
        <div className="row" style={{ gap: 10 }}>
          <Badge tone={data.count ? 'primary' : 'muted'}>{t('unread')}: {data.count}</Badge>
          <Button size="sm" loading={busy} disabled={!data.count} onClick={markAll}>{t('markAllRead')}</Button>
        </div>
      } />

      <Card style={{ marginBottom: 20 }}>
        <CardHead title={t('notifications')} subtitle={`${data.notifications.length} ${t('all').toLowerCase()}`}
          icon={<BellRing size={16} />} />
        <div className="card-body stack" style={{ gap: 8 }}>
          {data.notifications.map((notification) => (
            <div key={notification.id} className="presence-item panel" style={{
              alignItems: 'flex-start',
              background: notification.readAt ? undefined : 'var(--info-soft)',
            }}>
              <span className="avatar sm" style={{ background: notification.readAt ? 'var(--muted)' : 'var(--info)' }}>
                <BellRing size={14} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="row row-wrap" style={{ gap: 8 }}>
                  <span className="strong">{notification.title}</span>
                  {!notification.readAt && <Badge tone="info" plain>{t('unread')}</Badge>}
                  <Badge tone="muted" plain>{notification.type}</Badge>
                </div>
                <div className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{notification.body}</div>
                <div className="small mono muted">{new Date(notification.createdAt).toLocaleString()}</div>
              </div>
              {!notification.readAt && <Button size="sm" loading={busy} onClick={() => markRead(notification)}>
                {t('markRead')}
              </Button>}
            </div>
          ))}
          {!data.notifications.length && <EmptyState icon={<MailCheck size={24} />} title={t('noNotifications')}
            description={t('noDataHint')} />}
        </div>
      </Card>

      {auditAdmin && <Card>
        <CardHead title={t('deliveryLogs')} subtitle={t('notificationLog')} icon={<ClipboardList size={16} />} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('date')}</th><th>{t('kind')}</th><th>{t('type')}</th><th>{t('status')}</th>
            <th>{t('notificationLog')}</th><th>{t('reason')}</th></tr></thead>
          <tbody>
            {data.logs.map((log) => (
              <tr key={log.id}>
                <td className="small mono">{new Date(log.createdAt).toLocaleString()}</td>
                <td><Badge tone="muted" plain>{log.channel === 'in_app' ? t('inApp') : log.channel}</Badge></td>
                <td className="small mono">{log.type}</td>
                <td><Badge tone={statusTone[log.status] ?? 'muted'}>
                  {log.status === 'skipped' ? t('skipped') : statusLabel(log.status)}
                </Badge></td>
                <td className="small mono">{log.provider ?? '—'}</td>
                <td className="small">{log.error ?? '—'}</td>
              </tr>
            ))}
            {!data.logs.length && <tr><td colSpan={6}>
              <EmptyState icon={<ClipboardList size={22} />} title={t('noData')} description={t('noDataHint')} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>}
    </div>
  );
}
