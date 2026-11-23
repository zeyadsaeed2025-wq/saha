import { CalendarDays, Clock3, Plus, RefreshCw, ShieldAlert } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, PageHead, Select, Skeleton, StatusBadge, useAsync } from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { useToast } from '../../lib/toast.js';
import type { Member, ScheduleRule, ScheduledSession } from '../../types.js';

const dayKeys = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

export function Schedules() {
  const { t, lang } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const canManage = me?.role === 'org_admin' || me?.role === 'super_admin' || me?.role === 'mentor';
  const [tab, setTab] = useState<'rules' | 'calendar' | 'sessions'>('rules');
  const [createOpen, setCreateOpen] = useState(false);
  const [generateFor, setGenerateFor] = useState<ScheduleRule | null>(null);
  const [from, setFrom] = useState(new Date().toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10));

  const { data, loading, error, reload } = useAsync(async () => {
    const [rules, sessions, members] = await Promise.all([
      api<{ schedules: ScheduleRule[] }>(`/orgs/${orgId}/schedules`),
      api<{ sessions: ScheduledSession[] }>(`/orgs/${orgId}/schedules/sessions/list`),
      api<{ members: Member[] }>(`/orgs/${orgId}/members`),
    ]);
    return { schedules: rules, sessions, members };
  }, [orgId]);

  if (loading) return <div className="stack"><Skeleton height={100} />{Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} height={80} />)}</div>;
  if (error || !data) return <div className="error-banner">{error ?? t('loading')}</div>;

  const create = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api(`/orgs/${orgId}/schedules`, {
        method: 'POST',
        body: {
          userId: form.get('userId'), kind: form.get('kind'), title: form.get('title'),
          days: form.getAll('days').map(Number),
          startTime: form.get('startTime'), endTime: form.get('endTime'),
          timezone: me?.organization?.timezone ?? 'UTC',
          graceMinutes: Number(form.get('graceMinutes')),
          minimumMinutes: Number(form.get('minimumMinutes')),
        },
      });
      notify(t('saved'), 'success'); setCreateOpen(false); await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not save', 'error'); }
  };

  const generate = async () => {
    if (!generateFor) return;
    try {
      const result = await api<{ created: number }>(`/orgs/${orgId}/schedules/${generateFor.id}/generate`, {
        method: 'POST', body: { from, to },
      });
      notify(`${result.created} ${t('sessions').toLowerCase()}`, 'success');
      setGenerateFor(null); await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not generate', 'error'); }
  };

  const cancel = async (id: string) => {
    try {
      await api(`/orgs/${orgId}/schedules/sessions/${id}/cancel`, { method: 'POST' });
      notify(t('saved'), 'success'); await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not cancel', 'error'); }
  };

  const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0);
  const gridStart = new Date(monthStart); gridStart.setDate(1 - monthStart.getDay());
  const days = Array.from({ length: 42 }, (_, i) => {
    const date = new Date(gridStart); date.setDate(gridStart.getDate() + i); return date;
  });

  const memberOptions = data.members.members;

  return (
    <div className="rise">
      <PageHead title={t('schedTitle')} subtitle={t('schedSub')} actions={
        canManage && <Button variant="primary" icon={<Plus size={16} />} onClick={() => setCreateOpen(true)}>{t('newSchedule')}</Button>
      } />
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${tab === 'rules' ? 'active' : ''}`} onClick={() => setTab('rules')}>{t('list')}</button>
        <button className={`tab ${tab === 'calendar' ? 'active' : ''}`} onClick={() => setTab('calendar')}>{t('calendar')}</button>
        <button className={`tab ${tab === 'sessions' ? 'active' : ''}`} onClick={() => setTab('sessions')}>{t('sessions')} ({data.sessions.sessions.length})</button>
      </div>

      {tab === 'rules' && <div className="grid grid-3">
        {data.schedules.schedules.map((rule) => (
          <Card key={rule.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div className="row row-wrap" style={{ justifyContent: 'space-between' }}>
              <Badge tone={rule.kind === 'mentor_session' ? 'accent' : 'primary'} plain>{t(rule.kind === 'mentor_session' ? 'mentorSession' : 'shift')}</Badge>
              <StatusBadge status={rule.status} />
            </div>
            <h3 style={{ fontSize: 'var(--text-md)' }}>{rule.title}</h3>
            <div className="small muted">{memberOptions.find((m) => m.userId === rule.userId)?.name ?? rule.userId}</div>
            <div className="row row-wrap">
              {rule.days.map((d) => <span key={d} className="chip" style={{ padding: '3px 8px' }}>{t(dayKeys[d])}</span>)}
            </div>
            <div className="row" style={{ color: 'var(--muted)' }}><Clock3 size={15} /> <span className="mono">{rule.startTime} – {rule.endTime}</span></div>
            <div className="small muted">{t('grace')}: {rule.graceMinutes} · {t('minimum')}: {rule.minimumMinutes}</div>
            <div className="divider" style={{ margin: '2px 0' }} />
            <div className="row" style={{ justifyContent: 'space-between' }}>
              <span className="small muted">{t('history')}: {rule.history.length}</span>
              {canManage && <Button size="sm" icon={<RefreshCw size={14} />} onClick={() => setGenerateFor(rule)}>{t('generate')}</Button>}
            </div>
          </Card>
        ))}
        {!data.schedules.schedules.length && <Card style={{ gridColumn: '1 / -1' }}>
          <EmptyState icon={<CalendarDays size={24} />} title={t('noSchedules')} description={t('noSchedulesHint')}
            action={canManage && <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>{t('newSchedule')}</Button>} />
        </Card>}
      </div>}

      {tab === 'calendar' && <Card className="card-body">
        <div className="calendar-grid">
          {days.map((date) => {
            const iso = date.toISOString().slice(0, 10);
            const sessions = data.sessions.sessions.filter((s) => s.startsAt.slice(0, 10) === iso);
            return (
              <div key={iso} className={`calendar-day ${iso === new Date().toISOString().slice(0, 10) ? 'today' : ''}`}>
                <div className="calendar-day__num">{date.getDate()}</div>
                {sessions.slice(0, 3).map((session) => <div key={session.id} className="calendar-event" title={session.title}>
                  {session.startsAt.slice(11, 16)} {memberOptions.find((m) => m.userId === session.userId)?.name.split(' ')[0] ?? ''}
                </div>)}
                {sessions.length > 3 && <div className="small muted">+{sessions.length - 3}</div>}
              </div>
            );
          })}
        </div>
      </Card>}

      {tab === 'sessions' && <Card>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('date')}</th><th>{t('member')}</th><th>{t('ruleTitle')}</th><th>{t('status')}</th><th>{t('actions')}</th></tr></thead>
          <tbody>
            {data.sessions.sessions.slice(0, 60).map((session) => (
              <tr key={session.id}>
                <td className="mono">{session.startsAt.slice(0, 16).replace('T', ' ')}</td>
                <td className="cell-strong">{memberOptions.find((m) => m.userId === session.userId)?.name ?? '—'}</td>
                <td>{session.title}</td>
                <td><StatusBadge status={session.status} /></td>
                <td>{canManage && session.status === 'scheduled' &&
                  <Button size="sm" variant="danger" onClick={() => cancel(session.id)}>{t('cancelSession')}</Button>}</td>
              </tr>
            ))}
            {!data.sessions.sessions.length && <tr><td colSpan={5}><EmptyState title={t('noData')} description={t('noSchedulesHint')} /></td></tr>}
          </tbody>
        </table></div>
      </Card>}

      {createOpen && <Modal title={t('newSchedule')} onClose={() => setCreateOpen(false)} footer={
        <><Button onClick={() => setCreateOpen(false)}>{t('cancel')}</Button><Button variant="primary" type="submit" form="schedule-form">{t('saveSchedule')}</Button></>
      }>
        <form id="schedule-form" className="form-grid" onSubmit={create}>
          <Field label={t('ruleTitle')} className="full"><Input name="title" required minLength={2} placeholder="Engineering mentorship" /></Field>
          <Field label={t('member')} className="full"><Select name="userId" required defaultValue="">
            <option value="" disabled>—</option>
            {memberOptions.map((m) => <option key={m.userId} value={m.userId}>{m.name} · {m.team}</option>)}
          </Select></Field>
          <Field label={t('kind')}><Select name="kind"><option value="shift">{t('shift')}</option><option value="mentor_session">{t('mentorSession')}</option></Select></Field>
          <Field label={t('days')}>
            <div className="chip-row">{dayKeys.map((day, i) => <label key={day} className="chip">
              <input type="checkbox" name="days" value={i} defaultChecked={[1, 2, 3, 4, 5].includes(i)} /> {t(day)}
            </label>)}</div>
          </Field>
          <Field label={t('startTime')}><Input type="time" name="startTime" defaultValue="18:00" required dir="ltr" /></Field>
          <Field label={t('endTime')}><Input type="time" name="endTime" defaultValue="20:00" required dir="ltr" /></Field>
          <Field label={t('grace')}><Input type="number" name="graceMinutes" defaultValue={10} min={0} max={120} required /></Field>
          <Field label={t('minimum')}><Input type="number" name="minimumMinutes" defaultValue={60} min={1} max={600} required /></Field>
        </form>
      </Modal>}

      {generateFor && <Modal title={`${t('generate')}: ${generateFor.title}`} onClose={() => setGenerateFor(null)} footer={
        <><Button onClick={() => setGenerateFor(null)}>{t('cancel')}</Button><Button variant="primary" onClick={generate}>{t('generate')}</Button></>
      }>
        <div className="form-grid">
          <Field label={t('from')}><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} dir="ltr" /></Field>
          <Field label={t('to')}><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} dir="ltr" /></Field>
        </div>
        <div className="info-banner" style={{ marginTop: 16 }}>
          <ShieldAlert size={16} /> Sessions use the organization timezone ({me?.organization?.timezone}). Holidays and approved absences are skipped.
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>{lang === 'ar' ? 'يتم تخزين الأحداث بصيغة UTC دائمًا.' : 'All event times are stored in UTC.'}</div>
      </Modal>}
    </div>
  );
}
