/* ══════════════════════════════════════════════════════════════
   WarEra+ — Battaglie (archivio + spese di guerra)
   ------------------------------------------------------------------
   Una voce sola in Approfondimenti, due schede, perché i due dati
   vengono dalla stessa fonte e si guardano insieme: dalla classifica
   delle spese si clicca una nazione e si finisce sulle sue battaglie.

   ── COSA RISPONDE ──────────────────────────────────────────────────
   · Archivio: com'è finita quella battaglia, quanto danno ha fatto ogni
     lato, quanto è costata di taglia e di contratti mercenari.
   · Spese di guerra: quanto spende al giorno ogni nazione, sommando le
     due voci.

   ── ⚠️ IL NUMERO CHE SEMBRA GIUSTO E NON LO È ──────────────────────
   `rankings.countryBounty` (già in state.nazioniGlobal, gratis) NON è
   la spesa di una nazione: correla 0,87 col danno e 0,11 con la
   ricchezza — è quanto i suoi CITTADINI hanno incassato. Qui si mostra
   la spesa vera, ricostruita battaglia per battaglia dal server
   (server/battleArchive.js). Se un giorno qualcuno propone di
   "semplificare" usando countryBounty, la risposta è no, ed è scritta
   anche in testa a quel file.

   ── STRUTTURA ──────────────────────────────────────────────────────
   Questo file: montaggio, schede, stato condiviso, ritraduzione a
   overlay aperto. Il disegno delle due schede sta in battleList.js e
   warExpenses.js, che non si conoscono fra loro.
   ══════════════════════════════════════════════════════════════ */

import '../styles/battles.css';
import { btlT } from './i18n.js';
import { getBattleArchive, getWarExpenses, getLiveBattles } from './api.js';
import { renderBattleList, wireBattleList } from './battleList.js';
import { renderBattleDetail, wireBattleDetail, loadBattleDetail, resetBattleDetail } from './battleDetail.js';
import { renderWarExpenses, wireWarExpenses } from './warExpenses.js';
import { trackEvent } from '../shared/analytics.js';

let _container = null;
let _tab = 'archive';       // 'archive' | 'expenses'
let _archive = null;
let _expenses = null;
// Nazione scelta nella scheda spese: la si passa all'archivio quando si
// salta da una scheda all'altra, così il "vedi le sue battaglie" arriva
// con il filtro già impostato.
let _pendingCountryFilter = null;
let _langHandler = null;
// Battaglia aperta nel dettaglio (scomposizione per nazione). Null = elenco.
let _openBattle = null;

const TABS = [
  { id: 'archive', key: 'tabArchive' },
  { id: 'expenses', key: 'tabExpenses' },
];

function shellHtml() {
  return `
    <div class="wp-btl">
      <header class="wp-btl-head">
        <h1 class="wp-btl-title">${btlT('title')}</h1>
        <p class="wp-btl-sub">${btlT('subtitle')}</p>
      </header>
      <nav class="wp-btl-tabs" role="tablist">
        ${TABS.map(t => `
          <button type="button" role="tab" class="wp-btl-tab${_tab === t.id ? ' active' : ''}"
                  data-tab="${t.id}" aria-selected="${_tab === t.id}">${btlT(t.key)}</button>`).join('')}
      </nav>
      <div class="wp-btl-body" id="wp-btl-body">
        <div class="wp-btl-loading">${btlT('loading')}</div>
      </div>
    </div>`;
}

/** Disegna la scheda attiva. Le due schede ricevono i dati già pronti:
 *  non fanno fetch per conto loro, così cambiare scheda non ricompra
 *  nulla (api.js tiene comunque una cache di sessione). */
function paintBody() {
  const body = document.getElementById('wp-btl-body');
  if (!body) return;

  if (_tab === 'archive') {
    if (!_archive) { body.innerHTML = `<div class="wp-btl-loading">${btlT('loading')}</div>`; return; }

    // Dettaglio di una battaglia: sostituisce l'elenco, non ci si affianca
    // (sono due tabelle larghe, una sopra l'altra sarebbero illeggibili).
    if (_openBattle) {
      body.innerHTML = renderBattleDetail(_openBattle);
      wireBattleDetail(body, _openBattle, {
        onBack: () => { _openBattle = null; resetBattleDetail(); paintBody(); },
        repaint: () => paintBody(),
      });
      return;
    }

    body.innerHTML = renderBattleList(_archive, _pendingCountryFilter);
    wireBattleList(body, _archive, () => paintBody(), (battle) => {
      _openBattle = battle;
      // Si disegna subito il riepilogo (dati già in mano dall'elenco) e si
      // completa quando le classifiche atterrano: mai una schermata vuota.
      loadBattleDetail(battle, () => paintBody());
      trackEvent('battles-open-detail');
    });
    _pendingCountryFilter = null; // consumato: non deve riapplicarsi da solo
  } else {
    if (!_expenses) { body.innerHTML = `<div class="wp-btl-loading">${btlT('loading')}</div>`; return; }
    body.innerHTML = renderWarExpenses(_expenses);
    wireWarExpenses(body, _expenses, {
      onRepaint: () => paintBody(),
      // Salto fra schede: la scheda spese non sa nulla dell'archivio, si
      // limita a dire "questa nazione" e il coordinamento sta qui.
      onSeeBattles: (countryId) => {
        _pendingCountryFilter = countryId;
        _openBattle = null;
        resetBattleDetail();
        switchTab('archive');
        trackEvent('battles-jump-to-archive');
      },
    });
  }
}

