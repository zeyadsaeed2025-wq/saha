import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { store, findInOrg } from '../../common/store.js';
import {
  normalizePhone, randomToken, revokeWorldCredentials, sha256,
} from '../../common/security.js';
import {
  asyncRoute, getAuth, logAudit, requireAuth, requireOrg, requirePermission,
} from '../../common/middleware.js';
import { badRequest, conflict } from '../../common/errors.js';
import { issueSession } from '../auth/routes.js';

export const invitationsRouter = Router();
export const accessLinksRouter = Router({ mergeParams: true });
export const redeemRouter = Router();

/**
 * Links do not carry a DB column for issued sessions (the domain type is owned
 * by another worker), so this single-instance index lets revocation close guest
 * sessions that were created from a link.
 */
const guestSessionsByLink = new Map<string, Set<string>>();

const appUrl = () => (process.env.APP_URL ?? 'http://localhost:5173').replace(/\/$/, '');

invitationsRouter.post('/:orgId/invitations', requireAuth, requireOrg, requirePermission('invitation:manage'),
  asyncRoute(async (req, res) => {
    const parsed = z.object({
      phone: z.string().min(8).optional(),
      email: z.string().email().optional(),
      role: z.enum(['org_admin', 'mentor', 'student']).default('student'),
      team: z.string().min(1).max(60).default('General'),
      expiresInHours: z.number().int().min(1).max(720).default(168),
      maxUses: z.number().int().min(1).max(50).default(1),
    }).safeParse(req.body);
    if (!parsed.success) throw badRequest('Invalid invitation details');
    const token = randomToken();
    const auth = getAuth(req)!;
    const invitation = await store.mutate((draft) => {
      const created = {
        id: randomUUID(), organizationId: req.params.orgId!,
        phone: parsed.data.phone ? normalizePhone(parsed.data.phone) : null,
        email: parsed.data.email ?? null, role: parsed.data.role, team: parsed.data.team,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + parsed.data.expiresInHours * 3_600_000).toISOString(),
        maxUses: parsed.data.maxUses, uses: 0, revokedAt: null,
        createdBy: auth.user.id, createdAt: new Date().toISOString(),
      };
      draft.invitations.push(created);
      logAudit(draft, auth, 'invitation.created', created.id, { role: created.role, team: created.team });
      return created;
    });
    res.status(201).json({ invitation, url: `${appUrl()}/invite/${token}`, token,
      notice: 'The raw token is shown once. It is stored only as a hash.' });
  }));

invitationsRouter.get('/:orgId/invitations', requireAuth, requireOrg, requirePermission('invitation:manage'), (req, res) => {
  const items = store.read((state) => state.invitations
    .filter((i) => i.organizationId === req.params.orgId)
    .map(({ tokenHash: _hash, ...safe }) => ({ ...safe,
      active: !safe.revokedAt && safe.uses < safe.maxUses && new Date(safe.expiresAt) > new Date() })));
  res.json({ invitations: items });
});

invitationsRouter.get('/token/:token', (req, res) => {
  const info = store.read((state) => {
    const invitation = state.invitations.find((i) => i.tokenHash === sha256(req.params.token));
    if (!invitation) return null;
    const org = state.organizations.find((o) => o.id === invitation.organizationId);
    return {
      organizationName: org?.name ?? '', role: invitation.role, team: invitation.team,
      expiresAt: invitation.expiresAt, active: !invitation.revokedAt && invitation.uses < invitation.maxUses
        && new Date(invitation.expiresAt) > new Date(),
      phoneHint: invitation.phone ? `${invitation.phone.slice(0, 4)}•••${invitation.phone.slice(-2)}` : null,
    };
  });
  if (!info) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Invitation not found' } });
  res.json(info);
});

invitationsRouter.post('/token/:token/accept', requireAuth, asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const result = await store.mutate((draft) => {
    const invitation = draft.invitations.find((i) => i.tokenHash === sha256(req.params.token));
    if (!invitation || invitation.revokedAt || new Date(invitation.expiresAt) <= new Date()
      || invitation.uses >= invitation.maxUses) throw badRequest('Invitation is invalid or expired', 'INVALID_INVITATION');
    if (invitation.phone && invitation.phone !== auth.user.phone) {
      throw badRequest('This invitation was issued for a different phone number', 'PHONE_MISMATCH');
    }
    const existing = draft.memberships.find((m) => m.organizationId === invitation.organizationId
      && m.userId === auth.user.id);
    if (!existing) {
      draft.memberships.push({
        id: randomUUID(), organizationId: invitation.organizationId, userId: auth.user.id,
        role: invitation.role, team: invitation.team, status: 'active', joinedAt: new Date().toISOString(),
      });
    }
    invitation.uses += 1;
    const session = draft.authSessions.find((s) => s.id === auth.session.id);
    if (session) session.activeOrgId = invitation.organizationId;
    logAudit(draft, auth, 'invitation.accepted', invitation.id, {});
    return { organizationId: invitation.organizationId, role: invitation.role };
  });
  res.json(result);
}));

