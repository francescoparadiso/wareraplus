/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Archivio delle donazioni (transactionType: 'donation')
   -----------------------------------------------------------------------
   Alimenta la scheda «Economia» di Statistiche nazioni. Rotta:
   /donations?country=ID&days=N.

   ── LA FORMA DELLA RIGA E IL SUO VERSO ──────────────────────────────────
   Una riga `donation` ha sempre la stessa forma (verificato sul vivo,
   2026-11-13, su 22.800 righe):
       { money, buyerId, sellerCountryId | sellerMuId | sellerPartyId }
   ⚠️ Il verso è quello del GIOCO, non quello che i nomi farebbero pensare
   per analogia coi bonifici fra tesori: i giocatori donano a nazioni, unità
   e partiti, e le nazioni non pagano i giocatori (lo fanno solo comprando
   sul mercato o coi contratti). Quindi `buyerId` è il DONATORE (un
   giocatore) e `seller*Id` è CHI RICEVE: nome «venditore» perché è il lato
   che incassa, come in ogni altra transazione di soldi.
   (Per un po' questo modulo ha letto il verso al contrario, dedotto per
   analogia con `countryMoneyTransfer` invece che dal gioco: non rifarlo.)
   Su 6.000 righe: 59% a una nazione, 40% a un'unità, 1% a un partito.

   Per una nazione X si leggono due cose:
     · quanto ha ricevuto il tesoro di X (sellerCountryId = X);
     · quanto hanno ricevuto le unità REGISTRATE in X (sellerMuId nella
       directory con `country` = X), unità per unità.
   I donatori sono contati qualunque sia la loro nazione: la riga non la
   porta, e la mappa utente → nazione copre solo chi sta in un'unità.
   Il partito resta in archivio (`sellerPartyId`) ma non si espone: i
   partiti non hanno la nazione nella riga.

   ── ARCHIVIO ────────────────────────────────────────────────────────────
   Si salvano i campi-id grezzi con il loro nome (`ids`), non una
   classificazione: se il gioco aggiunge una forma nuova non si perde niente
   e si corregge solo la lettura. ~8.000 righe al giorno in tutto il mondo.
   L'API ne ricorda una finestra limitata e non uno storico: l'archivio si
   accumula dal primo avvio (il primo giro scende fin dove arriva il
   cursore), `coverageFrom` dice da quando è affidabile. sqlite su disco
   (cache/donations.sqlite): il VPS ha 954 MB di RAM in tutto. NON si pota.
   ═══════════════════════════════════════════════════════════════════════ */

const path = require('path');

let DatabaseSync = null;
try { ({ DatabaseSync } = require('node:sqlite')); } catch (_) { /* il modulo si spegne, il server no */ }

let deps = null;
let db = null;

const PAGE = 100;
// Primo giro (archivio vuoto): si sfoglia fin dove l'API arriva. Dopo, un
// giro si ferma alla prima pagina interamente già vista.
const MAX_PAGES_FIRST = 400;   // ~40.000 righe: fin dove l'API arriva
const MAX_PAGES = 25;
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
let _inCorso = false;
async function pollDonations() {
  if (!deps || !db || _inCorso) return;
  _inCorso = true;
  try { await _pollDonations(); } finally { _inCorso = false; }
}

async function _pollDonations() {
  if (!deps.apiToken) {
    console.warn('[donations] WARERA_API_TOKEN assente: archivio fermo (401 sulle transazioni)');
    return;
  }
  // Il primo giro non si ferma alla prima pagina già vista: scende finché il
  // cursore finisce (o al tetto), e solo allora segna `bootstrap`. Le righe
  // già in archivio si saltano con INSERT OR IGNORE.
  const primo = !_meta('bootstrap');
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
      if (!items.length || !nextCursor) break;
      if (!primo && !nuovePagina) break;
      cursor = nextCursor;
    }
    // Arrivati in fondo al cursore o al tetto senza errori: il recupero è
    // fatto. Un errore lascia il flag spento e il giro dopo riprova.
    if (primo) _setMeta('bootstrap', Date.now());
  } catch (err) {
    console.error('[donations] giro fallito:', err.message);
  }

  // Durante il primo giro l'inizio si riabbassa a ogni passata: è la riga più
  // vecchia che siamo riusciti a leggere, e il bootstrap può ripartire.
  if (!_meta('startedAt') || primo) {
    const min = db.prepare('SELECT MIN(ts) AS m FROM don').get().m;
    _setMeta('startedAt', min || Date.now());
  }
  _setMeta('lastPoll', Date.now());
  _cache.clear();
  if (nuove) console.log(`[donations] +${nuove}`);
}

// ── Lettura ─────────────────────────────────────────────────────────────

const _cache = new Map();   // "country|days" → { at, json }

function _contesto() {
  const dir = deps.readCache('mu-directory', { data: [] }).data || [];
  const muCountry = new Map();   // muId → countryId
  const muName = new Map();
  for (const m of dir) { muCountry.set(m._id, m.country); muName.set(m._id, m.name); }
  return { muCountry, muName };
}

const _giorno = (ts) => new Date(ts).toISOString().slice(0, 10);

/**
 * Quanto hanno donato i giocatori al tesoro di una nazione e alle sue unità
 * militari, negli ultimi `days` giorni (UTC).
 */
