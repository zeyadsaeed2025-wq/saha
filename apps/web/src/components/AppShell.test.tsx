// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, resetFrontendTestState, TestProviders } from '../test-utils.js';
import type { Me } from '../types.js';
import { AppShell } from './AppShell.js';

const { authState } = vi.hoisted(() => ({ authState: { me: null as Me | null } }));
const { logoutMock, switchOrgMock, refreshMock } = vi.hoisted(() => ({
  logoutMock: vi.fn(), switchOrgMock: vi.fn(), refreshMock: vi.fn(),
}));

vi.mock('../lib/auth.js', () => ({
  useAuth: () => ({
    me: authState.me, loading: false, refresh: refreshMock,
    login: vi.fn(), register: vi.fn(), logout: logoutMock,
    switchOrg: switchOrgMock, seedDemo: vi.fn(),
  }),
}));

function renderShell(initialEntry = '/app') {
  return render(
    <TestProviders initialEntries={[initialEntry]}>
      <Routes>
        <Route path="/app/*" element={<AppShell title="Dashboard"><div>Page content</div></AppShell>} />
        <Route path="/login" element={<div>Login screen</div>} />
      </Routes>
    </TestProviders>,
  );
}

describe('AppShell', () => {
  beforeEach(() => {
    resetFrontendTestState();
    vi.clearAllMocks();
    authState.me = adminMe;
    logoutMock.mockResolvedValue(undefined);
    switchOrgMock.mockResolvedValue(undefined);
  });

  it('renders every admin navigation link, the language toggle and live status', () => {
    renderShell();

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    const expected = [
      ['Dashboard', '/app'], ['Virtual office', '/app/office'], ['Schedules', '/app/schedules'],
      ['Attendance', '/app/attendance'], ['Reports', '/app/reports'], ['Members', '/app/members'],
      ['Invitations', '/app/invitations'], ['Settings', '/app/settings'],
    ] as const;
    for (const [label, href] of expected) {
      expect(within(nav).getByRole('link', { name: label })).toHaveAttribute('href', href);
    }
    expect(screen.getByRole('button', { name: /Change language/ })).toHaveTextContent('العربية');
    expect(screen.getByText('LTR')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
    expect(screen.getByText('Page content')).toBeInTheDocument();
  });

  it('marks only the current route as active and updates it on navigation', async () => {
    const user = userEvent.setup();
    renderShell('/app/members');

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Members' })).toHaveClass('active');
    expect(within(nav).getByRole('link', { name: 'Members' })).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByRole('link', { name: 'Dashboard' })).not.toHaveClass('active');
    expect(within(nav).getByRole('link', { name: 'Settings' })).not.toHaveClass('active');

    await user.click(within(nav).getByRole('link', { name: 'Reports' }));

    expect(within(nav).getByRole('link', { name: 'Reports' })).toHaveClass('active');
    expect(within(nav).getByRole('link', { name: 'Members' })).not.toHaveClass('active');
  });

  it('switches language from the top bar and flips direction to RTL', async () => {
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: /Change language/ }));

    expect(screen.getByRole('button', { name: /تغيير اللغة/ })).toHaveTextContent('English');
    expect(screen.getByText('RTL')).toBeInTheDocument();
    expect(document.documentElement.dir).toBe('rtl');
    expect(screen.getByRole('link', { name: 'لوحة التحكم' })).toHaveAttribute('href', '/app');
  });

  it('switches organizations from the org menu and signs out to /login', async () => {
    authState.me = {
      ...adminMe,
      memberships: [
        ...adminMe.memberships,
        { organizationId: 'org-2', organizationName: 'Second Org', role: 'mentor', team: 'Ops' },
      ],
    };
    const user = userEvent.setup();
    renderShell();

    await user.click(screen.getByRole('button', { name: /org_admin/ }));
    await user.click(screen.getByRole('button', { name: /Second Org/ }));

    expect(switchOrgMock).toHaveBeenCalledWith('org-2');

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(logoutMock).toHaveBeenCalledOnce();
    expect(await screen.findByText('Login screen')).toBeInTheDocument();
  });

  it('hides admin links for guest sessions', () => {
    authState.me = {
      ...adminMe,
      role: 'guest',
      isGuest: true,
    };
    renderShell('/app/office');

    const nav = screen.getByRole('navigation', { name: 'Primary' });
    expect(within(nav).getByRole('link', { name: 'Virtual office' })).toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Dashboard' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Members' })).not.toBeInTheDocument();
    expect(within(nav).queryByRole('link', { name: 'Settings' })).not.toBeInTheDocument();
  });
});
