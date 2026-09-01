// ui.js
import { state } from './state.js';
import { COLORS, THEMES } from './config.js';
import { getAllianceAllies, getDualAllyDefensiveIds } from './diplomacy.js';
import { fmtNumber } from './utils.js'; // Aggiunto per formattare i numeri nella legenda
import { escapeHtml } from './utils.js';
import { t } from '../shared/i18n.js';
import { trackEvent } from '../shared/analytics.js';
import { getContestedStats, contestedLegendGradient } from './contestedHeatmap.js';
import { getWarIntensityStats, warIntensityLegendGradient } from './warIntensityHeatmap.js';
import { getPlaystyleStats, playstyleLegendGradient } from './playstyleHeatmap.js';
import { activeDeposits, getProductionStats, productionLegendGradient, RESOURCE_TYPES, scaleMax } from './productionHeatmap.js';
import { getTrendStats, trendLegendGradient } from './playstyleTrendHeatmap.js';
import { mergedSphereGroups } from '../proxy/radar.js';

function _fmtDmg(n) {
  if (!n) return '0';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(0) + 'K';
  return String(n);
}

// showToast e' implementata in utils.js (unica versione, con icone e
// progress bar) e qui ri-esportata per compatibilita' con gli import esistenti.
export { showToast } from './utils.js';

// WarEra+: apertura automatica della legenda quando si entra in una
// "vista particolare" (qualunque coloringMode diverso dal default
// 'diplomacy', oppure la heatmap di una battaglia selezionata), e
// chiusura automatica tornando alla vista di default. Tiene traccia
// dell'ULTIMA transizione (non del solo stato attuale) per non forzare
// aperto/chiuso ad ogni singolo re-render — altrimenti l'utente non
// potrebbe mai chiudere manualmente la legenda restando nella stessa
// vista, dato che updateDynamicLegend() viene chiamata molto spesso.
let _lastLegendViewKey = null;
function _autoToggleLegend() {
  const legendEl = document.getElementById('dynamic-legend');
  if (!legendEl) return;

  // WarEra+ (feedback utente): su mobile niente apertura automatica —
  // meno clutter su uno schermo già stretto. La legenda resta esattamente
  // com'era (aperta o chiusa) finché l'utente non la tocca lui col bottone
  // manuale (#legendToggleBtn) — su desktop il comportamento resta
  // automatico com'era.
  //
  // BUG FIX (segnalato dall'utente: "ci sono viste che non hanno legenda,
  // come danni settimanali o popolazione", su DESKTOP): la condizione era
  // `window.innerWidth <= 768 || 'ontouchstart' in window`. Il secondo
  // ramo rende "mobile" QUALUNQUE dispositivo con touch, monitor da 27"
  // compreso: su un portatile con schermo touch `'ontouchstart' in window`
  // è true, quindi si usciva qui e la legenda — che parte chiusa — non si
  // apriva mai, in nessuna vista. Le legende di popolazione/danni non
  // mancavano affatto (il contenuto veniva costruito regolarmente): era il
  // contenitore a restare nascosto.
  // Qui conta lo SPAZIO disponibile, non come lo si tocca: un desktop
  // touch resta un desktop. Solo la larghezza, quindi.
  const isMobile = window.innerWidth <= 768;
  if (isMobile) {
    // WarEra+ (segnalato dall'utente): su mobile la legenda non si apre mai
    // da sola, in nessuna vista — si apre SOLO con la ℹ. Prima bastava
    // averla aperta una volta perché restasse aperta cambiando vista, e su
    // uno schermo stretto copriva la mappa. Cambiando vista quindi si
    // chiude: il contenuto è già aggiornato, basta toccare la ℹ per
    // rivederlo.
    const viewKeyMobile = `${state.coloringMode}|${!!state.battleHeatmapData}|${!!state.selectedCountryId}`;
    if (viewKeyMobile !== _lastLegendViewKey) {
      _lastLegendViewKey = viewKeyMobile;
      legendEl.classList.add('hidden');
    }
    return;
  }

  // BUG FIX (segnalato dall'utente: "non si apre la legenda in automatico in
  // diplomacy mode"): la vista diplomacy CON una nazione selezionata ha una
  // legenda vera (relazioni: NAP/alleato/nemico/...), non è "default" quanto
  // la vista senza selezione — va aperta anche lei. `viewKey` includeva solo
  // coloringMode+battleHeatmapData: passare da nessuna selezione a una
  // nazione selezionata (sempre in modalità 'diplomacy') non cambiava la
  // viewKey, quindi non ri-attivava mai il toggle automatico dopo la prima
  // apertura/chiusura manuale dell'utente.
  const isDefaultView = state.coloringMode === 'diplomacy' && !state.selectedCountryId;
  const viewKey = `${state.coloringMode}|${!!state.battleHeatmapData}|${!!state.selectedCountryId}`;

  if (viewKey === _lastLegendViewKey) return; // stessa vista di prima, non toccare lo stato utente
  _lastLegendViewKey = viewKey;

  legendEl.classList.toggle('hidden', isDefaultView);
}

