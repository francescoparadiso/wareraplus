// battleMarkers.js - versione completa con gestione 429 e cache

import { state } from './state.js';
import maplibregl from 'maplibre-gl';
import { fetchActiveBattles, setBattleHeatmap } from './battleHeatmap.js';
import { API_BASE_URL, WORKER_API_BASE } from './config.js';
import { trpcBatch, escapeHtml, getNation } from './utils.js';
import { highlightBattleRegion, clearBattleRegionHighlight } from './map.js';

let markers = new Map(); // battleId -> { marker, el } — SOLO le battaglie attualmente nel viewport (vedi _syncMarkersToViewport)
let markersEnabled = true;
let lastSuccessfulBattles = [];

// WarEra+: con molte battaglie attive in giro per il mondo, prima si creava
// e aggiornava un vero Marker DOM (con tutto il markup di buildMarkerMarkup)
// per OGNUNA, comprese quelle dall'altra parte del mondo rispetto a quello
// che si sta guardando — inutile lavoro DOM ogni ~30s. Filtrate al viewport
// per alleggerire il tool, come richiesto. battleCache tiene i DATI di TUTTE le battaglie
// attive (serve comunque per sapere cosa è ancora attivo), ma i Marker DOM
// veri e propri (in `markers`, sopra) vengono creati SOLO per quelle il cui
// centroide ricade nel viewport corrente (state.map.getBounds()). Un
// listener 'moveend' risincronizza la lista ad ogni pan/zoom SENZA nuove
// chiamate di rete (usa i dati già in cache), rispettando il principio di
// non moltiplicare le fetch in loop (vedi CLAUDE.md).
let battleCache = new Map(); // battleId -> { battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend, centroid }
let _viewportSyncBound = false;
let _allHidden = false; // true fra hideAllMarkers() e showAllMarkers() — vedi _syncMarkersToViewport

function _inBounds(centroid) {
  if (!state.map || !centroid) return false;
  try {
    return state.map.getBounds().contains(centroid);
  } catch (e) {
    return true; // in caso di errore imprevisto, meglio mostrare che nascondere per sbaglio
  }
}

function _syncMarkersToViewport() {
  if (!markersEnabled || !state.map) return;
  const zoom = state.map.getZoom();
  battleCache.forEach((d, battleId) => {
    const inView = _inBounds(d.centroid);
    const existing = markers.get(battleId);
    if (inView) {
      if (existing) {
        existing.marker.setLngLat(d.centroid);
        // WarEra+: prima il contenuto (font/padding/dimensione — dipendono
        // da `zoom`, vedi buildMarkerMarkup) veniva ridisegnato SOLO al
        // refresh periodico dei dati (~30s in updateBattleMarkers) o alla
        // creazione. Zoommando la mappa senza che questa battaglia
        // entrasse/uscisse dal viewport, il marker restava "congelato" alla
        // dimensione di quando era stato creato fino al giro successivo —
        // da cui l'incoerenza segnalata (marker vicini con "reattività"
        // diversa allo zoom, sembrava dipendesse dal tempo). Ora si
        // riaggiorna qui, ad ogni moveend (pan O zoom), con lo zoom attuale.
        updateMarkerEl(existing.el, d.battle, d.regionName, d.liveData, d.totalAttackerDmg, d.totalDefenderDmg, zoom, d.trend);
      } else {
        const el = buildMarkerEl(d.battle, d.regionName, d.liveData, d.totalAttackerDmg, d.totalDefenderDmg, zoom, d.trend);
        // Se una battaglia selezionata sta mostrando la heatmap (tutti gli
        // altri marker nascosti via hideAllMarkers), un marker che entra nel
        // viewport ORA durante quello stato non deve apparire visibile e
        // rompere l'effetto "solo il tooltip centrale, niente marker".
        if (_allHidden) el.style.display = 'none';
        const marker = new maplibregl.Marker({ element: el }).setLngLat(d.centroid).addTo(state.map);
        markers.set(battleId, { marker, el });
      }
    } else if (existing) {
      try { existing.marker.remove(); } catch (e) {}
      markers.delete(battleId);
    }
  });
  _declutterMarkers(zoom);
}

// WarEra+: ingombro approssimativo (in pixel schermo) di un marker alle
// varie fasce di zoom — stessa logica/soglie di buildMarkerMarkup
// (isZoomLow/isZoomMedium, minWidth) tenuta in sync a mano qui perché lì è
// dentro al markup, non esposta. Non serve precisione al pixel: è solo la
// distanza minima sotto la quale due marker si considerano "sovrapposti".
function _footprintForZoom(zoom) {
  const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window);
  const effectiveZoom = isMobile ? Math.max(zoom, 3.5) : zoom;
  if (effectiveZoom < 3.5) return { w: 78, h: 48 };
  if (effectiveZoom < 5) return { w: 108, h: 60 };
  return { w: 138, h: 74 };
}

// WarEra+: con tante battaglie vicine (soprattutto zoomando lontano), i
// marker DOM si sovrapponevano completamente rendendo la mappa illeggibile
// in quei punti — richiesto esplicitamente "una situazione sempre chiara".
// Non è vero clustering (nessuna bolla "+N"): passata greedy in spazio
// schermo, ordinata per danno totale (la battaglia più "pesante" vince il
// posto quando due si sovrappongono), che nasconde (display:none, i dati
// restano comunque in battleCache) quelle il cui riquadro si
// sovrapporrebbe a una già piazzata. Ricalcolata ad ogni sync (pan/zoom/
// refresh dati), quindi si aggiusta da sola quando lo zoom separa i punti.
function _declutterMarkers(zoom) {
  if (_allHidden || !state.map) return;
  const { w: cellW, h: cellH } = _footprintForZoom(zoom);
  const placed = [];
  const ranked = [...markers.entries()]
    .map(([battleId, m]) => {
      const d = battleCache.get(battleId);
      const total = d ? (d.totalAttackerDmg || 0) + (d.totalDefenderDmg || 0) : 0;
      return { m, d, total };
    })
    .filter(x => x.d)
    .sort((a, b) => b.total - a.total);

  ranked.forEach(({ m, d }) => {
    const p = state.map.project(d.centroid);
    const overlaps = placed.some(o => Math.abs(o.x - p.x) < cellW && Math.abs(o.y - p.y) < cellH);
    if (overlaps) {
      m.el.style.display = 'none';
    } else {
      placed.push(p);
      m.el.style.display = '';
    }
  });
}

