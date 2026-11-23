import { ArrowRight, ClipboardCheck, Languages, Map, Users } from 'lucide-react';
import { Fragment, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui.js';
import { useAuth } from '../../lib/auth.js';
import { useI18n } from '../../lib/i18n.js';
import { useToast } from '../../lib/toast.js';

function OfficePreview() {
  return (
    <svg viewBox="0 0 560 360" role="img" aria-label="Virtual office preview" style={{ width: '100%', display: 'block' }}>
      <defs>
        <pattern id="grid" width="28" height="28" patternUnits="userSpaceOnUse">
          <path d="M 28 0 L 0 0 0 28" fill="none" stroke="rgba(255,255,255,.05)" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="560" height="360" rx="14" fill="#132a32" />
      <rect width="560" height="360" rx="14" fill="url(#grid)" />
      <rect x="24" y="24" width="180" height="130" rx="12" fill="#175b58" stroke="#2a8b84" />
      <rect x="220" y="24" width="190" height="190" rx="12" fill="#1b4550" stroke="#2c6a72" />
      <rect x="426" y="24" width="110" height="130" rx="12" fill="#5c4033" stroke="#a06f52" />
      <rect x="24" y="170" width="180" height="166" rx="12" fill="#2e3b63" stroke="#4a5a8a" />
      <rect x="220" y="230" width="190" height="106" rx="12" fill="#3d3457" stroke="#65568e" />
      <rect x="426" y="170" width="110" height="166" rx="12" fill="#224c3f" stroke="#3a7a62" />
      <text x="40" y="48" fill="#9fd8ce" fontSize="12" fontWeight="600">FOCUS FLOOR</text>
      <text x="236" y="48" fill="#a9ced6" fontSize="12" fontWeight="600">MENTOR CORNER</text>
      <text x="442" y="48" fill="#d9b59a" fontSize="12" fontWeight="600">MEETING</text>
      <text x="40" y="194" fill="#b6c0e8" fontSize="12" fontWeight="600">STUDY HALL</text>
      <text x="442" y="194" fill="#a9d9bf" fontSize="12" fontWeight="600">BREAK ROOM</text>
      {[[92, 96, '#f0785a', 'L'], [140, 118, '#5bc7b6', 'M'], [300, 110, '#e8b44c', 'O'], [346, 156, '#8a9be8', 'S'],
        [78, 246, '#5bc7b6', 'N'], [300, 278, '#f0785a', 'Z'], [470, 250, '#8a9be8', 'K']].map(([x, y, color, letter], i) => (
        <g key={i}>
          <ellipse cx={x as number} cy={(y as number) + 18} rx="13" ry="4" fill="rgba(0,0,0,.25)" />
          <rect x={(x as number) - 11} y={(y as number) - 14} width="22" height="26" rx="9" fill={color as string} />
          <circle cx={x as number} cy={(y as number) - 19} r="8" fill={color as string} />
          <text x={x as number} y={(y as number) - 16} textAnchor="middle" fill="#10242b" fontSize="9" fontWeight="800">{letter as string}</text>
        </g>
      ))}
    </svg>
  );
}

export function Landing() {
  const { t, lang, setLang } = useI18n();
  const { seedDemo, me } = useAuth();
  const { notify } = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);

  const enterDemo = async () => {
    setBusy(true);
    try {
      await seedDemo();
      notify(t('demoData'), 'success');
      navigate('/app');
    } catch (error) {
      notify(error instanceof Error ? error.message : 'Could not open the demo', 'error');
    } finally { setBusy(false); }
  };

  return (
    <div className="landing">
      <nav className="landing-nav" aria-label="Main">
        <Link to="/" className="brand" style={{ padding: 0 }}>
          <div className="brand__mark">س</div>
          <div><div className="brand__name">{t('appName')}</div><div className="brand__tag">{t('tagline')}</div></div>
        </Link>
        <div className="links">
          <a href="#features">{t('office')}</a>
          <a href="#features">{t('attendance')}</a>
          <Link to="/login">{t('signIn')}</Link>
        </div>
        <button className="lang-toggle" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}>
          <Languages size={15} />{lang === 'en' ? 'العربية' : 'English'}
        </button>
        <Button variant="primary" size="sm" onClick={() => navigate(me ? '/app' : '/register')}>{t('getStarted')}</Button>
      </nav>

      <section className="landing-hero">
        <div className="rise">
          <span className="badge badge-primary plain">Gather-inspired · rebuilt from scratch</span>
          <h1 style={{ marginTop: 18 }}>{t('heroTitle').split(t('heroHighlight')).map((part, i, arr) =>
            i < arr.length - 1 ? <Fragment key={i}>{part}<em>{t('heroHighlight')}</em></Fragment> : part)}</h1>
          <p>{t('heroSub')}</p>
          <div className="landing-hero__actions">
            <Button variant="primary" size="lg" icon={<ArrowRight size={18} />} onClick={() => navigate(me ? '/app' : '/register')}>
              {t('getStarted')}
            </Button>
            <Button size="lg" loading={busy} icon={<Map size={18} />} onClick={enterDemo}>{t('exploreDemo')}</Button>
          </div>
          <div className="row row-wrap" style={{ marginTop: 28, color: 'var(--muted)' }}>
            <span className="small">{t('trustedBy')}</span>
          </div>
        </div>
        <div className="landing-hero__visual rise"><OfficePreview /></div>
      </section>

      <section className="landing-features" id="features">
        <h2 style={{ fontSize: 'var(--text-2xl)' }}>{t('trustedBy')}</h2>
        <div className="feature-grid">
          <div className="feature">
            <div className="feature__icon"><Map size={20} /></div>
            <h3>{t('feature1Title')}</h3><p>{t('feature1Desc')}</p>
          </div>
          <div className="feature">
            <div className="feature__icon"><ClipboardCheck size={20} /></div>
            <h3>{t('feature2Title')}</h3><p>{t('feature2Desc')}</p>
          </div>
          <div className="feature">
            <div className="feature__icon"><Users size={20} /></div>
            <h3>{t('feature3Title')}</h3><p>{t('feature3Desc')}</p>
          </div>
        </div>
      </section>

      <footer className="landing-foot">
        <span>© {new Date().getFullYear()} Saha — Virtual Office SaaS</span>
        <span>·</span>
        <span>{t('verifiedOnly')}</span>
        <span>·</span>
        <span>{t('deferred')}: LiveKit · Google Drive · SMS</span>
      </footer>
    </div>
  );
}
