/* ═══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — il database
   -----------------------------------------------------------------------
   Primo pezzo di WarEra+ che SCRIVE. Tutto il resto del server legge dati
   pubblici e li rimette in cache: un file JSON riscritto per intero da un
   solo poller, dove l'ultima scrittura vince ed è giusto così.

   Qui no, e serve dire perché non si continua con i JSON:

     1. LA SCRITTURA PERSA. Con un'API HTTP due richieste arrivano insieme.
        Entrambe leggono il file, entrambe modificano la propria copia in
        memoria, entrambe riscrivono: la seconda cancella la prima. Due
        comandanti che prenotano nello stesso istante, e una richiesta
        sparisce senza un errore da nessuna parte.
     2. IL FILE TRONCATO. Un processo che muore a metà di writeFileSync
        lascia un JSON illeggibile, e si perde l'INTERO dataset, non
        l'ultima riga. Per una cache è irrilevante — al giro dopo si
        riempie. Le identità verificate invece non si rigenerano.
     3. I VINCOLI. `UNIQUE` su discord_id e war_user_id fa rispettare al
        database la regola "un account WarEra ↔ un account Discord",
        invece di affidarla a un controllo che bisogna ricordarsi di
        scrivere in ogni punto che tocca la tabella.

   Non è una questione di volume: sono decine di righe al giorno.

   ── PERCHÉ `node:sqlite` E NON `better-sqlite3` ────────────────────────
   Stesso identico motore. Il VPS è stato portato a Node 22 il 2026-09-02
   (prima girava la 20, fuori supporto da aprile), e da lì SQLite è dentro
   Node: zero dipendenze native, niente compilatore, e il deploy resta lo
   scp di file .js senza npm install. Stampa un ExperimentalWarning ad ogni
   avvio, silenziato con --disable-warning=ExperimentalWarning nei flag pm2.

   ── I DATI VECCHI NON SI TOCCANO ───────────────────────────────────────
   cache/, l'archivio battaglie e i bonifici restano JSON come sono: hanno
   un solo scrittore e nessuno dei tre problemi qui sopra.
   ═══════════════════════════════════════════════════════════════════════ */

const { DatabaseSync } = require('node:sqlite');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// La cartella dati NON sta dentro quella del codice per un motivo pratico:
// il deploy è uno scp che sovrascrive i .js, e un giorno una wildcard di
// troppo porterebbe via il database con sé. Stessa logica di cache/.
const DATA_DIR = process.env.DATA_DIR
  ? path.resolve(process.env.DATA_DIR)
  : path.join(__dirname, '..', '..', 'data');

let db = null;

// ---------------------------------------------------------------------------
// SCHEMA
// ---------------------------------------------------------------------------
// `IF NOT EXISTS` ovunque: initDb() gira ad ogni avvio, e un pm2 restart non
// deve essere un evento. Le migrazioni future vanno in migrate() più sotto,
// non modificando queste CREATE — chi ha già il database non le rieseguirebbe.
const SCHEMA = `
CREATE TABLE IF NOT EXISTS account (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  discord_id        TEXT    NOT NULL UNIQUE,
  discord_username  TEXT    NOT NULL,
  discord_avatar    TEXT,
  -- Restano NULL finché il giocatore non prova di essere chi dice (il codice
  -- nel nome dell'azienda). L'account Discord da solo non dice niente sul
  -- gioco: è solo un'ancora stabile a cui appendere l'identità vera.
  war_user_id       TEXT    UNIQUE,
  war_username      TEXT,
  linked_at         INTEGER,
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS session (
  -- Si salva lo SHA-256 del token, mai il token. Se il file finisse in mano
  -- a qualcuno, non ci si potrebbe fare login: l'hash non è riconvertibile.
  -- Costa un digest per richiesta, che è niente.
  token_hash   TEXT    PRIMARY KEY,
  account_id   INTEGER NOT NULL REFERENCES account(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_session_account ON session(account_id);
CREATE INDEX IF NOT EXISTS idx_session_expires ON session(expires_at);

-- Ogni transizione di stato dell'area riservata finisce qui. Serve a
-- rispondere a "chi ha approvato cosa e quando" mesi dopo, che è metà del
-- valore del sistema: oggi quella storia vive in una chat Discord e scorre
-- via. Non si cancella mai per anzianità.
CREATE TABLE IF NOT EXISTS audit (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  at         INTEGER NOT NULL,
  actor_id   INTEGER REFERENCES account(id) ON DELETE SET NULL,
  action     TEXT    NOT NULL,
  entity     TEXT,
  detail     TEXT
);
CREATE INDEX IF NOT EXISTS idx_audit_at ON audit(at);
`;

function initDb() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const file = path.join(DATA_DIR, 'plus.sqlite');

  db = new DatabaseSync(file);

  // WAL: un lettore non blocca uno scrittore. Con un solo processo e questi
  // volumi non è una necessità di prestazioni — serve perché un crash a metà
  // scrittura lascia il database coerente invece che troncato, che è la
  // ragione numero 2 in testa al file.
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  // NORMAL invece di FULL: si rinuncia alla durabilità dell'ultima
  // transazione in caso di spegnimento brutale della macchina, non alla
  // coerenza. Per una prenotazione di contratto è un compromesso onesto.
  db.exec('PRAGMA synchronous = NORMAL');

  db.exec(SCHEMA);
  migrate();

  return db;
}

