/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Soldi bloccati negli ordini d'acquisto
   -----------------------------------------------------------------------
   La domanda: «quanti soldi stanno fermi nel mercato, e di chi sono?».
   Il gioco non lo dice da nessuna parte: `tradingOrder.getTopOrders` è
   pubblica ma mostra un libro alla volta, e nessuna procedura pubblica
   dice quanti soldi ha un giocatore (`user.getUserLite` non porta
   `money`, `inventory.getInventory` risponde 401 senza chiave).

   Un ordine d'acquisto è però l'unico pezzo del portafoglio di un
   giocatore che si vede: `quantity × price` sono soldi che hanno già
   lasciato le sue mani. Questo modulo li somma, ogni ora, per risorsa,
   per unità militare e per nazione del compratore.

   ── COSTO ─────────────────────────────────────────────────────────────
   Una richiesta a `itemTrading.getPrices` (per sapere quali risorse
   esistono, così una risorsa nuova entra da sola) e un batch di
   `getTopOrders`, una per risorsa, `limit: 100`. Tutto PUBBLICO, niente
   chiave, ~24 procedure all'ora.

   ── ⚠️ IL TETTO È 100, E SI DICHIARA ──────────────────────────────────
   `getTopOrders` accetta al massimo 100 ordini per lato (200 → errore di
   validazione, verificato il 2026-11-03). Su 24 risorse, 17 avevano già
   100 ordini d'acquisto: la coda dell'elenco, cioè gli ordini più bassi
   rispetto al mercato, NON si vede. Il totale è quindi un MINIMO. Ogni
   risorsa porta il flag `capped` e il prezzo più basso visto (`minPrice`),
   e la vista dice «almeno». Non si stima la coda: stimarla con un
   modello dell'orderbook darebbe un numero preciso e inventato.

   ── CHI È IL COMPRATORE ───────────────────────────────────────────────
   Ogni ordine porta `user` e, quando il giocatore l'ha messo a nome
   della sua unità, `mu`. La nazione si legge dalla mappa
   utente → nazione che il giro dei cittadini già tiene
   (`mu-user-countries`): zero richieste. Un compratore che non c'è in
   mappa finisce in `noCountry`, MAI assegnato a caso.

   ── TESORI ────────────────────────────────────────────────────────────
   Il totale dei tesori delle nazioni è `rankings.countryWealth` (non
   `money`, fermo da mesi: somma 54 mila contro 4,4 milioni, vedi
   dayHistory.js). Il campione orario lo porta con sé, e per i giorni
   precedenti al primo avvio la rotta aggiunge la serie giornaliera che
   `dayHistory.js` già conserva dal 13 aprile (`treasuryDaily`).

   ── ARCHIVIO ──────────────────────────────────────────────────────────
   Un campione all'ora per 14 giorni; più indietro, uno al giorno (l'ultimo
   del giorno italiano). Non si pota a giorni: un campione è quanto era
   fermo nel mercato in quel momento, e non si rifà. Costo: ~3 KB a
   campione, qualche MB all'anno. Un'ora saltata è un buco, mai uno zero.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const FILE = 'order-money';
const TZ = 'Europe/Rome';
const LIMITE_ORDINI = 100;               // il massimo che getTopOrders accetta
const ORARIO_GIORNI = 14;                // oltre, un campione al giorno
const MAX_FINESTRA_GIORNI = 3650;
const MU_USER_COUNTRIES_FILE = 'mu-user-countries';

/** Chiamato una volta dal server principale, prima di qualunque poll.
 *  `treasuryByDay` viene da dayHistory.js. */
function initOrderMoney(tools) {
  deps = tools;
}

// Soldi negli ordini per compratore, dell'ULTIMO campione: serve a
// playerParts.js (le parti della ricchezza di un giocatore). In memoria e
// non su disco: per giocatore il campione orario sarebbe ~700 righe all'ora
// per niente, e lo scatto giornaliero lo salva playerParts. null finché il
// primo campione dopo un avvio non c'è.
let _perUtente = null;
function orderMoneyByUser() { return _perUtente; }

let _mem = null;
function _read() {
  if (_mem) return _mem;
  _mem = deps.readCache(FILE, { fetchedAt: null, startedAt: null, samples: [] });
  if (!Array.isArray(_mem.samples)) _mem.samples = [];
  return _mem;
}
function _write(store) {
  _mem = store;
  deps.writeCache(FILE, store, { compact: true });
}

function giornoDi(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
}

const arrotonda = (v) => Math.round(v * 100) / 100;

/** Somma dei tesori: `countryWealth` di ogni nazione, dalla cache `countries`
 *  che il server riempie già. null se la cache non c'è. */
function _tesori() {
  const cache = deps.readCache('countries', null);
  const lista = cache?.data?.result?.data || cache?.data || [];
  if (!Array.isArray(lista) || !lista.length) return null;
  let somma = 0;
  for (const n of lista) {
    const v = n?.rankings?.countryWealth?.value;
    if (Number.isFinite(v)) somma += v;
  }
  return Math.round(somma);
}

/**
 * Un campione. Se anche UNA sola risorsa non risponde il campione si salta:
 * un totale senza una risorsa si leggerebbe come «sono usciti dal mercato
 * quattrocentomila btc», che è un errore e non un dato.
 */
