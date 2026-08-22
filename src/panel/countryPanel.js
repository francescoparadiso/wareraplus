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
import { ensureDailyDamage, sumCountryDamageToday, dailyDamageLabel } from '../shared/dailyDamage.js';
import { allianceDamageBonus, formatBonus } from '../shared/allianceBonus.js';

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

/* ── Pannello a comparsa su mobile (WarEra+) ──
   Su telefono il pannello è largo quanto lo schermo: aperto da solo copre
   la mappa, che è il motivo per cui si sta guardando una vista. Per nazione
   e alleanza il ripiego era già il tooltip leggero (nationTooltip.js); per
   la sfera, che di tooltip non ne ha, si mostra invece una linguetta in
   basso "Vedi dettagli": il contenuto è già disegnato e pronto, la
   linguetta si limita a farlo scorrere dentro.

   Larghezza sola, non 'ontouchstart': un portatile touch resta un desktop
   (stessa correzione già fatta in diplomacy/ui.js per la legenda). */
function isMobileView() {
  return window.innerWidth <= 768;
}

let peekEl = null;
function ensurePeekEl() {
  if (peekEl) return peekEl;
  peekEl = document.createElement('button');
  peekEl.type = 'button';
  peekEl.id = 'wp-panel-peek';
  peekEl.className = 'wp-panel-peek';
  peekEl.hidden = true;
  peekEl.addEventListener('click', () => {
    hidePanelPeek();
    openPanelNow();
  });
  document.body.appendChild(peekEl);
  return peekEl;
}

function showPanelPeek(title) {
  const el = ensurePeekEl();
  el.innerHTML = `<span class="wp-panel-peek-title">${escapeHtml(title)}</span>
                  <span class="wp-panel-peek-cta">${t('see_details')} ›</span>`;
  el.hidden = false;
}

function hidePanelPeek() {
  if (peekEl) peekEl.hidden = true;
}

function openPanelNow() {
  panelEl.classList.add('open');
  panelEl.setAttribute('aria-hidden', 'false');
  document.body.classList.add('wp-panel-open');
  updateBackBar();
}

/* ── Barra "Indietro" in cima al pannello (WarEra+, solo mobile) ──
   Su telefono il pannello copre tutto lo schermo e l'unica via d'uscita era
   la ✕ da 32px in alto a destra — piccola, e nel posto dove su mobile non
   si cerca. Qui c'è una barra piena in cima, appiccicata mentre si scorre,
   con la stessa idea del "← Torna alla mappa" delle altre sotto-viste.

   Dove porta dipende da dov'è: dal dettaglio di una sfera si risale al
   riepilogo delle sfere (che è il livello sopra), da tutto il resto si
   chiude il pannello e si torna alla mappa. Su desktop non compare: lì il
   pannello è una sidebar e la mappa è già visibile accanto. */
let backBarEl = null, backLabelEl = null;
function ensureBackBar() {
  if (backBarEl || !panelEl) return;
  backBarEl = document.createElement('div');
  backBarEl.id = 'wp-panel-back';
  backBarEl.className = 'wp-panel-back';

  // La ✕ originale (#wp-panel-close) è in posizione assoluta in cima al
  // pannello: una barra a tutta larghezza le finirebbe sopra e sparirebbe
  // (segnalato dall'utente). Su mobile quindi la ✕ NON resta dietro la
  // barra ma ci entra dentro, a destra — un solo posto per uscire, dove
  // entrambe le abitudini (freccia a sinistra, croce a destra) funzionano.
  backLabelEl = document.createElement('button');
  backLabelEl.type = 'button';
  backLabelEl.className = 'wp-panel-back-btn';
  backLabelEl.addEventListener('click', () => {
    if (currentSphereId) { renderSphereOverviewPanel(); return; }
    trackEvent('nation-panel-close', { via: 'mobile-back' });
    closePanel();
  });

  const closeInBar = document.createElement('button');
  closeInBar.type = 'button';
  closeInBar.className = 'wp-panel-back-close';
  closeInBar.setAttribute('aria-label', 'Close');
  closeInBar.textContent = '✕';
  closeInBar.addEventListener('click', () => {
    trackEvent('nation-panel-close', { via: 'mobile-x' });
    closePanel();
  });

  backBarEl.appendChild(backLabelEl);
  backBarEl.appendChild(closeInBar);
  panelEl.insertBefore(backBarEl, panelEl.firstChild);
}

function updateBackBar() {
  if (!backLabelEl) return;
  // back_to_map porta già la freccia dentro la traduzione, sphere_all_label no.
  backLabelEl.textContent = currentSphereId ? `← ${t('sphere_all_label')}` : t('back_to_map');
}

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