function readDonations(countryId, days = 30) {
  if (!db) return null;
  days = Math.max(1, Math.min(400, Math.floor(Number(days)) || 30));
  const key = `${countryId}|${days}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.json;

  const ctx = _contesto();
  const dal = Date.now() - days * 86400_000;
  const righe = db.prepare('SELECT ts, money, ids FROM don WHERE ts >= ?').all(dal);

  const tesoro = new Map();      // giorno → { money, n }
  const donatoriTesoro = new Set();
  const perMu = new Map();       // muId → { money, n, donors:Set, daily:Map }
  // giver = righe con un donatore (buyerId), receiver = righe con un
  // destinatario (nazione, unità o partito): se uno dei due è 0 la forma è cambiata.
  const conti = { rows: righe.length, giver: 0, receiver: 0 };

  for (const r of righe) {
    let ids;
    try { ids = JSON.parse(r.ids); } catch { continue; }
    const soldi = Number(r.money) || 0;
    const nazione = ids.sellerCountryId || null;
    const mu = ids.sellerMuId || null;
    if (ids.buyerId) conti.giver++;
    if (nazione || mu || ids.sellerPartyId) conti.receiver++;
    if (!(soldi > 0)) continue;
    const g = _giorno(r.ts);

    if (nazione === countryId) {
      const d = tesoro.get(g) || { money: 0, n: 0 };
      d.money += soldi; d.n++;
      tesoro.set(g, d);
      if (ids.buyerId) donatoriTesoro.add(ids.buyerId);
    } else if (mu && ctx.muCountry.get(mu) === countryId) {
      const m = perMu.get(mu) || { money: 0, n: 0, donors: new Set(), daily: new Map() };
      m.money += soldi; m.n++;
      if (ids.buyerId) m.donors.add(ids.buyerId);
      m.daily.set(g, (m.daily.get(g) || 0) + soldi);
      perMu.set(mu, m);
    }
  }

  const unitaPerGiorno = new Map();
  for (const m of perMu.values()) for (const [g, v] of m.daily) unitaPerGiorno.set(g, (unitaPerGiorno.get(g) || 0) + v);
  const giorni = [...new Set([...tesoro.keys(), ...unitaPerGiorno.keys()])].sort();

  const json = {
    available: true,
    days,
    coverageFrom: Number(_meta('startedAt')) || null,
    lastPoll: Number(_meta('lastPoll')) || null,
    classified: conti,
    // [giorno, alTesoro, alleUnita, nAlTesoro]
    daily: giorni.map(g => [g, Math.round(tesoro.get(g)?.money || 0), Math.round(unitaPerGiorno.get(g) || 0), tesoro.get(g)?.n || 0]),
    treasury: {
      money: Math.round([...tesoro.values()].reduce((a, d) => a + d.money, 0)),
      n: [...tesoro.values()].reduce((a, d) => a + d.n, 0),
      donors: donatoriTesoro.size,
    },
    byMu: [...perMu.entries()].map(([id, m]) => ({
      id, name: ctx.muName.get(id) || id,
      money: Math.round(m.money), n: m.n, donors: m.donors.size,
      daily: [...m.daily.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([g, v]) => [g, Math.round(v)]),
    })).sort((a, b) => b.money - a.money),
  };
  _cache.set(key, { at: Date.now(), json });
  return json;
}

/**
 * Le donazioni ricevute da OGNI nazione (tesoro e unità registrate lì) negli
 * ultimi `days` giorni: serve al confronto fra nazioni (donazioni per
 * cittadino, per punto di sviluppo). Una passata sull'archivio, memoria per
 * cinque minuti. `countries`: [[countryId, alTesoro, alleUnita, nAlTesoro,
 * nAlleUnita, donatoriDistinti]] — i donatori sono contati una volta per
 * nazione anche se hanno donato sia al tesoro sia a un'unità.
 */
function readDonationsByCountry(days = 30) {
  if (!db) return null;
  days = Math.max(1, Math.min(400, Math.floor(Number(days)) || 30));
  const key = `*|${days}`;
  const hit = _cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.json;

  const ctx = _contesto();
  const dal = Date.now() - days * 86400_000;
  const righe = db.prepare('SELECT money, ids FROM don WHERE ts >= ?').all(dal);
  const per = new Map();   // countryId → { tre, uni, nTre, nUni, donors:Set }
  let letti = 0;
  for (const r of righe) {
    let ids;
    try { ids = JSON.parse(r.ids); } catch { continue; }
    const soldi = Number(r.money) || 0;
    if (!(soldi > 0)) continue;
    const viaMu = ids.sellerMuId ? ctx.muCountry.get(ids.sellerMuId) : null;
    const cid = ids.sellerCountryId || viaMu;
    if (!cid) continue;
    letti++;
    const e = per.get(cid) || { tre: 0, uni: 0, nTre: 0, nUni: 0, donors: new Set() };
    if (ids.sellerCountryId) { e.tre += soldi; e.nTre++; } else { e.uni += soldi; e.nUni++; }
    if (ids.buyerId) e.donors.add(ids.buyerId);
    per.set(cid, e);
  }
  const json = {
    available: true,
    days,
    coverageFrom: Number(_meta('startedAt')) || null,
    classified: { rows: righe.length, read: letti },
    countries: [...per.entries()].map(([c, e]) => [c, Math.round(e.tre), Math.round(e.uni), e.nTre, e.nUni, e.donors.size]),
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
    bootstrap: !!_meta('bootstrap'),
    ultimoGiro: _meta('lastPoll') ? new Date(Number(_meta('lastPoll'))).toISOString() : null,
    fields: [...campi],
  };
}

module.exports = { initDonations, pollDonations, readDonations, readDonationsByCountry, readDonationsStatus };
