import { state } from './state.js';
import { escapeHtml } from './utils.js';
import { getBlocMemberIds } from './diplomacy.js';
import * as topojson from 'topojson-client';

// URL del tool esterno "PoliticalView". Se il formato del parametro cambia,
// aggiorna solo questa riga.
const POLITICAL_VIEW_BASE_URL = 'https://francescoparadiso.github.io/PoliticalView/';

let hoverSuppressed = false;

// ==================== EVIDENZIAZIONE CONFINE AL HOVER ====================
// WarEra+: nella vista diplomatica di default, passare il mouse su una
// nazione "aumenta la traccia bianca sui confini" — un layer linea in più
// sopra ai confini normali (LYR_BORDER/LYR_COAST, bianchi ma sottili),
// ricalcolato al volo sul solo paese sotto al cursore. Nessuna modifica ai
// layer esistenti: si somma sopra, si toglie svuotando i dati.
//
// PRIMA filtrava SRC_REGIONS (un poligono PER REGIONE, non per nazione) sul
// countryId sotto cursore: un layer 'line' disegna il contorno di OGNI
// poligono che passa il filtro, comprese le linee interne condivise fra
// regioni della STESSA nazione — quindi evidenziava anche i confini
// regionali interni insieme a quello nazionale esterno (bug segnalato).
// Fix: stessa tecnica già usata in map.js per bordersMesh/originalBordersMesh
// (vedi setupMapLayers) — topojson.mesh con un filtro che tiene solo gli
// archi dove ESATTAMENTE un lato appartiene alla nazione sotto cursore
// (confine con un'altra nazione, o costa — mai un arco interno dove
// entrambi i lati sono della stessa nazione).
const LYR_HOVER_BORDER = 'wp-hover-border';
const SRC_HOVER_BORDER = 'wp-hover-border-src';
const EMPTY_FC = { type: 'FeatureCollection', features: [] };

function _initHoverBorderLayer(map) {
  if (!map.getSource(SRC_HOVER_BORDER)) {
    map.addSource(SRC_HOVER_BORDER, { type: 'geojson', data: EMPTY_FC });
  }
  if (!map.getLayer(LYR_HOVER_BORDER)) {
    map.addLayer({
      id: LYR_HOVER_BORDER, type: 'line', source: SRC_HOVER_BORDER,
      paint: { 'line-color': '#ffffff', 'line-width': 3.2, 'line-opacity': 0.95, 'line-blur': 0.3 },
    });
  }
}

// Cache sull'ultimo paese/campo processato: mousemove spara in continuazione
// mentre il cursore resta sulla stessa nazione, non serve ricalcolare la
// mesh (più pesante di un semplice setFilter) ad ogni pixel di movimento.
let _lastNid = null;
let _lastField = null;

function _setHoverBorder(map, nid) {
  const src = map.getSource(SRC_HOVER_BORDER);
  if (!src) return;
  // Solo nella vista diplomatica di default: le altre modalità (blocs,
  // sfera, danni settimanali, popolazione, heatmap battaglie) hanno già
  // le loro logiche di colore/evidenziazione, non ci sovrapponiamo.
  if (state.coloringMode !== 'diplomacy' || !nid) {
    if (_lastNid !== null) { _lastNid = null; src.setData(EMPTY_FC); }
    return;
  }
  const field = state.mapSource === 'original' ? 'initialCountryId' : 'countryId';
  if (nid === _lastNid && field === _lastField) return;
  _lastNid = nid;
  _lastField = field;

  const topoData = state.mapDataGlobal?.map;
  if (!topoData) return;
  const mesh = topojson.mesh(topoData, topoData.objects.regions, (a, b) => {
    // ATTENZIONE: topojson-client NON chiama mai questo filtro con `b`
    // undefined. Per un arco di COSTA (non condiviso con nessun'altra
    // regione — usato una sola volta) chiama filter(a, a): stesso oggetto
    // due volte, non (a, undefined) come ci si aspetterebbe (vedi
    // node_modules/topojson-client/src/mesh.js: extractArcs usa
    // `geoms[0].g, geoms[geoms.length-1].g`, che con un solo "uso"
    // dell'arco sono lo STESSO elemento). Con `a === b` sempre vero,
    // `aIn !== bIn` dava sempre false e la costa spariva SEMPRE
    // dall'evidenziazione hover, qualunque fosse la nazione sotto cursore
    // (bug segnalato: "l'hover non illumina la coastline"). Va quindi
    // trattata a parte: un arco non condiviso fa parte del confine esterno
    // della nazione sotto cursore se quella singola regione è sua.
    const aIn = a.properties[field] === nid;
    if (a === b) return aIn;
    const bIn = b.properties[field] === nid;
    return aIn !== bIn; // esattamente un lato è la nazione sotto cursore
  });
  src.setData({ type: 'Feature', properties: {}, geometry: mesh });
}

