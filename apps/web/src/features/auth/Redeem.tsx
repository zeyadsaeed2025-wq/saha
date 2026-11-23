import { ArrowRight, CheckCircle2, Clock3, KeyRound, Link2, ShieldAlert, Users } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Badge, Button, Card, CardHead, EmptyState, Field, Input, Skeleton, Spinner, useAsync } from '../../components/ui.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { rememberReturnTo } from '../../lib/redirect.js';
import { useToast } from '../../lib/toast.js';

interface InviteInfo {
  organizationName: string;
  role: string;
  team: string;
  expiresAt: string;
  active: boolean;
  phoneHint: string | null;
}
interface LinkInfo {
  kind: 'passwordless_member' | 'public_guest' | 'private_workspace' | 'member_invitation' | 'passwordless_access';
  requiresApproval?: boolean;
  organizationName: string;
  workspaceName: string;
  roomName: string | null;
  subjectName: string | null;
  expiresAt: string;
  uses: number;
  maxUses: number;
  active: boolean;
}
interface WaitingStatus {
  linkActive: boolean;
  requestId: string | null;
  status: 'pending' | 'approved' | 'rejected' | string;
}

function RedeemFrame({ children }: { children: ReactNode }) {
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand__mark">س</div>
          <div><div className="brand__name">Saha</div><div className="brand__tag">Virtual Office</div></div>
        </div>
        <h2>Multi-tenant by design. Invitations stay scoped and revocable.</h2>
        <p>Every access token is stored as a hash, expires, and can be disabled by an organization administrator.</p>
        <div className="auth-aside__badges"><span>Scoped links</span><span>Revocable</span><span>Audited</span></div>
      </aside>
      <div className="auth-panel"><div className="auth-card">{children}</div></div>
    </div>
  );
}

export function InvitationRedeem() {
  const { token = '' } = useParams();
  const { t } = useI18n();
  const { me, loading: authLoading, refresh } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const { data, loading, error } = useAsync(() => api<InviteInfo>(`/orgs/token/${token}`), [token]);

  const accept = async () => {
    setBusy(true);
    try {
      await api(`/orgs/token/${token}/accept`, { method: 'POST' });
      await refresh();
      notify(t('inviteAccepted'), 'success');
      navigate('/app');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Could not accept invitation', 'error');
    } finally { setBusy(false); }
  };

  if (authLoading || loading) return <Spinner label={t('loading')} />;
  if (error || !data || !data.active) return (
    <RedeemFrame>
      <EmptyState icon={<ShieldAlert size={24} />} title={t('invalidLink')} description={t('tokenNotice')}
        action={<Link to="/" className="btn btn-secondary btn-sm">{t('backHome')}</Link>} />
    </RedeemFrame>
  );

  return (
    <RedeemFrame>
      <Badge tone="accent" plain>{t('invitations')}</Badge>
      <h1 style={{ marginTop: 12 }}>{t('inviteTitle')}</h1>
      <p>{t('inviteFor')} <strong>{data.organizationName}</strong></p>
      <div className="panel card-body stack" style={{ gap: 10, marginTop: 20 }}>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">{t('role')}</span><Badge tone="primary" plain>{data.role}</Badge>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">{t('team')}</span><strong>{data.team}</strong>
        </div>
        <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">{t('expiresAt')}</span><span className="small mono">{new Date(data.expiresAt).toLocaleString()}</span>
        </div>
        {data.phoneHint && <div className="row" style={{ justifyContent: 'space-between' }}>
          <span className="small muted">{t('phone')}</span><span className="mono small" dir="ltr">{data.phoneHint}</span>
        </div>}
      </div>
      {!me ? (
        <div className="stack" style={{ marginTop: 20 }}>
          <div className="info-banner"><KeyRound size={16} />{t('needSignIn')}</div>
          <Button variant="primary" size="lg" onClick={() => {
            rememberReturnTo(`/invite/${token}`);
            navigate('/login');
          }}>{t('signIn')}</Button>
          <Button size="lg" onClick={() => {
            rememberReturnTo(`/invite/${token}`);
            navigate('/register');
          }}>{t('createAccountToAccept')}</Button>
        </div>
      ) : (
        <div className="stack" style={{ marginTop: 20 }}>
          <div className="info-banner"><CheckCircle2 size={16} />{t('signedInAs')} {me.user.phone}</div>
          <Button variant="primary" size="lg" icon={<ArrowRight size={17} />} loading={busy} onClick={accept}>
            {t('accept')}
          </Button>
        </div>
      )}
    </RedeemFrame>
  );
}

