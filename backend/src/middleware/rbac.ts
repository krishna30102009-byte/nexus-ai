import type { Response, NextFunction } from 'express';
import type { AuthRequest } from './auth.js';

type Role = 'officer' | 'police' | 'admin';

/** Only these roles exist. No public signup — Admin creates accounts. */
export function requireRole(...allowed: Role[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ success: false, error: { code: 'UNAUTH', message: 'Not authenticated', statusCode: 401 } });
      return;
    }
    if (!allowed.includes(req.user.role)) {
      res.status(403).json({ success: false, error: { code: 'FORBIDDEN', message: 'Insufficient role', statusCode: 403 } });
      return;
    }
    next();
  };
}

export const requireAdmin = requireRole('admin');
export const requireOfficerOrAdmin = requireRole('officer', 'admin');
export const requireAnyRole = requireRole('officer', 'police', 'admin');