/* ── Danno di oggi nel pannello (WarEra+) ──
   Il cumulato settimanale dice quanto si è picchiato in una settimana, ma
   la domanda di chi guarda una nazione o un'alleanza durante una guerra è
   quasi sempre "oggi quanto stanno spingendo": è quella la cifra che si
   muove. Il conto (e i suoi casi limite) sta in src/shared/dailyDamage.js.

   La casella si disegna VUOTA e si riempie quando lo scatto arriva dal
   server di cache: il resto del pannello viene tutto da `state` ed è già
   pronto, non deve aspettare una richiesta di rete per comparire. Se il
   server non ha il dato, la casella resta nascosta e il pannello è quello
   di prima. */
/* ── Cittadini (WarEra+) ──
   La casella "popolazione" mostra `rankings.countryActivePopulation`, cioè
   gli ATTIVI: è il numero che il gioco mette in classifica, non quanti
   cittadini ha davvero il paese. Il censimento del server
   (server/warera-cache-server.js: pollCitizens, che pagina
   user.getUsersByCountry) dà quello vero — misurato, gli iscritti sono
   ~1,07 volte gli attivi — più quanti si sono registrati oggi.

   Come per il danno di oggi la casella nasce vuota e si riempie quando la
   risposta arriva: il resto del pannello viene da `state` ed è già pronto. */
function citizensStatHtml() {
  return `<div class="wp-stat" id="wp-stat-citizens" hidden>
    <div class="wp-stat-label">${t('citizens_label')}</div>
    <div class="wp-stat-value" id="wp-stat-citizens-value">—</div>
    <div class="wp-stat-sub" id="wp-stat-citizens-new"></div>
  </div>`;
}

/** Riempie la casella sommando le nazioni date (una sola per il pannello
 *  nazione, tutti i membri per alleanza e sfera). */
function paintCitizens(nationIds, stillCurrent) {
  import('../diplomacy/cacheClient.js')
    .then(m => m.fetchCitizensViaCache())
    .then(byCountry => {
      if (!byCountry || !stillCurrent()) return;
      let n = 0, today = 0, found = 0;
      for (const id of nationIds) {
        const row = byCountry[id];
        if (!row) continue;
        found++; n += row.n || 0; today += row.new24h || 0;
      }
      if (!found) return;
      const box = document.getElementById('wp-stat-citizens');
      const value = document.getElementById('wp-stat-citizens-value');
      const sub = document.getElementById('wp-stat-citizens-new');
      if (!box || !value) return;
      value.textContent = fmt(n);
      if (sub) sub.textContent = today ? t('citizens_new_today', { n: today }) : '';
      box.hidden = false;
    })
    .catch(() => { /* niente casella cittadini, nient'altro cambia */ });
}

function dailyDamageStatHtml() {
  return `<div class="wp-stat" id="wp-stat-today" hidden>
    <div class="wp-stat-label">🔥 <span id="wp-stat-today-label"></span></div>
    <div class="wp-stat-value" id="wp-stat-today-value">—</div>
  </div>`;
}

/** Riempie la casella per l'insieme di nazioni dato (una sola per il
 *  pannello nazione, tutti i membri per alleanza e sfera). `stillCurrent`
 *  evita di scrivere su un pannello che nel frattempo è cambiato. */
function paintDailyDamage(nations, stillCurrent) {
  ensureDailyDamage().then(baseline => {
    if (!baseline || !stillCurrent()) return;
    const today = sumCountryDamageToday(nations);
    if (today == null) return; // nessuna delle nazioni era nello scatto
    const box = document.getElementById('wp-stat-today');
    const label = document.getElementById('wp-stat-today-label');
    const value = document.getElementById('wp-stat-today-value');
    if (!box || !label || !value) return;
    label.textContent = dailyDamageLabel(t);
    value.textContent = fmt(today);
    box.hidden = false;
  });
}

/* ══════════════════════════════════════════════════════════════
   Espansione territoriale (saldo regioni)
   ------------------------------------------------------------------
   `rankings.countryRegionDiff` arriva già dentro l'oggetto nazione di
   country.getAllCountries, come gli altri rankings che il pannello legge:
   nessuna fetch in più, nessuna dipendenza dal cache-server.

   Semantica verificata contro region.getRegionsObject (campo `country`
   contro `initialCountry`): è regioni attuali − regioni iniziali.
   Combaciava su 178 nazioni su 180; le due differenze erano di 1 e si
   riallineano al giro di aggiornamento successivo del ranking.

   Il segno va mostrato sempre: "29" da solo non dice se quella nazione
   ha conquistato o perso. Zero resta neutro, senza colore.
   ══════════════════════════════════════════════════════════════ */
