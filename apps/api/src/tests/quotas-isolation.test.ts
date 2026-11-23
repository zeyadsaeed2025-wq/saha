import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { rmSync } from 'node:fs';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Entitlement unit checks plus cross-tenant API isolation. HTTP tests use the
// local JSON adapter over localhost; pure entitlement checks use emptyState()
// directly and never touch a database or a payment provider.
const dataFile = join(tmpdir(), `saha-quotas-isolation-tests-${process.pid}.json`);
process.env.LOCAL_DATA_FILE = dataFile;
delete process.env.DATA_ADAPTER;
process.env.COOKIE_SECURE = 'false';
process.env.APP_URL = 'http://localhost:5173';

const { store } = await import('../common/store.js');
const { createApp } = await import('../app.js');
const { emptyState } = await import('../domain/types.js');
const { AppError } = await import('../common/errors.js');
const {
  DEFAULT_LIMITS, addUsage, getEntitlements,
} = await import('../modules/billing/entitlements.js');

const PASSWORD = 'Passw0rd!';
let server: Server;
let baseUrl = '';

beforeAll(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await new Promise<void>((resolve, reject) => {
    server.once('listening', resolve);
    server.once('error', reject);
  });
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  server.closeAllConnections();
  rmSync(dataFile, { force: true });
});

beforeEach(() => store.reset());

class Jar {
  private readonly cookies = new Map<string, string>();

  ingest(response: Response): void {
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';');
      const at = pair.indexOf('=');
      if (at < 0) continue;
      const name = pair.slice(0, at).trim();
      const value = pair.slice(at + 1).trim();
      if (!value || /expires=Thu, 01 Jan 1970/i.test(raw)) this.cookies.delete(name);
      else this.cookies.set(name, value);
    }
  }

  get(name: string): string | undefined { return this.cookies.get(name); }

  header(): string { return [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '); }
}

interface Result {
  status: number;
  body: any; // eslint-disable-line @typescript-eslint/no-explicit-any -- test helper parses arbitrary JSON
  raw: string;
}

async function api(jar: Jar | null, method: string, path: string, body?: unknown,
  options: { csrf?: boolean } = {}): Promise<Result> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  const cookies = jar?.header();
  if (cookies) headers.Cookie = cookies;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const csrf = jar?.get('saha_csrf');
  if ((options.csrf ?? true) && !['GET', 'HEAD', 'OPTIONS'].includes(method) && csrf) {
    headers['x-csrf-token'] = csrf;
  }
  const response = await fetch(`${baseUrl}${path}`, {
    method, headers, body: body === undefined ? undefined : JSON.stringify(body),
  });
  jar?.ingest(response);
  const raw = await response.text();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { parsed = raw; }
  return { status: response.status, body: parsed, raw };
}

async function register(name: string, phone: string): Promise<void> {
  const result = await api(null, 'POST', '/api/auth/register', { name, phone, password: PASSWORD }, { csrf: false });
  expect(result.status, result.raw).toBe(201);
}

async function login(phone: string, password = PASSWORD): Promise<{ jar: Jar; userId: string }> {
  const jar = new Jar();
  const result = await api(jar, 'POST', '/api/auth/login', { phone, password }, { csrf: false });
  expect(result.status, result.raw).toBe(200);
  return { jar, userId: result.body.user.id as string };
}

async function createOwner(name: string, phone: string) {
  await register(name, phone);
  const signedIn = await login(phone);
  const created = await api(signedIn.jar, 'POST', '/api/orgs', { name: `${name} Org`, timezone: 'UTC' });
  expect(created.status, created.raw).toBe(201);
  const orgId = created.body.organization.id as string;
  const workspaces = await api(signedIn.jar, 'GET', `/api/orgs/${orgId}/workspaces`);
  return {
    ...signedIn, orgId, workspaceId: workspaces.body.workspaces[0].id as string,
  };
}

