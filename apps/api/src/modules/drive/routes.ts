import { randomUUID } from 'node:crypto';
import { Router, type Request } from 'express';
import { z } from 'zod';
import { findInOrg, inOrg, store } from '../../common/store.js';
import { asyncRoute, getAuth, logAudit, requireFeature, requireOrg, requirePermission } from '../../common/middleware.js';
import { AppError, badRequest } from '../../common/errors.js';
import { randomToken } from '../../common/security.js';
import type { DbState, DriveConnection, IntegrationConnection } from '../../domain/types.js';

export const driveRouter = Router({ mergeParams: true });

driveRouter.use(requireOrg);
driveRouter.use(requireFeature('integrations'));
driveRouter.use(requirePermission('integration:manage'));

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.file';
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const UPLOAD_ENDPOINT = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';

/** The local store allows extra fields on DriveConnection; tokens are never exposed. */
type DriveRecord = DriveConnection & { metadata?: Record<string, unknown> };
type PublicDriveConnection = DriveConnection & { configured: boolean };

const folderSchema = z.object({
  folderId: z.string().min(1).max(512),
  folderName: z.string().min(1).max(240),
});
const callbackSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(512),
});

const credentialsConfigured = (): boolean =>
  Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());

function redirectUri(orgId: string): string {
  return process.env.GOOGLE_REDIRECT_URI?.trim()
    || `${process.env.APP_URL ?? 'http://localhost:5173'}/api/orgs/${orgId}/drive/connect/callback`;
}

function publicConnection(connection: DriveRecord, configured: boolean): PublicDriveConnection {
  return {
    organizationId: connection.organizationId,
    status: connection.status,
    folderId: connection.folderId,
    folderName: connection.folderName,
    connectedBy: connection.connectedBy,
    connectedAt: connection.connectedAt,
    lastError: connection.lastError,
    updatedAt: connection.updatedAt,
    configured,
  };
}

function defaultConnection(orgId: string, configured: boolean): PublicDriveConnection {
  return {
    organizationId: orgId,
    status: 'not_connected',
    folderId: null,
    folderName: null,
    connectedBy: null,
    connectedAt: null,
    lastError: null,
    updatedAt: new Date().toISOString(),
    configured,
  };
}

function driveConnection(draft: DbState, orgId: string): DriveRecord | undefined {
  return inOrg(draft.driveConnections as DriveRecord[], orgId)[0];
}

function driveIntegration(draft: DbState, orgId: string): IntegrationConnection | undefined {
  return draft.integrations.find((item) => item.organizationId === orgId && item.provider === 'google_drive');
}

function saveOAuthState(draft: DbState, orgId: string, state: string): void {
  const now = new Date().toISOString();
  const existing = driveIntegration(draft, orgId);
  if (existing) {
    existing.metadata = { ...existing.metadata, state };
    existing.updatedAt = now;
    return;
  }
  draft.integrations.push({
    id: randomUUID(),
    organizationId: orgId,
    provider: 'google_drive',
    status: 'not_connected',
    scopes: [DRIVE_SCOPE],
    connectedBy: null,
    connectedAt: null,
    lastError: null,
    metadata: { state },
    updatedAt: now,
  });
}

driveRouter.get('/status', (req: Request, res) => {
  const orgId = req.params.orgId as string;
  const configured = credentialsConfigured();
  const connection = store.read((state) => {
    const stored = driveConnection(state, orgId);
    return stored ? publicConnection(stored, configured) : defaultConnection(orgId, configured);
  });
  res.json({ connection });
});

driveRouter.post('/connect/prepare', asyncRoute(async (req, res) => {
  const orgId = req.params.orgId as string;
  if (!credentialsConfigured()) {
    throw new AppError(503, 'PROVIDER_NOT_CONFIGURED',
      'Google Drive credentials are not configured; OAuth connect is unavailable locally.');
  }
  const auth = getAuth(req)!;
  const state = randomToken(16);
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID as string,
    redirect_uri: redirectUri(orgId),
    response_type: 'code',
    scope: DRIVE_SCOPE,
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  const authorizationUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  await store.mutate((draft) => {
    saveOAuthState(draft, orgId, state);
    logAudit(draft, auth, 'drive.connect_prepared', orgId, { provider: 'google_drive' });
  });
  res.json({ authorizationUrl, state });
}));

