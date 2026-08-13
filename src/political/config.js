/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: config & stato condiviso (Fase 2)
   ------------------------------------------------------------------
   Conversione a modulo ES di public/political/config.js. Comportamento
   preservato 1:1 salvo le eccezioni commentate qui sotto — vedi
   C:\Users\franc\.claude\plans\crystalline-sauteeing-scroll.md per il
   piano completo.

   STATO MUTABILE CONDIVISO: in script classici, tutte le `let`
   top-level qui sotto erano leggibili E riassegnabili come
   identificatori nudi da qualunque altro file (stesso ambiente
   lessicale globale). In un modulo ES un `import { x } from './config.js'`
   è un binding LIVE ma READ-ONLY: un consumatore può leggere `x` ma
   `x = y` altrove lancia TypeError. Ogni variabile qui sotto che
   veniva riassegnata da un ALTRO file (verificato con grep su tutto
   public/political/: congress.js, senate.js, party.js, main.js,
   presidential.js) è quindi esposta anche con un setter esplicito —
   i chiamanti convertiti (Stage 6/7/8) useranno il setter al posto
   della riassegnazione diretta.

   ECCEZIONI rispetto all'originale (deliberate, vedi piano):
   - API_BASE: ri-esporta WORKER_API_BASE di src/diplomacy/config.js
     invece di duplicare la stringa — stesso Worker Cloudflare, un
     solo posto da aggiornare. SENZA suffisso /trpc finale (l'originale
     public/political/config.js lo includeva già nella costante;
     src/shared/trpcClient.js aggiunge sempre lui stesso `/trpc/...`,
     quindi includerlo qui produrrebbe un `/trpc/trpc/` rotto).
   - _lastMinVotesToWin: nell'originale party.js scriveva SIA la
     variabile bare SIA `window._lastMinVotesToWin` nella stessa riga
     (in pratica già sincronizzate, non un bug reale come ipotizzato
     in fase di analisi) — qui resta una sola variabile di modulo,
     senza il doppio-write ridondante su window.
   - window.APP_BASE non viene mai realmente scritto nell'originale
     (il fallback `window.APP_BASE || 'https://app.warera.io'` in
     parliament.js non scattava mai) — qui non esiste equivalente,
     chi importava quel fallback userà direttamente APP_BASE.
   ══════════════════════════════════════════════════════════════ */

import Chart from 'chart.js/auto';
import { WORKER_API_BASE } from '../diplomacy/config.js';

export const API_BASE = WORKER_API_BASE; // senza /trpc finale, vedi nota sopra
export const APP_BASE = 'https://app.warera.io';

export const PALETTE = [
  '#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7',
  '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#f43f5e',
  '#6366f1', '#14b8a6', '#d946ef', '#0ea5e9', '#f59e0b',
];

/* ── CACHE TTL (i valori, non l'implementazione — quella vive ora in
   src/shared/trpcClient.js, usata da src/political/api.js) ── */
export const CACHE_TTL_SHORT = 3 * 60 * 1000;
export const CACHE_TTL_LONG  = 60 * 60 * 1000;

/* ── STATO CONDIVISO — Map mutate in-place via .set()/.clear(), MAI
   riassegnate da altri file (verificato via grep): restano `export const`,
   nessun setter necessario, il binding importato punta sempre alla
   stessa istanza. ── */
export const partyColorMap   = new Map();
export const csvColorMap     = new Map();
export const partyNamesMap   = new Map();
export const countryNamesMap = new Map();

/* ── STATO CONDIVISO — riassegnato da altri file: `export let` +
   setter esplicito. ── */
export let seatsChart, membersChart, allPartiesChart, presidentChart, timelineChart, votesChart;
export function setSeatsChart(v)       { seatsChart = v; }
export function setMembersChart(v)     { membersChart = v; }
export function setAllPartiesChart(v)  { allPartiesChart = v; }
export function setPresidentChart(v)   { presidentChart = v; }
export function setTimelineChart(v)    { timelineChart = v; }
export function setVotesChart(v)       { votesChart = v; }

