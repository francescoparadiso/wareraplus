/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — sorveglianza dei confini
   ----------------------------------------------------------------------
   La domanda: «qualcuno alla nostra frontiera sta accendendo una base
   militare o un bunker?». Il gioco la sa — ogni regione porta le sue
   costruzioni in `upgradesV2` — ma non la dice a nessuno: bisognerebbe
   aprire le quattordici regioni confinanti una per una, tutti i giorni.

   Le due costruzioni che contano, e perché non sono la stessa notizia
   (gameConfig.upgradesConfig, letto dal vivo il 2026-09-10):

     · base    → `attackBonus` 5-25% a chi ATTACCA partendo da lì.
                 Una base che si accende accanto a noi è qualcuno che si
                 prepara ad attaccarci.
     · bunker  → `defenseBonus` 5-25% a chi DIFENDE lì.
                 Un bunker che si accende è qualcuno che si prepara a
                 essere attaccato — da noi, magari.

   ── PERCHÉ UN AVVISO ARRIVA IN TEMPO ──────────────────────────────────
   Accendere una costruzione non è istantaneo: lo stato passa a `pending`
   per `pendingDurationHours` (12 ore) prima di diventare `active`. Un
   controllo ogni dieci minuti vede quindi l'accensione con ~11 ore e
   mezza di anticipo sul momento in cui il bonus conta davvero. È questo
   che rende l'avviso utile e non cronaca.

   ── COSA SI GUARDA ────────────────────────────────────────────────────
   Per ogni nazione a cui l'area è aperta (nazioni.js): le sue regioni e
   quelle straniere che le toccano (`neighbors`). Chi possiede cosa e chi
   confina con chi arriva dalla cache oraria del cache-server; le DIFESE
   invece si leggono in diretta con `region.getById` in batch — una
   settantina di regioni in due richieste ogni dieci minuti, contro i
   768 KB di region.getRegionsObject.

   ⚠️ `activeUpgradeLevels` NON si usa. È un secondo campo per le stesse
   costruzioni e non combacia con `upgradesV2` (misurato: Tunis bunker
   livello 1 attivo in upgradesV2, 4 in activeUpgradeLevels; Libia sud-est
   5 senza nessuna voce in upgradesV2). Finché non si capisce cosa misura,
   avvisare su quel campo vorrebbe dire avvisare su qualcosa di ignoto.

   ── IL PRIMO GIRO NON AVVISA ──────────────────────────────────────────
   Una regione mai vista prima si fotografa e basta: al primo avvio, o
   quando una regione diventa confinante per una conquista, tutto quello
   che c'è sembrerebbe "appena acceso". Si avvisa solo su un CAMBIO fra due
   letture vere, e la vista dichiara da quando in qua si guarda.

   E si confronta SOLO ciò che è stato letto in diretta in questo giro: se
   una regione non risponde, si salta invece di confrontarla con la cache
   oraria, che direbbe "spento" di una base accesa venti minuti fa e
   produrrebbe un falso allarme al giro dopo.
   ══════════════════════════════════════════════════════════════════════ */

const { trpcBatch } = require('./wareraApi');
const { regioniMappa, paesiMappa, configGioco } = require('./fonti');
const { nazioniAmmesse } = require('./nazioni');
const {
  leggiStatoConfini, salvaStatoConfini, registraEventiConfini, eventiConfini,
  potaEventiConfini, inizioSorveglianzaConfini,
} = require('./db');
const { avvisa, testoConfini } = require('./notify');

const CONTROLLO_MS = 10 * 60_000;
const CHUNK = 40;                 // regioni per batch: ~40 caratteri l'una, URL sotto i 2 KB
const TIPI = ['base', 'bunker'];
const RETENTION_EVENTI_MS = 60 * 24 * 3600_000;
const PENDING_H_DEFAULT = 12;     // ultimo valore noto, se gameConfig non risponde

// Gli eventi che vanno su Discord: accendere e costruire. Spegnere e
// smontare sono buone notizie, restano nella vista ma non svegliano un
// canale con centinaia di persone dentro.
const EVENTI_DA_AVVISARE = new Set(['attivazione', 'attivo', 'costruzione', 'livello_su']);

// Se in un giro cambiano più cose sulla stessa costruzione, se ne tiene
// una: la più importante per chi deve decidere.
const PRIORITA = ['attivazione', 'attivo', 'costruzione', 'livello_su', 'disattivazione', 'disattivato', 'rimosso', 'livello_giu'];

