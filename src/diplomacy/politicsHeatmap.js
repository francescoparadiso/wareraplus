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
   ══════════════════════════════════════════════════════════════ */

import { COLORS } from './config.js';
import { state } from './state.js';

export const POLITICS_COLORS = {
  voting: '#e05252',
  candidacy: '#c5964a',
};

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

export function buildPoliticsColorExpression(isOriginal = false) {
  const prop = isOriginal ? 'initialCountryId' : 'countryId';
  const phases = phaseByCountry();
  if (!phases.size) return COLORS.DEFAULT_LAND;
  const expr = ['match', ['get', prop]];
  for (const [id, phase] of phases) expr.push(id, POLITICS_COLORS[phase]);
  expr.push(COLORS.DEFAULT_LAND);
  return expr;
}

export function getPoliticsStats() {
  const rows = openElectionRows();
  const phases = phaseByCountry();
  let voting = 0, candidacy = 0;
  for (const p of phases.values()) { if (p === 'voting') voting++; else candidacy++; }
  return {
    voting, candidacy,
    presidential: rows.filter(r => r.type === 'president').length,
    congress: rows.filter(r => r.type === 'congress').length,
    votes: rows.filter(r => r.phase === 'voting').reduce((s, r) => s + r.votes, 0),
  };
}
