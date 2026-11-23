// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, resetFrontendTestState, TestProviders } from '../../test-utils.js';
import type { AccessLink, Invitation, Me, Member, Room, Workspace } from '../../types.js';
import { Invitations } from './Invitations.js';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
const { authState } = vi.hoisted(() => ({ authState: { me: null as Me | null } }));

vi.mock('../../lib/api.js', () => ({ api: apiMock }));
vi.mock('../../lib/auth.js', () => ({
  useAuth: () => ({ me: authState.me, loading: false, refresh: vi.fn() }),
}));

const workspace: Workspace = {
  id: 'ws-1', organizationId: 'org-1', name: 'Main Office', description: 'Primary workspace', width: 800, height: 600,
};
const room: Room = {
  id: 'room-1', workspaceId: 'ws-1', name: 'Focus Room', kind: 'focus', privacy: 'public',
  bounds: { x: 0, y: 0, w: 100, h: 100 }, color: '#fff', allowedRoles: ['student'], capacity: 20,
};
const member: Member = {
  id: 'm-1', userId: 'user-1', name: 'Omar Saleh', phone: '+201000000002',
  role: 'mentor', team: 'Engineering', status: 'active', joinedAt: '2026-01-01T00:00:00.000Z',
};
const activeLink: AccessLink = {
  id: 'link-1', kind: 'passwordless_member', workspaceId: 'ws-1', roomId: null,
  subjectUserId: 'user-1', expiresAt: '2026-12-01T00:00:00.000Z', maxUses: 10, uses: 0, active: true,
};
const invitation: Invitation = {
  id: 'inv-1', role: 'student', team: 'Engineering', expiresAt: '2026-12-01T00:00:00.000Z',
  maxUses: 1, uses: 0, active: true, phone: null, email: null,
};

function useFixtures(options: { links?: AccessLink[]; invitations?: Invitation[]; workspaces?: Workspace[] } = {}) {
  apiMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    if (opts?.method === 'POST') {
      if (path === '/orgs/org-1/invitations') return { url: 'https://saha.test/join/invite-raw' };
      if (path === '/orgs/org-1/access-links') return { url: 'https://saha.test/access/link-raw' };
      if (path.endsWith('/revoke')) return undefined;
    }
    if (!opts?.method || opts.method === 'GET') {
      if (path === '/orgs/org-1/invitations') return { invitations: options.invitations ?? [] };
      if (path === '/orgs/org-1/access-links') return { links: options.links ?? [] };
      if (path === '/orgs/org-1/workspaces') return { workspaces: options.workspaces ?? [workspace] };
      if (path === '/orgs/org-1/members') return { members: [member] };
      if (path === '/orgs/org-1/workspaces/ws-1') return { workspace, rooms: [room] };
    }
    throw new Error(`Unexpected API call: ${opts?.method ?? 'GET'} ${path}`);
  });
}

function renderInvitations() {
  return render(<TestProviders><Invitations /></TestProviders>);
}

describe('Invitations', () => {
  beforeEach(() => {
    resetFrontendTestState();
    vi.clearAllMocks();
    authState.me = adminMe;
  });

  it('shows loading skeletons while invitations, links and workspaces load', () => {
    apiMock.mockReturnValue(new Promise<unknown>(() => {}));

    const { container } = renderInvitations();

    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(2);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders empty states on both tabs', async () => {
    useFixtures();
    const user = userEvent.setup();
    renderInvitations();

    expect(await screen.findByRole('heading', { name: 'No links created yet.' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Scoped access links/ }));

    expect(await screen.findByRole('heading', { name: 'No links created yet' })).toBeInTheDocument();
  });

  it('creates an invitation with the form payload and shows the raw link once', async () => {
    useFixtures();
    const user = userEvent.setup();
    renderInvitations();

    await screen.findByRole('heading', { name: 'No links created yet.' });
    await user.click(screen.getAllByRole('button', { name: 'Create link' })[0]);

    const dialog = screen.getByRole('dialog', { name: 'Create link' });
    await user.type(within(dialog).getByLabelText('Restrict to phone (optional)'), '+201000000009');
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }));

    expect(apiMock).toHaveBeenCalledWith('/orgs/org-1/invitations', {
      method: 'POST',
      body: {
        phone: '+201000000009', role: 'student', team: 'General',
        expiresInHours: 168, maxUses: 1,
      },
    });
    expect(await screen.findByRole('dialog', { name: /Link created · Member invitation/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://saha.test/join/invite-raw')).toBeInTheDocument();
    expect(screen.getByText(/shown only once/)).toBeInTheDocument();
  });

  it('creates a passwordless access link with the selected workspace and subject', async () => {
    useFixtures();
    const user = userEvent.setup();
    renderInvitations();

    await user.click(await screen.findByRole('button', { name: /Scoped access links/ }));
    await user.click(screen.getAllByRole('button', { name: 'Create link' })[0]);

    const dialog = screen.getByRole('dialog', { name: 'Create link' });
    await user.selectOptions(within(dialog).getByLabelText('Workspace'), 'ws-1');
    await user.selectOptions(within(dialog).getByLabelText('Link subject'), 'user-1');
    await user.click(within(dialog).getByRole('button', { name: 'Create link' }));

    expect(apiMock).toHaveBeenCalledWith('/orgs/org-1/access-links', {
      method: 'POST',
      body: {
        kind: 'passwordless_member', workspaceId: 'ws-1', roomId: null, subjectUserId: 'user-1',
        expiresInHours: 24, maxUses: 10,
      },
    });
    expect(await screen.findByRole('dialog', { name: /Link created · Passwordless member link/ })).toBeInTheDocument();
    expect(screen.getByDisplayValue('https://saha.test/access/link-raw')).toBeInTheDocument();
  });

  it('revokes an active link and confirms it with a toast', async () => {
    useFixtures({ links: [activeLink] });
    const user = userEvent.setup();
    renderInvitations();

    await user.click(await screen.findByRole('button', { name: /Scoped access links/ }));
    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    expect(apiMock).toHaveBeenCalledWith('/orgs/org-1/access-links/link-1/revoke', { method: 'POST' });
    expect(await screen.findByText('Link revoked')).toBeInTheDocument();
  });

  it('shows an error banner if the initial loader rejects', async () => {
    apiMock.mockRejectedValue(new Error('Invitation service unavailable'));

    renderInvitations();

    expect(await screen.findByText('Invitation service unavailable')).toBeInTheDocument();
    expect(screen.getByText('Invitation service unavailable')).toHaveClass('error-banner');
  });

  it('lists an invitation returned by the API', async () => {
    useFixtures({ invitations: [invitation] });

    renderInvitations();

    expect(await screen.findByText('Engineering')).toBeInTheDocument();
    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke' })).toBeEnabled();
  });
});