function regionDiffStatHtml(v, rank) {
  const label = t('expansion_label');
  if (v == null) {
    return `<div class="wp-stat"><div class="wp-stat-label">${label}</div><div class="wp-stat-value">—</div></div>`;
  }
  const cls = v > 0 ? ' up' : v < 0 ? ' down' : '';
  const txt = v > 0 ? `+${v}` : String(v);
  const title = rank ? ` title="#${rank}"` : '';
  return `<div class="wp-stat"${title}><div class="wp-stat-label">${label}</div><div class="wp-stat-value${cls}">${txt}</div></div>`;
}

/** Espansione di un blocco: somma dei saldi regioni dei membri. Positiva =
 *  l'alleanza ha guadagnato territorio da inizio partita. Nessun rank: le
 *  classifiche di WarEra sono per nazione, non per blocco. */
function blocRegionDiff(members) {
  return members.reduce((s, n) => s + (n?.rankings?.countryRegionDiff?.value || 0), 0);
}

/** Bonus danno d'alleanza (vedi src/shared/allianceBonus.js per la regola e
 *  la verifica contro la schermata di gioco). Il title riporta quota e
 *  sviluppo core: senza quei due numeri il bonus da solo non si spiega. */
function allianceBonusStatHtml(members) {
  const label = t('alliance_bonus_label');
  const b = allianceDamageBonus(members, state.nazioniGlobal);
  if (!b) {
    return `<div class="wp-stat"><div class="wp-stat-label">${label}</div><div class="wp-stat-value">—</div></div>`;
  }
  // Numeri interi e non formattati con fmt(): lo sviluppo core sta sulle
  // migliaia, e "3.0K / 14.9K" perde proprio le cifre che spiegano la quota.
  const title = `${b.share.toFixed(2)}% · core dev ${Math.round(b.core)} / ${Math.round(b.world)}`;
  return `<div class="wp-stat" title="${title}"><div class="wp-stat-label">${label}</div><div class="wp-stat-value up">${formatBonus(b.bonus)}</div></div>`;
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

    <div id="wp-panel-playstyle"></div>

    <div class="wp-panel-grid">
      <div class="wp-stat"><div class="wp-stat-label">${t('population_label')}</div><div class="wp-stat-value">${fmt(pop)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('wealth_label')}</div><div class="wp-stat-value">${fmt(wealth)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('weekly_damage_label')}</div><div class="wp-stat-value">${fmt(dmg)}</div></div>
      ${citizensStatHtml()}
      ${dailyDamageStatHtml()}
      <div class="wp-stat"><div class="wp-stat-label">${t('development_label')}</div><div class="wp-stat-value">${dev != null ? dev.toFixed(1) : '—'}</div></div>
      ${regionDiffStatHtml(nation?.rankings?.countryRegionDiff?.value, nation?.rankings?.countryRegionDiff?.rank)}
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
  currentSphereId = null;
  sphereOverviewOpen = false;
  contentEl.innerHTML = buildPanelHtml(nation);
  hidePanelPeek();   // si arriva qui da una scelta esplicita: niente linguetta
  openPanelNow();
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

  renderPlaystyle(nationId);
  paintDailyDamage([nation], () => currentNationId === nationId);
  paintCitizens([nationId], () => currentNationId === nationId);
}

/* ── Stile di gioco dei cittadini (WarEra+) ──
   Quanti giocano di guerra e quanti di economia, letto dalla
   distribuzione dei loro punti abilità (vedi src/mu/playstyle.js per il
   metodo e le soglie, verificate su 900 utenti).

   ⚠️ È un CAMPIONE, non un censimento, ed è etichettato come tale: sono
   i cittadini tesserati in una unità militare, gli unici di cui si
   conoscano le skill. WarEra non espone l'elenco dei cittadini di un
   paese, quindi non c'è modo di allargarlo — e il campione pende verso
   la guerra, visto da dove è preso.

   L'aggregato lo calcola il server di cache (endpoint
   /mu-playstyle-by-country) riusando le stesse risposte user.getUserLite
   che scarica già per la nazionalità dei membri: costo zero in chiamate.
   Se il server non risponde, la sezione semplicemente non compare. */
const PLAYSTYLE_DELTA_WINDOW_MS = 24 * 60 * 60 * 1000;

async function renderPlaystyle(nationId) {
  const host = document.getElementById('wp-panel-playstyle');
  if (!host) return;
  const { fetchPlaystyleByCountry, fetchPlaystyleHistory } = await import('../mu/api.js');
  const { playstyleDelta } = await import('../mu/playstyle.js');
  const byCountry = await fetchPlaystyleByCountry();
  // Il pannello può essere già passato a un'altra nazione nel frattempo.
  if (!byCountry || currentNationId !== nationId) return;
  const counts = byCountry[nationId];
  if (!counts?.known) return;

  // La nota dice la copertura VERA: quanti cittadini hanno skill note su
  // quanti ne ha il paese (censimento del server, campo `total`). Prima
  // diceva "sui cittadini tesserati in una unità militare", che era il modo
  // di dire "non lo sappiamo per tutti" quando l'unico insieme misurabile
  // erano i tesserati.
  await paintPlaystyle(host, counts, t('playstyle_note', { n: counts.known, m: counts.total ?? counts.known }));

  // Il movimento nelle ultime 24 ore, in una seconda fetch: la fotografia
  // deve comparire subito, la tendenza può arrivare un istante dopo.
  const series = await fetchPlaystyleHistory(nationId, Date.now() - PLAYSTYLE_DELTA_WINDOW_MS);
  if (currentNationId !== nationId) return;
  paintPlaystyleDelta(playstyleDelta(series), counts.known);
}

