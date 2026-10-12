import type { Request, Response, NextFunction } from 'express';

/**
 * Simple in-memory fixed-window rate limiter (single-instance only).
 * If the API is ever scaled to multiple instances, swap this for a shared store.
 */
export function rateLimit(opts: { windowMs: number; max: number; key: (req: Request) => string }) {
  const hits = new Map<string, { count: number; resetAt: number }>();

  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, opts.windowMs).unref();

  return (req: Request, res: Response, next: NextFunction) => {
    const key = opts.key(req);
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + opts.windowMs };
      hits.set(key, entry);
    }
    entry.count++;
    if (entry.count > opts.max) {
      res.setHeader('Retry-After', Math.ceil((entry.resetAt - now) / 1000));
      return res.status(429).json({
        error: 'TOO_MANY_ATTEMPTS',
        message: 'Too many attempts. Please wait a few minutes and try again.',
      });
    }
    next();
  };
}
