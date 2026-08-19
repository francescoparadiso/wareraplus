// battleMarkers.js - versione completa con gestione 429 e cache

import { state } from './state.js';
import maplibregl from 'maplibre-gl';
import { fetchActiveBattles, setBattleHeatmap } from './battleHeatmap.js';
import { API_BASE_URL, WORKER_API_BASE } from './config.js';
import { trpcBatch, escapeHtml, getNation } from './utils.js';
import { highlightBattleRegion, clearBattleRegionHighlight } from './map.js';
import { trackEvent } from '../shared/analytics.js';

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

// WarEra+: bolle "+N" per i cluster di battaglie ravvicinate (richiesta
// esplicita: zone come i Balcani, dove a zoom lontano tante battaglie si
// accavallano). Chiave = battleId del "vincitore" del cluster (quello che
// resta visibile come card intera) -> { marker, el }. Ricostruite da zero
// ad ogni _declutterMarkers (poche decine di marker al massimo, costo
// trascurabile), non serve tracciarle in modo incrementale.
let clusterMarkers = new Map();

// WarEra+ perf: un maplibregl.Marker ATTACCATO alla mappa resta agganciato
// ai suoi eventi 'move'/'moveend' e viene riproiettato ad ogni movimento
// anche quando il suo elemento è display:none. Col decluttering per cluster
// la maggior parte dei marker è nascosta (misurato dal vivo: 23 su 34 in una
// situazione normale) e pagava quel costo per niente, oltre a tenere altri
// 23 nodi nel DOM sopra al canvas.
// Staccarli davvero — Marker.remove() sgancia i listener e toglie il nodo —
// e riattaccarli quando tornano visibili costa quanto il display:none di
// prima, ma azzera il lavoro per-movimento. Il display resta comunque
// allineato: è quello che il resto del file legge come "stato visibile".
// NB: Marker.addTo() chiama this.remove() come prima cosa, quindi è
// idempotente — riattaccare un marker già attaccato è sicuro.
function _setMarkerVisible(entry, visible) {
  if (!entry) return;
  entry.el.style.display = visible ? '' : 'none';
  if (visible) {
    if (state.map) entry.marker.addTo(state.map);
  } else {
    try { entry.marker.remove(); } catch (e) {}
  }
}

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
        // Non più .addTo() incondizionato: _setMarkerVisible attacca solo
        // se il marker deve davvero essere visibile (vedi la sua nota).
        const marker = new maplibregl.Marker({ element: el }).setLngLat(d.centroid);
        const entry = { marker, el };
        markers.set(battleId, entry);
        _setMarkerVisible(entry, !_allHidden);
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
// Raggruppa in CLUSTER (componenti connesse in spazio schermo, non solo
// coppie: così un gruppo tipo i Balcani si aggrega in un unico cluster
// anche se non tutte le battaglie si sovrappongono esattamente fra loro,
// a catena sì) — in ogni cluster resta visibile per intero solo la
// battaglia più "pesante" (stesso criterio di prima, danno totale), le
// altre si nascondono (display:none, i dati restano in battleCache) e, se
// il cluster ha più di una battaglia, compare una bolla "+N" (vedi
// _createClusterBubble) che zooma su tutto il gruppo al click. Ricalcolato
// ad ogni sync (pan/zoom/refresh dati), si aggiusta da solo quando lo zoom
// separa i punti abbastanza da non aver più bisogno del cluster.
function _declutterMarkers(zoom) {
  if (_allHidden || !state.map) return;
  const { w: cellW, h: cellH } = _footprintForZoom(zoom);

  clusterMarkers.forEach(({ marker }) => { try { marker.remove(); } catch (e) {} });
  clusterMarkers.clear();

  const entries = [...markers.entries()]
    .map(([battleId, m]) => {
      const d = battleCache.get(battleId);
      if (!d) return null;
      const total = (d.totalAttackerDmg || 0) + (d.totalDefenderDmg || 0);
      return { battleId, m, d, total, p: state.map.project(d.centroid) };
    })
    .filter(Boolean);

  // Union-find su "si toccherebbero visivamente" — raggio leggermente più
  // ampio (1.4x) della sola soglia di sovrapposizione del singolo marker,
  // così un gruppo denso si aggrega in un cluster invece di restare a
  // coppie separate. Transitivo: A vicino a B, B vicino a C -> stesso
  // cluster anche se A e C da soli non si toccherebbero.
  const clusterW = cellW * 1.4;
  const clusterH = cellH * 1.4;
  const parent = entries.map((_, i) => i);
  const find = (i) => { while (parent[i] !== i) { parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const union = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; };
  for (let i = 0; i < entries.length; i++) {
    for (let j = i + 1; j < entries.length; j++) {
      if (Math.abs(entries[i].p.x - entries[j].p.x) < clusterW && Math.abs(entries[i].p.y - entries[j].p.y) < clusterH) {
        union(i, j);
      }
    }
  }
  const groups = new Map(); // radice union-find -> entries[]
  entries.forEach((e, i) => {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(e);
  });

  groups.forEach(group => {
    group.sort((a, b) => b.total - a.total);
    const [winner, ...rest] = group;
    _setMarkerVisible(winner.m, true);
    rest.forEach(e => _setMarkerVisible(e.m, false));
    if (group.length > 1) _createClusterBubble(zoom, group, winner);
  });
}

// Bolla "+N" (N = battaglie nel cluster oltre a quella già mostrata per
// intero) ancorata allo stesso punto della card vincitrice, spostata verso
// l'angolo in alto a destra via `offset` (pixel, indipendente dallo zoom —
// supportato nativamente da maplibregl.Marker, non serve calcolarlo a mano
// ad ogni frame). Al click: zoom su tutto il cluster (_zoomToCluster).
function _createClusterBubble(zoom, group, winner) {
  const extra = group.length - 1;
  const { w, h } = _footprintForZoom(zoom);
  const isLight = state.theme === 'light';

  const el = document.createElement('div');
  el.className = 'battle-cluster-bubble';
  el.title = `${group.length} battaglie in quest'area — clicca per vederle tutte`;
  el.style.cssText = `
    display: flex; align-items: center; justify-content: center;
    min-width: 22px; height: 22px; padding: 0 5px; border-radius: 11px;
    background: linear-gradient(135deg, #ff5f5f, #d81c3f);
    border: 2px solid ${isLight ? '#fff' : 'rgba(13,17,23,0.9)'};
    color: #fff; font-family: Inter, system-ui, sans-serif;
    font-size: 11px; font-weight: 800; line-height: 1;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
    cursor: pointer; user-select: none; pointer-events: auto;
  `;
  // BUG FIX (segnalato dall'utente: bolla nascosta dietro la card): maplibre
  // applica .maplibregl-marker (position:absolute) DIRETTAMENTE all'elemento
  // passato a `element` — non c'è un wrapper. La card vincitrice ha
  // z-index:2000 esplicito (vedi buildMarkerEl più sotto); un elemento
  // fratello con z-index:auto perde SEMPRE contro un valore esplicito,
  // indipendentemente da quale sia più recente nel DOM. Serve uno z-index
  // esplicito più alto qui, non basta crearla dopo.
  el.style.zIndex = '2100';
  el.textContent = `+${extra}`;

  el.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    _zoomToCluster(group);
  });

  const marker = new maplibregl.Marker({ element: el, offset: [w / 2 - 2, -h / 2 + 2] })
    .setLngLat(winner.d.centroid)
    .addTo(state.map);
  clusterMarkers.set(winner.battleId, { marker, el });
}

