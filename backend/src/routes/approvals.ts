import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db/connection.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { requireOfficerOrAdmin, requireAnyRole } from '../middleware/rbac.js';
import { appendChainRecord } from '../services/chain.js';
import { addTimelineEvent } from '../services/timeline.js';

const router = Router();
router.use(requireAuth);

const decideSchema = z.object({
  decision: z.enum(['approved', 'rejected']),
});

// LIST — any role can view; ?status=pending filter
router.get('/', requireAnyRole, (req, res) => {
  const db = getDb();
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const rows = status
    ? db.prepare(`SELECT * FROM approvals WHERE status = ? ORDER BY created_at DESC LIMIT 100`).all(status)
    : db.prepare(`SELECT * FROM approvals ORDER BY created_at DESC LIMIT 100`).all();
  res.json({ success: true, data: rows });
});

// DECIDE — officer/admin, must NOT be the requester (two-person rule)
router.post('/:id/decide', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const parsed = decideSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'decision must be approved|rejected', statusCode: 400 } });
    return;
  }
  const db = getDb();
  const ap = db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(req.params.id) as any;
  if (!ap) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Approval not found', statusCode: 404 } });
    return;
  }
  if (ap.status !== 'pending') {
    res.status(409).json({ success: false, error: { code: 'ALREADY_DECIDED', message: `Already ${ap.status}`, statusCode: 409 } });
    return;
  }
  if (ap.requested_by === req.user!.sub) {
    res.status(403).json({ success: false, error: { code: 'SELF_APPROVAL', message: 'Two-person rule: requester cannot approve their own request', statusCode: 403 } });
    return;
  }

  const now = new Date().toISOString();
  const newStatus = parsed.data.decision === 'approved' ? 'approved' : 'rejected';
  db.prepare(`UPDATE approvals SET status = ?, approved_by = ?, decided_at = ? WHERE id = ?`).run(newStatus, req.user!.sub, now, ap.id);

  if (ap.case_id) {
    if (parsed.data.decision === 'approved' && ap.action === 'close_case') {
      db.prepare(`UPDATE cases SET status = 'closed', closed_at = ?, updated_at = ? WHERE id = ?`).run(now, now, ap.case_id);
      addTimelineEvent({ caseId: ap.case_id, type: 'status_changed', title: 'Case CLOSED (two-person approval)', description: ap.reason, userId: req.user!.sub });
      appendChainRecord({ caseId: ap.case_id, eventType: 'approval_granted', actorId: req.user!.sub, actorRole: req.user!.role, payload: { approvalId: ap.id, action: ap.action } });
      appendChainRecord({ caseId: ap.case_id, eventType: 'case_closed', actorId: req.user!.sub, actorRole: req.user!.role, payload: { approvalId: ap.id } });
    } else if (parsed.data.decision === 'approved' && ap.action === 'reopen_case') {
      db.prepare(`UPDATE cases SET status = 'open', closed_at = NULL, updated_at = ? WHERE id = ?`).run(now, ap.case_id);
      addTimelineEvent({ caseId: ap.case_id, type: 'status_changed', title: 'Case REOPENED (two-person approval)', description: ap.reason, userId: req.user!.sub });
      appendChainRecord({ caseId: ap.case_id, eventType: 'approval_granted', actorId: req.user!.sub, actorRole: req.user!.role, payload: { approvalId: ap.id, action: ap.action } });
      appendChainRecord({ caseId: ap.case_id, eventType: 'case_reopened', actorId: req.user!.sub, actorRole: req.user!.role, payload: { approvalId: ap.id } });
    } else if (parsed.data.decision === 'approved' && ap.action === 'delete_entity' && ap.entity_id) {
      db.prepare(`UPDATE entities SET is_active = 0, updated_at = ? WHERE id = ?`).run(now, ap.entity_id);
      try {
        const c = db.prepare(`SELECT entity_ids_json FROM cases WHERE id = ?`).get(ap.case_id) as { entity_ids_json: string } | undefined;
        if (c) {
          const arr = (JSON.parse(c.entity_ids_json || '[]') as string[]).filter((e) => e !== ap.entity_id);
          db.prepare(`UPDATE cases SET entity_ids_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(arr), now, ap.case_id);
        }
      } catch { /* ignore */ }
      addTimelineEvent({ caseId: ap.case_id, type: 'entity_added', title: 'Entity removed (two-person approval)', description: ap.reason, userId: req.user!.sub, entityIds: [ap.entity_id] });
      appendChainRecord({ caseId: ap.case_id, eventType: 'approval_granted', actorId: req.user!.sub, actorRole: req.user!.role, payload: { approvalId: ap.id, action: ap.action, entityId: ap.entity_id } });
      appendChainRecord({ caseId: ap.case_id, eventType: 'entity_deleted', actorId: req.user!.sub, actorRole: req.user!.role, payload: { approvalId: ap.id, entityId: ap.entity_id } });
    } else {
      appendChainRecord({ caseId: ap.case_id, eventType: 'approval_rejected', actorId: req.user!.sub, actorRole: req.user!.role, payload: { approvalId: ap.id, action: ap.action } });
      addTimelineEvent({ caseId: ap.case_id, type: 'status_changed', title: `Approval ${newStatus}: ${ap.action}`, description: ap.reason, userId: req.user!.sub });
    }
  }

  const updated = db.prepare(`SELECT * FROM approvals WHERE id = ?`).get(ap.id);
  res.json({ success: true, data: updated });
});

export default router;
