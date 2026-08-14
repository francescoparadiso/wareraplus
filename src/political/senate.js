/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: senate.js come modulo ES (Fase 2, Stage 6)
   ------------------------------------------------------------------
   Conversione dell'IIFE `SenateView` a modulo con export diretti (le
   ~50 funzioni interne restano private al modulo, esattamente come
   erano private al closure — questa parte era già "module-friendly").

   DUE fix strutturali rispetto all'originale (necessari, non opzionali,
   per funzionare fuori da un iframe/script-tag):

   1. CATTURA DOM A TOP-LEVEL. L'originale leggeva `overlay`,
      `seatsContainer`, `emptyMsg`, `subtitle` con `document.getElementById`
      all'ESECUZIONE dell'IIFE (cioè al parse dello script), contando sul
      fatto che quegli elementi esistessero già nell'HTML statico in quel
      momento. Nel path in-page il markup viene montato lazy DOPO che
      questo modulo è già stato importato (Stage 5: domTemplate.js monta
      dentro #wp-political-root all'apertura di Political, non al boot
      dell'app) — quegli elementi NON esistono ancora quando il modulo
      viene valutato. Soluzione: lookup spostato dentro `initSenateView()`,
      chiamata esplicitamente da main.js (Stage 8) DOPO il mount del
      template. Stesso discorso per il binding dei bottoni open/close,
      prima wired su `DOMContentLoaded` (mai più utile: il DOMContentLoaded
      della pagina SHELL è già passato quando Political si apre).

   2. DIPENDENZE FORWARD su main.js/congress.js (non ancora convertiti a
      questo stage). `loadElection` (main.js, Stage 8), `getGovernmentWithDetails`
      e `loadPartiesForCountry` (congress.js, Stage 7) erano identificatori
      nudi risolti a runtime nell'originale, con guardie `typeof fn ===
      'function'` per gli ultimi due (l'assenza era tollerata, mai
      realmente osservata a runtime). Con import statici l'assenza
      diventerebbe un errore di build, non un caso opzionale — e in ogni
      caso questi file non esistono ancora in questo stage. Iniettate
      quindi via `setSenateDeps({...})`, chiamata da main.js una volta
      sola all'avvio (stesso pattern già usato per showPartyView in ui.js
      e toggleTheme in config.js).

   `openPlayerCard` (parliament.js, Stage 6, già esiste) non ha più
   bisogno della guardia `typeof`: import statico diretto, la dipendenza
   è sempre presente per costruzione.

   `_injectStyles()`: il CSS iniettato in `document.head` è stato
   ri-scopato sotto `#wp-political-root` con lo stesso script postcss
   usato per style.css (Stage 5) — questi selettori (.senate-party-sidebar,
   .sps-*, .scb-*, .ssb-*) sono abbastanza specifici da non collidere
   probabilmente con nulla nello shell, ma lo scoping sistematico evita
   di doverlo verificare caso per caso.
   ══════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';
import {
  escapeHtml, APP_BASE,
  currentCountryId, setCurrentCountryId,
  currentCountryData, setCurrentCountryData,
  currentCongressElectionId,
  countryNamesMap, partyNamesMap,
  lastElectedParties, setLastElectedParties,
} from './config.js';
import { localFetch } from './api.js';
import { getAllCountries } from '../shared/countries.js';
import { openPlayerCard } from './parliament.js';

// ── state ──
let _parties = [];
let _filtered = [];
let _viewMode = 'semicircle'; // 'semicircle' | 'table'
let _searchTerm = '';
let _partyFilter = 'all';
let _sortKey = 'votes';
let _sortDir = -1;
let _chromeBuilt = false;
let _countryCodesMap = new Map(); // countryId -> ISO code (minuscolo), per le bandiere
let _govData = null;        // { presidentData, vicePresidentData, ... } per currentCountryId
let _govDataCountryId = null;
let _totalPartiesCount = null; // n. totale partiti registrati nel paese (non solo quelli in senato)
let _totalPartiesCountryId = null;
let _resizeListenerBound = false; // era window._senateResizeListener

// Spazio riservato alla colonna partiti (dx) e alla barra statistiche (basso):
// l'arco viene calcolato per stare dentro lo spazio residuo, non sotto questi due.
const SIDEBAR_W = 300;
const BOTTOMBAR_H = 46;

// Popolati da initSenateView() dopo il mount del template (vedi header) —
// NON più catturati a top-level.
let overlay, seatsContainer, emptyMsg, subtitle;

// Dipendenze cross-modulo iniettate da main.js (Stage 8) — vedi header.
let _loadElection = null;
let _getGovernmentWithDetails = null;
let _loadPartiesForCountry = null;
export function setSenateDeps({ loadElection, getGovernmentWithDetails, loadPartiesForCountry } = {}) {
  if (loadElection) _loadElection = loadElection;
  if (getGovernmentWithDetails) _getGovernmentWithDetails = getGovernmentWithDetails;
  if (loadPartiesForCountry) _loadPartiesForCountry = loadPartiesForCountry;
}

// ── utils ──
const _fmt = (n) => (n || 0).toLocaleString();
const _abbr = (name) => name ? name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 4) : '?';

function _flattenSeats(parties) {
  const sorted = [...parties].sort((a, b) => b.seats - a.seats);
  const seats = [];
  sorted.forEach(party => {
    const users = party.users || [];
    const totalVotesAll = sorted.reduce((s, p) => s + (p.votes || 0), 0);
    const partyVotesPct = totalVotesAll > 0 && party.votes > 0 ? ((party.votes / totalVotesAll) * 100).toFixed(1) : null;
    const rankedUsers = [...users].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const rankMap = new Map(rankedUsers.map((u, i) => [u.userId, i + 1]));
    const topVotesInParty = rankedUsers[0]?.votes || 0;
    for (let i = 0; i < party.seats; i++) {
      const user = users[i] || {};
      seats.push({
        party: party.name,
        partyId: party.id || null,
        color: party.color || '#c5964a',
        seatIdx: i,
        total: party.seats,
        username: user.username || null,
        userId: user.userId || user._id || null,
        avatarUrl: user.avatarUrl || null,
        level: user.level ?? user.lvl ?? null,
        userVotes: user.votes ?? null,
        partyVotesPct,
        partyVotes: party.votes || null,
        partyMembers: party.members || null,
        partyRank: user.userId ? rankMap.get(user.userId) : null,
        topVotesInParty,
      });
    }
  });
  return seats;
}

function _filterSeats(seats) {
  let result = seats;
  if (_searchTerm) {
    const term = _searchTerm.toLowerCase();
    result = result.filter(s => s.username && s.username.toLowerCase().includes(term));
  }
  if (_partyFilter !== 'all') {
    result = result.filter(s => s.partyId === _partyFilter);
  }
  return result;
}

function _sortSeats(seats) {
  return [...seats].sort((a, b) => {
    let va, vb;
    if (_sortKey === 'votes') { va = a.userVotes || 0; vb = b.userVotes || 0; }
    else if (_sortKey === 'name') { va = a.username || ''; vb = b.username || ''; return va.localeCompare(vb) * _sortDir; }
    else if (_sortKey === 'level') { va = a.level || 0; vb = b.level || 0; }
    else if (_sortKey === 'party') { va = a.party || ''; vb = b.party || ''; return va.localeCompare(vb) * _sortDir; }
    else { va = a.seatIdx; vb = b.seatIdx; }
    return (va - vb) * _sortDir;
  });
}

