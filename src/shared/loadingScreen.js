/* ══════════════════════════════════════════════════════════════
   WarEra+ — Schermata di attesa delle sezioni caricate a richiesta
   ------------------------------------------------------------------
   Ogni sezione di "Approfondimenti" (Political, Ottimizzatore, News,
   Unità Militari, Statistiche nazioni, Statistiche alleanze, Guida)
   arriva con un `import()` dinamico e poi fa le proprie fetch. Fra il
   clic e il primo pixel di contenuto passava quindi un intervallo in
   cui l'overlay era già aperto ma VUOTO — solo lo sfondo a particelle.
   Su rete mobile è abbastanza lungo da sembrare un blocco (segnalato
   dall'utente: "sembra che non abbia fatto niente"). Qui si copre
   quell'intervallo con una schermata di attesa unica per tutte le
   sezioni, nella tinta della sezione che si sta aprendo.

   TRE SCELTE CHE VALE LA PENA CONOSCERE:

   1. CONTEGGIO, NON BOOLEANO. La schermata copre DUE fasi in fila —
      il download del chunk (src/shared/lazyModule.js: loadModule) e
      l'init della vista (fetch dei dati) — chiamate da punti diversi.
      Con un booleano la prima fase, chiudendosi, spegnerebbe la
      schermata per un istante prima che la seconda la riaccenda: uno
      sfarfallio. Con un contatore si spegne solo all'ultimo `end()`.

   2. RITARDO PRIMA DI MOSTRARLA (SHOW_DELAY_MS). Dalla seconda
      apertura in poi il chunk è già nel module graph e la vista è già
      montata: l'attesa è di pochi millisecondi. Mostrare comunque la
      schermata darebbe un lampo bianco ad ogni riapertura, che è
      peggio del problema che risolve. Se l'attesa finisce prima del
      ritardo, la schermata non compare affatto.

   3. NIENTE `display:none` A RIPOSO, MA NEMMENO DOM SEMPRE PRESENTE:
      l'elemento si crea alla prima attesa vera e resta poi riusato —
      un solo nodo per tutta la sessione, nessun lavoro al boot.

   Le tinte sono le stesse dichiarate come --wp-ov-accent in shell.css
   e come OVERLAY_TINTS in src/app/overlayChrome.js: se ne cambi una,
   cambiala in tutti i posti. Qui NON si importa overlayChrome.js di
   proposito — `shared/` non deve dipendere da `app/` (quello importa
   mapIdle.js, cioè la mappa: la schermata di attesa serve anche a chi
   la mappa non ce l'ha).
   ══════════════════════════════════════════════════════════════ */

import { t } from './i18n.js';

/** Chiave = `intent` di loadModule (vedi lazyModule.js). */
const ACCENTS = {
  political: '#c5964a',
  eco: '#3fb950',
  mu: '#e5484d',
  nations: '#39d0d8',
  guide: '#d29922',
  news: '#58a6ff',
  market: '#e3b341',
  'bloc-stats': '#a371f7',
  battles: '#db6d28',
  private: '#818cf8',
};
const DEFAULT_ACCENT = '#58a6ff';

/** Sotto questa soglia l'attesa non merita una schermata: si sarebbe
 *  vista solo come un lampo (vedi punto 2 in testa al file). */
const SHOW_DELAY_MS = 220;

let _el = null;
let _pending = 0;      // quante attese sono in corso (vedi punto 1)
let _showTimer = null;
let _accent = DEFAULT_ACCENT;

function ensureEl() {
  if (_el && _el.isConnected) return _el;
  _el = document.createElement('div');
  _el.className = 'wp-modload';
  _el.setAttribute('role', 'status');
  _el.setAttribute('aria-live', 'polite');
  _el.innerHTML = `
    <div class="wp-modload-box">
      <div class="wp-modload-ring"></div>
      <div class="wp-modload-label"></div>
    </div>`;
  document.body.appendChild(_el);
  return _el;
}

function paint() {
  const el = ensureEl();
  el.style.setProperty('--wp-modload-accent', _accent);
  el.querySelector('.wp-modload-label').textContent = t('loading_section');
  el.classList.add('visible');
}

function hideNow() {
  clearTimeout(_showTimer);
  _showTimer = null;
  if (_el) _el.classList.remove('visible');
}

/**
 * Apre un'attesa. Va SEMPRE chiusa con la funzione restituita (in un
 * `finally`, così un errore della sezione non lascia la schermata
 * appesa per sempre).
 *
 * @param {string} intent  la stessa etichetta di sezione passata a
 *                         loadModule ('political', 'mu', 'nations', …):
 *                         decide solo la tinta.
 * @returns {() => void} chiusura, idempotente.
 */
export function beginModuleLoading(intent = '') {
  // La tinta è quella dell'ULTIMA attesa aperta: le due fasi di una
  // stessa apertura hanno lo stesso intent, quindi in pratica non
  // cambia mai a metà.
  _accent = ACCENTS[intent] || DEFAULT_ACCENT;
  _pending++;
  if (_pending === 1) {
    _showTimer = setTimeout(() => { _showTimer = null; paint(); }, SHOW_DELAY_MS);
  } else if (_el?.classList.contains('visible')) {
    paint();   // già a schermo: aggiorna solo la tinta
  }

  let done = false;
  return () => {
    if (done) return;
    done = true;
    _pending = Math.max(0, _pending - 1);
    if (_pending === 0) hideNow();
  };
}

/**
 * Zucchero per il caso normale: esegue `fn` con la schermata attiva e la
 * chiude comunque vada, anche se `fn` lancia.
 * @template T
 * @param {string} intent
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export async function withModuleLoading(intent, fn) {
  const end = beginModuleLoading(intent);
  try {
    return await fn();
  } finally {
    end();
  }
}