driveRouter.post('/connect/callback', asyncRoute(async (req, res) => {
  const parsed = callbackSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('An authorization code and state are required');
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;

  const connection = await store.mutate(async (draft) => {
    const integration = driveIntegration(draft, orgId);
    const storedState = integration?.metadata?.state;
    if (typeof storedState !== 'string' || storedState !== parsed.data.state) {
      throw badRequest('Invalid or expired OAuth state', 'INVALID_STATE');
    }
    if (!credentialsConfigured()) {
      throw new AppError(503, 'PROVIDER_NOT_CONFIGURED',
        'Google Drive credentials are not configured; the OAuth callback is unavailable locally.');
    }

    const existing = driveConnection(draft, orgId);
    const now = new Date().toISOString();
    const fail = (): never => {
      if (existing) {
        existing.status = 'error';
        existing.lastError = 'Google token exchange failed';
        existing.updatedAt = new Date().toISOString();
      } else {
        draft.driveConnections.push({
          organizationId: orgId,
          status: 'error',
          folderId: null,
          folderName: null,
          connectedBy: null,
          connectedAt: null,
          lastError: 'Google token exchange failed',
          updatedAt: new Date().toISOString(),
        });
      }
      if (integration) {
        integration.status = 'error';
        integration.lastError = 'Google token exchange failed';
        integration.updatedAt = new Date().toISOString();
      }
      logAudit(draft, auth, 'drive.connect_failed', orgId, { provider: 'google_drive' });
      throw new AppError(502, 'PROVIDER_ERROR', 'Google token exchange failed; no Drive connection was created.');
    };

    const body = new URLSearchParams({
      code: parsed.data.code,
      client_id: process.env.GOOGLE_CLIENT_ID as string,
      client_secret: process.env.GOOGLE_CLIENT_SECRET as string,
      redirect_uri: redirectUri(orgId),
      grant_type: 'authorization_code',
    });
    let tokenResponse: Response;
    try {
      tokenResponse = await fetch(TOKEN_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
      });
    } catch {
      return fail();
    }
    if (!tokenResponse.ok) return fail();

    let payload: { access_token?: unknown };
    try {
      payload = await tokenResponse.json() as { access_token?: unknown };
    } catch {
      return fail();
    }
    if (typeof payload.access_token !== 'string' || !payload.access_token) return fail();

    // Dev-only local adapter: the token is kept verbatim in the local JSON store.
    // It must never be returned to the client or written to an audit log.
    const accessToken = payload.access_token;
    let target = existing;
    if (!target) {
      target = {
        organizationId: orgId,
        status: 'connected',
        folderId: null,
        folderName: null,
        connectedBy: auth.user.id,
        connectedAt: now,
        lastError: null,
        updatedAt: now,
        metadata: {},
      };
      draft.driveConnections.push(target);
    }
    target.status = 'connected';
    target.connectedBy = auth.user.id;
    target.connectedAt = now;
    target.lastError = null;
    target.updatedAt = now;
    target.metadata = { ...(target.metadata ?? {}), access_token: accessToken };

    integration!.status = 'connected';
    integration!.scopes = [DRIVE_SCOPE];
    integration!.connectedBy = auth.user.id;
    integration!.connectedAt = now;
    integration!.lastError = null;
    integration!.updatedAt = now;
    // State is single-use; remove it together with any previous token.
    integration!.metadata = { access_token: accessToken };

    logAudit(draft, auth, 'drive.connected', orgId, { provider: 'google_drive' });
    return publicConnection(target, true);
  });
  res.json({ connection });
}));

driveRouter.post('/folder', asyncRoute(async (req, res) => {
  const parsed = folderSchema.safeParse(req.body);
  if (!parsed.success) throw badRequest('A folder id and name are required');
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const connection = await store.mutate((draft) => {
    const target = driveConnection(draft, orgId);
    if (!target || target.status !== 'connected') {
      throw badRequest('Connect Google Drive first', 'DRIVE_NOT_CONNECTED');
    }
    target.folderId = parsed.data.folderId;
    target.folderName = parsed.data.folderName;
    target.updatedAt = new Date().toISOString();
    logAudit(draft, auth, 'drive.folder_selected', orgId, {
      folderId: parsed.data.folderId,
      folderName: parsed.data.folderName,
    });
    return publicConnection(target, credentialsConfigured());
  });
  res.json({ connection });
}));