// ── LAYOUT: horizontal semicircle (arc upward, left→right) ──
// Cerca la geometria (righe + dimensione carte) con capienza sufficiente
// per tutti gli n seggi, preferendo poche righe/carte grandi e passando a
// più righe solo se serve — esattamente come il "ventaglio" originale.
// Se, in casi estremi (schermo minuscolo), nessuna geometria raggiunge la
// capienza piena, usa comunque la migliore trovata e FORZA la distribuzione
// di tutti i seggi su di essa: non vengono mai scartati.
function _computeSemicircleLayout(n, containerW, containerH) {
  if (n === 0) return null;

  const availW = containerW - 40;
  const availH = containerH;

  // Cards are rotated to follow the arc: near the two ends of the outer
  // rows they sit almost sideways, so their real vertical footprint can
  // exceed cardH. VSLACK inflates the height budget so those cards never
  // poke out under the bottom bar, especially with many rows (large N).
  const VSLACK = 1.3;

  const baseCardW = Math.min(78, Math.max(26, (availW / (n * 0.4 + 6))));

  let fallbackBest = null; // valid geometry with the most capacity found so far

  for (let scale = 1; scale >= 0.28; scale -= 0.06) {
    const cardW = Math.max(14, baseCardW * scale);
    const cardH = cardW * 1.4;
    for (let rows = 1; rows <= 5; rows++) {
      const rowGap = cardH * 1.15;
      const innerR = Math.min(availW * 0.44, Math.max(cardW * 1.2, availW * 0.18));
      const totalR = innerR + (rows - 1) * rowGap;
      if (totalR * 2 > availW) continue;
      if (totalR + cardH * VSLACK > availH) continue;

      const radii = [];
      const caps = [];
      for (let r = 0; r < rows; r++) {
        const radius = innerR + r * rowGap;
        radii.push(radius);
        caps.push(Math.max(1, Math.floor((Math.PI * radius) / (cardW * 1.3))));
      }
      const totalCap = caps.reduce((a, b) => a + b, 0);

      if (totalCap >= n) {
        const rowSeats = _distributeForce(n, caps);
        return { rows, radii, rowSeats, cardW, cardH };
      }
      if (!fallbackBest || totalCap > fallbackBest.totalCap) {
        fallbackBest = { rows, radii, caps, cardW, cardH, totalCap };
      }
    }
  }

  if (fallbackBest) {
    const rowSeats = _distributeForce(n, fallbackBest.caps);
    return { rows: fallbackBest.rows, radii: fallbackBest.radii, rowSeats, cardW: fallbackBest.cardW, cardH: fallbackBest.cardH };
  }

  // Estremo: nessuna geometria rientra in availH (viewport minuscolo) —
  // carte minime, 5 righe forzate, ma tutti i seggi restano visibili.
  const cardW = 14, cardH = cardW * 1.4, rows = 5;
  const rowGap = cardH * 1.15;
  const innerR = Math.max(cardW * 1.2, availW * 0.12);
  const radii = Array.from({ length: rows }, (_, i) => innerR + i * rowGap);
  const caps = radii.map(radius => Math.max(1, Math.floor((Math.PI * radius) / (cardW * 1.3))));
  const rowSeats = _distributeForce(n, caps);
  return { rows, radii, rowSeats, cardW, cardH };
}

function _distributeForce(total, caps) {
  const capSum = caps.reduce((a, b) => a + b, 0);
  const result = capSum > 0 ? caps.map(c => Math.floor(total * c / capSum)) : caps.map(() => 0);
  let diff = total - result.reduce((a, b) => a + b, 0);
  // Prima riempi fino al "cap" morbido di ogni riga...
  for (let i = 0; diff > 0 && i < result.length; i++) {
    while (diff > 0 && result[i] < caps[i]) { result[i]++; diff--; }
  }
  // ...poi, se restano seggi (n supera la capienza totale stimata),
  // continuano a essere assegnati a rotazione: MAI persi.
  let i = 0;
  while (diff > 0) { result[i % result.length]++; diff--; i++; }
  i = 0;
  while (diff < 0) { const j = i % result.length; if (result[j] > 0) { result[j]--; diff++; } i++; }
  return result;
}

// Re-groups seats so members of the same party are placed contiguously in
// the arc, regardless of whatever sort is currently active for the table
// (e.g. sorting by votes globally would otherwise scatter parties around).
function _groupSeatsForArc(seats) {
  const map = new Map();
  seats.forEach(s => {
    const key = s.partyId || s.party;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(s);
  });
  const keys = [...map.keys()].sort((a, b) => map.get(b).length - map.get(a).length);
  const grouped = [];
  keys.forEach(k => grouped.push(...map.get(k)));
  return grouped;
}

