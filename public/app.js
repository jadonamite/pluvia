'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = { claims: [], policies: [], selected: null, run: null, chart: null, busy: false, ticket: 0, filter: 'all', verdicts: {}, poll: null, shown: {}, reveal: null };
  const money = value => Number.isFinite(value) ? new Intl.NumberFormat('en-NG', { style: 'currency', currency: 'NGN', maximumFractionDigits: 0 }).format(value) : 'Not available';
  const number = value => Number.isFinite(value) ? new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(value) : 'Unavailable';
  const labels = { PAY: 'Pay', PAY_ANYWAY: 'Pay anyway', INSPECT: 'Inspect', NO_PAY: 'Do not pay' };
  const tone = { PAY: 'pay', PAY_ANYWAY: 'pay-anyway', INSPECT: 'inspect', NO_PAY: 'refuse' };
  const sourceName = source => ({ ghcn: 'Ground gauge', power: 'Independent satellite', none: 'No index approved' }[source] || 'Not available');
  const statusOrder = { FAIL: 0, WARN: 1, PASS: 3 };

  function el(tag, content, className) { const node = document.createElement(tag); if (content != null) node.textContent = String(content); if (className) node.className = className; return node; }
  function button(text, className, onClick) { const node = el('button', text, className); node.type = 'button'; if (onClick) node.addEventListener('click', onClick); return node; }
  function verdictTag(verdict, text) { const tag = el('span', text || labels[verdict] || 'Review required', `verdict ${tone[verdict] || ''}`); return tag; }
  function date(value) { const parsed = new Date(`${String(value).slice(0, 10)}T00:00:00Z`); return Number.isNaN(parsed.valueOf()) ? String(value || 'Unknown date') : new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(parsed); }
  function policyFor(claim) { return state.policies.find(p => p.policy_id === claim?.policy_id); }
  function query(values, replace = false) { const url = new URL(location.href); for (const [key, value] of Object.entries(values)) value == null ? url.searchParams.delete(key) : url.searchParams.set(key, value); history[replace ? 'replaceState' : 'pushState']({}, '', url); }
  function status(message, error = false) { $('status').textContent = message; $('status').setAttribute('role', error ? 'alert' : 'status'); }
  async function request(path, options = {}) { const response = await fetch(path, { ...options, headers: { 'Content-Type': 'application/json', ...(options.headers || {}) } }); let data; try { data = await response.json(); } catch { throw new Error('The server returned an unreadable response.'); } if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : data.error?.message || `Request failed (${response.status}).`); return data; }

  // appearance, kept for this tab only
  function currentTheme() { return document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'); }
  function themeLabel() { $('theme').textContent = currentTheme() === 'dark' ? 'Light appearance' : 'Dark appearance'; document.querySelector('meta[name="theme-color"]').content = currentTheme() === 'dark' ? '#14120E' : '#F2EDE3'; }
  try { const stored = sessionStorage.getItem('pluvia-theme'); if (stored === 'light' || stored === 'dark') document.documentElement.dataset.theme = stored; state.verdicts = JSON.parse(sessionStorage.getItem('pluvia-verdicts') || '{}'); } catch { /* Session preferences are optional. */ }
  themeLabel();
  $('theme').addEventListener('click', () => { const theme = currentTheme() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; try { sessionStorage.setItem('pluvia-theme', theme); } catch { /* Session preferences are optional. */ } themeLabel(); if (state.run) showCase(state.run); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeLabel(); if (state.run) showCase(state.run); });

  // one sheet for every detail view; closes on Esc, the close button or a click outside it
  const sheet = $('sheet');
  function openSheet(label, title, ...nodes) { $('sheet-label').textContent = label; $('sheet-title').textContent = title; $('sheet-body').replaceChildren(...nodes); if (sheet.open) sheet.close(); sheet.showModal(); $('sheet-body').scrollTop = 0; }
  $('sheet-close').addEventListener('click', () => sheet.close());
  sheet.addEventListener('click', event => { if (event.target === sheet) sheet.close(); });

  // phones show either the list or the case
  function view(name) { $('desk').dataset.view = name; if (name === 'case') $('case').focus({ preventScroll: true }); }
  $('back').addEventListener('click', () => { view('list'); window.scrollTo(0, 0); });

  function renderInbox() {
    const filter = $('claim-search').value.trim().toLowerCase();
    const claims = state.claims.filter(c => {
      const p = policyFor(c); const reviewed = !!state.verdicts[c.claim_id];
      if (state.filter === 'todo' && reviewed) return false;
      if (state.filter === 'done' && !reviewed) return false;
      return [c.claim_id, c.policy_id, p?.group_name, p?.ref_station_id, c.event_text].join(' ').toLowerCase().includes(filter);
    });
    $('claim-count').textContent = String(state.claims.length); $('claim-list').replaceChildren();
    if (!claims.length) { $('claim-list').append(el('p', state.claims.length ? 'No claim matches. Try a group, station or ID.' : 'No claims yet.', 'muted')); return; }
    for (const claim of claims) {
      const policy = policyFor(claim); const link = el('a', null, 'claim'); const url = new URL(location.href); url.searchParams.set('claim', claim.claim_id); url.searchParams.delete('run'); link.href = url.pathname + url.search;
      if (state.selected?.claim_id === claim.claim_id) link.setAttribute('aria-current', 'true');
      const verdict = state.verdicts[claim.claim_id];
      link.append(el('strong', (policy?.group_name || claim.policy_id).replace(/ \(synthetic\)$/, '')), el('span', claim.claim_id, 'mono'), verdict ? verdictTag(verdict) : el('span', 'To review', 'todo'));
      link.addEventListener('click', event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return; event.preventDefault(); selectClaim(claim.claim_id); view('case'); });
      $('claim-list').append(link);
    }
  }
  document.querySelectorAll('[data-filter]').forEach(chip => chip.addEventListener('click', () => { state.filter = chip.dataset.filter; document.querySelectorAll('[data-filter]').forEach(c => c.setAttribute('aria-pressed', String(c === chip))); renderInbox(); }));

  function policySheet(claim, policy) {
    const list = el('dl', null, 'terms');
    for (const [label, value] of [['Policy', claim.policy_id], ['Crop', policy?.crop || 'Unavailable'], ['Reference station', policy?.ref_station_id || 'Unavailable'], ['Cover window', policy ? `${date(claim.window_override?.start || policy.window_start)} to ${date(claim.window_override?.end || policy.window_end)}` : 'Unavailable'], ['Pays from', policy ? `${number(policy.trigger_mm)} mm and below` : 'Unavailable'], ['Pays in full at', policy ? `${number(policy.exit_mm)} mm and below` : 'Unavailable'], ['Sum insured', `${money(policy?.sum_insured_ngn)} (synthetic)`]]) { const row = el('div'); row.append(el('dt', label), el('dd', value)); list.append(row); }
    openSheet(claim.claim_id, 'Policy terms', list);
  }
  function caseHead(claim, policy) {
    const root = $('case-head'); root.replaceChildren();
    const top = el('div', null, 'case-top'); top.append(el('span', claim.claim_id, 'mono muted'), el('span', 'Synthetic', 'tag'));
    const verdict = state.run?.claim_id === claim.claim_id ? state.run.decision?.verdict : state.verdicts[claim.claim_id];
    const title = el('div', null, 'case-title'); title.append(el('h2', (policy?.group_name || claim.policy_id).replace(/ \(synthetic\)$/, '')), verdict ? verdictTag(verdict) : el('span', 'To review', 'todo'));
    const actions = el('div', null, 'case-actions');
    const run = button(state.run ? 'Open a new case' : 'Hand to the agent', 'button', startCase); run.id = 'run-review'; run.disabled = state.busy || !policy;
    actions.append(run, button('Policy terms', 'button ghost', () => policySheet(claim, policy)));
    root.append(top, title, el('p', claim.event_text || 'No statement from the group.', 'event'), actions);
  }

  function selectClaim(id, navigate = true, latest = true) {
    const claim = state.claims.find(c => c.claim_id === id); if (!claim) { status('That claim is not in the register. Pick one from the list.', true); return; }
    state.ticket++; clearTimeout(state.poll); state.selected = claim; state.run = null; state.busy = false; $('results').hidden = true; $('empty').hidden = false;
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    caseHead(claim, policyFor(claim)); renderInbox(); status(''); if (navigate) query({ claim: id, case: null }); if (latest) latestCase(claim.claim_id);
  }
  async function loadInbox() {
    status('Loading claims…');
    try {
      const data = await request('/claims'); state.claims = Array.isArray(data.claims) ? data.claims : []; state.policies = Array.isArray(data.policies) ? data.policies : []; renderInbox(); status('');
      const params = new URLSearchParams(location.search); const id = params.get('claim') || state.selected?.claim_id || state.claims[0]?.claim_id;
      await loadVerdicts(); if (id) selectClaim(id, false, !params.get('case')); if (params.get('claim')) view('case'); if (params.get('case')) await openCase(params.get('case'));
    } catch (error) { status(`The claims could not be loaded. ${error.message} Reload the page to try again.`, true); $('claim-list').replaceChildren(el('p', 'The list is unavailable.', 'muted')); }
  }
  const labels2 = { investigating: 'The agent is working', inspection_open: 'Inspection open', awaiting_signoff: 'Waiting for your sign-off', settled: 'Settled', closed: 'Closed', escalated: 'With a person', failed: 'Stopped' };
  async function loadVerdicts() {
    try { const { cases } = await request('/cases'); state.verdicts = {}; for (const c of cases.reverse()) if (c.decision) state.verdicts[c.claim_id] = c.decision.verdict; } catch { /* The list still works without verdicts. */ }
  }
  async function latestCase(claimId) {
    const ticket = state.ticket;
    try { const { cases } = await request(`/cases?claim=${encodeURIComponent(claimId)}`); if (ticket !== state.ticket || !cases.length) return; showCase(cases[0]); } catch { /* No earlier case for this claim. */ }
  }
  async function openCase(id) {
    try { showCase(await request(`/cases/${encodeURIComponent(id)}`)); } catch (error) { status(`That case could not be opened. ${error.message}`, true); }
  }
  async function startCase() {
    if (!state.selected || state.busy) return; state.busy = true; const ticket = ++state.ticket;
    const run = $('run-review'); run.disabled = true; run.textContent = 'Starting…';
    try { const item = await request('/cases', { method: 'POST', body: JSON.stringify({ claim_id: state.selected.claim_id }) }); if (ticket !== state.ticket) return; query({ claim: state.selected.claim_id, case: item.id }); showCase(item); }
    catch (error) { status(`The agent could not start. ${error.message}`, true); }
    finally { state.busy = false; if (state.selected) caseHead(state.selected, policyFor(state.selected)); }
  }
  // While the agent works, the case is fetched every two seconds and redrawn.
  function poll(id) {
    clearTimeout(state.poll); const ticket = state.ticket;
    state.poll = setTimeout(async () => { try { const item = await request(`/cases/${encodeURIComponent(id)}`); if (ticket === state.ticket) showCase(item); } catch { poll(id); } }, 2000);
  }
  async function act(path, body, done) {
    try { showCase(await request(path, { method: 'POST', body: JSON.stringify(body) })); if (done) status(done); } catch (error) { status(error.message, true); }
  }

  // tabs: arrow keys move between them
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(tab, focus = false) {
    for (const t of tabs) { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; $(t.getAttribute('aria-controls')).hidden = !on; }
    if (focus) tab.focus(); if (tab.id === 'tab-evidence' && state.run) drawChart({ evidence: state.run.evidence || {}, policy: policyFor(state.selected), claim: state.selected });
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => { const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]; if (event.key === 'Home') selectTab(tabs[0], true); else if (event.key === 'End') selectTab(tabs[tabs.length - 1], true); else if (step) selectTab(tabs[(i + step + tabs.length) % tabs.length], true); else return; event.preventDefault(); });
  });

  // A replayed case plays its recorded steps out one by one, as they happened live.
  function revealed(item) {
    if (!item.replay || matchMedia('(prefers-reduced-motion: reduce)').matches) return item;
    const count = state.shown[item.id] ?? 0; if (count >= item.events.length) return item;
    clearTimeout(state.reveal); const ticket = state.ticket;
    state.reveal = setTimeout(() => { if (ticket !== state.ticket || state.run?.id !== item.id) return; state.shown[item.id] = count + 1; showCase(item); }, item.events[count]?.kind === 'thought' ? 700 : 450);
    const events = item.events.slice(0, count); const decided = events.some(e => e.kind === 'decision');
    return { ...item, events, running: true, steps_used: events.filter(e => e.kind === 'tool' || e.kind === 'decision' || e.kind === 'action').length, state: 'investigating', decision: decided ? item.decision : undefined, proposal: decided ? item.proposal : undefined, inspection: undefined, signoff: undefined, payment: undefined, outbox: [], summary: undefined };
  }
  function showCase(full) {
    state.run = full; const claim = state.selected; const item = revealed(full);
    if (item.decision) state.verdicts[item.claim_id] = item.decision.verdict;
    const first = $('results').hidden; $('empty').hidden = true; $('results').hidden = false; if (first) selectTab(tabs[0]);
    if (claim) caseHead(claim, policyFor(claim)); renderInbox();
    const working = item.running || (item.state === 'investigating' && !item.replay);
    if (item.replay && item.running) { $('working').hidden = false; $('working').textContent = `Replaying a recorded live investigation · step ${item.steps_used} · ${item.events.at(-1)?.summary || ''}`; }
    else $('working').hidden = !working && !item.replay;
    if (!(item.replay && item.running)) $('working').textContent = working ? `The agent is working · step ${item.steps_used} · ${item.events.at(-1)?.summary || ''}` : item.replay ? `A recorded live investigation, replayed${item.models?.length ? ` · ${item.models.join(', ')}` : ''}` : '';
    renderDecision(item); renderTimeline(item); renderChecks(item.decision?.probes || []); renderActions(item);
    const output = { evidence: item.evidence || {}, policy: policyFor(claim), claim };
    renderFigures(output); if (!$('panel-evidence').hidden) drawChart(output);
    if (item.running && !item.replay) poll(item.id);
  }

  const money2 = v => money(v);
  function renderDecision(item) {
    const root = $('decision'); root.replaceChildren(); const decision = item.decision;
    root.append(el('p', 'The agent', 'label'));
    if (!decision) { root.append(el('p', item.running ? 'Still investigating.' : labels2[item.state] || 'No decision yet.', 'lead')); }
    else {
      const reasons = Array.isArray(decision.reasons) ? decision.reasons : [];
      root.append(verdictTag(decision.verdict), el('p', money2(decision.payout_ngn), 'amount'), el('p', `${labels2[item.state] || item.state}${item.payment ? ` · payment ${item.payment.status}` : ''}`, 'muted small'));
      if (item.proposal?.rationale) root.append(el('p', item.proposal.rationale, 'lead'));
      const more = el('div', null, 'card-actions');
      more.append(button('Why', 'button ghost small', () => { const list = el('ul', null, 'reasons'); for (const r of reasons) list.append(el('li', r)); const nodes = [list, el('p', `Index used: ${sourceName(decision.index_source)}${Number.isFinite(decision.index_mm) ? `, ${number(decision.index_mm)} mm` : ''}`, 'muted')]; if (item.proposal) nodes.push(el('p', `The agent proposed ${labels[item.proposal.verdict] || item.proposal.verdict}${item.proposal.figures_verified === true ? '; its figures were reproduced by the code' : item.proposal.figures_verified === false ? '; its figures were not reproduced' : ''}.`, 'note')); openSheet(labels[decision.verdict] || 'Decision', 'What the gate allowed, and why', ...nodes); }));
      if (decision.counter_case) more.append(button('Case for paying', 'button ghost small', () => openSheet('Counter-case', 'The strongest case for paying', el('p', decision.counter_case, 'reading'))));
      if (item.summary) more.append(button('Summary', 'button ghost small', () => openSheet('The agent', 'Its summary of the case', el('p', item.summary, 'reading'))));
      root.append(more);
    }
    const base = $('baseline'); base.replaceChildren(); const naive = decision?.naive?.station_only;
    base.append(el('p', 'Automatic trigger', 'label'));
    if (naive) base.append(verdictTag(naive.verdict), el('p', money2(naive.payout_ngn), 'amount'), el('p', `Adds up ${number(naive.index_mm)} mm from the gauge and never checks the days it stayed silent.`, 'muted small'));
    else base.append(el('p', 'Shown once the agent has a decision.', 'muted'));

    const call = $('call'); call.replaceChildren();
    if (item.state === 'awaiting_signoff' && item.signoff) {
      const text = el('div'); text.append(el('h2', 'Your sign-off'), el('p', `Needed for ${item.signoff.reason}. ${item.signoff.summary || ''}`, 'muted'));
      const note = el('input'); note.type = 'text'; note.placeholder = 'Note (optional)'; note.className = 'note-input'; note.setAttribute('aria-label', 'Sign-off note');
      const actions = el('div', null, 'call-actions');
      actions.append(button('Approve', 'button', () => act(`/cases/${item.id}/signoff`, { approve: true, note: note.value || undefined }, 'Approved.')), button('Decline', 'button ghost', () => act(`/cases/${item.id}/signoff`, { approve: false, note: note.value || undefined }, 'Declined. The case is with a person.')));
      call.append(text, actions, note); call.hidden = false;
    } else if (item.signoff && item.signoff.status !== 'pending') {
      call.append(el('div'), el('p', `${item.signoff.status === 'approved' ? 'Approved' : 'Declined'} by a claims officer${item.signoff.note ? `: ${item.signoff.note}` : '.'}`, 'muted')); call.hidden = false;
    } else if (decision && item.payment?.status === 'released') {
      call.append(el('p', `Released without sign-off: ${money2(item.payment.amount_ngn)} is under ₦1,000,000.`, 'muted')); call.hidden = false;
    } else call.hidden = true;
  }

  const kindLabel = { start: 'Opened', thought: 'Reasoning', tool: 'Query', decision: 'Gate', action: 'Action', person: 'Person', note: 'Note' };
  function renderTimeline(item) {
    const list = $('timeline'); list.replaceChildren();
    const queries = item.events.filter(e => e.tool === 'sql_query').length;
    $('trail-summary').textContent = `${item.steps_used} steps · ${queries} queries written by the agent${item.models?.length ? ` · ${item.models.join(', ')}` : ''}`;
    for (const event of item.events) {
      const kind = event.kind === 'tool' && event.tool !== 'sql_query' ? 'Tool' : kindLabel[event.kind] || event.kind;
      const li = el('li', null, `step ${event.kind}`);
      const row = button(null, 'row');
      row.append(el('span', kind, `state ${event.kind === 'decision' ? 'warn' : event.kind === 'action' ? 'pass' : event.kind === 'person' ? 'fail' : 'step'}`), el('span', event.summary, 'row-title'), el('span', '', 'chevron'));
      const detail = [];
      if (event.input?.sql) detail.push(el('p', 'The query it wrote', 'label'), el('pre', event.input.sql, 'code'));
      else if (event.input && Object.keys(event.input).length) detail.push(el('p', 'What it sent', 'label'), el('pre', typeof event.input === 'string' ? event.input : JSON.stringify(event.input, null, 2), 'code'));
      if (event.output !== undefined) detail.push(el('p', 'What came back', 'label'), el('pre', JSON.stringify(event.output, null, 2).slice(0, 6000), 'code'));
      if (event.model) detail.push(el('p', `Model: ${event.model}`, 'muted small'));
      if (detail.length) row.addEventListener('click', () => openSheet(kind, event.summary.slice(0, 90), ...detail)); else row.disabled = event.kind !== 'thought';
      if (event.kind === 'thought') row.addEventListener('click', () => openSheet('Reasoning', 'What the agent was thinking', el('p', event.summary, 'reading')));
      li.append(row); list.append(li);
    }
  }

  function renderActions(item) {
    const box = $('inspection'); box.replaceChildren();
    box.append(el('p', 'Inspection', 'label'));
    if (!item.inspection) box.append(el('p', item.decision?.verdict === 'INSPECT' ? 'Not opened yet.' : 'No inspection on this case.', 'muted'));
    else {
      box.append(el('p', `${item.inspection.dates.length} dates to verify`, 'lead'), el('p', item.inspection.instructions, 'small'));
      if (item.inspection.dates.length) box.append(el('p', item.inspection.dates.join(', '), 'mono muted'));
      if (item.inspection.report) box.append(el('p', 'Report received', 'label'), el('p', item.inspection.report.text, 'small'));
      else if (item.state === 'inspection_open') {
        const form = el('form', null, 'report-form'); const area = el('textarea'); area.rows = 4; area.placeholder = 'Paste the inspector’s report'; if (item.replay?.report) { area.value = item.replay.report; area.readOnly = true; } area.setAttribute('aria-label', 'Inspector’s report'); area.required = true; area.minLength = 10;
        const send = el('button', 'Send to the agent', 'button'); send.type = 'submit';
        form.append(area, send); form.addEventListener('submit', event => { event.preventDefault(); act(`/cases/${item.id}/inspection-report`, { report: area.value }, 'The agent is reading the report.'); });
        box.append(form);
      }
    }
    const out = $('outbox'); out.replaceChildren();
    if (!item.outbox.length) out.append(el('p', 'No letters or notices yet.', 'muted small'));
    for (const message of item.outbox) {
      const row = button(null, 'row'); const to = message.to === 'farmer_group' ? 'Farmer group' : 'Station operator';
      row.append(el('span', message.status === 'held' ? 'Held' : 'Sent', `state ${message.status === 'held' ? 'warn' : 'pass'}`), el('span', `Letter to the ${to.toLowerCase()}`, 'row-title'), el('span', '', 'chevron'));
      row.addEventListener('click', () => openSheet(to, message.status === 'held' ? 'Held until sign-off' : 'Sent', el('p', message.body, 'reading letter')));
      out.append(row);
    }
  }

  function valid(day) { return !!day && Number.isFinite(day.mm) && day.mm >= 0 && !day.q_flag?.trim() && !day.fill; }
  function aligned(series, dates) { const map = new Map(); const seen = new Set(); for (const day of series?.days || []) { map.set(day.date, seen.has(day.date) ? null : day); seen.add(day.date); } return dates.map(d => { const day = map.get(d); return { date: d, mm: valid(day) ? day.mm : null, raw: day }; }); }
  function chartRows(output) { const evidence = output.evidence || {}; const policy = output.policy || policyFor(state.selected); const window = output.claim?.window_override || evidence.station?.window || evidence.satellite?.window || { start: policy?.window_start, end: policy?.window_end }; const start = Date.parse(window.start), end = Date.parse(window.end); let dates = []; if (Number.isFinite(start) && Number.isFinite(end) && end >= start && end - start <= 3660 * 86400000) dates = Array.from({ length: Math.round((end - start) / 86400000) + 1 }, (_, i) => new Date(start + i * 86400000).toISOString().slice(0, 10)); else dates = [...new Set([...(evidence.station?.days || []), ...(evidence.satellite?.days || [])].map(d => d.date))].sort(); return { dates, station: aligned(evidence.station, dates), satellite: aligned(evidence.satellite, dates) }; }

  function renderFigures(output) {
    const { dates, station, satellite } = chartRows(output); $('figures').replaceChildren();
    for (const [name, rows, cls] of [['Gauge on the ground', station, 'station'], ['Satellite overhead', satellite, 'satellite']]) {
      const count = rows.filter(d => d.mm != null).length; const tile = el('div', null, `card figure ${cls}`);
      tile.append(el('p', name, 'label'), el('p', count ? `${number(rows.reduce((sum, d) => sum + (d.mm ?? 0), 0))} mm` : 'None', 'amount'), el('p', `${count} of ${dates.length} days reported`, 'muted small'));
      $('figures').append(tile);
    }
    const missing = station.filter(d => d.mm == null).length;
    $('chart-caption').textContent = dates.length ? `The gauge was silent on ${missing} of ${dates.length} days. Hatched days are missing, not dry.` : 'No rainfall readings came with this review.';
    $('open-daily').onclick = () => {
      const table = el('table'); const head = el('tr'); for (const h of ['Date', 'Gauge mm', 'Satellite mm', 'Gauge flags']) { const th = el('th', h); th.scope = 'col'; head.append(th); } const thead = el('thead'); thead.append(head); const body = el('tbody');
      for (let i = 0; i < dates.length; i++) { const row = el('tr'); const th = el('th', date(dates[i])); th.scope = 'row'; const raw = station[i].raw; const flags = raw ? ['m_flag', 'q_flag', 's_flag'].filter(k => raw[k]?.trim()).map(k => `${k}: ${raw[k]}`).join('; ') || 'None' : 'No reading'; row.append(th, el('td', number(station[i].mm), station[i].mm == null ? 'missing' : ''), el('td', number(satellite[i].mm), satellite[i].mm == null ? 'missing' : ''), el('td', flags)); body.append(row); }
      table.append(thead, body); const wrap = el('div', null, 'table-wrap'); wrap.tabIndex = 0; wrap.setAttribute('role', 'region'); wrap.setAttribute('aria-label', 'Daily rainfall'); wrap.append(table);
      openSheet('Evidence', 'Daily readings', el('p', 'A missing reading is not zero rainfall.', 'muted small'), wrap);
    };
  }

  function drawChart(output) {
    if ($('panel-evidence').hidden) return;
    const { dates, station, satellite } = chartRows(output);
    if (state.chart) { state.chart.destroy(); state.chart = null; } $('chart-unavailable').hidden = !!window.Chart && !!dates.length; $('rainfall-chart').hidden = !window.Chart || !dates.length; if (!window.Chart || !dates.length) return;
    const style = getComputedStyle(document.documentElement); const color = role => style.getPropertyValue(role).trim();
    const missingPlugin = { id: 'missingStation', beforeDatasetsDraw(chart) { const { ctx, chartArea, scales: { x } } = chart; const step = x.getPixelForValue(1) - x.getPixelForValue(0) || chartArea.width; ctx.save(); ctx.beginPath(); ctx.rect(chartArea.left, chartArea.top, chartArea.width, chartArea.height); ctx.clip(); station.forEach((d, i) => { if (d.mm != null) return; const left = x.getPixelForValue(i) - Math.abs(step) * .4, right = left + Math.abs(step) * .8; const top = chartArea.bottom - 12; ctx.strokeStyle = color('--secondary'); ctx.globalAlpha = .65; ctx.lineWidth = 1; for (let n = left - 12; n < right; n += 5) { ctx.save(); ctx.beginPath(); ctx.rect(left, top, right - left, 12); ctx.clip(); ctx.beginPath(); ctx.moveTo(n, chartArea.bottom); ctx.lineTo(n + 12, top); ctx.stroke(); ctx.restore(); } }); ctx.restore(); } };
    state.chart = new Chart($('rainfall-chart'), { type: 'bar', data: { labels: dates, datasets: [{ label: 'Gauge (mm)', data: station.map(d => d.mm), backgroundColor: color('--station'), maxBarThickness: 14, borderRadius: 2, order: 2 }, { type: 'line', label: 'Satellite (mm)', data: satellite.map(d => d.mm), borderColor: color('--satellite'), backgroundColor: color('--satellite'), borderWidth: 2, pointRadius: 0, pointHitRadius: 10, tension: 0.25, spanGaps: false, order: 1 }] }, plugins: [missingPlugin], options: { responsive: true, maintainAspectRatio: false, animation: matchMedia('(prefers-reduced-motion: reduce)').matches ? false : { duration: 240 }, interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false }, tooltip: { callbacks: { title: items => date(items[0]?.label), afterBody: items => station[items[0]?.dataIndex]?.mm == null ? 'Gauge silent: not zero rainfall.' : '' } } }, scales: { x: { grid: { display: false }, ticks: { color: color('--secondary'), maxRotation: 0, maxTicksLimit: 6, font: { size: 12 }, callback: function(value) { const label = this.getLabelForValue(value); return new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${label}T00:00:00Z`)); } }, border: { color: color('--separator') } }, y: { beginAtZero: true, grid: { color: color('--separator') }, ticks: { color: color('--secondary'), maxTicksLimit: 5, font: { size: 12 } }, border: { display: false } } } } });
  }

  function renderChecks(probes) {
    const sorted = [...probes].sort((a, b) => (statusOrder[a.status] ?? 2) - (statusOrder[b.status] ?? 2));
    const count = s => probes.filter(p => p.status === s).length;
    $('check-summary').textContent = probes.length ? [count('FAIL') && `${count('FAIL')} failed`, count('WARN') && `${count('WARN')} to watch`, count('PASS') && `${count('PASS')} passed`].filter(Boolean).join(' · ') : 'No checks came with this review.';
    $('checks').replaceChildren();
    for (const probe of sorted) {
      const row = button(null, 'row'); const word = { FAIL: 'Failed', WARN: 'Watch', PASS: 'Passed' }[probe.status] || probe.status;
      row.append(el('span', word, `state ${String(probe.status).toLowerCase()}`), el('span', probe.name || probe.id, 'row-title'), el('span', '', 'chevron'));
      row.addEventListener('click', () => openSheet(`Check ${probe.id} · ${word}`, probe.name || probe.id, el('p', probe.evidence || 'No detail was attached.', 'reading')));
      $('checks').append(row);
    }
  }

  document.querySelectorAll('[data-legal]').forEach(link => link.addEventListener('click', () => { const [title, ...paragraphs] = window.PLUVIA_LEGAL[link.dataset.legal]; openSheet('Updated 27 October 2026 · not legally reviewed', title, ...paragraphs.map(text => el('p', text, 'reading'))); }));
  $('claim-search').addEventListener('input', renderInbox);
  window.addEventListener('popstate', () => { const params = new URLSearchParams(location.search); const id = params.get('claim') || state.claims[0]?.claim_id; if (id) selectClaim(id, false); if (params.get('case')) openCase(params.get('case')); });
  request('/health').then(health => { const sample = health.sample_mode ?? health.sampleMode ?? (health.mode === 'sample' ? true : health.mode === 'live' ? false : undefined); $('mode').textContent = sample ? 'Sample mode' : sample === false ? `Live · Zetaris ${health.zetaris || 'unknown'} · Nightshift ${health.nightshift || 'unknown'}` : 'Connected'; }).catch(() => { $('mode').textContent = 'Offline'; });
  loadInbox();
})();