function _bindViewportSync() {
  if (_viewportSyncBound || !state.map) return;
  _viewportSyncBound = true;
  // 'moveend' copre sia il pan sia lo zoom (maplibre spara move/moveend per
  // qualunque cambio di camera, non solo il pan) — un solo listener basta
  // sia per il filtro al viewport sia per il refresh zoom-dependent sopra.
  state.map.on('moveend', _syncMarkersToViewport);
}

// ==================== TREND / MOMENTUM (locale, nessuna chiamata extra) ====================
// Confronta i danni totali di ogni battaglia fra un refresh e il successivo
// (updateBattleMarkers gira ogni ~30s) per capire chi sta guadagnando terreno
// ORA, senza fare nessuna richiesta API in piu': i totali arrivano gia' dal
// batch esistente (getBattles + live data batch).
const battleHistory = new Map(); // battleId -> { atk, def, ts }

function computeTrend(battleId, atkDmg, defDmg) {
  const now = Date.now();
  const prev = battleHistory.get(battleId);
  battleHistory.set(battleId, { atk: atkDmg, def: defDmg, ts: now });
  if (!prev) return null;
  const dtSec = (now - prev.ts) / 1000;
  if (dtSec < 5) return prev.trend || null; // refresh troppo ravvicinato, tieni l'ultimo valore buono
  const dAtk = Math.max(0, atkDmg - prev.atk);
  const dDef = Math.max(0, defDmg - prev.def);
  const rateAtk = dAtk / dtSec;
  const rateDef = dDef / dtSec;
  const rateSum = rateAtk + rateDef;
  // balance > 0 = il difensore sta guadagnando terreno piu' in fretta ORA
  // (stessa convenzione di segno usata in battleFront, per coerenza fra le viste).
  const trend = rateSum > 0
    ? { rateAtk, rateDef, balance: (rateDef - rateAtk) / rateSum }
    : { rateAtk: 0, rateDef: 0, balance: 0 };
  battleHistory.set(battleId, { atk: atkDmg, def: defDmg, ts: now, trend });
  return trend;
}

// ==================== BATTLE TOOLTIP (pin in basso) ====================
let pinnedBattleId = null;

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

// ==================== HELPERS: NATION (spostate PRIMA del tooltip) ====================
// getNation ora importata da utils.js (era duplicata identica qui e in
// battleFront.js — vedi nota lì).
function getFlagUrl(code) {
  if (!code) return '';
  return `https://media.warera.io/images/flags/${code.toLowerCase()}.svg?v=16`;
}

// Canvas 1x1 riusato + cache: prima ne veniva creato uno nuovo ad ogni
// chiamata, 2 per marker ad ogni refresh (60 canvas ogni 30s con 30 battaglie).
let _colorCanvasCtx = null;
const _colorCache = new Map();

function brightenAndSaturate(color, saturationBoost = 0.4) {
  if (!color) return '#e6edf3';
  const cacheKey = `${color}|${saturationBoost}`;
  const hit = _colorCache.get(cacheKey);
  if (hit) return hit;

  if (!_colorCanvasCtx) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    _colorCanvasCtx = canvas.getContext('2d', { willReadFrequently: true });
  }
  const ctx = _colorCanvasCtx;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;

  const lum = (r * 299 + g * 587 + b * 114) / 1000;
  const brightFactor = lum < 80 ? 2.0 : lum < 140 ? 1.6 : lum < 180 ? 1.3 : 1.0;
  let nr = Math.min(255, Math.round(r * brightFactor));
  let ng = Math.min(255, Math.round(g * brightFactor));
  let nb = Math.min(255, Math.round(b * brightFactor));

  const max = Math.max(nr, ng, nb);
  if (max > 0) {
    const avg = (nr + ng + nb) / 3;
    const boost = 1 + saturationBoost;
    nr = Math.min(255, Math.round(avg + (nr - avg) * boost));
    ng = Math.min(255, Math.round(avg + (ng - avg) * boost));
    nb = Math.min(255, Math.round(avg + (nb - avg) * boost));
  }
  const out = `rgb(${nr},${ng},${nb})`;
  _colorCache.set(cacheKey, out);
  return out;
}

// ==================== TOOLTIP FUNCTIONS ====================
function getBattleTooltipEl() {
  let el = document.getElementById('battle-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'battle-tooltip';
    el.style.cssText = `
      position: fixed;
      bottom: calc(55px + env(safe-area-inset-bottom, 0px));
      left: 50%;
      transform: translateX(-50%) translateY(8px);
      z-index: 9000;
      font-family: Inter, system-ui, sans-serif;
      pointer-events: auto;
      opacity: 0;
      transition: opacity 0.18s ease, transform 0.18s ease;
      /* Responsivo: mai piu' largo della viewport meno un margine, invece del
         fisso max-width:420px che su schermi stretti (<440px) veniva tagliato
         o spingeva oltre il bordo, rompendo il layout su mobile. */
      width: min(420px, calc(100vw - 20px));
      max-width: calc(100vw - 20px);
      box-sizing: border-box;
    `;
    document.body.appendChild(el);
  }
  return el;
}

