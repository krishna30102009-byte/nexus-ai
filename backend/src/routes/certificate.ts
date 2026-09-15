import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { requireOfficerOrAdmin } from '../middleware/rbac.js';
import { verifyChain, appendChainRecord } from '../services/chain.js';
import { buildCertificatePdf } from '../services/certificate.js';

const router = Router();
router.use(requireAuth);

// GET /api/certificates/cases/:caseId — Integrity Certificate PDF (Sec 65B framing)
router.get('/cases/:caseId', requireOfficerOrAdmin, (req: AuthRequest, res) => {
  const db = getDb();
  const caseRow = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(req.params.caseId) as any;
  if (!caseRow) {
    res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Case not found', statusCode: 404 } });
    return;
  }
  const chain = db.prepare(`SELECT * FROM chain_records WHERE case_id = ? ORDER BY seq ASC`).all(req.params.caseId);
  const timeline = db.prepare(`SELECT * FROM timeline_events WHERE case_id = ? ORDER BY created_at ASC LIMIT 500`).all(req.params.caseId);
  // officer actions touching this case: chain actors + timeline users + http audit hits on the case path
  const audit = db.prepare(`SELECT * FROM audit_logs WHERE resource_id LIKE ? OR details_json LIKE ? ORDER BY timestamp DESC LIMIT 200`)
    .all(`%${req.params.caseId}%`, `%${req.params.caseId}%`);
  const verification = verifyChain(req.params.caseId);
  const me = db.prepare(`SELECT id, name, email, role FROM users WHERE id = ?`).get(req.user!.sub) as any;

  const generatedAt = new Date().toISOString();
  appendChainRecord({
    caseId: req.params.caseId, eventType: 'report_generated',
    actorId: req.user!.sub, actorRole: req.user!.role,
    payload: { kind: 'integrity_certificate', verificationOk: verification.ok, checked: verification.checked },
  });

  buildCertificatePdf({ case: caseRow, chain, timeline, audit, verification, generatedBy: me, generatedAt })
    .then((pdf) => {
      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `attachment; filename="Integrity-Certificate-${caseRow.case_number}.pdf"`);
      res.setHeader('X-Chain-Verified', verification.ok ? 'true' : 'false');
      res.send(Buffer.from(pdf));
    })
    .catch((e) => {
      res.status(500).json({ success: false, error: { code: 'PDF_FAIL', message: String(e?.message || e), statusCode: 500 } });
    });
});

export default router;
