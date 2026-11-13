/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Archivio delle donazioni (transactionType: 'donation')
   -----------------------------------------------------------------------
   Alimenta la scheda «Economia» di Statistiche nazioni: quanto donano
   ogni giorno i cittadini di una nazione, dove vanno (tesoro, unità
   militari, altri giocatori) e quanto riceve ciascuna unità militare della
   nazione. Rotta: /donations?country=ID&days=N.

   ── ⚠️ LA FORMA DELLA RIGA NON È STATA VERIFICATA ───────────────────────
   `transaction.getPaginatedTransactions` è token-gated e quando questo
   modulo è stato scritto non c'era una chiave a portata di mano: i nomi dei
   campi di una `donation` (chi dà, chi riceve, se è un'unità o una nazione)
   NON sono stati letti da una risposta vera. L'unica cosa certa è che per i
   bonifici fra tesori vale `sellerCountryId` (chi manda) / `buyerCountryId`
   (chi incassa), e che l'API accetta i filtri `userId`, `muId`, `countryId`.

   Quindi il modulo è scritto per NON dipendere da quei nomi:

     · si salvano TUTTI i campi che sembrano un id (24 caratteri esadecimali,
       `_id` escluso) con il loro nome, così com'è: l'archivio è corretto
       qualunque sia la forma, e non si perde niente mentre la si scopre;
     · la CLASSIFICAZIONE (nazione / unità / giocatore, e la nazione di chi
       dona) si fa in LETTURA, per valore: un id che sta nella directory MU è
       un'unità, uno che sta fra le nazioni è una nazione, un utente si porta
       alla nazione con la mappa utente → nazione dei membri delle unità.
       Il ruolo (chi dà / chi riceve) si legge dal prefisso del nome:
       `seller*`/`from*`/`donor*` dà, `buyer*`/`to*`/`receiver*` riceve;
     · `readDonationsStatus` e la risposta riportano i NOMI dei campi visti e
       quante righe sono state classificate, così dopo il primo deploy si
       vede se la lettura ha capito la forma o no — e se no si corregge
       `_classifica` senza dover ri-raccogliere niente.

   ⚠️ Se `classified.donor` o `classified.receiver` restano a zero con righe
   in archivio, la forma è diversa da quella attesa: guarda `fields` in
   /health e adatta `_classifica`. Non "riempire" il buco con un'ipotesi: un
   «nessuna donazione» inventato sarebbe peggio di un buco dichiarato.

   ── COME SI ACCUMULA ────────────────────────────────────────────────────
   Come i bonifici: l'API ricorda una finestra corta (qualche giorno), non
   uno storico. Si parte da quello che c'è e si cresce di un giorno al
   giorno; `coverageFrom` dice da quando l'archivio è affidabile.
   Archivio: cache/donations.sqlite, su disco e non in RAM (il VPS ha
   954 MB in tutto). NON si pota: è storia che il gioco non conserva.
   ═══════════════════════════════════════════════════════════════════════ */

const path = require('path');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (_) { /* il modulo si spegne, il server no */ }

let deps = null;
let db = null;

const PAGE = 100;
// Primo giro (archivio vuoto): si sfoglia fin dove l'API arriva. Dopo, un
// giro si ferma alla prima pagina interamente già vista.
const MAX_PAGES_FIRST = 60;
const MAX_PAGES = 8;
const SAMPLE_MAX = 5;
const ID_RE = /^[0-9a-f]{24}$/i;
const CACHE_TTL_MS = 5 * 60 * 1000;

function initDonations(tools) {
  deps = tools;
  if (!DatabaseSync) { console.warn('[donations] node:sqlite non disponibile: modulo spento'); return; }
  try {
    db = new DatabaseSync(path.join(tools.cacheDir, 'donations.sqlite'));
    db.exec('PRAGMA journal_mode = WAL');
    db.exec(`
      CREATE TABLE IF NOT EXISTS don (
        id TEXT PRIMARY KEY, ts INTEGER NOT NULL, money REAL NOT NULL,
        item TEXT, qty REAL, ids TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS don_ts ON don (ts);
      CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
    `);
  } catch (err) {
    console.error('[donations] apertura archivio fallita:', err.message);
    db = null;
  }
}

function _meta(k) {
  const r = db.prepare('SELECT v FROM meta WHERE k = ?').get(k);
  return r ? r.v : null;
}
function _setMeta(k, v) {
  db.prepare('INSERT OR REPLACE INTO meta (k, v) VALUES (?, ?)').run(k, String(v));
}

/** ⚠️ L'input va NUDO (vedi moneyTransfers.js). */
async function _fetchPage(cursor) {
  const input = { transactionType: 'donation', limit: PAGE };
  if (cursor) input.cursor = cursor;
  const url = `${deps.trpcUpstream}/transaction.getPaginatedTransactions`
    + `?input=${encodeURIComponent(JSON.stringify(input))}`;
  for (let tentativo = 0; tentativo < 4; tentativo++) {
    const res = await fetch(url, { headers: deps.apiToken ? { 'X-API-Key': deps.apiToken } : {} });
    if (res.status === 429) { await new Promise(r => setTimeout(r, 4000 * (tentativo + 1))); continue; }
    if (!res.ok) throw new Error(`getPaginatedTransactions(donation): HTTP ${res.status}`);
    const data = (await res.json())?.result?.data;
    if (!data || !Array.isArray(data.items)) throw new Error('getPaginatedTransactions(donation): risposta inattesa');
    return { items: data.items, nextCursor: data.nextCursor || null };
  }
  throw new Error('getPaginatedTransactions(donation): 429 persistente');
}

/** Tutti i campi che sembrano un id, col loro nome (`_id` escluso). */
function _idFields(t) {
  const out = {};
  for (const [k, v] of Object.entries(t || {})) {
    if (k === '_id') continue;
    if (typeof v === 'string' && ID_RE.test(v)) out[k] = v;
  }
  return out;
}

/** Giro incrementale: dal più recente all'indietro, fino a una pagina tutta
 *  già vista. Un giro fallito riparte dagli stessi id: nessun cursore salvato. */
async function pollDonations() {
  if (!deps || !db) return;
  if (!deps.apiToken) {
    console.warn('[donations] WARERA_API_TOKEN assente: archivio fermo (401 sulle transazioni)');
    return;
  }
  const primo = !Number(_meta('rows')) && !db.prepare('SELECT 1 FROM don LIMIT 1').get();
  const maxPages = primo ? MAX_PAGES_FIRST : MAX_PAGES;
  const ins = db.prepare('INSERT OR IGNORE INTO don (id, ts, money, item, qty, ids) VALUES (?, ?, ?, ?, ?, ?)');
  let cursor = null;
  let nuove = 0;

  try {
    for (let pagina = 0; pagina < maxPages; pagina++) {
      const { items, nextCursor } = await _fetchPage(cursor);
      let nuovePagina = 0;
      db.exec('BEGIN');
      try {
        for (const t of items) {
          const ts = Date.parse(t.createdAt);
          if (!t?._id || !Number.isFinite(ts)) continue;
          const money = Number(t.money);
          const item = t.item?.code || (typeof t.item === 'string' ? t.item : null) || t.itemCode || null;
          const qty = Number(t.quantity);
          const r = ins.run(
            t._id, ts, Number.isFinite(money) ? money : 0,
            item, Number.isFinite(qty) ? qty : null,
            JSON.stringify(_idFields(t)),
          );
          if (r.changes) { nuovePagina++; nuove++; }
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }

      // Qualche riga grezza, per vedere la forma vera dopo il primo giro.
      if (items.length && !_meta('samples')) {
        _setMeta('samples', JSON.stringify(items.slice(0, SAMPLE_MAX)));
      }
      if (!items.length || !nextCursor || !nuovePagina) break;
      cursor = nextCursor;
    }
  } catch (err) {
    console.error('[donations] giro fallito:', err.message);
  }

  if (!_meta('startedAt')) {
    const min = db.prepare('SELECT MIN(ts) AS m FROM don').get().m;
    _setMeta('startedAt', min || Date.now());
  }
  _setMeta('lastPoll', Date.now());
  _cache.clear();
  if (nuove) console.log(`[donations] +${nuove}`);
}

// ── Lettura: classificazione per valore ─────────────────────────────────

const _cache = new Map();   // "country|days" → { at, json }

const SELLER_RE = /^(seller|from|donor|giver|sender|user)/i;
const BUYER_RE = /^(buyer|to|receiver|recipient)/i;

function _contesto() {
  const dir = deps.readCache('mu-directory', { data: [] }).data || [];
  const muCountry = new Map();   // muId → countryId
  const muName = new Map();
  for (const m of dir) { muCountry.set(m._id, m.country); muName.set(m._id, m.name); }
  const cc = deps.readCache('countries', null);
  const countries = cc?.data?.result?.data || cc?.data || [];
  const countrySet = new Set(countries.map(c => c._id));
  const utenti = deps.readCacheShared('mu-user-countries', { data: {} }).data || {};
  return { muCountry, muName, countrySet, utenti };
}

/** Chi dà, chi riceve, in valori. Ritorna { donor, donorCountry, rMu, rCountry, rUser }. */
function _classifica(ids, ctx) {
  const out = { donor: null, donorCountry: null, rMu: null, rCountry: null, rUser: null };
  for (const [k, v] of Object.entries(ids)) {
    const venditore = SELLER_RE.test(k) && !BUYER_RE.test(k);
    const compratore = BUYER_RE.test(k);
    const eMu = ctx.muCountry.has(v);
    const eNaz = ctx.countrySet.has(v);

    if (eMu) {
      // Un'unità non dà soldi a un giocatore: è sempre la destinataria.
      if (!out.rMu) out.rMu = v;
    } else if (eNaz) {
      if (venditore) { if (!out.donorCountry) out.donorCountry = v; }
      else if (!out.rCountry) out.rCountry = v;
    } else if (venditore && !compratore) {
      if (!out.donor) out.donor = v;
    } else if (compratore) {
      if (!out.rUser) out.rUser = v;
    }
  }
  // La nazione di chi dona, se non è scritta: dalla mappa utente → nazione
  // (solo chi milita in una unità, ma è l'insieme che si conosce).
  if (!out.donorCountry && out.donor) {
    const rec = ctx.utenti[out.donor];
    if (rec?.[0]) out.donorCountry = rec[0];
  }
  return out;
}

const _giorno = (ts) => new Date(ts).toISOString().slice(0, 10);

/**
 * Le donazioni dei cittadini di una nazione e quelle ricevute dalle sue
 * unità militari, negli ultimi `days` giorni (UTC).
 */
function readDonations(countryId, days = 30) {
  if (!db) return null;
  days = Math.max(1, Math.min(400, Math.floor(Number(days)) || 30));
  const key = `${countryId}|${days}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.json;

  const ctx = _contesto();
  const mieMu = new Set([...ctx.muCountry].filter(([, c]) => c === countryId).map(([id]) => id));
  const dal = Date.now() - days * 86400_000;
  const righe = db.prepare('SELECT ts, money, item, ids FROM don WHERE ts >= ?').all(dal);

  const cittadini = new Map();   // giorno → { tot, tesoro, mu, utenti, n }
  const perMu = new Map();       // muId → { money, n, citizens, donors:Set, daily:Map }
  const donatori = new Set();
  const conti = { rows: righe.length, donor: 0, receiver: 0, donorOfNation: 0, itemOnly: 0 };

  for (const r of righe) {
    let ids;
    try { ids = JSON.parse(r.ids); } catch { continue; }
    const c = _classifica(ids, ctx);
    if (c.donor || c.donorCountry) conti.donor++;
    if (c.rMu || c.rCountry || c.rUser) conti.receiver++;
    const soldi = Number(r.money) || 0;
    if (!(soldi > 0)) { conti.itemOnly++; continue; }
    const g = _giorno(r.ts);
    const delMioPaese = c.donorCountry === countryId;
    if (delMioPaese) conti.donorOfNation++;

    if (delMioPaese) {
      const d = cittadini.get(g) || { tot: 0, tesoro: 0, mu: 0, utenti: 0, n: 0 };
      d.tot += soldi; d.n++;
      if (c.rMu) d.mu += soldi; else if (c.rCountry) d.tesoro += soldi; else d.utenti += soldi;
      cittadini.set(g, d);
      if (c.donor) donatori.add(c.donor);
    }
    if (c.rMu && mieMu.has(c.rMu)) {
      const m = perMu.get(c.rMu) || { money: 0, n: 0, citizens: 0, donors: new Set(), daily: new Map() };
      m.money += soldi; m.n++;
      if (delMioPaese) m.citizens += soldi;
      if (c.donor) m.donors.add(c.donor);
      m.daily.set(g, (m.daily.get(g) || 0) + soldi);
      perMu.set(c.rMu, m);
    }
  }

  const json = {
    available: true,
    days,
    coverageFrom: Number(_meta('startedAt')) || null,
    lastPoll: Number(_meta('lastPoll')) || null,
    classified: conti,
    // [giorno, totale, versoTesoro, versoUnita, versoGiocatori, n]
    daily: [...cittadini.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([g, d]) => [g, Math.round(d.tot), Math.round(d.tesoro), Math.round(d.mu), Math.round(d.utenti), d.n]),
    donors: donatori.size,
    byMu: [...perMu.entries()].map(([id, m]) => ({
      id, name: ctx.muName.get(id) || id,
      money: Math.round(m.money), n: m.n, citizens: Math.round(m.citizens), donors: m.donors.size,
      daily: [...m.daily.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([g, v]) => [g, Math.round(v)]),
    })).sort((a, b) => b.money - a.money),
  };
  _cache.set(key, { at: Date.now(), json });
  return json;
}

function readDonationsStatus() {
  if (!db) return { attivo: false };
  const v = db.prepare('SELECT COUNT(*) AS n, MIN(ts) AS min, MAX(ts) AS max FROM don').get();
  let campioni = [];
  try { campioni = JSON.parse(_meta('samples') || '[]'); } catch { /* ignorato */ }
  // I NOMI dei campi, non i valori: dicono se la classificazione ha capito.
  const campi = new Set();
  for (const s of campioni) for (const k of Object.keys(s || {})) campi.add(k);
  return {
    attivo: true,
    righe: v.n,
    piuVecchia: v.min ? new Date(v.min).toISOString() : null,
    piuRecente: v.max ? new Date(v.max).toISOString() : null,
    ultimoGiro: _meta('lastPoll') ? new Date(Number(_meta('lastPoll'))).toISOString() : null,
    fields: [...campi],
  };
}

module.exports = { initDonations, pollDonations, readDonations, readDonationsStatus };