describe('entitlements (pure local logic; no database)', () => {
  it('applies DEFAULT_LIMITS when no subscription exists', () => {
    const state = emptyState();
    const entitlements = getEntitlements(state, 'org-without-plan');
    expect(entitlements.planId).toBeNull();
    expect(entitlements.planName).toBe('Default plan');
    expect(entitlements.status).toBe('none');
    expect(entitlements.limits).toEqual(DEFAULT_LIMITS);
    expect(entitlements.usage.members).toBe(0);
    expect(entitlements.remaining.members).toBe(DEFAULT_LIMITS.members);
    expect(entitlements.allow('members', 1)).toBe(true);
    expect(() => entitlements.assert('members', 1)).not.toThrow();
  });

  it('enforces a plan limit and throws a typed QUOTA_EXCEEDED AppError at the boundary', () => {
    const orgId = 'org-tiny';
    const state = emptyState();
    const now = new Date().toISOString();
    state.plans.push({
      id: 'plan-tiny', name: 'Tiny', description: 'Restrictive local plan', interval: 'monthly',
      priceCents: 0, currency: 'USD', features: [],
      limits: { ...DEFAULT_LIMITS, members: 1, meetingsPerMonth: 0 }, status: 'active', createdAt: now,
    });
    state.subscriptions.push({
      id: 'sub-tiny', organizationId: orgId, planId: 'plan-tiny', status: 'active',
      trialEndsAt: null, currentPeriodStart: now, currentPeriodEnd: now,
      cancelAtPeriodEnd: false, graceUntil: null, createdAt: now, updatedAt: now,
    });
    state.memberships.push({
      id: 'member-tiny', organizationId: orgId, userId: 'user-tiny', role: 'org_admin',
      team: 'Leadership', status: 'active', joinedAt: now,
    });

    const entitlements = getEntitlements(state, orgId);
    expect(entitlements.planId).toBe('plan-tiny');
    expect(entitlements.limits.members).toBe(1);
    expect(entitlements.usage.members).toBe(1);
    expect(entitlements.remaining.members).toBe(0);
    expect(entitlements.allow('members')).toBe(false);
    expect(entitlements.allow('meetingsPerMonth')).toBe(false);

    let caught: unknown;
    try { entitlements.assert('members', 1); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(AppError);
    expect(caught).toMatchObject({
      status: 403, code: 'QUOTA_EXCEEDED',
      details: { metric: 'members', limit: 1, usage: 1 },
    });

    // Past-due subscriptions fall back to the generous product defaults.
    state.subscriptions[0].status = 'past_due';
    const pastDue = getEntitlements(state, orgId);
    expect(pastDue.limits).toEqual(DEFAULT_LIMITS);
    expect(pastDue.allow('members')).toBe(true);
  });

  it('addUsage accumulates metered values for the correct organization', () => {
    const state = emptyState();
    addUsage(state, 'org-meter', 'recordingMinutes', 12, '2026-11-23T00:00:00.000Z');
    addUsage(state, 'org-meter', 'recordingMinutes', 8, '2026-11-23T00:05:00.000Z');
    addUsage(state, 'org-other', 'recordingMinutes', 500, '2026-11-23T00:06:00.000Z');

    const entitlements = getEntitlements(state, 'org-meter');
    expect(entitlements.usage.recordingMinutes).toBe(20);
    expect(entitlements.remaining.recordingMinutes).toBe(DEFAULT_LIMITS.recordingMinutes - 20);
    expect(getEntitlements(state, 'org-other').usage.recordingMinutes).toBe(500);
    expect(getEntitlements(state, 'org-empty').usage.recordingMinutes).toBe(0);
  });
});

describe('quota enforcement through the API', () => {
  it('rejects member and meeting creation once a restrictive plan is reached', async () => {
    const owner = await createOwner('Quota Admin', '+14155559101');
    const now = new Date().toISOString();
    await store.mutate((draft) => {
      draft.plans.push({
        id: 'plan-restrictive', name: 'Restrictive', description: 'Test plan', interval: 'monthly',
        priceCents: 0, currency: 'USD', features: [],
        limits: { ...DEFAULT_LIMITS, members: 1, meetingsPerMonth: 0 }, status: 'active', createdAt: now,
      });
      draft.subscriptions.push({
        id: 'sub-restrictive', organizationId: owner.orgId, planId: 'plan-restrictive', status: 'active',
        trialEndsAt: null, currentPeriodStart: now, currentPeriodEnd: now,
        cancelAtPeriodEnd: false, graceUntil: null, createdAt: now, updatedAt: now,
      });
    });

    const overview = await api(owner.jar, 'GET', `/api/orgs/${owner.orgId}/billing/overview`);
    expect(overview.body.entitlements).toMatchObject({ planId: 'plan-restrictive', status: 'active' });
    expect(overview.body.entitlements.usage.members).toBe(1);

    const member = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/members`, {
      phone: '+14155559102', name: 'Blocked Student', role: 'student',
    });
    expect(member.status, member.raw).toBe(403);
    expect(member.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(member.body.error.details).toMatchObject({ metric: 'members', limit: 1, usage: 1 });

    const meeting = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/media/meetings`, {
      title: 'Blocked meeting', workspaceId: owner.workspaceId,
    });
    expect(meeting.status, meeting.raw).toBe(403);
    expect(meeting.body.error.code).toBe('QUOTA_EXCEEDED');
    expect(meeting.body.error.details).toMatchObject({ metric: 'meetingsPerMonth', limit: 0 });
  });
});

