(function () {
  const data = window.NexusData;
  const login = document.querySelector('#login-form');
  if (login) {
    login.addEventListener('submit', (event) => {
      event.preventDefault();
      const id = document.querySelector('#investigator-id').value.trim();
      const password = document.querySelector('#password').value;
      const error = document.querySelector('#form-error');
      error.textContent = 'Authenticating…';
      // Level-2: real backend auth (JWT). Same UI, same redirect.
      fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: id, password: password }) })
        .then((r) => r.json().then((b) => ({ ok: r.ok, b: b })).catch(() => ({ ok: r.ok, b: null })))
        .then(({ ok, b }) => {
          if (ok && b && b.success) {
            try { localStorage.setItem('nexus-token', b.data.token); localStorage.setItem('nexus-user', JSON.stringify(b.data.user)); } catch (e) { /* storage unavailable */ }
            sessionStorage.setItem('nexus-authorized', 'true'); window.location.href = 'dashboard.html';
          } else error.textContent = (b && b.error && b.error.message) || 'Access denied. Use the demo credentials shown below.';
        })
        .catch(() => { error.textContent = 'Server unreachable. Open the site via the backend (port 4001), not as a file.'; });
    });
    return;
  }
  if (!sessionStorage.getItem('nexus-authorized')) window.location.href = '/';
  // LEVEL-2 live layer: JWT session verify + backend API helper (look unchanged)
  const __token = (() => { try { return localStorage.getItem('nexus-token'); } catch (e) { return null; } })();
  function __api(path, opts) {
    const init = Object.assign({ headers: { 'Content-Type': 'application/json', Authorization: __token ? 'Bearer ' + __token : '' } }, opts || {});
    return fetch(path, init).then((r) => r.json().then((b) => ({ ok: r.ok, status: r.status, body: b })).catch(() => ({ ok: r.ok, status: r.status, body: null })));
  }
  let __caseId = null;
  if (__token) {
    __api('/api/auth/me').then(({ ok, body }) => {
      const u = ok && body ? body.data || body : null;
      if (!u || !u.email) { sessionStorage.removeItem('nexus-authorized'); try { localStorage.removeItem('nexus-token'); localStorage.removeItem('nexus-user'); } catch (e) { /* ignore */ } window.location.href = '/'; return; }
      try {
        const av = document.querySelector('.agent .avatar'); if (av && u.name) av.textContent = u.name.split(/[\s.]+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
        const nm = document.querySelector('.agent strong'); if (nm && u.name) nm.textContent = u.name;
        const rl = document.querySelector('.agent small'); if (rl && u.role) rl.textContent = u.role === 'officer' ? 'Investigating Officer' : u.role === 'admin' ? 'Administrator' : u.role === 'police' ? 'Police Personnel' : u.role;
        const hi = document.querySelector('.topbar h1'); if (hi && u.name) { const last = u.name.trim().split(/\s+/).pop(); hi.textContent = 'Good day, ' + (u.role === 'officer' ? 'Officer ' : '') + last + '.'; }
      } catch (e) { /* cosmetic only */ }
    }).catch(() => { /* offline: keep static demo running */ });
    __api('/api/cases?limit=10').then(({ ok, body }) => {
      const items = ok && body ? body.data || [] : [];
      const f = items.find((c) => c.case_number === 'NTF-042') || items[0];
      if (f) __caseId = f.id;
    }).catch(() => { /* offline */ });
  }
  window.__nexusLive = { api: __api, token: __token, caseId: () => __caseId };
  const panel = document.querySelector('#detail-panel'); const toast = document.querySelector('#toast');
  function showEntity(key) {
    const entity = data.entities[key]; if (!entity) return;
    document.querySelector('#entity-name').textContent = entity.name;
    document.querySelector('#entity-role').textContent = entity.role;
    document.querySelector('#entity-risk').textContent = entity.risk;
    document.querySelector('#entity-risk-label').textContent = entity.risk >= 80 ? 'Critical risk signal' : entity.risk >= 65 ? 'Elevated risk signal' : 'Monitored signal';
    document.querySelector('#entity-connections').innerHTML = entity.connections.map(x => `<span class="chip">${x}</span>`).join('');
    document.querySelector('#entity-phones').innerHTML = entity.phones.length ? entity.phones.map(x => `<span class="chip">${x}</span>`).join('') : '<span class="muted">No linked numbers in this demo case.</span>';
    const __ids = document.querySelector('#entity-ids'); if (__ids) __ids.innerHTML = `<span class="chip">FIR: ${entity.firNumber || '-'}</span><span class="chip">CNR: ${entity.cnrNumber || '-'}</span><span class="chip">CR: ${entity.criminalId || '-'}</span>`;
    document.querySelector('#entity-note').textContent = entity.note; panel.classList.add('open');
    document.querySelectorAll('.graph-node').forEach(n=> n.style.outline='');
    const node=document.querySelector(`.graph-node[data-entity="${key}"]`);
    if(node){ node.style.outline='2px solid var(--cyan)'; node.style.outlineOffset='3px'; setTimeout(()=> node.style.outline='',2200);}
  }
  document.querySelectorAll('[data-entity]').forEach(node => node.addEventListener('click', () => showEntity(node.dataset.entity)));
  document.querySelector('#close-panel').addEventListener('click', () => panel.classList.remove('open'));
  document.querySelector('#search').addEventListener('keydown', (event) => { if (event.key === 'Enter') { const q = event.target.value.toLowerCase(); const key = Object.keys(data.entities).find(k => data.entities[k].name.toLowerCase().includes(q)); if (key) showEntity(key); else { toast.textContent = 'No entity matched this demonstration dataset.'; toast.classList.add('show'); setTimeout(() => toast.classList.remove('show'), 2600); } } });
  document.querySelector('#logout').addEventListener('click', () => { sessionStorage.removeItem('nexus-authorized'); try { localStorage.removeItem('nexus-token'); localStorage.removeItem('nexus-user'); localStorage.removeItem('nexus-case'); } catch (e) { /* ignore */ } window.location.href = '/'; });

  // ID-based search
  const idWrap = document.querySelector('#id-search');
  if (idWrap) {
    const typeBtn = document.querySelector('#id-type-btn');
    const typeLabel = document.querySelector('#id-type-label');
    const menu = document.querySelector('#id-menu');
    const input = document.querySelector('#id-search-input');
    const goBtn = document.querySelector('#id-search-btn');
    const results = document.querySelector('#id-results');
    let currentType = 'fir';
    const placeholders = { fir: 'Enter FIR Number', cnr: 'Enter CNR Number', criminal: 'Enter Criminal ID' };
    const fieldMap = { fir: 'firNumber', cnr: 'cnrNumber', criminal: 'criminalId' };
    const labelMap = { fir: 'FIR', cnr: 'CNR', criminal: 'ID' };
    function showToast(msg) { toast.textContent = msg; toast.classList.add('show'); clearTimeout(showToast._t); showToast._t = setTimeout(() => toast.classList.remove('show'), 2600); }
    function setType(type) { currentType = type; typeLabel.textContent = labelMap[type]; input.placeholder = placeholders[type]; menu.querySelectorAll('.id-option').forEach(b => b.classList.toggle('active', b.dataset.type === type)); input.classList.remove('invalid'); hideResults(); input.focus(); }
    function hideMenu() { menu.hidden = true; typeBtn.setAttribute('aria-expanded', 'false'); }
    function showMenu() { menu.hidden = false; typeBtn.setAttribute('aria-expanded', 'true'); }
    function hideResults() { results.hidden = true; results.innerHTML = ''; }
    function renderMulti(matches) {
      results.hidden = false;
      results.innerHTML = `<div class="id-results-head"><strong>${matches.length} records found</strong><small>${placeholders[currentType]}</small></div><div class="id-results-list">${matches.map(([k, e]) => `<button type="button" class="id-result" data-key="${k}"><span><b>${e.name}</b><span>${e.role} \u00B7 ${fieldMap[currentType]}: ${e[fieldMap[currentType]]}</span></span><span class="go">VIEW \u2192</span></button>`).join('')}</div>`;
      results.querySelectorAll('.id-result').forEach(b => b.addEventListener('click', () => { hideResults(); showEntity(b.dataset.key); }));
    }
    typeBtn.addEventListener('click', (e) => { e.stopPropagation(); menu.hidden ? showMenu() : hideMenu(); });
    menu.querySelectorAll('.id-option').forEach(btn => btn.addEventListener('click', () => { setType(btn.dataset.type); hideMenu(); }));
    document.addEventListener('click', (e) => { if (!idWrap.contains(e.target)) hideMenu(); });
    document.addEventListener('click', (e) => { if (!results.hidden && !idWrap.contains(e.target) && !panel.contains(e.target)) hideResults(); });
    function doIdSearch() {
      const raw = input.value.trim();
      if (!raw) { input.classList.add('invalid'); showToast(`Please ${placeholders[currentType].toLowerCase()}.`); hideResults(); return; }
      input.classList.remove('invalid');
      const field = fieldMap[currentType];
      const q = raw.toLowerCase();
      const matches = Object.entries(data.entities).filter(([, e]) => (e[field] || '').toLowerCase() === q);
      if (matches.length === 0) { hideResults(); showToast('No criminal record found for this ID.'); return; }
      if (matches.length === 1) { hideResults(); showEntity(matches[0][0]); return; }
      renderMulti(matches);
    }
    goBtn.addEventListener('click', doIdSearch);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); doIdSearch(); } if (e.key === 'Escape') hideResults(); });
    input.addEventListener('input', () => input.classList.remove('invalid'));
    window.__nexusIdSearch = { setType, doIdSearch };
  }

  // Unique Feature: Nexus Copilot + Temporal Scrubber + Collapse Simulator
  const fab = document.querySelector('#copilot-fab');
  const copilot = document.querySelector('#copilot');
  const copilotClose = document.querySelector('#copilot-close');
  const copilotForm = document.querySelector('#copilot-form');
  const copilotInput = document.querySelector('#copilot-input');
  const copilotMessages = document.querySelector('#copilot-messages');
  const copilotChips = document.querySelector('#copilot-chips');
  const voiceBtn = document.querySelector('#copilot-voice');
  function addMsg(role, html) {
    if (!copilotMessages) return;
    const div = document.createElement('div');
    div.className = `cop-msg ${role}`;
    div.innerHTML = html;
    copilotMessages.appendChild(div);
    copilotMessages.scrollTop = copilotMessages.scrollHeight;
    div.querySelectorAll('[data-entity-jump]').forEach(b => b.addEventListener('click', () => showEntity(b.dataset.entityJump)));
  }
  function addTyping() {
    const div=document.createElement('div'); div.className='cop-msg ai typing'; div.id='typing'; div.innerHTML='<b>Nexus Copilot</b><p><span class="dot"></span><span class="dot"></span><span class="dot"></span> analyzing case file...</p>';
    copilotMessages.appendChild(div); copilotMessages.scrollTop=copilotMessages.scrollHeight; return div;
  }
  function isHinglish(q){
    return /(\bkya\b|\bkya hai\b|\bbatao\b|\bdikhao\b|\bkitna\b|\bkaun\b|\bkahan\b|\bkab\b|\bkaise\b|\bhain\b|\bhai\b|\bmein\b|\bhai\b|\bka\b|\bki\b|\bko\b|\bhota\b|\bhoti\b|\bhai\b|\bhai\b)/i.test(q) || /[\u0900-\u097F]/.test(q);
  }
  function copilotAnswer(q) {
    const l = q.toLowerCase();
    const H = isHinglish(q);
    if (/(kingpin|central|main suspect|mastermind|sabse bada|mukhy)/.test(l)) {
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>Arjun Mehra</b> hi is case ka <b>kingpin</b> hai — Risk <b>92</b>, 5 categories se juda hai. Centrality 0.94 hai, isko hatane se network 3 tukdo me toot jayega.</p><div class="cite"><span data-entity-jump="arjun" style="cursor:pointer">Arjun Mehra \u00B7 CR-MH-2026-0001</span><span data-entity-jump="account" style="cursor:pointer">Account \u00B7\u00B78821</span></div>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p><b>Arjun Mehra</b> is the central influencer — Risk <b>92</b>, centrality 0.94. Connects 5 categories. Removing him fragments network into 3 clusters.</p><div class="cite"><span data-entity-jump="arjun" style="cursor:pointer">Arjun Mehra \u00B7 CR-MH-2026-0001</span><span data-entity-jump="account" style="cursor:pointer">Account \u00B7\u00B78821</span><span data-entity-jump="harbor" style="cursor:pointer">Harbor Warehouse</span></div>`);
      document.querySelector('#network-body')?.classList.add('pulse-kingpin'); setTimeout(()=> document.querySelector('#network-body')?.classList.remove('pulse-kingpin'),1200);
      return;
    }
    if (/(money|trail|transaction|fund|paisa|financial|rupya|paise|payment|paisa)/.test(l)) {
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>Account \u00B7\u00B78821</b> par <b>circular paisa trail</b> mila — 96% confidence. 14-min me 3-hop loop: Riya Shah \u2192 Account \u2192 Device K-19. Amount <b>\u20B94.8L</b> x 3 baar. ML ne flag kiya.</p><div class="cite"><span data-entity-jump="account" style="cursor:pointer">Account \u00B7\u00B78821</span><span data-entity-jump="riya" style="cursor:pointer">Riya Shah</span></div>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p><b>Circular money trail</b> on <b>Account \u00B7\u00B78821</b> — 96% confidence. 14-min loop: Riya Shah \u2192 Account \u2192 Device K-19. Amount <b>\u20B94.8L</b> x 3 hops. Flagged by ML anomaly detector.</p><div class="cite"><span data-entity-jump="account" style="cursor:pointer">Account \u00B7\u00B78821</span><span data-entity-jump="riya" style="cursor:pointer">Riya Shah</span><span data-entity-jump="device" style="cursor:pointer">Device K-19</span></div>`);
      return;
    }
    if (/(harbor|warehouse|location|dock|godown|bandar)/.test(l)) {
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>Harbor Warehouse</b> — Risk 68. Wahan <b>Arjun + Riya + Vehicle DL-8C-\u00B7\u00B7427</b> 90 min ke andar 3 baar mile. Last 2 ghante pehle dikha.</p><div class="cite"><span data-entity-jump="harbor" style="cursor:pointer">Harbor Warehouse</span><span data-entity-jump="vehicle" style="cursor:pointer">Vehicle DL-8C-\u00B7\u00B7427</span></div>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p><b>Harbor Warehouse</b> — Risk 68. Co-location: <b>Arjun + Riya + Vehicle DL-8C-\u00B7\u00B7427</b> within 90 min window (3 events). Last seen 2 hrs ago.</p><div class="cite"><span data-entity-jump="harbor" style="cursor:pointer">Harbor Warehouse</span><span data-entity-jump="vehicle" style="cursor:pointer">Vehicle DL-8C-\u00B7\u00B7427</span></div>`);
      return;
    }
    if (/(simulate|arrest|detention|remove|hatana|pakdo|warrant|giraftar)/.test(l)) {
      triggerSim();
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>Arjun Mehra ko pakadne</b> ka simulation kiya. Network resilience <b style="color:var(--red)">23%</b> — 3 tukde, paisa chain toot gaya. Salah: Pehle Arjun ka warrant, Riya backup hub.</p>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p>Simulated <b>Arjun Mehra detention</b>. Resilience <b style="color:var(--red)">23%</b> — 3 clusters, financial chain breaks. Recommendation: Prioritize Arjun warrant, monitor Riya.</p>`);
      return;
    }
    if (/(arjun|mehra)/.test(l)) {
      const e=data.entities.arjun;
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>Arjun Mehra</b> — Primary suspect, Risk <b>${e.risk}</b>. IDs: ${e.criminalId} \u00B7 ${e.firNumber} \u00B7 ${e.cnrNumber}. Phone: ${e.phones.join(', ')}. ${e.note}</p><div class="cite"><span data-entity-jump="arjun" style="cursor:pointer">Arjun Mehra</span></div>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p><b>Arjun Mehra</b> — Primary subject, Risk <b>${e.risk}</b>. IDs: ${e.criminalId} \u00B7 ${e.firNumber} \u00B7 ${e.cnrNumber}. Phones: ${e.phones.join(', ')}. ${e.note}</p><div class="cite"><span data-entity-jump="arjun" style="cursor:pointer">Arjun Mehra</span></div>`);
      return;
    }
    if (/(riya|shah)/.test(l)) { const e=data.entities.riya; if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>Riya Shah</b> — Associate, Risk <b>${e.risk}</b>. CR: ${e.criminalId} \u00B7 FIR: ${e.firNumber}. 2 ghante pehle transfer se pehle contact.</p><div class="cite"><span data-entity-jump="riya" style="cursor:pointer">Riya Shah</span></div>`); else addMsg('ai', `<b>Nexus Copilot</b><p><b>Riya Shah</b> — Associate, Risk <b>${e.risk}</b>. CR: ${e.criminalId} \u00B7 FIR: ${e.firNumber}. Contact 2 hrs before transfers.</p><div class="cite"><span data-entity-jump="riya" style="cursor:pointer">Riya Shah</span></div>`); return; }
    if (/(device|k-19|k19)/.test(l)) { const e=data.entities.device; if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>Device K-19</b> — Risk <b>${e.risk}</b>. Naya device, 42 min pehle aaya. IMSI 404-11-\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7. Arjun se juda.</p><div class="cite"><span data-entity-jump="device" style="cursor:pointer">Device K-19</span></div>`); else addMsg('ai', `<b>Nexus Copilot</b><p><b>Device K-19</b> — Risk <b>${e.risk}</b>. Unknown device entered 42 min before transfer. IMSI 404-11-\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7.</p><div class="cite"><span data-entity-jump="device" style="cursor:pointer">Device K-19</span></div>`); return; }
    if (/(vehicle|gaadi|dl-8c|car)/.test(l)) { const e=data.entities.vehicle; if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>Vehicle DL-8C-\u00B7\u00B7427</b> — Risk <b>${e.risk}</b>. Harbor ke paas 4 baar dikha, last toll 42 min pehle.</p><div class="cite"><span data-entity-jump="vehicle" style="cursor:pointer">Vehicle</span></div>`); else addMsg('ai', `<b>Nexus Copilot</b><p><b>Vehicle DL-8C-\u00B7\u00B7427</b> — Risk <b>${e.risk}</b>. Repeated Harbor proximity (4 signals).</p><div class="cite"><span data-entity-jump="vehicle" style="cursor:pointer">Vehicle</span></div>`); return; }
    if (/(account|8821|bank|khata)/.test(l)) { const e=data.entities.account; if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>Account \u00B7\u00B78821</b> — Risk <b>${e.risk}</b>. Circular transfer, ${e.note}</p><div class="cite"><span data-entity-jump="account" style="cursor:pointer">Account \u00B7\u00B78821</span></div>`); else addMsg('ai', `<b>Nexus Copilot</b><p><b>Account \u00B7\u00B78821</b> — Risk <b>${e.risk}</b>. ${e.note}</p><div class="cite"><span data-entity-jump="account" style="cursor:pointer">Account \u00B7\u00B78821</span></div>`); return; }
    if (/(phone|mobile|number|contact|call|cdr)/.test(l)) {
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p>Phones: Arjun (${data.entities.arjun.phones.join(', ')}), Riya (${data.entities.riya.phones.join(', ')}), Device (IMSI 404-11-\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7). CDR me Arjun-Riya 42 calls.</p>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p>Linked phones: Arjun (${data.entities.arjun.phones.join(', ')}), Riya (${data.entities.riya.phones.join(', ')}), Device IMSI 404-11-\u00B7\u00B7\u00B7\u00B7\u00B7\u00B7. 42 calls Arjun\u2194Riya.</p>`);
      return;
    }
    if (/(fir|cnr|criminal id|cr-mh|fir-mh|case number|case no)/.test(l)) {
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p>IDs — FIR: <b>FIR-MH-2026-0147</b> (5 log), Criminal ID: <b>CR-MH-2026-0001</b> (Arjun), CNR: <b>CNR-MH-0192847</b>. Top bar me search karo.</p>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p>IDs for <b>Operation Nightfall</b>: FIR <b>FIR-MH-2026-0147</b> (5 entities), Criminal ID <b>CR-MH-2026-0001</b> (Arjun), CNR <b>CNR-MH-0192847</b>. Use top-bar ID Search.</p>`);
      return;
    }
    if (/(risk|score|confidence|khatra)/.test(l)) {
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p>Risk scores: Arjun 92 (Critical), Account 87, Device 81, Riya 74, Harbor 68, Vehicle 56. AI confidence 94.2%.</p>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p>Risk scores: Arjun 92 (Critical), Account 87, Device 81, Riya 74, Harbor 68, Vehicle 56. Overall AI confidence 94.2%.</p>`);
      return;
    }
    if (/(timeline|kab|when|activity|day|kab hua)/.test(l)) {
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p>Timeline: <b>Day 1</b> Arjun, <b>Day 2</b> Riya, <b>Day 4</b> Device, <b>Day 6</b> Harbor+Account, <b>Day 7</b> pura network. Neeche scrubber se replay karo.</p>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p>Timeline: <b>Day 1</b> Arjun, <b>Day 2</b> Riya joins, <b>Day 4</b> Device appears, <b>Day 6</b> Harbor+Account, <b>Day 7</b> full network. Use scrubber to replay.</p>`);
      return;
    }
    if (/(operation|nightfall|case|mukadma)/.test(l)) {
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>Operation Nightfall</b> — 47 entities me se 6 linked, 4 high-risk connections. Kingpin Arjun, paisa trail Account \u00B7\u00B78821, location Harbor.</p>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p><b>Operation Nightfall</b> — 47 entities analyzed, 4 high-risk connections. Central: Arjun Mehra, financial hub: Account \u00B7\u00B78821, location: Harbor Warehouse. #NTF-042</p>`);
      return;
    }
    if (/(help|kya kar|kaise|what can|madad)/.test(l)) {
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p>Pucho:<br>\u00B7 “Kingpin kaun hai?”<br>\u00B7 “Paise ka trail dikhao”<br>\u00B7 “Riya ka role?”<br>\u00B7 “Vehicle kahan hai?”<br>\u00B7 “FIR number batao”</p>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p>Try:<br>\u00B7 “Who is the kingpin?”<br>\u00B7 “Show money trail”<br>\u00B7 “What happened at Harbor?”<br>\u00B7 “Simulate arrest”<br>\u00B7 “FIR number?”</p>`);
      return;
    }
    const found = Object.entries(data.entities).find(([k,e])=> l.includes(e.name.toLowerCase().split(' ')[0]));
    if(found){
      const [k,e]=found;
      if(H) addMsg('ai', `<b>Nexus Copilot</b><p><b>${e.name}</b> — ${e.role}, Risk <b>${e.risk}</b>. ${e.note}</p><div class="cite"><span data-entity-jump="${k}" style="cursor:pointer">${e.name}</span></div>`);
      else addMsg('ai', `<b>Nexus Copilot</b><p><b>${e.name}</b> — ${e.role}, Risk <b>${e.risk}</b>. ${e.note}</p><div class="cite"><span data-entity-jump="${k}" style="cursor:pointer">${e.name}</span></div>`);
      return;
    }
    if(H) addMsg('ai', `<b>Nexus Copilot</b><p>Samjha: “<i>${q}</i>”. Ye demo file me seedha nahi mila. Hinglish me pucho jaise: “Arjun ka risk?”, “Paise ka trail?”, “Harbor kya hai?” Chips se start karo.</p>`);
    else addMsg('ai', `<b>Nexus Copilot</b><p>I understood: “<i>${q}</i>”. Not directly in demo file. Try: “Who is the kingpin?”, “Show money trail”, “What happened at Harbor?” or tap a chip.</p>`);
  }
  function escHtml(s){ return String(s == null ? '' : s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
  function liveAnswer(a){
    const cites = (a.citations || []).map((c) => `<span>${escHtml(c.name)}${c.chainSeq != null ? ' · chain #' + c.chainSeq : ''}</span>`).join('');
    addMsg('ai', `<b>Nexus Copilot</b><p>${a.verified ? '[verified ✅] ' : '[UNVERIFIED ❌] '}${escHtml(a.answer).replace(/\n/g,'<br>')}</p>` + (cites ? `<div class="cite">${cites}</div>` : ''));
  }
  function handleQuery(q){
    addMsg('user', `<b>You</b><p>${escHtml(q)}</p>`);
    const t=addTyping();
    const local=()=>{ t.remove(); copilotAnswer(q); };
    if (!__token) { setTimeout(local, 650); return; }
    const payload = __caseId ? { question: q, caseId: __caseId } : { question: q };
    __api('/api/copilot/ask', { method: 'POST', body: JSON.stringify(payload) }).then(({ ok, body }) => {
      const a = ok && body ? body.data || body : null;
      if (a && a.answer) { t.remove(); liveAnswer(a); }
      else local();
    }).catch(local);
  }
  if (fab && copilot) {
    fab.addEventListener('click', () => { copilot.classList.add('open'); copilot.setAttribute('aria-hidden','false'); copilotInput.focus(); });
    copilotClose.addEventListener('click', () => { copilot.classList.remove('open'); copilot.setAttribute('aria-hidden','true'); });
    copilotForm.addEventListener('submit', (e) => { e.preventDefault(); const q = copilotInput.value.trim(); if (!q) return; copilotInput.value=''; handleQuery(q); });
    copilotChips.querySelectorAll('.chip-action').forEach(c => c.addEventListener('click', () => handleQuery(c.dataset.q)));
    if(voiceBtn){
      let rec=null; 
      voiceBtn.addEventListener('click', ()=>{
        const SR=window.SpeechRecognition||window.webkitSpeechRecognition;
        if(!SR){ toast.textContent='Voice not supported in this browser.'; toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'),2000); return; }
        if(rec){ rec.stop(); rec=null; voiceBtn.textContent='\uD83C\uDFA4'; return; }
        rec=new SR(); rec.lang='en-IN'; rec.interimResults=false;
        voiceBtn.textContent='\uD83D\uDD34'; toast.textContent='Listening... speak now'; toast.classList.add('show');
        rec.onresult=(e)=>{ const txt=e.results[0][0].transcript; copilotInput.value=txt; handleQuery(txt); };
        rec.onend=()=>{ voiceBtn.textContent='\uD83C\uDFA4'; toast.classList.remove('show'); rec=null; };
        rec.onerror=()=>{ voiceBtn.textContent='\uD83C\uDFA4'; rec=null; };
        rec.start();
      });
    }
  }
  // Scrubber
  const range = document.querySelector('#scrubber-range');
  const label = document.querySelector('#scrubber-label');
  const play = document.querySelector('#scrubber-play');
  const labels = ['Day 1 \u00B7 Arjun only','Day 2 \u00B7 + Riya','Day 4 \u00B7 + Device K-19','Day 6 \u00B7 + Harbor & Account','Day 7 \u00B7 Full Network'];
  function applyScrubber(v) {
    const day = parseInt(v,10);
    if(label) label.textContent = labels[day] || labels[4];
    document.querySelectorAll('#network-body [data-day]').forEach(el => {
      const d = parseInt(el.dataset.day,10);
      const visible = d <= day;
      if(el.tagName.toLowerCase()==='line'){
        el.style.opacity = visible ? '1' : '0.08';
        el.style.strokeOpacity = visible ? '' : '0.08';
      } else {
        el.style.opacity = visible ? '1' : '0.15';
        el.style.filter = visible ? '' : 'grayscale(1) blur(0.5px)';
        el.style.pointerEvents = visible ? '' : 'none';
        el.style.transform = visible ? '' : 'scale(0.96)';
      }
    });
  }
  if (range) { range.addEventListener('input', () => applyScrubber(range.value)); applyScrubber(range.value); }
  let playTimer=null;
  if (play && range) {
    play.addEventListener('click', () => {
      if (playTimer) { clearInterval(playTimer); playTimer=null; play.textContent='\u25B6'; return; }
      play.textContent='\u275A\u275A';
      let v=0; range.value=v; applyScrubber(v);
      playTimer=setInterval(()=>{ v++; if(v>4){clearInterval(playTimer);playTimer=null;play.textContent='\u25B6';return;} range.value=v; applyScrubber(v); }, 720);
    });
  }
  function triggerSim() {
    const body=document.querySelector('#network-body');
    const overlay=document.querySelector('#sim-overlay');
    if(!body||!overlay) return;
    body.classList.add('sim-active');
    overlay.hidden=false;
    const detailSim=document.querySelector('#sim-detail');
    if(detailSim) detailSim.hidden=false;
  }
  const simBtn=document.querySelector('#simulate-btn');
  if(simBtn) simBtn.addEventListener('click', ()=>{ triggerSim(); const k=document.querySelector('#entity-name')?.textContent || 'Arjun Mehra'; handleQuery(`Simulate ${k} arrest`); if(copilot) { copilot.classList.add('open'); copilot.setAttribute('aria-hidden','false'); } });
  const style=document.createElement('style'); style.textContent='.typing .dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:var(--cyan);margin:0 2px;animation:blink 1s infinite}.typing .dot:nth-child(2){animation-delay:.15s}.typing .dot:nth-child(3){animation-delay:.3s}@keyframes blink{0%,80%,100%{opacity:.25}40%{opacity:1}} .pulse-kingpin{animation:pulseKing 1.1s ease} @keyframes pulseKing{0%{box-shadow:0 0 0 0 rgba(40,215,228,.0)}50%{box-shadow:0 0 0 12px rgba(40,215,228,.15)}100%{box-shadow:0 0 0 0 rgba(40,215,228,0)}}';
  document.head.appendChild(style);
  window.__nexusFinal={};window.__nexusUnique = { triggerSim, copilotAnswer, applyScrubber, showEntity };

  // FINAL: upper-left accessible panels + varying risk + activity + report
  function riskOf(e){ const r=parseInt(e.risk||'0',10); return isNaN(r)?0:r; }
  function probClass(r){ return r>=80?'high':(r>=65?'med':'low'); }
  const overlay=document.querySelector('#drawer-overlay');
  function openDrawer(id){ document.querySelectorAll('.side-drawer').forEach(d=>{d.classList.remove('open');d.setAttribute('aria-hidden','true');}); const el=document.getElementById(id); if(!el) return; el.classList.add('open'); el.setAttribute('aria-hidden','false'); if(overlay) overlay.hidden=false; }
  function closeDrawers(){ document.querySelectorAll('.side-drawer').forEach(d=>{d.classList.remove('open');d.setAttribute('aria-hidden','true');}); if(overlay) overlay.hidden=true; }
  if(overlay) overlay.addEventListener('click', closeDrawers);
  document.querySelectorAll('.drawer-close').forEach(b=> b.addEventListener('click', closeDrawers));
  document.addEventListener('keydown', (e)=>{ if(e.key==='Escape'){ closeDrawers(); const rm=document.querySelector('#report-modal'); if(rm) rm.hidden=true; }});
  function renderEntityList(filter){
    const box=document.querySelector('#entity-list'); if(!box) return;
    const q=(filter||'').toLowerCase();
    const entries=Object.entries(data.entities).filter(([k,e])=> !q || e.name.toLowerCase().includes(q));
    const cnt=document.querySelector('#entity-count'); if(cnt) cnt.textContent=String(entries.length).padStart(2,'0');
    box.innerHTML=entries.map(([k,e])=>{ const r=riskOf(e); return `<button type="button" class="entity-row" data-key="${k}"><span><b>${e.name}</b><small>${e.role} - ${e.type||''}</small></span><span class="prob ${probClass(r)}">${r}%</span></button>`; }).join('') || '<div class="muted" style="font-size:12px">No entities match.</div>';
    box.querySelectorAll('.entity-row').forEach(b=> b.addEventListener('click', ()=>{ closeDrawers(); showEntity(b.dataset.key); }));
  }
  function renderSuspectActivity(){
    const box=document.querySelector('#suspect-activity-list'); if(!box) return;
    const acts=data.suspectActivities||[];
    box.innerHTML=acts.map(a=>`<div class="sact"><div style="display:flex;gap:8px;align-items:center"><span class="activity-icon" style="width:24px;height:24px;border-radius:7px;background:rgba(73,133,255,.15);color:var(--blue);display:grid;place-items:center">${a.icon||'!'}</span><strong style="font-size:12px">Suspect activity</strong><time style="margin-left:auto">${a.t}</time></div><p style="margin:8px 0 6px;line-height:1.5">${a.text}</p><button class="chip chip-action" data-jump="${a.entity||'arjun'}" style="font-size:11px">Open dossier</button></div>`).join('');
    box.querySelectorAll('[data-jump]').forEach(b=> b.addEventListener('click', ()=>{ closeDrawers(); showEntity(b.dataset.jump); }));
    const filt=document.querySelector('#entity-filter'); if(filt) filt.addEventListener('input', ()=> renderEntityList(filt.value));
  }
  function renderReport(){
    const body=document.querySelector('#report-body'); if(!body) return;
    const ents=Object.entries(data.entities).map(([k,e])=>({k,name:e.name,role:e.role,risk:riskOf(e),criminalId:e.criminalId||'-',fir:e.firNumber||'-',cnr:e.cnrNumber||'-'})).sort((a,b)=>b.risk-a.risk);
    const avg=Math.round(ents.reduce((s,e)=>s+e.risk,0)/Math.max(1,ents.length));
    const acts=(data.suspectActivities||[]).slice(0,5).map(a=>`<div class="sact"><time>${a.t}</time><p style="margin:4px 0 0">${a.text}</p></div>`).join('');
    body.innerHTML=`<div class="kv"><span class="muted">Case</span><span><b>Operation Nightfall (NTF-042)</b> - Active, High priority. Lead: Officer K. Rao</span></div>`
    +`<div class="kv"><span class="muted">IDs</span><span>FIR <b>FIR-MH-2026-0147</b> | CNR <b>CNR-MH-0192847</b> | Criminal <b>CR-MH-2026-0001</b></span></div>`
    +`<div class="kv"><span class="muted">Totals</span><span><b>${String(ents.length).padStart(2,'0')} entities</b> shown, avg risk <b>${avg}%</b>, 04 high-risk connections, AI confidence 94.2%</span></div>`
    +`<div><strong style="font-size:13px">Entities with probability</strong><div style="display:grid;gap:6px;margin-top:8px">`+ents.map(e=>`<div class="entity-row"><span><b>${e.name}</b><small>${e.role} | CR:${e.criminalId} FIR:${e.fir} CNR:${e.cnr}</small></span><span class="prob ${probClass(e.risk)}">${e.risk}%</span></div>`).join('')+`</div></div>`
    +`<div><strong style="font-size:13px">Recent suspect activity</strong><div style="display:grid;gap:6px;margin-top:8px">${acts}</div></div>`
    +`<div class="kv"><span class="muted">Conclusion</span><span>Central influencer <b>Arjun Mehra (92%)</b>. Circular money pattern on Account 8821. Harbor co-location confirmed. Recommendation: review 14-min loop + confirm warehouse timeline + prioritize warrant.</span></div>`;
  }
  document.querySelectorAll('[data-nav]').forEach(a=> a.addEventListener('click', (ev)=>{
    const v=a.dataset.nav;
    document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active')); a.classList.add('active');
    if(v==='entities'){ ev.preventDefault(); renderEntityList(''); renderSuspectActivity(); openDrawer('entities-drawer'); }
    if(v==='activity'){ ev.preventDefault(); renderSuspectActivity(); renderEntityList(''); openDrawer('activity-drawer'); }
    if(v==='reports'){ ev.preventDefault(); renderReport(); const m=document.querySelector('#report-modal'); if(m) m.hidden=false; }
    if(v==='network'){ ev.preventDefault(); closeDrawers(); document.querySelector('#network')?.scrollIntoView({behavior:'smooth'}); }
    if(v==='alerts'){ ev.preventDefault(); closeDrawers(); document.querySelector('#alerts')?.scrollIntoView({behavior:'smooth'}); }
    if(v==='overview'){ ev.preventDefault(); closeDrawers(); window.scrollTo({top:0,behavior:'smooth'}); }
  }));
  const rc=document.querySelector('#report-close'); if(rc) rc.addEventListener('click', ()=>{ document.querySelector('#report-modal').hidden=true; });
  const rm=document.querySelector('#report-modal'); if(rm) rm.addEventListener('click', (e)=>{ if(e.target===rm) rm.hidden=true; });
  const rp=document.querySelector('#report-print'); if(rp) rp.addEventListener('click', ()=> window.print());
  const rcp=document.querySelector('#report-copy'); if(rcp) rcp.addEventListener('click', ()=>{ const t=document.querySelector('#report-body')?.innerText||''; try{ navigator.clipboard.writeText(t); toast.textContent='Report summary copied.'; }catch(_){ toast.textContent='Copy not available.'; } toast.classList.add('show'); setTimeout(()=>toast.classList.remove('show'),2000); });
  renderEntityList(''); renderSuspectActivity();
  // varying risk signal below graph
  let curRisk=78, dir=1;
  setInterval(()=>{
    curRisk+= (Math.random()*4-2) + dir*0.6;
    if(curRisk>89){curRisk=89;dir=-1;} if(curRisk<71){curRisk=71;dir=1;}
    const v=Math.round(curRisk);
    const el=document.querySelector('#risk-signal-value'); if(el) el.textContent=String(v);
    const fill=document.querySelector('#risk-signal-fill'); if(fill) fill.style.width=v+'%';
    const lab=document.querySelector('#risk-signal-label'); if(lab) lab.textContent = v>=85?'Critical - varies with live intel':(v>=75?'High - varies with live intel':'Elevated - varies with live intel');
    const tr=document.querySelector('#risk-signal-trend'); if(tr) tr.textContent=(dir>0?'+':'')+(Math.random()*3).toFixed(1)+'% last hour';
    const vv=document.querySelector('#entity-risk'); if(vv && panel.classList.contains('open')){ /* keep panel stable */ }
  },3000);
  window.__nexusFinal={renderEntityList,renderSuspectActivity,renderReport,openDrawer,closeDrawers};


  // TABS: proper per-tab pages in main area (replaces drawer-only nav)
  document.querySelectorAll('[data-nav]').forEach(a=>{ try{ a.replaceWith(a.cloneNode(true)); }catch(_){} });
  const navItems = document.querySelectorAll('[data-nav]');
  function riskNum(e){ const r=parseInt(e.risk||'0',10); return isNaN(r)?0:r; }
  function probCls(r){ return r>=80?'high':(r>=65?'med':'low'); }
  function renderEntitiesTable(){
    const tb=document.querySelector('#entities-tbody'); if(!tb) return;
    const ents=Object.entries(data.entities).map(([k,e])=>({k,name:e.name,type:e.type||'-',role:e.role||'-',risk:riskNum(e),cr:e.criminalId||'-',fir:e.firNumber||'-',cnr:e.cnrNumber||'-'})).sort((a,b)=>b.risk-a.risk);
    const tag=document.querySelector('#entities-count-tag'); if(tag) tag.textContent=ents.length+' SHOWN';
    const sub=document.querySelector('#entities-sub'); if(sub) sub.textContent=ents.length+' linked + '+(47-ents.length)+' background = 47 total';
    tb.innerHTML=ents.map(e=>`<tr><td><b>${e.name}</b></td><td class="muted">${e.type}</td><td class="muted">${e.role}</td><td class="muted" style="font-size:11px">CR:${e.cr}<br>FIR:${e.fir}<br>CNR:${e.cnr}</td><td><div style="display:flex;align-items:center;gap:8px"><div class="prob-bar"><div class="prob-fill" style="width:${e.risk}%"></div></div><b class="prob ${probCls(e.risk)}">${e.risk}%</b></div></td><td><button class="mini-btn" data-open="${e.k}">Open</button></td></tr>`).join('');
    tb.querySelectorAll('[data-open]').forEach(b=> b.addEventListener('click', ()=> showEntity(b.dataset.open)));
  }
  function renderActivityTimeline(){
    const box=document.querySelector('#activity-timeline'); if(!box) return;
    const acts=data.suspectActivities||[];
    box.innerHTML=acts.map(a=>`<div class="tl-item"><div class="tl-dot">${a.icon||'!'}</div><div class="tl-card"><div style="display:flex;gap:8px;align-items:center"><strong style="font-size:12px">Suspect activity</strong><time style="margin-left:auto">${a.t}</time></div><p style="margin:6px 0 8px;line-height:1.5">${a.text}</p><button class="mini-btn" data-jump="${a.entity||'arjun'}">Open dossier</button></div></div>`).join('');
    box.querySelectorAll('[data-jump]').forEach(b=> b.addEventListener('click', ()=> showEntity(b.dataset.jump)));
  }
  function renderTabReport(){
    const body=document.querySelector('#tab-report-body'); if(!body) return;
    const ents=Object.entries(data.entities).map(([k,e])=>({k,name:e.name,role:e.role,risk:riskNum(e),cr:e.criminalId||'-',fir:e.firNumber||'-',cnr:e.cnrNumber||'-'})).sort((a,b)=>b.risk-a.risk);
    const avg=Math.round(ents.reduce((s,e)=>s+e.risk,0)/Math.max(1,ents.length));
    const acts=(data.suspectActivities||[]).slice(0,5).map(a=>`<div class="sact"><time>${a.t}</time><p style="margin:4px 0 0">${a.text}</p></div>`).join('');
    body.innerHTML=`<div class="kv"><span class="muted">Case</span><span><b>Operation Nightfall (NTF-042)</b> - Active, High priority. Lead: Officer K. Rao</span></div>`
    +`<div class="kv"><span class="muted">IDs</span><span>FIR <b>FIR-MH-2026-0147</b> | CNR <b>CNR-MH-0192847</b> | Criminal <b>CR-MH-2026-0001</b></span></div>`
    +`<div class="kv"><span class="muted">Totals</span><span><b>47 entities</b>, avg risk <b>${avg}%</b>, 04 high-risk connections, AI confidence 94.2%</span></div>`
    +`<div><strong style="font-size:13px">Entities with probability</strong><div style="display:grid;gap:6px;margin-top:8px">`+ents.map(e=>`<div class="entity-row"><span><b>${e.name}</b><small>${e.role} | CR:${e.cr} FIR:${e.fir}</small></span><span class="prob ${probCls(e.risk)}">${e.risk}%</span></div>`).join('')+`</div></div>`
    +`<div><strong style="font-size:13px">Recent suspect activity</strong><div style="display:grid;gap:6px;margin-top:8px">${acts}</div></div>`
    +`<div class="kv"><span class="muted">Conclusion</span><span>Central influencer <b>Arjun Mehra (92%)</b>. Circular money pattern on Account 8821. Harbor co-location confirmed. Next: review 14-min loop + warehouse timeline + prioritize warrant.</span></div>`
    +`<div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:10px"><button class="mini-btn" data-live="verify-chain">Verify hash-chain</button><button class="mini-btn" data-live="certificate">Integrity Certificate (PDF)</button><button class="mini-btn" data-live="verify-all">Verify Entire Chain</button></div><div id="live-result" class="muted" style="font-size:12px;margin-top:6px"></div>`;
  }
  // LEVEL-2 live actions (delegated; works after every re-render)
  document.addEventListener('click', (ev) => {
    const b = ev.target && ev.target.closest ? ev.target.closest('[data-live]') : null;
    if (!b || !__token) return;
    const out = document.querySelector('#live-result');
    const say = (m) => { if (out) out.textContent = m; };
    const id = (typeof __caseId === 'string' && __caseId) ? __caseId : (window.__nexusLive && window.__nexusLive.caseId ? window.__nexusLive.caseId() : null);
    if (b.dataset.live === 'verify-chain') {
      if (!id) { say('Case not synced yet — reload once.'); return; }
      say('Verifying…');
      __api('/api/cases/' + id + '/verify', { method: 'POST' }).then(({ ok, body }) => {
        const d = ok && body ? body.data || body : null;
        say(d ? ((d.ok ? 'Verified ✅' : 'TAMPER ❌') + ' — ' + d.checked + ' records. ' + (d.message || '')) : 'Verify failed.');
      }).catch(() => say('Verify failed (offline?).'));
    }
    if (b.dataset.live === 'certificate') {
      if (!id) { say('Case not synced yet — reload once.'); return; }
      say('Preparing PDF…');
      fetch('/api/certificates/cases/' + id, { headers: { Authorization: 'Bearer ' + __token } }).then((r) => {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.blob();
      }).then((blob) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a'); a.href = url; a.download = 'Integrity-Certificate-NTF-042.pdf'; a.click();
        setTimeout(() => URL.revokeObjectURL(url), 5000);
        say('Certificate downloaded.');
      }).catch(() => say('Certificate failed.'));
    }
    if (b.dataset.live === 'verify-all') {
      say('Scanning entire chain…');
      __api('/api/admin/verify-all', { method: 'POST' }).then(({ ok, status, body }) => {
        const d = ok && body ? body.data || body : null;
        say(d ? ('Entire chain: ' + d.intact + '/' + d.scanned + ' intact' + (d.allOk ? ' ✅' : ' ❌')) : (status === 403 ? 'Admin only.' : 'Scan failed.'));
      }).catch(() => say('Scan failed (offline?).'));
    }
  });
  function flashCard(sel){ const el=document.querySelector(sel); if(!el) return; el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }
  function showView(name){
    document.querySelectorAll('main .view').forEach(v=>{ v.hidden=true; v.classList.remove('active'); });
    const show=(sel)=>{ document.querySelectorAll(sel).forEach(v=>{ v.hidden=false; v.classList.add('active'); }); };
    if(name==='overview'){ show('.view-overview'); window.scrollTo({top:0,behavior:'smooth'}); }
    else if(name==='network'){ show('.view-network'); const s=document.querySelector('.stats.view-overview'); if(s){s.hidden=false;s.classList.add('active');} document.querySelector('#network')?.scrollIntoView({behavior:'smooth',block:'start'}); flashCard('#network'); }
    else if(name==='alerts'){ show('.view-network'); const s=document.querySelector('.stats.view-overview'); if(s){s.hidden=false;s.classList.add('active');} document.querySelector('#alerts')?.scrollIntoView({behavior:'smooth',block:'start'}); flashCard('#alerts'); }
    else if(name==='entities'){ const s=document.querySelector('.stats.view-overview'); if(s){s.hidden=false;s.classList.add('active');} show('#view-entities'); renderEntitiesTable(); document.querySelector('#view-entities')?.scrollIntoView({behavior:'smooth'}); }
    else if(name==='activity'){ const s=document.querySelector('.stats.view-overview'); if(s){s.hidden=false;s.classList.add('active');} show('#view-activity'); renderActivityTimeline(); document.querySelector('#view-activity')?.scrollIntoView({behavior:'smooth'}); }
    else if(name==='reports'){ const s=document.querySelector('.stats.view-overview'); if(s){s.hidden=false;s.classList.add('active');} show('#view-reports'); renderTabReport(); document.querySelector('#view-reports')?.scrollIntoView({behavior:'smooth'}); }
  }
  navItems.forEach(a=> a.addEventListener('click', (ev)=>{
    ev.preventDefault();
    navItems.forEach(n=>n.classList.remove('active')); a.classList.add('active');
    if(typeof closeDrawers==='function') closeDrawers();
    showView(a.dataset.nav);
  }));
  const tp=document.querySelector('#tab-report-print'); if(tp) tp.addEventListener('click', ()=> window.print());
  renderEntitiesTable(); renderActivityTimeline(); renderTabReport();
  window.__nexusTabs={showView,renderEntitiesTable,renderActivityTimeline,renderTabReport};

})();
