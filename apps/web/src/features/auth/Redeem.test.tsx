// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, resetFrontendTestState, TestProviders } from '../../test-utils.js';
import type { Me } from '../../types.js';
import { AccessRedeem, InvitationRedeem } from './Redeem.js';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
const { authState } = vi.hoisted(() => ({ authState: { me: null as Me | null, loading: false } }));
const { refreshMock } = vi.hoisted(() => ({ refreshMock: vi.fn() }));

vi.mock('../../lib/api.js', () => ({ api: apiMock }));
vi.mock('../../lib/auth.js', () => ({
  useAuth: () => ({
    me: authState.me, loading: authState.loading, refresh: refreshMock,
    login: vi.fn(), register: vi.fn(), logout: vi.fn(), switchOrg: vi.fn(), seedDemo: vi.fn(),
  }),
}));

const inviteInfo = {
  organizationName: 'Northstar Academy', role: 'mentor', team: 'Engineering',
  expiresAt: '2026-12-01T00:00:00.000Z', active: true, phoneHint: '+201000000002',
};
const linkInfo = {
  kind: 'public_guest' as const, organizationName: 'Northstar Academy', workspaceName: 'Main Office',
  roomName: 'Focus Room', subjectName: null, expiresAt: '2026-12-01T00:00:00.000Z',
  uses: 2, maxUses: 10, active: true,
};

function useFixtures() {
  apiMock.mockImplementation(async (path: string, opts?: { method?: string }) => {
    if (opts?.method === 'POST') {
      if (path === '/orgs/token/good/accept') return undefined;
      if (path === '/access/abc/redeem') {
        return { kind: 'public_guest', organizationId: 'org-1', workspaceId: 'ws-1', roomId: 'room-1' };
      }
    }
    if (path === '/orgs/token/bad') throw new Error('Token not found');
    if (path === '/orgs/token/good') return inviteInfo;
    if (path === '/access/expired/info') throw new Error('Link expired');
    if (path === '/access/abc/info') return linkInfo;
    throw new Error(`Unexpected API call: ${opts?.method ?? 'GET'} ${path}`);
  });
}

function renderRoute(path: string) {
  return render(
    <TestProviders initialEntries={[path]}>
      <Routes>
        <Route path="/invite/:token" element={<InvitationRedeem />} />
        <Route path="/access/:token" element={<AccessRedeem />} />
        <Route path="/guest/:token" element={<AccessRedeem guest />} />
        <Route path="/" element={<div>Home destination</div>} />
        <Route path="/login" element={<div>Login destination</div>} />
        <Route path="/register" element={<div>Register destination</div>} />
        <Route path="/app" element={<div>App destination</div>} />
        <Route path="/app/office" element={<div>Office destination</div>} />
      </Routes>
    </TestProviders>,
  );
}

describe('invitation and access redemption', () => {
  beforeEach(() => {
    resetFrontendTestState();
    vi.clearAllMocks();
    authState.me = null;
    authState.loading = false;
    refreshMock.mockResolvedValue(undefined);
    useFixtures();
  });

  it('shows an honest invalid-link state for a rejected invitation token', async () => {
    renderRoute('/invite/bad');

    expect(await screen.findByText('This link is invalid or expired.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to home' })).toHaveAttribute('href', '/');
    expect(apiMock).toHaveBeenCalledWith('/orgs/token/bad');
  });

  it('shows invitation details and remembers the deep link for sign-in', async () => {
    const user = userEvent.setup();
    renderRoute('/invite/good');

    expect(await screen.findByText('You have been invited')).toBeInTheDocument();
    expect(screen.getByText('Northstar Academy')).toBeInTheDocument();
    expect(screen.getByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('Sign in to accept this invitation.')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(sessionStorage.getItem('saha_return_to')).toBe('/invite/good');
    expect(await screen.findByText('Login destination')).toBeInTheDocument();
  });

  it('accepts a valid invitation for a signed-in user and reports success', async () => {
    authState.me = adminMe;
    const user = userEvent.setup();
    renderRoute('/invite/good');

    await user.click(await screen.findByRole('button', { name: 'Accept invitation' }));

    expect(apiMock).toHaveBeenCalledWith('/orgs/token/good/accept', { method: 'POST' });
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(await screen.findByText('Invitation accepted')).toBeInTheDocument();
    expect(await screen.findByText('App destination')).toBeInTheDocument();
  });

  it('shows valid access-link info and redeems it for the office', async () => {
    const user = userEvent.setup();
    renderRoute('/access/abc');

    expect(await screen.findByText('Secure access link')).toBeInTheDocument();
    expect(screen.getByText('Main Office')).toBeInTheDocument();
    expect(screen.getByText('Focus Room')).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Enter the virtual office' }));

    expect(apiMock).toHaveBeenCalledWith('/access/abc/redeem', { method: 'POST' });
    expect(sessionStorage.getItem('saha_office_scope')).toBe(JSON.stringify({ workspaceId: 'ws-1', roomId: 'room-1' }));
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(await screen.findByText('Your access link is ready')).toBeInTheDocument();
    expect(await screen.findByText('Office destination')).toBeInTheDocument();
  });

  it('shows an invalid state for an expired access link', async () => {
    renderRoute('/access/expired');

    expect(await screen.findByText('This link is invalid, expired or has reached its usage limit')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Enter the virtual office' })).not.toBeInTheDocument();
  });
});
