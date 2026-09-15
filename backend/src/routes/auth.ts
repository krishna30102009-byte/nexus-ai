import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { hashPassword, verifyPassword, signAccessToken } from '../utils/crypto.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { appendChainRecord } from '../services/chain.js';
import { randomUUID } from 'node:crypto';

const router = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post('/login', async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'Invalid login payload', statusCode: 400 } });
    return;
  }
  const db = getDb();
  const loginEmail = parsed.data.email.toLowerCase();
  const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
  const ua = (req.headers['user-agent'] as string) || '';
  function auditLogin(userId: string | null, action: string, outcome: 'success' | 'failure'): void {
    try {
      db.prepare(
        `INSERT INTO audit_logs (id, user_id, action, resource_type, resource_id, details_json, ip_address, user_agent, timestamp, outcome, risk_score)
         VALUES (?, ?, ?, 'auth', '/api/auth/login', ?, ?, ?, ?, ?, ?)`
      ).run(randomUUID(), userId, action, JSON.stringify({ email: loginEmail }), ip, ua, new Date().toISOString(), outcome, outcome === 'failure' ? 40 : 0);
    } catch { /* never block login on audit failure */ }
  }
  const user = db.prepare(`SELECT * FROM users WHERE email = ? AND is_active = 1`).get(parsed.data.email.toLowerCase()) as any;
  if (!user || !(await verifyPassword(parsed.data.password, user.password_hash))) {
    auditLogin(user?.id ?? null, 'LOGIN_FAILED', 'failure');
    res.status(401).json({ success: false, error: { code: 'BAD_CREDS', message: 'Invalid credentials', statusCode: 401 } });
    return;
  }
  db.prepare(`UPDATE users SET last_login_at = ? WHERE id = ?`).run(new Date().toISOString(), user.id);
  auditLogin(user.id, 'LOGIN', 'success');

  const token = signAccessToken({ sub: user.id, email: user.email, role: user.role, name: user.name });
  try {
    appendChainRecord({ caseId: null, eventType: 'login', actorId: user.id, actorRole: user.role, payload: { email: user.email } });
  } catch { /* chain table may not exist yet */ }

  res.json({
    success: true,
    data: {
      token,
      user: { id: user.id, email: user.email, name: user.name, role: user.role, badgeNumber: user.badge_number, department: user.department },
    },
  });
});

router.get('/me', requireAuth, (req: AuthRequest, res) => {
  const db = getDb();
  const user = db.prepare(`SELECT id, email, name, role, badge_number, department, created_at, last_login_at FROM users WHERE id = ?`).get(req.user!.sub);
  res.json({ success: true, data: user });
});

// NO public signup. Admin-only account creation.
const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  name: z.string().min(1),
  role: z.enum(['officer', 'police', 'admin']),
  badgeNumber: z.string().optional(),
  department: z.string().optional(),
});

router.post('/users', requireAuth, requireAdmin, async (req: AuthRequest, res) => {
  const parsed = createUserSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'Invalid user payload', details: parsed.error.flatten(), statusCode: 400 } });
    return;
  }
  const db = getDb();
  const now = new Date().toISOString();
  try {
    const id = randomUUID();
    db.prepare(
      `INSERT INTO users (id, email, password_hash, name, role, badge_number, department, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    ).run(id, parsed.data.email.toLowerCase(), await hashPassword(parsed.data.password), parsed.data.name, parsed.data.role, parsed.data.badgeNumber ?? null, parsed.data.department ?? null, now, now);
    res.status(201).json({ success: true, data: { id, email: parsed.data.email, role: parsed.data.role } });
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) {
      res.status(409).json({ success: false, error: { code: 'EXISTS', message: 'Email already exists', statusCode: 409 } });
      return;
    }
    throw e;
  }
});

router.get('/users', requireAuth, requireAdmin, (_req, res) => {
  const db = getDb();
  const users = db.prepare(`SELECT id, email, name, role, badge_number, department, is_active, created_at, last_login_at FROM users ORDER BY created_at DESC`).all();
  res.json({ success: true, data: users });
});

export default router;
