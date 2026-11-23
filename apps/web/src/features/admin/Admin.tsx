import { ClipboardCheck, Eye, Pencil, Plus, ReceiptText, ShieldAlert } from 'lucide-react';
import { useState } from 'react';
import {
  Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, PageHead, Select, Skeleton, useAsync,
} from '../../components/ui.js';
import { ApiError, api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { useToast } from '../../lib/toast.js';
import type { AdminOrganization, Entitlements, Member, Plan, Subscription } from '../../types.js';

interface AuditLog {
  id: string; organizationId: string; action: string; target: string;
  metadata: Record<string, unknown>; at: string; actorId: string;
}
interface OrgDetail {
  organization: AdminOrganization;
  entitlements: Entitlements;
  members: Member[];
  auditLogs: AuditLog[];
}
interface SupportView {
  organization: AdminOrganization;
  memberCount: number;
  attendanceSessions: number;
  meetings: number;
  recordings: number;
  entitlements: AdminOrganization['entitlements'];
  impersonation: { available: boolean; reason: string };
}

const FEATURE_KEYS = ['media', 'recording', 'integrations', 'ai', 'customization', 'publicApi'] as const;
const LIMIT_KEYS = [
  'members', 'rooms', 'workspaces', 'concurrentUsers',
  'recordingMinutes', 'storageGb', 'meetingsPerMonth',
] as const;
type LimitKey = typeof LIMIT_KEYS[number];

interface PlanForm {
  id: string | null;
  name: string;
  description: string;
  interval: 'monthly' | 'annual';
  priceCents: string;
  limits: Record<LimitKey, string>;
  featureKeys: string[];
}

const emptyPlanForm = (): PlanForm => ({
  id: null, name: '', description: '', interval: 'monthly', priceCents: '0',
  limits: { members: '100', rooms: '50', workspaces: '10', concurrentUsers: '50',
    recordingMinutes: '3000', storageGb: '50', meetingsPerMonth: '1000' },
  featureKeys: [...FEATURE_KEYS],
});

const formFromPlan = (plan: Plan): PlanForm => ({
  id: plan.id, name: plan.name, description: plan.description, interval: plan.interval,
  priceCents: String(plan.priceCents),
  limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, String(plan.limits[key] ?? 0)])) as Record<LimitKey, string>,
  featureKeys: plan.featureKeys ?? plan.features,
});

