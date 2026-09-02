/* ══════════════════════════════════════════════════════════════
   WarEra+ — Referral totali di una unità militare
   ------------------------------------------------------------------
   WarEra NON espone chi ha invitato chi: sull'utente non esiste nessun
   campo `referrer`/`referredBy` né la lista degli invitati (verificato il
   2026-09-02 su un profilo di livello 50 e su sei account creati lo stesso
   giorno, uno dei quali ancora in onboarding). L'unica traccia è un
   CONTATORE aggregato per giocatore, `rankings.userReferrals.value`.

   Il totale per unità però non costa una chiamata per membro, perché
   `ranking.getRanking { rankingType: 'userReferrals' }` porta ogni voce
   già corredata di `user`, `mu` e `country`: il totale di una MU è un
   raggruppamento in memoria su una risposta sola. Misurato il 2026-09-02:
   17.264 giocatori in classifica, 10.796 referral in tutto il mondo,
   distribuiti su 997 unità.

   PERCHÉ UNA FETCH DIRETTA E NON trpcCall/trpcProxy. La procedura è
   PUBBLICA (nessuna chiave, come itemTrading.getPrices per il mercato):
   passarla dal Worker o dal VPS spenderebbe budget condiviso per un dato
   che api6 dà a chiunque. È una GET sola per sessione — non un ciclo di
   fetch, che è quello contro cui esiste la regola del batching. Peso reale
   sul filo: 421 KB gzip in ~0,4 s (2,9 MB scompattati), scaricati solo
   quando l'utente apre davvero l'elenco unità.

   ⚠️ DUE LIMITI, dichiarati perché la colonna non dica più di quel che sa:

     · il campo `mu` della classifica è la FOTOGRAFIA dell'appartenenza a
       quando il gioco ha costruito il ranking, non quella di adesso: un
       membro appena passato di unità conta ancora sulla precedente finché
       la classifica non si rifà. Su un controllo dal vivo (Luftwaffe, 24
       membri) i membri visti dalla classifica erano 23 su 24 e nessun
       fantasma;
     · chi non compare nella classifica conta zero. Non è una stima
       ottimistica: incrociando `userReferrals` con `userLevel` risulta che
       TUTTI i 10.796 referral appartengono a giocatori oltre il livello
       10, e sotto quella soglia non ce n'è nemmeno uno — coerente col
       fatto che il referente si può impostare solo fino al livello 10
       (`gameConfig.referral.canSetReferrerBeforeOrAtLevel`).

   Come tutto ciò che è un di più (vedi shared/dailyDamage.js), se la
   chiamata fallisce si ritorna null e la colonna resta un trattino:
   l'elenco funziona come prima.
   ══════════════════════════════════════════════════════════════ */

import { API_BASE_URL } from '../diplomacy/config.js';

const TIMEOUT_MS = 15000; // ~420 KB gzip: più generoso degli 8s della directory

let _byMu = null;      // Map muId -> { total, known, top }
let _promise = null;
let _fetchedAt = null;

/** Scarica (una volta per sessione) la classifica referral e la raggruppa
 *  per unità. Ritorna la mappa, o null se non è disponibile. */
export function ensureMuReferrals() {
  if (_byMu) return Promise.resolve(_byMu);
  if (_promise) return _promise;
  _promise = _fetchReferralRanking()
    .then(items => {
      _byMu = _groupByMu(items);
      _fetchedAt = Date.now();
      return _byMu;
    })
    .catch(err => {
      console.warn('WarEra+ mu: classifica referral non disponibile:', err.message);
      _promise = null; // riprovabile alla prossima apertura della vista
      return null;
    });
  return _promise;
}

/** Referral totali dell'unità, o null finché la classifica non è scesa. */
export function muReferrals(mu) {
  return _byMu?.get(mu?._id)?.total ?? null;
}

/** Come sopra ma col contorno per il tooltip: quanti membri la classifica
 *  copre davvero (`known`) e quanti ne ha portati il migliore (`top`) —
 *  serve a non far leggere come lavoro di squadra un totale che è di uno
 *  solo, che è il caso normale (il primo al mondo ne ha 515 da solo). */
export function muReferralsInfo(mu) {
  return _byMu?.get(mu?._id) || null;
}

/** Quando la classifica è stata scaricata (epoch ms), o null. */
export function referralsFetchedAt() {
  return _fetchedAt;
}

async function _fetchReferralRanking() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const input = encodeURIComponent(JSON.stringify({ rankingType: 'userReferrals' }));
    const res = await fetch(`${API_BASE_URL}/trpc/ranking.getRanking?input=${input}`, { signal: controller.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    // Sbucciatura tollerante alle due forme superjson, come trpcBatchManual.
    const data = json?.result?.data?.json ?? json?.result?.data;
    const items = data?.items;
    if (!Array.isArray(items) || !items.length) throw new Error('forma inattesa o classifica vuota');
    return items;
  } finally {
    clearTimeout(timeout);
  }
}

function _groupByMu(items) {
  const map = new Map();
  for (const it of items) {
    if (!it?.mu) continue; // giocatore senza unità: non contribuisce a nessuna riga
    const v = typeof it.value === 'number' ? it.value : 0;
    const agg = map.get(it.mu);
    if (agg) {
      agg.total += v;
      agg.known++;
      if (v > agg.top) agg.top = v;
    } else {
      map.set(it.mu, { total: v, known: 1, top: v });
    }
  }
  return map;
}
