/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Censimento delle aziende: chi produce cosa, con quanti
   dipendenti, e quanto incassa lo Stato in tasse sui salari
   -----------------------------------------------------------------------
   Tre domande che il tool non sapeva fare, e il gioco nemmeno: per ogni
   risorsa quante aziende ci lavorano, quanti dipendenti ci sono sopra e
   quanto rende allo Stato che le ospita.

   ── PERCHÉ NON SI SFOGLIA L'ELENCO DI TUTTE LE AZIENDE ────────────────
   `company.getCompanies` senza `userId` elenca TUTTE le aziende del gioco
   (pubblica, 100 per pagina), ma sono più di 160.000 — comprese quelle di
   chi ha smesso di giocare un anno fa. E l'ordinamento non aiuta: è per
   `movedUpAt`, che NON è l'ultima produzione (misurato il 2026-10-08:
   ~1.000 aziende "mosse" al giorno, contro ~16.000 cittadini attivi che
   ne hanno in media 3,3 a testa). Sfogliarle tutte per tenerne un terzo
   sarebbe il modo più caro di sbagliare il denominatore.

   Si parte invece dai CITTADINI ATTIVI, che il censimento orario
   (`pollCitizens`, file `citizens-by-country`) tiene già: per ognuno
   `company.getCompanies {userId}`, poi `company.getById` di quelle
   aziende. "Attiva" qui vuol dire quindi "di un proprietario che ha
   giocato negli ultimi tre giorni" — la stessa soglia del censimento
   (vedi [[warera-census-active-only]] nella memoria del progetto), e la
   stessa che la vista dichiara.

   ── IL GETTITO NON SI STIMA: SI MISURA ────────────────────────────────
   `work.getStatsByCompany {companyId}` (TOKEN-GATED, dalla chiave del
   VPS) dà per ogni azienda, giorno per giorno e per 31 giorni a ritroso,
   i salari PAGATI (`wage`) e i punti prodotti da dipendenti, dal
   proprietario e dal motore automatico. I salari sono lordi (verificato:
   le transazioni `wage` di un dipendente valgono esattamente paga ×
   punti), e la tassa sul reddito la incassa la nazione dove OPERA
   l'azienda — stessa regola dell'archivio "Lavoro e tasse"
   (server/labourHistory.js), che la misurava pagamento per pagamento.
   Quindi:

       gettito(giorno, risorsa, nazione) = Σ salari × taxes.income / 100

   dove la nazione è quella che possiede ADESSO la regione dell'azienda,
   e l'aliquota quella di ADESSO. Per i giorni di ieri è il dato giusto;
   per quelli ricostruiti a ritroso al primo giro (vedi sotto) è
   un'approssimazione, e la risposta lo dice.

   Le statistiche si chiedono SOLO per le aziende che hanno dipendenti:
   senza dipendenti non c'è salario, quindi non c'è tassa sul reddito.
   Sono ~il 9% (campione di 914 aziende: 81 con dipendenti), cioè
   qualche migliaio di chiamate in meno al giorno.

   ⚠️ COSA NON È CONTATO, E VA DETTO NELLA VISTA: la tassa sul lavoro in
   proprio (`taxes.selfWork`) e quella di mercato (`taxes.market`). Della
   prima non si sa ancora su cosa si applichi, la seconda dipende da chi
   vende e dove, non da chi produce. Il numero è "tasse sui salari", non
   "tutto quello che lo Stato guadagna da quella risorsa".

   ── IL PRIMO GIRO E LA SOPRAVVIVENZA ──────────────────────────────────
   Le statistiche portano 31 giorni, quindi il primo giro riempie subito
   un mese di salari. Ma solo delle aziende che hanno dipendenti OGGI: una
   che li aveva due settimane fa e li ha persi non viene interrogata, e i
   suoi salari di allora mancano. Per questo un giorno si "congela" appena
   misurato e non si riscrive più (tranne ieri, che il giro dopo può solo
   completare), e ognuno porta il giorno in cui è stato misurato: la vista
   distingue "misurato il giorno dopo" da "ricostruito a ritroso".

   Aziende e dipendenti, invece, sono una fotografia: dicono com'è
   adesso, e la loro storia si ACCUMULA un giorno alla volta dal deploy,
   come i bonifici e la ricchezza.

   ── QUANTO COSTA ─────────────────────────────────────────────────────
   Misurato sul campione: ~16.000 proprietari → ~52.000 aziende → ~4.700
   con dipendenti. A blocchi da 50 (25 per le statistiche, che pesano ~3
   KB ad azienda): ~320 + ~1.050 + ~190 richieste, UNA volta al giorno,
   alle 03:20 italiane quando il gioco è vuoto (la stessa regola del
   bootstrap dell'archivio battaglie: niente giri pesanti mentre c'è
   gente). Passano tutte da api2 con la chiave del server, con una pausa
   fra un blocco e l'altro: un'ora scarsa di lavoro lento invece di un
   minuto che fa scattare i 429 a chi gioca.

   ⚠️ Un giro monco non sostituisce quello buono. Se meno del 90% dei
   proprietari risponde, o le aziende trovate sono meno del 70% di quelle
   del giro prima, si scarta tutto e resta la fotografia di ieri: una
   pagina persa diventerebbe "metà delle aziende di ferro ha chiuso".
   Stessa guardia di citizenMoves.js.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const FILE = 'company-census';