let _live = new Map();            // regionId → regione letta in diretta all'ultimo giro
let _stato = { ultimoGiro: null, regioni: 0, eventi: 0, errore: null, durataMs: null };
let _inCorso = false;

// ---------------------------------------------------------------------------
// Forma di una costruzione
// ---------------------------------------------------------------------------

/** Una costruzione come la guarda questo file: livello, stato, cantiere. */
function statoCostruzione(u) {
  if (!u) return { livello: 0, stato: 'assente', inCostruzione: false, dal: null };
  return {
    livello: Number(u.level) || 0,
    // Una costruzione appena avviata non ha ancora `status`: e' solo un
    // cantiere. null e non 'assente', perche' qualcosa c'e'.
    stato: u.status || null,
    inCostruzione: Boolean(u.isUnderConstruction),
    dal: Date.parse(u.statusChangedAt || u.constructionEndedAt || u.constructionStartedAt || '') || null,
    puntiCostruzione: Number(u.constructionPoints) || 0,
  };
}

/**
 * Cosa è cambiato fra due letture. null se niente.
 * @param {{livello:number, stato:string|null, in_costruzione:number}|null} p  riga del db
 * @param {ReturnType<typeof statoCostruzione>} c
 */
function classifica(p, c) {
  if (!p) return null;
  const trovati = [];
  if (p.stato === 'assente' && c.stato === 'assente') return null;
  if (p.stato !== 'assente' && c.stato === 'assente') trovati.push('rimosso');
  else {
    if (!p.in_costruzione && c.inCostruzione) trovati.push('costruzione');
    if (c.livello > p.livello) trovati.push('livello_su');
    if (c.livello < p.livello) trovati.push('livello_giu');
    if ((p.stato || null) !== (c.stato || null)) {
      // `pending` e' il passaggio in corso, in un verso o nell'altro: lo
      // dice lo stato di prima. Da spento (o da niente) si sta accendendo.
      if (c.stato === 'pending') trovati.push(p.stato === 'active' ? 'disattivazione' : 'attivazione');
      else if (c.stato === 'active') trovati.push('attivo');
      else if (c.stato === 'disabled') trovati.push('disattivato');
    }
  }
  if (!trovati.length) return null;
  return PRIORITA.find((e) => trovati.includes(e)) || trovati[0];
}

/** Il rapporto fra la nazione che guarda e quella che possiede la regione.
 *  Si calcola sui dati di adesso: una guerra dichiarata ieri cambia il
 *  peso di una base accesa oggi. */
function relazione(noi, loro) {
  if (!noi || !loro) return 'neutrale';
  if (noi.enemy === loro) return 'nemico_giurato';
  if ((noi.warsWith || []).includes(loro)) return 'guerra';
  if ((noi.allies || []).includes(loro)) return 'alleato';
  if ((noi.defensivePacts || []).includes(loro)) return 'patto';
  const nap = Date.parse(noi.nonAggressionUntil?.[loro] || '');
  if (Number.isFinite(nap) && nap > Date.now()) return 'nap';
  return 'neutrale';
}

/**
 * Per una nazione: le sue regioni e quelle straniere che le toccano, con
 * accanto quali delle nostre toccano. Dalla cache oraria: la geografia e
 * i possessi si muovono a colpi di battaglia, non di minuti.
 */
function geografia(reg, countryId) {
  const proprie = [];
  const confinanti = new Map(); // regionId → Set(regionId nostre)
  for (const r of Object.values(reg)) {
    if (r?.country !== countryId) continue;
    proprie.push(r._id);
    for (const n of r.neighbors || []) {
      const x = reg[n];
      if (!x || x.country === countryId) continue;
      if (!confinanti.has(n)) confinanti.set(n, new Set());
      confinanti.get(n).add(r._id);
    }
  }
  return { proprie, confinanti };
}

async function pendingOre() {
  try {
    const cfg = await configGioco();
    return Number(cfg?.upgradesConfig?.bunker?.pendingDurationHours) || PENDING_H_DEFAULT;
  } catch { return PENDING_H_DEFAULT; }
}

// ---------------------------------------------------------------------------
// Il giro
// ---------------------------------------------------------------------------