/* ── Stile di gioco di un'ALLEANZA (WarEra+) ──
   Stessa lettura del pannello nazione, sommata su tutte le nazioni membre:
   la domanda su un blocco è se sia una macchina da guerra o un cartello
   economico, e la risposta sta nella somma, non in dieci barre da leggere
   una per una.

   La fotografia costa ZERO fetch: /mu-playstyle-by-country è già in memoria
   dalla prima apertura di un pannello qualsiasi, contiene tutte le nazioni,
   e qui si sommano solo le voci dei membri. La tendenza a 24 ore invece è
   UNA richiesta per l'intero blocco (parametro `countryIds`), non una per
   nazione — vedi fetchPlaystyleHistoryMany. */
async function renderBlocPlaystyle(allianceId, memberIds) {
  const host = document.getElementById('wp-panel-bloc-playstyle');
  if (!host || !memberIds.length) return;
  const { fetchPlaystyleByCountry, fetchPlaystyleHistoryMany } = await import('../mu/api.js');
  const { sumPlaystyleCounts, sumPlaystyleDeltas } = await import('../mu/playstyle.js');
  const byCountry = await fetchPlaystyleByCountry();
  if (!byCountry || currentBlocId !== allianceId) return;

  const counts = sumPlaystyleCounts(memberIds.map(id => byCountry[id]));
  if (!counts.known) return;

  await paintPlaystyle(host, counts, t('playstyle_bloc_note', { n: counts.countries, m: memberIds.length }));

  const seriesByCountry = await fetchPlaystyleHistoryMany(memberIds, Date.now() - PLAYSTYLE_DELTA_WINDOW_MS);
  if (currentBlocId !== allianceId) return;
  paintPlaystyleDelta(sumPlaystyleDeltas(seriesByCountry), counts.known);
}

/** Disegno comune a nazione e alleanza: titolo, barra, posto per la
 *  tendenza, nota sul campione. L'id del contenitore della tendenza è unico
 *  nel documento perché i due pannelli non sono mai aperti insieme (uno
 *  sostituisce l'altro nello stesso contentEl). */
async function paintPlaystyle(host, counts, note) {
  const { playstyleBarHtml } = await import('../mu/playstyle.js');
  const labels = {
    war: t('ps_war'), eco: t('ps_eco'),
    mixed: t('ps_mixed'), undecided: t('ps_undecided'),
  };
  host.innerHTML = `
    <div class="wp-panel-section-title">${t('playstyle_label')} <span class="wp-panel-ps-count">${counts.known}</span></div>
    ${playstyleBarHtml(counts, labels)}
    <div id="wp-panel-ps-delta"></div>
    <div class="wp-panel-ps-note">${note}</div>`;
}

/* `base` è il `known` attuale, serve solo alla percentuale di chi ha
   cambiato scuola. Sul pannello alleanza il travaso è calcolato sui delta
   GIÀ SOMMATI del blocco, non nazione per nazione: così il numero resta
   coerente con i due totali che gli stanno accanto (un +2 / −7 di blocco non
   può convivere con "nove passati", che verrebbe fuori sommando movimenti
   opposti di nazioni diverse). */
async function paintPlaystyleDelta(delta, base) {
  if (!delta || (!delta.war && !delta.eco)) return; // niente da dire se non si è mosso niente
  const { playstyleSwitch } = await import('../mu/playstyle.js');
  const deltaEl = document.getElementById('wp-panel-ps-delta');
  if (!deltaEl) return;
  // Il colore dice DI COSA si parla (rosso guerra, verde economia, come i
  // segmenti della barra sopra), il segno dice se sale o scende. Colorare
  // per direzione farebbe uscire "+5 economia" in rosso.
  const chip = (n, group, key) => {
    if (!n) return '';
    return `<span class="wp-panel-ps-delta-chip wp-panel-ps-chip-${group}">${n > 0 ? '+' : '−'}${Math.abs(n)} ${t(key)}</span>`;
  };
  // Il travaso netto sta PRIMA dei due totali: è la lettura vera del
  // movimento ("due sono passati alla guerra"), i totali sono il dettaglio.
  const sw = playstyleSwitch(delta, base);
  const swChip = sw
    ? `<span class="wp-panel-ps-delta-chip wp-panel-ps-chip-switch wp-panel-ps-chip-${sw.to}">⇄ ${sw.n} ${t('ps_switched_to')} ${t(sw.to === 'war' ? 'ps_war' : 'ps_eco')}${sw.pct != null ? ` · ${formatSwitchPct(sw.pct)}%` : ''}</span>`
    : '';
  deltaEl.innerHTML = `
    <div class="wp-panel-ps-delta">
      <span class="wp-panel-ps-delta-label">${t('playstyle_delta_24h')}</span>
      ${swChip}${chip(delta.war, 'war', 'ps_war')}${chip(delta.eco, 'eco', 'ps_eco')}
    </div>`;
}

