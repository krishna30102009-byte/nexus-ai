import { Router } from 'express';
import { getDb } from '../db/connection.js';
import { requireAuth } from '../middleware/auth.js';
import { requireAnyRole } from '../middleware/rbac.js';
import { buildCaseGraph } from '../services/graph.js';

const router = Router();
router.use(requireAuth);

// GET /api/graph/cases/:caseId — nodes + edges + crossCaseEdges + centrality + density
router.get('/cases/:caseId', requireAnyRole, (req, res) => {
  try {
    const graph = buildCaseGraph(req.params.caseId);
    const db = getDb();
    const caseRow = db.prepare(`SELECT id, case_number, title, status FROM cases WHERE id = ?`).get(req.params.caseId);
    res.json({ success: true, data: { case: caseRow, ...graph, counts: { nodes: graph.nodes.length, edges: graph.edges.length, crossCaseEdges: graph.crossCaseEdges.length } } });
  } catch (e: any) {
    res.status(e.status || 500).json({ success: false, error: { code: e.code || 'INTERNAL', message: e.message, statusCode: e.status || 500 } });
  }
});

export default router;