invitationsRouter.post('/:orgId/invitations/:id/revoke', requireAuth, requireOrg, requirePermission('invitation:manage'),
  asyncRoute(async (req, res) => {
    const auth = getAuth(req)!;
    await store.mutate((draft) => {
      const invitation = findInOrg(draft.invitations, req.params.orgId, req.params.id);
      if (!invitation) throw badRequest('Invitation not found', 'NOT_FOUND');
      invitation.revokedAt = new Date().toISOString();
      logAudit(draft, auth, 'invitation.revoked', invitation.id, {});
    });
    res.json({ ok: true });
  }));

// ---- Scoped access links ----

accessLinksRouter.use(requireOrg);

accessLinksRouter.get('/', requirePermission('link:manage'), (req, res) => {
  const links = store.read((state) => state.accessLinks
    .filter((l) => l.organizationId === req.params.orgId)
    .map(({ tokenHash: _hash, ...safe }) => ({ ...safe,
      active: !safe.revokedAt && safe.uses < safe.maxUses && new Date(safe.expiresAt) > new Date() })));
  res.json({ links });
});

accessLinksRouter.post('/', requirePermission('link:manage'), asyncRoute(async (req, res) => {
  const parsed = z.object({
    kind: z.enum([
      'private_workspace', 'public_guest', 'member_invitation',
      'passwordless_access', 'passwordless_member',
    ]),
    workspaceId: z.string().uuid(),
    roomId: z.string().uuid().nullable().optional(),
    subjectUserId: z.string().uuid().nullable().optional(),
    requiresApproval: z.boolean().optional(),
    expiresInHours: z.number().int().min(1).max(168).optional(),
    maxUses: z.number().int().min(1).max(100).optional(),
  }).safeParse(req.body);
  if (!parsed.success) throw badRequest('Invalid access link details');
  const isMemberLink = parsed.data.kind !== 'public_guest';
  if (isMemberLink && !parsed.data.subjectUserId) {
    throw badRequest('Member links must be bound to an active organization member');
  }
  // Member links can impersonate a member: default to the narrowest possible
  // lifetime and a single use. Public guest links keep the existing defaults.
  const expiresInHours = parsed.data.expiresInHours ?? (isMemberLink ? 4 : 24);
  const maxUses = parsed.data.maxUses ?? (isMemberLink ? 1 : 10);
  const orgId = req.params.orgId!;
  const valid = store.read((state) => {
    const workspace = findInOrg(state.workspaces, orgId, parsed.data.workspaceId);
    if (!workspace) return { ok: false as const, reason: 'Workspace not found' };
    if (parsed.data.roomId) {
      const room = findInOrg(state.rooms, orgId, parsed.data.roomId);
      if (!room || room.workspaceId !== workspace.id) return { ok: false as const, reason: 'Room not found in this workspace' };
    }
    if (isMemberLink) {
      const member = state.memberships.find(
        (m) => m.userId === parsed.data.subjectUserId && m.organizationId === orgId && m.status === 'active');
      if (!member) return { ok: false as const, reason: 'Subject is not an active member of this organization' };
      const room = parsed.data.roomId ? findInOrg(state.rooms, orgId, parsed.data.roomId) : null;
      if (room && !room.allowedRoles.includes(member.role) && member.role !== 'super_admin') {
        return { ok: false as const, reason: 'The subject does not have permission for the selected room' };
      }
    }
    return { ok: true as const, reason: '' };
  });
  if (!valid.ok) throw badRequest(valid.reason, 'NOT_FOUND');
  const token = randomToken();
  const auth = getAuth(req)!;
  const link = await store.mutate((draft) => {
    const created = {
      id: randomUUID(), organizationId: orgId, workspaceId: parsed.data.workspaceId,
      roomId: parsed.data.roomId ?? null, kind: parsed.data.kind,
      subjectUserId: parsed.data.subjectUserId ?? null,
      requiresApproval: parsed.data.requiresApproval ?? false,
      tokenHash: sha256(token),
      expiresAt: new Date(Date.now() + expiresInHours * 3_600_000).toISOString(),
      maxUses, uses: 0, revokedAt: null,
      createdBy: auth.user.id, createdAt: new Date().toISOString(),
    };
    draft.accessLinks.push(created);
    logAudit(draft, auth, 'access_link.created', created.id, { kind: created.kind });
    return created;
  });
  const path = link.kind === 'public_guest' ? 'guest' : 'access';
  res.status(201).json({ link, url: `${appUrl()}/${path}/${token}`, token });
}));

