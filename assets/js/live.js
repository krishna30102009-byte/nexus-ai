/* NexusAI Live Ops — backend-wired Cases, Approvals, Entities, Dossier.
   Layers over app.js mock flows; mock stays as offline fallback. */
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

  /* ---------- active case state ---------- */
  let activeCaseId = null;
  try { activeCaseId = localStorage.getItem('nexus-case') || null; } catch (e) { /* ignore */ }
  let caseMap = {};
  let graphCache = {};

  function statusBadge(s) { return `<span class="st st-${esc(s)}">${esc(s.replace('_', ' '))}</span>`; }

  async function refreshCases() {
    const list = document.querySelector('#cases-list'); if (!list) return;
    let cases = [];
    try { cases = await call('/api/cases?limit=50'); }
    catch (e) { list.innerHTML = `<div class="muted" style="font-size:12px">Cases unavailable: ${esc(e.message)}</div>`; return; }
    caseMap = {}; cases.forEach(c => { caseMap[c.id] = c; });
    if (!activeCaseId || !caseMap[activeCaseId]) {
      const ntf = cases.find(c => c.case_number === 'NTF-042') || cases[0];
      if (ntf) activeCaseId = ntf.id;
    }
    const cc = document.querySelector('#cases-count'); if (cc) cc.textContent = String(cases.length).padStart(2, '0');
    list.innerHTML = cases.map(c => {
      const n = (c.entityIds || []).length;
      return `<button type="button" class="entity-row case-row${c.id === activeCaseId ? ' selected' : ''}" data-case="${c.id}"><span><b>${esc(c.case_number)} · ${esc(c.title)}</b><small>FIR:${esc(c.fir_number || '-') } CNR:${esc(c.cnr_number || '-') } · ${n} entities · ${esc(c.priority)}</small></span><span>${statusBadge(c.status)}</span></button>`;
    }).join('') || '<div class="muted" style="font-size:12px">No cases yet — create one above.</div>';
    list.querySelectorAll('[data-case]').forEach(b => b.addEventListener('click', () => setActiveCase(b.dataset.case)));
    paintActiveCase();
    refreshApprovalsBadge();
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
  }

  async function setActiveCase(id) {
    activeCaseId = id; graphCache = {};
    try { localStorage.setItem('nexus-case', id); } catch (e) { /* ignore */ }
    closeDrawers(); paintActiveCase(); refreshCases();
    if (!document.querySelector('#view-entities').hidden) renderLiveEntities();
    if (!document.querySelector('#view-activity').hidden) renderLiveActivity();
    if (!document.querySelector('#view-reports').hidden) augmentReport();
    say('Switched to ' + (caseMap[id] ? caseMap[id].case_number : 'case'));
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
        nf.reset(); nf.hidden = true;
        await refreshCases(); setActiveCase(created.id);
        say('Case ' + created.case_number + ' created');
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
        const r = await call(`/api/cases/${activeCaseId}/close-request`, { method: 'POST', body: JSON.stringify({ reason }) });
        document.querySelector('#close-reason').value = '';
        say('Close requested — second officer must approve');
        refreshApprovals(); refreshApprovalsBadge();
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
        refreshApprovals(); refreshApprovalsBadge(); refreshCases();
      } catch (e) { say(e.message); }
    }));
  }

  /* ---------- live entities tab ---------- */
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
    form.addEventListener('submit', submitEntity);
  }
  async function submitEntity(e) {
    e.preventDefault();
    const err = document.querySelector('#ne-error'); err.textContent = '';
    document.querySelector('#ne-dup').innerHTML = '';
    const v = (id) => document.querySelector(id).value.trim();
    const body = {
      type: v('#ne-type'), name: v('#ne-name'), caseId: activeCaseId,
      background: v('#ne-bg'), lastKnownLocation: v('#ne-loc'), lastCallRecord: v('#ne-call'),
      vehicles: v('#ne-veh').split(',').map(s => s.trim()).filter(Boolean),
      identifiers: { phone: v('#ne-phone') || undefined, cnr: v('#ne-cnr') || undefined, aadhaar: v('#ne-aadhaar') || undefined, fir: v('#ne-fir') || undefined, criminal: v('#ne-criminal') || undefined },
      riskInputs: { centrality: 0.5, recentActivityDays: 0 },
    };
    try {
      await call('/api/entities', { method: 'POST', body: JSON.stringify(body) });
      e.target.reset(); e.target.hidden = true;
      say('Entity added with risk scoring'); renderLiveEntities();
    } catch (ex) {
      err.textContent = ex.message;
      // duplicate → offer one-click link
      try {
        const dup = await findDupHint(body.identifiers);
        if (dup) {
          document.querySelector('#ne-dup').innerHTML = `<div class="dup-note">Exists as <b>${esc(dup.name)}</b> — <button class="mini-btn" id="ne-link" type="button">Link to this case instead</button></div>`;
          document.querySelector('#ne-link').addEventListener('click', async () => {
            try { await call(`/api/entities/${dup.id}/link`, { method: 'POST', body: JSON.stringify({ caseId: activeCaseId }) }); say('Linked (no duplicate created)'); e.target.hidden = true; renderLiveEntities(); }
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
  async function renderLiveEntities() {
    ensureEntityBar();
    const tb = document.querySelector('#entities-tbody'); if (!tb || !activeCaseId) return;
    let rows = [];
    try { rows = await call(`/api/entities?caseId=${activeCaseId}&limit=100`); }
    catch (e) { const n = document.querySelector('#live-ent-note'); if (n) n.textContent = 'live unavailable — showing file data'; return; }
    if (!rows.length) { tb.innerHTML = '<tr><td colspan="6" class="muted">No entities in this case yet — add the first one above.</td></tr>'; }
    else {
      tb.innerHTML = rows.map(en => {
        nameCache[en.name.toLowerCase()] = en.id;
        return `<tr><td><b>${esc(en.name)}</b> <span class="tag">LIVE</span></td><td class="muted">${esc(en.type)}</td><td class="muted">conf ${en.confidence}%</td><td class="muted" style="font-size:11px">${(en.tags || []).slice(0, 2).map(esc).join(', ') || '—'}</td><td><div style="display:flex;align-items:center;gap:8px"><div class="prob-bar"><div class="prob-fill" style="width:${en.riskScore}%"></div></div><b class="prob ${probCls(en.riskScore)}">${en.riskScore}%</b></div></td><td><button class="mini-btn" data-live-open="${en.id}">Open</button></td></tr>`;
      }).join('');
      tb.querySelectorAll('[data-live-open]').forEach(b => b.addEventListener('click', () => openLiveDossier(b.dataset.liveOpen)));
    }
    const tag = document.querySelector('#entities-count-tag'); if (tag) tag.textContent = rows.length + ' LIVE';
    const sub = document.querySelector('#entities-sub'); if (sub) sub.textContent = rows.length + ' live entities in ' + ((caseMap[activeCaseId] || {}).case_number || 'case');
    const n2 = document.querySelector('#live-ent-note'); if (n2) n2.textContent = `live · ${(caseMap[activeCaseId] || {}).case_number || ''} · dedupe phone>CNR>Aadhaar`;
  }

  /* ---------- live activity tab ---------- */
  async function renderLiveActivity() {
    const box2 = document.querySelector('#activity-timeline'); if (!box2 || !activeCaseId) return;
    let evs = [];
    try { evs = await call(`/api/cases/${activeCaseId}/timeline`); }
    catch (e) { return; }
    if (!evs.length) { box2.innerHTML = '<div class="muted" style="font-size:12px">No live events yet for this case.</div>'; return; }
    box2.innerHTML = `<div class="live-bar"><span class="tag">LIVE</span><span class="muted" style="font-size:11px">${evs.length} events · ${(caseMap[activeCaseId] || {}).case_number || ''}</span></div>` + evs.slice(0, 30).map(t =>
      `<div class="tl-item"><div class="tl-dot">${esc((t.type || '!')[0].toUpperCase())}</div><div class="tl-card"><div style="display:flex;gap:8px;align-items:center"><strong style="font-size:12px">${esc(t.title)}</strong><time style="margin-left:auto">${fmtTime(t.created_at)}</time></div><p style="margin:6px 0 0;line-height:1.5;font-size:12px;color:var(--muted)">${esc(t.description || t.type)}</p></div></div>`
    ).join('');
  }

  /* ---------- report augment ---------- */
  async function augmentReport() {
    const body = document.querySelector('#tab-report-body'); if (!body || !activeCaseId) return;
    if (document.querySelector('#live-case-head')) return;
    const c = caseMap[activeCaseId]; if (!c) return;
    const head = document.createElement('div');
    head.id = 'live-case-head'; head.className = 'live-case-head';
    head.innerHTML = `<div><strong style="font-size:13px">${esc(c.title)} (${esc(c.case_number)})</strong> ${statusBadge(c.status)}<div class="muted" style="font-size:11px;margin-top:4px">Priority ${esc(c.priority)} · FIR ${esc(c.fir_number || '-')} · CNR ${esc(c.cnr_number || '-')}</div></div>`;
    body.prepend(head);
  }

  /* ---------- dossier: live profile + risk why + cross-case ---------- */
  async function entityByName(name) {
    const k = (name || '').toLowerCase();
    if (nameCache[k]) return nameCache[k];
    try {
      const rows = await call('/api/entities?q=' + encodeURIComponent(name));
      const hit = (rows || []).find(r => r.name.toLowerCase() === k) || rows[0];
      if (hit) { nameCache[k] = hit.id; return hit.id; }
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
    slot.querySelectorAll('[data-goto-case]').forEach(ch => ch.addEventListener('click', () => { document.querySelector('#detail-panel').classList.remove('open'); setActiveCase(ch.dataset.gotoCase); }));
    const del = document.querySelector('#live-delete-req');
    if (del) del.addEventListener('click', async () => {
      const reason = prompt('Delete reason (min 5 chars):', '');
      if (!reason || reason.length < 5) return;
      try { await call(`/api/entities/${d.id}/delete-request`, { method: 'POST', body: JSON.stringify({ caseId: activeCaseId, reason }) }); say('Delete requested — second officer must approve'); refreshApprovals(); refreshApprovalsBadge(); }
      catch (e) { say(e.message); }
    });
  }
  // mock-entity opens → enrich with live record by name
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

  /* ---------- live nav + tab hooks ---------- */
  document.querySelectorAll('[data-live-nav]').forEach(a => a.addEventListener('click', (ev) => {
    ev.preventDefault();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active')); a.classList.add('active');
    if (a.dataset.liveNav === 'cases') { refreshCases().then(() => openDrawer('cases-drawer')); }
    if (a.dataset.liveNav === 'approvals') { refreshApprovals().then(() => openDrawer('approvals-drawer')); }
  }));
  const entNav = document.querySelector('[data-nav="entities"]');
  if (entNav) entNav.addEventListener('click', () => setTimeout(renderLiveEntities, 60));
  const actNav = document.querySelector('[data-nav="activity"]');
  if (actNav) actNav.addEventListener('click', () => setTimeout(renderLiveActivity, 60));
  const repNav = document.querySelector('[data-nav="reports"]');
  if (repNav) repNav.addEventListener('click', () => setTimeout(augmentReport, 60));

  /* ---------- init: sync active case with backend, then paint ---------- */
  let tries = 0;
  const iv = setInterval(() => {
    tries++;
    const backendCase = box.caseId ? box.caseId() : null;
    if ((backendCase && !activeCaseId) || tries > 40) {
      if (backendCase && !activeCaseId) activeCaseId = backendCase;
      clearInterval(iv);
      refreshCases(); refreshApprovalsBadge();
    }
  }, 250);

  window.__nexusLive2 = { refreshCases, refreshApprovals, setActiveCase, renderLiveEntities, renderLiveActivity };
})();