function buildBattleTooltipContent(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend) {
  const attackerNation = getNation(battle.attacker?.country);
  const defenderNation = getNation(battle.defender?.country);
  const atkName = attackerNation?.name || 'Unknown';
  const defName = defenderNation?.name || 'Unknown';
  const atkCode = attackerNation?.code?.toLowerCase() || '';
  const defCode = defenderNation?.code?.toLowerCase() || '';

  const rawAtkColor = state.nationBaseColorMap.get(battle.attacker?.country);
  const rawDefColor = state.nationBaseColorMap.get(battle.defender?.country);
  const atkColor = brightenAndSaturate(rawAtkColor, 0.4);
  const defColor = brightenAndSaturate(rawDefColor, 0.4);

  // useLive pilota solo il badge "🔴 Live" in testata: la barra percentuale
  // che un tempo derivava da liveData/atkDmg/defDmg è stata sostituita dal
  // widget battleFront montato più sotto, che i suoi dati live se li fa da
  // solo (poll indipendente, più frequente di questo refresh a ~30s).
  const useLive = !!(liveData && (liveData.attackerDmg > 0 || liveData.defenderDmg > 0));

  // Cumulativo dell'intera battaglia (round completati + round in corso —
  // vedi il fix in updateBattleMarkers), indipendente dal solo round live.
  const battleTotal = (totalAttackerDmg || 0) + (totalDefenderDmg || 0);

  // Round vinti — campi diretti sull'oggetto battaglia (battle.getBattles),
  // nessuna chiamata in più.
  const defWon = battle.defender?.wonRoundsCount ?? 0;
  const atkWon = battle.attacker?.wonRoundsCount ?? 0;
  const roundsToWin = battle.roundsToWin;

  const isLight = state.theme === 'light';
  const bg = isLight ? 'rgba(240,242,247,0.98)' : 'rgba(13,17,23,0.97)';
  const border = isLight ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.1)';
  const textColor = isLight ? '#1a1a1a' : '#e6edf3';
  const subColor = isLight ? '#555' : '#8b949e';
  const flagUrl = (code) => `https://media.warera.io/images/flags/${code}.svg?v=16`;

  // Layout responsivo: niente piu' min-width fisso a 260px, che su schermi
  // molto stretti costringeva il contenitore oltre il bordo viewport.
  // Con width:100% + box-sizing:border-box il box si adatta sempre al
  // contenitore (gia' limitato a calc(100vw - 20px) in getBattleTooltipEl).
  const isMobile = window.innerWidth <= 480;
  const padding = isMobile ? '10px 12px' : '12px 16px';
  const nameFontSize = isMobile ? '12px' : '13px';
  const flagHeight = isMobile ? '14px' : '16px';

  // WarEra+: la riga di momentum "a scatti" (derivata dal trend fra un
  // refresh marker e l'altro, ogni ~30s — vedi computeTrend) è stata
  // rimossa da qui: il widget battleFront montato più sotto calcola il
  // momentum live (poll ogni ~1.5s), non serve più duplicarlo con un dato
  // più vecchio e meno preciso. `trend` resta nella firma perché
  // buildMarkerMarkup lo usa ancora per l'indicatore sul marker stesso.

  return `
    <div style="
      background: ${bg};
      border: 1px solid ${border};
      border-radius: 10px;
      padding: ${padding};
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
      width: 100%;
      box-sizing: border-box;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px;">
        <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.6px; color:${subColor}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">
          ⚔️ ${escapeHtml(regionName || 'Battle')}${useLive ? ' <span style="color:#ff4444;">🔴 Live</span>' : ''}
        </span>
        <span id="battle-tooltip-close" style="cursor:pointer; font-size:16px; color:${subColor}; padding:4px; line-height:1; flex-shrink:0;">✕</span>
      </div>

      <div style="display:flex; align-items:center; flex-wrap:wrap; gap:8px; margin-bottom:10px;">
        <div style="display:flex; align-items:center; gap:5px; flex:1 1 40%; min-width:0;">
          ${defCode ? `<img src="${flagUrl(defCode)}" style="height:${flagHeight}; border-radius:2px; flex-shrink:0;" onerror="this.style.display='none'">` : ''}
          <span style="font-size:${nameFontSize}; font-weight:700; color:${defColor}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(defName)}</span>
        </div>
        <span style="font-size:10px; color:${subColor}; flex-shrink:0;">vs</span>
        <div style="display:flex; align-items:center; gap:5px; flex:1 1 40%; min-width:0; justify-content:flex-end;">
          <span style="font-size:${nameFontSize}; font-weight:700; color:${atkColor}; text-align:right; overflow:hidden; text-overflow:ellipsis; white-space:nowrap;">${escapeHtml(atkName)}</span>
          ${atkCode ? `<img src="${flagUrl(atkCode)}" style="height:${flagHeight}; border-radius:2px; flex-shrink:0;" onerror="this.style.display='none'">` : ''}
        </div>
      </div>

      <div id="battle-front-mount" style="margin-bottom:10px;"></div>

      <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:11px; color:${subColor};">
        <div style="display:flex; align-items:center; gap:4px;">
          ${defCode ? `<img src="${flagUrl(defCode)}" style="height:10px; border-radius:1px; flex-shrink:0;" onerror="this.style.display='none'">` : '🛡️'}
          <span>Defender total: <strong style="color:${textColor};">${fmt(totalDefenderDmg)}</strong></span>
        </div>
        <div style="display:flex; align-items:center; gap:4px; justify-content:flex-end;">
          <span>Attacker total: <strong style="color:${textColor};">${fmt(totalAttackerDmg)}</strong></span>
          ${atkCode ? `<img src="${flagUrl(atkCode)}" style="height:10px; border-radius:1px; flex-shrink:0;" onerror="this.style.display='none'">` : '⚔️'}
        </div>
        <div style="grid-column:1 / -1;">💥 Combined total: <strong style="color:${textColor};">${fmt(battleTotal)}</strong></div>
        ${roundsToWin ? `<div style="grid-column:1 / -1;">🏆 Rounds won: <strong style="color:${defColor};">${defWon}</strong> – <strong style="color:${atkColor};">${atkWon}</strong> <span style="opacity:.75;">(first to ${roundsToWin})</span></div>` : ''}
      </div>

      <div style="margin-top:8px; font-size:10px; color:${subColor}; text-align:center;">
        Click again to open the heatmap · ✕ to close
      </div>
    </div>
  `;
}

