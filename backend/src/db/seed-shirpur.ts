/**
 * Content seed: Shirpur Event Storage Robbery Case (+ full entity network).
 * Idempotent — safe to re-run and safe to run on every boot
 * (skips existing case/entities/relationships by FIR / identity / pair).
 *
 * Website already switches all panels per selected case (live.js) —
 * this only adds content, no layout/structure change.
 */
import { randomUUID } from 'node:crypto';
import { getDb, closeDb } from './connection.js';
import {
  requirePrimaryIdentifier,
  resolveIdentities,
  findDuplicate,
  attachIdentities,
  type IdentifierInput,
} from '../services/identities.js';
import { explainRisk } from '../services/risk.js';
import { appendChainRecord } from '../services/chain.js';
import { addTimelineEvent } from '../services/timeline.js';

interface EntityDef {
  name: string;
  type: 'person' | 'location' | 'device' | 'vehicle';
  phone: string;
  criminal?: string;
  background: string;
  lastKnownLocation: string;
  centrality: number;
  repeatPatterns: number;
  recentActivityDays: number;
  tags: string[];
}

const ENTITIES: EntityDef[] = [
  // ---- 6 persons (P01–P06) ----
  { name: 'Pratik Patil', type: 'person', phone: '+917501000112', criminal: 'CR-SHP-2026-007', background: 'P01 · Event volunteer. Had storage-room access during the college celebration; seen near Karwand Naka on event day.', lastKnownLocation: 'Amalner', centrality: 0.7, repeatPatterns: 2, recentActivityDays: 1, tags: ['suspect', 'P01', 'volunteer'] },
  { name: 'Harshal Patil', type: 'person', phone: '+917501000107', background: 'P02 · Seen with Pratik Patil near Karwand Naka on event day. Uses Mobile 15.', lastKnownLocation: 'Karwand Naka, Shirpur', centrality: 0.55, repeatPatterns: 1, recentActivityDays: 2, tags: ['suspect', 'P02'] },
  { name: 'Krishna Patil', type: 'person', phone: '+917501000108', background: 'P03 · Part of the volunteer circle. Uses Mobile T4X.', lastKnownLocation: 'Shirpur town', centrality: 0.35, repeatPatterns: 0, recentActivityDays: 4, tags: ['suspect', 'P03'] },
  { name: 'Nikita Patil', type: 'person', phone: '+917501000110', background: 'P04 · Met Durgesh Wagh near the venue. Uses Mobile P4 5G.', lastKnownLocation: 'Bhadgaon', centrality: 0.3, repeatPatterns: 0, recentActivityDays: 5, tags: ['suspect', 'P04'] },
  { name: 'Nayan Patil', type: 'person', phone: '+917501000109', background: 'P05 · Exchanged calls with Krishna Patil during the event window. Uses iPhone XS.', lastKnownLocation: 'Shirpur town', centrality: 0.3, repeatPatterns: 0, recentActivityDays: 5, tags: ['suspect', 'P05'] },
  { name: 'Durgesh Wagh', type: 'person', phone: '+917501000111', background: 'P06 · Contact of Pratik Patil. Uses a Lava handset; seen at Karwand Naka on event night.', lastKnownLocation: 'Karwand Naka, Shirpur', centrality: 0.6, repeatPatterns: 2, recentActivityDays: 1, tags: ['suspect', 'P06'] },
  // ---- 5 places ----
  { name: 'Bhadgaon', type: 'location', phone: '+917502000103', background: 'Village linked to Nikita Patil movements.', lastKnownLocation: 'Near Shirpur', centrality: 0.3, repeatPatterns: 0, recentActivityDays: 6, tags: ['place', 'village'] },
  { name: 'Shirpur', type: 'location', phone: '+917502000102', background: 'Town where the college celebration and storage-room theft occurred.', lastKnownLocation: 'Dhule district', centrality: 0.6, repeatPatterns: 1, recentActivityDays: 0, tags: ['place', 'town'] },
  { name: 'Amalner', type: 'location', phone: '+917502000105', background: 'Town linked to Pratik Patil movements before the event.', lastKnownLocation: 'Jalgaon district', centrality: 0.4, repeatPatterns: 1, recentActivityDays: 2, tags: ['place', 'town'] },
  { name: 'Karwand Naka', type: 'location', phone: '+917502000101', background: 'Road junction where Harshal Patil and Durgesh Wagh were sighted.', lastKnownLocation: 'Shirpur', centrality: 0.5, repeatPatterns: 1, recentActivityDays: 1, tags: ['place', 'junction'] },
  { name: 'RCPCOEP', type: 'location', phone: '+917502000104', background: 'College campus (event venue). Storage room with sound equipment and ₹25,000 cash.', lastKnownLocation: 'Shirpur', centrality: 0.85, repeatPatterns: 2, recentActivityDays: 0, tags: ['place', 'venue', 'campus'] },
  // ---- 6 devices (one per person, same order) ----
  { name: 'Mobile Y-29', type: 'device', phone: '867290000000101', background: 'Handset used by Pratik Patil (P01).', lastKnownLocation: 'Amalner', centrality: 0.7, repeatPatterns: 2, recentActivityDays: 1, tags: ['device', 'mobile'] },
  { name: 'Mobile 15', type: 'device', phone: '867290000000107', background: 'Handset used by Harshal Patil (P02).', lastKnownLocation: 'Karwand Naka', centrality: 0.55, repeatPatterns: 1, recentActivityDays: 2, tags: ['device', 'mobile'] },
  { name: 'Mobile T4X', type: 'device', phone: '867290000000102', background: 'Handset used by Krishna Patil (P03).', lastKnownLocation: 'Shirpur town', centrality: 0.5, repeatPatterns: 1, recentActivityDays: 1, tags: ['device', 'mobile'] },
  { name: 'Mobile P4 5G', type: 'device', phone: '867290000000108', background: 'Handset used by Nikita Patil (P04).', lastKnownLocation: 'Bhadgaon', centrality: 0.45, repeatPatterns: 1, recentActivityDays: 2, tags: ['device', 'mobile'] },
  { name: 'iPhone XS', type: 'device', phone: '867290000000109', background: 'Handset used by Nayan Patil (P05).', lastKnownLocation: 'Shirpur town', centrality: 0.35, repeatPatterns: 0, recentActivityDays: 3, tags: ['device', 'mobile'] },
  { name: 'Lava', type: 'device', phone: '867290000000110', background: 'Handset used by Durgesh Wagh (P06).', lastKnownLocation: 'Karwand Naka', centrality: 0.5, repeatPatterns: 1, recentActivityDays: 1, tags: ['device', 'mobile'] },
];

