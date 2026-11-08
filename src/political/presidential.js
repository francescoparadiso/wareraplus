/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: presidential.js come modulo ES (Fase 2, Stage 7)
   ------------------------------------------------------------------
   Conversione diretta. Chart da CDN a import npm.

   window._presCountdown / window._lastPresData: letti anche da main.js
   (Stage 8, toggleTheme via config.js già li riceve come parametro
   iniettato dal Stage 2) — restano `export let` di questo modulo,
   scritti per riassegnazione diretta (proprietario unico).

   `loadElection` (main.js, Stage 8) e `getGovernmentWithDetails`/
   `renderGovernment` (congress.js, già creato in questo stage) — i
   primi due iniettati via setPresidentialDeps, i secondi importati
   staticamente (il modulo esiste già).

   BUG PREESISTENTE preservato inalterato (non è nello scope di questa
   conversione "correggerlo silenziosamente"): dentro
   renderPresidentialTurnoutChart, l'onClick del grafico fa
   `document.getElementById('electionIdInput').value = eid` — quell'id
   non esiste in nessun punto del markup (verificato via grep su
   public/political/index.html). Nell'originale, cliccare un punto sul
   grafico storico affluenza (quando ci sono >=2 elezioni presidenziali)
   lancia già un errore "Cannot read properties of null" prima ancora
   di questa conversione — comportamento (bug incluso) preservato 1:1.
   ══════════════════════════════════════════════════════════════ */

import Chart from 'chart.js/auto';
import { t } from './i18n.js';
import {
  csvColorMap, PALETTE, electionHistory, currentCountryId,
  chartTheme, getTheme, APP_BASE, CACHE_TTL_LONG,
  partyNamesMap, setPresidentChart, escapeHtml, getPartyColor,
} from './config.js';
import { prT, prLocale } from './presI18n.js';
import { localFetch } from './api.js';
import { startHeavyOperation, endHeavyOperation } from './loading.js';
import { showView, resetStats, fillStat, safeDestroy } from './ui.js';
import { getGovernmentWithDetails, renderGovernment, loadPartiesForCountry } from './congress.js';
import { renderTermGovernment } from './governmentView.js';
import { fetchPoliticalHistory } from './plusApi.js';
import { fetchUsersLiteViaCache } from '../diplomacy/cacheClient.js';
import { governmentMembers } from '../shared/government.js';

// Dipendenze cross-modulo iniettate da main.js (Stage 8).
let _loadElection = null;
export function setPresidentialDeps({ loadElection } = {}) {
  if (loadElection) _loadElection = loadElection;
}

// Stato di proprietà esclusiva di questo modulo, letto anche da main.js
// (Stage 8) e da config.js:toggleTheme (via parametro iniettato, Stage 2).
export let presCountdown = null;
export let lastPresData = null;
// setter aggiunto in Stage 8: main.js:loadElection deve poter azzerare un
// countdown presidenziale residuo PRIMA di sapere se la nuova elezione è
// di tipo congress o president (reset difensivo, come nell'originale).
export function setPresCountdown(v) { presCountdown = v; }

