/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — la mia nazione
   ----------------------------------------------------------------------
   Fino a qui l'area riservata era un posto per chi aveva un POTERE: il
   comandante che chiede un contratto, il ministro che lo approva. Un
   cittadino senza cariche entrava e trovava il suo profilo e nient'altro.

   Questo router rovescia la domanda: non «cosa puoi fare» ma «cosa puoi
   vedere», e un cittadino di una nazione abilitata può vedere la sua
   nazione — tesoro, governo, battaglie, regioni con le loro difese, cosa
   si accende ai confini, come stanno i nemici. I contratti restano dove
   erano, per chi ha i poteri; questo sta davanti, per tutti.

   ── PERCHÉ SUL SERVER, SE I DATI SONO PUBBLICI ────────────────────────
   Presi uno per uno lo sono tutti. Tre ragioni per non rifarli nel
   browser:

     · la SORVEGLIANZA DEI CONFINI deve girare anche quando nessuno guarda,
       o un avviso arriva quando qualcuno apre la pagina — cioè tardi;
     · il potenziale dei NEMICI vuole `user.getUserLite` su novanta
       giocatori per nazione: dieci ministri che aprono la vista sarebbero
       novecento richieste, qui sono novanta ogni dieci minuti;
     · il resto sono sei letture di cache diverse che il server fa sulla
       loopback e il browser farebbe attraverso internet.

   ── CHI VEDE COSA ─────────────────────────────────────────────────────
   Tutto il router sta dietro al filtro nazione (nazioni.js): solo le
   nazioni abilitate. Dentro, la pagina la vedono in tre:

     · il GOVERNO, per carica (`gestisceNazione`: presidente, vice,
       ministri — il congresso no, è parlamento). Calcolata dal gioco
       come ogni ruolo: chi è eletto entra, chi decade esce;
     · i giocatori che il governo SCEGLIE (tabella nation_access). Devono
       essere cittadini di quella nazione, e servono comunque Discord e il
       personaggio collegato: la riga dice "questo personaggio", il login
       dice "sono io";
     · gli amministratori del tool.

   Il cittadino qualunque no — decisione del 2026-09-10, dopo una prima
   versione aperta a tutti i cittadini: basi nemiche e pillole altrui
   sono cose che un governo sceglie con chi condividere. A lui il 403
   porta i nomi del governo, così la vista dice a chi chiedere invece di
   dire solo di no.

   La nazione è quella del GIOCATORE (`derivati.countryId`), non una
   scelta: un cittadino italiano vede l'Italia. Un amministratore può
   passare `?paese=` per guardarne un'altra — serve a rispondere a «a me
   non si vede», come la lente — e senza personaggio collegato vede la
   prima delle nazioni abilitate invece di una pagina vuota.

   Le SCRITTURE sono tutte del governo, come la lista permessi: il canale
   Discord degli avvisi di confine e chi altro può vedere la pagina.
   ══════════════════════════════════════════════════════════════════════ */

const express = require('express');
const { calcolaEffettivi } = require('./roles');
const { nazioniAmmesse } = require('./nazioni');
const {
  getWebhook, setWebhook, deleteWebhook, audit, getAccountById, findAccountByWarUserId,
  accessiNazione, haAccessoNazione, aggiungiAccessoNazione, togliAccessoNazione,
} = require('./db');
const { urlWebhookValido } = require('./notify');
const { trpcGet } = require('./wareraApi');
const {
  regioniMappa, paesiMappa, paeseLive, governo, nomiUtenti,
  battaglieVive, baseDannoGiornaliero, bonifici, timeline, dalCache, memo,
} = require('./fonti');
const { quadroConfini, relazione } = require('./confini');
const { quadroNemici } = require('./nemici');

const FINESTRA_BONIFICI_MS = 72 * 3600_000;

const CARICHE = [
  ['president', 'presidente'],
  ['vicePresident', 'vice'],
  ['minOfDefense', 'difesa'],
  ['minOfForeignAffairs', 'esteri'],
  ['minOfEconomy', 'economia'],
];

const rk = (r) => (r ? { valore: r.value ?? null, rank: r.rank ?? null, tier: r.tier ?? null } : null);

/** Il valore di una promessa andata a buon fine, null altrimenti: ogni
 *  pezzo del quadro fallisce per conto suo e si dice "non disponibile"
 *  al posto suo, invece di portarsi dietro tutto il resto. */
const esito = (r) => (r.status === 'fulfilled' ? r.value : null);

// ---------------------------------------------------------------------------
// Il quadro
// ---------------------------------------------------------------------------

