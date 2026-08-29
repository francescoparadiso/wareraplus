/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: congress.js come modulo ES (Fase 2, Stage 7)
   ------------------------------------------------------------------
   Conversione diretta. Punti non meccanici:

   - `loadElection` (main.js, Stage 8, non ancora esistente in questo
     stage) era un identificatore nudo risolto a runtime in più punti
     (loadElectionsHistory, il listener wareraplus:open-senate, l'onClick
     della timeline, il countdown, il refresh button). Iniettato via
     `setCongressDeps({ loadElection })`, stesso pattern di senate.js.
   - `Parliament`/`observeParliamentResize`: import statico diretto da
     parliament.js (Stage 6) e panels.js (creato più avanti in QUESTO
     stesso stage, quindi già presente quando si builda/testa) — a
     differenza di loadElection, questi non richiedono injection perché
     i moduli sorgente esistono già nel grafo di import.
   - `SenateView`: import statico da senate.js (Stage 6).
   - window._timelineChart (righe 141-144 dell'originale): mai popolato
     con un'istanza reale (solo assegnato a null), il vero stato era la
     variabile bare _timelineChart — ramo morto rimosso, il distruzione
     reale avviene già poco sopra via `safeDestroy('timelineChart')`.
   - window._lastAllParties/_simIsLive/_lastElectedCount: scritti E letti
     solo da questo file stesso (verificato via grep su tutto
     public/political/) più da config.js:toggleTheme (che li riceve già
     come parametri iniettati, Stage 2) — non serve config.js come hub
     condiviso qui, restano `export let` di QUESTO modulo (proprietario
     unico), scritti per riassegnazione diretta (nessun setter necessario,
     dato che nessun altro modulo li riassegna dall'esterno).
     _prevCongressPartyCount resta invece completamente privato (mai
     letto altrove).
   - typeof Parliament !== 'undefined' (mini preview del simulatore):
     rimosso, Parliament è sempre importato staticamente ora.
   ══════════════════════════════════════════════════════════════ */

import Chart from 'chart.js/auto';
import { t } from './i18n.js';
import {
  escapeHtml, makeAbbr, getPartyColor, chartTheme, getTheme, APP_BASE, CACHE_TTL_LONG,
  currentCountryId, currentCountryData,
  electionHistory, setElectionHistory,
  currentCongressElectionId, setCurrentCongressElectionId,
  latestPresidentialElectionId, setLatestPresidentialElectionId,
  timelineChart, setTimelineChart,
  timelineElectionIds, setTimelineElectionIds,
  setHistoricTurnouts,
  congressCountdownInterval, setCongressCountdownInterval,
  setSeatsChart, setMembersChart, setVotesChart, setAllPartiesChart,
  votesChart,
  partyNamesMap,
  setLastElectedParties,
} from './config.js';
import { localFetch } from './api.js';
import { startHeavyOperation, endHeavyOperation } from './loading.js';
import { showView, showSkeleton, hideSkeleton, resetStats, fillStat, setStatus, safeDestroy } from './ui.js';
import { render as parliamentRender } from './parliament.js';
import { observeParliamentResize } from './panels.js';
import { SenateView } from './senate.js';

// Dipendenze cross-modulo iniettate da main.js (Stage 8) — vedi header.
let _loadElection = null;
export function setCongressDeps({ loadElection } = {}) {
  if (loadElection) _loadElection = loadElection;
}

// Stato di proprietà esclusiva di questo modulo (era window._lastAllParties
// / window._simIsLive / window._lastElectedCount) — letto anche da
// config.js:toggleTheme, ma iniettato come parametro (Stage 2), non
// importato direttamente, per evitare un ciclo config.js <-> congress.js.
export let lastAllParties = null;
export let simIsLive = false;
export let lastElectedCount = null;
let _prevCongressPartyCount = null; // mai letto altrove, resta privato

/* ── COLOR HELPER: hex/rgb string → rgba() con alpha, per sfondi card ── */
export function hexToRgba(color, alpha = 1) {
  if (!color) return `rgba(150,150,150,${alpha})`;
  color = color.trim();
  if (color.startsWith('rgb')) {
    const nums = color.match(/[\d.]+/g);
    if (nums && nums.length >= 3) return `rgba(${nums[0]},${nums[1]},${nums[2]},${alpha})`;
    return `rgba(150,150,150,${alpha})`;
  }
  let hex = color.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (hex.length !== 6) return `rgba(150,150,150,${alpha})`;
  const r = parseInt(hex.slice(0, 2), 16);
  const g = parseInt(hex.slice(2, 4), 16);
  const b = parseInt(hex.slice(4, 6), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}

/* ── ELECTIONS HISTORY ── */
export async function loadElectionsHistory() {
  try {
    startHeavyOperation('Loading elections list...');
    const data = await localFetch('/elections', { countryId: currentCountryId });
    const items = (data?.items || []).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    setElectionHistory(items);

    const select = document.getElementById('electionSelect');
    while (select.options.length > 1) select.remove(1);
    [...items].reverse().forEach(e => {
      const opt = document.createElement('option');
      opt.value = e._id;
      const emoji = e.type === 'president' ? '👤' : '🏛️';
      const date = new Date(e.createdAt).toLocaleDateString('it');
      opt.textContent = `${emoji} ${e.type === 'president' ? 'Presidential' : 'Congress'} · ${date}`;
      select.appendChild(opt);
    });

    const congressElections = items.filter(e => e.type === 'congress');
    const presidentialElections = items.filter(e => e.type === 'president');
    setCurrentCongressElectionId(congressElections.length ? congressElections[congressElections.length - 1]._id : null);

    const sortedPres = [...presidentialElections].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    setLatestPresidentialElectionId(sortedPres[0]?._id || null);

      // Distruggi il vecchio grafico e pulisci la legenda
    if (timelineChart) {
      timelineChart.destroy();
      setTimelineChart(null);
    }
    const legendDiv = document.getElementById('timelineLegend');
    if (legendDiv) legendDiv.innerHTML = '';
    const filterSel = document.getElementById('timelinePartyFilter');
    if (filterSel) filterSel.innerHTML = `<option value="">${t('all_parties')}</option>`;
    // Forza la rimozione del canvas e ricreazione (opzionale ma sicuro)
    const canvas = document.getElementById('timelineChart');
    if (canvas) {
      const parent = canvas.parentNode;
      const newCanvas = document.createElement('canvas');
      newCanvas.id = 'timelineChart';
      newCanvas.setAttribute('role', 'img');
      newCanvas.setAttribute('aria-label', 'Seats trend over time');
      parent.replaceChild(newCanvas, canvas);
    }
    renderTimeline(timelineRange(congressElections));

    if (items.length > 0) {
      const latest = [...items].reverse()[0];
      select.value = latest._id;
      if (_loadElection) await _loadElection(latest._id);
    }
    endHeavyOperation();

    // WarEra+ hook (additivo, unica riga): segnala che electionHistory
    // è stato assegnato con i dati reali. Usato da src/app/politicalOverlay.js
    // (bottone "Vai alla Senate View" nel pannello nazione) per sapere
    // quando è sicuro chiamare SenateView.open() con dati veri, invece
    // di aprirla vuota. Nessun modulo originale ascolta questo evento,
    // zero effetto sul comportamento esistente.
    window.dispatchEvent(new CustomEvent('wareraplus:elections-ready'));
  }
  catch (err) {
    console.warn('Storico elezioni non disponibile:', err.message);
    window.dispatchEvent(new CustomEvent('wareraplus:elections-ready'));
  }
}

// WarEra+ hook (additivo): il pannello nazione (src/app/politicalOverlay.js)
// comunica con questo bridge event-based — mantenuto invariato in questo
// stage (mittente/destinatario restano nello stesso documento una volta
// eliminato l'iframe, Stage 9, ma la semplificazione a chiamata diretta è
// riservata al cutover per non introdurre due cambi contemporaneamente).
window.addEventListener('wareraplus:open-senate', () => {
  if (currentCongressElectionId) {
    if (_loadElection) _loadElection(currentCongressElectionId).then(() => SenateView.open());
    else SenateView.open();
  } else {
    SenateView.open(); // mostra lo stato vuoto già previsto dalla view
  }
});

export async function loadPartiesForCountry(countryId) {
  startHeavyOperation('Loading parties...');
  try {
    const limit = 100;
    let page = 1;
    let allParties = [];
    while (true) {
      const data  = await localFetch('/parties', { countryId, page, limit }, { useCache: true, ttl: CACHE_TTL_LONG });
      const items = data?.items || [];
      allParties.push(...items);
      if (items.length < limit || page > 20) break; // fine risultati o safety cap
      page++;
    }
    // Filtro di sicurezza: se l'API non filtrasse già per country lato server
    const parties = allParties.filter(p => !p.country || p.country === countryId);
    parties.forEach(p => {
      getPartyColor(p._id); // popola partyColorMap se assente (stringToColor interno a getPartyColor)
      partyNamesMap.set(p._id, p.name);
    });
    endHeavyOperation();
    return parties;
  } catch (err) {
    console.warn('Unable to load party list:', err.message);
    endHeavyOperation();
    return [];
  }
}

/* ── TIMELINE ── */

// WarEra+: erano gli ultimi 6 punti, per una ragione che non era una
// scelta grafica — `election.getElections` senza `limit` restituisce dieci
// elezioni in tutto (5 presidenziali + 5 congressuali), quindi di
// congressuali ne arrivavano cinque e il sesto punto non esisteva
// nemmeno. Ora lo storico è completo (vedi cacheClient.js e
// mergeElectionLists nel cache-server) e il grafico può coprire due anni
// di legislature; Chart.js dirada da solo le etichette sull'asse X quando
// non ci stanno.
const TIMELINE_MAX_POINTS = 24;

// I partiti nel gioco esistono da marzo 2026: prima di allora gli eletti
// erano tutti indipendenti, e il grafico — che disegna una linea per
// partito — su quelle elezioni non ha proprio niente da mostrare (erano
// otto punti piatti a zero prima del primo dato vero). Il taglio si fa sui
// dati, non sulla data: si parte dalla prima elezione con almeno un
// eletto in un partito. La data resta come rete di sicurezza, per quando
// la lista arriva senza `candidates` e la domanda non è rispondibile.
const PARTIES_SINCE = Date.parse('2026-03-01T00:00:00Z');

function timelineRange(congressElections) {
  const hasPartySeats = e => (e?.candidates || []).some(c => c.isElected && (c.party || c.partyId));
  const first = congressElections.findIndex(hasPartySeats);
  const partyEra = first >= 0
    ? congressElections.slice(first)
    : congressElections.filter(e => Date.parse(e.createdAt || 0) >= PARTIES_SINCE);
  return partyEra.slice(-TIMELINE_MAX_POINTS);
}

// WarEra+: ogni voce di `election.getElections` È già il dettaglio
// completo — verificato dal vivo, la voce di lista e la risposta di
// `election.getElection` per lo stesso id sono identiche byte per byte
// (candidates, votes, votesCount, votesStartAt/EndAt). Quando i candidati
// ci sono si usa quella e si risparmia una fetch per punto del grafico:
// con lo storico lungo sarebbero state una ventina di richieste al VPS
// solo per disegnare l'andamento. Se un domani la lista tornasse leggera,
// `candidates` manca e si ricade sul dettaglio esplicito, come prima.
async function electionWithDetail(election) {
  if (Array.isArray(election?.candidates) && election.candidates.length) return election;
  try { return await localFetch('/election', { id: election._id }); }
  catch (_) { return null; }
}

export function renderTimeline(congressElections) {
  const panel = document.getElementById('timelinePanel');
  if (!congressElections || congressElections.length === 0) {
    if (panel) panel.style.display = 'none';
    return;
  }
  if (panel) panel.style.display = '';

  safeDestroy('timelineChart');
  const labels = congressElections.map(e => new Date(e.createdAt).toLocaleDateString('it', { month: 'short', year: '2-digit' }));
  const electionIds = congressElections.map(e => e._id);
  const canvas = document.getElementById('timelineChart');
  if (!canvas) return;
  setTimelineElectionIds(electionIds);
  const T = chartTheme();

  setTimelineChart(new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: { labels, datasets: [] },
    options: {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: 'index', intersect: false },
      plugins: {
        legend: { display: false },
        tooltip: {
          ...T.tt,
          callbacks: {
            title: items => `Elezione ${items[0].label}`,
            label: item => item.dataset.label ? `${item.dataset.label}: ${item.parsed.y} seggi` : '',
          },
        },
      },
      scales: {
        x: { ticks: { color: T.tick, font: { size: 11 } }, grid: { color: T.grid }, border: { color: T.border } },
        y: { beginAtZero: true, ticks: { color: T.tick, stepSize: 1 }, grid: { color: T.grid }, border: { color: T.border } },
      },
      onClick: (evt, elements) => {
        if (!elements.length) return;
        const eid = electionIds[elements[0].index];
        if (eid) {
          document.getElementById('electionSelect').value = eid;
          if (_loadElection) _loadElection(eid);
        }
      },
    },
  }));
  loadTimelineData(congressElections, electionIds);
}

