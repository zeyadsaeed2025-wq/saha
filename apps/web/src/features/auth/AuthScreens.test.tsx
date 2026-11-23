// @vitest-environment jsdom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TestProviders, resetFrontendTestState } from '../../test-utils.js';
import type { Me } from '../../types.js';
import { ForgotPassword, Login, Register } from './AuthScreens.js';

const { apiMock } = vi.hoisted(() => ({ apiMock: vi.fn() }));
const { authState } = vi.hoisted(() => ({ authState: { me: null as Me | null, loading: false } }));
const { loginMock, registerMock, refreshMock, logoutMock, switchOrgMock, seedDemoMock } = vi.hoisted(() => ({
  loginMock: vi.fn(), registerMock: vi.fn(), refreshMock: vi.fn(),
  logoutMock: vi.fn(), switchOrgMock: vi.fn(), seedDemoMock: vi.fn(),
}));

vi.mock('../../lib/api.js', () => ({ api: apiMock }));
vi.mock('../../lib/auth.js', () => ({
  useAuth: () => ({
    me: authState.me, loading: authState.loading, refresh: refreshMock,
    login: loginMock, register: registerMock, logout: logoutMock,
    switchOrg: switchOrgMock, seedDemo: seedDemoMock,
  }),
}));

function renderLogin() {
  return render(
    <TestProviders initialEntries={['/login']}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/app/schedules" element={<div>Destination reached</div>} />
      </Routes>
    </TestProviders>,
  );
}

function renderRegister() {
  return render(
    <TestProviders initialEntries={['/register']}>
      <Routes>
        <Route path="/register" element={<Register />} />
        <Route path="/onboarding" element={<div>Onboarding reached</div>} />
      </Routes>
    </TestProviders>,
  );
}

function renderForgotPassword() {
  return render(
    <TestProviders initialEntries={['/forgot-password']}>
      <Routes>
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="/login" element={<div>Back at login</div>} />
      </Routes>
    </TestProviders>,
  );
}

describe('auth screens', () => {
  beforeEach(() => {
    resetFrontendTestState();
    vi.clearAllMocks();
    authState.me = null;
    authState.loading = false;
    loginMock.mockResolvedValue(undefined);
    registerMock.mockResolvedValue(undefined);
    refreshMock.mockResolvedValue(undefined);
  });

  it('submits the login form with the exact phone/password and honors a saved return path', async () => {
    sessionStorage.setItem('saha_return_to', '/app/schedules');
    const user = userEvent.setup();
    renderLogin();

    expect(screen.getByLabelText('Phone')).toBeRequired();
    expect(screen.getByLabelText('Password')).toHaveAttribute('type', 'password');

    await user.type(screen.getByLabelText('Phone'), '+201000000001');
    await user.type(screen.getByLabelText('Password'), 'secret123');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(loginMock).toHaveBeenCalledWith('+201000000001', 'secret123');
    expect(await screen.findByText('Destination reached')).toBeInTheDocument();
    expect(screen.getByText('Sign in', { selector: '.toast span' })).toBeInTheDocument();
    expect(sessionStorage.getItem('saha_return_to')).toBeNull();
  });

  it('shows the login error banner when authentication fails', async () => {
    loginMock.mockRejectedValue(new Error('Invalid phone or password'));
    const user = userEvent.setup();
    renderLogin();

    await user.type(screen.getByLabelText('Phone'), '+201000000001');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid phone or password');
    expect(screen.queryByText('Destination reached')).not.toBeInTheDocument();
  });

  it('registers with name, phone and password, then continues to onboarding', async () => {
    const user = userEvent.setup();
    renderRegister();

    await user.type(screen.getByLabelText('Full name'), 'Lina Hassan');
    await user.type(screen.getByPlaceholderText('+20 100 000 0001'), '+201000000001');
    await user.type(screen.getByLabelText(/Password/), 'longpassword');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(registerMock).toHaveBeenCalledWith('Lina Hassan', '+201000000001', 'longpassword');
    expect(await screen.findByText('Onboarding reached')).toBeInTheDocument();
    expect(screen.getByText('Account created. Add your organization next.')).toBeInTheDocument();
  });

  it('honors a saved return path during registration', async () => {
    sessionStorage.setItem('saha_return_to', '/app/schedules');
    const user = userEvent.setup();
    render(
      <TestProviders initialEntries={['/register']}>
        <Routes>
          <Route path="/register" element={<Register />} />
          <Route path="/app/schedules" element={<div>Saved destination reached</div>} />
        </Routes>
      </TestProviders>,
    );

    await user.type(screen.getByLabelText('Full name'), 'Omar Saleh');
    await user.type(screen.getByPlaceholderText('+20 100 000 0001'), '+201000000002');
    await user.type(screen.getByLabelText(/Password/), 'longpassword');
    await user.click(screen.getByRole('button', { name: 'Create account' }));

    expect(await screen.findByText('Saved destination reached')).toBeInTheDocument();
  });

  it('honestly shows the local dev reset code and submits the reset payload', async () => {
    apiMock.mockImplementation(async (path: string, options?: { method?: string; body?: unknown }) => {
      if (path === '/auth/forgot' && options?.method === 'POST') return { devCode: '123456' };
      if (path === '/auth/reset' && options?.method === 'POST') return undefined;
      throw new Error(`Unexpected API call: ${options?.method ?? 'GET'} ${path}`);
    });
    const user = userEvent.setup();
    renderForgotPassword();

    await user.type(screen.getByLabelText('Phone'), '+201000000001');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(apiMock).toHaveBeenCalledWith('/auth/forgot', {
      method: 'POST', body: { phone: '+201000000001' },
    });
    expect(screen.getByText(/no SMS provider is configured/)).toBeInTheDocument();
    expect(screen.getByText('123456')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Verification code'), '123456');
    await user.type(screen.getByLabelText('New password'), 'brandnewpassword');
    await user.click(screen.getByRole('button', { name: 'Save changes' }));

    expect(apiMock).toHaveBeenCalledWith('/auth/reset', {
      method: 'POST', body: { phone: '+201000000001', code: '123456', newPassword: 'brandnewpassword' },
    });
    expect(await screen.findByText('Back at login')).toBeInTheDocument();
  });

  it('shows a request error if the reset code cannot be sent', async () => {
    apiMock.mockRejectedValue(new Error('Phone number not registered'));
    const user = userEvent.setup();
    renderForgotPassword();

    await user.type(screen.getByLabelText('Phone'), '+201099999999');
    await user.click(screen.getByRole('button', { name: 'Send code' }));

    expect(await screen.findByText('Phone number not registered')).toBeInTheDocument();
    expect(screen.queryByText(/no SMS provider is configured/)).not.toBeInTheDocument();
  });
});