function formaPaese(n) {
  const r = n.rankings || {};
  const ora = Date.now();
  return {
    id: n._id,
    nome: n.name,
    codice: n.code,
    fonte: n._fonte || 'cache',
    letto: n._letto || null,
    tesoro: n.money ?? null,
    tasse: n.taxes || null,
    popolazione: n.currentPopulation ?? null,
    popolazioneAttiva: rk(r.countryActivePopulation),
    sviluppo: rk(r.countryDevelopment),
    dannoSettimana: rk(r.weeklyCountryDamages),
    dannoPerCittadino: rk(r.weeklyCountryDamagesPerCitizen),
    dannoTotale: rk(r.countryDamages),
    ricchezza: rk(r.countryWealth),
    // ⚠️ Incassato dai cittadini, NON speso dal governo: vedi
    // country-bounty-is-earned-not-spent e battleArchive.js.
    taglieIncassate: rk(r.countryBounty),
    bonusProduzione: rk(r.countryProductionBonus),
    regioniDiff: rk(r.countryRegionDiff),
    disordini: n.unrest ? { barra: n.unrest.bar ?? 0, max: n.unrest.barMax ?? null } : null,
    risorse: n.strategicResources?.resources ? Object.fromEntries(
      Object.entries(n.strategicResources.resources).map(([k, v]) => [k, (v || []).length])) : {},
    bonusStrategici: n.strategicResources?.bonuses || null,
    specializzazione: n.specializedItem || null,
    alleanza: n.allianceId || null,
    alleati: n.allies || [],
    guerre: n.warsWith || [],
    nemicoGiurato: n.enemy || null,
    patti: n.defensivePacts || [],
    nap: Object.entries(n.nonAggressionUntil || {})
      .map(([id, fino]) => ({ id, fino: Date.parse(fino) || null }))
      .filter((x) => x.fino && x.fino > ora)
      .sort((a, b) => a.fino - b.fino),
    discord: n.discordUrl || null,
  };
}

async function formaGoverno(countryId) {
  const g = await governo(countryId);
  if (!g) return null;
  const ids = CARICHE.map(([k]) => g[k]).filter(Boolean);
  const nomi = await nomiUtenti(ids);
  const persona = (id) => (id ? { id, nome: nomi[id]?.username || null, avatar: nomi[id]?.avatarUrl || null } : null);
  return {
    cariche: CARICHE.map(([k, chiave]) => ({ carica: chiave, persona: persona(g[k]) })),
    congresso: (g.congressMembers || []).length,
  };
}

/** Le battaglie in corso in cui la nazione è uno dei due schieramenti. */
function formaBattaglie(elenco, countryId, reg) {
  return (elenco || [])
    .filter((b) => b?.isActive !== false
      && (b.attacker?.country === countryId || b.defender?.country === countryId))
    .map((b) => {
      const lato = b.attacker?.country === countryId ? 'attacker' : 'defender';
      const altro = lato === 'attacker' ? 'defender' : 'attacker';
      const cr = b.currentRound || {};
      const regione = b.defender?.region || b.attacker?.region || null;
      return {
        id: b._id,
        tipo: b.type || null,
        regioneId: regione,
        regione: reg?.[regione]?.name || null,
        lato,
        avversario: b[altro]?.country || null,
        round: { noi: b[lato]?.wonRoundsCount ?? 0, loro: b[altro]?.wonRoundsCount ?? 0, perVincere: b.roundsToWin ?? null },
        punti: { noi: cr[lato]?.points ?? null, loro: cr[altro]?.points ?? null },
        danno: { noi: cr[lato]?.damages ?? 0, loro: cr[altro]?.damages ?? 0 },
        inizio: Date.parse(b.createdAt || '') || null,
      };
    })
    .sort((a, b) => (b.danno.noi + b.danno.loro) - (a.danno.noi + a.danno.loro));
}

function formaBonifici(body, countryId) {
  const da = Date.now() - FINESTRA_BONIFICI_MS;
  const righe = (body?.data || []).filter((x) => x.a >= da && (x.f === countryId || x.t === countryId));
  const entrati = righe.filter((x) => x.t === countryId).map((x) => ({ paese: x.f, soldi: x.m, at: x.a }));
  const usciti = righe.filter((x) => x.f === countryId).map((x) => ({ paese: x.t, soldi: x.m, at: x.a }));
  const tot = (l) => l.reduce((t, x) => t + (x.soldi || 0), 0);
  return {
    finestraOre: FINESTRA_BONIFICI_MS / 3600_000,
    coverageFrom: body?.coverageFrom ?? null,
    entrati: entrati.sort((a, b) => b.at - a.at),
    usciti: usciti.sort((a, b) => b.at - a.at),
    totaleEntrati: tot(entrati),
    totaleUsciti: tot(usciti),
  };
}

