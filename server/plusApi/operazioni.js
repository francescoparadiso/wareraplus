/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — le operazioni (la lavagna dei piani)
   ----------------------------------------------------------------------
   Richiesta dell'utente: uno scrumboard per rivolte, attacchi e orari di
   priorità, a "schede sequenziali" con orari e frecce, e un tasto per
   vederlo sulla mappa. Qui c'è solo la parte che si salva; il flowchart
   e la mappa sono del client (src/private/operazioni.js e
   src/private/mappaOperazione.js).

   ── COSA SI SALVA ─────────────────────────────────────────────────────
   Un'OPERAZIONE è un titolo con una catena di PASSI. Ogni passo ha un
   tipo (attacco, difesa, rivolta, pillole, contratto, altro), una
   regione e — per un attacco — la regione da cui si parte, un orario,
   una priorità, chi se ne occupa e uno stato. Le FRECCE dicono quale
   passo va fatto prima di quale: stanno in op_link, vedi db.js.

   "In attesa" non è uno stato salvato: un passo da fare con un
   precedente non ancora fatto è in attesa, e lo si ricava dalle frecce
   ogni volta. Salvarlo vorrebbe dire aggiornarlo a mano ogni volta che
   cambia UN ALTRO passo, e prima o poi qualcuno se ne dimentica.

   ── CHI VEDE, CHI SCRIVE ──────────────────────────────────────────────
   Le stesse persone della "mia nazione", per la stessa regola
   (contestoNazione in nazione.js): il governo per carica, i cittadini a
   cui il governo ha dato accesso, gli amministratori. Sono piani di
   guerra: chi non vede la scheda della nazione non vede nemmeno questi.

   Dentro, due livelli:
     · PIANIFICARE (creare, cambiare, cancellare operazioni e passi) è del
       governo e dell'amministratore, come ogni scrittura della nazione;
     · SPOSTARE un passo da uno stato all'altro lo può fare chiunque veda
       la lavagna. È il gesto dello scrum: chi ha fatto la sua parte la
       sposta in "fatta" senza dover chiedere a un ministro di farlo.

   Tutto per nazione: un'operazione di un'altra nazione risponde 404, non
   403 — chi non la vede non deve nemmeno sapere che esiste.
   ══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { contestoNazione, formaGoverno } = require('./nazione');
const { paesiMappa, battaglieVive, archivioBattaglie, memo } = require('./fonti');
const { trpcGet } = require('./wareraApi');
const {
  listaOperazioni, contaOperazioniAttive, getOperazione, creaOperazione, aggiornaOperazione, eliminaOperazione,
  passiDi, frecceDi, contaPassi, getPasso, creaPasso, aggiornaPasso, eliminaPasso, impostaPrecedenti,
  getAccountById, audit,
} = require('./db');

const TIPI = new Set(['attacco', 'difesa', 'rivolta', 'pillole', 'contratto', 'altro']);
const STATI_PASSO = new Set(['da_fare', 'in_corso', 'fatta', 'fallita', 'annullata']);
const STATI_OPERAZIONE = new Set(['attiva', 'archiviata']);
const PRIORITA = new Set(['alta', 'media', 'bassa']);
// Chi ha una regione di partenza: l'attacco (da dove partiamo) e la difesa
// (da dove ci attaccano).
const CON_PARTENZA = new Set(['attacco', 'difesa']);
const ID_GIOCO = /^[a-f0-9]{24}$/i;

// Tetti larghi rispetto all'uso, stretti rispetto all'abuso: una nazione
// non porta avanti cinquanta operazioni insieme, e un piano di quaranta
// passi non si legge più come un piano.
const MAX_OPERAZIONI_ATTIVE = 50;
const MAX_PASSI = 40;
// Un orario fuori da questa finestra è quasi sempre un anno sbagliato nel
// campo data, non un piano: meglio dirlo subito che disegnarlo fuori scala.
const ORARIO_PASSATO_MS = 30 * 24 * 3600_000;
const ORARIO_FUTURO_MS = 90 * 24 * 3600_000;