function showBattleTooltip(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend) {
  // I due tooltip vivono entrambi in basso al centro: se restano aperti
  // insieme, quello battaglia (z-index 9000) copre quello nazione (3000) e
  // intercetta i click destinati ai suoi link.
  import('./nationTooltip.js').then(m => m.hide());
  const el = getBattleTooltipEl();
  el.innerHTML = buildBattleTooltipContent(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend);
  pinnedBattleId = battle._id;

  el.querySelector('#battle-tooltip-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideBattleTooltip();
  });

  // Il campo di battaglia vive direttamente nel tooltip (WarEra+: prima
  // apriva un overlay a schermo intero da un bottone dedicato — richiesta
  // esplicita di averlo qui senza cambiare pagina). mountBattleFront è
  // idempotente: se un'istanza precedente è ancora montata su un'altra
  // battaglia la sostituisce da sola.
  const mount = el.querySelector('#battle-front-mount');
  if (mount) import('./battleFront.js').then(m => m.mountBattleFront(mount, battle._id));

  el.style.pointerEvents = 'auto';
  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(0)';
  });
}

export function hideBattleTooltip() {
  const el = document.getElementById('battle-tooltip');
  if (el) {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(8px)';
    // CAUSA PRINCIPALE del bug "il link apre una battaglia": senza questo il
    // tooltip resta invisibile ma cliccabile (pointer-events:auto) sopra la
    // nation-tooltip, intercettando i click destinati ai suoi link.
    el.style.pointerEvents = 'none';
  }
  pinnedBattleId = null;

  // Ferma il poll live del widget battleFront montato nel tooltip — senza
  // questo continuerebbe a interrogare l'API anche a tooltip chiuso.
  import('./battleFront.js').then(m => m.unmountBattleFront());

  // Ripristina subito la visibilità di tutte le battaglie (nascoste da
  // hideAllMarkers quando questa era stata selezionata) — istantaneo,
  // non aspetta il rebuild dei marker innescato da exitBattleHeatmap qui
  // sotto (che comunque li ricrea tutti da capo, ma con un piccolo ritardo).
  showAllMarkers();
  clearBattleRegionHighlight();

  // Se la heatmap è ancora attiva, esce anche da quella: chiudere il
  // tooltip (click fuori, bottone ✕, o ri-click sulla stessa battaglia)
  // è ora l'unico punto da cui si "lascia" la battaglia selezionata,
  // sia per il tooltip sia per la colorazione heatmap sulla mappa.
  if (state.coloringMode === 'battleHeatmap') {
    import('./battleHeatmap.js').then(m => m.exitBattleHeatmap());
  }
}

// Click fuori per chiudere il tooltip. "Fuori" deve significare "sulla
// mappa/sfondo", non "su un altro pannello dell'interfaccia" — altrimenti
// aprire il menu impostazioni o toccare uno switch (checkbox, select,
// mode-btn...) chiude la battaglia selezionata come se avessimo cliccato
// fuori, che è esattamente il bug segnalato. Escludiamo quindi anche tutti
// i pannelli/controlli di chrome, non solo il tooltip stesso.
const BATTLE_TOOLTIP_KEEP_OPEN_SELECTORS = [
  '#battle-tooltip',
  '.battle-marker',
  '#hamburger-menu',
  '#hamburger-btn',
  '#wp-top-controls',
  '#bloc-stats-btn',
  '#bloc-stats-page',
  '#wp-battles-toggle-btn',
  '#legend-container',
  '#wp-country-panel',
  '#wp-political-overlay',
  '#nation-tooltip',
  '#toast-container',
].join(', ');

document.addEventListener('click', (e) => {
  if (pinnedBattleId && !e.target.closest(BATTLE_TOOLTIP_KEEP_OPEN_SELECTORS)) {
    hideBattleTooltip();
  }
});

// ==================== TOGGLE ====================
export function toggleBattleMarkers(enabled) {
  markersEnabled = enabled;
  if (enabled) {
    updateBattleMarkers();
  } else {
    clearMarkers();
  }
  const toggle = document.getElementById('checkActiveBattles');
  if (toggle) toggle.checked = enabled;
}

// ==================== HELPER: REGION DATA ====================
// Versione singola (fallback / usi puntuali). Il percorso "hot" in
// updateBattleMarkers usa fetchRegionDataBatch per evitare N richieste separate.
async function fetchRegionData(regionId) {
  if (state.regionCache.has(regionId)) return state.regionCache.get(regionId);
  try {
    const input = { regionId };
    const url = `${API_BASE_URL}/trpc/region.getById?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const region = data?.result?.data || data;
    const result = { position: region.position || null, name: region.name || region.mainCity || '' };
    state.regionCache.set(regionId, result);
    return result;
  } catch (err) {
    console.error(`fetchRegionData error for ${regionId}:`, err);
    return null;
  }
}

// Batcha in un solo POST tutte le regioni non ancora in cache (era una
// fetch sequenziale per battaglia). Vedi warera-api-batching.md.
async function fetchRegionDataBatch(regionIds) {
  const toFetch = [...new Set(regionIds)].filter(id => id && !state.regionCache.has(id));
  if (!toFetch.length) return;
  const calls = toFetch.map(id => ['region.getById', { regionId: id }]);
  const results = await trpcBatch(calls);
  toFetch.forEach((regionId, idx) => {
    const region = results[idx];
    if (!region) return;
    state.regionCache.set(regionId, {
      position: region.position || null,
      name: region.name || region.mainCity || '',
    });
  });
}

// ==================== LIVE BATTLE DATA ====================
// Versione singola (fallback). Il percorso "hot" usa fetchLiveBattleDataBatch.
async function fetchLiveBattleData(battleId) {
  try {
    const input = { battleId };
    const url = `${WORKER_API_BASE}/trpc/battle.getLiveBattleData?input=${encodeURIComponent(JSON.stringify(input))}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const live = data?.result?.data || data;
    const round = live?.round || {};
    return {
      attackerDmg: round.attackerDamages || 0,
      defenderDmg: round.defenderDamages || 0,
    };
  } catch (err) {
    console.warn(`fetchLiveBattleData error for ${battleId}:`, err);
    return null;
  }
}

