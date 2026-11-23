import { Copy, Link2, Mail, ShieldCheck, Trash2, UserPlus, Users } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, PageHead, Select, Skeleton, useAsync,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { AccessLink, AccessLinkKind, Invitation, Member, Room, Workspace } from '../../types.js';

interface WorkspaceDetail { workspace: Workspace; rooms: Room[] }
interface CreatedLink { url: string; label: string }

async function copyText(value: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(value); return true; }
  } catch { /* fall through to legacy copy */ }
  const area = document.createElement('textarea');
  area.value = value;
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  const ok = document.execCommand('copy');
  area.remove();
  return ok;
}

export function Invitations() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const manageable = can(me?.role, 'invitation:manage');
  const [tab, setTab] = useState<'invitations' | 'links'>('invitations');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [created, setCreated] = useState<CreatedLink | null>(null);
  const [busy, setBusy] = useState(false);
  const [linkKind, setLinkKind] = useState<AccessLinkKind>('passwordless_member');
  const [workspaceId, setWorkspaceId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [subjectUserId, setSubjectUserId] = useState('');
  const [requiresApproval, setRequiresApproval] = useState(false);

  const linkLabel = (kind: AccessLinkKind) => kind === 'public_guest' ? t('publicGuestLink')
    : kind === 'passwordless_member' ? t('passwordlessMemberLink')
      : kind === 'passwordless_access' ? t('passwordlessAccessLink')
        : kind === 'member_invitation' ? t('memberInvitation') : t('privateWorkspaceLink');

  const { data, loading, error, reload } = useAsync(async () => {
    const [invitations, links, workspaceList, members] = await Promise.all([
      api<{ invitations: Invitation[] }>(`/orgs/${orgId}/invitations`),
      api<{ links: AccessLink[] }>(`/orgs/${orgId}/access-links`),
      api<{ workspaces: Workspace[] }>(`/orgs/${orgId}/workspaces`),
      api<{ members: Member[] }>(`/orgs/${orgId}/members`),
    ]);
    const details = await Promise.all(workspaceList.workspaces.map((w) =>
      api<WorkspaceDetail>(`/orgs/${orgId}/workspaces/${w.id}`)));
    return {
      invitations: invitations.invitations,
      links: links.links,
      workspaces: workspaceList.workspaces,
      details,
      members: members.members,
    };
  }, [orgId]);

  const createInvitation = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    const phone = String(form.get('phone') ?? '').trim();
    const email = String(form.get('email') ?? '').trim();
    try {
      const result = await api<{ url: string }>(`/orgs/${orgId}/invitations`, {
        method: 'POST',
        body: {
          ...(phone ? { phone } : {}),
          ...(email ? { email } : {}),
          role: form.get('role'),
          team: form.get('team'),
          expiresInHours: Number(form.get('expiresInHours')),
          maxUses: Number(form.get('maxUses')),
        },
      });
      setCreated({ url: result.url, label: t('memberInvitation') });
      setInviteOpen(false);
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not create invitation', 'error'); }
    finally { setBusy(false); }
  };

  const createLink = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ url: string }>(`/orgs/${orgId}/access-links`, {
        method: 'POST',
        body: {
          kind: linkKind,
          workspaceId: workspaceId || form.get('workspaceId'),
          roomId: roomId || null,
          subjectUserId: linkKind === 'public_guest' ? null : subjectUserId || form.get('subjectUserId'),
          ...(linkKind === 'public_guest' ? { requiresApproval } : {}),
          expiresInHours: Number(form.get('expiresInHours')),
          maxUses: Number(form.get('maxUses')),
        },
      });
      setCreated({ url: result.url, label: linkLabel(linkKind) });
      setLinkOpen(false);
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not create access link', 'error'); }
    finally { setBusy(false); }
  };

  const revoke = async (path: string) => {
    try {
      await api(path, { method: 'POST' });
      notify(t('linkRevoked'), 'success');
      await reload();
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not revoke', 'error'); }
  };

  const copy = async () => {
    if (!created) return;
    const ok = await copyText(created.url);
    notify(ok ? t('copiedToClipboard') : 'Copy failed — select and copy the link manually', ok ? 'success' : 'error');
  };

  if (loading) return <div className="stack"><Skeleton height={90} />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={64} />)}</div>;
  if (error || !data) return <div className="error-banner">{error ?? t('loading')}</div>;

  const rooms = data.details.find((d) => d.workspace.id === workspaceId)?.rooms ?? [];
  const dateLabel = (iso: string) => new Date(iso).toLocaleString();

  return (
    <div className="rise">
      <PageHead title={t('invTitle')} subtitle={t('invSub')} />
      <div className="tabs" style={{ marginBottom: 20 }}>
        <button className={`tab ${tab === 'invitations' ? 'active' : ''}`} onClick={() => setTab('invitations')}>
          {t('invitationList')} ({data.invitations.length})
        </button>
        <button className={`tab ${tab === 'links' ? 'active' : ''}`} onClick={() => setTab('links')}>
          {t('accessLinkList')} ({data.links.length})
        </button>
      </div>

      {tab === 'invitations' && <Card>
        <CardHead title={t('invitationList')} subtitle={t('tokenNotice')} action={manageable &&
          <Button variant="primary" size="sm" icon={<UserPlus size={15} />} onClick={() => setInviteOpen(true)}>
            {t('createInvitation')}
          </Button>} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('role')}</th><th>{t('team')}</th><th>{t('invitationForPhone')}</th>
            <th>{t('expiresAt')}</th><th>{t('linkUses')}</th><th>{t('status')}</th>{manageable && <th>{t('actions')}</th>}</tr></thead>
          <tbody>
            {data.invitations.map((invite) => (
              <tr key={invite.id}>
                <td><Badge tone="primary" plain>{invite.role}</Badge></td>
                <td>{invite.team}</td>
                <td className="mono small" dir="ltr">{invite.phone ?? '—'}</td>
                <td className="small mono">{dateLabel(invite.expiresAt)}</td>
                <td className="mono">{invite.uses}/{invite.maxUses}</td>
                <td><Badge tone={invite.active ? 'success' : 'muted'}>{invite.active ? t('active') : t('expired')}</Badge></td>
                {manageable && <td><Button size="sm" variant="danger" icon={<Trash2 size={14} />}
                  disabled={!invite.active} onClick={() => revoke(`/orgs/${orgId}/invitations/${invite.id}/revoke`)}>
                  {t('revoke')}
                </Button></td>}
              </tr>
            ))}
            {!data.invitations.length && <tr><td colSpan={manageable ? 7 : 6}>
              <EmptyState icon={<Mail size={24} />} title={t('noInvitations')} description={t('noLinksHint')}
                action={manageable && <Button variant="primary" size="sm" onClick={() => setInviteOpen(true)}>{t('createInvitation')}</Button>} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>}

      {tab === 'links' && <Card>
        <CardHead title={t('accessLinkList')} subtitle={t('guestNotice')} action={manageable &&
          <Button variant="primary" size="sm" icon={<Link2 size={15} />} onClick={() => setLinkOpen(true)}>
            {t('createLink')}
          </Button>} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('linkType')}</th><th>{t('workspace')}</th><th>{t('linkSubject')}</th>
            <th>{t('expiresAt')}</th><th>{t('linkUses')}</th><th>{t('status')}</th>{manageable && <th>{t('actions')}</th>}</tr></thead>
          <tbody>
            {data.links.map((link) => (
              <tr key={link.id}>
                <td><Badge tone={link.kind === 'public_guest' ? 'accent' : 'primary'} plain>
                  {linkLabel(link.kind)}
                </Badge>
                {link.requiresApproval && <div className="small muted">{t('approvalRequired')}</div>}</td>
                <td>{data.workspaces.find((w) => w.id === link.workspaceId)?.name ?? '—'}</td>
                <td className="small">{data.members.find((m) => m.userId === link.subjectUserId)?.name ?? '—'}</td>
                <td className="small mono">{dateLabel(link.expiresAt)}</td>
                <td className="mono">{link.uses}/{link.maxUses}</td>
                <td><Badge tone={link.active ? 'success' : 'muted'}>{link.active ? t('active') : t('expired')}</Badge></td>
                {manageable && <td><Button size="sm" variant="danger" icon={<Trash2 size={14} />}
                  disabled={!link.active} onClick={() => revoke(`/orgs/${orgId}/access-links/${link.id}/revoke`)}>
                  {t('revoke')}
                </Button></td>}
              </tr>
            ))}
            {!data.links.length && <tr><td colSpan={manageable ? 7 : 6}>
              <EmptyState icon={<Link2 size={24} />} title={t('noLinks')} description={t('noLinksHint')}
                action={manageable && <Button variant="primary" size="sm" onClick={() => setLinkOpen(true)}>{t('createLink')}</Button>} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>}

      {inviteOpen && <Modal title={t('createInvitation')} onClose={() => setInviteOpen(false)} footer={
        <><Button onClick={() => setInviteOpen(false)}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form="invite-form" loading={busy}>{t('createLink')}</Button></>
      }>
        <form id="invite-form" className="form-grid" onSubmit={createInvitation}>
          <Field label={t('invitationForPhone')} className="full">
            <Input name="phone" dir="ltr" placeholder="+20 100 000 0001" />
          </Field>
          <Field label="Email (optional)" className="full"><Input name="email" type="email" placeholder="lina@example.com" /></Field>
          <Field label={t('role')}><Select name="role" defaultValue="student">
            <option value="student">student</option><option value="mentor">mentor</option><option value="org_admin">org_admin</option>
          </Select></Field>
          <Field label={t('team')}><Input name="team" defaultValue="General" required /></Field>
          <Field label={t('expiryHours')}><Input name="expiresInHours" type="number" defaultValue={168} min={1} max={720} required /></Field>
          <Field label={t('maxUses')}><Input name="maxUses" type="number" defaultValue={1} min={1} max={50} required /></Field>
        </form>
      </Modal>}

      {linkOpen && <Modal title={t('createLink')} onClose={() => setLinkOpen(false)} footer={
        <><Button onClick={() => setLinkOpen(false)}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form="link-form" loading={busy}>{t('createLink')}</Button></>
      }>
        <form id="link-form" className="form-grid" onSubmit={createLink}>
          <Field label={t('linkType')} className="full">
            <Select value={linkKind} onChange={(e) => {
              setLinkKind(e.target.value as typeof linkKind);
              setSubjectUserId('');
            }}>
              <option value="private_workspace">{t('privateWorkspaceLink')}</option>
              <option value="public_guest">{t('publicGuestLink')}</option>
              <option value="member_invitation">{t('memberInvitation')}</option>
              <option value="passwordless_access">{t('passwordlessAccessLink')}</option>
              <option value="passwordless_member">{t('passwordlessMemberLink')}</option>
            </Select>
          </Field>
          <Field label={t('workspace')} className="full">
            <Select name="workspaceId" value={workspaceId} onChange={(e) => { setWorkspaceId(e.target.value); setRoomId(''); }} required>
              <option value="" disabled>—</option>
              {data.workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </Select>
          </Field>
          <Field label={t('optionalRoom')}>
            <Select value={roomId} onChange={(e) => setRoomId(e.target.value)}>
              <option value="">{t('all')}</option>
              {rooms.map((room) => <option key={room.id} value={room.id}>{room.name}</option>)}
            </Select>
          </Field>
          <Field label={t('linkSubject')}>
            <Select name="subjectUserId" value={subjectUserId} onChange={(e) => setSubjectUserId(e.target.value)}
              disabled={linkKind === 'public_guest'} required={linkKind !== 'public_guest'}>
              <option value="">—</option>
              {data.members.map((m) => <option key={m.userId} value={m.userId}>{m.name} · {m.team}</option>)}
            </Select>
          </Field>
          <Field label={t('expiryHours')}><Input name="expiresInHours" type="number" defaultValue={24} min={1} max={168} required /></Field>
          <Field label={t('maxUses')}><Input name="maxUses" type="number" defaultValue={10} min={1} max={100} required /></Field>
          {linkKind === 'public_guest' && <Field label={t('requiresApprovalLabel')} className="full" hint={t('guestNotice')}>
            <label className="row" style={{ gap: 8 }}>
              <input type="checkbox" checked={requiresApproval} onChange={(e) => setRequiresApproval(e.target.checked)} />
              <span>{t('approvalRequired')}</span>
            </label>
          </Field>}
        </form>
        <div className="info-banner" style={{ marginTop: 16 }}><ShieldCheck size={16} />{t('tokenNotice')}</div>
      </Modal>}

      {created && <Modal title={`${t('linkCreated')} · ${created.label}`} onClose={() => setCreated(null)} footer={
        <><Button icon={<Copy size={15} />} onClick={copy}>{t('copyLink')}</Button>
          <Button variant="primary" onClick={() => setCreated(null)}>{t('close')}</Button></>
      }>
        <div className="stack">
          <div className="info-banner"><ShieldCheck size={16} />{t('rawLinkNotice')}</div>
          <Field label={t('linkDetails')}>
            <Input readOnly value={created.url} dir="ltr" onFocus={(e) => e.currentTarget.select()} />
          </Field>
          <div className="small muted"><Users size={13} style={{ verticalAlign: -2 }} /> {t('guestNotice')}</div>
        </div>
      </Modal>}
    </div>
  );
}
