import { randomUUID } from 'node:crypto';
import { Router } from 'express';
import {
  asyncRoute, getAuth, requireOrg, requirePermission,
} from '../../common/middleware.js';
import { findInOrg, inOrg, store } from '../../common/store.js';
import { notFound } from '../../common/errors.js';
import type { DbState, Notification, NotificationLog } from '../../domain/types.js';

export const notificationsRouter = Router({ mergeParams: true });

notificationsRouter.use(requireOrg);
notificationsRouter.use(requirePermission('notification:read'));

/**
 * Appends a delivery log entry. Email/SMS without a configured provider is
 * recorded as skipped — never as a successful send.
 */
export function recordNotificationLog(
  draft: DbState,
  orgId: string,
  userId: string | null,
  channel: NotificationLog['channel'],
  type: string,
  status: NotificationLog['status'],
  provider?: string | null,
  error?: string | null,
): NotificationLog {
  const hasProvider = typeof provider === 'string' && provider.trim().length > 0;
  const providerMissing = channel !== 'in_app' && !hasProvider && status === 'sent';
  const log: NotificationLog = {
    id: randomUUID(),
    organizationId: orgId,
    userId,
    channel,
    type,
    status: providerMissing ? 'skipped' : status,
    provider: hasProvider ? provider! : null,
    error: providerMissing ? 'No email/SMS provider configured' : error ?? null,
    createdAt: new Date().toISOString(),
  };
  draft.notificationLogs.push(log);
  return log;
}

const visibleTo = (notification: Notification, userId: string): boolean =>
  notification.userId === null || notification.userId === userId;

/**
 * Read state is per recipient. Older direct rows without `readBy` fall back to
 * their legacy `readAt` value; org-wide rows never use that shared timestamp as
 * a per-user read flag.
 */
const isReadBy = (notification: Notification, userId: string): boolean => {
  if (Array.isArray(notification.readBy)) return notification.readBy.includes(userId);
  return notification.userId !== null && notification.userId === userId && Boolean(notification.readAt);
};

function markRead(notification: Notification, userId: string): void {
  if (!Array.isArray(notification.readBy)) {
    notification.readBy = notification.readAt && notification.userId ? [notification.userId] : [];
  }
  if (!notification.readBy.includes(userId)) notification.readBy.push(userId);
  notification.readAt = new Date().toISOString();
}

const newestFirst = (a: { createdAt: string; id: string }, b: { createdAt: string; id: string }): number =>
  b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

const unreadFirst = (a: Notification, b: Notification, userId: string): number =>
  Number(isReadBy(a, userId)) - Number(isReadBy(b, userId)) || newestFirst(a, b);

notificationsRouter.get('/', (req, res) => {
  const auth = getAuth(req)!;
  const notifications = store.read((state) => inOrg(state.notifications, auth.orgId)
    .filter((notification) => visibleTo(notification, auth.user.id))
    .sort((a, b) => unreadFirst(a, b, auth.user.id))
    .slice(0, 100));
  res.json({ notifications });
});

notificationsRouter.get('/unread-count', (req, res) => {
  const auth = getAuth(req)!;
  const count = store.read((state) => inOrg(state.notifications, auth.orgId)
    .filter((notification) => visibleTo(notification, auth.user.id) && !isReadBy(notification, auth.user.id)).length);
  res.json({ count });
});

notificationsRouter.post('/read-all', asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const updated = await store.mutate((draft) => {
    let count = 0;
    for (const notification of draft.notifications) {
      if (notification.organizationId === auth.orgId
        && visibleTo(notification, auth.user.id)
        && !isReadBy(notification, auth.user.id)) {
        markRead(notification, auth.user.id);
        count += 1;
      }
    }
    return count;
  });
  res.json({ updated });
}));

notificationsRouter.get('/logs', requirePermission('audit:read'), (req, res) => {
  const auth = getAuth(req)!;
  const logs = store.read((state) => inOrg(state.notificationLogs, auth.orgId)
    .sort(newestFirst)
    .slice(0, 100));
  res.json({ logs });
});

notificationsRouter.post('/:id/read', asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const updated = await store.mutate((draft) => {
    const notification = findInOrg(draft.notifications, auth.orgId, req.params.id);
    if (!notification || !visibleTo(notification, auth.user.id)) throw notFound('Notification not found');
    if (!isReadBy(notification, auth.user.id)) markRead(notification, auth.user.id);
    return notification;
  });
  res.json({ notification: updated });
}));
