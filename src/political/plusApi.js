/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: client dello storico politico
   ------------------------------------------------------------------
   Le tre rotte di server/politicalHistory.js. Tutte e tre SENZA
   ripiego nel browser, e va bene così: sono riassunti di archivi che
   stanno solo sul server (i cambi di casacca e i governi nel tempo
   non esistono da nessun'altra parte). Server giù o non rideployato
   = `null`, e chi chiama non disegna la sezione invece di disegnarla
   vuota — un "nessun cambio di partito" su un archivio che non c'è
   sarebbe una bugia credibile.

   Una cache in memoria per sessione, con TTL corto: le elezioni si
   muovono ogni 3 minuti sul server, ma nessuno ha bisogno di vederle
   più fresche di così dentro una scheda di storia.
   ══════════════════════════════════════════════════════════════ */

import { WARERA_CACHE_BASE } from '../diplomacy/config.js';

const TIMEOUT_MS = 8000;
const TTL_MS = 5 * 60 * 1000;
const _memo = new Map();   // url → { at, promise }

function _get(path) {
  const url = `${WARERA_CACHE_BASE}${path}`;
  const hit = _memo.get(url);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.promise;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const promise = fetch(url, { signal: ctrl.signal })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .catch(err => {
      console.warn(`[political+] ${path} non disponibile:`, err.message);
      _memo.delete(url);     // un buco non si ricorda: al prossimo giro si riprova
      return null;
    })
    .finally(() => clearTimeout(timer));
  _memo.set(url, { at: Date.now(), promise });
  return promise;
}

/** Storia politica di UNA nazione (elezioni, presidenti, iscritti, cambi
 *  di casacca, governi). `null` se il server non la sa dare. */
export function fetchPoliticalHistory(countryId, { days = 30 } = {}) {
  if (!countryId) return Promise.resolve(null);
  return _get(`/political-history?countryId=${encodeURIComponent(countryId)}&days=${days}`)
    .then(j => (j && Array.isArray(j.elections) ? j : null));
}

/** Metriche di confronto di tutte le nazioni. */
export function fetchPoliticalOverview() {
  return _get('/political-overview').then(j => (j && j.data ? j : null));
}

/** Presidenti di sempre di tutte le nazioni (time machine). */
export function fetchPresidents() {
  return _get('/presidents').then(j => (j && j.data ? j : null));
}
