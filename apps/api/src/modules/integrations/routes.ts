import { createHmac, randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { store } from '../../common/store.js';
import { asyncRoute, getAuth, logAudit, requireFeature, requireOrg, requirePermission } from '../../common/middleware.js';
import { AppError, badRequest } from '../../common/errors.js';
import { randomToken, safeEqualHex, sha256 } from '../../common/security.js';
import type { DbState, IntegrationConnection } from '../../domain/types.js';

export const integrationsRouter = Router({ mergeParams: true });
export const webhooksRouter = Router({ mergeParams: true });

export const KNOWN_PROVIDERS = [
  'google_drive', 'google_calendar', 'outlook', 'slack', 'teams', 'webhook', 'public_api',
] as const;

type KnownProvider = typeof KNOWN_PROVIDERS[number];

const OAUTH_PROVIDERS: KnownProvider[] = ['google_drive', 'google_calendar', 'outlook', 'slack', 'teams'];

const ENV_BY_PROVIDER: Record<KnownProvider, string> = {
  google_drive: 'GOOGLE_CLIENT_ID',
  google_calendar: 'GOOGLE_CLIENT_ID',
  outlook: 'OUTLOOK_CLIENT_ID',
  slack: 'SLACK_CLIENT_ID',
  teams: 'TEAMS_CLIENT_ID',
  webhook: 'INTEGRATION_WEBHOOK_SECRET',
  public_api: 'PUBLIC_API_SECRET',
};

const SCOPES_BY_PROVIDER: Record<KnownProvider, string> = {
  google_drive: 'https://www.googleapis.com/auth/drive.file',
  google_calendar: 'https://www.googleapis.com/auth/calendar.events',
  outlook: 'https://graph.microsoft.com/.default',
  slack: 'channels:read,chat:write',
  teams: 'https://graph.microsoft.com/.default',
  webhook: '',
  public_api: '',
};

const SENSITIVE_METADATA_KEYS = new Set([
  'access_token', 'refresh_token', 'token', 'secret', 'client_secret',
  'api_key', 'webhook_secret', 'state', 'authorization_code', 'code',
]);

const isKnownProvider = (value: string): value is KnownProvider =>
  (KNOWN_PROVIDERS as readonly string[]).includes(value);

/** Never return stored credentials through the integrations listing. */
function publicIntegration(integration: IntegrationConnection): IntegrationConnection {
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(integration.metadata ?? {})) {
    if (SENSITIVE_METADATA_KEYS.has(key.toLowerCase())) continue;
    if (value === null || ['string', 'number', 'boolean'].includes(typeof value)) metadata[key] = value;
  }
  return { ...integration, metadata };
}

function upsertIntegration(
  draft: DbState,
  orgId: string,
  provider: KnownProvider,
  metadata: Record<string, unknown>,
): IntegrationConnection {
  const now = new Date().toISOString();
  let integration = draft.integrations.find((item) =>
    item.organizationId === orgId && item.provider === provider);
  if (!integration) {
    integration = {
      id: randomUUID(),
      organizationId: orgId,
      provider,
      status: 'not_connected',
      scopes: [],
      connectedBy: null,
      connectedAt: null,
      lastError: null,
      metadata: {},
      updatedAt: now,
    };
    draft.integrations.push(integration);
  }
  integration.metadata = { ...integration.metadata, ...metadata };
  integration.updatedAt = now;
  return integration;
}

integrationsRouter.use(requireOrg);
integrationsRouter.use(requireFeature('integrations'));
integrationsRouter.use(requirePermission('integration:manage'));

integrationsRouter.get('/', (req: Request, res) => {
  const orgId = req.params.orgId as string;
  const integrations = store.read((state) => KNOWN_PROVIDERS.map((provider) => {
    const stored = state.integrations.find((item) =>
      item.organizationId === orgId && item.provider === provider);
    return stored ? publicIntegration(stored) : {
      id: '',
      organizationId: orgId,
      provider,
      status: 'not_connected' as const,
      scopes: [],
      connectedBy: null,
      connectedAt: null,
      lastError: null,
      metadata: {},
      updatedAt: new Date().toISOString(),
    };
  }));
  res.json({ integrations });
});

integrationsRouter.get('/public-api/status', (_req, res) => {
  const configured = Boolean(process.env.PUBLIC_API_SECRET?.trim());
  res.json({
    configured,
    message: configured
      ? 'PUBLIC_API_SECRET is configured; the secret value is never exposed.'
      : 'PUBLIC_API_SECRET is not configured; public API access is unavailable locally.',
  });
});