describe('team administration', () => {
  it('creates, renames, moves members between, isolates and deletes teams', async () => {
    const owner = await createOwner('Team Admin', '+14155559501');
    const added = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/members`, {
      phone: '+14155559502', name: 'Team Student', role: 'student', team: 'General',
    });
    expect(added.status, added.raw).toBe(201);
    const membershipId = added.body.member.id as string;

    const first = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/teams`, {
      name: 'Builders', description: 'Build team', leadUserId: owner.userId,
    });
    expect(first.status, first.raw).toBe(201);
    const firstId = first.body.team.id as string;

    const listed = await api(owner.jar, 'GET', `/api/orgs/${owner.orgId}/teams`);
    expect(listed.body.teams).toHaveLength(1);
    expect(listed.body.teams[0]).toMatchObject({ leadName: 'Team Admin', memberCount: 0 });

    const moved = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/teams/${firstId}/members`, { membershipId });
    expect(moved.status, moved.raw).toBe(200);
    expect(moved.body.membership.team).toBe('Builders');

    const renamed = await api(owner.jar, 'PATCH', `/api/orgs/${owner.orgId}/teams/${firstId}`, {
      name: 'Makers', description: 'Renamed team',
    });
    expect(renamed.status, renamed.raw).toBe(200);
    const members = await api(owner.jar, 'GET', `/api/orgs/${owner.orgId}/members`);
    expect(members.body.members.find((m: { id: string }) => m.id === membershipId).team).toBe('Makers');

    const second = await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/teams`, {
      name: 'Reviewers', description: 'Review team', leadUserId: null,
    });
    expect(second.status, second.raw).toBe(201);
    const secondId = second.body.team.id as string;

    const blockedDelete = await api(owner.jar, 'DELETE', `/api/orgs/${owner.orgId}/teams/${firstId}`);
    expect(blockedDelete.status, blockedDelete.raw).toBe(400);
    expect(blockedDelete.body.error.code).toBe('TEAM_NOT_EMPTY');

    expect((await api(owner.jar, 'POST', `/api/orgs/${owner.orgId}/teams/${secondId}/members`, { membershipId })).status).toBe(200);

    const outsider = await createOwner('Team Outsider', '+14155559503');
    expect((await api(outsider.jar, 'GET', `/api/orgs/${owner.orgId}/teams`)).status).toBe(403);
    expect((await api(outsider.jar, 'PATCH', `/api/orgs/${owner.orgId}/teams/${firstId}`, { name: 'Stolen' })).status).toBe(403);

    const deleted = await api(owner.jar, 'DELETE', `/api/orgs/${owner.orgId}/teams/${firstId}`);
    expect(deleted.status, deleted.raw).toBe(200);
    expect((await api(owner.jar, 'GET', `/api/orgs/${owner.orgId}/teams`)).body.teams.map((t: { id: string }) => t.id)).toEqual([secondId]);
  });
});

