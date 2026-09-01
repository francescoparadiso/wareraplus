/* ══════════════════════════════════════════════════════════════
   WarEra+ — Finanziamenti fra nazioni (chi manda soldi a chi)
   ------------------------------------------------------------------
   Serve a una domanda che l'archivio battaglie non sapeva rispondere:
   dietro a uno schieramento, CHI ha messo i soldi. Non i contratti
   mercenari (quelli si vedono già) e non la taglia (quella la paga il
   belligerante): i bonifici da tesoro a tesoro, `countryMoneyTransfer`.

   ── PERCHÉ UNA LISTA SOLA PER TUTTA LA SESSIONE ────────────────────
   L'endpoint non filtra per battaglia né per finestra temporale: sa
   solo tornare i trasferimenti dal più recente all'indietro. Ma sono
   POCHI — misurati sul vivo: 104 bonifici in 70 ore, cioè ~36 al
   giorno in tutto il mondo, e il cursore si esaurisce in tre pagine.
   Quindi la strategia giusta non è chiedere ad ogni battaglia aperta,
   è scaricare UNA volta l'intera finestra disponibile e poi filtrarla
   in memoria: aprire venti battaglie costa le stesse tre richieste di
   aprirne una.

   ⚠️ RICHIEDE LA CHIAVE. Su api6 questa procedura risponde 401, quindi
   passa dal proxy (`useWorker: true` → src/shared/trpcProxy.js → VPS,
   Worker come riserva). È l'unico motivo per cui non è gratis come i
   prezzi di mercato.

   ── QUELLO CHE L'API NON HA ────────────────────────────────────────
   La finestra si ferma dove si ferma: nelle misure ~3 giorni, poi il
   cursore finisce. Per le battaglie più vecchie di così non esiste un
   "nessun finanziamento", esiste un "non lo sappiamo" — e i due non
   vanno confusi in una tabella vuota. Per questo `oldestAt` viene
   esposto insieme ai dati: chi disegna deve poter dire quale delle due
   cose sta guardando.
   ══════════════════════════════════════════════════════════════ */

import { trpcCall } from '../shared/trpcClient.js';

// Tetto di sicurezza: se un giorno l'API smettesse di esaurire il
// cursore, meglio fermarsi che sfogliare all'infinito.
const MAX_PAGES = 8;
const PAGE = 50;
// I bonifici sono ~36 al giorno: ricontrollare più spesso di così è
// sprecare richieste su una lista che quasi sempre è identica.
const TTL_MS = 5 * 60 * 1000;

let _cache = null;      // { at, transfers, oldestAt, complete }
let _inFlight = null;

const _ts = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };

/**
 * Tutti i trasferimenti fra tesori che l'API ancora ricorda.
 * @returns {Promise<{transfers:{from:string,to:string,money:number,at:number}[],
 *                    oldestAt:number|null, complete:boolean}|null>}
 *   `oldestAt` = il bonifico più vecchio raggiunto: prima di quel momento
 *   l'assenza di righe NON significa che non ci siano stati finanziamenti.
 *   null se la rete non ha risposto affatto (diverso da "lista vuota").
 */
export function fetchMoneyTransfers() {
  if (_cache && Date.now() - _cache.at < TTL_MS) return Promise.resolve(_cache);
  if (_inFlight) return _inFlight;

  _inFlight = (async () => {
    const rows = [];
    let cursor = null;
    let complete = false;

    try {
      for (let page = 0; page < MAX_PAGES; page++) {
        const input = { transactionType: 'countryMoneyTransfer', limit: PAGE };
        if (cursor) input.cursor = cursor;
        const res = await trpcCall('transaction.getPaginatedTransactions', input, { useWorker: true });
        const items = res?.items || [];
        for (const t of items) {
          const at = _ts(t.createdAt);
          const money = Number(t.money);
          if (!at || !Number.isFinite(money)) continue;
          if (!t.sellerCountryId || !t.buyerCountryId) continue;
          // seller = chi manda, buyer = chi riceve. Nomi dell'API, non
          // nostri: qui non si compra niente, è un bonifico.
          rows.push({ from: t.sellerCountryId, to: t.buyerCountryId, money, at });
        }
        cursor = res?.nextCursor || null;
        if (!cursor) { complete = true; break; }
      }
    } catch (_) {
      // Rete o proxy giù. Se qualcosa era già arrivato lo teniamo, ma
      // senza `complete`: la vista deve sapere che la lista è monca.
      if (!rows.length) { _inFlight = null; return null; }
    }

    _cache = {
      at: Date.now(),
      transfers: rows,
      oldestAt: rows.length ? Math.min(...rows.map(r => r.at)) : null,
      complete,
    };
    _inFlight = null;
    return _cache;
  })();

  return _inFlight;
}

/**
 * I finanziamenti ARRIVATI a una nazione mentre la battaglia era aperta.
 * Il filtro è sulla finestra della battaglia, non sul giorno: due
 * battaglie nello stesso giorno hanno finanziatori diversi, e attribuire
 * a entrambe lo stesso bonifico sarebbe contarlo due volte.
 *
 * @param {object} data risultato di fetchMoneyTransfers()
 * @param {string} countryId nazione che RICEVE
 * @param {number} fromMs inizio battaglia
 * @param {number} toMs fine battaglia (o adesso, se in corso)
 */
export function transfersFor(data, countryId, fromMs, toMs) {
  if (!data || !countryId || !fromMs) return [];
  const end = Number.isFinite(toMs) ? toMs : Date.now();
  return data.transfers
    .filter(t => t.to === countryId && t.at >= fromMs && t.at <= end)
    .sort((a, b) => b.money - a.money);
}

/** Vero se la battaglia è iniziata prima di dove arriva la nostra
 *  finestra: in quel caso una tabella vuota non è una risposta. */
export function windowIsShort(data, fromMs) {
  if (!data || !fromMs) return false;
  return Boolean(data.oldestAt && fromMs < data.oldestAt);
}
