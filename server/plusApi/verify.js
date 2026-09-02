/* ═══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — collegare il personaggio di gioco
   -----------------------------------------------------------------------
   auth.js prova che sei il proprietario di un account Discord. Non dice
   niente su chi sei nel gioco, ed è una domanda diversa che fallisce per
   ragioni diverse. Questo file risponde alla seconda.

   ── COME ───────────────────────────────────────────────────────────────
   Il giocatore dichiara il proprio nome, sceglie sé stesso fra gli
   omonimi, riceve un codice `WP-XXXXXX` e lo mette nel nome di una sua
   azienda. Il server rilegge le aziende DI QUELLO userId e cerca il
   codice. È lo stesso meccanismo dei bot Discord che i giocatori già
   conoscono, e questo conta: non bisogna spiegare niente.

   ── PERCHÉ NON SI PUÒ RUBARE ───────────────────────────────────────────
   Il codice è legato allo **userId**, e la domanda che si fa all'API non è
   "chi ha questo codice" ma "questo giocatore ha questo codice". Chi
   copiasse un codice altrui nella propria azienda non otterrebbe niente:
   verrebbe cercato nelle aziende di un altro. In più `company.getById`
   restituisce `user`, cioè il proprietario, e lo si ricontrolla lì invece
   di fidarsi solo dell'elenco.

   ── COSTO: ZERO CHIAVI ─────────────────────────────────────────────────
   Misurato il 2026-09-02: `search.searchUsers`, `user.getUserLite`,
   `company.getCompanies` e `company.getById` rispondono TUTTE da api6
   senza X-API-Key. Quindi niente proxy, niente budget del Worker, e il
   processo non ha bisogno di una seconda copia del token. Un tentativo di
   verifica costa due richieste: l'elenco delle aziende e un batch che
   ne legge i nomi.

   ── E CHI NON HA AZIENDE ───────────────────────────────────────────────
   Una minoranza, fra ministri e comandanti. Per loro non si inventa un
   secondo meccanismo tecnico: un amministratore collega a mano, e resta
   scritto nell'audit chi l'ha fatto. Scrivere un articolo col codice
   sarebbe stata l'alternativa ovvia, ma costa 3 monete: un meccanismo di
   verifica che si paga è un meccanismo che qualcuno non userà.
   ═══════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');
const express = require('express');
const {
  getDb, getAccountById, setWarIdentity, findAccountByWarUserId,
  getClaim, setClaim, deleteClaim, audit,
} = require('./db');

const API = 'https://api6.warera.io/trpc';

const CODE_TTL_MS = 30 * 60 * 1000;   // mezz'ora per andare in gioco e rinominare
const MAX_COMPANIES = 20;
const CHECK_MIN_GAP_MS = 8000;        // fra due verifiche consecutive
const CHECK_MAX_PER_CLAIM = 40;

// Alfabeto senza caratteri che si leggono male da uno screenshot o si
// digitano al posto di un altro: niente 0/O, 1/I/L, 5/S, 8/B. Chi trascrive
// il codice a mano nel gioco non deve poter sbagliare.
const ALPHABET = '23479ACDEFGHJKMNPQRTUVWXYZ';

function generaCodice() {
  const b = crypto.randomBytes(6);
  let s = '';
  for (let i = 0; i < 6; i++) s += ALPHABET[b[i] % ALPHABET.length];
  return `WP-${s}`;
}

// Confronto tollerante: il giocatore può scrivere il codice in minuscolo,
// senza trattino, o attaccato al nome dell'azienda. Si normalizzano
// entrambi i lati a sole lettere e cifre maiuscole.
const normalizza = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

// ---------------------------------------------------------------------------
// Chiamate a WarEra (tutte pubbliche)
// ---------------------------------------------------------------------------

/** Errore che distingue "il gioco dice di no" da "il gioco non risponde".
 *  Servono due messaggi diversi: dire "gioco non raggiungibile" a chi ha
 *  solo sbagliato personaggio lo manda a controllare la propria
 *  connessione invece del nome che ha scritto. */
class TrpcError extends Error {
  constructor(proc, codice, messaggio) {
    super(`${proc}: ${messaggio}`);
    this.codiceGioco = codice; // es. 'NOT_FOUND'
  }
}

