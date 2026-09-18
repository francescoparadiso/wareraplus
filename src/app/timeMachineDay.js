/* ══════════════════════════════════════════════════════════════
   WarEra+ — Time machine: la giornata storica

   Il pezzo di dati che toglie alla time machine il suo limite dichiarato.
   In testa a timeMachine.js c'è scritto perché mostrava solo l'ownership:
   «quei dati non sono mai stati salvati nel tempo, mostrarli sarebbe
   fuorviante (sembrerebbero valori storici ma sarebbero quelli di OGGI)».

   Per patti difensivi, guerre, nemico giurato e battaglie aperte adesso
   sono salvati davvero, giorno per giorno (server/dayHistory.js): un
   archivio di terzi importato fino al 17 settembre 2026 e uno scatto
   nostro ogni notte da lì in poi. Quindi si possono mostrare — e sono di
   QUEL giorno, che è tutta la differenza.

   ── NIENTE FALLBACK, E VA BENE COSÌ ────────────────────────────────
   Come lo storico regioni: se il server di cache non risponde, questi
   dati non esistono da nessun'altra parte. `null` significa "non lo so",
   e chi chiama non disegna la sezione invece di disegnarla vuota — una
   nazione senza guerre e senza patti sarebbe una bugia credibile.

   ── UNA FETCH PER GIORNO, NON PER FOTOGRAMMA ───────────────────────
   Lo slider ne attraversa centocinquanta di giorni durante un playback.
   Qui si tiene una cache per giorno in memoria e si chiede solo il giorno
   che l'utente FERMA (vedi il debounce in timeMachine.js): il playback non
   deve pagare una richiesta al secondo per un pannello che nessuno legge
   mentre scorre.
   ══════════════════════════════════════════════════════════════ */

import { WARERA_CACHE_BASE } from '../diplomacy/config.js';

const TIMEOUT_MS = 4000;

// giorno → { diplomacy: Map, battles: [], coverageFrom } | null (assente =
// mai chiesto, null = chiesto e non c'era)
const _cache = new Map();
const _inFlight = new Map();

/** Il giorno italiano di un istante: la stessa griglia con cui il server
 *  scatta (02:00 italiane = cambio giorno di gioco). */
export function dayKey(ts) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Rome', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(ts));
}

/** Quello che c'è già in memoria per quel giorno, senza chiedere niente.
 *  `undefined` = non ancora chiesto, `null` = chiesto e non c'era. */
export function cachedDay(day) {
  return _cache.get(day);
}

/**
 * La giornata storica dal server di cache. Una sola richiesta per giorno
 * per sessione, condivisa fra chiamate contemporanee (_inFlight).
 */
export function fetchDay(day) {
  if (_cache.has(day)) return Promise.resolve(_cache.get(day));
  if (_inFlight.has(day)) return _inFlight.get(day);

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  const p = fetch(`${WARERA_CACHE_BASE}/day-history?day=${encodeURIComponent(day)}`, { signal: ctrl.signal })
    .then(res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return res.json();
    })
    .then(data => {
      // Le righe arrivano compatte (vedi dayHistory.js): qui si riespandono
      // una volta sola, invece che ad ogni apertura del popup.
      const diplomacy = new Map();
      for (const r of data?.diplomacy || []) {
        diplomacy.set(r[0], { wars: r[1] || [], pacts: r[2] || [], sworn: r[3] || null, wealth: r[4] ?? null });
      }
      const battles = (data?.battles || []).map(r => ({
        id: r[0], type: r[1],
        attackerName: r[2], attackerCode: r[3],
        defenderName: r[4], defenderCode: r[5],
        attackerPower: r[6], defenderPower: r[7],
        hits: r[8], balance: r[9],
        attackerDamage: r[10], defenderDamage: r[11],
      }));
      const out = {
        day: data?.day || day,
        diplomacy: data?.diplomacy ? diplomacy : null,
        battles: data?.battles ? battles : null,
        coverageFrom: data?.coverageFrom || null,
      };
      _cache.set(day, out);
      return out;
    })
    .catch(err => {
      // Server vecchio (rotta assente) o VPS giù: si ricorda il buco, così
      // riaprendo lo stesso giorno non si ripaga il timeout.
      console.warn('[time-machine] giornata storica non disponibile:', err.message);
      _cache.set(day, null);
      return null;
    })
    .finally(() => {
      clearTimeout(timer);
      _inFlight.delete(day);
    });

  _inFlight.set(day, p);
  return p;
}

/** Vero se quel giorno è PRIMA di quando l'archivio ha cominciato a
 *  guardare: chi chiama deve dire "fuori portata" invece di mostrare una
 *  nazione in pace che magari era in guerra. */
export function fuoriPortata(dati, day, quale = 'diplomacy') {
  const da = dati?.coverageFrom?.[quale];
  return Boolean(da && day < da);
}
