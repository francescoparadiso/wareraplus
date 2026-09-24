/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Le alleanze di un istante, per la time machine
   -----------------------------------------------------------------------
   Il server (server/allianceHistory.js) manda il registro eventi delle
   alleanze; qui lo si rigioca all'istante dello slider. Due sistemi, uno
   dopo l'altro:

   - fino al 10 giugno 2026: alleanze BILATERALI, coppie di nazioni. Si
     rigiocano in avanti dal lancio del gioco (1° maggio 2025), quando non
     c'era nessuna alleanza;
   - dal 10 giugno 2026: alleanze a BLOCCO, col loro nome di allora. Si
     rigiocano all'indietro dall'appartenenza di oggi, perché chi fonda
     un'alleanza non riceve l'evento di ingresso (vedi il server), e sotto la
     data di nascita di un'alleanza non se ne è membri.

   ⚠️ Dopo il 10 giugno il campo `allies` delle nazioni è un fossile e qui
   non si mostra: le bilaterali valgono solo fino a `pair.until`.

   Una fetch per sessione, e solo quando si seleziona una nazione: chi apre
   la time machine senza cliccare niente non la paga. Senza server le
   sezioni non compaiono: non esiste un ripiego diretto (sarebbero ~115
   pagine di eventi da ogni browser).
   ═══════════════════════════════════════════════════════════════════════ */

import { WARERA_CACHE_BASE } from '../diplomacy/config.js';

let _dati = null;       // decodificato, oppure null se il server non l'ha
let _promessa = null;

/** Scarica (una volta) e indicizza. Risolve a true se i dati ci sono. */
export function loadAllianceHistory() {
  if (_promessa) return _promessa;
  _promessa = fetch(`${WARERA_CACHE_BASE}/alliance-history`, { signal: AbortSignal.timeout(15000) })
    .then(res => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
    .then(raw => { _dati = _decodifica(raw); return Boolean(_dati); })
    .catch(err => {
      console.warn('[time-machine] storia alleanze non disponibile:', err.message);
      _dati = null;
      return false;
    });
  return _promessa;
}

export function allianceHistoryReady() {
  return Boolean(_dati);
}

function _decodifica(raw) {
  const c = raw?.c;
  if (!Array.isArray(c) || !raw.bloc || !raw.pair) return null;
  const id = (i) => c[i];
  const ms = (s) => s * 1000;

  // Blocchi, dal più recente al più vecchio (si rigiocano all'indietro).
  const bloc = (raw.bloc.e || []).map(([t, k, n, a]) => ({ t: ms(t), k, n: id(n), a })).reverse();
  const now = new Map(Object.entries(raw.bloc.now || {}).map(([i, a]) => [id(Number(i)), a]));
  const created = new Map(Object.entries(raw.bloc.created || {}).map(([a, t]) => [a, ms(t)]));
  const names = new Map(Object.entries(raw.bloc.names || {}).map(([a, l]) => [a, l.map(([t, n]) => [ms(t), n])]));
  const current = new Map(Object.entries(raw.bloc.current || {}));

  // Bilaterali per nazione: ognuna ha la lista dei suoi eventi, in ordine.
  const pairsBy = new Map();
  for (const [t, k, x, y] of raw.pair.e || []) {
    const a = id(x), b = id(y);
    for (const [io, altro] of [[a, b], [b, a]]) {
      if (!pairsBy.has(io)) pairsBy.set(io, []);
      pairsBy.get(io).push([ms(t), k, altro]);
    }
  }

  return {
    bloc, now, created, names, current, pairsBy,
    blocFrom: raw.bloc.from ? ms(raw.bloc.from) : null,
    pairFrom: raw.pair.from ? ms(raw.pair.from) : null,
    pairUntil: raw.pair.until ? ms(raw.pair.until) : null,
  };
}

// L'appartenenza a blocchi di un istante si ricalcola solo se cambia
// l'istante: durante il playback lo slider avanza a scatti, e fra un
// fotogramma e l'altro spesso non succede niente.
let _cacheTs = null;
let _cacheMap = null;

/** Map nazione → alleanza a blocco all'istante `ts`. */
function _blocchiA(ts) {
  if (_cacheTs === ts) return _cacheMap;
  const m = new Map(_dati.now);
  for (const e of _dati.bloc) {
    if (e.t <= ts) break;             // da qui in giù gli eventi sono già successi
    if (e.k === 'j') { if (m.get(e.n) === e.a) m.delete(e.n); }
    else m.set(e.n, e.a);             // 'l' / 'x': prima di uscire c'era
  }
  for (const [n, a] of m) if ((_dati.created.get(a) ?? 0) > ts) m.delete(n);
  _cacheTs = ts;
  _cacheMap = m;
  return m;
}

/** { nome, allora }: il nome di oggi (o l'ultimo noto, se l'alleanza non
 *  esiste più) e quello che portava in quel momento, se era un altro. I
 *  cambi di nome non sono nel registro: "allora" è il nome dell'ultimo
 *  evento prima dell'istante, non una data di cambio inventata. */
function _nomiA(allianceId, ts) {
  const lista = _dati.names.get(allianceId) || [];
  let allora = lista[0]?.[1] || null;
  for (const [t, n] of lista) { if (t <= ts) allora = n; else break; }
  const nome = _dati.current.get(allianceId) || lista[lista.length - 1]?.[1] || allora;
  // Dopo l'ULTIMO evento dell'alleanza il nome vero non si sa: può essere
  // quello dell'evento o quello di oggi, perché il cambio di nome non ha
  // data. Lì non si dice niente (si mostra il nome di oggi, e basta): oggi
  // la scheda diceva «allora si chiamava The Olive Union», che è falso.
  const dopoUltimo = lista.length && ts > lista[lista.length - 1][0];
  return { nome, allora: !dopoUltimo && allora && allora !== nome ? allora : null };
}

/**
 * Le alleanze di una nazione all'istante `ts`, nella forma del sistema in
 * vigore allora:
 *   { tipo: 'blocco', id, nome, allora, membri: [countryId…] }   (lei esclusa;
 *     `allora` = il nome di quel momento, se diverso da quello di oggi)
 *   { tipo: 'blocco', id: null }                          nessun blocco
 *   { tipo: 'bilaterale', alleati: [countryId…] }
 *   null  → dati assenti, o istante prima del lancio del gioco
 */
export function alliancesAt(countryId, ts) {
  if (!_dati) return null;
  if (_dati.blocFrom && ts >= _dati.blocFrom) {
    const m = _blocchiA(ts);
    const a = m.get(countryId) || null;
    if (!a) return { tipo: 'blocco', id: null };
    const membri = [];
    for (const [n, x] of m) if (x === a && n !== countryId) membri.push(n);
    return { tipo: 'blocco', id: a, ..._nomiA(a, ts), membri };
  }
  if (_dati.pairFrom && ts >= _dati.pairFrom) {
    const alleati = new Set();
    for (const [t, k, altro] of _dati.pairsBy.get(countryId) || []) {
      if (t > ts) break;
      if (k === 'f') alleati.add(altro); else alleati.delete(altro);
    }
    return { tipo: 'bilaterale', alleati: [...alleati] };
  }
  return null;
}