/** Una cifra decimale finché la percentuale è sotto il 10%: su campioni da
 *  qualche centinaio di persone due passaggi valgono 0,5%, e arrotondare a
 *  "0%" cancellerebbe proprio il fatto che si vuole raccontare. */
function formatSwitchPct(pct) {
  return pct < 10 ? pct.toFixed(1) : Math.round(pct).toString();
}

/* ══════════════════════════════════════════════════════════════
   PANNELLO SFERA D'INFLUENZA (WarEra+)
   ------------------------------------------------------------------
   In modalità 'sphere' la mappa colorava i proxy col colore della loro
   potenza di riferimento, ma chi fossero — e quanto pesassero messi
   insieme — non si leggeva da nessuna parte: bisognava passare il mouse
   nazione per nazione. Qui la sfera si apre come già fanno nazione e
   blocco, nello STESSO pannello a scomparsa da destra (uno sostituisce
   l'altro in contentEl: non sono mai aperti insieme).

   Struttura: la potenza in testa, il totale della sfera subito sotto
   (somma di primaria + proxy, che è la ragione per cui si guarda una
   sfera), poi i proxy uno per riga con i loro numeri. Ogni riga proxy è
   cliccabile e apre il pannello di quella nazione.

   Dati: solo `state` (sphereInfo/sphereMap li ha già riempiti
   src/diplomacy/sphereOfInfluence.js dal CSV) — zero fetch.
   ══════════════════════════════════════════════════════════════ */
let currentSphereId = null;
let sphereOverviewOpen = false;   // il riepilogo di TUTTE le sfere è quello aperto

function sphereStats(nation) {
  return {
    pop: nation?.rankings?.countryActivePopulation?.value || 0,
    wealth: nation?.rankings?.countryWealth?.value ?? nation?.money ?? 0,
    dmg: nation?.rankings?.weeklyCountryDamages?.value || 0,
    wars: nation?.warsWith?.length || 0,
  };
}

/** La sfera a cui appartiene una nazione: se stessa se è una potenza,
 *  altrimenti la potenza di cui è proxy. null se sta fuori da ogni sfera. */
export function getSphereOf(nationId) {
  if (state.spherePrimaries.has(nationId)) return nationId;
  return state.sphereMap.get(nationId) || null;
}