export function updateDynamicLegend() {
  _autoToggleLegend();
  const box = document.getElementById('dynamic-legend');

  // WarEra+ (feedback utente: "la legenda per le heatmap è troppo grande"):
  // il layout "largo" a più colonne (#dynamic-legend.legend-wide in
  // shell.css, width fino a 1300px) serve solo alle legende con tante voci
  // affiancate (blocchi/alleanze, sfere d'influenza). Le legende "a
  // gradiente" (popolazione, danni settimanali, battle heatmap) hanno 2-3
  // righe di contenuto: senza questa classe restano compatte (vedi
  // .legend-content in diplomacy.css, min-width 150/max-width 200).
  // WarEra+ (feedback utente: la legenda di una nazione selezionata, che ha
  // fino a 9 voci — SELECTED/NAP/DEFENSIVE PACT/SWORN ENEMY/DIRECT WAR/
  // INDIRECT ENEMY/DIRECT ALLY/ALLY+DEFENSIVE PACT/NEUTRAL — si apriva in
  // colonna singola invece che a più colonne come prima di questo giro di
  // fix). Senza selezione la vista diplomacy ha solo 2 voci: resta compatta.
  const wideModes = state.coloringMode === 'blocs'
    || state.coloringMode === 'sphereOfInfluence'
    || (state.coloringMode === 'diplomacy' && !!state.selectedCountryId);
  box.classList.toggle('legend-wide', wideModes);

  if (state.coloringMode === 'population') {
    let min = Infinity, max = -Infinity;
    for (const nation of state.nationMap.values()) {
      const pop = nation?.rankings?.countryActivePopulation?.value;
      if (typeof pop === 'number' && pop > 0) {
        if (pop < min) min = pop;
        if (pop > max) max = pop;
      }
    }
    if (!isFinite(min) || !isFinite(max)) {
      box.innerHTML = `
        <div class="legend-section-title">Active Population</div>
        <div class="legend-note">No population data available</div>`;
      return;
    }
    const subPop = THEMES[state.theme].TEXT_SECONDARY;
    box.innerHTML = `
      <div class="legend-section-title">Active Population</div>
      <div class="legend-scale" style="margin: 4px 0;">
        <div style="width:100%;height:14px;background:linear-gradient(to right, rgb(255,255,204), rgb(255,153,0));border-radius:3px;"></div>
      </div>
      <div class="legend-item" style="justify-content:space-between; padding: 0 4px;">
        <span style="font-size:10px; color:${subPop};">${fmtNumber(min)}</span>
        <span style="font-size:10px; color:${subPop};">${fmtNumber(max)}</span>
      </div>
      <div class="legend-note">Higher = more orange</div>
    `;
    return;
  }

  if (state.coloringMode === 'weeklyDamage') {
    let min = Infinity, max = -Infinity;
    for (const nation of state.nationMap.values()) {
      const dmg = nation?.rankings?.weeklyCountryDamages?.value;
      if (typeof dmg === 'number' && dmg >= 0) {
        if (dmg < min) min = dmg;
        if (dmg > max) max = dmg;
      }
    }
    if (!isFinite(min) || !isFinite(max)) {
      box.innerHTML = `
        <div class="legend-section-title">Weekly Damage</div>
        <div class="legend-note">No damage data available</div>`;
      return;
    }
    const sub = THEMES[state.theme].TEXT_SECONDARY;
    box.innerHTML = `
      <div class="legend-section-title">Weekly Damage</div>
      <div class="legend-scale" style="margin:4px 0;">
        <div style="width:100%;height:14px;background:linear-gradient(to right, rgb(69,117,180), rgb(215,48,39));border-radius:3px;"></div>
      </div>
      <div class="legend-item" style="justify-content:space-between; padding:0 4px;">
        <span style="font-size:10px; color:${sub};">${fmtNumber(min)}</span>
        <span style="font-size:10px; color:${sub};">${fmtNumber(max)}</span>
      </div>
      <div class="legend-note">Low = blue · High = red</div>
    `;
    return;
  }

  // ══ Heatmap storiche per REGIONE (contese / intensità bellica) e
  //    playstyle nazionale — legende a gradiente, compatte come le altre.
  if (state.coloringMode === 'contested') {
    const sub = THEMES[state.theme].TEXT_SECONDARY;
    const stats = getContestedStats(state.contestedCounts || {});
    if (!stats.regions) {
      box.innerHTML = `
        <div class="legend-section-title">Contested Regions</div>
        <div class="legend-note">Loading ownership history…</div>`;
      return;
    }
    box.innerHTML = `
      <div class="legend-section-title">Contested Regions</div>
      <div class="legend-scale" style="margin:4px 0;">
        <div style="width:100%;height:14px;background:${contestedLegendGradient()};border-radius:3px;"></div>
      </div>
      <div class="legend-item" style="justify-content:space-between; padding:0 4px;">
        <span style="font-size:10px; color:${sub};">calm</span>
        <span style="font-size:10px; color:${sub};">up to ${fmtNumber(stats.max)}×</span>
      </div>
      <div class="legend-note">Times the region changed hands, ranked (median ${fmtNumber(stats.median)}) · ${fmtNumber(stats.regions)} regions, ${fmtNumber(stats.total)} transfers since day one</div>
    `;
    return;
  }

  if (state.coloringMode === 'warIntensity') {
    const sub = THEMES[state.theme].TEXT_SECONDARY;
    if (state.warIntensityError) {
      box.innerHTML = `
        <div class="legend-section-title">War Intensity</div>
        <div class="legend-note">${escapeHtml(state.warIntensityError)}</div>`;
      return;
    }
    const stats = getWarIntensityStats(state.warIntensityData || {});
    if (!stats.regions) {
      box.innerHTML = `
        <div class="legend-section-title">War Intensity</div>
        <div class="legend-note">Loading battle history…</div>`;
      return;
    }
    box.innerHTML = `
      <div class="legend-section-title">War Intensity</div>
      <div class="legend-scale" style="margin:4px 0;">
        <div style="width:100%;height:14px;background:${warIntensityLegendGradient()};border-radius:3px;"></div>
      </div>
      <div class="legend-item" style="justify-content:space-between; padding:0 4px;">
        <span style="font-size:10px; color:${sub};">quiet</span>
        <span style="font-size:10px; color:${sub};">up to ${fmtNumber(stats.max)}</span>
      </div>
      <div class="legend-note">Total damage of all resolved battles fought in the region, ranked (median ${fmtNumber(stats.median)}) · snapshot, not live</div>
    `;
    return;
  }

  // WarEra+ — Bonus produzione: scala fissa 0-30% (il massimo teorico è
  // avere tutti e sei i tipi di risorsa), più il conto di quante regioni
  // porta ogni risorsa nel mondo: la seconda domanda dopo "quanto" è
  // "quali", e la legenda è il posto dove sta senza aprire nulla.
  if (state.coloringMode === 'production') {
    const sub = THEMES[state.theme].TEXT_SECONDARY;
    const stats = getProductionStats();
    const spread = RESOURCE_TYPES
      .map(r => `${r.icon} ${stats.byResource[r.key] || 0}`)
      .join(' · ');
    box.innerHTML = `
      <div class="legend-section-title">Production bonus</div>
      <div class="legend-scale" style="margin:4px 0;">
        <div style="width:100%;height:14px;background:${productionLegendGradient()};border-radius:3px;"></div>
      </div>
      <div class="legend-item" style="justify-content:space-between; padding:0 4px;">
        <span style="font-size:10px; color:${sub};">+5%</span>
        <span style="font-size:10px; color:${sub};">+${scaleMax()}%</span>
      </div>
      <div class="legend-note">Total = strategic resources + ruling-party ethics${stats.ethicsLoaded
        ? ` (${stats.withEthic} industrialist nations, +30% each on their specialised item)`
        : ' — ethics still loading, showing resources only'} · grey = nothing (${stats.without} nations) · best +${stats.best}%, average +${stats.avg.toFixed(1)}% · regions by resource: ${spread} · ⛏ ${activeDeposits().length} temporary deposits (+30% on one item, few days) — listed in the panel</div>
    `;
    return;
  }

  if (state.coloringMode === 'playstyle') {
    const sub = THEMES[state.theme].TEXT_SECONDARY;

    // WarEra+: stessa vista, due letture — la fotografia di adesso o la
    // variazione a 7 giorni, scambiate dal toggle nel riepilogo del
    // pannello. La legenda deve dire quale delle due si sta guardando.
    if (state.playstyleTrendMode) {
      const trend = getTrendStats(state.playstyleTrend);
      // Il titolo segue lo slider del riepilogo: "ieri" o "N giorni fa".
      const askedDays = state.playstyleTrendDays || 7;
      const vsLabel = askedDays === 1 ? 'vs yesterday' : `vs ${askedDays} days ago`;
      if (!trend.covered) {
        box.innerHTML = `
          <div class="legend-section-title">War vs Eco · ${vsLabel}</div>
          <div class="legend-note">${state.playstyleTrendError || 'Loading playstyle history…'}</div>`;
        return;
      }
      box.innerHTML = `
        <div class="legend-section-title">War vs Eco · ${vsLabel}</div>
        <div class="legend-scale" style="margin:4px 0;">
          <div style="width:100%;height:14px;background:${trendLegendGradient()};border-radius:3px;"></div>
        </div>
        <div class="legend-item" style="justify-content:space-between; padding:0 4px;">
          <span style="font-size:10px; color:${sub};">Toward eco</span>
          <span style="font-size:10px; color:${sub};">Toward war</span>
        </div>
        <div class="legend-note">Change of the war/eco balance ${vsLabel} (history covers ${trend.spanDays}d) · ${trend.toWar} moving to war, ${trend.still} steady, ${trend.toEco} moving to eco · ${trend.covered} nations with enough history</div>
      `;
      return;
    }

    const stats = getPlaystyleStats(state.nationPlaystyle || {});
    if (!stats.colored) {
      box.innerHTML = `
        <div class="legend-section-title">War vs Eco</div>
        <div class="legend-note">No playstyle data available</div>`;
      return;
    }
    box.innerHTML = `
      <div class="legend-section-title">War vs Eco</div>
      <div class="legend-scale" style="margin:4px 0;">
        <div style="width:100%;height:14px;background:${playstyleLegendGradient()};border-radius:3px;"></div>
      </div>
      <div class="legend-item" style="justify-content:space-between; padding:0 4px;">
        <span style="font-size:10px; color:${sub};">Eco</span>
        <span style="font-size:10px; color:${sub};">War</span>
      </div>
      <div class="legend-note">Skill points of citizens in military units, compared to the world average (${Math.round(((stats.world + 1) / 2) * 100)}% war) · small samples pulled toward that average · ${stats.warLeaning} war-leaning, ${stats.balanced} balanced, ${stats.ecoLeaning} eco-leaning · ${stats.skipped} nations without a large enough sample</div>
    `;
    return;
  }

  if (state.coloringMode === 'sphereOfInfluence') {
    let html = '';
    // WarEra+: la legenda deve descrivere quello che la mappa sta davvero
    // disegnando, cioè CSV + rilevamenti sopra soglia (o tutti, col toggle) —
    // non il solo CSV. Ogni riga distingue le due provenienze.
    mergedSphereGroups({ forMap: true }).forEach(group => {
      const color = state.nationBaseColorMap.get(group.primaryId) || COLORS.DEFAULT_LAND;
      const fromCsv = group.proxies.filter(p => p.source === 'csv').length;
      const detected = group.proxies.length - fromCsv;
      const parts = [];
      if (fromCsv) parts.push(`${fromCsv} listed`);
      if (detected) parts.push(`${detected} detected`);
      html += `
        <div class="legend-item">
          <div class="legend-bar" style="background:${color};"></div>
          <div class="legend-info">
            <div class="legend-name">${escapeHtml(group.primaryName)}</div>
            <div class="legend-desc">${parts.join(' · ')}</div>
          </div>
        </div>`;
    });
    html += `
      <div class="legend-item">
        <div class="legend-bar" style="background:${COLORS.DEFAULT_LAND};opacity:0.6;"></div>
        <div class="legend-info"><div class="legend-name">Other</div></div>
      </div>`;
    box.innerHTML = html;
    return;
  }

  if (state.coloringMode === 'blocs') {
    // WarEra+: quando un blocco è in focus (selectedBlocId), la legenda
    // mostra la situazione diplomatica aggregata invece della lista piatta
    // di tutti i blocchi — coerente con quanto la mappa sta visualizzando.
    if (state.selectedBlocId) {
      const alliance = state.allianceMap.get(state.selectedBlocId);
      const memberCount = alliance ? alliance.memberCountries.length : 0;
      box.innerHTML = `
        <div class="legend-item">
          <div class="legend-bar" style="background:${COLORS.SELECTED};"></div>
          <div class="legend-info">
            <div class="legend-name">${escapeHtml(alliance?.name || '')}</div>
            <div class="legend-desc">${memberCount} nations</div>
          </div>
        </div>
        <div class="legend-item">
          <div class="legend-bar" style="background:${COLORS.WAR_DIRECT};"></div>
          <div class="legend-info">
            <div class="legend-name">${t('legend_war_direct')}</div>
            <div class="legend-desc">At war with a bloc member</div>
          </div>
        </div>
        <div class="legend-item">
          <div class="legend-bar" style="background:${COLORS.ALLY_DIRECT};"></div>
          <div class="legend-info">
            <div class="legend-name">${t('legend_ally_direct')}</div>
            <div class="legend-desc">De facto allied bloc (many shared defensive pacts)</div>
          </div>
        </div>
        <div class="legend-item">
          <div class="legend-bar" style="background:${COLORS.DEFENSIVE_PACT};"></div>
          <div class="legend-info">
            <div class="legend-name">${t('legend_defensive')}</div>
            <div class="legend-desc">Defensive pact outside the bloc</div>
          </div>
        </div>
        <div class="legend-item">
          <div class="legend-bar" style="background:${COLORS.DEFAULT_LAND};opacity:0.6;"></div>
          <div class="legend-info"><div class="legend-name">${t('legend_neutral')}</div></div>
        </div>
      `;
      return;
    }
    // WarEra+: in anteprima Alliance Builder la legenda elenca i blocchi
    // COSTRUITI, coi loro membri. Le voci non sono cliccabili: il focus su
    // un blocco e' spento in anteprima (vedi map.js, _onRegionClick).
    if (state.builderPreview) {
      box.innerHTML = state.builderPreview.blocs.map(b => `
        <div class="legend-item">
          <div class="legend-bar" style="background:${b.color};"></div>
          <div class="legend-info">
            <div class="legend-name">${escapeHtml(b.name)}</div>
            <div class="legend-desc">${b.memberCount} nations${b.movedCount ? ` · ${b.movedCount} moved` : ''}</div>
          </div>
        </div>`).join('') + `
        <div class="legend-item">
          <div class="legend-bar" style="background:${COLORS.DEFAULT_LAND};opacity:0.6;"></div>
          <div class="legend-info"><div class="legend-name">Unaligned</div></div>
        </div>`;
      return;
    }
    let html = '';
    state.externalBlocsInfo.forEach(b => {
      // lookup per id invece di .find per nome dentro il forEach (O(n^2));
      // il match per nome falliva anche con due alleanze omonime.
      const alliance = state.allianceMap.get(b.id);
      const memberCount = alliance ? alliance.memberCountries.length : 0;
      html += `
        <div class="legend-item wp-legend-clickable" data-bloc-id="${b.id}" title="${t('legend_click_hint')}">
          <div class="legend-bar" style="background:${b.color};"></div>
          <div class="legend-info">
            <div class="legend-name">${escapeHtml(b.name)}</div>
            <div class="legend-desc">${memberCount} nations</div>
          </div>
        </div>`;
    });
    const multi = [...state.multiBlocMap.values()];
    if (multi.length) {
      html += `
        <div class="legend-item">
          <div class="legend-bar" style="background:linear-gradient(180deg,${multi[0].colors[0]} 50%,${multi[0].colors[1]} 50%);"></div>
          <div class="legend-info">
            <div class="legend-name">Multi-bloc</div>
            <div class="legend-desc">Member of multiple alliances</div>
          </div>
        </div>`;
    }
    html += `
      <div class="legend-item">
        <div class="legend-bar" style="background:${COLORS.DEFAULT_LAND};opacity:0.6;"></div>
        <div class="legend-info"><div class="legend-name">Other</div></div>
      </div>`;
    box.innerHTML = html;

    // WarEra+: click su una voce della legenda -> seleziona quel blocco
    // (stesso effetto di cliccare una sua nazione sulla mappa) + effetto
    // "blink" per confermare visivamente quale territorio corrisponde
    // al nome cliccato.
    box.querySelectorAll('.wp-legend-clickable').forEach(el => {
      el.addEventListener('click', () => {
        const blocId = el.dataset.blocId;
        if (!blocId) return;
        const wasSelected = state.selectedBlocId === blocId;
        state.selectedBlocId = wasSelected ? null : blocId;
        import('./map.js').then(m => {
          m.renderMap();
          if (wasSelected) {
            m.clearBlocFlash(); // deselezione: nessun flash, e pulisce quello eventualmente in corso
          } else {
            m.flashBlocOnMap(blocId); // selezione: pulsazione di conferma
          }
        });
        import('../panel/countryPanel.js').then(m => m.selectBlocInPanel(state.selectedBlocId));
        // Stesso evento di map.js (via:'map') ma via:'legend' — percorso
        // diverso per selezionare lo stesso blocco, senza questo il click
        // dalla legenda era invisibile e bloc-click sottostimava l'uso reale.
        if (!wasSelected) {
          const alliance = state.allianceMap.get(blocId);
          if (alliance) trackEvent('bloc-click', { bloc: alliance.name, via: 'legend' });
        }
      });
    });
    return;
  }

  // ==================== BATTLE HEATMAP ====================
// ui.js - sostituisci la sezione battleHeatmap nella funzione updateDynamicLegend

  // ==================== BATTLE HEATMAP ====================
  if (state.coloringMode === 'battleHeatmap' && state.battleHeatmapData) {
    const data = state.battleHeatmapData;
    
    // Calcola i totali per lato per la legenda
    const attackers = data.nations.filter(n => n.side === 'attacker');
    const defenders = data.nations.filter(n => n.side === 'defender');
    const totalAttackerDmg = attackers.reduce((sum, n) => sum + n.totalDamage, 0);
    const totalDefenderDmg = defenders.reduce((sum, n) => sum + n.totalDamage, 0);
    
    box.innerHTML = `
      <div class="legend-section-title">⚔️ Battle Heatmap</div>
      <div class="legend-item"><span style="font-weight:bold;">${escapeHtml(data.battleName)}</span></div>
      <div class="legend-scale" style="margin: 4px 0;">
        <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
          <span style="font-size:10px; color:#58a6ff;">Attacker</span>
          <div style="flex:1; height:12px; background:linear-gradient(to right, #B0D4FF, #0044FF); border-radius:3px;"></div>
          <span style="font-size:10px; color:${THEMES[state.theme].TEXT_SECONDARY};">${fmtNumber(totalAttackerDmg)}</span>
        </div>
        <div style="display:flex; align-items:center; gap:6px;">
          <span style="font-size:10px; color:#ff6b6b;">Defender</span>
          <div style="flex:1; height:12px; background:linear-gradient(to right, #FFB0B0, #FF0000); border-radius:3px;"></div>
          <span style="font-size:10px; color:${THEMES[state.theme].TEXT_SECONDARY};">${fmtNumber(totalDefenderDmg)}</span>
        </div>
        <div style="font-size:10px; color:${THEMES[state.theme].TEXT_SECONDARY}; opacity:.8; margin-top:4px;">Share = nation damage / side total</div>
      </div>
      <button id="exit-heatmap-btn" style="margin-top:8px; background:#ff4444; border:none; color:#fff; padding:6px 12px; border-radius:6px; cursor:pointer; font-weight:600; width:100%; transition:background 0.15s;">✕ Exit Heatmap</button>
    `;
    
    // Gestione robusta del pulsante exit
    setTimeout(() => {
      const exitBtn = document.getElementById('exit-heatmap-btn');
      if (exitBtn) {
        const newExitBtn = exitBtn.cloneNode(true);
        exitBtn.parentNode.replaceChild(newExitBtn, exitBtn);
        newExitBtn.addEventListener('click', (e) => {
          e.stopPropagation();
          import('./battleHeatmap.js').then(m => m.exitBattleHeatmap());
        });
      }
    }, 50);
    return;
  }

  // Diplomacy mode (con o senza selezione)
  if (!state.selectedCountryId) {
    box.innerHTML = `
      <div class="legend-item">
        <div class="legend-bar" style="background:#3a3d46;"></div>
        <div class="legend-info">
          <div class="legend-name">No selection</div>
          <div class="legend-desc">Click a nation on the map</div>
        </div>
      </div>
      <div class="legend-item">
        <div class="legend-bar" style="background:${COLORS.NAP};"></div>
        <div class="legend-info">
          <div class="legend-name">NAP</div>
          <div class="legend-desc">Non-aggression pact</div>
        </div>
      </div>
      ${state.mapSource === 'original' ? '<div class="legend-note">Showing original territory borders</div>' : ''}
    `;
    return;
  }

  // Con nazione selezionata
  const target = state.nationMap.get(state.selectedCountryId);
  const dipl = state.diplomacyData.get(state.selectedCountryId);
  const defCount = dipl?.defensivePacts?.length || 0;
  const swornCount = dipl?.swornEnemy ? 1 : 0;
  const alliesCnt = getAllianceAllies(state.selectedCountryId).length;
  const warsCnt = target?.warsWith?.length ?? 0;
  const napsCnt = state.customNaps.length + _countExternalNaps();
  const dualCnt = getDualAllyDefensiveIds(state.selectedCountryId).length;

  let html = '';
  const items = [
    { color: COLORS.SELECTED, name: t('legend_selected'), desc: t('legend_selected_desc') },
    { color: COLORS.NAP, name: t('legend_nap'), desc: t('legend_nap_desc') },
    { color: COLORS.DEFENSIVE_PACT, name: t('legend_defensive'), desc: t('legend_defensive_desc') },
    { color: COLORS.SWORN_ENEMY, name: t('legend_sworn'), desc: t('legend_sworn_desc') },
    { color: COLORS.WAR_DIRECT, name: t('legend_war_direct'), desc: t('legend_war_direct_desc') },
    { color: COLORS.WAR_INDIRECT, name: t('legend_war_indirect'), desc: t('legend_war_indirect_desc') },
    { color: COLORS.ALLY_DIRECT, name: t('legend_ally_direct'), desc: t('legend_ally_direct_desc') },
    { color: COLORS.DEFAULT_LAND, name: t('legend_neutral'), desc: t('legend_neutral_desc') },
  ];

  items.forEach(item => {
    let cnt = undefined;
    if (item.color === COLORS.ALLY_DIRECT) cnt = alliesCnt;
    else if (item.color === COLORS.WAR_DIRECT) cnt = warsCnt;
    else if (item.color === COLORS.NAP) cnt = napsCnt;
    else if (item.color === COLORS.DEFENSIVE_PACT) cnt = defCount;
    else if (item.color === COLORS.SWORN_ENEMY) cnt = swornCount;
    html += `
      <div class="legend-item">
        <div class="legend-bar" style="background:${item.color};${item.color === COLORS.DEFAULT_LAND ? 'opacity:0.6;' : ''}"></div>
        <div class="legend-info">
          <div class="legend-name">${item.name}</div>
          <div class="legend-desc">${item.desc}</div>
        </div>
        ${cnt !== undefined ? `<div class="legend-count">${cnt}</div>` : ''}
      </div>`;

    if (item.color === COLORS.ALLY_DIRECT && dualCnt > 0) {
      html += `
        <div class="legend-item">
          <div class="legend-bar" style="background:linear-gradient(180deg,${COLORS.ALLY_DIRECT} 50%,${COLORS.DEFENSIVE_PACT} 50%);"></div>
          <div class="legend-info">
            <div class="legend-name">Ally + Defensive Pact</div>
            <div class="legend-desc">Same bloc, also defensive pact</div>
          </div>
          <div class="legend-count">${dualCnt}</div>
        </div>`;
    }
  });

  if (state.mapSource === 'original') {
    html += '<div class="legend-note">Showing original territory borders</div>';
  }
  box.innerHTML = html;
}

