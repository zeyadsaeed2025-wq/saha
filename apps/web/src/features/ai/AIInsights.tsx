import { Info, Sparkles, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, PageHead, Select, Skeleton, useAsync,
} from '../../components/ui.js';
import { PageError, PageLoading } from '../../components/PageStates.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { AiInsight } from '../../types.js';

export function AIInsights() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const adminDelete = can(me?.role, 'report:export');

  const [sourceText, setSourceText] = useState('');
  const [kind, setKind] = useState<AiInsight['kind']>('summary');
  const [formError, setFormError] = useState('');
  const [busy, setBusy] = useState(false);
  const [detail, setDetail] = useState<AiInsight | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const { data, loading, error, setData } = useAsync(async () =>
    api<{ insights: AiInsight[]; provider: string; available: boolean; note: string }>(
      `/orgs/${orgId}/ai/insights`), [orgId]);

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const text = sourceText.trim();
    if (text.length < 20) {
      setFormError(`${t('sourceText')}: 20+`);
      return;
    }
    setFormError('');
    setBusy(true);
    try {
      const result = await api<{ insight: AiInsight }>(`/orgs/${orgId}/ai/summary`, {
        method: 'POST', body: { sourceText: text, kind },
      });
      setData((current) => current ? { ...current, insights: [result.insight, ...current.insights] } : current);
      setSourceText('');
      notify(t('summaryCreated'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  const openDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const result = await api<{ insight: AiInsight }>(`/orgs/${orgId}/ai/insights/${id}`);
      setDetail(result.insight);
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setDetailLoading(false); }
  };

  const remove = async (id: string) => {
    setBusy(true);
    try {
      await api<{ ok: boolean }>(`/orgs/${orgId}/ai/insights/${id}`, { method: 'DELETE' });
      setData((current) => current ? { ...current, insights: current.insights.filter((item) => item.id !== id) } : current);
      if (detail?.id === id) setDetail(null);
      notify(t('saved'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : t('errorGeneric'), 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <PageLoading />;
  if (error || !data) return <PageError message={error ?? t('loading')} />;

  return (
    <div className="rise">
      <PageHead title={t('ai')} subtitle={t('aiSub')} />
      <div className="info-banner" style={{ marginBottom: 20 }}>
        <Info size={16} />
        <div>
          <div>{data.note || t('localAiNote')}</div>
          {data.note !== t('localAiNote') && <div className="small">{t('localAiNote')}</div>}
          <div className="small mono">provider: {data.provider} · available: {String(data.available)}</div>
        </div>
      </div>

      <div className="grid grid-32">
        <Card>
          <CardHead title={t('newSummary')} icon={<Sparkles size={16} />} />
          <form className="card-body form-grid" onSubmit={create}>
            <Field label={t('insightKind')}>
              <Select value={kind} onChange={(event) => setKind(event.target.value as AiInsight['kind'])}>
                <option value="summary">summary</option>
                <option value="highlight">highlight</option>
                <option value="insight">insight</option>
              </Select>
            </Field>
            <Field label={`${t('sourceText')} (${sourceText.trim().length}/20000)`} className="full"
              error={formError} hint={t('localAiNote')}>
              <textarea className="input" rows={7} value={sourceText}
                onChange={(event) => { setSourceText(event.target.value); setFormError(''); }}
                minLength={20} maxLength={20000} placeholder={t('sourceText')} />
            </Field>
            <div className="full">
              <Button variant="primary" type="submit" loading={busy} icon={<Sparkles size={15} />}>
                {t('generateSummary')}
              </Button>
            </div>
          </form>
        </Card>

        <Card>
          <CardHead title={t('insights')} subtitle={`${data.insights.length} ${t('all').toLowerCase()}`} />
          <div className="card-body stack" style={{ gap: 8 }}>
            {data.insights.map((insight) => (
              <div key={insight.id} className="presence-item panel" style={{ alignItems: 'flex-start' }}>
                <span className="avatar sm"><Sparkles size={14} /></span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="row row-wrap" style={{ gap: 8 }}>
                    <Badge tone="primary" plain>{insight.kind}</Badge>
                    <span className="small mono muted">{insight.provider}</span>
                    <span className="small mono muted">{new Date(insight.createdAt).toLocaleString()}</span>
                  </div>
                  <div className="small" style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{insight.content}</div>
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <Button size="sm" onClick={() => openDetail(insight.id)} loading={detailLoading}>{t('view')}</Button>
                  {adminDelete && <Button size="sm" variant="danger" icon={<Trash2 size={14} />}
                    loading={busy} onClick={() => remove(insight.id)}>{t('delete')}</Button>}
                </div>
              </div>
            ))}
            {!data.insights.length && <EmptyState icon={<Sparkles size={24} />} title={t('noInsights')}
              description={t('localAiNote')} />}
          </div>
        </Card>
      </div>

      {detail && <Modal title={`${t('insights')} · ${detail.kind}`} onClose={() => setDetail(null)} footer={
        <Button variant="primary" onClick={() => setDetail(null)}>{t('close')}</Button>
      }>
        <div className="stack">
          <div className="small mono muted">{new Date(detail.createdAt).toLocaleString()} · {detail.provider}</div>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{detail.content}</div>
          {adminDelete && <Button variant="danger" loading={busy} icon={<Trash2 size={14} />}
            onClick={() => remove(detail.id)}>{t('delete')}</Button>}
        </div>
      </Modal>}
    </div>
  );
}
