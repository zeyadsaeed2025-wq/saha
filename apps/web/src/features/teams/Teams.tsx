import { Clock3, Inbox, Plus, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, PageHead, Select, Skeleton, useAsync,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { GuestRequest, Member, Team } from '../../types.js';

const failMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

const statusTone = (status: string): 'success' | 'warning' | 'danger' | 'muted' =>
  status === 'approved' ? 'success' : status === 'rejected' ? 'danger' : status === 'pending' ? 'warning' : 'muted';

export function Teams() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const teamManage = can(me?.role, 'team:manage');
  const guestManage = can(me?.role, 'guest:manage');

  const [tab, setTab] = useState<'teams' | 'requests'>('teams');
  const [createOpen, setCreateOpen] = useState(false);
  const [editing, setEditing] = useState<Team | null>(null);
  const [busy, setBusy] = useState(false);
  const [moveSelection, setMoveSelection] = useState<Record<string, string>>({});

  const { data, loading, error, reload } = useAsync(async () => {
    const [teamResult, memberResult, requestResult] = await Promise.all([
      api<{ teams: Team[] }>(`/orgs/${orgId}/teams`),
      api<{ members: Member[] }>(`/orgs/${orgId}/members`),
      api<{ requests: GuestRequest[] }>(`/orgs/${orgId}/access-links/guest-requests`),
    ]);
    return { teams: teamResult.teams, members: memberResult.members, requests: requestResult.requests };
  }, [orgId]);

  const createTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api(`/orgs/${orgId}/teams`, {
        method: 'POST',
        body: {
          name: String(form.get('name') ?? '').trim(),
          description: String(form.get('description') ?? '').trim(),
          leadUserId: String(form.get('leadUserId') ?? '') || null,
        },
      });
      notify(t('teamCreated'), 'success');
      setCreateOpen(false);
      await reload();
    } catch (err) { notify(failMessage(err, t('teamCreated')), 'error'); }
    finally { setBusy(false); }
  };

  const saveTeam = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!editing) return;
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api(`/orgs/${orgId}/teams/${editing.id}`, {
        method: 'PATCH',
        body: {
          name: String(form.get('name') ?? '').trim(),
          description: String(form.get('description') ?? '').trim(),
          leadUserId: String(form.get('leadUserId') ?? '') || null,
        },
      });
      notify(t('teamUpdated'), 'success');
      setEditing(null);
      await reload();
    } catch (err) { notify(failMessage(err, t('teamUpdated')), 'error'); }
    finally { setBusy(false); }
  };

  const removeTeam = async (team: Team) => {
    if (!window.confirm(`${t('deleteTeam')}: ${team.name}?`)) return;
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/teams/${team.id}`, { method: 'DELETE' });
      notify(t('teamDeleted'), 'success');
      await reload();
    } catch (err) { notify(failMessage(err, t('teamDeleted')), 'error'); }
    finally { setBusy(false); }
  };

  const moveMember = async (teamId: string, membershipId: string) => {
    if (!membershipId) return;
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/teams/${teamId}/members`, {
        method: 'POST', body: { membershipId },
      });
      notify(t('teamUpdated'), 'success');
      setMoveSelection((current) => ({ ...current, [teamId]: '' }));
      await reload();
    } catch (err) { notify(failMessage(err, t('teamUpdated')), 'error'); }
    finally { setBusy(false); }
  };

  const reviewRequest = async (request: GuestRequest, action: 'approve' | 'reject') => {
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/access-links/guest-requests/${request.id}/${action}`, { method: 'POST' });
      notify(action === 'approve' ? t('guestApproved') : t('guestRejected'), 'success');
      await reload();
    } catch (err) { notify(failMessage(err, t('approvalRequired')), 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="stack"><Skeleton height={90} />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={64} />)}</div>;
  if (error || !data) return <div className="error-banner">{error ?? t('loading')}</div>;

  const dateLabel = (iso: string) => new Date(iso).toLocaleString();

  return (
    <div className="rise">
      <PageHead title={t('teams')} subtitle={t('teamsSub')} />

      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${tab === 'teams' ? 'active' : ''}`} onClick={() => setTab('teams')}>
          {t('teams')} ({data.teams.length})
        </button>
        <button className={`tab ${tab === 'requests' ? 'active' : ''}`} onClick={() => setTab('requests')}>
          {t('guestRequests')} ({data.requests.length})
        </button>
      </div>

      {tab === 'teams' && <Card>
        <CardHead title={t('teams')} subtitle={`${data.teams.length} · ${data.members.length} ${t('members').toLowerCase()}`}
          action={teamManage && <Button variant="primary" size="sm" icon={<Plus size={15} />}
            onClick={() => setCreateOpen(true)}>{t('addTeam')}</Button>} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('teamName')}</th><th>{t('teamLead')}</th><th>{t('teamMembers')}</th>
            <th>{t('actions')}</th></tr></thead>
          <tbody>
            {data.teams.map((team) => (
              <tr key={team.id}>
                <td>
                  <div className="strong">{team.name}</div>
                  <div className="small muted">{team.description || '—'}</div>
                </td>
                <td>{team.leadName ?? <Badge tone="muted">{t('unassigned')}</Badge>}</td>
                <td className="mono">{team.memberCount}</td>
                <td>
                  <div className="row row-wrap" style={{ gap: 6 }}>
                    {teamManage && <>
                      <Button size="sm" icon={<UserPlus size={14} />} onClick={() => setEditing(team)}
                        disabled={busy}>{t('edit')}</Button>
                      <Select aria-label={t('moveMember')} value={moveSelection[team.id] ?? ''}
                        disabled={busy} onChange={(event) => {
                          const value = event.target.value;
                          setMoveSelection((current) => ({ ...current, [team.id]: value }));
                          if (value) void moveMember(team.id, value);
                        }}>
                        <option value="">{t('moveMember')}</option>
                        {data.members.filter((member) => member.team !== team.name).map((member) => (
                          <option key={member.id} value={member.id}>{member.name} · {member.team || t('unassigned')}</option>
                        ))}
                      </Select>
                      <Button size="sm" variant="danger" icon={<Trash2 size={14} />}
                        disabled={busy} onClick={() => void removeTeam(team)}>{t('delete')}</Button>
                    </>}
                    {!teamManage && <span className="small muted">—</span>}
                  </div>
                </td>
              </tr>
            ))}
            {!data.teams.length && <tr><td colSpan={4}>
              <EmptyState icon={<Users size={24} />} title={t('noTeams')} description={t('noTeamsHint')}
                action={teamManage && <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>{t('addTeam')}</Button>} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>}

      {tab === 'requests' && <Card>
        <CardHead title={t('guestRequests')} subtitle={t('guestWaiting')} />
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="info-banner"><ShieldCheck size={16} />{t('approvalRequired')}</div>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('guestName')}</th><th>{t('phone')}</th><th>{t('status')}</th>
            <th>{t('requestedAt')}</th>{guestManage && <th>{t('actions')}</th>}</tr></thead>
          <tbody>
            {data.requests.map((request) => (
              <tr key={request.id}>
                <td>{request.name}</td>
                <td className="mono small" dir="ltr">{request.phone ?? '—'}</td>
                <td><Badge tone={statusTone(request.status)}>{t(`status_${request.status}`)}</Badge></td>
                <td className="small mono">{dateLabel(request.createdAt)}</td>
                {guestManage && <td>
                  <div className="row row-wrap" style={{ gap: 6 }}>
                    <Button size="sm" variant="primary" disabled={request.status !== 'pending' || busy}
                      onClick={() => void reviewRequest(request, 'approve')}>{t('approve')}</Button>
                    <Button size="sm" variant="danger" disabled={request.status !== 'pending' || busy}
                      onClick={() => void reviewRequest(request, 'reject')}>{t('reject')}</Button>
                  </div>
                </td>}
              </tr>
            ))}
            {!data.requests.length && <tr><td colSpan={guestManage ? 5 : 4}>
              <EmptyState icon={<Inbox size={24} />} title={t('noGuestRequests')} description={t('approvalRequired')} />
            </td></tr>}
          </tbody>
        </table></div>
        {!guestManage && <div className="card-body small muted"><Clock3 size={13} style={{ verticalAlign: -2 }} /> {t('guestWaiting')}</div>}
      </Card>}

      {createOpen && <Modal title={t('addTeam')} onClose={() => setCreateOpen(false)} footer={
        <><Button onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form="team-create-form" loading={busy}>{t('create')}</Button></>
      }>
        <form id="team-create-form" className="form-grid" onSubmit={createTeam}>
          <Field label={t('teamName')} className="full"><Input name="name" required minLength={2} maxLength={80} /></Field>
          <Field label={t('teamDescription')} className="full"><Input name="description" maxLength={200} /></Field>
          <Field label={t('teamLead')} className="full">
            <Select name="leadUserId" defaultValue="">
              <option value="">{t('unassigned')}</option>
              {data.members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
            </Select>
          </Field>
        </form>
      </Modal>}

      {editing && <Modal title={`${t('edit')} · ${editing.name}`} onClose={() => setEditing(null)} footer={
        <><Button onClick={() => setEditing(null)}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form="team-edit-form" loading={busy}>{t('save')}</Button></>
      }>
        <form id="team-edit-form" className="form-grid" onSubmit={saveTeam}>
          <Field label={t('teamName')} className="full">
            <Input name="name" defaultValue={editing.name} required minLength={2} maxLength={80} />
          </Field>
          <Field label={t('teamDescription')} className="full">
            <Input name="description" defaultValue={editing.description} maxLength={200} />
          </Field>
          <Field label={t('teamLead')} className="full">
            <Select name="leadUserId" defaultValue={editing.leadUserId ?? ''}>
              <option value="">{t('unassigned')}</option>
              {data.members.map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
            </Select>
          </Field>
        </form>
      </Modal>}
    </div>
  );
}
