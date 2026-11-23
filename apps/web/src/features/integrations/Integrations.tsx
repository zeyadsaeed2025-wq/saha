import {
  Activity, AlertTriangle, CalendarDays, CheckCircle2, Globe2, HardDrive, KeyRound, Link2, Mail, MessageSquare, Users,
} from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardHead, EmptyState, Input, PageHead, Skeleton, useAsync } from '../../components/ui.js';
import { api, ApiError } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { IntegrationConnection } from '../../types.js';

interface PrepareResult {
  provider: string; authorizationUrl?: string; state?: string; ready?: boolean; message?: string;
}
interface PublicApiStatus { configured: boolean; message: string | null }

type Provider = IntegrationConnection['provider'];

const registry: Array<{ provider: Provider; icon: typeof Link2 }> = [
  { provider: 'google_drive', icon: HardDrive },
  { provider: 'google_calendar', icon: CalendarDays },
  { provider: 'outlook', icon: Mail },
  { provider: 'slack', icon: MessageSquare },
  { provider: 'teams', icon: Users },
  { provider: 'webhook', icon: Activity },
  { provider: 'public_api', icon: Globe2 },
];

const failMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

const statusTone = (status: string): 'success' | 'warning' | 'danger' | 'muted' =>
  status === 'connected' ? 'success' : status === 'expired' || status === 'error' ? 'danger' : 'muted';

