/* ══════════════════════════════════════════════════════════════════════
   WarEra+ — Registro degli ORDINI NAZIONALI nelle battaglie
   ----------------------------------------------------------------------
   Richiesta dell'utente (2026-11-12): il controllo dei patti (Accordi) non
   deve guardare solo il DANNO ma anche gli ORDINI. Capita che i giocatori
   facciano danno a una nazione con cui c'è un NAP senza che il loro governo
   l'abbia voluto: se la nazione non ha messo nessun ordine su quella
   battaglia, il danno non era voluto. E un ordine si può togliere.

   ── PERCHÉ UN ARCHIVIO ────────────────────────────────────────────────
   Un ordine nazionale (`battleOrder`) esiste solo finché è attivo:
     · battleOrder.getByBattle ne rende solo quelli ATTIVI (misurato il
       2026-11-12 su 25 battaglie: 837 ordini, zero con isActive false);
     · a battaglia chiusa rende una lista VUOTA, e lo stesso per le 80
       battaglie concluse provate: il gioco li butta;
     · l'ordine tolto sparisce: non ha un "tolto alle", non c'è modo di
       saperlo dopo.
   Quindi A RITROSO NON ESISTE e il registro si ACCUMULA da quando guarda,
   come i bonifici e il danno orario. Non provare a riempirlo con
   un'ipotesi: sarebbe un "nessun ordine" inventato.

   ── DA DOVE ARRIVA, E QUANTO COSTA ────────────────────────────────────
   Ogni battaglia attiva porta già, per lato, `countryOrders`: gli id delle
   nazioni che hanno un ordine attivo su quel lato (verificato: coincide
   con gli ordini `country` di getByBattle, zero differenze su 50 letture).
   Il registro si nutre dell'elenco che il cache-server SCARICA GIÀ ogni
   minuto per l'andamento delle battaglie (fetchActiveBattles): nessuna
   richiesta in più per la presenza. Solo quando compare una nazione nuova
   si chiede getByBattle di quel lato, per l'ora esatta in cui l'ordine fu
   messo (`createdAt`, anche prima che guardassimo), la priorità e chi
   l'ha dato. Gli ordini delle UNITÀ (`mu`) non si registrano: la
   richiesta è sugli ordini NAZIONALI.

   ── COSA SI SA, E COSA NO ─────────────────────────────────────────────
   Un ordine è un intervallo { c nazione, s lato 'a'|'d', f da, t a }:
     · `f` è esatto se `fx` (ora di creazione data dal gioco), altrimenti
       è l'istante in cui l'abbiamo visto;
     · `t` è il primo giro in cui NON c'era più: la rimozione è avvenuta
       fra l'ultimo giro in cui c'era e quello (≤ 1 minuto, salvo pm2
       fermo). `te` = 1 vuol dire che non è stato tolto, ma finito con la
       battaglia (`t` = ultima volta che la battaglia si è vista);
     · una battaglia vista dopo più di tre minuti dalla sua apertura ha
       `g` = 1: un ordine messo e tolto PRIMA di allora non lo vediamo, e
       il controllo non può dire "nessun ordine" ma solo "non so".
   Una battaglia mai vista (finita prima che questo registro nascesse) non
   c'è proprio: il controllo la chiama "non registrata".

   ── DOVE STA ──────────────────────────────────────────────────────────
   Le battaglie APERTE in cache/battle-orders.json (piccolo, riscritto a
   ogni cambio); a chiusura finiscono, una volta sola, in
   cache/battle-orders-closed.jsonl (una riga per battaglia) e restano in
   memoria. NESSUNA potatura: è un dato che non esiste in nessun altro
   posto, e pesa ~300 byte a battaglia (~5 MB l'anno). Il cron del backup
   copia tutta la cache.
   ══════════════════════════════════════════════════════════════════════ */

const fs = require('fs');
const path = require('path');

