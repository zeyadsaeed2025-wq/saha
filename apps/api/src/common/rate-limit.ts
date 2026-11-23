import type { NextFunction, Request, Response } from 'express';
import { AppError } from './errors.js';

interface Bucket { count: number; resetAt: number }

/**
 * Single-instance in-process rate limiter. A shared Redis/Postgres-backed
 * limiter is required before horizontal scaling; ADR-002 already restricts the
 * world service to a single instance.
 */
export function rateLimit(options: { windowMs: number; max: number; prefix: string; message?: string }) {
  const buckets = new Map<string, Bucket>();
  const windowMs = Math.max(1_000, options.windowMs);
  const max = Math.max(1, options.max);

  return (req: Request, _res: Response, next: NextFunction): void => {
    const now = Date.now();
    const ip = req.ip ?? req.socket.remoteAddress ?? 'unknown';
    const key = `${options.prefix}:${ip}:${req.path}`;
    let bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      bucket = { count: 0, resetAt: now + windowMs };
      buckets.set(key, bucket);
    }
    bucket.count += 1;
    if (buckets.size > 10_000) {
      for (const [storedKey, stored] of buckets) if (stored.resetAt <= now) buckets.delete(storedKey);
    }
    if (bucket.count > max) {
      return next(new AppError(429, 'RATE_LIMITED', options.message ?? 'Too many requests. Please try again later.'));
    }
    next();
  };
}

export const apiRateLimit = rateLimit({
  prefix: 'api', windowMs: 60_000, max: Number(process.env.API_RATE_LIMIT_MAX ?? 600),
});

export const authRateLimit = rateLimit({
  prefix: 'auth', windowMs: 60_000, max: Number(process.env.AUTH_RATE_LIMIT_MAX ?? 30),
  message: 'Too many authentication attempts. Please wait before trying again.',
});

export const linkRateLimit = rateLimit({
  prefix: 'link', windowMs: 60_000, max: Number(process.env.LINK_RATE_LIMIT_MAX ?? 60),
  message: 'Too many link attempts. Please wait before trying again.',
});
