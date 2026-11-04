/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — La ricchezza dei giocatori, divisa per categoria
   -----------------------------------------------------------------------
   `user.getUserById` (PUBBLICA, senza chiave) porta `stats.wealth`:

       { companies, equipments, weapons, items, money, total }

   cioè esattamente la scomposizione che il gioco usa per il suo numero
   `rankings.userWealth`. Verificato il 2026-11-04 su 40 compratori: la
   somma delle cinque voci è uguale a `total` con differenza ZERO. Quindi
   non c'è nessun «resto» da ricavare per sottrazione: ogni voce è del
   gioco.

   (Fino al 2026-11-03 questo file e la scheda Ricchezza dicevano il
   contrario — «soldi, oggetti e armi non sono visibili» — e dividevano in
   aziende / ordini / resto. Era sbagliato: `getUserLite` non porta la
   scomposizione, ma `getUserById` sì, e io avevo guardato solo quella.)

   ── GLI ORDINI D'ACQUISTO NON SONO NELLA RICCHEZZA ────────────────────
   I soldi messi in un ordine d'acquisto escono dal portafoglio e NON
   rientrano in nessuna delle cinque voci: su 40 compratori, 16 avevano
   negli ordini più di quanto avessero in `money`, e diversi più dell'intero
   `total` (ordini 89.700, ricchezza 88.950). Sono soldi in più, fuori dalla
   ricchezza. La colonna `o` li tiene a parte, dal campione orario di
   orderMoney.js — un MINIMO, `getTopOrders` si ferma a 100 ordini per libro.

   ── IL GIRO ───────────────────────────────────────────────────────────
   Una richiesta per sapere CHI (`ranking.getRanking userWealth`: tutta la
   ladder in un colpo, ~17.000 giocatori con nazione e unità), poi
   `getUserById` a blocchi di 25 (~7 KB a giocatore, ~120 MB e ~12 minuti in
   tutto). Si lancia una volta al giorno fra le 05:00 e le 06:59 italiane,
   dopo il censimento aziende che occupa la chiave fino a quell'ora; e una
   volta sola all'avvio, se l'archivio è vuoto, per non far aspettare una
   notte intera il primo giorno.

   ── DUE ARCHIVI ───────────────────────────────────────────────────────
   · `cache/player-parts.sqlite` — una riga per giocatore e giorno
     (c, e, w, i, m, o). ~700 KB al giorno, ~250 MB all'anno: su disco e
     NON in memoria, perché il VPS ha 954 MB in tutto e ne usa l'85%.
   · `cache/player-money-days.json` — gli aggregati del giorno: mondo,
     nazioni (portafogli dei cittadini) e le prime 150 unità per soldi.
     Ci vive la scheda Soldi di Economia: quanti btc stanno nei
     portafogli, e di chi.

   La storia non si ricostruisce: nessuna procedura dice quanto aveva un
   giocatore ieri. Un giorno saltato è un buco, mai uno zero. Non si pota.
   ═══════════════════════════════════════════════════════════════════════ */

const path = require('path');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (_) { /* il modulo si disattiva, il server no */ }

let deps = null;
let db = null;

const FILE_AGG = 'player-money-days';
const TZ = 'Europe/Rome';
const BLOCCO = 25;
const PAUSA_MS = 300;
const SOGLIA_FALLITI = 0.03;        // oltre il 3% il giorno non si dichiara fatto
const TENTATIVI_GIORNO = 2;
const MU_TOP = 150;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function giornoDi(ms = Date.now()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
    .format(new Date(ms));
}

function initPlayerParts(tools) {
  deps = tools;
  if (!DatabaseSync) { console.warn('[player-parts] node:sqlite non disponibile: modulo spento'); return; }
  try {
    db = new DatabaseSync(path.join(tools.cacheDir, 'player-parts.sqlite'));
    db.exec(`CREATE TABLE IF NOT EXISTS parts (
      uid TEXT NOT NULL, day TEXT NOT NULL,
      c INTEGER, e INTEGER, w INTEGER, i INTEGER, m INTEGER, o INTEGER,
      PRIMARY KEY (uid, day)
    ) WITHOUT ROWID`);
  } catch (err) {
    db = null;
    console.error('[player-parts] database non aperto:', err.message);
  }
}