// ── RENDER SEMICIRCLE (horizontal) ──
function _renderSemicircle(seatsIn) {
  const container = seatsContainer;
  container.innerHTML = '';
  if (!seatsIn.length) { emptyMsg.style.display = 'block'; return; }
  emptyMsg.style.display = 'none';

  // Su mobile le card dell'arco diventano troppo piccole per essere
  // leggibili o utili per fare i conti: sotto la stessa soglia usata dalla
  // sidebar (1000px) mostriamo sempre la tabella, indipendentemente dal
  // toggle. Su desktop l'arco resta invariato.
  if (window.innerWidth <= 1000) {
    _renderTable(seatsIn);
    return;
  }

  const seats = _groupSeatsForArc(seatsIn);

  // A questo punto siamo garantiti desktop (mobile è già stato deviato
  // sulla tabella sopra), quindi la sidebar destra è sempre presente.
  const W = window.innerWidth - SIDEBAR_W;
  const H = window.innerHeight - BOTTOMBAR_H;

  const cx = W / 2;

  // Margine sopra: misuriamo il bordo inferiore reale di titolo+controlli
  // invece di un valore fisso, così l'arco parte sempre subito sotto di
  // essi qualunque sia la loro altezza effettiva.
  const stageEl = document.querySelector('.senate-stage');
  const controlsEl = stageEl?.querySelector('.senate-controls');
  let topMargin = 100;
  if (controlsEl) {
    const r = controlsEl.getBoundingClientRect();
    if (r.bottom > 0) topMargin = Math.max(60, r.bottom + 20);
  }
  const bottomMargin = 28;
  const labelHeadroom = 66; // spazio per le due righe di etichetta partito oltre il bordo esterno dell'arco
  const availH = Math.max(120, H - topMargin - bottomMargin - labelHeadroom);

  const layout = _computeSemicircleLayout(seats.length, W, availH);
  if (!layout) {
    // Fallback: show a simple grid
    _viewMode = 'table';
    document.getElementById('senateViewToggle').textContent = '🏛️ Arc';
    _renderTable(seatsIn);
    return;
  }

  const { rows, radii, rowSeats, cardW, cardH } = layout;

  // Centriamo verticalmente il bounding box dell'arco dentro la zona
  // disponibile [topMargin, H-bottomMargin], invece di ancorarlo al
  // fondo: con pochi seggi/righe (raggio piccolo) l'arco finiva basso
  // e a volte "sforava" sotto la barra statistiche. `_computeSemicircleLayout`
  // garantisce già che (outerR + cardH*1.3) <= availH — lo stesso 1.3 di
  // sicurezza va usato qui per restare coerenti col vincolo verificato.
  const outerR = radii[rows - 1];
  const arcBoxH = outerR + cardH * 1.3; // dal top dell'arco al bordo inferiore delle cards
  const zoneTop = topMargin;
  const zoneH = availH;
  let cy = zoneTop + (zoneH - arcBoxH) / 2 + outerR + cardH / 2;

  // Margine di sicurezza incondizionato: qualunque cosa dica il calcolo
  // sopra, il fondo dell'arco (cy + cardH/2) non deve mai superare
  // `H - bottomMargin`. Così l'arco parte sempre garantendo lo spazio dal
  // fondo, indipendentemente da eventuali errori di stima della geometria.
  const hardMaxCy = H - bottomMargin - cardH / 2;
  if (cy > hardMaxCy) cy = hardMaxCy;

  const frag = document.createDocumentFragment();

  // ── Build every point across ALL rows first, then sort them globally
  // by angle (left → right), exactly like Parliament.render()/generatePoints.
  // This is what makes party blocks read correctly left-to-right across
  // the whole arc instead of being filled one full row at a time.
  const points = [];
  for (let row = 0; row < rows; row++) {
    const radius = radii[row];
    const n = rowSeats[row];
    if (n <= 0) continue;
    const startAngle = -Math.PI;
    const endAngle = 0;
    const angleRange = endAngle - startAngle;
    for (let i = 0; i < n; i++) {
      const frac = n === 1 ? 0.5 : i / (n - 1);
      const angle = startAngle + angleRange * frac;
      points.push({ angle, radius, row });
    }
  }
  points.sort((a, b) => a.angle - b.angle);

  let idx = 0;
  const arranged = []; // { seat, angle } nell'ordine di disegno, per calcolare gli spicchi colorati per partito
  for (const pt of points) {
    {
      const seat = seats[idx++];
      if (!seat) continue;
      arranged.push({ seat, angle: pt.angle });
      const { angle, radius } = pt;
      const x = cx + radius * Math.cos(angle);
      const y = cy + radius * Math.sin(angle);
      const rotateDeg = (angle * 180 / Math.PI) + 90;

      const card = document.createElement('div');
      card.className = 'senate-card';
      card.style.setProperty('--sc-color', seat.color || '#c5964a');
      card.style.width = cardW + 'px';
      card.style.height = cardH + 'px';
      card.style.left = x + 'px';
      card.style.top = y + 'px';
      card.style.setProperty('--sc-rot', rotateDeg + 'deg');
      card.style.setProperty('--sc-delay', (idx * 20) + 'ms');
      card.style.zIndex = 100 + Math.round(radius);

      const avatarStyle = seat.avatarUrl ? `background-image:url('${seat.avatarUrl}')` : '';
      const initial = (seat.username || '?')[0].toUpperCase();
      const rankStr = seat.partyRank ? `#${seat.partyRank}` : '';
      const votesLabel = seat.userVotes != null ? _fmt(seat.userVotes) : '—';
      const topVotes = seat.topVotesInParty || 1;
      const pctBar = seat.userVotes != null ? Math.min(100, Math.round((seat.userVotes / topVotes) * 100)) : 0;

      card.innerHTML = `
        <div class="senate-card-body">
          <div class="senate-card-figure" style="${avatarStyle}">
            ${!seat.avatarUrl ? `<span class="senate-card-initial">${initial}</span>` : ''}
            <span class="senate-card-party-badge">${_abbr(seat.party)}</span>
          </div>
          <div class="senate-card-info">
            <div class="senate-card-name">${escapeHtml(seat.username || '—')}</div>
            <div class="senate-card-stats">
              <span class="senate-card-stat">🗳 ${votesLabel}</span>
              ${rankStr ? `<span class="senate-card-stat">${rankStr}</span>` : ''}
              ${seat.level != null ? `<span class="senate-card-stat">⭐${seat.level}</span>` : ''}
            </div>
            <div class="senate-card-bar">
              <div class="senate-card-bar-fill" style="width:${pctBar}%;background:${seat.color}"></div>
            </div>
          </div>
        </div>
        <div class="senate-card-hover">
          <div class="senate-card-hover-name">${escapeHtml(seat.username || 'Unknown')}</div>
          <div class="senate-card-hover-party" style="color:${seat.color}">${escapeHtml(seat.party)}</div>
          <div class="senate-card-hover-row">🗳 ${seat.userVotes != null ? _fmt(seat.userVotes) : '—'} ${t('votes_suffix')}</div>
          ${seat.level != null ? `<div class="senate-card-hover-row">⭐ Level ${seat.level}</div>` : ''}
          ${seat.partyRank ? `<div class="senate-card-hover-row">Rank in party: #${seat.partyRank} of ${seat.total}</div>` : ''}
          ${seat.partyVotesPct != null ? `<div class="senate-card-hover-row">${t('party_vote_share_label')}: ${seat.partyVotesPct}%</div>` : ''}
          ${seat.partyVotes != null ? `<div class="senate-card-hover-row">${t('party_total_votes_label')}: ${_fmt(seat.partyVotes)}</div>` : ''}
          ${seat.partyMembers != null ? `<div class="senate-card-hover-row">Party members: ${seat.partyMembers}</div>` : ''}
          <div class="senate-card-hover-row" style="opacity:.7;margin-top:4px;">click for full profile ↗</div>
        </div>
      `;
      card.addEventListener('click', () => {
        if (seat.userId) openPlayerCard(seat);
      });
      frag.appendChild(card);
    }
  }

  // ── Spicchi colorati di sfondo, uno per partito ──
  // Dato che i seggi sono già raggruppati per partito lungo l'arco,
  // ricaviamo per ciascuno l'intervallo angolare min/max occupato e
  // disegniamo dietro le card uno "spicchio" (settore di cerchio dal
  // centro dell'arco) del colore di quel partito. Così lo sfondo cambia
  // colore man mano che ci si sposta lungo l'arco, seguendo i confini
  // reali tra un partito e l'altro.
  const wedgeOuterR = outerR + cardH * 0.85;
  const wedgeLayer = _buildPartyWedges(arranged, cx, cy, wedgeOuterR, W, H);
  container.appendChild(wedgeLayer);

  const labelLayer = _buildPartyLabels(arranged, cx, cy, wedgeOuterR, W, H);
  container.appendChild(labelLayer);

  container.appendChild(frag);
  subtitle.textContent = t('senate_subtitle_count', { seats: seats.length, factions: new Set(seats.map(s => s.partyId)).size });

  // ── Correzione post-render ──
  // Le card sono ruotate per seguire l'arco, quindi il loro ingombro
  // verticale reale dipende dall'angolo di rotazione in un modo che è
  // scomodo calcolare in anticipo con precisione pixel-perfect (dipende
  // anche da dettagli del CSS come transform-origin). Invece di continuare
  // a indovinare margini, misuriamo qui il bounding box REALE delle card
  // dopo averle disegnate e, se qualcuna sfora sotto il limite (le colonne
  // alle due estremità dell'arco sono quelle più a rischio), spostiamo
  // l'intero arco su di quel tanto. Garanzia definitiva, indipendente
  // da come il browser renderizza esattamente le rotazioni.
  requestAnimationFrame(() => {
    const cards = container.querySelectorAll('.senate-card');
    if (!cards.length) return;
    const bottomLimit = H - bottomMargin;
    let maxBottom = 0;
    cards.forEach(c => {
      const b = c.getBoundingClientRect().bottom;
      if (b > maxBottom) maxBottom = b;
    });
    const overflow = maxBottom - bottomLimit;
    if (overflow > 2) {
      cards.forEach(c => {
        const curTop = parseFloat(c.style.top) || 0;
        c.style.top = (curTop - overflow) + 'px';
      });
    }
  });
}

// Raggruppa i seggi disegnati (già contigui per partito) in blocchi con
// intervallo angolare min/max, confini condivisi a metà strada fra un
// gruppo e il successivo, e i totali (voti, eletti) del partito — usata
// sia per gli spicchi di sfondo sia per le etichette curve.
function _computePartyGroups(arranged) {
  const groups = [];
  arranged.forEach(({ seat, angle }) => {
    const last = groups[groups.length - 1];
    const key = seat.partyId || seat.party;
    if (last && last.partyId === key) {
      last.minA = Math.min(last.minA, angle);
      last.maxA = Math.max(last.maxA, angle);
      last.seatCount++;
      last.votesSum += (seat.userVotes || 0);
    } else {
      groups.push({
        partyId: key,
        name: seat.party,
        color: seat.color,
        minA: angle,
        maxA: angle,
        seatCount: 1,
        votesSum: seat.userVotes || 0,
        partyVotes: seat.partyVotes,
      });
    }
  });

  // Confini contigui: ogni spicchio finisce esattamente dove inizia il
  // successivo (a metà strada tra gli angoli dei due gruppi), e il primo
  // e l'ultimo si estendono fino ai bordi estremi dell'arco (-π e 0).
  const boundaries = [-Math.PI];
  for (let i = 0; i < groups.length - 1; i++) {
    boundaries.push((groups[i].maxA + groups[i + 1].minA) / 2);
  }
  boundaries.push(0);

  return { groups, boundaries };
}

// ── ETICHETTE PARTITO LUNGO L'ARCO ──
// Per ogni spicchio disegna il nome del partito (col colore del partito)
// seguendo la curvatura dell'arco, appena sopra la fila esterna di
// seggi, e sotto — in font più piccolo — voti ed eletti. Il testo segue
// davvero la curva (via <textPath> su un arco SVG), non è solo ruotato.
function _buildPartyLabels(arranged, cx, cy, baseRadius, W, H) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'senate-party-labels');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '2';
  svg.style.overflow = 'visible';

  if (!arranged.length) return svg;

  const { groups, boundaries } = _computePartyGroups(arranged);
  const defs = document.createElementNS(NS, 'defs');
  svg.appendChild(defs);

  const nameR = baseRadius + 60;
  const subR = baseRadius + 80;
  groups.forEach((g, i) => {
    // Restringe leggermente l'intervallo del testo rispetto allo spicchio
    // pieno, per lasciare un piccolo margine visivo verso i partiti vicini.
    const span = boundaries[i + 1] - boundaries[i];
    const inset = span * 0.08;
    const a1 = boundaries[i] + inset;
    const a2 = boundaries[i + 1] - inset;
    const arcLenAtName = Math.max(0, (a2 - a1) * nameR);
    // Spicchi troppo stretti (1-2 seggi isolati) non hanno spazio per un
    // testo leggibile: l'informazione resta comunque nella sidebar.
    if (arcLenAtName < 26) return;

    const makeArcPath = (r) => {
      const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
      const x2 = cx + r * Math.cos(a2), y2 = cy + r * Math.sin(a2);
      const largeArc = (a2 - a1) > Math.PI ? 1 : 0;
      const pathId = `senate-arclabel-${i}-${Math.round(r)}`;
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('id', pathId);
      path.setAttribute('d', `M ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2}`);
      path.setAttribute('fill', 'none');
      defs.appendChild(path);
      return pathId;
    };

    // Riga 1: nome del partito, col colore del partito, dimensione che si
    // adatta (entro un range) alla lunghezza reale disponibile sull'arco.
    const nameId = makeArcPath(nameR);
    const nameFontSize = Math.max(9, Math.min(13, arcLenAtName / Math.max(6, (g.name || '?').length * 0.62)));
    const nameText = document.createElementNS(NS, 'text');
    nameText.setAttribute('font-family', 'Sora, sans-serif');
    nameText.setAttribute('font-weight', '700');
    nameText.setAttribute('font-size', nameFontSize.toFixed(1));
    nameText.setAttribute('fill', g.color || '#c5964a');
    nameText.setAttribute('text-anchor', 'middle');
    nameText.style.textShadow = '0 1px 3px rgba(0,0,0,.6)';
    const nameTP = document.createElementNS(NS, 'textPath');
    nameTP.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${nameId}`);
    nameTP.setAttribute('href', `#${nameId}`);
    nameTP.setAttribute('startOffset', '50%');
    nameTP.setAttribute('lengthAdjust', 'spacingAndGlyphs');
    nameTP.textContent = g.name || '';
    nameText.appendChild(nameTP);
    svg.appendChild(nameText);

    // Riga 2, più piccola: voti totali ed eletti del partito.
    const subId = makeArcPath(subR);
    const subLabel = `${_fmt(g.partyVotes != null ? g.partyVotes : g.votesSum)} ${t('votes_suffix') || 'voti'} · ${g.seatCount} ${t('col_seats') || 'eletti'}`;
    const subText = document.createElementNS(NS, 'text');
    subText.setAttribute('font-family', 'Sora, sans-serif');
    subText.setAttribute('font-weight', '500');
    subText.setAttribute('font-size', '8.5');
    subText.setAttribute('fill', '#9aa2b4');
    subText.setAttribute('text-anchor', 'middle');
    const subTP = document.createElementNS(NS, 'textPath');
    subTP.setAttributeNS('http://www.w3.org/1999/xlink', 'href', `#${subId}`);
    subTP.setAttribute('href', `#${subId}`);
    subTP.setAttribute('startOffset', '50%');
    subTP.textContent = subLabel;
    subText.appendChild(subTP);
    svg.appendChild(subText);
  });

  return svg;
}

