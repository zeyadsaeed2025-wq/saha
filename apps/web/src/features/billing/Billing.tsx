import { Download, Info, ReceiptText, ShieldCheck } from 'lucide-react';
import { useState } from 'react';
import {
  Badge, Button, Card, CardHead, EmptyState, PageHead, Progress, Skeleton, useAsync,
} from '../../components/ui.js';
import { PageError, PageLoading } from '../../components/PageStates.js';
import { api, apiUrl } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { Entitlements, Invoice, Plan, Subscription } from '../../types.js';

interface BillingOverview {
  entitlements: Entitlements;
  subscription: Subscription | null;
  invoices: Invoice[];
}

const quotaKeys = ['members', 'rooms', 'workspaces', 'meetingsPerMonth'] as const;
type QuotaKey = typeof quotaKeys[number];

const statusTone: Record<string, 'success' | 'warning' | 'danger' | 'muted' | 'info'> = {
  active: 'success', trialing: 'success', past_due: 'warning', grace: 'warning', cancelled: 'muted',
};

export function Billing() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const manageable = can(me?.role, 'billing:manage');
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    const [overview, catalog, invoiceList] = await Promise.all([
      api<BillingOverview>(`/orgs/${orgId}/billing/overview`),
      api<{ plans: Plan[] }>(`/orgs/${orgId}/billing/plans`),
      api<{ invoices: Invoice[] }>(`/orgs/${orgId}/billing/invoices`),
    ]);
    return { ...overview, plans: catalog.plans, invoiceList: invoiceList.invoices };
  }, [orgId]);

  const subscribe = async (plan: Plan) => {
    setBusy(true);
    try {
      await api<{ subscription: Subscription }>(`/orgs/${orgId}/billing/subscribe`, {
        method: 'POST', body: { planId: plan.id },
      });
      notify(t('saved'), 'success');
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await api<{ subscription: Subscription }>(`/orgs/${orgId}/billing/cancel`, {
        method: 'POST', body: { atPeriodEnd: true },
      });
      notify(t('saved'), 'success');
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  const downloadExport = async () => {
    try {
      const response = await fetch(apiUrl(`/orgs/${orgId}/billing/export`), { credentials: 'include' });
      if (!response.ok) throw new Error(`Export failed (${response.status})`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `saha-org-${orgId}-export.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      notify(t('saved'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
  };

  const planLabel = (plan: Plan) => {
    if (plan.id === 'plan-free') return t('planFree');
    if (plan.id === 'plan-pro') return t('planPro');
    if (plan.id === 'plan-school') return t('planSchool');
    return plan.name;
  };

  const intervalLabel = (interval?: 'monthly' | 'annual') =>
    interval === 'annual' ? t('annual') : t('monthly');

  const money = (amountCents: number, currency: string) =>
    `${(amountCents / 100).toFixed(2)} ${currency}`;

  const dateLabel = (iso: string) => new Date(iso).toLocaleDateString();
  const statusLabel = (status: string) => {
    const label = t(`status_${status}`);
    return label === `status_${status}` ? status : label;
  };

  if (loading) return <PageLoading />;
  if (error || !data) return <PageError message={error ?? t('loading')} onRetry={reload} />;

  const { entitlements, subscription } = data;

  return (
    <div className="rise">
      <PageHead title={t('billing')} subtitle={t('billingSub')} actions={
        <Button icon={<Download size={16} />} onClick={downloadExport}>{t('dataExport')}</Button>
      } />

      <div className="info-banner" style={{ marginBottom: 20 }}>
        <ShieldCheck size={16} />{t('noBillingProvider')}
      </div>

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <Card>
          <CardHead title={t('currentPlan')} subtitle={subscription?.id ?? t('status_none')}
            icon={<ReceiptText size={16} />} />
          <div className="card-body stack">
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <div>
                <div className="strong">{entitlements.planName || t('status_none')}</div>
                <div className="small muted">{t('status')}: {t(`status_${subscription?.status ?? entitlements.status}`)} · {t('planInterval')}: {intervalLabel(subscription?.interval)}</div>
              </div>
              <Badge tone={statusTone[subscription?.status ?? ''] ?? 'muted'}>
                {t(`status_${subscription?.status ?? entitlements.status}`)}
              </Badge>
            </div>
            {subscription && <div className="divider" />}
            {subscription && <>
              <div className="row row-wrap" style={{ justifyContent: 'space-between', gap: 12 }}>
                <div><div className="stat-card__label">{t('from')}</div><div className="mono small">{dateLabel(subscription.currentPeriodStart)}</div></div>
                <div><div className="stat-card__label">{t('to')}</div><div className="mono small">{dateLabel(subscription.currentPeriodEnd)}</div></div>
                {subscription.trialEndsAt && <div><div className="stat-card__label">{t('trialing')}</div>
                  <div className="mono small">{dateLabel(subscription.trialEndsAt)}</div></div>}
              </div>
              {subscription.cancelAtPeriodEnd && <div className="info-banner"><Info size={16} />{t('cancelAtPeriodEnd')}</div>}
              {manageable && !subscription.cancelAtPeriodEnd && subscription.status !== 'cancelled' &&
                <Button variant="danger" loading={busy} onClick={cancel}>{t('cancelSubscription')}</Button>}
            </>}
            {!subscription && <EmptyState icon={<ReceiptText size={22} />} title={t('noInvoices')}
              description={t('noBillingProvider')} />}
          </div>
        </Card>

        <Card>
          <CardHead title={t('quotas')} subtitle={`${t('usage')} / ${t('limit')}`} />
          <div className="card-body stack" style={{ gap: 14 }}>
            {quotaKeys.map((key: QuotaKey) => {
              const limit = entitlements.limits[key] ?? 0;
              const used = entitlements.usage[key] ?? 0;
              const left = entitlements.remaining[key] ?? 0;
              const percent = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
              return <div key={key}>
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <span className="small strong">{key}</span>
                  <span className="small mono">{used} / {limit} <span className="muted">({t('remaining')}: {left})</span></span>
                </div>
                <Progress value={percent} />
                {left <= 0 && <div className="small" style={{ color: 'var(--danger)', marginTop: 4 }}>{t('quotaExceeded')}</div>}
              </div>;
            })}
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <CardHead title={t('planCatalog')} subtitle={t('noBillingProvider')} />
        <div className="grid grid-3 card-body">
          {data.plans.map((plan) => {
            const current = subscription?.planId === plan.id;
            return <div key={plan.id} className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <h3>{planLabel(plan)}</h3>
                {current && <Badge tone="success">{t('currentPlan')}</Badge>}
              </div>
              <div className="small muted">{plan.description}</div>
              <div className="strong">{money(plan.priceCents, plan.currency)} <span className="small muted">{plan.interval === 'annual' ? `/ ${t('annual')}` : t('priceMonthly')}</span></div>
              <div className="small muted">{t('features')}</div>
              <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
                {plan.features.map((feature) => <li key={feature}>{feature}</li>)}
              </ul>
              <div className="divider" />
              <div className="small mono muted">
                {t('members')}: {plan.limits.members} · {t('rooms')}: {plan.limits.rooms} · {t('meetingCount')}: {plan.limits.meetingsPerMonth}
              </div>
              {manageable && <Button variant={current ? 'secondary' : 'primary'} loading={busy}
                onClick={() => subscribe(plan)}>{t('subscribe')}</Button>}
            </div>;
          })}
          {!data.plans.length && <EmptyState icon={<ReceiptText size={22} />} title={t('noData')} description={t('noBillingProvider')} />}
        </div>
      </Card>

      <Card>
        <CardHead title={t('invoices')} subtitle={`${data.invoiceList.length} ${t('all').toLowerCase()}`} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('date')}</th><th>{t('status')}</th><th className="numeric">{t('usage')}</th>
            <th>{t('from')}</th><th>{t('to')}</th><th>ID</th></tr></thead>
          <tbody>
            {data.invoiceList.map((invoice) => (
              <tr key={invoice.id}>
                <td className="small mono">{new Date(invoice.createdAt).toLocaleString()}</td>
                <td><Badge tone={statusTone[invoice.status] ?? 'muted'}>{statusLabel(invoice.status)}</Badge></td>
                <td className="numeric mono">{money(invoice.amountCents, invoice.currency)}</td>
                <td className="small mono">{dateLabel(invoice.periodStart)}</td>
                <td className="small mono">{dateLabel(invoice.periodEnd)}</td>
                <td className="small mono">{invoice.id.slice(0, 8)}</td>
              </tr>
            ))}
            {!data.invoiceList.length && <tr><td colSpan={6}>
              <EmptyState icon={<ReceiptText size={22} />} title={t('noInvoices')} description={t('noBillingProvider')} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>
    </div>
  );
}
