/* ══════════════════════════════════════════════════════════════
   WarEra+ — Overlay Political View
   ------------------------------------------------------------------
   Carica il Political View ORIGINALE (public/political/index.html,
   codice invariato salvo 2 piccoli hook additivi in congress.js — vedi
   commenti lì) dentro un iframe, sfruttando il meccanismo di deep-link
   ?country=<id> già presente in quel tool (letto in political/config.js).

   IMPORTANTE — perché si usano solo eventi, mai `contentWindow.X`:
   in JavaScript, `let`/`const` dichiarate a livello globale in uno
   script classico NON diventano proprietà di `window` (solo `var` e le
   dichiarazioni di funzione lo fanno). `SenateView` (const) e
   `_currentCongressElectionId` (let) in Political sono quindi
   invisibili come `frameEl.contentWindow.SenateView` dall'esterno,
   anche se esistono e sono valide *dentro* quello script. Da qui il
   bug della versione precedente (`Cannot read properties of undefined
   (reading 'open')`). La soluzione: comunicare solo via
   CustomEvent su `window` (l'oggetto window stesso È condiviso,
   same-origin — sono i bare-name binding let/const a non esserlo),
   con un piccolo listener dentro congress.js che ha accesso diretto
   per nome a quelle variabili.
   ══════════════════════════════════════════════════════════════ */

import { syncThemeToFrame } from './themeSync.js';

let overlayEl, frameEl, backBtn, titleEl;

// Traccia, lato genitore, se il boot dati (elezioni) è già avvenuto per
// il documento ATTUALMENTE caricato nell'iframe. Si azzera ogni volta
// che l'iframe naviga (evento 'load'), perché un nuovo documento parte
// sempre da zero. Non si può dedurre questo stato leggendo variabili
// interne a Political (vedi nota sopra), quindi lo ricostruiamo qui
// ascoltando l'evento che quello stesso codice già emette.
let _electionsReady = false;

export function initPoliticalOverlay() {
  overlayEl = document.getElementById('wp-political-overlay');
  frameEl = document.getElementById('wp-political-frame');
  backBtn = document.getElementById('wp-political-back');
  titleEl = document.getElementById('wp-political-title');

  backBtn.addEventListener('click', closePoliticalView);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlayEl.classList.contains('open')) {
      closePoliticalView();
    }
  });

  // Ogni volta che l'iframe carica un nuovo documento, riparte da zero
  // e si aggancia al suo evento di prontezza.
  frameEl.addEventListener('load', () => {
    _electionsReady = false;
    const win = frameEl.contentWindow;
    if (!win) return;
    win.addEventListener('wareraplus:elections-ready', () => {
      _electionsReady = true;
    });
  });
}

/**
 * Chiede a Political (via evento in ingresso, ascoltato in congress.js)
 * di aprire la Senate View. Se i dati non sono ancora pronti, aspetta
 * l'evento di prontezza prima di mandare la richiesta.
 */
function _requestSenateOpen() {
  const win = frameEl.contentWindow;
  if (!win) return;

  const dispatch = () => win.dispatchEvent(new CustomEvent('wareraplus:open-senate'));

  if (_electionsReady) {
    dispatch();
    return;
  }

  let done = false;
  const onReady = () => {
    if (done) return;
    done = true;
    dispatch();
  };
  win.addEventListener('wareraplus:elections-ready', onReady, { once: true });
  // Timeout di sicurezza: se l'evento non arrivasse mai (errore
  // imprevisto nel boot), tenta comunque dopo un'attesa ragionevole.
  setTimeout(() => {
    if (!done) { done = true; dispatch(); }
  }, 15000);
}

/**
 * Apre Political View per una nazione specifica.
 * @param {string} countryId - _id WarEra della nazione
 * @param {string} [countryName] - solo per il titolo mostrato in top bar
 * @param {{ openSenate?: boolean }} [options]
 */
export function openPoliticalView(countryId, countryName = '', options = {}) {
  const src = `/political/index.html?country=${encodeURIComponent(countryId)}`;
  const isNewCountry = frameEl.dataset.currentCountry !== countryId;

  // Il tema va scritto PRIMA che l'iframe (ri)carichi, così Political lo
  // legge già corretto al boot (config.js: initTheme() legge we_theme,
  // applyTheme è una function declaration quindi ATTACCATA a window —
  // per quella l'accesso diretto funziona, a differenza di SenateView).
  syncThemeToFrame();

  if (isNewCountry) {
    frameEl.src = src;
    frameEl.dataset.currentCountry = countryId;
  }
  titleEl.textContent = countryName ? `— ${countryName}` : '';
  overlayEl.classList.add('open');
  overlayEl.setAttribute('aria-hidden', 'false');

  if (options.openSenate) {
    if (isNewCountry) {
      // L'iframe sta (ri)caricando: aspetta il suo 'load' (che reimposta
      // _electionsReady e riaggancia il listener, vedi initPoliticalOverlay)
      // prima di richiedere l'apertura della Senate View.
      frameEl.addEventListener('load', function onLoad() {
        frameEl.removeEventListener('load', onLoad);
        _requestSenateOpen();
      });
    } else {
      // Stessa nazione già caricata: l'iframe non ricarica, quindi nessun
      // nuovo evento 'load' scatterà — richiama direttamente.
      _requestSenateOpen();
    }
  }

  if (window.umami) {
    window.umami.track('wareraplus-expand-political', { countryId, openSenate: !!options.openSenate });
  }
}

export function closePoliticalView() {
  overlayEl.classList.remove('open');
  overlayEl.setAttribute('aria-hidden', 'true');
}

export function isPoliticalViewOpen() {
  return overlayEl?.classList.contains('open') ?? false;
}