// ==================== HELPERS ====================
function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return n.toLocaleString();
}

function getFlagEmoji(code) {
  if (!code || code.length !== 2) return '🌍';
  const offset = 0x1F1E6 - 65;
  return String.fromCodePoint(
    code.toUpperCase().charCodeAt(0) + offset,
    code.toUpperCase().charCodeAt(1) + offset
  );
}

function getTooltipEl() {
  let el = document.getElementById('nation-tooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'nation-tooltip';
    el.className = 'nation-tooltip';
    document.body.appendChild(el);
  }
  return el;
}

/** Posizionamento "pinnato": in basso al centro, largo quanto sta nella
 *  viewport, scrollabile e cliccabile. Estratto da show() perché lo usa
 *  anche il tooltip alleanza qui sotto — è la stessa scatola. */
function _pinTooltip(tooltip) {
  // Chiude il tooltip battaglia, che occupa la stessa area in basso al
  // centro con z-index piu' alto e ruberebbe i click (es. il link
  // "View Political Situation" apriva invece una battaglia).
  import('./battleMarkers.js').then(m => m.hideBattleTooltip());
  tooltip.style.zIndex = '9500';
  tooltip.classList.add('pinned');
  tooltip.style.left = '50%';
  tooltip.style.top = 'auto';
  tooltip.style.setProperty(
    'bottom',
    `calc(${window.innerWidth <= 768 ? '45px' : '55px'} + env(safe-area-inset-bottom, 0px))`,
    'important'
  );
  tooltip.style.transform = 'translateX(-50%)';
  // La classe CSS '.nation-tooltip' puo' avere una larghezza fissa pensata
  // per desktop: su schermi stretti spingeva il box oltre il bordo della
  // viewport (o lo tagliava), rompendo completamente il layout su mobile.
  // Qui la larghezza viene sempre vincolata alla viewport reale, e in
  // altezza si aggiunge scroll invece di traboccare fuori schermo quando
  // il contenuto (specie con la sezione battle-heatmap) e' troppo alto
  // per un telefono in orizzontale.
  tooltip.style.setProperty('width', 'min(360px, calc(100vw - 24px))', 'important');
  tooltip.style.setProperty('max-width', 'calc(100vw - 24px)', 'important');
  tooltip.style.setProperty('box-sizing', 'border-box', 'important');
  tooltip.style.setProperty('max-height', 'calc(100vh - 90px)', 'important');
  tooltip.style.setProperty('overflow-y', 'auto', 'important');
  tooltip.style.setProperty('-webkit-overflow-scrolling', 'touch', 'important');
  // Pinnato: deve essere cliccabile (link "View Political Situation",
  // bottone di chiusura implicito via click-fuori gestito altrove).
  tooltip.style.pointerEvents = 'auto';
}

