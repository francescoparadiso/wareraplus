/* ══════════════════════════════════════════════════════════════
   WarEra+ — Esplora Unità Militari: orchestratore
   ------------------------------------------------------------------
   Stesso ruolo che src/political/main.js ha per Political View e
   src/eco/main.js per l'Ottimizzatore: monta la vista dentro il div che
   l'overlay gli passa (#wp-mu-root), tiene le tre sotto-viste (elenco,
   classifiche, scheda) e decide quale è a schermo.

   Caricato via import() dinamico da src/app/muOverlay.js alla PRIMA
   apertura, quindi il suo chunk non pesa sul boot dell'app.

   `initMuView()` è idempotente: riaprire la vista NON riscarica la
   directory (sta in memoria in src/mu/api.js per tutta la sessione),
   ridisegna soltanto.
   ══════════════════════════════════════════════════════════════ */

import '../styles/mu.css';
import { directoryFetchedAt, fetchMuDirectory } from './api.js';
import { muT } from './i18n.js';
import { renderMuList } from './muList.js';
import { renderMuDetail } from './muDetail.js';
import { renderMuRankings } from './ranking.js';
import { renderMuCompare } from './muCompare.js';
import { escapeHtml } from './ui.js';
import { trackEvent } from '../shared/analytics.js';
import { haSessionePlus } from '../app/privateOverlay.js';
import { loadModule } from '../shared/lazyModule.js';
import { syncBack, updateBackParams } from '../app/backNav.js';

let rootEl = null;
let directory = null;
let tab = 'list';          // 'list' | 'ranking' | 'compare' | 'wealth'
let pendingMuId = null;    // scheda da aprire appena la directory è pronta
// Il confronto 1 vs 1 (muCompare.js): i due lati, le due ricerche e quale
// casella aveva il cursore. Resta fra un'apertura e l'altra della sezione.
const cmp = { a: null, b: null, qA: '', qB: '', focus: null };

// ── La linguetta riservata ────────────────────────────────────────────
// "Bilancio" compare SOLO a chi comanda in gioco un'unità italiana ed è
// entrato con Discord. Qui si tiene l'esito della domanda al server, non
// il permesso: quello lo ridà il server ad ogni chiamata (vedi
// server/plusApi/wealth.js). Una linguetta nascosta non è un permesso
// negato — è solo un menù che non mente su cosa si può aprire.
//
// Chi non ha nemmeno una sessione non fa partire NESSUNA richiesta: la
// vista unità è pubblica e si apre migliaia di volte, e un giro di rete
// per ogni apertura sarebbe un costo pagato da tutti per una linguetta
// che quasi nessuno ha.
let bilancio = null;       // { unita, ... } o null
let bilancioChiesto = false;
let renderMuWealth = null; // caricato con import() alla prima apertura

export async function initMuView(container) {
  rootEl = container;
  bindLangChange();

  if (!directory) {
    rootEl.innerHTML = `<div class="wp-mu-page"><div class="wp-mu-empty">${escapeHtml(muT('loading'))}</div></div>`;
    try {
      directory = await fetchMuDirectory();
    } catch (err) {
      console.warn('WarEra+ mu: directory non disponibile', err);
      rootEl.innerHTML = `
        <div class="wp-mu-page">
          <div class="wp-mu-empty">
            ${escapeHtml(muT('error'))}
            <button type="button" class="wp-mu-more" id="wp-mu-retry">${escapeHtml(muT('retry'))}</button>
          </div>
        </div>`;
      rootEl.querySelector('#wp-mu-retry')?.addEventListener('click', () => initMuView(container));
      return;
    }
    trackEvent('mu-directory-loaded', { count: directory.length });
  }

  render();
  // Dopo il primo disegno, non prima: la linguetta in più non deve
  // ritardare di un millisecondo l'elenco che tutti vengono a vedere.
  chiediBilancio();
}

/** Chiede al server se questo account ha diritto alla linguetta.
 *  Fallisce in silenzio: se il server dell'area riservata è giù, la vista
 *  unità resta esattamente com'era per tutti. */
async function chiediBilancio() {
  if (bilancioChiesto || !haSessionePlus()) return;
  bilancioChiesto = true;
  try {
    const { fetchUnitaBilancio } = await import('./wealthApi.js');
    const risposta = await fetchUnitaBilancio();
    if (!risposta?.unita?.length) return;
    bilancio = risposta;
    render();
  } catch (err) {
    console.warn('WarEra+ mu: bilancio non disponibile', err);
  }
}

/** Apre direttamente la scheda di un'unità (preferiti, ricerca globale).
 *  Se la vista non ha ancora la directory, la scheda viene ricordata e
 *  aperta appena arriva. */
export function openMuDetail(muId) {
  pendingMuId = muId;
  if (rootEl && directory) render();
}

function ctx() {
  return {
    directory,
    onOpenMu: (muId) => { pendingMuId = muId; render(); },
    onBack: () => { pendingMuId = null; render(); },
    // "Confronta" dalla scheda di un'unità: se A è già un'ALTRA unità e B è
    // libero va in B (si è aperta una, poi l'altra: "questa contro quella"),
    // altrimenti in A.
    onCompare: (muId) => {
      if (cmp.a && cmp.a !== muId && !cmp.b) cmp.b = muId;
      else { cmp.a = muId; if (cmp.b === muId) cmp.b = null; }
      tab = 'compare';
      pendingMuId = null;
      trackEvent('mu-compare-from-detail');
      render();
    },
  };
}

