/* ══════════════════════════════════════════════════════════════
   WarEra+ — Quanto è costata una battaglia
   ------------------------------------------------------------------
   Richiesta della community: «nessuno riesce a calcolare quanto si è
   speso di taglie e contratti mercenari in una battaglia, e per le
   nazioni sarebbe utile saperlo».

   In WarEra i soldi che una nazione mette in una battaglia escono da due
   rubinetti distinti, che l'interfaccia del gioco non somma da nessuna
   parte:

   1. TAGLIA (bounty) — ogni schieramento ha un salvadanaio (`moneyPool`)
      e una tariffa (`moneyPer1kDamages`): ad ogni colpo il salvadanaio
      paga chi ha fatto danno. Quanto è GIÀ USCITO non sta nell'oggetto
      battaglia (lì c'è solo il residuo): sta nella classifica "money"
      della battaglia, che è la stessa cosa vista dal lato di chi
      incassa. Sommando la classifica per nazione di uno schieramento si
      ottiene la taglia effettivamente pagata da quello schieramento.
   2. CONTRATTI MERCENARI — aste al ribasso che una nazione apre per
      ingaggiare unità militari (`mercenaryContractAuction`). Costano
      solo quelle aggiudicate (`status: 'won'`): `currentPayout` è la
      cifra pattuita. Quelle ancora aperte (`status: 'active'`) sono
      impegni, non spesa — qui vengono tenute separate e dichiarate tali.

   Le due voci si possono SOMMARE senza doppi conteggi: le regole del gioco
   dicono esplicitamente che i colpi fatti per un contratto non incassano
   anche la taglia ("Hits for the contract cannot also earn bounty",
   codex WarEra / warera.wiki). Sono due portafogli distinti, ed è proprio
   questo che rende il totale un numero sensato.

   Tutte e tre le procedure usate sono PUBBLICHE su API_BASE_URL (api6),
   verificate senza chiave: non passano dal Worker e non ne consumano il
   budget. Un aggiornamento completo = 1 batch (+ eventuali pagine extra
   delle aste, solo se la battaglia ne ha più di 50).

   ⚠️ Cosa NON è: la taglia pagata è quella distribuita FINORA. Su una
   battaglia in corso cresce ad ogni round — la UI la etichetta come
   "finora", non come totale finale.

   ⚠️ Non conteggiato di proposito: la penale del 10% che l'emittente paga
   quando annulla un'asta. Servirebbe una quarta chiamata (status
   'cancelled') per una voce quasi sempre nulla; se un giorno servisse, è
   una riga in più nel batch e un `× 0.10` sul budget.
   ══════════════════════════════════════════════════════════════ */

import { trpcBatch } from './utils.js';

// Tetti dell'API misurati dal vivo: `limit` delle aste si ferma a 50,
// quello della classifica accetta almeno 100 (77 nazioni in una battaglia
// grossa ci stanno in una pagina sola).
const AUCTION_PAGE = 50;
const RANKING_LIMIT = 100;
// Quante pagine extra si è disposti a inseguire col cursore prima di
// dichiarare il dato troncato. Una battaglia con oltre 250 contratti
// aggiudicati non si è mai vista; il tetto c'è per non trasformare un
// caso limite in una raffica di richieste.
const MAX_EXTRA_PAGES = 4;

// Cache in memoria per la sessione: il tooltip battaglia si riapre spesso
// sullo stesso marker mentre si guarda la mappa, e questi numeri si
// muovono al ritmo dei round (~minuti), non dei secondi.
const TTL_MS = 60 * 1000;
const _cache = new Map(); // battleId -> { at, data }

function _sumRanking(res) {
  const items = res?.items;
  if (!Array.isArray(items)) return null;
  const byCountry = items
    .map(it => ({ countryId: it.country, value: Number(it.value) || 0 }))
    .filter(x => x.countryId);
  return {
    total: byCountry.reduce((s, x) => s + x.value, 0),
    byCountry,
    // La classifica è paginata: se resta un cursore, la somma è un minimo.
    truncated: Boolean(res?.nextCursor),
  };
}

