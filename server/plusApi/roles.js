/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — i ruoli non si assegnano, si calcolano
   ----------------------------------------------------------------------
   È la scelta che evita di trasformare l'amministratore del tool in un
   ufficio permessi. Il gioco sa già chi comanda: chi vince le elezioni
   entra da solo, chi le perde esce da solo, e nessuno deve evadere una
   coda di richieste.

     government.getByCountryId → presidente, vice, ministri, congresso
     mu.getById                → proprietario, comandanti, gestori

   Entrambe PUBBLICHE (misurato il 2026-09-02), e soprattutto entrambe
   interrogabili sul SINGOLO utente: dal suo `user.getUserLite` si
   ricavano nazione e unità, e da lì bastano due chiamate. Non serve
   scaricare i governi di 180 nazioni per sapere se una persona è
   ministro — errore facile da fare, e caro.

   ── IL DELTA, NON IL SOSTITUTO ────────────────────────────────────────
   Le deroghe (role_override) si sommano al calcolo, non lo rimpiazzano:

       effettivo = derivato + grant − revoke

   Servono per quello che il gioco non modella (i capi alleanza non hanno
   un campo) e per quello che modella male rispetto alla realtà (un
   ministro che delega, un comandante appena passato di unità). Tenerli
   separati fa sì che l'interfaccia possa mostrare *cosa* è stato
   corretto accanto al dato di gioco, invece del solo risultato: una
   deroga invisibile, fra sei mesi, è indistinguibile da un errore.

   ── CACHE ─────────────────────────────────────────────────────────────
   Dieci minuti in memoria. I governi cambiano due volte al mese e le
   cariche nelle unità raramente; ricalcolare ad ogni richiesta
   significherebbe due chiamate per ogni clic dell'interfaccia. Dieci
   minuti sono anche il tempo massimo in cui un ministro appena eletto
   resta senza i suoi poteri, che è accettabile e va detto nella vista.
   ══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { trpcGet, trpcBatch } = require('./wareraApi');
const {
  getAccountById, listRoleOverrides, setRoleOverride, removeRoleOverride,
  listAccounts, setAdmin, audit,
} = require('./db');

const CACHE_TTL_MS = 10 * 60 * 1000;
const _cache = new Map(); // warUserId → { at, dati }

// Le cariche di governo, dalla più alta. L'ordine conta solo per
// mostrarne UNA quando una persona ne ricopre più d'una.
const CARICHE = ['president', 'vicePresident', 'minOfDefense', 'minOfForeignAffairs', 'minOfEconomy'];

// Chi può APPROVARE un contratto per la propria nazione. Il ministro
// della difesa è quello che lo fa davvero; presidente e vice ci sono
// perché in pratica lo fanno quando il ministro non c'è.
const CARICHE_APPROVAZIONE = new Set(['president', 'vicePresident', 'minOfDefense']);

// Chi può CHIEDERE un contratto per la propria unità.
const RUOLI_MU_RICHIESTA = new Set(['owner', 'commander', 'manager']);

/**
 * Ruoli DERIVATI dai dati di gioco, senza deroghe.
 * Costo: due richieste HTTP (la seconda in batch), entrambe pubbliche.
 */
async function calcolaDerivati(warUserId, { forzaRicalcolo = false } = {}) {
  const ora = Date.now();
  const cached = _cache.get(warUserId);
  if (!forzaRicalcolo && cached && ora - cached.at < CACHE_TTL_MS) return cached.dati;

  const lite = await trpcGet('user.getUserLite', { userId: warUserId });
  const countryId = lite?.country || null;
  const muId = lite?.mu || null;

  const chiamate = [];
  if (countryId) chiamate.push(['government.getByCountryId', { countryId }]);
  if (muId) chiamate.push(['mu.getById', { muId }]);
  const risposte = chiamate.length ? await trpcBatch(chiamate) : [];

  let i = 0;
  const governo = countryId ? risposte[i++] : null;
  const mu = muId ? risposte[i++] : null;

  let carica = null;
  if (governo) {
    carica = CARICHE.find((k) => governo[k] === warUserId) || null;
    // Il congresso è l'unico ruolo di governo che sta in un elenco.
    if (!carica && (governo.congressMembers || []).includes(warUserId)) carica = 'congress';
  }

  let ruoloMu = null;
  if (mu) {
    if (mu.user === warUserId) ruoloMu = 'owner';
    else if ((mu.roles?.commanders || []).includes(warUserId)) ruoloMu = 'commander';
    else if ((mu.roles?.managers || []).includes(warUserId)) ruoloMu = 'manager';
    else ruoloMu = 'member';
  }

  const dati = {
    warUserId,
    username: lite?.username || null,
    countryId,
    carica,                                   // null se semplice cittadino
    muId,
    muNome: mu?.name || null,
    ruoloMu,                                  // null se senza unità
    calcolatoIl: ora,
  };
  _cache.set(warUserId, { at: ora, dati });
  return dati;
}

