import {
  BarChart3, Bell, CalendarDays, ChevronDown, ChevronRight, ClipboardCheck, CreditCard, FileVideo, Languages,
  LayoutDashboard, LogOut, Menu, MessageSquare, Monitor, Palette, Plug, Settings2, Shield,
  ShieldCheck, Sparkles, TrendingUp, Users, Video, X,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth.js';
import { useI18n } from '../lib/i18n.js';
import { Avatar, IconButton } from './ui.js';

interface NavItem { to: string; label: string; icon: ReactNode; show?: boolean }

export function AppShell({ children, title }: { children: ReactNode; title: string }) {
  const { me, logout, switchOrg } = useAuth();
  const { t, lang, setLang, dir } = useI18n();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [orgOpen, setOrgOpen] = useState(false);
  const isAdmin = me?.role === 'org_admin' || me?.role === 'super_admin';
  const isSuper = me?.role === 'super_admin';
  const isGuest = me?.isGuest;

  const groups: Array<{ label: string; items: NavItem[] }> = [
    {
      label: t('overviewGroup'),
      items: [
        { to: '/app', label: t('dashboard'), icon: <LayoutDashboard size={18} />, show: !isGuest },
        { to: '/app/office', label: t('office'), icon: <Monitor size={18} /> },
        { to: '/app/meetings', label: t('meetings'), icon: <Video size={18} />, show: !isGuest },
        { to: '/app/recordings', label: t('recordings'), icon: <FileVideo size={18} />, show: !isGuest },
      ],
    },
    {
      label: t('manageGroup'),
      items: [
        { to: '/app/schedules', label: t('schedules'), icon: <CalendarDays size={18} />, show: !isGuest },
        { to: '/app/attendance', label: t('attendance'), icon: <ClipboardCheck size={18} />, show: !isGuest },
        { to: '/app/reports', label: t('reports'), icon: <BarChart3 size={18} />, show: !isGuest },
        { to: '/app/analytics', label: t('analytics'), icon: <TrendingUp size={18} />, show: !isGuest },
        { to: '/app/messaging', label: t('messages'), icon: <MessageSquare size={18} />, show: !isGuest },
        { to: '/app/notifications', label: t('notifications'), icon: <Bell size={18} />, show: !isGuest },
        { to: '/app/teams', label: t('teams'), icon: <Users size={18} />, show: isAdmin },
        { to: '/app/members', label: t('members'), icon: <Users size={18} />, show: isAdmin },
        { to: '/app/invitations', label: t('invitations'), icon: <ShieldCheck size={18} />, show: isAdmin },
      ],
    },
    {
      label: t('adminGroup'),
      items: [
        { to: '/app/billing', label: t('billing'), icon: <CreditCard size={18} />, show: isAdmin },
        { to: '/app/integrations', label: t('integrations'), icon: <Plug size={18} />, show: isAdmin },
        { to: '/app/ai', label: t('ai'), icon: <Sparkles size={18} />, show: isAdmin },
        { to: '/app/customization', label: t('customization'), icon: <Palette size={18} />, show: isAdmin },
        { to: '/app/settings', label: t('settings'), icon: <Settings2 size={18} />, show: isAdmin },
        { to: '/app/admin', label: t('admin'), icon: <Shield size={18} />, show: isSuper },
      ],
    },
  ];

  const close = () => setMenuOpen(false);

  return (
    <div className="app-shell">
      {menuOpen && <div className="modal-backdrop" style={{ zIndex: 35 }} onClick={close} />}
      <aside className={`sidebar ${menuOpen ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand__mark">س</div>
          <div>
            <div className="brand__name">{t('appName')}</div>
            <div className="brand__tag">{t('tagline')}</div>
          </div>
          <IconButton label="Close menu" onClick={close} style={{ marginInlineStart: 'auto', display: menuOpen ? 'inline-flex' : 'none', color: '#fff' }}>
            <X size={18} />
          </IconButton>
        </div>

        {!isGuest && (
          <div style={{ position: 'relative' }}>
            <button className="org-switch" onClick={() => setOrgOpen((v) => !v)} aria-expanded={orgOpen}>
              <span className="org-switch__avatar">{me?.organization?.name?.[0] ?? 'S'}</span>
              <span className="org-switch__body">
                <span className="org-switch__name">{me?.organization?.name ?? t('appName')}</span>
                <span className="org-switch__meta">{me?.role ?? 'member'}</span>
              </span>
              <ChevronDown size={15} style={{ marginInlineStart: 'auto', flex: '0 0 auto' }} />
            </button>
            {orgOpen && (
              <div className="panel" style={{ position: 'absolute', insetInlineStart: 0, insetInlineEnd: 0, zIndex: 10, padding: 6, boxShadow: 'var(--shadow-lg)' }}>
                {me?.memberships.map((m) => (
                  <button key={m.organizationId} className="nav-item" onClick={async () => {
                    if (m.organizationId !== me.activeOrgId) await switchOrg(m.organizationId);
                    setOrgOpen(false); close();
                  }}>
                    <span className="org-switch__avatar" style={{ width: 26, height: 26 }}>{m.organizationName[0]}</span>
                    <span className="org-switch__name">{m.organizationName}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <nav aria-label="Primary">
          {groups.map((group) => {
            const items = group.items.filter((item) => item.show !== false);
            if (!items.length) return null;
            return (
              <div className="nav-group" key={group.label}>
                <div className="nav-group__label">{group.label}</div>
                {items.map((item) => (
                  <NavLink key={item.to} to={item.to} end={item.to === '/app'} onClick={close}
                    className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                    {item.icon}<span>{item.label}</span>
                  </NavLink>
                ))}
              </div>
            );
          })}
        </nav>

        <div className="sidebar__foot">
          <div className="sidebar__user">
            <Avatar name={me?.user.name ?? 'User'} />
            <div style={{ minWidth: 0, flex: 1 }}>
              <div className="sidebar__name">{me?.user.name}</div>
              <div className="sidebar__role">{me?.role}</div>
            </div>
            <IconButton label={t('logout')} onClick={async () => { await logout(); navigate('/login'); }}>
              <LogOut size={16} />
            </IconButton>
          </div>
        </div>
      </aside>

      <div className="main-column">
        <header className="topbar">
          <IconButton label="Open menu" onClick={() => setMenuOpen(true)} className="menu-btn"><Menu size={20} /></IconButton>
          <div className="topbar__heading">
            <div className="topbar__crumb">
              <span className="topbar__crumb-root">{t('appName')}</span>
              <ChevronRight size={13} aria-hidden="true" />
              <span className="topbar__crumb-current">{title}</span>
            </div>
            <div className="topbar__sub">{me?.organization?.name ?? t('tagline')}</div>
          </div>
          <div className="topbar__spacer" />
          {me?.organization?.settings?.demo && <span className="badge badge-accent">{t('demoData')}</span>}
          <span className="live-dot">{t('liveNow')}</span>
          <button className="lang-toggle" onClick={() => setLang(lang === 'en' ? 'ar' : 'en')}
            aria-label={`${t('changeLanguage')}: ${lang === 'en' ? 'العربية' : 'English'}`}>
            <Languages size={15} aria-hidden="true" />{lang === 'en' ? 'العربية' : 'English'}
          </button>
          <span className="small muted" style={{ textTransform: 'uppercase' }}>{dir === 'rtl' ? 'RTL' : 'LTR'}</span>
        </header>
        <main id="main-content" className="main-content" tabIndex={-1}>{children}</main>
      </div>
    </div>
  );
}