integrationsRouter.post('/:provider/prepare', asyncRoute(async (req, res) => {
  const provider = req.params.provider as string;
  if (!isKnownProvider(provider)) throw badRequest('Unknown integration provider', 'UNKNOWN_PROVIDER');
  const orgId = req.params.orgId as string;
  const envVar = ENV_BY_PROVIDER[provider];
  if (!process.env[envVar]?.trim()) {
    throw new AppError(503, 'PROVIDER_NOT_CONFIGURED',
      `${provider} credentials are not configured; this adapter cannot prepare a connection.`);
  }
  const auth = getAuth(req)!;

  if (!OAUTH_PROVIDERS.includes(provider)) {
    await store.mutate((draft) => {
      logAudit(draft, auth, 'integration.prepare', orgId, { provider });
    });
    res.json({
      provider,
      ready: true,
      message: 'Credentials configured; complete the provider handshake outside this local adapter.',
    });
    return;
  }

  const state = randomToken(16);
  const clientId = process.env[envVar] as string;
  const redirectUri = `${process.env.APP_URL ?? 'http://localhost:5173'}/api/orgs/${orgId}/integrations/${provider}/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: SCOPES_BY_PROVIDER[provider],
    state,
  });
  // Reserved .invalid host: this local adapter does not impersonate a real
  // provider's consent screen. Configure a real OAuth client to go live.
  const authorizationUrl = `https://auth.example.invalid/oauth2/authorize?${params.toString()}`;
  await store.mutate((draft) => {
    upsertIntegration(draft, orgId, provider, { state });
    logAudit(draft, auth, 'integration.prepare', orgId, { provider });
  });
  res.json({
    provider,
    authorizationUrl,
    state,
    message: 'Local adapter: the OAuth handshake must be completed with a real provider client.',
  });
}));

integrationsRouter.post('/:provider/disconnect', asyncRoute(async (req, res) => {
  const provider = req.params.provider as string;
  if (!isKnownProvider(provider)) throw badRequest('Unknown integration provider', 'UNKNOWN_PROVIDER');
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;

  const integration = await store.mutate((draft) => {
    const current = upsertIntegration(draft, orgId, provider, {});
    current.status = 'not_connected';
    current.metadata = {};
    current.connectedBy = null;
    current.connectedAt = null;
    current.lastError = null;
    current.updatedAt = new Date().toISOString();
    if (provider === 'google_drive') {
      for (const connection of draft.driveConnections) {
        if (connection.organizationId !== orgId) continue;
        connection.status = 'not_connected';
        connection.folderId = null;
        connection.folderName = null;
        connection.connectedBy = null;
        connection.connectedAt = null;
        connection.lastError = null;
        connection.updatedAt = new Date().toISOString();
        Object.assign(connection, { metadata: {} });
      }
    }
    logAudit(draft, auth, 'integration.disconnected', orgId, { provider });
    return publicIntegration(current);
  });
  res.json({ integration });
}));

/** HMAC over the parsed request body; unexpected header formats are hashed first. */
function signatureMatches(expected: string, provided: string): boolean {
  if (!provided) return false;
  if (safeEqualHex(expected, provided)) return true;
  return safeEqualHex(expected, sha256(provided));
}

webhooksRouter.post('/:provider', asyncRoute(async (req, res) => {
  const provider = req.params.provider as string;
  if (provider === 'billing') {
    throw badRequest('Billing webhooks are handled by the billing module', 'BILLING_WEBHOOK');
  }
  if (!isKnownProvider(provider)) throw badRequest('Unknown integration provider', 'UNKNOWN_PROVIDER');
  const secret = process.env.INTEGRATION_WEBHOOK_SECRET;
  if (!secret?.trim()) {
    throw new AppError(503, 'PROVIDER_NOT_CONFIGURED',
      'INTEGRATION_WEBHOOK_SECRET is not configured; webhook verification is unavailable.');
  }

  const provided = req.header('x-webhook-signature') ?? '';
  const expected = createHmac('sha256', secret).update(JSON.stringify(req.body ?? {})).digest('hex');
  if (!signatureMatches(expected, provided)) {
    throw new AppError(401, 'INVALID_SIGNATURE', 'Webhook signature is invalid');
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  const eventId = typeof body.id === 'string' ? body.id
    : typeof body.eventId === 'string' ? body.eventId : null;
  if (!eventId) throw badRequest('Webhook event id is required', 'EVENT_ID_REQUIRED');

  const duplicate = store.read((state) =>
    state.auditLogs.some((entry) => entry.action === `webhook.${provider}.${eventId}`));
  if (duplicate) {
    res.json({ received: true, duplicate: true });
    return;
  }
  await store.mutate((draft) => {
    logAudit(draft, null, `webhook.${provider}.${eventId}`, eventId, {
      provider,
      eventId,
      type: typeof body.type === 'string' ? body.type : null,
    });
  });
  res.json({ received: true, duplicate: false });
}));
