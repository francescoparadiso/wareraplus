/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: la scheda "Storia politica" di una nazione
   ------------------------------------------------------------------
   Tutto da /political-history (server/politicalHistory.js), una
   richiesta per nazione. Cinque riquadri, e due tipi di dato che la
   vista tiene separati apposta:

     · COMPLETI dal lancio del gioco — presidenti e affluenza. Vengono
       dalle elezioni, che il server ha tutte.
     · ACCUMULATI da quando il server guarda — iscritti ai partiti,
       cambi di casacca, governi. Ognuno porta il suo `coverageFrom`
       e il riquadro lo dice in una fascia: prima di quella data una
       riga vuota NON è "nessuno si è mosso", è "non guardavamo".

   Nessun ripiego nel browser: se il server non risponde la scheda
   dice che lo storico non è disponibile e basta — questi archivi non
   esistono da nessun'altra parte.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, getPartyColor, partyNamesMap, countryNamesMap, APP_BASE } from './config.js';
import { pT } from './plusI18n.js';
import { fetchPoliticalHistory } from './plusApi.js';
import { lineChartSvg, stripSvg, fmtDate } from './plusCharts.js';
import { hideOtherViews } from './plusViews.js';

const DAY_MS = 864e5;
const ROLE_KEYS = ['role_president', 'role_vice', 'role_defense', 'role_foreign', 'role_economy'];

let _renderSeq = 0;

export function isHistoryViewOpen() {
  const el = document.getElementById('wp-pol-history-view');
  return !!el && el.style.display !== 'none';
}

export async function showHistoryView(countryId) {
  hideOtherViews('history');
  const view = document.getElementById('wp-pol-history-view');
  if (!view) return;
  view.style.display = '';
  const seq = ++_renderSeq;
  view.innerHTML = `<div class="panel wp-pol-loading">${escapeHtml(pT('loading_history'))}</div>`;
  const data = await fetchPoliticalHistory(countryId);
  if (seq !== _renderSeq || !view.isConnected) return;
  if (!data) {
    view.innerHTML = `<div class="panel wp-pol-empty">${escapeHtml(pT('history_unavailable'))}</div>`;
    return;
  }
  view.innerHTML = historyHtml(data);
}

/* ── helper ── */

function _pct(x, digits = 0) { return Number.isFinite(x) ? (x * 100).toFixed(digits) + '%' : '—'; }

function _partyName(pid, names) {
  if (!pid || pid === '_') return pT('independent');
  return names?.[pid] || partyNamesMap.get(pid) || pT('unknown_party');
}

function _partyPill(pid, names) {
  if (!pid) return `<span class="wp-pol-party wp-pol-party-none">${escapeHtml(pT('no_party'))}</span>`;
  const c = pid === '_' ? '#8b949e' : getPartyColor(pid);
  return `<span class="wp-pol-party" style="--pc:${c}"><i></i>${escapeHtml(_partyName(pid, names))}</span>`;
}

function _user(uid, usernames) {
  if (!uid) return '<span class="wp-pol-dim">—</span>';
  const name = usernames?.[uid] || `#${String(uid).slice(-6)}`;
  return `<a href="${APP_BASE}/user/${encodeURIComponent(uid)}" target="_blank" rel="noopener">${escapeHtml(name)}</a>`;
}

function _coverage(from, extra = '') {
  if (!from) return `<div class="wp-pol-cov">${escapeHtml(pT('coverage_none'))}</div>`;
  return `<div class="wp-pol-cov">${escapeHtml(pT('coverage_from', { date: fmtDate(from, true) }))}${extra ? ' ' + escapeHtml(extra) : ''}</div>`;
}

function _panel(icon, title, body, cls = '') {
  return `<div class="panel wp-pol-card ${cls}">
    <div class="panel-head"><div class="panel-icon">${icon}</div><h2>${escapeHtml(title)}</h2></div>
    ${body}
  </div>`;
}

/* ── la scheda ── */

function historyHtml(d) {
  const names = d.partyNames || {};
  const users = d.usernames || {};
  const finished = d.elections.filter(e => e.st === 'finished' || (!e.st && e.e < Date.now()));
  const first = finished[0]?.e || d.elections[0]?.c0 || null;
  const country = countryNamesMap.get(d.countryId) || '';

  const head = `<div class="panel wp-pol-hist-head">
      <div>
        <div class="wp-pol-hist-title">📜 ${escapeHtml(pT('history_title'))}${country ? ` — ${escapeHtml(country)}` : ''}</div>
        <div class="wp-pol-dim">${escapeHtml(pT('history_sub', { n: finished.length, date: first ? fmtDate(first, true) : '—' }))}</div>
      </div>
      <button type="button" class="btn-load" data-wp-nation="${escapeHtml(d.countryId)}">📊 ${escapeHtml(pT('open_nation'))}</button>
    </div>`;

  return `${head}
    <div class="wp-pol-grid2">
      ${presidentsPanel(d.presidents, names, users)}
      ${turnoutPanel(finished)}
    </div>
    ${membersPanel(d.members, names)}
    <div class="wp-pol-grid2">
      ${switchesPanel(d.switches, names, users)}
      ${governmentsPanel(d.governments, users)}
    </div>`;
}

