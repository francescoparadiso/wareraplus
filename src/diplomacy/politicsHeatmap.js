/* ══════════════════════════════════════════════════════════════
   WarEra+ — Vista mappa "Elezioni"
   ------------------------------------------------------------------
   Dove si vota adesso, e dove si stanno raccogliendo le candidature.
   Le elezioni di WarEra sono il momento in cui una nazione può
   cambiare padrone senza una battaglia — un presidente nuovo cambia
   alleanze, guerre, tesoro — ma finora per sapere dove ce n'era una
   aperta bisognava aspettarla nel ticker o aprire Political nazione
   per nazione.

   Granularità per NAZIONE (le elezioni sono di paese), tre stati:
     · voto in corso     — rosso
     · candidature aperte — oro
     · niente di aperto  — la terra neutra di sempre

   Dati: /elections?open=1 del server di cache, la stessa rotta
   leggera dei due ticker (cacheClient.js: fetchOpenElectionsViaCache),
   una richiesta sola per tutto il mondo. Nessun ripiego per nazione:
   180 chiamate per colorare una mappa sono esattamente quello che il
   server esiste per evitare. Server giù = la legenda lo dice.

   La fase si ricalcola a ogni lettura dagli orari (votesStartAt /
   votesEndAt), non si fida di quella del momento della fetch: la
   vista può restare aperta a lungo e una candidatura diventa voto
   senza che nessuno ricarichi niente.

   ── AFFLUENZA (richiesta dell'utente, 2026-10-10) ──────────────
   Dove si vota, il rosso non è più uno solo: è una scala sull'affluenza
   DI ADESSO, voti espressi finora / popolazione attiva
   (`rankings.countryActivePopulation`, la metrica giusta — vedi
   CLAUDE.md sulla popolazione — e la stessa della vista "Mondo" di
   Political, src/political/world.js). Zero fetch: i voti stanno già in
   /elections?open=1, la popolazione in state.nationMap.
   La scala è FISSA da 0 a 100% (richiesta dell'utente), non relativa
   al massimo del momento: con quattro elezioni aperte il "più scuro"
   sarebbe sempre qualcuno, anche a un 5%. Ma è PONDERATA con una
   radice: misurato il 10 ott 2026, a voto in corso si sta fra 20 e 48%,
   e su una scala lineare sarebbero state tutte e quattro rosa pallido.
   Con la radice il 25% cade a metà barra, il 100% in fondo. L'affluenza cresce durante le 24 ore del voto, quindi un
   chiaro a un'ora dall'apertura non vuol dire disinteresse — il
   riepilogo mostra accanto quanto manca alla chiusura.
   Con due elezioni aperte insieme vale la più alta.
   ══════════════════════════════════════════════════════════════ */

import { COLORS } from './config.js';
import { state } from './state.js';

export const POLITICS_COLORS = {
  voting: '#e05252',     // voto in corso ma affluenza non calcolabile (popolazione ignota)
  candidacy: '#c5964a',
};

/** Fondo scala dell'affluenza (100%) e il punto che cade a metà barra. */
export const TURNOUT_MAX = 1;
export const TURNOUT_MID = 0.25;   // √0,25 = 0,5
const TURNOUT_LO = [255, 205, 196];
const TURNOUT_HI = [140, 18, 30];

/** Affluenza di un'elezione adesso (0–1), o null se la popolazione manca. */
export function turnoutOf(e, countryId) {
  const pop = state.nationMap.get(countryId)?.rankings?.countryActivePopulation?.value;
  if (!pop) return null;
  const votes = e?.votesCount || (e?.candidates || []).reduce((s, c) => s + (c.voteCount || 0), 0);
  return Math.min(1, votes / pop);
}

export function turnoutColor(t) {
  if (t == null) return POLITICS_COLORS.voting;
  const k = Math.sqrt(Math.min(1, Math.max(0, t / TURNOUT_MAX)));
  const ch = i => Math.round(TURNOUT_LO[i] + (TURNOUT_HI[i] - TURNOUT_LO[i]) * k);
  return `rgb(${ch(0)},${ch(1)},${ch(2)})`;
}

