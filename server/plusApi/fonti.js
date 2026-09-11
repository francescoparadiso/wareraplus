/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — da dove si leggono i dati della nazione
   ----------------------------------------------------------------------
   Il quadro della nazione, la sorveglianza dei confini e i nemici leggono
   quasi tutto dal cache-server sulla LOOPBACK (127.0.0.1:3001), come fa
   già wealth.js: niente nginx, niente segreto, e soprattutto nessuna
   richiesta a WarEra che il cache-server non stia già facendo per tutti.

   Vanno in diretta su api6 solo le cose per cui dieci minuti di ritardo
   sono troppi o che il cache-server non tiene:

     · country.getCountryById    tesoro e classifiche "di adesso"
     · government.getByCountryId chi siede nel governo
     · region.getById            le difese delle regioni sorvegliate
     · user.getUserLite          pillole e abilità dei giocatori nemici
     · gameConfig.getGameConfig  durate e bonus, mai scritti a mano

   Tutte PUBBLICHE (misurato il 2026-09-10): nessuna chiave, nessun
   consumo del Worker. Se una diventasse token-gated la strada è il proxy
   del cache-server sulla stessa macchina, vedi wareraApi.js.

   ── IL CACHE-SERVER È UN'OTTIMIZZAZIONE, MAI UN PUNTO DI ROTTURA ──────
   Ogni lettura qui ha un ripiego o degrada a "non lo so": un cache-server
   giù toglie pezzi del quadro, non l'area riservata. E una lettura fallita
   restituisce l'ultimo valore buono se c'è — dati di venti minuti fa sono
   meglio di una scheda vuota, purché la data accanto dica quanti anni hanno.
   ══════════════════════════════════════════════════════════════════════ */

const { trpcGet } = require('./wareraApi');

const CACHE_BASE = (process.env.CACHE_BASE || 'http://127.0.0.1:3001').replace(/\/+$/, '');

async function dalCache(percorso, timeoutMs = 15_000) {
  const res = await fetch(`${CACHE_BASE}${percorso}`, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`cache-server ${percorso}: HTTP ${res.status}`);
  return res.json();
}

/**
 * Una funzione asincrona con memoria a scadenza, per chiave.
 *
 * Due richieste che arrivano insieme ricevono la STESSA promessa: senza,
 * dieci ministri che aprono l'area alle 21:00 sarebbero dieci letture
 * identiche dello stesso dato. E se la lettura fallisce ma c'è un valore
 * vecchio, si restituisce quello (vedi la testata).
 */
function memo(ttlMs, fn) {
  const m = new Map(); // chiave → { at, val, p }
  return (chiave = '_') => {
    const e = m.get(chiave);
    if (e && 'val' in e && Date.now() - e.at < ttlMs) return Promise.resolve(e.val);
    if (e?.p) return e.p;
    const p = fn(chiave)
      .then((val) => { m.set(chiave, { at: Date.now(), val }); return val; })
      .catch((err) => {
        const vecchio = m.get(chiave);
        if (vecchio && 'val' in vecchio) { m.set(chiave, { at: vecchio.at, val: vecchio.val }); return vecchio.val; }
        m.delete(chiave);
        throw err;
      });
    m.set(chiave, { ...(e || {}), p });
    return p;
  };
}

// La forma delle risposte del cache-server non è uniforme: alcune cache
// salvano la risposta tRPC intera, altre solo i dati. Si accettano tutte e
// due invece di scommettere su una.
const dati = (body) => body?.data?.result?.data ?? body?.data ?? null;

// ---------------------------------------------------------------------------
// Regioni e nazioni (dal cache-server)
// ---------------------------------------------------------------------------

/** id → regione. Il cache-server la riscrive ogni ora: basta per sapere
 *  chi possiede cosa e chi confina con chi, NON per le difese (quelle le
 *  legge in diretta confini.js). */
const regioniMappa = memo(10 * 60_000, async () => {
  try {
    const d = dati(await dalCache('/regions', 30_000));
    if (d && typeof d === 'object' && Object.keys(d).length) return d;
    throw new Error('cache /regions vuota');
  } catch {
    return trpcGet('region.getRegionsObject', {});
  }
});

/** id → nazione, dall'elenco completo (con warsWith, enemy, allies…). */
const paesiMappa = memo(5 * 60_000, async () => {
  let elenco = null;
  try { elenco = dati(await dalCache('/countries', 20_000)); } catch { /* ripiego sotto */ }
  if (!Array.isArray(elenco) || !elenco.length) elenco = await trpcGet('country.getAllCountries', {});
  return new Map((elenco || []).map((n) => [n._id, n]));
});

/** La nazione IN DIRETTA: il tesoro di dieci minuti fa, per chi deve
 *  decidere se aprire un contratto, è già un'altra cifra. */
