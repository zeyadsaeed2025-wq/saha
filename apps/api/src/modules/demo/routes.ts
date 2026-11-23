import { Router } from 'express';
import { asyncRoute } from '../../common/middleware.js';
import { forbidden } from '../../common/errors.js';
import { seedDemo } from './seed.js';

export const demoRouter = Router();

demoRouter.post('/seed', asyncRoute(async (_req, res) => {
  if (process.env.ALLOW_DEMO_SEED !== 'true') throw forbidden('Demo data is disabled on this deployment');
  const result = await seedDemo();
  res.json({
    ...result,
    notice: 'Sample data only. It is marked as a demo organization and is never mixed with real customer data.',
  });
}));
