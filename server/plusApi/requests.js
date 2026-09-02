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
   ══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const {
  creaRichiesta, getRichiesta, listaRichieste, aggiornaRichiesta,
  getAccountById, getWebhook, setWebhook, deleteWebhook, audit,
} = require('./db');
const { calcolaEffettivi } = require('./roles');
const {
  avvisa, urlWebhookValido,
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
    duration: r.duration, professionalsOnly: Boolean(r.professionals_only),
    note: r.note,
    status: r.status,
    approvedAt: r.approved_at, openedAt: r.opened_at,
    esito: r.esito, winnerMu: r.winner_mu, finalPerK: r.final_per_k,
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

function buildRequestsRouter({ requireAuth, risolviIdentita, bloccaScrittureSottoLente }) {
  const router = express.Router();
  router.use(requireAuth, risolviIdentita, bloccaScrittureSottoLente);

  /** Capacità dell'identità corrente (che sotto lente è il bersaglio). */
  async function capacita(req) {
    const dati = await calcolaEffettivi(req.identita, {});
    return dati.capacita;
  }

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

  // ── Chiedere ───────────────────────────────────────────────────────────
  router.post('/', async (req, res) => {
    const b = req.body || {};
    const battleId = String(b.battleId || '').trim();
    const muId = String(b.muId || '').trim();
    const countryId = String(b.countryId || '').trim();
    if (!battleId || !muId || !countryId) return res.status(400).json({ error: 'parametri_non_validi' });

    const cap = await capacita(req);
    if (!cap.chiedePer.includes(muId)) return res.status(403).json({ error: 'non_comandi_questa_unita' });

    const r = creaRichiesta({
      battleId, battleLabel: String(b.battleLabel || '').slice(0, 200) || null,
      side: b.side === 'defender' ? 'defender' : b.side === 'attacker' ? 'attacker' : null,
      countryId, muId, muNome: String(b.muNome || '').slice(0, 100) || null,
      requestedBy: req.identita.id,
      minDamage: Number(b.minDamage) || null,
      budget: Number(b.budget) || null,
      perK: Number(b.perK) || null,
      duration: Number(b.duration) || null,
      professionalsOnly: Boolean(b.professionalsOnly),
      note: String(b.note || '').slice(0, 500) || null,
    });
    audit(req.identita.id, 'request.create', `request:${r.id}`, { battleId, muId, countryId });

    // L'avviso va al canale della NAZIONE: è chi deve decidere.
    avvisa('country', countryId, testoNuovaRichiesta(r, req.identita.war_username || req.identita.discord_username));

    res.status(201).json({ richiesta: pubblica(conNomi(r)) });
  });

  // ── Decidere ───────────────────────────────────────────────────────────
  // Approvazione e rifiuto sono la stessa porta: cambia solo lo stato e il
  // testo dell'avviso.
  async function decidi(req, res, nuovoStato) {
    const r = getRichiesta(Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'richiesta_inesistente' });
    if (r.status !== 'pending') return res.status(409).json({ error: 'gia_decisa' });

    const cap = await capacita(req);
    if (!cap.approvaPer.includes(r.country_id)) return res.status(403).json({ error: 'non_approvi_per_questa_nazione' });

    const chi = req.identita.war_username || req.identita.discord_username;
    const agg = aggiornaRichiesta(r.id, {
      status: nuovoStato,
      approved_by: req.identita.id,
      approved_at: Date.now(),
    });
    audit(req.identita.id, `request.${nuovoStato}`, `request:${r.id}`, null);

    // L'avviso va al canale dell'UNITÀ: è chi aspetta la risposta.
    avvisa('mu', r.mu_id, (nuovoStato === 'approved' ? testoApprovata : testoRifiutata)(agg, chi));

    res.json({ richiesta: pubblica(conNomi(agg)) });
  }

  router.post('/:id/approve', (req, res) => decidi(req, res, 'approved'));
  router.post('/:id/reject', (req, res) => decidi(req, res, 'rejected'));

  // ── "L'ho aperta" ──────────────────────────────────────────────────────
  // Il gesto che fa partire tutto il resto. Volutamente manuale: è anche
  // l'unico modo di avvisare PRIMA che l'asta esista.
  router.post('/:id/opened', async (req, res) => {
    const r = getRichiesta(Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'richiesta_inesistente' });
    if (r.status !== 'approved') return res.status(409).json({ error: 'non_approvata' });
    if (r.opened_at) return res.status(409).json({ error: 'gia_segnata_aperta' });

    const cap = await capacita(req);
    if (!cap.approvaPer.includes(r.country_id)) return res.status(403).json({ error: 'non_approvi_per_questa_nazione' });

    const agg = aggiornaRichiesta(r.id, { opened_at: Date.now(), opened_by: req.identita.id });
    audit(req.identita.id, 'request.opened', `request:${r.id}`, null);

    avvisa('mu', r.mu_id, testoAperta(agg, req.identita.war_username || req.identita.discord_username));

    res.json({ richiesta: pubblica(conNomi(agg)) });
  });

  // ── Ritirare ───────────────────────────────────────────────────────────
  router.post('/:id/cancel', async (req, res) => {
    const r = getRichiesta(Number(req.params.id));
    if (!r) return res.status(404).json({ error: 'richiesta_inesistente' });
    if (['cancelled', 'closed'].includes(r.status)) return res.status(409).json({ error: 'gia_chiusa' });

    const cap = await capacita(req);
    const suo = r.requested_by === req.identita.id;
    const puo = suo || cap.chiedePer.includes(r.mu_id) || cap.approvaPer.includes(r.country_id) || cap.admin;
    if (!puo) return res.status(403).json({ error: 'non_autorizzato' });

    const agg = aggiornaRichiesta(r.id, { status: 'cancelled' });
    audit(req.identita.id, 'request.cancel', `request:${r.id}`, null);
    res.json({ richiesta: pubblica(conNomi(agg)) });
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

module.exports = { buildRequestsRouter };
