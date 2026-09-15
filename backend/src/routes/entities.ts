import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { requireOfficerOrAdmin, requireAnyRole } from '../middleware/rbac.js';
import { appendChainRecord } from '../services/chain.js';
import { addTimelineEvent } from '../services/timeline.js';
import { explainRisk } from '../services/risk.js';
import {
  requirePrimaryIdentifier, resolveIdentities, findDuplicate,
  attachIdentities, getDisplayIdentities, findLinkedCaseIds,
} from '../services/identities.js';

const router = Router();
router.use(requireAuth);

const ENTITY_TYPES = ['person', 'phone', 'device', 'location', 'vehicle', 'account', 'organization', 'document', 'ip_address', 'email', 'crypto_wallet'] as const;

const identifiersSchema = z.object({
  phone: z.string().max(30).optional(),
  cnr: z.string().max(50).optional(),
  aadhaar: z.string().max(20).optional(),
  fir: z.string().max(50).optional(),
  criminal: z.string().max(50).optional(),
});

const createEntitySchema = z.object({
  type: z.enum(ENTITY_TYPES),
  name: z.string().min(2).max(200),
  caseId: z.string().uuid(),
  // Dossier profile
  background: z.string().max(5000).default(''),
  lastKnownLocation: z.string().max(500).default(''),
  lastCallRecord: z.string().max(500).default(''),
  vehicles: z.array(z.string().max(100)).max(20).default([]),
  notes: z.string().max(5000).default(''),
  // Unique identifiers — at least one of phone/cnr/aadhaar
  identifiers: identifiersSchema,
  // Risk inputs (explainable)
  riskInputs: z.object({
    centrality: z.number().min(0).max(1).optional(),
    repeatPatterns: z.number().int().min(0).max(100).optional(),
    linkedCases: z.number().int().min(0).max(100).optional(),
    financialFlags: z.number().int().min(0).max(100).optional(),
    recentActivityDays: z.number().int().min(0).max(3650).optional(),
  }).default({}),
  tags: z.array(z.string().max(40)).max(20).default([]),
  confidence: z.number().int().min(0).max(100).default(50),
});

function rowToEntity(row: any): any {
  let data: any = {};
  try { data = JSON.parse(row.data_json || '{}'); } catch { data = {}; }
  return {
    id: row.id, type: row.type, name: row.name,
    riskScore: row.risk_score, riskLevel: row.risk_level, confidence: row.confidence,
    tags: JSON.parse(row.tags_json || '[]'),
    sourceIds: JSON.parse(row.source_ids_json || '[]'),
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
    isActive: !!row.is_active,
    profile: data,
  };
}