function _countExternalNaps() {
  if (!state.selectedCountryId) return 0;
  let cnt = 0;
  state.externalNapsList.forEach(n => {
    if (n.fromId === state.selectedCountryId || n.toId === state.selectedCountryId) cnt++;
  });
  return cnt;
}

export function updateStats() {
  const allies = state.selectedCountryId ? getAllianceAllies(state.selectedCountryId).length : 0;
  const wars   = state.selectedCountryId ? (state.nationMap.get(state.selectedCountryId)?.warsWith?.length ?? 0) : 0;
  const naps   = state.customNaps.length;

  const setSafe = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setSafe('stats-allies', allies);
  setSafe('stats-wars',   wars);
  setSafe('stats-naps',   naps);
  setSafe('chip-allies',  allies);
  setSafe('chip-wars',    wars);
  setSafe('chip-naps',    naps);
}

export function updateSelectedDisplay() {
  const display = document.getElementById('selected-display');
  if (!state.selectedCountryId) { display.style.display = 'none'; return; }

  const nation = state.nationMap.get(state.selectedCountryId);
  if (!nation) { display.style.display = 'none'; return; }

  let code = '';
  if (state.mapSource === 'original') {
    code = state.originalLabelsData.find(l => l.properties.countryId === state.selectedCountryId)?.properties?.countryCode || nation.code?.toLowerCase() || '';
  } else {
    code = state.labelsData.find(l => l.properties?.countryId === state.selectedCountryId)?.properties?.countryCode?.toLowerCase() || nation.code?.toLowerCase() || '';
  }

  const allies = getAllianceAllies(state.selectedCountryId).length;
  const wars = nation.warsWith?.length ?? 0;
  const naps = state.customNaps.length + _countExternalNaps();

  const flagHtml = code
    ? `<img src="https://media.warera.io/images/flags/${code}.svg?v=16" alt="${escapeHtml(nation.name)}" onerror="this.style.display='none'" />`
    : `<span class="selected-flag-fallback">🌍</span>`;

  display.innerHTML = `
    <div class="selected-flag-wrap">${flagHtml}</div>
    <div class="selected-info-col">
      <div class="selected-nation-name">${escapeHtml(nation.name)}</div>
      <div class="selected-nation-meta">${allies} allies · ${wars} wars · ${naps} NAPs</div>
    </div>
    <button id="deselect-btn" title="Deselect">✕</button>
  `;
  display.style.display = 'flex';

  document.getElementById('deselect-btn')?.addEventListener('click', () => {
    state.selectedCountryId = null;
    import('./map.js').then(m => m.renderMap());
    trackEvent('nation-deselect');
  });
}

