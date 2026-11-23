// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, resetFrontendTestState, TestProviders } from '../../test-utils.js';
import type { Me, Member } from '../../types.js';
import { Members } from './Members.js';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
const { authState } = vi.hoisted(() => ({ authState: { me: null as Me | null } }));

vi.mock('../../lib/api.js', () => ({ api: apiMock }));
vi.mock('../../lib/auth.js', () => ({
  useAuth: () => ({ me: authState.me, loading: false, refresh: vi.fn() }),
}));

const members: Member[] = [
  {
    id: 'm-1', userId: 'user-1', name: 'Omar Saleh', phone: '+201000000002',
    role: 'student', team: 'Engineering', status: 'active', joinedAt: '2026-01-01T00:00:00.000Z',
  },
];

function useFixtures(options: { list?: Member[]; createdPassword?: string | null } = {}) {
  apiMock.mockImplementation(async (path: string, opts?: { method?: string; body?: unknown }) => {
    if (path === '/orgs/org-1/members' && opts?.method === 'POST') {
      return { temporaryPassword: options.createdPassword ?? 'one-time-123', notice: null };
    }
    if (path.startsWith('/orgs/org-1/members/') && opts?.method === 'PATCH') {
      return { membership: { ...members[0], ...opts.body as Partial<Member> } };
    }
    if (path === '/orgs/org-1/members') return { members: options.list ?? members };
    throw new Error(`Unexpected API call: ${opts?.method ?? 'GET'} ${path}`);
  });
}

function renderMembers() {
  return render(<TestProviders><Members /></TestProviders>);
}

describe('Members', () => {
  beforeEach(() => {
    resetFrontendTestState();
    vi.clearAllMocks();
    authState.me = adminMe;
  });

  it('shows loading skeletons before the member request resolves', () => {
    apiMock.mockReturnValue(new Promise<unknown>(() => {}));

    const { container } = renderMembers();

    expect(container.querySelectorAll('.skeleton').length).toBeGreaterThan(2);
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('renders an empty state when the org has no members', async () => {
    useFixtures({ list: [] });

    renderMembers();

    expect(await screen.findByRole('heading', { name: 'No members match this view' })).toBeInTheDocument();
    expect(screen.getByText('Add a person or adjust the filters.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Add member' }).length).toBeGreaterThan(0);
  });

  it('creates a member with the submitted form values and reveals the one-time password', async () => {
    useFixtures();
    const user = userEvent.setup();
    renderMembers();

    expect(await screen.findByText('Omar Saleh')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Add member' }));

    const dialog = screen.getByRole('dialog', { name: 'Add a member' });
    await user.type(within(dialog).getByLabelText('Name'), 'Lina Hassan');
    await user.type(within(dialog).getByLabelText('Phone'), '+201000000003');
    await user.click(within(dialog).getByRole('button', { name: 'Create' }));

    expect(apiMock).toHaveBeenCalledWith('/orgs/org-1/members', {
      method: 'POST',
      body: { name: 'Lina Hassan', phone: '+201000000003', role: 'student', team: 'General' },
    });
    expect(await screen.findByRole('dialog', { name: 'Temporary password' })).toBeInTheDocument();
    expect(screen.getByText('one-time-123')).toBeInTheDocument();
    expect(screen.getByText(/will not be shown again/)).toBeInTheDocument();
  });

  it('edits a member and reports success through a toast', async () => {
    useFixtures();
    const user = userEvent.setup();
    renderMembers();

    await user.click(await screen.findByRole('button', { name: 'Edit' }));
    const dialog = screen.getByRole('dialog', { name: 'Edit · Omar Saleh' });
    await user.selectOptions(within(dialog).getByLabelText('Role'), 'mentor');
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }));

    expect(apiMock).toHaveBeenCalledWith('/orgs/org-1/members/m-1', {
      method: 'PATCH',
      body: { role: 'mentor', team: 'Engineering', status: 'active' },
    });
    expect(await screen.findByText('Saved successfully')).toBeInTheDocument();
  });

  it('shows an error banner when loading members fails', async () => {
    apiMock.mockRejectedValue(new Error('Members service unavailable'));

    renderMembers();

    expect(await screen.findByText('Members service unavailable')).toBeInTheDocument();
    expect(screen.getByText('Members service unavailable')).toHaveClass('error-banner');
  });
});