function presidentsPanel(presidents, names, users) {
  if (!presidents.length) return _panel('👤', pT('presidents'), `<p class="wp-pol-dim">${escapeHtml(pT('no_presidents'))}</p>`);
  const periods = presidents.map(p => ({
    from: p.from, to: p.to,
    color: p.p ? getPartyColor(p.p) : '#8b949e',
    label: `${users[p.u] || p.u} · ${_partyName(p.p, names)} · ${fmtDate(p.from, true)} → ${p.to ? fmtDate(p.to, true) : pT('in_office')}`,
  }));
  const rows = presidents.slice().reverse().map((p, i, arr) => {
    const prev = arr[i + 1];
    const again = prev && prev.u === p.u;
    const days = Math.max(1, Math.round(((p.to || Date.now()) - p.from) / DAY_MS));
    return `<div class="wp-pol-pres-row${p.to ? '' : ' current'}">
      <div class="wp-pol-pres-who">${_user(p.u, users)}${again ? ` <span class="wp-pol-tag">${escapeHtml(pT('reelected'))}</span>` : ''}${p.to ? '' : ` <span class="wp-pol-tag live">${escapeHtml(pT('in_office'))}</span>`}</div>
      <div>${_partyPill(p.p, names)}</div>
      <div class="wp-pol-num" title="${escapeHtml(pT('votes_of', { v: p.v, tot: p.tot }))}">${_pct(p.share)}</div>
      <div class="wp-pol-dim wp-pol-pres-dates">${escapeHtml(fmtDate(p.from, true))} · ${escapeHtml(pT('days_n', { n: days }))}</div>
    </div>`;
  }).join('');
  const distinct = new Set(presidents.map(p => p.u)).size;
  return _panel('👤', pT('presidents'), `
    ${stripSvg(periods)}
    <div class="wp-pol-dim wp-pol-small">${escapeHtml(pT('presidents_sub', { n: presidents.length, d: distinct }))}</div>
    <div class="wp-pol-pres-list">${rows}</div>
    <div class="wp-pol-note">${escapeHtml(pT('presidents_note'))}</div>`);
}

function turnoutPanel(finished) {
  const cong = finished.filter(e => e.t === 'C').map(e => [e.e, e.v]);
  const pres = finished.filter(e => e.t === 'P').map(e => [e.e, e.v]);
  if (!cong.length && !pres.length) return _panel('🗳️', pT('turnout'), `<p class="wp-pol-dim">—</p>`);
  const chart = lineChartSvg({
    series: [
      { name: pT('congress'), color: 'var(--gold2)', points: cong, dots: true },
      { name: pT('presidential'), color: '#58a6ff', points: pres, dots: true, dashed: true },
    ],
  });
  const last = cong.at(-1), prev = cong.at(-2);
  const delta = last && prev && prev[1] ? (last[1] - prev[1]) / prev[1] : null;
  const best = cong.reduce((m, x) => (x[1] > (m?.[1] ?? -1) ? x : m), null);
  return _panel('🗳️', pT('turnout'), `
    <div class="wp-pol-legend">
      <span><i style="background:var(--gold2)"></i>${escapeHtml(pT('congress'))}</span>
      <span><i style="background:#58a6ff"></i>${escapeHtml(pT('presidential'))}</span>
    </div>
    ${chart}
    <div class="wp-pol-kpis">
      ${last ? `<div><strong>${last[1]}</strong><span>${escapeHtml(pT('last_congress_voters'))}</span></div>` : ''}
      ${delta != null ? `<div><strong class="${delta >= 0 ? 'up' : 'down'}">${delta >= 0 ? '+' : ''}${_pct(delta)}</strong><span>${escapeHtml(pT('vs_previous'))}</span></div>` : ''}
      ${best ? `<div><strong>${best[1]}</strong><span>${escapeHtml(pT('record_on', { date: fmtDate(best[0], true) }))}</span></div>` : ''}
    </div>
    <div class="wp-pol-note">${escapeHtml(pT('turnout_note'))}</div>`);
}

