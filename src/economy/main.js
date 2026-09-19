/* ══════════════════════════════════════════════════════════════
   WarEra+ — Economia: una voce, tre schede
   ------------------------------------------------------------------
   Prima erano due voci separate in Approfondimenti — "Ottimizzatore
   industriale" e "Rendite di produzione" — e la terza cosa, i prezzi,
   non esisteva se non come riquadro dentro una riga di tabella.

   Erano separate per come sono NATE, non per come si usano:
   l'Ottimizzatore è il port di un bot Discord di terzi (ArgusIA), le
   Rendite sono nate dopo per chi un'azienda non ce l'ha ancora. Ma le
   tre domande sono un discorso solo, e nell'ordine in cui si fanno:

     1. Prezzi          — quanto vale la roba, e come si sta muovendo
     2. Rendite         — cosa conviene produrre, dove, e quanto resta
                          dopo le tasse e la paga degli operai
     3. Ottimizzatore   — la MIA azienda: competenze, posizione,
                          lavoratori, assunzioni

   Chi arrivava dall'una all'altra doveva tornare alla mappa e riaprire
   un'altra voce, perdendo quello che aveva impostato.

   ── COME SONO MESSE INSIEME ────────────────────────────────────────
   Per affiancamento, non per fusione: `src/market/*` e `src/eco/*` non
   sono stati toccati dentro. Ogni scheda ha il SUO contenitore, ci si
   monta la vista di prima con la sua `init*(container)`, e cambiare
   scheda nasconde invece di smontare — così tornare sulle Rendite
   ritrova la paga, i giorni e la riga aperta esattamente com'erano.

   Il costo di questa scelta è che i tre dizionari restano tre
   (`economy/i18n.js` per lo scheletro e i Prezzi, `market/i18n.js` per
   le Rendite, i testi interni di `eco/main.js` per l'Ottimizzatore).
   È voluto: unificarli sarebbe un diff enorme dentro codice che
   funziona, e la regola del repo è che le etichette di una vista sola
   stanno in un dizionario di quella vista.

   ── ⚠️ L'ATTRIBUZIONE AD ARGUSIA NON SI TOCCA ──────────────────────
   L'Ottimizzatore è il lavoro di qualcun altro, portato qui con la sua
   card di attribuzione in cima. Sta dentro `src/eco/main.js` e finisce
   dentro la scheda insieme al resto: metterla in ombra perché "ora è
   una scheda di una sezione più grande" non è una scelta grafica.

   ── CARICAMENTO ────────────────────────────────────────────────────
   Una scheda mai aperta non carica niente: `import()` alla prima
   apertura di ognuna, così chi entra per guardare i prezzi non si
   scarica anche l'Ottimizzatore. La sezione parte dai Prezzi.
   ══════════════════════════════════════════════════════════════ */

import '../styles/economy.css';
import { escapeHtml } from '../mu/ui.js';
import { ecoT } from './i18n.js';
import { loadModule } from '../shared/lazyModule.js';
import { trackEvent } from '../shared/analytics.js';

const TABS = [
  { id: 'prices', key: 'tabPrices' },
  { id: 'yields', key: 'tabYields' },
  { id: 'optimizer', key: 'tabOptimizer' },
];

let _container = null;
let _tab = 'prices';
let _langHandler = null;
// Cosa è già stato montato, e cosa sa fare. `stop` è opzionale: solo le
// schede con un timer ne hanno uno.
const _montate = new Map();   // id → { stop?, retranslate? }

function shellHtml() {
  return `
    <div class="wp-ecn-sec">
      <header class="wp-ecn-sechead">
        <h1 class="wp-ecn-sectitle">${escapeHtml(ecoT('title'))}</h1>
        <p class="wp-ecn-secsub">${escapeHtml(ecoT('subtitle'))}</p>
      </header>
      <nav class="wp-ecn-tabs" role="tablist">
        ${TABS.map(t => `
          <button type="button" role="tab" class="wp-ecn-tab${_tab === t.id ? ' active' : ''}"
                  data-tab="${t.id}" aria-selected="${_tab === t.id}">${escapeHtml(ecoT(t.key))}</button>`).join('')}
      </nav>
      <div class="wp-ecn-panels">
        ${TABS.map(t => `<div class="wp-ecn-panel" id="wp-ecn-panel-${t.id}" role="tabpanel"
                              style="display:${_tab === t.id ? 'block' : 'none'}"></div>`).join('')}
      </div>
    </div>`;
}

