/* ══════════════════════════════════════════════════════════════
   WarEra+ — Guida "Come si usa"
   ------------------------------------------------------------------
   Vista NUOVA sotto "Approfondimenti": una scheda per ogni sezione
   dell'app, con i tre punti che servono davvero per capirla. Nasce da
   una richiesta esplicita dell'utente ("vorrei creare un how to use che
   spieghi un po' le varie sezioni").

   È la vista più leggera dell'app e deve restarlo: SOLO testo statico
   dal dizionario (src/guide/i18n.js), zero fetch, zero stato, zero
   dipendenze dalla mappa o dalle API. Per questo non ha bisogno di
   loading, errori o retry come le altre sezioni.

   Si ridisegna a 'wareraplus:langchange' come le altre viste, così il
   cambio lingua vale anche a overlay già aperto.
   ══════════════════════════════════════════════════════════════ */

import '../styles/guide.css';
import { getLang } from '../shared/i18n.js';
import { trackEvent } from '../shared/analytics.js';
import { GUIDE_DICT } from './i18n.js';

// Ordine delle schede = ordine in cui le sezioni compaiono nei menù
// (prima la mappa e il pannello, poi le voci di Approfondimenti, infine
// le impostazioni). L'icona è un pezzo di SVG a tratto, sullo stesso
// stile di quelle delle barre menù ma tenuto qui: la barra non le
// esporta e duplicare tre path costa meno di un modulo condiviso.
const SECTIONS = [
  ['map', '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>'],
  ['panel', '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>'],
  ['politics', '<polygon points="12 2 21 8 3 8 12 2"/><line x1="5" y1="10" x2="5" y2="18"/><line x1="10" y1="10" x2="10" y2="18"/><line x1="14" y1="10" x2="14" y2="18"/><line x1="19" y1="10" x2="19" y2="18"/><line x1="3" y1="21" x2="21" y2="21"/>'],
  ['nations', '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>'],
  ['alliances', '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>'],
  ['mu', '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>'],
  ['eco', '<path d="M2 20h20"/><path d="M3 20V9l6 4V9l6 4V6l6 3v11"/><line x1="7" y1="16" x2="7" y2="16.5"/><line x1="12" y1="16" x2="12" y2="16.5"/><line x1="17" y1="16" x2="17" y2="16.5"/>'],
  ['news', '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9h4"/><line x1="10" y1="6" x2="18" y2="6"/><line x1="10" y1="10" x2="18" y2="10"/><line x1="10" y1="14" x2="14" y2="14"/>'],
  ['timeMachine', '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>'],
  ['settings', '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'],
];

/** Testi della lingua attiva, con fallback all'inglese scheda per
 *  scheda: una chiave dimenticata in una traduzione mostra l'inglese
 *  invece di lasciare un buco. */
function texts() {
  const en = GUIDE_DICT.en;
  const cur = GUIDE_DICT[getLang()] || en;
  return {
    title: cur.title || en.title,
    intro: cur.intro || en.intro,
    tip: cur.tip || en.tip,
    section: key => (cur.sections?.[key] || en.sections[key]),
  };
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let _container = null;
let _langBound = false;

function render() {
  if (!_container) return;
  const T = texts();
  const cards = SECTIONS.map(([key, icon], i) => {
    const s = T.section(key);
    if (!s) return '';
    return `
      <article class="wp-guide-card" style="--wp-guide-i:${i}">
        <div class="wp-guide-card-head">
          <svg class="wp-guide-icon" viewBox="0 0 24 24" aria-hidden="true">${icon}</svg>
          <h3 class="wp-guide-card-title">${esc(s.t)}</h3>
        </div>
        <ul class="wp-guide-points">
          ${s.b.map(p => `<li>${esc(p)}</li>`).join('')}
        </ul>
      </article>`;
  }).join('');

  _container.innerHTML = `
    <div class="wp-guide">
      <header class="wp-guide-head">
        <h2 class="wp-guide-title">${esc(T.title)}</h2>
        <p class="wp-guide-intro">${esc(T.intro)}</p>
      </header>
      <div class="wp-guide-grid">${cards}</div>
      <p class="wp-guide-tip">${esc(T.tip)}</p>
    </div>`;
}

/**
 * Monta la guida dentro `container`. Idempotente: alle riaperture
 * ridisegna soltanto (costa una innerHTML di testo statico, non vale la
 * pena tenere in vita un albero DOM per una vista di sola lettura).
 */
export function initGuideView(container) {
  _container = container;
  render();
  if (!_langBound) {
    _langBound = true;
    window.addEventListener('wareraplus:langchange', render);
  }
  trackEvent('guide-view-render', { lang: getLang() });
}