async function loadTimelineData(elections, electionIds) {
  startHeavyOperation('Loading timeline data...');
  // WarEra+: un solo passaggio. Prima erano due Promise.all separate sugli
  // stessi id (seggi, poi affluenza) che si appoggiavano alla cache locale
  // per non pagare due volte; con electionWithDetail il dato è già in
  // mano e le due derivazioni leggono lo stesso array.
  const details = await Promise.all(elections.map(e => electionWithDetail(e)));

  const partySeatsPerElection = details.map(data => {
    const seatMap = {};
    (data?.candidates || []).filter(c => c.isElected).forEach(c => {
      const pid = String(c.party || c.partyId || 'independent');
      seatMap[pid] = (seatMap[pid] || 0) + 1;
    });
    return seatMap;
  });

  const allPids = new Set();
  partySeatsPerElection.forEach(m => Object.keys(m).forEach(pid => allPids.add(pid)));

  const _pidsToFetch = [...allPids].filter(pid => pid !== 'independent' && !partyNamesMap.has(pid));
  await Promise.all(_pidsToFetch.map(async pid => {
    try {
      const partyData = await localFetch('/party', { id: pid });
      if (partyData?.name) partyNamesMap.set(pid, partyData.name);
    } catch (_) { }
  }));

  const _turnoutResults = details.map((data, i) => {
    if (!data) return null;
    const election = elections[i];
    const totalVotes = data.votesCount || (data.candidates || []).reduce((s, c) => s + (c.voteCount || 0), 0);
    return { electionId: election._id, totalVotes: totalVotes || 0, date: election.createdAt, seats: (data.candidates || []).filter(c => c.isElected).length };
  });
  setHistoricTurnouts(_turnoutResults.filter(Boolean));

  const datasets = [];
  const legendDiv = document.getElementById('timelineLegend');
  legendDiv.innerHTML = '';

  for (const pid of allPids) {
    if (pid === 'independent') continue;
    const color = getPartyColor(pid);
    const name = partyNamesMap.get(pid) || pid.slice(-6);
    const data = partySeatsPerElection.map(m => m[pid] || 0);
    if (data.every(v => v === 0)) continue;

    const pointRadii = electionIds.map(eid => (eid === currentCongressElectionId) ? 7 : 5);
    datasets.push({
      label: name, data, borderColor: color, backgroundColor: color + '18',
      borderWidth: 2.5, pointRadius: pointRadii, pointHoverRadius: pointRadii.map(r => r + 3),
      pointBackgroundColor: color, pointBorderColor: color + 'cc', pointBorderWidth: 1.5,
      tension: 0.35, fill: true,
    });

    if (data.length >= 2) {
      const movingAvg = data.map((v, i) => i === 0 ? v : Math.round((data[i - 1] + data[i]) / 2));
      datasets.push({
        label: '', data: movingAvg, borderColor: color, backgroundColor: 'transparent',
        borderWidth: 1.5, borderDash: [4, 3], pointRadius: 0, pointHoverRadius: 3, tension: 0.3, fill: false,
      });
    }

    const item = document.createElement('div');
    item.className = 'tl-leg-item';
    item.innerHTML = `<span class="tl-leg-dot" style="background:${color}"></span>${name}`;
    legendDiv.appendChild(item);
  }

  if (timelineChart && datasets.length) {
    timelineChart.data.datasets = datasets;
    timelineChart.update('active');
    endHeavyOperation();
    document.getElementById('timelineBadge').textContent = `${elections.length} elections`;

    // Populate the party filter dropdown
    const filterSelect = document.getElementById('timelinePartyFilter');
    if (filterSelect) {
      const currentVal = filterSelect.value;
      filterSelect.innerHTML = `<option value="">${t('all_parties')}</option>`;
      datasets.filter(d => d.label).forEach(d => {
        const opt = document.createElement('option');
        opt.value = d.label;
        opt.textContent = d.label;
        filterSelect.appendChild(opt);
      });
      filterSelect.value = currentVal || '';

      filterSelect.onchange = () => {
        const selected = filterSelect.value;
        if (!timelineChart) return;
        timelineChart.data.datasets.forEach(ds => {
          if (!ds.label) return; // skip moving-avg lines (no label)
          ds.hidden = selected ? ds.label !== selected : false;
        });
        // Also hide/show the corresponding moving-avg dataset (the one right after)
        timelineChart.data.datasets.forEach((ds, i) => {
          if (!ds.label && i > 0) {
            const prev = timelineChart.data.datasets[i - 1];
            if (prev?.label) ds.hidden = prev.hidden;
          }
        });
        timelineChart.update();
      };
    }
  }
}