const TZ = 'Europe/Rome';

const CHUNK_OWNERS = 50;
const CHUNK_IDS = 50;
const CHUNK_STATS = 25;     // ~3 KB ad azienda: 25 per batch tengono la risposta sotto i 100 KB
const PAUSA_MS = 700;       // fra un blocco e l'altro: un giro lento, non un picco
const PER_PAGE = 100;       // aziende per proprietario: il tetto è ben sotto (skills.companies ≤ 12)

const MIN_RISPOSTE = 0.9;   // quota di proprietari che deve rispondere
const MIN_RISPETTO_PRIMA = 0.7;

// Fino a quanti giorni la route manda indietro, e quanti ne tiene la media.
const MAX_GIORNI = 365;
const GIORNI_MEDIA = 7;

let _inCorso = false;
let _mem = null;            // copia in memoria del file: lo si rilegge a ogni richiesta

function initCompanyCensus(tools) {
  deps = tools;
}

// ── Giorni ─────────────────────────────────────────────────────────────
// Due calendari, e non è distrazione: la fotografia si etichetta col
// giorno ITALIANO (come lo scatto della ricchezza e /daily-damage), i
// salari col `dailyDate` del gioco, che è UTC. I due non si mescolano mai.
const giornoDi = (ms = Date.now()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(ms));
const giornoUtc = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
function giornoMeno(giorno, n) {
  const d = new Date(`${giorno}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function _vuoto() {
  return {
    startedAt: null,       // primo giro riuscito: da qui in qua le fotografie sono nostre
    updatedAt: null,
    day: null,             // giorno italiano dell'ultima fotografia
    coverage: null,
    latest: null,          // { items: {code: [c, cw, w]}, countries: {cid: {code: [c, cw, w]}} }
    counts: {},            // giorno → {code: [c, cw, w]}, il mondo, una riga al giorno
    wages: {},             // giornoUtc → {code: {cid: [salari, tasse]}}
    measured: {},          // giornoUtc → giorno italiano in cui è stato misurato
    rates: {},             // cid → aliquota sul reddito all'ultimo giro (percentuale)
  };
}

function _read() {
  if (_mem) return _mem;
  _mem = { ..._vuoto(), ...deps.readCache(FILE, _vuoto()) };
  return _mem;
}

function _write(store) {
  _mem = store;
  deps.writeCache(FILE, store, { compact: true });
}

// ── I dati che servono e ci sono già ───────────────────────────────────
function _proprietari() {
  const c = deps.readCache(deps.citizensFile, null);
  const ids = new Set();
  for (const v of Object.values(c?.data || {})) for (const id of v.ids || []) ids.add(id);
  return [...ids];
}

function _regioni() {
  const r = deps.readCache('regions', null);
  return r?.data?.result?.data || r?.data || {};
}

function _aliquote() {
  const c = deps.readCache('countries', null);
  const list = c?.data?.result?.data || c?.data || [];
  const out = {};
  for (const n of list) {
    const v = Number(n?.taxes?.income);
    if (n?._id && Number.isFinite(v)) out[n._id] = v;
  }
  return out;
}

/** Un giro di batch a blocchi, con la pausa fra l'uno e l'altro. Ritorna
 *  i risultati nello stesso ordine degli input (null dove è fallita). */
async function _aBlocchi(proc, inputs, dimensione) {
  const out = [];
  for (let i = 0; i < inputs.length; i += dimensione) {
    const blocco = inputs.slice(i, i + dimensione);
    const res = await deps.trpcBatch(blocco.map((x) => [proc, x]), { useWorker: true });
    out.push(...res);
    if (i + dimensione < inputs.length) await sleep(PAUSA_MS);
  }
  return out;
}

// ── Il giro ────────────────────────────────────────────────────────────
async function runCompanyCensus({ motivo = 'programmato', forza = false } = {}) {
  if (!deps || _inCorso) return;
  const store = _read();
  const oggi = giornoDi();
  if (!forza && store.day === oggi) return;   // già fatto oggi

  const proprietari = _proprietari();
  if (!proprietari.length) { console.log('[company-census] nessun cittadino in censimento, salto'); return; }

  _inCorso = true;
  const t0 = Date.now();
  console.log(`[company-census] giro (${motivo}): ${proprietari.length} proprietari`);
  try {
    // 1. Le aziende di ogni cittadino attivo.
    const elenchi = await _aBlocchi('company.getCompanies',
      proprietari.map((userId) => ({ userId, perPage: PER_PAGE })), CHUNK_OWNERS);
    let risposte = 0;
    const idAziende = [];
    elenchi.forEach((r) => {
      if (!r?.items) return;
      risposte++;
      for (const id of r.items) idAziende.push(id);
    });
    if (risposte < proprietari.length * MIN_RISPOSTE) {
      console.warn(`[company-census] solo ${risposte}/${proprietari.length} proprietari hanno risposto: giro scartato`);
      return;
    }

    // 2. Il dettaglio: risorsa, regione, dipendenti.
    const dettagli = await _aBlocchi('company.getById',
      idAziende.map((companyId) => ({ companyId })), CHUNK_IDS);
    const aziende = dettagli.filter((c) => c?._id && c.itemCode);
    const prima = store.coverage?.companies || 0;
    if (prima && aziende.length < prima * MIN_RISPETTO_PRIMA) {
      console.warn(`[company-census] ${aziende.length} aziende contro ${prima} del giro prima: giro scartato`);
      return;
    }

    const regioni = _regioni();
    const aliquote = _aliquote();
    const nazioneDi = (regionId) => regioni[regionId]?.country || null;

    // 3. La fotografia: per risorsa e per nazione dove opera l'azienda.
    const items = {};
    const countries = {};
    let conDipendenti = 0, dipendenti = 0;
    const daInterrogare = [];
    for (const c of aziende) {
      const code = c.itemCode;
      const w = Number(c.workerCount) || 0;
      const cid = nazioneDi(c.region);
      const it = items[code] || (items[code] = [0, 0, 0]);
      it[0]++; if (w > 0) it[1]++; it[2] += w;
      if (cid) {
        const pc = countries[cid] || (countries[cid] = {});
        const r = pc[code] || (pc[code] = [0, 0, 0]);
        r[0]++; if (w > 0) r[1]++; r[2] += w;
      }
      if (w > 0) {
        conDipendenti++; dipendenti += w;
        daInterrogare.push({ id: c._id, code, cid });
      }
    }

    // 4. I salari pagati, giorno per giorno, delle sole aziende con dipendenti.
    const stats = await _aBlocchi('work.getStatsByCompany',
      daInterrogare.map((x) => ({ companyId: x.id })), CHUNK_STATS);
    const ieriUtc = giornoMeno(giornoUtc(), 1);
    const oggiUtc = giornoUtc();
    const perGiorno = {};        // giornoUtc → code → cid → salari
    let statsOk = 0;
    stats.forEach((righe, i) => {
      if (!Array.isArray(righe)) return;
      statsOk++;
      const { code, cid } = daInterrogare[i];
      if (!cid) return;
      for (const r of righe) {
        const g = r?.dailyDate;
        const wage = Number(r?.wage) || 0;
        // Oggi è una giornata a metà: entra domani, intera.
        if (!g || g >= oggiUtc || wage <= 0) continue;
        const pg = perGiorno[g] || (perGiorno[g] = {});
        const pc = pg[code] || (pg[code] = {});
        pc[cid] = (pc[cid] || 0) + wage;
      }
    });

    // Un giorno già misurato non si riscrive: il giro di oggi, per un
    // giorno di due settimane fa, ne sa MENO di quello di allora (vedi
    // "sopravvivenza" in testa). L'eccezione è ieri, che nessun giro
    // precedente ha potuto vedere intero.
    let giorniScritti = 0;
    for (const [g, perCode] of Object.entries(perGiorno)) {
      if (store.wages[g] && g !== ieriUtc) continue;
      const giorno = {};
      for (const [code, perCid] of Object.entries(perCode)) {
        const out = giorno[code] = {};
        for (const [cid, wage] of Object.entries(perCid)) {
          const rate = aliquote[cid] ?? 0;
          out[cid] = [Math.round(wage * 100) / 100, Math.round(wage * rate) / 100];
        }
      }
      store.wages[g] = giorno;
      store.measured[g] = oggi;
      giorniScritti++;
    }

    store.latest = { items, countries };
    store.counts[oggi] = items;
    store.rates = aliquote;
    store.coverage = {
      owners: proprietari.length,
      ownersOk: risposte,
      companies: aziende.length,
      withWorkers: conDipendenti,
      workers: dipendenti,
      statsAsked: daInterrogare.length,
      statsOk,
      seconds: Math.round((Date.now() - t0) / 1000),
    };
    store.day = oggi;
    store.updatedAt = Date.now();
    if (!store.startedAt) store.startedAt = store.updatedAt;
    _write(store);
    console.log(`[company-census] ${aziende.length} aziende (${conDipendenti} con dipendenti, ${dipendenti} dipendenti), `
      + `${statsOk}/${daInterrogare.length} statistiche, ${giorniScritti} giorni di salari scritti, ${store.coverage.seconds}s`);
  } catch (err) {
    console.error('[company-census] giro fallito:', err.message);
  } finally {
    _inCorso = false;
  }
}

/** Al riavvio: se non c'è mai stata una fotografia si parte subito,
 *  invece di far aspettare la notte a una sezione appena deployata. Dopo,
 *  ci pensa il cron delle 03:20. */
function companyCensusDovuto() {
  return !_read().latest;
}

// ── La lettura ─────────────────────────────────────────────────────────
/** Media giornaliera degli ultimi GIORNI_MEDIA giorni che ci sono davvero
 *  (non 7 fissi: un giorno mancante non deve dimezzare la media). */
function _medie(store, scegli) {
  const giorni = Object.keys(store.wages).sort().slice(-GIORNI_MEDIA);
  const somme = {};    // chiave → [salari, tasse]
  for (const g of giorni) {
    for (const [code, perCid] of Object.entries(store.wages[g])) {
      for (const [cid, v] of Object.entries(perCid)) {
        const k = scegli(code, cid);
        if (k == null) continue;
        const s = somme[k] || (somme[k] = [0, 0]);
        s[0] += v[0]; s[1] += v[1];
      }
    }
  }
  const n = giorni.length || 1;
  for (const s of Object.values(somme)) { s[0] = Math.round(s[0] / n * 100) / 100; s[1] = Math.round(s[1] / n * 100) / 100; }
  return { somme, giorni };
}

function _serie(store, dal, filtro) {
  const out = {};   // code → [[giorno, salari, tasse]]
  for (const g of Object.keys(store.wages).sort()) {
    if (g < dal) continue;
    for (const [code, perCid] of Object.entries(store.wages[g])) {
      let w = 0, t = 0;
      for (const [cid, v] of Object.entries(perCid)) {
        if (filtro && cid !== filtro) continue;
        w += v[0]; t += v[1];
      }
      if (!w) continue;
      (out[code] || (out[code] = [])).push([g, Math.round(w * 100) / 100, Math.round(t * 100) / 100]);
    }
  }
  return out;
}

/**
 * Quello che va al browser. Righe compatte, come /price-history.
 *
 *   items    code → [aziende, conDipendenti, dipendenti, salari/g, tasse/g]
 *   series   code → [[giornoUtc, salari, tasse]]          (mondo, o la nazione)
 *   counts   code → [[giorno, aziende, conDip, dipendenti]] (la storia delle fotografie)
 *
 * Con `item` aggiunge `countries`: [cid, aziende, conDip, dip, salari/g,
 * tasse/g, aliquota] per quella risorsa. Con `countryId` le righe di
 * `items` e `series` sono quelle della sola nazione.
 */
function readCompanyCensus({ item = null, countryId = null, days = 30 } = {}) {
  const store = _read();
  if (!store.latest) return { available: false };

  const dal = giornoMeno(giornoUtc(), Math.max(1, Math.min(Number(days) || 30, MAX_GIORNI)));
  const medie = _medie(store, countryId
    ? (code, cid) => (cid === countryId ? code : null)
    : (code) => code);

  const base = countryId ? (store.latest.countries[countryId] || {}) : store.latest.items;
  const items = {};
  const codici = new Set([...Object.keys(base), ...Object.keys(medie.somme)]);
  for (const code of codici) {
    const f = base[code] || [0, 0, 0];
    const m = medie.somme[code] || [0, 0];
    items[code] = [f[0], f[1], f[2], m[0], m[1]];
  }

  const counts = {};
  if (!countryId) {
    for (const g of Object.keys(store.counts).sort()) {
      if (g < dal) continue;
      for (const [code, v] of Object.entries(store.counts[g])) {
        (counts[code] || (counts[code] = [])).push([g, v[0], v[1], v[2]]);
      }
    }
  }

  const out = {
    available: true,
    updatedAt: store.updatedAt,
    day: store.day,
    startedAt: store.startedAt,
    coverage: store.coverage,
    // Da che giorno ci sono salari, e da che giorno sono misurati il
    // giorno dopo invece che ricostruiti a ritroso dal primo giro.
    wagesFrom: Object.keys(store.wages).sort()[0] || null,
    measuredFrom: Object.entries(store.measured)
      // Il giro delle 03:20 italiane del giorno dopo è il primo che vede
      // un giorno (UTC) intero: misurato entro allora = misurato davvero.
      .filter(([g, m]) => m <= giornoMeno(g, -1))
      .map(([g]) => g).sort()[0] || null,
    averageDays: medie.giorni.length,
    countryId,
    items,
    series: _serie(store, dal, countryId),
    counts,
  };

  if (item) {
    const medieNaz = _medie(store, (code, cid) => (code === item ? cid : null));
    const righe = new Map();
    for (const [cid, perCode] of Object.entries(store.latest.countries)) {
      const f = perCode[item];
      if (f) righe.set(cid, [cid, f[0], f[1], f[2], 0, 0, store.rates[cid] ?? null]);
    }
    for (const [cid, m] of Object.entries(medieNaz.somme)) {
      const r = righe.get(cid) || [cid, 0, 0, 0, 0, 0, store.rates[cid] ?? null];
      r[4] = m[0]; r[5] = m[1];
      righe.set(cid, r);
    }
    out.item = item;
    out.countries = [...righe.values()].sort((a, b) => b[5] - a[5] || b[3] - a[3] || b[1] - a[1]);
  }
  return out;
}

/** Per /health. */
function statoCompanyCensus() {
  const store = _read();
  const giorni = Object.keys(store.wages).sort();
  return {
    inCorso: _inCorso,
    ultimoGiro: store.updatedAt ? new Date(store.updatedAt).toISOString() : null,
    giorno: store.day,
    copertura: store.coverage,
    salariDal: giorni[0] || null,
    salariAl: giorni[giorni.length - 1] || null,
    fotografie: Object.keys(store.counts).length,
  };
}

module.exports = {
  initCompanyCensus,
  runCompanyCensus,
  companyCensusDovuto,
  readCompanyCensus,
  statoCompanyCensus,
};