/** Il danno di oggi = cumulato settimanale di adesso meno quello delle
 *  02:00. Negativo vuol dire che il contatore settimanale è ripartito nel
 *  frattempo: non si inventa un numero, si dice che non c'è. Stessa regola
 *  di src/shared/dailyDamage.js. */
function formaOggi(base, paese) {
  const ora = paese?.rankings?.weeklyCountryDamages?.value;
  const prima = base?.byCountry?.[paese?._id];
  if (ora == null || prima == null || ora < prima) return null;
  return { danno: ora - prima, dal: base.takenAt ?? null };
}

function formaOrario(tl) {
  if (!tl?.known) return null;
  return {
    coverageFrom: tl.coverageFrom ?? null,
    pill: tl.pill || null,
    serie: (tl.series || []).map((p) => ({ t: p.t, to: p.to, min: p.min, d: p.d, p: p.p })),
  };
}

async function quadroNazione(countryId) {
  const [paeseR, govR, battR, baseR, tlR, bonR, regR, confR] = await Promise.allSettled([
    paeseLive(countryId),
    formaGoverno(countryId),
    battaglieVive(),
    baseDannoGiornaliero(),
    timeline(`${countryId}|48`),
    bonifici(),
    regioniMappa(),
    quadroConfini(countryId),
  ]);

  const paese = esito(paeseR);
  if (!paese) throw new Error('nazione_non_leggibile');
  const reg = esito(regR);

  return {
    paese: formaPaese(paese),
    governo: esito(govR),
    oggi: formaOggi(esito(baseR), paese),
    orario: formaOrario(esito(tlR)),
    battaglie: esito(battR) ? formaBattaglie(esito(battR), countryId, reg) : null,
    bonifici: esito(bonR) ? formaBonifici(esito(bonR), countryId) : null,
    confini: esito(confR),
    generatoIl: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Chi altro vede la pagina
// ---------------------------------------------------------------------------

/** L'elenco completo dei cittadini, per cercarne uno per nome. Tutti e non
 *  i primi 400 come per i nemici: chi il governo vuole aggiungere è spesso
 *  proprio uno che fa poco danno (un diplomatico, un economista). */
const tuttiICittadini = memo(10 * 60_000, (countryId) =>
  dalCache(`/country-citizens?countryId=${encodeURIComponent(countryId)}&limit=5000`));

async function formaAccessi(countryId) {
  const righe = accessiNazione(countryId);
  const nomi = await nomiUtenti(righe.map((r) => r.war_user_id));
  return righe.map((r) => {
    const chi = r.added_by ? getAccountById(r.added_by) : null;
    return {
      warUserId: r.war_user_id,
      nome: nomi[r.war_user_id]?.username || r.war_username || null,
      avatar: nomi[r.war_user_id]?.avatarUrl || null,
      // L'accesso c'è, ma finché quel giocatore non entra con Discord e
      // collega questo personaggio non lo usa nessuno: la vista lo dice,
      // altrimenti "gliel'ho dato e non vede niente" diventa un guasto.
      entrato: Boolean(findAccountByWarUserId(r.war_user_id)),
      aggiuntoDa: chi ? (chi.war_username || chi.discord_username) : null,
      aggiuntoIl: r.created_at,
    };
  });
}

/** Gli id di chi siede nel governo adesso: nella ricerca si segnano, così
 *  non si aggiunge a mano chi la pagina la vede già per carica. */
async function idGoverno(countryId) {
  try {
    const g = await governo(countryId);
    return new Set(CARICHE.map(([k]) => g?.[k]).filter(Boolean));
  } catch { return new Set(); }
}

// ---------------------------------------------------------------------------
// Rotte
// ---------------------------------------------------------------------------

function buildNazioneRouter({ requireAuth, risolviIdentita, bloccaScrittureSottoLente, filtroNazione }) {
  const router = express.Router();
  // Stessa catena del tavolo: sotto la lente si guarda con gli occhi del
  // bersaglio, filtro nazione compreso, e non si scrive.
  router.use(requireAuth, risolviIdentita, bloccaScrittureSottoLente, filtroNazione);

  /** Di quale nazione si parla, e se chi guarda la governa. */
  async function contesto(req) {
    const eff = await calcolaEffettivi(req.identita, {});
    let countryId = eff.derivati?.countryId || null;
    const amministra = Boolean(req.account.is_admin) && !req.lente;
    const scelto = String(req.query.paese || '').trim();
    if (amministra && /^[a-f0-9]{24}$/i.test(scelto)) countryId = scelto;
    if (!countryId && amministra) countryId = nazioniAmmesse()[0] || null;
    const cap = eff.capacita || {};
    const governa = Boolean(countryId && (cap.gestisceNazione || []).includes(countryId));
    // La delega si controlla sulla nazione di cui il giocatore è cittadino
    // ADESSO: cambiata cittadinanza, `countryId` è un altro e la riga non
    // combacia più, senza che nessuno debba ricordarsi di toglierla.
    const delegato = Boolean(countryId && haAccessoNazione(countryId, req.identita?.war_user_id));
    const via = governa ? 'governo' : delegato ? 'delega' : amministra ? 'admin' : null;
    return { countryId, governa, amministra, delegato, via, accesso: Boolean(via) };
  }

  const puoGestire = (ctx) => ctx.governa || ctx.amministra;

  /** Il no, con dentro a chi chiedere: nomi pubblici, gli stessi che il
   *  gioco mostra sulla pagina del governo. */
  async function negato(res, countryId) {
    let gov = null;
    try { gov = await formaGoverno(countryId); } catch { /* chi chiamare è un di più */ }
    return res.status(403).json({ error: 'accesso_nazione_negato', governo: gov });
  }

  router.get('/', async (req, res) => {
    try {
      const ctx = await contesto(req);
      if (!ctx.countryId) return res.status(404).json({ error: 'nazione_sconosciuta' });
      if (!ctx.accesso) return negato(res, ctx.countryId);
      const quadro = await quadroNazione(ctx.countryId);
      const w = getWebhook('confini', ctx.countryId);
      res.json({
        ...quadro,
        governa: ctx.governa,
        amministra: ctx.amministra,
        // Perché questa persona vede la pagina: a un delegato la vista lo
        // scrive, perché è un accesso che qualcuno gli ha dato e può togliere.
        via: ctx.via,
        // Per l'amministratore: fra quali nazioni puo' scegliere.
        ammesse: ctx.amministra ? nazioniAmmesse() : null,
        // Mai l'URL del webhook: contiene il token del canale.
        canaleConfini: (ctx.governa || ctx.amministra) ? { configurato: Boolean(w), creatoIl: w?.created_at || null } : null,
      });
    } catch (err) {
      console.error('[nazione] quadro fallito:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  router.get('/nemici', async (req, res) => {
    try {
      const ctx = await contesto(req);
      if (!ctx.countryId) return res.status(404).json({ error: 'nazione_sconosciuta' });
      if (!ctx.accesso) return negato(res, ctx.countryId);
      res.json(await quadroNemici(ctx.countryId));
    } catch (err) {
      console.error('[nazione] nemici falliti:', err.message);
      res.status(502).json({ error: 'gioco_non_raggiungibile' });
    }
  });

  /** Il canale Discord degli avvisi di confine. Separato da quello dei
   *  contratti: un governo può volere le basi nemiche nel canale dello
   *  stato maggiore e le prenotazioni in quello dei comandanti. */
  router.post('/canale-confini', async (req, res) => {
    const ctx = await contesto(req);
    if (!ctx.countryId) return res.status(404).json({ error: 'nazione_sconosciuta' });
    if (!ctx.governa && !ctx.amministra) return res.status(403).json({ error: 'non_governi_questa_nazione' });

    const url = String(req.body?.url || '').trim();
    if (!url) {
      deleteWebhook('confini', ctx.countryId);
      audit(req.account.id, 'webhook.remove', `confini:${ctx.countryId}`, null);
      return res.json({ configurato: false });
    }
    if (!urlWebhookValido(url)) return res.status(400).json({ error: 'url_non_valido' });
    setWebhook({ scopeType: 'confini', scopeId: ctx.countryId, url, createdBy: req.account.id });
    audit(req.account.id, 'webhook.set', `confini:${ctx.countryId}`, null);
    res.json({ configurato: true });
  });

  // ── Chi altro vede la pagina ───────────────────────────────────────────
  // Leggere l'elenco e scriverlo sono del governo: un delegato vede la
  // pagina, non decide chi altro la vede.

  router.get('/accessi', async (req, res) => {
    try {
      const ctx = await contesto(req);
      if (!ctx.countryId) return res.status(404).json({ error: 'nazione_sconosciuta' });
      if (!puoGestire(ctx)) return res.status(403).json({ error: 'non_governi_questa_nazione' });
      res.json({ accessi: await formaAccessi(ctx.countryId) });
    } catch (err) {
      console.error('[nazione] accessi falliti:', err.message);
      res.status(502).json({ error: 'errore_server' });
    }
  });

  /** Cerca fra i cittadini della nazione. Solo loro: la pagina è di una
   *  nazione, e dare le basi nemiche a uno straniero è un'altra decisione,
   *  che per ora il tool non prende. */
  router.get('/cittadini', async (req, res) => {
    const ctx = await contesto(req);
    if (!ctx.countryId) return res.status(404).json({ error: 'nazione_sconosciuta' });
    if (!puoGestire(ctx)) return res.status(403).json({ error: 'non_governi_questa_nazione' });

    const q = String(req.query.q || '').trim().toLowerCase().slice(0, 40);
    let cit;
    try { cit = await tuttiICittadini(ctx.countryId); }
    catch { return res.status(502).json({ error: 'gioco_non_raggiungibile' }); }

    const deleghe = new Set(accessiNazione(ctx.countryId).map((r) => r.war_user_id));
    const perCarica = await idGoverno(ctx.countryId);
    const nome = (c) => String(c.u || '').toLowerCase();
    const trovati = (cit?.data || [])
      .filter((c) => c.u && (!q || nome(c).includes(q)))
      // Chi comincia col testo scritto prima di chi lo contiene soltanto,
      // poi chi fa più danno: fra tre "Marco" si cerca quasi sempre quello
      // attivo.
      .sort((a, b) => (Number(!nome(a).startsWith(q)) - Number(!nome(b).startsWith(q)))
        || ((b.wk || 0) - (a.wk || 0)))
      .slice(0, 15)
      .map((c) => ({
        id: c.id, nome: c.u, avatar: c.a || null, livello: c.lv ?? null, settimana: c.wk ?? null,
        delegato: deleghe.has(c.id), perCarica: perCarica.has(c.id),
      }));
    // `noti` < `censiti` vuol dire che il cache-server non ha ancora letto
    // tutti: chi manca dalla ricerca c'è, e la vista lo dice.
    res.json({ trovati, censiti: cit?.total ?? null, noti: cit?.known ?? null });
  });

  router.post('/accessi', async (req, res) => {
    const ctx = await contesto(req);
    if (!ctx.countryId) return res.status(404).json({ error: 'nazione_sconosciuta' });
    if (!puoGestire(ctx)) return res.status(403).json({ error: 'non_governi_questa_nazione' });

    const warUserId = String(req.body?.warUserId || '').trim();
    if (!/^[a-f0-9]{24}$/i.test(warUserId)) return res.status(400).json({ error: 'parametri_non_validi' });

    // La cittadinanza si controlla sul gioco, adesso, non sull'elenco del
    // cache-server che può avere ore: è la regola della riga, e va
    // verificata nel momento in cui la si scrive.
    let lite;
    try { lite = await trpcGet('user.getUserLite', { userId: warUserId }); }
    catch (err) {
      const nonEsiste = err.codiceGioco === 'NOT_FOUND';
      return res.status(nonEsiste ? 404 : 502).json({ error: nonEsiste ? 'utente_inesistente' : 'gioco_non_raggiungibile' });
    }
    if (lite?.country !== ctx.countryId) return res.status(400).json({ error: 'non_cittadino' });

    aggiungiAccessoNazione({ countryId: ctx.countryId, warUserId, warUsername: lite.username, addedBy: req.account.id });
    audit(req.account.id, 'nazione.accesso.add', `country:${ctx.countryId}`, { warUserId, username: lite.username });
    res.json({ accessi: await formaAccessi(ctx.countryId) });
  });

  router.post('/accessi/remove', async (req, res) => {
    const ctx = await contesto(req);
    if (!ctx.countryId) return res.status(404).json({ error: 'nazione_sconosciuta' });
    if (!puoGestire(ctx)) return res.status(403).json({ error: 'non_governi_questa_nazione' });

    const warUserId = String(req.body?.warUserId || '').trim();
    if (!warUserId) return res.status(400).json({ error: 'parametri_non_validi' });
    togliAccessoNazione(ctx.countryId, warUserId);
    audit(req.account.id, 'nazione.accesso.remove', `country:${ctx.countryId}`, { warUserId });
    res.json({ accessi: await formaAccessi(ctx.countryId) });
  });

  return router;
}

module.exports = { buildNazioneRouter, quadroNazione, relazione, paesiMappa };