// ── SPICCHI DI SFONDO PER PARTITO ──
// Costruisce un layer SVG con un settore (pie slice) per ciascun partito,
// colorato col colore del partito, che copre l'intervallo angolare reale
// occupato dai suoi seggi sull'arco. `arranged` è la sequenza {seat,angle}
// nell'ordine di disegno (i seggi dello stesso partito sono già contigui).
function _buildPartyWedges(arranged, cx, cy, outerRadius, W, H) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'senate-party-wedges');
  svg.setAttribute('width', W);
  svg.setAttribute('height', H);
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.style.position = 'absolute';
  svg.style.left = '0';
  svg.style.top = '0';
  svg.style.pointerEvents = 'none';
  svg.style.zIndex = '1';
  svg.style.overflow = 'visible';

  if (!arranged.length) return svg;

  const { groups, boundaries } = _computePartyGroups(arranged);

  groups.forEach((g, i) => {
    const a1 = boundaries[i];
    const a2 = boundaries[i + 1];
    const x1 = cx + outerRadius * Math.cos(a1);
    const y1 = cy + outerRadius * Math.sin(a1);
    const x2 = cx + outerRadius * Math.cos(a2);
    const y2 = cy + outerRadius * Math.sin(a2);
    const largeArc = (a2 - a1) > Math.PI ? 1 : 0;
    const d = `M ${cx} ${cy} L ${x1} ${y1} A ${outerRadius} ${outerRadius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', d);
    path.setAttribute('fill', g.color || '#c5964a');
    path.setAttribute('fill-opacity', '0.16');
    path.setAttribute('stroke', g.color || '#c5964a');
    path.setAttribute('stroke-opacity', '0.3');
    path.setAttribute('stroke-width', '1');
    svg.appendChild(path);
  });

  return svg;
}

// ── TABLE VIEW (full-screen) ──
function _renderTable(seats) {
  const container = seatsContainer;
  container.innerHTML = '';
  if (!seats.length) { emptyMsg.style.display = 'block'; return; }
  emptyMsg.style.display = 'none';

  const table = document.createElement('table');
  table.className = 'senate-table';
  table.innerHTML = `
    <thead>
      <tr>
        <th data-sort="idx">#</th>
        <th data-sort="name">${t('col_senator')}</th>
        <th data-sort="party">${t('col_party')}</th>
        <th data-sort="votes">${t('col_votes')}</th>
        <th data-sort="level">${t('col_level')}</th>
        <th>${t('col_profile')}</th>
      </tr>
    </thead>
    <tbody></tbody>
  `;
  const tbody = table.querySelector('tbody');
  seats.forEach((s, i) => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td>
        ${s.avatarUrl ? `<img src="${s.avatarUrl}" class="senate-table-avatar" onerror="this.style.display='none'">` : ''}
        ${escapeHtml(s.username || '—')}
      </td>
      <td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${s.color};margin-right:6px;"></span>${escapeHtml(s.party)}</td>
      <td>${s.userVotes != null ? _fmt(s.userVotes) : '—'}</td>
      <td>${s.level != null ? s.level : '—'}</td>
      <td><a href="${APP_BASE}/user/${s.userId}" target="_blank" class="senate-table-link">↗</a></td>
    `;
    tbody.appendChild(tr);
  });
  table.querySelectorAll('th[data-sort]').forEach(th => {
    th.style.cursor = 'pointer';
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (_sortKey === key) _sortDir *= -1;
      else { _sortKey = key; _sortDir = 1; }
      _applyFiltersAndRender();
    });
  });
  container.appendChild(table);
  subtitle.textContent = t('senate_subtitle_count', { seats: seats.length, factions: new Set(seats.map(s => s.partyId)).size });
}

// ── CHROME (built once): unhide title/controls, add fixed right sidebar + bottom bar ──
function _ensureChrome() {
  if (_chromeBuilt) return;
  _chromeBuilt = true;
  _injectStyles();

  const stage = document.querySelector('.senate-stage');
  if (!stage) return;

  const titleWrap = document.getElementById('senateTitle')?.closest('.senate-title-wrap');
  const controls = stage.querySelector('.senate-controls');
  if (titleWrap) titleWrap.style.display = '';
  if (controls) controls.style.display = '';

  const sidebar = document.createElement('div');
  sidebar.id = 'senatePartySidebar';
  sidebar.className = 'senate-party-sidebar';
  stage.appendChild(sidebar);

  const bar = document.createElement('div');
  bar.id = 'senateStatsBar';
  bar.className = 'senate-stats-bar';
  stage.appendChild(bar);

  const countryBox = document.createElement('div');
  countryBox.id = 'senateCountryBox';
  countryBox.className = 'senate-country-box';
  stage.appendChild(countryBox);

  const govBox = document.createElement('div');
  govBox.id = 'senateGovBox';
  govBox.className = 'senate-gov-box';
  stage.appendChild(govBox);
}

// ── BOX NAZIONE (alto sx): bandiera + nome grandi, voti totali e seggi
// dell'elezione attualmente mostrata ──
function _countryCode(country) {
  if (!country) return _countryCodesMap.get(currentCountryId) || '';
  const raw = country.code || country.countryCode || country.iso || country.isoCode || country.abbr || country.abbreviation || _countryCodesMap.get(currentCountryId) || '';
  if (!raw && !country._flagWarned) {
    country._flagWarned = true;
    console.warn('Senate: nessun campo codice-paese riconosciuto su questo oggetto country, bandiera non mostrabile:', country);
  }
  return raw;
}

function _flagMarkup(country) {
  const code = String(_countryCode(country)).toLowerCase();
  const nameForInitials = country?.name || countryNamesMap.get(currentCountryId) || '?';
  const initials = escapeHtml(nameForInitials.trim().slice(0, 2).toUpperCase());
  if (code) {
    const url = `https://app.warera.io/images/upload/map/${code}.png?v=21`;
    // Se l'immagine non si carica (codice sbagliato/mancante), sostituiamo
    // al volo con le iniziali invece di mostrare un'icona rotta.
    return `<img src="${url}" class="scb-flag-img" alt="" onerror="this.outerHTML='<span class=&quot;scb-flag-fallback&quot;>${initials}</span>'">`;
  }
  return `<span class="scb-flag-fallback">${initials}</span>`;
}