export function updateNapBadge(count) {
  document.getElementById('nap-count').textContent = count;
}

export function updateNapListUI() {
  const container = document.getElementById('napList');
  updateNapBadge(state.customNaps.length);
  if (!state.customNaps.length) {
    container.innerHTML = '<div class="empty-state">No manual NAPs set</div>';
    return;
  }
  container.innerHTML = state.customNaps.map(id => {
    const n = state.nationMap.get(id);
    if (!n) return '';
    const code = (n.code || '').toLowerCase();
    const flagHtml = code
      ? `<img class="nap-flag-thumb" src="https://media.warera.io/images/flags/${code}.svg?v=16" alt="${escapeHtml(n.name)}" onerror="this.style.display='none'">`
      : `<div class="nap-flag-placeholder">?</div>`;
    return `
      <div class="nap-item">
        ${flagHtml}
        <span class="nap-name">${escapeHtml(n.name)}</span>
        <span class="remove-nap" data-id="${id}" title="Remove">✕</span>
      </div>`;
  }).join('');

  container.querySelectorAll('.remove-nap').forEach(btn => {
    btn.addEventListener('click', () => {
      import('./naps.js').then(({ rimuoviNap }) => rimuoviNap(btn.dataset.id));
    });
  });
}

export function updateExternalNapsUI() {
  const container = document.getElementById('externalNapList');
  if (!state.externalNapsList.length) {
    container.innerHTML = '<div class="empty-state">No external NAPs loaded</div>';
    return;
  }
  const grouped = new Map();
  state.externalNapsList.forEach(nap => {
    if (!grouped.has(nap.fromId)) grouped.set(nap.fromId, []);
    grouped.get(nap.fromId).push(nap.toName);
  });

  let html = '';
  for (const [fromId, toNames] of grouped) {
    const from = state.nationMap.get(fromId);
    if (!from) continue;
    const code = (from.code || '').toLowerCase();
    const flagHtml = code
      ? `<img class="nap-flag-thumb" src="https://media.warera.io/images/flags/${code}.svg?v=16" alt="${escapeHtml(from.name)}" onerror="this.style.display='none'">`
      : `<div class="nap-flag-placeholder">?</div>`;
    html += `
      <div class="nap-item external">
        ${flagHtml}
        <span class="nap-name">${escapeHtml(from.name)}</span>
        <span class="nap-to" title="${escapeHtml(toNames.join(', '))}">→ ${escapeHtml(toNames.length > 2 ? toNames.slice(0, 2).join(', ') + ` +${toNames.length - 2}` : toNames.join(', '))}</span>
      </div>`;
  }
  container.innerHTML = html;
}

