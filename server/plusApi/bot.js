/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — la porta del bot Discord dei contratti
   ----------------------------------------------------------------------
   Il bot (server/discordBot/) gira su un ALTRO VPS e non sa niente: non
   ha un database, non conosce i ruoli, non decide chi può approvare. Fa
   da bocca e da dita di questo processo:

     bocca  — ritira gli avvisi (`/bot/eventi`) e li scrive su Discord, con
              le persone giuste taggate
     dita   — quando qualcuno preme "Approva" o scrive /contract, chiede
              QUI di farlo, dicendo solo chi è (l'id Discord)

   ── PERCHÉ IL BOT NON DECIDE NIENTE ───────────────────────────────────
   Il permesso si controlla sempre qui, con le stesse funzioni della pagina
   web (requests.js: azioneCrea / azioneDecidi / azioneAperta / azioneRitira).
   Un bot compromesso, o un bug nel bot, al massimo può fingere un id
   Discord: e quello deve comunque essere un account che ha collegato il
   proprio personaggio al tool, con la carica giusta. Non può approvare per
   chi non ha il diritto, né per nazioni non abilitate (stesso filtro di
   `filtroNazione`).

   ── CHI SI TAGGA ──────────────────────────────────────────────────────
   Per una richiesta nuova (o un contratto rubato), chi nel governo della
   nazione può approvare: stessa regola dell'approvazione (`approvaPer`),
   quindi presidente, vice e i ministri col diritto `manageMercenaryContracts`,
   più le deroghe, meno le revoche. Si taggano SOLO quelli che hanno
   collegato Discord e personaggio al tool: gli altri non hanno un id
   Discord che il server conosca. Il bot li elenca per nome, senza tag, e
   dice che manca il collegamento — meglio che ignorarli in silenzio.

   Per gli avvisi di un'unità si tagga chi ha fatto la richiesta.

   ── AUTENTICAZIONE ────────────────────────────────────────────────────
   Un segreto condiviso (`BOT_TOKEN`, nell'ecosystem.config.js del VPS, mai
   nel repo) in `Authorization: Bearer`. Senza BOT_TOKEN tutte le rotte
   rispondono 503: il bot è opzionale, e il tool funziona uguale con i
   webhook di prima.

   ── SE IL BOT SI FERMA ────────────────────────────────────────────────
   Ogni richiesta del bot segna "è vivo" (notify.js). Dopo 90 secondi di
   silenzio gli avvisi tornano ai webhook, se ce ne sono: un allarme
   "l'asta sta per essere rubata" non finisce in una coda che nessuno legge.
   ══════════════════════════════════════════════════════════════════════ */

const crypto = require('crypto');
const express = require('express');
const {
  getRichiesta, findAccountByDiscordId, findAccountByWarUserId, getDb, upsertDiscordAccount,
  getBotChannel, setBotChannel, deleteBotChannel, setBotAperto, limitiSportello, setLimitiSportello, eventiBotDopo, ultimoEventoBotId, audit,
} = require('./db');
const { calcolaEffettivi } = require('./roles');
const { nazioneAmmessa } = require('./nazioni');
const { puoChiedere } = require('./policy');
const { idGoverno, haDiritto, membriGoverno } = require('./governo');
const { governo, paesiMappa, regioniMappa, battaglieVive, nomiUtenti, memo } = require('./fonti');
const { segnaBotVivo } = require('./notify');
const { accountsDellUnita } = require('./dm');
const { trpcGet } = require('./wareraApi');
const { cercaPersonaggi, avviaVerifica, controllaVerifica } = require('./verify');
const {
  pubblica, conNomi, azioneCrea, azioneDecidi, azioneAperta, azioneRitira, azioneModifica,
} = require('./requests');

const ID_DISCORD = /^\d{15,25}$/;
const AZIONI = { approve: azioneDecidi, reject: azioneDecidi, opened: azioneAperta, cancel: azioneRitira };

// ---------------------------------------------------------------------------
// Autenticazione del bot
// ---------------------------------------------------------------------------

function requireBot(req, res, next) {
  const atteso = process.env.BOT_TOKEN || '';
  if (!atteso) return res.status(503).json({ error: 'bot_non_configurato' });
  const dato = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // Confronto a tempo costante, su digest della stessa lunghezza: un `===`
  // sul segreto direbbe, byte per byte, quanto il tentativo ci somiglia.
  const h = (s) => crypto.createHash('sha256').update(String(s)).digest();
  if (!dato || !crypto.timingSafeEqual(h(dato), h(atteso))) {
    return res.status(401).json({ error: 'non_autenticato' });
  }
  segnaBotVivo();
  next();
}

// ---------------------------------------------------------------------------
// Chi è quella persona (e può farlo)
// ---------------------------------------------------------------------------

/**
 * Dall'id Discord all'identità che può agire. Ripete, per il bot, i due
 * sbarramenti che sul sito stanno in `requireAuth` e `filtroNazione`:
 * l'account deve esistere ed essere collegato a un personaggio, e la sua
 * nazione deve essere fra quelle abilitate.
 * @returns {Promise<{ok:true, account, dati}|{ok:false, codice:number, error:string}>}
 */
async function identitaDaDiscord(discordId) {
  if (!ID_DISCORD.test(String(discordId || ''))) return { ok: false, codice: 400, error: 'parametri_non_validi' };
  const account = findAccountByDiscordId(discordId);
  if (!account) return { ok: false, codice: 403, error: 'non_collegato' };
  if (!account.war_user_id) return { ok: false, codice: 403, error: 'non_verificato' };

  let dati;
  try { dati = await calcolaEffettivi(account, {}); }
  catch (err) { return { ok: false, codice: 502, error: 'gioco_non_raggiungibile' }; }
  if (dati.erroreGioco) return { ok: false, codice: 502, error: 'gioco_non_raggiungibile' };

  const esito = nazioneAmmessa(account, dati.derivati);
  if (!esito.ok) return { ok: false, codice: 403, error: 'nazione_non_abilitata' };
  return { ok: true, account, dati };
}

// ---------------------------------------------------------------------------
// Chi taggare
// ---------------------------------------------------------------------------

/**
 * Chi può approvare per questa nazione, adesso, diviso fra chi ha un id
 * Discord noto e chi no. Cinque minuti di memoria: un evento di rado
 * arriva da solo, e ogni calcolo costa due richieste al gioco per ministro.
 */
const approvatori = memo(5 * 60_000, async (countryId) => {
  const gov = await governo(countryId);
  // Chi ha il DIRITTO secondo il gioco (presidente e vice li hanno tutti).
  const conDiritto = idGoverno(gov).filter((id) => haDiritto(gov, id, 'manageMercenaryContracts'));

  const candidati = new Map();                       // account.id → account
  const senzaAccount = [];
  for (const warId of conDiritto) {
    const a = findAccountByWarUserId(warId);
    if (a) candidati.set(a.id, a); else senzaAccount.push(warId);
  }
  // Le deroghe che CONCEDONO l'approvazione (il gioco non le conosce).
  const concesse = getDb().prepare(
    "SELECT DISTINCT account_id FROM role_override WHERE scope_type = 'country' AND scope_id = ? AND mode = 'grant'",
  ).all(countryId);
  for (const { account_id: id } of concesse) {
    const a = getDb().prepare('SELECT * FROM account WHERE id = ?').get(id);
    if (a) candidati.set(a.id, a);
  }

  const tag = [];
  const senzaDiscord = new Set();
  let senzaNome = 0;
  for (const a of candidati.values()) {
    try {
      // La regola vera, quella con cui il bottone decide: niente tag a chi
      // poi si sentirebbe rispondere "non puoi approvare".
      const cap = (await calcolaEffettivi(a, {})).capacita;
      if (cap.approvaPer.includes(countryId)) tag.push(a.discord_id);
    } catch { /* un ministro che non si calcola non ferma gli altri */ }
  }
  if (senzaAccount.length) {
    const nomi = await nomiUtenti(senzaAccount);
    for (const id of senzaAccount) {
      const n = nomi[id]?.username || nomi[id]?.name;
      // Mai un id esadecimale in un canale: o il nome, o si conta e basta.
      if (n) senzaDiscord.add(n); else senzaNome += 1;
    }
  }
  return { tag: [...new Set(tag)], senzaDiscord: [...senzaDiscord], senzaNome };
});

/** Il richiedente di una richiesta: l'unico taggato negli avvisi dell'unità. */
function tagRichiedente(r) {
  if (!r?.requested_by) return [];
  const a = getDb().prepare('SELECT discord_id FROM account WHERE id = ?').get(r.requested_by);
  return a?.discord_id ? [a.discord_id] : [];
}

/** Gli avvisi di nazione che chiedono una decisione o segnalano un furto
 *  taggano il governo; i soli aggiornamenti di carta non taggano nessuno. */
const TAGGA_GOVERNO = new Set(['nuova', 'allarme_paese', 'persa_paese']);

async function arricchisci(e) {
  const canale = getBotChannel(e.scope_type, e.scope_id);
  const r = e.request_id ? getRichiesta(e.request_id) : null;
  let tag = [];
  let senzaDiscord = [];
  let senzaNome = 0;
  try {
    if (e.scope_type === 'country' && TAGGA_GOVERNO.has(e.tipo)) {
      ({ tag, senzaDiscord, senzaNome } = await approvatori(e.scope_id));
    } else if (e.scope_type === 'mu' && r) {
      tag = tagRichiedente(r);
    }
  } catch (err) {
    console.warn('[bot] tag non calcolati:', err.message);
  }
  let nomePaese = null;
  try { nomePaese = r ? (await paesiMappa()).get(r.country_id)?.name || null : null; } catch { /* resta null */ }
  return {
    id: e.id,
    at: e.at,
    tipo: e.tipo,
    scope: { type: e.scope_type, id: e.scope_id },
    canaleId: canale?.channel_id || null,
    testo: e.testo,
    richiesta: r ? pubblica(conNomi(r)) : null,
    nomePaese,
    tag,
    // Chi potrebbe approvare ma non ha collegato Discord al tool: per nome
    // (+ quanti senza nome), senza tag. Il bot lo scrive in chiaro.
    senzaDiscord,
    senzaNome,
  };
}

// ---------------------------------------------------------------------------
// La scrivania (il pannello con i bottoni)
// ---------------------------------------------------------------------------

const TITOLI = {
  president: 'President', vicePresident: 'VP', minOfDefense: 'MoD', minOfEconomy: 'MoE',
  minOfForeignAffairs: 'MoFA', minOfInterior: 'MoI', minOfCommunication: 'MoC',
  chiefOfStaff: 'Chief of staff', advisor: 'Advisor',
};

/** Chi puo' approvare in questa nazione, per il pannello: nome, titolo e id
 *  Discord se collegato. Cinque minuti, come `approvatori`. */
const governoPannello = memo(5 * 60_000, async (countryId) => {
  const gov = await governo(countryId);
  const membri = membriGoverno(gov).filter((m) => haDiritto(gov, m.user, 'manageMercenaryContracts'));
  const nomi = await nomiUtenti(membri.map((m) => m.user));
  return membri.map((m) => ({
    nome: nomi[m.user]?.username || null,
    titolo: m.customTitle || TITOLI[m.carica] || m.carica,
    discordId: findAccountByWarUserId(m.user)?.discord_id || null,
  }));
});

const GIORNO_MS = 24 * 3600_000;

/** Le richieste di un ambito che il pannello deve mostrare: quelle ancora
 *  vive, piu' quelle chiuse nelle ultime 24 ore (cosi' "com'e' finita" non
 *  sparisce un secondo dopo). */
function richiesteScrivania(scope, scopeId) {
  const col = scope === 'country' ? 'country_id' : 'mu_id';
  const da = Date.now() - GIORNO_MS;
  return getDb().prepare(`
    SELECT * FROM request WHERE ${col} = ? AND (
      (status IN ('pending','approved') AND esito IS NULL) OR updated_at > ?
    ) ORDER BY created_at DESC LIMIT 60
  `).all(scopeId, da);
}

// ---------------------------------------------------------------------------
// Contratti ancora ATTIVI (per "Ask burst")
// ---------------------------------------------------------------------------
// Un contratto vinto vale per UN ROUND della battaglia (l'asta porta `round`):
// finito il round il contratto e' finito. Il gioco non dice pubblicamente
// quanto danno ha fatto l'unita' (`mercenaryContract.*` chiede il login), quindi
// "attivo e non finito" si deduce cosi':
//   · l'asta e' stata VINTA dall'unita' concordata (esito `conforme`, o
//     `parametri_diversi` che e' vinta ma con altri numeri);
//   · la battaglia e' ancora IN CORSO;
//   · il round dell'asta e' ancora il round CORRENTE della battaglia.
// Se il round e' cambiato, o la battaglia e' finita, non c'e' piu' niente da
// chiedere: un burst chiesto dopo sarebbe inutile.
// ⚠️ TUTTE le aste vinte, non le prime 50: l'API le da' dalla piu' recente con un
// cursore (`nextCursor`), e su una battaglia lunga (la Sfax ne aveva 51) una
// pagina sola lascia fuori le piu' vecchie — e un contratto ancora in corso puo'
// essere fra quelle. Si segue il cursore fino alla fine; il tetto di 30 pagine
// (1.500 aste) e' una rete contro un cursore che non finisce mai.
const asteVinte = memo(60_000, async (battleId) => {
  const tutte = [];
  let cursor;
  for (let pagina = 0; pagina < 30; pagina++) {
    const r = await trpcGet('mercenaryContractAuction.getPaginatedAuctions',
      { battleId, status: 'won', limit: 50, ...(cursor ? { cursor } : {}) });
    const items = r?.items || [];
    tutte.push(...items);
    cursor = r?.nextCursor;
    if (!cursor || !items.length) break;
  }
  return tutte;
});

/** @returns {Promise<object[]|null>} righe `request`; null se non si riesce a saperlo. */
async function contrattiAttivi(countryId) {
  const righe = getDb().prepare(`
    SELECT * FROM request
    WHERE country_id = ? AND esito IN ('conforme','parametri_diversi')
      AND auction_id IS NOT NULL AND verificato_il > ?
    ORDER BY verificato_il DESC LIMIT 60
  `).all(countryId, Date.now() - 24 * 3600_000);
  if (!righe.length) return [];

  let vive;
  try { vive = await battaglieVive(); } catch { return null; }
  const perId = new Map((vive || []).filter((b) => b?._id).map((b) => [b._id, b]));

  const attivi = [];
  for (const r of righe) {
    const b = perId.get(r.battle_id);
    if (!b || b.isActive === false || !b.currentRound?._id) continue;          // battaglia finita
    let round = null;
    try { round = (await asteVinte(r.battle_id)).find((a) => a._id === r.auction_id)?.round || null; }
    catch { return null; }
    if (round && round === b.currentRound._id) attivi.push(r);                 // contratto del round in corso
  }
  return attivi;
}

// Un burst si puo' chiedere per lo stesso contratto una volta ogni 10 minuti:
// ripingare i comandanti ad ogni clic e' il modo piu' rapido di farsi silenziare.
const BURST_OGNI_MS = 10 * 60_000;
const ultimoBurstChiesto = new Map();             // requestId → quando

// ---------------------------------------------------------------------------
// Le battaglie su cui si può chiedere (per il menu di "Request a contract")
// ---------------------------------------------------------------------------

const nomeNaz = (m, id) => m.get(id)?.name || null;

function etichettaBattaglia(b, naz, reg) {
  const regione = reg?.[b.defender?.region]?.name || reg?.[b.attacker?.region]?.name || null;
  const att = nomeNaz(naz, b.attacker?.country);
  const dif = nomeNaz(naz, b.defender?.country);
  if (regione && att && dif) return `${regione} — ${att} → ${dif}`;
  if (att && dif) return `${att} → ${dif}`;
  return regione || b._id;
}

const dannoRound = (b) => (b.currentRound?.attacker?.damages || 0) + (b.currentRound?.defender?.damages || 0);

async function battaglieChiedibili(dati, q, soloId = null) {
  const muId = dati.derivati?.muId;
  if (!muId || !dati.capacita.chiedePer.includes(muId)) return null;       // nessuna unità da cui chiedere

  const [elenco, naz, regRaw] = await Promise.all([
    battaglieVive(), paesiMappa(), regioniMappa().catch(() => ({})),
  ]);
  const reg = regRaw && !Array.isArray(regRaw) ? regRaw : {};
  const cerca = String(q || '').trim().toLowerCase();

  const out = [];
  for (const b of elenco || []) {
    if (!b?._id || b.isActive === false) continue;
    // `soloId`: il bot chiede i lati di UNA battaglia gia' scelta, che puo'
    // non essere fra le 25 piu' calde della lista.
    if (soloId && b._id !== soloId) continue;
    const etichetta = etichettaBattaglia(b, naz, reg);
    if (cerca && !etichetta.toLowerCase().includes(cerca)) continue;
    const lati = [];
    for (const side of ['attacker', 'defender']) {
      const countryId = b[side]?.country;
      if (!countryId) continue;
      const p = await puoChiedere({ muId, muCountryId: dati.capacita.muCountryId, targetCountryId: countryId });
      if (p.ammesso) lati.push({ side, countryId, nome: nomeNaz(naz, countryId) || countryId });
    }
    if (lati.length) out.push({ id: b._id, etichetta, danno: dannoRound(b), lati });
  }
  out.sort((x, y) => y.danno - x.danno);
  return out.slice(0, 25);
}

// ---------------------------------------------------------------------------
// Le rotte
// ---------------------------------------------------------------------------

function buildBotRouter() {
  const router = express.Router();
  router.use(requireBot);

  const errore = (res, id) => res.status(id.codice).json({ error: id.error });

  // ── Gli avvisi da scrivere ─────────────────────────────────────────────
  // `?dopo=ultimo` serve alla PRIMA partenza del bot (senza cursore salvato):
  // si parte da adesso, non dai sette giorni di coda.
  router.get('/eventi', async (req, res) => {
    try {
      if (req.query.dopo === 'ultimo') return res.json({ eventi: [], ultimo: ultimoEventoBotId() });
      const dopo = Number(req.query.dopo) || 0;
      const righe = eventiBotDopo(dopo, 30);
      const eventi = [];
      for (const e of righe) eventi.push(await arricchisci(e));
      res.json({ eventi, ultimo: righe.length ? righe[righe.length - 1].id : dopo });
    } catch (err) {
      console.error('[bot] eventi falliti:', err.message);
      res.status(500).json({ error: 'errore_server' });
    }
  });

  // ── Un bottone: approva / rifiuta / aperta / ritira ────────────────────
  router.post('/azione', async (req, res) => {
    const { discordId, azione, requestId } = req.body || {};
    const fn = AZIONI[azione];
    if (!fn) return res.status(400).json({ error: 'azione_sconosciuta' });
    const id = await identitaDaDiscord(discordId);
    if (!id.ok) return errore(res, id);

    const esito = azione === 'approve' ? await fn(id.account, requestId, 'approved')
      : azione === 'reject' ? await fn(id.account, requestId, 'rejected')
        : await fn(id.account, requestId);
    audit(id.account.id, 'bot.azione', `request:${Number(requestId) || 0}`, { azione, codice: esito.codice });
    res.status(esito.codice).json(esito.corpo);
  });

  // ── Dove chiedere (autocompletamento) ──────────────────────────────────
  router.get('/battaglie', async (req, res) => {
    const id = await identitaDaDiscord(req.query.discordId);
    if (!id.ok) return errore(res, id);
    try {
      const lista = await battaglieChiedibili(id.dati, req.query.q, req.query.id ? String(req.query.id) : null);
      if (lista === null) return res.status(403).json({ error: 'nessuna_unita' });
      res.json({ battaglie: lista });
    } catch (err) {
      console.error('[bot] battaglie fallite:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  // ── I dati del pannello ────────────────────────────────────────────────
  // Niente identita': e' quello che il pannello mostra a tutto il canale.
  router.get('/scrivania', async (req, res) => {
    const scope = req.query.scope === 'mu' ? 'mu' : 'country';
    const scopeId = String(req.query.scopeId || '');
    if (!scopeId) return res.status(400).json({ error: 'parametri_non_validi' });
    const riga = getBotChannel(scope, scopeId);
    try {
      const naz = await paesiMappa();
      const righe = richiesteScrivania(scope, scopeId);
      const richieste = righe.map((r) => ({ ...pubblica(conNomi(r)), nomePaese: naz.get(r.country_id)?.name || null }));
      let governoElenco = [];
      if (scope === 'country') {
        try { governoElenco = await governoPannello(scopeId); } catch { /* il pannello senza governo e' meglio di nessun pannello */ }
      }
      res.json({
        scope, scopeId,
        nome: scope === 'country' ? (naz.get(scopeId)?.name || null) : (righe[0]?.mu_nome || null),
        aperto: !riga || riga.aperto !== 0,
        // I tetti del governo (danno e taglia per 1.000), null = nessun tetto.
        limiti: scope === 'country' ? limitiSportello(scopeId) : null,
        governo: governoElenco,
        richieste,
      });
    } catch (err) {
      console.error('[bot] scrivania fallita:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  // I soli tetti, leggeri (database, niente gioco): il modulo dei tetti deve
  // aprirsi entro 3 secondi dal clic.
  router.get('/limiti', (req, res) => {
    const scopeId = String(req.query.scopeId || '');
    if (!scopeId) return res.status(400).json({ error: 'parametri_non_validi' });
    res.json({ limiti: limitiSportello(scopeId) });
  });

  // ── Aprire / chiudere lo sportello e fissarne i tetti (solo il governo) ──
  // `aperto` assente = non toccarlo; `maxDamage` / `maxRate` presenti = si
  // impostano (null o vuoto = nessun tetto), assenti = restano com'erano.
  router.post('/scrivania/stato', async (req, res) => {
    const b = req.body || {};
    const id = await identitaDaDiscord(b.discordId);
    if (!id.ok) return errore(res, id);
    const countryId = id.dati.derivati?.countryId;
    if (!countryId || !(id.dati.capacita.gestisceNazione.includes(countryId) || id.dati.capacita.admin)) {
      return res.status(403).json({ error: 'non_autorizzato' });
    }
    if (!getBotChannel('country', countryId)) return res.status(404).json({ error: 'nessun_canale' });
    const attuali = limitiSportello(countryId);
    const tetto = (v, max) => (v == null || v === '' ? null : (Number(v) > 0 && Number(v) <= max ? Number(v) : false));
    const maxDamage = 'maxDamage' in b ? tetto(b.maxDamage, 1e12) : attuali.maxDamage;
    const maxRate = 'maxRate' in b ? tetto(b.maxRate, 5) : attuali.maxRate;
    // Un tetto sotto il minimo che la richiesta ammette (1.000 di danno, 0,001 di taglia)
    // chiuderebbe lo sportello di fatto: meglio dirlo.
    if (maxDamage === false || maxRate === false || (maxDamage != null && maxDamage < 1000) || (maxRate != null && maxRate < 0.001)) {
      return res.status(400).json({ error: 'tetto_non_valido' });
    }
    setLimitiSportello(countryId, { maxDamage, maxRate });
    if (b.aperto !== undefined) {
      setBotAperto('country', countryId, Boolean(b.aperto));
      audit(id.account.id, b.aperto ? 'bot.sportello.aperto' : 'bot.sportello.chiuso', `country:${countryId}`, null);
    }
    if ('maxDamage' in b || 'maxRate' in b) audit(id.account.id, 'bot.sportello.tetti', `country:${countryId}`, { maxDamage, maxRate });
    const riga = getBotChannel('country', countryId);
    res.json({ aperto: riga.aperto !== 0, scopeId: countryId, limiti: { maxDamage, maxRate } });
  });

  // ── Le mie richieste ancora vive (per "Edit mine" / "Withdraw mine") ───
  router.get('/mie', async (req, res) => {
    const id = await identitaDaDiscord(req.query.discordId);
    if (!id.ok) return errore(res, id);
    const righe = getDb().prepare(`
      SELECT * FROM request WHERE requested_by = ? AND status IN ('pending','approved') AND esito IS NULL
      ORDER BY created_at DESC LIMIT 25
    `).all(id.account.id);
    const naz = await paesiMappa().catch(() => new Map());
    res.json({ richieste: righe.map((r) => ({ ...pubblica(conNomi(r)), nomePaese: naz.get(r.country_id)?.name || null })) });
  });

  // ── Ha collegato l'account? ────────────────────────────────────────────
  // Per la risposta automatica a chi scrive "10m pro" a mano: serve solo a
  // scegliere fra "usa lo sportello" e "prima accedi e collega il personaggio".
  // Niente chiamate al gioco: e' una lettura del database e basta.
  router.get('/utente', (req, res) => {
    const d = String(req.query.discordId || '');
    if (!ID_DISCORD.test(d)) return res.status(400).json({ error: 'parametri_non_validi' });
    const a = findAccountByDiscordId(d);
    res.json({ conto: Boolean(a), verificato: Boolean(a?.war_user_id), warUsername: a?.war_username || null });
  });

  // ── Registrarsi dal bot (/register) ────────────────────────────────────
  // Stessa verifica del sito (verify.js: stesse funzioni), senza passare dal
  // login OAuth: l'id Discord arriva dal bot, che lo riceve firmato da
  // Discord in ogni interazione. Il personaggio di gioco si prova come sul
  // sito, con un codice nel nome di un'azienda. L'account creato qui e'
  // quello che il sito trovera' al primo login (stesso discord_id).
  //
  // Ogni ricerca costa due richieste al gioco: un tetto per persona, in
  // memoria, per non lasciare un comando senza freno.
  const ultimaRicerca = new Map();
  router.post('/registra/cerca', async (req, res) => {
    const b = req.body || {};
    if (!ID_DISCORD.test(String(b.discordId || ''))) return res.status(400).json({ error: 'parametri_non_validi' });
    const testo = String(b.username || '').trim();
    if (testo.length < 2) return res.status(400).json({ error: 'nome_troppo_corto' });
    const ora = Date.now();
    if (ora - (ultimaRicerca.get(b.discordId) || 0) < 3000) return res.status(429).json({ error: 'troppo_presto' });
    ultimaRicerca.set(b.discordId, ora);
    try {
      const r = await cercaPersonaggi(testo);
      const naz = await paesiMappa().catch(() => new Map());
      res.json({
        troncato: r.troncato,
        candidati: r.candidati.map((c) => ({ ...c, nomePaese: naz.get(c.countryId)?.name || null })),
      });
    } catch (err) {
      console.error('[bot] ricerca personaggio fallita:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  router.post('/registra/inizia', async (req, res) => {
    const b = req.body || {};
    if (!ID_DISCORD.test(String(b.discordId || ''))) return res.status(400).json({ error: 'parametri_non_validi' });
    // L'account nasce qui, alla prima richiesta di codice (non alla ricerca):
    // una ricerca a vuoto non deve lasciare righe dietro di se'.
    const account = upsertDiscordAccount({
      discordId: String(b.discordId),
      username: String(b.discordUsername || 'unknown').slice(0, 80),
      avatar: b.discordAvatar ? String(b.discordAvatar).slice(0, 64) : null,
    });
    const esito = await avviaVerifica(account, String(b.warUserId || '').trim());
    if (esito.codice === 200) audit(account.id, 'verify.via-bot', 'account', { fase: 'start' });
    res.status(esito.codice).json(esito.corpo);
  });

  router.post('/registra/verifica', async (req, res) => {
    const d = String(req.body?.discordId || '');
    if (!ID_DISCORD.test(d)) return res.status(400).json({ error: 'parametri_non_validi' });
    const account = findAccountByDiscordId(d);
    if (!account) return res.status(400).json({ error: 'nessuna_richiesta' });
    const esito = await controllaVerifica(account);
    if (esito.collegato) audit(account.id, 'verify.via-bot', 'account', { fase: 'ok' });
    res.status(esito.codice).json(esito.corpo);
  });

  // ── La coda (/contract-queue) ──────────────────────────────────────────
  // Due viste sugli stessi dati dello sportello, ma per CHI chiede:
  //   unit    le richieste della MIA unita', con la posizione in coda presso
  //           ogni nazione e quanto ci mette di solito a decidere (comandanti)
  //   nation  tutta la coda della MIA nazione, dalla piu' vecchia (chi approva)
  router.get('/coda', async (req, res) => {
    const vista = req.query.vista === 'nation' ? 'nation' : 'unit';
    const id = await identitaDaDiscord(req.query.discordId);
    if (!id.ok) return errore(res, id);
    const { derivati, capacita } = id.dati;

    let scope; let scopeId;
    if (vista === 'unit') {
      scope = 'mu'; scopeId = derivati?.muId;
      if (!scopeId || !capacita.chiedePer.includes(scopeId)) return res.status(403).json({ error: 'nessuna_unita' });
    } else {
      scope = 'country'; scopeId = derivati?.countryId;
      if (!scopeId || !(capacita.approvaPer.includes(scopeId) || capacita.gestisceNazione.includes(scopeId) || capacita.admin)) {
        return res.status(403).json({ error: 'non_autorizzato' });
      }
    }

    try {
      const righe = richiesteScrivania(scope, scopeId);
      const paesi = [...new Set(righe.map((r) => r.country_id))];

      // Posizione in coda: l'ordine di arrivo fra le richieste ANCORA IN ATTESA
      // di quella nazione (e' l'ordine in cui il governo le vede in "Pending").
      const posizione = new Map();
      const inCoda = {};
      // Tempo tipico di decisione, sugli ultimi 7 giorni: la MEDIANA (una
      // richiesta dimenticata per un giorno non deve far sembrare lento un
      // governo che risponde in dieci minuti), e solo da 3 decisioni in su.
      const decisione = {};
      const settimana = Date.now() - 7 * GIORNO_MS;
      for (const cid of paesi) {
        const att = getDb().prepare("SELECT id FROM request WHERE country_id = ? AND status = 'pending' AND esito IS NULL ORDER BY created_at, id").all(cid);
        att.forEach((x, k) => posizione.set(x.id, k + 1));
        inCoda[cid] = att.length;
        const d = getDb().prepare('SELECT created_at AS c, approved_at AS a FROM request WHERE country_id = ? AND approved_at IS NOT NULL AND approved_at > ?')
          .all(cid, settimana).map((x) => x.a - x.c).filter((x) => x >= 0).sort((a, b) => a - b);
        decisione[cid] = d.length >= 3 ? { medianaMs: d[Math.floor(d.length / 2)], n: d.length } : null;
      }

      const naz = await paesiMappa().catch(() => new Map());
      res.json({
        vista, scopeId,
        nome: scope === 'country' ? (naz.get(scopeId)?.name || null) : (derivati?.muNome || null),
        richieste: righe.map((r) => ({
          ...pubblica(conNomi(r)),
          nomePaese: naz.get(r.country_id)?.name || null,
          posizione: posizione.get(r.id) || null,
          inCoda: inCoda[r.country_id] ?? null,
        })),
        decisione,
        paesi: Object.fromEntries(paesi.map((cid) => [cid, naz.get(cid)?.name || null])),
      });
    } catch (err) {
      console.error('[bot] coda fallita:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  router.post('/modifica', async (req, res) => {
    const b = req.body || {};
    const id = await identitaDaDiscord(b.discordId);
    if (!id.ok) return errore(res, id);
    const esito = await azioneModifica(id.account, b.requestId, b);
    res.status(esito.codice).json(esito.corpo);
  });

  // ── Contratti attivi di una nazione (per "Ask burst") ─────────────────
  router.get('/contratti-attivi', async (req, res) => {
    const scopeId = String(req.query.scopeId || '');
    if (!scopeId) return res.status(400).json({ error: 'parametri_non_validi' });
    try {
      const attivi = await contrattiAttivi(scopeId);
      if (attivi === null) return res.status(502).json({ error: 'gioco_non_raggiungibile' });
      res.json({
        contratti: attivi.map((r) => ({
          requestId: r.id, muId: r.mu_id, muNome: r.mu_nome,
          battleId: r.battle_id, battleLabel: r.battle_label,
          minDamage: r.min_damage, burstDamage: r.burst_damage, perK: r.per_k,
          vintoIl: r.verificato_il,
        })),
      });
    } catch (err) {
      console.error('[bot] contratti attivi falliti:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  // ── "Ask burst": il governo chiede il burst ai comandanti ──────────────
  // Solo chi governa la nazione che paga. Il server controlla che il contratto
  // sia DAVVERO ancora attivo (non fidarsi di un menu aperto da dieci minuti) e
  // restituisce chi pingare: il bot scrive il messaggio.
  router.post('/chiedi-burst', async (req, res) => {
    const b = req.body || {};
    const id = await identitaDaDiscord(b.discordId);
    if (!id.ok) return errore(res, id);
    const r = getRichiesta(Number(b.requestId));
    if (!r) return res.status(404).json({ error: 'richiesta_inesistente' });
    const cap = id.dati.capacita;
    if (!(cap.approvaPer.includes(r.country_id) || cap.gestisceNazione.includes(r.country_id) || cap.admin)) {
      return res.status(403).json({ error: 'non_autorizzato' });
    }

    const attivi = await contrattiAttivi(r.country_id);
    if (attivi === null) return res.status(502).json({ error: 'gioco_non_raggiungibile' });
    if (!attivi.some((x) => x.id === r.id)) return res.status(409).json({ error: 'contratto_non_attivo' });

    const dopo = (ultimoBurstChiesto.get(r.id) || 0) + BURST_OGNI_MS - Date.now();
    if (dopo > 0) return res.status(429).json({ error: 'burst_gia_chiesto', riprovaFraMin: Math.ceil(dopo / 60_000) });

    const account = await accountsDellUnita(r);
    account.delete(id.account.id);                                  // chi chiede non si pinga da solo
    const tag = [...account.values()].map((a) => a.discord_id);
    if (!tag.length) return res.status(404).json({ error: 'nessun_comandante_collegato' });

    ultimoBurstChiesto.set(r.id, Date.now());
    audit(id.account.id, 'bot.burst.chiesto', `request:${r.id}`, { tag: tag.length });
    res.json({
      tag,
      // Con i nomi: a chi chiede il burst si dice A CHI e' arrivato (o no).
      destinatari: [...account.values()].map((a) => ({ discordId: a.discord_id, nome: a.war_username || a.discord_username })),
      chi: id.account.war_username || id.account.discord_username,
      muNome: r.mu_nome, battleId: r.battle_id, battleLabel: r.battle_label,
      minDamage: r.min_damage, burstDamage: r.burst_damage,
    });
  });

  // ── "Who's tagged": chi viene taggato e chi no (per nazione) ───────────
  router.get('/approvatori', async (req, res) => {
    const scopeId = String(req.query.scopeId || '');
    if (!scopeId) return res.status(400).json({ error: 'parametri_non_validi' });
    try { res.json(await approvatori(scopeId)); }
    catch { res.status(502).json({ error: 'gioco_non_raggiungibile' }); }
  });

  // ── /contract ──────────────────────────────────────────────────────────
  // Il bot manda cosa ha scritto la persona; qui si ricava il resto (nazione
  // che paga, etichetta, unità, totale) con la stessa logica del modulo web.
  router.post('/richiesta', async (req, res) => {
    const b = req.body || {};
    const id = await identitaDaDiscord(b.discordId);
    if (!id.ok) return errore(res, id);

    const side = b.side === 'defender' ? 'defender' : b.side === 'attacker' ? 'attacker' : null;
    const minDamage = Number(b.minDamage);
    const perK = Number(b.perK);
    // Stessi limiti del modulo web (board.js): sotto mille danni o fuori da
    // 0,001–5 per mille e' un errore di battitura, non un contratto.
    if (!side || !b.battleId || !(minDamage >= 1000) || !(perK >= 0.001 && perK <= 5)) {
      return res.status(400).json({ error: 'parametri_non_validi' });
    }

    const muId = id.dati.derivati?.muId;
    if (!muId || !id.dati.capacita.chiedePer.includes(muId)) {
      return res.status(403).json({ error: 'nessuna_unita' });
    }

    let battaglia;
    try { battaglia = (await battaglieVive() || []).find((x) => x?._id === b.battleId && x.isActive !== false); }
    catch { return res.status(502).json({ error: 'gioco_non_raggiungibile' }); }
    if (!battaglia) return res.status(404).json({ error: 'battaglia_non_in_corso' });

    const countryId = battaglia[side]?.country;
    if (!countryId) return res.status(400).json({ error: 'parametri_non_validi' });

    let etichetta = b.battleId;
    try {
      const [naz, reg] = await Promise.all([paesiMappa(), regioniMappa().catch(() => ({}))]);
      etichetta = etichettaBattaglia(battaglia, naz, reg && !Array.isArray(reg) ? reg : {});
    } catch { /* si lascia l'id: brutto, ma non e' un guasto */ }

    const esito = await azioneCrea(id.account, {
      battleId: b.battleId, battleLabel: etichetta, side, countryId,
      muId, muNome: id.dati.derivati?.muNome || null,
      minDamage, perK,
      budget: (minDamage / 1000) * perK,
      professionalsOnly: Boolean(b.professionalsOnly),
      note: b.note,
      // Facoltativo; sotto mille si scarta (azioneCrea) invece di rifiutare
      // la richiesta per un campo accessorio.
      burstDamage: b.burstDamage,
    });
    res.status(esito.codice).json(esito.corpo);
  });

  // ── /contract-channel ──────────────────────────────────────────────────
  // Il canale in cui il bot scrive per la nazione (chi la governa) o per
  // l'unita' (chi la comanda). L'ambito lo decide il server da chi e', mai
  // dal bot: nessuno puo' puntare gli avvisi di una nazione che non e' sua.
  router.post('/canale', async (req, res) => {
    const b = req.body || {};
    const id = await identitaDaDiscord(b.discordId);
    if (!id.ok) return errore(res, id);
    if (!['country', 'mu'].includes(b.scope)) return res.status(400).json({ error: 'ambito_non_valido' });

    const { derivati, capacita } = id.dati;
    const scopeId = b.scope === 'country' ? derivati?.countryId : derivati?.muId;
    const puo = b.scope === 'country'
      ? scopeId && capacita.gestisceNazione.includes(scopeId)
      : scopeId && capacita.chiedePer.includes(scopeId);
    if (!puo && !capacita.admin) return res.status(403).json({ error: 'non_autorizzato' });
    if (!scopeId) return res.status(403).json({ error: 'non_autorizzato' });

    if (b.remove) {
      deleteBotChannel(b.scope, scopeId);
      audit(id.account.id, 'bot.canale.rimosso', `${b.scope}:${scopeId}`, null);
      return res.json({ configurato: false, scope: b.scope, scopeId });
    }
    if (!ID_DISCORD.test(String(b.channelId || ''))) return res.status(400).json({ error: 'parametri_non_validi' });

    setBotChannel({ scopeType: b.scope, scopeId, channelId: b.channelId, guildId: b.guildId, createdBy: id.account.id });
    audit(id.account.id, 'bot.canale.impostato', `${b.scope}:${scopeId}`, { channelId: b.channelId });
    // Lo sportello dell'ALTRO ambito (nazione <-> unita') di chi sta impostando: se sta
    // in un canale diverso, gli avvisi di quell'ambito restano LI', e chi ha spostato
    // la nazione crede che il bot risponda "nel canale vecchio". Lo si dice a chi
    // imposta, che ne ha il diritto: e' il suo stesso sportello.
    const altri = [];
    for (const [ambito, id2] of [['country', derivati?.countryId], ['mu', derivati?.muId]]) {
      if (ambito === b.scope || !id2) continue;
      const c2 = getBotChannel(ambito, id2);
      if (c2 && c2.channel_id !== String(b.channelId)) altri.push({ scope: ambito, channelId: c2.channel_id });
    }
    res.json({ configurato: true, scope: b.scope, scopeId, altri, nome: b.scope === 'country' ? null : derivati?.muNome || null });
  });

  return router;
}

module.exports = { buildBotRouter };