accessLinksRouter.post('/:id/revoke', requirePermission('link:manage'), asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  await store.mutate((draft) => {
    const link = findInOrg(draft.accessLinks, req.params.orgId, req.params.id);
    if (!link) throw badRequest('Link not found', 'NOT_FOUND');
    const revokedAt = new Date().toISOString();
    link.revokedAt = revokedAt;
    let sessionsRevoked = 0;
    const linkedSessions = new Set<string>(guestSessionsByLink.get(link.id) ?? []);
    for (const session of draft.authSessions) {
      if ((session as typeof session & { guestLinkId?: string }).guestLinkId === link.id) {
        linkedSessions.add(session.id);
      }
    }
    for (const sessionId of linkedSessions) {
      const session = draft.authSessions.find((s) => s.id === sessionId);
      if (session && !session.revokedAt) {
        session.revokedAt = revokedAt;
        sessionsRevoked += 1;
      }
      revokeWorldCredentials(draft, sessionId, revokedAt);
    }
    for (const request of draft.guestRequests) {
      if (request.linkId === link.id && request.status === 'pending') {
        request.status = 'rejected';
        request.reviewedBy = auth.user.id;
        request.reviewedAt = revokedAt;
      }
    }
    guestSessionsByLink.delete(link.id);
    logAudit(draft, auth, 'access_link.revoked', link.id, { sessionsRevoked });
  });
  res.json({ ok: true });
}));

// ---- Guest waiting room ----

