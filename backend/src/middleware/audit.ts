import type { Response, NextFunction } from 'express';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import type { AuthRequest } from './auth.js';

/**
 * Global mount BEFORE routes (see index.ts) but the insert happens on
 * response finish — by then requireAuth has populated req.user, so every
 * authenticated action is traceable to an officer/admin account.
 */
export function auditLog(req: AuthRequest, res: Response, next: NextFunction): void {
  res.on('finish', () => {
    try {
      if (!req.user) return;
      if (req.path === '/api/auth/login' || req.path === '/api/health') return;
      const db = getDb();
      db.prepare(
        `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details_json, ip_address, user_agent, timestamp, outcome, risk_score)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        req.user.sub,
        `${req.method} ${req.path}`,
        'http',
        req.path,
        JSON.stringify({ statusCode: res.statusCode }),
        (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '',
        (req.headers['user-agent'] as string) || '',
        new Date().toISOString(),
        res.statusCode < 400 ? 'success' : 'failure',
        0
      );
    } catch {
      // never break responses on audit failure
    }
  });
  next();
}