const RELS: Array<[string, string, string, number]> = [
  ['Pratik Patil', 'Harshal Patil', 'associated_with', 70],
  ['Harshal Patil', 'Krishna Patil', 'family_of', 65],
  ['Krishna Patil', 'Nayan Patil', 'associated_with', 55],
  ['Nayan Patil', 'Nikita Patil', 'family_of', 60],
  ['Nikita Patil', 'Durgesh Wagh', 'met_with', 50],
  ['Durgesh Wagh', 'Pratik Patil', 'associated_with', 55],
  ['Pratik Patil', 'Mobile Y-29', 'owns', 90],
  ['Harshal Patil', 'Mobile 15', 'owns', 70],
  ['Krishna Patil', 'Mobile T4X', 'owns', 85],
  ['Nikita Patil', 'Mobile P4 5G', 'owns', 70],
  ['Nayan Patil', 'iPhone XS', 'owns', 65],
  ['Durgesh Wagh', 'Lava', 'owns', 75],
  ['Pratik Patil', 'Amalner', 'co_located', 70],
  ['Pratik Patil', 'RCPCOEP', 'co_located', 85],
  ['Harshal Patil', 'Karwand Naka', 'co_located', 70],
  ['Krishna Patil', 'Shirpur', 'co_located', 70],
  ['Nayan Patil', 'Shirpur', 'co_located', 60],
  ['Nikita Patil', 'Bhadgaon', 'co_located', 60],
  ['Durgesh Wagh', 'Karwand Naka', 'co_located', 65],
  ['Durgesh Wagh', 'RCPCOEP', 'co_located', 80],
];

