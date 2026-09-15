import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { canonicalize, chainHash } from '../utils/crypto.js';

export type ChainEventType =
  | 'case_created' | 'evidence_uploaded' | 'entity_added' | 'entity_updated'
  | 'entity_deleted' | 'case_closed' | 'case_reopened' | 'data_edited'
  | 'login' | 'note_added' | 'report_generated'
  | 'approval_requested' | 'approval_granted' | 'approval_rejected';

interface AppendArgs {
  caseId: string | null;
  eventType: ChainEventType;
  actorId: string;
  actorRole: string;
  payload: Record<string, unknown>;
}

/**
 * Lightweight hash-chain (chosen over Hyperledger Fabric):
 * - Zero hosting cost, works on SQLite/Postgres row
 * - Each record: record_hash = sha256(prev_hash :: canonical(payload))
 * - Any silent edit breaks all later hashes → detectable by verifyChain()
 */
export function appendChainRecord(args: AppendArgs): { id: string; seq: number; recordHash: string } {
  const db = getDb();
  const now = new Date().toISOString();

  const last = args.caseId
    ? db.prepare(`SELECT seq, record_hash FROM chain_records WHERE case_id = ? ORDER BY seq DESC LIMIT 1`).get(args.caseId) as { seq: number; record_hash: string } | undefined
    : db.prepare(`SELECT seq, record_hash FROM chain_records WHERE case_id IS NULL ORDER BY seq DESC LIMIT 1`).get() as { seq: number; record_hash: string } | undefined;

  const prevHash = last?.record_hash ?? 'GENESIS';
  const seq = (last?.seq ?? 0) + 1;

  const canonical = canonicalize({
    caseId: args.caseId,
    seq,
    eventType: args.eventType,
    actorId: args.actorId,
    actorRole: args.actorRole,
    payload: args.payload,
    createdAt: now,
    prevHash,
  });
  const recordHash = chainHash(prevHash, canonical);
  const id = randomUUID();

  db.prepare(
    `INSERT INTO chain_records (id, case_id, seq, event_type, actor_id, actor_role, payload_json, prev_hash, record_hash, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, args.caseId, seq, args.eventType, args.actorId, args.actorRole, JSON.stringify(args.payload), prevHash, recordHash, now);

  return { id, seq, recordHash };
}

export interface VerifyResult {
  ok: boolean;
  checked: number;
  brokenAtSeq: number | null;
  message: string;
}

export function verifyChain(caseId: string | null): VerifyResult {
  const db = getDb();
  const rows = (
    caseId
      ? db.prepare(`SELECT * FROM chain_records WHERE case_id = ? ORDER BY seq ASC`).all(caseId)
      : db.prepare(`SELECT * FROM chain_records WHERE case_id IS NULL ORDER BY seq ASC`).all()
  ) as Array<{
    seq: number; event_type: string; actor_id: string; actor_role: string;
    payload_json: string; prev_hash: string; record_hash: string; created_at: string; case_id: string | null;
  }>;

  let prev = 'GENESIS';
  for (const r of rows) {
    if (r.prev_hash !== prev) {
      return { ok: false, checked: rows.length, brokenAtSeq: r.seq, message: `prev_hash mismatch at seq ${r.seq}` };
    }
    const canonical = canonicalize({
      caseId: r.case_id,
      seq: r.seq,
      eventType: r.event_type,
      actorId: r.actor_id,
      actorRole: r.actor_role,
      payload: JSON.parse(r.payload_json),
      createdAt: r.created_at,
      prevHash: r.prev_hash,
    });
    const expected = chainHash(r.prev_hash, canonical);
    if (expected !== r.record_hash) {
      return { ok: false, checked: rows.length, brokenAtSeq: r.seq, message: `record_hash mismatch at seq ${r.seq} — tampering detected` };
    }
    prev = r.record_hash;
  }
  return { ok: true, checked: rows.length, brokenAtSeq: null, message: rows.length === 0 ? 'Empty chain — nothing to verify' : `Verified ✅ ${rows.length} records intact` };
}