async function giro() {
  if (_inCorso) return;
  _inCorso = true;
  const t0 = Date.now();
  try {
    const [reg, paesi, oreAttesa] = await Promise.all([regioniMappa(), paesiMappa(), pendingOre()]);
    const ammesse = nazioniAmmesse();

    const perPaese = new Map();
    const daLeggere = new Set();
    for (const cid of ammesse) {
      const g = geografia(reg, cid);
      perPaese.set(cid, g);
      for (const id of g.proprie) daLeggere.add(id);
      for (const id of g.confinanti.keys()) daLeggere.add(id);
    }

    // ── Lettura in diretta ────────────────────────────────────────────
    const ids = [...daLeggere];
    const live = new Map();
    for (let i = 0; i < ids.length; i += CHUNK) {
      const pezzo = ids.slice(i, i + CHUNK);
      try {
        const risp = await trpcBatch(pezzo.map((id) => ['region.getById', { regionId: id }]));
        risp.forEach((r, k) => { if (r?._id) live.set(pezzo[k], r); });
      } catch (err) {
        // Un pezzo che non risponde si salta: vedi la testata sul perché
        // non si ricade sulla cache oraria per il confronto.
        console.warn('[confini] lettura regioni fallita:', err.message);
      }
    }

    // ── Confronto ─────────────────────────────────────────────────────
    const now = Date.now();
    const prima = leggiStatoConfini();
    const regioniViste = new Set([...prima.keys()].map((k) => k.split(':')[0]));
    const righe = [];
    const nuovi = [];

    for (const [rid, r] of live) {
      const maiVista = !regioniViste.has(rid);
      for (const tipo of TIPI) {
        const c = statoCostruzione(r.upgradesV2?.upgrades?.[tipo]);
        righe.push({ regionId: rid, tipo, livello: c.livello, stato: c.stato, inCostruzione: c.inCostruzione, ownerId: r.country });
        if (maiVista) continue;
        const evento = classifica(prima.get(`${rid}:${tipo}`) || null, c);
        if (!evento) continue;
        const p = prima.get(`${rid}:${tipo}`);

        // Una riga per ogni nazione sorvegliata a cui questa regione confina:
        // la stessa base accesa fra Italia e Slovenia e' una notizia per
        // tutte e due, con due relazioni diverse.
        for (const [cid, g] of perPaese) {
          const tocca = g.confinanti.get(rid);
          if (!tocca) continue;
          nuovi.push({
            countryId: cid,
            regionId: rid,
            regionNome: r.name || reg[rid]?.name || rid,
            ownerId: r.country,
            tipo,
            evento,
            livelloDa: p?.livello ?? 0,
            livelloA: c.livello,
            statoDa: p?.stato ?? null,
            statoA: c.stato,
            relazione: relazione(paesi.get(cid), r.country),
            confinaCon: [...tocca].map((id) => reg[id]?.name || id),
            at: now,
            // Quando il bonus comincia a contare: accensione + 12 ore.
            effettoIl: evento === 'attivazione' ? (c.dal || now) + oreAttesa * 3600_000 : null,
          });
        }
      }
    }

    salvaStatoConfini(righe, now);
    if (nuovi.length) registraEventiConfini(nuovi);
    potaEventiConfini(now - RETENTION_EVENTI_MS);

    // ── Discord ───────────────────────────────────────────────────────
    // Un messaggio per nazione per giro, non uno per evento: dieci basi
    // accese insieme sono UNA notizia ("stanno preparando qualcosa"), e
    // dieci notifiche di fila sono il modo più rapido di farsi silenziare.
    const perAvviso = new Map();
    for (const e of nuovi) {
      if (!EVENTI_DA_AVVISARE.has(e.evento)) continue;
      if (!perAvviso.has(e.countryId)) perAvviso.set(e.countryId, []);
      perAvviso.get(e.countryId).push(e);
    }
    const nome = (id) => paesi.get(id)?.name || id;
    for (const [cid, eventi] of perAvviso) avvisa('confini', cid, testoConfini(eventi, nome));

    _live = live;
    _stato = { ultimoGiro: now, regioni: live.size, attese: ids.length, eventi: nuovi.length, errore: null, durataMs: Date.now() - t0 };
    if (nuovi.length) console.log(`[confini] ${nuovi.length} cambi rilevati su ${live.size} regioni`);
  } catch (err) {
    _stato = { ..._stato, errore: err.message, durataMs: Date.now() - t0 };
    console.error('[confini] giro fallito:', err.message);
  } finally {
    _inCorso = false;
  }
}

