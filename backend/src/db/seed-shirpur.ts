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
  // ---- 6 suspects (S01–S06) ----
  { name: 'Amit Patil', type: 'person', phone: '+917501000101', criminal: 'CR-SHP-2026-001', background: 'S01 · Event volunteer. Had storage-room access during the college celebration; helped with sound setup.', lastKnownLocation: 'RCPCOEP campus, Shirpur', centrality: 0.85, repeatPatterns: 3, recentActivityDays: 1, tags: ['suspect', 'S01', 'volunteer'] },
  { name: 'Rohit More', type: 'person', phone: '+917501000102', criminal: 'CR-SHP-2026-002', background: 'S02 · Sound-system helper. Handled equipment movement in and out of the storage room.', lastKnownLocation: 'RCPCOEP campus, Shirpur', centrality: 0.7, repeatPatterns: 2, recentActivityDays: 1, tags: ['suspect', 'S02', 'sound'] },
  { name: 'Sameer Joshi', type: 'person', phone: '+917501000103', criminal: 'CR-SHP-2026-003', background: 'S03 · Event coordinator. Central contact for all volunteers; held the storage-room key register.', lastKnownLocation: 'RCPCOEP campus, Shirpur', centrality: 0.9, repeatPatterns: 3, recentActivityDays: 0, tags: ['suspect', 'S03', 'coordinator'] },
  { name: 'Kunal Shinde', type: 'person', phone: '+917501000104', criminal: 'CR-SHP-2026-004', background: 'S04 · Transport volunteer. Moved equipment between venue and storage; owns a Platina.', lastKnownLocation: 'Karwand Naka, Shirpur', centrality: 0.5, repeatPatterns: 1, recentActivityDays: 2, tags: ['suspect', 'S04', 'transport'] },
  { name: 'Neeraj Pawar', type: 'person', phone: '+917501000105', criminal: 'CR-SHP-2026-005', background: 'S05 · Food-stall volunteer. Present near the event area through the evening.', lastKnownLocation: 'Shirpur town', centrality: 0.4, repeatPatterns: 1, recentActivityDays: 3, tags: ['suspect', 'S05', 'food-stall'] },
  { name: 'Pratik Deshmukh', type: 'person', phone: '+917501000106', criminal: 'CR-SHP-2026-006', background: 'S06 · Former event volunteer. Knows the storage layout from previous events.', lastKnownLocation: 'Bhadgaon', centrality: 0.6, repeatPatterns: 2, recentActivityDays: 1, tags: ['suspect', 'S06', 'former-volunteer'] },
  // ---- 5 associated persons ----
  { name: 'Harshal Patil', type: 'person', phone: '+917501000107', background: 'Relative of Amit Patil. Seen with Amit near Karwand Naka on event day.', lastKnownLocation: 'Karwand Naka, Shirpur', centrality: 0.55, repeatPatterns: 1, recentActivityDays: 2, tags: ['associate'] },
  { name: 'Krishna Patil', type: 'person', phone: '+917501000108', background: 'Associate of Harshal Patil. Part of the wider volunteer circle.', lastKnownLocation: 'Shirpur town', centrality: 0.35, repeatPatterns: 0, recentActivityDays: 4, tags: ['associate'] },
  { name: 'Nayan Patil', type: 'person', phone: '+917501000109', background: 'Associate. Exchanged calls with Krishna Patil during the event window.', lastKnownLocation: 'Shirpur town', centrality: 0.3, repeatPatterns: 0, recentActivityDays: 5, tags: ['associate'] },
  { name: 'Nikita Patil', type: 'person', phone: '+917501000110', background: 'Associate of Nayan Patil. Met Durgesh Wagh near the venue.', lastKnownLocation: 'Bhadgaon', centrality: 0.3, repeatPatterns: 0, recentActivityDays: 5, tags: ['associate'] },
  { name: 'Durgesh Wagh', type: 'person', phone: '+917501000111', background: 'Contact of Pratik Deshmukh. Called Rohit More twice on event night; owns a Bullet.', lastKnownLocation: 'Karwand Naka, Shirpur', centrality: 0.6, repeatPatterns: 2, recentActivityDays: 1, tags: ['associate'] },
  // ---- 4 places ----
  { name: 'Karwand Naka', type: 'location', phone: '+917502000101', background: 'Road junction where Kunal Shinde and Durgesh Wagh were sighted with vehicles.', lastKnownLocation: 'Shirpur', centrality: 0.5, repeatPatterns: 1, recentActivityDays: 1, tags: ['place', 'junction'] },
  { name: 'Shirpur', type: 'location', phone: '+917502000102', background: 'Town where the college celebration and storage-room theft occurred.', lastKnownLocation: 'Dhule district', centrality: 0.6, repeatPatterns: 1, recentActivityDays: 0, tags: ['place', 'town'] },
  { name: 'Bhadgaon', type: 'location', phone: '+917502000103', background: 'Village linked to Pratik Deshmukh and Nikita Patil movements.', lastKnownLocation: 'Near Shirpur', centrality: 0.3, repeatPatterns: 0, recentActivityDays: 6, tags: ['place', 'village'] },
  { name: 'RCPCOEP', type: 'location', phone: '+917502000104', background: 'College campus (event venue). Storage room with sound equipment and ₹25,000 cash.', lastKnownLocation: 'Shirpur', centrality: 0.85, repeatPatterns: 2, recentActivityDays: 0, tags: ['place', 'venue', 'campus'] },
  // ---- 6 devices ----
  { name: 'Mobile Y-29', type: 'device', phone: '867290000000101', background: 'Handset used by Amit Patil (S01). CDR shows night-window calls to Rohit More.', lastKnownLocation: 'RCPCOEP campus', centrality: 0.7, repeatPatterns: 2, recentActivityDays: 1, tags: ['device', 'mobile'] },
  { name: 'Mobile T4X', type: 'device', phone: '867290000000102', background: 'Handset used by Rohit More (S02). Two incoming calls from Durgesh Wagh.', lastKnownLocation: 'RCPCOEP campus', centrality: 0.55, repeatPatterns: 1, recentActivityDays: 1, tags: ['device', 'mobile'] },
  { name: 'Mobile A14', type: 'device', phone: '867290000000103', background: 'Handset used by Sameer Joshi (S03). Coordinator group hub.', lastKnownLocation: 'RCPCOEP campus', centrality: 0.8, repeatPatterns: 2, recentActivityDays: 0, tags: ['device', 'mobile'] },
  { name: 'Mobile X', type: 'device', phone: '867290000000104', background: 'Handset used by Kunal Shinde (S04).', lastKnownLocation: 'Karwand Naka', centrality: 0.35, repeatPatterns: 0, recentActivityDays: 3, tags: ['device', 'mobile'] },
  { name: 'Mobile F-16', type: 'device', phone: '867290000000105', background: 'Handset used by Neeraj Pawar (S05).', lastKnownLocation: 'Shirpur town', centrality: 0.3, repeatPatterns: 0, recentActivityDays: 4, tags: ['device', 'mobile'] },
  { name: 'Mobile Nova', type: 'device', phone: '867290000000106', background: 'Handset used by Pratik Deshmukh (S06).', lastKnownLocation: 'Bhadgaon', centrality: 0.45, repeatPatterns: 1, recentActivityDays: 2, tags: ['device', 'mobile'] },
  // ---- 4 vehicles ----
  { name: 'Platina MH-18-AB-2201', type: 'vehicle', phone: '+917503000101', background: 'Motorcycle used by Kunal Shinde for equipment transport.', lastKnownLocation: 'Karwand Naka, Shirpur', centrality: 0.45, repeatPatterns: 1, recentActivityDays: 1, tags: ['vehicle', 'platina'] },
  { name: 'Activa MH-18-CD-3456', type: 'vehicle', phone: '+917503000102', background: 'Scooter linked to Neeraj Pawar movements near the venue.', lastKnownLocation: 'Shirpur town', centrality: 0.3, repeatPatterns: 0, recentActivityDays: 3, tags: ['vehicle', 'activa'] },
  { name: 'Bullet MH-18-EF-7890', type: 'vehicle', phone: '+917503000103', background: 'Motorcycle owned by Durgesh Wagh; spotted at Karwand Naka.', lastKnownLocation: 'Karwand Naka, Shirpur', centrality: 0.5, repeatPatterns: 1, recentActivityDays: 1, tags: ['vehicle', 'bullet'] },
  { name: 'Splendor MH-18-GH-1122', type: 'vehicle', phone: '+917503000104', background: 'Motorcycle linked to Harshal Patil.', lastKnownLocation: 'Shirpur town', centrality: 0.35, repeatPatterns: 0, recentActivityDays: 4, tags: ['vehicle', 'splendor'] },
];

