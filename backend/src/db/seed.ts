import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from './connection.js';
import { hashPassword } from '../utils/crypto.js';
import { explainRisk } from '../services/risk.js';
import { resolveIdentities, attachIdentities, findDuplicate } from '../services/identities.js';
import { appendChainRecord } from '../services/chain.js';
import { addTimelineEvent } from '../services/timeline.js';
import { seedShirpur } from './seed-shirpur.js';

async function main(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();

  const users: Array<{ email: string; password: string; name: string; role: 'officer' | 'police' | 'admin'; badge: string; dept: string }> = [
    { email: 'admin@nexus.ai', password: 'Admin@2026!', name: 'System Admin', role: 'admin', badge: 'ADM-001', dept: 'Cyber Cell' },
    { email: 'officer@nexus.ai', password: 'Officer@2026!', name: 'Officer K. Rao', role: 'officer', badge: 'MH-042', dept: 'Crime Branch' },
    { email: 'police@nexus.ai', password: 'Police@2026!', name: 'Constable Patil', role: 'police', badge: 'MH-118', dept: 'Harbor Unit' },
  ];

  for (const u of users) {
    const existing = db.prepare(`SELECT id FROM users WHERE email = ?`).get(u.email) as { id: string } | undefined;
    if (!existing) {
      db.prepare(
        `INSERT INTO users (id, email, password_hash, name, role, badge_number, department, is_active, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
      ).run(randomUUID(), u.email, await hashPassword(u.password), u.name, u.role, u.badge, u.dept, now, now);
      console.log('seeded user', u.email, '/', u.password);
    } else {
      console.log('user exists', u.email);
    }
  }

  // Seed Operation Nightfall case (idempotent by case_number)
  const admin = db.prepare(`SELECT id FROM users WHERE email = 'admin@nexus.ai'`).get() as { id: string };
  const existingCase = db.prepare(`SELECT id FROM cases WHERE case_number = 'NTF-042'`).get() as { id: string } | undefined;
  if (!existingCase && admin) {
    const caseId = randomUUID();
    db.prepare(
      `INSERT INTO cases (id, case_number, fir_number, cnr_number, title, description, status, priority, entity_ids_json, document_ids_json, created_at, updated_at, tags_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 'high', '[]', '[]', ?, ?, ?, ?)`
    ).run(
      caseId, 'NTF-042', 'FIR-MH-2026-0147', 'CNR-MH-0192847',
      'Operation Nightfall', 'Harbor warehouse network — ported from NexusAI prototype mock data.',
      now, now, JSON.stringify(['harbor', 'financial']), admin.id
    );
    console.log('seeded case NTF-042', caseId);
  } else {
    console.log('case NTF-042 exists or no admin');
  }

  await seedDemoIntel();
  seedShirpur();
  closeDb();
}

// Demo intelligence: 6 entities + relationships + 2nd cold case sharing
// Riya (cross-case demo) + chain records so verify/copilot/certificate work.
// Exported so server boot can ensure it on fresh disks (idempotent).
export async function seedDemoIntel(): Promise<void> {
  const db = getDb();
  const now = new Date().toISOString();
  const officer = db.prepare(`SELECT id FROM users WHERE email = 'officer@nexus.ai'`).get() as { id: string } | undefined;
  const admin = db.prepare(`SELECT id FROM users WHERE email = 'admin@nexus.ai'`).get() as { id: string } | undefined;
  if (!officer || !admin) { console.log('demo intel skipped (users missing)'); return; }

  // Self-sufficient: create NTF-042 when missing (fresh disks only get users
  // from boot ensure, so the case row must be created here too).
  let ntf42 = db.prepare(`SELECT id FROM cases WHERE case_number = 'NTF-042'`).get() as { id: string } | undefined;
  if (!ntf42) {
    const caseId = randomUUID();
    db.prepare(
      `INSERT INTO cases (id, case_number, fir_number, cnr_number, title, description, status, priority, entity_ids_json, document_ids_json, created_at, updated_at, tags_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 'high', '[]', '[]', ?, ?, ?, ?)`
    ).run(
      caseId, 'NTF-042', 'FIR-MH-2026-0147', 'CNR-MH-0192847',
      'Operation Nightfall', 'Harbor warehouse network — ported from NexusAI prototype mock data.',
      now, now, JSON.stringify(['harbor', 'financial']), admin.id
    );
    console.log('seeded case NTF-042', caseId);
    ntf42 = { id: caseId };
  }

  const demo = [
    { name: 'Arjun Mehra', type: 'person', ids: { phone: '9818018827', cnr: 'CNR-MH-0192847', aadhaar: '123456789012', fir: 'FIR-MH-2026-0147', criminal: 'CR-MH-2026-0001' }, bg: 'Primary subject. Centrality analysis places him at the intersection of communications, financial movement and location activity.', loc: 'Harbor Warehouse area, Mumbai', call: '42 calls with Riya Shah, night window 02:00-04:00', vehicles: ['DL-8C-4427'], risk: { centrality: 0.94, repeatPatterns: 4, linkedCases: 1, financialFlags: 1, recentActivityDays: 0 } },
    { name: 'Riya Shah', type: 'person', ids: { phone: '9899044518', cnr: 'CNR-MH-0192848', fir: 'FIR-MH-2026-0147', criminal: 'CR-MH-2026-0002' }, bg: 'Associate. Repeated contact with the primary subject within two hours of anomalous transfer events.', loc: 'Andheri West, Mumbai', call: '7 calls to unknown device before transfers', vehicles: [], risk: { centrality: 0.5, repeatPatterns: 2, linkedCases: 2, financialFlags: 1, recentActivityDays: 0 } },
    { name: 'Unknown Device K-19', type: 'device', ids: { phone: '404110190000', fir: 'FIR-MH-2026-0147' }, bg: 'New device appeared within the known communication cluster shortly before a flagged event. IMSI 404-11-190000.', loc: 'Tower dump: Harbor sector', call: 'Night-window bursts, 02:00-04:00', vehicles: [], risk: { centrality: 0.6, repeatPatterns: 1, linkedCases: 0, financialFlags: 0, recentActivityDays: 0 } },
    { name: 'Harbor Warehouse', type: 'location', ids: { phone: '02261004500', fir: 'FIR-MH-2026-0147' }, bg: 'Shared location. Co-location signals show three linked entities present within the same 90-minute period.', loc: 'Harbor Warehouse, Port Trust Rd, Mumbai', call: '-', vehicles: [], risk: { centrality: 0.55, repeatPatterns: 3, linkedCases: 0, financialFlags: 0, recentActivityDays: 1 } },
    { name: 'Account 8821', type: 'account', ids: { phone: '9821008821', fir: 'FIR-MH-2026-0147' }, bg: 'Financial channel. Transfers form a rapid circular pattern across three accounts; human review recommended.', loc: 'Branch: Fort, Mumbai', call: 'Rs 4.8L circular transfer x3 in 14 minutes', vehicles: [], risk: { centrality: 0.7, repeatPatterns: 3, linkedCases: 0, financialFlags: 3, recentActivityDays: 0 } },
    { name: 'Vehicle DL-8C-4427', type: 'vehicle', ids: { phone: '9810044227', fir: 'FIR-MH-2026-0147' }, bg: 'Linked vehicle. Repeated proximity signals near Harbor Warehouse toll, no FASTag.', loc: 'Last ping: Harbor toll', call: '-', vehicles: ['DL-8C-4427'], risk: { centrality: 0.3, repeatPatterns: 1, linkedCases: 0, financialFlags: 0, recentActivityDays: 2 } },
  ] as const;

  const ids: Record<string, string> = {};
  for (const e of demo) {
    const existing = db.prepare(`SELECT id FROM entities WHERE name = ?`).get(e.name) as { id: string } | undefined;
    if (existing) { ids[e.name] = existing.id; console.log('entity exists', e.name); continue; }
    // Person-unique dedupe (phone/CNR/Aadhaar/criminal): reuse, never fork.
    const dupPre = findDuplicate(resolveIdentities(e.ids as any));
    if (dupPre) { ids[e.name] = dupPre.entityId; console.log('entity reuses', e.name, 'via', dupPre.idType); continue; }
    const risk = explainRisk(e.risk as any);
    const level = risk.score >= 85 ? 'critical' : risk.score >= 75 ? 'high' : risk.score >= 45 ? 'medium' : 'low';
    const id = randomUUID();
    const profile = { background: e.bg, lastKnownLocation: e.loc, lastCallRecord: e.call, vehicles: [...e.vehicles], notes: '', riskExplanation: risk };
    db.prepare(`INSERT INTO entities (id, type, name, risk_score, risk_level, confidence, data_json, tags_json, source_ids_json, created_by, created_at, updated_at, is_active) VALUES (?, ?, ?, ?, ?, 90, ?, '[]', ?, ?, ?, ?, 1)`)
      .run(id, e.type, e.name, risk.score, level, JSON.stringify(profile), JSON.stringify((e.ids as any).fir ? [(e.ids as any).fir] : []), officer.id, now, now);
    attachIdentities(id, resolveIdentities(e.ids as any));
    ids[e.name] = id;
    appendChainRecord({ caseId: ntf42.id, eventType: 'entity_added', actorId: officer.id, actorRole: 'officer', payload: { entityId: id, name: e.name, risk } });
    console.log('seeded entity', e.name, 'risk', risk.score);
  }

  // link all to NTF-042
  const c42 = db.prepare(`SELECT entity_ids_json FROM cases WHERE id = ?`).get(ntf42.id) as { entity_ids_json: string };
  let arr: string[] = [];
  try { arr = JSON.parse(c42.entity_ids_json || '[]'); } catch { arr = []; }
  for (const v of Object.values(ids)) if (!arr.includes(v)) arr.push(v);
  db.prepare(`UPDATE cases SET entity_ids_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(arr), now, ntf42.id);

  // relationships
  const rels = [
    ['Arjun Mehra', 'Riya Shah', 'calls', 85, 90],
    ['Arjun Mehra', 'Unknown Device K-19', 'shared_device', 70, 80],
    ['Riya Shah', 'Account 8821', 'transferred_to', 90, 96],
    ['Unknown Device K-19', 'Account 8821', 'associated_with', 60, 70],
    ['Arjun Mehra', 'Harbor Warehouse', 'co_located', 75, 84],
    ['Riya Shah', 'Harbor Warehouse', 'co_located', 70, 79],
    ['Vehicle DL-8C-4427', 'Harbor Warehouse', 'co_located', 55, 68],
  ] as const;
  for (const [s, t, type, strength, conf] of rels) {
    const ex = db.prepare(`SELECT id FROM relationships WHERE source_entity_id = ? AND target_entity_id = ? AND type = ?`).get(ids[s], ids[t], type);
    if (!ex) {
      db.prepare(`INSERT INTO relationships (id, source_entity_id, target_entity_id, type, strength, confidence, evidence_ids_json, first_observed, last_observed, is_active, metadata_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, '[]', ?, ?, 1, '{}', ?, ?)`)
        .run(randomUUID(), ids[s], ids[t], type, strength, conf, now, now, now, now);
      console.log('seeded rel', s, '->', t);
    }
  }

  // 2nd cold case sharing Riya (cross-case demo)
  let ntf43 = db.prepare(`SELECT id FROM cases WHERE case_number = 'NTF-043'`).get() as { id: string } | undefined;
  if (!ntf43) {
    const cid = randomUUID();
    db.prepare(`INSERT INTO cases (id, case_number, fir_number, cnr_number, title, description, status, priority, entity_ids_json, document_ids_json, created_at, updated_at, tags_json, created_by) VALUES (?, ?, ?, ?, ?, ?, 'cold', 'medium', ?, '[]', ?, ?, ?, ?)`)
      .run(cid, 'NTF-043', 'FIR-MH-2025-0891', 'CNR-MH-0188771', 'Operation Cold Trail', 'Old harbor extortion trail. Shares an entity with Nightfall — check cross-case links.', JSON.stringify([ids['Riya Shah']]), now, now, JSON.stringify(['harbor']), admin.id);
    appendChainRecord({ caseId: cid, eventType: 'case_created', actorId: admin.id, actorRole: 'admin', payload: { caseNumber: 'NTF-043', title: 'Operation Cold Trail' } });
    addTimelineEvent({ caseId: cid, type: 'status_changed', title: 'Case NTF-043 marked cold', userId: admin.id });
    console.log('seeded case NTF-043', cid);
  } else {
    console.log('case NTF-043 exists');
  }

  // timeline for NTF-042
  const tl = db.prepare(`SELECT COUNT(*) AS c FROM timeline_events WHERE case_id = ?`).get(ntf42.id) as { c: number };
  if (!tl.c) {
    addTimelineEvent({ caseId: ntf42.id, type: 'entity_added', title: 'New CDR link: Arjun Mehra <-> Device K-19', userId: officer.id, entityIds: [ids['Arjun Mehra']] });
    addTimelineEvent({ caseId: ntf42.id, type: 'alert_triggered', title: 'Rs 4.8L circular transfer via Account 8821 flagged', userId: officer.id, entityIds: [ids['Account 8821']] });
    addTimelineEvent({ caseId: ntf42.id, type: 'entity_added', title: 'Shared presence: Arjun + Riya + Vehicle at Harbor Warehouse', userId: officer.id });
    console.log('seeded timeline NTF-042');
  }
}

// Only auto-run when invoked directly (`npm run db:seed`).
// Importing this module (e.g. server boot ensure) must NOT seed by itself.
const invokedAsSeed = (process.argv[1] || '').replace(/\\/g, '/');
if (invokedAsSeed.endsWith('/seed.ts')) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