// ---------------------------------------------------------------------------
// Le guerre e la loro priorità
// ---------------------------------------------------------------------------
// Dopo una conquista una delle due nazioni ha la PRIORITÀ nella guerra per
// 24 ore. Il dato sta in `war.getById` (`priority`, `priorityEndAt`), che è
// pubblica. `war.getActiveWarBetweenCountries` lo direbbe senza bisogno
// dell'id, ma risponde 403 a qualunque chiave API (verificato il
// 2026-10-22): vuole la sessione di un giocatore.
//
// L'id della guerra si trova nelle battaglie: quelle vive portano `war`;
// per una coppia senza battaglia aperta — il caso tipico, la priorità
// nasce quando una battaglia FINISCE — si prende l'ultima battaglia fra le
// due dall'archivio e la si rilegge con `battle.getById`. L'id di una
// guerra non cambia finché la guerra dura: si ricorda (_idGuerra).
// ⚠️ `priorityEndAt` resta pieno anche a priorità scaduta: si confronta
// sempre con adesso, lato client.

const _idGuerra = new Map(); // "a|b" (ordinati) → warId

const coppia = (a, b) => [a, b].sort().join('|');

async function idGuerra(noi, loro) {
  const k = coppia(noi, loro);
  if (_idGuerra.has(k)) return _idGuerra.get(k);
  const tra = (ac, dc) => coppia(ac || '', dc || '') === k;
  const viva = (await battaglieVive()).find((b) => b.type === 'war' && b.war && tra(b.attacker?.country, b.defender?.country));
  let id = viva?.war || null;
  if (!id) {
    const ultima = (await archivioBattaglie())
      .filter((r) => r.t === 'war' && tra(r.ac, r.dc))
      .sort((x, y) => (y.e || 0) - (x.e || 0))[0];
    if (ultima) id = (await trpcGet('battle.getById', { battleId: ultima.i }))?.war || null;
  }
  if (id) _idGuerra.set(k, id);
  return id;
}

// Tre minuti: la priorità cambia solo a una conquista, e la lavagna la
// rilegge a ogni apertura.
const leggiGuerra = memo(3 * 60_000, (warId) => trpcGet('war.getById', { warId }));

async function guerreDi(countryId) {
  const noi = (await paesiMappa()).get(countryId);
  const nemici = [...new Set(noi?.warsWith || [])];
  const righe = await Promise.all(nemici.map(async (nemico) => {
    try {
      const warId = await idGuerra(countryId, nemico);
      if (!warId) return { nemico, warId: null };
      const w = await leggiGuerra(warId);
      if (w && w.isActive === false) _idGuerra.delete(coppia(countryId, nemico));
      return {
        nemico,
        warId,
        attaccante: w?.attacker?.country || null,
        priorita: w?.priority || null,
        prioritaFino: w?.priorityEndAt ? Date.parse(w.priorityEndAt) : null,
      };
    } catch (err) {
      console.warn('[operazioni] guerra con', nemico, 'non letta:', err.message);
      return { nemico, warId: null };
    }
  }));
  return righe;
}

// ---------------------------------------------------------------------------
// Validazione
// ---------------------------------------------------------------------------

class Rifiuto extends Error {
  constructor(codice, stato = 400) { super(codice); this.codice = codice; this.stato = stato; }
}

/** Testo ripulito e accorciato; stringa vuota → null. */
function testo(v, max) {
  if (v == null) return null;
  const s = String(v).replace(/\s+/g, ' ').trim().slice(0, max);
  return s || null;
}

function idRegione(v) {
  if (v == null || v === '') return null;
  const s = String(v).trim();
  if (!ID_GIOCO.test(s)) throw new Rifiuto('regione_non_valida');
  return s;
}

function orario(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  const ora = Date.now();
  if (!Number.isFinite(n) || n < ora - ORARIO_PASSATO_MS || n > ora + ORARIO_FUTURO_MS) {
    throw new Rifiuto('orario_non_valido');
  }
  return Math.round(n);
}

function scelta(v, insieme, codice) {
  if (!insieme.has(v)) throw new Rifiuto(codice);
  return v;
}

/** I campi di un passo dal corpo della richiesta. Solo quelli presenti:
 *  una modifica che manda il solo stato non deve azzerare tutto il resto. */
