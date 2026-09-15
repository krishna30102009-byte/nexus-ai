import { getDb } from '../db/connection.js';
import { findLinkedCaseIds } from './identities.js';

export interface GraphNode {
  id: string;
  type: string;
  name: string;
  riskScore: number;
  riskLevel: string;
  centrality: number;
  crossCase: boolean;
  linkedCaseCount: number;
}

export interface GraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  strength: number;
  confidence: number;
  crossCase: boolean;
}

export function buildCaseGraph(caseId: string): {
  nodes: GraphNode[];
  edges: GraphEdge[];
  crossCaseEdges: GraphEdge[];
  centralNodeId: string | null;
  density: number;
} {
  const db = getDb();
  const c = db.prepare(`SELECT entity_ids_json FROM cases WHERE id = ?`).get(caseId) as { entity_ids_json: string } | undefined;
  if (!c) throw Object.assign(new Error('Case not found'), { status: 404, code: 'NOT_FOUND' });

  let memberIds: string[] = [];
  try { memberIds = JSON.parse(c.entity_ids_json || '[]'); } catch { memberIds = []; }
  const memberSet = new Set(memberIds);

  const entities = memberIds.length
    ? (db.prepare(`SELECT * FROM entities WHERE id IN (${memberIds.map(() => '?').join(',')}) AND is_active = 1`).all(...memberIds) as any[])
    : [];

  const allRels = db.prepare(`SELECT * FROM relationships WHERE is_active = 1`).all() as any[];

  const edges: GraphEdge[] = [];
  const crossCaseEdges: GraphEdge[] = [];
  const degree = new Map<string, number>();
  for (const id of memberIds) degree.set(id, 0);

  for (const r of allRels) {
    const sIn = memberSet.has(r.source_entity_id);
    const tIn = memberSet.has(r.target_entity_id);
    const edge: GraphEdge = {
      id: r.id, source: r.source_entity_id, target: r.target_entity_id,
      type: r.type, strength: r.strength, confidence: r.confidence, crossCase: !(sIn && tIn),
    };
    if (sIn && tIn) {
      edges.push(edge);
      degree.set(r.source_entity_id, (degree.get(r.source_entity_id) || 0) + 1);
      degree.set(r.target_entity_id, (degree.get(r.target_entity_id) || 0) + 1);
    } else if (sIn || tIn) {
      crossCaseEdges.push(edge);
    }
  }

  const n = entities.length;
  let centralNodeId: string | null = null;
  let maxDeg = -1;
  let maxRisk = -1;

  const nodes: GraphNode[] = entities.map((e) => {
    const deg = degree.get(e.id) || 0;
    const centrality = n > 1 ? deg / (n - 1) : 0;
    if (deg > maxDeg || (deg === maxDeg && (e.risk_score || 0) > maxRisk)) { maxDeg = deg; maxRisk = e.risk_score || 0; centralNodeId = e.id; }
    const linked = findLinkedCaseIds(e.id);
    return {
      id: e.id, type: e.type, name: e.name,
      riskScore: e.risk_score, riskLevel: e.risk_level,
      centrality: Math.round(centrality * 100) / 100,
      crossCase: linked.length > 1,
      linkedCaseCount: Math.max(0, linked.length - 1),
    };
  });

  const possible = n > 1 ? (n * (n - 1)) / 2 : 0;
  const density = possible > 0 ? Math.round((edges.length / possible) * 100) / 100 : 0;

  return { nodes, edges, crossCaseEdges, centralNodeId, density };
}