export function Admin() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const isSuper = me?.role === 'super_admin';

  const [selectedPlans, setSelectedPlans] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<OrgDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [support, setSupport] = useState<SupportView | null>(null);
  const [supportLoading, setSupportLoading] = useState(false);
  const [supportError, setSupportError] = useState('');
  const [planForm, setPlanForm] = useState<PlanForm | null>(null);
  const [planSaving, setPlanSaving] = useState(false);

  const { data, loading, error, reload } = useAsync(async () => {
    if (!isSuper) return null;
    const [organizations, audit, catalog] = await Promise.all([
      api<{ organizations: AdminOrganization[] }>('/admin/organizations'),
      api<{ logs: AuditLog[] }>('/admin/audit'),
      api<{ plans: Plan[] }>('/admin/plans'),
    ]);
    return { organizations: organizations.organizations, logs: audit.logs, plans: catalog.plans };
  }, [isSuper]);

  const setStatus = async (organization: AdminOrganization, status: 'active' | 'suspended') => {
    setBusy(true);
    try {
      const result = await api<{ organization: AdminOrganization; sessionsRevoked: number }>(
        `/admin/organizations/${organization.id}/status`, { method: 'PATCH', body: { status } });
      notify(`${t('orgStatusUpdated')} · ${t('sessionsRevoked')}: ${result.sessionsRevoked}`, 'success');
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  const assignPlan = async (organization: AdminOrganization) => {
    const planId = selectedPlans[organization.id];
    if (!planId) { notify(t('noPermission'), 'error'); return; }
    setBusy(true);
    try {
      const result = await api<{ subscription: Subscription }>(
        `/admin/organizations/${organization.id}/plan`, { method: 'POST', body: { planId } });
      notify(`${t('planAssigned')} · ${t(`status_${result.subscription.status}`)}`, 'success');
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  const openDetail = async (organizationId: string) => {
    setDetailLoading(true); setDetailError(''); setDetail(null);
    try {
      const result = await api<OrgDetail>(`/admin/organizations/${organizationId}`);
      setDetail(result);
    } catch (err) { setDetailError(err instanceof Error ? err.message : t('errorGeneric')); }
    finally { setDetailLoading(false); }
  };

  const openSupport = async (organizationId: string) => {
    setSupportLoading(true); setSupportError(''); setSupport(null);
    try {
      const result = await api<SupportView>(`/admin/support/${organizationId}`);
      setSupport(result);
    } catch (err) { setSupportError(err instanceof Error ? err.message : t('errorGeneric')); }
    finally { setSupportLoading(false); }
  };

  const describeError = (err: unknown, fallback: string) => {
    if (err instanceof ApiError && err.info.code === 'PLAN_IN_USE') return t('planInUse');
    return err instanceof Error ? err.message : fallback;
  };

  const savePlan = async () => {
    if (!planForm) return;
    if (planForm.name.trim().length < 2) { notify(t('planName'), 'error'); return; }
    setPlanSaving(true);
    try {
      const body = {
        name: planForm.name.trim(), description: planForm.description.trim(),
        interval: planForm.interval,
        priceCents: Math.max(0, Number(planForm.priceCents) || 0),
        limits: Object.fromEntries(LIMIT_KEYS.map((key) => [key, Math.max(0, Number(planForm.limits[key]) || 0)])),
        featureKeys: planForm.featureKeys,
      };
      if (planForm.id) {
        await api(`/admin/plans/${planForm.id}`, { method: 'PATCH', body });
        notify(t('planUpdated'), 'success');
      } else {
        await api('/admin/plans', { method: 'POST', body });
        notify(t('planCreated'), 'success');
      }
      setPlanForm(null);
      await reload();
    } catch (err) { notify(describeError(err, t('errorGeneric')), 'error'); }
    finally { setPlanSaving(false); }
  };

  const setPlanStatus = async (plan: Plan, status: 'active' | 'archived') => {
    setBusy(true);
    try {
      await api(`/admin/plans/${plan.id}/status`, { method: 'POST', body: { status } });
      notify(status === 'archived' ? t('planArchived') : t('planUpdated'), 'success');
      await reload();
    } catch (err) { notify(describeError(err, t('errorGeneric')), 'error'); }
    finally { setBusy(false); }
  };

  if (!isSuper) return <div className="rise">
    <PageHead title={t('admin')} subtitle={t('adminSub')} />
    <EmptyState icon={<ShieldAlert size={24} />} title={t('adminOnly')} description={t('noPermission')} />
  </div>;

  if (loading) return <div className="stack"><Skeleton height={90} />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={100} />)}</div>;
  if (error || !data) return <div className="error-banner">{error ?? t('loading')}</div>;

  return (
    <div className="rise">
      <PageHead title={t('admin')} subtitle={t('platformAdmin')} />

      <Card style={{ marginBottom: 20 }}>
        <CardHead title={t('organizations')} subtitle={`${data.organizations.length} ${t('all').toLowerCase()}`}
          icon={<ShieldAlert size={16} />} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('name')}</th><th>{t('status')}</th><th className="numeric">{t('members')}</th>
            <th className="numeric">{t('activeSessions')}</th><th>{t('billing')}</th>
            <th>{t('assignPlan')}</th><th>{t('actions')}</th></tr></thead>
          <tbody>
            {data.organizations.map((organization) => (
              <tr key={organization.id}>
                <td className="cell-strong">{organization.name}<div className="small mono muted">{organization.slug}</div></td>
                <td><Badge tone={organization.status === 'active' ? 'success' : 'danger'}>
                  {t(`status_${organization.status}`)}
                </Badge></td>
                <td className="numeric mono">{organization.memberCount}</td>
                <td className="numeric mono">{organization.activeSessions}</td>
                <td><div className="small">{organization.entitlements.planName || t('status_none')}</div>
                  <Badge tone="muted" plain>{t(`status_${organization.entitlements.status}`)}</Badge></td>
                <td><div className="row" style={{ gap: 6 }}>
                  <Select aria-label={`${t('assignPlan')} · ${organization.name}`}
                    value={selectedPlans[organization.id] ?? ''}
                    onChange={(event) => setSelectedPlans((current) => ({ ...current, [organization.id]: event.target.value }))}>
                    <option value="">—</option>
                    {data.plans.filter((plan) => plan.status === 'active').map((plan) =>
                      <option key={plan.id} value={plan.id}>
                        {plan.name} · {plan.interval === 'annual' ? t('annual') : t('monthly')}
                      </option>)}
                  </Select>
                  <Button size="sm" disabled={!selectedPlans[organization.id]} loading={busy}
                    onClick={() => assignPlan(organization)}>{t('assignPlan')}</Button>
                </div></td>
                <td><div className="row row-wrap" style={{ gap: 6 }}>
                  <Button size="sm" onClick={() => openDetail(organization.id)} icon={<Eye size={14} />}>{t('details')}</Button>
                  <Button size="sm" onClick={() => openSupport(organization.id)} icon={<ClipboardCheck size={14} />}>
                    {t('supportView')}
                  </Button>
                  <Button size="sm" variant={organization.status === 'active' ? 'danger' : 'primary'}
                    loading={busy} disabled={busy}
                    onClick={() => setStatus(organization, organization.status === 'active' ? 'suspended' : 'active')}>
                    {organization.status === 'active' ? t('suspendOrg') : t('activateOrg')}
                  </Button>
                </div></td>
              </tr>
            ))}
            {!data.organizations.length && <tr><td colSpan={7}>
              <EmptyState icon={<ShieldAlert size={22} />} title={t('noOrganizations')} description={t('noDataHint')} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>

      <Card style={{ marginBottom: 20 }}>
        <CardHead title={t('plans')} subtitle={`${data.plans.length} ${t('all').toLowerCase()}`}
          icon={<ReceiptText size={16} />}
          action={<Button size="sm" icon={<Plus size={14} />} onClick={() => setPlanForm(emptyPlanForm())}>
            {t('newPlan')}
          </Button>} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('planName')}</th><th>{t('planInterval')}</th><th className="numeric">{t('planPrice')}</th>
            <th>{t('featureGates')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead>
          <tbody>
            {data.plans.map((plan) => (
              <tr key={plan.id}>
                <td className="cell-strong">{plan.name}<div className="small muted">{plan.description}</div></td>
                <td>{plan.interval === 'annual' ? t('annual') : t('monthly')}</td>
                <td className="numeric mono">{plan.priceCents}</td>
                <td className="small mono">{(plan.featureKeys ?? plan.features).join(', ') || '—'}</td>
                <td><Badge tone={plan.status === 'active' ? 'success' : 'muted'}>
                  {plan.status === 'active' ? t('active') : t('revoked')}
                </Badge></td>
                <td><div className="row row-wrap" style={{ gap: 6 }}>
                  <Button size="sm" icon={<Pencil size={14} />} onClick={() => setPlanForm(formFromPlan(plan))}>
                    {t('edit')}
                  </Button>
                  <Button size="sm" loading={busy} disabled={busy}
                    variant={plan.status === 'active' ? 'danger' : 'primary'}
                    onClick={() => setPlanStatus(plan, plan.status === 'active' ? 'archived' : 'active')}>
                    {plan.status === 'active' ? t('archivePlan') : t('activatePlan')}
                  </Button>
                </div></td>
              </tr>
            ))}
            {!data.plans.length && <tr><td colSpan={6}>
              <EmptyState icon={<ReceiptText size={22} />} title={t('noData')} description={t('noDataHint')} />
            </td></tr>}
          </tbody>
        </table></div>
        <div className="card-body small muted">{t('annualNote')}</div>
      </Card>

      <Card>
        <CardHead title={t('auditLog')} subtitle={`${data.logs.length} ${t('all').toLowerCase()}`}
          icon={<ClipboardCheck size={16} />} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('date')}</th><th>{t('organization')}</th><th>{t('kind')}</th><th>{t('actions')}</th>
            <th>{t('member')}</th><th>{t('details')}</th></tr></thead>
          <tbody>
            {data.logs.map((log) => (
              <tr key={log.id}>
                <td className="small mono">{new Date(log.at).toLocaleString()}</td>
                <td className="small mono">{log.organizationId || '—'}</td>
                <td className="small mono">{log.action}</td>
                <td className="small mono">{log.target || '—'}</td>
                <td className="small mono">{(log.actorId ?? '').slice(0, 8) || '—'}</td>
                <td className="small mono">{JSON.stringify(log.metadata).slice(0, 140)}</td>
              </tr>
            ))}
            {!data.logs.length && <tr><td colSpan={6}>
              <EmptyState icon={<ClipboardCheck size={22} />} title={t('noData')} description={t('noDataHint')} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>

      {detailLoading && <Modal title={t('details')} onClose={() => setDetail(null)}>
        <Skeleton height={90} /><Skeleton height={160} />
      </Modal>}
      {detailError && <Modal title={t('details')} onClose={() => setDetailError('')}>
        <div className="error-banner">{detailError}</div>
      </Modal>}
      {detail && <Modal title={`${t('details')} · ${detail.organization.name}`} onClose={() => setDetail(null)}
        footer={<Button variant="primary" onClick={() => setDetail(null)}>{t('close')}</Button>}>
        <div className="stack">
          <div className="row row-wrap" style={{ gap: 10 }}>
            <Badge tone={detail.organization.status === 'active' ? 'success' : 'danger'}>
              {t(`status_${detail.organization.status}`)}
            </Badge>
            <span className="small mono">{detail.organization.slug}</span>
            <span className="small">{detail.organization.memberCount} {t('members').toLowerCase()}</span>
          </div>
          <div className="divider" />
          <div className="strong">{t('billing')}: {detail.entitlements.planName || t('status_none')}</div>
          <div className="small muted">{Object.entries(detail.entitlements.usage).map(([key, value]) =>
            `${key}: ${value}/${detail.entitlements.limits[key as keyof Entitlements['limits']] ?? 0}`).join(' · ')}</div>
          <div className="divider" />
          <div className="strong">{t('members')} ({detail.members.length})</div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('name')}</th><th>{t('role')}</th><th>{t('team')}</th><th>{t('status')}</th></tr></thead>
            <tbody>{detail.members.map((member) => <tr key={member.id}>
              <td>{member.name}</td><td className="small mono">{member.role}</td>
              <td>{member.team}</td><td className="small">{member.status}</td>
            </tr>)}</tbody>
          </table></div>
          <div className="strong">{t('auditLog')}</div>
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('date')}</th><th>{t('kind')}</th><th>{t('details')}</th></tr></thead>
            <tbody>{detail.auditLogs.map((log) => <tr key={log.id}>
              <td className="small mono">{new Date(log.at).toLocaleString()}</td>
              <td className="small mono">{log.action}</td>
              <td className="small mono">{JSON.stringify(log.metadata).slice(0, 120)}</td>
            </tr>)}</tbody>
          </table></div>
        </div>
      </Modal>}

      {supportLoading && <Modal title={t('supportView')} onClose={() => setSupport(null)}>
        <Skeleton height={140} />
      </Modal>}
      {supportError && <Modal title={t('supportView')} onClose={() => setSupportError('')}>
        <div className="error-banner">{supportError}</div>
      </Modal>}
      {support && <Modal title={`${t('supportView')} · ${support.organization.name}`} onClose={() => setSupport(null)}
        footer={<Button variant="primary" onClick={() => setSupport(null)}>{t('close')}</Button>}>
        <div className="stack">
          <div className="grid grid-2">
            <div className="stat-card panel"><div className="stat-card__label">{t('members')}</div>
              <div className="stat-card__value">{support.memberCount}</div></div>
            <div className="stat-card panel"><div className="stat-card__label">{t('attendanceSessions')}</div>
              <div className="stat-card__value">{support.attendanceSessions}</div></div>
            <div className="stat-card panel"><div className="stat-card__label">{t('meetings')}</div>
              <div className="stat-card__value">{support.meetings}</div></div>
            <div className="stat-card panel"><div className="stat-card__label">{t('recordings')}</div>
              <div className="stat-card__value">{support.recordings}</div></div>
          </div>
          <div className="divider" />
          <div className="small">{t('billing')}: {support.entitlements.planName || t('status_none')}</div>
          <div className="info-banner"><ShieldAlert size={16} />{support.impersonation.reason}</div>
          <div className="small muted">{t('impersonationNote')}</div>
        </div>
      </Modal>}

      {planForm && <Modal title={planForm.id ? t('editPlan') : t('newPlan')} onClose={() => setPlanForm(null)}
        footer={<>
          <Button onClick={() => setPlanForm(null)}>{t('cancel')}</Button>
          <Button variant="primary" loading={planSaving} onClick={savePlan}>{t('save')}</Button>
        </>}>
        <div className="stack">
          <div className="grid grid-2">
            <Field label={t('planName')}>
              <Input value={planForm.name} onChange={(event) => setPlanForm({ ...planForm, name: event.target.value })} />
            </Field>
            <Field label={t('planInterval')}>
              <Select value={planForm.interval}
                onChange={(event) => setPlanForm({ ...planForm, interval: event.target.value as 'monthly' | 'annual' })}>
                <option value="monthly">{t('monthly')}</option>
                <option value="annual">{t('annual')}</option>
              </Select>
            </Field>
          </div>
          <Field label={t('planDescription')}>
            <Input value={planForm.description} onChange={(event) => setPlanForm({ ...planForm, description: event.target.value })} />
          </Field>
          <Field label={t('planPrice')}>
            <Input type="number" min={0} value={planForm.priceCents}
              onChange={(event) => setPlanForm({ ...planForm, priceCents: event.target.value })} />
          </Field>
          <div className="strong">{t('featureGates')}</div>
          <div className="row row-wrap" style={{ gap: 10 }}>
            {FEATURE_KEYS.map((key) => (
              <label key={key} className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={planForm.featureKeys.includes(key)}
                  onChange={(event) => setPlanForm({ ...planForm, featureKeys: event.target.checked
                    ? [...planForm.featureKeys, key]
                    : planForm.featureKeys.filter((item) => item !== key) })} />
                <span className="small mono">{key}</span>
              </label>
            ))}
          </div>
          <div className="strong">{t('planLimits')}</div>
          <div className="grid grid-2">
            {LIMIT_KEYS.map((key) => (
              <Field key={key} label={key}>
                <Input type="number" min={0} value={planForm.limits[key]}
                  onChange={(event) => setPlanForm({ ...planForm,
                    limits: { ...planForm.limits, [key]: event.target.value } })} />
              </Field>
            ))}
          </div>
          <div className="small muted">{t('annualNote')}</div>
        </div>
      </Modal>}
    </div>
  );
}