export function seedShirpur(): void {
  const db = getDb();
  const now = new Date().toISOString();

  const admin = db.prepare(`SELECT id FROM users WHERE email = 'admin@nexus.ai'`).get() as { id: string } | undefined;
  if (!admin) {
    console.log('shirpur seed skipped (no admin — run db:seed first)');
    return;
  }

  // ---- case (idempotent by FIR) ----
  let caseRow = db.prepare(`SELECT * FROM cases WHERE fir_number = 'FIR-SHP-2026-014'`).get() as any;
  let caseId: string;
  if (caseRow) {
    caseId = caseRow.id;
  } else {
    const rows = db.prepare(`SELECT case_number FROM cases WHERE case_number LIKE 'NTF-%'`).all() as Array<{ case_number: string }>;
    let max = 43;
    for (const r of rows) {
      const n = parseInt((r.case_number || '').split('-')[1] || '0', 10);
      if (!isNaN(n) && n > max) max = n;
    }
    const caseNumber = `NTF-${String(max + 1).padStart(3, '0')}`;
    caseId = randomUUID();
    db.prepare(
      `INSERT INTO cases (id, case_number, fir_number, cnr_number, title, description, status, priority, entity_ids_json, document_ids_json, created_at, updated_at, tags_json, created_by)
       VALUES (?, ?, ?, ?, ?, ?, 'active', 'high', '[]', '[]', ?, ?, ?, ?)`
    ).run(
      caseId, caseNumber, 'FIR-SHP-2026-014', 'CNR-SHP-2026-014',
      'Shirpur Event Storage Robbery Case',
      'During a college celebration in Shirpur, sound equipment and ₹25,000 cash were reported missing from the event storage room. Six persons who had access to the event area are under investigation. No physical injury was reported.',
      now, now, JSON.stringify(['Shirpur', 'Theft', 'College Event', 'Cash', 'Equipment', 'Six Suspects']), admin.id
    );
    addTimelineEvent({ caseId, type: 'status_changed', title: `Case ${caseNumber} opened — Shirpur Event Storage Robbery`, userId: admin.id });
    appendChainRecord({ caseId, eventType: 'case_created', actorId: admin.id, actorRole: 'admin', payload: { caseNumber, title: 'Shirpur Event Storage Robbery Case' } });
    console.log(`seeded case ${caseNumber} ${caseId}`);
  }

  // ---- entities (idempotent via identity dedupe) ----
  const idByName = new Map<string, string>();
  for (const e of ENTITIES) {
    const identifiers: IdentifierInput = { phone: e.phone, ...(e.criminal ? { criminal: e.criminal } : {}) };
    try {
      requirePrimaryIdentifier(identifiers);
    } catch (err: any) {
      console.error(`skip ${e.name}: ${err.message}`);
      continue;
    }
    const resolved = resolveIdentities(identifiers);
    const dup = findDuplicate(resolved);
    if (dup) {
      idByName.set(e.name, dup.entityId);
      continue;
    }
    const risk = explainRisk({ centrality: e.centrality, repeatPatterns: e.repeatPatterns, recentActivityDays: e.recentActivityDays });
    const level = risk.score >= 85 ? 'critical' : risk.score >= 75 ? 'high' : risk.score >= 45 ? 'medium' : 'low';
    const id = randomUUID();
    const profile = { background: e.background, lastKnownLocation: e.lastKnownLocation, lastCallRecord: '', vehicles: [], notes: '', riskExplanation: risk };
    db.prepare(
      `INSERT INTO entities (id, type, name, risk_score, risk_level, confidence, data_json, tags_json, source_ids_json, created_by, created_at, updated_at, is_active)
       VALUES (?, ?, ?, ?, ?, 60, ?, ?, '[]', ?, ?, ?, 1)`
    ).run(id, e.type, e.name, risk.score, level, JSON.stringify(profile), JSON.stringify(e.tags), admin.id, now, now);
    attachIdentities(id, resolved);
    idByName.set(e.name, id);
    console.log(`seeded entity: ${e.name} (risk ${risk.score}/${level})`);
  }

  // ---- link all entities to the case ----
  const c = db.prepare(`SELECT entity_ids_json FROM cases WHERE id = ?`).get(caseId) as { entity_ids_json: string };
  let arr: string[] = [];
  try { arr = JSON.parse(c.entity_ids_json || '[]'); } catch { arr = []; }
  for (const id of idByName.values()) if (!arr.includes(id)) arr.push(id);
  db.prepare(`UPDATE cases SET entity_ids_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(arr), now, caseId);

  // ---- relationships (idempotent both directions) ----
  let relCount = 0;
  for (const [a, b, type, strength] of RELS) {
    const s = idByName.get(a);
    const t = idByName.get(b);
    if (!s || !t) continue;
    const exists = db.prepare(
      `SELECT id FROM relationships WHERE type = ? AND ((source_entity_id = ? AND target_entity_id = ?) OR (source_entity_id = ? AND target_entity_id = ?)) AND is_active = 1`
    ).get(type, s, t, t, s) as { id: string } | undefined;
    if (exists) continue;
    db.prepare(
      `INSERT INTO relationships (id, source_entity_id, target_entity_id, type, strength, confidence, evidence_ids_json, first_observed, last_observed, is_active, metadata_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 60, '[]', ?, ?, 1, '{}', ?, ?)`
    ).run(randomUUID(), s, t, type, strength, now, now, now, now);
    relCount++;
  }
  if (relCount) console.log(`seeded ${relCount} new shirpur relationships`);
}

// Standalone: npm run db:seed:shirpur
const invokedAs = (process.argv[1] || '').replace(/\\/g, '/');
if (invokedAs.endsWith('/seed-shirpur.ts') || invokedAs.endsWith('/seed-shirpur.js')) {
  try {
    seedShirpur();
  } finally {
    closeDb();
  }
}
