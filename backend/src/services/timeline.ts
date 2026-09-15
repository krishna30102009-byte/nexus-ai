import { randomUUID } from 'node:crypto';
import { getDb } from '../db/connection.js';

export type TimelineType =
  | 'entity_added' | 'relationship_found' | 'document_uploaded'
  | 'note_added' | 'status_changed' | 'alert_triggered'
  | 'simulation_run' | 'search_performed';

export function addTimelineEvent(args: {
  caseId: string;
  type: TimelineType;
  title: string;
  description?: string;
  userId: string;
  entityIds?: string[];
  documentIds?: string[];
  metadata?: Record<string, unknown>;
}): string {
  const db = getDb();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO timeline_events (id, case_id, type, title, description, entity_ids_json, document_ids_json, user_id, metadata_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    args.caseId,
    args.type,
    args.title,
    args.description ?? null,
    JSON.stringify(args.entityIds ?? []),
    JSON.stringify(args.documentIds ?? []),
    args.userId,
    JSON.stringify(args.metadata ?? {}),
    new Date().toISOString()
  );
  return id;
}
