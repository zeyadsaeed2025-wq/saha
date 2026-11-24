import { Building2, CheckCircle2, Clock3, Info, Link2, LockKeyhole, Monitor, Radio, Save, ShieldCheck, Trash2, UploadCloud } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import {
  Badge, Button, Card, CardHead, ConfirmDialog, EmptyState, Field, Input, Modal, PageHead, Select,
  Skeleton, useAsync,
} from '../../components/ui.js';
import { PageError, PageLoading } from '../../components/PageStates.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { Organization, Room, Workspace } from '../../types.js';

interface SessionRow { id: string; createdAt: string; expiresAt: string; current: boolean }
interface WorkspaceDetail { workspace: Workspace; rooms: Room[] }

export function Settings() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const manageable = can(me?.role, 'org:update');
  const [form, setForm] = useState({ name: '', timezone: '', graceMinutesDefault: 10, heartbeatSeconds: 60, verificationWindowMinutes: 15 });
  // The form must never be editable before the loaded organization has been
  // copied into it; otherwise a fast edit can be overwritten by the load effect.
  const [formReady, setFormReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [confirmRevokeAll, setConfirmRevokeAll] = useState(false);
  const [editingRoom, setEditingRoom] = useState<Room | null>(null);
  const [roomPrivacy, setRoomPrivacy] = useState<'public' | 'private'>('public');
  const [roomCapacity, setRoomCapacity] = useState(20);

  const { data, loading, error, reload, setData } = useAsync(async () => {
    const [org, sessions, workspaces] = await Promise.all([
      api<{ organization: Organization }>(`/orgs/${orgId}`),
      api<{ sessions: SessionRow[] }>('/auth/sessions'),
      api<{ workspaces: Workspace[] }>(`/orgs/${orgId}/workspaces`),
    ]);
    const details = await Promise.all(workspaces.workspaces.map((w) =>
      api<WorkspaceDetail>(`/orgs/${orgId}/workspaces/${w.id}`)));
    return { organization: org.organization, sessions: sessions.sessions, details };
  }, [orgId]);

  useEffect(() => {
    if (!data?.organization) return;
    setFormReady(false);
    setForm({
      name: data.organization.name,
      timezone: data.organization.timezone,
      graceMinutesDefault: data.organization.settings.graceMinutesDefault,
      heartbeatSeconds: data.organization.settings.heartbeatSeconds,
      verificationWindowMinutes: data.organization.settings.verificationWindowMinutes,
    });
    setFormReady(true);
  }, [data?.organization]);

  const saveOrg = async (event: FormEvent) => {
    event.preventDefault(); setBusy(true);
    try {
      const result = await api<{ organization: Organization }>(`/orgs/${orgId}`, { method: 'PATCH', body: form });
      setData((current) => current ? { ...current, organization: result.organization } : current);
      notify(t('orgDetailsSaved'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not save settings', 'error'); }
    finally { setBusy(false); }
  };

  const revokeSession = async (session: SessionRow) => {
    if (session.current) return;
    try {
      await api(`/auth/sessions/${session.id}`, { method: 'DELETE' });
      setData((current) => current ? { ...current, sessions: current.sessions.filter((s) => s.id !== session.id) } : current);
      notify(t('linkRevoked'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not revoke session', 'error'); }
  };

  const revokeOthers = async () => {
    const others = data?.sessions.filter((s) => !s.current) ?? [];
    if (!others.length) return;
    try {
      await Promise.all(others.map((s) => api(`/auth/sessions/${s.id}`, { method: 'DELETE' })));
      setData((current) => current ? { ...current, sessions: current.sessions.filter((s) => s.current) } : current);
      notify(t('revokedAll'), 'success');
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not revoke sessions', 'error'); }
  };

  const openRoom = (room: Room) => {
    setEditingRoom(room);
    setRoomPrivacy(room.privacy);
    setRoomCapacity(room.capacity);
  };

  const saveRoom = async () => {
    if (!editingRoom) return;
    setBusy(true);
    try {
      const result = await api<{ room: Room }>(
        `/orgs/${orgId}/workspaces/${editingRoom.workspaceId}/rooms/${editingRoom.id}`,
        { method: 'PATCH', body: { privacy: roomPrivacy, capacity: roomCapacity } },
      );
      setData((current) => current ? {
        ...current,
        details: current.details.map((detail) => detail.workspace.id === editingRoom.workspaceId
          ? { ...detail, rooms: detail.rooms.map((room) => room.id === editingRoom.id ? result.room : room) }
          : detail),
      } : current);
      notify(t('roomUpdated'), 'success');
      setEditingRoom(null);
    } catch (err) { notify(err instanceof Error ? err.message : 'Could not update room', 'error'); }
    finally { setBusy(false); }
  };

  if (error) return <PageError message={error} onRetry={reload} />;
  if (loading || !formReady) return <PageLoading rows={2} />;
  if (!data) return <PageError message={t('loading')} />;

  const integrations = [
    { icon: <Radio size={20} />, title: t('livekit'), body: t('livekitDesc') },
    { icon: <UploadCloud size={20} />, title: t('drive'), body: t('driveDesc') },
    { icon: <Link2 size={20} />, title: t('sms'), body: t('smsDesc') },
  ];

  return (
    <div className="rise">
      <PageHead title={t('settingsTitle')} subtitle={t('settingsSub')} />

      <div className="grid grid-2" style={{ marginBottom: 20 }}>
        <Card>
          <CardHead title={t('settingsOrg')} subtitle={data.organization.slug} />
          <form className="card-body form-grid" onSubmit={saveOrg}>
            <Field label={t('orgName')} className="full">
              <Input value={form.name} onChange={(e) => setForm((current) => ({ ...current, name: e.target.value }))}
                disabled={!manageable} minLength={2} maxLength={80} required />
            </Field>
            <Field label={t('timezone')} className="full">
              <Input value={form.timezone} onChange={(e) => setForm((current) => ({ ...current, timezone: e.target.value }))}
                disabled={!manageable} dir="ltr" required />
            </Field>
            <Field label={t('graceDefault')}>
              <Input type="number" value={form.graceMinutesDefault}
                onChange={(e) => setForm((current) => ({ ...current, graceMinutesDefault: Number(e.target.value) }))}
                disabled={!manageable} min={0} max={120} />
            </Field>
            <Field label={t('heartbeatTimeout')}>
              <Input type="number" value={form.heartbeatSeconds}
                onChange={(e) => setForm((current) => ({ ...current, heartbeatSeconds: Number(e.target.value) }))}
                disabled={!manageable} min={10} max={600} />
            </Field>
            <Field label={t('verificationWindow')} className="full">
              <Input type="number" value={form.verificationWindowMinutes}
                onChange={(e) => setForm((current) => ({ ...current, verificationWindowMinutes: Number(e.target.value) }))}
                disabled={!manageable} min={0} max={240} />
            </Field>
            {manageable && <div className="full"><Button variant="primary" type="submit" icon={<Save size={15} />} loading={busy}>
              {t('save')}
            </Button></div>}
            {data.organization.settings.demo && <div className="full info-banner">
              <Info size={16} />{t('demoData')} — {t('demo')} organization, separated from real customer data.
            </div>}
          </form>
        </Card>

        <Card>
          <CardHead title={t('activeSessions')} subtitle={`${data.sessions.length}`} action={
            data.sessions.some((s) => !s.current) && <Button size="sm" variant="danger" icon={<LockKeyhole size={14} />}
              onClick={() => setConfirmRevokeAll(true)}>{t('revokeAllOther')}</Button>
          } />
          <div className="card-body stack" style={{ gap: 8 }}>
            {data.sessions.map((session) => (
              <div key={session.id} className="presence-item">
                <span className="avatar sm" style={{ background: session.current ? 'var(--primary)' : 'var(--muted)' }}>
                  {session.current ? <CheckCircle2 size={15} /> : <Monitor size={15} />}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div className="presence-item__name">{session.current ? t('currentSession') : session.id.slice(0, 12)}</div>
                  <div className="presence-item__room mono">{new Date(session.createdAt).toLocaleString()}</div>
                </div>
                {session.current
                  ? <Badge tone="success">{t('active')}</Badge>
                  : <Button size="sm" variant="danger" icon={<Trash2 size={13} />} onClick={() => revokeSession(session)}>
                    {t('revoke')}
                  </Button>}
              </div>
            ))}
            {!data.sessions.length && <EmptyState icon={<ShieldCheck size={22} />} title={t('noData')} />}
          </div>
        </Card>
      </div>

      <Card style={{ marginBottom: 20 }}>
        <CardHead title={t('workspaceSettings')} subtitle={`${data.details.length} ${t('workspaces').toLowerCase()}`} />
        <div className="grid grid-2 card-body">
          {data.details.map((detail) => (
            <div key={detail.workspace.id} className="panel" style={{ padding: 16 }}>
              <div className="row" style={{ justifyContent: 'space-between' }}>
                <div><div className="strong">{detail.workspace.name}</div>
                  <div className="small muted">{detail.workspace.description}</div></div>
                <Badge tone="primary" plain>{detail.rooms.length}</Badge>
              </div>
              <div className="divider" />
              <div className="room-list">
                {detail.rooms.map((room) => (
                  <button key={room.id} className="room-item" onClick={() => manageable && openRoom(room)}
                    disabled={!manageable} title={manageable ? t('edit') : undefined}>
                    <span className="room-item__dot" style={{ background: room.color }} />
                    <span style={{ flex: 1 }}>
                      <span className="room-item__name">{room.name}</span>
                      <span className="small muted" style={{ display: 'block' }}>
                        {room.privacy === 'private' ? t('privateRoomSetting') : t('public')} · {room.kind}
                      </span>
                    </span>
                    <Badge tone="muted" plain>{room.capacity}</Badge>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!data.details.length && <EmptyState icon={<Building2 size={22} />} title={t('noData')} />}
        </div>
      </Card>

      <Card>
        <CardHead title={t('integrations')} subtitle={t('integrationStatus')} />
        <div className="grid grid-3 card-body">
          {integrations.map((item) => (
            <div key={item.title} className="feature">
              <div className="feature__icon">{item.icon}</div>
              <div className="row row-wrap" style={{ justifyContent: 'space-between' }}>
                <h3>{item.title}</h3><Badge tone="warning" plain>{t('deferredBadge')}</Badge>
              </div>
              <p>{item.body}</p>
            </div>
          ))}
        </div>
        <div className="card-body" style={{ paddingTop: 0 }}>
          <div className="deferred-note"><Clock3 size={15} style={{ flex: '0 0 auto' }} />
            <span>{t('comingSoon')}. {t('verifiedOnly')}</span>
          </div>
        </div>
      </Card>

      {editingRoom && <Modal title={`${t('edit')} · ${editingRoom.name}`} onClose={() => setEditingRoom(null)} footer={
        <><Button onClick={() => setEditingRoom(null)}>{t('cancel')}</Button>
          <Button variant="primary" loading={busy} onClick={saveRoom}>{t('saveRoom')}</Button></>
      }>
        <div className="form-grid">
          <Field label={t('roomPrivacy')}>
            <Select value={roomPrivacy} onChange={(e) => setRoomPrivacy(e.target.value as 'public' | 'private')}>
              <option value="public">{t('public')}</option>
              <option value="private">{t('privateRoomSetting')}</option>
            </Select>
          </Field>
          <Field label={t('capacity')}>
            <Input type="number" min={1} max={200} value={roomCapacity}
              onChange={(e) => setRoomCapacity(Number(e.target.value))} />
          </Field>
        </div>
        <div className="info-banner" style={{ marginTop: 16 }}>
          <Info size={16} />{t('guestNotice')}
        </div>
      </Modal>}

      {confirmRevokeAll && <ConfirmDialog title={t('revokeAllOther')}
        message={`${t('revokeAllOther')}?`} confirmLabel={t('revokeAllOther')}
        onConfirm={revokeOthers} onClose={() => setConfirmRevokeAll(false)} />}
    </div>
  );
}
