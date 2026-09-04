/* ══════════════════════════════════════════════════════════════
   WarEra+ — Bilancio unità: il client dell'API

   L'unico pezzo della vista Unità militari che parla con un server
   AUTENTICATO. Tutto il resto di src/mu/ legge dati pubblici e non sa
   nemmeno chi sei.

   Il token è lo STESSO dell'area riservata e si legge da lì
   (src/private/api.js): un secondo posto in cui custodire una sessione
   sarebbe un secondo posto da cui farla scadere male. Da quel modulo si
   prende solo `getToken` — un accessorio a localStorage, che non tira
   dentro la vista dell'area riservata.

   ── LA REGOLA DI DISCREZIONE ───────────────────────────────────────
   Se un token non c'è, qui non parte NESSUNA richiesta e la linguetta
   non compare. Chi non ha mai fatto login non deve pagare un giro di
   rete per una sezione che non gli si aprirebbe comunque, e il server
   non deve ricevere una richiesta per ogni apertura della vista unità.
   ══════════════════════════════════════════════════════════════ */

import { WARERA_PLUS_API_BASE } from '../diplomacy/config.js';
import { getToken } from '../private/api.js';

/** Errore che porta con sé il codice dell'API, così la vista può tradurlo
 *  invece di mostrare "HTTP 502" a chi ha appena aperto una linguetta. */
export class WealthError extends Error {
  constructor(codice, stato) { super(codice); this.codice = codice; this.stato = stato; }
}

async function call(percorso) {
  const token = getToken();
  if (!token) throw new WealthError('non_autenticato', 401);

  const res = await fetch(`${WARERA_PLUS_API_BASE}${percorso}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  let corpo = null;
  try { corpo = await res.json(); } catch { /* risposta non JSON */ }
  if (!res.ok) throw new WealthError(corpo?.error || `http_${res.status}`, res.status);
  return corpo;
}

/** C'è una sessione? Non dice se dà diritto a qualcosa — solo se ha senso
 *  chiedere. Il permesso vero lo decide il server. */
export function haSessione() { return Boolean(getToken()); }

/**
 * Le unità di cui questo account può vedere il bilancio.
 * Elenco vuoto = niente linguetta. `comandaQualcosa` distingue «non
 * comandi nessuna unità» da «ne comandi una che non è italiana»: sono due
 * messaggi diversi e vanno detti in modo diverso.
 */
export function fetchUnitaBilancio() { return call('/wealth/unita'); }

/** Il rapporto di UNA unità: membri, serie giornaliera, riassunto. */
export function fetchBilancio(muId) { return call(`/wealth/unita/${encodeURIComponent(muId)}`); }