/** Mostra la scheda, montandola se è la prima volta. Le altre si
 *  nascondono e basta: smontarle butterebbe via quello che l'utente ci
 *  ha impostato dentro, che è tutto il punto di averle insieme.
 *
 *  ⚠️ L'`init*` si richiama anche su una scheda GIÀ montata, e non è uno
 *  spreco: tutte e tre sono scritte per essere riaperte (lo facevano
 *  già gli overlay di prima, ad ogni apertura) e ognuna ci riattacca il
 *  suo giro di aggiornamento, che `switchTab` aveva appena fermato. I
 *  dati non si ricomprano — le cache rispettano i loro TTL. */
async function apri(id) {
  _tab = id;

  for (const t of TABS) {
    const el = document.getElementById(`wp-ecn-panel-${t.id}`);
    if (el) el.style.display = t.id === id ? 'block' : 'none';
  }
  _container?.querySelectorAll('.wp-ecn-tab').forEach(b => {
    const on = b.dataset.tab === id;
    b.classList.toggle('active', on);
    b.setAttribute('aria-selected', String(on));
  });

  const host = document.getElementById(`wp-ecn-panel-${id}`);
  if (!host) return;
  if (!_montate.has(id)) host.innerHTML = `<div class="wp-ecn-loading">${escapeHtml(ecoT('loading'))}</div>`;

  try {
    if (id === 'prices') {
      const m = await loadModule(() => import('./prices.js'), 'economy');
      await m.initPricesTab(host);
      _montate.set(id, { stop: m.stopPricesTab, retranslate: m.retranslatePricesTab });
    } else if (id === 'yields') {
      const m = await loadModule(() => import('../market/main.js'), 'economy');
      await m.initMarketView(host);
      _montate.set(id, { stop: m.stopMarketAutoRefresh });
    } else {
      const m = await loadModule(() => import('../eco/main.js'), 'economy');
      m.initEcoView(host);
      _montate.set(id, {});
    }
  } catch (err) {
    console.error('[economia] scheda non caricata:', err);
    host.innerHTML = `<div class="wp-ecn-empty">${escapeHtml(ecoT('empty'))}</div>`;
    return;
  }

  trackEvent(`economy-tab-${id}`);
}

/** Cambio scheda: prima si ferma il giro di quella che si lascia, poi
 *  si apre l'altra. Due giri accesi sono due volte il traffico per una
 *  sola tabella guardata. */
function switchTab(id) {
  if (id === _tab) return;
  _montate.get(_tab)?.stop?.();
  apri(id);
}

/**
 * @param {HTMLElement} container dove montare la sezione
 * @param {{ tab?: string }} opts scheda di partenza (deep-link o voce di
 *   menù che punta direttamente a una delle tre)
 */
export async function initEconomyView(container, { tab } = {}) {
  const primoMontaggio = _container !== container;
  _container = container;

  if (primoMontaggio) {
    _montate.clear();
    _tab = TABS.some(t => t.id === tab) ? tab : 'prices';
    container.innerHTML = shellHtml();

    container.querySelectorAll('.wp-ecn-tab').forEach(b => {
      b.addEventListener('click', () => switchTab(b.dataset.tab));
    });

    // Ritraduzione a sezione aperta, come le altre viste.
    _langHandler = () => {
      const scroll = container.scrollTop;
      const attiva = _tab;
      // Solo lo scheletro: ogni scheda si ritraduce da sé, e ridisegnare
      // i pannelli li smonterebbe.
      container.querySelector('.wp-ecn-sectitle').textContent = ecoT('title');
      container.querySelector('.wp-ecn-secsub').textContent = ecoT('subtitle');
      container.querySelectorAll('.wp-ecn-tab').forEach(b => {
        const t = TABS.find(x => x.id === b.dataset.tab);
        if (t) b.textContent = ecoT(t.key);
      });
      _montate.get(attiva)?.retranslate?.();
      container.scrollTop = scroll;
    };
    window.addEventListener('wareraplus:langchange', _langHandler);
  }

  // Riapertura: se il chiamante chiede una scheda diversa da quella
  // rimasta aperta, `switchTab` ferma il giro di quella vecchia.
  const voluta = TABS.some(t => t.id === tab) ? tab : _tab;
  if (!primoMontaggio && voluta !== _tab) switchTab(voluta);
  else await apri(voluta);
}

/** Chiusura della sezione: si fermano TUTTI i timer, non solo quello
 *  della scheda in vista. Una scheda aperta prima e lasciata indietro
 *  avrebbe il suo giro ancora acceso dietro un overlay invisibile —
 *  l'errore che `src/market/main.js` documenta in testa. */
export function stopEconomyView() {
  for (const m of _montate.values()) m.stop?.();
}