export function AccessRedeem({ guest = false }: { guest?: boolean }) {
  const { token = '' } = useParams();
  const { t } = useI18n();
  const { loading: authLoading, refresh } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [waiting, setWaiting] = useState<string | null>(null);
  const [waitStatus, setWaitStatus] = useState<string>('pending');

  const { data, loading, error } = useAsync(() => api<LinkInfo>(`/access/${token}/info`), [token]);

  const redeem = async (requestId?: string) => {
    setBusy(true);
    try {
      const body = data?.requiresApproval
        ? { name: name.trim() || 'Guest visitor', ...(requestId ? { requestId } : {}) }
        : undefined;
      const result = await api<{ kind?: string; requestId?: string; organizationId: string; workspaceId?: string; roomId?: string | null } | undefined>(
        `/access/${token}/redeem`, { method: 'POST', ...(body ? { body } : {}) },
      );
      if (result?.kind === 'waiting' && result.requestId) {
        setWaiting(result.requestId);
        setWaitStatus('pending');
        notify(t('requestSent'), 'success');
        return;
      }
      sessionStorage.setItem('saha_office_scope', JSON.stringify({
        workspaceId: result?.workspaceId ?? undefined,
        roomId: result?.roomId ?? undefined,
      }));
      await refresh();
      notify(t('accessReady'), 'success');
      navigate('/app/office');
    } catch (err) {
      const info = err as { info?: { code?: string } };
      if (info.info?.code === 'GUEST_REJECTED') notify(t('guestRejectedNotice'), 'error');
      else if (info.info?.code === 'GUEST_PENDING') notify(t('stillWaiting'), 'info');
      else notify(err instanceof Error ? err.message : t('accessInvalid'), 'error');
    } finally { setBusy(false); }
  };

  // Poll the server-side decision while the guest request is pending. Approval
  // is an explicit administrator action, never a client-side assumption.
  useEffect(() => {
    if (!waiting) return;
    let cancelled = false;
    const poll = async () => {
      try {
        const status = await api<WaitingStatus>(`/access/${token}/status?requestId=${encodeURIComponent(waiting)}`);
        if (cancelled) return;
        setWaitStatus(status.status);
        if (status.status !== 'pending') setWaiting(null);
      } catch { /* keep polling; the next tick can succeed */ }
    };
    void poll();
    const timer = setInterval(() => { void poll(); }, 2_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, [waiting, token]);

  useEffect(() => {
    if (waitStatus === 'approved' && waiting) {
      setWaitStatus('pending');
      void redeem(waiting);
    }
    // redeem is intentionally invoked only on an approved transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitStatus, waiting]);

  if (authLoading || loading) return <Spinner label={t('consuming')} />;
  if (error || !data || !data.active) return (
    <RedeemFrame>
      <EmptyState icon={<ShieldAlert size={24} />} title={t('accessInvalid')} description={t('tokenNotice')}
        action={<Link to="/" className="btn btn-secondary btn-sm">{t('backHome')}</Link>} />
    </RedeemFrame>
  );

  return (
    <RedeemFrame>
      <Badge tone={data.kind === 'public_guest' ? 'accent' : 'primary'} plain>
        {data.kind === 'public_guest' ? t('guestAccess') : t('memberAccess')}
      </Badge>
      <h1 style={{ marginTop: 12 }}>{guest ? t('guestTitle') : t('accessTitle')}</h1>
      <p>{data.requiresApproval ? t('approvalRequired') : t('accessReady')}</p>
      <Card style={{ marginTop: 20 }}>
        <CardHead title={data.organizationName} subtitle={data.workspaceName} />
        <div className="card-body stack" style={{ gap: 10 }}>
          {data.roomName && <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">{t('room')}</span><strong>{data.roomName}</strong>
          </div>}
          {data.subjectName && <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted">{t('linkSubject')}</span><strong>{data.subjectName}</strong>
          </div>}
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted"><Clock3 size={13} style={{ verticalAlign: -2 }} /> {t('expiresAt')}</span>
            <span className="small mono">{new Date(data.expiresAt).toLocaleString()}</span>
          </div>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span className="small muted"><Users size={13} style={{ verticalAlign: -2 }} /> {t('usesRemaining')}</span>
            <strong>{data.maxUses - data.uses}</strong>
          </div>
        </div>
      </Card>
      {data.requiresApproval && !waiting && <Field label={t('yourName')} className="full" hint={t('guestNotice')}>
        <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('guestName')} />
      </Field>}
      {waiting && <div className="info-banner" style={{ marginTop: 16 }}>
        <Clock3 size={16} />{waitStatus === 'rejected' ? t('guestRejectedNotice')
          : waitStatus === 'approved' ? t('accessReady') : `${t('waitingForApproval')} · ${t('polling')}`}
      </div>}
      <div className="info-banner" style={{ marginTop: 16 }}><Link2 size={16} />{t('guestNotice')}</div>
      <Button variant="primary" size="lg" icon={<ArrowRight size={17} />} loading={busy}
        disabled={Boolean(waiting) || waitStatus === 'rejected'}
        onClick={() => { void redeem(); }} style={{ width: '100%', marginTop: 18 }}>
        {waiting ? t('guestWaiting') : t('enterOffice')}
      </Button>
    </RedeemFrame>
  );
}