describe('tenant isolation across stage 3 readers', () => {
  it('returns 403 for another organization’s id and never mixes the two tenants’ data', async () => {
    const a = await createOwner('Isolation Admin A', '+14155559201');
    const b = await createOwner('Isolation Admin B', '+14155559202');

    // Seed distinctive data owned by B through the real routers.
    const bChannel = await api(b.jar, 'POST', `/api/orgs/${b.orgId}/messaging/channels`, {
      name: 'B secret channel', scope: 'organization',
    });
    expect(bChannel.status, bChannel.raw).toBe(201);
    const bMessage = await api(b.jar, 'POST', `/api/orgs/${b.orgId}/messaging/channels/${bChannel.body.channel.id}/messages`, {
      body: 'B secret message body',
    });
    expect(bMessage.status, bMessage.raw).toBe(201);
    const bMeeting = await api(b.jar, 'POST', `/api/orgs/${b.orgId}/media/meetings`, {
      title: 'B secret meeting', workspaceId: b.workspaceId,
    });
    expect(bMeeting.status, bMeeting.raw).toBe(201);
    const bRecording = await api(b.jar, 'POST', `/api/orgs/${b.orgId}/recordings`, {
      meetingId: bMeeting.body.meeting.id,
    });
    expect(bRecording.status, bRecording.raw).toBe(201);
    const bInsight = await api(b.jar, 'POST', `/api/orgs/${b.orgId}/ai/summary`, {
      sourceText: 'This is a private summary for organization B that must never leak into organization A.',
    });
    expect(bInsight.status, bInsight.raw).toBe(201);
    const bSubscription = await api(b.jar, 'POST', `/api/orgs/${b.orgId}/billing/subscribe`, { planId: 'plan-pro' });
    expect(bSubscription.status, bSubscription.raw).toBe(200);
    await store.mutate((draft) => {
      draft.notifications.push({
        id: 'notif-b-org', organizationId: b.orgId, userId: null, type: 'test.notice',
        title: 'B org-wide secret', body: 'Only B members may read this', readAt: null,
        createdAt: new Date().toISOString(),
      });
    });

    const probes = [
      '/messaging/channels', '/notifications', '/ai/insights', '/billing/overview',
      '/analytics/meetings', '/recordings', '/media/meetings',
    ];
    for (const suffix of probes) {
      const cross = await api(a.jar, 'GET', `/api/orgs/${b.orgId}${suffix}`);
      expect(cross.status, `${suffix}: ${cross.raw}`).toBe(403);
      expect(cross.body.error?.code).toBe('FORBIDDEN');
      expect(cross.raw).not.toContain('B secret');
    }

    const ownChannels = await api(a.jar, 'GET', `/api/orgs/${a.orgId}/messaging/channels`);
    expect(ownChannels.body.channels).toEqual([]);
    const ownNotifications = await api(a.jar, 'GET', `/api/orgs/${a.orgId}/notifications`);
    expect(ownNotifications.body.notifications).toEqual([]);
    const ownInsights = await api(a.jar, 'GET', `/api/orgs/${a.orgId}/ai/insights`);
    expect(ownInsights.body.insights).toEqual([]);
    const ownBilling = await api(a.jar, 'GET', `/api/orgs/${a.orgId}/billing/overview`);
    expect(ownBilling.body.subscription).toBeNull();
    expect(ownBilling.body.entitlements.status).toBe('none');
    const ownAnalytics = await api(a.jar, 'GET', `/api/orgs/${a.orgId}/analytics/meetings`);
    expect(ownAnalytics.body.totals).toMatchObject({ meetings: 0, live: 0, ended: 0, minutes: 0 });
    const ownRecordings = await api(a.jar, 'GET', `/api/orgs/${a.orgId}/recordings`);
    expect(ownRecordings.body.recordings).toEqual([]);
    const ownMeetings = await api(a.jar, 'GET', `/api/orgs/${a.orgId}/media/meetings`);
    expect(ownMeetings.body.meetings).toEqual([]);

    const reverse = await api(b.jar, 'GET', `/api/orgs/${a.orgId}/messaging/channels`);
    expect(reverse.status, reverse.raw).toBe(403);
  });

  it('hides another tenant’s channel messages even when the channel id is known', async () => {
    const a = await createOwner('Channel Admin A', '+14155559301');
    const b = await createOwner('Channel Admin B', '+14155559302');
    const created = await api(a.jar, 'POST', `/api/orgs/${a.orgId}/messaging/channels`, {
      name: 'Private A channel', scope: 'organization',
    });
    expect(created.status, created.raw).toBe(201);
    const channelId = created.body.channel.id as string;
    const posted = await api(a.jar, 'POST', `/api/orgs/${a.orgId}/messaging/channels/${channelId}/messages`, {
      body: 'tenant-private-message',
    });
    expect(posted.status, posted.raw).toBe(201);

    const crossPath = await api(b.jar, 'GET', `/api/orgs/${a.orgId}/messaging/channels/${channelId}/messages`);
    expect(crossPath.status, crossPath.raw).toBe(403);
    const crossId = await api(b.jar, 'GET', `/api/orgs/${b.orgId}/messaging/channels/${channelId}/messages`);
    expect(crossId.status, crossId.raw).toBe(404);
    expect(crossId.body.error.code).toBe('NOT_FOUND');
    expect(crossId.raw).not.toContain('tenant-private-message');

    const own = await api(a.jar, 'GET', `/api/orgs/${a.orgId}/messaging/channels/${channelId}/messages`);
    expect(own.body.messages.map((m: { body: string }) => m.body)).toEqual(['tenant-private-message']);
  });

  it('shows org-wide notifications to every member but direct notifications only to the target', async () => {
    const admin = await createOwner('Notification Admin', '+14155559401');
    const added = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/members`, {
      phone: '+14155559402', name: 'Notify Student', role: 'student', team: 'Learners',
    });
    expect(added.status, added.raw).toBe(201);
    const student = await login('+14155559402', added.body.temporaryPassword);
    const outsider = await createOwner('Notification Outsider', '+14155559403');

    await store.mutate((draft) => {
      const now = new Date().toISOString();
      draft.notifications.push(
        { id: 'org-wide', organizationId: admin.orgId, userId: null, type: 'test.notice',
          title: 'Org wide notice', body: 'Visible to all', readAt: null, createdAt: now },
        { id: 'direct-admin', organizationId: admin.orgId, userId: admin.userId, type: 'test.notice',
          title: 'Direct to admin', body: 'Admin only', readAt: null, createdAt: now },
        { id: 'direct-student', organizationId: admin.orgId, userId: student.userId, type: 'test.notice',
          title: 'Direct to student', body: 'Student only', readAt: null, createdAt: now },
        { id: 'other-org', organizationId: outsider.orgId, userId: null, type: 'test.notice',
          title: 'Other org notice', body: 'Hidden', readAt: null, createdAt: now },
      );
    });

    const adminNotifications = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/notifications`);
    expect(adminNotifications.body.notifications.map((n: { id: string }) => n.id).sort()).toEqual(
      ['direct-admin', 'org-wide']);
    const studentNotifications = await api(student.jar, 'GET', `/api/orgs/${admin.orgId}/notifications`);
    expect(studentNotifications.body.notifications.map((n: { id: string }) => n.id).sort()).toEqual(
      ['direct-student', 'org-wide']);
    expect(studentNotifications.raw).not.toContain('Direct to admin');
    expect(studentNotifications.raw).not.toContain('Other org notice');

    const directRead = await api(student.jar, 'POST', `/api/orgs/${admin.orgId}/notifications/direct-admin/read`, {});
    expect(directRead.status, directRead.raw).toBe(404);
    expect(directRead.body.error.code).toBe('NOT_FOUND');

    const adminUnread = await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/notifications/unread-count`);
    expect(adminUnread.body.count).toBe(2);
    const studentUnread = await api(student.jar, 'GET', `/api/orgs/${admin.orgId}/notifications/unread-count`);
    expect(studentUnread.body.count).toBe(2);

    const readAll = await api(admin.jar, 'POST', `/api/orgs/${admin.orgId}/notifications/read-all`, {});
    expect(readAll.status, readAll.raw).toBe(200);
    expect(readAll.body.updated).toBe(2);
    expect((await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/notifications/unread-count`)).body.count).toBe(0);
    // Read receipts are per recipient: the admin's read-all must not clear the
    // shared org-wide notice for the student or their own direct notification.
    expect((await api(student.jar, 'GET', `/api/orgs/${admin.orgId}/notifications/unread-count`)).body.count).toBe(2);
    const studentRead = await api(student.jar, 'POST', `/api/orgs/${admin.orgId}/notifications/org-wide/read`, {});
    expect(studentRead.status, studentRead.raw).toBe(200);
    expect((await api(student.jar, 'GET', `/api/orgs/${admin.orgId}/notifications/unread-count`)).body.count).toBe(1);
    expect((await api(admin.jar, 'GET', `/api/orgs/${admin.orgId}/notifications/unread-count`)).body.count).toBe(0);
  });
});
