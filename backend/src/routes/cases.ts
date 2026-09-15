import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { requireOfficerOrAdmin, requireAnyRole } from '../middleware/rbac.js';
import { appendChainRecord, verifyChain } from '../services/chain.js';
import { addTimelineEvent } from '../services/timeline.js';

const router = Router();
router.use(requireAuth);

/* ---------- helpers ---------- */

function parseJsonArray(v: unknown): string[] {
  try {
    const a = typeof v === 'string' ? JSON.parse(v) : v;
    return Array.isArray(a) ? a : [];
  } catch {
    return [];
  }
}

function nextCaseNumber(): string {
  const db = getDb();
  const rows = db.prepare(`SELECT case_number FROM cases WHERE case_number LIKE 'NTF-%'`).all() as Array<{ case_number: string }>;
  let max = 41;
  for (const r of rows) {
    const n = parseInt((r.case_number || '').split('-')[1] || '0', 10);
    if (!isNaN(n) && n > max) max = n;
  }
  return `NTF-${String(max + 1).padStart(3, '0')}`;
}

function rowToCase(row: any): any {
  return {
    ...row,
    entityIds: parseJsonArray(row.entity_ids_json),
    documentIds: parseJsonArray(row.document_ids_json),
    tags: parseJsonArray(row.tags_json),
  };
}

/* ---------- schemas ---------- */

const createCaseSchema = z.object({
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional().default(''),
  firNumber: z.string().max(50).optional().nullable(),
  cnrNumber: z.string().max(50).optional().nullable(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  tags: z.array(z.string().max(40)).max(20).default([]),
  assignedTo: z.array(z.string().uuid()).max(20).default([]),
});

const updateCaseSchema = z.object({
  title: z.string().min(3).max(200).optional(),
  description: z.string().max(5000).optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  firNumber: z.string().max(50).optional().nullable(),
  cnrNumber: z.string().max(50).optional().nullable(),
  tags: z.array(z.string().max(40)).max(20).optional(),
}).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });

const noteSchema = z.object({
  content: z.string().min(1).max(5000),
  isPrivate: z.boolean().default(false),
});

const reasonSchema = z.object({
  reason: z.string().min(5).max(1000),
});

/* ---------- routes ---------- */

// LIST — any role, ?status=&q=&page=&limit=
router.get('/', requireAnyRole, (req, res) => {
  const db = getDb();
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));
  const offset = (page - 1) * limit;

  const conds: string[] = [];
  const params: Array<string | number | null | Buffer> = [];
  if (status) {
    conds.push('status = ?');
    params.push(status);
  }
  if (q) {
    conds.push('(case_number LIKE ? OR title LIKE ? OR fir_number LIKE ? OR cnr_number LIKE ?)');
    params.push(`%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`);
  }
  const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
  const total = (db.prepare(`SELECT COUNT(*) AS c FROM cases ${where}`).get(...params) as { c: number }).c;
  const rows = db.prepare(`SELECT * FROM cases ${where} ORDER BY updated_at DESC LIMIT ? OFFSET ?`).all(...params, limit, offset) as any[];

  res.json({
    success: true,
    data: rows.map(rowToCase),
    meta: { timestamp: new Date().toISOString(), requestId: randomUUID(), version: '2.0', pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } },
  });
});

// CREATE — officer/admin only
router.post('/', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const parsed = createCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'Invalid case payload', details: parsed.error.flatten(), statusCode: 400 } });
    return;
  }
  const db = getDb();
  const now = new Date().toISOString();
  const id = randomUUID();
  const caseNumber = nextCaseNumber();

  db.prepare(
    `INSERT INTO cases (id, case_number, fir_number, cnr_number, title, description, status, priority, entity_ids_json, document_ids_json, created_at, updated_at, tags_json, created_by)
     VALUES (?, ?, ?, ?, ?, ?, 'open', ?, '[]', '[]', ?, ?, ?, ?)`
  ).run(id, caseNumber, parsed.data.firNumber || null, parsed.data.cnrNumber || null, parsed.data.title, parsed.data.description, parsed.data.priority, now, now, JSON.stringify(parsed.data.tags), req.user!.sub);

  for (const uid of parsed.data.assignedTo) {
    try {
      db.prepare(`INSERT INTO case_assignments (id, case_id, user_id, assigned_at, assigned_by) VALUES (?, ?, ?, ?, ?)`).run(randomUUID(), id, uid, now, req.user!.sub);
    } catch { /* skip bad user ids */ }
  }

  addTimelineEvent({ caseId: id, type: 'status_changed', title: `Case ${caseNumber} opened`, description: parsed.data.title, userId: req.user!.sub });
  appendChainRecord({ caseId: id, eventType: 'case_created', actorId: req.user!.sub, actorRole: req.user!.role, payload: { caseNumber, title: parsed.data.title } });

  const row = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(id);
  res.status(201).json({ success: true, data: rowToCase(row) });
});