function buildSpherePanelHtml(primaryId) {
  const info = state.sphereInfo.find(s => s.primaryId === primaryId);
  const primary = state.nationMap.get(primaryId);
  if (!info || !primary) return `<div class="wp-panel-empty">Sphere not found.</div>`;

  const color = state.nationBaseColorMap.get(primaryId) || '#888888';
  const proxies = info.proxyIds
    .map(id => state.nationMap.get(id))
    .filter(Boolean)
    .sort((a, b) => sphereStats(b).pop - sphereStats(a).pop);

  // Il totale include la potenza: la domanda su una sfera è quanto pesa
  // tutta insieme, non quanto pesano i satelliti da soli. Il peso dei soli
  // proxy si legge comunque per differenza dalla riga della primaria.
  const all = [primary, ...proxies];
  const tot = all.reduce((s, n) => {
    const x = sphereStats(n);
    return { pop: s.pop + x.pop, wealth: s.wealth + x.wealth, dmg: s.dmg + x.dmg, wars: s.wars + x.wars };
  }, { pop: 0, wealth: 0, dmg: 0, wars: 0 });
  const dmgPerPlayer = tot.pop > 0 ? tot.dmg / tot.pop : 0;

  const primaryCode = getNationCode(primaryId, primary);
  const primaryFlag = getFlagUrl(primaryCode);
  const p = sphereStats(primary);

  const row = (nation, isPrimary) => {
    const s = sphereStats(nation);
    const code = getNationCode(nation._id, nation);
    const flag = getFlagUrl(code);
    // Quota di danno settimanale sulla sfera: dice se la potenza fa tutto
    // da sola o se i proxy contano davvero.
    const share = tot.dmg > 0 ? (s.dmg / tot.dmg) * 100 : 0;
    return `
      <div class="wp-sphere-row${isPrimary ? ' primary' : ''}" data-sphere-nation="${nation._id}">
        <div class="wp-sphere-row-head">
          ${flag ? `<img class="wp-sphere-flag" src="${flag}" alt="" onerror="this.style.display='none'">` : ''}
          <span class="wp-sphere-name">${escapeHtml(nation.name)}</span>
          <span class="wp-sphere-share">${share.toFixed(0)}%</span>
        </div>
        <div class="wp-sphere-row-stats">
          <span>👥 ${fmt(s.pop)}</span>
          <span>💥 ${fmt(s.dmg)}</span>
          <span>💰 ${fmt(s.wealth)}</span>
          <span>⚔ ${s.wars}</span>
        </div>
      </div>`;
  };

  return `
    <button class="wp-sphere-back" id="wp-sphere-back">← ${t('sphere_all_label')}</button>

    <div class="wp-panel-header">
      ${primaryFlag ? `<img class="wp-panel-flag" src="${primaryFlag}" alt="" onerror="this.style.display='none'">` : ''}
      <div>
        <div class="wp-panel-name">${escapeHtml(primary.name)}</div>
        <span class="wp-panel-bloc" style="background:${color}22;color:${color}">${t('sphere_proxies_label')} · ${proxies.length}</span>
      </div>
      ${pinStarHtml('nation', primaryId)}
    </div>

    <div id="wp-panel-sphere-playstyle"></div>

    <div class="wp-panel-section-title">${t('sphere_total_label')} <span class="wp-panel-ps-count">${all.length}</span></div>
    <div class="wp-panel-grid">
      <div class="wp-stat"><div class="wp-stat-label">${t('population_label')}</div><div class="wp-stat-value">${fmt(tot.pop)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('wealth_label')}</div><div class="wp-stat-value">${fmt(tot.wealth)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('weekly_damage_label')}</div><div class="wp-stat-value">${fmt(tot.dmg)}</div></div>
      ${citizensStatHtml()}
      ${dailyDamageStatHtml()}
      <div class="wp-stat"><div class="wp-stat-label">${t('damage_per_player_label')}</div><div class="wp-stat-value">${dmgPerPlayer >= 1000 ? fmt(dmgPerPlayer) : dmgPerPlayer.toFixed(1)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('active_wars_label')}</div><div class="wp-stat-value">${tot.wars}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('sphere_primary_share_label')}</div><div class="wp-stat-value">${tot.dmg > 0 ? Math.round((p.dmg / tot.dmg) * 100) : 0}%</div></div>
    </div>

    <div class="wp-panel-section-title">${t('sphere_primary_label')}</div>
    ${row(primary, true)}

    <div class="wp-panel-section-title">${t('sphere_proxies_label')} <span class="wp-panel-ps-count">${proxies.length}</span></div>
    ${proxies.length
      ? proxies.map(n => row(n, false)).join('')
      : `<div class="wp-panel-row"><span style="color:#8b949e;">—</span></div>`}
  `;
}

function renderSpherePanel(primaryId) {
  if (!state.sphereInfo.some(s => s.primaryId === primaryId)) return;
  currentSphereId = primaryId;
  currentNationId = null;
  currentBlocId = null;
  sphereOverviewOpen = false;
  contentEl.innerHTML = buildSpherePanelHtml(primaryId);
  // Su mobile il pannello resta chiuso dietro alla linguetta: la mappa
  // colorata per sfere è proprio quello che si sta guardando.
  if (isMobileView() && !panelEl.classList.contains('open')) {
    showPanelPeek(state.nationMap.get(primaryId)?.name || t('sphere_all_label'));
  } else {
    openPanelNow();
  }
  wirePinStar();

  // Ogni riga apre il pannello della SINGOLA nazione: è il livello di
  // dettaglio sotto la sfera (parlamento, alleanze, guerre della nazione).
  // Per tornare indietro c'è il click sulla mappa, che in questa modalità
  // riapre la sfera.
  contentEl.querySelectorAll('[data-sphere-nation]').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.sphereNation;
      trackEvent('sphere-proxy-click', { via: 'panel' });
      selectNationInPanel(id);
    });
  });

  const backBtn = document.getElementById('wp-sphere-back');
  if (backBtn) backBtn.addEventListener('click', () => renderSphereOverviewPanel());

  renderSpherePlaystyle(primaryId);
  const info = state.sphereInfo.find(s => s.primaryId === primaryId);
  const sphereNations = [primaryId, ...(info?.proxyIds || [])].map(id => state.nationMap.get(id)).filter(Boolean);
  paintDailyDamage(sphereNations, () => currentSphereId === primaryId);
  paintCitizens(sphereNations.map(n => n._id), () => currentSphereId === primaryId);
}