/* ══════════════════════════════════════════════════════════════
   TOOLTIP ALLEANZA (WarEra+)
   ------------------------------------------------------------------
   In modalità 'blocs' il click su una nazione seleziona il BLOCCO, non la
   nazione: il tooltip nazione che compariva lì raccontava quindi una cosa
   diversa da quella selezionata, e su mobile si sovrapponeva pure al
   pannello alleanza a schermo intero (segnalato dall'utente: "rende tutto
   molto confusionario").

   Qui c'è il suo sostituto: stessa scatola, stessi riquadri, ma i numeri
   sono quelli del blocco intero e l'unica azione è "Full Details", che apre
   il pannello alleanza (non Political View: in questa vista la nazione
   singola non c'entra).

   Su desktop non serve: lì il pannello alleanza è una sidebar che si apre
   da sola senza coprire la mappa, e ripetere gli stessi numeri in un
   tooltip sarebbe rumore. Vedi initNationTooltip.
   ══════════════════════════════════════════════════════════════ */
export function showBlocTooltip(allianceId) {
  const alliance = state.allianceMap?.get(allianceId);
  if (!alliance) return;
  const memberIds = getBlocMemberIds(allianceId);
  const members = memberIds.map(id => state.nationMap.get(id)).filter(Boolean);

  const tot = members.reduce((s, n) => ({
    pop: s.pop + (n?.rankings?.countryActivePopulation?.value || 0),
    wealth: s.wealth + (n?.rankings?.countryWealth?.value ?? n?.money ?? 0),
    dmg: s.dmg + (n?.rankings?.weeklyCountryDamages?.value || 0),
    wars: s.wars + (n?.warsWith?.length || 0),
  }), { pop: 0, wealth: 0, dmg: 0, wars: 0 });
  const dmgPerPlayer = tot.pop > 0 ? tot.dmg / tot.pop : 0;
  const color = state.allianceColorMap?.get(allianceId) || '#8b949e';

  const tooltip = getTooltipEl();
  tooltip.innerHTML = `
    <div class="nt-header">
      ${alliance.avatarUrl
        ? `<img class="nt-flag" src="${alliance.avatarUrl}" alt="" onerror="this.style.display='none'">`
        : `<span class="nt-emoji">🛡️</span>`}
      <span class="nt-name">${escapeHtml(alliance.name)}</span>
      <span class="nt-bloc" style="background:${color}22;color:${color}">${members.length} nations</span>
    </div>
    <div class="nt-grid">
      <div class="nt-item"><span class="nt-icon">👥</span><span class="nt-val">${fmt(tot.pop)}</span><span class="nt-lbl">pop.</span></div>
      <div class="nt-item"><span class="nt-icon">💰</span><span class="nt-val">${fmt(tot.wealth)}</span><span class="nt-lbl">wealth</span></div>
      <div class="nt-item"><span class="nt-icon">🔥</span><span class="nt-val">${fmt(tot.dmg)}</span><span class="nt-lbl">dmg/wk</span></div>
      <div class="nt-item"><span class="nt-icon">⚔️</span><span class="nt-val">${fmt(dmgPerPlayer)}</span><span class="nt-lbl">dmg/player</span></div>
      <div class="nt-item"><span class="nt-icon">🗡️</span><span class="nt-val">${tot.wars}</span><span class="nt-lbl">wars</span></div>
    </div>
    <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08);">
      <button type="button" class="nt-bloc-details-btn" data-bloc-id="${escapeHtml(allianceId)}" style="
        display:flex; align-items:center; justify-content:center; gap:6px;
        width:100%; padding:7px 10px; border-radius:8px;
        background:rgba(46,204,113,0.12); border:1px solid rgba(46,204,113,0.35);
        color:#2ecc71; font-size:12px; font-weight:600; cursor:pointer;
        box-sizing:border-box;">📋 Full Details</button>
    </div>`;

  currentId = null;   // non è una nazione: il toggle "riclicco = chiudi" vale per il blocco, gestito da map.js
  isPinned = true;
  _pinTooltip(tooltip);
  requestAnimationFrame(() => tooltip.classList.add('visible'));
}