function updateTimelineHighlight() {
  if (!timelineChart || !timelineElectionIds.length || !currentCongressElectionId) return;
  timelineChart.data.datasets.forEach(dataset => {
    if (!dataset.label) return;
    dataset.pointRadius = timelineElectionIds.map(eid => (eid === currentCongressElectionId) ? 7 : 4);
    dataset.pointHoverRadius = dataset.pointRadius.map(r => r + 2);
  });
  timelineChart.update('none');
}

/* ── GOVERNMENT ── */
async function loadCurrentGovernment(countryId) {
  try {
    const data = await localFetch('/government', { countryId });
    const gov = data?.result?.data?.json || data;
    if (!gov || !gov.president) return null;
    return gov;
  } catch (err) {
    console.warn('Errore nel caricamento del governo:', err);
    return null;
  }
}
export async function getGovernmentWithDetails(countryId) {
  const gov = await loadCurrentGovernment(countryId);
  if (!gov) return null;
  const roleKeys = ['president', 'vicePresident', 'minOfDefense', 'minOfEconomy', 'minOfForeignAffairs'];
  const userIds = roleKeys.map(k => gov[k]).filter(Boolean);
  if (!userIds.length) return gov;
  const users = await Promise.all(userIds.map(uid => localFetch('/user', { id: uid }).catch(() => null)));
  const userMap = {};
  userIds.forEach((uid, idx) => { if (users[idx]?.username) userMap[uid] = users[idx]; });
  roleKeys.forEach(key => { if (gov[key] && userMap[gov[key]]) gov[key + 'Data'] = userMap[gov[key]]; });
  return gov;
}
export function renderGovernment(gov) {
  const panel = document.getElementById('presGovernmentPanel');
  const grid = document.getElementById('governmentGrid');
  if (!gov || !gov.presidentData) { if (panel) panel.open = false; return; }
  panel.open = true;
  const roles = [
    { key: 'president', label: 'President', dataKey: 'presidentData' },
    { key: 'vicePresident', label: 'Vice President', dataKey: 'vicePresidentData' },
    { key: 'minOfDefense', label: 'Minister of Defense', dataKey: 'minOfDefenseData' },
    { key: 'minOfEconomy', label: 'Minister of Economy', dataKey: 'minOfEconomyData' },
    { key: 'minOfForeignAffairs', label: 'Minister of Foreign Affairs', dataKey: 'minOfForeignAffairsData' },
  ];
  grid.innerHTML = roles.map(role => {
    const userId = gov[role.key];
    const user = gov[role.dataKey];
    if (!userId || !user) return '';
    const avatarHtml = user.avatarUrl
      ? `<img src="${user.avatarUrl}" class="gov-avatar" alt="" loading="lazy">`
      : `<div class="gov-avatar" style="display:flex;align-items:center;justify-content:center;background:var(--s3);">👤</div>`;
    return `
      <div class="gov-card">
        ${avatarHtml}
        <div class="gov-info">
          <div class="gov-role">${role.label}</div>
          <div class="gov-name"><a href="${APP_BASE}/user/${userId}" target="_blank">${escapeHtml(user.username || userId)}</a></div>
        </div>
      </div>
    `;
  }).join('');
  document.getElementById('govBadge').textContent = `${roles.length} roles`;
}

/* ── PARTY TABLE ── */
export function renderPartyTable(electedParties, totalSeats) {
  const maxSeats = electedParties.length ? Math.max(...electedParties.map(p => p.seats)) : 1;
  const totalVotes = electedParties.reduce((s, p) => s + (p.votes || 0), 0);
  document.getElementById('partyTableBody').innerHTML = [...electedParties].sort((a, b) => b.seats - a.seats).map((p, rank) => {
    const pct  = totalSeats ? ((p.seats / totalSeats) * 100).toFixed(1) : 0;
    const votePct = totalVotes && p.votes ? ((p.votes / totalVotes) * 100).toFixed(1) : '—';
    const barW = maxSeats   ? (p.seats / maxSeats * 100).toFixed(1) : 0;
    const leaderAvatar = p.leaderAvatarUrl
      ? `<img src="${p.leaderAvatarUrl}" class="avatar-small" alt="">`
      : `<span class="avatar-placeholder">👤</span>`;
    const leaderEl = p.leaderId
      ? `<a href="${APP_BASE}/user/${p.leaderId}" target="_blank" class="leader-link">${leaderAvatar} ${p.leaderName || '—'}</a>`
      : `<span class="leader-chip">${leaderAvatar} ${p.leaderName || '—'}</span>`;
    const rankBadge = rank === 0 ? '🥇' : rank === 1 ? '🥈' : rank === 2 ? '🥉' : `${rank+1}.`;
    return `<tr>
      <td><div class="party-name-cell"><span style="color:var(--text3);font-size:.72rem;min-width:22px;">${rankBadge}</span><span class="party-color-bar" style="background:${p.color}"></span><div class="party-name-stack"><span class="party-name-main">${p.name}</span><span class="party-name-abbr">${p.abbr}</span></div></div></td>
      <td><div class="seats-bar-wrap"><div class="seats-bar"><div class="seats-bar-fill" style="width:${barW}%;background:${p.color}"></div></div><span class="seats-num">${p.seats}</span></div></td>
      <td>${p.members}</td>
      <td>${p.votes.toLocaleString()}</td>
      <td><span class="party-pct">${pct}%</span></td>
      <td><span class="party-pct" style="color:${p.color}">${votePct}%</span></td>
      <td>${leaderEl}</td>
    </tr>`;
  }).join('');
}

