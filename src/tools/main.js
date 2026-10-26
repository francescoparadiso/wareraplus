/* ══════════════════════════════════════════════════════════════
   WarEra+ — Altri strumenti
   ------------------------------------------------------------------
   Vista NUOVA sotto "Approfondimenti", chiesta dall'utente: una scheda
   per ogni tool della community WarEra che vale la pena conoscere, con
   una riga su cosa fa e il link al sito. In testa un avviso: sono di
   terzi, non affiliati a WarEra+.

   Come la Guida, è solo testo statico: zero fetch, zero stato, niente
   loading o retry. L'elenco sta in src/tools/list.js (un array, una voce
   per sito), la cornice in src/tools/i18n.js.

   I link escono in una scheda nuova con rel="noopener noreferrer": la
   pagina aperta non riceve né window.opener né il Referer, quindi non
   sa da dove arriva chi ci clicca e non può toccare questa scheda.

   Si ridisegna a 'wareraplus:langchange' come le altre viste.
   ══════════════════════════════════════════════════════════════ */

import '../styles/tools.css';
import { getLang } from '../shared/i18n.js';
import { trackEvent } from '../shared/analytics.js';
import { TOOLS_DICT } from './i18n.js';
import { TOOLS } from './list.js';

// Freccia "esce dal sito": stesso tratto delle icone delle barre menù.
const EXTERNAL_ICON = '<path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>';

function tt(key) {
  return TOOLS_DICT[getLang()]?.[key] ?? TOOLS_DICT.en[key] ?? key;
}

/** Il dominio come lo si legge nella barra degli indirizzi, senza www. */
function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return url; }
}

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

let _container = null;
let _langBound = false;

function render() {
  if (!_container) return;
  const lang = getLang();
  const cards = TOOLS.map((tool, i) => {
    const desc = tool.desc?.[lang] || tool.desc?.en || '';
    const domain = domainOf(tool.url);
    return `
      <a class="wp-tools-card" style="--wp-tools-i:${i}" href="${esc(tool.url)}"
         target="_blank" rel="noopener noreferrer" data-tool="${esc(domain)}"
         aria-label="${esc(`${tool.name} — ${domain} (${tt('newTab')})`)}">
        <span class="wp-tools-card-name">${esc(tool.name)}</span>
        <span class="wp-tools-card-desc">${esc(desc)}</span>
        <span class="wp-tools-card-foot">
          <span class="wp-tools-domain">${esc(domain)}</span>
          <span class="wp-tools-open">${esc(tt('open'))}
            <svg class="wp-tools-icon" viewBox="0 0 24 24" aria-hidden="true">${EXTERNAL_ICON}</svg>
          </span>
        </span>
      </a>`;
  }).join('');

  _container.innerHTML = `
    <div class="wp-tools">
      <header class="wp-tools-head">
        <h2 class="wp-tools-title">${esc(tt('title'))}</h2>
        <p class="wp-tools-intro">${esc(tt('intro'))}</p>
      </header>
      <p class="wp-tools-notice" role="note">${esc(tt('notice'))}</p>
      <div class="wp-tools-grid">${cards}</div>
    </div>`;
}

/**
 * Monta la vista dentro `container`. Idempotente come la Guida: alle
 * riaperture ridisegna soltanto. Il clic sui link si ascolta una volta
 * sul contenitore, che resta lo stesso fra un render e l'altro.
 */
export function initToolsView(container) {
  if (_container !== container) {
    container.addEventListener('click', (e) => {
      const a = e.target.closest?.('.wp-tools-card');
      if (a) trackEvent('tools-link-click', { tool: a.dataset.tool });
    });
  }
  _container = container;
  render();
  if (!_langBound) {
    _langBound = true;
    window.addEventListener('wareraplus:langchange', render);
  }
}
