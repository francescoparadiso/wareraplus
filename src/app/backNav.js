/* ══════════════════════════════════════════════════════════════
   WarEra+ — tasto Indietro (browser, gesto/tasto del telefono)
   ------------------------------------------------------------------
   Il tool è una pagina sola: overlay, pannello nazione, schede di
   dettaglio, viste mappa si aprono via JS senza toccare la cronologia.
   Per il browser si era quindi sempre sulla prima pagina caricata, e
   "Indietro" faceva USCIRE dal tool (segnalato dall'utente) — dalla PWA
   installata su Android, la chiudeva.

   Come funziona:
   - Chi apre qualcosa chiama `pushBack(id, onBack, isOpen)`; chi lo
     chiude dall'interfaccia (✕, Esc, "Torna alla mappa") `dropBack(id)`.
     Gli id sono gerarchici: 'mu/detail' è figlio di 'mu', e chiudere
     'mu' fa cadere anche il figlio.
   - In cronologia c'è AL MASSIMO UNA voce nostra in più (la
     "sentinella"), qualunque sia la profondità: Indietro la consuma,
     chiude il livello in cima e, se sotto ne resta aperto un altro, la
     rimette. Così la cronologia non si gonfia mai e Avanti non riapre
     niente a sorpresa.
   - Quando l'ultimo livello si chiude dall'interfaccia, la sentinella
     va tolta (history.back()) — ma un turno DOPO: il menù chiude una
     vista e ne apre un'altra nello stesso clic (closeAnySubview), e in
     quel caso la sentinella serve ancora. Un pushBack nel frattempo
     annulla il ritorno.
   - `isOpen` (facoltativo) rende la pila robusta a chiusure che non
     passano da dropBack (DOM rimosso altrove, cambio lingua…): un
     livello che non è più aperto viene scartato invece di "mangiarsi"
     una pressione di Indietro senza effetti visibili.
   - Link condivisibili: ogni livello può portare i suoi parametri
     (`{ section: 'mu' }`, `{ mu: id }`, `{ map: 'weeklyDamage' }`…) e la
     barra degli indirizzi si riscrive da sola a ogni apertura/chiusura,
     sempre con replaceState sulla voce corrente. Si toccano SOLO le chiavi
     di URL_KEYS: ?tm= (la time machine se lo gestisce da sé), ?wallpaper=
     e il resto restano dove sono. Chi apre il link lo rilegge da
     main.js:handleIncomingDeepLink, che deve girare PRIMA di
     startUrlSync(): fino ad allora l'URL non si scrive, altrimenti la
     closePanel() del boot cancellerebbe ?country= prima che venga letto.
   - Se un livello ritocca l'URL mentre la sentinella è in cima (la time
     machine con ?tm=), l'URL viene riportato sulla voce di sotto quando
     la sentinella si toglie.
   ══════════════════════════════════════════════════════════════ */

const SENTINEL = 'wpBack';

/** Le chiavi dell'URL che appartengono ai livelli: le altre non si toccano.
 *  ⚠️ `view` NO: è dello sfondo di Wallpaper Engine (?wallpaper=1&view=). */
export const URL_KEYS = ['map', 'focus', 'days', 'region', 'country', 'alliance',
  'sphere', 'battle', 'section', 'tab', 'item', 'mu', 'mua', 'mub', 'nation', 'senate'];

/** @type {{ id: string, onBack: () => void, isOpen?: () => boolean, params?: object }[]} */
const stack = [];
let armed = false;          // la voce in cima alla cronologia è la nostra sentinella?
let ignoreNextPop = false;  // il prossimo popstate è il nostro history.back()
let carryUrl = null;        // URL della sentinella da riportare sulla voce di sotto
let backTimer = null;
let handling = false;       // dentro il popstate: la cronologia è già a posto
let enabled = false;        // spento finché initBackNav non lo accende
let urlReady = false;       // l'URL si scrive solo dopo aver letto il deep-link

/** L'indirizzo che descrive la pila: chiavi nostre nell'ordine dei livelli
 *  (prima la vista mappa, poi la nazione, poi la sezione…), il resto intatto. */
function syncUrl() {
  if (!urlReady) return;
  const url = new URL(location.href);
  URL_KEYS.forEach(k => url.searchParams.delete(k));
  for (const layer of stack) {
    // Un livello che non si vede più (scheda nascosta, popup rimosso
    // altrove) non deve restare nel link anche se non è ancora stato potato.
    if (!stillOpen(layer)) continue;
    for (const [k, v] of Object.entries(layer.params || {})) {
      if (v != null && v !== '' && v !== false) url.searchParams.set(k, String(v));
    }
  }
  if (url.href !== location.href) history.replaceState(history.state, '', url);
}

/** Da chiamare una volta, dopo handleIncomingDeepLink (vedi testata). */
export function startUrlSync() {
  if (!enabled) return;
  urlReady = true;
  prune();
  syncUrl();
}

function stillOpen(layer) {
  if (!layer.isOpen) return true;
  try { return !!layer.isOpen(); } catch { return false; }
}

