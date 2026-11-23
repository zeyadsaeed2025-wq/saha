// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, resetFrontendTestState, TestProviders } from '../../test-utils.js';
import type { Me, Organization, Room, Workspace } from '../../types.js';
import { Settings } from './Settings.js';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
const { authState } = vi.hoisted(() => ({ authState: { me: null as Me | null } }));

vi.mock('../../lib/api.js', () => ({ api: apiMock }));
vi.mock('../../lib/auth.js', () => ({
  useAuth: () => ({ me: authState.me, loading: false, refresh: vi.fn() }),
}));

const organization: Organization = {
  id: 'org-1', name: 'Northstar Academy', slug: 'northstar', timezone: 'Africa/Cairo',
  settings: { graceMinutesDefault: 10, heartbeatSeconds: 60, verificationWindowMinutes: 15, demo: false },
};
const workspace: Workspace = {
  id: 'ws-1', organizationId: 'org-1', name: 'Main Office', description: 'Primary workspace', width: 800, height: 600,
};
const room: Room = {
  id: 'room-1', workspaceId: 'ws-1', name: 'Focus Room', kind: 'focus', privacy: 'public',
  bounds: { x: 0, y: 0, w: 100, h: 100 }, color: '#fff', allowedRoles: ['student'], capacity: 20,
};
const sessions = [
  { id: 'session-current', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z', current: true },
  { id: 'session-other', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-01-02T00:00:00.000Z', current: false },
];

function useFixtures() {
  apiMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    if (opts?.method === 'PATCH' && path === '/orgs/org-1') {
      return { organization: { ...organization, ...opts.body as Partial<Organization> } };
    }
    if (opts?.method === 'PATCH' && path === '/orgs/org-1/workspaces/ws-1/rooms/room-1') {
      return { room: { ...room, ...opts.body as Partial<Room> } };
    }
    if (opts?.method === 'DELETE' && path === '/auth/sessions/session-other') return undefined;
    if (!opts?.method || opts.method === 'GET') {
      if (path === '/orgs/org-1') return { organization };
      if (path === '/auth/sessions') return { sessions };
      if (path === '/orgs/org-1/workspaces') return { workspaces: [workspace] };
      if (path === '/orgs/org-1/workspaces/ws-1') return { workspace, rooms: [room] };
    }
    throw new Error(`Unexpected API call: ${opts?.method ?? 'GET'} ${path}`);
  });
}

function renderSettings() {
  return render(<TestProviders><Settings /></TestProviders>);
}

describe('Settings', () => {
  beforeEach(() => {
    resetFrontendTestState();
    vi.clearAllMocks();
    authState.me = adminMe;
  });

  it('shows skeletons while settings load', () => {
    apiMock.mockReturnValue(new Promise<unknown>(() => {}));

    const { container } = renderSettings();

    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(1);
    expect(screen.queryByRole('heading', { name: 'Settings' })).not.toBeInTheDocument();
  });

  it('saves organization settings with the edited form values and a success toast', async () => {
    useFixtures();
    const user = userEvent.setup();
    renderSettings();

    const nameInput = await screen.findByLabelText('Organization name') as HTMLInputElement;
    await user.clear(nameInput);
    await user.type(nameInput, 'New Academy Name');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(apiMock).toHaveBeenCalledWith('/orgs/org-1', {
      method: 'PATCH',
      body: {
        name: 'New Academy Name', timezone: 'Africa/Cairo', graceMinutesDefault: 10,
        heartbeatSeconds: 60, verificationWindowMinutes: 15,
      },
    });
    expect(await screen.findByText('Organization settings saved')).toBeInTheDocument();
  });

  it('updates room privacy and capacity through the room modal', async () => {
    useFixtures();
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: /Focus Room/ }));

    const dialog = screen.getByRole('dialog', { name: 'Edit · Focus Room' });
    await user.selectOptions(within(dialog).getByLabelText('Room privacy'), 'private');
    await user.clear(within(dialog).getByLabelText('Capacity'));
    await user.type(within(dialog).getByLabelText('Capacity'), '30');
    await user.click(within(dialog).getByRole('button', { name: 'Save room' }));

    expect(apiMock).toHaveBeenCalledWith('/orgs/org-1/workspaces/ws-1/rooms/room-1', {
      method: 'PATCH', body: { privacy: 'private', capacity: 30 },
    });
    expect(await screen.findByText('Room updated')).toBeInTheDocument();
  });

  it('revokes another active session after confirmation', async () => {
    useFixtures();
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const user = userEvent.setup();
    renderSettings();

    await user.click(await screen.findByRole('button', { name: 'Revoke' }));

    expect(apiMock).toHaveBeenCalledWith('/auth/sessions/session-other', { method: 'DELETE' });
    expect(await screen.findByText('Link revoked')).toBeInTheDocument();
    confirmSpy.mockRestore();
  });

  it('shows an error banner when the settings loader rejects', async () => {
    apiMock.mockRejectedValue(new Error('Settings unavailable'));

    renderSettings();

    expect(await screen.findByText('Settings unavailable')).toBeInTheDocument();
    expect(screen.getByText('Settings unavailable')).toHaveClass('error-banner');
  });
});