const FILE = 'battle-orders';
const CLOSED_FILE = path.join(__dirname, 'cache', 'battle-orders-closed.jsonl');
const MISS_TO_CLOSE = 3;          // giri (minuti) di assenza prima di chiudere
const GAP_MS = 3 * 60 * 1000;     // oltre questo, una battaglia l'abbiamo vista tardi
const MAX_DETAIL_PER_GIRO = 40;   // richieste getByBattle per giro
const MAX_TENTATIVI = 5;

let deps = null;                  // { trpcBatch, readCache, writeCache }
let state = { startedAt: null, battles: {} };   // le APERTE
const closed = new Map();         // le chiuse, id -> record
const miss = new Map();           // id -> giri di assenza (solo memoria)
const pending = new Map();        // 'id|a' -> tentativi di getByBattle
let meta = { lastPollAt: null, lastError: null };
let _busy = false;
let _lastFlush = 0;

const _ts = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };

function initBattleOrders(d) {
  deps = d;
  const saved = deps.readCache(FILE, null);
  if (saved && saved.battles) state = { startedAt: saved.startedAt || null, battles: saved.battles };
  try {
    if (fs.existsSync(CLOSED_FILE)) {
      for (const line of fs.readFileSync(CLOSED_FILE, 'utf-8').split('\n')) {
        if (!line) continue;
        try { const r = JSON.parse(line); if (r && r.id) closed.set(r.id, r); } catch (_) { /* riga mozza: si salta */ }
      }
    }
  } catch (err) { console.error('[battle-orders] lettura chiuse:', err.message); }
  // Gli ordini rimasti senza dettagli prima di un riavvio si richiedono di nuovo.
  for (const rec of Object.values(state.battles)) {
    for (const o of rec.o) if (o.t == null && o.p == null) pending.set(`${rec.id}|${o.s}`, 0);
  }
}

function _flush(force = false) {
  const now = Date.now();
  if (!force && now - _lastFlush < 60 * 1000) return;
  _lastFlush = now;
  try { deps.writeCache(FILE, state, { compact: true }); }
  catch (err) { console.error('[battle-orders] scrittura:', err.message); }
}

function _close(rec) {
  rec.e = rec.l;
  for (const o of rec.o) if (o.t == null) { o.t = rec.l; o.te = 1; }
  try {
    fs.mkdirSync(path.dirname(CLOSED_FILE), { recursive: true });
    fs.appendFileSync(CLOSED_FILE, JSON.stringify(rec) + '\n');
  } catch (err) { console.error(`[battle-orders] archivio ${rec.id} fallito:`, err.message); return false; }
  closed.set(rec.id, rec);
  delete state.battles[rec.id];
  miss.delete(rec.id);
  pending.delete(`${rec.id}|a`);
  pending.delete(`${rec.id}|d`);
  return true;
}

/**
 * Registra lo stato degli ordini nazionali di tutte le battaglie ATTIVE.
 * Va chiamata con l'elenco che il giro delle battaglie ha già in mano; non
 * lancia mai (un guasto qui non deve toccare l'andamento delle battaglie).
 */
