/* ══════════════════════════════════════════════════════════════
   WarEra+ — Le elezioni in diretta (vista "Elezioni")
   ------------------------------------------------------------------
   Richiesta dell'utente: durante il voto, la tinta dell'affluenza che si
   scalda man mano, con un piccolo battito ogni volta che il conteggio
   sale.

   Il dato è lo stesso di sempre: /elections?open=1, riletto ogni 3
   minuti a vista accesa (diplomacy/main.js: _loadOpenElections). Prima a
   ogni giro la mappa saltava di colpo al colore nuovo; ora, se i voti di
   un'elezione sono saliti dal giro prima:
     · la tinta passa dal colore vecchio al nuovo in TRANSITION_MS,
       ridipingendo il solo riempimento con un'affluenza interpolata
       (politicsHeatmap.js: buildPoliticsColorExpression con le
       affluenze date) — non tutto renderMap a ogni passo;
     · sulla capitale di quella nazione (flowGeometry.js) due battiti,
       con un'etichetta "+N voti".
   Al primo caricamento non c'è un "prima": niente animazione.

   Con le animazioni spente (Impostazioni, shared/motion.js) il colore
   cambia di colpo come prima, e resta solo l'etichetta.

   ── L'ESITO (richiesta dell'utente) ────────────────────────────
   Un'elezione che al giro prima era al voto e ora non c'è più (o ha
   passato la chiusura) è CHIUSA: se ne legge il risultato
   (cacheClient.js: fetchElectionDetailViaCache, col suo ripiego
   diretto) e un'onda nel colore del partito vincitore attraversa la
   nazione — il territorio si accende e si spegne, e dalla capitale parte
   un anello — con l'etichetta "vince …". Vincitore: presidenziali = il
   partito del candidato più votato; congresso = il partito con più
   ELETTI (isElected), e a pari eletti quello con più voti.
   Il colore del partito è quello che Political dà a chi non è nel CSV
   dei colori, ricavato dall'id (political/config.js: stringToColor):
   copiato qui per non tirarsi dietro tutta Political. Il nome viene da
   /parties?countryId= (i soli partiti di quella nazione: /parties-detail
   sarebbe più di un megabyte per leggere un nome). Si vede solo con la vista Elezioni aperta: è lei che rilegge
   le elezioni ogni 3 minuti.
   ══════════════════════════════════════════════════════════════ */

import maplibregl from 'maplibre-gl';
import { state } from './state.js';
import { countryAnchor } from './flowGeometry.js';
import { buildPoliticsColorExpression, turnoutByCountry, turnoutColor } from './politicsHeatmap.js';
import { animationsOn } from '../shared/motion.js';
import { t } from '../shared/i18n.js';
import { escapeHtml } from './utils.js';
import { WARERA_CACHE_BASE } from './config.js';
import { phaseOf } from './politicsHeatmap.js';

const TRANSITION_MS = 1500;
const BEAT_MS = 1700;
const LABEL_MS = 4000;
const SRC = 'wp-elections-live-src';
const LYR = 'wp-elections-live-beat';

let _raf = null;
let _beats = [];   // { pos, color, start }

const votesOf = e => e?.votesCount || (e?.candidates || []).reduce((s, c) => s + (c.voteCount || 0), 0);

/** Voti saliti per nazione fra due letture: { countryId: delta }. */
function gains(prev, next) {
  const before = new Map();
  for (const list of Object.values(prev || {})) for (const e of list || []) if (e?._id) before.set(e._id, votesOf(e));
  const out = new Map();
  for (const [countryId, list] of Object.entries(next || {})) {
    for (const e of list || []) {
      if (!e?._id || !before.has(e._id)) continue;
      const d = votesOf(e) - before.get(e._id);
      if (d > 0) out.set(countryId, (out.get(countryId) || 0) + d);
    }
  }
  return out;
}

