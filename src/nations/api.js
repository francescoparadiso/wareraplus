/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: accesso ai dati
   ------------------------------------------------------------------
   Questa vista non scarica quasi nulla di suo. Le nazioni con tutte le
   loro classifiche sono GIÀ in memoria: Diplomacy le ha caricate al boot
   in `state.nazioniGlobal` (una `country.getAllCountries` sola per tutta
   l'app, vedi src/shared/countries.js). Da lì arrivano ricchezza,
   sviluppo, popolazione, danni, guerre, alleanze, tasse e malcontento.

   Le uniche due cose che vengono da fuori:

     · il censimento cittadini e lo stile di gioco per nazione, dal server
       di cache (/citizens, /mu-playstyle-by-country) — già usati dal
       pannello nazione, qui si riusano le stesse funzioni e quindi le
       stesse risposte;
     · l'ELENCO cittadini con le loro statistiche (/country-citizens,
       endpoint nuovo). Dal browser sarebbe impossibile: il gioco espone
       solo gli id e poi una chiamata per utente, cioè migliaia di
       richieste per una nazione grande. Il server invece risolve già
       user.getUserLite per ogni cittadino censito (gli serve per lo stile
       di gioco) e ora ne conserva anche i numeri.

   Se il server non è raggiungibile (o non è ancora stato rideployato) la
   vista resta viva: tutto il resto viene dai dati già in memoria e
   l'elenco cittadini ricade su una risoluzione diretta LIMITATA — vedi
   FALLBACK_MAX più sotto: meglio i primi 150 cittadini che una pagina che
   non si apre, ma non si scaricano migliaia di utenti dal browser.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { WARERA_CACHE_BASE } from '../diplomacy/config.js';
import { trpcCall } from '../shared/trpcClient.js';

const TIMEOUT_MS = 8000;
const FALLBACK_MAX = 150;   // cittadini risolti dal browser quando il server manca

/** Tutte le nazioni, dal set già in memoria di Diplomacy.
 *  MAI mutato in posto (è condiviso): chi ordina lavora su una copia. */
export function getNations() {
  return state.nazioniGlobal || [];
}

export function getNation(countryId) {
  return getNations().find(n => n._id === countryId) || null;
}

async function cacheJson(path, { timeout = TIMEOUT_MS } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/* ── Elenco cittadini di una nazione ─────────────────────────── */

const _citizensByCountry = new Map();   // countryId → { rows, total, known, partial }

/**
 * @param {string} countryId
 * @param {{limit?: number}} [opts]
 * @returns {Promise<{rows: object[], total: number, known: number, partial: boolean, fetchedAt: number|null}>}
 */
export async function fetchCountryCitizens(countryId, { limit = 1000 } = {}) {
  if (_citizensByCountry.has(countryId)) return _citizensByCountry.get(countryId);

  let out;
  try {
    const json = await cacheJson(`/country-citizens?countryId=${encodeURIComponent(countryId)}&limit=${limit}`);
    out = {
      rows: json.data || [],
      total: json.total || 0,
      known: json.known || 0,
      partial: false,
      fetchedAt: json.fetchedAt || null,
    };
    // Server raggiunto ma ancora senza statistiche per questa nazione
    // (deploy appena fatto: la mappa si riempie in qualche giro di poll).
    if (!out.rows.length) out = await citizensDirect(countryId);
  } catch (err) {
    console.warn('WarEra+ nations: /country-citizens non disponibile, risoluzione diretta limitata:', err.message);
    out = await citizensDirect(countryId);
  }

  _citizensByCountry.set(countryId, out);
  return out;
}

/** Fallback dal browser: id dal gioco, poi al massimo FALLBACK_MAX
 *  user.getUserLite. Dichiaratamente parziale — chi disegna lo segnala. */
async function citizensDirect(countryId) {
  const ids = [];
  let cursor = null;
  try {
    for (let page = 0; page < 3 && ids.length < FALLBACK_MAX; page++) {
      const res = await trpcCall('user.getUsersByCountry', {
        countryId, limit: 100, ...(cursor ? { cursor } : {}),
      });
      for (const u of res?.items || []) ids.push(u._id);
      cursor = res?.nextCursor;
      if (!cursor) break;
    }
  } catch (err) {
    console.warn('WarEra+ nations: elenco cittadini non disponibile:', err.message);
  }

  const slice = ids.slice(0, FALLBACK_MAX);
  const users = await Promise.all(
    slice.map(id => trpcCall('user.getUserLite', { userId: id }).catch(() => null)),
  );

  const rows = users.filter(Boolean).map(u => ({
    id: u._id,
    u: u.username || null,
    a: u.avatarUrl || null,
    lv: u.leveling?.level ?? null,
    mr: u.militaryRank ?? null,
    wk: u.rankings?.weeklyUserDamages?.value ?? 0,
    dmg: u.rankings?.userDamages?.value ?? u.stats?.damagesCount ?? 0,
    w: u.rankings?.userWealth?.value ?? 0,
    b: u.rankings?.userBounty?.value ?? 0,
    atk: u.skills?.attack?.total ?? null,
    seen: Date.parse(u.dates?.lastConnectionAt) || null,
    ps: null,   // lo stile si calcola dalle skill: qui le abbiamo, vedi sotto
    skills: u.skills,
  }));
  rows.sort((a, b) => (b.wk || 0) - (a.wk || 0));

  return { rows, total: ids.length, known: rows.length, partial: true, fetchedAt: Date.now() };
}
