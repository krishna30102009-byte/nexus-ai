import { Router } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { requireOfficerOrAdmin, requireAnyRole } from '../middleware/rbac.js';
import { appendChainRecord } from '../services/chain.js';
import { addTimelineEvent } from '../services/timeline.js';

const router = Router();
router.use(requireAuth);

const REL_TYPES = [
  'calls', 'messaged', 'met_with', 'transferred_to', 'transferred_from',
  'owns', 'registered_at', 'works_for', 'associated_with', 'family_of',
  'co_located', 'shared_device', 'shared_ip', 'crypto_transfer',
  'email_contact', 'social_media', 'witness', 'suspect_of',
] as const;

const createRelSchema = z.object({
  sourceEntityId: z.string().uuid(),
  targetEntityId: z.string().uuid(),
  type: z.enum(REL_TYPES),
  strength: z.number().int().min(0).max(100).default(50),
  confidence: z.number().int().min(0).max(100).default(50),
  caseId: z.string().uuid(),
  evidenceIds: z.array(z.string()).max(50).default([]),
}).refine((o) => o.sourceEntityId !== o.targetEntityId, { message: 'Self-links not allowed' });

// CREATE — officer/admin; timeline relationship_found + chain data_edited
router.post('/', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const parsed = createRelSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'Invalid relationship', details: parsed.error.flatten(), statusCode: 400 } });
    return;
  }
  const db = getDb();
  const d = parsed.data;
  const s = db.prepare(`SELECT id FROM entities WHERE id = ? AND is_active = 1`).get(d.sourceEntityId);
  const t = db.prepare(`SELECT id FROM entities WHERE id = ? AND is_active = 1`).get(d.targetEntityId);
  if (!s || !t) {
    res.status(404).json({ success: false, error: { code: 'ENTITY_NOT_FOUND', message: 'Both entities must exist and be active', statusCode: 404 } });
    return;
  }
  const c = db.prepare(`SELECT id FROM cases WHERE id = ?`).get(d.caseId);
  if (!c) {
    res.status(404).json({ success: false, error: { code: 'CASE_NOT_FOUND', message: 'Case not found', statusCode: 404 } });
    return;
  }

  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO relationships (id, source_entity_id, target_entity_id, type, strength, confidence, evidence_ids_json, first_observed, last_observed, is_active, metadata_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, '{}', ?, ?)`
  ).run(id, d.sourceEntityId, d.targetEntityId, d.type, d.strength, d.confidence, JSON.stringify(d.evidenceIds), now, now, now, now);

  addTimelineEvent({ caseId: d.caseId, type: 'relationship_found', title: `Link: ${d.type} (${d.strength}%)`, userId: req.user!.sub, entityIds: [d.sourceEntityId, d.targetEntityId] });
  appendChainRecord({ caseId: d.caseId, eventType: 'data_edited', actorId: req.user!.sub, actorRole: req.user!.role, payload: { relationshipId: id, type: d.type, source: d.sourceEntityId, target: d.targetEntityId } });

  res.status(201).json({ success: true, data: { id } });
});

// LIST — ?entityId=&caseId=
router.get('/', requireAnyRole, (req, res) => {
  const db = getDb();
  const entityId = typeof req.query.entityId === 'string' ? req.query.entityId : undefined;
  const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : undefined;

  let rows = db.prepare(`SELECT * FROM relationships WHERE is_active = 1 ORDER BY created_at DESC LIMIT 500`).all() as any[];
  if (entityId) rows = rows.filter((r) => r.source_entity_id === entityId || r.target_entity_id === entityId);
  if (caseId) {
    const c = db.prepare(`SELECT entity_ids_json FROM cases WHERE id = ?`).get(caseId) as { entity_ids_json: string } | undefined;
    let ids: string[] = [];
    try { ids = JSON.parse(c?.entity_ids_json || '[]'); } catch { ids = []; }
    const set = new Set(ids);
    rows = rows.filter((r) => set.has(r.source_entity_id) && set.has(r.target_entity_id));
  }
  res.json({ success: true, data: rows });
});

// DELETE — officer/admin (soft-delete + chain)
router.delete('/:id', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const db = getDb();
  const rel = db.prepare(`SELECT * FROM relationships WHERE id = ? AND is_active = 1`).get(req.params.id) as any;
  if (!rel) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Relationship not found', statusCode: 404 } });
    return;
  }
  const caseId = typeof req.query.caseId === 'string' ? req.query.caseId : null;
  db.prepare(`UPDATE relationships SET is_active = 0, updated_at = ? WHERE id = ?`).run(new Date().toISOString(), req.params.id);
  if (caseId) appendChainRecord({ caseId, eventType: 'data_edited', actorId: req.user!.sub, actorRole: req.user!.role, payload: { relationshipDeleted: req.params.id } });
  else appendChainRecord({ caseId: null, eventType: 'data_edited', actorId: req.user!.sub, actorRole: req.user!.role, payload: { relationshipDeleted: req.params.id } });
  res.json({ success: true, data: { id: req.params.id, deleted: true } });
});

export default router;