// Batcha i dati live di tutte le battaglie in un solo POST (era Promise.all
// a gruppi di 5 -> ceil(N/5) richieste HTTP; ora 1 richiesta fino a 50
// battaglie, chunk automatico oltre). Vedi warera-api-batching.md.
async function fetchLiveBattleDataBatch(battleIds) {
  const liveDataMap = new Map();
  if (!battleIds.length) return liveDataMap;
  const calls = battleIds.map(id => ['battle.getLiveBattleData', { battleId: id }]);
  const results = await trpcBatch(calls, { useWorker: true });
  battleIds.forEach((battleId, idx) => {
    const live = results[idx];
    const round = live?.round || {};
    liveDataMap.set(battleId, live ? {
      attackerDmg: round.attackerDamages || 0,
      defenderDmg: round.defenderDamages || 0,
    } : null);
  });
  return liveDataMap;
}

// ==================== BUILD MARKER ELEMENT ====================
// Genera SOLO il markup del marker (nessun DOM, nessun listener), cosi' puo'
// essere riusato sia alla creazione sia agli aggiornamenti in place.
function buildMarkerMarkup(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend) {
  const attackerNation = getNation(battle.attacker?.country);
  const defenderNation = getNation(battle.defender?.country);
  const attackerName = attackerNation?.name || 'Unknown';
  const defenderName = defenderNation?.name || 'Unknown';
  const attackerCode = attackerNation?.code || '';
  const defenderCode = defenderNation?.code || '';

  const rawAtkColor = state.nationBaseColorMap.get(battle.attacker?.country);
  const rawDefColor = state.nationBaseColorMap.get(battle.defender?.country);
  const atkColor = brightenAndSaturate(rawAtkColor, 0.4);
  const defColor = brightenAndSaturate(rawDefColor, 0.4);

  let attackerDmg, defenderDmg;
  let useLive = false;
  if (liveData && (liveData.attackerDmg > 0 || liveData.defenderDmg > 0)) {
    attackerDmg = liveData.attackerDmg;
    defenderDmg = liveData.defenderDmg;
    useLive = true;
  } else {
    attackerDmg = totalAttackerDmg || 0;
    defenderDmg = totalDefenderDmg || 0;
  }

  const total = attackerDmg + defenderDmg;
  const showBar = total > 0;
  const atkPct = showBar ? Math.round(attackerDmg / total * 100) : 50;
  const defPct = showBar ? 100 - atkPct : 50;

  // Adattamento allo zoom. Su mobile lo zoom iniziale e' spesso sotto 3.5,
  // il che faceva scattare quasi sempre la fascia "low" (marker minuscoli,
  // testo a 6-7px, quasi impossibili da leggere o toccare su un telefono).
  // Alziamo la soglia effettiva su mobile cosi' i marker restano leggibili
  // e con un'area di tocco decente indipendentemente dal livello di zoom.
  const isMobile = window.innerWidth <= 768 || ('ontouchstart' in window);
  const effectiveZoom = isMobile ? Math.max(zoom, 3.5) : zoom;
  const isZoomLow = effectiveZoom < 3.5;
  const isZoomMedium = effectiveZoom >= 3.5 && effectiveZoom < 5;
  // WarEra+: font innalzati rispetto all'originale (erano 5-9px, quasi
  // illeggibili) — nuova fascia 9-12px, ancora scalata per zoom ma sempre
  // leggibile anche nella fascia "low".
  const fontSizeName = isZoomLow ? '9px' : (isZoomMedium ? '10px' : '11px');
  const fontSizeRegion = isZoomLow ? '8px' : (isZoomMedium ? '9px' : '10px');
  const fontSizePct = isZoomLow ? '8px' : (isZoomMedium ? '9px' : '10px');
  // WarEra+: padding leggermente più generoso + angoli molto più arrotondati
  // (prima 4-7px, quasi un rettangolo secco) — la card ora si legge come un
  // "badge" invece che una scheda squadrata.
  const padding = isZoomLow ? '5px 7px' : (isZoomMedium ? '6px 8px' : '7px 10px');
  const minWidth = isZoomLow ? 68 : (isZoomMedium ? 98 : 128);
  const maxWidth = isZoomLow ? 100 : (isZoomMedium ? 140 : 190);
  const borderRadius = isZoomLow ? '10px' : '14px';
  const gap = isZoomLow ? '2px' : '4px';
  const marginBottom = isZoomLow ? '1px' : '3px';

  const regionLabel = regionName || '⚔️ Battle';
  const liveLabel = useLive ? ' 🔴' : '';

  // SEMPRE mostra bandiere e percentuali
  const showFlags = true;
  const showPct = true;

  // WarEra+: colori theme-aware, come già fa buildBattleTooltipContent —
  // prima il marker era sempre scuro (rgba(10,12,20,...)) indipendentemente
  // dal tema selezionato.
  const isLight = state.theme === 'light';
  const bg = isLight ? 'rgba(255,255,255,0.97)' : 'rgba(10,12,20,0.96)';
  const bgHover = isLight ? 'rgba(255,250,245,0.99)' : 'rgba(18,20,34,0.98)';
  const border = isLight ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.1)';
  const barBg = isLight ? 'rgba(0,0,0,0.08)' : 'rgba(255,255,255,0.06)';
  const vsColor = isLight ? 'rgba(0,0,0,0.32)' : 'rgba(255,255,255,0.18)';
  const dimColor = isLight ? 'rgba(0,0,0,0.4)' : 'rgba(255,255,255,0.4)';

  // ── Info aggiuntive: danno combinato SEMPRE visibile (prima solo da
  //    zoom medio in su — era l'unico dato "extra" e spariva proprio dove
  //    i marker sono più numerosi/piccoli), momentum e cifre di danno
  //    grezze aggiunte da zoom medio in su dove c'è spazio. ──
  const totalLine = total > 0
    ? `<span style="color:${dimColor};">💥 ${fmt(total)}</span>`
    : '<span></span>';
  let momentumLine = '';
  if (!isZoomLow && trend && Math.abs(trend.balance) >= 0.08) {
    const defGaining = trend.balance > 0;
    const momColor = defGaining ? defColor : atkColor;
    const arrow = defGaining ? '🛡️◀' : '▶⚔️';
    momentumLine = `<span style="color:${momColor}; font-weight:700;">${arrow}</span>`;
  }
  const extraInfo = `
    <div style="display:flex; justify-content:space-between; align-items:center; margin-top:${marginBottom}; font-size:${fontSizePct};">
      ${totalLine}
      ${momentumLine}
    </div>
  `;

  // Cifre di danno grezze accanto alla percentuale — solo dove c'è spazio
  // (zoom medio/alto), per non affollare il badge minimo.
  const defDmgFig = !isZoomLow && showBar ? `<span style="opacity:0.7; font-weight:500;"> · ${fmt(defenderDmg)}</span>` : '';
  const atkDmgFig = !isZoomLow && showBar ? `<span style="opacity:0.7; font-weight:500;"> · ${fmt(attackerDmg)}</span>` : '';

  // Nastro superiore (gradiente difensore -> attaccante) + badge incrociato:
  // prima la card era un rettangolo secco senza alcun accento visivo in
  // cima, ora si legge subito come "scheda di battaglia" invece che una
  // card generica.
  const ribbonHeight = isZoomLow ? '3px' : '4px';
  const badgeSize = isZoomLow ? '14px' : '18px';

  return `
    <div style="
      position: relative;
      background: ${bg};
      border: 1px solid ${border};
      border-radius: ${borderRadius};
      padding: ${padding};
      padding-top: calc(${padding.split(' ')[0]} + ${ribbonHeight});
      min-width: ${minWidth}px;
      max-width: ${maxWidth}px;
      font-family: Inter, system-ui, sans-serif;
      cursor: pointer;
      user-select: none;
      box-shadow: 0 2px 10px rgba(0,0,0,${isLight ? '0.12' : '0.35'});
      overflow: visible;
      transition: border-color 0.15s, box-shadow 0.15s, background 0.15s;
    " class="bm-inner" data-bg="${bg}" data-bg-hover="${bgHover}">
      <div style="position:absolute; top:0; left:0; right:0; height:${ribbonHeight}; border-radius:${borderRadius} ${borderRadius} 0 0; background:linear-gradient(90deg, ${defColor}, ${atkColor}); overflow:hidden;"></div>
      <div style="position:absolute; top:-1px; left:50%; transform:translate(-50%,-50%); width:${badgeSize}; height:${badgeSize}; border-radius:50%; background:${bg}; border:1px solid ${border}; display:flex; align-items:center; justify-content:center; font-size:${isZoomLow ? '8px' : '10px'}; box-shadow:0 1px 4px rgba(0,0,0,0.25);">⚔️</div>
      <div style="font-size:${fontSizeRegion}; font-weight:700; text-transform:uppercase; letter-spacing:0.4px; text-align:center; color:${defColor}; margin-bottom:${marginBottom}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">
        ${escapeHtml(regionLabel)}${liveLabel}
      </div>
      <div style="display:flex; align-items:center; gap:${gap}; margin-bottom:${marginBottom};">
        <!-- DIFENSORE a SINISTRA -->
        <div style="display:flex; align-items:center; gap:3px; flex:1; min-width:0;">
          ${defenderCode && showFlags ? `<img src="${getFlagUrl(defenderCode)}" style="height:${isZoomLow ? '9px' : '11px'}; width:auto; border-radius:1px; flex-shrink:0; opacity:0.95; border: 1px solid rgba(255,255,255,0.08);" onerror="this.style.display='none'">` : ''}
          <span style="font-size:${fontSizeName}; font-weight:700; color:${defColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;">${escapeHtml(defenderName)}</span>
        </div>
        <span style="font-size:${isZoomLow ? '7px' : '8px'}; color:${vsColor}; flex-shrink:0; font-weight:500;">vs</span>
        <!-- ATTACCANTE a DESTRA -->
        <div style="display:flex; align-items:center; gap:3px; flex:1; min-width:0; justify-content:flex-end;">
          <span style="font-size:${fontSizeName}; font-weight:700; color:${atkColor}; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-align:right;">${escapeHtml(attackerName)}</span>
          ${attackerCode && showFlags ? `<img src="${getFlagUrl(attackerCode)}" style="height:${isZoomLow ? '9px' : '11px'}; width:auto; border-radius:1px; flex-shrink:0; opacity:0.95; border: 1px solid rgba(255,255,255,0.08);" onerror="this.style.display='none'">` : ''}
        </div>
      </div>
      ${showBar ? `
        <div style="height:${isZoomLow ? '3px' : '4px'}; border-radius:2px; overflow:hidden; display:flex; background:${barBg};">
          <div style="width:${defPct}%; background:${defColor}; border-radius:2px 0 0 2px; transition:width 0.5s cubic-bezier(0.22, 1, 0.36, 1);"></div>
          <div style="width:${atkPct}%; background:${atkColor}; border-radius:0 2px 2px 0; transition:width 0.5s cubic-bezier(0.22, 1, 0.36, 1);"></div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:${isZoomLow ? '1px' : '2px'};">
          <span style="font-size:${fontSizePct}; color:${defColor}; font-weight:600;">${defPct}%${defDmgFig}</span>
          <span style="font-size:${fontSizePct}; color:${atkColor}; font-weight:600;">${atkPct}%${atkDmgFig}</span>
        </div>
      ` : `
        <div style="height:${isZoomLow ? '3px' : '4px'}; border-radius:2px; overflow:hidden; display:flex; background:${barBg};">
          <div style="width:50%; background:${defColor}; opacity:0.4; border-radius:2px 0 0 2px;"></div>
          <div style="width:50%; background:${atkColor}; opacity:0.4; border-radius:0 2px 2px 0;"></div>
        </div>
        <div style="display:flex; justify-content:space-between; margin-top:${isZoomLow ? '1px' : '2px'};">
          <span style="font-size:${fontSizePct}; color:${defColor}; font-weight:600; opacity:0.5;">50%</span>
          <span style="font-size:${fontSizePct}; color:${atkColor}; font-weight:600; opacity:0.5;">50%</span>
        </div>
      `}
      ${extraInfo}
    </div>
  `;
}

