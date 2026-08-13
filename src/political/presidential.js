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
  partyNamesMap, setPresidentChart,
} from './config.js';
import { localFetch } from './api.js';
import { startHeavyOperation, endHeavyOperation } from './loading.js';
import { showView, resetStats, fillStat, safeDestroy } from './ui.js';
import { getGovernmentWithDetails, renderGovernment } from './congress.js';

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

  /* STATUS BADGE */
  const now = new Date(), end = new Date(election.votesEndAt), start = new Date(election.votesStartAt);
  let statusText = '', statusClass = '';
  if (now < start)      { statusText = t('status_candidacy'); statusClass = 'pres-badge-pending'; }
  else if (now <= end)  { statusText = '🔴 In progress'; statusClass = 'pres-badge-live'; }
  else                  { statusText = '✅ Concluded';   statusClass = 'pres-badge-done'; }
  const sb = document.getElementById('pres-status-badge');
  sb.textContent = statusText; sb.className = 'badge-count ' + statusClass;

  /* COUNTDOWN */
  if (presCountdown) { clearInterval(presCountdown); presCountdown = null; }
  const countdownEl = document.getElementById('presCountdown');
  if (now <= end && now >= start) {
    const tick = () => {
      const remaining = new Date(election.votesEndAt) - new Date();
      if (remaining <= 0) { clearInterval(presCountdown); if (countdownEl) countdownEl.textContent = 'Voting ended'; return; }
      const h = Math.floor(remaining / 3600000);
      const m = Math.floor((remaining % 3600000) / 60000);
      const s = Math.floor((remaining % 60000) / 1000);
      if (countdownEl) countdownEl.textContent = `Closes in ${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    };
    tick();
    presCountdown = setInterval(tick, 1000);
  } else {
    if (countdownEl) countdownEl.textContent = '';
  }

  /* WINNER BANNER */
  const banner = document.getElementById('pres-winner-banner');
  if (winner && now > end) {
    const username = winner.userData?.username || 'Unknown';
    const av = winner.userData?.avatarUrl
      ? `<img src="${winner.userData.avatarUrl}" class="pres-winner-avatar" alt="">`
      : `<div class="pres-winner-avatar pres-winner-initials">${username[0]?.toUpperCase() || '?'}</div>`;
    banner.style.display = '';
    banner.innerHTML = `
      <div class="pres-winner-left">${av}<div>
        <div class="pres-winner-label">🏆 Presidente eletto</div>
        <div class="pres-winner-name">${username}</div>
      </div></div>
      <div class="pres-winner-votes">
        <div class="pres-winner-vcount">${winner.votes.toLocaleString()}</div>
        <div class="pres-winner-vsub">${t('col_votes').toLowerCase()} · ${totalVotes ? ((winner.votes / totalVotes) * 100).toFixed(1) + '%' : '—'}</div>
      </div>
    `;
    fillStat('stat-leader', username);
  } else {
    banner.style.display = 'none';
  }

  /* MARGIN */
  const marginEl = document.getElementById('presMargin');
  if (marginEl && now > end && candidates.length >= 2) {
    const marginVotes = candidates[0].votes - candidates[1].votes;
    const marginPct   = totalVotes ? ((marginVotes / totalVotes) * 100).toFixed(1) : null;
    marginEl.style.display = '';
    marginEl.innerHTML = `
      <span class="margin-label">Margin of victory</span>
      <span class="margin-val">${marginVotes.toLocaleString()} ${t('votes_suffix')}</span>
      <span class="margin-pct">${marginPct}%</span>
      <span class="margin-vs">over ${candidates[1].userData?.username || 'Unknown'}</span>
    `;
  } else if (marginEl) {
    marginEl.style.display = 'none';
  }

  /* RACE */
  document.getElementById('pres-race').innerHTML = candidates.map((c, i) => {
    const username = c.userData?.username || 'Unknown';
    const votes = c.votes || 0;
    const pct   = totalVotes ? ((votes / totalVotes) * 100).toFixed(1) : 0;
    const barW  = maxVotes   ? ((votes / maxVotes)   * 100).toFixed(1) : 0;
    const av    = c.userData?.avatarUrl
      ? `<img src="${c.userData.avatarUrl}" class="race-avatar" alt="">`
      : `<div class="race-avatar race-initials" style="background:${c.color}33;color:${c.color}">${username[0]?.toUpperCase() || '?'}</div>`;
    const partyChip = c.partyInfo ? `<span class="race-party-chip" style="background:${c.partyInfo.color}22;border-color:${c.partyInfo.color}55;color:${c.partyInfo.color}">${c.partyInfo.name}</span>` : '';
    const gapStr    = i > 0 && candidates[0].votes > 0 ? `<span class="race-gap">-${(candidates[0].votes - votes).toLocaleString()}</span>` : '';
    const barColor  = c.isElected ? 'linear-gradient(90deg,#c5964a,#e8c97a)' : c.color;
    const rankClass = i === 0 ? 'race-rank-badge first' : 'race-rank-badge';
    return `<div class="race-row${c.isElected ? ' race-winner' : ''}">
      <div class="${rankClass}">${i + 1}</div>${av}
      <div class="race-info">
        <div class="race-name">${username}${c.isElected ? ' <span class="race-win-chip">Elected</span>' : ''}${gapStr}${partyChip}</div>
        <div class="race-bar-wrap"><div class="race-bar" style="width:${barW}%;background:${barColor}"></div></div>
      </div>
      <div class="race-stats">
        <div class="race-votes">${votes.toLocaleString()}</div>
        <div class="race-pct">${pct}%</div>
      </div>
    </div>`;
  }).join('');

  /* COLLAPSE extra candidates */
  const threshold = 6;
  const raceDiv   = document.getElementById('pres-race');
  if (candidates.length > threshold) {
    raceDiv.querySelectorAll('.race-row').forEach((row, i) => {
      if (i >= threshold) { row.style.display = 'none'; row.classList.add('collapsed-candidate'); }
    });
    const btn = document.createElement('button');
    btn.className   = 'race-toggle-btn';
    btn.textContent = `Show more (${candidates.length})`;
    btn.addEventListener('click', () => {
      const hidden   = raceDiv.querySelectorAll('.collapsed-candidate');
      const areHidden = hidden[0]?.style.display === 'none';
      hidden.forEach(r => r.style.display = areHidden ? '' : 'none');
      btn.textContent = areHidden ? 'Show less' : `Show more (${candidates.length})`;
    });
    raceDiv.appendChild(btn);
  }

  /* CHART */
  safeDestroy('presidentChart');
  const T = chartTheme();
  setPresidentChart(new Chart(document.getElementById('presidentChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: candidates.map(c => c.userData?.username || 'Unknown'),
      datasets: [{ data: candidates.map(c => c.votes || 0), backgroundColor: candidates.map(c => c.color + 'cc'), borderColor: getTheme() === 'light' ? 'rgba(0,0,0,0.2)' : candidates.map(c => c.color), borderWidth: 1.5, borderRadius: 6, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { ...T.tt, callbacks: { title: i => candidates[i[0].dataIndex].userData?.username || 'Unknown', label: i => ` ${i.raw.toLocaleString()} ${t('col_votes').toLowerCase()} (${totalVotes ? ((i.raw / totalVotes) * 100).toFixed(1) + '%' : '—'})` } } },
      scales: { y: { beginAtZero: true, ticks: { color: T.tick }, grid: { color: T.grid } }, x: { ticks: { color: T.tick2 }, grid: { display: false } } },
    },
  }));

  /* META */
  document.getElementById('pres-meta').innerHTML = `
    <span>📅 Inizio: <strong>${new Date(election.votesStartAt).toLocaleDateString('it')}</strong></span>
    <span>⏱ Fine: <strong>${new Date(election.votesEndAt).toLocaleDateString('it')}</strong></span>
    <span>${t('votes_total_label', { n: totalVotes.toLocaleString() })}</span>
    <a href="${APP_BASE}/country/${election.country}/election/${election._id}" target="_blank" class="pres-meta-link">Vai all'elezione →</a>
  `;

  renderPresidentialTurnoutChart(election._id);
  renderPresidentialHistoricWinners(election._id);

  lastPresData = { candidates, totalVotes, election };
  renderPresSimulator(candidates, totalVotes, election);
  document.getElementById('badgeCount').textContent = t('badge_presidential', { n: totalVotes });

  if (isLatestPresidential) {
    const govData = await getGovernmentWithDetails(election.country || currentCountryId);
    renderGovernment(govData);
  } else {
    const panel = document.getElementById('presGovernmentPanel');
    if (panel) panel.open = false;
  }
  endHeavyOperation();
}

/* ── PRESIDENTIAL TURNOUT CHART ── */
export function renderPresidentialTurnoutChart(currentElectionId = null) {
  const presidentialElections = electionHistory.filter(e => e.type === 'president').sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  if (presidentialElections.length < 2) return;

  const canvas = document.getElementById('presidentTurnoutChart');
  if (!canvas) return;
  const existing = Chart.getChart(canvas);
  if (existing) existing.destroy();

  const labels      = presidentialElections.map(e => new Date(e.createdAt).toLocaleDateString('it', { month: 'short', year: '2-digit' }));
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
        { label: 'Total votes', data, borderColor: '#e8c97a', backgroundColor: 'rgba(232,201,122,0.1)', borderWidth: 2, pointRadius: pointRadii, pointHoverRadius: pointRadii.map(r => r + 4), pointHitRadius: 15, pointBackgroundColor: '#e8c97a', tension: 0.3, fill: true },
        { label: 'Moving average (2)', data: movingAvg, borderColor: '#60a5fa', backgroundColor: 'transparent', borderWidth: 2, borderDash: [6, 3], pointRadius: 0, pointHoverRadius: 3, tension: 0.3, fill: false },
      ]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: false, axis: 'x' },
      plugins: {
        legend: { display: false },
        tooltip: { ...T.tt, callbacks: { title: items => `Election ${items[0].label}`, label: item => ` ${item.dataset.label}: ${item.parsed.y.toLocaleString()} votes` } },
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
        ? `<span style="color:#22c55e;font-weight:600">✓ Won</span>`
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

  const tbody = document.getElementById('presHistoricBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text3);padding:8px;">Loading…</td></tr>';

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
    return { date: new Date(e.createdAt).toLocaleDateString('en', { month: 'short', year: 'numeric' }), username: userData?.username || '—', partyInfo, winVotes, pct, totalV, runnerUpName };
  });

  if (!rows.length) { panel.style.display = 'none'; return; }
  tbody.innerHTML = rows.map(r => `
    <tr>
      <td style="color:var(--text3)">${r.date}</td>
      <td style="font-weight:600">👤 ${r.username}</td>
      <td>${r.partyInfo?.name ? `<span style="color:var(--text2)">${r.partyInfo.name}</span>` : '—'}</td>
      <td>${r.winVotes.toLocaleString()} <span class="party-pct">(${r.pct}%)</span></td>
      <td style="color:var(--text3)">${r.runnerUpName}</td>
    </tr>`).join('');
}
