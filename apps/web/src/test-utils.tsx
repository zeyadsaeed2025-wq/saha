import type { ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from './lib/i18n.js';
import { ToastProvider } from './lib/toast.js';
import type { Me } from './types.js';

/** Common providers for component tests. Auth is mocked per test file. */
export function TestProviders({ children, initialEntries = ['/'] }: {
  children: ReactNode;
  initialEntries?: string[];
}) {
  return (
    <MemoryRouter initialEntries={initialEntries}>
      <I18nProvider>
        <ToastProvider>{children}</ToastProvider>
      </I18nProvider>
    </MemoryRouter>
  );
}

export function resetFrontendTestState(): void {
  localStorage.clear();
  sessionStorage.clear();
  document.documentElement.dir = '';
  document.documentElement.lang = '';
}

export const adminMe: Me = {
  user: { id: 'user-admin', phone: '+201000000001', name: 'Lina Hassan' },
  activeOrgId: 'org-1',
  organization: {
    id: 'org-1', name: 'Northstar Academy', timezone: 'Africa/Cairo',
    settings: { graceMinutesDefault: 10, heartbeatSeconds: 60, verificationWindowMinutes: 15, demo: false },
  },
  memberships: [{ organizationId: 'org-1', organizationName: 'Northstar Academy', role: 'org_admin', team: 'General' }],
  role: 'org_admin',
  isGuest: false,
};
