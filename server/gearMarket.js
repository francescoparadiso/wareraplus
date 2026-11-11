/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Mercato dell'equipaggiamento: vendite, craft e casse
   -----------------------------------------------------------------------
   Alimenta la scheda «Crafting» di Economia (src/economy/crafting.js): il
   ROI di un craft casuale e il valore atteso di una cassa.

   ── LA DOMANDA ─────────────────────────────────────────────────────────
   Un craft casuale spende scraps (e acciaio) e restituisce UN pezzo a caso:
   il 30% un'arma della rarità scelta, il resto un pezzo d'armatura in uno
   dei cinque slot. Conviene se il pezzo che esce vale, in media, più di
   quanto è costato. Il costo si sa (prezzi pubblici). Quello che NON si sa
   è quanto vale «un casco epico con 83 di danno critico»: dipende dal
   tiro, e il gioco non pubblica nessun listino per tiro.

   ── DA DOVE VIENE IL VALORE ────────────────────────────────────────────
   `transaction.getPaginatedTransactions` (token-gated, quindi la chiave del
   VPS, come moneyTransfers.js) porta quattro tipi che ci servono, TUTTI
   con il pezzo intero (codice + tiri) dentro:

     · itemMarket   — una vendita vera: prezzo + codice + tiri.
     · craftItem    — cosa è uscito da un craft e quante scraps sono costate.
     · openCase     — cosa è uscito da una cassa (e, senza `item`, il
                      contenuto di una cassa di legno: risorsa + quantità).
     · dismantleItem— quante scraps rende smontare un pezzo.

   Quindi niente stime a tavolino: le probabilità di uscita si MISURANO dai
   craft veri, il valore di un tiro dalle vendite vere.

   ── LA CURVA DEI VALORI ────────────────────────────────────────────────
   Per ogni codice (helmet4, sniper…) si tiene un campione di vendite degli
   ultimi MODEL_DAYS giorni e si costruisce una curva prezzo(tiro):
   mediana PESATA con un nucleo gaussiano sulle coordinate normalizzate dei
   tiri. La mediana, non la media, perché un'offerta a 1 moneta o a 9.999 per
   errore esiste e una media la sconterebbe in silenzio; dove i vicini sono
   pochi il nucleo si allarga (4 volte al massimo) e la `conf` scende.
   Per le armature la curva è poi resa non decrescente (PAV): un tiro
   migliore non può valere meno di uno peggiore.
   Si vendono solo i pezzi NUOVI (stato = stato massimo): quelli usati
   costano meno per un motivo che non è il tiro.

   I tiri sono uniformi nell'intervallo di `gameConfig.items.<codice>.
   dynamicStats` (verificato su 439 sniper e sul casco epico: istogramma
   piatto), quindi il client media la curva sull'intera griglia senza
   bisogno di sapere quanti pezzi per tiro sono usciti.

   ── ⚠️ LA FINESTRA DELL'API È UN GIORNO E MEZZO, NON UN ARCHIVIO ───────
   Misurato il 2026-11-11: itemMarket arriva ad almeno 40.000 righe (> 1
   giorno), ~1.260 l'ora. Le vendite si accumulano da qui in poi; al primo
   avvio si prende quello che l'API ricorda (gentilmente: 400 ms fra una
   pagina e l'altra, la chiave è condivisa col resto del tool). Dopo 7
   giorni il modello ha tutta la sua finestra. `coverageFrom` dice da
   quando c'è qualcosa: la vista lo dichiara.

   ── PERCHÉ SI POTA (a differenza degli archivi importati) ──────────────
   Le vendite grezze più vecchie di RETENTION_DAYS si cancellano: servono
   solo a dire quanto vale un pezzo OGGI, e un prezzo di tre settimane fa
   non è un dato storico ma un dato sbagliato. I contatori di craft e casse
   (`events`) invece non si potano: sono pochi byte al giorno e una
   frequenza di uscita misurata su mesi vale più di una su una settimana.

   ── COSTI ──────────────────────────────────────────────────────────────
   Regime: ~45 richieste ogni 10 minuti (le casse si aprono 12.000 volte
   l'ora, ma le frequenze si campionano: non serve vederle tutte). Su disco
   (`cache/gear-market.sqlite`, NON in RAM: il VPS ha 954 MB): ~1 MB al
   giorno di vendite, 14 giorni di coda. Escluso dal tar del backup: è un
   dato derivato che l'API rifà in un giorno.
   ═══════════════════════════════════════════════════════════════════════ */

const path = require('path');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (_) { /* il modulo si spegne, il server no */ }

let deps = null;
let db = null;

const RETENTION_DAYS = 14;       // vendite grezze
const MODEL_DAYS = 7;            // finestra della curva dei valori
const FREQ_DAYS = 30;            // finestra delle frequenze di uscita
const PAGE = 100;                // tetto dell'API (200 → errore di validazione)
const PAUSA_MS = 120;            // fra due pagine, a regime
const PAUSA_BOOT_MS = 400;       // fra due pagine, al primo avvio
const OVERLAP_MS = 60 * 1000;    // sovrapposizione per non perdere righe con lo stesso istante
const MODEL_TTL_MS = 10 * 60 * 1000;
const CFG_TTL_MS = 12 * 3600 * 1000;
const BOOT_PAGES_SALES = 450;    // ~45.000 vendite: poco più di quanto l'API ricorda

// Pagine al massimo per tipo e per giro. Le vendite e i craft si leggono
// TUTTI (fermandosi al segno già visto); le casse e gli smontaggi si
// campionano, perché servono solo frequenze e rese medie.
const MAX_PAGES = { itemMarket: 30, craftItem: 20, openCase: 8, dismantleItem: 1 };

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// ── Configurazione di gioco ──────────────────────────────────────────
// code → { rarity, kind: 'armor'|'weapon', keys: [chiave…], lo: [..], hi: [..] }
let _gear = null;
let _gearAt = 0;
let _caseCodes = [];

async function _loadConfig() {
  if (_gear && Date.now() - _gearAt < CFG_TTL_MS) return true;
  try {
    const [cfg] = await deps.trpcBatch([['gameConfig.getGameConfig', {}]]);
    const items = cfg?.items;
    if (!items) throw new Error('forma inattesa');
    const gear = {};
    const armorSlots = new Set(['helmet', 'chest', 'pants', 'boots', 'gloves']);
    for (const [code, it] of Object.entries(items)) {
      const ds = it.dynamicStats;
      if (!ds) continue;
      const isWeapon = it.type === 'weapon';
      const isArmor = !isWeapon && armorSlots.has(it.usage);
      if (!isWeapon && !isArmor) continue;
      // Armatura: un solo tiro. Arma: attacco e probabilità di critico,
      // sempre in quest'ordine (il client disegna la griglia così).
      const keys = isWeapon ? ['attack', 'criticalChance'] : Object.keys(ds).slice(0, 1);
      if (!keys.every(k => Array.isArray(ds[k]))) continue;
      gear[code] = {
        rarity: it.rarity,
        kind: isWeapon ? 'weapon' : 'armor',
        keys,
        lo: keys.map(k => ds[k][0]),
        hi: keys.map(k => ds[k][1]),
      };
    }
    if (!Object.keys(gear).length) throw new Error('nessun pezzo riconosciuto');
    _gear = gear;
    _caseCodes = Object.entries(items).filter(([, it]) => it.type === 'case').map(([c]) => c);
    _gearAt = Date.now();
    return true;
  } catch (err) {
    console.error('[gear-market] gameConfig non letta:', err.message);
    return !!_gear;
  }
}

// ── Database ─────────────────────────────────────────────────────────
function initGearMarket(tools) {
  deps = tools;
  if (!DatabaseSync) { console.warn('[gear-market] node:sqlite non disponibile: modulo spento'); return; }
  try {
    db = new DatabaseSync(path.join(tools.cacheDir, 'gear-market.sqlite'));
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(`CREATE TABLE IF NOT EXISTS sales (
      id TEXT PRIMARY KEY, ts INTEGER NOT NULL, code TEXT NOT NULL,
      a INTEGER, b INTEGER, price REAL NOT NULL
    ) WITHOUT ROWID`);
    db.exec('CREATE INDEX IF NOT EXISTS sales_code_ts ON sales (code, ts)');
    db.exec(`CREATE TABLE IF NOT EXISTS events (
      day TEXT NOT NULL, kind TEXT NOT NULL, key TEXT NOT NULL,
      n INTEGER NOT NULL, q REAL NOT NULL,
      PRIMARY KEY (day, kind, key)
    ) WITHOUT ROWID`);
    db.exec('CREATE TABLE IF NOT EXISTS seen (id TEXT PRIMARY KEY, ts INTEGER NOT NULL) WITHOUT ROWID');
    db.exec('CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT) WITHOUT ROWID');
  } catch (err) {
    db = null;
    console.error('[gear-market] database non aperto:', err.message);
  }
}

function _meta(k) {
  const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  return r ? r.v : null;
}
function _setMeta(k, v) {
  db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(k, String(v));
}

const giornoUtc = (ms) => new Date(ms).toISOString().slice(0, 10);

// ── Lettura delle pagine ─────────────────────────────────────────────
/** ⚠️ L'input va NUDO (vedi moneyTransfers.js). 429: si aspetta e si
 *  riprova, la chiave è una sola per tutto il tool. */
async function _fetchPage(type, cursor) {
  const input = { transactionType: type, limit: PAGE };
  if (cursor) input.cursor = cursor;
  const url = `${deps.trpcUpstream}/transaction.getPaginatedTransactions`
    + `?input=${encodeURIComponent(JSON.stringify(input))}`;
  for (let tentativo = 0; tentativo < 4; tentativo++) {
    const res = await fetch(url, { headers: deps.apiToken ? { 'X-API-Key': deps.apiToken } : {} });
    if (res.status === 429) { await sleep(4000 * (tentativo + 1)); continue; }
    if (!res.ok) throw new Error(`getPaginatedTransactions(${type}): HTTP ${res.status}`);
    const data = (await res.json())?.result?.data;
    if (!data || !Array.isArray(data.items)) throw new Error(`getPaginatedTransactions(${type}): risposta inattesa`);
    return { items: data.items, nextCursor: data.nextCursor || null };
  }
  throw new Error(`getPaginatedTransactions(${type}): 429 persistente`);
}

/** I tiri di un pezzo come [a, b|null], o null se non sono quelli attesi. */
function _tiri(item, g) {
  const s = item?.skills;
  if (!s) return null;
  const a = Number(s[g.keys[0]]);
  if (!Number.isFinite(a)) return null;
  if (g.keys.length === 1) return [a, null];
  const b = Number(s[g.keys[1]]);
  return Number.isFinite(b) ? [a, b] : null;
}

const _nuovo = (item) => item && Number(item.state) === Number(item.maxState);

/**
 * Un giro su un tipo di transazione. Si ferma quando incontra righe più
 * vecchie del segno già raggiunto (meno una sovrapposizione), o al tetto di
 * pagine. Le righe dentro la sovrapposizione si deduplicano: per le vendite
 * dalla chiave primaria, per il resto dalla tabella `seen`.
 */
async function _giro(type, { maxPages, pausa = PAUSA_MS } = {}) {
  const wmKey = `wm:${type}`;
  const wm = Number(_meta(wmKey)) || 0;
  const oggi = giornoUtc(Date.now());
  let cursor = null;
  let nuovoWm = wm;
  let lette = 0;
  let nuove = 0;
  let finito = false;

  const insSale = db.prepare('INSERT OR IGNORE INTO sales (id, ts, code, a, b, price) VALUES (?, ?, ?, ?, ?, ?)');
  const insSeen = db.prepare('INSERT OR IGNORE INTO seen (id, ts) VALUES (?, ?)');
  const upEv = db.prepare(`INSERT INTO events (day, kind, key, n, q) VALUES (?, ?, ?, 1, ?)
    ON CONFLICT(day, kind, key) DO UPDATE SET n = n + 1, q = q + excluded.q`);

  for (let pagina = 0; pagina < maxPages && !finito; pagina++) {
    const { items, nextCursor } = await _fetchPage(type, cursor);
    db.exec('BEGIN');
    try {
      for (const t of items) {
        const ts = Date.parse(t.createdAt);
        if (!t._id || !Number.isFinite(ts)) continue;
        lette++;
        if (ts > nuovoWm) nuovoWm = ts;
        if (wm && ts < wm - OVERLAP_MS) { finito = true; continue; }

        if (type === 'itemMarket') {
          const g = _gear[t.item?.code];
          if (!g || !_nuovo(t.item)) continue;
          const price = Number(t.money);
          const tiri = _tiri(t.item, g);
          if (!tiri || !(price > 0) || Number(t.quantity) !== 1) continue;
          if (insSale.run(t._id, ts, t.item.code, tiri[0], tiri[1], price).changes) nuove++;
          continue;
        }

        // Gli altri tipi non hanno chiave primaria utile: si dedup con `seen`.
        if (!insSeen.run(t._id, ts).changes) continue;
        nuove++;
        const day = giornoUtc(ts);
        if (type === 'craftItem') {
          const code = t.item?.code;
          if (_gear[code] && t.itemCode === 'scraps') upEv.run(day, 'craft', code, Number(t.quantity) || 0);
        } else if (type === 'openCase') {
          if (t.item?.code) {
            if (_gear[t.item.code] && _caseCodes.includes(t.itemCode)) upEv.run(day, `case:${t.itemCode}`, t.item.code, 0);
          } else if (t.itemCode && t.itemCode !== 'toolbox') {
            // Senza `item`: il contenuto di una cassa di legno.
            upEv.run(day, 'wood', t.itemCode, Number(t.quantity) || 0);
          }
        } else if (type === 'dismantleItem') {
          const code = t.item?.code;
          if (_gear[code] && _nuovo(t.item) && t.itemCode === 'scraps') upEv.run(day, 'dismantle', code, Number(t.quantity) || 0);
        }
      }
      db.exec('COMMIT');
    } catch (err) {
      db.exec('ROLLBACK');
      throw err;
    }
    cursor = nextCursor;
    if (!cursor) break;
    if (pausa) await sleep(pausa);
  }

  if (nuovoWm > wm) _setMeta(wmKey, nuovoWm);
  return { lette, nuove };
}

let _inCorso = false;

/** Il giro periodico: tutti e quattro i tipi, uno dopo l'altro. */
async function pollGearMarket() {
  if (!deps || !db || _inCorso) return;
  if (!deps.apiToken) {
    console.warn('[gear-market] WARERA_API_TOKEN assente: archivio fermo (401 sulle transazioni)');
    return;
  }
  _inCorso = true;
  const t0 = Date.now();
  try {
    if (!await _loadConfig()) return;
    const out = {};
    for (const type of Object.keys(MAX_PAGES)) {
      try {
        out[type] = await _giro(type, { maxPages: MAX_PAGES[type] });
      } catch (err) {
        console.error(`[gear-market] giro ${type} fallito:`, err.message);
      }
    }
    // Manutenzione: poche righe, ma gira a ogni giro e costa niente.
    db.prepare('DELETE FROM sales WHERE ts < ?').run(Date.now() - RETENTION_DAYS * 86400_000);
    db.prepare('DELETE FROM seen WHERE ts < ?').run(Date.now() - 36 * 3600_000);
    _setMeta('lastPoll', Date.now());
    const sommario = Object.entries(out).map(([k, v]) => `${k} +${v.nuove}`).join(' · ');
    if (sommario) console.log(`[gear-market] ${sommario} (${Date.now() - t0} ms)`);
  } finally {
    _inCorso = false;
  }
}

/** Il primo avvio: se non c'è nessuna vendita si prende tutta la finestra che
 *  l'API ricorda, con calma. Senza await: serve minuti, non deve bloccare
 *  l'avvio del server. */
async function bootstrapGearMarket() {
  if (!deps || !db || _inCorso) return;
  if (!deps.apiToken) return;
  const n = db.prepare('SELECT COUNT(*) AS n FROM sales').get().n;
  if (n > 0) return;
  _inCorso = true;
  try {
    if (!await _loadConfig()) return;
    console.log('[gear-market] primo avvio: carico la finestra che l\'API ricorda');
    // `bootPages` esiste solo per provare il modulo in locale senza
    // sfogliare 450 pagine con la chiave di tutti.
    const r = await _giro('itemMarket', { maxPages: deps.bootPages || BOOT_PAGES_SALES, pausa: PAUSA_BOOT_MS });
    console.log(`[gear-market] bootstrap vendite: ${r.nuove} su ${r.lette} righe`);
    for (const type of ['craftItem', 'openCase', 'dismantleItem']) {
      try { await _giro(type, { maxPages: 30, pausa: PAUSA_BOOT_MS }); } catch (err) {
        console.error(`[gear-market] bootstrap ${type}:`, err.message);
      }
    }
    _setMeta('lastPoll', Date.now());
  } catch (err) {
    console.error('[gear-market] bootstrap fallito:', err.message);
  } finally {
    _inCorso = false;
  }
}

// ── Il modello: la curva dei valori ──────────────────────────────────
const round4 = (v) => Math.round(v * 10000) / 10000;

/** Mediana pesata di valori GIÀ ordinati per prezzo. */
function _medianaPesata(prezzi, pesi, totale) {
  let acc = 0;
  const meta = totale / 2;
  for (let i = 0; i < prezzi.length; i++) {
    acc += pesi[i];
    if (acc >= meta) return prezzi[i];
  }
  return prezzi[prezzi.length - 1];
}

/** Non decrescente (PAV): il valore di un tiro migliore non scende. */
function _pav(v, w) {
  const blocchi = [];
  for (let i = 0; i < v.length; i++) {
    blocchi.push({ s: v[i] * w[i], w: w[i], n: 1 });
    while (blocchi.length > 1) {
      const b = blocchi[blocchi.length - 1], a = blocchi[blocchi.length - 2];
      if (a.s / a.w <= b.s / b.w) break;
      blocchi.splice(blocchi.length - 2, 2, { s: a.s + b.s, w: a.w + b.w, n: a.n + b.n });
    }
  }
  const out = [];
  for (const b of blocchi) for (let k = 0; k < b.n; k++) out.push(b.s / b.w);
  return out;
}

/**
 * Valore al punto `q` (coordinate normalizzate) con nucleo che si allarga
 * finché i vicini efficaci sono almeno 6. `righe` è ordinata per prezzo;
 * `xs` le coordinate normalizzate di ogni riga (dimensioni 1 o 2).
 */
function _valoreInPunto(righe, xs, q, h0) {
  const dim = q.length;
  const pesi = new Array(righe.length);
  for (let livello = 0; livello < 4; livello++) {
    const h = h0 * (2 ** livello);
    const inv = 1 / (2 * h * h);
    let s = 0, s2 = 0;
    for (let i = 0; i < righe.length; i++) {
      let d2 = 0;
      for (let d = 0; d < dim; d++) { const df = xs[i][d] - q[d]; d2 += df * df; }
      const w = Math.exp(-d2 * inv);
      pesi[i] = w; s += w; s2 += w * w;
    }
    const neff = s2 > 0 ? (s * s) / s2 : 0;
    if (neff >= 6 || livello === 3) {
      if (s < 1e-9) return null;
      const prezzi = righe.map(r => r.price);
      return { v: _medianaPesata(prezzi, pesi, s), livello, neff };
    }
  }
  return null;
}

function _curva(code, g, righe) {
  // Ordinate per prezzo una volta sola.
  righe.sort((x, y) => x.price - y.price);
  const norm = (val, k) => (g.hi[k] > g.lo[k] ? (val - g.lo[k]) / (g.hi[k] - g.lo[k]) : 0.5);

  if (g.kind === 'armor') {
    const xs = righe.map(r => [norm(r.a, 0)]);
    const valori = [];
    const pesi = [];
    let peggiore = 0;
    for (let v = g.lo[0]; v <= g.hi[0]; v++) {
      const r = _valoreInPunto(righe, xs, [norm(v, 0)], 0.06);
      valori.push(r ? r.v : null);
      pesi.push(r ? Math.max(r.neff, 1) : 1);
      if (r) peggiore = Math.max(peggiore, r.livello);
    }
    if (valori.every(x => x == null)) return null;
    // I buchi si colmano col vicino più prossimo prima del PAV.
    for (let i = 0; i < valori.length; i++) if (valori[i] == null) {
      let k = 1;
      while (valori[i] == null && k < valori.length) {
        valori[i] = valori[i - k] ?? valori[i + k] ?? null;
        k++;
      }
    }
    const liscia = _pav(valori, pesi).map(round4);
    return { n: righe.length, conf: peggiore === 0 ? 'high' : peggiore === 1 ? 'mid' : 'low', g: liscia };
  }

  // Arma: griglia attacco (al più 14 celle) × critico (al più 10 valori).
  const xs = righe.map(r => [norm(r.a, 0), norm(r.b, 1)]);
  const Ra = g.hi[0] - g.lo[0] + 1, Rb = g.hi[1] - g.lo[1] + 1;
  const na = Math.min(Ra, 14);
  const ac = [], aw = [];
  for (let k = 0; k < na; k++) {
    const da = g.lo[0] + Math.floor((k * Ra) / na);
    const a1 = g.lo[0] + Math.floor(((k + 1) * Ra) / na) - 1;
    ac.push((da + a1) / 2);
    aw.push(a1 - da + 1);
  }
  const bc = [];
  for (let v = g.lo[1]; v < g.lo[1] + Rb; v++) bc.push(v);
  const mat = [];
  let peggiore = 0;
  let qualcuno = false;
  for (const a of ac) {
    const riga = [];
    for (const b of bc) {
      const r = _valoreInPunto(righe, xs, [norm(a, 0), norm(b, 1)], 0.1);
      riga.push(r ? round4(r.v) : null);
      if (r) { qualcuno = true; peggiore = Math.max(peggiore, r.livello); }
    }
    mat.push(riga);
  }
  if (!qualcuno) return null;
  return {
    n: righe.length,
    conf: peggiore === 0 ? 'high' : peggiore === 1 ? 'mid' : 'low',
    g: { ac, aw, bc, v: mat },
  };
}

function _frequenze() {
  const dal = giornoUtc(Date.now() - FREQ_DAYS * 86400_000);
  const rows = db.prepare('SELECT kind, key, SUM(n) AS n, SUM(q) AS q FROM events WHERE day >= ? GROUP BY kind, key').all(dal);
  const craft = {}, cases = {}, wood = {}, dismantle = {};
  for (const r of rows) {
    if (r.kind === 'craft') craft[r.key] = r.n;
    else if (r.kind.startsWith('case:')) (cases[r.kind.slice(5)] ||= {})[r.key] = r.n;
    else if (r.kind === 'wood') wood[r.key] = { n: r.n, q: r.q };
    else if (r.kind === 'dismantle') dismantle[r.key] = r.n ? Math.round(r.q / r.n) : null;
  }
  const primo = db.prepare('SELECT MIN(day) AS d FROM events').get().d;
  return { craft, cases, wood, dismantle, since: primo || null };
}

let _model = null;

function _buildModel() {
  const dal = Date.now() - MODEL_DAYS * 86400_000;
  const curves = {};
  const sel = db.prepare('SELECT price, a, b FROM sales WHERE code = ? AND ts >= ?');
  for (const [code, g] of Object.entries(_gear)) {
    const righe = sel.all(code, dal).map(r => ({ price: r.price, a: r.a, b: r.b }));
    const info = { r: g.rarity, k: g.kind, keys: g.keys, lo: g.lo, hi: g.hi, n: righe.length };
    if (righe.length >= 3) {
      const c = _curva(code, g, righe);
      if (c) { info.conf = c.conf; info.g = c.g; }
    }
    curves[code] = info;
  }
  const agg = db.prepare('SELECT COUNT(*) AS n, MIN(ts) AS min, MAX(ts) AS max FROM sales WHERE ts >= ?').get(dal);
  _model = {
    builtAt: Date.now(),
    data: {
      available: true,
      builtAt: Date.now(),
      windowDays: MODEL_DAYS,
      sales: agg.n,
      salesFrom: agg.min ? new Date(agg.min).toISOString() : null,
      salesTo: agg.max ? new Date(agg.max).toISOString() : null,
      curves,
      freq: _frequenze(),
    },
  };
}

/** Quello che va al browser. Ricostruito al più ogni MODEL_TTL_MS. */
async function readGearMarket() {
  if (!db) return { available: false, reason: 'database spento' };
  if (!_gear && !await _loadConfig()) return { available: false, reason: 'configurazione di gioco non letta' };
  if (!_model || Date.now() - _model.builtAt > MODEL_TTL_MS) _buildModel();
  return _model.data;
}

function statoGearMarket() {
  if (!db) return { attivo: false };
  const v = db.prepare('SELECT COUNT(*) AS n, MIN(ts) AS min, MAX(ts) AS max FROM sales').get();
  const ev = db.prepare('SELECT kind, SUM(n) AS n FROM events GROUP BY kind').all();
  const lp = Number(_meta('lastPoll'));
  return {
    attivo: true,
    vendite: v.n,
    primaVendita: v.min ? new Date(v.min).toISOString() : null,
    ultimaVendita: v.max ? new Date(v.max).toISOString() : null,
    ultimoGiro: lp ? new Date(lp).toISOString() : null,
    eventi: Object.fromEntries(ev.map(e => [e.kind, e.n])),
    inCorso: _inCorso,
  };
}

module.exports = {
  initGearMarket,
  pollGearMarket,
  bootstrapGearMarket,
  readGearMarket,
  statoGearMarket,
};