function membersPanel(members, names) {
  const series = Object.entries(members?.series || {});
  const now = Date.now();
  // I sei partiti più grandi ADESSO: oltre, le linee diventano un gomitolo.
  const top = series
    .map(([pid, pts]) => ({ pid, pts, n: pts.at(-1)?.[1] || 0 }))
    .filter(s => s.n > 0 || s.pts.length > 1)
    .sort((a, b) => b.n - a.n)
    .slice(0, 6);
  let body;
  if (!top.length) body = `<p class="wp-pol-dim">${escapeHtml(pT('members_empty'))}</p>`;
  else {
    const chart = lineChartSvg({
      series: top.map(s => ({ name: _partyName(s.pid, names), color: getPartyColor(s.pid), points: s.pts })),
      step: true, until: now, from: members.coverageFrom || undefined, height: 220,
    });
    const rows = top.map(s => {
      const weekAgo = _valueAt(s.pts, now - 7 * DAY_MS);
      const d7 = weekAgo != null ? s.n - weekAgo : null;
      return `<div class="wp-pol-mem-row">${_partyPill(s.pid, names)}<strong>${s.n}</strong>
        <span class="wp-pol-num ${d7 > 0 ? 'up' : d7 < 0 ? 'down' : ''}">${d7 == null ? '—' : (d7 > 0 ? '+' : '') + d7} <em>${escapeHtml(pT('in_7d'))}</em></span></div>`;
    }).join('');
    body = `${chart}<div class="wp-pol-mem-list">${rows}</div>`;
  }
  return _panel('📈', pT('members_over_time'), `${_coverage(members?.coverageFrom)}${body}`, 'wp-pol-wide');
}

/** Il valore di una serie di CAMBI a un istante: l'ultimo cambio prima di
 *  lì. Prima del primo punto non si sa (null), non è zero. */
function _valueAt(pts, ts) {
  let v = null;
  for (const [t, n] of pts) { if (t <= ts) v = n; else break; }
  return v;
}

function switchesPanel(sw, names, users) {
  const rows = sw?.rows || [];
  const net = new Map();   // pid → { in, out }
  const bump = (pid, k) => {
    if (!pid) return;
    const o = net.get(pid) || { in: 0, out: 0 };
    o[k]++; net.set(pid, o);
  };
  for (const r of rows) { bump(r.t, 'in'); bump(r.f, 'out'); }
  const summary = [...net.entries()]
    .map(([pid, o]) => ({ pid, ...o, net: o.in - o.out }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net) || (b.in + b.out) - (a.in + a.out))
    .slice(0, 8);

  const sumHtml = summary.length ? `<div class="wp-pol-sw-sum">${summary.map(s => `
      <div class="wp-pol-sw-sum-row">${_partyPill(s.pid, names)}
        <span class="up">+${s.in}</span><span class="down">−${s.out}</span>
        <strong class="${s.net > 0 ? 'up' : s.net < 0 ? 'down' : ''}">${s.net > 0 ? '+' : ''}${s.net}</strong></div>`).join('')}</div>` : '';

  const list = rows.slice(0, 60).map(r => `
    <div class="wp-pol-sw-row">
      <span class="wp-pol-dim">${escapeHtml(fmtDate(r.a))}</span>
      <span class="wp-pol-sw-user">${_user(r.u, users)}</span>
      <span class="wp-pol-sw-path">${_partyPill(r.f, names)} <b>→</b> ${_partyPill(r.t, names)}</span>
    </div>`).join('');

  const body = rows.length
    ? `${sumHtml}<div class="wp-pol-sw-list">${list}</div>${rows.length > 60 ? `<div class="wp-pol-dim wp-pol-small">${escapeHtml(pT('and_more', { n: rows.length - 60 }))}</div>` : ''}`
    : `<p class="wp-pol-dim">${escapeHtml(pT('switches_empty', { days: sw?.days || 30 }))}</p>`;
  return _panel('🔀', pT('switches', { days: sw?.days || 30 }), `${_coverage(sw?.coverageFrom)}${body}`);
}

function governmentsPanel(gov, users) {
  const rows = gov?.rows || [];
  let body;
  if (!rows.length) body = `<p class="wp-pol-dim">${escapeHtml(pT('gov_empty'))}</p>`;
  else {
    const out = [];
    for (let i = rows.length - 1; i >= 0 && out.length < 25; i--) {
      const cur = rows[i], prev = rows[i - 1];
      const changes = cur.r.map((u, k) => ({ k, u, before: prev?.r?.[k] }))
        .filter(c => !prev || c.u !== c.before);
      const items = changes.map(c => `<div class="wp-pol-gov-ch"><span class="wp-pol-dim">${escapeHtml(pT(ROLE_KEYS[c.k]))}</span>
          ${prev && c.before ? `<s>${_user(c.before, users)}</s> → ` : ''}${c.u ? _user(c.u, users) : `<em class="wp-pol-dim">${escapeHtml(pT('vacant'))}</em>`}</div>`).join('');
      out.push(`<div class="wp-pol-gov-row">
          <div class="wp-pol-gov-date">${escapeHtml(fmtDate(cur.a, true))}${prev ? '' : ` <span class="wp-pol-tag">${escapeHtml(pT('first_reading'))}</span>`}</div>
          <div>${items}</div>
        </div>`);
    }
    body = out.join('');
  }
  return _panel('🏛️', pT('governments'), `${_coverage(gov?.coverageFrom, pT('gov_resolution'))}${body}`);
}
