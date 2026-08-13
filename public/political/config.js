/* ═══ CONFIG & GLOBALS ═══ */
/* ── API ufficiale WarEra (tRPC) ──
   Il Cloudflare Worker + cache-service (duckdns) sono stati rimossi:
   l'app parla ora direttamente con le API ufficiali. */
const API_BASE = 'https://politicalview-proxy.fra-paradiso2.workers.dev/trpc';
const APP_BASE = 'https://app.warera.io';

const PALETTE = [
  '#3b82f6', '#22c55e', '#eab308', '#ef4444', '#a855f7',
  '#f97316', '#06b6d4', '#ec4899', '#84cc16', '#f43f5e',
  '#6366f1', '#14b8a6', '#d946ef', '#0ea5e9', '#f59e0b',
];

/* ── CACHE ── */
const CACHE_TTL_SHORT = 3 * 60 * 1000;
const CACHE_TTL_LONG  = 60 * 60 * 1000;

/* ── STATE ── */
let _partyColorMap   = new Map();
let _csvColorMap     = new Map();
let _partyNamesMap   = new Map();
let _countryNamesMap = new Map();
let _seatsChart, _membersChart, _allPartiesChart, _presidentChart, _timelineChart, _votesChart;
let _apiKey                      = sessionStorage.getItem('we_key') || '';
let _pendingRequest              = null;
let _electionHistory             = [];
let _currentCongressElectionId   = null;
let _timelineElectionIds         = [];
// Se il tool viene aperto con ?country=<countryId> (es. link da un'app esterna),
// quel valore ha priorità sulla preferenza salvata in precedenza.
const _urlParams      = new URLSearchParams(window.location.search);
const _urlCountryId   = _urlParams.get('country');
if (_urlCountryId) { try { localStorage.setItem('preferredCountryId', _urlCountryId); } catch (_) {} }
let _currentCountryId            = _urlCountryId || localStorage.getItem('preferredCountryId') || '6813b6d446e731854c7ac7a2';
let _currentCountryData          = null;
let _historicTurnouts            = [];
let _congressCountdownInterval   = null;
let _latestPresidentialElectionId = null;
let _currentIsLatestPresidential  = false;
let _currentPartyId              = localStorage.getItem('preferredPartyId') || null;
let _currentPartyData            = null;
let _lastCongressElection        = null;
let _lastMinVotesToWin           = 0;

/* ── THEME ── */
function getTheme() { return document.documentElement.getAttribute('data-theme') || 'dark'; }
function applyTheme(t) {
  document.documentElement.setAttribute('data-theme', t);
  localStorage.setItem('we_theme', t);
  const b = document.getElementById('themeToggle');
  if (b) b.textContent = t === 'dark' ? '☀️' : '🌙';
}
function initTheme() {
  applyTheme(localStorage.getItem('we_theme') ||
    (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
}
function toggleTheme() {
  applyTheme(getTheme() === 'dark' ? 'light' : 'dark');
  setTimeout(() => {
    if (document.getElementById('congress-view').style.display !== 'none' && _currentCongressElectionId) {
      loadElection(_currentCongressElectionId);
    } else if (window._lastAllParties) {
      renderAllPartiesChart(window._lastAllParties);
    } else if (document.getElementById('president-view').style.display !== 'none' && window._lastPresData?.election) {
      loadPresidentialElection(window._lastPresData.election, _currentIsLatestPresidential);
    }
    if (_votesChart) { safeDestroy('votesChart'); }
  }, 50);
}
function chartTheme() {
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

/* ── CACHE FUNCTIONS ── */
function cacheKey(path, params) { return 'we_' + path + '_' + JSON.stringify(params); }
function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const { data, ts, ttl } = JSON.parse(raw);
    if (Date.now() - ts > ttl) { localStorage.removeItem(key); return null; }
    return data;
  } catch (_) { return null; }
}
function cacheSet(key, data, ttl) {
  try { localStorage.setItem(key, JSON.stringify({ data, ts: Date.now(), ttl })); } catch (_) {}
}
function cacheClear() {
  try { Object.keys(localStorage).filter(k => k.startsWith('we_')).forEach(k => localStorage.removeItem(k)); } catch (_) {}
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
function escapeHtml(str) {
  if (!str) return '';
  return str.replace(/[&<>]/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[m]));
}
function makeAbbr(name) {
  if (!name || typeof name !== 'string') return 'N/A';
  const clean = name.replace(/['’‘]/g, '')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ').trim();
  if (!clean) return 'N/A';
  return clean.split(' ').filter(w => w.length > 0).map(w => w[0]).slice(0, 3).join('').toUpperCase() || 'N/A';
}
function stringToColor(str) {
  if (!str || typeof str !== 'string') return '#888888'; // fallback grigio
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  let color = '#';
  for (let i = 0; i < 3; i++) color += ('00' + ((hash >> (i * 8)) & 0xFF).toString(16)).slice(-2);
  return color;
}
function getPartyColor(partyId) {
  if (_csvColorMap.has(partyId))   return _csvColorMap.get(partyId);
  if (_partyColorMap.has(partyId)) return _partyColorMap.get(partyId);
  const color = stringToColor(partyId);
  _partyColorMap.set(partyId, color);
  return color;
}
