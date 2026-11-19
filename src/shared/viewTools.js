/* ══════════════════════════════════════════════════════════════
   WarEra+ — Strumenti di vista: colonne ordinabili, sezioni spostabili
   ------------------------------------------------------------------
   Un osservatore solo (MutationObserver su <body>), stesso schema di
   shared/reveal.js: chi disegna una vista continua a scrivere il suo
   innerHTML come prima, e qui si riconoscono i pezzi da potenziare.

     · shared/tableSort.js — ogni tabella ha le colonne ordinabili;
     · shared/sections.js  — ogni sezione si chiude e si sposta.

   ── Dove guarda ──────────────────────────────────────────────
   Solo dentro gli overlay (#wp-*-overlay), il pannello nazione e la vista
   Political: la mappa e le sue etichette sono migliaia di nodi che cambiano
   a ogni movimento e non contengono né tabelle né sezioni.

   ── Le mutazioni che facciamo noi ────────────────────────────
   Riordinare righe, mettere i comandi nei titoli e chiudere sezioni sono a
   loro volta mutazioni del DOM: senza un freno l'osservatore le
   rileggerebbe in un giro infinito. `quiet(fn)` esegue una modifica e scarta
   le mutazioni che ha prodotto (takeRecords).
   ══════════════════════════════════════════════════════════════ */

import { enhanceTables } from './tableSort.js';
import { enhanceSections } from './sections.js';

const ROOTS = '[id$="-overlay"], #wp-country-panel, #wp-political-root';

let observer = null;
const pending = new Set();
let queued = false;

function quiet(fn) {
  try { fn(); } finally { observer?.takeRecords(); }
}

function flush() {
  queued = false;
  const nodes = [...pending];
  pending.clear();
  for (const n of nodes) {
    // Un nodo uscito dal documento nel frattempo (ridisegno a catena) non
    // serve più: il suo sostituto è già in coda.
    if (!n.isConnected) continue;
    try {
      enhanceSections(n, quiet);
      enhanceTables(n, quiet);
    } catch (err) {
      // Un nodo strano non deve fermare le viste: si scrive e si va avanti.
      console.warn('WarEra+ viewTools:', err.message);
    }
  }
  observer?.takeRecords();
}

function schedule() {
  if (queued) return;
  queued = true;
  // setTimeout e non requestAnimationFrame: in una scheda in secondo piano rAF
  // si ferma e le viste aprirebbero senza comandi finché non si torna a guardarle.
  setTimeout(flush, 16);
}

export function initViewTools() {
  if (observer) return;
  observer = new MutationObserver((records) => {
    for (const r of records) {
      for (const n of r.addedNodes) {
        if (n.nodeType !== 1) continue;
        // I comandi che mettiamo noi non sono una vista nuova.
        if (n.classList?.contains('wp-sec-ctl')) continue;
        if (n.closest?.(ROOTS) || n.matches?.(ROOTS)) pending.add(n);
      }
    }
    if (pending.size) schedule();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  // Quello che c'è già (viste montate prima dell'osservatore).
  for (const root of document.querySelectorAll(ROOTS)) pending.add(root);
  if (pending.size) schedule();
}
