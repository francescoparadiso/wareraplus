/* ══════════════════════════════════════════════════════════════
   WarEra+ — gli Accordi sulla mappa
   ------------------------------------------------------------------
   I patti di non belligeranza scritti nella sezione Accordi
   (src/accordi/*, archivio su warera-plus-api) diventano NAP sulla
   mappa finché sono in vigore. Dal 2026-10-23 sono l'UNICA fonte dei NAP
   "esterni": il CSV warera_naps.csv non si carica più.

   Si appoggiano a `state.externalNapsSet` / `externalNapsList` invece di
   aprire un terzo insieme: le quattro letture che decidono il colore
   (getRelationKey, buildOriginalColorExpression, borderStyle, contatori
   della legenda) guardano già quelli, e un insieme in più sarebbe un
   quinto posto da ricordarsi di toccare. Le voci portano
   `source: 'accordi'` e si rifanno da capo a ogni giro.

   Un patto fra alleanze vale per i membri di ADESSO: si espande in
   coppie di nazioni a ogni applicazione, dalle alleanze già in memoria
   (state.alliancesList), senza una fetch in più.

   Il server può non rispondere: la mappa resta con gli accordi dell'ultima
   lettura riuscita (alla prima, senza NAP esterni), in silenzio.
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { WARERA_PLUS_API_BASE } from './config.js';

const RILETTURA_MS = 10 * 60_000;

let _accordi = [];
// Le chiavi che QUESTO modulo ha messo nell'insieme. Oggi è l'unica
// fonte, ma i NAP manuali stanno altrove (customNaps) e chi aggiungesse un
// domani una seconda fonte qui non deve vedersele cancellare.
let _aggiunte = new Set();
let _timer = null;

/** In vigore adesso: cominciato e non ancora finito. */
export function accordoInVigore(a, ora = Date.now()) {
  return a.inizio <= ora && (a.fine == null || a.fine > ora);
}

/** Le nazioni di una parte, adesso. */
/** Le nazioni di una parte, adesso: la nazione o i membri dell'alleanza,
 *  più le nazioni AGGIUNTE (proxy, alleati fuori dall'alleanza). */
export function nazioniParte(parte) {
  if (!parte) return [];
  let base;
  if (parte.tipo === 'nazione') base = [parte.id];
  else {
    const all = (state.alliancesList || []).find(x => x._id === parte.id);
    base = all
      ? (all.memberCountries || []).map(m => m.country).filter(Boolean)
      : (state.nazioniGlobal || []).filter(n => n.allianceId === parte.id).map(n => n._id);
  }
  return [...new Set([...base, ...(parte.aggiunte || [])])];
}

function applica() {
  for (const k of _aggiunte) state.externalNapsSet.delete(k);
  _aggiunte = new Set();
  state.externalNapsList = state.externalNapsList.filter(n => n.source !== 'accordi');

  const ora = Date.now();
  for (const a of _accordi) {
    if (!accordoInVigore(a, ora)) continue;
    const A = nazioniParte(a.parteA);
    const B = nazioniParte(a.parteB);
    for (const x of A) {
      for (const y of B) {
        if (x === y) continue;
        const k = `${x}-${y}`;
        if (state.externalNapsSet.has(k) || state.externalNapsSet.has(`${y}-${x}`)) continue;
        state.externalNapsSet.add(k);
        _aggiunte.add(k);
        state.externalNapsList.push({
          fromId: x, toId: y,
          fromName: state.nationMap.get(x)?.name || x,
          toName: state.nationMap.get(y)?.name || y,
          source: 'accordi', accordoId: a.id,
        });
      }
    }
  }
}

async function ridisegna() {
  try {
    const [{ renderMap }, { updateExternalNapsUI }] = await Promise.all([import('./map.js'), import('./ui.js')]);
    updateExternalNapsUI();
    renderMap();
  } catch (err) {
    console.warn('[accordi] mappa non ridisegnata:', err);
  }
}

/** La sezione Accordi ha appena salvato: l'elenco nuovo arriva già con
 *  la risposta, niente seconda lettura. */
export function impostaAccordiSullaMappa(accordi) {
  _accordi = Array.isArray(accordi) ? accordi : [];
  applica();
  ridisegna();
}

export async function loadAccordiNaps() {
  try {
    const res = await fetch(`${WARERA_PLUS_API_BASE}/accordi`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const body = await res.json();
    impostaAccordiSullaMappa(body?.accordi || []);
  } catch (err) {
    // Server giù o rotta non ancora deployata (404): resta l'ultima
    // lettura buona. Si riprova al giro dopo.
    console.warn('[accordi] elenco non disponibile:', err.message);
  }
  // Un patto scade o comincia anche senza che nessuno lo tocchi: il giro
  // lo riapplica (e rilegge quelli scritti da altri nel frattempo).
  if (!_timer) _timer = setInterval(loadAccordiNaps, RILETTURA_MS);
}