// Aggiorna il contenuto di un marker gia' montato, senza ricrearlo.
// I dati correnti vivono su el._battleData: i listener (agganciati una volta
// sola alla creazione) li leggono da li', altrimenti resterebbero legati alla
// battaglia catturata nella closure al primo render.
function updateMarkerEl(el, battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend) {
  el._battleData = { battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend };
  el.innerHTML = buildMarkerMarkup(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend);
}

function buildMarkerEl(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend) {
  const el = document.createElement('div');
  el.className = 'battle-marker';
  updateMarkerEl(el, battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, zoom, trend);

  // .bm-inner viene ricreato ad ogni updateMarkerEl, quindi va risolto al
  // momento dell'evento e non catturato una volta sola. I colori vengono
  // letti dagli attributi data-bg/data-bg-hover impostati in
  // buildMarkerMarkup (theme-aware) invece di valori hardcoded sempre
  // scuri come nella versione precedente.
  const hoverStyle = (borderColor, boxShadow, useHoverBg) => {
    const inner = el.querySelector('.bm-inner');
    if (!inner) return;
    inner.style.borderColor = borderColor;
    inner.style.boxShadow = boxShadow;
    inner.style.background = useHoverBg ? inner.dataset.bgHover : inner.dataset.bg;
  };
  el.addEventListener('mouseenter', () => {
    hoverStyle('rgba(255,68,68,0.45)', '0 4px 18px rgba(255,68,68,0.18)', true);
  });
  el.addEventListener('mouseleave', () => {
    hoverStyle('rgba(255,255,255,0.1)', 'none', false);
  });

  // Click handler: legge i dati correnti da el._battleData, non dalla closure
  // (che resterebbe ferma ai valori del primo render).
  el.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();

    const d = el._battleData;
    if (!d) return;
    const battleId = d.battle._id;

    // Se la heatmap è già aperta su questa battaglia, esci
    if (state.coloringMode === 'battleHeatmap' &&
        state.battleHeatmapData?.battleId === battleId) {
      hideBattleTooltip();
      return;
    }

    showBattleTooltip(d.battle, d.regionName, d.liveData, d.totalAttackerDmg, d.totalDefenderDmg, d.trend);
    setBattleHeatmap(battleId);
    hideAllMarkers();

    const regionId = d.battle.regionId || d.battle.defender?.region || d.battle.attacker?.region;
    if (regionId) {
      const cached = state.regionCache.get(regionId);
      if (cached?.position) {
        highlightBattleRegion(cached.position);
      } else {
        fetchRegionData(regionId).then(region => {
          if (region?.position) highlightBattleRegion(region.position);
        });
      }
    }
  });

  // Nota: niente hack di padding/margin negativo sull'elemento radice per
  // allargare l'area di tocco — maplibre calcola l'ancoraggio del marker
  // sulla dimensione di questo stesso elemento, e alterarla rischierebbe di
  // disallineare il marker dal punto geografico reale. L'area di tocco resta
  // comunque piu' grande su mobile grazie alla fascia di zoom minima
  // "medium" forzata sopra (minWidth/padding piu' generosi).
  Object.assign(el.style, { pointerEvents: 'auto', zIndex: 2000 });
  return el;
}