function prune() {
  for (let i = stack.length - 1; i >= 0; i--) {
    if (!stillOpen(stack[i])) stack.splice(i, 1);
  }
}

function arm() {
  // Con un nostro history.back() ancora in volo non si spinge niente:
  // ci pensa il suo popstate a rimettere la sentinella se serve.
  if (armed || ignoreNextPop) return;
  history.pushState({ [SENTINEL]: true }, '');
  armed = true;
}

function scheduleDisarm() {
  if (backTimer) return;
  backTimer = setTimeout(() => {
    backTimer = null;
    prune();
    if (stack.length || !armed) return;
    armed = false;
    ignoreNextPop = true;
    carryUrl = location.href;
    history.back();
  }, 0);
}

/**
 * Registra un livello aperto. Ripetere la chiamata con lo stesso id
 * (riapertura, cambio di nazione nello stesso pannello) aggiorna il
 * livello senza aggiungerne un altro.
 * @param {string} id
 * @param {() => void} onBack  cosa fare quando l'utente preme Indietro
 * @param {() => boolean} [isOpen]
 * @param {object} [params]  i suoi parametri nell'URL (chiavi di URL_KEYS)
 */
export function pushBack(id, onBack, isOpen, params) {
  if (!enabled) return;
  // Un figlio ('mu/detail') vale solo dentro il suo genitore aperto: una
  // vista che si ridisegna a overlay chiuso (giro automatico, cambio
  // lingua) non deve lasciare un Indietro che non chiude niente.
  const slash = id.lastIndexOf('/');
  if (slash > 0) {
    const parent = id.slice(0, slash);
    if (!stack.some(l => l.id === parent)) return;
  }
  clearTimeout(backTimer);
  backTimer = null;
  const existing = stack.find(l => l.id === id);
  if (existing) {
    existing.onBack = onBack;
    existing.isOpen = isOpen;
    existing.params = params;
  } else {
    stack.push({ id, onBack, isOpen, params });
  }
  arm();
  syncUrl();
}

/** C'è un livello con questo id? */
export function hasBack(id) {
  return stack.some(l => l.id === id);
}

/** Cambia i parametri di un livello già aperto (scheda di Economia, nazione
 *  scelta dentro Political) senza toccare la cronologia. */
export function updateBackParams(id, params) {
  const layer = stack.find(l => l.id === id);
  if (!layer) return;
  layer.params = { ...layer.params, ...params };
  syncUrl();
}

/** Il livello `id` (e i suoi figli `id/...`) è stato chiuso. */
export function dropBack(id) {
  if (!enabled) return;
  for (let i = stack.length - 1; i >= 0; i--) {
    const lid = stack[i].id;
    if (lid === id || lid.startsWith(id + '/')) stack.splice(i, 1);
  }
  if (handling) { syncUrl(); return; }
  prune();
  syncUrl();
  if (!stack.length && armed) scheduleDisarm();
}

/** Comodità per le viste che si ridisegnano da sole: allinea il livello
 *  `id` a uno stato booleano ("la scheda di dettaglio è aperta?"). */
export function syncBack(id, active, onBack, isOpen, params) {
  if (active) pushBack(id, onBack, isOpen, params);
  else if (stack.some(l => l.id === id)) dropBack(id);
}

function onPopState() {
  if (ignoreNextPop) {
    ignoreNextPop = false;
    if (carryUrl && location.href !== carryUrl) {
      history.replaceState(history.state, '', carryUrl);
    }
    carryUrl = null;
    prune();
    syncUrl();
    if (stack.length) arm();
    return;
  }

  const wasArmed = armed;
  armed = !!history.state?.[SENTINEL];
  // Solo "dalla sentinella alla voce di sotto" è un Indietro nostro. Un
  // Avanti che torna sulla sentinella non deve chiudere niente.
  if (!wasArmed || armed) return;

  prune();
  const top = stack.pop();
  if (top) {
    handling = true;
    try { top.onBack(); }
    catch (err) { console.error('[backNav] chiusura fallita:', top.id, err); }
    finally { handling = false; }
  }
  prune();
  // Siamo sulla voce di sotto: il suo URL deve dire cosa è aperto ADESSO
  // (la sentinella rimessa da arm() lo copia).
  syncUrl();
  if (stack.length) arm();
}

/** @param {{ enabled?: boolean }} [opts] — false dentro lo sfondo di
 *  Wallpaper Engine: lì un tasto Indietro non c'è, e la rotazione delle
 *  viste riempirebbe la cronologia per niente. */
export function initBackNav({ enabled: on = true } = {}) {
  if (!on) return;
  enabled = true;
  window.addEventListener('popstate', onPopState);
  // Ricaricando la pagina mentre la sentinella era in cima, il browser la
  // ripresenta: senza livelli aperti va tolta, altrimenti la prima
  // pressione di Indietro non farebbe nulla. Se nel frattempo un deep-link
  // apre qualcosa, pushBack annulla il ritorno e la sentinella resta buona.
  if (history.state?.[SENTINEL]) {
    armed = true;
    scheduleDisarm();
  }
}