/* ── PRESIDENTIAL ELECTION ── */
export async function loadPresidentialElection(election, isLatestPresidential) {
  startHeavyOperation('Loading presidential election...');
  document.getElementById('timelinePanel').style.display = 'none';
  showView('president');
  document.getElementById('candidatesContainer').style.display = 'none';
  resetStats();

  const candidatePartyIds = [...new Set(election.candidates.map(c => c.party || c.partyId).filter(Boolean))];
  const candPartyMap      = {};
  await Promise.all(candidatePartyIds.map(async pid => {
    try {
      const p = await localFetch('/party', { id: pid });
      if (p?.name) candPartyMap[pid] = { name: p.name, color: csvColorMap.get(pid) || PALETTE[Object.keys(candPartyMap).length % PALETTE.length] };
    } catch (_) {}
  }));

  const candidateUsers = await Promise.all(
    election.candidates.map(c => localFetch('/user', { id: c.user || c.userId }).catch(() => ({})))
  );
  const candidates = election.candidates.map((c, i) => {
    const userData = candidateUsers[i];
    const votes    = election.votes ? (election.votes[String(c.user || c.userId)] ?? c.voteCount ?? 0) : (c.voteCount ?? 0);
    const partyId  = c.party || c.partyId || null;
    return { ...c, userData, votes, color: PALETTE[i % PALETTE.length], partyInfo: partyId ? (candPartyMap[partyId] || null) : null, partyId };
  });
  candidates.sort((a, b) => b.votes - a.votes);

  const totalVotes = election.votesCount || candidates.reduce((s, c) => s + c.votes, 0);
  const maxVotes   = candidates[0]?.votes || 1;
  const winner     = candidates.find(c => c.isElected) || candidates[0];

  fillStat('stat-totalvotes', totalVotes.toLocaleString());

  /* WarEra+ 2026-11-08 — RISULTATI RIFATTI.
     Prima: banner del vincitore, una barra per candidato con colori a caso
     (non quelli dei partiti), e sotto un grafico a barre che ripeteva gli
     stessi numeri; testi metà in inglese e metà in italiano. Ora un solo
     riquadro: chi vince (o chi è in testa) col partito, una barra unica
     delle quote con la linea del 50%, il margine detto in chiaro, i
     candidati coi colori dei partiti e il confronto con le presidenziali
     precedenti (affluenza, presidente uscente, partito). Il grafico
     doppione non si disegna più. */
  const now = new Date(), end = new Date(election.votesEndAt), start = new Date(election.votesStartAt);
  const phase = now < start ? 'candidacy' : now <= end ? 'live' : 'done';

  // Colore: quello del partito (lo stesso di tutto Political); gli
  // indipendenti prendono la tavolozza, così due indipendenti si distinguono.
  candidates.forEach((c, i) => { c.color = c.partyId ? getPartyColor(c.partyId) : PALETTE[i % PALETTE.length]; });

  /* STATUS BADGE */
  const sb = document.getElementById('pres-status-badge');
  sb.textContent = prT(phase === 'candidacy' ? 'pr_candidacy' : phase === 'live' ? 'pr_live' : 'pr_done');
  sb.className = 'badge-count ' + (phase === 'candidacy' ? 'pres-badge-pending' : phase === 'live' ? 'pres-badge-live' : 'pres-badge-done');

  /* COUNTDOWN */
  if (presCountdown) { clearInterval(presCountdown); presCountdown = null; }
  const countdownEl = document.getElementById('presCountdown');
  if (phase === 'live') {
    const tick = () => {
      const remaining = new Date(election.votesEndAt) - new Date();
      if (remaining <= 0) { clearInterval(presCountdown); if (countdownEl) countdownEl.textContent = prT('pr_closed'); return; }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      if (countdownEl) countdownEl.textContent = prT('pr_closes', { t: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` });
    };
    tick();
    presCountdown = setInterval(tick, 1000);
  } else if (countdownEl) {
    countdownEl.textContent = '';
  }

  // Il banner e il margine di prima stanno ora dentro #pres-race.
  document.getElementById('pres-winner-banner').style.display = 'none';
  const oldMargin = document.getElementById('presMargin');
  if (oldMargin) oldMargin.style.display = 'none';
  if (winner) fillStat('stat-leader', winner.userData?.username || '—');

  document.getElementById('pres-race').innerHTML = presRaceHtml(candidates, totalVotes, election, phase, winner);
  const raceDiv = document.getElementById('pres-race');
  raceDiv.querySelector('[data-pr-more]')?.addEventListener('click', (e) => {
    const box = raceDiv.querySelector('.wp-pr-rows');
    const open = box.classList.toggle('wp-pr-rows-open');
    e.currentTarget.textContent = open ? prT('pr_less') : prT('pr_more', { n: candidates.length });
  });
  presCompare(candidates, totalVotes, election, phase).then(html => {
    const slot = raceDiv.querySelector('.wp-pr-compare');
    if (slot && html && lastPresData?.election?._id === election._id) { slot.innerHTML = html; slot.hidden = false; }
  }).catch(() => {});

  /* CHART — non più: il pannello "Distribuzione voti" ripeteva la barra. */
  safeDestroy('presidentChart');
  const distPanel = document.getElementById('presVotesChartPanel');
  if (distPanel) distPanel.style.display = 'none';

  renderPresidentialTurnoutChart(election._id);
  renderPresidentialHistoricWinners(election._id);

  lastPresData = { candidates, totalVotes, election };
  renderPresSimulator(candidates, totalVotes, election);
  document.getElementById('badgeCount').textContent = t('badge_presidential', { n: totalVotes });

  // WarEra+ 2026-11-08: per una presidenziale vecchia il governo "di oggi"
  // non c'entra: si mostra quello di quel mandato, dall'archivio dei
  // governi (governmentView.js: renderTermGovernment). Prima il pannello
  // si chiudeva e basta.
  const govPanel = document.getElementById('presGovernmentPanel');
  const govTitle = govPanel?.querySelector('summary h2');
  if (isLatestPresidential) {
    if (govTitle) govTitle.textContent = prT('gv_title_now');
    const govData = await getGovernmentWithDetails(election.country || currentCountryId);
    renderGovernment(govData);
  } else if (govPanel) {
    govPanel.open = true;
    if (govTitle) govTitle.textContent = prT('gv_title_term');
    const next = (electionHistory || [])
      .filter(e => e.type === 'president' && Date.parse(e.createdAt) > Date.parse(election.createdAt))
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt))[0];
    renderTermGovernment(
      { ...election, country: election.country || currentCountryId },
      document.getElementById('governmentGrid'), document.getElementById('govBadge'),
      {
        fetchPoliticalHistory,
        fetchUsersLite: fetchUsersLiteViaCache,
        loadParties: loadPartiesForCountry,
        governmentMembers,
        nextEnd: next?.votesEndAt ? Date.parse(next.votesEndAt) : null,
      },
    ).catch(err => console.warn('WarEra+ governo del mandato:', err));
  }
  endHeavyOperation();
}

/* ── WarEra+ 2026-11-08 — RISULTATI PRESIDENZIALI ──────────────────
   Il riquadro unico che sostituisce banner, margine, righe e grafico a
   barre (vedi il commento dentro loadPresidentialElection). */

const _num = (n) => Number(n || 0).toLocaleString(prLocale());
const _pct = (v, tot) => (tot ? (v / tot) * 100 : 0);
const _pctTxt = (v, tot) => `${_pct(v, tot).toLocaleString(prLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
const _day = (d) => new Date(d).toLocaleDateString(prLocale(), { day: 'numeric', month: 'short', year: 'numeric' });

/** Testo scuro su un colore chiaro: i colori dei partiti vengono dal CSV
 *  o da stringToColor, e alcuni sono quasi bianchi (MOS MAIORVM è #fff),
 *  col nome bianco sopra che spariva. Accetta #rgb, #rrggbb, rgb() e hsl(). */
function _inkOn(color) {
  const s = String(color || '').trim();
  let r, g, b;
  let m = s.match(/^#([0-9a-f]{3})$/i);
  if (m) [r, g, b] = m[1].split('').map(x => parseInt(x + x, 16));
  else if ((m = s.match(/^#([0-9a-f]{6})/i))) [r, g, b] = [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  else if ((m = s.match(/^rgba?\(\s*(\d+)[ ,]+(\d+)[ ,]+(\d+)/i))) [r, g, b] = m.slice(1, 4).map(Number);
  else if ((m = s.match(/^hsla?\(\s*([\d.]+)[ ,]+([\d.]+)%[ ,]+([\d.]+)%/i))) {
    const h = Number(m[1]) / 360, sat = Number(m[2]) / 100, l = Number(m[3]) / 100;
    const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat, p = 2 * l - q;
    const f = (t) => { t = (t + 1) % 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p; };
    [r, g, b] = [f(h + 1 / 3), f(h), f(h - 1 / 3)].map(v => v * 255);
  } else return '#fff';
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return lum > 0.62 ? '#0d1117' : '#fff';
}

function _prAvatar(c, cls) {
  const u = c.userData || {};
  if (u.avatarUrl) return `<img src="${escapeHtml(u.avatarUrl)}" class="${cls}" alt="" loading="lazy">`;
  return `<span class="${cls} wp-pr-av-none" style="--pc:${c.color}">${escapeHtml((u.username || '?')[0].toUpperCase())}</span>`;
}

function _prParty(c) {
  if (!c.partyId) return `<span class="wp-pr-party wp-pr-party-none">${escapeHtml(prT('pr_independent'))}</span>`;
  const name = c.partyInfo?.name || partyNamesMap.get(c.partyId) || '—';
  return `<span class="wp-pr-party" style="--pc:${c.color}"><i></i>${escapeHtml(name)}</span>`;
}

function presRaceHtml(candidates, totalVotes, election, phase, winner) {
  const top = candidates[0];
  const second = candidates[1];
  const done = phase === 'done';
  const lead = done ? winner : top;
  const leadVotes = lead?.votes || 0;
  const hero = lead ? `
    <div class="wp-pr-hero${done ? ' wp-pr-hero-done' : ''}" style="--pc:${lead.color}">
      ${_prAvatar(lead, 'wp-pr-av wp-pr-av-big')}
      <div class="wp-pr-hero-txt">
        <div class="wp-pr-kicker">${done ? '🏆 ' : ''}${escapeHtml(prT(done ? 'pr_elected' : 'pr_leading'))}</div>
        <div class="wp-pr-hero-name"><a href="${APP_BASE}/user/${escapeHtml(lead.user || lead.userId)}" target="_blank" rel="noopener">${escapeHtml(lead.userData?.username || '—')}</a></div>
        ${_prParty(lead)}
      </div>
      <div class="wp-pr-hero-num">
        <div class="wp-pr-big">${_pctTxt(leadVotes, totalVotes)}</div>
        <div class="wp-pr-sub">${escapeHtml(prT('pr_votes', { n: _num(leadVotes) }))}</div>
      </div>
    </div>` : '';

  // Barra unica delle quote: un segmento per candidato, linea al 50%.
  // Sotto il 4% il nome non ci sta e resta nel tooltip.
  const bar = totalVotes > 0 ? `
    <div class="wp-pr-share" role="img" aria-label="${escapeHtml(candidates.map(c => `${c.userData?.username || '—'} ${_pctTxt(c.votes, totalVotes)}`).join(', '))}">
      ${candidates.filter(c => c.votes > 0).map(c => {
        const p = _pct(c.votes, totalVotes);
        return `<span style="flex:${c.votes};background:${c.color};color:${_inkOn(c.color)};text-shadow:${_inkOn(c.color) === '#fff' ? '0 1px 2px rgba(0,0,0,.55)' : 'none'}" title="${escapeHtml(`${c.userData?.username || '—'}: ${_num(c.votes)} (${_pctTxt(c.votes, totalVotes)})`)}">${p >= 9 ? escapeHtml(c.userData?.username || '') : ''}</span>`;
      }).join('')}
      <i class="wp-pr-half" title="${escapeHtml(prT('pr_half'))}"></i>
    </div>` : '';

  let margin = '';
  if (candidates.length === 1) margin = prT('pr_unopposed');
  else if (top && second && totalVotes > 0) {
    const gap = top.votes - second.votes;
    const pts = (_pct(gap, totalVotes)).toLocaleString(prLocale(), { maximumFractionDigits: 1, minimumFractionDigits: 1 });
    const name = second.userData?.username || '—';
    margin = gap === 0 ? prT('pr_tie', { name }) : prT(done ? 'pr_win_by' : 'pr_lead_by', { n: _num(gap), p: pts, name });
  }

  const SHOW = 6;
  const rows = candidates.map((c, i) => {
    const p = _pct(c.votes, totalVotes);
    const gap = i > 0 && top ? top.votes - c.votes : 0;
    return `<div class="wp-pr-row${c.isElected ? ' wp-pr-row-win' : ''}${i >= SHOW ? ' wp-pr-row-extra' : ''}" style="--pc:${c.color}">
      <span class="wp-pr-rank">${i + 1}</span>
      ${_prAvatar(c, 'wp-pr-av')}
      <div class="wp-pr-row-main">
        <div class="wp-pr-row-head">
          <a class="wp-pr-row-name" href="${APP_BASE}/user/${escapeHtml(c.user || c.userId)}" target="_blank" rel="noopener">${escapeHtml(c.userData?.username || '—')}</a>
          ${c.isElected ? `<span class="wp-pr-chip">${escapeHtml(prT('pr_elected_chip'))}</span>` : ''}
          ${_prParty(c)}
        </div>
        <div class="wp-pr-track"><i style="width:${Math.max(p, c.votes ? 0.8 : 0).toFixed(1)}%"></i></div>
      </div>
      <div class="wp-pr-row-num">
        <b>${_pctTxt(c.votes, totalVotes)}</b>
        <span>${_num(c.votes)}${gap > 0 ? ` <em>−${_num(gap)}</em>` : ''}</span>
      </div>
    </div>`;
  }).join('');
  const more = candidates.length > SHOW
    ? `<button type="button" class="wp-pr-more" data-pr-more>${escapeHtml(prT('pr_more', { n: candidates.length }))}</button>` : '';

  const meta = `
    <div class="wp-pr-meta">
      <span>📅 ${escapeHtml(prT('pr_start'))} <b>${escapeHtml(_day(election.votesStartAt))}</b></span>
      <span>⏱ ${escapeHtml(prT('pr_end'))} <b>${escapeHtml(_day(election.votesEndAt))}</b></span>
      <span>🗳 ${escapeHtml(prT('pr_votes', { n: _num(totalVotes) }))}</span>
      <a href="${APP_BASE}/country/${escapeHtml(election.country)}/election/${escapeHtml(election._id)}" target="_blank" rel="noopener">${escapeHtml(prT('pr_open'))}</a>
    </div>`;

  return `<div class="wp-pr">
    ${hero}
    ${bar}
    ${margin ? `<div class="wp-pr-margin">${escapeHtml(margin)}</div>` : ''}
    <div class="wp-pr-rows">${rows}</div>
    ${more}
    <div class="wp-pr-compare" hidden></div>
    ${meta}
  </div>`;
}

/** Il confronto con la presidenziale precedente della stessa nazione:
 *  affluenza, cosa è successo al presidente uscente, il partito della
 *  presidenza. Due richieste in cache (dettaglio dell'elezione precedente,
 *  nome del suo vincitore); null se non c'è una presidenziale prima. */
async function presCompare(candidates, totalVotes, election, phase) {
  const prevMeta = (electionHistory || [])
    .filter(e => e.type === 'president' && e._id !== election._id && Date.parse(e.createdAt) < Date.parse(election.createdAt))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!prevMeta) return null;
  const prev = await localFetch('/election', { id: prevMeta._id }, { useCache: true, ttl: CACHE_TTL_LONG }).catch(() => null);
  if (!prev?.candidates) return null;
  const votesOf = (c) => (prev.votes ? (prev.votes[String(c.user || c.userId)] ?? c.voteCount ?? 0) : (c.voteCount ?? 0));
  const prevWin = prev.candidates.find(c => c.isElected) || [...prev.candidates].sort((a, b) => votesOf(b) - votesOf(a))[0];
  const prevTotal = prev.votesCount || prev.candidates.reduce((s, c) => s + votesOf(c), 0);
  const lines = [];

  const delta = totalVotes - prevTotal;
  const deltaTxt = `${delta > 0 ? '+' : delta < 0 ? '−' : '±'}${_num(Math.abs(delta))}`;
  lines.push(['🗳', prT('pr_turnout', { n: _num(totalVotes), delta: deltaTxt, prev: _num(prevTotal) }), delta > 0 ? 'up' : delta < 0 ? 'down' : '']);

  if (prevWin && phase !== 'candidacy') {
    const incId = prevWin.user || prevWin.userId;
    const incUser = await localFetch('/user', { id: incId }, { useCache: true, ttl: CACHE_TTL_LONG }).catch(() => null);
    const name = incUser?.username || '—';
    const idx = candidates.findIndex(c => (c.user || c.userId) === incId);
    const done = phase === 'done';
    let key;
    if (idx < 0) key = 'pr_inc_absent';
    else if (idx === 0) key = done ? 'pr_inc_reelected' : 'pr_inc_ahead';
    else key = done ? 'pr_inc_defeated' : 'pr_inc_behind';
    lines.push(['👑', prT(key, { name, rank: idx + 1 }), key === 'pr_inc_reelected' || key === 'pr_inc_ahead' ? 'up' : key === 'pr_inc_absent' ? '' : 'down']);

    const nowParty = candidates[0]?.partyId || null;
    const prevParty = prevWin.party || prevWin.partyId || null;
    const pName = (pid) => (pid ? partyNamesMap.get(pid) || '—' : prT('pr_independent'));
    // Il partito solo a urne chiuse: durante il voto "passa a" sarebbe
    // una previsione detta come un fatto.
    if (done && candidates[0] && (nowParty || prevParty)) {
      lines.push(['🏛️', nowParty === prevParty
        ? prT('pr_party_kept', { party: pName(nowParty) })
        : prT('pr_party_change', { a: pName(prevParty), b: pName(nowParty) }), '']);
    }
  }

  return `<div class="wp-pr-compare-title">${escapeHtml(prT('pr_vs_prev', { d: _day(prev.votesEndAt || prevMeta.createdAt) }))}</div>
    <ul>${lines.map(([ico, txt, cls]) => `<li class="${cls}"><span>${ico}</span>${escapeHtml(txt)}</li>`).join('')}</ul>`;
}

/* ── PRESIDENTIAL TURNOUT CHART ── */
export function renderPresidentialTurnoutChart(currentElectionId = null) {
  const presidentialElections = electionHistory.filter(e => e.type === 'president').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (presidentialElections.length < 2) return;

  const canvas = document.getElementById('presidentTurnoutChart');
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const labels      = presidentialElections.map(e => new Date(e.createdAt).toLocaleDateString(prLocale(), { month: 'short', year: '2-digit' }));
  const data        = presidentialElections.map(e => e.votesCount || 0);
  const electionIds = presidentialElections.map(e => e._id);
  const pointRadii  = presidentialElections.map(e => (currentElectionId && e._id === currentElectionId) ? 8 : 4);
  const movingAvg   = data.map((v, i) => i === 0 ? v : Math.round((data[i - 1] + data[i]) / 2));
  const T = chartTheme();

  new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [
        { label: prT('pr_total_votes'), data, borderColor: '#e8c97a', backgroundColor: 'rgba(232,201,122,0.1)', borderWidth: 2, pointRadius: pointRadii, pointHoverRadius: pointRadii.map(r => r + 4), pointHitRadius: 15, pointBackgroundColor: '#e8c97a', tension: 0.3, fill: true },
        { label: prT('pr_avg'), data: movingAvg, borderColor: '#60a5fa', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 3], pointRadius: 0, pointHoverRadius: 3, tension: 0.3, fill: false },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      plugins: {
        legend: { display: false },
        tooltip: { ...T.tt, callbacks: { title: items => prT('pr_turnout_title', { d: items[0].label }), label: item => ` ${item.dataset.label}: ${item.parsed.y.toLocaleString(prLocale())}` } },
      },
      scales: {
        x: { ticks: { color: T.tick, font: { size: 11 } }, grid: { color: T.grid }, border: { color: T.border } },
        y: { beginAtZero: true, ticks: { color: T.tick, callback: v => v.toLocaleString() }, grid: { color: T.grid }, border: { color: T.border } },
      },
      onClick: (event, elements) => {
        if (elements.length > 0) {
          const eid = electionIds[elements[0].index];
          // BUG PREESISTENTE (vedi header del file): 'electionIdInput' non
          // esiste nel markup, questa riga lancia già nell'originale.
          if (eid) { document.getElementById('electionSelect').value = eid; document.getElementById('electionIdInput').value = eid; if (_loadElection) _loadElection(eid); }
        }
      },
    },
  });
}

/* ── PRESIDENTIAL SIMULATOR ── */
export function renderPresSimulator(candidates, totalVotes, election) {
  const wrapPanel = document.getElementById('presSimPanelWrap');
  if (!wrapPanel) return;

  const presHistoric = electionHistory.filter(e => e.type === 'president' && e.votesCount > 0).slice(-5);
  const avgPresVotes = presHistoric.length ? Math.round(presHistoric.reduce((s, e) => s + (e.votesCount || 0), 0) / presHistoric.length) : null;

  const input          = document.getElementById('presSimVoters');
  const expectedVoters = parseInt(input?.value) || avgPresVotes || totalVotes || 0;
  const toWin          = Math.floor(expectedVoters / 2) + 1;
  wrapPanel.open       = true;

  document.getElementById('presSimExpected').textContent  = expectedVoters.toLocaleString();
  document.getElementById('presSimToWin').textContent     = toWin.toLocaleString();
  document.getElementById('presSimAvgHist').textContent   = avgPresVotes ? avgPresVotes.toLocaleString() : '—';

  const histRef = document.getElementById('presSimHistRef');
  if (histRef) {
    histRef.innerHTML = presHistoric.map((e, i) => {
      const d    = new Date(e.createdAt).toLocaleDateString('en', { month: 'short', year: '2-digit' });
      const last = i === presHistoric.length - 1;
      return `<span class="sim-chip${last ? ' sim-chip-latest' : ''}">${d} · ${(e.votesCount || 0).toLocaleString()} v</span>`;
    }).join('');
  }

  const tbody = document.getElementById('presSimBody');
  if (tbody) {
    tbody.innerHTML = candidates.map(c => {
      const current  = c.votes;
      const stillNeed = Math.max(0, toWin - current);
      const pct      = totalVotes > 0 ? ((current / totalVotes) * 100).toFixed(1) : '—';
      const projPct  = expectedVoters > 0 ? ((current / expectedVoters) * 100).toFixed(1) : '—';
      const colorDot = `<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c.color};margin-right:6px;vertical-align:middle;"></span>`;
      const partyStr = c.partyInfo ? `<span style="color:var(--text3);font-size:.75em"> · ${c.partyInfo.name}</span>` : '';
      const stillNeedStr = c.isElected
        ? `<span style="color:#22c55e;font-weight:600">✓ ${escapeHtml(prT('pr_won'))}</span>`
        : stillNeed === 0
          ? `<span style="color:#22c55e">0</span>`
          : `<span style="color:#e8c97a">${stillNeed.toLocaleString()}</span>`;
      return `<tr>
        <td>${colorDot}${c.userData.username}${partyStr}</td>
        <td>${current.toLocaleString()}</td>
        <td>${pct}%</td>
        <td>${projPct}%</td>
        <td>${stillNeedStr}</td>
      </tr>`;
    }).join('');
  }
}

export function onPresSimInput() {
  if (lastPresData) renderPresSimulator(lastPresData.candidates, lastPresData.totalVotes, lastPresData.election);
}

/* ── HISTORIC WINNERS ── */
export async function renderPresidentialHistoricWinners(currentElectionId) {
  const panel = document.getElementById('presHistoricPanelWrap');
  if (!panel) return;

  const presidentialElections = electionHistory.filter(e => e.type === 'president').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (presidentialElections.length < 2) { panel.open = false; return; }
  panel.open = true;

  // WarEra+ 2026-11-08: elenco visivo (colore del partito, quota in barra,
  // secondo classificato) al posto della tabella, nel contenitore intero.
  const host = document.getElementById('presHistoricPanel');
  if (!host) return;
  host.innerHTML = `<div class="wp-ph-loading">…</div>`;

  // Fase 1: elezioni da mostrare (esclusa quella corrente), fetch dei dettagli tutti in parallelo (un unico batch)
  const targetElections = presidentialElections.slice(0, 8).filter(e => e._id !== currentElectionId);
  const electionDetails = await Promise.all(
    targetElections.map(e => localFetch('/election', { id: e._id }, { useCache: true, ttl: CACHE_TTL_LONG }).catch(() => null))
  );

  // Fase 2: per ogni elezione valida, individua vincitore/secondo e fetch degli user, tutti in parallelo
  const prepared = targetElections.map((e, i) => {
    const data = electionDetails[i];
    if (!data?.candidates) return null;
    const winner = data.candidates.find(c => c.isElected);
    if (!winner) return null;
    const runnerUp = data.candidates.filter(c => !c.isElected).sort((a, b) => {
      const av = data.votes ? (data.votes[String(a.user || a.userId)] ?? a.voteCount ?? 0) : (a.voteCount ?? 0);
      const bv = data.votes ? (data.votes[String(b.user || b.userId)] ?? b.voteCount ?? 0) : (b.voteCount ?? 0);
      return bv - av;
    })[0];
    return { e, data, winner, runnerUp };
  });

  const validPrepared = prepared.filter(Boolean);
  const [winnerUsers, runnerUpUsers] = await Promise.all([
    Promise.all(validPrepared.map(p => localFetch('/user', { id: p.winner.user || p.winner.userId }, { useCache: true, ttl: CACHE_TTL_LONG }).catch(() => null))),
    Promise.all(validPrepared.map(p => p.runnerUp
      ? localFetch('/user', { id: p.runnerUp.user || p.runnerUp.userId }, { useCache: true, ttl: CACHE_TTL_LONG }).catch(() => null)
      : Promise.resolve(null))),
  ]);

  const rows = validPrepared.map((p, i) => {
    const { e, data, winner } = p;
    const userData  = winnerUsers[i];
    const totalV    = data.votesCount || data.candidates.reduce((s, c) => s + (c.voteCount || 0), 0);
    const winVotes  = data.votes ? (data.votes[String(winner.user || winner.userId)] ?? winner.voteCount ?? 0) : (winner.voteCount ?? 0);
    const pct       = totalV > 0 ? ((winVotes / totalV) * 100).toFixed(1) : '—';
    const runnerUpName = runnerUpUsers[i]?.username || '—';
    const partyInfo = winner.party ? { name: partyNamesMap.get(winner.party) || '' } : null;
    return {
      date: new Date(e.votesEndAt || e.createdAt).toLocaleDateString(prLocale(), { day: 'numeric', month: 'short', year: 'numeric' }),
      username: userData?.username || '—', avatarUrl: userData?.avatarUrl || null, userId: winner.user || winner.userId,
      partyId: winner.party || winner.partyId || null, partyInfo, winVotes, pct, totalV, runnerUpName,
    };
  });

  if (!rows.length) { host.innerHTML = `<p class="wp-ph-empty">${escapeHtml(prT('ph_empty'))}</p>`; return; }
  // Il pannello nasce `display:none` nel modello e prima nessuno lo
  // scopriva: ora che si legge, si mostra quando c'è qualcosa da mostrare.
  panel.style.display = '';
  host.innerHTML = `<div class="wp-ph">${rows.map(r => {
    const color = r.partyId ? getPartyColor(r.partyId) : 'var(--bd3)';
    const av = r.avatarUrl
      ? `<img src="${escapeHtml(r.avatarUrl)}" class="wp-pr-av" alt="" loading="lazy">`
      : `<span class="wp-pr-av wp-pr-av-none">${escapeHtml(r.username[0] || '?')}</span>`;
    const party = r.partyId
      ? `<span class="wp-pr-party" style="--pc:${color}"><i></i>${escapeHtml(r.partyInfo?.name || partyNamesMap.get(r.partyId) || '—')}</span>`
      : `<span class="wp-pr-party wp-pr-party-none">${escapeHtml(prT('pr_independent'))}</span>`;
    return `<div class="wp-ph-row" style="--pc:${color}">
      <span class="wp-ph-date">${escapeHtml(r.date)}</span>
      ${av}
      <div class="wp-ph-main">
        <div class="wp-pr-row-head"><a class="wp-pr-row-name" href="${APP_BASE}/user/${escapeHtml(r.userId)}" target="_blank" rel="noopener">${escapeHtml(r.username)}</a>${party}</div>
        <div class="wp-pr-track"><i style="width:${r.pct === '—' ? 0 : r.pct}%"></i></div>
      </div>
      <div class="wp-pr-row-num"><b>${r.pct === '—' ? '—' : `${Number(r.pct).toLocaleString(prLocale(), { minimumFractionDigits: 1 })}%`}</b>
        <span>${escapeHtml(prT('pr_votes', { n: r.winVotes.toLocaleString(prLocale()) }))}</span>
        ${r.runnerUpName !== '—' ? `<span class="wp-ph-vs">${escapeHtml(prT('ph_vs', { name: r.runnerUpName }))}</span>` : ''}</div>
    </div>`;
  }).join('')}</div>`;
}
