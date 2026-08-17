/* ══════════════════════════════════════════════════════════════
   WarEra+ — Pannello laterale nazione
   ------------------------------------------------------------------
   Componente NUOVO (non esiste in Political né in Diplomacy).
   Si aggancia al click sul layer 'regions-fill' della mappa,
   esattamente come fa nationTooltip.js (stesso layer, stesso modo
   di estrarre l'id nazione), ma senza modificare quel file: sono
   due listener indipendenti sullo stesso evento MapLibre, che
   MapLibre supporta nativamente in parallelo.

   Tutti i dati mostrati vengono da state (già popolato da
   diplomacy/main.js: refreshData()) — zero fetch aggiuntive.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import {
  getAllianceAllies, getDefensivePactAllies,
  getBlocMemberIds, getBlocWarTargets, getBlocExternalDefensivePacts, getBlocRelations,
} from '../diplomacy/diplomacy.js';
import { escapeHtml, fmtNumber } from '../diplomacy/utils.js';
import { openPoliticalView } from '../app/politicalOverlay.js';
import { renderParliamentChart, renderParliamentSeats, renderParliamentAvatars, fetchGroupSeatsData, fetchGroupUserData, hasParliamentSeatsCached } from './parliamentChart.js';
import { initPanelResize } from './panelResize.js';
import { t } from '../shared/i18n.js';
import { trackEvent } from '../shared/analytics.js';
import { isPinned, togglePin } from '../app/pins.js';

// Stella di pin per l'intestazione del pannello (nazione o alleanza).
function pinStarHtml(type, id) {
  const on = isPinned(type, id);
  return `<button class="wp-panel-pin${on ? ' pinned' : ''}" id="wp-panel-pin"
            data-pin-type="${type}" data-pin-id="${id}"
            title="${on ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'}"
            aria-label="Preferiti">${on ? '★' : '☆'}</button>`;
}
function wirePinStar() {
  const btn = document.getElementById('wp-panel-pin');
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const type = btn.dataset.pinType;
    const id = btn.dataset.pinId;
    const on = togglePin(type, id);
    btn.classList.toggle('pinned', on);
    btn.textContent = on ? '★' : '☆';
    btn.title = on ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
    trackEvent('pin-toggle', { type, id, pinned: on, source: 'panel' });
  });
}

let panelEl, contentEl, closeBtn;
let currentNationId = null;
let currentBlocId = null;

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return fmtNumber(n);
}

function getFlagUrl(code) {
  return code ? `https://media.warera.io/images/flags/${code}.svg?v=16` : null;
}

function getNationCode(nationId, nation) {
  const isOriginal = state.mapSource === 'original';
  const srcData = isOriginal ? state.originalLabelsData : state.labelsData;
  const label = srcData?.find(l => l.properties?.countryId === nationId);
  return label?.properties?.countryCode?.toLowerCase() || nation.code?.toLowerCase() || '';
}

function buildPanelHtml(nation) {
  const code = getNationCode(nation._id, nation);
  const flagUrl = getFlagUrl(code);

  const pop = nation?.rankings?.countryActivePopulation?.value || 0;
  const wealth = nation?.rankings?.countryWealth?.value ?? nation.money ?? 0;
  const dmg = nation?.rankings?.weeklyCountryDamages?.value || 0;
  const dev = nation?.rankings?.countryDevelopment?.value;
  const wars = nation?.warsWith?.length || 0;

  const allies = getAllianceAllies(nation._id);
  const defensivePacts = getDefensivePactAllies(nation._id);
  const dipl = state.diplomacyData.get(nation._id);
  let swornEnemyName = '';
  if (dipl?.swornEnemy) {
    const enemy = state.nationMap.get(dipl.swornEnemy);
    if (enemy) swornEnemyName = enemy.name;
  }

  const blocColor = state.blocColorMap.get(nation._id);
  const blocInfo = blocColor ? state.externalBlocsInfo.find(b => b.color === blocColor) : null;

  return `
    <div class="wp-panel-header">
      ${flagUrl
        ? `<img class="wp-panel-flag" src="${flagUrl}" alt="" onerror="this.style.display='none'">`
        : ''}
      <div>
        <div class="wp-panel-name">${escapeHtml(nation.name)}</div>
        ${blocInfo ? `<span class="wp-panel-bloc" style="background:${blocInfo.color}22;color:${blocInfo.color}">${escapeHtml(blocInfo.name)}</span>` : ''}
      </div>
      ${pinStarHtml('nation', nation._id)}
    </div>

    <div class="wp-political-actions" role="group" aria-label="${t('explore_political_title')}">
      <button class="wp-political-action-btn" id="wp-open-elections-btn">
        <span class="wp-political-action-icon">🗳️</span>${t('elections_btn')}
      </button>
      <button class="wp-political-action-btn" id="wp-open-senate-btn">
        <span class="wp-political-action-icon">🏛️</span>${t('senate_btn')}
      </button>
      <button class="wp-political-action-btn" id="wp-open-parties-btn">
        <span class="wp-political-action-icon">👥</span>${t('parties_btn')}
      </button>
    </div>

    <div class="wp-panel-section-title">${t('parliament_government')}</div>
    <div class="wp-parliament-embed" id="wp-parliament-container">
      <div class="wp-parliament-loading">${t('loading_parliament')}</div>
    </div>

    <div class="wp-panel-grid">
      <div class="wp-stat"><div class="wp-stat-label">${t('population_label')}</div><div class="wp-stat-value">${fmt(pop)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('wealth_label')}</div><div class="wp-stat-value">${fmt(wealth)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('weekly_damage_label')}</div><div class="wp-stat-value">${fmt(dmg)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('development_label')}</div><div class="wp-stat-value">${dev != null ? dev.toFixed(1) : '—'}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('defensive_pacts_label')}</div><div class="wp-stat-value">${defensivePacts.length}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('active_wars_label')}</div><div class="wp-stat-value">${wars}</div></div>
    </div>

    ${swornEnemyName ? `
      <div class="wp-panel-section-title">${t('sworn_enemy_label')}</div>
      <div class="wp-panel-row"><span>⚡ ${escapeHtml(swornEnemyName)}</span></div>
    ` : ''}

    ${allies.length ? `
      <div class="wp-panel-section-title">${t('direct_allies_label')} (${allies.length})</div>
      ${allies.slice(0, 6).map(id => {
        const a = state.nationMap.get(id);
        return a ? `<div class="wp-panel-row"><span>${escapeHtml(a.name)}</span></div>` : '';
      }).join('')}
      ${allies.length > 6 ? `<div class="wp-panel-row"><span style="color:#8b949e;">${t('plus_others', { n: allies.length - 6 })}</span></div>` : ''}
    ` : ''}
  `;
}

function render(nationId) {
  const nation = state.nationMap.get(nationId);
  if (!nation) return;
  currentNationId = nationId;
  currentBlocId = null;
  contentEl.innerHTML = buildPanelHtml(nation);
  panelEl.classList.add('open');
  panelEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('wp-panel-open');
  wirePinStar();

  // WarEra+: le tre scorciatoie in cima al pannello aprono Political View
  // direttamente sulla vista giusta (vedi initPoliticalView in
  // src/political/main.js). "Elezioni" è la vista di default (nessuna
  // opzione), Senato e Partiti passano la loro opzione dedicata.
  const electionsBtn = document.getElementById('wp-open-elections-btn');
  if (electionsBtn) {
    electionsBtn.addEventListener('click', () => {
      openPoliticalView(nationId, nation.name);
    });
  }

  const senateBtn = document.getElementById('wp-open-senate-btn');
  if (senateBtn) {
    senateBtn.addEventListener('click', () => {
      openPoliticalView(nationId, nation.name, { openSenate: true });
    });
  }

  const partiesBtn = document.getElementById('wp-open-parties-btn');
  if (partiesBtn) {
    partiesBtn.addEventListener('click', () => {
      openPoliticalView(nationId, nation.name, { openParty: true });
    });
  }

  const parliamentContainer = document.getElementById('wp-parliament-container');
  if (parliamentContainer) {
    renderParliamentChart(parliamentContainer, nationId);
  }
}

/* ── PANNELLO BLOCCO (WarEra+) ──
   Mostrato al posto del pannello nazione quando in modalità 'blocs' si
   seleziona un blocco (vedi map.js:_onRegionClick, che chiama
   selectBlocInPanel). Dati aggregati del blocco, poi in fondo i
   parlamenti di OGNI nazione membro, uno per uno (non aggregati) —
   ognuno è un'istanza indipendente di renderParliamentChart, resa
   possibile dal fix del token anti-race-condition (era un contatore
   globale, ora per-contenitore: vedi parliamentChart.js). */