// DETAIL — any role (private notes filtered for police)
router.get('/:id', requireAnyRole, (req: AuthRequest, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Case not found', statusCode: 404 } });
    return;
  }
  const notes = db.prepare(`SELECT * FROM case_notes WHERE case_id = ? ORDER BY created_at DESC LIMIT 100`).all(req.params.id) as any[];
  const visibleNotes = req.user!.role === 'police' ? notes.filter((n) => !n.is_private) : notes;
  const timeline = db.prepare(`SELECT * FROM timeline_events WHERE case_id = ? ORDER BY created_at DESC LIMIT 50`).all(req.params.id);
  const approvals = db.prepare(`SELECT * FROM approvals WHERE case_id = ? ORDER BY created_at DESC LIMIT 20`).all(req.params.id);
  const chainCount = (db.prepare(`SELECT COUNT(*) AS c FROM chain_records WHERE case_id = ?`).get(req.params.id) as { c: number }).c;

  res.json({ success: true, data: { ...rowToCase(row), notes: visibleNotes, timeline, approvals, chainCount } });
});

// UPDATE — officer/admin, blocked when closed (use reopen flow)
router.patch('/:id', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const parsed = updateCaseSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'Invalid update payload', details: parsed.error.flatten(), statusCode: 400 } });
    return;
  }
  const db = getDb();
  const row = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Case not found', statusCode: 404 } });
    return;
  }
  if (row.status === 'closed' && req.user!.role !== 'admin') {
    res.status(409).json({ success: false, error: { code: 'CASE_CLOSED', message: 'Case is closed. Request reopen via approval flow.', statusCode: 409 } });
    return;
  }
  const d = parsed.data;
  const now = new Date().toISOString();
  db.prepare(
    `UPDATE cases SET
       title = COALESCE(?, title),
       description = COALESCE(?, description),
       priority = COALESCE(?, priority),
       fir_number = COALESCE(?, fir_number),
       cnr_number = COALESCE(?, cnr_number),
       tags_json = COALESCE(?, tags_json),
       updated_at = ?
     WHERE id = ?`
  ).run(
    d.title ?? null, d.description ?? null, d.priority ?? null,
    d.firNumber ?? null, d.cnrNumber ?? null,
    d.tags ? JSON.stringify(d.tags) : null, now, req.params.id
  );

  addTimelineEvent({ caseId: req.params.id, type: 'status_changed', title: 'Case details edited', description: `Fields: ${Object.keys(d).join(', ')}`, userId: req.user!.sub });
  appendChainRecord({ caseId: req.params.id, eventType: 'data_edited', actorId: req.user!.sub, actorRole: req.user!.role, payload: { fields: Object.keys(d) } });

  const updated = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(req.params.id);
  res.json({ success: true, data: rowToCase(updated) });
});

// NOTES — any role can add (timestamped per-case log)
router.post('/:id/notes', requireAnyRole, (req: AuthRequest, res) => {
  const parsed = noteSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'Invalid note', statusCode: 400 } });
    return;
  }
  const db = getDb();
  const row = db.prepare(`SELECT id FROM cases WHERE id = ?`).get(req.params.id) as { id: string } | undefined;
  if (!row) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Case not found', statusCode: 404 } });
    return;
  }
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(`INSERT INTO case_notes (id, case_id, user_id, content, is_private, attachments_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, '[]', ?, ?)`)
    .run(id, req.params.id, req.user!.sub, parsed.data.content, parsed.data.isPrivate ? 1 : 0, now, now);

  addTimelineEvent({ caseId: req.params.id, type: 'note_added', title: 'Officer note added', userId: req.user!.sub, metadata: { noteId: id } });
  appendChainRecord({ caseId: req.params.id, eventType: 'note_added', actorId: req.user!.sub, actorRole: req.user!.role, payload: { noteId: id } });

  res.status(201).json({ success: true, data: { id } });
});

