/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — le battaglie su cui si può chiedere
   ------------------------------------------------------------------
   La prima cosa che un comandante vuole sapere è "dove posso portare
   la mia unità stasera". Prima era un menù a tendina dentro un modulo:
   quarantasei voci fra cui scegliere alla cieca, senza sapere quali
   pagano.

   ── ORDINATE PER QUANTO HANNO GIÀ PAGATO ───────────────────────────
   Il danno fatto finora è il segnale migliore che si abbia a costo
   zero: una battaglia dove si è già picchiato molto è una battaglia
   dove le taglie stanno uscendo, e presumibilmente continueranno.
   Arriva già dentro `/battles` (currentRound), quindi ordinare non
   costa niente.

   La taglia VERA — quanto è materialmente uscito dal salvadanaio —
   richiede `battleRanking.getRanking dataType money`, una chiamata per
   battaglia e per lato. Su quarantasei battaglie sarebbero novantadue
   richieste per disegnare una lista: troppe. Si prendono quindi solo
   per le prime della classifica, in UN batch, dove il numero serve
   davvero a decidere.

   ── SOLO QUELLE SU CUI SI PUÒ DAVVERO CHIEDERE ─────────────────────
   La lista è filtrata sulle nazioni che ammettono la propria unità
   (`/policy/mie/nazioni`, una chiamata). Mostrare battaglie su cui poi
   si prende un rifiuto è peggio che non mostrarle: promette e poi
   accusa.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { trpcBatch } from '../diplomacy/utils.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { fetchMoneyTransfers, transfersFor, windowIsShort } from '../battles/moneyTransfers.js';

/** Quante battaglie arricchire con la taglia vera. Oltre la decina il
 *  numero non cambia più una decisione: si sceglie fra le prime. */
const CON_TAGLIA = 10;

export function nomeNazione(id) { return state.nationMap?.get(id)?.name || null; }
export function nomeRegione(id) { return state.regionData?.[id]?.name || null; }

/** La tinta con cui la nazione e' dipinta sulla mappa. Usarla anche qui
 *  fa si' che "il verde" sia lo stesso verde di la': un colore inventato
 *  per questa vista sarebbe un secondo vocabolario da imparare. */
export function coloreNazione(id) {
  return state.nationBaseColorMap?.get(id) || null;
}

export function urlBandiera(id) {
  const n = state.nationMap?.get(id);
  if (!n) return null;
  return getFlagUrl(getNationCode(id, n)) || null;
}

/** Danno fatto nel round in corso, i due lati sommati. Il campo `damages`
 *  a livello di battaglia è risultato sempre 0 (misurato): quello vivo
 *  sta dentro `currentRound`. */
export function dannoBattaglia(b) {
  const cr = b?.currentRound || {};
  return (cr.attacker?.damages || 0) + (cr.defender?.damages || 0);
}

export function etichettaBattaglia(b) {
  if (!b) return '?';
  const regione = nomeRegione(b.defender?.region) || nomeRegione(b.attacker?.region);
  const att = nomeNazione(b.attacker?.country);
  const dif = nomeNazione(b.defender?.country);
  if (regione && att && dif) return `${regione} — ${att} → ${dif}`;
  if (att && dif) return `${att} → ${dif}`;
  // Succede sulle battaglie di torneo, dove non c'è una nazione ma una
  // squadra: meglio dirlo che stampare un id esadecimale.
  return regione || b?._id || '?';
}

export function schieramenti(b) {
  if (!b) return [];
  return [
    { side: 'attacker', countryId: b.attacker?.country, nome: nomeNazione(b.attacker?.country) },
    { side: 'defender', countryId: b.defender?.country, nome: nomeNazione(b.defender?.country) },
  ].filter((s) => s.countryId);
}

/**
 * Prepara l'elenco: filtra sulle nazioni ammesse, ordina per danno,
 * arricchisce le prime con la taglia realmente pagata.
 * @param {object[]} battaglie   da /battles
 * @param {Set<string>} nazioniAmmesse
 */