// "Cliccando deve zoommare sulla zona in modo che si vedano tutte" — fitBounds
// su tutti i centroidi del cluster, con margine e un tetto di zoom (evita di
// zoommare in modo assurdo se le battaglie del cluster sono praticamente
// nello stesso punto). moveend scatta comunque a fine animazione e
// risincronizza/ridecluttera da sola coi punti ora più separati.
function _zoomToCluster(group) {
  if (!state.map || !group.length) return;
  const bounds = new maplibregl.LngLatBounds();
  group.forEach(e => bounds.extend(e.d.centroid));
  state.map.fitBounds(bounds, { padding: 80, maxZoom: 7, duration: 500 });
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
// WarEra+: stato collassato del tooltip battaglia — persiste tra i rebuild
// innescati dal refresh marker (~30s), cosi' l'utente non deve ri-collassare
// ogni volta. Reset solo quando il tooltip si chiude (hideBattleTooltip).
let tooltipCollapsed = false;
// Apertura del pannello "Other contributors", separata per breakpoint: su
// desktop e' una colonna a lato e c'e' spazio per tenerla aperta di default,
// su mobile e' una sezione dentro la card e parte chiusa (richiesta
// esplicita). Tenerle distinte evita che un resize della finestra erediti
// lo stato dell'altro layout. Reset in hideBattleTooltip, come tooltipCollapsed.
const CONTRIB_NARROW_MQ = '(max-width: 768px)';
const isNarrowLayout = () => window.matchMedia(CONTRIB_NARROW_MQ).matches;
let contribOpenDesktop = true;
let contribOpenMobile = false;
// Modalità "leggi bene" — ingrandisce SOLO il pannello contribuenti (riquadro
// più alto/largo, righe più grandi). Unica per i due layout (a differenza di
// contribOpen*: qui non c'è motivo di volerla diversa da desktop a mobile,
// resta solo "espanso sì/no"). Reset in hideBattleTooltip.
let contribExpanded = false;
// Etichetta del bottone "espandi": collassato invita ad aprire la vista
// completa ("All data"), espanso invita a tornare a quella compatta.
const contribExpandLabel = (expanded) => expanded ? '🔼 Top only' : '📊 All data';

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
// WarEra+: colonna "Other contributors" (nazioni sotto l'1% del danno
// totale) — solo desktop, a destra del tooltip principale, stile "hall of
// fame" (vedi src/app/timeMachine.js per il precedente usato come
// riferimento visivo). Su mobile diventa una sezione collassabile DENTRO il
// tooltip stesso (bottone dedicato, chiusa di default). Layout via classi +
// media query (non JS isMobile) cosi' reagisce anche al resize della
// finestra, non solo al render iniziale — stesso principio di
// injectStyles() in blocStats.js: iniettato una sola volta, idempotente.
function injectContribStyles() {
  if (document.getElementById('bfm-contrib-style')) return;
  const s = document.createElement('style');
  s.id = 'bfm-contrib-style';
  s.textContent = `
    /* Colonna desktop: a scomparsa come la sezione mobile — si apre/chiude
       dallo STESSO bottone dentro la card della battaglia (.bfm-contrib-toggle),
       che pilota le classi bfm-contrib-desktop-open / bfm-contrib-mobile-open
       sul wrapper #battle-tooltip. Due flag separate (una per breakpoint):
       su desktop c'e' spazio e parte aperta, su mobile parte chiusa. */
    /* Ancorata FUORI dal flusso flex, agganciata al fianco destro della card
       (left:100% = bordo destro del wrapper, che con la colonna in absolute
       è largo quanto la sola card). Serve perché il wrapper è centrato con
       translateX(-50%): da figlio flex, allargare la colonna spingeva la
       card di battaglia verso sinistra ad ogni "All data". Così la card non
       si muove di un pixel e il pannello cresce solo verso destra. */
    #battle-tooltip-contributors {
      display: none;
      position: absolute;
      left: 100%;
      bottom: 0;
      margin-left: 8px;
      flex-direction: column;
      width: 208px;
      /* Lo spazio REALE a destra della card: metà viewport, meno metà card
         (il 50% si risolve sulla larghezza del wrapper = la card, essendo
         questo elemento fuori dal flusso), meno il margine di 8px e 10px di
         aria dal bordo finestra. Vale anche qui da collassata, altrimenti su
         finestre strette la versione compatta risulterebbe più larga di
         quella espansa. */
      max-width: min(230px, calc(50vw - 50% - 18px));
      max-height: 320px;
      border-radius: 10px;
      overflow: hidden;
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
      flex-shrink: 0;
      box-sizing: border-box;
    }
    #battle-tooltip.bfm-contrib-desktop-open #battle-tooltip-contributors.bfm-contrib-has-data { display: flex; }
    @media (max-width: 768px) {
      #battle-tooltip-contributors { display: none !important; }
    }
    #battle-contrib-list-desktop, #battle-contrib-list-desktop-full { flex: 1 1 auto; min-height: 0; overflow-y: auto; }
    #battle-contrib-list-mobile, #battle-contrib-list-mobile-full { max-height: 190px; overflow-y: auto; }
    .bfm-contrib-title { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; padding: 8px 10px 6px; flex-shrink: 0; }
    /* Bottone "All data": la vista compatta (solo nazioni <1%) serve a non
       ingombrare la mappa, ma non fa vedere il quadro completo. Cliccandolo
       si passa alla vista estesa — OGNI nazione che ha fatto danno, divisa
       per lato — in un riquadro anche piu' grande per leggerla comoda
       (richiesta esplicita). Le due liste (compatta/-full) convivono nel
       DOM, sempre aggiornate insieme (renderOtherContributors in
       battleFront.js): qui si sceglie solo quale mostrare. */
    .bfm-contrib-expand { display: flex; align-items: center; gap: 3px; cursor: pointer; opacity: 0.65; font-size: 10px; font-weight: 700; letter-spacing: 0.3px; line-height: 1; padding: 3px 6px; border-radius: 4px; flex-shrink: 0; }
    .bfm-contrib-expand:hover { opacity: 1; background: rgba(128,128,128,0.15); }
    #battle-contrib-list-desktop-full, #battle-contrib-list-mobile-full { display: none; }
    #battle-tooltip-contributors.bfm-contrib-expanded #battle-contrib-list-desktop { display: none; }
    #battle-tooltip-contributors.bfm-contrib-expanded #battle-contrib-list-desktop-full { display: block; }
    #battle-contrib-mobile-section.bfm-contrib-expanded #battle-contrib-list-mobile { display: none; }
    #battle-contrib-mobile-section.bfm-contrib-expanded #battle-contrib-list-mobile-full { display: block; }
    /* Espansa: cresce verso destra (vedi left:100% sopra), fin dove arriva lo
       spazio disponibile. Se la finestra è troppo stretta per due colonne il
       grid qui sotto le impila da solo invece di sfondare il bordo. */
    #battle-tooltip-contributors.bfm-contrib-expanded {
      width: 440px;
      max-width: calc(50vw - 50% - 18px);
      max-height: min(70vh, 560px);
    }
    #battle-contrib-mobile-section.bfm-contrib-expanded #battle-contrib-list-mobile-full { max-height: min(60vh, 420px); }

    /* Due colonne affiancate (difesa | attacco) nella vista "All data".
       auto-fit + minmax: restano affiancate finché c'è spazio, si impilano
       da sole sotto i ~150px per colonna (caso mobile stretto) senza dover
       duplicare il markup in una media query. */
    .bfm-contrib-cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); align-items: start; }
    .bfm-contrib-col { min-width: 0; }
    .bfm-contrib-col + .bfm-contrib-col { border-left: 1px solid rgba(128,128,128,0.18); }
    .bfm-contrib-col-def { background: color-mix(in srgb, var(--bfm-c-def, #8fc3e8) 7%, transparent); }
    .bfm-contrib-col-atk { background: color-mix(in srgb, var(--bfm-c-atk, #ef9269) 7%, transparent); }
    .bfm-contrib-col-def .bfm-contrib-side-title, .bfm-contrib-col-def .bfm-contrib-pct { color: var(--bfm-c-def-ink, #8fc3e8); }
    .bfm-contrib-col-atk .bfm-contrib-side-title, .bfm-contrib-col-atk .bfm-contrib-pct { color: var(--bfm-c-atk-ink, #ef9269); }
    /* Intestazione di colonna sempre visibile mentre si scorre: senza, in una
       lista lunga si perde di vista quale colonna si sta leggendo. Lo sfondo
       pieno è obbligatorio o le righe ci passerebbero sotto in trasparenza. */
    .bfm-contrib-side-title {
      position: sticky; top: 0; z-index: 1;
      display: flex; align-items: baseline; gap: 4px;
      padding: 7px 10px 4px; font-size: 9.5px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.4px;
      background: var(--bfm-c-bg, rgba(13,17,23,0.97));
      border-bottom: 1px solid rgba(128,128,128,0.18);
    }
    .bfm-contrib-side-count { font-weight: 500; opacity: 0.75; text-transform: none; }
    /* Totale del lato = denominatore delle percentuali della colonna. */
    .bfm-contrib-side-total { margin-left: auto; font-variant-numeric: tabular-nums; text-transform: none; }
    /* Riga su DUE livelli: nome sopra, danno sotto in piccolo. Con tutto su
       una riga sola il danno (non comprimibile, e' un numero) schiacciava
       il nome fino a una lettera sola — verificato dal vivo in una colonna
       da 190px. Cosi' il nome ha l'intera larghezza. */
    .bfm-contrib-row { display: flex; align-items: center; gap: 7px; padding: 5px 10px; font-size: 11px; }
    .bfm-contrib-row:not(:last-child) { border-bottom: 1px solid rgba(128,128,128,0.12); }
    .bfm-contrib-flag { width: 15px; height: 11px; object-fit: cover; border-radius: 1px; flex-shrink: 0; }
    .bfm-contrib-main { flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; gap: 1px; }
    .bfm-contrib-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .bfm-contrib-dmg { opacity: 0.62; font-variant-numeric: tabular-nums; font-size: 9px; white-space: nowrap; }
    .bfm-contrib-pct { flex-shrink: 0; font-weight: 700; font-variant-numeric: tabular-nums; min-width: 42px; text-align: right; }
    .bfm-contrib-empty { padding: 10px; text-align: center; font-size: 11px; opacity: 0.6; }
    .bfm-contrib-expanded .bfm-contrib-row { gap: 9px; padding: 7px 12px; font-size: 13px; }
    .bfm-contrib-expanded .bfm-contrib-flag { width: 19px; height: 14px; }
    .bfm-contrib-expanded .bfm-contrib-dmg { font-size: 10.5px; }
    .bfm-contrib-expanded .bfm-contrib-pct { min-width: 50px; font-size: 13px; }
    .bfm-contrib-expanded .bfm-contrib-side-title { font-size: 11px; padding: 10px 12px 4px; }

    /* Scrollbar: quella nativa (larga, grigio sistema, con frecce su Windows)
       stonava con il resto del tool. Qui e' sottile, senza frecce e senza
       traccia visibile, col pollice tinto sui colori del tema — i due colori
       arrivano da variabili CSS impostate inline sul contenitore in
       buildBattleTooltipContent, che e' il punto dove si sa gia' se il tema
       e' chiaro o scuro. Firefox non supporta ::-webkit-scrollbar ma ha
       scrollbar-width/scrollbar-color, quindi entrambe le sintassi. */
    #battle-contrib-list-desktop, #battle-contrib-list-mobile,
    #battle-contrib-list-desktop-full, #battle-contrib-list-mobile-full {
      scrollbar-width: thin;
      scrollbar-color: var(--bfm-sb-thumb, rgba(139,148,158,0.45)) transparent;
      overscroll-behavior: contain;
    }
    #battle-contrib-list-desktop::-webkit-scrollbar,
    #battle-contrib-list-mobile::-webkit-scrollbar,
    #battle-contrib-list-desktop-full::-webkit-scrollbar,
    #battle-contrib-list-mobile-full::-webkit-scrollbar { width: 6px; height: 6px; }
    #battle-contrib-list-desktop::-webkit-scrollbar-track,
    #battle-contrib-list-mobile::-webkit-scrollbar-track,
    #battle-contrib-list-desktop-full::-webkit-scrollbar-track,
    #battle-contrib-list-mobile-full::-webkit-scrollbar-track { background: transparent; }
    #battle-contrib-list-desktop::-webkit-scrollbar-thumb,
    #battle-contrib-list-mobile::-webkit-scrollbar-thumb,
    #battle-contrib-list-desktop-full::-webkit-scrollbar-thumb,
    #battle-contrib-list-mobile-full::-webkit-scrollbar-thumb {
      background: var(--bfm-sb-thumb, rgba(139,148,158,0.45));
      border-radius: 3px;
    }
    #battle-contrib-list-desktop::-webkit-scrollbar-thumb:hover,
    #battle-contrib-list-mobile::-webkit-scrollbar-thumb:hover,
    #battle-contrib-list-desktop-full::-webkit-scrollbar-thumb:hover,
    #battle-contrib-list-mobile-full::-webkit-scrollbar-thumb:hover {
      background: var(--bfm-sb-thumb-hover, rgba(139,148,158,0.75));
    }
    #battle-contrib-list-desktop::-webkit-scrollbar-button,
    #battle-contrib-list-mobile::-webkit-scrollbar-button,
    #battle-contrib-list-desktop-full::-webkit-scrollbar-button,
    #battle-contrib-list-mobile-full::-webkit-scrollbar-button { display: none; height: 0; width: 0; }
    #battle-contrib-list-desktop::-webkit-scrollbar-corner,
    #battle-contrib-list-mobile::-webkit-scrollbar-corner,
    #battle-contrib-list-desktop-full::-webkit-scrollbar-corner,
    #battle-contrib-list-mobile-full::-webkit-scrollbar-corner { background: transparent; }

    .bfm-contrib-toggle { display: none; }
    .bfm-contrib-toggle.bfm-contrib-has-data { display: flex; }
    .bfm-contrib-mobile-section { display: none; overflow: hidden; }
    @media (max-width: 768px) {
      #battle-tooltip.bfm-contrib-mobile-open .bfm-contrib-mobile-section.bfm-contrib-has-data { display: block; }
    }
  `;
  document.head.appendChild(s);
}

function getBattleTooltipEl() {
  injectContribStyles();
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
      /* Ora un contenitore flex: il tooltip principale (#battle-tooltip-main,
         width vincolata li' sotto) piu', su desktop, la colonna "Other
         contributors" come sibling a destra (#battle-tooltip-contributors).
         Su mobile quest'ultima e' display:none via media query, quindi la
         larghezza del wrapper collassa comunque su quella del solo main. */
      display: flex;
      align-items: flex-end;
      gap: 8px;
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

  // Stato del pannello contribuenti per il layout ATTUALE (vedi le due flag
  // in testa al file): serve solo a disegnare il verso della freccia coerente
  // col pannello che quel bottone apre qui e ora.
  const contribOpen = isNarrowLayout() ? contribOpenMobile : contribOpenDesktop;
  // Pollice della scrollbar tinto sul tema — le liste lo leggono da queste
  // variabili (vedi injectContribStyles).
  const sbVars = (isLight
    ? '--bfm-sb-thumb: rgba(0,0,0,0.22); --bfm-sb-thumb-hover: rgba(0,0,0,0.38);'
    : '--bfm-sb-thumb: rgba(139,148,158,0.45); --bfm-sb-thumb-hover: rgba(139,148,158,0.75);')
    // Colori delle due colonne "All data": gli STESSI dei due schieramenti in
    // testa al tooltip (colore nazione ravvivato), non una palette a parte —
    // così la colonna difesa/attacco si riconosce a colpo d'occhio. --bfm-c-bg
    // serve alle intestazioni sticky, che devono coprire le righe sotto.
    //
    // Le varianti "-ink" servono al TESTO. Il colore nazione grezzo può essere
    // molto scuro (misurato dal vivo: Serbia rgb(29,125,66), Italia
    // rgb(13,72,198)) e su tema scuro un titolo o una percentuale in quel
    // colore è illeggibile; la tinta di sfondo al 7% invece va bene com'è.
    // Su tema chiaro vale l'opposto — schiarire ancora sbiadirebbe il testo
    // sul bianco — quindi lì si tiene il colore originale.
    + ` --bfm-c-def: ${defColor}; --bfm-c-atk: ${atkColor}; --bfm-c-bg: ${bg};`
    + ` --bfm-c-def-ink: ${isLight ? defColor : brightenAndSaturate(defColor, 0.25)};`
    + ` --bfm-c-atk-ink: ${isLight ? atkColor : brightenAndSaturate(atkColor, 0.25)};`;

  // WarEra+: la riga di momentum "a scatti" (derivata dal trend fra un
  // refresh marker e l'altro, ogni ~30s — vedi computeTrend) è stata
  // rimossa da qui: il widget battleFront montato più sotto calcola il
  // momentum live (poll ogni ~1.5s), non serve più duplicarlo con un dato
  // più vecchio e meno preciso. `trend` resta nella firma perché
  // buildMarkerMarkup lo usa ancora per l'indicatore sul marker stesso.

  return `
    <div id="battle-tooltip-main" style="
      ${sbVars}
      background: ${bg};
      border: 1px solid ${border};
      border-radius: 10px;
      padding: ${padding};
      box-shadow: 0 8px 32px rgba(0,0,0,0.35);
      width: min(420px, calc(100vw - 20px));
      max-width: calc(100vw - 20px);
      box-sizing: border-box;
      flex: 0 1 auto;
    ">
      <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:8px; gap:8px;">
        <span style="font-size:11px; font-weight:700; text-transform:uppercase; letter-spacing:0.6px; color:${subColor}; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; min-width:0;">
          ⚔️ ${escapeHtml(regionName || 'Battle')}${useLive ? ' <span style="color:#ff4444;">🔴 Live</span>' : ''}
        </span>
        <span id="battle-tooltip-collapse" style="cursor:pointer; font-size:16px; color:${subColor}; padding:4px; line-height:1; flex-shrink:0;">${tooltipCollapsed ? '▲' : '▼'}</span>
        <span id="battle-tooltip-close" style="cursor:pointer; font-size:16px; color:${subColor}; padding:4px; line-height:1; flex-shrink:0;">✕</span>
      </div>

      <div id="battle-tooltip-body" style="display:${tooltipCollapsed ? 'none' : 'block'};">
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

        <!-- WarEra+: bottone unico "Other contributors" — su desktop apre/
             chiude la colonna a lato (fuori da questa card, vedi sotto), su
             mobile la sezione qui dentro. Compare solo se ci sono davvero
             nazioni sotto l'1% (classe bfm-contrib-has-data, assegnata da
             renderOtherContributors in battleFront.js). -->
        <div id="battle-contrib-toggle" class="bfm-contrib-toggle" style="margin-top:8px; align-items:center; justify-content:center; gap:5px; cursor:pointer; font-size:10px; color:${subColor}; border:1px solid ${border}; border-radius:6px; padding:5px;">
          👥 All contributors <span id="battle-contrib-count" style="opacity:.7;"></span> <span id="battle-contrib-caret">${contribOpen ? '▲' : '▼'}</span>
        </div>
        <div id="battle-contrib-mobile-section" class="bfm-contrib-mobile-section" style="margin-top:6px; border-top:1px solid ${border};">
          <div style="display:flex; justify-content:flex-end; padding:4px 10px 0;">
            <span id="battle-contrib-expand-mobile" class="bfm-contrib-expand" title="Show every nation that dealt damage, by side">${contribExpandLabel(contribExpanded)}</span>
          </div>
          <div id="battle-contrib-list-mobile"></div>
          <div id="battle-contrib-list-mobile-full"></div>
        </div>

        <div style="margin-top:8px; font-size:10px; color:${subColor}; text-align:center;">
          Click ✕ to close
        </div>
      </div>
    </div>
    <div id="battle-tooltip-contributors" style="${sbVars} background:${bg}; border:1px solid ${border}; color:${textColor};">
      <div class="bfm-contrib-title" style="color:${subColor}; border-bottom:1px solid ${border};">
        <span>👥 All contributors <span style="opacity:.6; font-weight:500; text-transform:none;">(&lt;1% of side)</span></span>
        <span id="battle-contrib-expand-desktop" class="bfm-contrib-expand" title="Show every nation that dealt damage, by side">${contribExpandLabel(contribExpanded)}</span>
      </div>
      <div id="battle-contrib-list-desktop"></div>
      <div id="battle-contrib-list-desktop-full"></div>
    </div>
  `;
}

// Riflette le due flag di apertura sul DOM: classi sul wrapper (le regole CSS
// scelgono da sole QUALE pannello mostrare in base al breakpoint) + verso
// della freccia del bottone, che deve seguire il pannello effettivamente
// pilotato nel layout corrente.
function applyContribVisibility(el) {
  const root = el || document.getElementById('battle-tooltip');
  if (!root) return;
  root.classList.toggle('bfm-contrib-desktop-open', contribOpenDesktop);
  root.classList.toggle('bfm-contrib-mobile-open', contribOpenMobile);
  const caret = root.querySelector('#battle-contrib-caret');
  if (caret) caret.textContent = (isNarrowLayout() ? contribOpenMobile : contribOpenDesktop) ? '▲' : '▼';
}

// Attraversare il breakpoint cambia QUALE pannello il bottone comanda: senza
// questo la freccia resterebbe quella dell'altro layout finche' non si
// riapre il tooltip.
if (typeof window !== 'undefined' && window.matchMedia) {
  window.matchMedia(CONTRIB_NARROW_MQ).addEventListener('change', () => applyContribVisibility());
}

// Riflette contribExpanded sui due pannelli (solo quello del layout attivo
// e' visibile, ma tenerli sincronizzati entrambi evita un disallineamento
// se l'utente attraversa il breakpoint mentre e' espanso).
function applyContribExpand(el) {
  const root = el || document.getElementById('battle-tooltip');
  if (!root) return;
  root.querySelector('#battle-tooltip-contributors')?.classList.toggle('bfm-contrib-expanded', contribExpanded);
  root.querySelector('#battle-contrib-mobile-section')?.classList.toggle('bfm-contrib-expanded', contribExpanded);
  const label = contribExpandLabel(contribExpanded);
  const btnD = root.querySelector('#battle-contrib-expand-desktop');
  const btnM = root.querySelector('#battle-contrib-expand-mobile');
  if (btnD) btnD.textContent = label;
  if (btnM) btnM.textContent = label;
}

function showBattleTooltip(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend) {
  // I due tooltip vivono entrambi in basso al centro: se restano aperti
  // insieme, quello battaglia (z-index 9000) copre quello nazione (3000) e
  // intercetta i click destinati ai suoi link.
  import('./nationTooltip.js').then(m => m.hide());
  const el = getBattleTooltipEl();
  el.innerHTML = buildBattleTooltipContent(battle, regionName, liveData, totalAttackerDmg, totalDefenderDmg, trend);
  pinnedBattleId = battle._id;

  el.querySelector('#battle-tooltip-collapse')?.addEventListener('click', (e) => {
    e.stopPropagation();
    tooltipCollapsed = !tooltipCollapsed;
    const body = el.querySelector('#battle-tooltip-body');
    const btn = el.querySelector('#battle-tooltip-collapse');
    if (body) body.style.display = tooltipCollapsed ? 'none' : 'block';
    if (btn) btn.textContent = tooltipCollapsed ? '▲' : '▼';
  });

  el.querySelector('#battle-tooltip-close')?.addEventListener('click', (e) => {
    e.stopPropagation();
    hideBattleTooltip();
  });

  // Bottone unico "Other contributors": su desktop apre/chiude la colonna a
  // lato, su mobile la sezione dentro la card — quale delle due lo decide la
  // media query, qui si aggiorna solo la flag del layout corrente.
  applyContribVisibility(el);
  el.querySelector('#battle-contrib-toggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (isNarrowLayout()) contribOpenMobile = !contribOpenMobile;
    else contribOpenDesktop = !contribOpenDesktop;
    applyContribVisibility(el);
  });

  // Bottone "espandi" — presente sia sopra la colonna desktop sia sopra la
  // lista mobile, ma e' sempre lo STESSO stato (contribExpanded): stopPropagation
  // qui serve anche a non far scattare il click sul bottone toggle sottostante
  // (nel caso mobile il bottone espandi vive dentro la sezione che il toggle apre).
  applyContribExpand(el);
  const onExpandClick = (e) => {
    e.stopPropagation();
    contribExpanded = !contribExpanded;
    applyContribExpand(el);
  };
  el.querySelector('#battle-contrib-expand-desktop')?.addEventListener('click', onExpandClick);
  el.querySelector('#battle-contrib-expand-mobile')?.addEventListener('click', onExpandClick);

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
  tooltipCollapsed = false;
  contribOpenDesktop = true;
  contribOpenMobile = false;
  contribExpanded = false;

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
  // WarEra+: a zoom minimo su mobile il floor sopra spinge sempre in fascia
  // "medium" (mai "low", per restare leggibile — vedi commento sopra), ma le
  // dimensioni della fascia medium restano identiche al desktop: a zoom
  // minimo il marker occupa troppo schermo su un telefono. Riduce SOLO
  // l'ingombro (min/max-width, padding, badge), non i font — restano
  // leggibili come da intento originale.
  const mobileMinZoom = isMobile && zoom < 3.5;
  // WarEra+: font innalzati rispetto all'originale (erano 5-9px, quasi
  // illeggibili) — nuova fascia 9-12px, ancora scalata per zoom ma sempre
  // leggibile anche nella fascia "low".
  const fontSizeName = isZoomLow ? '9px' : (isZoomMedium ? '10px' : '11px');
  const fontSizeRegion = isZoomLow ? '8px' : (isZoomMedium ? '9px' : '10px');
  const fontSizePct = isZoomLow ? '8px' : (isZoomMedium ? '9px' : '10px');
  // WarEra+: padding leggermente più generoso + angoli molto più arrotondati
  // (prima 4-7px, quasi un rettangolo secco) — la card ora si legge come un
  // "badge" invece che una scheda squadrata.
  const padding = isZoomLow ? '5px 7px' : (isZoomMedium ? (mobileMinZoom ? '5px 7px' : '6px 8px') : '7px 10px');
  const minWidth = isZoomLow ? 68 : (isZoomMedium ? (mobileMinZoom ? 85 : 98) : 128);
  const maxWidth = isZoomLow ? 100 : (isZoomMedium ? (mobileMinZoom ? 122 : 140) : 190);
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
  const badgeSize = isZoomLow ? '14px' : (mobileMinZoom ? '16px' : '18px');

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
    trackEvent('battle-marker-click', { region: d.regionName });

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
  markers.forEach(entry => _setMarkerVisible(entry, false));
  clusterMarkers.forEach(entry => _setMarkerVisible(entry, false));
}

export function showAllMarkers() {
  _allHidden = false;
  markers.forEach(entry => _setMarkerVisible(entry, true));
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
  clusterMarkers.forEach(({ marker }) => {
    try { marker.remove(); } catch (e) {}
  });
  clusterMarkers.clear();
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