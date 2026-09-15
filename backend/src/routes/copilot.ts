import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthRequest } from '../middleware/auth.js';
import { requireAnyRole } from '../middleware/rbac.js';
import { buildContext, answer } from '../services/copilot.js';

const router = Router();
router.use(requireAuth);

const askSchema = z.object({
  question: z.string().min(2).max(1000),
  caseId: z.string().uuid().optional(),
});

// POST /api/copilot/ask — verified-source answers only
router.post('/ask', requireAnyRole, (req: AuthRequest, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ success: false, error: { code: 'BAD_INPUT', message: 'question (2-1000 chars) required', statusCode: 400 } });
    return;
  }
  try {
    const ctx = buildContext(parsed.data.caseId, req.user!.role);
    const result = answer(parsed.data.question, ctx, parsed.data.caseId ?? null);
    res.json({ success: true, data: { question: parsed.data.question, scope: ctx.scope, ...result } });
  } catch (e: any) {
    res.status(e.status || 500).json({ success: false, error: { code: e.code || 'INTERNAL', message: e.message, statusCode: e.status || 500 } });
  }
});

export default router;
