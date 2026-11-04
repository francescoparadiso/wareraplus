/* ══════════════════════════════════════════════════════════════
   WarEra+ — Riferimenti mondiali dei dipendenti
   ------------------------------------------------------------------
   Il giro notturno del censimento aziende (server/companyCensus.js) chiede
   la rosa alle aziende che hanno prodotto in settimana e ne tiene, per
   risorsa, i percentili 10/25/50/75/90 di costo per punto (salario orario
   ÷ punti orari stimati dal gioco), punti all'ora e Produzione.

   Qui li leggono l'Ottimizzatore ("costa più del 80% dei dipendenti del
   ferro") e Rendite ("in attivo il ~60% dei dipendenti su questo bene").
   Una richiesta per sessione, tenuta in memoria: il dato cambia una volta
   per notte. Senza server, o prima del primo giro con la rosa, `null`: i
   due confronti non compaiono, il resto delle viste non cambia.

   ⚠️ Il costo per punto si confronta SOLO dentro la stessa risorsa: fra
   risorse diverse cambia quanto vale il punto, non quanto è bravo il
   dipendente. Per questo i percentili stanno per `itemCode`.
   ══════════════════════════════════════════════════════════════ */

let _promise = null;

/** I riferimenti, o null. Una richiesta per sessione. Il client della
 *  cache si carica qui dentro e non in testa: così `shareBelow` resta un
 *  modulo puro, che src/eco/companies.js (puro anche lui) può importare. */
export function loadEmployeeBenchmarks() {
  if (!_promise) {
    _promise = import('../diplomacy/cacheClient.js')
      .then(m => m.fetchEmployeeBenchmarksViaCache())
      .then(b => (b?.available && b.items ? b : null))
      .catch(() => null);
  }
  return _promise;
}

/**
 * Quota (0–100) dei dipendenti della risorsa con un valore SOTTO `v`,
 * interpolata fra i percentili. Fuori dalla fascia 10–90 si ferma ai bordi
 * (5 o 95): oltre, i cinque punti non dicono niente di preciso, e "più del
 * 95%" è già la risposta che serve. null se mancano i dati.
 */
export function shareBelow(v, pcts, ps) {
  if (!Array.isArray(pcts) || !Array.isArray(ps) || pcts.length !== ps.length || !Number.isFinite(v)) return null;
  const lo = pcts[0], hi = pcts[pcts.length - 1];
  // Tutti uguali (una risorsa con pochissimi dipendenti): sopra, sotto o pari.
  if (lo === hi) return v < lo ? 5 : v > hi ? 95 : 50;
  if (v < lo) return 5;
  if (v > hi) return 95;
  for (let i = 1; i < pcts.length; i++) {
    if (v <= pcts[i]) {
      const span = pcts[i] - pcts[i - 1];
      const t = span > 0 ? (v - pcts[i - 1]) / span : 0.5;
      return ps[i - 1] + t * (ps[i] - ps[i - 1]);
    }
  }
  return 95;
}
