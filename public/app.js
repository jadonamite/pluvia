'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const state = { claims: [], policies: [], selected: null, run: null, chart: null, busy: false, ticket: 0, filter: 'all', verdicts: {} };
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
  $('theme').addEventListener('click', () => { const theme = currentTheme() === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = theme; try { sessionStorage.setItem('pluvia-theme', theme); } catch { /* Session preferences are optional. */ } themeLabel(); if (state.run) drawChart(state.run.output); });
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { themeLabel(); if (state.run) drawChart(state.run.output); });

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
    const verdict = state.run && state.run.output?.claim?.claim_id === claim.claim_id ? state.run.output.decision.verdict : state.verdicts[claim.claim_id];
    const title = el('div', null, 'case-title'); title.append(el('h2', (policy?.group_name || claim.policy_id).replace(/ \(synthetic\)$/, '')), verdict ? verdictTag(verdict) : el('span', 'To review', 'todo'));
    const actions = el('div', null, 'case-actions');
    const run = button(state.run?.output?.claim?.claim_id === claim.claim_id ? 'Review again' : 'Review rainfall', 'button', runReview); run.id = 'run-review'; run.disabled = state.busy || !policy;
    actions.append(run, button('Policy terms', 'button ghost', () => policySheet(claim, policy)));
    root.append(top, title, el('p', claim.event_text || 'No statement from the group.', 'event'), actions);
  }

  function selectClaim(id, navigate = true) {
    const claim = state.claims.find(c => c.claim_id === id); if (!claim) { status('That claim is not in the register. Pick one from the list.', true); return; }
    state.ticket++; state.selected = claim; state.run = null; state.busy = false; $('results').hidden = true; $('empty').hidden = false;
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    caseHead(claim, policyFor(claim)); renderInbox(); status(''); if (navigate) query({ claim: id, run: null });
  }
  async function loadInbox() {
    status('Loading claims…');
    try {
      const data = await request('/claims'); state.claims = Array.isArray(data.claims) ? data.claims : []; state.policies = Array.isArray(data.policies) ? data.policies : []; renderInbox(); status('');
      const params = new URLSearchParams(location.search); const id = params.get('claim') || state.selected?.claim_id || state.claims[0]?.claim_id;
      if (id) selectClaim(id, false); if (params.get('claim')) view('case'); if (params.get('run')) await loadRun(params.get('run'));
    } catch (error) { status(`The claims could not be loaded. ${error.message} Reload the page to try again.`, true); $('claim-list').replaceChildren(el('p', 'The list is unavailable.', 'muted')); }
  }
  async function runReview() {
    if (!state.selected || state.busy) return; const ticket = ++state.ticket; const claimId = state.selected.claim_id; state.busy = true;
    const run = $('run-review'); run.disabled = true; run.textContent = 'Reviewing…'; status('Reading the gauge, the satellite and the policy. This takes a few seconds.');
    try {
      const result = await request('/run', { method: 'POST', body: JSON.stringify({ input: { claim_id: claimId } }) }); if (ticket !== state.ticket) return;
      if (!result.output?.decision) throw new Error('The review returned no decision.');
      renderRun(result); query({ claim: claimId, run: result.run_id });
      status(result.status === 'partial' ? 'This review is partial. Read the trail before acting on it.' : 'Review complete. Nothing has been paid.');
    } catch (error) { if (ticket === state.ticket) status(`The review stopped. ${error.message} Try again.`, true); }
    finally { if (ticket === state.ticket) { state.busy = false; caseHead(state.selected, policyFor(state.selected)); } }
  }
  async function loadRun(id) {
    const ticket = ++state.ticket; status('Opening the saved review…');
    try {
      const run = await request(`/runs/${encodeURIComponent(id)}`); if (ticket !== state.ticket) return; if (!run.output?.decision) throw new Error('This saved review has no decision.');
      const claim = run.output.claim; if (claim) state.selected = state.claims.find(c => c.claim_id === claim.claim_id) || claim;
      renderRun(run); status('');
    } catch (error) { if (ticket === state.ticket) status(`The saved review could not be opened. ${error.message} Run a new review.`, true); }
  }

  // tabs: arrow keys move between them
  const tabs = [...document.querySelectorAll('[role="tab"]')];
  function selectTab(tab, focus = false) {
    for (const t of tabs) { const on = t === tab; t.setAttribute('aria-selected', String(on)); t.tabIndex = on ? 0 : -1; $(t.getAttribute('aria-controls')).hidden = !on; }
    if (focus) tab.focus(); if (tab.id === 'tab-evidence' && state.run) drawChart(state.run.output);
  }
  tabs.forEach((tab, i) => {
    tab.addEventListener('click', () => selectTab(tab));
    tab.addEventListener('keydown', event => { const step = { ArrowRight: 1, ArrowLeft: -1 }[event.key]; if (event.key === 'Home') selectTab(tabs[0], true); else if (event.key === 'End') selectTab(tabs[tabs.length - 1], true); else if (step) selectTab(tabs[(i + step + tabs.length) % tabs.length], true); else return; event.preventDefault(); });
  });

  function renderRun(run) {
    state.run = run; const output = run.output; const decision = output.decision; const claim = state.selected;
    if (claim) { state.verdicts[claim.claim_id] = decision.verdict; try { sessionStorage.setItem('pluvia-verdicts', JSON.stringify(state.verdicts)); } catch { /* Session preferences are optional. */ } }
    $('empty').hidden = true; $('results').hidden = false; selectTab(tabs[0]);
    if (claim) caseHead(claim, output.policy || policyFor(claim)); renderInbox();
    renderDecision(output, decision); renderFigures(output); renderChecks(output.probes || decision.probes || []); renderMemory(run.memory || decision.memory); renderTrail(run);
    $('feedback-status').textContent = ''; $('feedback-form').querySelectorAll('button').forEach(b => b.disabled = false);
  }

  function renderDecision(output, decision) {
    const root = $('decision'); root.replaceChildren();
    const reasons = Array.isArray(decision.reasons) ? decision.reasons : [];
    root.append(el('p', 'Our decision', 'label'), verdictTag(decision.verdict, null), el('p', money(decision.payout_ngn), 'amount'), el('p', decision.verdict === 'INSPECT' ? 'Held until the field is checked' : 'Computed payout, synthetic', 'muted small'));
    if (typeof decision.inspection_question === 'string' && decision.inspection_question.trim()) { const q = el('div', null, 'question'); q.append(el('p', 'For the inspector', 'label'), el('p', decision.inspection_question)); root.append(q); }
    else if (reasons[0]) root.append(el('p', reasons[0], 'lead'));
    const more = el('div', null, 'card-actions');
    more.append(button('Why', 'button ghost small', () => { const list = el('ul', null, 'reasons'); for (const r of reasons) list.append(el('li', r)); const source = el('p', `Index used: ${sourceName(decision.index_source)}${Number.isFinite(decision.index_mm) ? `, ${number(decision.index_mm)} mm` : ''}`, 'muted'); const nodes = [reasons.length ? list : el('p', 'No reasons were attached.', 'muted'), source]; if (decision.human_review_required || ['INSPECT', 'NO_PAY'].includes(decision.verdict)) nodes.push(el('p', decision.verdict === 'NO_PAY' ? 'A person must review this refusal before it is final.' : 'A person must review this before settlement.', 'note')); openSheet(labels[decision.verdict] || 'Decision', 'Why we decided this', ...nodes); }));
    more.append(button('Case for paying', 'button ghost small', () => openSheet('Counter-case', 'The strongest case for paying', el('p', decision.counter_case || output.card?.counter_case || 'No counter-case was attached. A refusal needs a person to review the case for paying.', 'reading'))));
    more.append(button('Letter', 'button ghost small', () => openSheet('Decision letter', 'The letter to the group', el('pre', output.letter_markdown || 'No letter was attached to this review.', 'letter'))));
    root.append(more);

    const base = $('baseline'); base.replaceChildren(); const naive = output.naive?.station_only || decision.naive?.station_only;
    base.append(el('p', 'Automatic trigger', 'label'));
    if (naive) base.append(verdictTag(naive.verdict), el('p', money(naive.payout_ngn), 'amount'), el('p', `Adds up ${number(naive.index_mm)} mm from the gauge and never checks the days it stayed silent.`, 'muted small'));
    else base.append(el('p', 'No comparison for this claim.', 'muted'));
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

  function renderMemory(memory) {
    $('memory').replaceChildren();
    const text = value => typeof value === 'string' ? value : value?.content || (value?.status ? `${value.status}, confidence ${number(value.resolution_confidence)}, ${value.id}` : JSON.stringify(value));
    for (const [key, name, empty, title] of [['recalled', 'Earlier reviews recalled', 'Nothing recalled yet.', 'What we remembered'], ['written', 'Saved from this review', 'Nothing saved.', 'What we saved'], ['conflicts', 'Source conflicts', 'No conflicts recorded.', 'Where the sources disagree']]) {
      const values = Array.isArray(memory?.[key]) ? memory[key] : []; const tile = el('div', null, 'card tile');
      const preview = !values.length ? empty : key === 'conflicts' ? `${values.filter(v => v?.status === 'open').length} still open, waiting on a closer look.` : key === 'written' ? 'Kept for the next review of this station.' : text(values[0]);
      tile.append(el('p', name, 'label'), el('p', String(values.length), 'amount'), el('p', preview, 'muted small clamp'));
      if (values.length) tile.append(button('View all', 'button ghost small', () => { const list = el('ul', null, 'plain'); for (const v of values) list.append(el('li', text(v))); openSheet('Memory', title, list); }));
      $('memory').append(tile);
    }
  }

  function renderTrail(run) {
    const trace = Array.isArray(run.trace) ? run.trace : []; const groups = new Map();
    for (const event of trace) { const agent = event.agent || 'Review'; if (!groups.has(agent)) groups.set(agent, []); groups.get(agent).push(event); }
    $('trail-summary').textContent = trace.length ? `${trace.length} steps across ${groups.size} parts${Number.isFinite(run.execution_time_seconds) ? `, ${number(run.execution_time_seconds)} seconds` : ''}. Run ${run.run_id || 'unknown'}.` : 'No trail came with this review.';
    $('trail').replaceChildren();
    for (const [agent, events] of groups) {
      const warnings = events.filter(e => e.status && e.status !== 'ok').length;
      const row = button(null, 'row'); row.append(el('span', String(events.length), 'state step'), el('span', agent.replace(/Agent$/, ''), 'row-title'), el('span', warnings ? `${warnings} to watch` : 'All clear', 'row-meta'), el('span', '', 'chevron'));
      row.addEventListener('click', () => {
        const list = el('ol', null, 'steps');
        for (const event of events) { const item = el('li'); item.append(el('strong', event.action || 'Event'), el('span', [event.status, event.model ? `model ${event.model}` : null, Number.isFinite(event.round) ? `round ${event.round}` : null].filter(Boolean).join(' · '), 'muted small')); if (event.output_summary || event.input_summary) item.append(el('p', event.output_summary || event.input_summary, 'small')); const raw = el('details'); raw.append(el('summary', event.sql ? 'SQL and raw event' : 'Raw event'), el('pre', event.sql ? `${event.sql}\n\n${JSON.stringify(event, null, 2)}` : JSON.stringify(event, null, 2))); item.append(raw); list.append(item); }
        openSheet('Trail', agent.replace(/Agent$/, ''), list);
      });
      $('trail').append(row);
    }
  }

  $('feedback-form').addEventListener('submit', async event => {
    event.preventDefault(); if (!state.run || !event.submitter) return; const runId = state.run.run_id; const kind = event.submitter.value; const buttons = [...$('feedback-form').querySelectorAll('button')];
    buttons.forEach(b => b.disabled = true); $('feedback-status').textContent = 'Saving…';
    try { await request(`/runs/${encodeURIComponent(runId)}/feedback`, { method: 'POST', body: JSON.stringify({ kind }) }); if (state.run?.run_id === runId) $('feedback-status').textContent = kind === 'helpful' ? 'Confirmed and saved. The payout is unchanged.' : 'Override saved. The payout is unchanged.'; }
    catch (error) { if (state.run?.run_id === runId) $('feedback-status').textContent = `Not saved. ${error.message} Try again.`; }
    finally { if (state.run?.run_id === runId) buttons.forEach(b => b.disabled = false); }
  });

  document.querySelectorAll('[data-legal]').forEach(link => link.addEventListener('click', () => { const [title, ...paragraphs] = window.PLUVIA_LEGAL[link.dataset.legal]; openSheet('Updated 27 October 2026 · not legally reviewed', title, ...paragraphs.map(text => el('p', text, 'reading'))); }));
  $('claim-search').addEventListener('input', renderInbox);
  window.addEventListener('popstate', () => { const params = new URLSearchParams(location.search); const id = params.get('claim') || state.claims[0]?.claim_id; if (id) selectClaim(id, false); if (params.get('run')) loadRun(params.get('run')); });
  request('/health').then(health => { const sample = health.sample_mode ?? health.sampleMode ?? (health.mode === 'sample' ? true : health.mode === 'live' ? false : undefined); $('mode').textContent = sample ? 'Sample mode' : sample === false ? `Live · Zetaris ${health.zetaris || 'unknown'} · Nightshift ${health.nightshift || 'unknown'}` : 'Connected'; }).catch(() => { $('mode').textContent = 'Offline'; });
  loadInbox();
})();