/* ── CONGRESS CHARTS ── */
export function renderCharts(electedParties) {
  safeDestroy('seatsChart');
  safeDestroy('membersChart');
  safeDestroy('votesChart');
  if (!electedParties.length) return;

  const totalSeats = electedParties.reduce((s, p) => s + p.seats, 0);
  const totalVotes = electedParties.reduce((s, p) => s + (p.votes || 0), 0);
  const colors = electedParties.map(p => p.color);
  const colorsA = colors.map(c => c + 'cc');
  const T = chartTheme();
  const isLight = getTheme() === 'light';
  const chartBorder = isLight ? 'rgba(0,0,0,0.2)' : 'rgba(255,255,255,0.12)';

  // Track which parties are hidden in seats chart
  let hiddenSeatsIndices = new Set();

  const seatsChartInstance = new Chart(document.getElementById('seatsChart').getContext('2d'), {
    type: 'doughnut',
    data: {
      labels: electedParties.map(p => p.name),
      datasets: [{ data: electedParties.map(p => p.seats), backgroundColor: colorsA, borderColor: chartBorder, borderWidth: 2, hoverBorderColor: colors, hoverBorderWidth: 3 }]
    },
    options: {
      responsive: true, maintainAspectRatio: false, cutout: '65%', rotation: -90, circumference: 180,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...T.tt,
          callbacks: {
            title: i => i[0].label,
            label: i => {
              const p = electedParties[i.dataIndex];
              const seatPct = totalSeats ? ((i.raw / totalSeats) * 100).toFixed(1) : 0;
              const votePct = totalVotes && p.votes ? ((p.votes / totalVotes) * 100).toFixed(1) : null;
              const lines = [`🏛 ${i.raw} seats (${seatPct}%)`];
              if (votePct) lines.push(`🗳 ${p.votes.toLocaleString()} votes (${votePct}%)`);
              if (p.members) lines.push(`👥 ${p.members} members`);
              if (p.leaderName) lines.push(`👑 ${p.leaderName}`);
              return lines;
            }
          }
        },
        centerText: { text: `${totalSeats}`, sub: 'seggi', fontSize: 20, color: T.tt.titleColor, subColor: T.tt.bodyColor },
      },
      onClick: (evt, el) => {
        if (!el.length) return;
        const idx = el[0].index;
        const meta = seatsChartInstance.getDatasetMeta(0);
        if (hiddenSeatsIndices.has(idx)) {
          hiddenSeatsIndices.delete(idx);
          meta.data[idx].hidden = false;
        } else {
          hiddenSeatsIndices.add(idx);
          meta.data[idx].hidden = true;
        }
        seatsChartInstance.update();
      },
    },
  });
  setSeatsChart(seatsChartInstance);

  setMembersChart(new Chart(document.getElementById('membersChart').getContext('2d'), {
    type: 'bar',
    data: {
      labels: electedParties.map(p => p.abbr),
      datasets: [{ data: electedParties.map(p => Number(p.members) || 0), backgroundColor: colorsA, borderColor: isLight ? 'rgba(0,0,0,0.25)' : colors, borderWidth: 1.5, borderRadius: 5, borderSkipped: false }]
    },
    options: {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...T.tt,
          callbacks: {
            title: i => electedParties[i[0].dataIndex].name,
            label: i => {
              const p = electedParties[i.dataIndex];
              const lines = [`👥 ${i.raw} members`];
              if (p.seats) lines.push(`🏛 ${p.seats} seats`);
              if (p.votes) lines.push(`🗳 ${p.votes.toLocaleString()} votes`);
              return lines;
            }
          }
        }
      },
      scales: {
        y: { beginAtZero: true, ticks: { color: T.tick }, grid: { color: T.grid }, border: { color: T.border } },
        x: { ticks: { color: T.tick, font: { size: 11 } }, grid: { display: false }, border: { color: T.border } },
      },
      onClick: (_, el) => { if (el.length) window.open(`${APP_BASE}/party/${electedParties[el[0].index].id}`, '_blank'); },
    },
  }));

  // ── NEW VOTES % BAR CHART ──
  const votesCanvas = document.getElementById('votesChart');
  if (votesCanvas && totalVotes > 0) {
    safeDestroy('votesChart');
    const sorted = [...electedParties].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    setVotesChart(new Chart(votesCanvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: sorted.map(p => p.abbr),
        datasets: [{
          label: 'Vote %',
          data: sorted.map(p => totalVotes ? +((p.votes / totalVotes) * 100).toFixed(2) : 0),
          backgroundColor: sorted.map(p => p.color + 'cc'),
          borderColor: sorted.map(p => p.color),
          borderWidth: 1.5, borderRadius: 5, borderSkipped: false
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...T.tt,
            callbacks: {
              title: i => sorted[i[0].dataIndex].name,
              label: i => {
                const p = sorted[i.dataIndex];
                return [`🗳 ${i.raw}% of votes`, `   ${(p.votes || 0).toLocaleString()} total votes`];
              }
            }
          }
        },
        scales: {
          y: { beginAtZero: true, ticks: { color: T.tick, callback: v => v + '%' }, grid: { color: T.grid }, border: { color: T.border } },
          x: { ticks: { color: T.tick, font: { size: 11 } }, grid: { display: false }, border: { color: T.border } },
        },
        onClick: (_, el) => { if (el.length) window.open(`${APP_BASE}/party/${sorted[el[0].index].id}`, '_blank'); },
      },
    }));
  }
}

export function renderAllPartiesChart(allParties) {
  safeDestroy('allPartiesChart');
  if (!allParties.length) return;

  const canvas = document.getElementById('allPartiesChart');
  const sk = canvas?.previousElementSibling;
  if (sk && sk.classList.contains('sk-chart-block')) sk.style.display = 'none';
  if (canvas) canvas.style.display = '';

  const sorted = [...allParties].sort((a, b) => b.members - a.members);
  const wrap = document.getElementById('allPartiesChartWrap');
  if (wrap) wrap.style.height = Math.max(260, sorted.length * 32) + 'px';

  const L = getTheme() === 'light';
  const { tt, tick, grid, border: gb } = chartTheme();

  const bg = sorted.map(p => p.seats > 0 ? p.color + (L ? 'ee' : 'ff') : p.color + (L ? '33' : '1a'));
  const brd = sorted.map(p => p.seats > 0 ? (L ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.7)') : (L ? 'rgba(0,0,0,0.1)' : 'rgba(255,255,255,0.1)'));

  setAllPartiesChart(new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: sorted.map(p => p.name),
      datasets: [{ data: sorted.map(p => Number(p.members) || 0), backgroundColor: bg, borderColor: brd, borderWidth: 1.5, borderRadius: 4, borderSkipped: false }]
    },
    options: {
      indexAxis: 'y', responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          ...tt, callbacks: {
            title: i => sorted[i[0].dataIndex].name,
            label: i => {
              const p = sorted[i.dataIndex];
              const lines = [`👥 ${i.raw} members`];
              if (p.seats > 0) lines.push(`🏛 ${p.seats} seats`);
              if (p.votes > 0) {
                const allVotes = sorted.reduce((s, x) => s + (x.votes || 0), 0);
                const votePct = allVotes > 0 ? ((p.votes / allVotes) * 100).toFixed(1) : null;
                lines.push(`🗳 ${p.votes.toLocaleString()} votes${votePct ? ` (${votePct}%)` : ''}`);
              }
              return lines;
            },
          }
        },
      },
      scales: {
        x: { beginAtZero: true, ticks: { color: tick, font: { size: 11 } }, grid: { color: grid }, border: { color: gb } },
        y: {
          ticks: {
            color: ctx => { const p = sorted[ctx.index]; return p?.seats > 0 ? (L ? '#000' : '#fff') : tick; },
            font: ctx => ({ weight: sorted[ctx.index]?.seats > 0 ? 'bold' : 'normal', size: 11 }),
          },
          grid: { display: false }, border: { color: gb },
        },
      },
      onClick: (_, el) => { if (el.length) window.open(APP_BASE + '/party/' + sorted[el[0].index].id, '_blank'); },
    },
  }));
  document.getElementById('badgeAllParties').textContent = allParties.length + ' partiti';
}