function campiPasso(body, { nuovo }) {
  const c = {};
  const ha = (k) => Object.prototype.hasOwnProperty.call(body, k);
  if (nuovo || ha('tipo')) c.kind = scelta(body.tipo, TIPI, 'tipo_non_valido');
  if (ha('titolo')) c.title = testo(body.titolo, 80);
  if (ha('regione')) c.region_id = idRegione(body.regione);
  if (ha('daRegione')) c.from_region_id = idRegione(body.daRegione);
  if (ha('quando')) c.at = orario(body.quando);
  if (ha('priorita')) c.priority = scelta(body.priorita, PRIORITA, 'priorita_non_valida');
  if (ha('incaricato')) c.assignee = testo(body.incaricato, 60);
  if (ha('stato')) c.status = scelta(body.stato, STATI_PASSO, 'stato_non_valido');
  if (ha('nota')) c.note = testo(body.nota, 500);
  if (ha('battaglia')) c.battle_id = idRegione(body.battaglia);
  if (nuovo) {
    c.priority = c.priority || 'media';
    c.status = c.status || 'da_fare';
  }
  // Un attacco parte da qualche parte; per gli altri tipi la regione di
  // partenza non vuol dire niente e si butta, invece di restare appesa a
  // un passo diventato "rivolta" dopo una modifica.
  const tipo = c.kind;
  if (tipo && !CON_PARTENZA.has(tipo)) c.from_region_id = null;
  if (c.from_region_id && c.region_id && c.from_region_id === c.region_id) throw new Rifiuto('regioni_uguali');
  return c;
}

/** I precedenti di un passo: passi della STESSA operazione, mai sé stesso,
 *  e senza chiudere un cerchio (A dopo B dopo A non si può fare). */
function precedentiValidi(opId, stepId, dopo) {
  if (dopo == null) return null;
  if (!Array.isArray(dopo)) throw new Rifiuto('precedenti_non_validi');
  const passi = new Map(passiDi([opId]).map((p) => [p.id, p]));
  const ids = [...new Set(dopo.map(Number))].filter((n) => Number.isInteger(n));
  for (const id of ids) {
    if (!passi.has(id) || id === stepId) throw new Rifiuto('precedenti_non_validi');
  }
  if (stepId != null && ids.length) {
    // Le frecce che escono da ogni passo, senza quelle che entrano in
    // questo (stanno per essere sostituite): se da qui si arriva a uno dei
    // nuovi precedenti, la freccia nuova chiuderebbe un cerchio.
    const uscite = new Map();
    for (const f of frecceDi([opId])) {
      if (f.to_step === stepId) continue;
      if (!uscite.has(f.from_step)) uscite.set(f.from_step, []);
      uscite.get(f.from_step).push(f.to_step);
    }
    const visti = new Set();
    const pila = [stepId];
    while (pila.length) {
      const x = pila.pop();
      if (visti.has(x)) continue;
      visti.add(x);
      for (const y of uscite.get(x) || []) pila.push(y);
    }
    if (ids.some((id) => visti.has(id))) throw new Rifiuto('ciclo');
  }
  return ids;
}

// ---------------------------------------------------------------------------
// Forma esposta al client
// ---------------------------------------------------------------------------

const nomeAccount = (id) => {
  if (!id) return null;
  const a = getAccountById(id);
  return a ? (a.war_username || a.discord_username) : null;
};

function formaPasso(p, dopo) {
  return {
    id: p.id,
    tipo: p.kind,
    titolo: p.title,
    regione: p.region_id,
    daRegione: p.from_region_id,
    quando: p.at,
    priorita: p.priority,
    incaricato: p.assignee,
    stato: p.status,
    nota: p.note,
    battaglia: p.battle_id || null,
    dopo: dopo || [],
    aggiornatoDa: nomeAccount(p.updated_by),
    aggiornatoIl: p.updated_at,
  };
}

function elenco(countryId, { archiviate = false } = {}) {
  const ops = listaOperazioni(countryId, { archiviate });
  const ids = ops.map((o) => o.id);
  const precedenti = new Map();
  for (const f of frecceDi(ids)) {
    if (!precedenti.has(f.to_step)) precedenti.set(f.to_step, []);
    precedenti.get(f.to_step).push(f.from_step);
  }
  const perOp = new Map(ids.map((id) => [id, []]));
  for (const p of passiDi(ids)) perOp.get(p.operation_id)?.push(formaPasso(p, precedenti.get(p.id)));
  return ops.map((o) => ({
    id: o.id,
    titolo: o.title,
    nota: o.note,
    stato: o.status,
    creataDa: nomeAccount(o.created_by),
    creataIl: o.created_at,
    aggiornataDa: nomeAccount(o.updated_by),
    aggiornataIl: o.updated_at,
    passi: perOp.get(o.id) || [],
  }));
}