// Formattazione compatta per numeri grandi (wealth, damage, ecc.) — stile
// coerente con nationTooltip.js, ma tenuta locale per non introdurre una
// dipendenza cross-file.
function _fmtCompact(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return Math.round(n).toLocaleString();
}

// Riga superiore col governo in carica: presidente al centro, evidenziato
// e più grande, ministri/vice ai lati (più piccoli). Ogni ruolo è mostrato
// solo se abbiamo effettivamente i dati dell'utente (avatar/nome).
function _renderGovernmentRow() {
  const gov = _govData;
  if (!gov || !gov.presidentData) return '';

  // All roles in display order: president first, then all others
  const allRoles = [
    ['vicePresidentData',       t('senate_role_vp')],
    ['minOfDefenseData',        t('senate_role_defense')],
    ['minOfEconomyData',        t('senate_role_economy')],
    ['minOfForeignAffairsData', t('senate_role_foreign')],
  ];

  // Additional roles that may exist in the gov object but aren't named above
  const knownKeys = new Set(['presidentData', 'vicePresidentData', 'minOfDefenseData', 'minOfEconomyData', 'minOfForeignAffairsData']);
  Object.keys(gov).forEach(k => {
    if (!knownKeys.has(k) && gov[k] && gov[k].username) {
      // Humanise the key: e.g. "minOfJusticeData" → "Min. of Justice"
      const label = k.replace(/Data$/, '').replace(/([A-Z])/g, ' $1').replace(/^min of /i, 'Min. of ').trim();
      allRoles.push([k, label]);
    }
  });

  const memberHtml = (key, label, isBig = false) => {
    const user = gov[key];
    if (!user) return '';
    const sizeClass = isBig ? 'scb-gov-avatar scb-gov-avatar-president' : 'scb-gov-avatar';
    const avatarHtml = user.avatarUrl
      ? `<img src="${user.avatarUrl}" class="${sizeClass}" alt="" loading="lazy">`
      : `<div class="${sizeClass} scb-gov-avatar-fallback">👤</div>`;
    return `
      <div class="scb-gov-member${isBig ? ' scb-gov-member-president' : ''}">
        ${avatarHtml}
        <div class="scb-gov-member-info">
          <div class="scb-gov-member-name">${escapeHtml(user.username || '—')}</div>
          <div class="scb-gov-member-role">${escapeHtml(label)}</div>
        </div>
      </div>`;
  };

  return `
    <div class="scb-gov-box">
      <div class="scb-gov-title">⚖️ ${t('senate_government_label') || 'Government'}</div>
      <div class="scb-gov-president-row">
        ${memberHtml('presidentData', t('senate_role_president') || 'President', true)}
      </div>
      <div class="scb-gov-members-grid">
        ${allRoles.map(([key, label]) => memberHtml(key, label)).join('')}
      </div>
    </div>
  `;
}

function _renderCountryBox(seats) {
  const box = document.getElementById('senateCountryBox');
  if (!box) return;
  const countryName = countryNamesMap.get(currentCountryId) || currentCountryId || '—';
  const totalVotes = _parties.reduce((s, p) => s + (p.votes || 0), 0);
  const totalSeats = seats.length;
  const factionsInSenate = new Set(seats.map(s => s.partyId)).size;

  const c = (currentCountryData && currentCountryData._id === currentCountryId) ? currentCountryData : null;
  const activePop = c?.rankings?.countryActivePopulation?.value;
  const development = c?.development ?? c?.rankings?.countryDevelopment?.value;
  const wealth = c?.rankings?.countryWealth?.value;
  const unrestPct = (c?.unrest?.barMax) ? Math.min(100, (c.unrest.bar / c.unrest.barMax) * 100) : null;
  const warsCount = c?.warsWith?.length;
  const alliesCount = c?.allies?.length;
  const rulingPartyName = c?.rulingParty ? (partyNamesMap.get(c.rulingParty) || null) : null;
  const totalParties = (_totalPartiesCountryId === currentCountryId) ? _totalPartiesCount : null;

  // Statistiche "secondarie": ogni entry viene mostrata solo se il dato è
  // effettivamente disponibile, per non riempire la box di trattini "—"
  // quando currentCountryData non ha ancora un certo campo.
  const extraStats = [];
  if (development != null) extraStats.push([development.toFixed(1), t('senate_development_label')]);
  if (activePop != null) extraStats.push([_fmt(activePop), t('population_label')]);
  extraStats.push([factionsInSenate, t('senate_parties_label')]);
  if (totalParties != null) extraStats.push([totalParties, t('senate_parties_total_label')]);
  if (wealth != null) extraStats.push(['💰 ' + _fmtCompact(wealth), t('senate_wealth_label')]);
  if (unrestPct != null) extraStats.push([unrestPct.toFixed(0) + '%', t('senate_unrest_label')]);
  if (warsCount != null) extraStats.push([warsCount, t('senate_wars_label')]);
  if (alliesCount != null) extraStats.push([alliesCount, t('senate_allies_label')]);
  if (rulingPartyName) extraStats.push([escapeHtml(rulingPartyName), t('senate_ruling_party_label')]);

  box.innerHTML = `
    <div class="scb-top">
      ${_flagMarkup(currentCountryData)}
      <div class="scb-name">${escapeHtml(countryName)}</div>
    </div>
    <div class="scb-stats">
      <div class="scb-stat"><span class="scb-stat-val">${_fmt(totalVotes)}</span><span class="scb-stat-label">${t('senate_total_votes_label') || 'Total votes'}</span></div>
      <div class="scb-stat"><span class="scb-stat-val">${_fmt(totalSeats)}</span><span class="scb-stat-label">${t('senate_seats_label') || 'Seats'}</span></div>
    </div>
    ${extraStats.length ? `
    <div class="scb-stats scb-stats-extra">
      ${extraStats.map(([val, label]) => `<div class="scb-stat"><span class="scb-stat-val">${val}</span><span class="scb-stat-label">${label}</span></div>`).join('')}
    </div>` : ''}
  `;

  // Government box: separate element, centered on the arc area (not the full window)
  let govBox = document.getElementById('senateGovBox');
  if (!govBox) {
    govBox = document.createElement('div');
    govBox.id = 'senateGovBox';
    govBox.className = 'senate-gov-box';
    document.querySelector('.senate-stage')?.appendChild(govBox);
  }
  govBox.innerHTML = _renderGovernmentRow();
}

// ── RIGHT SIDEBAR: every party, every member, every vote count — all
// visible at once, no click needed to see who has how many votes ──
function _renderPartySidebar(seats) {
  const sidebar = document.getElementById('senatePartySidebar');
  if (!sidebar) return;
  if (!seats.length) { sidebar.innerHTML = `<div class="sps-empty">${t('senate_empty_title')}</div>`; return; }

  const partyMap = new Map();
  seats.forEach(s => {
    if (!partyMap.has(s.partyId)) {
      partyMap.set(s.partyId, { id: s.partyId, name: s.party, color: s.color, seats: 0, members: [], totalVotes: 0 });
    }
    const p = partyMap.get(s.partyId);
    p.seats++;
    p.members.push(s);
    p.totalVotes += (s.userVotes || 0);
  });
  const parties = Array.from(partyMap.values()).sort((a, b) => b.seats - a.seats);
  const totalSeats = seats.length;

  sidebar.innerHTML = parties.map(p => {
    p.members.sort((a, b) => (b.userVotes || 0) - (a.userVotes || 0));
    const seatPct = totalSeats ? ((p.seats / totalSeats) * 100).toFixed(1) : '0.0';
    const membersHtml = p.members.map(m => {
      const pct = p.totalVotes > 0 ? ((m.userVotes || 0) / p.totalVotes * 100).toFixed(1) : '0.0';
      const avatar = m.avatarUrl
        ? `<span class="sps-avatar" style="background-image:url('${m.avatarUrl}')"></span>`
        : `<span class="sps-avatar sps-avatar-fallback">${(m.username || '?')[0].toUpperCase()}</span>`;
      return `
        <div class="sps-member" data-uid="${m.userId || ''}">
          ${avatar}
          <span class="sps-member-name">${escapeHtml(m.username || '—')}</span>
          <span class="sps-member-votes">${_fmt(m.userVotes || 0)}</span>
          <span class="sps-member-pct">${pct}%</span>
        </div>`;
    }).join('');

    return `
      <div class="sps-party" style="--pc:${p.color}">
        <div class="sps-party-header">
          <span class="sps-dot" style="background:${p.color}"></span>
          <span class="sps-party-name">${escapeHtml(p.name)}</span>
          <span class="sps-party-seats">${p.seats} (${seatPct}%)</span>
        </div>
        <div class="sps-party-votes">🗳 ${_fmt(p.totalVotes)} ${t('votes_suffix')}</div>
        <div class="sps-members">${membersHtml}</div>
      </div>`;
  }).join('');

  sidebar.querySelectorAll('.sps-member').forEach(el => {
    el.addEventListener('click', () => {
      const uid = el.getAttribute('data-uid');
      if (uid) window.open(`${APP_BASE}/user/${uid}`, '_blank');
    });
  });
}

