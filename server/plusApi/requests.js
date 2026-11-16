/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — il tavolo delle prenotazioni
   ----------------------------------------------------------------------
   Il prodotto. Tutto il resto — accesso Discord, personaggio verificato,
   ruoli derivati — era l'impalcatura per poter costruire questo.

   ── IL FLUSSO, CHE È QUELLO CHE GIÀ FANNO ─────────────────────────────
     1. il comandante chiede un contratto per la sua unità
     2. il ministro approva (o rifiuta)
     3. il ministro apre l'asta in gioco e SPUNTA "aperta"
     4. la spunta fa partire l'avviso all'unità, e insieme lo scheduler
        che andrà a verificare com'è finita (fase 06)

   Il passaggio 3 è manuale di proposito, ed è meglio dell'automatismo:
   un'asta non si può rilevare prima che esista, ma un umano può
   annunciarla. Chi spunta "sto per aprirla" fa arrivare l'avviso qualche
   secondo PRIMA, invece che dieci secondi dopo — e la prima offerta,
   misurata, arriva in circa dieci secondi.

   ── DUE COSE CHE NON VANNO FUSE ───────────────────────────────────────
   `status` è quello che dicono le persone; `esito` è quello che dice il
   gioco. Metà del valore sta nel poterli mostrare accanto: "il ministro
   aveva detto ok alle 21:04, l'asta è comparsa alle 21:31, l'ha presa
   un'altra unità". Con una colonna sola quella frase non esiste più.

   ── I PERMESSI SI CHIEDONO A roles.js ─────────────────────────────────
   Qui non si decide chi può cosa: si chiede. `capacita.chiedePer` e
   `capacita.approvaPer` arrivano dai dati di gioco più le deroghe, e
   questo file si limita a rispettarli. Un secondo posto in cui si decide
   chi comanda è un secondo posto in cui sbagliare.

   ── LE AZIONI STANNO FUORI DALLE ROTTE (2026-11-16) ───────────────────
   `azioneCrea / azioneDecidi / azioneAperta / azioneRitira` prendono
   l'identità che agisce e rispondono `{ codice, corpo }`. Le rotte qui sotto
   le traducono in HTTP; il bot Discord (bot.js) in bottoni e comandi. Un
   bottone "Approva" passa dagli STESSI controlli di quello della pagina.
   ══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const {
  creaRichiesta, getRichiesta, listaRichieste, aggiornaRichiesta,
  getAccountById, getWebhook, setWebhook, deleteWebhook, audit, getDb, sportelloAperto,
} = require('./db');
const { calcolaEffettivi } = require('./roles');
const { puoChiedere } = require('./policy');
const { segnalaApertura } = require('./watcher');
const {
  avvisa, avvisaCarta, urlWebhookValido,
  testoNuovaRichiesta, testoApprovata, testoRifiutata, testoAperta,
} = require('./notify');

/** Forma esposta al client: nomi in camelCase e nessun id interno che non
 *  serva. Quello che non esce non si può sbagliare a mostrare. */
function pubblica(r) {
  return {
    id: r.id,
    battleId: r.battle_id, battleLabel: r.battle_label, side: r.side,
    countryId: r.country_id, muId: r.mu_id, muNome: r.mu_nome,
    minDamage: r.min_damage, budget: r.budget, perK: r.per_k,
    // Danno fattibile SUBITO all'apertura dell'asta (facoltativo).
    burstDamage: r.burst_damage,
    duration: r.duration, professionalsOnly: Boolean(r.professionals_only),
    note: r.note,
    status: r.status,
    approvedAt: r.approved_at, openedAt: r.opened_at,
    esito: r.esito, winnerMu: r.winner_mu, finalPerK: r.final_per_k,
    // Com'e' stata aperta davvero: la vista mostra "chiesto X, aperto Y"
    // quando differiscono, che dice piu' di un'etichetta.
    apertMinDamage: r.apert_min_damage, apertBudget: r.apert_budget,
    verificatoIl: r.verificato_il,
    createdAt: r.created_at, updatedAt: r.updated_at,
    // Chi ha fatto cosa, per nome: l'archivio serve a questo.
    richiedente: r.richiedente || null,
    approvatore: r.approvatore || null,
    apritore: r.apritore || null,
  };
}

function conNomi(r) {
  const nome = (id) => {
    if (!id) return null;
    const a = getAccountById(id);
    return a ? (a.war_username || a.discord_username) : null;
  };
  return { ...r, richiedente: nome(r.requested_by), approvatore: nome(r.approved_by), apritore: nome(r.opened_by) };
}

// ---------------------------------------------------------------------------
// LE AZIONI, SEPARATE DALLE ROTTE
// ---------------------------------------------------------------------------