// Le colonne nuove si aggiungono qui, non nelle CREATE sopra: un database
// già esistente non rilegge quelle. `PRAGMA table_info` dice cosa c'è già,
// così la funzione è ripetibile a ogni avvio senza effetti.
function migrate() {
  // (nessuna migrazione ancora — il primo schema è questo)
}

function getDb() {
  if (!db) throw new Error('initDb() non è stata chiamata');
  return db;
}

// ---------------------------------------------------------------------------
// ACCOUNT
// ---------------------------------------------------------------------------

/** Trova l'account per id Discord, o lo crea al primo accesso. */
function upsertDiscordAccount({ discordId, username, avatar }) {
  const now = Date.now();
  const existing = getDb()
    .prepare('SELECT * FROM account WHERE discord_id = ?')
    .get(discordId);

  if (existing) {
    // Il nome su Discord si può cambiare quando si vuole: si riallinea ad
    // ogni accesso, altrimenti l'interfaccia mostrerebbe per sempre quello
    // del giorno dell'iscrizione.
    getDb()
      .prepare('UPDATE account SET discord_username = ?, discord_avatar = ?, last_seen_at = ? WHERE id = ?')
      .run(username, avatar || null, now, existing.id);
    return getDb().prepare('SELECT * FROM account WHERE id = ?').get(existing.id);
  }

  const info = getDb()
    .prepare(`INSERT INTO account (discord_id, discord_username, discord_avatar, created_at, last_seen_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(discordId, username, avatar || null, now, now);

  return getDb().prepare('SELECT * FROM account WHERE id = ?').get(info.lastInsertRowid);
}

function getAccountById(id) {
  return getDb().prepare('SELECT * FROM account WHERE id = ?').get(id) || null;
}

/** Cancella account e, a cascata, le sue sessioni. Il bottone "scollega e
 *  cancella" deve cancellare davvero: è l'unica promessa che non si può
 *  permettere di essere approssimativa. */
function deleteAccount(id) {
  getDb().prepare('DELETE FROM account WHERE id = ?').run(id);
}

// ---------------------------------------------------------------------------
// SESSIONI
// ---------------------------------------------------------------------------
// Token opaco nell'header Authorization, non cookie. Motivo: il cache-server
// espone origin:'*' e i cookie obbligherebbero a un'allowlist con credenziali
// più tutta la superficie CSRF che ne segue. Un Bearer che il browser non
// manda da solo quella superficie non ce l'ha.

const SESSION_TTL_MS = 30 * 24 * 3600 * 1000; // 30 giorni

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

/** Crea una sessione e restituisce il token in chiaro — l'unica volta in cui
 *  esiste da questa parte. Da qui in poi il server conosce solo l'hash. */
function createSession(accountId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  getDb()
    .prepare(`INSERT INTO session (token_hash, account_id, created_at, expires_at, last_used_at)
              VALUES (?, ?, ?, ?, ?)`)
    .run(sha256(token), accountId, now, now + SESSION_TTL_MS, now);
  return token;
}

/** Account della sessione, o null. Scaduta = cancellata al volo: la pulizia
 *  periodica sotto serve solo per le sessioni che nessuno riusa mai più. */
function accountFromToken(token) {
  if (!token) return null;
  const hash = sha256(token);
  const row = getDb().prepare('SELECT * FROM session WHERE token_hash = ?').get(hash);
  if (!row) return null;

  if (row.expires_at < Date.now()) {
    getDb().prepare('DELETE FROM session WHERE token_hash = ?').run(hash);
    return null;
  }

  getDb().prepare('UPDATE session SET last_used_at = ? WHERE token_hash = ?').run(Date.now(), hash);
  return getAccountById(row.account_id);
}

function destroySession(token) {
  if (!token) return;
  getDb().prepare('DELETE FROM session WHERE token_hash = ?').run(sha256(token));
}

function purgeExpiredSessions() {
  const info = getDb().prepare('DELETE FROM session WHERE expires_at < ?').run(Date.now());
  return info.changes || 0;
}

// ---------------------------------------------------------------------------
// AUDIT
// ---------------------------------------------------------------------------

function audit(actorId, action, entity, detail) {
  getDb()
    .prepare('INSERT INTO audit (at, actor_id, action, entity, detail) VALUES (?, ?, ?, ?, ?)')
    .run(Date.now(), actorId || null, action, entity || null,
         detail == null ? null : (typeof detail === 'string' ? detail : JSON.stringify(detail)));
}

// ---------------------------------------------------------------------------
// STATO (per /health)
// ---------------------------------------------------------------------------

function dbStatus() {
  const one = (sql) => {
    try { return getDb().prepare(sql).get()?.n ?? 0; } catch { return null; }
  };
  return {
    file: path.join(DATA_DIR, 'plus.sqlite'),
    accounts: one('SELECT COUNT(*) AS n FROM account'),
    verificati: one('SELECT COUNT(*) AS n FROM account WHERE war_user_id IS NOT NULL'),
    sessioniAttive: one(`SELECT COUNT(*) AS n FROM session WHERE expires_at > ${Date.now()}`),
  };
}

module.exports = {
  initDb, getDb, DATA_DIR,
  upsertDiscordAccount, getAccountById, deleteAccount,
  createSession, accountFromToken, destroySession, purgeExpiredSessions,
  audit, dbStatus,
};