// ── BOTTOM BAR: seat totals, majority threshold, coalition composition strip ──
function _renderStatsBar(seats) {
  const bar = document.getElementById('senateStatsBar');
  if (!bar) return;
  if (!seats.length) { bar.innerHTML = `<span class="ssb-chip">${t('senate_empty_title')}</span>`; return; }

  const partyMap = new Map();
  seats.forEach(s => {
    if (!partyMap.has(s.partyId)) partyMap.set(s.partyId, { name: s.party, color: s.color, seats: 0 });
    partyMap.get(s.partyId).seats++;
  });
  const parties = Array.from(partyMap.values()).sort((a, b) => b.seats - a.seats);
  const totalSeats = seats.length;
  const majority = Math.floor(totalSeats / 2) + 1;

  bar.innerHTML = `
    <span class="ssb-chip">${t('col_seats') || 'Seats'} <b>${totalSeats}</b></span>
    <span class="ssb-chip">${t('stat_majority') || 'Majority'} <b>${majority}</b></span>
    <div class="ssb-track">
      ${parties.map(p => `<div class="ssb-seg" style="width:${(p.seats / totalSeats * 100)}%;background:${p.color}" title="${escapeHtml(p.name)} · ${p.seats}"></div>`).join('')}
    </div>
    <span class="ssb-chip">${parties.length} ${t('senate_factions_label') || 'groups'}</span>
  `;
}

// CSS iniettato in document.head — ri-scopato sotto #wp-political-root
// con lo stesso script postcss di Stage 5 (vedi header del file).
function _injectStyles() {
  if (document.getElementById('senateSidebarStyles')) return;
  const style = document.createElement('style');
  style.id = 'senateSidebarStyles';
  style.textContent = `
    #wp-political-root .senate-party-sidebar {
      position:absolute; top:0; right:0; bottom:${BOTTOMBAR_H}px; width:${SIDEBAR_W}px; z-index:40;
      overflow-y:auto; padding:16px 14px 20px;
      background: linear-gradient(180deg, rgba(10,8,6,.92), rgba(8,6,5,.88));
      border-left: 1px solid rgba(197,150,74,.15);
      font-family:"Sora",sans-serif; color:#dde2ec;
    }
    #wp-political-root .sps-empty { margin-top:40%; text-align:center; color:#5f6a80; font-size:.82rem; }
    #wp-political-root .sps-party {
      margin-bottom:16px; padding-bottom:14px; border-bottom:1px solid rgba(255,255,255,.06);
    }
    #wp-political-root .sps-party:last-child { border-bottom:none; }
    #wp-political-root .sps-party-header { display:flex; align-items:center; gap:8px; }
    #wp-political-root .sps-dot { width:10px; height:10px; border-radius:50%; flex:0 0 auto; box-shadow:0 0 8px -1px var(--pc); }
    #wp-political-root .sps-party-name {
      font-size:.8rem; font-weight:700; color:#f2e6c8; flex:1; min-width:0;
      white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
    }
    #wp-political-root .sps-party-seats { font-size:.68rem; font-weight:700; color:#e8c97a; flex:0 0 auto; }
    #wp-political-root .sps-party-votes { font-size:.66rem; color:#8892a4; margin:3px 0 8px 18px; }
    #wp-political-root .sps-members { display:flex; flex-direction:column; gap:4px; }
    #wp-political-root .sps-member {
      display:flex; align-items:center; gap:7px; padding:5px 6px; border-radius:7px;
      background: rgba(255,255,255,.02); cursor:pointer; transition: background .15s ease;
    }
    #wp-political-root .sps-member:hover { background: rgba(255,255,255,.06); }
    #wp-political-root .sps-avatar {
      width:22px; height:22px; border-radius:50%; flex:0 0 auto; background-color:#1a1410;
      background-size:cover; background-position:center; border:1px solid rgba(232,201,122,.3);
      display:flex; align-items:center; justify-content:center; font-size:.62rem; color:#e8c97a;
    }
    #wp-political-root .sps-member-name { font-size:.72rem; flex:1; min-width:0; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
    #wp-political-root .sps-member-votes { font-size:.7rem; font-weight:700; color:#e8c97a; flex:0 0 auto; }
    #wp-political-root .sps-member-pct { font-size:.62rem; color:#8892a4; flex:0 0 auto; width:34px; text-align:right; }

    #wp-political-root .senate-stats-bar {
      position:absolute; left:0; right:${SIDEBAR_W}px; bottom:0; height:${BOTTOMBAR_H}px; z-index:40;
      display:flex; align-items:center; gap:14px; padding:0 18px;
      background: linear-gradient(180deg, rgba(8,6,5,.9), rgba(6,5,4,.98));
      border-top:1px solid rgba(197,150,74,.12);
      font-family:"Sora",sans-serif; font-size:.72rem; color:#c9c4b8;
    }
    #wp-political-root .ssb-chip { white-space:nowrap; }
    #wp-political-root .ssb-chip b { color:#e8c97a; }
    #wp-political-root .ssb-track { flex:1; height:10px; border-radius:5px; overflow:hidden; display:flex; box-shadow: inset 0 0 0 1px rgba(255,255,255,.08); }
    #wp-political-root .ssb-seg { height:100%; transition: width .5s ease; }

    #wp-political-root .senate-country-box {
      position:absolute; top:120px; left:16px; z-index:35;
      display:flex; flex-direction:column; gap:10px; padding:12px 16px;
      background: linear-gradient(160deg, rgba(20,16,12,.85), rgba(10,8,6,.8));
      border:1px solid rgba(197,150,74,.18); border-radius:12px;
      backdrop-filter: blur(6px);
      font-family:"Sora",sans-serif; pointer-events:none;
      max-width: 320px;
    }
    #wp-political-root .scb-top { display:flex; align-items:center; gap:10px; }
    #wp-political-root .scb-flag-img { width:40px; height:28px; object-fit:cover; border-radius:4px; box-shadow:0 0 0 1px rgba(255,255,255,.15); flex:0 0 auto; }
    #wp-political-root .scb-flag-fallback {
      width:40px; height:28px; border-radius:4px; flex:0 0 auto;
      display:flex; align-items:center; justify-content:center;
      background: rgba(197,150,74,.15); color:#e8c97a; font-weight:700; font-size:.72rem;
      box-shadow:0 0 0 1px rgba(255,255,255,.1);
    }
    /* ── GOVERNMENT BOX: centrata sull'area emiciclo (non sull'intera finestra) ── */
    #wp-political-root .senate-gov-box {
      position: absolute;
      /* Centrata orizzontalmente sull'area emiciclo: metà di (100% - SIDEBAR_W) */
      left: 0;
      right: ${SIDEBAR_W}px;
      bottom: ${BOTTOMBAR_H + 10}px;
      display: flex;
      justify-content: center;
      pointer-events: none;
      z-index: 36;
    }
    #wp-political-root .scb-gov-box {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px 16px;
      background: linear-gradient(160deg, rgba(20,16,12,.9), rgba(10,8,6,.85));
      border: 1px solid rgba(197,150,74,.22);
      border-radius: 12px;
      backdrop-filter: blur(8px);
      font-family: "Sora", sans-serif;
      pointer-events: auto;
      max-width: 480px;
      min-width: 220px;
    }
    #wp-political-root .scb-gov-title {
      font-size: .65rem;
      font-weight: 700;
      color: #e8c97a;
      text-transform: uppercase;
      letter-spacing: .07em;
      margin-bottom: 2px;
    }
    #wp-political-root .scb-gov-president-row {
      display: flex;
      justify-content: center;
      padding-bottom: 8px;
      border-bottom: 1px solid rgba(197,150,74,.15);
    }
    #wp-political-root .scb-gov-members-grid {
      display: flex;
      flex-wrap: wrap;
      gap: 6px 10px;
      justify-content: center;
    }
    #wp-political-root .scb-gov-member {
      display: flex;
      align-items: center;
      gap: 7px;
      padding: 4px 8px;
      border-radius: 8px;
      background: rgba(255,255,255,.03);
      min-width: 0;
    }
    #wp-political-root .scb-gov-member-president {
      padding: 6px 14px;
      background: rgba(232,201,122,.07);
      border: 1px solid rgba(232,201,122,.18);
    }
    #wp-political-root .scb-gov-member-info {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }
    #wp-political-root .scb-gov-member-name {
      font-size: .74rem;
      font-weight: 700;
      color: #f2e6c8;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 110px;
    }
    #wp-political-root .scb-gov-member-president .scb-gov-member-name {
      font-size: .82rem;
      max-width: 140px;
    }
    #wp-political-root .scb-gov-member-role {
      font-size: .6rem;
      color: #8892a4;
      text-transform: uppercase;
      letter-spacing: .04em;
      white-space: nowrap;
    }
    #wp-political-root .scb-gov-member-president .scb-gov-member-role {
      color: #e8c97a;
    }
    #wp-political-root .scb-gov-avatar {
      width: 28px;
      height: 28px;
      border-radius: 50%;
      object-fit: cover;
      flex: 0 0 auto;
      box-shadow: 0 0 0 1px rgba(255,255,255,.15);
    }
    #wp-political-root .scb-gov-avatar-fallback {
      display: flex;
      align-items: center;
      justify-content: center;
      background: rgba(197,150,74,.15);
      font-size: .8rem;
    }
    #wp-political-root .scb-gov-avatar-president {
      width: 44px;
      height: 44px;
      box-shadow: 0 0 0 2px #e8c97a, 0 0 14px -2px rgba(232,201,122,.7);
    }
    #wp-political-root .scb-name { font-size:1.05rem; font-weight:700; color:#f2e6c8; line-height:1.15; }
    #wp-political-root .scb-stats { display:flex; flex-wrap:wrap; gap:14px 18px; }
    #wp-political-root .scb-stats-extra { padding-top:8px; border-top:1px solid rgba(197,150,74,.15); }
    #wp-political-root .scb-stat { display:flex; flex-direction:column; min-width:0; }
    #wp-political-root .scb-stat-val { font-size:1rem; font-weight:700; color:#e8c97a; line-height:1.2; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:110px; }
    #wp-political-root .scb-stats-extra .scb-stat-val { font-size:.86rem; }
    #wp-political-root .scb-stat-label { font-size:.62rem; color:#8892a4; text-transform:uppercase; letter-spacing:.03em; }

    @media (max-width: 1000px) {
      #wp-political-root .senate-party-sidebar { width:0; padding:0; border:none; overflow:hidden; }
      #wp-political-root .senate-country-box { display:none; }
      #wp-political-root .senate-gov-box { display:none; }
      #wp-political-root .senate-stats-bar { right:0; }
      /* Su mobile la vista ad arco è disattivata (card troppo piccole per
         essere leggibili): il toggle non ha più senso, si resta sempre
         in tabella. */
      #wp-political-root #senateViewToggle { display:none; }
      /* La tabella su mobile deve essere scorribile: il container è
         pensato per l'arco (posizionamento assoluto, spesso senza
         overflow), quindi qui lo forziamo esplicitamente per non perdere
         righe oltre lo schermo. overflow-x per tabelle più larghe dello
         schermo, padding-bottom per non finire nascosti dietro la barra
         statistiche fissa in basso. */
      #wp-political-root #senateSeats {
        overflow-y: auto !important;
        overflow-x: auto !important;
        -webkit-overflow-scrolling: touch;
        padding-bottom: ${BOTTOMBAR_H + 16}px;
        box-sizing: border-box;
      }
      #wp-political-root .senate-table { width: 100%; border-collapse: collapse; }
      #wp-political-root .senate-table thead th {
        position: sticky; top: 0; z-index: 5;
        background: #0e0b09;
      }
    }
  `;
  document.head.appendChild(style);
}

