import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAdmin } from '../middleware/rbac.js';
import { verifyChain } from '../services/chain.js';

const router = Router();
router.use(requireAuth, requireAdmin);

// Integrity Check admin view — per-case chain status + global log counts
router.get('/integrity', (_req, res) => {
  const db = getDb();
  const cases = db.prepare(`SELECT id, case_number, title, status FROM cases ORDER BY updated_at DESC`).all() as any[];
  const report = cases.map((c) => {
    const v = verifyChain(c.id);
    return { caseId: c.id, caseNumber: c.case_number, title: c.title, status: c.status, ...v };
  });
  const totals = {
    cases: cases.length,
    chainRecords: (db.prepare(`SELECT COUNT(*) AS c FROM chain_records`).get() as { c: number }).c,
    approvals: (db.prepare(`SELECT COUNT(*) AS c FROM approvals`).get() as { c: number }).c,
    auditLogs: (db.prepare(`SELECT COUNT(*) AS c FROM audit_logs`).get() as { c: number }).c,
    pendingApprovals: (db.prepare(`SELECT COUNT(*) AS c FROM approvals WHERE status = 'pending'`).get() as { c: number }).c,
  };
  const global = verifyChain(null);
  const allOk = report.every((r) => r.ok) && global.ok;
  res.json({ success: true, data: { allOk, totals, cases: report, global } });
});

// One-click Verify Entire Chain — scans every case's hash-chain
router.post('/verify-all', (_req, res) => {
  const db = getDb();
  const cases = db.prepare(`SELECT id, case_number FROM cases`).all() as Array<{ id: string; case_number: string }>;
  const results = cases.map((c) => ({ scope: 'case', caseId: c.id, caseNumber: c.case_number, ...verifyChain(c.id) }));
  const global = { scope: 'global', caseId: null, caseNumber: '(system logins)', ...verifyChain(null) };
  const all = [...results, global];
  const tampered = all.filter((r) => !r.ok);
  res.json({
    success: true,
    data: {
      scanned: all.length,
      intact: all.length - tampered.length,
      tampered: tampered.length,
      allOk: tampered.length === 0,
      results: all,
    },
  });
});

// Audit trail — every login + data access/change (queryable)
router.get('/audit-logs', (req, res) => {
  const db = getDb();
  const userId = typeof req.query.userId === 'string' ? req.query.userId : undefined;
  const limit = Math.min(500, Math.max(1, parseInt(String(req.query.limit || '100'), 10) || 100));
  const rows = userId
    ? db.prepare(`SELECT * FROM audit_logs WHERE user_id = ? ORDER BY timestamp DESC LIMIT ?`).all(userId, limit)
    : db.prepare(`SELECT * FROM audit_logs ORDER BY timestamp DESC LIMIT ?`).all(limit);
  res.json({ success: true, data: rows });
});

// Full chain dump for a case (admin forensics)
router.get('/chain/:caseId', (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT * FROM chain_records WHERE case_id = ? ORDER BY seq ASC`).all(req.params.caseId);
  res.json({ success: true, data: rows });
});

export default router;
