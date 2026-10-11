/* ══════════════════════════════════════════════════════════════
   WarEra+ — La mappa "viva": un ping per ogni evento del ticker
   ------------------------------------------------------------------
   Richiesta dell'utente: un'onda sulla regione quando nasce una
   battaglia o cambia proprietario, un impulso fra due capitali quando si
   dichiara una guerra. Le notizie stavano solo nel nastro in alto: si
   leggevano, non si vedevano DOVE.

   Zero fetch nuove per tre fonti su quattro: il ticker (newsTicker.js)
   ci passa a ogni suo giro (5 min) quello che ha già scaricato —
   battaglie attive (con createdAt), guerre, nemici giurati ed eventi
   ufficiali del gioco (pace, patti). I CAMBI DI PROPRIETARIO invece
   vengono dallo storico regioni della time machine
   (/region-history/events, una richiesta piccola ogni 3 minuti): gli
   eventi "regione liberata" del gioco sono solo una parte dei passaggi
   di mano, lo storico li ha tutti.

   ── Cosa diventa cosa ─────────────────────────────────────────
     · nuova battaglia   → onde arancioni sulla regione contesa;
     · cambio di padrone → onde nel colore del nuovo padrone;
     · guerra / nemico giurato / pace / patto → un impulso che corre
       fra le due capitali (rosso, rosso scuro, verde, viola) e lascia
       l'arco acceso per un attimo.
   Ogni ping ha un'etichetta breve (il testo già tradotto del ticker, che
   porta già la sua emoji) che svanisce da sola.

   ── Quanti e quando ───────────────────────────────────────────
   All'apertura si mostrano gli eventi degli ultimi BACKLOG_MS (altrimenti
   la prima volta non succede niente per minuti); tutto il resto, più
   vecchio, si segna come già visto. Poi solo quello che arriva di nuovo.
   Uno alla volta ogni GAP_MS, coda di al massimo MAX_QUEUE (i più
   recenti). Niente ping con la time machine aperta o sotto gli overlay
   (mapIdle.js): quelli persi lì non si recuperano, sono notizie
   vecchie quando si torna.
   ══════════════════════════════════════════════════════════════ */

import maplibregl from 'maplibre-gl';
import { state } from '../diplomacy/state.js';
import { countryAnchor, arc, alongArc, brightenColor } from '../diplomacy/flowGeometry.js';
import { fetchRegionHistoryEventsViaCache } from '../diplomacy/cacheClient.js';
import { t } from '../shared/i18n.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { animationsOn } from '../shared/motion.js';

const SRC = 'wp-ping-src';
const LYR_RING = 'wp-ping-ring';
const LYR_ARC = 'wp-ping-arc';
const LYR_DOT = 'wp-ping-dot';

// Mezz'ora: con ~1 guerra ogni ora e mezza e ~2 battaglie nuove all'ora,
// dieci minuti lasciavano quasi sempre la mappa muta all'apertura.
const BACKLOG_MS = 30 * 60 * 1000;
const GAP_MS = 900;
const MAX_QUEUE = 12;
const LIFE_MS = 3200;          // un ping, dall'inizio alla scomparsa
const LABEL_MS = 4500;
const REGION_POLL_MS = 3 * 60 * 1000;
const MIN_ARC_DEG = 1.2;

const COLORS = {
  battle: '#ff9f43',
  war: '#f85149',
  sworn: '#b62324',
  peace: '#3fb950',
  pact: '#a371f7',
};

const _seen = new Set();
let _primed = false;           // il primo giro segna come visto tutto il vecchio
let _queue = [];
let _live = [];                // { start, kind, color, pos?, coords? }
let _raf = null;
let _gapTimer = null;
let _paused = false;
let _regionTimer = null;
let _regionSince = null;

const nameOf = id => state.nationMap.get(id)?.name || '—';
const regionPos = id => {
  const p = state.regionData?.[id]?.position || state.regionCache?.get(id)?.position;
  return Array.isArray(p) ? p : null;
};

function enqueue(ev) {
  _queue.push(ev);
  if (_queue.length > MAX_QUEUE) _queue = _queue.slice(-MAX_QUEUE);
  pump();
}

/* ── Le fonti ── */

