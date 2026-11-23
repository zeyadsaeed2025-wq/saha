import { ArrowLeft, Languages, LockKeyhole, Phone } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Field, Input } from '../../components/ui.js';
import { consumeReturnTo } from '../../lib/redirect.js';
import { api } from '../../lib/api.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { useToast } from '../../lib/toast.js';

function AuthFrame({ children, asideTitle, asideBody }: {
  children: ReactNode; asideTitle: string; asideBody: string;
}) {
  const { lang, setLang } = useI18n();
  return (
    <div className="auth-page">
      <aside className="auth-aside">
        <div className="brand" style={{ padding: 0 }}>
          <div className="brand__mark">س</div>
          <div><div className="brand__name">Saha</div><div className="brand__tag">Virtual Office</div></div>
        </div>
        <h2>{asideTitle}</h2>
        <p>{asideBody}</p>
        <div className="auth-aside__badges">
          <span>Multi-tenant</span><span>RBAC</span><span>UTC timestamps</span><span>EN / عربي</span>
        </div>
      </aside>
      <div className="auth-panel">
        <div className="auth-card">
          <button className="lang-toggle" style={{ marginBottom: 20 }} onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
            <Languages size={15} />{lang === 'en' ? 'العربية' : 'English'}
          </button>
          {children}
        </div>
      </div>
    </div>
  );
}

export function Login() {
  const { t } = useI18n();
  const { login, me } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError(''); setBusy(true);
    try {
      await login(phone, password);
      notify(t('signIn'), 'success');
      navigate(consumeReturnTo());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally { setBusy(false); }
  };

  return (
    <AuthFrame asideTitle={t('heroTitle')} asideBody={t('heroSub')}>
      <h1>{t('loginTitle')}</h1><p>{t('loginSub')}</p>
      <form onSubmit={submit} noValidate>
        <Field label={t('phone')}>
          <div className="input-prefix"><Phone /><Input value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="+20 100 000 0001" dir="ltr" autoComplete="tel" required /></div>
        </Field>
        <Field label={t('password')}>
          <div className="input-prefix"><LockKeyhole /><Input type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" autoComplete="current-password" required /></div>
        </Field>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <div className="row" style={{ justifyContent: 'space-between', marginTop: 10 }}>
          <Link to="/forgot-password" className="small">{t('forgot')}</Link>
          <Link to="/register" className="small">{t('createAccount')}</Link>
        </div>
        <Button variant="primary" size="lg" type="submit" loading={busy} style={{ width: '100%', marginTop: 18 }}>
          {t('signIn')}
        </Button>
      </form>
      <div className="auth-card__foot">
        {t('noAccount')} <Link to="/register">{t('createAccount')}</Link>
        {me && <div className="small" style={{ marginTop: 8 }}><Link to="/app">→ {t('dashboard')}</Link></div>}
      </div>
    </AuthFrame>
  );
}

export function ForgotPassword() {
  const { t } = useI18n();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [step, setStep] = useState<'request' | 'reset'>('request');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [devCode, setDevCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const request = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      const result = await api<{ devCode?: string }>('/auth/forgot', { method: 'POST', body: { phone } });
      if (result.devCode) setDevCode(result.devCode);
      setStep('reset');
      notify('Code sent', 'success');
    } catch (err) { setError(err instanceof Error ? err.message : 'Request failed'); }
    finally { setBusy(false); }
  };

  const reset = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/auth/reset', { method: 'POST', body: { phone, code, newPassword: password } });
      notify('Password updated', 'success');
      navigate('/login');
    } catch (err) { setError(err instanceof Error ? err.message : 'Reset failed'); }
    finally { setBusy(false); }
  };

  return (
    <AuthFrame asideTitle={t('resetTitle')} asideBody={t('verifiedOnly')}>
      <h1>{t('resetTitle')}</h1><p>{t('resetSub')}</p>
      <form onSubmit={step === 'request' ? request : reset} noValidate>
        <Field label={t('phone')}>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} dir="ltr" placeholder="+20 100 000 0001" required />
        </Field>
        {step === 'reset' && <>
          {devCode && <div className="info-banner">{t('devCodeNotice')} <strong dir="ltr">{devCode}</strong></div>}
          <Field label={t('code')}><Input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric"
            maxLength={6} dir="ltr" placeholder="000000" required /></Field>
          <Field label={t('newPassword')}><Input type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} minLength={8} required /></Field>
        </>}
        {error && <div className="error-banner">{error}</div>}
        <Button variant="primary" size="lg" type="submit" loading={busy} style={{ width: '100%', marginTop: 18 }}>
          {step === 'request' ? t('sendCode') : t('save')}
        </Button>
      </form>
      <div className="auth-card__foot"><Link to="/login"><ArrowLeft size={14} /> {t('signIn')}</Link></div>
    </AuthFrame>
  );
}

export function Onboarding() {
  const { t } = useI18n();
  const { refresh } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [timezone, setTimezone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await api('/orgs', { method: 'POST', body: { name, timezone } });
      await refresh();
      notify(t('saved'), 'success');
      navigate('/app');
    } catch (err) { setError(err instanceof Error ? err.message : 'Could not create organization'); }
    finally { setBusy(false); }
  };

  return (
    <AuthFrame asideTitle={t('onboardTitle')} asideBody={t('onboardSub')}>
      <h1>{t('onboardTitle')}</h1><p>{t('onboardSub')}</p>
      <form onSubmit={submit} noValidate>
        <Field label={t('orgName')}><Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} required
          placeholder="Northstar Academy" /></Field>
        <Field label={t('timezone')} hint="IANA timezone, e.g. Africa/Cairo">
          <Input value={timezone} onChange={(e) => setTimezone(e.target.value)} dir="ltr" required />
        </Field>
        {error && <div className="error-banner">{error}</div>}
        <Button variant="primary" size="lg" type="submit" loading={busy} style={{ width: '100%', marginTop: 18 }}>
          {t('createWorkspace')}
        </Button>
      </form>
      <div className="auth-card__foot">{t('haveAccount')} <Link to="/login">{t('signIn')}</Link></div>
    </AuthFrame>
  );
}

export function Register() {
  const { t } = useI18n();
  const { register } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault(); setError(''); setBusy(true);
    try {
      await register(name, phone, password);
      notify(t('accountCreated'), 'success');
      navigate(consumeReturnTo('/onboarding'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the account');
    } finally { setBusy(false); }
  };

  return (
    <AuthFrame asideTitle={t('registerTitle')} asideBody={t('registerSub')}>
      <h1>{t('registerTitle')}</h1><p>{t('registerSub')}</p>
      <form onSubmit={submit} noValidate>
        <Field label={t('fullName')}>
          <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={80}
            autoComplete="name" placeholder="Lina Hassan" required />
        </Field>
        <Field label={t('phone')} hint="+country code + national number">
          <div className="input-prefix"><Phone /><Input value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder="+20 100 000 0001" dir="ltr" autoComplete="tel" required /></div>
        </Field>
        <Field label={t('password')} hint="At least 8 characters">
          <div className="input-prefix"><LockKeyhole /><Input type="password" value={password}
            onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete="new-password" required /></div>
        </Field>
        {error && <div className="error-banner" role="alert">{error}</div>}
        <Button variant="primary" size="lg" type="submit" loading={busy} style={{ width: '100%', marginTop: 18 }}>
          {t('createAccount')}
        </Button>
      </form>
      <div className="auth-card__foot">{t('haveAccount')} <Link to="/login">{t('signIn')}</Link></div>
    </AuthFrame>
  );
}