export function turnoutLegendGradient() {
  // Fermate lungo la barra in posizione u → affluenza u², così il colore
  // di ogni punto è quello che avrebbe sulla mappa.
  const stops = [0, 0.25, 0.5, 0.75, 1].map(u => `${turnoutColor(u * u * TURNOUT_MAX)} ${u * 100}%`);
  return `linear-gradient(to right, ${stops.join(', ')})`;
}

/** Fase di un'elezione aperta ADESSO: 'voting' | 'candidacy' | null (chiusa). */
export function phaseOf(e, now = Date.now()) {
  const s = Date.parse(e?.votesStartAt || '');
  const en = Date.parse(e?.votesEndAt || '');
  if (Number.isFinite(en) && en < now) return null;
  if (Number.isFinite(s) && now < s) return 'candidacy';
  return 'voting';
}

/** { countryId: [elezioni aperte] } → righe piatte con fase, ordinate:
 *  prima il voto (per chiusura), poi le candidature (per apertura del voto). */
export function openElectionRows(byCountry = state.openElections, now = Date.now()) {
  const rows = [];
  for (const [countryId, list] of Object.entries(byCountry || {})) {
    for (const e of list || []) {
      const phase = phaseOf(e, now);
      if (!phase) continue;
      rows.push({
        countryId,
        nation: state.nationMap.get(countryId) || null,
        id: e._id,
        type: e.type === 'president' ? 'president' : 'congress',
        phase,
        start: Date.parse(e.votesStartAt || '') || null,
        end: Date.parse(e.votesEndAt || '') || null,
        votes: e.votesCount || 0,
        turnout: phase === 'voting' ? turnoutOf(e, countryId) : null,
        candidates: (e.candidates || []).length,
      });
    }
  }
  return rows.sort((a, b) =>
    (a.phase === b.phase ? 0 : a.phase === 'voting' ? -1 : 1)
    || (a.phase === 'voting' ? (a.end || 0) - (b.end || 0) : (a.start || 0) - (b.start || 0)));
}

/** La fase più "calda" di una nazione (voto batte candidature). */
function phaseByCountry(now = Date.now()) {
  const out = new Map();
  for (const r of openElectionRows(state.openElections, now)) {
    const cur = out.get(r.countryId);
    if (!cur || (cur === 'candidacy' && r.phase === 'voting')) out.set(r.countryId, r.phase);
  }
  return out;
}

/** Affluenza di adesso per nazione dove si vota: la più alta fra le sue
 *  elezioni aperte (null se la popolazione non si sa). */
export function turnoutByCountry(now = Date.now()) {
  const out = new Map();
  for (const r of openElectionRows(state.openElections, now)) {
    if (r.phase !== 'voting') continue;
    const cur = out.get(r.countryId);
    if (!out.has(r.countryId) || (r.turnout != null && (cur == null || r.turnout > cur))) out.set(r.countryId, r.turnout);
  }
  return out;
}

export function buildPoliticsColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const phases = phaseByCountry();
  if (!phases.size) return COLORS.DEFAULT_LAND;
  const turnouts = turnoutByCountry();
  const expr = ['match', ['get', prop]];
  for (const [id, phase] of phases) {
    expr.push(id, phase === 'voting' ? turnoutColor(turnouts.get(id)) : POLITICS_COLORS[phase]);
  }
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}

export function getPoliticsStats() {
  const rows = openElectionRows();
  const phases = phaseByCountry();
  let voting = 0, candidacy = 0;
  for (const p of phases.values()) { if (p === 'voting') voting++; else candidacy++; }
  const ts = [...turnoutByCountry().values()].filter(t => t != null);
  return {
    voting, candidacy,
    // Media semplice per nazione: è "quanto si vota in una nazione tipo",
    // non pesata sulla popolazione (la peserebbe tutta sulle grandi).
    avgTurnout: ts.length ? ts.reduce((s, t) => s + t, 0) / ts.length : null,
    maxTurnout: ts.length ? Math.max(...ts) : null,
    presidential: rows.filter(r => r.type === 'president').length,
    congress: rows.filter(r => r.type === 'congress').length,
    votes: rows.filter(r => r.phase === 'voting').reduce((s, r) => s + r.votes, 0),
  };
}