function buildContent(nation, code, blocInfo, isPinned) {
  const pop = nation?.rankings?.countryActivePopulation?.value || 0;
  const wealth = nation?.rankings?.countryWealth?.value ?? nation.money ?? 0;
  const dmg = nation?.rankings?.weeklyCountryDamages?.value || 0;
  const dev = nation?.rankings?.countryDevelopment?.value;
  const wars = nation?.warsWith?.length || 0;

  const dipl = state.diplomacyData.get(nation._id);
  const defPacts = dipl?.defensivePacts?.length || 0;
  let swornEnemyName = '';
  if (dipl?.swornEnemy) {
    const enemy = state.nationMap.get(dipl.swornEnemy);
    if (enemy) swornEnemyName = enemy.name;
  }

  // WarEra+ fix: il vecchio pattern app.warera.io/images/map/*.png dava
  // 404 (confermato anche sul Diplomacy originale, non è una regressione
  // di questo progetto). Il CDN attuale usa media.warera.io con SVG.
  const flagUrl = code ? `https://media.warera.io/images/flags/${code}.svg?v=16` : null;

  let html = `
    <div class="nt-header">
      ${flagUrl
      ? `<img class="nt-flag" src="${flagUrl}" alt="" onerror="this.style.display='none'">`
      : `<span class="nt-emoji">${getFlagEmoji(code)}</span>`
    }
      <span class="nt-name">${escapeHtml(nation.name)}</span>
      ${blocInfo ? `<span class="nt-bloc" style="background:${blocInfo.color}22;color:${blocInfo.color}">${escapeHtml(blocInfo.name)}</span>` : ''}
    </div>
    <div class="nt-grid">
      <div class="nt-item"><span class="nt-icon">👥</span><span class="nt-val">${fmt(pop)}</span><span class="nt-lbl">pop.</span></div>
      <div class="nt-item"><span class="nt-icon">💰</span><span class="nt-val">${fmt(wealth)}</span><span class="nt-lbl">wealth</span></div>
      <div class="nt-item"><span class="nt-icon">🔥</span><span class="nt-val">${fmt(dmg)}</span><span class="nt-lbl">dmg/wk</span></div>
      ${dev != null ? `<div class="nt-item"><span class="nt-icon">📈</span><span class="nt-val">${dev.toFixed(1)}</span><span class="nt-lbl">dev.</span></div>` : ''}
      <div class="nt-item"><span class="nt-icon">🛡️</span><span class="nt-val">${defPacts}</span><span class="nt-lbl">def pacts</span></div>
      <div class="nt-item"><span class="nt-icon">⚔️</span><span class="nt-val">${wars}</span><span class="nt-lbl">wars</span></div>
      ${swornEnemyName ? `<div class="nt-item" style="color:#e67e22;"><span class="nt-icon">⚡</span><span class="nt-val">${escapeHtml(swornEnemyName)}</span><span class="nt-lbl">sworn enemy</span></div>` : ''}
    </div>
  `;
// nationTooltip.js - sezione BATTLE HEATMAP DATI

if (state.coloringMode === 'battleHeatmap' && state.battleHeatmapData) {
  const data = state.battleHeatmapData;
  const nationData = data.nations.find(n => n.countryId === nation._id);
  if (nationData) {
    const rank = data.nations.findIndex(n => n.countryId === nation._id) + 1;
    
    // Percentuale rispetto al massimo del lato
    const sameSide = data.nations.filter(n => n.side === nationData.side);
    const maxInSide = sameSide.reduce((max, n) => Math.max(max, n.totalDamage), 0);
    const pct = maxInSide > 0 ? (nationData.totalDamage / maxInSide * 100) : 0;
    
    // Percentuale sul totale del lato
    const totalInSide = sameSide.reduce((sum, n) => sum + n.totalDamage, 0);
    const totalPct = totalInSide > 0 ? (nationData.totalDamage / totalInSide * 100) : 0;
    
    const sideColor = nationData.side === 'attacker' ? '#58a6ff' : '#ff6b6b';
    const sideLabel = nationData.side === 'attacker' ? '⚔️ Attacker' : '🛡️ Defender';
    
    const atkDmg = nationData.damageToAttackers || 0;
    const defDmg = nationData.damageToDefenders || 0;

    html += `
      <div style="border-top:1px solid rgba(255,255,255,0.08); margin-top:8px; padding-top:8px; font-size:12px;">
        <div style="display:flex; justify-content:space-between; margin-bottom:4px;">
          <span>Side: <strong style="color:${sideColor}">${sideLabel}</strong></span>
          <span>Rank: <strong>#${rank}</strong></span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:2px;">
          <span>Total dmg: <strong>${fmt(nationData.totalDamage)}</strong></span>
          <span>vs max: <strong>${pct.toFixed(1)}%</strong></span>
        </div>
        <div style="display:flex; justify-content:space-between; margin-bottom:2px; font-size:10px; color:#8b949e;">
          <span>Side total: ${fmt(totalInSide)}</span>
          <span>Share: ${totalPct.toFixed(1)}%</span>
        </div>
        ${defDmg > 0 ? `<div style="color:#58a6ff;">⚔️ As attacker: <strong>${fmt(defDmg)}</strong></div>` : ''}
        ${atkDmg > 0 ? `<div style="color:#ff6b6b;">🛡️ As defender: <strong>${fmt(atkDmg)}</strong></div>` : ''}
      </div>
    `;
  }
}

  html += `
    <div class="nt-footer">ID: ${nation._id?.slice(0, 8)}… · <span class="nt-code">${code?.toUpperCase() || '—'}</span></div>
  `;

  if (isPinned) {
    // WarEra+: su mobile il tooltip pinnato è l'UNICA cosa che si apre al
    // click (il pannello laterale a schermo intero NON si apre più da solo,
    // vedi countryPanel.js — guard mobile aggiunto lì) proprio per lasciare
    // visibile la mappa/diplomazia sotto. Chi vuole i dettagli estesi
    // (parlamento, alleati completi, ecc.) li apre esplicitamente da qui.
    // Su desktop il pannello si apre comunque in automatico (sidebar, non
    // copre la mappa) quindi questo bottone sarebbe ridondante — non lo
    // mostriamo lì.
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
    if (isMobile) {
      html += `
        <div style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08);">
          <button type="button" class="nt-expand-btn" data-country-id="${nation._id}" style="
            display:flex; align-items:center; justify-content:center; gap:6px;
            width:100%; padding:7px 10px; border-radius:8px;
            background:rgba(46,204,113,0.12); border:1px solid rgba(46,204,113,0.35);
            color:#2ecc71; font-size:12px; font-weight:600; cursor:pointer;
            box-sizing:border-box; transition:background 0.15s, border-color 0.15s;
          " onmouseover="this.style.background='rgba(46,204,113,0.22)'; this.style.borderColor='rgba(46,204,113,0.55)';"
             onmouseout="this.style.background='rgba(46,204,113,0.12)'; this.style.borderColor='rgba(46,204,113,0.35)';">
            📋 Full Details
          </button>
        </div>
      `;
    }
    // WarEra+ hook: dentro il nuovo shell il bottone apre l'overlay in-app
    // (public/political/, stesso codice Political originale) invece di una
    // nuova scheda esterna. L'href resta come fallback funzionante se
    // questo file viene mai eseguito fuori da WarEra+ (es. Diplomacy
    // originale standalone) o se il click JS fallisce per qualunque motivo.
    const politicalUrl = `${POLITICAL_VIEW_BASE_URL}?country=${encodeURIComponent(nation._id)}`;
    html += `
      <div class="nt-actions" style="margin-top:8px; padding-top:8px; border-top:1px solid rgba(255,255,255,0.08);">
        <a href="${politicalUrl}" target="_blank" rel="noopener" class="nt-political-btn" data-country-id="${nation._id}" data-country-name="${escapeHtml(nation.name)}" style="
          display:flex; align-items:center; justify-content:center; gap:6px;
          width:100%; padding:7px 10px; border-radius:8px;
          background:rgba(88,166,255,0.12); border:1px solid rgba(88,166,255,0.35);
          color:#58a6ff; font-size:12px; font-weight:600; text-decoration:none;
          box-sizing:border-box; cursor:pointer; transition:background 0.15s, border-color 0.15s;
        " onmouseover="this.style.background='rgba(88,166,255,0.22)'; this.style.borderColor='rgba(88,166,255,0.55)';"
           onmouseout="this.style.background='rgba(88,166,255,0.12)'; this.style.borderColor='rgba(88,166,255,0.35)';">
          🏛️ View Political Situation
        </a>
      </div>
    `;
  }

  return html;
}