/**
 * Ruoli EFFETTIVI: derivati più deroghe. Restituisce i tre livelli
 * separati apposta — l'interfaccia deve poter mostrare che una capacità
 * viene da una correzione e non dal gioco.
 */
async function calcolaEffettivi(account, opzioni) {
  const deroghe = listRoleOverrides(account.id);

  let derivati = null;
  let erroreGioco = null;
  if (account.war_user_id) {
    try { derivati = await calcolaDerivati(account.war_user_id, opzioni); }
    catch (err) { erroreGioco = err.message; }
  }

  const concesse = deroghe.filter((d) => d.mode === 'grant');
  const revocate = deroghe.filter((d) => d.mode === 'revoke');
  const revocato = (tipo, id, ruolo) => revocate.some(
    (r) => r.scope_type === tipo && (r.scope_id || null) === (id || null) && r.role === ruolo);

  // ── Capacità: cosa questa persona può fare, in concreto ──────────────
  // Si tengono separate dai ruoli perché sono la domanda che l'interfaccia
  // fa davvero ("posso approvare per questa nazione?"), e perché così una
  // deroga può concedere la capacità senza fingere una carica che nel
  // gioco quella persona non ha.
  const approvaPer = new Set();
  const chiedePer = new Set();

  if (derivati?.carica && CARICHE_APPROVAZIONE.has(derivati.carica)
      && !revocato('country', derivati.countryId, derivati.carica)) {
    approvaPer.add(derivati.countryId);
  }
  if (derivati?.ruoloMu && RUOLI_MU_RICHIESTA.has(derivati.ruoloMu)
      && !revocato('mu', derivati.muId, derivati.ruoloMu)) {
    chiedePer.add(derivati.muId);
  }
  for (const g of concesse) {
    if (g.scope_type === 'country' && CARICHE_APPROVAZIONE.has(g.role)) approvaPer.add(g.scope_id);
    if (g.scope_type === 'mu' && RUOLI_MU_RICHIESTA.has(g.role)) chiedePer.add(g.scope_id);
  }

  return {
    account: {
      id: account.id,
      discordUsername: account.discord_username,
      warUserId: account.war_user_id,
      warUsername: account.war_username,
      admin: Boolean(account.is_admin),
      verificato: Boolean(account.war_user_id),
    },
    derivati,
    // Il gioco può non rispondere: si dice, invece di far sembrare che
    // la persona non abbia cariche.
    erroreGioco,
    deroghe: deroghe.map((d) => ({
      scopeType: d.scope_type, scopeId: d.scope_id, role: d.role, mode: d.mode,
      reason: d.reason, createdAt: d.created_at, expiresAt: d.expires_at,
    })),
    capacita: {
      approvaPer: [...approvaPer].filter(Boolean),
      chiedePer: [...chiedePer].filter(Boolean),
      // L'amministratore non passa da qui: il suo potere non e' un ruolo
      // di gioco e non deve poter essere revocato da una deroga.
      admin: Boolean(account.is_admin),
    },
  };
}

// ---------------------------------------------------------------------------
// Rotte
// ---------------------------------------------------------------------------