const paeseLive = memo(60_000, async (countryId) => {
  try {
    const n = await trpcGet('country.getCountryById', { countryId });
    return { ...n, _fonte: 'live', _letto: Date.now() };
  } catch {
    const n = (await paesiMappa()).get(countryId);
    if (!n) throw new Error(`nazione ${countryId} sconosciuta`);
    return { ...n, _fonte: 'cache', _letto: Date.parse(n.updatedAt || '') || null };
  }
});

/** Presidente, vice, ministri e congresso. Cinque minuti: un governo
 *  cambia due volte al mese, ma chi è appena stato eletto lo vuole vedere. */
const governo = memo(5 * 60_000, (countryId) => trpcGet('government.getByCountryId', { countryId }));

/** Durate e bonus del gioco. Sei ore: cambiano con le patch, non col meteo. */
const configGioco = memo(6 * 3600_000, () => trpcGet('gameConfig.getGameConfig', {}));

// ---------------------------------------------------------------------------
// Il resto, dal cache-server
// ---------------------------------------------------------------------------

const battaglieVive = memo(90_000, async () => dati(await dalCache('/battles')) || []);

const baseDannoGiornaliero = memo(10 * 60_000, () => dalCache('/daily-damage'));

const bonifici = memo(10 * 60_000, () => dalCache('/money-transfers'));

/** Chiave `countryId|ore`: lo stesso archivio serve due finestre diverse
 *  (le 48 ore del quadro, le due settimane dei nemici). */
const timeline = memo(5 * 60_000, (chiave) => {
  const [countryId, ore] = chiave.split('|');
  return dalCache(`/damage-timeline?countryId=${encodeURIComponent(countryId)}&hours=${Number(ore) || 48}&days=14`);
});

const cittadini = memo(10 * 60_000, (countryId) =>
  dalCache(`/country-citizens?countryId=${encodeURIComponent(countryId)}&limit=400`));

/** TUTTI i cittadini (il cache-server taglia a 500 se non lo si chiede). */
const cittadiniTutti = memo(10 * 60_000, (countryId) =>
  dalCache(`/country-citizens?countryId=${encodeURIComponent(countryId)}&limit=5000`));

/** Quanti cittadini e quanti nuovi (24 ore, 7 giorni), dal censimento. */
const conteggiCittadini = memo(10 * 60_000, async (countryId) =>
  (await dalCache(`/citizens?countryId=${encodeURIComponent(countryId)}`))?.data?.[countryId] || null);

// ── Storia e guerra: tutto già sul cache-server, qui solo letto ─────────

/** Gli eventi del ticker: il tesoro ogni ora (categoria `wealth`, dal
 *  28/08) e la popolazione attiva ad ogni variazione. ~1,4 MB, ma sulla
 *  loopback e una volta ogni dieci minuti per tutte le nazioni. */
const eventiTicker = memo(10 * 60_000, async () => {
  const b = await dalCache('/ticker', 30_000);
  return b?.data || b?.events || (Array.isArray(b) ? b : []);
});

/** Le battaglie concluse degli ultimi 90 giorni, forma compatta di
 *  battleArchive.js: i id, e fine, w lato vincitore, r regione, ac/dc
 *  nazioni, ad/dd danno, ab/db taglia incassata dai due lati. */
const archivioBattaglie = memo(10 * 60_000, async () => (await dalCache('/battle-archive', 30_000))?.data || []);

/** Le spese di guerra per giorno e nazione: taglie pagate e contratti. */
const speseGuerra = memo(10 * 60_000, () => dalCache('/war-expenses', 30_000));

/** Le unità militari, con la composizione per nazionalità dei membri. */
const direttorioMu = memo(30 * 60_000, async () => (await dalCache('/mu-directory', 30_000))?.data || []);

const elezioniDi = memo(10 * 60_000, async (countryId) =>
  (await dalCache(`/elections?countryId=${encodeURIComponent(countryId)}`))?.data || []);

/** Nome e avatar di un gruppo di giocatori. Il cache-server li tiene già
 *  per i grafici del parlamento; qui non si memorizza niente in più. */
async function nomiUtenti(ids) {
  const unici = [...new Set((ids || []).filter(Boolean))];
  const out = {};
  for (let i = 0; i < unici.length; i += 50) {
    const pezzo = unici.slice(i, i + 50);
    try {
      const body = await dalCache(`/users-lite?ids=${pezzo.join(',')}`);
      Object.assign(out, body?.data || {});
    } catch { /* un nome mancante si disegna come "?", non rompe il quadro */ }
  }
  return out;
}

module.exports = {
  CACHE_BASE, dalCache, memo,
  regioniMappa, paesiMappa, paeseLive, governo, configGioco,
  battaglieVive, baseDannoGiornaliero, bonifici, timeline, cittadini, nomiUtenti,
  cittadiniTutti, conteggiCittadini, eventiTicker, archivioBattaglie, speseGuerra, direttorioMu, elezioniDi,
};
