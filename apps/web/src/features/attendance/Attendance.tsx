import { Activity, CheckCircle2, CirclePause, History, PlugZap, ShieldCheck, Unplug } from 'lucide-react';
import { useState } from 'react';
import { Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, PageHead, Select, Skeleton, StatusBadge, useAsync } from '../../components/ui.js';
import { PageError, PageLoading } from '../../components/PageStates.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { useToast } from '../../lib/toast.js';
import { formatDuration } from '../../lib/format.js';
import type { AttendanceEvent, AttendanceRow } from '../../types.js';

const today = () => new Date().toISOString().slice(0, 10);
const back = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

export function Attendance() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const admin = me?.role === 'org_admin' || me?.role === 'super_admin';
  const [from, setFrom] = useState(back(13));
  const [to, setTo] = useState(today());
  const [eventsFor, setEventsFor] = useState<AttendanceRow | null>(null);
  const [correctFor, setCorrectFor] = useState<AttendanceRow | null>(null);
  const [reason, setReason] = useState('');
  const [status, setStatus] = useState('excused');
  const [busy, setBusy] = useState('');

  const { data, loading, error, reload } = useAsync(async () => {
    const [rows, sessions] = await Promise.all([
      api<{ sessions: AttendanceRow[] }>(`/orgs/${orgId}/attendance?from=${from}&to=${to}`),
      api<{ sessions: Array<{ id: string; title: string; startsAt: string; status: string }> }>(
        `/orgs/${orgId}/schedules/sessions/list?from=${back(1)}&to=${back(-1)}`),
    ]);
    const events = eventsFor ? await api<{ events: AttendanceEvent[] }>(
      `/orgs/${orgId}/attendance/events?sessionId=${eventsFor.id}`) : null;
    return { rows: rows.sessions, sessions: sessions.sessions, events: events?.events ?? [] };
  }, [orgId, from, to, eventsFor?.id]);

  const act = async (kind: string) => {
    setBusy(kind);
    try {
      await api(`/orgs/${orgId}/attendance/${kind}`, { method: 'POST', body: {} });
      notify(t('saved'), 'success'); await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Action failed', 'error'); }
    finally { setBusy(''); }
  };

  const finalize = async () => {
    setBusy('finalize');
    try {
      const result = await api<{ absences: number; finalized: number }>(`/orgs/${orgId}/attendance/finalize`, { method: 'POST' });
      notify(`${result.absences} ${t('absentCount').toLowerCase()}, ${result.finalized} ${t('status_completed').toLowerCase()}`, 'success');
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Finalize failed', 'error'); }
    finally { setBusy(''); }
  };

  const correct = async () => {
    if (!correctFor) return;
    try {
      await api(`/orgs/${orgId}/attendance/${correctFor.id}/correct`, {
        method: 'POST', body: { reason, status },
      });
      notify(t('saved'), 'success'); setCorrectFor(null); setReason(''); await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Correction failed', 'error'); }
  };

  if (loading) return <PageLoading />;
  if (error || !data) return <PageError message={error ?? t('loading')} onRetry={reload} />;

  const active = data.sessions.find((s) => s.status === 'scheduled');

  return (
    <div className="rise">
      <PageHead title={t('attTitle')} subtitle={t('attSub')} actions={
        admin && <Button icon={<ShieldCheck size={16} />} loading={busy === 'finalize'} onClick={finalize}>{t('finalize')}</Button>
      } />
      <div className="info-banner" style={{ marginBottom: 20 }}><ShieldCheck size={16} />{t('verifiedOnly')}</div>

      <div className="grid grid-32">
        <Card>
          <CardHead title={t('sessions')} subtitle={`${data.rows.length} records`} action={
            <div className="row">
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" style={{ width: 145 }} />
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" style={{ width: 145 }} />
            </div>
          } />
          <div className="table-wrap"><table className="table">
            <thead><tr><th>{t('member')}</th><th>{t('date')}</th><th>{t('status')}</th>
              <th className="numeric">{t('confirmedTime')}</th><th className="numeric">{t('lateness')}</th><th>{t('actions')}</th></tr></thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id}>
                  <td className="cell-strong">{row.memberName}<div className="small muted">{row.team} · {row.role}</div></td>
                  <td className="small mono">{row.scheduled?.startsAt?.slice(0, 16).replace('T', ' ') ?? '—'}</td>
                  <td><StatusBadge status={row.status} /></td>
                  <td className="numeric mono">{formatDuration(row.confirmedConnectedSeconds)}</td>
                  <td className="numeric mono">{Math.round(row.countedLatenessSeconds / 60)}m</td>
                  <td><div className="row">
                    <Button size="sm" icon={<History size={14} />} onClick={() => setEventsFor(row)}>{t('events')}</Button>
                    {admin && <Button size="sm" variant="secondary" onClick={() => { setCorrectFor(row); setReason(''); }}>{t('correct')}</Button>}
                  </div></td>
                </tr>
              ))}
              {!data.rows.length && <tr><td colSpan={6}><EmptyState icon={<Activity size={22} />} title={t('noAttendance')} description={t('noDataHint')} /></td></tr>}
            </tbody>
          </table></div>
        </Card>

        <div className="stack">
          <Card>
            <CardHead title={t('liveTracking')} subtitle={t('verifiedOnly')} />
            <div className="card-body stack" style={{ gap: 10 }}>
              {!active && <div className="small muted">{t('noActiveSession')}</div>}
              <div className="row row-wrap">
                <Button size="sm" variant="primary" icon={<PlugZap size={14} />} loading={busy === 'join'} onClick={() => act('join')}>{t('join')}</Button>
                <Button size="sm" icon={<Activity size={14} />} loading={busy === 'heartbeat'} onClick={() => act('heartbeat')}>{t('heartbeat')}</Button>
                <Button size="sm" icon={<CirclePause size={14} />} loading={busy === 'break/start'} onClick={() => act('break/start')}>{t('breakStart')}</Button>
                <Button size="sm" icon={<CheckCircle2 size={14} />} loading={busy === 'break/end'} onClick={() => act('break/end')}>{t('breakEnd')}</Button>
                <Button size="sm" icon={<Unplug size={14} />} loading={busy === 'disconnect'} onClick={() => act('disconnect')}>{t('disconnect')}</Button>
                <Button size="sm" icon={<PlugZap size={14} />} loading={busy === 'reconnect'} onClick={() => act('reconnect')}>{t('reconnect')}</Button>
                <Button size="sm" variant="danger" loading={busy === 'leave'} onClick={() => act('leave')}>{t('leave')}</Button>
              </div>
              <div className="divider" />
              <div className="small muted">
                {active ? `${active.title} · ${active.startsAt.slice(11, 16)}` : t('noActiveSession')}
              </div>
              <Badge tone="primary" plain>UTC</Badge>
            </div>
          </Card>

          <Card>
            <CardHead title={t('summary')} />
            <div className="card-body stack" style={{ gap: 12 }}>
              {[
                [t('present'), data.rows.filter((r) => r.status !== 'absent').length],
                [t('late'), data.rows.filter((r) => r.status === 'late').length],
                [t('excused'), data.rows.filter((r) => r.status === 'excused').length],
                [t('pending'), data.rows.filter((r) => r.status === 'pending_review').length],
              ].map(([label, value]) => <div key={String(label)} className="row" style={{ justifyContent: 'space-between' }}>
                <span className="small muted">{label}</span><strong>{value}</strong>
              </div>)}
            </div>
          </Card>
        </div>
      </div>

      {eventsFor && <Modal title={`${t('events')} · ${eventsFor.memberName}`} onClose={() => setEventsFor(null)}>
        <div className="stack" style={{ gap: 0 }}>
          {data.events.map((event) => <div key={event.id} className="row" style={{ justifyContent: 'space-between', padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div><div className="strong small">{event.type}</div><div className="small muted">{event.source}</div></div>
            <span className="small mono muted">{new Date(event.at).toLocaleString()}</span>
          </div>)}
          {!data.events.length && <EmptyState title={t('noData')} />}
        </div>
      </Modal>}

      {correctFor && <Modal title={t('correct')} onClose={() => setCorrectFor(null)} footer={
        <><Button onClick={() => setCorrectFor(null)}>{t('cancel')}</Button><Button variant="primary" onClick={correct}>{t('save')}</Button></>
      }>
        <div className="stack">
          <div className="info-banner">{correctFor.memberName} · {correctFor.scheduled?.title}</div>
          <Field label={t('status')}><Select value={status} onChange={(e) => setStatus(e.target.value)}>
            {['on_time', 'late', 'absent', 'partial', 'excused', 'pending_review'].map((key) =>
              <option key={key} value={key}>{t(`status_${key}`)}</option>)}
          </Select></Field>
          <Field label={t('correctionReason')}><Input value={reason} onChange={(e) => setReason(e.target.value)} minLength={5} required /></Field>
          <div className="small muted">{t('reason')} · {t('history')} — {t('verifiedOnly')}</div>
        </div>
      </Modal>}
    </div>
  );
}