async function pollOrderMoney() {
  if (!deps) return;
  let prezzi;
  try {
    [prezzi] = await deps.trpcBatch([['itemTrading.getPrices', {}]]);
  } catch (err) {
    console.error('[order-money] getPrices fallita:', err.message);
    return;
  }
  const codici = prezzi && typeof prezzi === 'object' ? Object.keys(prezzi) : [];
  if (!codici.length) {
    console.warn('[order-money] nessuna risorsa da getPrices');
    return;
  }

  let libri;
  try {
    libri = await deps.trpcBatch(codici.map(code => ['tradingOrder.getTopOrders', { itemCode: code, limit: LIMITE_ORDINI }]));
  } catch (err) {
    console.error('[order-money] getTopOrders fallita:', err.message);
    return;
  }
  if (!Array.isArray(libri) || libri.length !== codici.length || libri.some(l => !Array.isArray(l?.buyOrders))) {
    console.warn('[order-money] libro incompleto: campione saltato');
    return;
  }

  const paesi = deps.readCacheShared(MU_USER_COUNTRIES_FILE, { data: {} }).data || {};
  const byItem = {};
  const byCountry = {};
  const byMu = {};
  const perUtente = new Map();
  let total = 0;
  let orders = 0;
  let noCountry = 0;
  let cappedItems = 0;

  codici.forEach((code, i) => {
    const buy = libri[i].buyOrders;
    let soldi = 0;
    let minPrice = null;
    for (const o of buy) {
      const q = Number(o.quantity);
      const p = Number(o.price);
      if (!Number.isFinite(q) || !Number.isFinite(p) || q <= 0 || p <= 0) continue;
      const m = q * p;
      soldi += m;
      if (minPrice === null || p < minPrice) minPrice = p;
      const paese = paesi[o.user]?.[0] || null;
      if (paese) byCountry[paese] = (byCountry[paese] || 0) + m;
      else noCountry += m;
      if (o.mu) byMu[o.mu] = (byMu[o.mu] || 0) + m;
      if (o.user) perUtente.set(o.user, (perUtente.get(o.user) || 0) + m);
    }
    const capped = buy.length >= LIMITE_ORDINI ? 1 : 0;
    cappedItems += capped;
    orders += buy.length;
    total += soldi;
    byItem[code] = [arrotonda(soldi), buy.length, capped, minPrice];
  });

  for (const k of Object.keys(byCountry)) byCountry[k] = arrotonda(byCountry[k]);
  for (const k of Object.keys(byMu)) byMu[k] = arrotonda(byMu[k]);

  _perUtente = perUtente;
  const store = _read();
  const t = Date.now();
  store.samples.push({
    t, total: arrotonda(total), orders, cappedItems,
    noCountry: arrotonda(noCountry), treasury: _tesori(),
    byItem, byCountry, byMu,
  });

  // Oltre ORARIO_GIORNI resta un campione per giorno italiano, l'ultimo.
  const soglia = t - ORARIO_GIORNI * 86400_000;
  const vecchi = new Map();   // giorno → campione più recente
  const tenuti = [];
  for (const s of store.samples) {
    if (s.t >= soglia) { tenuti.push(s); continue; }
    const g = giornoDi(s.t);
    const gia = vecchi.get(g);
    if (!gia || s.t > gia.t) vecchi.set(g, s);
  }
  store.samples = [...vecchi.values(), ...tenuti].sort((a, b) => a.t - b.t);

  store.fetchedAt = t;
  if (!store.startedAt) store.startedAt = t;
  _write(store);
  console.log(`[order-money] campione: ${orders} ordini, ${Math.round(total)} btc, ${cappedItems}/${codici.length} libri al tetto`);
}

/**
 * Quello che va al browser.
 *
 *   series        [[t, total, orders, cappedItems, treasury]] nella finestra
 *   latest        l'ultimo campione intero (per risorsa, nazione, unità)
 *   treasuryDaily [[giorno, somma, nazioni]] da dayHistory, per i giorni in
 *                 cui questo archivio non c'era ancora
 *   one           con `country` o `mu`: [[t, soldi]] di quell'id
 */
function readOrderMoney({ days = 30, country = null, mu = null } = {}) {
  const store = _read();
  const finestra = Math.max(1, Math.min(days, MAX_FINESTRA_GIORNI));
  const da = Date.now() - finestra * 86400_000;
  const dentro = store.samples.filter(s => s.t >= da);

  const out = {
    fetchedAt: store.fetchedAt,
    coverageFrom: store.samples.length ? new Date(store.samples[0].t).toISOString() : null,
    tz: TZ,
    limit: LIMITE_ORDINI,
    series: dentro.map(s => [s.t, s.total, s.orders, s.cappedItems, s.treasury]),
    latest: store.samples.length ? store.samples[store.samples.length - 1] : null,
    treasuryDaily: deps.treasuryByDay ? deps.treasuryByDay(finestra) : [],
  };
  const id = country || mu;
  if (id) {
    const chiave = country ? 'byCountry' : 'byMu';
    out.one = { kind: country ? 'country' : 'mu', id, series: dentro.map(s => [s.t, s[chiave]?.[id] || 0]) };
  }
  return out;
}

/** Per /health. */
function statoOrderMoney() {
  const store = _read();
  const n = store.samples.length;
  const ultimo = n ? store.samples[n - 1] : null;
  return {
    campioni: n,
    primo: n ? new Date(store.samples[0].t).toISOString() : null,
    ultimo: ultimo ? new Date(ultimo.t).toISOString() : null,
    totale: ultimo?.total ?? null,
    libriAlTetto: ultimo?.cappedItems ?? null,
  };
}

module.exports = {
  initOrderMoney,
  pollOrderMoney,
  orderMoneyByUser,
  readOrderMoney,
  statoOrderMoney,
};
