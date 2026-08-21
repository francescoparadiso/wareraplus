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
import { escapeHtml } from './ui.js';
import { trackEvent } from '../shared/analytics.js';

let rootEl = null;
let directory = null;
let tab = 'list';          // 'list' | 'ranking'
let pendingMuId = null;    // scheda da aprire appena la directory è pronta

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
  };
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
  if (pendingMuId) renderMuDetail(view, pendingMuId, ctx());
  else if (tab === 'ranking') renderMuRankings(view, ctx());
  else renderMuList(view, ctx());
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