function compareCtx() {
  return {
    directory,
    cmp,
    onPick: (side, muId) => {
      const other = side === 'a' ? 'b' : 'a';
      if (cmp[other] === muId) cmp[other] = null;   // dall'altro lato si SPOSTA
      cmp[side] = cmp[side] === muId ? null : muId; // ricliccata = via
      cmp.focus = null;
      if (cmp.a && cmp.b) trackEvent('mu-compare', { a: cmp.a, b: cmp.b });
      render();
    },
    onClear: (side) => { cmp[side] = null; cmp.focus = null; render(); },
    onSwap: () => { [cmp.a, cmp.b] = [cmp.b, cmp.a]; [cmp.qA, cmp.qB] = [cmp.qB, cmp.qA]; cmp.focus = null; render(); },
    onSearch: (side, q) => { cmp[side === 'a' ? 'qA' : 'qB'] = q; cmp.focus = side; render(); },
    onOpenMu: (muId) => { pendingMuId = muId; cmp.focus = null; render(); },
  };
}

/** Link condivisibile (?section=mu&tab=compare&mua=&mub=) e scorciatoie:
 *  scheda e lati da impostare PRIMA di initMuView (vedi src/main.js). */
export function presetMuView({ tab: t, a, b } = {}) {
  if (['list', 'ranking', 'compare'].includes(t)) tab = t;
  if (a) cmp.a = a;
  if (b && b !== a) cmp.b = b;
  if (a || b) tab = 'compare';
}

function render() {
  if (!rootEl || !directory) return;

  const fetchedAt = directoryFetchedAt();
  const stamp = fetchedAt
    ? `${muT('updated')} ${new Date(fetchedAt).toLocaleTimeString(document.documentElement.lang || undefined, { hour: '2-digit', minute: '2-digit' })}`
    : '';

  rootEl.innerHTML = `
    <div class="wp-mu-page">
      <header class="wp-mu-masthead">
        <h1 class="wp-mu-title">${escapeHtml(muT('title'))}</h1>
        <div class="wp-mu-subtitle">${directory.length} ${escapeHtml(muT('subtitle'))}${stamp ? ` · ${escapeHtml(stamp)}` : ''}</div>
      </header>
      <nav class="wp-mu-tabs">
        <button type="button" class="wp-mu-tab${tab === 'list' ? ' active' : ''}" data-tab="list">${escapeHtml(muT('tabList'))}</button>
        <button type="button" class="wp-mu-tab${tab === 'ranking' ? ' active' : ''}" data-tab="ranking">${escapeHtml(muT('tabRanking'))}</button>
        <button type="button" class="wp-mu-tab${tab === 'compare' ? ' active' : ''}" data-tab="compare">⚔ ${escapeHtml(muT('tabCompare'))}</button>
        ${bilancio ? `<button type="button" class="wp-mu-tab wp-mu-tab-riservata${tab === 'wealth' ? ' active' : ''}" data-tab="wealth">🔒 ${escapeHtml(muT('tabWealth'))}</button>` : ''}
      </nav>
      <div id="wp-mu-view"></div>
    </div>`;

  rootEl.querySelectorAll('.wp-mu-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      tab = btn.dataset.tab;
      pendingMuId = null; // cambiare scheda torna alla vista d'elenco/classifica
      render();
    });
  });

  const view = rootEl.querySelector('#wp-mu-view');
  // WarEra+: con la scheda di un'unità aperta, Indietro torna all'elenco
  // invece di chiudere la sezione (vedi app/backNav.js).
  syncBack('mu/detail', !!pendingMuId, () => { pendingMuId = null; render(); }, () => !!pendingMuId,
    { mu: pendingMuId });
  // Nel link: la linguetta (se non è l'elenco) e i due lati del confronto.
  updateBackParams('mu', {
    tab: tab !== 'list' && tab !== 'wealth' ? tab : undefined,
    mua: tab === 'compare' ? cmp.a || undefined : undefined,
    mub: tab === 'compare' ? cmp.b || undefined : undefined,
  });
  if (pendingMuId) renderMuDetail(view, pendingMuId, ctx());
  else if (tab === 'wealth' && bilancio) mostraBilancio(view);
  else if (tab === 'ranking') renderMuRankings(view, ctx());
  else if (tab === 'compare') renderMuCompare(view, compareCtx());
  else renderMuList(view, ctx());
}

/** Il modulo del bilancio arriva con import() alla prima apertura della
 *  linguetta: chi non la apre non ne scarica un byte, come per le viste
 *  degli overlay. */
function mostraBilancio(view) {
  if (renderMuWealth) { renderMuWealth(view, bilancio.unita); return; }
  view.innerHTML = `<div class="wp-mu-empty">${escapeHtml(muT('wLoading'))}</div>`;
  // loadModule e non un import() nudo: in produzione un chunk può sparire
  // dopo un deploy, e la rete di sicurezza di shared/lazyModule.js è la
  // stessa che usano gli overlay.
  loadModule(() => import('./muWealth.js'), 'mu-wealth')
    .then((mod) => {
      renderMuWealth = mod.renderMuWealth;
      // Nel frattempo l'utente può aver cambiato linguetta: si ridisegna
      // solo se sta ancora guardando questa.
      if (tab === 'wealth' && !pendingMuId) renderMuWealth(view, bilancio.unita);
    })
    .catch((err) => {
      console.warn('WarEra+ mu: modulo bilancio non caricato', err);
      view.innerHTML = `<div class="wp-mu-empty">${escapeHtml(muT('wError'))}</div>`;
    });
}

// Cambio lingua: ridisegna con le etichette nuove. I dati non si toccano
// (sono numeri e nomi propri) — nessuna chiamata di rete, stesso
// ragionamento di src/app/newsView.js:bindLangChange.
let langBound = false;
function bindLangChange() {
  if (langBound) return; // una sola volta: initMuView gira ad ogni apertura
  langBound = true;
  window.addEventListener('wareraplus:langchange', () => { if (rootEl && directory) render(); });
}