export let pendingRequest = null;
export function setPendingRequest(v) { pendingRequest = v; }

export let electionHistory = [];
export function setElectionHistory(v) { electionHistory = v; }

export let currentCongressElectionId = null;
export function setCurrentCongressElectionId(v) { currentCongressElectionId = v; }

export let timelineElectionIds = [];
export function setTimelineElectionIds(v) { timelineElectionIds = v; }

// Se il tool viene aperto con ?country=<countryId> (es. link da un'app
// esterna) quel valore ha priorità sulla preferenza salvata. Questo resta
// utile finché public/political/index.html (legacy, iframe) è ancora
// servito con il proprio ?country= nella query string dell'iframe stesso;
// nel path in-page (Stage 8+) il countryId arriva invece come parametro
// esplicito a initPoliticalView(countryId), che chiama setCurrentCountryId()
// PRIMA di qualunque fetch — questo valore iniziale letto da location.search
// (quella della pagina SHELL, non più di un iframe separato) resta quindi
// solo un fallback per apertura diretta/debug di questo modulo.
const _urlParams = new URLSearchParams(window.location.search);
const _urlCountryId = _urlParams.get('country');
if (_urlCountryId) { try { localStorage.setItem('preferredCountryId', _urlCountryId); } catch (_) {} }

export let currentCountryId = _urlCountryId || localStorage.getItem('preferredCountryId') || '6813b6d446e731854c7ac7a2';
export function setCurrentCountryId(v) { currentCountryId = v; }

export let currentCountryData = null;
export function setCurrentCountryData(v) { currentCountryData = v; }

export let historicTurnouts = [];
export function setHistoricTurnouts(v) { historicTurnouts = v; }

export let congressCountdownInterval = null;
export function setCongressCountdownInterval(v) { congressCountdownInterval = v; }

export let latestPresidentialElectionId = null;
export function setLatestPresidentialElectionId(v) { latestPresidentialElectionId = v; }

export let currentIsLatestPresidential = false;
export function setCurrentIsLatestPresidential(v) { currentIsLatestPresidential = v; }

export let currentPartyId = localStorage.getItem('preferredPartyId') || null;
export function setCurrentPartyId(v) { currentPartyId = v; }

export let currentPartyData = null;
export function setCurrentPartyData(v) { currentPartyData = v; }

export let lastCongressElection = null;
export function setLastCongressElection(v) { lastCongressElection = v; }

export let minVotesToWin = 0; // era _lastMinVotesToWin, vedi nota "ECCEZIONI" in testa al file
export function setMinVotesToWin(v) { minVotesToWin = v; }

/* AGGIUNTA Stage 6 (non presente nell'originale config.js): window._lastElectedParties
   nell'originale era scritto da congress.js e letto/scritto da senate.js —
   stato condiviso tra due file "pari grado", non owned da nessuno dei due.
   Va quindi qui, nell'hub di stato condiviso, invece che in uno dei due
   moduli che lo consumano (evita un altro giro di dipendenza incrociata). */
export let lastElectedParties = [];
export function setLastElectedParties(v) { lastElectedParties = v; }

