/* ══════════════════════════════════════════════════════════════
   WarEra+ — Danno di OGGI (comune a nazioni, alleanze e unità militari)
   ------------------------------------------------------------------
   WarEra pubblica solo il cumulato SETTIMANALE (rankings.weeklyCountryDamages
   per le nazioni, rankings.muWeeklyDamages per le unità): il danno di
   giornata non esiste come dato. Il giorno di gioco però cambia alle 02:00
   italiane, quindi il server di cache fotografa lì il cumulato di tutti e
   due (server/warera-cache-server.js: snapshotDailyDamage) e la differenza
   col valore corrente è il danno fatto da inizio giornata.

   Questo modulo esiste perché lo stesso conto serve in quattro posti
   (pannello nazione, pannello alleanza, statistiche alleanze, scheda unità)
   e la parte delicata non è la sottrazione ma i casi limite, che devono
   essere trattati allo stesso modo ovunque:

     · differenza NEGATIVA → il contatore settimanale è ripartito (reset
       della settimana di gioco): non è "danno negativo", vale zero;
     · soggetto ASSENTE dallo scatto (nazione/unità nata dopo) → nessuna
       base a cui riferirsi: sta fuori dal totale, invece di far entrare
       tutto il suo cumulato in "oggi";
     · scatto NON delle 02:00 (primo avvio del server) → non si scrive
       "oggi" ma da che ora si conta, vedi dailyDamageLabel().

   Una sola richiesta per sessione, condivisa: la prima chiamata scarica, le
   altre riusano. Se il server non ha l'endpoint (deploy non fatto) o non
   risponde, tutto ritorna null e i chiamanti semplicemente non mostrano la
   riga — è un di più, non deve far fallire nulla.
   ══════════════════════════════════════════════════════════════ */

let _baseline = null;      // { takenAt, tz, byCountry, byMu } | null
let _promise = null;

/** Scarica (una volta) lo scatto. Ritorna null se non disponibile. */
export function ensureDailyDamage() {
  if (_baseline) return Promise.resolve(_baseline);
  if (_promise) return _promise;
  _promise = import('../diplomacy/cacheClient.js')
    .then(m => m.fetchDailyDamageBaselineViaCache())
    .then(data => {
      _baseline = data || null;
      if (!_baseline) _promise = null; // riprovabile alla prossima apertura
      return _baseline;
    })
    .catch(() => { _promise = null; return null; });
  return _promise;
}

/** Lo scatto già scaricato, senza aspettare (null finché non c'è). */
export function getDailyBaseline() {
  return _baseline;
}

function _delta(map, id, currentWeekly) {
  if (!map) return null;
  const base = map[id];
  if (typeof base !== 'number' || typeof currentWeekly !== 'number') return null;
  const d = currentWeekly - base;
  return d > 0 ? d : 0;
}

/** Danno di oggi di UNA nazione. null = non calcolabile (niente scatto, o
 *  nazione non presente nello scatto). */
export function countryDamageToday(nation) {
  return _delta(_baseline?.byCountry, nation?._id, nation?.rankings?.weeklyCountryDamages?.value);
}

/** Danno di oggi di UNA unità militare (voce di /mu-directory o dettaglio). */
export function muDamageToday(mu) {
  return _delta(_baseline?.byMu, mu?._id, mu?.rankings?.muWeeklyDamages?.value);
}

/** Somma su più nazioni (alleanza, sfera, mondo). Le nazioni non calcolabili
 *  restano fuori; ritorna null se NESSUNA lo era, così chi disegna distingue
 *  "zero danni oggi" da "non lo so". */
export function sumCountryDamageToday(nations) {
  if (!_baseline?.byCountry) return null;
  let total = 0, counted = 0;
  for (const n of nations || []) {
    const d = countryDamageToday(n);
    if (d == null) continue;
    total += d; counted++;
  }
  return counted ? total : null;
}

/** Etichetta della finestra: "oggi" solo se lo scatto è davvero quello del
 *  cambio giorno, letto NEL FUSO in cui è stato preso (un olandese e un
 *  italiano devono leggere la stessa cosa per lo stesso scatto). */
export function dailyDamageLabel(t) {
  if (!_baseline?.takenAt) return '';
  const taken = new Date(_baseline.takenAt);
  if (_hourIn(taken, _baseline.tz) === 2) return t ? t('damage_today_label') : 'Today';
  const hhmm = taken.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return t ? t('damage_since_label', { time: hhmm }) : `Since ${hhmm}`;
}

function _hourIn(date, tz) {
  if (!tz) return date.getHours();
  try {
    return Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: tz }).format(date));
  } catch { return date.getHours(); }
}
