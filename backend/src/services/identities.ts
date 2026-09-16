import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';
import { encryptAadhaar, decryptAadhaar, identityHash, normalizePhone } from '../utils/crypto.js';

export interface IdentifierInput {
  phone?: string;
  cnr?: string;
  aadhaar?: string;
  fir?: string;
  criminal?: string;
}

export interface ResolvedIdentity {
  idType: 'phone' | 'cnr' | 'aadhaar' | 'fir' | 'criminal';
  rawValue: string;       // as supplied (aadhaar raw, only transient)
  storeValue: string;     // what goes into id_value (aadhaar encrypted blob)
  valueHash: string;      // dedupe index
}

/** Priority: phone > CNR > Aadhaar. At least one of the three is required. */
export function requirePrimaryIdentifier(input: IdentifierInput): void {
  if (!input.phone && !input.cnr && !input.aadhaar) {
    throw Object.assign(new Error('At least one unique identifier is required: phone, CNR, or Aadhaar (priority phone > CNR > Aadhaar)'), { status: 400, code: 'ID_REQUIRED' });
  }
}

export function resolveIdentities(input: IdentifierInput): ResolvedIdentity[] {
  const out: ResolvedIdentity[] = [];
  if (input.phone) {
    const norm = normalizePhone(input.phone);
    if (norm.length < 7) throw Object.assign(new Error('Invalid phone number'), { status: 400, code: 'BAD_PHONE' });
    out.push({ idType: 'phone', rawValue: norm, storeValue: norm, valueHash: identityHash('phone', norm) });
  }
  if (input.cnr) {
    const norm = input.cnr.trim();
    out.push({ idType: 'cnr', rawValue: norm, storeValue: norm, valueHash: identityHash('cnr', norm) });
  }
  if (input.aadhaar) {
    const norm = input.aadhaar.replace(/[\s\-]/g, '');
    if (!/^\d{12}$/.test(norm)) throw Object.assign(new Error('Aadhaar must be 12 digits'), { status: 400, code: 'BAD_AADHAAR' });
    out.push({ idType: 'aadhaar', rawValue: norm, storeValue: encryptAadhaar(norm), valueHash: identityHash('aadhaar', norm) });
  }
  if (input.fir) {
    const norm = input.fir.trim();
    if (norm) out.push({ idType: 'fir', rawValue: norm, storeValue: norm, valueHash: identityHash('fir', norm) });
  }
  if (input.criminal) {
    const norm = input.criminal.trim();
    if (norm) out.push({ idType: 'criminal', rawValue: norm, storeValue: norm, valueHash: identityHash('criminal', norm) });
  }
  return out;
}

/** Returns the existing entity holding this identifier, if any.
 * FIR is a shared case record (one FIR names several accused), so it is
 * deliberately NOT a dedupe key — only phone/CNR/Aadhaar/criminal block. */
export function findDuplicate(resolved: ResolvedIdentity[]): { entityId: string; idType: string } | null {
  const db = getDb();
  for (const r of resolved) {
    if (r.idType === 'fir') continue;
    const hit = db.prepare(`SELECT entity_id FROM entity_identities WHERE id_type = ? AND id_value_hash = ?`).get(r.idType, r.valueHash) as { entity_id: string } | undefined;
    if (hit) return { entityId: hit.entity_id, idType: r.idType };
  }
  return null;
}

export function attachIdentities(entityId: string, resolved: ResolvedIdentity[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  for (const r of resolved) {
    try {
      db.prepare(`INSERT INTO entity_identities (id, entity_id, id_type, id_value, id_value_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(randomUUID(), entityId, r.idType, r.storeValue, r.valueHash, now);
    } catch (e: any) {
      // A shared FIR already recorded on another accused: keep the entity's
      // own FIR reference in source_ids_json, skip the duplicate identity row.
      if (r.idType === 'fir' && String(e?.message || '').includes('UNIQUE')) continue;
      throw e;
    }
  }
}

export interface DisplayIdentity {
  idType: string;
  value: string;      // decrypted/masked for display
  masked: boolean;
}

/** Aadhaar: officer/admin see decrypted, police see masked XXXX-XXXX-1234 */
export function getDisplayIdentities(entityId: string, viewerRole: string): DisplayIdentity[] {
  const db = getDb();
  const rows = db.prepare(`SELECT id_type, id_value FROM entity_identities WHERE entity_id = ?`).all(entityId) as Array<{ id_type: string; id_value: string }>;
  return rows.map((r) => {
    if (r.id_type === 'aadhaar') {
      try {
        const raw = decryptAadhaar(r.id_value);
        if (viewerRole === 'police') return { idType: r.id_type, value: `XXXX-XXXX-${raw.slice(-4)}`, masked: true };
        return { idType: r.id_type, value: raw, masked: false };
      } catch {
        return { idType: r.id_type, value: '[decrypt error]', masked: true };
      }
    }
    if (r.id_type === 'phone' && viewerRole === 'police') {
      const v = r.id_value;
      return { idType: r.id_type, value: v.length > 4 ? `${v.slice(0, 3)}•••${v.slice(-3)}` : '•••', masked: true };
    }
    return { idType: r.id_type, value: r.id_value, masked: false };
  });
}

/**
 * Cross-case linking: cases sharing ANY identity hash with this entity
 * (same phone/CNR/Aadhaar appearing in >1 case → hidden network surface)
 */
export function findLinkedCaseIds(entityId: string): string[] {
  const db = getDb();
  const hashes = db.prepare(`SELECT id_value_hash FROM entity_identities WHERE entity_id = ?`).all(entityId) as Array<{ id_value_hash: string }>;
  if (!hashes.length) return [];
  const caseSet = new Set<string>();
  for (const h of hashes) {
    const siblings = db.prepare(`SELECT entity_id FROM entity_identities WHERE id_value_hash = ? AND entity_id != ?`).all(h.id_value_hash, entityId) as Array<{ entity_id: string }>;
    const ids = [entityId, ...siblings.map((s) => s.entity_id)];
    for (const eid of ids) {
      const cases = db.prepare(`SELECT id, entity_ids_json FROM cases`).all() as Array<{ id: string; entity_ids_json: string }>;
      for (const c of cases) {
        try {
          const arr = JSON.parse(c.entity_ids_json || '[]') as string[];
          if (arr.includes(eid)) caseSet.add(c.id);
        } catch { /* ignore */ }
      }
    }
  }
  return [...caseSet];
}
