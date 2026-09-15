import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import health from './routes/health.js';
import auth from './routes/auth.js';
import cases from './routes/cases.js';
import approvals from './routes/approvals.js';
import entities from './routes/entities.js';
import relationships from './routes/relationships.js';
import graph from './routes/graph.js';
import admin from './routes/admin.js';
import certificate from './routes/certificate.js';
import copilot from './routes/copilot.js';
import { auditLog } from './middleware/audit.js';
import { randomUUID } from 'node:crypto';
import { getDb } from './db/connection.js';
import { SCHEMA } from './db/schema.js';
import { hashPassword } from './utils/crypto.js';

// Auto-init schema on boot (idempotent) so fresh deploys/Docker work
// without a manual db:init step.
try {
  getDb().exec(SCHEMA);
} catch (e) {
  console.error('DB init failed:', e);
}

// Auto-seed default logins on fresh databases so a new deploy is
// immediately usable (admin creates real users afterwards).
async function ensureSeedUsers(): Promise<void> {
  try {
    const db = getDb();
    const n = (db.prepare(`SELECT COUNT(*) AS c FROM users`).get() as { c: number }).c;
    if (n > 0) return;
    const now = new Date().toISOString();
    const seed: Array<[string, string, string, string, string, string]> = [
      ['admin@nexus.ai', 'Admin@2026!', 'System Admin', 'admin', 'ADM-001', 'Cyber Cell'],
      ['officer@nexus.ai', 'Officer@2026!', 'Officer K. Rao', 'officer', 'MH-042', 'Crime Branch'],
      ['police@nexus.ai', 'Police@2026!', 'Constable Patil', 'police', 'MH-118', 'Harbor Unit'],
    ];
    for (const [email, pass, name, role, badge, dept] of seed) {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, name, role, badge_number, department, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(randomUUID(), email, await hashPassword(pass), name, role, badge, dept, now, now);
    }
    console.log('seeded default users (admin/officer/police)');
  } catch (e) {
    console.error('user seed failed:', e);
  }
}
void ensureSeedUsers();

const app = express();
const PORT = Number(process.env.PORT || 4000);

app.use(helmet({ contentSecurityPolicy: false })); // Level-2 staging: allow prototype inline handlers
app.use(cors({ origin: (process.env.CORS_ORIGIN || 'http://localhost:5173').split(','), credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('dev'));
app.use(rateLimit({ windowMs: 60_000, max: 200 }));
app.use(auditLog);

app.use('/api', health);
app.use('/api/auth', auth);
app.use('/api/cases', cases);
app.use('/api/approvals', approvals);
app.use('/api/entities', entities);
app.use('/api/relationships', relationships);
app.use('/api/graph', graph);
app.use('/api/admin', admin);
app.use('/api/certificates', certificate);
app.use('/api/copilot', copilot);

// Serve the original NexusAI static frontend (same look, Level-2).
// Only explicit pages + /assets are exposed — backend/src, data, etc. stay private.
const here = path.dirname(fileURLToPath(import.meta.url));
const webRoot = path.resolve(here, '..', '..');
app.get('/', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
app.get('/index.html', (_req, res) => res.sendFile(path.join(webRoot, 'index.html')));
app.get('/dashboard.html', (_req, res) => res.sendFile(path.join(webRoot, 'dashboard.html')));
app.use('/assets', express.static(path.join(webRoot, 'assets')));

// 404 + error handler (no stack leak in prod)
app.use((_req, res) => {
  res.status(404).json({ success: false, error: { code: 'NOT_FOUND', message: 'Route not found', statusCode: 404 } });
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  res.status(err?.status || 500).json({
    success: false,
    error: { code: 'INTERNAL', message: process.env.NODE_ENV === 'production' ? 'Internal error' : String(err?.message || err), statusCode: 500 },
  });
});

app.listen(PORT, () => {
  console.log(`nexus-backend listening on :${PORT}`);
});