function linkEntityToCase(caseId: string, entityId: string): void {
  const db = getDb();
  const c = db.prepare(`SELECT entity_ids_json FROM cases WHERE id = ?`).get(caseId) as { entity_ids_json: string } | undefined;
  if (!c) return;
  let arr: string[] = [];
  try { arr = JSON.parse(c.entity_ids_json || '[]'); } catch { arr = []; }
  if (!arr.includes(entityId)) {
    arr.push(entityId);
    db.prepare(`UPDATE cases SET entity_ids_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(arr), new Date().toISOString(), caseId);
  }
}

// CREATE — officer/admin, dedupe by phone > CNR > Aadhaar
router.post('/', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const parsed = createEntitySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'Invalid entity payload', details: parsed.error.flatten(), statusCode: 400 } });
    return;
  }
  const db = getDb();
  const d = parsed.data;

  const caseRow = db.prepare(`SELECT id, status FROM cases WHERE id = ?`).get(d.caseId) as { id: string; status: string } | undefined;
  if (!caseRow) {
    res.status(404).json({ success: false, error: { code: 'CASE_NOT_FOUND', message: 'Case not found', statusCode: 404 } });
    return;
  }
  if (caseRow.status === 'closed') {
    res.status(409).json({ success: false, error: { code: 'CASE_CLOSED', message: 'Cannot add entities to a closed case', statusCode: 409 } });
    return;
  }

  try {
    requirePrimaryIdentifier(d.identifiers);
  } catch (e: any) {
    res.status(e.status || 400).json({ success: false, error: { code: e.code || 'ID_REQUIRED', message: e.message, statusCode: e.status || 400 } });
    return;
  }

  let resolved;
  try {
    resolved = resolveIdentities(d.identifiers);
  } catch (e: any) {
    res.status(e.status || 400).json({ success: false, error: { code: e.code || 'BAD_ID', message: e.message, statusCode: e.status || 400 } });
    return;
  }

  const dup = findDuplicate(resolved);
  if (dup) {
    const existing = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(dup.entityId) as any;
    res.status(409).json({
      success: false,
      error: {
        code: 'DUPLICATE_IDENTITY', statusCode: 409,
        message: `Duplicate ${dup.idType} — already linked to entity "${existing?.name || dup.entityId}". Link the existing entity to this case instead of creating a new record.`,
        details: { existingEntityId: dup.entityId, idType: dup.idType },
      },
    });
    return;
  }

  const risk = explainRisk(d.riskInputs);
  const now = new Date().toISOString();
  const id = randomUUID();

  const profile = {
    background: d.background,
    lastKnownLocation: d.lastKnownLocation,
    lastCallRecord: d.lastCallRecord,
    vehicles: d.vehicles,
    notes: d.notes,
    riskExplanation: risk,
  };

  try {
    db.prepare(
      `INSERT INTO entities (id, type, name, risk_score, risk_level, confidence, data_json, tags_json, source_ids_json, created_by, created_at, updated_at, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`
    ).run(id, d.type, d.name, risk.score, risk.level === 'high' ? 'high' : risk.level === 'medium' ? 'medium' : 'low', d.confidence, JSON.stringify(profile), JSON.stringify(d.tags), JSON.stringify(d.identifiers.fir ? [d.identifiers.fir] : []), req.user!.sub, now, now);
    attachIdentities(id, resolved);
  } catch (e: any) {
    if (String(e?.message || '').includes('UNIQUE')) {
      res.status(409).json({ success: false, error: { code: 'DUPLICATE_IDENTITY', message: 'Identifier already exists (race). Link existing entity instead.', statusCode: 409 } });
      return;
    }
    throw e;
  }

  linkEntityToCase(d.caseId, id);
  addTimelineEvent({ caseId: d.caseId, type: 'entity_added', title: `Entity added: ${d.name}`, userId: req.user!.sub, entityIds: [id], metadata: { riskScore: risk.score } });
  appendChainRecord({ caseId: d.caseId, eventType: 'entity_added', actorId: req.user!.sub, actorRole: req.user!.role, payload: { entityId: id, name: d.name, risk } });

  const row = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(id);
  res.status(201).json({ success: true, data: { ...rowToEntity(row), identifiers: getDisplayIdentities(id, req.user!.role), linkedCaseIds: findLinkedCaseIds(id) } });
});

// LIST — ?caseId=&q=&type=&page=&limit=
router.get('/', requireAnyRole, (req, res) => {
  const db = getDb();
  const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  const type = typeof req.query.type === 'string' ? req.query.type : undefined;
  const page = Math.max(1, parseInt(String(req.query.page || '1'), 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(String(req.query.limit || '20'), 10) || 20));

  let rows = db.prepare(`SELECT * FROM entities WHERE is_active = 1 ORDER BY updated_at DESC LIMIT 500`).all() as any[];
  if (type) rows = rows.filter((r) => r.type === type);
  if (q) {
    const lq = q.toLowerCase();
    rows = rows.filter((r) => r.name.toLowerCase().includes(lq) || (r.data_json || '').toLowerCase().includes(lq));
  }
  if (caseId) {
    const c = db.prepare(`SELECT entity_ids_json FROM cases WHERE id = ?`).get(caseId) as { entity_ids_json: string } | undefined;
    let ids: string[] = [];
    try { ids = JSON.parse(c?.entity_ids_json || '[]'); } catch { ids = []; }
    rows = rows.filter((r) => ids.includes(r.id));
  }
  const total = rows.length;
  const page_rows = rows.slice((page - 1) * limit, page * limit).map(rowToEntity);
  res.json({ success: true, data: page_rows, meta: { timestamp: new Date().toISOString(), requestId: randomUUID(), version: '2.0', pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } } });
});

// DETAIL — identifiers shown clearly; Aadhaar masked for police
router.get('/:id', requireAnyRole, (req: AuthRequest, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM entities WHERE id = ? AND is_active = 1`).get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entity not found', statusCode: 404 } });
    return;
  }
  const identifiers = getDisplayIdentities(row.id, req.user!.role);
  const linkedCaseIds = findLinkedCaseIds(row.id);
  const linkedCases = linkedCaseIds.length
    ? db.prepare(`SELECT id, case_number, title, status FROM cases WHERE id IN (${linkedCaseIds.map(() => '?').join(',')})`).all(...linkedCaseIds)
    : [];
  const chainCount = (db.prepare(`SELECT COUNT(*) AS c FROM chain_records WHERE payload_json LIKE ?`).get(`%${row.id}%`) as { c: number }).c;
  res.json({ success: true, data: { ...rowToEntity(row), identifiers, linkedCaseIds, linkedCases, crossCase: linkedCaseIds.length > 1, chainCount } });
});