accessLinksRouter.get('/guest-requests', requirePermission('guest:manage'), (req, res) => {
  const requests = store.read((state) => state.guestRequests
    .filter((r) => r.organizationId === req.params.orgId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  res.json({ requests });
});

const reviewRequest = async (req: Request, res: Response, status: 'approved' | 'rejected') => {
  const auth = getAuth(req)!;
  const updated = await store.mutate((draft) => {
    const request = draft.guestRequests.find((r) => r.id === req.params.id && r.organizationId === req.params.orgId);
    if (!request) throw badRequest('Guest request not found', 'NOT_FOUND');
    if (request.status !== 'pending') throw badRequest('This guest request has already been reviewed', 'ALREADY_REVIEWED');
    request.status = status;
    request.reviewedBy = auth.user.id;
    request.reviewedAt = new Date().toISOString();
    draft.notifications.push({
      id: randomUUID(), organizationId: request.organizationId, userId: auth.user.id,
      type: status === 'approved' ? 'guest.approved' : 'guest.rejected',
      title: status === 'approved' ? 'Guest approved' : 'Guest rejected',
      body: `${request.name} was ${status} for the guest waiting room.`,
      readAt: null, createdAt: new Date().toISOString(),
    });
    logAudit(draft, auth, `guest_request.${status}`, request.id, { linkId: request.linkId });
    return request;
  });
  res.json({ request: updated });
};

accessLinksRouter.post('/guest-requests/:id/approve', requirePermission('guest:manage'), asyncRoute((req, res) =>
  reviewRequest(req, res, 'approved')));
accessLinksRouter.post('/guest-requests/:id/reject', requirePermission('guest:manage'), asyncRoute((req, res) =>
  reviewRequest(req, res, 'rejected')));

redeemRouter.get('/:token/status', (req, res) => {
  const requestId = typeof req.query.requestId === 'string' ? req.query.requestId : '';
  const status = store.read((state) => {
    const link = state.accessLinks.find((l) => l.tokenHash === sha256(req.params.token));
    if (!link) return null;
    const request = requestId
      ? state.guestRequests.find((r) => r.id === requestId && r.linkId === link.id)
      : null;
    return {
      linkActive: !link.revokedAt && link.uses < link.maxUses && new Date(link.expiresAt) > new Date(),
      requestId: request?.id ?? null,
      status: request?.status ?? 'pending',
    };
  });
  if (!status) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Access link not found' } });
  res.json(status);
});

redeemRouter.get('/:token/info', (req, res) => {
  const info = store.read((state) => {
    const link = state.accessLinks.find((l) => l.tokenHash === sha256(req.params.token));
    if (!link) return null;
    const organization = state.organizations.find((o) => o.id === link.organizationId);
    const workspace = state.workspaces.find((w) => w.id === link.workspaceId);
    const room = link.roomId ? state.rooms.find((r) => r.id === link.roomId) : null;
    // Public link info must not disclose the identity of a passwordless subject.
    return {
      kind: link.kind,
      requiresApproval: Boolean(link.requiresApproval),
      organizationName: organization?.name ?? '',
      workspaceName: workspace?.name ?? '',
      roomName: room?.name ?? null,
      expiresAt: link.expiresAt,
      uses: link.uses,
      maxUses: link.maxUses,
      active: !link.revokedAt && link.uses < link.maxUses && new Date(link.expiresAt) > new Date(),
    };
  });
  if (!info) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Access link not found' } });
  res.json(info);
});

redeemRouter.post('/:token/redeem', asyncRoute(async (req, res) => {
  const tokenHash = sha256(req.params.token);
  const payload = z.object({
    name: z.string().min(2).max(80).optional(),
    requestId: z.string().uuid().optional(),
  }).safeParse(req.body ?? {});
  if (!payload.success) throw badRequest('Invalid redemption payload');
  // All validity checks and the use increment happen in one serialized mutation,
  // so concurrent redemptions cannot exceed maxUses.
  const consumed = await store.mutate((draft) => {
    const target = draft.accessLinks.find((l) => l.tokenHash === tokenHash);
    if (!target || target.revokedAt || target.uses >= target.maxUses || new Date(target.expiresAt) <= new Date()) {
      throw badRequest('This access link is invalid, expired or has reached its usage limit', 'INVALID_LINK');
    }
    if (target.kind === 'public_guest') {
      if (target.requiresApproval) {
        const request = payload.data.requestId
          ? draft.guestRequests.find((r) => r.id === payload.data.requestId && r.linkId === target.id)
          : undefined;
        if (!request) {
          const created = {
            id: randomUUID(), organizationId: target.organizationId, linkId: target.id,
            name: payload.data.name ?? 'Guest visitor', phone: null, status: 'pending' as const,
            reviewedBy: null, reviewedAt: null, createdAt: new Date().toISOString(),
          };
          draft.guestRequests.push(created);
          draft.notifications.push({
            id: randomUUID(), organizationId: target.organizationId, userId: null,
            type: 'guest.pending', title: 'Guest waiting for approval',
            body: `${created.name} is waiting at the guest entrance.`, readAt: null, createdAt: created.createdAt,
          });
          return {
            kind: 'waiting' as const, id: target.id, requestId: created.id,
            organizationId: target.organizationId,
          };
        }
        if (request.status !== 'approved') {
          throw badRequest(request.status === 'rejected'
            ? 'The guest request was rejected' : 'The guest request is still waiting for approval',
          request.status === 'rejected' ? 'GUEST_REJECTED' : 'GUEST_PENDING');
        }
      }
      const guestId = `guest-${target.id.slice(0, 8)}`;
      if (!draft.users.some((u) => u.id === guestId)) {
        draft.users.push({
          id: guestId, phone: `+guest${target.id.slice(0, 8)}`, name: payload.data.name ?? 'Guest visitor',
          passwordHash: 'disabled', status: 'active', verifiedAt: null, createdAt: new Date().toISOString(),
        });
      }
      target.uses += 1;
      return {
        kind: 'guest' as const, id: target.id, organizationId: target.organizationId,
        workspaceId: target.workspaceId, roomId: target.roomId, guestId,
      };
    }
    const activeMember = draft.memberships.some(
      (m) => m.userId === target.subjectUserId && m.organizationId === target.organizationId && m.status === 'active');
    if (!activeMember) throw badRequest('The link’s subject is no longer an active member', 'INVALID_LINK');
    target.uses += 1;
    return {
      kind: 'member' as const, id: target.id, organizationId: target.organizationId,
      subjectUserId: target.subjectUserId!,
    };
  });

  if (consumed.kind === 'waiting') {
    return res.status(202).json({ kind: 'waiting', requestId: consumed.requestId,
      message: 'Your request is waiting for an organization administrator to approve it.' });
  }

  if (consumed.kind === 'guest') {
    // The link id is persisted on the session and its world alias so revocation
    // also works after a restart, when the in-memory index is empty.
    const issued = await issueSession(res, consumed.guestId, null, 'guest', {
      orgId: consumed.organizationId, workspaceId: consumed.workspaceId, roomId: consumed.roomId ?? undefined,
    }, consumed.id);
    const sessions = guestSessionsByLink.get(consumed.id) ?? new Set<string>();
    sessions.add(issued.sessionId);
    guestSessionsByLink.set(consumed.id, sessions);
    return res.json({ kind: 'guest', organizationId: consumed.organizationId,
      workspaceId: consumed.workspaceId, roomId: consumed.roomId });
  }

  await issueSession(res, consumed.subjectUserId, consumed.organizationId);
  res.json({ kind: 'member', organizationId: consumed.organizationId, userId: consumed.subjectUserId });
}));