// ==================== UPDATE MARKERS ====================
export async function updateBattleMarkers() {
  // Se i marker sono disabilitati, esci
  if (!markersEnabled) return;
  if (!state.map) return;
  _bindViewportSync();

  try {
    const battles = await fetchActiveBattles();
    
    // Se la risposta è vuota e abbiamo dati salvati, mantieni quelli
    if ((!battles || battles.length === 0) && lastSuccessfulBattles.length > 0) {
      // Non fare nulla, mantieni i marker esistenti
      return;
    }
    
    // Se abbiamo dati validi, aggiorna
    if (battles && battles.length > 0) {
      // Salva i dati validi
      lastSuccessfulBattles = battles;

      // Dati live: 1 solo POST batch per tutte le battaglie.
      const battleIds = battles.map(b => b._id);
      const liveDataMap = await fetchLiveBattleDataBatch(battleIds);

      // Dati regione: 1 solo POST batch per tutte le regioni non in cache.
      const regionIds = battles
        .map(b => b.regionId || b.defender?.region || b.attacker?.region)
        .filter(Boolean);
      await fetchRegionDataBatch(regionIds);

      // DIFF invece di clearMarkers()+ricrea-tutto: qui si popola SOLO
      // battleCache con i dati aggiornati di TUTTE le battaglie attive.
      // Creazione/aggiornamento in place/rimozione dei Marker DOM veri e
      // propri, filtrata al viewport (+ decluttering), è delegata tutta a
      // _syncMarkersToViewport() in fondo (vedi nota su battleCache in
      // testa al file) — un solo punto che li tocca invece di due,
      // altrimenti questo giro e un moveend nel frattempo potevano pestarsi
      // i piedi aggiornando lo stesso marker con `zoom` diversi.
      const seen = new Set();

      for (const battle of battles) {
        const regionId = battle.regionId || battle.defender?.region || battle.attacker?.region;

        let centroid = null;
        let regionName = '';

        if (regionId) {
          const cached = state.regionCache?.get(regionId);
          if (cached) {
            centroid = cached.position;
            regionName = cached.name || '';
          }
        }

        if (!centroid) {
          const fallbackId = battle.defender?.country || battle.attacker?.country;
          if (fallbackId) centroid = state.centroids.get(fallbackId);
        }
        if (!centroid) continue;

        // WarEra+ FIX (bug segnalato: "Defender total" mostrava molto meno
        // del reale danno in corso): `battle.attacker.damages` /
        // `battle.defender.damages` (top-level) sono SOLO la somma dei
        // round GIA' COMPLETATI di questa battaglia — il round in corso non
        // ci finisce mai (resta a 0 finché il round non si chiude).
        // Verificato contro l'API reale (battle.getBattles): una battaglia
        // con `attacker.damages: 8058358` aveva contemporaneamente
        // `currentRound.attacker.damages: 4267936` di danno IN CORSO non
        // ancora incluso — quindi "Attacker total" mostrava 8M invece dei
        // reali ~12.3M. `battle.getBattles` include comunque sempre
        // `currentRound.{attacker,defender}.damages` inline nello stesso
        // oggetto (nessuna chiamata aggiuntiva necessaria): li sommiamo qui
        // per ottenere il vero totale cumulativo della battaglia.
        const totalAttackerDmg = (battle.attacker?.damages || 0) + (battle.currentRound?.attacker?.damages || 0);
        const totalDefenderDmg = (battle.defender?.damages || 0) + (battle.currentRound?.defender?.damages || 0);
        const liveData = liveDataMap.get(battle._id);

        // Stesso criterio usato nel markup per scegliere i danni "effettivi"
        // (live se disponibili, altrimenti i totali): il trend deve seguire
        // la stessa fonte, altrimenti oscillerebbe ogni volta che live/non
        // live si alternano.
        const effAtk = (liveData && (liveData.attackerDmg > 0 || liveData.defenderDmg > 0))
          ? liveData.attackerDmg : totalAttackerDmg;
        const effDef = (liveData && (liveData.attackerDmg > 0 || liveData.defenderDmg > 0))
          ? liveData.defenderDmg : totalDefenderDmg;
        const trend = computeTrend(battle._id, effAtk, effDef);

        seen.add(battle._id);
        battleCache.set(battle._id, { battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend, centroid });
        // Creazione/aggiornamento/rimozione del Marker DOM è tutta delegata
        // a _syncMarkersToViewport() più sotto (una sola chiamata, dopo il
        // loop) — crearlo/aggiornarlo qui per ogni battaglia a prescindere
        // dal viewport sarebbe esattamente il lavoro che vogliamo evitare.
      }

      // Rimuovi dalla cache (e i relativi marker montati) le battaglie non
      // piu' attive.
      for (const [battleId] of battleCache) {
        if (seen.has(battleId)) continue;
        battleCache.delete(battleId);
        const entry = markers.get(battleId);
        if (entry) { try { entry.marker.remove(); } catch (e) {} markers.delete(battleId); }
        battleHistory.delete(battleId); // niente memoria di trend per battaglie chiuse
      }

      _syncMarkersToViewport();
    }
  } catch (err) {
    console.error('Error updating battle markers:', err);
    // In caso di errore, mantieni i marker esistenti
  }
}

