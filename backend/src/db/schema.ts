/**
 * NexusAI Database Schema - SQLite (dev) / PostgreSQL (prod)
 * Single source of truth for all tables
 */

export const SCHEMA = `
-- ============================================
-- USERS & AUTH
-- ============================================
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('officer','police','admin')),
  badge_number TEXT,
  department TEXT,
  is_active INTEGER DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================
-- ENTITIES (Core Intelligence)
-- ============================================
CREATE TABLE IF NOT EXISTS entities (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN (
    'person','phone','device','location','vehicle','account',
    'organization','document','ip_address','email','crypto_wallet'
  )),
  name TEXT NOT NULL,
  risk_score INTEGER DEFAULT 0 CHECK (risk_score BETWEEN 0 AND 100),
  risk_level TEXT NOT NULL CHECK (risk_level IN ('critical','high','medium','low','monitored')),
  confidence INTEGER DEFAULT 0 CHECK (confidence BETWEEN 0 AND 100),
  data_json TEXT NOT NULL,           -- Full entity data as JSON
  tags_json TEXT DEFAULT '[]',       -- JSON array
  source_ids_json TEXT DEFAULT '[]', -- JSON array of FIR/CDR IDs
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_entities_type ON entities(type);
CREATE INDEX IF NOT EXISTS idx_entities_risk ON entities(risk_level);
CREATE INDEX IF NOT EXISTS idx_entities_name ON entities(name);
CREATE INDEX IF NOT EXISTS idx_entities_active ON entities(is_active);

-- ============================================
-- RELATIONSHIPS (Network Graph)
-- ============================================
CREATE TABLE IF NOT EXISTS relationships (
  id TEXT PRIMARY KEY,
  source_entity_id TEXT NOT NULL,
  target_entity_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'calls','messaged','met_with','transferred_to','transferred_from',
    'owns','registered_at','works_for','associated_with','family_of',
    'co_located','shared_device','shared_ip','crypto_transfer',
    'email_contact','social_media','witness','suspect_of'
  )),
  strength INTEGER DEFAULT 50 CHECK (strength BETWEEN 0 AND 100),
  confidence INTEGER DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  evidence_ids_json TEXT DEFAULT '[]',
  first_observed TEXT NOT NULL,
  last_observed TEXT NOT NULL,
  is_active INTEGER DEFAULT 1,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (source_entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  FOREIGN KEY (target_entity_id) REFERENCES entities(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_rel_source ON relationships(source_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_target ON relationships(target_entity_id);
CREATE INDEX IF NOT EXISTS idx_rel_type ON relationships(type);
CREATE INDEX IF NOT EXISTS idx_rel_active ON relationships(is_active);

-- ============================================
-- CASES & INVESTIGATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS cases (
  id TEXT PRIMARY KEY,
  case_number TEXT UNIQUE NOT NULL,
  fir_number TEXT,
  cnr_number TEXT,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL CHECK (status IN ('open','active','under_review','closed','cold','archived')),
  priority TEXT NOT NULL CHECK (priority IN ('critical','high','medium','low')),
  entity_ids_json TEXT DEFAULT '[]',
  document_ids_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  closed_at TEXT,
  tags_json TEXT DEFAULT '[]',
  created_by TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS case_assignments (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  assigned_at TEXT NOT NULL,
  assigned_by TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id),
  FOREIGN KEY (assigned_by) REFERENCES users(id),
  UNIQUE(case_id, user_id)
);

CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'entity_added','relationship_found','document_uploaded',
    'note_added','status_changed','alert_triggered',
    'simulation_run','search_performed'
  )),
  title TEXT NOT NULL,
  description TEXT,
  entity_ids_json TEXT DEFAULT '[]',
  document_ids_json TEXT DEFAULT '[]',
  user_id TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_timeline_case ON timeline_events(case_id);
CREATE INDEX IF NOT EXISTS idx_timeline_created ON timeline_events(created_at);

CREATE TABLE IF NOT EXISTS case_notes (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  is_private INTEGER DEFAULT 0,
  attachments_json TEXT DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id)
);

-- ============================================
-- ALERTS & SIGNALS
-- ============================================
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  type TEXT NOT NULL CHECK (type IN (
    'anomaly','pattern','threshold','new_entity','relationship',
    'geofence','financial','communication','movement','risk_change'
  )),
  severity TEXT NOT NULL CHECK (severity IN ('critical','high','medium','low','info')),
  title TEXT NOT NULL,
  description TEXT,
  entity_ids_json TEXT DEFAULT '[]',
  confidence INTEGER DEFAULT 50 CHECK (confidence BETWEEN 0 AND 100),
  source TEXT NOT NULL CHECK (source IN ('ai_model','rule_engine','manual','external_feed')),
  status TEXT NOT NULL CHECK (status IN ('new','acknowledged','investigating','resolved','dismissed')),
  assigned_to TEXT,
  acknowledged_at TEXT,
  resolved_at TEXT,
  created_at TEXT NOT NULL,
  metadata_json TEXT DEFAULT '{}',
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL,
  FOREIGN KEY (assigned_to) REFERENCES users(id)
);

CREATE INDEX IF NOT EXISTS idx_alerts_case ON alerts(case_id);
CREATE INDEX IF NOT EXISTS idx_alerts_status ON alerts(status);
CREATE INDEX IF NOT EXISTS idx_alerts_severity ON alerts(severity);
CREATE INDEX IF NOT EXISTS idx_alerts_created ON alerts(created_at);

-- ============================================
-- SIMULATIONS
-- ============================================
CREATE TABLE IF NOT EXISTS simulations (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('detention','removal','surveillance','asset_freeze','network_disruption')),
  target_entity_ids_json TEXT NOT NULL,
  parameters_json TEXT DEFAULT '{}',
  result_json TEXT,
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed')),
  requested_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (requested_by) REFERENCES users(id)
);

-- ============================================
-- DATA SOURCES & INGESTION
-- ============================================
CREATE TABLE IF NOT EXISTS data_sources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN (
    'cdr','fir','financial','surveillance','social_media',
    'intel_report','border','custom'
  )),
  config_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active','inactive','error','syncing')),
  last_sync_at TEXT,
  next_sync_at TEXT,
  total_records INTEGER DEFAULT 0,
  error_message TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (created_by) REFERENCES users(id)
);

CREATE TABLE IF NOT EXISTS ingestion_jobs (
  id TEXT PRIMARY KEY,
  data_source_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','running','completed','failed','cancelled')),
  records_processed INTEGER DEFAULT 0,
  records_created INTEGER DEFAULT 0,
  records_updated INTEGER DEFAULT 0,
  records_failed INTEGER DEFAULT 0,
  started_at TEXT,
  completed_at TEXT,
  error TEXT,
  FOREIGN KEY (data_source_id) REFERENCES data_sources(id) ON DELETE CASCADE
);

-- ============================================
-- AUDIT LOGS
-- ============================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  details_json TEXT DEFAULT '{}',
  ip_address TEXT,
  user_agent TEXT,
  timestamp TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('success','failure','partial')),
  risk_score INTEGER DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_logs(timestamp);

-- ============================================
-- FILES / EVIDENCE
-- ============================================
CREATE TABLE IF NOT EXISTS files (
  id TEXT PRIMARY KEY,
  original_name TEXT NOT NULL,
  stored_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  path TEXT NOT NULL,
  entity_id TEXT,
  case_id TEXT,
  uploaded_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE SET NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id)
);

-- ============================================
-- SEARCH INDEX (FTS5 for full-text search)
-- ============================================
CREATE VIRTUAL TABLE IF NOT EXISTS entities_fts USING fts5(
  id UNINDEXED,
  name,
  type,
  data_json,
  content='entities',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS entities_ai AFTER INSERT ON entities BEGIN
  INSERT INTO entities_fts(rowid, id, name, type, data_json) VALUES (new.rowid, new.id, new.name, new.type, new.data_json);
END;

CREATE TRIGGER IF NOT EXISTS entities_ad AFTER DELETE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, id, name, type, data_json) VALUES ('delete', old.rowid, old.id, old.name, old.type, old.data_json);
END;

CREATE TRIGGER IF NOT EXISTS entities_au AFTER UPDATE ON entities BEGIN
  INSERT INTO entities_fts(entities_fts, rowid, id, name, type, data_json) VALUES ('delete', old.rowid, old.id, old.name, old.type, old.data_json);
  INSERT INTO entities_fts(rowid, id, name, type, data_json) VALUES (new.rowid, new.id, new.name, new.type, new.data_json);
END;

-- ============================================
-- CHAIN OF CUSTODY (lightweight hash-chain)
-- Each record stores hash of previous record.
-- Tamper-evident without Hyperledger overhead.
-- ============================================
CREATE TABLE IF NOT EXISTS chain_records (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  seq INTEGER NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN (
    'case_created','evidence_uploaded','entity_added','entity_updated',
    'entity_deleted','case_closed','case_reopened','data_edited',
    'login','note_added','report_generated','approval_requested',
    'approval_granted','approval_rejected'
  )),
  actor_id TEXT NOT NULL,
  actor_role TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  prev_hash TEXT NOT NULL DEFAULT 'GENESIS',
  record_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE SET NULL,
  FOREIGN KEY (actor_id) REFERENCES users(id),
  UNIQUE(case_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_chain_case ON chain_records(case_id, seq);
CREATE INDEX IF NOT EXISTS idx_chain_actor ON chain_records(actor_id);

-- ============================================
-- ENTITY IDENTITY (unique identifiers, dedupe)
-- Priority: phone > CNR > Aadhaar
-- Aadhaar stored encrypted (AES-256-GCM blob)
-- ============================================
CREATE TABLE IF NOT EXISTS entity_identities (
  id TEXT PRIMARY KEY,
  entity_id TEXT NOT NULL,
  id_type TEXT NOT NULL CHECK (id_type IN ('phone','cnr','aadhaar','fir','criminal')),
  id_value TEXT NOT NULL,
  id_value_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (entity_id) REFERENCES entities(id) ON DELETE CASCADE,
  UNIQUE(id_type, id_value_hash)
);

CREATE INDEX IF NOT EXISTS idx_eid_entity ON entity_identities(entity_id);
CREATE INDEX IF NOT EXISTS idx_eid_hash ON entity_identities(id_value_hash);

-- ============================================
-- TWO-PERSON APPROVALS
-- Critical actions need a second officer/admin
-- ============================================
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY,
  case_id TEXT,
  entity_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('close_case','reopen_case','delete_entity','merge_entity')),
  reason TEXT NOT NULL,
  requested_by TEXT NOT NULL,
  approved_by TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected','expired')),
  payload_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  decided_at TEXT,
  FOREIGN KEY (case_id) REFERENCES cases(id) ON DELETE CASCADE,
  FOREIGN KEY (requested_by) REFERENCES users(id),
  FOREIGN KEY (approved_by) REFERENCES users(id),
  CHECK (requested_by != approved_by)
);

CREATE INDEX IF NOT EXISTS idx_approvals_status ON approvals(status);
CREATE INDEX IF NOT EXISTS idx_approvals_case ON approvals(case_id);
`;

// Migration helpers
export const MIGRATIONS: string[] = [];