function _applyFiltersAndRender() {
  const all = _flattenSeats(_parties);
  const filtered = _filterSeats(all);
  const sorted = _sortSeats(filtered);
  _filtered = sorted;

  _ensureChrome();

  if (_viewMode === 'semicircle') {
    _renderSemicircle(sorted);
  } else {
    _renderTable(sorted);
  }

  // La colonna partiti e la barra statistiche mostrano sempre l'intera
  // assemblea (non risentono della ricerca testuale), così restano un
  // riferimento stabile mentre si filtra/cerca nell'arco o nella tabella.
  _renderPartySidebar(all);
  _renderStatsBar(all);
  _renderCountryBox(all);
}

// ── PUBLIC API ──
export function render(parties) {
  _parties = parties || [];
  _applyFiltersAndRender();

  const filterSelect = document.getElementById('senatePartyFilter');
  if (filterSelect) {
    const currentVal = filterSelect.value;
    const uniqueParties = [];
    const seen = new Set();
    _flattenSeats(_parties).forEach(s => {
      if (s.partyId && !seen.has(s.partyId)) {
        seen.add(s.partyId);
        uniqueParties.push({ id: s.partyId, name: s.party });
      }
    });
    filterSelect.innerHTML = `<option value="all">${t('all_parties')}</option>`;
    uniqueParties.sort((a, b) => a.name.localeCompare(b.name));
    uniqueParties.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.name;
      filterSelect.appendChild(opt);
    });
    if (currentVal && seen.has(currentVal)) filterSelect.value = currentVal;
    else filterSelect.value = 'all';
  }
}

// ── SELETTORI NAZIONE + ELEZIONE (dentro la vista senato) ──
// Riusano lo stato globale dell'app (currentCountryId, loadElection, ecc.)
// così cambiare nazione/elezione da qui resta coerente col resto della UI
// (countrySelect principale, congress-view dietro le quinte) anche quando
// si richiude l'overlay.
async function _populateSenateSelectors() {
  const countrySel = document.getElementById('senateCountrySelect');
  const electionSel = document.getElementById('senateElectionSelect');
  if (!countrySel || !electionSel) return;

  if (!countrySel._loaded) {
    try {
      // Fase 2 follow-up: elenco condiviso con Diplomacy (src/shared/countries.js).
      const raw = await getAllCountries();
      const items = raw.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      countrySel.innerHTML = '';
      items.forEach(c => {
        countryNamesMap.set(c._id, c.name);
        const codeAlias = c.code || c.countryCode || c.iso || c.isoCode || c.abbr || c.abbreviation;
        if (codeAlias) _countryCodesMap.set(c._id, String(codeAlias).toLowerCase());
        const opt = document.createElement('option');
        opt.value = c._id;
        opt.textContent = c.name || c._id;
        countrySel.appendChild(opt);
      });
      countrySel._loaded = true;
    } catch (err) {
      console.warn('Senate: unable to load countries', err);
    }
  }
  if (countrySel._loaded) countrySel.value = currentCountryId;

  await _populateSenateElections(currentCountryId, electionSel);
}

// Ordina per data di inizio voto reale (più affidabile di createdAt, che
// in alcuni casi non riflette l'ordine cronologico effettivo delle
// elezioni); a parità, l'_id Mongo incorpora un timestamp di creazione ed
// è quindi un buon spareggio.
function _electionSortKey(e) {
  const ts = new Date(e.votesStartAt || e.votesEndAt || e.createdAt || 0).getTime();
  return isNaN(ts) ? 0 : ts;
}
function _sortElectionsDesc(list) {
  return [...list].sort((a, b) => {
    const diff = _electionSortKey(b) - _electionSortKey(a);
    if (diff !== 0) return diff;
    return String(b._id || '').localeCompare(String(a._id || ''));
  });
}

async function _populateSenateElections(countryId, electionSel) {
  electionSel.innerHTML = `<option value="">${t('senate_loading_elections') || '…'}</option>`;
  try {
    const data = await localFetch('/elections', { countryId });
    const congress = _sortElectionsDesc((data?.items || []).filter(e => e.type === 'congress'));
    electionSel.innerHTML = '';
    congress.forEach(e => {
      const opt = document.createElement('option');
      opt.value = e._id;
      opt.textContent = new Date(e.createdAt).toLocaleDateString();
      electionSel.appendChild(opt);
    });
    const keepCurrent = countryId === currentCountryId && currentCongressElectionId &&
      congress.some(e => e._id === currentCongressElectionId);
    electionSel.value = keepCurrent ? currentCongressElectionId : (congress[0]?._id || '');
    return congress;
  } catch (err) {
    console.warn('Senate: unable to load elections', err);
    electionSel.innerHTML = '';
    return [];
  }
}