// UPDATE — officer/admin
router.patch('/:id', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const schema = z.object({
    name: z.string().min(2).max(200).optional(),
    background: z.string().max(5000).optional(),
    lastKnownLocation: z.string().max(500).optional(),
    lastCallRecord: z.string().max(500).optional(),
    vehicles: z.array(z.string().max(100)).max(20).optional(),
    notes: z.string().max(5000).optional(),
    tags: z.array(z.string().max(40)).max(20).optional(),
    caseId: z.string().uuid().optional(), // for chain attribution
  }).refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update' });
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'Invalid update', details: parsed.error.flatten(), statusCode: 400 } });
    return;
  }
  const db = getDb();
  const row = db.prepare(`SELECT * FROM entities WHERE id = ? AND is_active = 1`).get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entity not found', statusCode: 404 } });
    return;
  }
  const d = parsed.data;
  let profile: any = {};
  try { profile = JSON.parse(row.data_json || '{}'); } catch { profile = {}; }
  if (d.background !== undefined) profile.background = d.background;
  if (d.lastKnownLocation !== undefined) profile.lastKnownLocation = d.lastKnownLocation;
  if (d.lastCallRecord !== undefined) profile.lastCallRecord = d.lastCallRecord;
  if (d.vehicles !== undefined) profile.vehicles = d.vehicles;
  if (d.notes !== undefined) profile.notes = d.notes;

  db.prepare(`UPDATE entities SET name = COALESCE(?, name), data_json = ?, tags_json = COALESCE(?, tags_json), updated_at = ? WHERE id = ?`)
    .run(d.name ?? null, JSON.stringify(profile), d.tags ? JSON.stringify(d.tags) : null, new Date().toISOString(), req.params.id);

  if (d.caseId) {
    addTimelineEvent({ caseId: d.caseId, type: 'entity_added', title: `Entity updated: ${d.name || row.name}`, userId: req.user!.sub, entityIds: [req.params.id] });
    appendChainRecord({ caseId: d.caseId, eventType: 'entity_updated', actorId: req.user!.sub, actorRole: req.user!.role, payload: { entityId: req.params.id, fields: Object.keys(d) } });
  } else {
    appendChainRecord({ caseId: null, eventType: 'entity_updated', actorId: req.user!.sub, actorRole: req.user!.role, payload: { entityId: req.params.id, fields: Object.keys(d) } });
  }

  const updated = db.prepare(`SELECT * FROM entities WHERE id = ?`).get(req.params.id);
  res.json({ success: true, data: { ...rowToEntity(updated), identifiers: getDisplayIdentities(req.params.id, req.user!.role) } });
});