/** Dal ticker, a ogni suo giro (newsTicker.js: refreshNews). */
export function feedNews(raw) {
  if (!raw) return;
  const now = Date.now();
  // Dopo il primo giro basta non averlo già visto: il server può passare
  // un evento con qualche minuto di ritardo, e non va perso per quello.
  const fresh = ts => ts > now - (_primed ? BACKLOG_MS * 3 : BACKLOG_MS);
  for (const b of raw.battles || []) {
    const key = `b:${b._id}`;
    if (_seen.has(key)) continue;
    _seen.add(key);
    const created = Date.parse(b.createdAt || '');
    if (!Number.isFinite(created) || !fresh(created)) continue;
    const pos = regionPos(b.defender?.region || b.attacker?.region);
    if (!pos) continue;
    enqueue({ kind: 'ring', color: COLORS.battle, pos, label: t('ticker_battle', { a: nameOf(b.attacker?.country), b: nameOf(b.defender?.country) }) });
  }
  for (const e of raw.stats?.punctual || []) {
    const key = `e:${e.id || `${e.category}:${e.countryId}:${e.enemyId}:${e.timestamp}`}`;
    if (_seen.has(key)) continue;
    _seen.add(key);
    if (!Number.isFinite(e.timestamp) || !fresh(e.timestamp)) continue;
    let a = null, b = null, color = null, label = null;
    if (e.category === 'war') {
      a = e.countryId; b = e.enemyId; color = COLORS.war;
      label = t('ticker_new_war', { a: nameOf(a), b: nameOf(b) });
    } else if (e.category === 'sworn_new') {
      a = e.countryId; b = e.enemyId; color = COLORS.sworn;
      label = t('ticker_sworn_new', { a: nameOf(a), b: nameOf(b) });
    } else if (e.category === 'game_event' && (e.eventType === 'peaceMade' || e.eventType === 'peace_agreement' || e.eventType === 'defensivePactFormed')) {
      [a, b] = e.raw?.countries || [];
      const peace = e.eventType !== 'defensivePactFormed';
      color = peace ? COLORS.peace : COLORS.pact;
      label = t(peace ? 'ticker_game_peace' : 'ticker_game_defpact_formed', { a: nameOf(a), b: nameOf(b) });
    }
    if (!a || !b || a === b) continue;
    const from = countryAnchor(a), to = countryAnchor(b);
    if (!from || !to) continue;
    const coords = Math.hypot(from[0] - to[0], from[1] - to[1]) >= MIN_ARC_DEG ? arc(from, to).coords : null;
    enqueue({ kind: 'link', color, coords, pos: coords ? null : to, label, labelAt: to });
  }
  _primed = true;
  startRegionPoll();
}

/** Cambi di proprietario dallo storico regioni, ogni 3 minuti. */
function startRegionPoll() {
  if (_regionTimer) return;
  _regionSince = Date.now() - BACKLOG_MS;
  const poll = async () => {
    if (document.hidden || _paused || state.timeMachineActive) return;
    const until = Date.now();
    try {
      const events = await fetchRegionHistoryEventsViaCache(_regionSince, until);
      _regionSince = until;
      for (const ev of (events || []).sort((x, y) => x.ts - y.ts)) {
        const key = `r:${ev.regionId}:${ev.ts}`;
        if (_seen.has(key)) continue;
        _seen.add(key);
        const pos = regionPos(ev.regionId);
        if (!pos || !ev.toCountry) continue;
        const color = brightenColor(state.nationBaseColorMap?.get(ev.toCountry), 0.4, '#ffd166');
        const region = state.regionData?.[ev.regionId]?.name || '';
        enqueue({ kind: 'ring', color, pos, label: `📍 ${region} → ${nameOf(ev.toCountry)}` });
      }
    } catch (err) {
      console.warn('[live-pings] storico regioni non disponibile:', err.message);
    }
  };
  poll();
  _regionTimer = setInterval(poll, REGION_POLL_MS);
}

/* ── Riproduzione ── */

function pump() {
  if (_gapTimer || !_queue.length) return;
  if (_paused || state.timeMachineActive || document.hidden || !state.map?.getLayer('regions-fill')) return;
  const ev = _queue.shift();
  play(ev);
  _gapTimer = setTimeout(() => { _gapTimer = null; pump(); }, GAP_MS);
}