driveRouter.post('/disconnect', asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const connection = await store.mutate((draft) => {
    const target = driveConnection(draft, orgId);
    const now = new Date().toISOString();
    if (target) {
      target.status = 'not_connected';
      target.folderId = null;
      target.folderName = null;
      target.connectedBy = null;
      target.connectedAt = null;
      target.lastError = null;
      target.updatedAt = now;
      target.metadata = {};
    }
    const integration = driveIntegration(draft, orgId);
    if (integration) {
      integration.status = 'not_connected';
      integration.connectedBy = null;
      integration.connectedAt = null;
      integration.lastError = null;
      integration.metadata = {};
      integration.updatedAt = now;
    }
    logAudit(draft, auth, 'drive.disconnected', orgId, { provider: 'google_drive' });
    return target ? publicConnection(target, credentialsConfigured()) : defaultConnection(orgId, credentialsConfigured());
  });
  res.json({ connection });
}));

driveRouter.post('/upload/:recordingId', asyncRoute(async (req, res) => {
  const auth = getAuth(req)!;
  const orgId = req.params.orgId as string;
  const preflight = store.read((state) => ({
    recording: findInOrg(state.recordings, orgId, req.params.recordingId as string),
    connection: driveConnection(state, orgId),
  }));
  if (!preflight.recording) throw badRequest('Recording not found', 'NOT_FOUND');
  const accessToken = preflight.connection?.metadata?.access_token;
  if (!preflight.connection || preflight.connection.status !== 'connected'
    || !preflight.connection.folderId || typeof accessToken !== 'string' || !accessToken) {
    throw new AppError(503, 'PROVIDER_NOT_CONFIGURED',
      'A connected Google Drive folder and an OAuth access token are required; this adapter has no upload credentials.');
  }

  const sourceUrl = process.env.RECORDING_FILE_SOURCE_URL?.trim();
  if (!sourceUrl) {
    throw badRequest('No recording file source is configured for this adapter', 'NO_MEDIA_SOURCE');
  }
  let bytes: Uint8Array;
  try {
    const source = await fetch(sourceUrl);
    if (!source.ok) throw new Error(`HTTP ${source.status}`);
    bytes = new Uint8Array(await source.arrayBuffer());
  } catch {
    throw new AppError(502, 'MEDIA_SOURCE_ERROR', 'The configured recording file source could not be read.');
  }
  if (bytes.byteLength === 0) {
    throw badRequest('No recording file source is configured for this adapter', 'NO_MEDIA_SOURCE');
  }

  const boundary = `----saha-${randomToken(12)}`;
  const fileMetadata = JSON.stringify({
    name: `${preflight.recording.id}.webm`,
    parents: [preflight.connection.folderId],
  });
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${fileMetadata}\r\n`
    + `--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  const multipartBody = Buffer.concat([head, Buffer.from(bytes), tail]);

  let uploadResponse: Response;
  try {
    uploadResponse = await fetch(UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': `multipart/related; boundary=${boundary}`,
      },
      body: multipartBody,
    });
  } catch {
    throw new AppError(502, 'PROVIDER_ERROR', 'Google Drive upload failed.');
  }
  if (!uploadResponse.ok) {
    throw new AppError(502, 'PROVIDER_ERROR', `Google Drive upload failed (HTTP ${uploadResponse.status}).`);
  }
  let uploaded: { id?: unknown; webViewLink?: unknown };
  try {
    uploaded = await uploadResponse.json() as { id?: unknown; webViewLink?: unknown };
  } catch {
    throw new AppError(502, 'PROVIDER_ERROR', 'Google Drive returned an invalid upload response.');
  }
  if (typeof uploaded.id !== 'string' || !uploaded.id) {
    throw new AppError(502, 'PROVIDER_ERROR', 'Google Drive did not return a file id.');
  }
  const providerFileId = uploaded.id;
  const providerUrl = typeof uploaded.webViewLink === 'string' ? uploaded.webViewLink : null;
  const at = new Date().toISOString();

  const recording = await store.mutate((draft) => {
    const target = findInOrg(draft.recordings, orgId, preflight.recording!.id);
    if (!target) throw badRequest('Recording not found', 'NOT_FOUND');
    target.status = 'uploaded';
    target.providerFileId = providerFileId;
    target.providerUrl = providerUrl;
    target.lastError = null;
    draft.notificationLogs.push({
      id: randomUUID(),
      organizationId: orgId,
      userId: auth.user.id,
      channel: 'in_app',
      type: 'recording.uploaded',
      status: 'sent',
      provider: 'google_drive',
      error: null,
      createdAt: at,
    });
    logAudit(draft, auth, 'recording.uploaded', target.id, { providerFileId });
    return target;
  });
  res.json({ recording });
}));