/** Capacità di un'identità (che sotto lente è il bersaglio). */
async function capacitaDi(identita) {
  const dati = await calcolaEffettivi(identita, {});
  return dati.capacita;
}

const nomeDi = (identita) => identita.war_username || identita.discord_username;

async function azioneCrea(identita, b) {
  b = b || {};
  const battleId = String(b.battleId || '').trim();
  const muId = String(b.muId || '').trim();
  const countryId = String(b.countryId || '').trim();
  if (!battleId || !muId || !countryId) return { codice: 400, corpo: { error: 'parametri_non_validi' } };

  const cap = await capacitaDi(identita);
  if (!cap.chiedePer.includes(muId)) return { codice: 403, corpo: { error: 'non_comandi_questa_unita' } };

  // Lo sportello chiuso dal governo (bottone "Close desk" del bot) vale per
  // tutti, sito compreso: chiuderlo solo su Discord e lasciare che le
  // richieste arrivino dal sito sarebbe un divieto a meta'.
  if (!sportelloAperto(countryId)) return { codice: 409, corpo: { error: 'sportello_chiuso' } };

  // Comandare un'unita' non basta: e' la nazione che paga, ed e' la
  // nazione che decide con chi lavora (policy.js).
  const permesso = await puoChiedere({
    muId, muCountryId: cap.muCountryId, targetCountryId: countryId,
  });
  if (!permesso.ammesso) {
    return { codice: 403, corpo: { error: permesso.motivo === 'esclusa' ? 'unita_esclusa' : 'fuori_dalla_lista' } };
  }

  const r = creaRichiesta({
    battleId, battleLabel: String(b.battleLabel || '').slice(0, 200) || null,
    side: b.side === 'defender' ? 'defender' : b.side === 'attacker' ? 'attacker' : null,
    countryId, muId, muNome: String(b.muNome || '').slice(0, 100) || null,
    requestedBy: identita.id,
    minDamage: Number(b.minDamage) || null,
    budget: Number(b.budget) || null,
    perK: Number(b.perK) || null,
    duration: Number(b.duration) || null,
    professionalsOnly: Boolean(b.professionalsOnly),
    note: String(b.note || '').slice(0, 500) || null,
    burstDamage: Number(b.burstDamage) >= 1000 ? Math.round(Number(b.burstDamage)) : null,
  });
  audit(identita.id, 'request.create', `request:${r.id}`, { battleId, muId, countryId });

  // L'avviso va al canale della NAZIONE: è chi deve decidere.
  avvisa('country', countryId, testoNuovaRichiesta(r, nomeDi(identita)), { tipo: 'nuova', requestId: r.id });

  return { codice: 201, corpo: { richiesta: pubblica(conNomi(r)) } };
}

// Approvazione e rifiuto sono la stessa porta: cambia solo lo stato e il
// testo dell'avviso.
async function azioneDecidi(identita, id, nuovoStato) {
  const r = getRichiesta(Number(id));
  if (!r) return { codice: 404, corpo: { error: 'richiesta_inesistente' } };
  if (r.status !== 'pending') return { codice: 409, corpo: { error: 'gia_decisa' } };

  const cap = await capacitaDi(identita);
  if (!cap.approvaPer.includes(r.country_id)) return { codice: 403, corpo: { error: 'non_approvi_per_questa_nazione' } };

  const chi = nomeDi(identita);
  // ⚠️ `approved_by`/`approved_at` significano "chi ha DECISO e quando",
  // non "chi ha approvato": ci scrive dentro anche il rifiuto. Il nome
  // della colonna e' infelice ma cambiarlo costerebbe una migrazione su
  // dati veri; chi mostra il dato deve guardare `status` per sapere in
  // che verso e' andata. Era un bug reale: una richiesta rifiutata
  // compariva come "approvata da".
  const agg = aggiornaRichiesta(r.id, {
    status: nuovoStato,
    approved_by: identita.id,
    approved_at: Date.now(),
  });
  audit(identita.id, `request.${nuovoStato}`, `request:${r.id}`, null);

  // L'avviso va al canale dell'UNITÀ: è chi aspetta la risposta.
  const approvata = nuovoStato === 'approved';
  avvisa('mu', r.mu_id, (approvata ? testoApprovata : testoRifiutata)(agg, chi),
    { tipo: approvata ? 'approvata' : 'rifiutata', requestId: r.id });
  avvisaCarta(r.country_id, agg, approvata ? 'approvata' : 'rifiutata');

  return { codice: 200, corpo: { richiesta: pubblica(conNomi(agg)) } };
}