/* ── Riepilogo di TUTTE le sfere (WarEra+) ──
   È il primo livello della modalità: si apre da solo appena si entra in
   vista Sphere (vedi setColoringMode in src/diplomacy/map.js), perché la
   domanda iniziale non è "com'è fatta la sfera russa" ma "quali sfere ci
   sono". Ogni sfera è un blocco: la potenza in evidenza con i suoi numeri
   aggregati, sotto i proxy in piccolo — cliccando qualunque nazione si
   scende al pannello di quella sfera.

   Le sfere sono ordinate per danno settimanale totale: è il criterio che
   mette in cima quelle che contano davvero nella guerra in corso. */
/* Profilo WarEra dell'autore, lo stesso di #wp-author-pill in index.html:
   nel disclaimer serve a dire chi ha raccolto i dati, e a chi scrivere se
   una sfera è sbagliata o vecchia. La traduzione contiene {author}: il nome
   è l'unico pezzo di markup, il resto resta testo tradotto. */
const AUTHOR_PROFILE_URL = 'https://app.warera.io/user/69d2ed249f38d300d59a2af1';
const AUTHOR_NAME = 'frappa10';

function sphereDisclaimerHtml() {
  const link = `<a href="${AUTHOR_PROFILE_URL}" target="_blank" rel="noopener" class="wp-sphere-author">${AUTHOR_NAME}</a>`;
  // Chiamata SENZA variabili: così il segnaposto {author} sopravvive
  // all'escape (il testo tradotto va trattato come testo, non come markup)
  // e solo dopo diventa il link.
  return escapeHtml(t('sphere_disclaimer')).replace('{author}', link);
}

function buildSphereOverviewHtml() {
  if (!state.sphereInfo.length) {
    return `<div class="wp-panel-empty">${t('sphere_none')}</div>`;
  }

  const spheres = state.sphereInfo.map(info => {
    const primary = state.nationMap.get(info.primaryId);
    const proxies = info.proxyIds.map(id => state.nationMap.get(id)).filter(Boolean);
    const tot = [primary, ...proxies].filter(Boolean).reduce((s, n) => {
      const x = sphereStats(n);
      return { pop: s.pop + x.pop, dmg: s.dmg + x.dmg };
    }, { pop: 0, dmg: 0 });
    return { info, primary, proxies, tot };
  }).filter(s => s.primary).sort((a, b) => b.tot.dmg - a.tot.dmg);

  const chip = (nation) => {
    const code = getNationCode(nation._id, nation);
    const flag = getFlagUrl(code);
    return `
      <button class="wp-sphere-chip" data-sphere-open="${nation._id}" title="${escapeHtml(nation.name)}">
        ${flag ? `<img class="wp-sphere-chip-flag" src="${flag}" alt="" onerror="this.style.display='none'">` : ''}
        <span>${escapeHtml(nation.name)}</span>
      </button>`;
  };

  return `
    <div class="wp-panel-header">
      <div>
        <div class="wp-panel-name">${t('sphere_all_label')}</div>
        <span class="wp-panel-bloc" style="background:#58a6ff22;color:#58a6ff">${spheres.length}</span>
      </div>
    </div>
    <div class="wp-panel-hint">${t('sphere_overview_hint')}</div>
    <div class="wp-sphere-disclaimer">⚠️ ${sphereDisclaimerHtml()}</div>

    ${spheres.map(({ info, primary, proxies, tot }) => {
      const color = state.nationBaseColorMap.get(info.primaryId) || '#888888';
      const code = getNationCode(primary._id, primary);
      const flag = getFlagUrl(code);
      // Cliccabile TUTTO il riquadro, non solo i nomi: il bersaglio grosso è
      // quello che si tenta per primo. Le pastiglie dei proxy restano
      // cliccabili per conto loro (stessa destinazione, vedi getSphereOf).
      return `
      <div class="wp-sphere-group" style="border-left-color:${color}" data-sphere-open="${primary._id}">
        <div class="wp-sphere-group-head">
          ${flag ? `<img class="wp-sphere-flag" src="${flag}" alt="" onerror="this.style.display='none'">` : ''}
          <span class="wp-sphere-name">${escapeHtml(primary.name)}</span>
          <span class="wp-sphere-share">${proxies.length}</span>
        </div>
        <div class="wp-sphere-row-stats">
          <span>👥 ${fmt(tot.pop)}</span>
          <span>💥 ${fmt(tot.dmg)}</span>
        </div>
        <div class="wp-sphere-chips">${proxies.map(chip).join('')}</div>
      </div>`;
    }).join('')}
  `;
}