export function Integrations() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const manageable = can(me?.role, 'integration:manage');

  const [busyProvider, setBusyProvider] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<Record<string, PrepareResult>>({});

  const { data, loading, error, reload, setData } = useAsync(async () => {
    const [integrationResult, publicApiResult] = await Promise.all([
      api<{ integrations: IntegrationConnection[] }>(`/orgs/${orgId}/integrations`),
      api<PublicApiStatus>(`/orgs/${orgId}/integrations/public-api/status`),
    ]);
    return { integrations: integrationResult.integrations, publicApi: publicApiResult };
  }, [orgId]);

  const prepare = async (provider: Provider) => {
    setBusyProvider(provider);
    try {
      const result = await api<PrepareResult>(`/orgs/${orgId}/integrations/${provider}/prepare`, { method: 'POST' });
      setPrepared((current) => ({ ...current, [provider]: result }));
      notify(result.message ?? t('prepareConnection'), 'success');
      await reload();
    } catch (err) {
      const unavailable = err instanceof ApiError && err.status === 503;
      notify(`${unavailable ? `${t('providerNotConfigured')} — ` : ''}${failMessage(err, t('prepareConnection'))}`, 'error');
    } finally { setBusyProvider(null); }
  };

  const disconnect = async (provider: Provider) => {
    setBusyProvider(provider);
    try {
      const result = await api<{ integration: IntegrationConnection }>(
        `/orgs/${orgId}/integrations/${provider}/disconnect`, { method: 'POST' },
      );
      setData((current) => current ? {
        ...current,
        integrations: current.integrations.map((item) => item.provider === provider ? result.integration : item),
      } : current);
      setPrepared((current) => {
        const next = { ...current };
        delete next[provider];
        return next;
      });
      notify(t('disconnectDrive'), 'success');
    } catch (err) { notify(failMessage(err, t('disconnectDrive')), 'error'); }
    finally { setBusyProvider(null); }
  };

  if (loading) return <div className="stack"><Skeleton height={90} />{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} height={72} />)}</div>;
  if (error || !data) return <div className="error-banner">{error ?? t('loading')}</div>;

  const byProvider = new Map(data.integrations.map((item) => [item.provider, item]));
  const webhook = byProvider.get('webhook');
  const dateLabel = (iso: string | null) => iso ? new Date(iso).toLocaleString() : '—';
  const statusLabel = (status: string) => status === 'expired' ? t('expired') : t(`status_${status}`);

  return (
    <div className="rise">
      <PageHead title={t('integrations')} subtitle={t('integrationsSub')} />

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <Card>
          <CardHead title={t('webhookStatus')} subtitle={t('integrationRegistry')} icon={<Activity size={18} />} />
          <div className="card-body stack" style={{ gap: 8 }}>
            <div className="row row-wrap" style={{ gap: 8 }}>
              <Badge tone={webhook?.status === 'connected' ? 'success' : 'warning'}>
                {statusLabel(webhook?.status ?? 'not_connected')}
              </Badge>
              {webhook?.connectedAt && <span className="small muted">{dateLabel(webhook.connectedAt)}</span>}
            </div>
            {webhook?.lastError && <div className="error-banner">{webhook.lastError}</div>}
            {!webhook && <div className="small muted">{t('notConfigured')} · {t('providerNotConfigured')}</div>}
          </div>
        </Card>
        <Card>
          <CardHead title={t('publicApiStatus')} subtitle={t('integrationStatus')} icon={<Globe2 size={18} />} />
          <div className="card-body stack" style={{ gap: 8 }}>
            <div className="row row-wrap" style={{ gap: 8 }}>
              <Badge tone={data.publicApi.configured ? 'success' : 'warning'}>
                {data.publicApi.configured ? t('configured') : t('notConfigured')}
              </Badge>
              {!data.publicApi.configured && <AlertTriangle size={15} />}
            </div>
            {data.publicApi.message && <div className="small muted">{data.publicApi.message}</div>}
          </div>
        </Card>
      </div>

      <Card>
        <CardHead title={t('integrationRegistry')} subtitle={`${registry.length}`} icon={<Link2 size={18} />} />
        <div className="grid grid-2 card-body">
          {registry.map(({ provider, icon: Icon }) => {
            const connection = byProvider.get(provider);
            const connected = connection?.status === 'connected';
            const result = prepared[provider];
            return (
              <div key={provider} className="panel" style={{ padding: 16 }}>
                <div className="row" style={{ justifyContent: 'space-between', gap: 8 }}>
                  <div className="row" style={{ gap: 8 }}><Icon size={18} /><span className="strong">{provider}</span></div>
                  <Badge tone={statusTone(connection?.status ?? 'not_connected')}>
                    {statusLabel(connection?.status ?? 'not_connected')}
                  </Badge>
                </div>
                <div className="divider" />
                <div className="stack" style={{ gap: 6 }}>
                  <div className="small muted">
                    {t('status')}: {connected ? t('configured') : t('notConfigured')}
                    {connection?.connectedAt ? ` · ${dateLabel(connection.connectedAt)}` : ''}
                  </div>
                  <div className="small muted">
                    Scopes: {connection?.scopes?.length ? connection.scopes.join(', ') : '—'}
                  </div>
                  {connection?.lastError && <div className="small" style={{ color: 'var(--danger)' }}>{connection.lastError}</div>}
                  {result?.authorizationUrl && <Input readOnly value={result.authorizationUrl} dir="ltr"
                    aria-label={`${provider} authorization URL`}
                    onFocus={(event) => event.currentTarget.select()} />}
                  {result && !result.authorizationUrl && result.message &&
                    <div className="small muted">{result.message}</div>}
                  {manageable && <div className="row row-wrap" style={{ gap: 6 }}>
                    <Button size="sm" icon={<KeyRound size={14} />} loading={busyProvider === provider}
                      onClick={() => void prepare(provider)}>{t('prepareConnection')}</Button>
                    <Button size="sm" variant="danger" loading={busyProvider === provider}
                      disabled={!connection || connection.status === 'not_connected'}
                      onClick={() => void disconnect(provider)}>{t('disconnectDrive')}</Button>
                  </div>}
                </div>
              </div>
            );
          })}
          {!data.integrations.length && <div className="full">
            <EmptyState icon={<Link2 size={24} />} title={t('notConfigured')} description={t('providerNotConfigured')} />
          </div>}
        </div>
        {!data.publicApi.configured && <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="deferred-note"><CheckCircle2 size={15} style={{ flex: '0 0 auto' }} />
            <span>{t('providerNotConfigured')} — {t('integrationsSub')}</span>
          </div>
        </div>}
      </Card>
    </div>
  );
}