function ensureLayers(map) {
  if (map.getSource(SRC)) return;
  map.addSource(SRC, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({
    id: LYR, type: 'circle', source: SRC,
    paint: {
      'circle-radius': ['get', 'r'],
      'circle-color': ['get', 'c'],
      'circle-opacity': ['*', ['get', 'o'], 0.25],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 2,
      'circle-stroke-opacity': ['get', 'o'],
    },
  });
}

function showLabel(map, at, text, color = '#e05252') {
  const el = document.createElement('div');
  el.style.pointerEvents = 'none';
  el.style.zIndex = '2300';
  const inner = document.createElement('div');
  inner.className = 'wp-ping-label';
  inner.style.setProperty('--ping-c', color);
  inner.innerHTML = escapeHtml(text);
  el.appendChild(inner);
  const marker = new maplibregl.Marker({ element: el, anchor: 'bottom', offset: [0, -14] }).setLngLat(at).addTo(map);
  setTimeout(() => marker.remove(), LABEL_MS);
}

/* ── L'esito ── */

// Stesso calcolo di political/config.js: stringToColor.
function partyColor(id) {
  if (!id || typeof id !== 'string') return '#888888';
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = id.charCodeAt(i) + ((hash << 5) - hash);
  let color = '#';
  for (let i = 0; i < 3; i++) color += ('00' + ((hash >> (i * 8)) & 0xFF).toString(16)).slice(-2);
  return color;
}

const _parties = new Map();   // countryId → Promise<Map partyId → nome>
function partyNames(countryId) {
  if (!_parties.has(countryId)) {
    _parties.set(countryId, fetch(`${WARERA_CACHE_BASE}/parties?countryId=${encodeURIComponent(countryId)}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => new Map((j?.data || []).map(p => [p._id, p.name]).filter(([k, v]) => k && v)))
      .catch(() => new Map()));
  }
  return _parties.get(countryId);
}

const _announced = new Set();

function winnerOf(detail, type) {
  const cands = detail?.candidates || [];
  if (!cands.length) return null;
  if (type === 'president') {
    const top = cands.slice().sort((a, b) => (b.voteCount || 0) - (a.voteCount || 0))[0];
    return top?.party ? { party: top.party, votes: top.voteCount || 0 } : null;
  }
  const by = new Map();
  for (const c of cands) {
    if (!c.party) continue;
    const r = by.get(c.party) || { party: c.party, seats: 0, votes: 0 };
    if (c.isElected) r.seats += 1;
    r.votes += c.voteCount || 0;
    by.set(c.party, r);
  }
  return [...by.values()].sort((a, b) => b.seats - a.seats || b.votes - a.votes)[0] || null;
}

const SRC_WAVE = 'wp-elections-result-src';
const LYR_WAVE_FILL = 'wp-elections-result-fill';
const LYR_WAVE_RING = 'wp-elections-result-ring';
const WAVE_MS = 2600;

async function announceResult(e, countryId) {
  if (_announced.has(e._id)) return;
  _announced.add(e._id);
  let detail = null;
  try {
    const { fetchElectionDetailViaCache } = await import('./cacheClient.js');
    detail = await fetchElectionDetailViaCache(e._id);
  } catch (err) {
    console.warn('[elections-live] esito non disponibile:', err.message);
    return;
  }
  const win = winnerOf(detail || e, e.type);
  if (!win || state.coloringMode !== 'politics') return;
  const map = state.map;
  const fillLayer = map?.getLayer('regions-fill');
  const pos = countryAnchor(countryId);
  if (!fillLayer || !pos) return;
  const name = (await partyNames(countryId)).get(win.party) || '—';
  const color = partyColor(win.party);
  const nation = state.nationMap.get(countryId)?.name || '';
  showLabel(map, pos, `🏆 ${nation}: ${name}`, color);
  if (!animationsOn()) return;

  // Il territorio della nazione si accende nel colore del partito e si
  // spegne; dalla capitale parte un anello che si allarga.
  if (!map.getLayer(LYR_WAVE_FILL)) {
    map.addLayer({ id: LYR_WAVE_FILL, type: 'fill', source: fillLayer.source, paint: { 'fill-color': '#000', 'fill-opacity': 0 }, filter: ['==', ['get', 'countryId'], ''] });
  }
  if (!map.getSource(SRC_WAVE)) {
    map.addSource(SRC_WAVE, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({
      id: LYR_WAVE_RING, type: 'circle', source: SRC_WAVE,
      paint: { 'circle-radius': ['get', 'r'], 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': ['get', 'c'], 'circle-stroke-width': 4, 'circle-stroke-opacity': ['get', 'o'] },
    });
  }
  const prop = state.mapSource === 'original' ? 'initialCountryId' : 'countryId';
  map.setFilter(LYR_WAVE_FILL, ['==', ['get', prop], countryId]);
  map.setPaintProperty(LYR_WAVE_FILL, 'fill-color', color);
  const t0 = performance.now();
  const step = (now) => {
    const x = Math.min(1, (now - t0) / WAVE_MS);
    if (!map.getLayer(LYR_WAVE_FILL)) return;
    // Su di colpo, giù piano: due "accensioni", la seconda più debole.
    const glow = Math.exp(-(((x - 0.15) / 0.12) ** 2)) + 0.5 * Math.exp(-(((x - 0.5) / 0.15) ** 2));
    map.setPaintProperty(LYR_WAVE_FILL, 'fill-opacity', 0.8 * glow);
    map.getSource(SRC_WAVE)?.setData({ type: 'FeatureCollection', features: [
      { type: 'Feature', properties: { r: 8 + 90 * x, o: 1 - x, c: color }, geometry: { type: 'Point', coordinates: pos } },
    ] });
    if (x < 1) requestAnimationFrame(step);
    else { map.setPaintProperty(LYR_WAVE_FILL, 'fill-opacity', 0); map.getSource(SRC_WAVE)?.setData({ type: 'FeatureCollection', features: [] }); }
  };
  requestAnimationFrame(step);
}

/** Le elezioni al voto nel giro prima che ora sono chiuse. */
function closedSince(prev, next) {
  const still = new Set();
  const now = Date.now();
  for (const list of Object.values(next || {})) for (const e of list || []) if (e?._id && phaseOf(e, now) === 'voting') still.add(e._id);
  const out = [];
  for (const [countryId, list] of Object.entries(prev || {})) {
    for (const e of list || []) {
      if (!e?._id || still.has(e._id)) continue;
      const end = Date.parse(e.votesEndAt || '');
      // Era al voto (aperta e già iniziata) e ora è finita.
      if (Date.parse(e.votesStartAt || '') <= now && Number.isFinite(end) && end <= now) out.push({ e, countryId });
    }
  }
  return out;
}

/**
 * Chiamata da _loadOpenElections dopo una lettura nuova. Ritorna true se
 * si occupa lei di ridipingere (transizione in corso): chi chiama allora
 * NON fa renderMap, altrimenti il colore nuovo arriverebbe di colpo prima
 * della transizione.
 */
export function onElectionsUpdate(prev, next) {
  const map = state.map;
  if (!prev || !next || !map?.getLayer('regions-fill') || state.coloringMode !== 'politics') return false;
  // Le chiuse dal giro prima: l'esito arriva da solo, dopo una fetch.
  for (const { e, countryId } of closedSince(prev, next)) announceResult(e, countryId);
  const up = gains(prev, next);
  if (!up.size) return false;

  for (const [countryId, d] of up) {
    const pos = countryAnchor(countryId);
    if (!pos) continue;
    showLabel(map, pos, `🗳️ +${t('vo_votes_n', { n: d.toLocaleString() })} · ${state.nationMap.get(countryId)?.name || ''}`);
    if (animationsOn()) _beats.push({ pos, color: turnoutColor(turnoutByCountry(Date.now(), next).get(countryId)), start: performance.now() });
  }
  if (!animationsOn()) return false;

  // Transizione del colore: affluenza vecchia → nuova, per le sole
  // nazioni salite; le altre hanno già il loro colore definitivo.
  const from = turnoutByCountry(Date.now(), prev);
  const to = turnoutByCountry(Date.now(), next);
  const isOriginal = state.mapSource === 'original';
  const t0 = performance.now();
  ensureLayers(map);
  const step = (now) => {
    _raf = null;
    if (state.coloringMode !== 'politics' || !map.getLayer('regions-fill')) { _beats = []; return; }
    const k = Math.min(1, (now - t0) / TRANSITION_MS);
    const e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2;   // ease-in-out
    if (k < 1) {
      const mixed = new Map(to);
      for (const id of up.keys()) {
        const a = from.get(id), b = to.get(id);
        if (a != null && b != null) mixed.set(id, a + (b - a) * e);
      }
      map.setPaintProperty('regions-fill', 'fill-color', buildPoliticsColorExpression(isOriginal, mixed));
    }
    // I battiti: due "tu-tum" che si allargano e svaniscono.
    _beats = _beats.filter(b => now - b.start < BEAT_MS);
    const feats = _beats.map(b => {
      const x = (now - b.start) / BEAT_MS;
      const beat = Math.exp(-(((x - 0.12) / 0.07) ** 2)) + 0.7 * Math.exp(-(((x - 0.4) / 0.07) ** 2));
      return { type: 'Feature', properties: { r: 6 + 10 * beat + 14 * x, o: Math.max(0, 1 - x) * (0.4 + 0.6 * beat), c: b.color }, geometry: { type: 'Point', coordinates: b.pos } };
    });
    map.getSource(SRC)?.setData({ type: 'FeatureCollection', features: feats });
    if (k < 1 || _beats.length) _raf = requestAnimationFrame(step);
    else import('./map.js').then(m => m.renderMap());   // fine: il ridisegno vero, colori definitivi
  };
  if (_raf) cancelAnimationFrame(_raf);
  _raf = requestAnimationFrame(step);
  return true;
}
