import { getDb } from '../db/connection.js';
import { verifyChain } from './chain.js';
import { getDisplayIdentities, findLinkedCaseIds } from './identities.js';
import { buildCaseGraph } from './graph.js';

export interface Citation {
  entityId: string;
  name: string;
  type: string;
  riskScore: number;
  chainSeq: number | null;
}

export interface CopilotContext {
  scope: string;
  verified: boolean;
  chainChecked: number;
  verifyMessage: string;
  cases: any[];
  entities: any[];
  relationships: any[];
  timeline: any[];
  centralName: string | null;
}

function chainSeqFor(entityId: string, caseId: string | null): number | null {
  try {
    const db = getDb();
    const r = (caseId
      ? db.prepare(`SELECT seq FROM chain_records WHERE case_id = ? AND payload_json LIKE ? ORDER BY seq ASC LIMIT 1`).get(caseId, `%${entityId}%`)
      : db.prepare(`SELECT seq FROM chain_records WHERE payload_json LIKE ? ORDER BY seq ASC LIMIT 1`).get(`%${entityId}%`)) as { seq: number } | undefined;
    return r?.seq ?? null;
  } catch {
    return null;
  }
}

/** Live context injection: new cases/entities are readable the moment they're committed */
export function buildContext(caseId: string | undefined, viewerRole: string): CopilotContext {
  const db = getDb();
  if (caseId) {
    const caseRow = db.prepare(`SELECT * FROM cases WHERE id = ?`).get(caseId) as any;
    if (!caseRow) throw Object.assign(new Error('Case not found'), { status: 404, code: 'NOT_FOUND' });
    const v = verifyChain(caseId);
    let memberIds: string[] = [];
    try { memberIds = JSON.parse(caseRow.entity_ids_json || '[]'); } catch { memberIds = []; }
    const entities = memberIds.length
      ? (db.prepare(`SELECT * FROM entities WHERE id IN (${memberIds.map(() => '?').join(',')}) AND is_active = 1`).all(...memberIds) as any[])
      : [];
    const allRels = db.prepare(`SELECT * FROM relationships WHERE is_active = 1`).all() as any[];
    const set = new Set(memberIds);
    const relationships = allRels.filter((r) => set.has(r.source_entity_id) && set.has(r.target_entity_id));
    const timeline = db.prepare(`SELECT * FROM timeline_events WHERE case_id = ? ORDER BY created_at DESC LIMIT 10`).all(caseId) as any[];
    let centralName: string | null = null;
    try {
      const g = buildCaseGraph(caseId);
      centralName = g.nodes.find((n) => n.id === g.centralNodeId)?.name ?? null;
    } catch { /* ignore */ }
    return {
      scope: `Case ${caseRow.case_number} (${caseRow.title})`, verified: v.ok, chainChecked: v.checked,
      verifyMessage: v.message, cases: [caseRow],
      entities: entities.map((e) => ({ ...e, identifiers: getDisplayIdentities(e.id, viewerRole), linkedCases: findLinkedCaseIds(e.id) })),
      relationships, timeline, centralName,
    };
  }
  // No case scope: recent open cases + top-risk entities
  const cases = db.prepare(`SELECT * FROM cases WHERE status != 'closed' ORDER BY updated_at DESC LIMIT 5`).all() as any[];
  const entities = db.prepare(`SELECT * FROM entities WHERE is_active = 1 ORDER BY risk_score DESC LIMIT 10`).all() as any[];
  let verified = true;
  let checked = 0;
  const msgs: string[] = [];
  for (const c of cases) {
    const v = verifyChain(c.id);
    checked += v.checked;
    if (!v.ok) { verified = false; msgs.push(`${c.case_number}: ${v.message}`); }
  }
  return {
    scope: 'All open cases', verified, chainChecked: checked,
    verifyMessage: verified ? `Verified — ${checked} records intact across ${cases.length} cases` : msgs.join('; '),
    cases,
    entities: entities.map((e) => ({ ...e, identifiers: getDisplayIdentities(e.id, viewerRole), linkedCases: findLinkedCaseIds(e.id) })),
    relationships: [], timeline: [], centralName: null,
  };
}

function isHinglish(q: string): boolean {
  return /(\bkya\b|\bbatao\b|\bdikhao\b|\bkitna\b|\bkaun\b|\bkahan\b|\bkab\b|\bkaise\b|\bhain\b|\bhai\b|\bka\b|\bki\b|\bko\b)/i.test(q) || /[\u0900-\u097F]/.test(q);
}

function cite(e: any, caseId: string | null): Citation {
  return { entityId: e.id, name: e.name, type: e.type, riskScore: e.risk_score, chainSeq: chainSeqFor(e.id, caseId) };
}

