import { AlertTriangle, CheckCircle2, FolderOpen, KeyRound, Link2, Plus, UploadCloud, Video } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import {
  Badge, Button, Card, CardHead, EmptyState, Field, Input, Modal, PageHead, Select, Skeleton, useAsync,
} from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { can } from '../../lib/permissions.js';
import { useToast } from '../../lib/toast.js';
import type { DriveConnection, Meeting, Recording } from '../../types.js';

interface PrepareResult { authorizationUrl: string; state: string }

const failMessage = (err: unknown, fallback: string): string =>
  err instanceof Error && err.message ? err.message : fallback;

const recordingTone = (status: string): 'success' | 'warning' | 'danger' | 'info' | 'muted' =>
  status === 'uploaded' ? 'success' : status === 'failed' ? 'danger' : status === 'retrying' || status === 'uploading'
    ? 'info' : status === 'recording' ? 'warning' : 'muted';

const connectionTone = (status: string): 'success' | 'warning' | 'danger' | 'muted' =>
  status === 'connected' ? 'success' : status === 'expired' || status === 'error' ? 'danger' : 'muted';

export function Recordings() {
  const { t } = useI18n();
  const { me } = useAuth();
  const { notify } = useToast();
  const orgId = me?.activeOrgId ?? '';
  const canRead = can(me?.role, 'recording:read');

  const [createOpen, setCreateOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [createNote, setCreateNote] = useState<string | null>(null);
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const { data, loading, error, reload } = useAsync(async () => {
    const [recordingResult, meetingResult, driveResult] = await Promise.all([
      api<{ recordings: Recording[] }>(`/orgs/${orgId}/recordings`),
      api<{ meetings: Meeting[] }>(`/orgs/${orgId}/media/meetings`),
      api<{ connection: DriveConnection }>(`/orgs/${orgId}/drive/status`),
    ]);
    return {
      recordings: recordingResult.recordings,
      meetings: meetingResult.meetings,
      connection: driveResult.connection,
    };
  }, [orgId]);

  const startRecording = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      const result = await api<{ recording: Recording; note?: string }>(`/orgs/${orgId}/recordings`, {
        method: 'POST', body: { meetingId: String(form.get('meetingId') ?? '') },
      });
      setCreateNote(result.note ?? null);
      notify(t('startRecording'), 'success');
      setCreateOpen(false);
      await reload();
    } catch (err) { notify(failMessage(err, t('startRecording')), 'error'); }
    finally { setBusy(false); }
  };

  const recordingAction = async (recording: Recording, action: 'stop' | 'retry' | 'upload') => {
    setBusy(true);
    try {
      const path = action === 'upload'
        ? `/orgs/${orgId}/drive/upload/${recording.id}`
        : `/orgs/${orgId}/recordings/${recording.id}/${action}`;
      const result = await api<{ recording: Recording; note?: string }>(path, { method: 'POST' });
      if (result.note) setCreateNote(result.note);
      const label = action === 'stop' ? t('stopRecording') : action === 'retry' ? t('retryRecording') : t('uploadToDrive');
      notify(label, 'success');
      await reload();
    } catch (err) { notify(failMessage(err, t('recordings')), 'error'); }
    finally { setBusy(false); }
  };

  const prepareDrive = async () => {
    setBusy(true);
    try {
      const result = await api<PrepareResult>(`/orgs/${orgId}/drive/connect/prepare`, { method: 'POST' });
      setAuthUrl(result.authorizationUrl);
      notify(t('connectDrive'), 'success');
    } catch (err) { notify(failMessage(err, t('providerNotConfigured')), 'error'); }
    finally { setBusy(false); }
  };

  const saveFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBusy(true);
    const form = new FormData(event.currentTarget);
    try {
      await api(`/orgs/${orgId}/drive/folder`, {
        method: 'POST',
        body: {
          folderId: String(form.get('folderId') ?? '').trim(),
          folderName: String(form.get('folderName') ?? '').trim(),
        },
      });
      notify(t('chooseFolder'), 'success');
      setFolderOpen(false);
      await reload();
    } catch (err) { notify(failMessage(err, t('chooseFolder')), 'error'); }
    finally { setBusy(false); }
  };

  const disconnectDrive = async () => {
    setBusy(true);
    try {
      await api(`/orgs/${orgId}/drive/disconnect`, { method: 'POST' });
      notify(t('disconnectDrive'), 'success');
      setAuthUrl(null);
      await reload();
    } catch (err) { notify(failMessage(err, t('disconnectDrive')), 'error'); }
    finally { setBusy(false); }
  };

  if (loading) return <div className="stack"><Skeleton height={110} /><Skeleton height={110} />{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} height={56} />)}</div>;
  if (error || !data) return <div className="error-banner">{error ?? t('loading')}</div>;

  const dateLabel = (iso: string | null) => iso ? new Date(iso).toLocaleString() : '—';
  const providerReady = data.connection.configured !== false;

  return (
    <div className="rise">
      <PageHead title={t('recordings')} subtitle={t('recordingsSub')} actions={canRead &&
        <Button variant="primary" icon={<Plus size={15} />} onClick={() => setCreateOpen(true)}>{t('startRecording')}</Button>} />

      {!providerReady && <div className="deferred-note" style={{ marginBottom: 20 }}>
        <AlertTriangle size={16} style={{ flex: '0 0 auto' }} />
        <span>{t('recordingNote')} {t('providerNotConfigured')}</span>
      </div>}
      {createNote && <div className="info-banner" style={{ marginBottom: 20 }}><CheckCircle2 size={16} />{createNote}</div>}

      <Card style={{ marginBottom: 20 }}>
        <CardHead title={t('driveStatus')} subtitle={data.connection.folderName ?? t('driveNotConnected')}
          icon={<Link2 size={18} />} />
        <div className="card-body stack" style={{ gap: 10 }}>
          <div className="row row-wrap" style={{ gap: 8 }}>
            <Badge tone={connectionTone(data.connection.status)}>
              {data.connection.status === 'expired' ? t('expired')
                : t(`status_${data.connection.status}`)}
            </Badge>
            <Badge tone={providerReady ? 'success' : 'warning'} plain>
              {providerReady ? t('configured') : t('notConfigured')}
            </Badge>
            {data.connection.connectedAt && <span className="small muted">{dateLabel(data.connection.connectedAt)}</span>}
          </div>
          {data.connection.folderId && <div className="small mono" dir="ltr">
            <FolderOpen size={13} style={{ verticalAlign: -2 }} /> {data.connection.folderId}
          </div>}
          {data.connection.lastError && <div className="error-banner">{data.connection.lastError}</div>}
          <div className="row row-wrap" style={{ gap: 8 }}>
            <Button size="sm" icon={<KeyRound size={14} />} loading={busy} onClick={() => void prepareDrive()}>
              {t('connectDrive')}
            </Button>
            <Button size="sm" icon={<FolderOpen size={14} />} loading={busy} onClick={() => setFolderOpen(true)}>
              {t('chooseFolder')}
            </Button>
            <Button size="sm" variant="danger" loading={busy}
              disabled={data.connection.status === 'not_connected'}
              onClick={() => void disconnectDrive()}>{t('disconnectDrive')}</Button>
          </div>
          {authUrl && <div className="info-banner stack" style={{ gap: 6 }}>
            <span>{t('connectDrive')}: open this URL to complete the provider handshake; this page does not complete the browser redirect locally.</span>
            <Input readOnly value={authUrl} dir="ltr" onFocus={(event) => event.currentTarget.select()} />
          </div>}
        </div>
      </Card>

      <Card>
        <CardHead title={t('recordings')} subtitle={`${data.recordings.length}`} />
        <div className="table-wrap"><table className="table">
          <thead><tr><th>{t('meetings')}</th><th>{t('status')}</th><th>{t('attempts')}</th>
            <th>{t('reason')}</th><th>{t('date')}</th><th>{t('actions')}</th></tr></thead>
          <tbody>
            {data.recordings.map((recording) => (
              <tr key={recording.id}>
                <td>
                  <div className="small mono" dir="ltr">{recording.meetingId.slice(0, 12)}</div>
                  <div className="small muted">{data.meetings.find((m) => m.id === recording.meetingId)?.title ?? '—'}</div>
                </td>
                <td><Badge tone={recordingTone(recording.status)}>{t(`status_${recording.status}`)}</Badge></td>
                <td className="mono">{recording.attempts}</td>
                <td className="small">{recording.lastError ?? '—'}</td>
                <td className="small mono">{dateLabel(recording.startedAt ?? recording.createdAt)}</td>
                <td>
                  <div className="row row-wrap" style={{ gap: 6 }}>
                    {(recording.status === 'recording' || recording.status === 'pending') &&
                      <Button size="sm" variant="danger" loading={busy}
                        onClick={() => void recordingAction(recording, 'stop')}>{t('stopRecording')}</Button>}
                    {recording.status === 'failed' &&
                      <Button size="sm" loading={busy}
                        onClick={() => void recordingAction(recording, 'retry')}>{t('retryRecording')}</Button>}
                    {(recording.status === 'pending' || recording.status === 'failed') &&
                      <Button size="sm" icon={<UploadCloud size={14} />} loading={busy}
                        onClick={() => void recordingAction(recording, 'upload')}>{t('uploadToDrive')}</Button>}
                    {!['recording', 'pending', 'failed'].includes(recording.status) && <span className="small muted">—</span>}
                  </div>
                </td>
              </tr>
            ))}
            {!data.recordings.length && <tr><td colSpan={6}>
              <EmptyState icon={<Video size={24} />} title={t('noRecordings')} description={t('recordingNote')}
                action={canRead && <Button variant="primary" size="sm" onClick={() => setCreateOpen(true)}>{t('startRecording')}</Button>} />
            </td></tr>}
          </tbody>
        </table></div>
      </Card>

      {createOpen && <Modal title={t('startRecording')} onClose={() => setCreateOpen(false)} footer={
        <><Button onClick={() => setCreateOpen(false)}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form="recording-create-form" loading={busy}>{t('startRecording')}</Button></>
      }>
        <form id="recording-create-form" className="form-grid" onSubmit={startRecording}>
          <Field label={t('meetings')} className="full">
            <Select name="meetingId" required defaultValue="">
              <option value="" disabled>—</option>
              {data.meetings.map((meeting) => (
                <option key={meeting.id} value={meeting.id}>{meeting.title} · {t(`status_${meeting.status}`)}</option>
              ))}
            </Select>
          </Field>
        </form>
        {!providerReady && <div className="deferred-note" style={{ marginTop: 16 }}>
          <AlertTriangle size={15} />{t('recordingNote')}
        </div>}
      </Modal>}

      {folderOpen && <Modal title={t('chooseFolder')} onClose={() => setFolderOpen(false)} footer={
        <><Button onClick={() => setFolderOpen(false)}>{t('cancel')}</Button>
          <Button variant="primary" type="submit" form="drive-folder-form" loading={busy}>{t('save')}</Button></>
      }>
        <form id="drive-folder-form" className="form-grid" onSubmit={saveFolder}>
          <Field label={t('folderId')} className="full"><Input name="folderId" required dir="ltr" /></Field>
          <Field label={t('folderName')} className="full"><Input name="folderName" required /></Field>
        </form>
      </Modal>}
    </div>
  );
}
