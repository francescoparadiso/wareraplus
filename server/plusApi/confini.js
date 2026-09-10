/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — sorveglianza dei confini
   ----------------------------------------------------------------------
   La domanda: «qualcuno alla nostra frontiera sta accendendo una base
   militare o un bunker?». Il gioco la sa, ma non la dice a nessuno:
   bisognerebbe aprire le quattordici regioni confinanti una per una,
   tutti i giorni.

   Le due costruzioni che contano, e perché non sono la stessa notizia
   (gameConfig.upgradesConfig, letto dal vivo il 2026-09-10):

     · base    → `attackBonus` 5-25% a chi ATTACCA partendo da lì.
                 Una base che si accende accanto a noi è qualcuno che si
                 prepara ad attaccarci.
     · bunker  → `defenseBonus` 5-25% a chi DIFENDE lì.
                 Un bunker che si accende è qualcuno che si prepara a
                 essere attaccato — da noi, magari.

   ── LA FONTE: upgrade.getUpgradeByTypeAndEntity, NON la regione ──────
   ⚠️ La prima versione leggeva `upgradesV2` dentro la regione, e sbagliava
   tutto: è un campo FERMO a metà 2025 (nessuna data dentro è del 2026).
   Segnalato guardando il gioco: Ticino col bunker al 5 spento, e il tool
   che diceva "livello 1 attivo". La verità sta in un'altra collezione:

       upgrade.getUpgradeByTypeAndEntity { upgradeType, regionId }
         → { level, status: 'active'|'disabled', statusChangedAt,
             willBeActiveAt, lastUpgradeAt, lastDowngradeAt, … }
         → NOT_FOUND se in quella regione quella costruzione non esiste

   Pubblica, e accetta il batch: venti chiamate per URL (~2,7 KB), una
   sessantina in tutto per le regioni sorvegliate, quattro richieste ogni
   dieci minuti. Un batch con qualche NOT_FOUND risponde HTTP 207.

   `activeUpgradeLevels` della regione invece è GIUSTO, ma dice solo i
   livelli ACCESI (Tunis bunker 4 attivo → {bunker:4}; Ticino, bunker 5
   spento → {}). Serve da ripiego per le nazioni fuori sorveglianza, dove
   si vede cosa è acceso ma non cosa è spento.

   ── PERCHÉ UN AVVISO ARRIVA IN TEMPO ──────────────────────────────────
   Accendere una costruzione non è istantaneo: il gioco scrive in
   `willBeActiveAt` l'ora ESATTA in cui il bonus comincerà a contare
   (~12 ore dopo la richiesta, `pendingDurationHours`, arrotondate alla
   fine dell'ora). Un `willBeActiveAt` nel futuro vuol dire "si sta
   accendendo", e un controllo ogni dieci minuti lo vede con ~11 ore e
   mezza di anticipo. È questo che rende l'avviso utile e non cronaca.

   ── IL PRIMO GIRO NON AVVISA ──────────────────────────────────────────
   Una regione mai vista prima si fotografa e basta: al primo avvio, o
   quando una regione diventa confinante per una conquista, tutto quello
   che c'è sembrerebbe "appena acceso". Si avvisa solo su un CAMBIO fra due
   letture vere, e la vista dichiara da quando in qua si guarda.

   E si confronta SOLO ciò che è stato letto in questo giro: una chiamata
   fallita per rete non è un NOT_FOUND, e scambiarle produrrebbe un
   "smantellato" falso seguito da un "costruito" falso al giro dopo.
   ══════════════════════════════════════════════════════════════════════ */

const { API } = require('./wareraApi');
const { regioniMappa, paesiMappa, configGioco } = require('./fonti');
const { nazioniAmmesse } = require('./nazioni');
const {
  leggiStatoConfini, salvaStatoConfini, registraEventiConfini, eventiConfini,
  potaEventiConfini, inizioSorveglianzaConfini,
} = require('./db');
const { avvisa, testoConfini } = require('./notify');

const CONTROLLO_MS = 10 * 60_000;
const CHIAMATE_PER_BATCH = 20;    // ~2,7 KB di URL, misurato
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

let _difese = new Map();          // regionId → { base, bunker } (documenti upgrade letti all'ultimo giro)
let _stato = { ultimoGiro: null, regioni: 0, eventi: 0, errore: null, durataMs: null };
let _inCorso = false;

// ---------------------------------------------------------------------------
// Lettura
// ---------------------------------------------------------------------------

/**
 * Le costruzioni di un gruppo di regioni, in batch da venti chiamate.
 * NON passa da trpcBatch di wareraApi.js apposta: quello restituisce null
 * sia per NOT_FOUND sia per un errore qualunque, e qui la differenza è
 * tutto (vedi la testata).
 *
 * @param {string[]} regionIds
 * @returns {Promise<Map<string, {base?: object|null, bunker?: object|null}>>}
 *   solo le coppie lette davvero; null = la costruzione non esiste.
 */
async function leggiCostruzioni(regionIds) {
  const coppie = [];
  for (const id of regionIds) for (const tipo of TIPI) coppie.push([id, tipo]);
  const out = new Map();
  for (let i = 0; i < coppie.length; i += CHIAMATE_PER_BATCH) {
    const pezzo = coppie.slice(i, i + CHIAMATE_PER_BATCH);
    const input = Object.fromEntries(pezzo.map(([regionId, upgradeType], k) => [k, { upgradeType, regionId }]));
    const url = `${API}/${pezzo.map(() => 'upgrade.getUpgradeByTypeAndEntity').join(',')}`
      + `?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
    let risposte;
    try {
      const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
      // 207 = qualche costruzione inesistente in mezzo alle altre: normale.
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      risposte = await res.json();
    } catch (err) {
      console.warn('[confini] lettura costruzioni fallita:', err.message);
      continue;
    }
    (Array.isArray(risposte) ? risposte : [risposte]).forEach((x, k) => {
      const [id, tipo] = pezzo[k] || [];
      if (!id) return;
      let valore;
      if (x?.result) valore = x.result.data ?? null;
      else if (x?.error?.data?.code === 'NOT_FOUND') valore = null;
      else return; // errore vero: questa coppia non si è letta
      if (!out.has(id)) out.set(id, {});
      out.get(id)[tipo] = valore;
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Forma di una costruzione
// ---------------------------------------------------------------------------

/** Una costruzione come la guarda questo file. `pending` non è
 *  un'etichetta del gioco ma nostra: un `willBeActiveAt` nel futuro. */
function statoCostruzione(u, ora = Date.now()) {
  if (!u) return { livello: 0, stato: 'assente', dal: null, attivoDal: null };
  const attivoDal = Date.parse(u.willBeActiveAt || '') || null;
  return {
    livello: Number(u.level) || 0,
    stato: attivoDal && attivoDal > ora ? 'pending' : (u.status || null),
    dal: Date.parse(u.statusChangedAt || '') || null,
    attivoDal: attivoDal && attivoDal > ora ? attivoDal : null,
    potenziatoIl: Date.parse(u.lastUpgradeAt || '') || null,
  };
}

/**
 * Cosa è cambiato fra due letture. null se niente.
 * @param {{livello:number, stato:string|null}|null} p  riga del db
 * @param {ReturnType<typeof statoCostruzione>} c
 */
function classifica(p, c) {
  if (!p) return null;
  const eraAssente = p.stato === 'assente';
  if (eraAssente && c.stato === 'assente') return null;
  if (!eraAssente && c.stato === 'assente') return 'rimosso';

  const trovati = [];
  // Una costruzione che prima non c'era: è una costruzione, non un
  // "potenziamento da 0 a 1" né uno "spegnimento" da niente a spento.
  if (eraAssente) trovati.push('costruzione');
  else {
    if (c.livello > p.livello) trovati.push('livello_su');
    if (c.livello < p.livello) trovati.push('livello_giu');
  }
  if ((p.stato || null) !== (c.stato || null)) {
    if (c.stato === 'pending') trovati.push(p.stato === 'active' ? 'disattivazione' : 'attivazione');
    else if (c.stato === 'active') trovati.push('attivo');
    else if (c.stato === 'disabled' && !eraAssente) trovati.push('disattivato');
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
    const [reg, paesi] = await Promise.all([regioniMappa(), paesiMappa()]);
    const ammesse = nazioniAmmesse();

    const perPaese = new Map();
    const daLeggere = new Set();
    for (const cid of ammesse) {
      const g = geografia(reg, cid);
      perPaese.set(cid, g);
      for (const id of g.proprie) daLeggere.add(id);
      for (const id of g.confinanti.keys()) daLeggere.add(id);
    }

    const lette = await leggiCostruzioni([...daLeggere]);

    // ── Confronto ─────────────────────────────────────────────────────
    const now = Date.now();
    const prima = leggiStatoConfini();
    const regioniViste = new Set([...prima.keys()].map((k) => k.split(':')[0]));
    const righe = [];
    const nuovi = [];

    for (const [rid, costruzioni] of lette) {
      const maiVista = !regioniViste.has(rid);
      const ownerId = reg[rid]?.country || null;
      for (const tipo of TIPI) {
        if (!(tipo in costruzioni)) continue;  // questa coppia non si è letta
        const c = statoCostruzione(costruzioni[tipo], now);
        righe.push({ regionId: rid, tipo, livello: c.livello, stato: c.stato, attivoIl: c.attivoDal, ownerId });
        if (maiVista) continue;
        const p = prima.get(`${rid}:${tipo}`) || null;
        const evento = classifica(p, c);
        if (!evento) continue;

        // Una riga per ogni nazione sorvegliata a cui questa regione confina:
        // la stessa base accesa fra Italia e Slovenia e' una notizia per
        // tutte e due, con due relazioni diverse.
        for (const [cid, g] of perPaese) {
          const tocca = g.confinanti.get(rid);
          if (!tocca) continue;
          nuovi.push({
            countryId: cid,
            regionId: rid,
            regionNome: reg[rid]?.name || rid,
            ownerId,
            tipo,
            evento,
            livelloDa: p?.livello ?? 0,
            livelloA: c.livello,
            statoDa: p?.stato ?? null,
            statoA: c.stato,
            relazione: relazione(paesi.get(cid), ownerId),
            confinaCon: [...tocca].map((id) => reg[id]?.name || id),
            at: now,
            // L'ora esatta in cui il bonus comincia a contare: la scrive il
            // gioco, non la si stima.
            effettoIl: evento === 'attivazione' ? c.attivoDal : null,
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

    // Si sostituisce solo ciò che si è letto: una regione saltata per rete
    // tiene la lettura di prima invece di sparire dalla vista.
    for (const [rid, costruzioni] of lette) _difese.set(rid, { ...(_difese.get(rid) || {}), ...costruzioni });
    _stato = {
      ultimoGiro: now,
      regioni: [...lette.values()].filter((x) => TIPI.every((t) => t in x)).length,
      attese: daLeggere.size,
      eventi: nuovi.length,
      errore: null,
      durataMs: Date.now() - t0,
    };
    if (nuovi.length) console.log(`[confini] ${nuovi.length} cambi rilevati su ${lette.size} regioni`);
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
    fonte: 'upgrade.getUpgradeByTypeAndEntity',
    ultimoGiro: _stato.ultimoGiro ? new Date(_stato.ultimoGiro).toISOString() : null,
    sorvegliateDal: (() => { const t = inizioSorveglianzaConfini(); return t ? new Date(t).toISOString() : null; })(),
    nazioni: nazioniAmmesse().length,
  };
}

// ---------------------------------------------------------------------------
// Lettura per il quadro della nazione
// ---------------------------------------------------------------------------

/**
 * Le difese di una regione pronte da disegnare, col bonus che danno.
 *
 * Dalla lettura dell'ultimo giro quando c'è; altrimenti da
 * `activeUpgradeLevels` della cache oraria, che sa solo cosa è ACCESO: lì
 * una costruzione spenta non si distingue da nessuna costruzione, e lo
 * stato esce 'ignoto' invece di un 'assente' che sarebbe una bugia.
 */
function difese(id, r, cfg, ora = Date.now()) {
  const live = _difese.get(id);
  const out = {};
  for (const tipo of TIPI) {
    let c;
    if (live && tipo in live) c = statoCostruzione(live[tipo], ora);
    else {
      const lv = Number(r?.activeUpgradeLevels?.[tipo]) || 0;
      c = lv
        ? { livello: lv, stato: 'active', dal: null, attivoDal: null }
        : { livello: 0, stato: 'ignoto', dal: null, attivoDal: null };
    }
    const stats = cfg?.upgradesConfig?.[tipo]?.levels?.[String(c.livello)]?.stats || {};
    // Il bonus conta solo se la costruzione e' accesa: un bunker di
    // livello 5 spento difende quanto nessun bunker.
    out[tipo] = { ...c, bonus: c.stato === 'active' ? (stats.attackBonus ?? stats.defenseBonus ?? null) : null };
  }
  return out;
}

/**
 * Le regioni della nazione e quelle che la toccano, con le loro difese e
 * gli eventi degli ultimi 14 giorni. `sorvegliata` dice se c'è anche la
 * storia: un amministratore che guarda una nazione non abilitata vede lo
 * stato (solo le costruzioni accese) ma non gli eventi, e deve saperlo.
 */
async function quadroConfini(countryId) {
  const [reg, paesi, cfg] = await Promise.all([regioniMappa(), paesiMappa(), configGioco().catch(() => null)]);
  const noi = paesi.get(countryId);
  const g = geografia(reg, countryId);
  const sorvegliata = nazioniAmmesse().includes(countryId);

  const proprie = g.proprie.map((id) => {
    const r = reg[id] || {};
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
      difese: difese(id, r, cfg),
    };
  }).sort((a, b) => (b.capitale - a.capitale) || String(a.nome).localeCompare(String(b.nome)));

  const confinanti = [...g.confinanti.entries()].map(([id, tocca]) => {
    const r = reg[id] || {};
    return {
      id,
      nome: r.name || id,
      ownerId: r.country || null,
      relazione: relazione(noi, r.country),
      confinaCon: [...tocca].map((x) => reg[x]?.name || x),
      battaglia: r.activeBattle || null,
      difese: difese(id, r, cfg),
      live: _difese.has(id),
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
