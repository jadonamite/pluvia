'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = { mode: 'claims', stations: [], watch: null, station: null, playing: false, cases: [], claims: [], policies: [], selected: null, run: null, chart: null, busy: false, ticket: 0, filter: 'all', verdicts: {}, poll: null, shown: {}, reveal: null };
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
    if (state.mode !== 'queue') setMode('claims', false);
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
      await loadVerdicts();
      if (params.get('station')) { setMode('stations', false); await loadWatch(); selectStation(params.get('station'), false); return; }
      if (params.get('queue')) { setMode('queue', false); if (params.get('case')) { if (params.get('claim')) selectClaim(params.get('claim'), false, false); await openCase(params.get('case')); view('case'); } return; }
      if (id) selectClaim(id, false, !params.get('case')); if (params.get('claim')) view('case'); if (params.get('case')) await openCase(params.get('case'));
    } catch (error) { status(`The claims could not be loaded. ${error.message} Reload the page to try again.`, true); $('claim-list').replaceChildren(el('p', 'The list is unavailable.', 'muted')); }
  }
  const labels2 = { investigating: 'The agent is working', inspection_open: 'Inspection open', awaiting_signoff: 'Waiting for your sign-off', settled: 'Settled', closed: 'Closed', escalated: 'With a person', failed: 'Stopped' };
  async function loadVerdicts() {
    try { const { cases } = await request('/cases'); state.cases = cases; state.verdicts = {}; for (const c of cases.reverse()) if (c.decision) state.verdicts[c.claim_id] = c.decision.verdict; } catch { /* The list still works without verdicts. */ }
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
    if (item.replay && item.running) { $('working').hidden = false; $('working').textContent = `Replaying a recorded live investigation · step ${item.steps_used} · ${(item.events.at(-1)?.summary || '').slice(0, 110)}${(item.events.at(-1)?.summary || '').length > 110 ? '…' : ''}`; }
    else $('working').hidden = !working && !item.replay;
    if (!(item.replay && item.running)) $('working').textContent = working ? `The agent is working · step ${item.steps_used} · ${(item.events.at(-1)?.summary || '').slice(0, 110)}${(item.events.at(-1)?.summary || '').length > 110 ? '…' : ''}` : item.replay ? `A recorded live investigation, replayed${item.models?.length ? ` · ${item.models.join(', ')}` : ''}` : '';
    $('working').classList.toggle('live', Boolean(item.running));
    renderWatchLink(item); renderDecision(item); renderPlan(item); renderTalk(item); renderTimeline(item); renderChecks(item.decision?.probes || []); renderActions(item);
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

  // The plan as it stood after each event, so a replay shows it ticking through in order.
  function planFrom(events) {
    let steps = []; const revisions = [];
    for (const e of events) {
      if (e.kind !== 'plan' || !e.output?.ok) continue;
      if (e.tool === 'set_plan') { if (steps.length && e.input?.reason) revisions.push(e.input.reason); steps = (e.input?.steps || []).map(s => ({ text: typeof s === 'string' ? s : s.text, status: s.status || 'todo' })); }
      else if (e.tool === 'mark_step' && steps[e.input.step - 1]) Object.assign(steps[e.input.step - 1], { status: e.input.status, note: e.input.note });
    }
    return { steps, revisions };
  }
  const stepWord = { todo: ['Next', 'step'], doing: ['Now', 'warn'], done: ['Done', 'pass'], dropped: ['Dropped', 'fail'] };
  function renderPlan(item, root = $('plan')) {
    root.replaceChildren(el('p', 'Its plan', 'label'));
    const { steps, revisions } = planFrom(item.events);
    if (!steps.length) { root.append(el('p', item.running ? 'Writing its plan.' : 'This case was worked before the agent wrote plans.', 'muted')); return; }
    const list = el('ol', null, 'plan-steps');
    steps.forEach((step, i) => { const [word, cls] = item.running ? stepWord[step.status] || stepWord.todo : step.status === 'todo' ? ['Unmarked', 'step'] : step.status === 'doing' ? ['Started', 'step'] : stepWord[step.status] || stepWord.todo; const li = el('li', null, `plan-step is-${step.status}`); const body = el('div'); body.append(el('span', `${i + 1}. ${step.text}`, 'row-title')); if (step.note) body.append(el('span', step.note, 'muted small')); li.append(el('span', word, `state ${cls}`), body); list.append(li); });
    root.append(list);
    for (const reason of revisions) root.append(el('p', `Changed course: ${reason}`, 'note'));
  }
  function renderTalk(item) {
    const thread = $('thread'); thread.replaceChildren();
    for (const e of item.events) if (e.kind === 'officer' || e.kind === 'reply') { const li = el('li', null, `bubble ${e.kind}`); li.append(el('span', e.kind === 'officer' ? 'You' : 'The agent', 'muted small'), el('p', e.summary)); thread.append(li); }
    thread.hidden = !thread.children.length;
    const area = $('talk-text'), send = $('talk-send'), note = $('talk-note');
    const replay = item.replay, next = replay?.questions?.[replay.played ?? 0];
    $('talk').hidden = Boolean(replay && item.running && !thread.children.length);
    if (replay && item.running) { $('talk-form').hidden = true; note.hidden = true; return; }
    if (replay) { area.readOnly = true; area.value = next || ''; note.hidden = false; note.textContent = next ? 'A recorded investigation: this is the question the officer asked the live agent.' : 'This recorded investigation has no further questions. Run Pluvia live to ask your own.'; }
    else { area.readOnly = false; note.hidden = true; }
    $('talk-form').hidden = Boolean(replay && !next);
    send.disabled = Boolean(item.replay && item.running);
  }
  $('talk-form').addEventListener('submit', async event => {
    event.preventDefault(); const item = state.run; const text = $('talk-text').value.trim(); if (!item || text.length < 2) return;
    $('talk-send').disabled = true;
    try { showCase(await request(`/cases/${encodeURIComponent(item.id)}/messages`, { method: 'POST', body: JSON.stringify({ text }) })); if (!item.replay) $('talk-text').value = ''; } catch (error) { status(error.message, true); } finally { $('talk-send').disabled = false; }
  });

  const kindLabel = { start: 'Opened', thought: 'Reasoning', tool: 'Query', decision: 'Gate', action: 'Action', person: 'Person', note: 'Note', plan: 'Plan', officer: 'You', reply: 'Answer', watcher: 'Watcher' };
  function renderTimeline(item, list = $('timeline'), summary = $('trail-summary')) {
    list.replaceChildren();
    const queries = item.events.filter(e => e.tool === 'sql_query').length;
    summary.textContent = `${item.steps_used} steps · ${queries} queries written by the agent${item.models?.length ? ` · ${item.models.join(', ')}` : ''}`;
    for (const event of item.events) {
      const kind = event.kind === 'tool' && event.tool !== 'sql_query' ? 'Tool' : kindLabel[event.kind] || event.kind;
      const li = el('li', null, `step ${event.kind}`);
      const row = button(null, 'row');
      row.append(el('span', kind, `state ${event.kind === 'decision' || event.kind === 'watcher' ? 'warn' : event.kind === 'action' || event.kind === 'reply' ? 'pass' : event.kind === 'person' || event.kind === 'officer' ? 'fail' : 'step'}`), el('span', event.summary, 'row-title'), el('span', '', 'chevron'));
      const detail = [];
      if (event.input?.sql) detail.push(el('p', 'The query it wrote', 'label'), el('pre', event.input.sql, 'code'));
      else if (event.input && Object.keys(event.input).length) detail.push(el('p', 'What it sent', 'label'), el('pre', typeof event.input === 'string' ? event.input : JSON.stringify(event.input, null, 2), 'code'));
      if (event.output !== undefined) detail.push(el('p', 'What came back', 'label'), el('pre', JSON.stringify(event.output, null, 2).slice(0, 6000), 'code'));
      if (event.model) detail.push(el('p', `Model: ${event.model}`, 'muted small'));
      if (detail.length) row.addEventListener('click', () => openSheet(kind, event.summary.slice(0, 90), ...detail)); else row.disabled = event.kind !== 'thought';
      if (event.kind === 'officer' || event.kind === 'reply') { row.disabled = false; row.addEventListener('click', () => openSheet(kind, event.kind === 'officer' ? 'What you wrote' : 'What the agent answered', el('p', event.summary, 'reading'))); }
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

  // Stations: the watcher's simulated July, one day per step.
  const title = name => String(name).toLowerCase().replace(/\b[a-z]/g, c => c.toUpperCase());
  const longDate = d => new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'long', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
  const health = { ok: ['Healthy', 'pass'], silent: ['Quiet', 'warn'], diverging: ['Diverging', 'fail'] };
  function setMode(mode, navigate = true) {
    state.mode = mode;
    document.querySelectorAll('[data-mode]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mode === mode)));
    document.querySelectorAll('[data-for]').forEach(n => (n.hidden = n.dataset.for !== mode));
    const stations = mode === 'stations';
    $('station').hidden = !stations || !state.station;
    for (const id of ['case-head', 'empty', 'results']) $(id).classList.toggle('off', stations);
    if (stations) { loadWatch(); if (navigate) query({ claim: null, case: null, station: state.station?.id ?? null }); }
    if (mode === 'queue') { loadQueue(); if (navigate) query({ queue: '1', station: null }); } else if (navigate) query({ queue: null });
  }
  document.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => setMode(b.dataset.mode)));
  async function loadWatch() {
    try {
      const [watch, register] = await Promise.all([request('/watch'), state.stations.length ? null : request('/register/stations.json')]);
      if (register) state.stations = register.stations || [];
      state.watch = watch; renderStations(); if (state.station) renderStation();
    } catch (error) { status(`The stations could not be loaded. ${error.message}`, true); }
  }
  function checksFor(id) { return (state.watch?.checks || []).filter(c => c.station_id === id); }
  function renderStations() {
    const list = $('station-list'); list.replaceChildren();
    const insured = state.stations.filter(s => state.policies.some(p => p.ref_station_id === s.id));
    $('station-count').textContent = String(insured.length);
    if (!insured.length) { list.append(el('p', 'No insured stations in the register.', 'muted')); return; }
    for (const station of insured) {
      const link = el('a', null, 'claim'); link.href = `/desk?station=${encodeURIComponent(station.id)}`;
      if (state.station?.id === station.id) link.setAttribute('aria-current', 'true');
      const last = checksFor(station.id).at(-1); const [word, cls] = last ? health[last.status] : ['Not checked yet', 'step'];
      const silent = checksFor(station.id).filter(c => c.gauge_mm == null).length;
      const groups = state.policies.filter(p => p.ref_station_id === station.id).length;
      link.append(el('strong', title(station.name)), el('span', station.id, 'mono'), el('span', word, `state ${cls}`), el('span', last ? `${silent} silent ${silent === 1 ? 'day' : 'days'} · ${groups} insured groups` : `${groups} insured groups`, 'todo'));
      link.addEventListener('click', event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return; event.preventDefault(); selectStation(station.id); });
      list.append(link);
    }
  }
  function selectStation(id, navigate = true) {
    const station = state.stations.find(s => s.id === id); if (!station) return;
    state.station = station; $('station').hidden = false; renderStations(); renderStation(); view('case');
    if (navigate) query({ station: id, claim: null, case: null });
  }
  function renderStation() {
    const station = state.station; const policies = state.policies.filter(p => p.ref_station_id === station.id);
    const start = policies.map(p => p.window_start).sort()[0], end = policies.map(p => p.window_end).sort().at(-1);
    const head = $('station-head'); head.replaceChildren();
    const top = el('div', null, 'case-top'); top.append(el('span', station.id, 'mono muted'), el('span', 'Real record', 'tag'));
    const checks = checksFor(station.id); const last = checks.at(-1); const [word, cls] = last ? health[last.status] : ['Not checked yet', 'step'];
    const name = el('div', null, 'case-title'); name.append(el('h2', title(station.name)), el('span', word, `state ${cls}`));
    head.append(top, name, el('p', `${policies.length} insured farmer groups depend on this gauge from ${longDate(start)} to ${longDate(end)}. The watcher checks it once a day and reads only what had arrived by that day.`, 'event'));
    // calendar, Monday first
    const cal = $('calendar'); cal.replaceChildren();
    for (const d of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) cal.append(el('li', d, 'weekday'));
    const filed = (state.watch?.filings || []).filter(f => policies.some(p => state.claims.find(c => c.claim_id === f.claim_id)?.policy_id === p.policy_id));
    const lastShown = [end, ...filed.map(f => f.filed_on)].sort().at(-1);
    const first = Date.parse(`${start}T00:00:00Z`), days = Math.round((Date.parse(`${lastShown}T00:00:00Z`) - first) / 86400000) + 1;
    for (let i = 0; i < (new Date(first).getUTCDay() + 6) % 7; i++) cal.append(el('li', null, 'blank'));
    const item = state.watch?.cases.find(c => c.station_id === station.id); const today = state.watch?.today;
    for (let i = 0; i < days; i++) {
      const date = new Date(first + i * 86400000).toISOString().slice(0, 10); const check = checks.find(c => c.date === date);
      const filing = date > end ? filed.filter(f => f.filed_on === date) : [];
      const reached = today && date <= today;
      const kind = date > end ? (filing.length ? (reached ? 'filed' : 'future') : 'outside') : !check ? 'future' : check.gauge_mm == null ? 'silent' : check.status === 'diverging' ? 'gap' : 'reported';
      const cell = el('li', null, `day ${kind}${item?.opened_on === date ? ' opened' : ''}`);
      cell.append(el('span', new Date(`${date}T00:00:00Z`).getUTCDate() === 1 && i ? longDate(date) : String(new Date(`${date}T00:00:00Z`).getUTCDate()), 'day-number'), el('span', filing.length ? `${filing.length} ${filing.length === 1 ? 'claim' : 'claims'}` : check ? (check.gauge_mm == null ? 'silent' : `${number(check.gauge_mm)} mm`) : '', 'day-mm'));
      cell.setAttribute('aria-label', `${longDate(date)}: ${filing.length ? `${filing.length} claims filed${reached ? ' and picked up by the agent' : ''}` : date > end ? 'after the cover window' : !check ? 'not checked yet' : check.gauge_mm == null ? 'gauge silent' : `gauge ${number(check.gauge_mm)} mm, satellite ${number(check.satellite_mm)} mm`}${item?.opened_on === date ? ', watch case opened' : ''}`);
      cal.append(cell);
    }
    const done = today && today >= (state.watch?.last_day || end);
    $('calendar-today').textContent = today ? `Checked through ${longDate(today)}` : 'Not started';
    $('watch-next').disabled = state.playing || done; $('watch-run').disabled = state.playing || done; $('watch-reset').disabled = state.playing || !today;
    $('watch-mode').textContent = state.watch?.recorded ? 'The calendar is simulated. The readings are real, and this season was recorded from a live run through Zetaris.' : 'The calendar is simulated. The readings are the real record for this station.';
    renderWatchCase(station, item, policies);
    renderInvestigation(item && state.watch?.investigations?.[item.id]);
    const list = $('watch-days'); list.replaceChildren(); list.hidden = !checks.length; $('watch-days-title').hidden = !checks.length;
    for (const check of [...checks].reverse()) {
      const row = button(null, 'row'); const [w, c] = check.gauge_mm == null ? ['Silent', 'warn'] : check.status === 'diverging' ? ['Apart', 'fail'] : ['Reported', 'pass'];
      row.append(el('span', w, `state ${c}`), el('span', longDate(check.date), 'row-title'), el('span', `Gauge ${check.gauge_mm == null ? 'silent' : `${number(check.gauge_mm)} mm`} · satellite ${number(check.satellite_mm)} mm`, 'row-meta'), el('span', '', 'chevron'));
      row.addEventListener('click', () => { const list = el('dl', null, 'terms'); for (const [k, v] of [['Gauge', check.gauge_mm == null ? 'No reading' : `${number(check.gauge_mm)} mm`], ['Satellite', `${number(check.satellite_mm)} mm`], ['Silent days in a row', String(check.silent_run)]]) { const r = el('div'); r.append(el('dt', k), el('dd', v)); list.append(r); } openSheet('Daily check', longDate(check.date), list); });
      list.append(row);
    }
  }
  function renderWatchCase(station, item, policies) {
    const root = $('watch-case'); root.replaceChildren(el('p', 'Watch case', 'label'));
    if (!item) { root.append(el('p', state.watch?.today ? 'No watch case. The gauge has reported normally so far.' : 'Step through July to watch the gauge. A case opens after three silent days, or when the gauge and the satellite drift apart.', 'muted')); return; }
    root.append(el('p', `Opened ${longDate(item.opened_on)}, before any claim`, 'lead strong'));
    const findings = el('div', null, 'list flush');
    for (const f of item.findings) {
      const row = button(null, 'row'); row.append(el('span', f.kind === 'silent' ? 'Silent' : 'Apart', `state ${f.kind === 'silent' ? 'warn' : 'fail'}`), el('span', f.summary, 'row-title'), el('span', longDate(f.first_seen), 'row-meta'), el('span', '', 'chevron'));
      row.addEventListener('click', () => openSheet(f.kind === 'silent' ? 'Gauge silent' : 'Gauge and satellite apart', `Seen ${longDate(f.first_seen)}`, el('p', f.summary, 'reading'), el('p', f.dates.map(longDate).join(', '), 'mono muted')));
      findings.append(row);
    }
    const investigation = state.watch?.investigations?.[item.id];
    if (investigation?.lessons?.length) {
      root.append(findings, el('p', 'What the agent established', 'label'));
      const lessons = el('div', null, 'list flush');
      for (const lesson of investigation.lessons) {
        const row = button(null, 'row'); row.append(el('span', 'Lesson', 'state pass'), el('span', lesson.text, 'row-title'), el('span', lesson.day ? longDate(lesson.day) : '', 'row-meta'), el('span', '', 'chevron'));
        row.addEventListener('click', () => { const list = el('dl', null, 'terms'); for (const f of lesson.figures) { const r = el('div'); r.append(el('dt', f.label), el('dd', `${number(f.reproduced)} reproduced`)); list.append(r); } openSheet('Lesson', 'Recorded in memory for the claims that follow', el('p', lesson.text, 'reading'), el('p', 'The code reran every figure the agent cited.', 'muted small'), list); });
        lessons.append(row);
      }
      root.append(lessons);
    } else root.append(findings);
    root.append(el('p', 'Notices to the operator', 'label'));
    const notices = el('div', null, 'list flush');
    const sent = [...item.outbox.map(m => ({ day: m.on, body: m.body, by: 'The watcher' })), ...(investigation?.outbox || []).filter(m => m.to === 'station_operator').map(m => ({ day: m.day, body: m.body, by: 'The agent' }))].sort((a, b) => String(a.day).localeCompare(String(b.day)));
    if (!sent.length) notices.append(el('p', investigation ? 'The agent has not written to the operator yet.' : 'None yet.', 'muted small'));
    for (const m of sent) {
      const row = button(null, 'row'); row.append(el('span', 'Sent', 'state pass'), el('span', `${m.by} to the station operator`, 'row-title'), el('span', m.day ? longDate(m.day) : '', 'row-meta'), el('span', '', 'chevron'));
      row.addEventListener('click', () => openSheet('Station operator', `${m.by}, ${m.day ? longDate(m.day) : ''}`, el('p', m.body, 'reading letter')));
      notices.append(row);
    }
    root.append(notices, el('p', 'Claims on this gauge', 'label'));
    const claims = el('div', null, 'claim-links');
    for (const policy of policies) {
      const claim = state.claims.find(c => c.policy_id === policy.policy_id); if (!claim) continue;
      const started = state.cases.some(c => c.claim_id === claim.claim_id && c.watch?.some(w => w.station_id === station.id));
      const link = el('a', null, 'button ghost small'); link.href = `/desk?claim=${encodeURIComponent(claim.claim_id)}`;
      link.textContent = `${policy.group_name.replace(/ \(synthetic\)$/, '')}${started ? ' · started from this case' : ''}`;
      link.addEventListener('click', event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return; event.preventDefault(); selectClaim(claim.claim_id); view('case'); });
      claims.append(link);
    }
    root.append(claims);
  }
  // Queue: every case grouped by who it waits on, oldest first, then every letter and notice.
  const queueGroups = [
    ['Needs you', c => ['awaiting_signoff', 'inspection_open', 'escalated', 'failed'].includes(c.state) && !c.running],
    ['Working', c => c.running || c.state === 'investigating'],
    ['Closed', c => ['settled', 'closed'].includes(c.state) && !c.running],
  ];
  async function loadQueue() {
    clearTimeout(state.queuePoll);
    try { const { cases } = await request('/cases'); state.cases = cases; renderQueue(); if (state.mode === 'queue' && cases.some(c => c.running)) state.queuePoll = setTimeout(loadQueue, 3000); }
    catch (error) { status(`The queue could not be loaded. ${error.message}`, true); }
  }
  function caseTitle(c) {
    if (c.kind === 'watch') return `Watch case · ${title(c.station?.name || c.claim_id)}`;
    const policy = state.policies.find(p => p.policy_id === c.policy_id);
    return (policy?.group_name || c.claim_id).replace(/ \(synthetic\)$/, '');
  }
  function openQueued(c) {
    if (c.kind === 'watch') { setMode('stations'); selectStation(c.station.id); return; }
    selectClaim(c.claim_id, false, false); query({ claim: c.claim_id, case: c.id, queue: '1' }); openCase(c.id); view('case');
  }
  function renderQueue() {
    const root = $('queue-list'); root.replaceChildren();
    const cases = [...state.cases].sort((a, b) => a.created_at.localeCompare(b.created_at));
    $('queue-count').textContent = String(cases.length);
    if (!cases.length) { root.append(el('p', 'No cases yet. Hand a claim to the agent, or run the station calendar to the filing day and the agent picks the claims up itself.', 'muted')); return; }
    for (const [name, test] of queueGroups) {
      const items = cases.filter(test); const group = el('section', null, 'queue-group'); group.append(el('h3', `${name} · ${items.length}`, 'label'));
      if (!items.length) group.append(el('p', name === 'Needs you' ? 'Nothing waits on you.' : 'None.', 'muted small'));
      for (const c of items) {
        const link = el('a', null, 'claim'); link.href = c.kind === 'watch' ? `/desk?station=${encodeURIComponent(c.station?.id || '')}` : `/desk?claim=${encodeURIComponent(c.claim_id)}&case=${encodeURIComponent(c.id)}`;
        if (state.run?.id === c.id) link.setAttribute('aria-current', 'true');
        link.append(el('strong', caseTitle(c)), el('span', c.kind === 'watch' ? c.station?.id : c.claim_id, 'mono'), el('span', c.running ? 'The agent is working' : labels2[c.state] || c.state, 'todo'));
        link.addEventListener('click', event => { if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button) return; event.preventDefault(); openQueued(c); });
        group.append(link);
      }
      root.append(group);
    }
    const outbox = cases.flatMap(c => c.outbox.map(m => ({ ...m, owner: caseTitle(c) })));
    const box = el('section', null, 'queue-group'); box.append(el('h3', `Outbox · ${outbox.length}`, 'label'));
    if (!outbox.length) box.append(el('p', 'No letters or notices yet.', 'muted small'));
    const rows = el('div', null, 'list flush');
    for (const m of outbox) {
      const to = m.to === 'farmer_group' ? 'Farmer group' : 'Station operator'; const row = button(null, 'row');
      const text = el('span', null, 'row-stack'); text.append(el('span', to, 'row-title'), el('span', m.owner, 'muted small'));
      row.append(el('span', m.status === 'held' ? 'Held' : 'Sent', `state ${m.status === 'held' ? 'warn' : 'pass'}`), text, el('span', '', 'chevron'));
      row.addEventListener('click', () => openSheet(to, `${m.owner} · ${m.status === 'held' ? 'held until sign-off' : 'sent'}`, el('p', m.body, 'reading letter')));
      rows.append(row);
    }
    box.append(rows); root.append(box);
  }

  // The agent's own investigation of the watch case, with the same plan and trail as a claim.
  function renderInvestigation(item) {
    $('watch-investigation').hidden = !item; clearTimeout(state.watchPoll); if (!item) return;
    $('watch-working').textContent = item.running ? `The agent is investigating · ${(item.events.at(-1)?.summary || '').slice(0, 110)}` : item.replay ? 'A recorded live investigation, shown as it stood on this day' : item.summary || 'The agent finished its investigation.';
    $('watch-working').classList.toggle('live', Boolean(item.running));
    renderPlan(item, $('watch-plan')); renderTimeline(item, $('watch-timeline'), $('watch-trail-summary'));
    if (item.running) state.watchPoll = setTimeout(() => { if (state.mode === 'stations') loadWatch(); }, 2000);
  }
  async function advanceWatch(body) {
    const before = state.watch?.picked?.length || 0;
    const watch = await request('/watch/advance', { method: 'POST', body: JSON.stringify(body) }); state.watch = watch; renderStations(); renderStation();
    if ((watch.picked?.length || 0) > before) { await loadVerdicts(); renderInbox(); renderQueue(); status(`${watch.picked.length - before} claims filed on ${longDate(watch.today)}. The agent picked them up.`); }
  }
  $('watch-next').addEventListener('click', () => advanceWatch({ days: 1 }).catch(error => status(error.message, true)));
  $('watch-run').addEventListener('click', async () => {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return advanceWatch({ days: 62 }).catch(error => status(error.message, true));
    state.playing = true; renderStation();
    try {
      while (state.mode === 'stations' && !(state.watch.last_day && state.watch.today >= state.watch.last_day)) {
        const before = state.watch.today; await advanceWatch({ days: 1 });
        if (state.watch.today === before) break;
        await new Promise(r => setTimeout(r, 150));
      }
    }
    catch (error) { status(error.message, true); } finally { state.playing = false; if (state.station) renderStation(); }
  });
  $('watch-reset').addEventListener('click', async () => { try { state.watch = await request('/watch/reset', { method: 'POST', body: '{}' }); renderStations(); renderStation(); } catch (error) { status(error.message, true); } });
  function renderWatchLink(item) {
    const box = $('watch-link'); box.replaceChildren(); const w = item.watch?.[0]; box.hidden = !w; if (!w) return;
    const text = el('div'); text.append(el('p', 'Started from a watch case', 'label'), el('p', `The watcher had the ${title(w.station_name)} gauge under watch from ${longDate(w.opened_on)}. The agent read that case before it began.`, 'small'));
    box.append(text, button('Open the station', 'button ghost small', () => { setMode('stations'); selectStation(w.station_id); }));
  }

  document.querySelectorAll('[data-legal]').forEach(link => link.addEventListener('click', () => { const [title, ...paragraphs] = window.PLUVIA_LEGAL[link.dataset.legal]; openSheet('Updated 27 October 2026 · not legally reviewed', title, ...paragraphs.map(text => el('p', text, 'reading'))); }));
  $('claim-search').addEventListener('input', renderInbox);
  window.addEventListener('popstate', () => { const params = new URLSearchParams(location.search); if (params.get('station')) { setMode('stations', false); selectStation(params.get('station'), false); return; } const id = params.get('claim') || state.claims[0]?.claim_id; if (id) selectClaim(id, false); if (params.get('case')) openCase(params.get('case')); });
  request('/health').then(health => { const sample = health.sample_mode ?? health.sampleMode ?? (health.mode === 'sample' ? true : health.mode === 'live' ? false : undefined); $('mode').textContent = sample ? 'Sample mode' : sample === false ? `Live · Zetaris ${health.zetaris || 'unknown'} · Nightshift ${health.nightshift || 'unknown'}` : 'Connected'; }).catch(() => { $('mode').textContent = 'Offline'; });
  loadInbox();
})();
