/* NexusAI Live Ops — backend-wired Cases, Approvals, Entities, Dossier.
   Layers over app.js mock flows; mock stays as offline fallback ONLY.
   Case architecture: every piece of investigation data is scoped by caseId.
   No global/shared state for case-specific data — per-case bundle cache. */
(function () {
  if (document.querySelector('#login-form')) return;
  const box = window.__nexusLive;
  const toastEl = document.querySelector('#toast');
  function say(m) { if (!toastEl) return; toastEl.textContent = m; toastEl.classList.add('show'); clearTimeout(say._t); say._t = setTimeout(() => toastEl.classList.remove('show'), 2600); }
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  function fmtTime(iso) { try { const d = new Date(iso); return d.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); } catch (e) { return iso; } }

  const F = (window.__nexusFinal || {});
  const openDrawer = F.openDrawer || function (id) { document.getElementById(id)?.classList.add('open'); const o = document.querySelector('#drawer-overlay'); if (o) o.hidden = false; };
  const closeDrawers = F.closeDrawers || function () { document.querySelectorAll('.side-drawer').forEach(d => d.classList.remove('open')); };

  if (!box || !box.token) {
    const cl = document.querySelector('#cases-list'); if (cl) cl.innerHTML = '<div class="muted" style="font-size:12px">Offline — open via backend (port 4001) to manage live cases.</div>';
    try { document.querySelector('#live-hide-networkbody')?.remove(); setScrubberLive(false); } catch (e) { /* demo keeps its own map */ }
    return;
  }
  const api = box.api;
  let ME = { role: 'police', name: '' };
  try { ME = JSON.parse(localStorage.getItem('nexus-user') || '{}'); } catch (e) { /* ignore */ }
  const canWrite = ME.role === 'officer' || ME.role === 'admin';

  async function call(path, opts) {
    const r = await api(path, opts);
    if (!r.ok) { const msg = (r.body && r.body.error && r.body.error.message) || ('HTTP ' + r.status); throw new Error(msg); }
    return r.body.data;
  }

  /* ---------- per-case store (no global shared case data) ---------- */
  let activeCaseId = null;
  try { activeCaseId = localStorage.getItem('nexus-case') || null; } catch (e) { /* ignore */ }
  let caseMap = {};
  let liveReady = false; // true once backend cases fetched — mock becomes offline-only
  const bundleCache = new Map(); // caseId -> { detail, entities, timeline, graph }
  const bundleInflight = new Map();

  function isLiveActive() { return !!(box.token && liveReady && activeCaseId && caseMap[activeCaseId]); }
  function getActiveCaseId() { return activeCaseId; }

  function emitActiveCase() {
    try { if (activeCaseId) localStorage.setItem('nexus-case', activeCaseId); } catch (e) { /* ignore */ }
    // keep app.js copilot/verify/certificate on the same case (it closes over its own id)
    try {
      if (box) box.caseId = () => activeCaseId;
      window.dispatchEvent(new CustomEvent('nexus:active-case', { detail: { caseId: activeCaseId } }));
    } catch (e) { /* ignore */ }
  }

  function statusBadge(s) { return `<span class="st st-${esc(s)}">${esc(s.replace('_', ' '))}</span>`; }

  function ensureLiveStyles() {
    if (document.querySelector('#live-isolation-css')) return;
    const st = document.createElement('style');
    st.id = 'live-isolation-css';
    st.textContent = '.live-hide{display:none!important}.live-block{border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-top:10px;background:rgba(255,255,255,.02)}'
      + '.kvline{display:flex;justify-content:space-between;gap:10px;font-size:12px;padding:3px 0}.kvline span:first-child{color:var(--muted)}'
      + '.live-bar{display:flex;align-items:center;gap:8px;margin-bottom:8px}.why-list{margin:8px 0 0;padding-left:18px;font-size:12px;display:grid;gap:4px}';
    document.head.appendChild(st);
  }
  ensureLiveStyles();

  function activeCase() { return caseMap[activeCaseId] || null; }

  /* ---------- cases list ---------- */
  function renderCasesList(cases) {
    const list = document.querySelector('#cases-list'); if (!list) return;
    const cc = document.querySelector('#cases-count'); if (cc) cc.textContent = String(cases.length).padStart(2, '0');
    list.innerHTML = cases.map(c => {
      const n = (c.entityIds || []).length;
      return `<button type="button" class="entity-row case-row${c.id === activeCaseId ? ' selected' : ''}" data-case="${c.id}"><span><b>${esc(c.case_number)} · ${esc(c.title)}</b><small>FIR:${esc(c.fir_number || '-') } CNR:${esc(c.cnr_number || '-') } · ${n} entities · ${esc(c.priority)}</small></span><span>${statusBadge(c.status)}</span></button>`;
    }).join('') || '<div class="muted" style="font-size:12px">No cases yet — create one above.</div>';
    list.querySelectorAll('[data-case]').forEach(b => b.addEventListener('click', () => { void setActiveCase(b.dataset.case); }));
  }

  async function refreshCases() {
    const list = document.querySelector('#cases-list');
    let cases = [];
    try { cases = await call('/api/cases?limit=50'); }
    catch (e) { if (list) list.innerHTML = `<div class="muted" style="font-size:12px">Cases unavailable: ${esc(e.message)}</div>`; return; }
    caseMap = {}; cases.forEach(c => { caseMap[c.id] = c; });
    if (!activeCaseId || !caseMap[activeCaseId]) {
      // Respect the officer's last selection; otherwise open the most
      // recently updated open case — never force a hardcoded demo case.
      const open = cases.filter(c => c.status === 'active' || c.status === 'open');
      const pool = open.length ? open : cases;
      const pick = pool[0] || cases.find(c => c.case_number === 'NTF-042') || cases[0];
      if (pick) activeCaseId = pick.id;
    }
    liveReady = true;
    emitActiveCase();
    renderCasesList(cases);
    paintActiveCase();
    refreshApprovalsBadge();
    // keep the visible views truthful for the (possibly restored) active case
    void renderAllForActiveCase().catch(() => { /* leave mock fallback */ });
  }

  function paintActiveCase() {
    const c = caseMap[activeCaseId]; if (!c) return;
    const t = document.querySelector('#active-case-title'); if (t) t.textContent = c.title;
    const n = document.querySelector('#active-case-no'); if (n) n.textContent = c.case_number;
    const s = document.querySelector('#active-case-status'); if (s) s.textContent = c.status;
    const l = document.querySelector('#active-case-line'); if (l) l.innerHTML = `Active: <b>${esc(c.case_number)}</b> ${statusBadge(c.status)}`;
    const eb = document.querySelector('.topbar .eyebrow'); if (eb) eb.textContent = `Case workspace · #${c.case_number}`;
    try { localStorage.setItem('nexus-case', c.id); } catch (e) { /* ignore */ }
    const cb = document.querySelector('#close-request-btn'); if (cb) cb.disabled = (c.status === 'closed');
    const sub = document.querySelector('#view-reports .card-subtitle');
    if (sub) sub.textContent = `${c.title} ${c.case_number} | ${c.fir_number || 'no FIR'} | ${c.cnr_number || 'no CNR'}`;
    const mh = document.querySelector('#report-modal-title'); if (mh) mh.textContent = 'Overall Case Report - ' + c.title;
    const ms = document.querySelector('#report-modal-sub'); if (ms) ms.textContent = `${c.case_number} | ${c.fir_number || 'no FIR'} | ${c.cnr_number || 'no CNR'} | live verified records`;
    const adt = document.querySelector('#activity-drawer-title'); if (adt) adt.textContent = 'Activity Log - ' + c.case_number;
    const asub = document.querySelector('#activity-sub'); if (asub) asub.textContent = 'Recent activity in ' + c.case_number;
  }

  /* Open + switch: validated, immediate, per-case. Returns false when id unknown. */
  async function setActiveCase(id, opts) {
    if (!id) { say('No case selected'); return false; }
    if (!caseMap[id]) {
      try { await refreshCases(); } catch (e) { /* ignore */ }
      if (!caseMap[id]) { say('Case not found — it may have been removed'); return false; }
    }
    const changed = activeCaseId !== id;
    activeCaseId = id;
    bundleCache.delete(id); // always re-read the newly opened case (no stale flash)
    emitActiveCase();
    try { document.querySelector('#detail-panel')?.classList.remove('open'); } catch (e) { /* ignore */ }
    closeDrawers(); paintActiveCase();
    try { await renderAllForActiveCase(); }
    catch (e) { say('Opened case, but live refresh failed: ' + e.message); }
    try {
      const cases = Object.values(caseMap);
      renderCasesList(cases);
      paintActiveCase();
    } catch (e) { /* ignore */ }
    if (changed) say('Switched to ' + (caseMap[id] ? caseMap[id].case_number : 'case'));
    if (opts && opts.fresh) startFreshEntityFlow();
    return true;
  }

  /* New case starts with its own empty state + entity flow — never inherits demo data. */
  function startFreshEntityFlow() {
    try {
      if (window.__nexusTabs && window.__nexusTabs.showView) window.__nexusTabs.showView('entities');
      else {
        document.querySelectorAll('main .view').forEach(v => { v.hidden = true; v.classList.remove('active'); });
        const s = document.querySelector('.stats.view-overview'); if (s) { s.hidden = false; s.classList.add('active'); }
        document.querySelectorAll('#view-entities').forEach(v => { v.hidden = false; v.classList.add('active'); });
      }
    } catch (e) { /* ignore */ }
    void renderLiveEntities().catch(() => {});
    try {
      const form = document.querySelector('#entity-new-form');
      const toggle = document.querySelector('#entity-new-toggle');
      if (form && toggle && canWrite) { form.hidden = false; }
      setTimeout(() => { document.querySelector('#ne-name')?.focus(); }, 120);
    } catch (e) { /* ignore */ }
    say('New case opened — add its first entity below');
  }

  /* ---------- per-case bundle (entities + timeline + graph + detail) ---------- */
  async function fetchBundle(caseId) {
    if (!caseId) throw new Error('No active case');
    if (bundleCache.has(caseId)) return bundleCache.get(caseId);
    if (bundleInflight.has(caseId)) return bundleInflight.get(caseId);
    const p = (async () => {
      const [entities, timeline, graph] = await Promise.all([
        call(`/api/entities?caseId=${caseId}&limit=100`).catch(() => []),
        call(`/api/cases/${caseId}/timeline`).catch(() => []),
        call(`/api/graph/cases/${caseId}`).catch(() => ({ nodes: [], edges: [], crossCaseEdges: [], centralNodeId: null, density: 0, counts: { nodes: 0, edges: 0, crossCaseEdges: 0 } })),
      ]);
      let detail = null;
      try { detail = await call(`/api/cases/${caseId}`); if (detail && detail.id) caseMap[caseId] = { ...caseMap[caseId], ...detail, entityIds: detail.entityIds || detail.entity_ids_json || caseMap[caseId].entityIds }; } catch (e) { /* keep list row */ }
      const bundle = { detail, entities: entities || [], timeline: timeline || [], graph };
      bundleCache.set(caseId, bundle);
      bundleInflight.delete(caseId);
      return bundle;
    })();
    bundleInflight.set(caseId, p);
    return p;
  }

  async function renderAllForActiveCase() {
    if (!activeCaseId || !caseMap[activeCaseId]) return;
    const bundle = await fetchBundle(activeCaseId);
    paintActiveCase();
    setScrubberLive(true); // temporal replay is a static-demo toy — hide it on live cases
    renderLiveEntitiesFrom(bundle);
    renderLiveActivityFrom(bundle);
    renderLiveGraphFrom(bundle);
    renderLiveRiskFrom(bundle);
    renderLiveOverviewFrom(bundle);
    renderLiveReportFrom(bundle);
    renderLiveStatsFrom(bundle);
    renderLiveBriefFrom(bundle);
    renderLiveCopilotFrom(bundle);
    renderLiveSimFrom(bundle);
    renderLiveDrawersFrom(bundle);
  }

  function setScrubberLive(on) {
    const sc = document.querySelector('#scrubber'); if (sc) sc.style.display = on ? 'none' : '';
  }

  /* ---------- create case ---------- */
  const nt = document.querySelector('#case-new-toggle');
  const nf = document.querySelector('#case-new-form');
  if (nt && nf) {
    if (!canWrite) nt.hidden = true;
    nt.addEventListener('click', () => { nf.hidden = !nf.hidden; });
    nf.addEventListener('submit', async (e) => {
      e.preventDefault();
      const err = document.querySelector('#nc-error'); if (err) err.textContent = '';
      const body = {
        title: document.querySelector('#nc-title').value.trim(),
        description: document.querySelector('#nc-desc').value.trim(),
        firNumber: document.querySelector('#nc-fir').value.trim() || null,
        cnrNumber: document.querySelector('#nc-cnr').value.trim() || null,
        priority: document.querySelector('#nc-priority').value,
        tags: document.querySelector('#nc-tags').value.split(',').map(s => s.trim()).filter(Boolean),
      };
      try {
        const created = await call('/api/cases', { method: 'POST', body: JSON.stringify(body) });
        if (!created || !created.id) throw new Error('Create returned no case id');
        nf.reset(); nf.hidden = true;
        await refreshCases();
        const ok = await setActiveCase(created.id, { fresh: true });
        say(ok ? 'Case ' + created.case_number + ' created — opened' : 'Case ' + created.case_number + ' created');
      } catch (ex) { if (err) err.textContent = ex.message; else say(ex.message); }
    });
  }

  /* ---------- close request ---------- */
  const crb = document.querySelector('#close-request-btn');
  if (crb) {
    if (!canWrite) crb.hidden = true;
    crb.addEventListener('click', async () => {
      const reason = document.querySelector('#close-reason').value.trim();
      if (reason.length < 5) { say('Close reason min 5 chars'); return; }
      try {
        await call(`/api/cases/${activeCaseId}/close-request`, { method: 'POST', body: JSON.stringify({ reason }) });
        document.querySelector('#close-reason').value = '';
        say('Close requested — second officer must approve');
        bundleCache.delete(activeCaseId);
        refreshApprovals(); refreshApprovalsBadge();
        void renderAllForActiveCase().catch(() => {});
      } catch (e) { say(e.message); }
    });
  }

  /* ---------- approvals ---------- */
  async function refreshApprovalsBadge() {
    const b = document.querySelector('#approvals-badge'); if (!b) return;
    try {
      const p = await call('/api/approvals?status=pending');
      const n = (p || []).length;
      b.hidden = n === 0; b.textContent = String(n);
      const c = document.querySelector('#approvals-count'); if (c) c.textContent = String(n);
    } catch (e) { /* ignore */ }
  }
  async function refreshApprovals() {
    const list = document.querySelector('#approvals-list'); if (!list) return;
    let rows = [];
    try { rows = await call('/api/approvals?status=pending'); }
    catch (e) { list.innerHTML = `<div class="muted" style="font-size:12px">Unavailable: ${esc(e.message)}</div>`; return; }
    if (!rows.length) { list.innerHTML = '<div class="muted" style="font-size:12px">No pending approvals. Sensitive actions will appear here.</div>'; return; }
    list.innerHTML = rows.map(a => {
      const cn = (caseMap[a.case_id] && caseMap[a.case_id].case_number) || (a.case_id || '').slice(0, 8);
      const mine = ME.sub && a.requested_by === ME.sub;
      const dis = (!canWrite || mine) ? 'disabled' : '';
      const why = mine ? ' (you requested — another officer must decide)' : (!canWrite ? ' (officer/admin only)' : '');
      return `<div class="entity-row" style="cursor:default"><span><b>${esc(a.action.replace('_', ' '))} · ${esc(cn)}</b><small>${esc(a.reason || '')}${esc(why)}</small></span><span style="display:flex;gap:6px"><button class="mini-btn" data-decide="approved" data-id="${a.id}" ${dis}>Approve</button><button class="mini-btn" data-decide="rejected" data-id="${a.id}" ${dis}>Reject</button></span></div>`;
    }).join('');
    list.querySelectorAll('[data-decide]').forEach(b => b.addEventListener('click', async () => {
      try {
        await call(`/api/approvals/${b.dataset.id}/decide`, { method: 'POST', body: JSON.stringify({ decision: b.dataset.decide }) });
        say('Approval ' + b.dataset.decide);
        bundleCache.clear();
        refreshApprovals(); refreshApprovalsBadge(); refreshCases();
      } catch (e) { say(e.message); }
    }));
  }

  /* ---------- live entities tab (per case) ---------- */
  function probCls(s) { return s >= 75 ? 'high' : (s >= 45 ? 'med' : 'low'); }
  function ensureEntityBar() {
    if (document.querySelector('#live-entity-bar')) return;
    const wrap = document.querySelector('#view-entities .entity-table-wrap'); if (!wrap) return;
    const bar = document.createElement('div');
    bar.id = 'live-entity-bar'; bar.className = 'live-bar';
    bar.innerHTML = `<span class="tag" id="live-ent-tag">LIVE</span><span class="muted" id="live-ent-note" style="font-size:11px"></span><button class="mini-btn" id="entity-new-toggle" type="button" style="margin-left:auto">+ Add Entity</button>`;
    wrap.parentElement.insertBefore(bar, wrap);
    const form = document.createElement('form');
    form.id = 'entity-new-form'; form.className = 'live-form'; form.hidden = true;
    form.innerHTML = `<div class="live-row"><label>Type<select id="ne-type" class="search"><option>person</option><option>phone</option><option>device</option><option>location</option><option>vehicle</option><option>account</option><option>organization</option><option>document</option><option>ip_address</option><option>email</option><option>crypto_wallet</option></select></label><label>Name<input id="ne-name" class="search" maxlength="200" placeholder="Full name" required></label></div>
      <div class="live-row"><label>Phone<input id="ne-phone" class="search" maxlength="30" placeholder="required unless CNR/Aadhaar"></label><label>CNR<input id="ne-cnr" class="search" maxlength="50"></label></div>
      <div class="live-row"><label>Aadhaar (12-digit)<input id="ne-aadhaar" class="search" maxlength="20" inputmode="numeric"></label><label>FIR<input id="ne-fir" class="search" maxlength="50"></label></div>
      <div class="live-row"><label>Criminal ID<input id="ne-criminal" class="search" maxlength="50"></label><label>Last location<input id="ne-loc" class="search" maxlength="500"></label></div>
      <label>Background<textarea id="ne-bg" class="search" style="width:100%" rows="2" maxlength="5000"></textarea></label>
      <div class="live-row"><label>Call record<input id="ne-call" class="search" maxlength="500"></label><label>Vehicles (comma)<input id="ne-veh" class="search" maxlength="300"></label></div>
      <button class="primary" type="submit" style="margin-top:4px">Add entity (ID-validated)</button><div class="form-error" id="ne-error" aria-live="polite"></div><div id="ne-dup" style="margin-top:8px"></div>`;
    bar.parentElement.insertBefore(form, wrap);
    if (!canWrite) { document.querySelector('#entity-new-toggle').hidden = true; }
    document.querySelector('#entity-new-toggle').addEventListener('click', () => { form.hidden = !form.hidden; });
    document.querySelector('#ne-type').addEventListener('change', (ev) => {
      const t = ev.target.value;
      const cnr = document.querySelector('#ne-cnr');
      if (cnr) cnr.placeholder = (t === 'location' || t === 'vehicle') ? 'blank = auto REF' : '';
    });
    form.addEventListener('submit', submitEntity);
  }
  async function submitEntity(e) {
    e.preventDefault();
    const err = document.querySelector('#ne-error'); err.textContent = '';
    document.querySelector('#ne-dup').innerHTML = '';
    const v = (id) => document.querySelector(id).value.trim();
    const type = v('#ne-type'), name = v('#ne-name');
    // Places/vehicles rarely have a phone/CNR/Aadhaar handy — file them under
    // a deterministic case-scoped reference (REF-<CASENO>-<NAME>) so creation
    // never hard-errors. Same place in another case hits the normal
    // duplicate flow and can be linked instead of duplicated.
    let cnr = v('#ne-cnr');
    if (!v('#ne-phone') && !cnr && !v('#ne-aadhaar') && (type === 'location' || type === 'vehicle')) {
      const slug = (name || '').toUpperCase().replace(/[^A-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 20) || 'SITE';
      const cn = ((caseMap[activeCaseId] || {}).case_number || 'CASE').replace(/[^A-Z0-9-]/gi, '');
      cnr = `REF-${cn}-${slug}`;
      say(`No identifier given — filed under auto reference ${cnr}`);
    }
    const body = {
      type, name, caseId: activeCaseId,
      background: v('#ne-bg'), lastKnownLocation: v('#ne-loc'), lastCallRecord: v('#ne-call'),
      vehicles: v('#ne-veh').split(',').map(s => s.trim()).filter(Boolean),
      identifiers: { phone: v('#ne-phone') || undefined, cnr: cnr || undefined, aadhaar: v('#ne-aadhaar') || undefined, fir: v('#ne-fir') || undefined, criminal: v('#ne-criminal') || undefined },
      riskInputs: { centrality: 0.5, recentActivityDays: 0 },
    };
    try {
      await call('/api/entities', { method: 'POST', body: JSON.stringify(body) });
      e.target.reset(); e.target.hidden = true;
      bundleCache.delete(activeCaseId);
      say('Entity added with risk scoring');
      await renderAllForActiveCase().catch(() => {});
      refreshCases();
    } catch (ex) {
      err.textContent = ex.message;
      // duplicate → offer one-click link
      try {
        const dup = await findDupHint(body.identifiers);
        if (dup) {
          document.querySelector('#ne-dup').innerHTML = `<div class="dup-note">Exists as <b>${esc(dup.name)}</b> — <button class="mini-btn" id="ne-link" type="button">Link to this case instead</button></div>`;
          document.querySelector('#ne-link').addEventListener('click', async () => {
            try {
              await call(`/api/entities/${dup.id}/link`, { method: 'POST', body: JSON.stringify({ caseId: activeCaseId }) });
              say('Linked (no duplicate created)'); e.target.hidden = true;
              bundleCache.delete(activeCaseId);
              await renderAllForActiveCase().catch(() => {});
              refreshCases();
            }
            catch (ex2) { err.textContent = ex2.message; }
          });
        }
      } catch (ignore) { /* ignore */ }
    }
  }
  const nameCache = {};
  async function findDupHint(ids) {
    for (const k of ['phone', 'cnr', 'aadhaar']) {
      if (!ids[k]) continue;
      try {
        const rows = await call('/api/entities?q=' + encodeURIComponent(ids[k]));
        if (rows && rows.length) return rows[0];
      } catch (e) { /* ignore */ }
    }
    return null;
  }
  function renderLiveEntitiesFrom(bundle) {
    ensureEntityBar();
    const tb = document.querySelector('#entities-tbody'); if (!tb || !activeCaseId) return;
    const rows = bundle.entities || [];
    const cn = (caseMap[activeCaseId] || {}).case_number || 'case';
    rows.forEach(en => { nameCache[String(en.name || '').toLowerCase()] = en.id; });
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="6" class="muted">No entities in this case yet — add the first one above.</td></tr>'; }
    else {
      tb.innerHTML = rows.map(en => {
        return `<tr><td><b>${esc(en.name)}</b> <span class="tag">LIVE</span></td><td class="muted">${esc(en.type)}</td><td class="muted">conf ${en.confidence}%</td><td class="muted" style="font-size:11px">${(en.tags || []).slice(0, 2).map(esc).join(', ') || '—'}</td><td><div style="display:flex;align-items:center;gap:8px"><div class="prob-bar"><div class="prob-fill" style="width:${en.riskScore}%"></div></div><b class="prob ${probCls(en.riskScore)}">${en.riskScore}%</b></div></td><td><button class="mini-btn" data-live-open="${en.id}">Open</button></td></tr>`;
      }).join('');
      tb.querySelectorAll('[data-live-open]').forEach(b => b.addEventListener('click', () => openLiveDossier(b.dataset.liveOpen)));
    }
    const tag = document.querySelector('#entities-count-tag'); if (tag) tag.textContent = rows.length + ' LIVE';
    const sub = document.querySelector('#entities-sub'); if (sub) sub.textContent = rows.length + ' live entities in ' + cn;
    const n2 = document.querySelector('#live-ent-note'); if (n2) n2.textContent = `live · ${cn} · dedupe phone>CNR>Aadhaar`;
  }
  async function renderLiveEntities() {
    if (!activeCaseId) return;
    const bundle = await fetchBundle(activeCaseId);
    renderLiveEntitiesFrom(bundle);
  }

  /* ---------- live activity tab (per case) ---------- */
  function renderLiveActivityFrom(bundle) {
    const box2 = document.querySelector('#activity-timeline'); if (!box2 || !activeCaseId) return;
    const evs = bundle.timeline || [];
    const cn = (caseMap[activeCaseId] || {}).case_number || '';
    if (!evs.length) { box2.innerHTML = '<div class="muted" style="font-size:12px">No live events yet for this case.</div>'; return; }
    box2.innerHTML = `<div class="live-bar"><span class="tag">LIVE</span><span class="muted" style="font-size:11px">${evs.length} events · ${esc(cn)}</span></div>` + evs.slice(0, 30).map(t =>
      `<div class="tl-item"><div class="tl-dot">${esc((t.type || '!')[0].toUpperCase())}</div><div class="tl-card"><div style="display:flex;gap:8px;align-items:center"><strong style="font-size:12px">${esc(t.title)}</strong><time style="margin-left:auto">${fmtTime(t.created_at)}</time></div><p style="margin:6px 0 0;line-height:1.5;font-size:12px;color:var(--muted)">${esc(t.description || t.type)}</p></div></div>`
    ).join('');
  }
  async function renderLiveActivity() {
    if (!activeCaseId) return;
    const bundle = await fetchBundle(activeCaseId);
    renderLiveActivityFrom(bundle);
  }

  /* ---------- live network graph (per case, replaces static demo when live) ---------- */
  function renderLiveGraphFrom(bundle) {
    const card = document.querySelector('#network'); if (!card || !activeCaseId) return;
    const c = caseMap[activeCaseId]; if (!c) return;
    const g = bundle.graph || { nodes: [], edges: [], crossCaseEdges: [], centralNodeId: null, density: 0, counts: { nodes: 0, edges: 0, crossCaseEdges: 0 } };
    const counts = g.counts || { nodes: (g.nodes || []).length, edges: (g.edges || []).length, crossCaseEdges: (g.crossCaseEdges || []).length };
    const sub = card.querySelector('.card-subtitle');
    if (sub) sub.textContent = `${c.title} — ${counts.nodes} entities · ${counts.edges} links`;
    let bar = document.querySelector('#live-graph-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'live-graph-bar'; bar.className = 'live-bar';
      const body = document.querySelector('#network-body');
      if (body && body.parentElement) body.parentElement.insertBefore(bar, body);
      else card.prepend(bar);
    }
    const central = (g.nodes || []).find(n => n.id === g.centralNodeId);
    bar.innerHTML = `<span class="tag">LIVE</span><span class="muted" style="font-size:11px">${esc(c.case_number)} · ${counts.nodes} nodes · ${counts.edges} links · density ${g.density ?? 0}${central ? ` · central: <b>${esc(central.name)}</b>` : ''}</span>`;
    let panel = document.querySelector('#live-graph-body');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'live-graph-body';
      bar.parentElement.insertBefore(panel, bar.nextSibling);
    }
    const nodes = g.nodes || [];
    const edges = g.edges || [];
    const nameOf = (id) => (nodes.find(n => n.id === id) || {}).name || String(id).slice(0, 8);
    const typeColor = (t) => ({ person: '#ff5d6c', device: '#8b5cf6', phone: '#8b5cf6', location: '#22c55e', account: '#f59e0b', vehicle: '#3b82f6' }[t] || '#22d3ee');
    const typeName = (t) => ({ person: 'Person', device: 'Device', phone: 'Device', location: 'Location', account: 'Financial', vehicle: 'Vehicle' }[t] || 'Other');
    const initials = (name) => String(name || '?').trim().split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
    if (!counts.nodes) {
      panel.innerHTML = '<div class="muted" style="font-size:12px;padding:8px 0">No network yet for this case — add 2+ entities and link them from the Entities tab.</div>';
    } else {
      // Per-case visual graph: central node in the middle, others spread over
      // up to 3 rings (large cases) so nothing piles up. Labels are pushed
      // RADIALLY OUTWARD from the centre — each label sits on its node's own
      // spoke, anchored outward and staggered near/far, with a dark halo so
      // links never wash them out. Vehicle plates are shortened on the map
      // ("Platina MH-18-AB-2201" -> "Platina"); full names stay in tooltips.
      const big = nodes.length > 12;
      const W = big ? 980 : 760, H = big ? 640 : 470, CX = W / 2, CY = H / 2;
      const rN = big ? 12 : 16, rC = big ? 17 : 21;
      const RXo = W / 2 - 120, RYo = H / 2 - 95;
      const centralId = g.centralNodeId;
      const others = nodes.filter(n => n.id !== centralId);
      const ringCount = nodes.length > 20 ? 3 : (big ? 2 : 1);
      const rings = ringCount === 3
        ? [others.filter((_, i) => i % 3 === 0), others.filter((_, i) => i % 3 === 1), others.filter((_, i) => i % 3 === 2)]
        : (ringCount === 2
          ? [others.filter((_, i) => i % 2 === 0), others.filter((_, i) => i % 2 === 1)]
          : [others]);
      const scales = ringCount === 3 ? [0.38, 0.68, 1] : (ringCount === 2 ? [0.55, 1] : [0.85]);
      const pos = {};
      if (centralId) pos[centralId] = { x: CX, y: CY };
      rings.forEach((arr, ri) => {
        const rx = RXo * scales[ri], ry = RYo * scales[ri];
        arr.forEach((n, k) => {
          const a = (2 * Math.PI * k) / Math.max(1, arr.length) - Math.PI / 2 + ri * 0.4;
          pos[n.id] = { x: CX + rx * Math.cos(a), y: CY + ry * Math.sin(a) };
        });
      });
      const edgeSvg = edges.map(e => {
        const s = pos[e.source], t2 = pos[e.target];
        if (!s || !t2) return '';
        const hot = /transfer|calls/i.test(e.type || '');
        const w = (0.8 + (e.strength || 50) / 100 * 1.4).toFixed(1);
        const op = (0.14 + (e.strength || 50) / 100 * 0.4).toFixed(2);
        return `<line x1="${s.x.toFixed(1)}" y1="${s.y.toFixed(1)}" x2="${t2.x.toFixed(1)}" y2="${t2.y.toFixed(1)}" stroke="${hot ? '#ff7a7a' : '#4d6f96'}" stroke-width="${w}" opacity="${op}"><title>${esc(nameOf(e.source))} — ${esc(e.type)} — ${esc(nameOf(e.target))} (${e.strength}%)</title></line>`;
      }).join('');
      const maxLabel = big ? 12 : 17;
      const shortName = (n) => {
        let s = String(n.name || '?');
        if (n.type === 'vehicle') s = s.split(/\s+/)[0];
        return s.length > maxLabel ? s.slice(0, maxLabel - 1) + '…' : s;
      };
      const labelFs = big ? 9.5 : 10;
      const nodeSvg = nodes.map((n, idx) => {
        const p = pos[n.id]; if (!p) return '';
        const col = typeColor(n.type); const isC = n.id === centralId;
        const r = isC ? rC : rN;
        const label = shortName(n);
        let ux = (p.x - CX) / (RXo || 1), uy = (p.y - CY) / (RYo || 1);
        const ul = Math.hypot(ux, uy) || 1; ux /= ul; uy /= ul;
        const gap = r + 14 + (idx % 2) * 10;
        const lx = p.x + ux * gap, ly = p.y + uy * gap + 3;
        const anchor = ux > 0.35 ? 'start' : (ux < -0.35 ? 'end' : 'middle');
        return `<g data-live-node="${n.id}" style="cursor:pointer"><title>${esc(n.name)} · ${n.riskScore}%</title>`
          + `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${col}22" stroke="${col}" stroke-width="${isC ? 2.5 : 1.5}"/>`
          + `<text x="${p.x.toFixed(1)}" y="${(p.y + 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="#fff">${esc(initials(n.name))}</text>`
          + `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="${anchor}" font-size="${labelFs}" fill="#c6d5e5" stroke="#0b1526" stroke-width="3" style="paint-order:stroke">${esc(label)}</text></g>`;
      }).join('');
      const seenTypes = [...new Set(nodes.map(n => n.type))];
      const legend = `<div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:6px">` + seenTypes.map(t =>
        `<span class="muted" style="font-size:11px"><i style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${typeColor(t)};margin-right:4px"></i>${typeName(t)}</span>`
      ).join('') + `</div>`;
      const cross = (g.crossCaseEdges || []).length;
      panel.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" style="width:100%;height:auto;display:block">${edgeSvg}${nodeSvg}</svg>`
        + legend
        + (cross ? `<div class="muted" style="font-size:11px;margin-top:4px">+ ${cross} cross-case link(s) to other cases (see dossier).</div>` : '')
        + `<details style="margin-top:8px"><summary class="muted" style="font-size:11px;cursor:pointer">${edges.length} verified links — view list</summary><ul class="list" style="margin:8px 0 0">` + edges.slice(0, 30).map(e =>
          `<li><b>${esc(nameOf(e.source))}</b> —${esc(e.type)}→ <b>${esc(nameOf(e.target))}</b> <span class="muted">(${e.strength}%)</span></li>`
        ).join('') + (!edges.length ? '<li class="muted">Nodes present, no links yet — link entities from Overview.</li>' : '') + `</ul></details>`
        + `<div style="border-top:1px solid var(--line);margin-top:10px;padding-top:8px"><div class="muted" style="font-size:11px;margin-bottom:6px">Open dossier — ${esc((caseMap[activeCaseId] || {}).case_number || '')} · ${nodes.length} entities</div><div class="chips" id="live-dossier-chips">` + nodes.map(n =>
          `<button class="chip" data-live-node="${n.id}" style="cursor:pointer">${esc(n.name)} · ${n.riskScore}%</button>`
        ).join('') + `</div></div>`;
      panel.querySelectorAll('[data-live-node]').forEach(ch => ch.addEventListener('click', () => openLiveDossier(ch.dataset.liveNode)));
    }
    // Strict isolation: hide the ENTIRE static Nightfall demo map (not just
    // children) whenever live backend owns the view — no overlap, ever.
    // Removed again automatically when offline (see init guard below).
    try {
      let hid = document.querySelector('#live-hide-networkbody');
      if (!hid) {
        hid = document.createElement('style');
        hid.id = 'live-hide-networkbody';
        hid.textContent = '#network-body{display:none!important}';
        document.head.appendChild(hid);
      }
      hid.disabled = false;
    } catch (e) { /* ignore */ }
  }

  /* ---------- live risk signal (per case) ---------- */
  function renderLiveRiskFrom(bundle) {
    if (!activeCaseId) return;
    const rows = bundle.entities || [];
    const cn = (caseMap[activeCaseId] || {}).case_number || '';
    let val = 0, label = 'No signals yet — add entities to this case';
    if (rows.length) {
      const max = Math.max(...rows.map(e => e.riskScore || 0));
      const avg = Math.round(rows.reduce((s, e) => s + (e.riskScore || 0), 0) / rows.length);
      val = max;
      label = max >= 85 ? `Critical — peak ${max}% in ${cn}` : max >= 75 ? `High — peak ${max}% in ${cn}` : max >= 45 ? `Elevated — peak ${max}% in ${cn}` : `Monitored — avg ${avg}% in ${cn}`;
    }
    const el = document.querySelector('#risk-signal-value'); if (el) el.textContent = String(val);
    const fill = document.querySelector('#risk-signal-fill'); if (fill) fill.style.width = val + '%';
    const lab = document.querySelector('#risk-signal-label'); if (lab) lab.textContent = label;
    const tr = document.querySelector('#risk-signal-trend'); if (tr) tr.textContent = rows.length ? `${rows.length} entit${rows.length === 1 ? 'y' : 'ies'} · ${cn}` : cn;
  }

  /* ---------- live overview: activity + signals + stats (per case) ---------- */
  function renderLiveOverviewFrom(bundle) {
    if (!activeCaseId) return;
    const c = caseMap[activeCaseId]; if (!c) return;
    const evs = bundle.timeline || [];
    const rows = bundle.entities || [];
    // overview activity card: latest 3 per-case events
    const actList = document.querySelector('#activity .activity-list');
    if (actList) {
      if (!evs.length) actList.innerHTML = '<div class="muted" style="font-size:12px">No signals ingested for this case yet.</div>';
      else actList.innerHTML = evs.slice(0, 3).map(t =>
        `<div class="activity"><div class="activity-icon">${esc((t.type || '!')[0].toUpperCase())}</div><div><p>${esc(t.title)}</p><time>${fmtTime(t.created_at)} · ${esc(c.case_number)}</time></div></div>`
      ).join('');
    }
    // overview risk-signal card: top per-case entities by risk
    const alertsList = document.querySelector('#alerts .alerts-list');
    if (alertsList) {
      if (!rows.length) alertsList.innerHTML = '<div class="muted" style="font-size:12px">No risk signals for this case yet.</div>';
      else alertsList.innerHTML = rows.slice().sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)).slice(0, 4).map(en =>
        `<div class="alert" data-live-open="${en.id}" style="cursor:pointer"><i class="alert-signal ${(en.riskScore || 0) >= 75 ? 'high' : ''}"></i><div class="alert-copy"><strong>${esc(en.name)}</strong><span>${esc(en.type)} · ${esc(c.case_number)}</span><span class="confidence">${en.riskScore}% confidence</span></div></div>`
      ).join('');
      alertsList.querySelectorAll('[data-live-open]').forEach(el => el.addEventListener('click', () => openLiveDossier(el.dataset.liveOpen)));
    }
    const at = document.querySelector('#alerts-count-tag'); if (at) at.textContent = rows.length ? `${Math.min(4, rows.length)} LIVE` : 'EMPTY';
    const nt2 = document.querySelector('#nav-risk-tag'); if (nt2) nt2.textContent = rows.length ? String(Math.min(4, rows.length)) : '0';
  }

  function renderLiveStatsFrom(bundle) {
    if (!activeCaseId) return;
    const rows = bundle.entities || [];
    const g = bundle.graph || {};
    const counts = g.counts || { nodes: rows.length, edges: (g.edges || []).length };
    const cn = (caseMap[activeCaseId] || {}).case_number || '';
    const openCases = Object.values(caseMap).filter(c => c.status === 'active' || c.status === 'open');
    const stats = document.querySelectorAll('.stats .stat');
    const setStat = (label, value, sub) => {
      const el = Array.from(stats).find(s => (s.querySelector('.stat-label') || {}).textContent === label);
      if (el) {
        el.querySelector('.stat-number').textContent = value;
        if (sub != null) { const tag = el.querySelector('.stat-change'); if (tag) tag.textContent = sub; }
      }
    };
    const byId = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
    if (rows.length) {
      const avg = Math.round(rows.reduce((s, e) => s + (e.riskScore || 0), 0) / rows.length);
      const peak = Math.max(...rows.map(e => e.riskScore || 0));
      setStat('ENTITIES ANALYZED', String(rows.length).padStart(2, '0'), `live · ${cn}`);
      setStat('HIGH-RISK CONNECTIONS', String(counts.edges ?? 0).padStart(2, '0'), `${counts.edges || 0} links · ${cn}`);
      setStat('AI CONFIDENCE', avg + '%', `peak ${peak}% · verified`);
      byId('stat-entities', String(rows.length).padStart(2, '0'));
      byId('stat-entities-sub', `live · ${cn}`);
      byId('stat-links', String(counts.edges ?? 0).padStart(2, '0'));
      byId('stat-links-sub', `${counts.edges || 0} links · ${cn}`);
      byId('stat-confidence', avg + '%');
      byId('stat-confidence-sub', `peak ${peak}% · verified`);
    } else {
      setStat('ENTITIES ANALYZED', '00', `empty · ${cn}`);
      setStat('HIGH-RISK CONNECTIONS', '00', `no links · ${cn}`);
      setStat('AI CONFIDENCE', '—', 'add entities first');
      byId('stat-entities', '00'); byId('stat-entities-sub', `empty · ${cn}`);
      byId('stat-links', '00'); byId('stat-links-sub', `no links · ${cn}`);
      byId('stat-confidence', '—'); byId('stat-confidence-sub', 'add entities first');
    }
    // Honest investigation count: real open cases, with the focused one named.
    const n = openCases.length || Object.keys(caseMap).length || 1;
    setStat('ACTIVE INVESTIGATIONS', String(n).padStart(2, '0'), cn ? `${cn} · in focus` : `${n} case(s) open`);
    byId('stat-active', String(n).padStart(2, '0'));
    byId('stat-active-sub', cn ? `${cn} · in focus` : `${n} case(s) open`);
  }

  /* ---------- live AI brief (per case — replaces static demo copy) ---------- */
  function renderLiveBriefFrom(bundle) {
    const box3 = document.querySelector('#ai-brief'); if (!box3 || !activeCaseId) return;
    const c = caseMap[activeCaseId]; if (!c) return;
    const rows = bundle.entities || [];
    const g = bundle.graph || { nodes: [], edges: [] };
    const evs = bundle.timeline || [];
    if (!rows.length) {
      box3.innerHTML = `<div class="insight"><strong>No signals yet</strong><p>${esc(c.case_number)} starts empty — add its first entity from the Entities tab, then this brief explains itself.</p></div>`;
      return;
    }
    const byRisk = [...rows].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0));
    const central = (g.nodes || []).find(n => n.id === g.centralNodeId) || byRisk[0];
    const cross = (g.nodes || []).filter(n => n.crossCase).length;
    const top = byRisk[0];
    const last = evs[0];
    box3.innerHTML =
      `<div class="insight"><strong>Central influencer — ${esc(central.name)}</strong><p>Highest connection degree in ${esc(c.case_number)}${central.centrality != null ? ` (centrality ${central.centrality})` : ''}, risk ${central.riskScore}%.${cross ? ` ${cross} entit${cross === 1 ? 'y' : 'ies'} also appear in other cases.` : ''}</p></div>`
      + `<div class="insight"><strong>Recommended next step</strong><p>Review <b>${esc(top.name)}</b> (peak risk ${top.riskScore}%)${last ? ` and the latest event: “${esc(last.title)}”.` : '.'}</p></div>`;
  }

  /* ---------- live copilot header (per case — no demo bleed) ---------- */
  function renderLiveCopilotFrom(bundle) {
    if (!activeCaseId) return;
    const c = caseMap[activeCaseId]; if (!c) return;
    const rows = bundle.entities || [];
    const g = bundle.graph || {};
    const central = ((g.nodes || []).find(n => n.id === g.centralNodeId) || [...rows].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))[0]);
    const msgs = document.querySelector('#copilot-messages');
    if (msgs && msgs.children.length <= 1) {
      const greet = document.querySelector('#copilot-greet');
      if (greet) greet.innerHTML = `Hi Officer. Ask me about <b>${esc(c.title)}</b> (${esc(c.case_number)}) — ${rows.length} entit${rows.length === 1 ? 'y' : 'ies'} on verified record. I answer only from this case file.`;
    }
    const chips = document.querySelectorAll('#copilot-chips .chip-action');
    if (chips.length >= 4 && central) {
      const set = (i, label, q) => { chips[i].textContent = label; chips[i].dataset.q = q; };
      set(0, `${central.name} central?`, `Tell me about ${central.name}`);
      set(1, 'Money trail?', 'Show money trail');
      set(2, 'Recent timeline?', 'Show recent timeline');
      set(3, 'Risk scores?', 'What are the risk scores?');
    }
  }

  /* ---------- live detention estimate (per-case central node) ---------- */
  function renderLiveSimFrom(bundle) {
    if (!activeCaseId) return;
    const rows = bundle.entities || [];
    const g = bundle.graph || { nodes: [], edges: [], density: 0 };
    const central = (g.nodes || []).find(n => n.id === g.centralNodeId) || [...rows].sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0))[0];
    const ot = document.querySelector('#sim-overlay-title');
    const os = document.querySelector('#sim-overlay-sub');
    const dt = document.querySelector('#sim-detail-text');
    if (!central) {
      if (ot) ot.textContent = 'Detention Simulation';
      if (os) os.textContent = 'No network yet — add 2+ entities first';
      if (dt) dt.textContent = 'No network yet for this case.';
      return;
    }
    const deg = Math.max(1, (g.edges || []).filter(e => e.source === central.id || e.target === central.id).length);
    const total = (g.edges || []).length;
    const cut = total ? Math.round((deg / total) * 100) : 100;
    if (ot) ot.textContent = `Detention Simulation: ${central.name} removed`;
    if (os) os.textContent = `~${cut}% of links break · density ${g.density ?? 0} drops · estimate for ${caseMap[activeCaseId].case_number}`;
    if (dt) dt.textContent = `Removing ${central.name} breaks ~${cut}% of this case's links (${deg}/${total}). Use for warrant priority.`;
    try { window.__nexusSimName = central.name; } catch (e) { /* ignore */ }
  }

  /* ---------- live drawers (per case — stale mock must never show) ---------- */
  function renderLiveDrawersFrom(bundle) {
    if (!activeCaseId) return;
    const rows = bundle.entities || [];
    const evs = bundle.timeline || [];
    const cn = (caseMap[activeCaseId] || {}).case_number || '';
    const el = document.querySelector('#entity-list');
    if (el) {
      const ec = document.querySelector('#entity-count'); if (ec) ec.textContent = String(rows.length).padStart(2, '0');
      el.innerHTML = rows.length ? rows.slice().sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)).map(en =>
        `<button type="button" class="entity-row" data-live-open="${en.id}"><span><b>${esc(en.name)}</b><small>${esc(en.type)} · ${esc(cn)}</small></span><span class="prob ${probCls(en.riskScore)}">${en.riskScore}%</span></button>`
      ).join('') : '<div class="muted" style="font-size:12px">No entities in this case yet.</div>';
      el.querySelectorAll('[data-live-open]').forEach(b => b.addEventListener('click', () => { try { closeDrawers(); } catch (e) { /* ignore */ } openLiveDossier(b.dataset.liveOpen); }));
    }
    const sl = document.querySelector('#suspect-activity-list');
    if (sl) {
      sl.innerHTML = evs.length ? evs.slice(0, 12).map(t =>
        `<div class="sact"><div style="display:flex;gap:8px;align-items:center"><span class="activity-icon" style="width:24px;height:24px;border-radius:7px;background:rgba(73,133,255,.15);color:var(--blue);display:grid;place-items:center">${esc((t.type || '!')[0].toUpperCase())}</span><strong style="font-size:12px">${esc(t.title)}</strong></div><time style="font-size:11px">${fmtTime(t.created_at)}</time>${t.description ? `<p style="margin:8px 0 0;line-height:1.5">${esc(t.description)}</p>` : ''}</div>`
      ).join('') : '<div class="muted" style="font-size:12px">No live events yet for this case.</div>';
    }
  }

  /* ---------- report (per case; single live head, always updated) ---------- */
  function renderLiveReportFrom(bundle) {
    const body = document.querySelector('#tab-report-body'); if (!body || !activeCaseId) return;
    const c = caseMap[activeCaseId]; if (!c) return;
    const rows = bundle.entities || [];
    const evs = bundle.timeline || [];
    const avg = rows.length ? Math.round(rows.reduce((s, e) => s + (e.riskScore || 0), 0) / rows.length) : 0;
    let head = document.querySelector('#live-case-head');
    if (!head) {
      head = document.createElement('div');
      head.id = 'live-case-head'; head.className = 'live-case-head';
      body.prepend(head);
    }
    // Single instance, refreshed for the active case (never duplicated, never stale).
    head.innerHTML = `<div><strong style="font-size:13px">${esc(c.title)} (${esc(c.case_number)})</strong> ${statusBadge(c.status)}<div class="muted" style="font-size:11px;margin-top:4px">Priority ${esc(c.priority)} · FIR ${esc(c.fir_number || '-')} · CNR ${esc(c.cnr_number || '-')}</div></div>`;
    // Remove any stray duplicate heads (defensive: exactly one).
    document.querySelectorAll('#live-case-head').forEach((h, i) => { if (i > 0) h.remove(); });
    let tail = document.querySelector('#live-report-tail');
    if (!tail) {
      tail = document.createElement('div');
      tail.id = 'live-report-tail';
      body.appendChild(tail);
    }
    tail.innerHTML = `<div class="kv"><span class="muted">Totals</span><span><b>${String(rows.length).padStart(2, '0')} entities</b> in this case${rows.length ? `, avg risk <b>${avg}%</b>` : ''}</span></div>`
      + (rows.length
        ? `<div><strong style="font-size:13px">Entities in ${esc(c.case_number)}</strong><div style="display:grid;gap:6px;margin-top:8px">` + rows.slice().sort((a, b) => (b.riskScore || 0) - (a.riskScore || 0)).map(en => `<div class="entity-row"><span><b>${esc(en.name)}</b><small>${esc(en.type)} · risk ${en.riskScore}%</small></span><span><button class="mini-btn" data-live-open="${en.id}">Open</button></span></div>`).join('') + `</div></div>`
        : `<div class="muted" style="font-size:12px">No entities yet — this case starts empty. Add the first entity from the Entities tab.</div>`)
      + (evs.length
        ? `<div style="margin-top:8px"><strong style="font-size:13px">Recent activity</strong><div style="display:grid;gap:6px;margin-top:8px">` + evs.slice(0, 5).map(t => `<div class="sact"><time>${fmtTime(t.created_at)}</time><p style="margin:4px 0 0">${esc(t.title)}</p></div>`).join('') + `</div></div>`
        : '')
      + `<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="mini-btn" data-live="verify-chain">Verify hash-chain</button><button class="mini-btn" data-live="certificate">Integrity Certificate (PDF)</button><button class="mini-btn" data-live="verify-all">Verify Entire Chain</button></div><div id="live-result" class="muted" style="font-size:12px;margin-top:6px"></div>`;
    tail.querySelectorAll('[data-live-open]').forEach(b => b.addEventListener('click', () => openLiveDossier(b.dataset.liveOpen)));
  }

  /* ---------- dossier: live profile + risk why + cross-case ---------- */
  async function entityByName(name) {
    const k = (name || '').toLowerCase();
    if (nameCache[k]) return nameCache[k];
    try {
      // scope name search to the active case first — never bleed another case's record in
      const scoped = activeCaseId ? await call('/api/entities?caseId=' + activeCaseId + '&q=' + encodeURIComponent(name)) : [];
      const hit = (scoped || []).find(r => (r.name || '').toLowerCase() === k) || (scoped || [])[0];
      if (hit) { nameCache[k] = hit.id; return hit.id; }
      const rows = await call('/api/entities?q=' + encodeURIComponent(name));
      const hit2 = (rows || []).find(r => (r.name || '').toLowerCase() === k) || rows[0];
      if (hit2) { nameCache[k] = hit2.id; return hit2.id; }
    } catch (e) { /* ignore */ }
    return null;
  }
  async function openLiveDossier(id) {
    const panel = document.querySelector('#detail-panel'); if (!panel) return;
    let d = null;
    try { d = await call('/api/entities/' + id); } catch (e) { say(e.message); return; }
    document.querySelector('#entity-name').textContent = d.name;
    document.querySelector('#entity-role').textContent = d.type + ' · live record';
    document.querySelector('#entity-risk').textContent = d.riskScore;
    document.querySelector('#entity-risk-label').textContent = d.riskLevel + ' · live score';
    const prof = d.profile || {};
    document.querySelector('#entity-connections').innerHTML = `<span class="chip">live record · ${(d.linkedCaseIds || []).length} case(s)</span>`;
    document.querySelector('#entity-phones').innerHTML = (d.identifiers || []).map(i => `<span class="chip">${esc(i.idType)}: ${esc(i.value)}${i.masked ? ' (masked)' : ''}</span>`).join('') || '<span class="muted">No identifiers.</span>';
    (function () { const el = document.querySelector('#entity-ids'); if (!el) return; const by = {}; (d.identifiers || []).forEach(i => { by[i.idType] = i; }); if (!by.fir && d.sourceIds && d.sourceIds.length) by.fir = { value: d.sourceIds[0], masked: false }; const chip = (t, k) => `<span class="chip">${t}: ${by[k] ? esc(by[k].value) + (by[k].masked ? ' (masked)' : '') : '-'}</span>`; el.innerHTML = chip('FIR', 'fir') + chip('CNR', 'cnr') + chip('CR', 'criminal'); })();
    document.querySelector('#entity-note').textContent = prof.background || '—';
    panel.classList.add('open');
    renderLiveSection(d);
  }
  async function renderLiveSection(d) {
    const slot = document.querySelector('#live-dossier'); if (!slot) return;
    slot.innerHTML = '<div class="muted" style="font-size:11px">Loading live record…</div>';
    const prof = d.profile || {};
    let riskHtml = '';
    try {
      const r = await call(`/api/entities/${d.id}/risk`);
      const sigs = r.why || [];
      riskHtml = `<div class="live-block"><strong>Why this score (${r.storedScore}% · ${esc(r.indicator)})</strong>` +
        (sigs.length ? `<ul class="why-list">${sigs.map(s => `<li><b>+${s.points}</b> ${esc(s.label)} — <span class="muted">${esc(s.detail)}</span></li>`).join('')}</ul>`
          : '<div class="muted" style="font-size:11px">Base monitoring score — no strong signals yet.</div>') + `</div>`;
    } catch (e) { riskHtml = '<div class="muted" style="font-size:11px">Risk explanation unavailable.</div>'; }
    const linked = (d.linkedCases || []).map(c => `<span class="chip case-chip" data-goto-case="${c.id}" style="cursor:pointer" title="Open case">${esc(c.case_number)} · ${esc(c.status)}</span>`).join('');
    slot.innerHTML =
      `<div class="live-block"><strong>Live dossier</strong>`
      + (prof.lastKnownLocation && prof.lastKnownLocation !== '-' ? `<div class="kvline"><span>Location</span><span>${esc(prof.lastKnownLocation)}</span></div>` : '')
      + (prof.lastCallRecord && prof.lastCallRecord !== '-' ? `<div class="kvline"><span>Call record</span><span>${esc(prof.lastCallRecord)}</span></div>` : '')
      + ((prof.vehicles || []).length ? `<div class="kvline"><span>Vehicles</span><span>${prof.vehicles.map(esc).join(', ')}</span></div>` : '')
      + `<div class="kvline"><span>Chain refs</span><span>${d.chainCount || 0} hash-linked records</span></div></div>`
      + riskHtml
      + `<div class="live-block"><strong>Cross-case links ${(d.linkedCases || []).length > 1 ? '<span class="tag">CROSS-CASE</span>' : ''}</strong><div class="chips" style="margin-top:6px">${linked || '<span class="muted" style="font-size:11px">Only this case.</span>'}</div></div>`
      + (canWrite ? `<button class="ghost" id="live-delete-req" type="button" style="width:100%;margin-top:8px">Request delete (2-person approval)</button>` : '');
    slot.querySelectorAll('[data-goto-case]').forEach(ch => ch.addEventListener('click', () => { document.querySelector('#detail-panel').classList.remove('open'); void setActiveCase(ch.dataset.gotoCase); }));
    const del = document.querySelector('#live-delete-req');
    if (del) del.addEventListener('click', async () => {
      const reason = prompt('Delete reason (min 5 chars):', '');
      if (!reason || reason.length < 5) return;
      try {
        await call(`/api/entities/${d.id}/delete-request`, { method: 'POST', body: JSON.stringify({ caseId: activeCaseId, reason }) });
        say('Delete requested — second officer must approve'); refreshApprovals(); refreshApprovalsBadge();
      }
      catch (e) { say(e.message); }
    });
  }
  // mock-entity opens → enrich with live record by name (scoped to active case)
  const panel = document.querySelector('#detail-panel');
  if (panel) {
    let lastName = '';
    new MutationObserver(async () => {
      if (!panel.classList.contains('open')) return;
      const nm = (document.querySelector('#entity-name') || {}).textContent || '';
      if (!nm || nm === lastName) return;
      lastName = nm;
      const id = await entityByName(nm);
      const slot = document.querySelector('#live-dossier'); if (!slot) return;
      if (!id) { slot.innerHTML = '<div class="muted" style="font-size:11px">Not yet in backend — mock only.</div>'; return; }
      try { const d = await call('/api/entities/' + id); renderLiveSection(d); }
      catch (e) { slot.innerHTML = ''; }
    }).observe(panel, { attributes: true, attributeFilter: ['class'] });
  }

  /* ---------- live nav + tab hooks (re-assert per-case truth after mock nav) ---------- */
  document.querySelectorAll('[data-live-nav]').forEach(a => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); a.classList.add('active');
    if (a.dataset.liveNav === 'cases') { refreshCases().then(() => openDrawer('cases-drawer')); }
    if (a.dataset.liveNav === 'approvals') { refreshApprovals().then(() => openDrawer('approvals-drawer')); }
  }));
  const entNav = document.querySelector('[data-nav="entities"]');
  if (entNav) entNav.addEventListener('click', () => setTimeout(() => renderLiveEntities().catch(() => {}), 60));
  const actNav = document.querySelector('[data-nav="activity"]');
  if (actNav) actNav.addEventListener('click', () => setTimeout(() => renderLiveActivity().catch(() => {}), 60));
  const repNav = document.querySelector('[data-nav="reports"]');
  if (repNav) repNav.addEventListener('click', () => setTimeout(() => { if (activeCaseId) fetchBundle(activeCaseId).then(renderLiveReportFrom).catch(() => {}); }, 60));
  const netNav = document.querySelector('[data-nav="network"]');
  if (netNav) netNav.addEventListener('click', () => setTimeout(() => { if (activeCaseId) fetchBundle(activeCaseId).then(renderLiveGraphFrom).catch(() => {}); }, 60));
  const alertsNav = document.querySelector('[data-nav="alerts"]');
  if (alertsNav) alertsNav.addEventListener('click', () => setTimeout(() => { if (activeCaseId) fetchBundle(activeCaseId).then((b) => { renderLiveRiskFrom(b); renderLiveOverviewFrom(b); }).catch(() => {}); }, 60));

  // keep detail-panel dossier CTA scoped to the live record
  document.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest('[data-live]') : null;
    if (!b || !box.token) return;
    const out = document.querySelector('#live-result');
    const say2 = (m) => { if (out) out.textContent = m; };
    const id = activeCaseId;
    if (b.dataset.live === 'verify-chain') {
      if (!id) { say2('Case not synced yet — reload once.'); return; }
      say2('Verifying…');
      api('/api/cases/' + id + '/verify', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + box.token } }).then((r) => r.json()).then((body) => {
        const d = body && (body.data || body);
        say2(d ? ((d.ok ? 'Verified ✅' : 'TAMPER ❌') + ' — ' + d.checked + ' records. ' + (d.message || '')) : 'Verify failed.');
      }).catch(() => say2('Verify failed (offline?).'));
    }
    if (b.dataset.live === 'certificate') {
      if (!id) { say2('Case not synced yet — reload once.'); return; }
      say2('Preparing PDF…');
      fetch('/api/certificates/cases/' + id, { headers: { Authorization: 'Bearer ' + box.token } }).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'Integrity-Certificate-' + ((caseMap[id] || {}).case_number || id.slice(0, 8)) + '.pdf'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        say2('Certificate downloaded.');
      }).catch(() => say2('Certificate failed.'));
    }
    if (b.dataset.live === 'verify-all') {
      say2('Scanning entire chain…');
      api('/api/admin/verify-all', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + box.token } }).then((r) => r.json()).then((body) => {
        const d = body && (body.data || body);
        say2(d ? ('Entire chain: ' + d.intact + '/' + d.scanned + ' intact' + (d.allOk ? ' ✅' : ' ❌')) : 'Scan failed.');
      }).catch(() => say2('Scan failed (offline?).'));
    }
  });

  /* ---------- init: restore persisted active case, then paint per-case ---------- */
  emitActiveCase();
  refreshCases(); refreshApprovalsBadge();

  // Live risk ticker: the strip promises auto-updates, so re-read the active
  // case bundle every 20s and repaint risk + stats + overview. Paint-only —
  // never touches drawers, dossier, forms or the graph while in use.
  setInterval(() => {
    try {
      if (!box.token || !isLiveActive() || document.hidden) return;
      bundleCache.delete(activeCaseId);
      fetchBundle(activeCaseId).then((b) => {
        renderLiveRiskFrom(b); renderLiveStatsFrom(b); renderLiveOverviewFrom(b);
      }).catch(() => { /* offline: keep last painted values */ });
    } catch (e) { /* ignore */ }
  }, 20000);

  window.__nexusLive2 = { refreshCases, refreshApprovals, setActiveCase, renderLiveEntities, renderLiveActivity, openLiveDossier, isLiveActive, getActiveCaseId, renderAllForActiveCase, getActiveCase: activeCase, getBundle: (id) => bundleCache.get(id || activeCaseId) || null };
})();