/* ── CONGRESS ELECTION ── */
export async function loadCongressElection(election) {
  startHeavyOperation('Loading congress election...');
  document.getElementById('timelinePanel').style.display = '';
  showView('congress');
    // Nascondi i pannelli standard che verranno mostrati solo per risultati finali
  document.getElementById('congressMainGrid').style.display = 'none';
  document.getElementById('congressChartsRow').style.display = 'none';
  document.getElementById('allPartiesRow').style.display = 'none';
  document.getElementById('simulatorPanel').style.display = 'none';
  document.getElementById('candidatesContainer').style.display = 'none';

  // Ripristina visibilità delle statistiche (per il caso risultati finali)
  document.getElementById('stat-seats').parentElement.style.display = '';
  document.getElementById('stat-parties').parentElement.style.display = '';
  document.getElementById('stat-majority').parentElement.style.display = '';
  document.getElementById('stat-leader').parentElement.style.display = '';
  document.getElementById('stat-enp').parentElement.style.display = '';
  setCurrentCongressElectionId(election._id);
  document.getElementById('fullscreenBtn').style.display = 'inline-flex';
  document.getElementById('exportCsvBtn').style.display = 'inline-flex';

  const now = new Date();
  const start = election.votesStartAt ? new Date(election.votesStartAt) : null;
  const end = election.votesEndAt ? new Date(election.votesEndAt) : null;
  let isOngoing = false;
  const statusBadge = document.getElementById('congressStatusBadge');
  const countdownEl = document.getElementById('congressCountdown');

  if (!start || !end) {
    if (statusBadge) statusBadge.style.display = 'none';
    if (countdownEl) countdownEl.style.display = 'none';
  } else {
    let statusText = '', statusClass = '';
    if (now < start) { statusText = t('status_candidacy'); statusClass = 'pres-badge-pending'; }
    else if (now <= end) { statusText = '🔴 In corso'; statusClass = 'pres-badge-live'; isOngoing = true; }
    else { statusText = '✅ Closed'; statusClass = 'pres-badge-done'; }

    if (statusBadge) {
      statusBadge.textContent = statusText;
      statusBadge.className = 'badge-status ' + statusClass;
      statusBadge.style.display = 'inline-flex';
    }

    if (countdownEl) {
      if (isOngoing) {
        countdownEl.style.display = 'block';
        if (congressCountdownInterval) clearInterval(congressCountdownInterval);
        const tick = () => {
          const remaining = new Date(election.votesEndAt) - new Date();
          if (remaining <= 0) { clearInterval(congressCountdownInterval); countdownEl.textContent = 'Voting ended'; if (_loadElection) _loadElection(election._id); return; }
          const h = Math.floor(remaining / 3600000);
          const m = Math.floor((remaining % 3600000) / 60000);
          const s = Math.floor((remaining % 60000) / 1000);
          countdownEl.textContent = `Closes in ${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
        };
        tick();
        setCongressCountdownInterval(setInterval(tick, 1000));
      } else {
        countdownEl.style.display = 'none';
        if (congressCountdownInterval) clearInterval(congressCountdownInterval);
      }
    }
  }

  const refreshBtn = document.getElementById('refreshCongressBtn');
  if (refreshBtn) refreshBtn.onclick = () => { if (election._id && _loadElection) _loadElection(election._id); };

  showSkeleton();
  resetStats();

  const totalVotes = election.votesCount || election.candidates.reduce((s, c) => s + (c.voteCount || 0), 0);
  fillStat('stat-totalvotes', totalVotes ? totalVotes.toLocaleString() : '—');

  const elected = election.candidates.filter(c => c.isElected);

  /* ONGOING — no results yet */
  if (isOngoing && elected.length === 0) {
    // Nascondi pannelli standard
    document.getElementById('congressMainGrid').style.display = 'none';
    document.getElementById('congressChartsRow').style.display = 'none';
    document.getElementById('allPartiesRow').style.display = 'none';
    document.getElementById('fullscreenBtn').style.display = 'none';
    document.getElementById('exportCsvBtn').style.display = 'none';
    hideSkeleton();

    // Mostra container candidati
    const candidatesContainer = document.getElementById('candidatesContainer');
    candidatesContainer.style.display = 'block';
    document.getElementById('candidatesPhaseTitle').textContent = 'Candidates (Voting in Progress)';

    // Carica candidati con voti correnti
    const candidatePromises = election.candidates.map(async c => {
      const user = await localFetch('/user', { id: c.user || c.userId }).catch(() => null);
      const partyId = c.party || c.partyId;
      const party = partyId ? await localFetch('/party', { id: partyId }).catch(() => null) : null;
      const articleData = c.article ? await localFetch('/article', { id: c.article }).catch(() => null) : null;
      const safePartyId = partyId || 'independent';
      let votes = c.voteCount || 0;
      if (election.votes && election.votes[String(c.user || c.userId)]) votes = election.votes[String(c.user || c.userId)];
      const level = user?.level ?? user?.lvl ?? user?.leveling?.level ?? null;
      return { ...c, user, partyName: party?.name || 'Independent', partyAvatarUrl: party?.avatarUrl || null, partyColor: getPartyColor(safePartyId), level, votes, articleData };
    });
    const candidates = await Promise.all(candidatePromises);
    candidates.sort((a,b) => b.votes - a.votes);
    document.getElementById('candidatesCount').textContent = candidates.length;

    const totalVotesLive = election.votesCount || 0;
    const candidatesTotalVotes = candidates.reduce((s,c) => s + c.votes, 0);
    const maxVotes = candidates[0]?.votes || 1;

    const html = candidates.map((c, idx) => {
      const pct = candidatesTotalVotes ? ((c.votes / candidatesTotalVotes) * 100).toFixed(1) : 0;
      const barWidth = (c.votes / maxVotes) * 100;
      const isLeading = idx === 0 && c.votes > 0;
      const partyLogoHtml = c.partyAvatarUrl
        ? `<img src="${c.partyAvatarUrl}" class="candidate-card-party-logo" alt="" onerror="this.style.display='none'">`
        : '';
      return `
        <div class="candidate-card${isLeading ? ' candidate-card-leading' : ''}" style="background:${hexToRgba(c.partyColor, 0.14)}; border-color:${hexToRgba(c.partyColor, 0.35)};">
          <div class="candidate-card-rank">#${idx + 1}</div>
          <img src="${c.user?.avatarUrl || ''}" class="candidate-card-avatar" onerror="this.src=''">
          <div class="candidate-card-info">
            <div class="candidate-card-name">${escapeHtml(c.user?.username || 'Unknown')}${c.level != null ? ` <span class="candidate-card-level">⭐${c.level}</span>` : ''}</div>
            <div class="candidate-card-party">${partyLogoHtml}<span>${escapeHtml(c.partyName)}</span></div>
            <div class="candidate-card-votes">
              🗳️ <span class="votes-count">${c.votes.toLocaleString()}</span> votes (${pct}%)
              <div style="height:4px; background:var(--s3); border-radius:2px; margin-top:4px;">
                <div style="width:${barWidth}%; height:100%; background:${c.partyColor}; border-radius:2px;"></div>
              </div>
              ${c.article ? `<div class="candidate-card-article">📰 <a href="${APP_BASE}/article/${c.article}" target="_blank" rel="noopener">${escapeHtml(c.articleData?.title || 'Read candidacy article')}</a></div>` : ''}
            </div>
          </div>
        </div>
      `;
    }).join('');
    document.getElementById('candidatesList').innerHTML = html || '<p>No candidates yet.</p>';

    // Mostra solo il totale voti nelle statistiche
    fillStat('stat-totalvotes', totalVotesLive.toLocaleString());
    document.getElementById('stat-seats').parentElement.style.display = 'none';
    document.getElementById('stat-parties').parentElement.style.display = 'none';
    document.getElementById('stat-majority').parentElement.style.display = 'none';
    document.getElementById('stat-leader').parentElement.style.display = 'none';
    document.getElementById('stat-enp').parentElement.style.display = 'none';

    setStatus(`Voting in progress · ${t('votes_so_far', { n: totalVotesLive.toLocaleString() })}`, 'loading');
    document.getElementById('badgeCount').textContent = `Voting · ${candidates.length} candidates`;

    /* ── LIVE SIMULATOR — proietta i seggi con i voti parziali già arrivati ── */
    await renderLiveSimulator(election, candidates, totalVotesLive);

    endHeavyOperation();
    return;
  }

  /* DETERMINE PHASE */
  const isCandidacy = start && now < start;
  const isClosed = end && now > end;

  if (isCandidacy) {
    // Nascondi tutti i pannelli standard
    document.getElementById('congressMainGrid').style.display = 'none';
    document.getElementById('congressChartsRow').style.display = 'none';
    document.getElementById('allPartiesRow').style.display = 'none';
    document.getElementById('simulatorPanel').style.display = 'none';
    document.getElementById('fullscreenBtn').style.display = 'none';
    document.getElementById('exportCsvBtn').style.display = 'none';
    hideSkeleton();

    // Mostra container candidati
    const candidatesContainer = document.getElementById('candidatesContainer');
    candidatesContainer.style.display = 'block';
    document.getElementById('candidatesPhaseTitle').textContent = 'Candidates (Candidacy Phase)';

    // Carica i dettagli dei candidati
    const candidatePromises = election.candidates.map(async c => {
      const user = await localFetch('/user', { id: c.user || c.userId }).catch(() => null);
      const partyId = c.party || c.partyId;
      const party = partyId ? await localFetch('/party', { id: partyId }).catch(() => null) : null;
      const articleData = c.article ? await localFetch('/article', { id: c.article }).catch(() => null) : null;
      const safePartyId = partyId || 'independent';
      return { ...c, user, partyName: party?.name || 'Independent', partyColor: getPartyColor(safePartyId), articleData };
    });
    const candidates = await Promise.all(candidatePromises);
    document.getElementById('candidatesCount').textContent = candidates.length;

    const html = candidates.map(c => `
      <div class="candidate-card">
        <img src="${c.user?.avatarUrl || ''}" class="candidate-card-avatar" onerror="this.src=''">
        <div class="candidate-card-info">
          <div class="candidate-card-name">${escapeHtml(c.user?.username || 'Unknown')}</div>
          <div class="candidate-card-party">${c.partyName}</div>
          <div class="candidate-card-votes">📋 Registered as candidate</div>
          ${c.article ? `<div class="candidate-card-article">📰 <a href="${APP_BASE}/article/${c.article}" target="_blank" rel="noopener">${escapeHtml(c.articleData?.title || 'Read candidacy article')}</a></div>` : ''}
        </div>
      </div>
    `).join('');
    document.getElementById('candidatesList').innerHTML = html || '<p>No candidates yet.</p>';

    // Nascondi le statistiche non necessarie (solo total votes?)
    fillStat('stat-totalvotes', '—');
    document.getElementById('stat-seats').parentElement.style.display = 'none';
    document.getElementById('stat-parties').parentElement.style.display = 'none';
    document.getElementById('stat-majority').parentElement.style.display = 'none';
    document.getElementById('stat-leader').parentElement.style.display = 'none';
    document.getElementById('stat-enp').parentElement.style.display = 'none';

    setStatus('Candidacy phase – no votes yet', 'loading');
    document.getElementById('badgeCount').textContent = `Candidacy · ${candidates.length} candidates`;
    endHeavyOperation();
    return;
  }

  // Ripristina i pannelli per i risultati finali (sia con eletti che senza)
  document.getElementById('congressMainGrid').style.display = '';
  document.getElementById('congressChartsRow').style.display = '';
  document.getElementById('allPartiesRow').style.display = '';
  document.getElementById('simulatorPanel').style.display = '';
  document.getElementById('candidatesContainer').style.display = 'none';

  // Ripristina la visibilità di tutte le statistiche (nascoste durante candidacy/voting)
  document.getElementById('stat-seats').parentElement.style.display = '';
  document.getElementById('stat-parties').parentElement.style.display = '';
  document.getElementById('stat-majority').parentElement.style.display = '';
  document.getElementById('stat-leader').parentElement.style.display = '';
  document.getElementById('stat-enp').parentElement.style.display = '';

  // Se non ci sono eletti (caso anomalo), mostra messaggio ed esci
  if (!elected.length) {
    document.getElementById('partyTableBody').innerHTML = '<tr><td colspan="6">No elected candidates available for this election.</td></tr>';
    hideSkeleton();
    setStatus('Election closed but no results', 'error');
    endHeavyOperation(); // bilancia startHeavyOperation
    return;
  }

  document.getElementById('fullscreenBtn').style.display = 'inline-flex';
  document.getElementById('exportCsvBtn').style.display = 'inline-flex';

  const partySeatsMap = {}, partyUsersMap = {};
  const candidateVotesMap = {};
  elected.forEach(c => {
    const pid = String(c.party || c.partyId || 'independent');
    partySeatsMap[pid] = (partySeatsMap[pid] || 0) + 1;
    const uid = String(c.userId || c.user || '');
    (partyUsersMap[pid] = partyUsersMap[pid] || []).push(uid);
    let votes = c.voteCount || 0;
    if (election.votes && election.votes[uid] != null) votes = election.votes[uid];
    candidateVotesMap[uid] = votes;
  });

  const allPartiesData = await loadPartiesForCountry(election.country || currentCountryId);
  const allPartyDetailsMap = {};
  allPartiesData.forEach(p => { allPartyDetailsMap[p._id] = p; });

  const partyVotesMap = {};
  election.candidates.forEach(c => {
    const pid = String(c.party || c.partyId || 'independent');
    const votes = election.votes ? (election.votes[String(c.userId || c.user)] || c.voteCount || 0) : (c.voteCount || 0);
    partyVotesMap[pid] = (partyVotesMap[pid] || 0) + votes;
  });

  const allUserIds = new Set();
  elected.forEach(c => { if (c.userId || c.user) allUserIds.add(String(c.userId || c.user)); });
  Object.values(allPartyDetailsMap).forEach(pd => { if (pd?.leader) allUserIds.add(String(pd.leader)); });

  const userMap = {};
  const _userIdsArr = [...allUserIds];
  const _userResults = await Promise.all(_userIdsArr.map(uid => localFetch('/user', { id: uid }).catch(() => ({}))));
  _userIdsArr.forEach((uid, i) => { userMap[uid] = _userResults[i]; });

  const electedParties = Object.keys(partySeatsMap).map(pid => {
    if (!pid) return { id: 'unknown', name: 'Unknown', abbr: 'N/A', seats: 0, members: 0, votes: 0, leaderName: null, leaderAvatarUrl: null, leaderId: null, color: '#6b7280', users: [] };
    const color = getPartyColor(pid);
    if (pid === 'independent') return { id: pid, name: 'Independent', abbr: 'IND', seats: partySeatsMap[pid], members: 0, votes: partyVotesMap[pid] || 0, leaderName: null, leaderAvatarUrl: null, leaderId: null, color, users: (partyUsersMap[pid] || []).map(uid => ({ userId: uid, ...userMap[uid], votes: candidateVotesMap[uid] || 0 })) };
    const pd = allPartyDetailsMap[pid] || {};
    const name = pd.name || partyNamesMap.get(pid) || `Party ${pid.slice(-6)}`;
    const leaderId = pd.leader ? String(pd.leader) : null;
    const leaderData = leaderId ? userMap[leaderId] : null;
    const rawMembers = Array.isArray(pd.members) ? pd.members.length : Number(pd.membersCount || pd.memberCount || 0);
    return { id: pid, name, abbr: makeAbbr(name), seats: partySeatsMap[pid], members: rawMembers, votes: partyVotesMap[pid] || 0, leaderName: leaderData?.username || null, leaderAvatarUrl: leaderData?.avatarUrl || null, leaderId, color, users: (partyUsersMap[pid] || []).map(uid => ({ userId: uid, ...userMap[uid], votes: candidateVotesMap[uid] || 0 })) };
  }).sort((a, b) => b.seats - a.seats);

  const allParties = Object.keys(allPartyDetailsMap).map(pid => {
    const pd = allPartyDetailsMap[pid] || {};
    const name = pd.name || partyNamesMap.get(pid) || `Party ${pid.slice(-6)}`;
    const rawMembers = Array.isArray(pd.members) ? pd.members.length : Number(pd.membersCount || pd.memberCount || 0);
    return { id: pid, name, abbr: makeAbbr(name), seats: partySeatsMap[pid] || 0, members: rawMembers, votes: partyVotesMap[pid] || 0, color: getPartyColor(pid) };
  }).sort((a, b) => b.seats - a.seats || b.members - a.members);

  if (allParties.length > 0) { document.getElementById('allPartiesRow').style.display = ''; renderAllPartiesChart(allParties); }
  else { document.getElementById('allPartiesRow').style.display = 'none'; }

  const totalSeats = electedParties.reduce((s, p) => s + p.seats, 0);
  const majority = Math.floor(totalSeats / 2) + 1;

  fillStat('stat-seats', totalSeats);
  fillStat('stat-parties', electedParties.length);
  fillStat('stat-majority', majority);
  fillStat('stat-leader', electedParties[0]?.name || '—');

  /* ── STAT TRENDS vs previous congress election ── */
  _fillStatTrends(totalSeats, electedParties.length, totalVotes);

  const enp = (() => {
    const sumSq = electedParties.reduce((s, p) => s + (p.seats / totalSeats) ** 2, 0);
    return sumSq > 0 ? (1 / sumSq).toFixed(2) : '—';
  })();
  fillStat('stat-enp', enp);
  const enpEl = document.getElementById('stat-enp-label');
  if (enpEl) {
    const v = parseFloat(enp);
    enpEl.textContent = v <= 2.5 ? 'Bipolar' : v <= 4 ? 'Multyparty' : 'Fragmented';
    enpEl.style.color = v <= 2.5 ? '#22c55e' : v <= 4 ? '#eab308' : '#ef4444';
  }

  await new Promise(resolve => requestAnimationFrame(resolve));
  hideSkeleton();

  parliamentRender({
    container: document.getElementById('parliamentContainer'),
    legendContainer: document.getElementById('legendContainer'),
    parties: electedParties,
    tooltip: document.getElementById('tooltip'),
  });
  observeParliamentResize();
  renderPartyTable(electedParties, totalSeats);
  renderCharts(electedParties);
  updateTimelineHighlight();

  const badge = `${electedParties.length} parties · ${totalSeats} seats`;
  setStatus(badge, '');
  document.getElementById('badgeCount').textContent = badge;
  setLastElectedParties(electedParties);
  lastAllParties = allParties;
  simIsLive = false;
  lastElectedCount = election.electedCount;
  electedParties.forEach(p => partyNamesMap.set(p.id, p.name));

  const inputEl = document.getElementById('simExpectedVotersInput');
  if (inputEl) inputEl.value = totalVotes || '';
  renderSimulator(allParties, totalSeats, { electedCount: election.electedCount });

  const panel = document.getElementById('presGovernmentPanel');
  if (panel) panel.open = false;
}

/* ── LIVE SIMULATOR (voting in progress) ──
   Aggrega i voti parziali per partito e proietta i seggi già durante lo
   svolgimento del voto, prima che l'elezione si chiuda. */
async function renderLiveSimulator(election, candidates, totalVotesSoFar) {
  const panel = document.getElementById('simulatorPanel');
  if (!panel) return;

  // Voti live per partito, a partire dai candidati già caricati
  const partyVotesLive = {};
  candidates.forEach(c => {
    const pid = String(c.party || c.partyId || 'independent');
    partyVotesLive[pid] = (partyVotesLive[pid] || 0) + (c.votes || 0);
  });

  // Dettagli partiti (nome, membri) del paese corrente
  let allPartiesData = [];
  try { allPartiesData = await loadPartiesForCountry(election.country || currentCountryId); } catch (_) {}
  const allPartyDetailsMap = {};
  allPartiesData.forEach(p => { allPartyDetailsMap[p._id] = p; });

  // Seggi dell'elezione congressuale precedente, usati come riferimento "now" per il delta
  const prevCongress = [...electionHistory]
    .filter(e => e.type === 'congress' && e._id !== election._id)
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
  let prevSeatsMap = {}, prevVotesMap = {}, prevTotalSeats = 0;
  if (prevCongress) {
    try {
      const prevData = await localFetch('/election', { id: prevCongress._id });
      (prevData.candidates || []).filter(c => c.isElected).forEach(c => {
        const pid = String(c.party || c.partyId || 'independent');
        prevSeatsMap[pid] = (prevSeatsMap[pid] || 0) + 1;
        prevTotalSeats++;
      });
      // Voti totali per partito nell'elezione congressuale precedente (tutti i
      // candidati, non solo gli eletti) — usati come base della proiezione
      // quando l'elezione in corso non ha ancora voti propri.
      (prevData.candidates || []).forEach(c => {
        const pid = String(c.party || c.partyId || 'independent');
        let v = c.voteCount || 0;
        if (prevData.votes && prevData.votes[String(c.user || c.userId)]) v = prevData.votes[String(c.user || c.userId)];
        prevVotesMap[pid] = (prevVotesMap[pid] || 0) + v;
      });
    } catch (_) {}
  }

  // Se il voto in corso non ha ancora accumulato voti propri, usiamo come base
  // della proiezione i voti dell'ultima elezione congressuale (% voti presi),
  // invece di far ricadere il simulatore sulla % di membri del partito.
  const totalLiveVotes = Object.values(partyVotesLive).reduce((a, b) => a + b, 0);
  const usingPrevVotes = totalLiveVotes === 0 && Object.keys(prevVotesMap).length > 0;

  // Costruisci l'elenco partiti nello stesso formato usato da renderSimulator()
  const pidsWithVotes = new Set(Object.keys(partyVotesLive));
  const allPids = new Set([...Object.keys(allPartyDetailsMap), ...pidsWithVotes, ...Object.keys(prevSeatsMap), ...Object.keys(prevVotesMap)]);

  const liveParties = [...allPids].map(pid => {
    const votes = partyVotesLive[pid] || (usingPrevVotes ? (prevVotesMap[pid] || 0) : 0);
    if (pid === 'independent') {
      return { id: pid, name: 'Independent', abbr: 'IND', seats: prevSeatsMap[pid] || 0, members: 0, votes, color: getPartyColor(pid) };
    }
    const pd = allPartyDetailsMap[pid] || {};
    const name = pd.name || partyNamesMap.get(pid) || `Party ${pid.slice(-6)}`;
    const rawMembers = Array.isArray(pd.members) ? pd.members.length : Number(pd.membersCount || pd.memberCount || 0);
    return { id: pid, name, abbr: makeAbbr(name), seats: prevSeatsMap[pid] || 0, members: rawMembers, votes, color: getPartyColor(pid) };
  }).sort((a, b) => (b.votes || 0) - (a.votes || 0));

  lastAllParties = liveParties;
  simIsLive = true;
  lastElectedCount = election.electedCount;

  panel.style.display = '';
  // Pre-compila il numero di votanti attesi con i voti già arrivati, così la
  // proiezione compare subito, senza bisogno di un input manuale.
  const inputEl = document.getElementById('simExpectedVotersInput');
  if (inputEl && !inputEl.value) inputEl.value = totalVotesSoFar || '';

  renderSimulator(liveParties, prevTotalSeats, { isLive: true, liveVotes: totalVotesSoFar, electedCount: election.electedCount, usingPrevVotes });
}

/* ── CONGRESS SIMULATOR ── */
export function renderSimulator(allParties, totalSeatsCurrent, opts = {}) {
  const panel = document.getElementById('simulatorPanel');
  if (!panel) return;
  panel.style.display = '';

  const population = currentCountryData?.rankings?.countryActivePopulation?.value || null;
  const electedCount = opts.electedCount || null;
  const MIN_SEATS  = 5;
  const MAX_SEATS  = 50;

  // Seat count: manual override > election's official electedCount > population formula > current election seats (min 5)
  const seatsInputEl = document.getElementById('simSeatsInput');
  const seatsHintEl  = document.getElementById('simSeatsHint');
  const manualSeats  = seatsInputEl ? parseInt(seatsInputEl.value, 10) : NaN;
  let totalSeats, seatsNote;
  if (!isNaN(manualSeats) && manualSeats >= MIN_SEATS) {
    totalSeats = Math.min(manualSeats, MAX_SEATS);
    seatsNote  = 'manual';
  } else if (electedCount) {
    totalSeats = Math.max(MIN_SEATS, Math.min(MAX_SEATS, electedCount));
    seatsNote  = 'from electedCount';
  } else if (population) {
    totalSeats = Math.max(MIN_SEATS, Math.min(MAX_SEATS, Math.floor(population / 20) + 2));
    seatsNote  = `pop/20+2`;
  } else {
    totalSeats = Math.max(MIN_SEATS, Math.min(MAX_SEATS, totalSeatsCurrent));
    seatsNote  = 'from election';
  }
  if (seatsInputEl && isNaN(manualSeats)) seatsInputEl.placeholder = totalSeats;
  if (seatsHintEl) seatsHintEl.textContent = seatsNote;

  // Voter input
  const rawValue = document.getElementById('simExpectedVotersInput')?.value?.trim();
  const expectedVoters = parseInt(rawValue, 10);
  const hasVoters = rawValue && !isNaN(expectedVoters) && expectedVoters > 0;

  const projVotesPerSeat = hasVoters && totalSeats > 0 ? Math.round(expectedVoters / totalSeats) : null;
  const votesToWinPres   = hasVoters ? Math.floor(expectedVoters / 2) + 1 : null;

  document.getElementById('simPopulation').textContent    = population ? population.toLocaleString() : '—';
  document.getElementById('simAvgVotes').textContent      = totalSeats;
  document.getElementById('simAvgTurnout').textContent    = seatsNote;
  document.getElementById('simExpVoters').textContent     = hasVoters ? expectedVoters.toLocaleString() : '—';
  document.getElementById('simVotesPerSeat').textContent  = projVotesPerSeat ? projVotesPerSeat.toLocaleString() : '—';
  document.getElementById('simVotesToWin').textContent    = votesToWinPres ? votesToWinPres.toLocaleString() : '—';

  // Historic chips
  const recentTurnouts = electionHistory.filter(e => e.type === 'congress').slice(-6).map(e => ({
    totalVotes: e.votesCount || 0, date: e.createdAt,
  }));
  const refEl = document.getElementById('simHistoricRef');
  if (refEl) {
    if (!recentTurnouts.length) {
      refEl.innerHTML = '<span style="color:var(--text3);font-size:.72rem;">No historical data yet</span>';
    } else {
      refEl.innerHTML = recentTurnouts.map((rt, i) => {
        const d    = rt.date ? new Date(rt.date).toLocaleDateString('en', { month: 'short', year: '2-digit' }) : `#${i+1}`;
        const pct  = population ? ((rt.totalVotes / population) * 100).toFixed(0) + '%' : rt.totalVotes.toLocaleString() + ' v';
        const last = i === recentTurnouts.length - 1;
        return `<span class="sim-chip${last ? ' sim-chip-latest' : ''}" title="${d}: ${rt.totalVotes.toLocaleString()} votes">${d} · ${pct}</span>`;
      }).join('');
    }
  }

  // ── VOTE % BASED PROJECTION ──
  // Use actual vote totals from the parties (last congress election data stored in allParties)
  const totalVotesAll = allParties.reduce((s, p) => s + (p.votes || 0), 0);

  const projBasisEl = document.getElementById('simProjBasis');
  if (projBasisEl) {
    if (opts.isLive) {
      if (opts.usingPrevVotes) {
        projBasisEl.textContent = `📊 no votes yet this round · projecting from the previous congress election's vote share (${totalVotesAll.toLocaleString()} votes)`;
      } else {
        projBasisEl.textContent = totalVotesAll > 0
          ? `🔴 LIVE · projecting from ${totalVotesAll.toLocaleString()} votes counted so far (voting still in progress)`
          : '🔴 LIVE · waiting for the first votes to come in';
      }
    } else {
      projBasisEl.textContent = totalVotesAll > 0
        ? t('using_total_votes', { n: totalVotesAll.toLocaleString() })
        : 'using member share (no vote data)';
    }
  }

  // Distribute totalSeats proportionally by vote share (or member share as fallback)
  // Uses largest-remainder method to guarantee exact seat sum
  function distributeSeats(shares, total) {
    const sumShares = shares.reduce((a, b) => a + b, 0);
    if (!sumShares) return shares.map(() => 0);
    const quotas    = shares.map(s => (s / sumShares) * total);
    const floors    = quotas.map(Math.floor);
    const assigned  = floors.reduce((a, b) => a + b, 0);
    const remainder = total - assigned;
    const remainders = quotas.map((q, i) => ({ i, r: q - floors[i] }))
      .sort((a, b) => b.r - a.r);
    for (let k = 0; k < remainder; k++) floors[remainders[k].i]++;
    return floors;
  }

  const totalMembers = allParties.reduce((s, p) => s + (p.members || 0), 0);
  const shares = allParties.map(p =>
    totalVotesAll > 0 ? (p.votes || 0) : (p.members || 0)
  );
  const projSeatsArr = distributeSeats(shares, totalSeats);

  const simParties = allParties.map((p, i) => {
    const votePct  = totalVotesAll > 0 ? ((p.votes || 0) / totalVotesAll * 100) : null;
    const memberPct = totalMembers > 0 ? ((p.members || 0) / totalMembers * 100) : null;
    const basisPct  = votePct != null ? votePct : memberPct;
    const projVotes = hasVoters && basisPct != null ? Math.round(expectedVoters * basisPct / 100) : null;
    const proj      = projSeatsArr[i];
    const delta     = proj - (p.seats || 0);
    return { ...p, votePct, memberPct, projVotes, projSeats: proj, delta };
  }).sort((a, b) => b.projSeats - a.projSeats);

  // Render party cards
  const cardsEl = document.getElementById('simPartyCards');
  if (cardsEl) {
    const maxProj = Math.max(...simParties.map(p => p.projSeats), 1);
    cardsEl.innerHTML = simParties.map(p => {
      const deltaStr   = p.delta === 0 ? '=' : (p.delta > 0 ? `+${p.delta}` : `${p.delta}`);
      const deltaColor = p.delta > 0 ? 'var(--green)' : p.delta < 0 ? 'var(--red)' : 'var(--text3)';
      const barW       = (p.projSeats / maxProj * 100).toFixed(1);
      const votePctStr = p.votePct != null ? p.votePct.toFixed(1) + '%' : (p.memberPct != null ? p.memberPct.toFixed(1) + '% (mbr)' : '—');
      const projVotesStr = p.projVotes != null ? p.projVotes.toLocaleString() : '—';
      return `
        <div class="sim-party-card">
          <div class="sim-pc-head">
            <span class="sim-pc-dot" style="background:${p.color}"></span>
            <span class="sim-pc-name">${p.name}</span>
            <span class="sim-pc-delta" style="color:${deltaColor}">${deltaStr}</span>
          </div>
          <div class="sim-pc-bar-wrap">
            <div class="sim-pc-bar" style="width:${barW}%;background:${p.color}"></div>
          </div>
          <div class="sim-pc-stats">
            <span title="Vote share from last election"><span style="color:var(--text3)">🗳</span> ${votePctStr}</span>
            <span title="${t('projected_votes_title')}">${hasVoters ? `~${projVotesStr} ${t('votes_suffix')}` : ''}</span>
            <span class="sim-pc-seats-now" title="Current seats">${p.seats || 0} now</span>
            <strong class="sim-pc-seats-proj" style="color:${p.color}">${p.projSeats} seats</strong>
          </div>
        </div>`;
    }).join('');
  }

  // Mini parliament preview
  const previewWrap = document.getElementById('simParliamentWrap');
  const previewContainer = document.getElementById('simParliamentContainer');
  const previewLegend = document.getElementById('simParliamentLegend');
  const simHasSeats = simParties.some(p => p.projSeats > 0);
  if (previewWrap && previewContainer && simHasSeats) {
    previewWrap.style.display = '';
    const fakeTooltip = document.createElement('div');
    fakeTooltip.className = 'tooltip';
    fakeTooltip.style.cssText = 'position:fixed;pointer-events:none;opacity:0;z-index:9999;';
    document.body.appendChild(fakeTooltip);
    parliamentRender({
      container: previewContainer,
      legendContainer: previewLegend,
      parties: simParties.filter(p => p.projSeats > 0).map(p => ({
        ...p, seats: p.projSeats, users: [],
      })),
      tooltip: fakeTooltip,
    });
  } else if (previewWrap) {
    previewWrap.style.display = 'none';
  }

  const simBadgeEl = document.getElementById('simBadge');
  if (simBadgeEl) {
    simBadgeEl.textContent = opts.isLive
      ? `🔴 LIVE projection · ${totalSeats} seats · ${simParties.filter(p => p.projSeats > 0).length} parties`
      : `${totalSeats} seats · ${simParties.filter(p => p.projSeats > 0).length} parties`;
  }
}

