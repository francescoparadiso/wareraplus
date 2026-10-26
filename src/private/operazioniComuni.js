/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — operazioni: il pezzo comune a lavagna e mappa
   ------------------------------------------------------------------
   La lavagna (operazioni.js) e la mappa (mappaOperazione.js) devono
   dire la stessa cosa dello stesso passo: lo stesso numero, lo stesso
   stato, lo stesso orario, gli stessi colori. Qui, una volta sola, e
   non in uno dei due importato dall'altro (che si importano a vicenda).
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { nomeNazione } from './battles.js';
import { regionName } from '../diplomacy/travelDistance.js';

/** I colori degli stati, uguali sulla scheda e sulla freccia in mappa.
 *  Chiari di proposito: la mappa ha fondi scuri, e una freccia scura
 *  sull'oceano notturno non si vede. In private.css la stessa tavolozza
 *  (`.wp-pv-op-st-*`). */
export const COLORI_STATO = {
  da_fare: '#cbd5e1',
  attesa: '#f59e0b',
  in_corso: '#60a5fa',
  fatta: '#34d399',
  fallita: '#f87171',
  annullata: '#94a3b8',
};

/** Lo stato come si mostra: `attesa` se un precedente non è ancora
 *  fatto. Un precedente annullato non blocca più nessuno; uno fallito sì
 *  — il piano va rivisto, non ignorato. */
export function statoVisto(p, perId) {
  if (p.stato !== 'da_fare') return p.stato;
  const blocca = p.dopo.some((id) => {
    const q = perId.get(id);
    return q && q.stato !== 'fatta' && q.stato !== 'annullata';
  });
  return blocca ? 'attesa' : 'da_fare';
}

/** Il numero di ogni passo: in ordine di orario, chi non ne ha in fondo.
 *  È lo stesso numero sulla scheda e sulla mappa. */
export function numeriPassi(passi) {
  const ordinati = [...passi].sort((a, b) => ((a.quando ?? Infinity) - (b.quando ?? Infinity)) || (a.id - b.id));
  return new Map(ordinati.map((p, i) => [p.id, i + 1]));
}

/** Ora breve: "20:30" oggi, "23/10 20:30" un altro giorno. */
export function oraBreve(ms) {
  if (!ms) return '';
  const d = new Date(ms);
  const hm = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  if (d.toDateString() === new Date().toDateString()) return hm;
  return `${d.toLocaleDateString(undefined, { day: '2-digit', month: '2-digit' })} ${hm}`;
}

/** "Lombardia (Italia)": il nome da solo non basta, ce ne sono di uguali. */
export function etichettaRegione(id) {
  if (!id) return '';
  const nome = regionName(id);
  const paese = nomeNazione(state.regionData?.[id]?.country);
  return paese ? `${nome} (${paese})` : nome;
}
