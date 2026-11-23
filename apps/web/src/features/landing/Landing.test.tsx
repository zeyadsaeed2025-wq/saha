// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProviders, resetFrontendTestState } from '../../test-utils.js';
import { Landing } from './Landing.js';

const { seedDemoMock, refreshMock } = vi.hoisted(() => ({
  seedDemoMock: vi.fn(), refreshMock: vi.fn(),
}));
const { authState } = vi.hoisted(() => ({ authState: { me: null as unknown } }));

vi.mock('../../lib/auth.js', () => ({
  useAuth: () => ({ me: authState.me, loading: false, refresh: refreshMock, seedDemo: seedDemoMock }),
}));

function renderLanding() {
  return render(
    <TestProviders initialEntries={['/']}>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/app" element={<div>Dashboard destination</div>} />
        <Route path="/register" element={<div>Register destination</div>} />
      </Routes>
    </TestProviders>,
  );
}

describe('landing demo login CTA', () => {
  beforeEach(() => {
    resetFrontendTestState();
    vi.clearAllMocks();
    authState.me = null;
  });

  it('seeds demo data and enters the app from the demo CTA', async () => {
    seedDemoMock.mockResolvedValue({ adminPhone: '+201000000001', adminPassword: 'demo-pass', alreadySeeded: false });
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: 'Explore the demo' }));

    expect(seedDemoMock).toHaveBeenCalledOnce();
    expect(await screen.findByText('Dashboard destination')).toBeInTheDocument();
    expect(screen.getByText('Sample data')).toBeInTheDocument();
  });

  it('reports a demo seeding failure instead of navigating away', async () => {
    seedDemoMock.mockRejectedValue(new Error('Demo seed unavailable'));
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getByRole('button', { name: 'Explore the demo' }));

    expect(await screen.findByText('Demo seed unavailable')).toBeInTheDocument();
    expect(screen.queryByText('Dashboard destination')).not.toBeInTheDocument();
  });

  it('sends a signed-out visitor to registration from Get started', async () => {
    const user = userEvent.setup();
    renderLanding();

    await user.click(screen.getAllByRole('button', { name: 'Start your workspace' })[0]);

    expect(await screen.findByText('Register destination')).toBeInTheDocument();
  });
});