// ==================== STATE & LOGIC ====================
let currentId = null;
let isPinned = false;
let hoverTimer = null;

function show(nationId, x, y, pinned = false) {
  if (!nationId) return;
  // WarEra+: su mobile il tooltip torna a essere l'unica cosa che si apre
  // al click (vedi countryPanel.js — il pannello a schermo intero non si
  // apre più in automatico lì, solo dal bottone "Full Details" qui dentro,
  // vedi buildContent). Un primo tentativo sopprimeva del tutto il tooltip
  // su mobile per evitare la duplicazione con il pannello, ma così facendo
  // la mappa/diplomazia restava nascosta dietro al pannello a tutto
  // schermo finché non lo si chiudeva — feedback dell'utente: preferibile
  // il tooltip leggero (mappa visibile sotto) con un'azione esplicita per
  // i dettagli estesi, invece del pannello sempre aperto in automatico.
  const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
  const nation = state.nationMap.get(nationId);
  if (!nation) return;

  const isOriginal = state.mapSource === 'original';
  const srcData = isOriginal ? state.originalLabelsData : state.labelsData;
  const label = srcData.find(l => l.properties.countryId === nationId);
  const code = label?.properties?.countryCode?.toLowerCase() || nation.code?.toLowerCase() || '';
  const blocColor = state.blocColorMap.get(nationId);
  const blocInfo = blocColor ? state.externalBlocsInfo.find(b => b.color === blocColor) : null;

  const tooltip = getTooltipEl();

  if (pinned && currentId && nationId !== currentId) {
    tooltip.classList.remove('visible');
    void tooltip.offsetWidth;
  }

  tooltip.innerHTML = buildContent(nation, code, blocInfo, pinned || isMobile);
  currentId = nationId;
  isPinned = pinned;

  if (pinned || isMobile) {
    _pinTooltip(tooltip);
  } else {
    tooltip.style.zIndex = '';
    tooltip.classList.remove('pinned');
    // BUG: hover (non pinnato) segue il mouse e puo' finire proprio sopra un
    // marker battaglia mentre ci si avvicina per cliccarlo. Senza questo, il
    // click colpiva il tooltip nazione invece del marker sottostante: il
    // marker non riceveva mai il click (restava "non pinnato") e il click,
    // arrivato al document su un target che non e' ne' #battle-tooltip ne'
    // .battle-marker, faceva scattare l'handler "click fuori" di
    // battleMarkers.js chiudendo un eventuale tooltip battaglia gia' aperto —
    // da qui l'effetto "si incastra con la nation tooltip". In hover il
    // tooltip nazione non ha bisogno di essere cliccabile (nessun link/azione
    // qui dentro), quindi lo si rende trasparente ai click.
    tooltip.style.pointerEvents = 'none';
    tooltip.style.visibility = 'hidden';
    tooltip.classList.add('visible');
    const rect = tooltip.getBoundingClientRect();
    let left = x + 20, top = y + 15;
    if (left + rect.width > window.innerWidth - 16) left = x - rect.width - 20;
    if (top + rect.height > window.innerHeight - 16) top = y - rect.height - 15;
    tooltip.style.left = `${left}px`;
    tooltip.style.top = `${top}px`;
    tooltip.style.bottom = 'auto';
    tooltip.style.transform = 'none';
    tooltip.style.visibility = '';
  }

  requestAnimationFrame(() => tooltip.classList.add('visible'));
}