// ==================== VISIBILITÀ MARKER (focus battaglia) ====================
// Quando si apre la heatmap di una battaglia, TUTTI i marker sulla mappa
// si nascondono (compreso quello della battaglia selezionata: resta
// solo il tooltip centrale, non più anche il marker sopra la regione)
// per ridurre l'affollamento visivo. Tornano visibili quando si esce
// dalla heatmap (click fuori, tasto Escape, chiusura tooltip, o click
// sulla stessa battaglia per deselezionarla).
export function hideAllMarkers() {
  _allHidden = true;
  markers.forEach(({ el }) => { el.style.display = 'none'; });
}

export function showAllMarkers() {
  _allHidden = false;
  markers.forEach(({ el }) => { el.style.display = ''; });
  // La vista può essersi spostata mentre i marker erano nascosti (battaglia
  // selezionata con heatmap aperta): risincronizza col viewport corrente
  // invece di limitarsi a fare display:'' su un set potenzialmente stale.
  _syncMarkersToViewport();
}


export function clearMarkers() {
  markers.forEach(({ marker }) => {
    try { marker.remove(); } catch (e) {}
  });
  markers.clear();
  battleCache.clear();
}

// ==================== FORCE UPDATE ====================
export function forceUpdateBattleMarkers() {
  lastSuccessfulBattles = [];
  updateBattleMarkers();
}

// NOTA: initBattleMarkers()/startMarkerUpdates() sono state rimosse.
// Non erano chiamate da nessun modulo e cercavano l'id 'toggle-battle-markers'
// che non esiste nell'HTML (l'id reale e' 'checkActiveBattles'). Il ciclo di
// aggiornamento e' gestito da main.js, il toggle da toggleBattleMarkers().