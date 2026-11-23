import { KeyRound, Search, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, PageHead, Select, Skeleton,
  useAsync,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { Member } from '../../types.js';

interface CreatedMember { name: string; phone: string; temporaryPassword: string | null }

export function Members() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const manageable = can(me?.role, 'member:manage');
  const [search, setSearch] = useState('');
  const [team, setTeam] = useState('');
  const [role, setRole] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [editing, setEditing] = useState<Member | null>(null);
  const [editRole, setEditRole] = useState('student');
  const [editTeam, setEditTeam] = useState('');
  const [editStatus, setEditStatus] = useState('active');
  const [created, setCreated] = useState<CreatedMember | null>(null);
  const [busy, setBusy] = useState(false);

  const { data, loading, error, reload, setData } = useAsync(async () => {
    const result = await api<{ members: Member[] }>(`/orgs/${orgId}/members`);
    return result.members;
  }, [orgId]);

  const add = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') ?? '');
    const phone = String(form.get('phone') ?? '');
    try {
      const result = await api<{ temporaryPassword: string | null; notice: string | null }>(
        `/orgs/${orgId}/members`,
        { method: 'POST', body: { name, phone, role: form.get('role'), team: form.get('team') } },
      );
      setCreated({ name, phone, temporaryPassword: result.temporaryPassword });
      setAddOpen(false);
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not add member', 'error'); }
    finally { setBusy(false); }
  };

  const openEdit = (member: Member) => {
    setEditing(member);
    setEditRole(member.role);
    setEditTeam(member.team);
    setEditStatus(member.status);
  };

  const saveEdit = async () => {
    if (!editing) return;
    setBusy(true);
    try {
      const result = await api<{ membership: Member }>(`/orgs/${orgId}/members/${editing.id}`, {
        method: 'PATCH', body: { role: editRole, team: editTeam, status: editStatus },
      });
      setData((current) => current?.map((m) => (m.id === editing.id ? { ...m, ...result.membership } : m)) ?? current);
      notify(t('saved'), 'success');
      setEditing(null);
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not update member', 'error'); }
    finally { setBusy(false); }
  };

  const remove = async (member: Member) => {
    if (member.userId === me?.user.id) { notify(t('cannotRemoveSelf'), 'error'); return; }
    if (!window.confirm(`${t('removeMember')}: ${member.name}?`)) return;
    try {
      await api(`/orgs/${orgId}/members/${member.id}`, { method: 'DELETE' });
      setData((current) => current?.filter((m) => m.id !== member.id) ?? current);
      notify(t('saved'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not remove member', 'error'); }
  };

  if (loading) return <div className="stack"><Skeleton height={90} />{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} height={58} />)}</div>;
  if (error || !data) return <div className="error-banner">{error ?? t('loading')}</div>;

  const teams = [...new Set(data.map((m) => m.team))].sort();
  const filtered = data.filter((m) => {
    const query = search.trim().toLowerCase();
    return (!query || m.name.toLowerCase().includes(query) || m.phone.includes(query))
      && (!team || m.team === team) && (!role || m.role === role);
  });

  return (
    <div className="rise">
      <PageHead title={t('members')} subtitle={t('membersSub')} actions={
        manageable && <Button variant="primary" icon={<UserPlus size={16} />} onClick={() => setAddOpen(true)}>{t('addMember')}</Button>
      } />

      <Card>
        <CardHead title={`${data.length} ${t('members').toLowerCase()}`} subtitle={t('membersSub')} />
        <div className="card-body" style={{ paddingBottom: 0 }}>
          <div className="toolbar" style={{ margin: 0 }}>
            <Input aria-label={t('memberSearch')} placeholder={t('memberSearch')} value={search}
              onChange={(e) => setSearch(e.target.value)} />
            <Select aria-label={t('team')} value={team} onChange={(e) => setTeam(e.target.value)}>
              <option value="">{t('allTeams')}</option>
              {teams.map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
            <Select aria-label={t('role')} value={role} onChange={(e) => setRole(e.target.value)}>
              <option value="">{t('allRoles')}</option>
              {['org_admin', 'mentor', 'student'].map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </div>
        </div>
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('name')}</th><th>{t('phone')}</th><th>{t('team')}</th><th>{t('role')}</th><th>{t('status')}</th>
            {manageable && <th>{t('actions')}</th>}</tr></thead>
          <tbody>
            {filtered.map((member) => {
              const isSelf = member.userId === me?.user.id;
              return (
                <tr key={member.id}>
                  <td className="cell-strong">{member.name}{isSelf && <div className="small muted">({t('you')})</div>}</td>
                  <td className="mono small" dir="ltr">{member.phone}</td>
                  <td>{member.team}</td>
                  <td><Badge tone={member.role === 'org_admin' ? 'primary' : member.role === 'mentor' ? 'accent' : 'muted'} plain>{member.role}</Badge></td>
                  <td><Badge tone={member.status === 'active' ? 'success' : 'danger'}>{member.status}</Badge></td>
                  {manageable && <td><div className="row">
                    <Button size="sm" icon={<ShieldCheck size={14} />} onClick={() => openEdit(member)}>{t('edit')}</Button>
                    <Button size="sm" variant="danger" icon={<Trash2 size={14} />} disabled={isSelf}
                      onClick={() => remove(member)} title={isSelf ? t('cannotRemoveSelf') : t('removeMember')}>{t('remove')}</Button>
                  </div></td>}
                </tr>
              );
            })}
            {!filtered.length && <tr><td colSpan={manageable ? 6 : 5}>
              <EmptyState icon={<Users size={24} />} title={t('noMembers')} description={t('noMembersHint')}
                action={manageable && <Button variant="primary" size="sm" onClick={() => setAddOpen(true)}>{t('addMember')}</Button>} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>

      {addOpen && <Modal title={t('addMemberTitle')} onClose={() => setAddOpen(false)} footer={
        <><Button onClick={() => setAddOpen(false)}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form="member-form" loading={busy}>{t('create')}</Button></>
      }>
        <form id="member-form" className="form-grid" onSubmit={add}>
          <Field label={t('name')} className="full"><Input name="name" required minLength={2} maxLength={80}
            placeholder="Lina Hassan" /></Field>
          <Field label={t('phone')} className="full"><Input name="phone" required dir="ltr"
            placeholder="+20 100 000 0001" /></Field>
          <Field label={t('role')}><Select name="role" defaultValue="student">
            <option value="student">student</option>
            <option value="mentor">mentor</option>
            <option value="org_admin">org_admin</option>
          </Select></Field>
          <Field label={t('team')}><Input name="team" defaultValue="General" required maxLength={60} /></Field>
        </form>
      </Modal>}

      {editing && <Modal title={`${t('edit')} · ${editing.name}`} onClose={() => setEditing(null)} footer={
        <><Button onClick={() => setEditing(null)}>{t('cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={saveEdit}>{t('save')}</Button></>
      }>
        <div className="form-grid">
          <Field label={t('role')} hint={editing.userId === me?.user.id ? t('selfRoleError') : undefined}>
            <Select value={editRole} onChange={(e) => setEditRole(e.target.value)}
              disabled={editing.userId === me?.user.id}>
              {['student', 'mentor', 'org_admin'].map((value) => <option key={value} value={value}>{value}</option>)}
            </Select>
          </Field>
          <Field label={t('team')}><Input value={editTeam} onChange={(e) => setEditTeam(e.target.value)}
            maxLength={60} required /></Field>
          <Field label={t('status')} className="full">
            <Select value={editStatus} onChange={(e) => setEditStatus(e.target.value)}
              disabled={editing.userId === me?.user.id}>
              <option value="active">{t('active')}</option>
              <option value="suspended">{t('suspend')}</option>
            </Select>
          </Field>
        </div>
      </Modal>}

      {created && <Modal title={t('temporaryPassword')} onClose={() => setCreated(null)} footer={
        <Button variant="primary" onClick={() => setCreated(null)}>{t('close')}</Button>
      }>
        <div className="stack">
          <div className="info-banner"><KeyRound size={16} />{t('temporaryHint')}</div>
          <div className="panel" style={{ padding: 16 }}>
            <div className="small muted">{created.name} · <span dir="ltr">{created.phone}</span></div>
            {created.temporaryPassword
              ? <div className="mono strong" dir="ltr" style={{ fontSize: 'var(--text-lg)', marginTop: 8 }}>
                {created.temporaryPassword}
              </div>
              : <div className="small" style={{ marginTop: 8 }}>{t('saved')}</div>}
          </div>
        </div>
      </Modal>}
    </div>
  );
}