// ---------------------------------------------------------------------------
// Rotte
// ---------------------------------------------------------------------------

function buildOperazioniRouter({ requireAuth, risolviIdentita, bloccaScrittureSottoLente, filtroNazione }) {
  const router = express.Router();
  // La stessa catena della nazione: sotto la lente si guarda con gli occhi
  // del bersaglio e non si scrive.
  router.use(requireAuth, risolviIdentita, bloccaScrittureSottoLente, filtroNazione);

  /** Contesto della nazione, oppure la risposta di rifiuto già mandata. */
  async function contesto(req, res) {
    const ctx = await contestoNazione(req);
    if (!ctx.countryId) { res.status(404).json({ error: 'nazione_sconosciuta' }); return null; }
    if (!ctx.accesso) {
      // Lo stesso no della nazione, con dentro a chi chiedere.
      let gov = null;
      try { gov = await formaGoverno(ctx.countryId); } catch { /* chi chiamare è un di più */ }
      res.status(403).json({ error: 'accesso_nazione_negato', governo: gov });
      return null;
    }
    return ctx;
  }

  const puoPianificare = (ctx) => ctx.governa || ctx.amministra;

  function risposta(ctx, req) {
    const archiviate = req.query.archiviate === '1';
    return {
      countryId: ctx.countryId,
      puoPianificare: puoPianificare(ctx),
      operazioni: elenco(ctx.countryId, { archiviate }),
    };
  }

  /** L'operazione, solo se è di questa nazione. */
  function operazioneDi(ctx, id) {
    const op = getOperazione(Number(id));
    if (!op || op.country_id !== ctx.countryId) throw new Rifiuto('operazione_sconosciuta', 404);
    return op;
  }

  function passoDi(op, id) {
    const p = getPasso(Number(id));
    if (!p || p.operation_id !== op.id) throw new Rifiuto('passo_sconosciuto', 404);
    return p;
  }

  /** Un gestore asincrono che risponde da sé agli errori: un Rifiuto porta
   *  il suo codice e il suo stato HTTP, che il gestore generico di
   *  index.js appiattirebbe in un 500 `errore_server`. */
  const gestisci = (fn) => async (req, res) => {
    try {
      const ctx = await contesto(req, res);
      if (!ctx) return;
      await fn(req, res, ctx);
    } catch (err) {
      if (err instanceof Rifiuto) return res.status(err.stato).json({ error: err.codice });
      console.error('[operazioni] errore:', err.message);
      res.status(500).json({ error: 'errore_server' });
    }
  };

  const soloChiPianifica = (ctx) => {
    if (!puoPianificare(ctx)) throw new Rifiuto('non_governi_questa_nazione', 403);
  };

  router.get('/', gestisci(async (req, res, ctx) => {
    // Le guerre solo in lettura: le scritture rimandano l'elenco e il
    // client tiene le guerre che aveva. Se il gioco non risponde la lavagna
    // si apre lo stesso, senza timer.
    const guerre = await guerreDi(ctx.countryId).catch(() => null);
    res.json({ ...risposta(ctx, req), guerre });
  }));

  router.post('/', gestisci(async (req, res, ctx) => {
    soloChiPianifica(ctx);
    const titolo = testo(req.body?.titolo, 80);
    if (!titolo) throw new Rifiuto('titolo_mancante');
    if (contaOperazioniAttive(ctx.countryId) >= MAX_OPERAZIONI_ATTIVE) throw new Rifiuto('troppe_operazioni');
    const op = creaOperazione({ countryId: ctx.countryId, titolo, nota: testo(req.body?.nota, 500), createdBy: req.account.id });
    audit(req.account.id, 'operazione.crea', `operation:${op.id}`, { country: ctx.countryId, titolo });
    res.json({ ...risposta(ctx, req), creata: op.id });
  }));

  router.post('/:id', gestisci(async (req, res, ctx) => {
    soloChiPianifica(ctx);
    const op = operazioneDi(ctx, req.params.id);
    const b = req.body || {};
    const campi = {};
    if ('titolo' in b) {
      campi.title = testo(b.titolo, 80);
      if (!campi.title) throw new Rifiuto('titolo_mancante');
    }
    if ('nota' in b) campi.note = testo(b.nota, 500);
    if ('stato' in b) {
      campi.status = scelta(b.stato, STATI_OPERAZIONE, 'stato_non_valido');
      if (campi.status === 'attiva' && op.status !== 'attiva'
          && contaOperazioniAttive(ctx.countryId) >= MAX_OPERAZIONI_ATTIVE) {
        throw new Rifiuto('troppe_operazioni');
      }
    }
    aggiornaOperazione(op.id, campi, req.account.id);
    audit(req.account.id, 'operazione.modifica', `operation:${op.id}`, b);
    res.json(risposta(ctx, req));
  }));

  router.post('/:id/remove', gestisci(async (req, res, ctx) => {
    soloChiPianifica(ctx);
    const op = operazioneDi(ctx, req.params.id);
    eliminaOperazione(op.id);
    audit(req.account.id, 'operazione.elimina', `operation:${op.id}`, { titolo: op.title });
    res.json(risposta(ctx, req));
  }));

  router.post('/:id/passi', gestisci(async (req, res, ctx) => {
    soloChiPianifica(ctx);
    const op = operazioneDi(ctx, req.params.id);
    if (contaPassi(op.id) >= MAX_PASSI) throw new Rifiuto('troppi_passi');
    const b = req.body || {};
    const campi = campiPasso(b, { nuovo: true });
    // Prima i precedenti, poi la scrittura: un elenco sbagliato non deve
    // lasciare un passo creato a metà.
    const dopo = precedentiValidi(op.id, null, b.dopo);
    const p = creaPasso(op.id, campi, req.account.id);
    if (dopo?.length) impostaPrecedenti(p.id, dopo);
    aggiornaOperazione(op.id, {}, req.account.id);
    audit(req.account.id, 'operazione.passo.crea', `op_step:${p.id}`, { operazione: op.id, ...b });
    res.json({ ...risposta(ctx, req), creato: p.id });
  }));

  router.post('/:id/passi/:pid', gestisci(async (req, res, ctx) => {
    const op = operazioneDi(ctx, req.params.id);
    const p = passoDi(op, req.params.pid);
    const b = { ...(req.body || {}) };
    // Chi non pianifica può solo spostare il passo: un corpo con qualcosa
    // in più è un client che promette quello che il server non farà.
    if (!puoPianificare(ctx) && Object.keys(b).some((k) => k !== 'stato')) {
      throw new Rifiuto('non_governi_questa_nazione', 403);
    }
    // Il modulo rimanda l'orario anche quando non è cambiato: su un piano
    // di sei settimane fa la finestra di validità lo rifiuterebbe, e non si
    // potrebbe più nemmeno correggere una nota.
    if ('quando' in b && b.quando != null && Number(b.quando) === p.at) delete b.quando;
    const campi = campiPasso(b, { nuovo: false });
    // La regione di partenza si giudica sul tipo che il passo AVRÀ.
    const tipo = campi.kind || p.kind;
    if (!CON_PARTENZA.has(tipo)) campi.from_region_id = null;
    const regione = 'region_id' in campi ? campi.region_id : p.region_id;
    const da = 'from_region_id' in campi ? campi.from_region_id : p.from_region_id;
    if (regione && da && regione === da) throw new Rifiuto('regioni_uguali');
    const dopo = precedentiValidi(op.id, p.id, b.dopo);
    aggiornaPasso(p.id, campi, req.account.id);
    if (dopo) impostaPrecedenti(p.id, dopo);
    aggiornaOperazione(op.id, {}, req.account.id);
    audit(req.account.id, 'operazione.passo.modifica', `op_step:${p.id}`, b);
    res.json(risposta(ctx, req));
  }));

  router.post('/:id/passi/:pid/remove', gestisci(async (req, res, ctx) => {
    soloChiPianifica(ctx);
    const op = operazioneDi(ctx, req.params.id);
    const p = passoDi(op, req.params.pid);
    eliminaPasso(p.id);
    aggiornaOperazione(op.id, {}, req.account.id);
    audit(req.account.id, 'operazione.passo.elimina', `op_step:${p.id}`, { operazione: op.id, titolo: p.title });
    res.json(risposta(ctx, req));
  }));

  return router;
}

module.exports = { buildOperazioniRouter };