// Carica l'elezione scelta riusando la pipeline standard dell'app
// (main.js → loadElection → loadCongressElection), che aggiorna
// lastElectedParties (config.js): qui basta poi ridisegnare l'arco con quello.
async function _loadSenateElection(electionId) {
  if (!electionId) return;
  if (subtitle) subtitle.textContent = t('senate_subtitle_loading');
  try {
    if (_loadElection) await _loadElection(electionId);
    render(lastElectedParties || []);
  } catch (err) {
    console.warn('Senate: unable to load election', err);
  }
}

async function _onSenateCountryChange(newCountryId) {
  if (!newCountryId || newCountryId === currentCountryId) return;
  setCurrentCountryId(newCountryId);
  try { localStorage.setItem('preferredCountryId', newCountryId); } catch (_) { }
  // Invalida le cache legate alla nazione precedente: governo e conteggio
  // partiti vanno ricaricati per la nuova nazione selezionata.
  _govData = null; _govDataCountryId = null;
  _totalPartiesCount = null; _totalPartiesCountryId = null;

  // Tiene allineato il selettore nazione principale della pagina (dietro
  // l'overlay), così quando si chiude la vista senato l'app resta coerente.
  const mainSel = document.getElementById('countrySelect');
  if (mainSel?.tomselect) mainSel.tomselect.setValue(newCountryId, true);
  else if (mainSel) mainSel.value = newCountryId;

  try {
    // Fase 2 follow-up: elenco condiviso con Diplomacy invece di una
    // fetch dedicata (era { useCache: false } per forzare freschezza).
    const countries = await getAllCountries();
    setCurrentCountryData(countries.find(c => c._id === newCountryId) || null);
    const codeAlias = currentCountryData?.code || currentCountryData?.countryCode || currentCountryData?.iso || currentCountryData?.isoCode || currentCountryData?.abbr || currentCountryData?.abbreviation;
    if (codeAlias) _countryCodesMap.set(newCountryId, String(codeAlias).toLowerCase());
  } catch (_) { setCurrentCountryData(null); }

  const electionSel = document.getElementById('senateElectionSelect');
  const congress = await _populateSenateElections(newCountryId, electionSel);
  if (electionSel.value) await _loadSenateElection(electionSel.value);
  else {
    setLastElectedParties([]);
    render([]);
  }
  if (!congress.length && emptyMsg) emptyMsg.style.display = 'block';

  // Governo e conteggio partiti della nuova nazione: non bloccano il resto
  // (già renderizzato sopra con i dati elettorali), la box si aggiorna
  // appena pronti.
  Promise.all([_ensureGovernment(), _ensureTotalPartiesCount()])
    .then(() => _renderCountryBox(_flattenSeats(_parties)));
}

// Carica (se serve) i dati della nazione correntemente selezionata: si
// appoggia alla stessa variabile globale currentCountryData usata dal
// resto dell'app (config.js/main.js). Se al momento dell'apertura del
// pannello è già valorizzata per la nazione giusta (caso normale, perché
// main.js la carica al boot prima che l'utente possa aprire il senato),
// non rifà nessuna fetch.
async function _ensureCurrentCountryData() {
  if (currentCountryData?._id === currentCountryId) return;
  try {
    // Fase 2 follow-up: elenco condiviso con Diplomacy invece di una
    // fetch dedicata (era { useCache: false } per forzare freschezza).
    const items = await getAllCountries();
    items.forEach(c => countryNamesMap.set(c._id, c.name));
    setCurrentCountryData(items.find(c => c._id === currentCountryId) || null);
  } catch (err) {
    console.warn('Senate: unable to load current country data', err);
  }
}

// Governo in carica (presidente + ministri) — riusa getGovernmentWithDetails
// già definita in congress.js, iniettata via setSenateDeps (Stage 8).
async function _ensureGovernment() {
  if (_govDataCountryId === currentCountryId && _govData !== null) return;
  _govDataCountryId = currentCountryId;
  try {
    _govData = _getGovernmentWithDetails
      ? await _getGovernmentWithDetails(currentCountryId)
      : null;
  } catch (err) {
    console.warn('Senate: unable to load government', err);
    _govData = null;
  }
}

// Numero totale di partiti registrati nel paese (non solo quelli con seggi
// in senato) — riusa loadPartiesForCountry già definita in congress.js,
// iniettata via setSenateDeps (Stage 8), che come effetto collaterale
// popola anche partyNamesMap per TUTTI i partiti del paese (utile anche
// per risolvere il nome del ruling party).
async function _ensureTotalPartiesCount() {
  if (_totalPartiesCountryId === currentCountryId && _totalPartiesCount !== null) return;
  _totalPartiesCountryId = currentCountryId;
  try {
    const parties = _loadPartiesForCountry
      ? await _loadPartiesForCountry(currentCountryId)
      : [];
    _totalPartiesCount = parties.length;
  } catch (err) {
    console.warn('Senate: unable to load total parties count', err);
    _totalPartiesCount = null;
  }
}

export function open() {
  if (!overlay) return;
  overlay.classList.add('active');
  document.body.style.overflow = 'hidden';
  if (!_resizeListenerBound) {
    _resizeListenerBound = true;
    let timer = null;
    window.addEventListener('resize', () => {
      if (!overlay.classList.contains('active')) return;
      clearTimeout(timer);
      timer = setTimeout(() => _applyFiltersAndRender(), 150);
    });
  }
  _bindControls();
  render(lastElectedParties || []);
  _populateSenateSelectors();
  Promise.all([_ensureCurrentCountryData(), _ensureGovernment(), _ensureTotalPartiesCount()])
    .then(() => _renderCountryBox(_flattenSeats(_parties)));
}

export function close() {
  if (!overlay) return;
  overlay.classList.remove('active');
  document.body.style.overflow = '';
}

function _bindControls() {
  const search = document.getElementById('senateSearch');
  const filter = document.getElementById('senatePartyFilter');
  const toggle = document.getElementById('senateViewToggle');
  const countrySel = document.getElementById('senateCountrySelect');
  const electionSel = document.getElementById('senateElectionSelect');

  if (countrySel && !countrySel._listener) {
    countrySel._listener = true;
    countrySel.addEventListener('change', () => _onSenateCountryChange(countrySel.value));
  }
  if (electionSel && !electionSel._listener) {
    electionSel._listener = true;
    electionSel.addEventListener('change', () => _loadSenateElection(electionSel.value));
  }
  if (search && !search._listener) {
    search._listener = true;
    search.addEventListener('input', () => {
      _searchTerm = search.value.trim();
      _applyFiltersAndRender();
    });
  }
  if (filter && !filter._listener) {
    filter._listener = true;
    filter.addEventListener('change', () => {
      _partyFilter = filter.value;
      _applyFiltersAndRender();
    });
  }
  if (toggle && !toggle._listener) {
    toggle._listener = true;
    toggle.addEventListener('click', () => {
      _viewMode = _viewMode === 'semicircle' ? 'table' : 'semicircle';
      toggle.textContent = _viewMode === 'semicircle' ? '📋 Table' : '🏛️ Arc';
      // Force a reflow before rendering
      requestAnimationFrame(() => {
        _applyFiltersAndRender();
      });
    });
  }
}

/**
 * Lookup DOM (era cattura a top-level dell'IIFE) + wiring dei bottoni
 * open/close (era su document.addEventListener('DOMContentLoaded', ...),
 * mai più utile fuori da un documento iframe a sé stante) — chiamata da
 * main.js (Stage 8) subito dopo il mount del template in #wp-political-root.
 * Idempotente: può essere richiamata più volte senza doppio-wiring grazie
 * ai flag `_listener` già presenti su ciascun elemento (vedi _bindControls).
 */
export function initSenateView() {
  overlay = document.getElementById('senateOverlay');
  seatsContainer = document.getElementById('senateSeats');
  emptyMsg = document.getElementById('senateEmpty');
  subtitle = document.getElementById('senateSubtitle');

  document.getElementById('senateViewBtn')?.addEventListener('click', open);
  document.getElementById('senateCloseBtn')?.addEventListener('click', close);
  overlay?.addEventListener('click', e => {
    if (e.target === overlay) close();
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && overlay?.classList.contains('active')) close();
  });
}

// Namespace di comodo, per i chiamanti (congress.js, Stage 7) che preferiscono
// `SenateView.open()` invece di un import nominale — stesso identificatore
// dell'originale, solo che ora è un oggetto di funzioni già importate invece
// che il valore di ritorno di un IIFE.
export const SenateView = { open, close, render, initSenateView, setSenateDeps };