export function toggleNapSection(sectionId) {
  const body = document.getElementById(sectionId);
  const iconId = sectionId === 'manual-nap-section' ? 'manual-nap-icon' : 'external-nap-icon';
  const icon = document.getElementById(iconId);
  if (!body || !icon) return;
  const isOpen = body.classList.contains('open');
  body.classList.toggle('open', !isOpen);
  icon.classList.toggle('open', !isOpen);
  icon.textContent = isOpen ? '▶' : '▶';
}

export function syncUIToState() {
  const isOriginal = state.mapSource === 'original';
  document.getElementById('toggle-borders').checked = isOriginal;
  const lA = document.getElementById('label-actual');
  const lO = document.getElementById('label-original');
  if (lA && lO) {
    lA.classList.toggle('active', !isOriginal);
    lO.classList.toggle('active', isOriginal);
  }
  document.getElementById('mode-population')?.classList.toggle('active', state.coloringMode === 'population');
  document.getElementById('mode-diplomacy').classList.toggle('active', state.coloringMode === 'diplomacy');
  document.getElementById('mode-blocs').classList.toggle('active', state.coloringMode === 'blocs');
  document.getElementById('mode-weeklyDamage')?.classList.toggle('active', state.coloringMode === 'weeklyDamage');
  document.getElementById('mode-sphereOfInfluence')?.classList.toggle('active', state.coloringMode === 'sphereOfInfluence');
  document.getElementById('mode-contested')?.classList.toggle('active', state.coloringMode === 'contested');
  document.getElementById('mode-warIntensity')?.classList.toggle('active', state.coloringMode === 'warIntensity');
  document.getElementById('mode-playstyle')?.classList.toggle('active', state.coloringMode === 'playstyle');
  document.getElementById('mode-production')?.classList.toggle('active', state.coloringMode === 'production');
}