function observeBattleOrders(battles, now = Date.now()) {
  if (!deps || !Array.isArray(battles)) return;
  try {
    if (!state.startedAt) state.startedAt = now;
    let dirty = false;
    const seen = new Set();

    for (const b of battles) {
      if (!b?._id) continue;
      seen.add(b._id);
      miss.delete(b._id);
      let rec = state.battles[b._id];
      if (!rec) {
        const cr = _ts(b.createdAt);
        rec = {
          id: b._id,
          atk: b.attacker?.country || null,
          def: b.defender?.country || null,
          reg: b.defender?.region || b.attacker?.region || null,
          cr,
          f: now,
          l: now,
          e: null,
          g: cr && now - cr > GAP_MS ? 1 : 0,
          o: [],
        };
        state.battles[b._id] = rec;
        dirty = true;
      }
      rec.l = now;

      for (const [side, k] of [['attacker', 'a'], ['defender', 'd']]) {
        const list = b[side]?.countryOrders;
        if (!Array.isArray(list)) continue;      // campo assente: non è "nessun ordine"
        const present = new Set(list);
        for (const o of rec.o) {
          if (o.s === k && o.t == null && !present.has(o.c)) { o.t = now; dirty = true; }
        }
        for (const c of present) {
          if (rec.o.some((o) => o.s === k && o.c === c && o.t == null)) continue;
          rec.o.push({ c, s: k, f: now, fx: 0, t: null, p: null, u: null });
          pending.set(`${rec.id}|${k}`, pending.get(`${rec.id}|${k}`) || 0);
          dirty = true;
        }
      }
    }

    // Sparite dall'elenco: si chiudono dopo qualche giro di assenza, perché
    // una lista monca (429 a metà paginazione) non è una battaglia finita.
    for (const id of Object.keys(state.battles)) {
      if (seen.has(id)) continue;
      const n = (miss.get(id) || 0) + 1;
      miss.set(id, n);
      if (n >= MISS_TO_CLOSE && _close(state.battles[id])) dirty = true;
    }

    meta.lastPollAt = now;
    meta.lastError = null;
    if (dirty) _flush(true); else if (now - _lastFlush > 10 * 60 * 1000) _flush(true);
    if (pending.size) fetchDetails().catch((err) => { meta.lastError = err.message; });
  } catch (err) {
    meta.lastError = err.message;
    console.error('[battle-orders] giro fallito:', err.message);
  }
}

/** Ora esatta, priorità e autore degli ordini comparsi. In coda, un giro alla volta. */
async function fetchDetails() {
  if (_busy || !pending.size) return;
  _busy = true;
  try {
    const keys = [...pending.keys()].slice(0, MAX_DETAIL_PER_GIRO);
    const calls = keys.map((k) => {
      const [id, s] = k.split('|');
      return ['battleOrder.getByBattle', { battleId: id, side: s === 'a' ? 'attacker' : 'defender' }];
    });
    let res = [];
    try { res = await deps.trpcBatch(calls, { useWorker: true }); } catch (_) { res = []; }
    let dirty = false;
    keys.forEach((k, i) => {
      const [id, s] = k.split('|');
      const rec = state.battles[id];
      const list = res[i];
      const tries = (pending.get(k) || 0) + 1;
      if (!rec) { pending.delete(k); return; }
      if (Array.isArray(list)) {
        for (const o of rec.o) {
          if (o.s !== s || o.t != null || o.p != null) continue;
          const mine = list.filter((x) => x?.country === o.c && x.isActive !== false);
          if (!mine.length) continue;
          const first = mine.reduce((m, x) => ((_ts(x.createdAt) || Infinity) < (_ts(m.createdAt) || Infinity) ? x : m));
          const cr = _ts(first.createdAt);
          if (cr) { o.f = cr; o.fx = 1; }
          o.p = first.priority || 'medium';
          o.u = first.user || null;
          dirty = true;
        }
      }
      const resta = rec.o.some((o) => o.s === s && o.t == null && o.p == null);
      if (!resta || tries >= MAX_TENTATIVI) pending.delete(k); else pending.set(k, tries);
    });
    if (dirty) _flush(true);
  } finally {
    _busy = false;
  }
}

/** Gli ordini registrati per le battaglie chieste (id), aperte o chiuse. */
function readBattleOrders(ids) {
  const out = {};
  for (const id of ids) {
    const rec = state.battles[id] || closed.get(id);
    if (rec) out[id] = rec;
  }
  return { startedAt: state.startedAt, fetchedAt: meta.lastPollAt, battles: out };
}

function statoBattleOrders() {
  const aperte = Object.values(state.battles);
  return {
    startedAt: state.startedAt,
    lastPollAt: meta.lastPollAt,
    lastError: meta.lastError,
    aperte: aperte.length,
    chiuse: closed.size,
    ordiniAttivi: aperte.reduce((n, r) => n + r.o.filter((o) => o.t == null).length, 0),
    dettagliInCoda: pending.size,
  };
}

module.exports = { initBattleOrders, observeBattleOrders, readBattleOrders, statoBattleOrders };