export function renderSphereOverviewPanel() {
  if (!contentEl) return;
  currentSphereId = null;
  currentNationId = null;
  currentBlocId = null;
  sphereOverviewOpen = true;
  contentEl.innerHTML = buildSphereOverviewHtml();
  if (isMobileView() && !panelEl.classList.contains('open')) {
    showPanelPeek(t('sphere_all_label'));
  } else {
    openPanelNow();
  }

  contentEl.querySelectorAll('[data-sphere-open]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      const sphereId = getSphereOf(el.dataset.sphereOpen);
      if (sphereId) {
        trackEvent('sphere-click', { via: 'overview' });
        renderSpherePanel(sphereId);
      }
    });
  });
}

export function isSphereOverviewOpen() {
  return sphereOverviewOpen;
}

/** Stile di gioco dell'intera sfera: stessa lettura del pannello alleanza
 *  (vedi renderBlocPlaystyle), sommata su potenza + proxy. */
async function renderSpherePlaystyle(primaryId) {
  const host = document.getElementById('wp-panel-sphere-playstyle');
  const info = state.sphereInfo.find(s => s.primaryId === primaryId);
  if (!host || !info) return;
  const memberIds = [primaryId, ...info.proxyIds];

  const { fetchPlaystyleByCountry, fetchPlaystyleHistoryMany } = await import('../mu/api.js');
  const { sumPlaystyleCounts, sumPlaystyleDeltas } = await import('../mu/playstyle.js');
  const byCountry = await fetchPlaystyleByCountry();
  if (!byCountry || currentSphereId !== primaryId) return;

  const counts = sumPlaystyleCounts(memberIds.map(id => byCountry[id]));
  if (!counts.known) return;
  await paintPlaystyle(host, counts, t('playstyle_bloc_note', { n: counts.countries, m: memberIds.length }));

  const seriesByCountry = await fetchPlaystyleHistoryMany(memberIds, Date.now() - PLAYSTYLE_DELTA_WINDOW_MS);
  if (currentSphereId !== primaryId) return;
  paintPlaystyleDelta(sumPlaystyleDeltas(seriesByCountry), counts.known);
}

/** Chiamata da map.js in modalità 'sphere'. `primaryId` null chiude. */
export function selectSphereInPanel(primaryId) {
  if (primaryId) renderSpherePanel(primaryId);
  else closePanel();
}

export function getCurrentSphereId() {
  return currentSphereId;
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
  const totalRegionDiff = blocRegionDiff(members);
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

    <div id="wp-panel-bloc-playstyle"></div>

    <div class="wp-panel-grid">
      <div class="wp-stat"><div class="wp-stat-label">${t('population_label')}</div><div class="wp-stat-value">${fmt(totalPop)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('wealth_label')}</div><div class="wp-stat-value">${fmt(totalWealth)}</div></div>
      <div class="wp-stat"><div class="wp-stat-label">${t('weekly_damage_label')}</div><div class="wp-stat-value">${fmt(totalWeeklyDamage)}</div></div>
      ${citizensStatHtml()}
      ${dailyDamageStatHtml()}
      <div class="wp-stat"><div class="wp-stat-label">${t('damage_per_player_label')}</div><div class="wp-stat-value">${damagePerPlayer >= 1000 ? fmt(damagePerPlayer) : damagePerPlayer.toFixed(1)}</div></div>
      ${regionDiffStatHtml(totalRegionDiff)}
      ${allianceBonusStatHtml(members)}
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
  currentSphereId = null;
  sphereOverviewOpen = false;
  contentEl.innerHTML = buildBlocPanelHtml(allianceId);
  hidePanelPeek();
  openPanelNow();
  wirePinStar();

  // Stesso ordine (popolazione decrescente) usato per costruire l'HTML
  // in buildBlocPanelHtml, così il primo gruppo caricato è anche quello
  // mostrato per primo nella lista.
  const members = getBlocMemberIds(allianceId)
    .map(id => state.nationMap.get(id))
    .filter(Boolean)
    .sort((a, b) => (b?.rankings?.countryActivePopulation?.value || 0) - (a?.rankings?.countryActivePopulation?.value || 0));

  renderBlocPlaystyle(allianceId, members.map(m => m._id));
  paintDailyDamage(members, () => currentBlocId === allianceId);
  paintCitizens(members.map(m => m._id), () => currentBlocId === allianceId);
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
  hidePanelPeek();
  panelEl.classList.remove('open');
  panelEl.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('wp-panel-open');
  currentNationId = null;
  currentBlocId = null;
  currentSphereId = null;
  sphereOverviewOpen = false;
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
  ensureBackBar();
  initPanelResize();

  // Ri-renderizza il pannello (stringhe tradotte) se la lingua cambia
  // mentre una nazione o un blocco è già selezionato.
  window.addEventListener('wareraplus:langchange', () => {
    if (currentNationId) render(currentNationId);
    else if (currentBlocId) renderBlocPanel(currentBlocId);
    else if (currentSphereId) renderSpherePanel(currentSphereId);
    else if (sphereOverviewOpen) renderSphereOverviewPanel();
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
