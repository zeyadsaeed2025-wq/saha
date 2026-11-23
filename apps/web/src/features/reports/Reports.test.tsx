// @vitest-environment jsdom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { adminMe, resetFrontendTestState, TestProviders } from '../../test-utils.js';
import type { Me, Member, MemberReport, ReportSummary, SessionReportRow, Workspace } from '../../types.js';
import { Reports } from './Reports.js';

const { apiMock, downloadCsvMock } = vi.hoisted(() => ({ apiMock: vi.fn(), downloadCsvMock: vi.fn() }));
const { authState } = vi.hoisted(() => ({ authState: { me: null as Me | null } }));

vi.mock('../../lib/api.js', () => ({ api: apiMock, downloadCsv: downloadCsvMock }));
vi.mock('../../lib/auth.js', () => ({
  useAuth: () => ({ me: authState.me, loading: false, refresh: vi.fn() }),
}));

const summary: ReportSummary = {
  expected: 10, present: 8, onTime: 6, late: 2, partial: 0, absent: 2,
  excused: 0, pendingReview: 0, confirmedConnectedSeconds: 3600,
  confirmedConnectedLabel: '1h', punctualityRate: 75, exceptions: 0,
};
const memberReport: MemberReport = {
  userId: 'user-1', memberName: 'Omar Saleh', team: 'Engineering', role: 'mentor',
  scheduled: 10, attended: 8, onTime: 6, late: 2, absent: 2,
  connectedSeconds: 3600, latenessSeconds: 120, punctualityRate: 75, connectedLabel: '1h',
};
const sessionReport: SessionReportRow = {
  id: 's-1', day: '2026-01-15', memberName: 'Omar Saleh', team: 'Engineering', role: 'mentor',
  title: 'Morning shift', status: 'late', scheduledMinutes: 60, connectedSeconds: 1800,
  countedLatenessSeconds: 120, breakSeconds: 0, earlyLeaveSeconds: 0, note: '',
};
const member: Member = {
  id: 'm-1', userId: 'user-1', name: 'Omar Saleh', phone: '+201000000002',
  role: 'mentor', team: 'Engineering', status: 'active', joinedAt: '2026-01-01T00:00:00.000Z',
};
const workspace: Workspace = {
  id: 'ws-1', organizationId: 'org-1', name: 'Main Office', description: '', width: 800, height: 600,
};

function useFixtures() {
  apiMock.mockImplementation(async (path: string) => {
    if (path.startsWith('/orgs/org-1/reports/summary?')) {
      return { summary, teams: [], trend: [] };
    }
    if (path.startsWith('/orgs/org-1/reports/members?')) return { members: [memberReport] };
    if (path.startsWith('/orgs/org-1/reports/sessions?')) return { sessions: [sessionReport] };
    if (path === '/orgs/org-1/members') return { members: [member] };
    if (path === '/orgs/org-1/workspaces') return { workspaces: [workspace] };
    throw new Error(`Unexpected API call: ${path}`);
  });
}

function renderReports() {
  return render(<TestProviders><Reports /></TestProviders>);
}

async function waitForReports() {
  await screen.findByRole('heading', { name: 'Reports' });
}

async function changeDate(index: number, value: string) {
  const inputs = document.querySelectorAll<HTMLInputElement>('input[type="date"]');
  expect(inputs).toHaveLength(2);
  fireEvent.change(inputs[index], { target: { value } });
  await waitForReports();
}

async function applyDeterministicFilters() {
  const user = userEvent.setup();
  renderReports();
  await waitForReports();

  await changeDate(0, '2026-01-01');
  await changeDate(1, '2026-02-01');
  await user.selectOptions(await screen.findByLabelText('Team'), 'Engineering');
  await waitForReports();
  await user.selectOptions(await screen.findByLabelText('Status'), 'late');
  await waitForReports();

  await waitFor(() => expect(apiMock).toHaveBeenCalledWith(
    '/orgs/org-1/reports/summary?from=2026-01-01&to=2026-02-01&team=Engineering&status=late',
  ));
  return user;
}

describe('Reports', () => {
  beforeEach(() => {
    resetFrontendTestState();
    vi.clearAllMocks();
    authState.me = adminMe;
    downloadCsvMock.mockResolvedValue(undefined);
  });

  it('shows skeletons while reports load, then the summary from the API', async () => {
    apiMock.mockReturnValue(new Promise<unknown>(() => {}));
    const loading = renderReports();
    expect(loading.container.querySelectorAll('.skeleton').length).toBeGreaterThan(2);
    loading.unmount();

    useFixtures();
    const user = userEvent.setup();
    renderReports();

    expect((await screen.findAllByText('75%')).length).toBeGreaterThan(0);
    expect((await screen.findAllByText('Omar Saleh')).length).toBeGreaterThan(0);
    await user.click(screen.getByRole('button', { name: 'Scheduled sessions' }));
    expect(screen.getByText('Morning shift')).toBeInTheDocument();
    expect(screen.getAllByText('Late').length).toBeGreaterThan(0);
  });

  it('sends selected filters to every report endpoint', async () => {
    useFixtures();
    await applyDeterministicFilters();

    const expectedQuery = 'from=2026-01-01&to=2026-02-01&team=Engineering&status=late';
    expect(apiMock).toHaveBeenCalledWith(`/orgs/org-1/reports/summary?${expectedQuery}`);
    expect(apiMock).toHaveBeenCalledWith(`/orgs/org-1/reports/members?${expectedQuery}`);
    expect(apiMock).toHaveBeenCalledWith(`/orgs/org-1/reports/sessions?${expectedQuery}`);
  });

  it('exports CSV through the real download endpoint with the active filters', async () => {
    useFixtures();
    const user = await applyDeterministicFilters();
    vi.clearAllMocks();
    downloadCsvMock.mockResolvedValue(undefined);

    await user.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(downloadCsvMock).toHaveBeenCalledWith(
      '/orgs/org-1/reports/export.csv?from=2026-01-01&to=2026-02-01&team=Engineering&status=late',
      'saha-attendance-2026-01-01-2026-02-01.csv',
    );
    expect(await screen.findByText('Saved successfully')).toBeInTheDocument();
  });

  it('shows an error banner when a report request fails', async () => {
    apiMock.mockRejectedValue(new Error('Report service unavailable'));

    renderReports();

    expect(await screen.findByText('Report service unavailable')).toBeInTheDocument();
    expect(screen.getByText('Report service unavailable')).toHaveClass('error-banner');
  });
});