function ensureLayers(map) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: LYR_ARC, type: 'line', source: SRC, filter: ['==', ['geometry-type'], 'LineString'],
    layout: { 'line-cap': 'round', 'line-join': 'round' },
    paint: { 'line-color': ['get', 'c'], 'line-width': 2.5, 'line-opacity': ['get', 'o'] },
  });
  map.addLayer({
    id: LYR_RING, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'ring'],
    paint: {
      'circle-radius': ['get', 'r'],
      'circle-color': ['get', 'c'],
      'circle-opacity': ['*', ['get', 'o'], 0.15],
      'circle-stroke-color': ['get', 'c'],
      'circle-stroke-width': 2.5,
      'circle-stroke-opacity': ['get', 'o'],
    },
  });
  map.addLayer({
    id: LYR_DOT, type: 'circle', source: SRC, filter: ['==', ['get', 'role'], 'dot'],
    paint: { 'circle-radius': 5, 'circle-color': '#ffffff', 'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': 3, 'circle-opacity': ['get', 'o'] },
  });
}

function showLabel(map, at, text, color) {
  if (!at || !text) return;
  // Due elementi: MapLibre posiziona il marcatore con `transform` sul
  // contenitore, e l'animazione (che usa anch'essa transform) lo
  // sovrascriverebbe: si anima solo quello interno.
  const el = document.createElement('div');
  el.style.pointerEvents = 'none';
  const inner = document.createElement('div');
  inner.className = 'wp-ping-label';
  inner.style.setProperty('--ping-c', color);
  inner.innerHTML = escapeHtml(text);
  el.appendChild(inner);
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -16] }).setLngLat(at).addTo(map);
  // Sopra il canvas dei nomi delle nazioni (labels.js) e accanto ai
  // marcatori delle battaglie (z-index 2000-2100, battleMarkers.js): senza,
  // il nome della nazione le passava sopra a metà.
  el.style.zIndex = '2300';
  setTimeout(() => marker.remove(), LABEL_MS);
}

function play(ev) {
  const map = state.map;
  ensureLayers(map);
  showLabel(map, ev.labelAt || ev.pos || ev.coords?.[ev.coords.length - 1], ev.label, ev.color);
  // Animazioni spente (Impostazioni): resta l'etichetta, ferma; niente onde.
  if (!animationsOn()) return;
  _live.push({ ...ev, start: performance.now() });
  if (!_raf) _raf = requestAnimationFrame(tick);
}

function frame(now) {
  const feats = [];
  _live = _live.filter(p => now - p.start < LIFE_MS);
  for (const p of _live) {
    const k = (now - p.start) / LIFE_MS;
    if (p.kind === 'link' && p.coords) {
      // Il primo terzo: l'impulso corre da una capitale all'altra; poi
      // l'arco resta acceso e si spegne, e all'arrivo parte un'onda.
      const run = Math.min(1, k / 0.35);
      const n = Math.max(1, Math.floor(run * (p.coords.length - 1)));
      const head = alongArc(p.coords, run);
      const o = k < 0.35 ? 1 : 1 - (k - 0.35) / 0.65;
      feats.push({ type: 'Feature', properties: { c: p.color, o: o * 0.9 }, geometry: { type: 'LineString', coordinates: [...p.coords.slice(0, n), head] } });
      if (k < 0.35) feats.push({ type: 'Feature', properties: { c: p.color, o: 1, role: 'dot' }, geometry: { type: 'Point', coordinates: head } });
      else ringsAt(feats, p.coords[p.coords.length - 1], p.color, (k - 0.35) / 0.65, 1);
    } else if (p.pos) {
      ringsAt(feats, p.pos, p.color, k, 3);
    }
  }
  return feats;
}

/** `waves` onde concentriche sfasate, che si allargano e svaniscono. */
function ringsAt(feats, pos, color, k, waves) {
  for (let i = 0; i < waves; i++) {
    const t0 = k * (1 + (waves - 1) * 0.35) - i * 0.35;
    if (t0 < 0 || t0 > 1) continue;
    feats.push({ type: 'Feature', properties: { c: color, role: 'ring', r: 6 + 40 * t0, o: (1 - t0) * (1 - t0) }, geometry: { type: 'Point', coordinates: pos } });
  }
}

function tick(now) {
  _raf = null;
  const src = state.map?.getSource(SRC);
  if (!src) return;
  const feats = frame(now);
  src.setData({ type: 'FeatureCollection', features: feats });
  if (_live.length) _raf = requestAnimationFrame(tick);
}

/* ── Pausa (src/app/mapIdle.js) ── */

export function pauseLivePings() {
  _paused = true;
  _queue = [];
}

export function resumeLivePings() {
  _paused = false;
}