// LINK existing entity to another case (cross-case surfacing)
router.post('/:id/link', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const parsed = z.object({ caseId: z.string().uuid() }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'caseId required', statusCode: 400 } });
    return;
  }
  const db = getDb();
  const ent = db.prepare(`SELECT id, name FROM entities WHERE id = ? AND is_active = 1`).get(req.params.id) as any;
  if (!ent) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entity not found', statusCode: 404 } });
    return;
  }
  const c = db.prepare(`SELECT id, status FROM cases WHERE id = ?`).get(parsed.data.caseId) as any;
  if (!c) {
    res.status(404).json({ success: false, error: { code: 'CASE_NOT_FOUND', message: 'Case not found', statusCode: 404 } });
    return;
  }
  if (c.status === 'closed') {
    res.status(409).json({ success: false, error: { code: 'CASE_CLOSED', message: 'Cannot link to a closed case', statusCode: 409 } });
    return;
  }
  linkEntityToCase(parsed.data.caseId, req.params.id);
  addTimelineEvent({ caseId: parsed.data.caseId, type: 'entity_added', title: `Cross-case link: ${ent.name}`, description: 'Entity already exists in another case — linked, not duplicated', userId: req.user!.sub, entityIds: [req.params.id] });
  appendChainRecord({ caseId: parsed.data.caseId, eventType: 'entity_added', actorId: req.user!.sub, actorRole: req.user!.role, payload: { entityId: req.params.id, crossCaseLink: true } });
  res.json({ success: true, data: { linkedCaseIds: findLinkedCaseIds(req.params.id) } });
});

// RISK — explainable: live centrality + cross-case count overlaid on stored signals
router.get('/:id/risk', requireAnyRole, (req, res) => {
  const db = getDb();
  const row = db.prepare(`SELECT * FROM entities WHERE id = ? AND is_active = 1`).get(req.params.id) as any;
  if (!row) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entity not found', statusCode: 404 } });
    return;
  }
  let stored: any = {};
  try { stored = JSON.parse(row.data_json || '{}'); } catch { stored = {}; }
  const storedExp = stored.riskExplanation as { signals?: Array<{ key: string; detail: string }> } | undefined;

  // live graph signals
  const rels = db.prepare(`SELECT * FROM relationships WHERE is_active = 1 AND (source_entity_id = ? OR target_entity_id = ?)`)
    .all(req.params.id, req.params.id) as any[];
  const degree = rels.length;
  const centrality = Math.min(1, degree / 5);
  const linked = findLinkedCaseIds(req.params.id);
  const linkedCases = Math.max(0, linked.length - 0); // cases touching this entity network

  // carry forward stored repeat/financial/recency counts from explanation text
  const num = (re: RegExp): number => {
    const m = JSON.stringify(storedExp || {}).match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  const fresh = explainRisk({
    centrality,
    linkedCases,
    repeatPatterns: num(/(\d+) repeat modus/) || undefined,
    financialFlags: num(/(\d+) flagged transfer/) || undefined,
    recentActivityDays: 1,
  });

  const indicator = row.risk_score >= 75 ? 'high' : row.risk_score >= 45 ? 'medium' : 'low';
  res.json({
    success: true,
    data: {
      entityId: row.id, name: row.name,
      storedScore: row.risk_score, storedLevel: row.risk_level, indicator,
      liveExplanation: fresh,
      graphSignals: { degree, centrality, linkedCaseCount: linked.length },
      why: fresh.signals,
    },
  });
});

// DELETE-REQUEST — two-person approval (no direct delete)
router.post('/:id/delete-request', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const parsed = z.object({ caseId: z.string().uuid(), reason: z.string().min(5).max(1000) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'caseId + reason required', statusCode: 400 } });
    return;
  }
  const db = getDb();
  const ent = db.prepare(`SELECT id FROM entities WHERE id = ? AND is_active = 1`).get(req.params.id);
  if (!ent) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Entity not found', statusCode: 404 } });
    return;
  }
  const id = randomUUID();
  const now = new Date().toISOString();
  db.prepare(`INSERT INTO approvals (id, case_id, entity_id, action, reason, requested_by, status, payload_json, created_at) VALUES (?, ?, ?, 'delete_entity', ?, ?, 'pending', '{}', ?)`)
    .run(id, parsed.data.caseId, req.params.id, parsed.data.reason, req.user!.sub, now);
  appendChainRecord({ caseId: parsed.data.caseId, eventType: 'approval_requested', actorId: req.user!.sub, actorRole: req.user!.role, payload: { approvalId: id, action: 'delete_entity', entityId: req.params.id } });
  res.status(201).json({ success: true, data: { approvalId: id, message: 'Delete requested. A different officer/admin must approve.' } });
});

export default router;
