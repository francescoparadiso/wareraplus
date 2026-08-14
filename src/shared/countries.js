/* ══════════════════════════════════════════════════════════════
   WarEra+ — Elenco nazioni CONDIVISO tra Diplomacy e Political
   ------------------------------------------------------------------
   Gap dichiarato del piano originale della Fase 2, colmato qui su
   richiesta esplicita: prima di questo modulo, Diplomacy e Political
   facevano DUE fetch separate della STESSA procedura tRPC
   (`country.getAllCountries`) — Diplomacy diretta su `api6.warera.io`
   a boot (`src/diplomacy/main.js: refreshData()`), Political via
   Worker ogni volta che le serviva l'elenco (apertura, cambio
   nazione, selettori senato, ticker...).

   Diplomacy carica le nazioni UNA sola volta a boot
   (`state.map.on('load', refreshData)`, mai più ri-fetchata
   automaticamente — nessun refresh periodico, nessun bottone di
   refresh manuale, verificato leggendo tutto `diplomacy/main.js`).
   Questo è già il modello di "freschezza" accettato dal resto
   dell'app: il pannello nazione (`src/panel/countryPanel.js`) mostra
   "dati già in memoria, zero fetch aggiuntive" come principio di
   design esplicito (vedi CLAUDE.md) — Political ora si allinea allo
   stesso principio invece di trattarsi come vista isolata.

   Alcuni punti in Political passavano `{ useCache: false }` per
   forzare una fetch fresca (cambio nazione, ticker). Non era una
   scelta di design deliberata per "dati sempre live" — era la cautela
   ragionevole di una vista che allora non aveva alcun accesso ai dati
   già caricati da Diplomacy. Con l'accesso diretto a `state.nazioniGlobal`
   quella cautela non serve più: i dati sono già in memoria, aggiornati
   all'ultimo boot, esattamente come li vede già la mappa.

   `state` (da `src/diplomacy/state.js`) è letto qui in sola lettura —
   nessuna modifica ai file di Diplomacy, coerente col vincolo delle
   "uniche due modifiche" documentato in CLAUDE.md.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { trpcCall } from './trpcClient.js';

/**
 * Tutte le nazioni WarEra. Riusa `state.nazioniGlobal` di Diplomacy se
 * già popolato (caso normale: Diplomacy fa boot prima che l'utente
 * possa aprire Political, dato che Political si apre solo cliccando
 * una nazione già presente sulla mappa). Fallback a una fetch diretta
 * via Worker — lo stesso path che Political usava per ognuna delle sue
 * chiamate prima di questo modulo — solo se Diplomacy non ha ancora i
 * dati (raro: boot ancora in corso) o se `forceRefresh` è esplicito.
 */
export async function getAllCountries({ forceRefresh = false } = {}) {
  if (!forceRefresh && Array.isArray(state.nazioniGlobal) && state.nazioniGlobal.length > 0) {
    return state.nazioniGlobal;
  }
  const result = await trpcCall('country.getAllCountries', {}, { useWorker: true });
  const items = Array.isArray(result) ? result : (result?.items || []);
  // Se Diplomacy non aveva ancora i dati (raro), li popola qui per i
  // prossimi consumer — Diplomacy compresa, se non ha ancora fatto boot.
  if (items.length) {
    state.nazioniGlobal = items;
    items.forEach(n => {
      state.nationMap.set(n._id, n);
      if (n.code) state.nationByCode.set(n.code.toUpperCase(), n);
    });
  }
  return items;
}

/** Lookup O(1) per singola nazione — usa l'indice già mantenuto da Diplomacy. */
export function getCountryById(countryId) {
  return state.nationMap.get(countryId) || null;
}