export function hide() {
  const tooltip = document.getElementById('nation-tooltip');
  if (tooltip) {
    tooltip.classList.remove('visible');
    // Stesso motivo del fix in show(): senza azzerarlo qui, un tooltip
    // uscito da uno stato pinnato (pointer-events:auto) restava cliccabile
    // anche da nascosto/in transizione, potendo di nuovo intercettare un
    // click destinato a un marker battaglia sottostante.
    tooltip.style.pointerEvents = 'none';
  }
  currentId = null;
  isPinned = false;
}

function _getCoords(e) {
  if (e.originalEvent?.clientX != null) {
    return { x: e.originalEvent.clientX, y: e.originalEvent.clientY };
  }
  if (e.point?.x != null) {
    return { x: e.point.x, y: e.point.y };
  }
  return { x: window.innerWidth / 2, y: window.innerHeight / 2 };
}

// ==================== INIT ====================
export function initNationTooltip(map) {
  const layerId = 'regions-fill';

  function _extractId(e) {
    if (!e.features?.[0]) return null;
    const props = e.features[0].properties;
    return state.mapSource === 'original' ? props.initialCountryId : props.countryId;
  }

  // Evidenziazione bordo al hover — indipendente dallo stato pinned/
  // suppressed del tooltip (deve "funzionare sempre" mentre il mouse è
  // sopra una nazione, non solo quando il tooltip stesso è attivo).
  _initHoverBorderLayer(map);
  map.on('mouseenter', layerId, (e) => _setHoverBorder(map, _extractId(e)));
  map.on('mousemove', layerId, (e) => _setHoverBorder(map, _extractId(e)));
  map.on('mouseleave', layerId, () => _setHoverBorder(map, null));

  map.on('mouseenter', layerId, (e) => {
    // WarEra+ fix ("passando il mouse sopra la regione evidenziata la
    // battaglia si spegne"): non era che la battaglia si disattivasse
    // davvero — il tooltip nazione (hover, non pinnato) si apre proprio
    // accanto al cursore, ~20px di offset, e con la regione evidenziata
    // spesso piccola finiva PROPRIO sopra al riquadro giallo, coprendolo
    // (elemento DOM sopra al canvas della mappa). In battleHeatmap il
    // tooltip nazione al hover non serve comunque (c'è già il tooltip
    // battaglia fisso in basso) — stesso principio già applicato
    // all'evidenziazione bordo hover in _setHoverBorder qui sopra, solo
    // che lì il guard mancava proprio su questo handler.
    // 'blocs': qui il click seleziona l'alleanza, non la nazione — il
    // tooltip nazione parlerebbe di un'altra cosa rispetto a quella
    // selezionata (vedi showBlocTooltip).
    if (isPinned || hoverSuppressed || state.coloringMode === 'battleHeatmap' || state.coloringMode === 'blocs') return;
    clearTimeout(hoverTimer);
    const nid = _extractId(e);
    if (nid && nid !== currentId) show(nid, e.originalEvent.clientX, e.originalEvent.clientY);
  });

  map.on('mousemove', layerId, (e) => {
    // 'blocs': qui il click seleziona l'alleanza, non la nazione — il
    // tooltip nazione parlerebbe di un'altra cosa rispetto a quella
    // selezionata (vedi showBlocTooltip).
    if (isPinned || hoverSuppressed || state.coloringMode === 'battleHeatmap' || state.coloringMode === 'blocs') return;
    const tooltip = document.getElementById('nation-tooltip');
    if (!tooltip?.classList.contains('visible')) return;

    const nid = _extractId(e);
    if (nid && nid !== currentId) {
      show(nid, e.originalEvent.clientX, e.originalEvent.clientY, false);
    } else {
      const vw = window.innerWidth, vh = window.innerHeight;
      let left = e.originalEvent.clientX + 20, top = e.originalEvent.clientY + 15;
      const rect = tooltip.getBoundingClientRect();
      if (left + rect.width > vw - 16) left = e.originalEvent.clientX - rect.width - 20;
      if (top + rect.height > vh - 16) top = e.originalEvent.clientY - rect.height - 15;
      tooltip.style.left = `${left}px`;
      tooltip.style.top = `${top}px`;
    }
  });

  map.on('mouseleave', layerId, () => {
    hoverTimer = setTimeout(() => {
      if (!isPinned) hide();
    }, 60);
  });

  map.on('click', layerId, (e) => {
    // WarEra+: stesso guard di map.js:_onRegionClick e countryPanel.js —
    // mentre la time machine è aperta, il click mostra il proprietario
    // storico (src/app/timeMachine.js), non il tooltip "pinnato" con dati
    // live (popolazione/ricchezza/guerre di OGGI, fuorvianti su un'epoca
    // passata). Terzo listener indipendente sullo stesso layer/evento,
    // stesso motivo per cui va ripetuto invece di centralizzato.
    if (state.timeMachineActive) return;
    // In modalità alleanze il tooltip nazione non compare affatto: al suo
    // posto, su mobile, quello del blocco selezionato — che è quello che il
    // click ha davvero selezionato. Su desktop nemmeno quello: lì il
    // pannello alleanza si apre da solo come sidebar e direbbe le stesse
    // cose (vedi map.js:_onRegionClick).
    if (state.coloringMode === 'blocs') return;
    const nid = _extractId(e);
    if (!nid) return;

    if (currentId === nid && isPinned) {
      hide();
      hoverSuppressed = true;
      const reenable = () => {
        hoverSuppressed = false;
        document.removeEventListener('mousemove', reenable, { capture: true });
      };
      document.addEventListener('mousemove', reenable, { once: true, capture: true });
      return;
    }
    const coords = _getCoords(e);
    show(nid, coords.x, coords.y, true);
  });

  document.addEventListener('click', (e) => {
    // WarEra+ hook: se il bottone "View Political Situation" viene
    // cliccato, prova ad aprire l'overlay in-app invece della scheda
    // esterna. Se il modulo non esiste (es. Diplomacy eseguita standalone
    // fuori da WarEra+), l'import fallisce silenziosamente e il link
    // segue il suo comportamento originale (href + target="_blank").
    const politicalBtn = e.target.closest('.nt-political-btn');
    if (politicalBtn) {
      // BUG FIX (segnalato dall'utente: "riporta in una nuova scheda al
      // vecchio tool"): preventDefault stava DENTRO il .then() dell'import
      // dinamico, cioè in un turno successivo — quando ci arrivava, il
      // browser aveva già seguito l'href verso PoliticalView esterno. Va
      // chiamato SUBITO, in modo sincrono, e l'href resta solo come
      // fallback se l'overlay non è disponibile (import fallito).
      e.preventDefault();
      import('../app/politicalOverlay.js')
        .then(m => m.openPoliticalView(politicalBtn.dataset.countryId, politicalBtn.dataset.countryName))
        .catch(() => { window.open(politicalBtn.href, '_blank', 'noopener'); });
      return;
    }
    // WarEra+: bottone "Full Details" (solo mobile, vedi buildContent) —
    // apre lo stesso pannello laterale che su desktop si apre in
    // automatico al click (countryPanel.js). Import dinamico per lo stesso
    // motivo del blocco sopra: nessuna dipendenza diretta da un modulo
    // "superiore" nella gerarchia shell da un file di Diplomacy invariato.
    // Gemello del precedente per il tooltip alleanza: apre il pannello del
    // blocco invece di quello della nazione.
    const blocBtn = e.target.closest('.nt-bloc-details-btn');
    if (blocBtn) {
      import('../panel/countryPanel.js')
        .then(m => m.selectBlocInPanel(blocBtn.dataset.blocId))
        .catch(() => {});
      hide();
      return;
    }
    const expandBtn = e.target.closest('.nt-expand-btn');
    if (expandBtn) {
      import('../panel/countryPanel.js')
        .then(m => m.selectNationInPanel(expandBtn.dataset.countryId))
        .catch(() => {});
      hide();
      hoverSuppressed = true;
      const enableHover = () => {
        hoverSuppressed = false;
        document.removeEventListener('mousemove', enableHover);
      };
      document.addEventListener('mousemove', enableHover, { once: true });
      return;
    }
    if (isPinned && !e.target.closest('#nation-tooltip')) {
      hide();
      hoverSuppressed = true;
      const enableHover = () => {
        hoverSuppressed = false;
        document.removeEventListener('mousemove', enableHover);
      };
      document.addEventListener('mousemove', enableHover, { once: true });
    }
  }, true);
}