import { createServer } from 'node:http';
import { createApp } from './app.js';
import { initializeStore, store } from './common/store.js';
import { SESSION_COOKIE } from './common/middleware.js';
import { attachWorldServer } from './modules/world/socket.js';
import { startAttendanceJob } from './modules/attendance/jobs.js';
import { credentialMasterKey } from './common/secrets.js';

if (!process.env.VITEST) {
  // Fail fast in production: a missing vault key must never silently fall back
  // to the deterministic development key.
  credentialMasterKey();
  const port = Number(process.env.PORT ?? 4000);
  await initializeStore();
  const server = createServer(createApp());
  attachWorldServer(server);
  startAttendanceJob(Number(process.env.ATTENDANCE_JOB_MS ?? 60_000));
  server.listen(port, () => {
    console.log(`[saha] API + world server listening on http://localhost:${port}`);
    console.log(`[saha] data adapter: ${store.kind}`);
    console.log(`[saha] session cookie: ${SESSION_COOKIE}`);
  });
}