export async function preparaBattaglie(battaglie, nazioniAmmesse) {
  const utili = (battaglie || [])
    .filter((b) => b.isActive !== false)
    .map((b) => {
      const cr = b.currentRound || {};
      return {
        raw: b,
        id: b._id,
        etichetta: etichettaBattaglia(b),
        regione: nomeRegione(b.defender?.region) || nomeRegione(b.attacker?.region),
        danno: dannoBattaglia(b),
        // Il danno diviso per schieramento: "chi sta picchiando" e' una
        // domanda diversa da "quanto si sta picchiando", e per decidere
        // dove portare un'unita' conta la prima.
        parti: schieramenti(b).map((sd) => ({
          ...sd,
          danno: cr[sd.side]?.damages || 0,
          colpi: cr[sd.side]?.hitCount || 0,
          colore: coloreNazione(sd.countryId),
          bandiera: urlBandiera(sd.countryId),
          ammessa: nazioniAmmesse.has(sd.countryId),
        })),
        inizio: b.createdAt ? new Date(b.createdAt).getTime() : null,
        lati: schieramenti(b).filter((sd) => nazioniAmmesse.has(sd.countryId)),
      };
    })
    .filter((b) => b.lati.length)
    .sort((x, y) => y.danno - x.danno);

  await aggiungiTaglie(utili.slice(0, CON_TAGLIA));

  // Riordino: dove la taglia VERA si conosce, e' quella a decidere. Il
  // danno era solo il miglior segnale disponibile a costo zero, ma non
  // sono la stessa cosa — misurato: una battaglia con 121M di danno
  // aveva pagato piu' di una da 270M. Chi ha il numero vero passa
  // davanti a chi ha solo la stima.
  const conTaglia = utili.filter((b) => b.taglia != null).sort((x, y) => y.taglia - x.taglia);
  const senza = utili.filter((b) => b.taglia == null);
  return [...conTaglia, ...senza];
}

/** Taglia già pagata, dalle classifiche money dei due schieramenti.
 *  Un solo batch per tutte le battaglie da arricchire. */
async function aggiungiTaglie(prime) {
  if (!prime.length) return;
  const chiamate = [];
  for (const b of prime) {
    for (const lato of ['attacker', 'defender']) {
      chiamate.push(['battleRanking.getRanking',
        { battleId: b.id, dataType: 'money', type: 'country', side: lato, limit: 50 }]);
    }
  }
  try {
    const risposte = await trpcBatch(chiamate);
    prime.forEach((b, i) => {
      const somma = (r) => {
        const items = Array.isArray(r) ? r : (r?.items || []);
        return items.reduce((t, x) => t + (x?.value || 0), 0);
      };
      b.taglia = somma(risposte[i * 2]) + somma(risposte[i * 2 + 1]);
    });
  } catch (err) {
    // La taglia è un di più: senza, l'elenco resta ordinato per danno e
    // perfettamente usabile. Non si fa cadere una vista per un numero.
    console.warn('[area riservata] taglie non disponibili:', err.message);
  }
}


// ---------------------------------------------------------------------------
// Finanziatori
// ---------------------------------------------------------------------------
// Chi sta versando nel tesoro dei belligeranti mentre la battaglia e'
// aperta. Non e' un dettaglio da curiosi: un tesoro che si sta riempiendo
// e' un tesoro che paghera' le taglie, ed e' esattamente quello che un
// comandante vuole sapere prima di impegnare l'unita' per cinque minuti.
//
// ⚠️ Costa UNA fetch per sessione, non una per battaglia: il modulo
// scarica la lista globale dei bonifici e la si filtra in memoria sulla
// finestra della singola battaglia. Aprire venti battaglie costa quanto
// aprirne una. La copertura dell'API e' di ~3 giorni: per una battaglia
// piu' vecchia windowIsShort() dice "fuori portata", che e' diverso da
// "nessuno ha finanziato".

let _bonifici = null;
let _bonificiPromessa = null;

export async function caricaFinanziatori() {
  if (_bonifici) return _bonifici;
  if (!_bonificiPromessa) {
    _bonificiPromessa = fetchMoneyTransfers()
      .then((d) => { _bonifici = d; return d; })
      .catch(() => null);
  }
  return _bonificiPromessa;
}

/** I finanziatori dei due schieramenti di una battaglia, gia' pronti da
 *  disegnare. `fuoriPortata` distingue "non lo sappiamo" da "nessuno". */
export function finanziatoriDi(b) {
  if (!_bonifici || !b?.inizio) return null;
  const perParte = b.parti.map((p) => ({
    countryId: p.countryId,
    nome: p.nome,
    colore: p.colore,
    voci: transfersFor(_bonifici, p.countryId, b.inizio, Date.now()).slice(0, 5),
  }));
  return {
    fuoriPortata: windowIsShort(_bonifici, b.inizio),
    perParte: perParte.filter((p) => p.voci.length),
  };
}