// ── "L'ho aperta" ──────────────────────────────────────────────────────
// Il gesto che fa partire tutto il resto. Volutamente manuale: è anche
// l'unico modo di avvisare PRIMA che l'asta esista.
async function azioneAperta(identita, id) {
  const r = getRichiesta(Number(id));
  if (!r) return { codice: 404, corpo: { error: 'richiesta_inesistente' } };
  if (r.status !== 'approved') return { codice: 409, corpo: { error: 'non_approvata' } };
  if (r.opened_at) return { codice: 409, corpo: { error: 'gia_segnata_aperta' } };

  const cap = await capacitaDi(identita);
  if (!cap.approvaPer.includes(r.country_id)) return { codice: 403, corpo: { error: 'non_approvi_per_questa_nazione' } };

  const agg = aggiornaRichiesta(r.id, { opened_at: Date.now(), opened_by: identita.id });
  audit(identita.id, 'request.opened', `request:${r.id}`, null);

  // La spunta e' l'innesco: da qui parte la raffica che cerca l'asta e
  // schedula i due controlli. Non c'e' polling a vuoto prima di questo
  // momento, perche' prima non c'era niente da guardare.
  segnalaApertura(r.id);

  avvisa('mu', r.mu_id, testoAperta(agg, nomeDi(identita)), { tipo: 'aperta', requestId: r.id });
  avvisaCarta(r.country_id, agg, 'aperta');

  return { codice: 200, corpo: { richiesta: pubblica(conNomi(agg)) } };
}

// ── Ritirare ───────────────────────────────────────────────────────────
async function azioneRitira(identita, id) {
  const r = getRichiesta(Number(id));
  if (!r) return { codice: 404, corpo: { error: 'richiesta_inesistente' } };
  if (['cancelled', 'closed'].includes(r.status)) return { codice: 409, corpo: { error: 'gia_chiusa' } };

  const cap = await capacitaDi(identita);
  const suo = r.requested_by === identita.id;
  const puo = suo || cap.chiedePer.includes(r.mu_id) || cap.approvaPer.includes(r.country_id) || cap.admin;
  if (!puo) return { codice: 403, corpo: { error: 'non_autorizzato' } };

  const agg = aggiornaRichiesta(r.id, { status: 'cancelled' });
  audit(identita.id, 'request.cancel', `request:${r.id}`, null);
  avvisaCarta(r.country_id, agg, 'ritirata');
  return { codice: 200, corpo: { richiesta: pubblica(conNomi(agg)) } };
}

// ── Correggere la propria richiesta ────────────────────────────────────
// Solo finche' nessuno ha deciso (`pending`) e solo chi l'ha fatta: dopo
// l'approvazione il ministro ha detto di si' a QUEI numeri, e cambiarli sotto
// i suoi occhi sarebbe farsi approvare una cosa e aprirne un'altra. Chi vuole
// cambiare dopo ritira e rifa'.
async function azioneModifica(identita, id, b) {
  b = b || {};
  const r = getRichiesta(Number(id));
  if (!r) return { codice: 404, corpo: { error: 'richiesta_inesistente' } };
  if (r.requested_by !== identita.id) return { codice: 403, corpo: { error: 'non_autorizzato' } };
  if (r.status !== 'pending') return { codice: 409, corpo: { error: 'gia_decisa' } };

  const minDamage = b.minDamage != null ? Number(b.minDamage) : r.min_damage;
  const perK = b.perK != null ? Number(b.perK) : r.per_k;
  if (!(minDamage >= 1000) || !(perK >= 0.001 && perK <= 5)) {
    return { codice: 400, corpo: { error: 'parametri_non_validi' } };
  }
  const agg = aggiornaRichiesta(r.id, {
    min_damage: minDamage,
    per_k: perK,
    budget: (minDamage / 1000) * perK,
    professionals_only: b.professionalsOnly == null ? r.professionals_only : (b.professionalsOnly ? 1 : 0),
    note: b.note === undefined ? r.note : (String(b.note || '').slice(0, 500) || null),
    // `undefined` = non toccare; vuoto o 0 = toglierlo.
    burst_damage: b.burstDamage === undefined ? r.burst_damage
      : (Number(b.burstDamage) >= 1000 ? Math.round(Number(b.burstDamage)) : null),
  });
  audit(identita.id, 'request.edit', `request:${r.id}`, { minDamage, perK });
  // Chi deve decidere vede i numeri nuovi sulla carta, senza un secondo avviso.
  avvisaCarta(r.country_id, agg, 'modificata');
  return { codice: 200, corpo: { richiesta: pubblica(conNomi(agg)) } };
}

// ---------------------------------------------------------------------------
// LE ROTTE
// ---------------------------------------------------------------------------