async function trpcGet(proc, input) {
  const url = `${API}/${proc}?input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });

  // Un 404 di tRPC ha comunque un corpo con l'errore dentro: si legge
  // quello invece di fermarsi al codice HTTP.
  let body = null;
  try { body = await res.json(); } catch { /* risposta non JSON */ }

  if (body?.error) throw new TrpcError(proc, body.error?.data?.code || 'ERRORE', body.error.message);
  if (!res.ok) throw new Error(`${proc}: HTTP ${res.status}`);
  return body.result.data;
}

/** Più chiamate alla STESSA procedura in un solo GET. Il formato è quello
 *  che usa già src/diplomacy/utils.js: `proc,proc?batch=1&input={"0":…}`. */
async function trpcBatch(proc, inputs) {
  if (!inputs.length) return [];
  const url = `${API}/${new Array(inputs.length).fill(proc).join(',')}`
    + `?batch=1&input=${encodeURIComponent(JSON.stringify(Object.fromEntries(inputs.map((v, i) => [i, v]))))}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${proc} batch: HTTP ${res.status}`);
  const body = await res.json();
  return (Array.isArray(body) ? body : [body]).map((x) => x?.result?.data ?? null);
}

// ---------------------------------------------------------------------------
// Rotte
// ---------------------------------------------------------------------------

function buildVerifyRouter({ requireAuth, requireAdmin }) {
  const router = express.Router();

  // ── 1. Chi sei nel gioco? ───────────────────────────────────────────────
  // searchUsers restituisce solo id: senza una seconda chiamata l'utente
  // dovrebbe scegliere fra stringhe esadecimali. Si risolvono in nome,
  // avatar e nazione così la scelta è possibile — i nomi non sono univoci.
  router.post('/search', requireAuth, async (req, res) => {
    const testo = String(req.body?.username || '').trim();
    if (testo.length < 2) return res.status(400).json({ error: 'nome_troppo_corto' });

    try {
      const ids = (await trpcGet('search.searchUsers', { searchText: testo })) || [];
      const scelti = ids.slice(0, 8);
      const utenti = await trpcBatch('user.getUserLite', scelti.map((userId) => ({ userId })));
      res.json({
        candidati: scelti.map((id, i) => ({
          warUserId: id,
          username: utenti[i]?.username || null,
          avatarUrl: utenti[i]?.avatarUrl || null,
          countryId: utenti[i]?.country || null,
        })).filter((u) => u.username),
        troncato: ids.length > scelti.length,
      });
    } catch (err) {
      console.error('[verify] ricerca fallita:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  // ── 2. Dammi un codice ──────────────────────────────────────────────────
  router.post('/start', requireAuth, async (req, res) => {
    const warUserId = String(req.body?.warUserId || '').trim();
    if (!/^[a-f0-9]{24}$/.test(warUserId)) return res.status(400).json({ error: 'id_non_valido' });

    // Un personaggio, un solo account Discord. Il vincolo c'è anche nel
    // database (UNIQUE), ma intercettarlo qui permette di spiegare invece
    // di far esplodere una INSERT alla fine del giro.
    const altro = findAccountByWarUserId(warUserId);
    if (altro && altro.id !== req.account.id) {
      return res.status(409).json({ error: 'personaggio_gia_collegato' });
    }

    let lite = null;
    try {
      lite = await trpcGet('user.getUserLite', { userId: warUserId });
    } catch (err) {
      if (err.codiceGioco === 'NOT_FOUND') return res.status(404).json({ error: 'personaggio_inesistente' });
      console.error('[verify] lettura personaggio fallita:', err.message);
      return res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
    if (!lite?.username) return res.status(404).json({ error: 'personaggio_inesistente' });

    const codice = generaCodice();
    const scadenza = Date.now() + CODE_TTL_MS;
    setClaim({
      accountId: req.account.id,
      warUserId,
      warUsername: lite.username,
      code: codice,
      expiresAt: scadenza,
    });
    audit(req.account.id, 'verify.start', 'account', { warUserId });

    res.json({ code: codice, expiresAt: scadenza, warUsername: lite.username });
  });

  // ── 3. Ho messo il codice, controlla ────────────────────────────────────
  router.post('/check', requireAuth, async (req, res) => {
    const claim = getClaim(req.account.id);
    if (!claim) return res.status(400).json({ error: 'nessuna_richiesta' });
    if (claim.expires_at < Date.now()) {
      deleteClaim(req.account.id);
      return res.status(410).json({ error: 'codice_scaduto' });
    }

    // Ogni tentativo costa due richieste a WarEra. Il limite non protegge
    // da un attacco — protegge dal bottone premuto quaranta volte in un
    // minuto da chi sta aspettando che il gioco si aggiorni.
    const ora = Date.now();
    if (claim.last_check_at && ora - claim.last_check_at < CHECK_MIN_GAP_MS) {
      return res.status(429).json({ error: 'troppo_presto', riprovaFra: CHECK_MIN_GAP_MS - (ora - claim.last_check_at) });
    }
    if (claim.attempts >= CHECK_MAX_PER_CLAIM) {
      return res.status(429).json({ error: 'troppi_tentativi' });
    }
    getDb().prepare('UPDATE verify_claim SET attempts = attempts + 1, last_check_at = ? WHERE account_id = ?')
      .run(ora, req.account.id);

    let aziende = [];
    try {
      const elenco = await trpcGet('company.getCompanies', { userId: claim.war_user_id, perPage: MAX_COMPANIES });
      const ids = (elenco?.items || []).slice(0, MAX_COMPANIES);
      if (!ids.length) return res.json({ ok: false, motivo: 'nessuna_azienda', aziende: [] });
      aziende = (await trpcBatch('company.getById', ids.map((companyId) => ({ companyId }))))
        .filter(Boolean)
        // Doppio controllo della proprietà: il record dell'azienda porta
        // `user`, e ci si fida di quello invece che solo dell'elenco.
        .filter((c) => c.user === claim.war_user_id);
    } catch (err) {
      console.error('[verify] lettura aziende fallita:', err.message);
      return res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }

    const atteso = normalizza(claim.code);
    const trovata = aziende.find((c) => normalizza(c.name).includes(atteso));

    if (!trovata) {
      return res.json({ ok: false, motivo: 'codice_non_trovato', aziende: aziende.map((c) => c.name) });
    }

    // Ricontrollo dell'unicità: fra lo /start e adesso qualcun altro
    // potrebbe aver collegato lo stesso personaggio.
    const altro = findAccountByWarUserId(claim.war_user_id);
    if (altro && altro.id !== req.account.id) {
      deleteClaim(req.account.id);
      return res.status(409).json({ error: 'personaggio_gia_collegato' });
    }

    setWarIdentity(req.account.id, claim.war_user_id, claim.war_username);
    deleteClaim(req.account.id);
    audit(req.account.id, 'verify.ok', 'account', {
      warUserId: claim.war_user_id, warUsername: claim.war_username, azienda: trovata.name,
    });

    res.json({ ok: true, account: req.publicAccount(getAccountById(req.account.id)), azienda: trovata.name });
  });

  // ── 4. Lascia perdere ───────────────────────────────────────────────────
  router.post('/cancel', requireAuth, (req, res) => {
    deleteClaim(req.account.id);
    res.json({ ok: true });
  });

  /** La richiesta in corso, per riaprire la vista e ritrovare il codice
   *  invece di doverne chiedere uno nuovo. */
  router.get('/state', requireAuth, (req, res) => {
    const claim = getClaim(req.account.id);
    if (!claim || claim.expires_at < Date.now()) return res.json({ claim: null });
    res.json({
      claim: {
        code: claim.code,
        expiresAt: claim.expires_at,
        warUsername: claim.war_username,
        warUserId: claim.war_user_id,
      },
    });
  });

  // ── 5. Scollega ─────────────────────────────────────────────────────────
  // Separato dalla cancellazione dell'account: "non sono più io quel
  // personaggio" e "voglio sparire da qui" sono richieste diverse.
  router.post('/unlink', requireAuth, (req, res) => {
    setWarIdentity(req.account.id, null, null);
    audit(req.account.id, 'verify.unlink', 'account', null);
    res.json({ ok: true, account: req.publicAccount(getAccountById(req.account.id)) });
  });

  // ── 6. Collegamento a mano (amministratore) ─────────────────────────────
  // Per chi un'azienda non ce l'ha. Non è una scorciatoia comoda: resta
  // scritto chi ha collegato chi e quando, perché un collegamento senza
  // prova tecnica ha bisogno di una prova sociale al suo posto.
  router.post('/admin-link', requireAuth, requireAdmin, async (req, res) => {
    const accountId = Number(req.body?.accountId);
    const warUserId = String(req.body?.warUserId || '').trim();
    if (!accountId || !/^[a-f0-9]{24}$/.test(warUserId)) return res.status(400).json({ error: 'parametri_non_validi' });

    const bersaglio = getAccountById(accountId);
    if (!bersaglio) return res.status(404).json({ error: 'account_inesistente' });

    const altro = findAccountByWarUserId(warUserId);
    if (altro && altro.id !== accountId) return res.status(409).json({ error: 'personaggio_gia_collegato' });

    let lite = null;
    try {
      lite = await trpcGet('user.getUserLite', { userId: warUserId });
    } catch (err) {
      if (err.codiceGioco === 'NOT_FOUND') return res.status(404).json({ error: 'personaggio_inesistente' });
      return res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
    if (!lite?.username) return res.status(404).json({ error: 'personaggio_inesistente' });

    setWarIdentity(accountId, warUserId, lite.username);
    deleteClaim(accountId);
    audit(req.account.id, 'verify.admin-link', `account:${accountId}`, {
      warUserId, warUsername: lite.username, motivo: req.body?.reason || null,
    });

    res.json({ ok: true, account: req.publicAccount(getAccountById(accountId)) });
  });

  return router;
}

module.exports = { buildVerifyRouter, generaCodice, normalizza };
