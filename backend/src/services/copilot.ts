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

/** Full-name match first ("mobile y-29"), then first-token match ("pratik"). */
function nameHit(ents: any[], l: string): any | null {
  const full = ents.find((e) => l.includes(String(e.name).toLowerCase()));
  if (full) return full;
  return ents.find((e) => { const f = String(e.name).split(' ')[0]; return f.length > 2 && l.includes(f.toLowerCase()); }) || null;
}

function signalsOf(e: any): Array<{ label: string; points: number; detail: string }> {
  try {
    const p = JSON.parse(e.data_json || '{}');
    return (p.riskExplanation && p.riskExplanation.signals) || [];
  } catch { return []; }
}

function profileOf(e: any): any {
  try { return JSON.parse(e.data_json || '{}'); } catch { return {}; }
}

const REL_WORD: Record<string, string> = {
  associated_with: 'associated', family_of: 'family', met_with: 'met with', calls: 'calls with',
  owns: 'owns', co_located: 'seen at', transferred_to: 'paid', transferred_from: 'received from',
};

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
  const names = new Map<string, string>(ents.map((e: any) => [e.id, e.name]));
  const linksOf = (id: string) => ctx.relationships
    .filter((r) => r.source_entity_id === id || r.target_entity_id === id)
    .map((r) => ({
      other: names.get(r.source_entity_id === id ? r.target_entity_id : r.source_entity_id) || '?',
      type: r.type, strength: r.strength,
    }));
  const linkLine = (lk: { other: string; type: string; strength: number }) =>
    `${REL_WORD[lk.type] || lk.type} **${lk.other}** (${lk.strength}%)`;

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
      H ? `${ctx.scope} me abhi koi verified entity nahi hai. Pehle officer se Entities tab se entity add karwao (location/vehicle ke liye auto-reference ban jata hai).`
        : `${ctx.scope} has no verified entities yet. Ask an officer to add entities from the Entities tab.`,
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

  // Locations — named place detail, "X kahan hai?", or full place list
  if (/(location|godown|hideout|address|kahan|pata|thikana|jagah|sthan|place)/.test(l)) {
    const places = ents.filter((e) => e.type === 'location');
    const placeHit = places.find((e) => l.includes(String(e.name).toLowerCase()));
    if (placeHit) {
      const prof = profileOf(placeHit);
      const visitors = ctx.relationships
        .filter((r) => (r.source_entity_id === placeHit.id || r.target_entity_id === placeHit.id) && r.type === 'co_located')
        .map((r) => names.get(r.source_entity_id === placeHit.id ? r.target_entity_id : r.source_entity_id))
        .filter(Boolean);
      let text = `**${placeHit.name}** (risk ${placeHit.risk_score}%).${prof.background ? ` ${prof.background}` : ''}`;
      if (visitors.length) text += (H ? ` Yahan dekhe gaye: ` : ` Seen here: `) + visitors.map((v) => `**${v}**`).join(', ') + '.';
      return respond(text, [cite(placeHit, caseId)], ['Show timeline', 'Who is the kingpin?'], 0.9);
    }
    const personHit = ents.filter((e) => e.type === 'person').find((e) => l.includes(String(e.name).toLowerCase()) || l.includes(String(e.name).split(' ')[0].toLowerCase()));
    if (personHit) {
      const prof = profileOf(personHit);
      const spots = ctx.relationships
        .filter((r) => (r.source_entity_id === personHit.id || r.target_entity_id === personHit.id) && r.type === 'co_located')
        .map((r) => names.get(r.source_entity_id === personHit.id ? r.target_entity_id : r.source_entity_id))
        .filter(Boolean);
      let text = `**${personHit.name}**${prof.lastKnownLocation ? (H ? ` — last location: **${prof.lastKnownLocation}**` : ` — last location: **${prof.lastKnownLocation}**`) : ''}`;
      if (spots.length) text += (H ? `. In jagahon par dekha gaya: ` : `. Spotted at: `) + spots.map((s) => `**${s}**`).join(', ');
      return respond(text + '.', [cite(personHit, caseId)], [`Tell me about ${personHit.name}`, 'Show timeline'], 0.9);
    }
    if (places.length) {
      return respond(
        H ? `Is case ki jagahen: ${places.map((e) => `**${e.name}**`).join(', ')}.` : `Places in this case: ${places.map((e) => `**${e.name}**`).join(', ')}.`,
        places.slice(0, 5).map((e) => cite(e, caseId)), ['Show timeline', 'Who is the kingpin?'], 0.85);
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

  // Risk overview (+ top entity's reasons inline) — reason-questions go to the why-branch below
  if (/(risk|score|threat|khatra)/.test(l) && !/(kyu|kyun|why|reason|wajah|kaaran)/.test(l)) {
    const line = byRisk.slice(0, 5).map((e) => `${e.name} ${e.risk_score}`).join(', ');
    const topSigs = signalsOf(byRisk[0]);
    const whyLine = topSigs.length ? (H ? ` Top — **${byRisk[0].name}**: ` : ` Top — **${byRisk[0].name}**: `) + topSigs.map((s) => `+${s.points} ${s.label}`).join(', ') + '.' : '';
    return respond(
      (H ? `Risk scores (verified): ${line}.` : `Risk scores (verified): ${line}.`) + whyLine,
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
  if (/(operation|case|summary|overview|mukadma)/.test(l)) {
    const c = ctx.cases[0];
    const text = c
      ? `**${c.title}** (${c.case_number}) — ${c.status}, priority ${c.priority}. ${ents.length} verified entities, ${ctx.relationships.length} links. Central: **${ctx.centralName || byRisk[0]?.name || '—'}**.`
      : `${ctx.scope}: ${ents.length} verified entities.`;
    return respond(text, byRisk.slice(0, 2).map((e) => cite(e, caseId)), ['Who is the kingpin?', 'Show timeline'], 0.85);
  }

  // Connection between two named entities ("pratik aur durgesh ka connection?")
  if (/(connection|relation|link|rishta|sambandh|taalluk)/.test(l) || /(aur|and|vs)\b/.test(l)) {
    const found = ents.filter((e) => l.includes(String(e.name).toLowerCase()) || l.includes(String(e.name).split(' ')[0].toLowerCase()));
    if (found.length >= 2) {
      const [a, b] = found;
      const direct = ctx.relationships.find((r) =>
        (r.source_entity_id === a.id && r.target_entity_id === b.id) ||
        (r.source_entity_id === b.id && r.target_entity_id === a.id));
      if (direct) {
        const text = H
          ? `**${a.name}** aur **${b.name}** me seedha link hai — ${REL_WORD[direct.type] || direct.type} (${direct.strength}%).`
          : `Direct link: **${a.name}** ${REL_WORD[direct.type] || direct.type} **${b.name}** (${direct.strength}%).`;
        return respond(text, [cite(a, caseId), cite(b, caseId)], [`Tell me about ${a.name}`, 'Who is the kingpin?'], 0.9);
      }
      return respond(
        H ? `**${a.name}** aur **${b.name}** me koi seedha verified link nahi — dono ${ctx.scope} me hain.` : `No direct verified link between **${a.name}** and **${b.name}** — both are in ${ctx.scope}.`,
        [cite(a, caseId), cite(b, caseId)], ['Who is the kingpin?', 'Show network graph'], 0.85);
    }
  }

  // Why / reason behind a risk score ("lava ka risk kyu hai?")
  if (/(kyu|kyun|why|reason|wajah|kaaran|kaise|kaise bana|explain)/.test(l)) {
    const target = nameHit(ents, l) || byRisk[0];
    const sigs = signalsOf(target);
    if (sigs.length) {
      const lines = sigs.map((s) => `+${s.points} ${s.label} — ${s.detail}`).join('; ');
      const text = H
        ? `**${target.name}** ka risk **${target.risk_score}%** isliye: ${lines}.`
        : `**${target.name}** scores **${target.risk_score}%** because: ${lines}.`;
      return respond(text, [cite(target, caseId)], [`Tell me about ${target.name}`, 'Risk scores?'], 0.9);
    }
    return respond(
      H ? `**${target.name}** ka risk **${target.risk_score}%** base monitoring score hai — abhi koi strong signal nahi.` : `**${target.name}** at **${target.risk_score}%** is a base monitoring score — no strong signals yet.`,
      [cite(target, caseId)], ['Risk scores?'], 0.8);
  }

  // Counts ("kitne persons hain?", "how many mobiles?")
  if (/(kitne|kitni|how many|count|total|number of)/.test(l)) {
    const t = /(mobile|phone|device|handset|sim)/.test(l) ? 'device'
      : /(gaadi|vehicle|bike|car|bullet|activa|platina|splendor)/.test(l) ? 'vehicle'
      : /(vyakti|log|person|suspect|aaropi|accused)/.test(l) ? 'person'
      : /(jagah|place|location|thikana)/.test(l) ? 'location' : null;
    if (t) {
      const list = ents.filter((e) => e.type === t);
      const text = H
        ? `${ctx.scope} me **${list.length} ${t}s** hain: ${list.map((e) => e.name).join(', ') || '—'}.`
        : `${ctx.scope} has **${list.length} ${t}s**: ${list.map((e) => e.name).join(', ') || '—'}.`;
      return respond(text, list.slice(0, 5).map((e) => cite(e, caseId)), ['Who is the kingpin?', 'Risk scores?'], 0.9);
    }
    const byType = ['person', 'device', 'vehicle', 'location'].map((t) => `${ents.filter((e) => e.type === t).length} ${t}s`).join(', ');
    return respond(H ? `${ctx.scope} me kul **${ents.length}** entities: ${byType}.` : `${ctx.scope}: **${ents.length}** entities — ${byType}.`,
      byRisk.slice(0, 2).map((e) => cite(e, caseId)), ['Who is the kingpin?'], 0.9);
  }

  // Devices / mobiles ("saare mobiles dikhao", "lava kis ka hai?", "y-29 ke baare me")
  if (/(mobile|phone|device|handset|sim|imei)/.test(l)) {
    const devs = ents.filter((e) => e.type === 'device' || e.type === 'phone');
    const exact = devs.find((e) => l.includes(String(e.name).toLowerCase()));
    if (exact) {
      const ownerRels = ctx.relationships.filter((r) => (r.source_entity_id === exact.id || r.target_entity_id === exact.id) && r.type === 'owns');
      const ownerNames = ownerRels.map((r) => names.get(r.source_entity_id === exact.id ? r.target_entity_id : r.source_entity_id)).filter(Boolean);
      const text = H
        ? `**${exact.name}** (risk ${exact.risk_score}%)${ownerNames.length ? ` — **${ownerNames.join(', ')}** ka hai` : ''}. ${profileOf(exact).background || ''}`.trim()
        : `**${exact.name}** (risk ${exact.risk_score}%)${ownerNames.length ? ` — owned by **${ownerNames.join(', ')}**` : ''}. ${profileOf(exact).background || ''}`.trim();
      return respond(text, [cite(exact, caseId)], ['Show all mobiles', 'Who is the kingpin?'], 0.9);
    }
    if (devs.length) {
      const text = H
        ? `Is case ke mobiles: ${devs.map((e) => `**${e.name}** (${e.risk_score}%)`).join(', ')}.`
        : `Mobiles in this case: ${devs.map((e) => `**${e.name}** (${e.risk_score}%)`).join(', ')}.`;
      return respond(text, devs.slice(0, 6).map((e) => cite(e, caseId)), ['Who is the kingpin?', 'Risk scores?'], 0.85);
    }
  }

  // Vehicles ("gaadiyan kaun si hain?")
  if (/(vehicle|gaadi|gaadiyan|bike|car|bullet|activa|platina|splendor|truck)/.test(l)) {
    const vehs = ents.filter((e) => e.type === 'vehicle');
    if (vehs.length) {
      const text = H
        ? `Is case ki gaadiyan: ${vehs.map((e) => `**${e.name}** (${e.risk_score}%)`).join(', ')}.`
        : `Vehicles in this case: ${vehs.map((e) => `**${e.name}** (${e.risk_score}%)`).join(', ')}.`;
      return respond(text, vehs.slice(0, 6).map((e) => cite(e, caseId)), ['Who is the kingpin?'], 0.85);
    }
    return respond(H ? `Is case me koi verified vehicle nahi hai.` : `No verified vehicles in this case.`, [], ['What entities exist?'], 0.75);
  }

  // Persons ("saare suspects kaun hain?", "pratik ke baare me")
  if (/(vyakti|suspect|aaropi|accused|persons|people|members)/.test(l)) {
    const ps = ents.filter((e) => e.type === 'person');
    if (ps.length) {
      const text = H
        ? `Is case ke persons: ${ps.map((e) => `**${e.name}** (${e.risk_score}%)`).join(', ')}.`
        : `Persons in this case: ${ps.map((e) => `**${e.name}** (${e.risk_score}%)`).join(', ')}.`;
      return respond(text, ps.slice(0, 6).map((e) => cite(e, caseId)), ['Who is the kingpin?', 'Risk scores?'], 0.85);
    }
  }

  // Direct entity name hit
  const hit = nameHit(ents, l);
  if (hit) {
    const prof = profileOf(hit);
    const lks = linksOf(hit.id).slice(0, 5);
    const sigs = signalsOf(hit);
    let text = `**${hit.name}** (${hit.type}) — risk **${hit.risk_score}**. ${(prof.background || '').trim()}${prof.lastKnownLocation ? ` Last seen: ${prof.lastKnownLocation}.` : ''}`;
    if (lks.length) text += (H ? ` Links: ` : ` Links: `) + lks.map(linkLine).join('; ') + '.';
    if (sigs.length) text += (H ? ` Risk kyu: ` : ` Why: `) + sigs.map((s) => `+${s.points} ${s.label}`).join(', ') + '.';
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