export function answer(question: string, ctx: CopilotContext, caseId: string | null): {
  answer: string; language: string; citations: Citation[]; verified: boolean;
  chainChecked: number; verifyMessage: string; followUps: string[]; confidence: number;
} {
  const H = isHinglish(question);
  const lang = H ? 'hinglish' : 'en';
  const l = question.toLowerCase();
  const badge = ctx.verified ? '[hash-chain verified]' : '[UNVERIFIED — chain tamper detected]';
  const ents = ctx.entities;
  const byRisk = [...ents].sort((a, b) => b.risk_score - a.risk_score);

  const respond = (text: string, citations: Citation[], followUps: string[], confidence: number) => ({
    answer: `${badge} ${text}`, language: lang, citations, verified: ctx.verified,
    chainChecked: ctx.chainChecked, verifyMessage: ctx.verifyMessage, followUps, confidence,
  });

  if (!ctx.verified) {
    return respond(
      H ? `Is scope ka custody chain **tampered** hai — isliye verified jawab nahi de sakta. Pehle admin se Verify Entire Chain karwao.`
        : `This scope's custody chain shows **tampering** — I can't answer from unverified records. Ask an admin to run Verify Entire Chain first.`,
      [], ['Who can run Verify Entire Chain?', 'Show integrity report'], 0.95
    );
  }

  if (!ents.length) {
    return respond(
      H ? `${ctx.scope} me abhi koi verified entity nahi hai. Pehle officer se entity add karwao (phone/CNR/Aadhaar ke saath).`
        : `${ctx.scope} has no verified entities yet. Ask an officer to add entities with phone/CNR/Aadhaar identifiers.`,
      [], ['How do I add an entity?', 'What identifiers are required?'], 0.9
    );
  }

  // Kingpin / central
  if (/(kingpin|central|main suspect|mastermind|sabse bada|mukhy|most important)/.test(l)) {
    const top = ctx.centralName ? ents.find((e) => e.name === ctx.centralName) || byRisk[0] : byRisk[0];
    const linked = (top.linkedCases?.length || 1) > 1 ? ` Cross-case presence in ${top.linkedCases.length} cases.` : '';
    const text = H
      ? `**${top.name}** sabse central hai — Risk **${top.risk_score}**, network me sabse zyada connections.${linked}`
      : `**${top.name}** is the most central — risk **${top.risk_score}** with the highest connection degree in ${ctx.scope}.${linked}`;
    return respond(text, [cite(top, caseId)], ['Show money trail', `Tell me about ${top.name}`, 'Show network graph'], 0.9);
  }

  // Money trail
  if (/(money|trail|transaction|fund|paisa|financial|payment|transfer)/.test(l)) {
    const accts = ents.filter((e) => e.type === 'account');
    const finRels = ctx.relationships.filter((r) => r.type === 'transferred_to' || r.type === 'transferred_from');
    if (accts.length || finRels.length) {
      const a = accts[0];
      const text = a
        ? (H ? `**${a.name}** par flagged financial activity hai — Risk **${a.risk_score}**. ${finRels.length} transfer link(s) verified records me.`
          : `**${a.name}** shows flagged financial activity — risk **${a.risk_score}** with ${finRels.length} verified transfer link(s).`)
        : (H ? `${finRels.length} verified transfer links mile — amounts ke liye entity dossier dekho.`
          : `${finRels.length} verified transfer links found — see entity dossiers for amounts.`);
      return respond(text, [...accts.slice(0, 3).map((e) => cite(e, caseId))], ['Who is the kingpin?', 'Show network graph'], 0.8);
    }
    return respond(
      H ? `Verified records me koi financial trail nahi mila ${ctx.scope} me.` : `No financial trail in verified records for ${ctx.scope}.`,
      [], ['Who is the kingpin?', 'What entities exist?'], 0.75
    );
  }

  // Location
  if (/(harbor|warehouse|location|godown|hideout|address|kahan)/.test(l)) {
    const locs = ents.filter((e) => e.type === 'location' || e.lastKnownLocation || (e.data_json || '').toLowerCase().includes('harbor') || (e.data_json || '').toLowerCase().includes('warehouse'));
    if (locs.length) {
      const names = locs.slice(0, 3).map((e) => `**${e.name}**`).join(', ');
      return respond(
        H ? `Location signals: ${names}. Detail dossier me last-known location dekho.` : `Location signals: ${names}. See dossiers for last-known locations.`,
        locs.slice(0, 3).map((e) => cite(e, caseId)), ['Who was at this location?', 'Show timeline'], 0.8
      );
    }
    return respond(H ? `Koi location signal verified records me nahi.` : `No location signals in verified records.`, [], ['What entities exist?'], 0.7);
  }

  // Simulate / arrest impact (read-only estimate from live graph)
  if (/(simulate|arrest|detention|remove|hatana|pakdo|impact|warrant)/.test(l)) {
    if (caseId && ctx.centralName) {
      const g = buildCaseGraph(caseId);
      const text = H
        ? `Agar **${ctx.centralName}** hatao: ${g.edges.length} links tootenge, density ${g.density} se giregi. Recommendation: warrant + associates par nazar.`
        : `Removing **${ctx.centralName}**: ${g.edges.length} links break, density ${g.density} drops. Recommendation: prioritize warrant, monitor associates.`;
      const central = ents.find((e) => e.name === ctx.centralName);
      return respond(text, central ? [cite(central, caseId)] : [], ['Who is the kingpin?', 'Show money trail'], 0.75);
    }
    const top = byRisk[0];
    return respond(`Top-risk entity is **${top.name}** (${top.risk_score}). Open a case scope for removal simulation.`, [cite(top, caseId)], ['Who is the kingpin?'], 0.6);
  }

  // IDs
  if (/(fir|cnr|criminal id|aadhaar|phone number|case number)/.test(l)) {
    const withIds = ents.filter((e) => (e.identifiers || []).length > 0).slice(0, 5);
    if (withIds.length) {
      const lines = withIds.map((e) => `**${e.name}**: ${(e.identifiers || []).map((i: any) => `${i.idType}=${i.value}`).join(', ')}`).join(' | ');
      return respond(`Verified IDs — ${lines}`, withIds.map((e) => cite(e, caseId)), ['Tell me about the top suspect'], 0.85);
    }
  }

  // Risk overview
  if (/(risk|score|threat|khatra)/.test(l)) {
    const line = byRisk.slice(0, 5).map((e) => `${e.name} ${e.risk_score}`).join(', ');
    return respond(
      H ? `Risk scores (verified): ${line}. Har score ke peeche ke signals entity risk view me dekho.` : `Risk scores (verified): ${line}. See each entity's risk view for contributing signals.`,
      byRisk.slice(0, 3).map((e) => cite(e, caseId)), ['Who is the kingpin?', 'Why is the top score high?'], 0.85
    );
  }

  // Timeline
  if (/(timeline|activity|recent|happened|kab hua)/.test(l)) {
    if (ctx.timeline.length) {
      const ev = ctx.timeline.slice(0, 3).map((t) => `${t.title}`).join('; ');
      return respond(`Recent verified activity: ${ev}.`, [], ['Show money trail', 'Who is the kingpin?'], 0.8);
    }
    return respond(`No timeline events in this scope yet.`, [], ['What entities exist?'], 0.7);
  }

  // Case summary
  if (/(operation|nightfall|case|summary|overview)/.test(l)) {
    const c = ctx.cases[0];
    const text = c
      ? `**${c.title}** (${c.case_number}) — ${c.status}, priority ${c.priority}. ${ents.length} verified entities, ${ctx.relationships.length} links. Central: **${ctx.centralName || byRisk[0]?.name || '—'}**.`
      : `${ctx.scope}: ${ents.length} verified entities.`;
    return respond(text, byRisk.slice(0, 2).map((e) => cite(e, caseId)), ['Who is the kingpin?', 'Show timeline'], 0.85);
  }

  // Direct entity name hit
  const hit = ents.find((e) => l.includes(e.name.toLowerCase().split(' ')[0]) && e.name.split(' ')[0].length > 2);
  if (hit) {
    let prof: any = {};
    try { prof = JSON.parse(hit.data_json || '{}'); } catch { prof = {}; }
    const text = `**${hit.name}** (${hit.type}) — risk **${hit.risk_score}**. ${prof.background || ''} ${prof.lastKnownLocation ? `Last seen: ${prof.lastKnownLocation}.` : ''}`;
    return respond(text.trim(), [cite(hit, caseId)], ['Who is the kingpin?', 'Show money trail'], 0.9);
  }

  // Help
  if (/(help|what can|kya kar|kaise)/.test(l)) {
    return respond(
      H ? `Pucho: "Kingpin kaun hai?", "Paise ka trail?", "Risk scores?", "Timeline?" — jawab sirf verified records se.` : `Ask: "Who is the kingpin?", "Show money trail", "Risk scores?", "Recent timeline?" — answers come only from verified records.`,
      [], ['Who is the kingpin?', 'Show money trail'], 0.9
    );
  }

  return respond(
    H ? `Samjha: "${question}" — ye verified records me seedha nahi mila. Kingpin, money trail, risk ya timeline pucho.` : `Understood: "${question}" — not directly in verified records. Try kingpin, money trail, risk, or timeline.`,
    [], ['Who is the kingpin?', 'Show money trail', 'Risk scores?'], 0.4
  );
}
