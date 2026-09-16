/**
 * One-time reshape: Shirpur case (FIR-SHP-2026-014) keeps exactly
 * 6 persons + 6 mobiles + 5 places. Old suspects, old devices and all
 * vehicles are soft-deleted (is_active = 0, chain kept intact).
 * Safe to re-run (idempotent) — run via: npx tsx src/db/migrate-shirpur-reshape.ts
 */
import { getDb, closeDb } from './connection.js';
import { seedShirpur } from './seed-shirpur.js';
import { appendChainRecord } from '../services/chain.js';
import { addTimelineEvent } from '../services/timeline.js';

const REMOVE = [
  'Amit Patil', 'Rohit More', 'Sameer Joshi', 'Kunal Shinde', 'Neeraj Pawar', 'Pratik Deshmukh',
  'Mobile A14', 'Mobile X', 'Mobile F-16', 'Mobile Nova',
  'Platina MH-18-AB-2201', 'Activa MH-18-CD-3456', 'Bullet MH-18-EF-7890', 'Splendor MH-18-GH-1122',
];

// Profile clean-up for kept entities (drop references to removed entities)
const PROFILE_FIX: Record<string, { background: string; lastKnownLocation: string }> = {
  'Harshal Patil': { background: 'P02 · Seen with Pratik Patil near Karwand Naka on event day. Uses Mobile 15.', lastKnownLocation: 'Karwand Naka, Shirpur' },
  'Durgesh Wagh': { background: 'P06 · Contact of Pratik Patil. Uses a Lava handset; seen at Karwand Naka on event night.', lastKnownLocation: 'Karwand Naka, Shirpur' },
  'Mobile Y-29': { background: 'Handset used by Pratik Patil (P01).', lastKnownLocation: 'Amalner' },
  'Mobile T4X': { background: 'Handset used by Krishna Patil (P03).', lastKnownLocation: 'Shirpur town' },
  'Karwand Naka': { background: 'Road junction where Harshal Patil and Durgesh Wagh were sighted.', lastKnownLocation: 'Shirpur' },
  'Bhadgaon': { background: 'Village linked to Nikita Patil movements.', lastKnownLocation: 'Near Shirpur' },
};

function setProfile(db: any, id: string, fix: { background: string; lastKnownLocation: string }) {
  const row = db.prepare(`SELECT data_json FROM entities WHERE id = ?`).get(id) as { data_json: string };
  const data = JSON.parse(row.data_json || '{}');
  data.background = fix.background;
  data.lastKnownLocation = fix.lastKnownLocation;
  db.prepare(`UPDATE entities SET data_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(data), new Date().toISOString(), id);
}

try {
  const db = getDb();
  const now = new Date().toISOString();
  const admin = db.prepare(`SELECT id FROM users WHERE email = 'admin@nexus.ai'`).get() as { id: string };
  const caseRow = db.prepare(`SELECT * FROM cases WHERE fir_number = 'FIR-SHP-2026-014'`).get() as any;
  if (!caseRow) throw new Error('Shirpur case not found');

  // 1. resolve ids of entities to remove
  const removedIds: string[] = [];
  for (const name of REMOVE) {
    const r = db.prepare(`SELECT id FROM entities WHERE name = ? AND is_active = 1`).get(name) as { id: string } | undefined;
    if (r) removedIds.push(r.id);
    else console.log(`already gone: ${name}`);
  }

  // 2. deactivate their relationships
  let rels = 0;
  for (const id of removedIds) {
    const r = db.prepare(`UPDATE relationships SET is_active = 0, updated_at = ? WHERE is_active = 1 AND (source_entity_id = ? OR target_entity_id = ?)`).run(now, id, id);
    rels += Number(r.changes);
  }
  console.log(`deactivated ${rels} relationships`);

  // 3. deactivate the entities
  for (const id of removedIds) {
    db.prepare(`UPDATE entities SET is_active = 0, updated_at = ? WHERE id = ?`).run(now, id);
    appendChainRecord({ caseId: caseRow.id, eventType: 'entity_deleted', actorId: admin.id, actorRole: 'admin', payload: { entityId: id, reason: 'Shirpur reshape: keep 6 persons + 6 mobiles + 5 places' } });
  }
  console.log(`deactivated ${removedIds.length} entities`);

  // 4. clean case membership
  let members: string[] = JSON.parse(caseRow.entity_ids_json || '[]');
  members = members.filter((id: string) => !removedIds.includes(id));
  db.prepare(`UPDATE cases SET entity_ids_json = ?, updated_at = ? WHERE id = ?`).run(JSON.stringify(members), now, caseRow.id);

  // 5. fix kept profiles
  for (const [name, fix] of Object.entries(PROFILE_FIX)) {
    const r = db.prepare(`SELECT id FROM entities WHERE name = ? AND is_active = 1`).get(name) as { id: string } | undefined;
    if (r) { setProfile(db, r.id, fix); console.log(`profile updated: ${name}`); }
  }

  // 6. re-seed (adds Pratik Patil, 4 new mobiles, Amalner + all new links; skips existing)
  seedShirpur();

  // 7. audit trail
  addTimelineEvent({ caseId: caseRow.id, type: 'note_added', title: 'Case reshaped: 6 persons, 6 mobiles, 5 places', description: 'Removed old suspects/devices/vehicles; added Pratik Patil, Mobile 15, Mobile P4 5G, iPhone XS, Lava, Amalner.', userId: admin.id });

  // 8. report
  const finalMembers = JSON.parse((db.prepare(`SELECT entity_ids_json FROM cases WHERE id = ?`).get(caseRow.id) as any).entity_ids_json || '[]') as string[];
  const rows = finalMembers.length
    ? db.prepare(`SELECT type, name FROM entities WHERE id IN (${finalMembers.map(() => '?').join(',')}) AND is_active = 1 ORDER BY type, name`).all(...finalMembers) as Array<{ type: string; name: string }>
    : [];
  console.log(`FINAL: ${rows.length} active entities`);
  for (const r of rows) console.log(` - [${r.type}] ${r.name}`);
} finally {
  closeDb();
}
