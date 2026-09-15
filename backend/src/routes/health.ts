import { Router } from 'express';

const router = Router();

router.get('/health', (_req, res) => {
  res.json({ success: true, data: { status: 'ok', service: 'nexus-backend', time: new Date().toISOString() } });
});

export default router;