/* Le aste arrivano tutte insieme (aggiudicate e ancora aperte) e vengono
   divise QUI per schieramento e per nazione pagante. Attenzione: chi paga
   (`country`) non è per forza la nazione che combatte (`forCountry`) — un
   alleato può finanziare contratti per il fronte altrui, ed è proprio uno
   dei casi che rende il totale interessante. */
function _foldAuctions(list) {
  const empty = () => ({ total: 0, count: 0, byCountry: new Map() });
  const out = { attacker: empty(), defender: empty() };
  for (const a of list) {
    const side = a?.forCountrySide === 'defender' ? 'defender' : 'attacker';
    const payer = a?.country;
    const amount = Number(a?.currentPayout);
    if (!payer || !Number.isFinite(amount)) continue;
    const bucket = out[side];
    bucket.total += amount;
    bucket.count += 1;
    bucket.byCountry.set(payer, (bucket.byCountry.get(payer) || 0) + amount);
  }
  // Da Map a lista ordinata: la UI vuole solo leggerla in ordine di spesa.
  for (const side of ['attacker', 'defender']) {
    out[side].byCountry = [...out[side].byCountry.entries()]
      .map(([countryId, value]) => ({ countryId, value }))
      .sort((a, b) => b.value - a.value);
  }
  return out;
}

// Insegue il cursore di una lista di aste finché ce n'è (entro il tetto).
// Ogni pagina è una richiesta singola: succede solo su battaglie con più
// di 50 contratti dello stesso stato.
async function _drainAuctions(battleId, status, firstPage) {
  const items = [...(firstPage?.items || [])];
  let cursor = firstPage?.nextCursor;
  let pages = 0;
  let truncated = false;
  while (cursor && pages < MAX_EXTRA_PAGES) {
    const [page] = await trpcBatch([
      ['mercenaryContractAuction.getPaginatedAuctions', { battleId, status, limit: AUCTION_PAGE, cursor }],
    ]);
    if (!page?.items?.length) break;
    items.push(...page.items);
    cursor = page.nextCursor;
    pages += 1;
  }
  if (cursor) truncated = true;
  return { items, truncated };
}

/**
 * Spesa di una battaglia, per schieramento.
 * @returns {Promise<null|{
 *   bounty: { attacker: object|null, defender: object|null },
 *   merc: { won: object, pending: object },
 *   truncated: boolean,
 * }>} `null` se l'API non risponde affatto (la UI lo tratta come "dato
 * non disponibile" e non mostra la sezione).
 */
export async function fetchBattleSpending(battleId) {
  if (!battleId) return null;

  const hit = _cache.get(battleId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;

  const [moneyAtk, moneyDef, wonPage, activePage] = await trpcBatch([
    ['battleRanking.getRanking', { battleId, dataType: 'money', type: 'country', side: 'attacker', limit: RANKING_LIMIT }],
    ['battleRanking.getRanking', { battleId, dataType: 'money', type: 'country', side: 'defender', limit: RANKING_LIMIT }],
    ['mercenaryContractAuction.getPaginatedAuctions', { battleId, status: 'won', limit: AUCTION_PAGE }],
    ['mercenaryContractAuction.getPaginatedAuctions', { battleId, status: 'active', limit: AUCTION_PAGE }],
  ]);

  // Tutte e quattro a vuoto = l'API non ha risposto (rete giù, 429 dopo i
  // retry di trpcBatch). Una lista vuota è invece un dato legittimo
  // ("nessun contratto in questa battaglia") e va mostrata come zero.
  if (!moneyAtk && !moneyDef && !wonPage && !activePage) return null;

  const won = await _drainAuctions(battleId, 'won', wonPage);
  const active = await _drainAuctions(battleId, 'active', activePage);

  const bountyAtk = _sumRanking(moneyAtk);
  const bountyDef = _sumRanking(moneyDef);

  const data = {
    bounty: { attacker: bountyAtk, defender: bountyDef },
    merc: { won: _foldAuctions(won.items), pending: _foldAuctions(active.items) },
    truncated: Boolean(bountyAtk?.truncated || bountyDef?.truncated || won.truncated || active.truncated),
  };

  _cache.set(battleId, { at: Date.now(), data });
  return data;
}

/** Svuota la cache (usato dai test manuali; nessun chiamante in app). */
export function clearBattleSpendingCache() {
  _cache.clear();
}