function buildRolesRouter({ requireAuth, requireAdmin }) {
  const router = express.Router();

  /**
   * I propri ruoli. Un amministratore può passare `?asAccount=<id>` per
   * vedere quello che vede un altro.
   *
   * ⚠️ La lente è di SOLA LETTURA, e deliberatamente: serve a
   * diagnosticare "perché non vede il tavolo", non ad agire al posto di
   * qualcuno. Se un amministratore potesse anche approvare mentre indossa
   * l'identità altrui, ogni approvazione nell'archivio diventerebbe
   * ambigua — "l'ha fatto lui o l'admin per lui?" — e l'audit log
   * perderebbe l'unica cosa che deve garantire.
   */
  router.get('/me', requireAuth, async (req, res) => {
    let account = req.account;
    let comeAltri = null;

    const asAccount = Number(req.query.asAccount);
    if (asAccount) {
      if (!req.account.is_admin) return res.status(403).json({ error: 'non_autorizzato' });
      const bersaglio = getAccountById(asAccount);
      if (!bersaglio) return res.status(404).json({ error: 'account_inesistente' });
      account = bersaglio;
      comeAltri = { attivo: true, soloLettura: true, adminId: req.account.id };
      audit(req.account.id, 'admin.view-as', `account:${asAccount}`, null);
    }

    try {
      const dati = await calcolaEffettivi(account, { forzaRicalcolo: req.query.refresh === '1' });
      res.json({ ...dati, comeAltri });
    } catch (err) {
      console.error('[roles] calcolo fallito:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  // ── Amministrazione ─────────────────────────────────────────────────
  router.get('/admin/accounts', requireAuth, requireAdmin, (req, res) => {
    res.json({ accounts: listAccounts() });
  });

  /** Mette o sostituisce una deroga. `mode` 'grant' o 'revoke'. */
  router.post('/admin/override', requireAuth, requireAdmin, (req, res) => {
    const { accountId, scopeType, scopeId = null, role, mode, reason, expiresAt = null } = req.body || {};
    if (!accountId || !scopeType || !role || !['grant', 'revoke'].includes(mode)) {
      return res.status(400).json({ error: 'parametri_non_validi' });
    }
    if (!['country', 'mu', 'alliance', 'global'].includes(scopeType)) {
      return res.status(400).json({ error: 'ambito_non_valido' });
    }
    if (!getAccountById(accountId)) return res.status(404).json({ error: 'account_inesistente' });
    // Il motivo non è facoltativo: una deroga senza spiegazione, riletta
    // fra sei mesi, è indistinguibile da un errore.
    if (!String(reason || '').trim()) return res.status(400).json({ error: 'motivo_obbligatorio' });

    setRoleOverride({
      accountId, scopeType, scopeId, role, mode,
      reason: String(reason).trim().slice(0, 300),
      grantedBy: req.account.id, expiresAt,
    });
    audit(req.account.id, 'admin.override.set', `account:${accountId}`, { scopeType, scopeId, role, mode, reason });
    res.json({ ok: true });
  });

  router.post('/admin/override/remove', requireAuth, requireAdmin, (req, res) => {
    const { accountId, scopeType, scopeId = null, role } = req.body || {};
    if (!accountId || !scopeType || !role) return res.status(400).json({ error: 'parametri_non_validi' });
    removeRoleOverride({ accountId, scopeType, scopeId, role });
    audit(req.account.id, 'admin.override.remove', `account:${accountId}`, { scopeType, scopeId, role });
    res.json({ ok: true });
  });

  /** Nomina o revoca un amministratore. */
  router.post('/admin/set-admin', requireAuth, requireAdmin, (req, res) => {
    const accountId = Number(req.body?.accountId);
    const valore = Boolean(req.body?.admin);
    if (!accountId) return res.status(400).json({ error: 'parametri_non_validi' });
    if (accountId === req.account.id && !valore) {
      // Togliersi i poteri da soli e restare l'unico amministratore
      // significa chiudere la porta dall'interno. ADMIN_DISCORD_IDS
      // rimetterebbe le cose a posto al riavvio, ma non si costruisce
      // una trappola contando sul fatto che esiste una via d'uscita.
      return res.status(400).json({ error: 'non_puoi_degradarti' });
    }
    if (!getAccountById(accountId)) return res.status(404).json({ error: 'account_inesistente' });
    setAdmin(accountId, valore);
    audit(req.account.id, valore ? 'admin.promote' : 'admin.demote', `account:${accountId}`, null);
    res.json({ ok: true });
  });

  return router;
}

module.exports = { buildRolesRouter, calcolaDerivati, calcolaEffettivi };