function buildBlocPanelHtml(allianceId) {
  const alliance = state.allianceMap.get(allianceId);
  if (!alliance) return `<div class="wp-panel-empty">Bloc not found.</div>`;

  const memberIds = getBlocMemberIds(allianceId);
  // WarEra+: ordinati per popolazione attiva decrescente — sia per la
  // lista visualizzata sia per l'ordine di caricamento dei parlamenti
  // (vedi renderBlocPanel), così le nazioni più rilevanti si riempiono
  // per prime.
  const members = memberIds
    .map(id => state.nationMap.get(id))
    .filter(Boolean)
    .sort((a, b) => (b?.rankings?.countryActivePopulation?.value || 0) - (a?.rankings?.countryActivePopulation?.value || 0));
  const color = state.allianceColorMap.get(allianceId) || '#888888';

  const totalPop = members.reduce((s, n) => s + (n?.rankings?.countryActivePopulation?.value || 0), 0);
  const totalWealth = members.reduce((s, n) => s + (n?.rankings?.countryWealth?.value ?? n?.money ?? 0), 0);
  const totalWeeklyDamage = members.reduce((s, n) => s + (n?.rankings?.weeklyCountryDamages?.value || 0), 0);
  // WarEra+: danno settimanale medio per player attivo — utile per
  // confrontare l'intensità militare di blocchi con popolazioni molto
  // diverse (un blocco piccolo ma aggressivo può avere un valore più
  // alto di uno grande ma passivo).
  const damagePerPlayer = totalPop > 0 ? totalWeeklyDamage / totalPop : 0;
  const warTargets = getBlocWarTargets(allianceId);
  const defTargets = getBlocExternalDefensivePacts(allianceId);
  const { wars: warBlocs, allies: defactoAllies } = getBlocRelations(allianceId);

  return `
    <div class="wp-panel-header">
      ${alliance.avatarUrl
        ? `<img class="wp-bloc-avatar" src="${alliance.avatarUrl}" alt="" onerror="this.style.display='none'; this.nextElementSibling.style.display='block';">
           <div class="wp-bloc-swatch" style="background:${color}; display:none;"></div>`
        : `<div class="wp-bloc-swatch" style="background:${color};"></div>`}
      <div>
        <div class="wp-panel-name">${escapeHtml(alliance.name)}</div>
        <span class="wp-panel-bloc" style="background:${color}22;color:${color}">${members.length} nations</span>
      </div>
      ${pinStarHtml('alliance', allianceId)}
    </div>

    <div class="wp-panel-grid">
      <div class="wp-stat"><div class="wp-stat-label">${t('population_label')}</div><div class="wp-stat-value">${fmt(totalPop)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('wealth_label')}</div><div class="wp-stat-value">${fmt(totalWealth)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('weekly_damage_label')}</div><div class="wp-stat-value">${fmt(totalWeeklyDamage)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('damage_per_player_label')}</div><div class="wp-stat-value">${damagePerPlayer >= 1000 ? fmt(damagePerPlayer) : damagePerPlayer.toFixed(1)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('active_wars_label')}</div><div class="wp-stat-value">${warTargets.length}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('defensive_pacts_label')}</div><div class="wp-stat-value">${defTargets.length}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">🤝 ${t('defacto_allies_title')}</div><div class="wp-stat-value">${defactoAllies.length}</div></div>
    </div>

    ${warBlocs.length ? `
      <div class="wp-panel-section-title">${t('defacto_wars_title')}</div>
      ${warBlocs.map(b => `
        <div class="wp-panel-row"><span>${escapeHtml(b.name)}</span><span style="color:#e05252;">${b.warCount}/${b.memberCount} ${t('at_war_label')}</span></div>
      `).join('')}
    ` : ''}

    ${defactoAllies.length ? `
      <div class="wp-panel-section-title">${t('defacto_allies_title')}</div>
      ${defactoAllies.map(b => `
        <div class="wp-panel-row"><span>${escapeHtml(b.name)}</span><span style="color:#2ecc71;">${b.pactedCount}/${b.memberCount} ${t('pacted_label')}</span></div>
      `).join('')}
    ` : ''}

    <div class="wp-panel-section-title">${t('parliament_government')} — ${t('current')}</div>
    <div id="wp-bloc-parliaments">
      ${members.map(m => {
        const code = getNationCode(m._id, m);
        const flagUrl = getFlagUrl(code);
        return `
        <div class="wp-bloc-member-block">
          <div class="wp-bloc-member-header">
            ${flagUrl ? `<img class="wp-bloc-member-flag" src="${flagUrl}" alt="" onerror="this.style.display='none'">` : ''}
            <span>${escapeHtml(m.name)}</span>
          </div>
          <div class="wp-parliament-embed" id="wp-parliament-bloc-${m._id}">
            <div class="wp-parliament-loading wp-parliament-queued">⏳ ${t('queued_parliament')}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  `;
}

// WarEra+: caricamento a gruppi dei parlamenti del blocco. Prima versione
// (scaglionava l'avvio di ogni singola nazione) restava comunque a ~3
// richieste HTTP per nazione, quindi con un blocco di 21 membri il totale
// restava alto anche distribuito nel tempo — "non davvero raggruppato",
// come giustamente segnalato. Ora fetchGroupSeatsData/fetchGroupUserData
// (parliamentChart.js) raggruppano la STESSA fase su un intero gruppo di
// nazioni in poche richieste fisse, indipendentemente da quante nazioni
// contiene il gruppo.
//
// La versione precedente divideva i membri in due gruppi (primi 10
// subito, resto dopo 1 minuto di pausa) per stare ancora più larghi col
// rate limit. Rimossa su richiesta per verificare se il solo batching di
// gruppo (poche richieste fisse invece che una per nazione) basta da
// solo: se il 429 dovesse ripresentarsi con blocchi molto numerosi, la
// divisione in due gruppi con pausa è la prima cosa da reintrodurre.
let _blocQueueToken = 0;

async function _renderMemberGroup(myQueueToken, members) {
  const ids = members.map(m => m._id);

  await fetchGroupSeatsData(ids);
  if (myQueueToken !== _blocQueueToken) return; // un altro blocco è stato selezionato nel frattempo
  members.forEach(m => {
    const container = document.getElementById(`wp-parliament-bloc-${m._id}`);
    // renderParliamentSeats trova i dati già in cache (appena popolati da
    // fetchGroupSeatsData): nessuna nuova fetch, solo disegno del grafico.
    if (container) renderParliamentSeats(container, m._id);
  });

  await fetchGroupUserData(ids);
  if (myQueueToken !== _blocQueueToken) return;
  members.forEach(m => {
    const container = document.getElementById(`wp-parliament-bloc-${m._id}`);
    if (container) renderParliamentAvatars(container, m._id);
  });
}

async function _renderBlocParliamentsQueued(members) {
  const myQueueToken = ++_blocQueueToken;
  await _renderMemberGroup(myQueueToken, members);
}

function renderBlocPanel(allianceId) {
  const alliance = state.allianceMap.get(allianceId);
  if (!alliance) return;
  currentBlocId = allianceId;
  currentNationId = null;
  contentEl.innerHTML = buildBlocPanelHtml(allianceId);
  panelEl.classList.add('open');
  panelEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('wp-panel-open');
  wirePinStar();

  // Stesso ordine (popolazione decrescente) usato per costruire l'HTML
  // in buildBlocPanelHtml, così il primo gruppo caricato è anche quello
  // mostrato per primo nella lista.
  const members = getBlocMemberIds(allianceId)
    .map(id => state.nationMap.get(id))
    .filter(Boolean)
    .sort((a, b) => (b?.rankings?.countryActivePopulation?.value || 0) - (a?.rankings?.countryActivePopulation?.value || 0));

  _renderBlocParliamentsQueued(members);
}

/** Chiamata da map.js quando si seleziona/deseleziona un blocco in modalità 'blocs'. */
export function selectBlocInPanel(allianceId) {
  if (allianceId) {
    renderBlocPanel(allianceId);
  } else {
    closePanel();
  }
}

export function closePanel() {
  panelEl.classList.remove('open');
  panelEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('wp-panel-open');
  currentNationId = null;
  currentBlocId = null;
  _blocQueueToken++; // interrompe qualunque coda di caricamento parlamenti in corso
}

export function getCurrentNationId() {
  return currentNationId;
}

/**
 * Aggancia il pannello alla mappa. Va chiamato dopo che la mappa è
 * pronta e i layer esistono (evento 'wareraplus:diplomacy-ready').
 */
export function initCountryPanel() {
  panelEl = document.getElementById('wp-country-panel');
  contentEl = document.getElementById('wp-panel-content');
  closeBtn = document.getElementById('wp-panel-close');

  closeBtn.addEventListener('click', () => {
    // Tracciato QUI, non dentro closePanel(): quella è condivisa anche da
    // selectBlocInPanel(null) (side-effect di un cambio modalità/
    // deselezione blocco, non una vera chiusura voluta dall'utente) — in
    // quel percorso il click sulla ✕ non c'è mai stato.
    trackEvent('nation-panel-close');
    closePanel();
  });
  initPanelResize();

  // Ri-renderizza il pannello (stringhe tradotte) se la lingua cambia
  // mentre una nazione o un blocco è già selezionato.
  window.addEventListener('wareraplus:langchange', () => {
    if (currentNationId) render(currentNationId);
    else if (currentBlocId) renderBlocPanel(currentBlocId);
  });

  // Ri-renderizza SOLO i grafici parlamento (non l'intero pannello, che
  // perderebbe inutilmente scroll/focus) quando il pannello viene
  // ridimensionato o la finestra cambia dimensione — i dati restano gli
  // stessi (cache), cambia solo il layout SVG per la nuova larghezza.
  // In modalità blocco, ri-renderizza il grafico di OGNI membro.
  window.addEventListener('wareraplus:panel-resized', () => {
    if (currentNationId) {
      const parliamentContainer = document.getElementById('wp-parliament-container');
      if (parliamentContainer) renderParliamentChart(parliamentContainer, currentNationId);
    } else if (currentBlocId) {
      // Solo le nazioni già caricate (in cache): il secondo gruppo,
      // ancora in attesa del ritardo di un minuto, non deve scattare in
      // anticipo solo perché l'utente ha ridimensionato il pannello.
      getBlocMemberIds(currentBlocId).forEach(id => {
        if (!hasParliamentSeatsCached(id)) return;
        const container = document.getElementById(`wp-parliament-bloc-${id}`);
        if (container) renderParliamentChart(container, id);
      });
    }
  });

  if (!state.map) {
    console.warn('WarEra+ countryPanel: state.map non pronto, riprovo tra poco');
    setTimeout(initCountryPanel, 300);
    return;
  }

  const layerId = 'regions-fill';
  state.map.on('click', layerId, (e) => {
    if (!e.features?.[0]) return;
    // WarEra+: mentre la time machine è aperta, il click mostra il
    // proprietario storico (src/app/timeMachine.js, listener separato sullo
    // stesso layer) — non deve aprire ANCHE il pannello nazione live. Stesso
    // guard di map.js:_onRegionClick, ma questo listener è indipendente
    // (bindato qui, non passa da _onRegionClick) quindi va ripetuto.
    if (state.timeMachineActive) return;
    // In modalità 'blocs' la selezione è gestita da map.js:_onRegionClick,
    // che chiama selectBlocInPanel() per mostrare il pannello blocco —
    // altrimenti questo listener e quello di map.js, entrambi agganciati
    // allo stesso evento click MapLibre, andrebbero in conflitto (uno
    // mostrerebbe la singola nazione, l'altro il blocco).
    if (state.coloringMode === 'blocs') return;
    // WarEra+ (feedback utente): su mobile il pannello a schermo intero non
    // si apre più da solo al click — nasconderebbe mappa/diplomazia sotto
    // finché non lo si chiude. nationTooltip.js mostra un tooltip leggero
    // con un bottone esplicito "Full Details" che chiama selectNationInPanel
    // (sotto) quando l'utente vuole davvero i dettagli estesi. Su desktop
    // resta automatico com'era: lì il pannello è una sidebar, non copre la
    // mappa, niente da nascondere.
    const isMobile = window.innerWidth <= 768 || 'ontouchstart' in window;
    if (isMobile) return;
    const props = e.features[0].properties;
    const nid = state.mapSource === 'original' ? props.initialCountryId : props.countryId;
    if (nid) render(nid);
  });
}

/** Permette a Political View (via postMessage) o ad altri moduli di aprire il pannello per id */
export function selectNationInPanel(nationId) {
  if (nationId && state.nationMap?.has(nationId)) render(nationId);
}