/* ── THEME ── */
export function getTheme() { return document.documentElement.getAttribute('data-theme') || 'dark'; }
export function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('we_theme', t);
  const b = document.getElementById('themeToggle');
  if (b) b.textContent = t === 'dark' ? '☀️' : '🌙';
}
export function initTheme() {
  applyTheme(localStorage.getItem('we_theme') ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
}

/**
 * toggleTheme chiama in avanti loadElection (main.js), renderAllPartiesChart
 * (congress.js), loadPresidentialElection (presidential.js) — nell'originale
 * erano identificatori nudi risolti a runtime (mai a top-level, quindi
 * "funzionava" anche con l'ordine di caricamento script → moduli dopo).
 * Qui restano dipendenze cross-modulo esplicite: import diretto avrebbe
 * creato un ciclo (congress.js/presidential.js importano già config.js),
 * quindi toggleTheme accetta questi tre callback come parametri iniettati
 * da chi orchestra l'app (src/political/main.js, Stage 8) invece di
 * importarli qui — stesso comportamento, dipendenza esplicita anziché
 * implicita nel binding globale.
 */
export function toggleTheme({ loadElection, renderAllPartiesChart, loadPresidentialElection, safeDestroy, lastAllParties, lastPresData } = {}) {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
  setTimeout(() => {
    if (document.getElementById('congress-view').style.display !== 'none' && currentCongressElectionId) {
      loadElection?.(currentCongressElectionId);
    } else if (lastAllParties) {
      renderAllPartiesChart?.(lastAllParties);
    } else if (document.getElementById('president-view').style.display !== 'none' && lastPresData?.election) {
      loadPresidentialElection?.(lastPresData.election, currentIsLatestPresidential);
    }
    if (votesChart) { safeDestroy?.('votesChart'); }
  }, 50);
}

export function chartTheme() {
  const L = getTheme() === 'light';
  return {
    tt:     { backgroundColor: L ? '#fff' : '#0f1521', borderColor: L ? 'rgba(155,115,45,.4)' : 'rgba(197,150,74,.3)', borderWidth: 1, titleColor: L ? '#b8860b' : '#e8c97a', bodyColor: L ? '#4a5568' : '#8892a4', padding: 10, cornerRadius: 6 },
    tick:   L ? '#6b7280' : '#535e72',
    tick2:  L ? '#374151' : '#8892a4',
    grid:   L ? 'rgba(0,0,0,0.07)'  : 'rgba(255,255,255,0.04)',
    border: L ? 'rgba(0,0,0,0.12)'  : 'rgba(255,255,255,0.07)',
    legend: L ? '#374151' : '#8892a4',
  };
}

/* ── CHART PLUGIN: centerText ── */
const centerTextPlugin = {
  id: 'centerText',
  afterDraw(chart) {
    if (!chart.config.options.plugins?.centerText?.text) return;
    const { ctx, chartArea: { left, top, right, bottom } } = chart;
    const cx = (left + right) / 2;
    const cy = bottom * 0.92;
    const cfg = chart.config.options.plugins.centerText;
    ctx.save();
    ctx.font = `700 ${cfg.fontSize || 16}px "Playfair Display", serif`;
    ctx.fillStyle = cfg.color || '#e8c97a';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(cfg.text, cx, cy);
    if (cfg.sub) {
      ctx.font = `400 ${(cfg.fontSize || 16) * 0.6}px "Sora", sans-serif`;
      ctx.fillStyle = cfg.subColor || '#8892a4';
      ctx.fillText(cfg.sub, cx, cy + (cfg.fontSize || 16));
    }
    ctx.restore();
  }
};
Chart.register(centerTextPlugin);

/* ── UTILS ── */
export function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}
export function makeAbbr(name) {
  if (!name || typeof name !== 'string') return 'N/A';
  const clean = name.replace(/['’‘]/g, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!clean) return 'N/A';
  return clean.split(' ').filter(w => w.length > 0).map(w => w[0]).slice(0, 3).join('').toUpperCase() || 'N/A';
}
export function stringToColor(str) {
  if (!str || typeof str !== 'string') return '#888888'; // fallback grigio
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  let color = '#';
  for (let i = 0; i < 3; i++) color += ('00' + ((hash >> (i * 8)) & 0xFF).toString(16)).slice(-2);
  return color;
}
export function getPartyColor(partyId) {
  if (csvColorMap.has(partyId))   return csvColorMap.get(partyId);
  if (partyColorMap.has(partyId)) return partyColorMap.get(partyId);
  const color = stringToColor(partyId);
  partyColorMap.set(partyId, color);
  return color;
}
