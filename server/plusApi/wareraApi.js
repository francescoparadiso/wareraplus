/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — chiamate a WarEra
   ----------------------------------------------------------------------
   Condiviso da verify.js (collegamento del personaggio) e roles.js
   (ruoli derivati). Stava dentro verify.js finché serviva a uno solo.

   ── TUTTO PUBBLICO, E NON È UN CASO ───────────────────────────────────
   Le procedure che servono all'area riservata — search.searchUsers,
   user.getUserLite, company.getCompanies, company.getById,
   government.getByCountryId, mu.getById — rispondono TUTTE da api6 senza
   X-API-Key (misurato il 2026-09-02). Quindi questo processo non ha
   bisogno di una copia del token, non passa dal Worker Cloudflare e non
   ne consuma il budget, che era già stato sfondato una volta.

   Se un giorno una di queste diventasse token-gated, la strada è il
   proxy del cache-server sulla stessa macchina (127.0.0.1:3001/trpc),
   che la chiave ce l'ha già: non aggiungere un secondo posto in cui
   custodirla.
   ══════════════════════════════════════════════════════════════════════ */

const API = 'https://api6.warera.io/trpc';

/** Errore che distingue "il gioco dice di no" da "il gioco non risponde".
 *  Servono due messaggi diversi: dire "gioco non raggiungibile" a chi ha
 *  solo sbagliato personaggio lo manda a controllare la propria
 *  connessione invece del nome che ha scritto. */
class TrpcError extends Error {
  constructor(proc, codice, messaggio) {
    super(`${proc}: ${messaggio}`);
    this.codiceGioco = codice; // es. 'NOT_FOUND'
  }
}

async function trpcGet(proc, input) {
  const url = `${API}/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });

  // Un 404 di tRPC ha comunque un corpo con l'errore dentro: si legge
  // quello invece di fermarsi al codice HTTP.
  let body = null;
  try { body = await res.json(); } catch { /* risposta non JSON */ }

  if (body?.error) throw new TrpcError(proc, body.error?.data?.code || 'ERRORE', body.error.message);
  if (!res.ok) throw new Error(`${proc}: HTTP ${res.status}`);
  return body.result.data;
}

/**
 * Più procedure in un solo GET. Il formato è quello che usa già
 * src/diplomacy/utils.js: `proc1,proc2?batch=1&input={"0":…,"1":…}`.
 * Le procedure possono essere DIVERSE fra loro — serve per prendere
 * governo e unità militare in una richiesta sola.
 * @param {Array<[string, object]>} chiamate coppie [procedura, input]
 * @returns {Promise<Array<any|null>>} stessa lunghezza e ordine; null dove
 *   quella singola procedura ha fallito, così un pezzo mancante non fa
 *   cadere gli altri.
 */
async function trpcBatch(chiamate) {
  if (!chiamate.length) return [];
  const procs = chiamate.map(([p]) => p).join(',');
  const input = Object.fromEntries(chiamate.map(([, i], idx) => [idx, i]));
  const url = `${API}/${procs}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;

  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`batch: HTTP ${res.status}`);
  const body = await res.json();
  return (Array.isArray(body) ? body : [body]).map((x) => x?.result?.data ?? null);
}

/** Più chiamate alla STESSA procedura (la forma che serve a verify.js). */
function trpcBatchSame(proc, inputs) {
  return trpcBatch(inputs.map((i) => [proc, i]));
}

module.exports = { API, TrpcError, trpcGet, trpcBatch, trpcBatchSame };