function _agg() {
  return deps.readCache(FILE_AGG, { startedAt: null, fetchedAt: null, days: {} });
}

let _inCorso = false;
const _tentativi = new Map();   // giorno → quanti giri

/**
 * Il giro. `forza` salta il controllo «già fatto oggi» (solo a mano).
 * Idempotente: le righe si riscrivono (`INSERT OR REPLACE`), quindi un giro
 * interrotto e rifatto non lascia doppioni.
 */
async function sweepPlayerParts({ motivo = 'programmato', forza = false } = {}) {
  if (!deps || !db || _inCorso) return;
  const oggi = giornoDi();
  const agg = _agg();
  if (!forza && agg.days[oggi]) return;
  if (!forza && (_tentativi.get(oggi) || 0) >= TENTATIVI_GIORNO) return;
  _tentativi.set(oggi, (_tentativi.get(oggi) || 0) + 1);

  _inCorso = true;
  const t0 = Date.now();
  try {
    const [rk] = await deps.trpcBatch([['ranking.getRanking', { rankingType: 'userWealth' }]]);
    const items = (Array.isArray(rk) ? rk : rk?.items || []).filter(x => x?.user);
    if (items.length < 1000) {
      console.warn(`[player-parts] classifica troppo corta (${items.length}): giro saltato`);
      return;
    }
    console.log(`[player-parts] giro (${motivo}): ${items.length} giocatori`);

    const ordini = deps.ordersByUser();
    const ins = db.prepare('INSERT OR REPLACE INTO parts (uid, day, c, e, w, i, m, o) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
    const mondo = [0, 0, 0, 0, 0, 0];             // c e w i m total
    const perNazione = {};                         // id → [m, total, n]
    const perUnita = {};
    let fatti = 0;
    let falliti = 0;

    for (let i = 0; i < items.length; i += BLOCCO) {
      const blocco = items.slice(i, i + BLOCCO);
      let res;
      try {
        res = await deps.trpcBatch(blocco.map(it => ['user.getUserById', { userId: it.user }]));
      } catch (_) {
        res = blocco.map(() => null);
      }
      db.exec('BEGIN');
      blocco.forEach((it, k) => {
        const w = res[k]?.stats?.wealth;
        if (!w || !Number.isFinite(Number(w.total))) { falliti++; return; }
        const c = Math.round(w.companies) || 0, e = Math.round(w.equipments) || 0, wp = Math.round(w.weapons) || 0;
        const it2 = Math.round(w.items) || 0, m = Math.round(w.money) || 0, tot = Math.round(w.total) || 0;
        const o = ordini instanceof Map && ordini.has(it.user) ? Math.round(ordini.get(it.user)) : null;
        ins.run(it.user, oggi, c, e, wp, it2, m, o);
        fatti++;
        mondo[0] += c; mondo[1] += e; mondo[2] += wp; mondo[3] += it2; mondo[4] += m; mondo[5] += tot;
        if (it.country) { const r = perNazione[it.country] || (perNazione[it.country] = [0, 0, 0]); r[0] += m; r[1] += tot; r[2]++; }
        if (it.mu) { const r = perUnita[it.mu] || (perUnita[it.mu] = [0, 0, 0]); r[0] += m; r[1] += tot; r[2]++; }
      });
      db.exec('COMMIT');
      await sleep(PAUSA_MS);
    }

    if (falliti / items.length > SOGLIA_FALLITI) {
      console.warn(`[player-parts] ${falliti}/${items.length} giocatori non letti: il giorno non si dichiara fatto`);
      return;
    }

    const top = Object.entries(perUnita).sort((a, b) => b[1][0] - a[1][0]).slice(0, MU_TOP);
    const store = _agg();
    store.days[oggi] = {
      n: fatti, failed: falliti, at: Date.now(),
      world: mondo.map(v => Math.round(v)),
      byCountry: perNazione,
      byMu: Object.fromEntries(top),
      orders: ordini instanceof Map ? Math.round([...ordini.values()].reduce((s, v) => s + v, 0)) : null,
    };
    store.fetchedAt = Date.now();
    if (!store.startedAt) store.startedAt = Date.now();
    deps.writeCache(FILE_AGG, store, { compact: true });
    console.log(`[player-parts] ${oggi}: ${fatti} giocatori in ${Math.round((Date.now() - t0) / 1000)} s, soldi nei portafogli ${mondo[4]}`);
  } catch (err) {
    console.error('[player-parts] giro fallito:', err.message);
  } finally {
    _inCorso = false;
  }
}

/** Il cron la chiama ogni dieci minuti nella finestra: quasi sempre non fa
 *  niente. All'avvio riempie il primo giorno se l'archivio è vuoto. */
function sweepSeDovuto() {
  return sweepPlayerParts({ motivo: 'programmato' });
}
function sweepAlPrimoAvvio() {
  if (!deps || !db) return Promise.resolve();
  if (Object.keys(_agg().days).length) return Promise.resolve();
  return sweepPlayerParts({ motivo: 'primo avvio' });
}

/** Per UN giocatore: righe `[giorno, aziende, equipaggiamento, armi, oggetti,
 *  soldi, ordini|null]` e i soldi negli ordini di adesso. */
function readPlayerParts(userId, giorni = 90) {
  const ordini = deps.ordersByUser();
  let rows = [];
  if (db) {
    const da = giornoDi(Date.now() - Math.max(1, giorni) * 86400_000);
    rows = db.prepare('SELECT day, c, e, w, i, m, o FROM parts WHERE uid = ? AND day >= ? ORDER BY day')
      .all(userId, da).map(r => [r.day, r.c, r.e, r.w, r.i, r.m, r.o]);
  }
  const giorniArch = Object.keys(_agg().days).sort();
  return {
    coverageFrom: giorniArch[0] || null,
    days: giorniArch.length,
    rows,
    ordersNow: ordini instanceof Map ? Math.round((ordini.get(userId) || 0) * 100) / 100 : null,
  };
}

/** Per la scheda Soldi: il mondo giorno per giorno e l'ultimo giorno intero
 *  (nazioni, unità). */
function readPlayerMoney(giorni = 90) {
  const store = _agg();
  const giorniArch = Object.keys(store.days).sort();
  const da = giornoDi(Date.now() - Math.max(1, giorni) * 86400_000);
  const dentro = giorniArch.filter(g => g >= da);
  const ultimo = giorniArch[giorniArch.length - 1] || null;
  return {
    coverageFrom: giorniArch[0] || null,
    fetchedAt: store.fetchedAt,
    // [giorno, aziende, equipaggiamento, armi, oggetti, soldi, totale, giocatori]
    world: dentro.map(g => [g, ...store.days[g].world, store.days[g].n]),
    latest: ultimo ? { day: ultimo, ...store.days[ultimo] } : null,
  };
}

/** Per /health. */
function statoPlayerParts() {
  const giorni = Object.keys(_agg().days).sort();
  let righe = null;
  if (db) { try { righe = db.prepare('SELECT COUNT(*) AS n FROM parts').get().n; } catch (_) { /* */ } }
  return {
    attivo: !!db,
    giorni: giorni.length,
    primo: giorni[0] || null,
    ultimo: giorni[giorni.length - 1] || null,
    righe,
    inCorso: _inCorso,
  };
}

module.exports = {
  initPlayerParts,
  sweepPlayerParts,
  sweepSeDovuto,
  sweepAlPrimoAvvio,
  readPlayerParts,
  readPlayerMoney,
  statoPlayerParts,
};