function buildRequestsRouter({ requireAuth, risolviIdentita, bloccaScrittureSottoLente, filtroNazione }) {
  const router = express.Router();
  // `filtroNazione` sta nella catena del router, non sulle singole rotte:
  // cosi' copre anche quelle che verranno aggiunte da chi non ha letto
  // nazioni.js. Va DOPO risolviIdentita perche' sotto la lente deve
  // filtrare come il bersaglio, non come l'amministratore.
  router.use(requireAuth, risolviIdentita, bloccaScrittureSottoLente, filtroNazione);

  /** Capacità dell'identità corrente (che sotto lente è il bersaglio). */
  const capacita = (req) => capacitaDi(req.identita);
  const rispondi = (res, { codice, corpo }) => res.status(codice).json(corpo);

  // ── Il tavolo ──────────────────────────────────────────────────────────
  router.get('/', async (req, res) => {
    try {
      const cap = await capacita(req);
      // Un amministratore che NON sta usando la lente vede tutto: è il suo
      // mestiere. Sotto lente vede quello che vede il bersaglio, che è
      // esattamente il motivo per cui la lente esiste.
      const tutto = Boolean(cap.admin) && !req.lente;
      const righe = listaRichieste({
        muIds: cap.chiedePer, countryIds: cap.approvaPer, tutto,
      });
      res.json({
        richieste: righe.map((r) => pubblica(conNomi(r))),
        capacita: cap,
        lente: req.lente,
      });
    } catch (err) {
      console.error('[requests] elenco fallito:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  // ── Chiedere / decidere / aprire / ritirare ────────────────────────────
  router.post('/', async (req, res) => rispondi(res, await azioneCrea(req.identita, req.body)));
  router.post('/:id/approve', async (req, res) => rispondi(res, await azioneDecidi(req.identita, req.params.id, 'approved')));
  router.post('/:id/reject', async (req, res) => rispondi(res, await azioneDecidi(req.identita, req.params.id, 'rejected')));
  router.post('/:id/opened', async (req, res) => rispondi(res, await azioneAperta(req.identita, req.params.id)));
  router.post('/:id/cancel', async (req, res) => rispondi(res, await azioneRitira(req.identita, req.params.id)));

  // ── Svuotare il tavolo ─────────────────────────────────────────────────
  // Cancella SOLO le righe gia' concluse: quelle ancora aperte sono lavoro
  // in corso, e sparirebbero sotto le mani di chi le sta aspettando.
  //
  // L'audit NON si tocca: chi ha chiesto, chi ha approvato e con che esito
  // resta scritto anche dopo che la riga sparisce dal tavolo. E' quello il
  // registro che il tool esiste per tenere; il tavolo e' solo la vista di
  // cosa aspetta una decisione adesso.
  router.post('/svuota', async (req, res) => {
    const cap = await capacita(req);
    if (!cap.admin) return res.status(403).json({ error: 'non_autorizzato' });

    const info = getDb()
      .prepare("DELETE FROM request WHERE status NOT IN ('pending','approved')")
      .run();
    audit(req.identita.id, 'request.svuota', null, { cancellate: info.changes || 0 });
    res.json({ ok: true, cancellate: info.changes || 0 });
  });

  // ── Canali di avviso ───────────────────────────────────────────────────
  router.get('/webhooks/:scopeType/:scopeId', async (req, res) => {
    const { scopeType, scopeId } = req.params;
    const cap = await capacita(req);
    const puo = scopeType === 'country' ? cap.approvaPer.includes(scopeId) : cap.chiedePer.includes(scopeId);
    if (!puo && !cap.admin) return res.status(403).json({ error: 'non_autorizzato' });
    const w = getWebhook(scopeType, scopeId);
    // Mai l'URL: contiene il token del canale, e chi lo legge puo'
    // scriverci dentro per sempre. Si dice solo se c'e'.
    res.json({ configurato: Boolean(w), creatoIl: w?.created_at || null });
  });

  router.post('/webhooks/:scopeType/:scopeId', async (req, res) => {
    const { scopeType, scopeId } = req.params;
    if (!['country', 'mu'].includes(scopeType)) return res.status(400).json({ error: 'ambito_non_valido' });

    const cap = await capacita(req);
    const puo = scopeType === 'country' ? cap.approvaPer.includes(scopeId) : cap.chiedePer.includes(scopeId);
    if (!puo && !cap.admin) return res.status(403).json({ error: 'non_autorizzato' });

    const url = String(req.body?.url || '').trim();
    if (!url) {
      deleteWebhook(scopeType, scopeId);
      audit(req.identita.id, 'webhook.remove', `${scopeType}:${scopeId}`, null);
      return res.json({ configurato: false });
    }
    if (!urlWebhookValido(url)) return res.status(400).json({ error: 'url_non_valido' });

    setWebhook({ scopeType, scopeId, url, createdBy: req.identita.id });
    audit(req.identita.id, 'webhook.set', `${scopeType}:${scopeId}`, null);
    res.json({ configurato: true });
  });

  return router;
}

module.exports = {
  buildRequestsRouter, pubblica, conNomi,
  azioneCrea, azioneDecidi, azioneAperta, azioneRitira, azioneModifica,
};