// TIMELINE — per-case activity log
router.get('/:id/timeline', requireAnyRole, (req, res) => {
  const db = getDb();
  const exists = db.prepare(`SELECT id FROM cases WHERE id = ?`).get(req.params.id);
  if (!exists) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Case not found', statusCode: 404 } });
    return;
  }
  const events = db.prepare(`SELECT * FROM timeline_events WHERE case_id = ? ORDER BY created_at DESC LIMIT 200`).all(req.params.id);
  res.json({ success: true, data: events });
});

// CHAIN + VERIFY
router.get('/:id/chain', requireAnyRole, (req, res) => {
  const db = getDb();
  const rows = db.prepare(`SELECT id, seq, event_type, actor_id, actor_role, payload_json, prev_hash, record_hash, created_at FROM chain_records WHERE case_id = ? ORDER BY seq ASC`).all(req.params.id);
  res.json({ success: true, data: rows });
});

router.post('/:id/verify', requireAnyRole, (req, res) => {
  const result = verifyChain(req.params.id);
  res.json({ success: true, data: result });
});

// CLOSE-REQUEST — officer/admin; creates pending two-person approval
router.post('/:id/close-request', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'Close reason required (min 5 chars)', statusCode: 400 } });
    return;
  }
  const db = getDb();
  const row = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Case not found', statusCode: 404 } });
    return;
  }
  if (row.status === 'closed') {
    res.status(409).json({ success: false, error: { code: 'ALREADY_CLOSED', message: 'Case already closed', statusCode: 409 } });
    return;
  }
  const pending = db.prepare(`SELECT id FROM approvals WHERE case_id = ? AND action = 'close_case' AND status = 'pending'`).get(req.params.id);
  if (pending) {
    res.status(409).json({ success: false, error: { code: 'PENDING_EXISTS', message: 'A close approval is already pending — a second officer must decide it', statusCode: 409 } });
    return;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO approvals (id, case_id, entity_id, action, reason, requested_by, status, payload_json, created_at) VALUES (?, ?, NULL, 'close_case', ?, ?, 'pending', '{}', ?)`)
    .run(id, req.params.id, parsed.data.reason, req.user!.sub, now);

  addTimelineEvent({ caseId: req.params.id, type: 'status_changed', title: 'Close requested — awaiting second approval', description: parsed.data.reason, userId: req.user!.sub });
  appendChainRecord({ caseId: req.params.id, eventType: 'approval_requested', actorId: req.user!.sub, actorRole: req.user!.role, payload: { approvalId: id, action: 'close_case' } });

  res.status(201).json({ success: true, data: { approvalId: id, message: 'Close requested. A different officer/admin must approve.' } });
});

// REOPEN-REQUEST — officer/admin
router.post('/:id/reopen-request', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const parsed = reasonSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'Reopen reason required', statusCode: 400 } });
    return;
  }
  const db = getDb();
  const row = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Case not found', statusCode: 404 } });
    return;
  }
  if (row.status !== 'closed') {
    res.status(409).json({ success: false, error: { code: 'NOT_CLOSED', message: 'Only closed cases can be reopened', statusCode: 409 } });
    return;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO approvals (id, case_id, entity_id, action, reason, requested_by, status, payload_json, created_at) VALUES (?, ?, NULL, 'reopen_case', ?, ?, 'pending', '{}', ?)`)
    .run(id, req.params.id, parsed.data.reason, req.user!.sub, now);

  appendChainRecord({ caseId: req.params.id, eventType: 'approval_requested', actorId: req.user!.sub, actorRole: req.user!.role, payload: { approvalId: id, action: 'reopen_case' } });
  res.status(201).json({ success: true, data: { approvalId: id } });
});

export default router;