function initConfini() {
  // Un primo giro poco dopo l'avvio, non subito: il cache-server sulla
  // loopback riparte spesso insieme a questo processo, e un giro a vuoto
  // non serve a nessuno.
  setTimeout(giro, 20_000).unref();
  setInterval(giro, CONTROLLO_MS).unref();
}

function statoConfini() {
  return {
    ..._stato,
    ultimoGiro: _stato.ultimoGiro ? new Date(_stato.ultimoGiro).toISOString() : null,
    sorvegliateDal: (() => { const t = inizioSorveglianzaConfini(); return t ? new Date(t).toISOString() : null; })(),
    nazioni: nazioniAmmesse().length,
  };
}

// ---------------------------------------------------------------------------
// Lettura per il quadro della nazione
// ---------------------------------------------------------------------------

/** Le difese di una regione pronte da disegnare, col bonus che danno. */
function difese(r, cfg) {
  const out = {};
  for (const tipo of TIPI) {
    const c = statoCostruzione(r?.upgradesV2?.upgrades?.[tipo]);
    const livelli = cfg?.upgradesConfig?.[tipo]?.levels || {};
    const stats = livelli[String(c.livello)]?.stats || {};
    out[tipo] = {
      ...c,
      // Il bonus conta solo se la costruzione e' accesa: un bunker di
      // livello 5 spento difende quanto nessun bunker.
      bonus: c.stato === 'active' ? (stats.attackBonus ?? stats.defenseBonus ?? null) : null,
    };
  }
  return out;
}

/**
 * Le regioni della nazione e quelle che la toccano, con le loro difese e
 * gli eventi degli ultimi 14 giorni.
 *
 * Le difese vengono dalla lettura in diretta dell'ultimo giro quando c'è,
 * dalla cache oraria altrimenti — e `sorvegliata` dice quale dei due: un
 * amministratore che guarda una nazione non abilitata vede lo stato ma
 * non la storia, e deve saperlo.
 */
async function quadroConfini(countryId) {
  const [reg, paesi, cfg] = await Promise.all([regioniMappa(), paesiMappa(), configGioco().catch(() => null)]);
  const noi = paesi.get(countryId);
  const g = geografia(reg, countryId);
  const fonte = (id) => _live.get(id) || reg[id];
  const sorvegliata = nazioniAmmesse().includes(countryId);

  const proprie = g.proprie.map((id) => {
    const r = fonte(id) || {};
    return {
      id,
      nome: r.name || id,
      capitale: Boolean(r.isCapital),
      collegataCapitale: r.isLinkedToCapital !== false,
      sviluppo: r.development ?? null,
      resistenza: r.resistance ?? null,
      resistenzaMax: r.resistanceMax ?? null,
      battaglia: r.activeBattle || null,
      giacimento: r.deposit?.type ? { tipo: r.deposit.type, bonus: r.deposit.bonusPercent ?? null, fine: Date.parse(r.deposit.endsAt || '') || null } : null,
      risorsa: r.strategicResource || null,
      costa: Boolean(r.hasCoast),
      difese: difese(r, cfg),
    };
  }).sort((a, b) => (b.capitale - a.capitale) || String(a.nome).localeCompare(String(b.nome)));

  const confinanti = [...g.confinanti.entries()].map(([id, tocca]) => {
    const r = fonte(id) || {};
    return {
      id,
      nome: r.name || id,
      ownerId: r.country || null,
      relazione: relazione(noi, r.country),
      confinaCon: [...tocca].map((x) => reg[x]?.name || x),
      battaglia: r.activeBattle || null,
      difese: difese(r, cfg),
      live: _live.has(id),
    };
  });

  return {
    sorvegliata,
    ultimoGiro: sorvegliata ? _stato.ultimoGiro : null,
    sorvegliateDal: sorvegliata ? inizioSorveglianzaConfini() : null,
    pendingOre: Number(cfg?.upgradesConfig?.bunker?.pendingDurationHours) || PENDING_H_DEFAULT,
    proprie,
    confinanti,
    eventi: sorvegliata ? eventiConfini(countryId, Date.now() - 14 * 24 * 3600_000) : [],
  };
}

// `giro` esportato per le prove a mano (node -e) e per un eventuale
// "forza un controllo" dell'amministratore: non lo chiama nessun altro.
module.exports = { initConfini, statoConfini, quadroConfini, relazione, classifica, statoCostruzione, giro };
