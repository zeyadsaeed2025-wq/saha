import { createHmac, randomUUID } from 'node:crypto';
import { Router } from 'express';
import { AppError, badRequest } from '../../common/errors.js';
import { inOrg, store } from '../../common/store.js';
import { asyncRoute } from '../../common/middleware.js';
import { safeEqualHex, sha256 } from '../../common/security.js';
import type { DbState, Subscription } from '../../domain/types.js';
import { ensurePlans } from './plans.js';

export const billingWebhooksRouter = Router();

const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};

const asString = (value: unknown): string => typeof value === 'string' ? value : '';

const STATUS_MAP: Record<string, Subscription['status']> = {
  trialing: 'trialing',
  active: 'active',
  past_due: 'past_due',
  grace: 'grace',
  cancelled: 'cancelled',
  canceled: 'cancelled',
  unpaid: 'past_due',
  incomplete: 'past_due',
  incomplete_expired: 'past_due',
};

const mappedStatus = (value: string): Subscription['status'] | null => STATUS_MAP[value] ?? null;

function appendAudit(
  draft: DbState,
  organizationId: string,
  action: string,
  target: string,
  metadata: Record<string, unknown>,
): void {
  draft.auditLogs.push({
    id: randomUUID(),
    organizationId: organizationId || null,
    actorId: null,
    action,
    target,
    metadata,
    at: new Date().toISOString(),
  });
}

billingWebhooksRouter.post('/', asyncRoute(async (req, res) => {
  const secret = process.env.BILLING_WEBHOOK_SECRET;
  if (!secret) {
    throw new AppError(503, 'PROVIDER_NOT_CONFIGURED', 'Billing webhooks are not configured');
  }

  const expected = createHmac('sha256', secret).update(JSON.stringify(req.body ?? {})).digest('hex');
  const presented = (req.header('x-webhook-signature') ?? '').replace(/^sha256=/i, '').trim();
  // Normalize both values to fixed-length hashes before the constant-time compare.
  if (!safeEqualHex(sha256(expected), sha256(presented))) {
    throw new AppError(400, 'INVALID_SIGNATURE', 'Webhook signature verification failed');
  }

  const body = asRecord(req.body);
  const eventId = asString(body.id);
  if (!eventId) throw badRequest('Webhook event id is required');

  const type = asString(body.type);
  const data = asRecord(body.data);
  const object = asRecord(data.object);
  const objectMetadata = asRecord(object.metadata);
  const topMetadata = asRecord(body.metadata);
  const organizationId = asString(topMetadata.organizationId) || asString(objectMetadata.organizationId);
  const objectId = asString(object.id);
  const rawAmount = Number(object.amount ?? 0);
  const amountCents = Number.isFinite(rawAmount) ? rawAmount : 0;
  const rawStatus = asString(object.status) || 'unknown';

  const items = asRecord(object.items);
  const firstItem = Array.isArray(items.data) ? asRecord(items.data[0]) : {};
  const planId = asString(objectMetadata.planId)
    || asString(asRecord(object.plan).id)
    || asString(asRecord(firstItem.plan).id);

  const result = await store.mutate((draft) => {
    if (draft.paymentEvents.some((event) => event.eventId === eventId && event.provider === 'sandbox')) {
      return { received: true, duplicate: true };
    }
    ensurePlans(draft);

    const at = new Date().toISOString();
    // Without a resolved organization the event is informational only: never
    // touch another tenant's invoice or subscription.
    const invoice = organizationId
      ? draft.invoices.find((item) => item.organizationId === organizationId
        && (item.providerEventId === eventId || (objectId !== '' && item.id === objectId))) ?? null
      : null;

    draft.paymentEvents.push({
      id: randomUUID(),
      organizationId,
      invoiceId: invoice?.id ?? null,
      provider: 'sandbox',
      eventId,
      type,
      amountCents,
      status: organizationId ? rawStatus : 'ignored',
      createdAt: at,
    });

    const subscription = organizationId ? inOrg(draft.subscriptions, organizationId)[0] ?? null : null;

    if (type === 'invoice.paid' && invoice) {
      invoice.status = 'paid';
      invoice.providerEventId = eventId;
    } else if (type === 'invoice.payment_failed') {
      if (invoice) {
        invoice.status = 'failed';
        invoice.providerEventId = eventId;
      }
      const subscriptionId = invoice?.subscriptionId || asString(object.subscription);
      const target = organizationId && subscriptionId
        ? inOrg(draft.subscriptions, organizationId).find((item) => item.id === subscriptionId) ?? subscription
        : subscription;
      if (target) {
        target.status = 'past_due';
        target.updatedAt = at;
      }
    } else if (type === 'customer.subscription.updated') {
      if (subscription) {
        const knownPlan = planId !== '' && draft.plans.some((item) => item.id === planId && item.status === 'active');
        if (organizationId && knownPlan) subscription.planId = planId;
        const nextStatus = mappedStatus(asString(object.status).toLowerCase());
        if (nextStatus) {
          subscription.status = nextStatus;
          subscription.updatedAt = at;
        }
      }
    } else if (type === 'customer.subscription.deleted' && subscription) {
      subscription.status = 'cancelled';
      subscription.cancelAtPeriodEnd = true;
      subscription.graceUntil = new Date(Date.now() + 7 * 86_400_000).toISOString();
      subscription.updatedAt = at;
      appendAudit(draft, organizationId, 'billing.webhook_grace', subscription.id, {
        eventId,
        graceUntil: subscription.graceUntil,
      });
    }

    appendAudit(draft, organizationId, 'billing.webhook', eventId, {
      eventId,
      type,
      status: organizationId ? rawStatus : 'ignored',
      organizationResolved: Boolean(organizationId),
    });
    return { received: true, duplicate: false };
  });

  res.json(result);
}));
