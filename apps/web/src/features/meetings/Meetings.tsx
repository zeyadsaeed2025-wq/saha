import { AlertTriangle, CalendarDays, KeyRound, Mic, MicOff, MonitorUp, Plus, Radio, Users, Video, VideoOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, PageHead, Select, Skeleton, useAsync,
} from '../../components/ui.js';
import { PageError, PageLoading } from '../../components/PageStates.js';
import { api, ApiError } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { Meeting, MeetingParticipant, Workspace } from '../../types.js';

interface MediaStatus { provider: string; configured: boolean; url: string | null; message: string | null }
interface MeetingDetail { meeting: Meeting; participants: MeetingParticipant[] }
interface MediaToken { token: string; url: string; expiresAt: string; identity: string }
type ControlField = 'micEnabled' | 'cameraEnabled' | 'sharing';

const failMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

const statusTone = (status: string): 'success' | 'warning' | 'muted' =>
  status === 'live' ? 'success' : status === 'ended' ? 'muted' : 'warning';

export function Meetings() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const manageable = can(me?.role, 'meeting:manage');

  const [createOpen, setCreateOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [joinedIds, setJoinedIds] = useState<string[]>([]);
  const [detail, setDetail] = useState<MeetingDetail | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [token, setToken] = useState<MediaToken | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [meetingResult, workspaceResult, statusResult] = await Promise.all([
      api<{ meetings: Meeting[] }>(`/orgs/${orgId}/media/meetings`),
      api<{ workspaces: Workspace[] }>(`/orgs/${orgId}/workspaces`),
      api<MediaStatus>(`/orgs/${orgId}/media/status`),
    ]);
    return {
      meetings: meetingResult.meetings,
      workspaces: workspaceResult.workspaces,
      mediaStatus: statusResult,
    };
  }, [orgId]);

  const openDetail = async (meetingId: string) => {
    setDetailId(meetingId);
    setDetail(null);
    setToken(null);
    setTokenError(null);
    setDetailError(null);
    setDetailLoading(true);
    try {
      const result = await api<MeetingDetail>(`/orgs/${orgId}/media/meetings/${meetingId}`);
      setDetail(result);
    } catch (err) { setDetailError(failMessage(err, t('loading'))); }
    finally { setDetailLoading(false); }
  };

  const createMeeting = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ meeting: Meeting }>(`/orgs/${orgId}/media/meetings`, {
        method: 'POST',
        body: {
          title: String(form.get('title') ?? '').trim(),
          workspaceId: String(form.get('workspaceId') ?? ''),
          roomId: String(form.get('roomId') ?? '') || null,
        },
      });
      notify(t('newMeeting'), 'success');
      setCreateOpen(false);
      await reload();
      if (result.meeting) void openDetail(result.meeting.id);
    } catch (err) { notify(failMessage(err, t('newMeeting')), 'error'); }
    finally { setBusy(false); }
  };

  const changeStatus = async (meetingId: string, action: 'start' | 'end' | 'join' | 'leave') => {
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/media/meetings/${meetingId}/${action}`, { method: 'POST' });
      const label = action === 'start' ? t('startMeeting') : action === 'end' ? t('endMeeting')
        : action === 'join' ? t('joinMeeting') : t('leaveMeeting');
      notify(label, 'success');
      setJoinedIds((current) => action === 'join' ? [...new Set([...current, meetingId])]
        : action === 'leave' ? current.filter((id) => id !== meetingId) : current);
      await reload();
      if (detailId === meetingId) await openDetail(meetingId);
    } catch (err) { notify(failMessage(err, t('meetings')), 'error'); }
    finally { setBusy(false); }
  };

  const patchControl = async (field: ControlField, value: boolean) => {
    if (!detail) return;
    setBusy(true);
    try {
      const result = await api<{ participant: MeetingParticipant }>(
        `/orgs/${orgId}/media/meetings/${detail.meeting.id}/controls`,
        { method: 'PATCH', body: { [field]: value } },
      );
      setDetail((current) => current ? {
        ...current,
        participants: current.participants.map((p) => p.id === result.participant.id ? result.participant : p),
      } : current);
      notify(t('mediaControls'), 'success');
    } catch (err) { notify(failMessage(err, t('mediaControls')), 'error'); }
    finally { setBusy(false); }
  };

  const getToken = async (meetingId: string) => {
    setBusy(true);
    setToken(null);
    setTokenError(null);
    try {
      const result = await api<MediaToken>(`/orgs/${orgId}/media/token`, {
        method: 'POST', body: { meetingId },
      });
      setToken(result);
      notify(t('tokenReady'), 'success');
    } catch (err) {
      const unavailable = err instanceof ApiError && err.status === 503;
      const message = `${unavailable ? `${t('tokenUnavailable')} — ` : ''}${failMessage(err, t('providerNotConfigured'))}`;
      setTokenError(message);
      notify(message, 'error');
    } finally { setBusy(false); }
  };

  if (loading) return <PageLoading />;
  if (error || !data) return <PageError message={error ?? t('loading')} onRetry={reload} />;

  const dateLabel = (iso: string | null) => iso ? new Date(iso).toLocaleString() : '—';
  const currentParticipant = detail?.participants.find((p) => p.userId === me?.user.id && !p.leftAt) ?? null;

  return (
    <div className="rise">
      <PageHead title={t('meetings')} subtitle={t('meetingsSub')} actions={manageable &&
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>{t('newMeeting')}</Button>} />

      <div className={data.mediaStatus.configured ? 'info-banner' : 'deferred-note'} style={{ marginBottom: 20 }}>
        {data.mediaStatus.configured ? <Radio size={16} /> : <AlertTriangle size={16} />}
        <span>
          <strong>{t('providerStatus')}:</strong> {data.mediaStatus.provider || '—'} ·{' '}
          {data.mediaStatus.configured ? t('configured') : t('notConfigured')}
          {data.mediaStatus.message ? ` — ${data.mediaStatus.message}` : ''}
          {!data.mediaStatus.configured && ` ${t('localProviderNote')}`}
        </span>
      </div>

      <Card>
        <CardHead title={t('meetings')} subtitle={`${data.meetings.length} ${t('meetings').toLowerCase()}`} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('meetingTitle')}</th><th>{t('workspace')}</th><th>{t('providerStatus')}</th>
            <th>{t('status')}</th><th>{t('date')}</th><th>{t('actions')}</th></tr></thead>
          <tbody>
            {data.meetings.map((meeting) => (
              <tr key={meeting.id}>
                <td>
                  <button className="link-button" onClick={() => void openDetail(meeting.id)}>{meeting.title}</button>
                  <div className="small muted mono">{meeting.id.slice(0, 10)}</div>
                </td>
                <td>{data.workspaces.find((w) => w.id === meeting.workspaceId)?.name ?? '—'}</td>
                <td><Badge tone={meeting.provider === 'livekit' ? 'info' : 'muted'} plain>{meeting.provider}</Badge></td>
                <td><Badge tone={statusTone(meeting.status)}>{t(`status_${meeting.status}`)}</Badge></td>
                <td className="small mono">{dateLabel(meeting.startedAt ?? meeting.createdAt)}</td>
                <td>
                  <div className="row row-wrap" style={{ gap: 6 }}>
                    <Button size="sm" onClick={() => void openDetail(meeting.id)}>{t('details')}</Button>
                    {manageable && meeting.status !== 'live' &&
                      <Button size="sm" variant="primary" disabled={busy}
                        onClick={() => void changeStatus(meeting.id, 'start')}>{t('startMeeting')}</Button>}
                    {manageable && meeting.status === 'live' &&
                      <Button size="sm" variant="danger" disabled={busy}
                        onClick={() => void changeStatus(meeting.id, 'end')}>{t('endMeeting')}</Button>}
                    {meeting.status !== 'ended' && meeting.status !== 'live' &&
                      <Button size="sm" disabled={busy} onClick={() => void changeStatus(meeting.id, 'join')}>
                        {t('joinMeeting')}
                      </Button>}
                    {joinedIds.includes(meeting.id) &&
                      <Button size="sm" disabled={busy} onClick={() => void changeStatus(meeting.id, 'leave')}>
                        {t('leaveMeeting')}
                      </Button>}
                  </div>
                </td>
              </tr>
            ))}
            {!data.meetings.length && <tr><td colSpan={6}>
              <EmptyState icon={<CalendarDays size={24} />} title={t('noMeetings')} description={t('noMeetingsHint')}
                action={manageable && <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>{t('newMeeting')}</Button>} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>

      {detailId && <Card style={{ marginTop: 20 }}>
        <CardHead title={`${t('details')} · ${detail?.meeting.title ?? detailId.slice(0, 10)}`}
          subtitle={detail ? `${t('status')}: ${t(`status_${detail.meeting.status}`)}` : undefined}
          action={<Button size="sm" onClick={() => setDetailId(null)}>{t('close')}</Button>} />
        {detailLoading && <div className="card-body stack"><Skeleton height={44} /><Skeleton height={44} /></div>}
        {detailError && <div className="card-body"><div className="error-banner">{detailError}</div></div>}
        {detail && <div className="card-body stack">
          <div className="row row-wrap" style={{ justifyContent: 'space-between' }}>
            <div className="small muted"><Users size={13} style={{ verticalAlign: -2 }} /> {t('participants')}: {detail.participants.length}</div>
            <Button size="sm" icon={<KeyRound size={14} />} loading={busy} onClick={() => void getToken(detail.meeting.id)}>
              {t('getToken')}
            </Button>
          </div>
          {token && <div className="info-banner stack" style={{ gap: 6 }}>
            <span>{t('tokenReady')} · {t('expiresAt')}: {dateLabel(token.expiresAt)}</span>
            <Field label={t('getToken')}>
              <Input readOnly value={token.token} dir="ltr" onFocus={(event) => event.currentTarget.select()} />
            </Field>
            <div className="small mono" dir="ltr">{token.url}</div>
          </div>}
          {tokenError && <div className="error-banner">{tokenError}</div>}
          {detail.participants.length === 0 && <EmptyState icon={<Users size={22} />} title={t('noParticipants')} />}
          {detail.participants.map((participant) => (
            <div key={participant.id} className="presence-item">
              <span className="avatar sm">{participant.role === 'host' ? <Radio size={14} /> : <Users size={14} />}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="presence-item__name mono" dir="ltr">{participant.userId.slice(0, 12)}</div>
                <div className="presence-item__room small muted">
                  {participant.micEnabled ? t('micOn') : t('micOff')} ·{' '}
                  {participant.cameraEnabled ? t('cameraOn') : t('cameraOff')} ·{' '}
                  {participant.sharing ? t('shareScreen') : t('stopSharing')}
                </div>
              </div>
              {participant.id === currentParticipant?.id && <div className="row row-wrap" style={{ gap: 6 }}>
                <Button size="sm" icon={participant.micEnabled ? <Mic size={14} /> : <MicOff size={14} />}
                  disabled={busy} onClick={() => void patchControl('micEnabled', !participant.micEnabled)}>
                  {participant.micEnabled ? t('micOn') : t('micOff')}
                </Button>
                <Button size="sm" icon={participant.cameraEnabled ? <Video size={14} /> : <VideoOff size={14} />}
                  disabled={busy} onClick={() => void patchControl('cameraEnabled', !participant.cameraEnabled)}>
                  {participant.cameraEnabled ? t('cameraOn') : t('cameraOff')}
                </Button>
                <Button size="sm" icon={<MonitorUp size={14} />} disabled={busy}
                  onClick={() => void patchControl('sharing', !participant.sharing)}>
                  {participant.sharing ? t('stopSharing') : t('shareScreen')}
                </Button>
              </div>}
            </div>
          ))}
          {!currentParticipant && !detailLoading && <div className="small muted">{t('noParticipants')}</div>}
        </div>}
      </Card>}

      {createOpen && <Modal title={t('newMeeting')} onClose={() => setCreateOpen(false)} footer={
        <><Button onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form="meeting-create-form" loading={busy}>{t('create')}</Button></>
      }>
        <form id="meeting-create-form" className="form-grid" onSubmit={createMeeting}>
          <Field label={t('meetingTitle')} className="full">
            <Input name="title" required minLength={2} maxLength={120} />
          </Field>
          <Field label={t('workspace')} className="full">
            <Select name="workspaceId" required defaultValue="">
              <option value="" disabled>—</option>
              {data.workspaces.map((workspace) => (
                <option key={workspace.id} value={workspace.id}>{workspace.name}</option>
              ))}
            </Select>
          </Field>
          <Field label={t('room')} className="full">
            <Select name="roomId" defaultValue="">
              <option value="">{t('all')}</option>
              {data.workspaces.flatMap((workspace) => (workspace.rooms ?? []).map((room) => (
                <option key={room.id} value={room.id}>{workspace.name} · {room.name}</option>
              )))}
            </Select>
          </Field>
        </form>
        {!data.mediaStatus.configured && <div className="deferred-note" style={{ marginTop: 16 }}>
          <AlertTriangle size={15} />{t('localProviderNote')}
        </div>}
      </Modal>}
    </div>
  );
}