function switchTab(id) {
  if (_tab === id) return;
  _tab = id;
  _container.querySelectorAll('.wp-btl-tab').forEach(b => {
    const on = b.dataset.tab === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });
  paintBody();
  ensureData();
  // Il giro delle battaglie in corso serve solo alla scheda archivio.
  if (id === 'archive') startLiveRefresh(); else stopBattlesAutoRefresh();
  trackEvent('battles-tab', { tab: id });
}

/** Carica solo quello che serve alla scheda aperta. La scheda spese e
 *  l'archivio hanno due sorgenti diverse: chi apre solo l'archivio non
 *  deve pagare anche la serie giornaliera. */
async function ensureData() {
  if (_tab === 'archive' && !_archive) {
    _archive = await getBattleArchive();
    // Le battaglie in corso si attaccano all'oggetto archivio invece di
    // essere un secondo stato parallelo: l'elenco le disegna come un
    // blocco in cima, e il resto della vista non deve sapere che sono
    // arrivate da un'altra chiamata.
    await refreshLive();
    if (_tab === 'archive') paintBody();
  } else if (_tab === 'archive') {
    // Archivio già in memoria (riapertura della vista): le concluse non si
    // muovono, le vive sì. getLiveBattles ha il suo TTL, quindi riaprire
    // dieci volte in un minuto resta una richiesta sola.
    await refreshLive();
    if (_tab === 'archive') paintBody();
  } else if (_tab === 'expenses' && !_expenses) {
    _expenses = await getWarExpenses();
    if (_tab === 'expenses') paintBody();
  }
}

/* ══════════════════════════════════════════════════════════════
   AGGIORNAMENTO DELLE BATTAGLIE IN CORSO
   ------------------------------------------------------------------
   Quattro minuti, non due come i marker della mappa: qui il dato si
   legge, non si sorveglia, e una tabella che si riscrive sotto il
   cursore mentre la stai leggendo è solo fastidiosa. Il giro parte solo
   quando la scheda archivio è davvero visibile e si ferma alla chiusura
   dell'overlay (stopBattlesAutoRefresh, chiamato da app/battlesOverlay.js
   come fa marketOverlay con le rendite) — un timer che continua a girare
   dietro una mappa è esattamente il consumo che questo progetto ha già
   dovuto togliere una volta.

   Si salta anche a scheda nascosta (document.hidden): a monitor spento
   nessuno la sta leggendo.
   ══════════════════════════════════════════════════════════════ */
const LIVE_REFRESH_MS = 4 * 60 * 1000;
let _liveTimer = null;

async function refreshLive({ force = false } = {}) {
  if (!_archive) return;
  const live = await getLiveBattles({ force });
  _archive.live = live;
  _archive.liveAt = Date.now();
}

function startLiveRefresh() {
  if (_liveTimer) return;
  _liveTimer = setInterval(async () => {
    if (_tab !== 'archive' || _openBattle || document.hidden) return;
    await refreshLive({ force: true });
    if (_tab === 'archive' && !_openBattle) paintBody();
  }, LIVE_REFRESH_MS);
}

/** Ferma il giro. Esportata perché la chiami la chiusura dell'overlay:
 *  la vista non sa da sola quando smette di essere guardata. */
export function stopBattlesAutoRefresh() {
  if (_liveTimer) { clearInterval(_liveTimer); _liveTimer = null; }
}

function wireShell() {
  _container.querySelectorAll('.wp-btl-tab').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });
}

/** Cambio lingua a overlay già aperto: stessa convenzione delle altre
 *  viste (evento su window, vedi src/app/langSync.js). Si ridisegna
 *  tutto dai dati già in memoria — nessuna fetch. */
function onLangChange() {
  if (!_container) return;
  _container.innerHTML = shellHtml();
  wireShell();
  paintBody();
}

export async function initBattlesView(container) {
  _container = container;
  container.innerHTML = shellHtml();
  wireShell();

  if (!_langHandler) {
    _langHandler = onLangChange;
    window.addEventListener('wareraplus:langchange', _langHandler);
  }

  await ensureData();
  if (_tab === 'archive') startLiveRefresh();
  trackEvent('battles-view-open');
}
