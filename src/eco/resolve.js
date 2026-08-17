/* ══════════════════════════════════════════════════════════════
   WarEra+ — Ottimizzatore industriale: risoluzione utente
   ------------------------------------------------------------------
   Port di `warera/resolve.py`. Accetta un id utente grezzo (24 hex) o uno
   username. Lo username passa da `search.searchAnything`, che fa matching
   per SOTTOSTRINGA: uno username esatto può tornare insieme a collisioni
   non correlate (caso reale: "Argus" torna con "ArgusIA"). Si preferisce un
   match esatto case-insensitive, ma si tengono le altre corrispondenze come
   avviso, invece di risolvere silenziosamente sull'account sbagliato.
   ══════════════════════════════════════════════════════════════ */

import { ecoCall, ecoBatchByKey, EcoProxyUnavailableError } from './api.js';

const ID_RE = /^[0-9a-f]{24}$/i;

export class AmbiguousUserError extends Error {
  constructor(candidates) {
    super(`Più utenti corrispondono: ${candidates.join(', ')}`);
    this.name = 'AmbiguousUserError';
    this.candidates = candidates;
  }
}
export class UserNotFoundError extends Error {
  constructor(msg) { super(msg); this.name = 'UserNotFoundError'; }
}

/**
 * @returns {Promise<{userId: string, otherMatches: string[]}>}
 */
export async function resolveUserId(userCodeOrUsername) {
  const q = (userCodeOrUsername || '').trim();
  if (ID_RE.test(q)) return { userId: q, otherMatches: [] };

  const found = await ecoCall('search.searchAnything', { searchText: q });
  // `null` = il proxy non ha risposto (non deployato / key mancante / VPS
  // giù), NON "nessun utente": distinguerlo evita di mostrare "non trovato"
  // quando in realtà il tool non ha potuto nemmeno cercare.
  if (found == null) throw new EcoProxyUnavailableError('search.searchAnything non raggiungibile');
  const candidates = found.userIds || [];
  if (!candidates.length) throw new UserNotFoundError(`Nessun utente trovato per "${q}".`);
  if (candidates.length === 1) return { userId: candidates[0], otherMatches: [] };

  const liteById = await ecoBatchByKey('user.getUserLite', Object.fromEntries(candidates.map(cid => [cid, { userId: cid }])));
  const target = q.toLowerCase();
  const exact = candidates.filter(cid => (liteById[cid]?.username || '').toLowerCase() === target);
  if (exact.length === 1) {
    const chosen = exact[0];
    const others = candidates.filter(cid => cid !== chosen).map(cid => liteById[cid]?.username || cid);
    return { userId: chosen, otherMatches: others };
  }

  const sample = candidates.slice(0, 8);
  const names = sample.map(cid => liteById[cid]?.username || cid);
  throw new AmbiguousUserError(names);
}