export function onExpectedVotersChange() {
  if (lastAllParties) {
    const totalSeats = lastAllParties.reduce((s, p) => s + (p.seats || 0), 0);
    const opts = { electedCount: lastElectedCount };
    if (simIsLive) opts.isLive = true;
    renderSimulator(lastAllParties, totalSeats, opts);
  }
}

export function onSimSeatsChange() {
  onExpectedVotersChange();
}

/* ── STAT TREND HELPER ── */
function _fillStatTrends(currentSeats, currentParties, currentVotes) {
  // Trova le ultime 2 elezioni di tipo congress già nello storico
  const congHistory = electionHistory.filter(e => e.type === 'congress');
  if (congHistory.length < 2) return; // niente da confrontare

  const prevElection = congHistory[congHistory.length - 2];
  if (!prevElection) return;

  function setTrend(elId, current, prev, formatter) {
    const el = document.getElementById(elId);
    if (!el) return;
    if (prev == null || prev === 0) { el.textContent = ''; el.className = 'stat-trend neutral'; return; }
    const delta = current - prev;
    if (delta === 0) { el.textContent = '= same as prev'; el.className = 'stat-trend neutral'; return; }
    const sign = delta > 0 ? '↑' : '↓';
    const cls  = delta > 0 ? 'up' : 'down';
    el.textContent = `${sign} ${formatter ? formatter(Math.abs(delta)) : Math.abs(delta)} vs prev`;
    el.className = `stat-trend ${cls}`;
  }

  // Total seats: confronta con votesCount dell'elezione precedente se disponibile
  const prevSeats = (prevElection.candidates || []).filter(c => c.isElected).length || null;
  setTrend('stat-seats-trend', currentSeats, prevSeats, v => v);

  // Parties: non disponibile direttamente nello storico leggero, skip silenzioso
  // Votes
  const prevVotes = prevElection.votesCount || null;
  setTrend('stat-votes-trend', currentVotes, prevVotes, v => v.toLocaleString());

  // Parties trend — approssimato dal numero di partiti eletti precedente
  // Usiamo un valore in cache se disponibile
  const cachedPrevParties = _prevCongressPartyCount;
  setTrend('stat-parties-trend', currentParties, cachedPrevParties, v => v);
  _prevCongressPartyCount = currentParties;
}