const RELS: Array<[string, string, string, number]> = [
  ['Amit Patil', 'Rohit More', 'associated_with', 85],
  ['Amit Patil', 'Sameer Joshi', 'associated_with', 75],
  ['Rohit More', 'Sameer Joshi', 'associated_with', 70],
  ['Sameer Joshi', 'Kunal Shinde', 'associated_with', 65],
  ['Kunal Shinde', 'Neeraj Pawar', 'associated_with', 55],
  ['Neeraj Pawar', 'Pratik Deshmukh', 'met_with', 50],
  ['Pratik Deshmukh', 'Sameer Joshi', 'associated_with', 60],
  ['Amit Patil', 'Harshal Patil', 'family_of', 70],
  ['Harshal Patil', 'Krishna Patil', 'family_of', 65],
  ['Krishna Patil', 'Nayan Patil', 'associated_with', 55],
  ['Nayan Patil', 'Nikita Patil', 'family_of', 60],
  ['Nikita Patil', 'Durgesh Wagh', 'met_with', 50],
  ['Durgesh Wagh', 'Pratik Deshmukh', 'associated_with', 55],
  ['Rohit More', 'Durgesh Wagh', 'calls', 62],
  ['Amit Patil', 'Mobile Y-29', 'owns', 90],
  ['Rohit More', 'Mobile T4X', 'owns', 85],
  ['Sameer Joshi', 'Mobile A14', 'owns', 88],
  ['Kunal Shinde', 'Mobile X', 'owns', 70],
  ['Neeraj Pawar', 'Mobile F-16', 'owns', 65],
  ['Pratik Deshmukh', 'Mobile Nova', 'owns', 75],
  ['Kunal Shinde', 'Platina MH-18-AB-2201', 'owns', 80],
  ['Neeraj Pawar', 'Activa MH-18-CD-3456', 'owns', 70],
  ['Durgesh Wagh', 'Bullet MH-18-EF-7890', 'owns', 75],
  ['Harshal Patil', 'Splendor MH-18-GH-1122', 'owns', 65],
  ['Amit Patil', 'RCPCOEP', 'co_located', 90],
  ['Sameer Joshi', 'RCPCOEP', 'co_located', 95],
  ['Rohit More', 'RCPCOEP', 'co_located', 85],
  ['Kunal Shinde', 'Karwand Naka', 'co_located', 70],
  ['Neeraj Pawar', 'Shirpur', 'co_located', 75],
  ['Pratik Deshmukh', 'Bhadgaon', 'co_located', 60],
  ['Durgesh Wagh', 'Karwand Naka', 'co_located', 65],
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
