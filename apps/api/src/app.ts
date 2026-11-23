import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import { ZodError } from 'zod';
import { AppError } from './common/errors.js';
import { attachUser, csrfGuard } from './common/middleware.js';
import { store } from './common/store.js';
import { authRouter } from './modules/auth/routes.js';
import { organizationsRouter } from './modules/organizations/routes.js';
import { workspacesRouter } from './modules/workspaces/routes.js';
import { membersRouter } from './modules/members/routes.js';
import { invitationsRouter, accessLinksRouter, redeemRouter } from './modules/invitations/routes.js';
import { schedulesRouter } from './modules/schedules/routes.js';
import { attendanceRouter } from './modules/attendance/routes.js';
import { reportsRouter } from './modules/reports/routes.js';
import { demoRouter } from './modules/demo/routes.js';
import { worldRouter } from './modules/world/routes.js';
import { teamsRouter } from './modules/teams/routes.js';
import { mediaRouter } from './modules/media/routes.js';
import { recordingsRouter } from './modules/recordings/routes.js';
import { driveRouter } from './modules/drive/routes.js';
import { integrationsRouter, webhooksRouter } from './modules/integrations/routes.js';
import { billingRouter } from './modules/billing/routes.js';
import { billingWebhooksRouter } from './modules/billing/webhooks.js';
import { adminRouter } from './modules/admin/routes.js';
import { analyticsRouter } from './modules/analytics/routes.js';
import { messagingRouter } from './modules/messaging/routes.js';
import { notificationsRouter } from './modules/notifications/routes.js';
import { aiRouter } from './modules/ai/routes.js';
import { customizationRouter } from './modules/customization/routes.js';
import { credentialsRouter, platformCredentialsRouter } from './modules/credentials/routes.js';
import { apiRateLimit, authRateLimit, linkRateLimit } from './common/rate-limit.js';

/** Builds the Express application without binding a port (safe to import in tests). */
export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({
    origin: (process.env.APP_URL ?? 'http://localhost:5173').split(','),
    credentials: true,
  }));
  app.use(express.json({ limit: '256kb' }));
  app.use(cookieParser());
  app.use(apiRateLimit);
  app.use('/api/auth', authRateLimit);

  app.get('/api/health', (_req, res) => res.json({
    status: 'ok', service: 'saha-api', time: new Date().toISOString(),
    dataAdapter: store.kind,
    databaseUrlConfigured: Boolean(process.env.DATABASE_URL),
  }));
  app.use('/api/demo', demoRouter);

  app.use(attachUser);
  app.use((req: Request, res: Response, next: NextFunction) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    // Provider webhooks authenticate with HMAC signatures, never browser CSRF cookies.
    const webhookPaths = [/^\/api\/webhooks\/(?:billing|[^/]+)$/];
    if (webhookPaths.some((pattern) => pattern.test(req.path))) return next();
    const publicPaths = [/^\/api\/auth\/(login|register|forgot|reset)$/, /^\/api\/access\/[^/]+\/redeem$/];
    if (publicPaths.some((pattern) => pattern.test(req.path))) {
      // Public endpoints still set CSRF cookies on login; no pre-existing cookie required.
      return next();
    }
    return csrfGuard(req, res, next);
  });

  app.use('/api/auth', authRouter);
  app.use('/api/orgs/token', linkRateLimit);
  app.use('/api/access', linkRateLimit);
  app.use('/api/orgs', organizationsRouter);
  app.use('/api/orgs/:orgId/workspaces', workspacesRouter);
  app.use('/api/orgs/:orgId/members', membersRouter);
  app.use('/api/orgs/:orgId/teams', teamsRouter);
  app.use('/api/orgs/:orgId/schedules', schedulesRouter);
  app.use('/api/orgs/:orgId/attendance', attendanceRouter);
  app.use('/api/orgs/:orgId/reports', reportsRouter);
  app.use('/api/orgs/:orgId/world', worldRouter);
  app.use('/api/orgs', invitationsRouter);
  app.use('/api/orgs/:orgId/access-links', accessLinksRouter);
  app.use('/api/access', redeemRouter);

  // Stage 2 — media, meetings, recordings and integrations.
  app.use('/api/orgs/:orgId/media', mediaRouter);
  app.use('/api/orgs/:orgId/recordings', recordingsRouter);
  app.use('/api/orgs/:orgId/drive', driveRouter);
  app.use('/api/orgs/:orgId/integrations', integrationsRouter);

  // Stage 3 — billing, platform admin, analytics, messaging, notifications, AI, customization.
  app.use('/api/orgs/:orgId/billing', billingRouter);
  // Billing has its own signed webhook pipeline; mount it BEFORE the generic
  // /api/webhooks/:provider route so it is not shadowed.
  app.use('/api/webhooks/billing', billingWebhooksRouter);
  app.use('/api/webhooks', webhooksRouter);
  app.use('/api/admin', adminRouter);
  app.use('/api/orgs/:orgId/analytics', analyticsRouter);
  app.use('/api/orgs/:orgId/messaging', messagingRouter);
  app.use('/api/orgs/:orgId/notifications', notificationsRouter);
  app.use('/api/orgs/:orgId/ai', aiRouter);
  app.use('/api/orgs/:orgId/customization', customizationRouter);

  // Encrypted credential vault. Org secrets are tenant-scoped; platform secrets
  // are super-admin-only and mounted before the general /api/admin router.
  app.use('/api/orgs/:orgId/credentials', credentialsRouter);
  app.use('/api/admin/credentials', platformCredentialsRouter);

  const webRoot = resolve(process.cwd(), 'dist/web');
  if (existsSync(webRoot)) {
    app.use(express.static(webRoot));
    app.get(/^(?!\/api\/|\/ws\/).*/, (_req, res) => res.sendFile(resolve(webRoot, 'index.html')));
  }

  app.use((_req: Request, res: Response) => {
    res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Endpoint not found' } });
  });
  app.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (error instanceof AppError) {
      return res.status(error.status).json({ error: { code: error.code, message: error.message, details: error.details } });
    }
    if (error instanceof SyntaxError) {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Malformed request body' } });
    }
    if (error instanceof ZodError) {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid request payload', details: error.flatten() } });
    }
    if (error instanceof Error && error.message === 'INVALID_PHONE') {
      return res.status(400).json({ error: { code: 'BAD_REQUEST', message: 'Invalid phone number' } });
    }
    console.error('[api] unhandled error', error);
    res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' } });
  });
  return app;
}
