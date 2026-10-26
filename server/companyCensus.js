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

   ⚠️ DALLA v0.27 (2026-10-26) quel filtro non esiste più: i dipendenti
   sono NPC, `company.getById` ha perso `workerCount` e `employee.*` con
   la chiave risponde 403. Le statistiche si chiedono per TUTTE le
   aziende (~114.000 al giro del 2026-10-26: ~4.600 blocchi da 25 invece
   di ~500, circa un'ora in più, sempre di notte), elaborate blocco per
   blocco senza tenerle in memoria. Il tetto della chiave (500 al minuto)
   conta le richieste HTTP, non le procedure dentro un batch: quel giro
   ne faceva ~77 al minuto, e il ritmo resta quello.
   "Con dipendenti" diventa "i cui dipendenti hanno prodotto ieri"
   (`employeeProd > 0`), il numero dei dipendenti diventa null e la
   copertura lo dice (`workersKnown: false`). Lo scambio fra le due forme
   lo decide il dato, non la data.

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

   ⚠️ E LA RICOSTRUZIONE SI FERMA A 7 GIORNI (misurato al primo giro, il
   2026-10-08). Sui giorni che si sovrappongono all'archivio chiuso "Lavoro
   e tasse" il censimento ricostruito vedeva il 29% dei salari veri (8
   settembre: 422.000 contro 1.437.000), e non per un errore: i pagamenti
   di salario sono scesi da ~530.000 al giorno a ~200.000, quindi gran
   parte delle aziende che pagavano a settembre oggi non ha dipendenti e
   non viene interrogata. Un mese di ricostruzione disegnava un +70% di
   gettito in trenta giorni che in buona parte non c'era. I giorni recenti
   invece tornano (7 ottobre: 711.000 contro ~800.000 stimati dal flusso
   delle transazioni). Quindi: si ricostruisce al massimo BACKFILL_GIORNI
   indietro (vale sia per il primo giro sia per una notte saltata), e il
   resto della curva si accumula un giorno alla volta.

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

   ── LE AZIENDE ALL'ESTERO (2026-10-26) ────────────────────────────────
   Richiesta dell'area riservata: quali cittadini di una nazione hanno
   aziende in regioni di un'ALTRA nazione (tasse sui salari e produzione
   vanno a chi ospita). Il giro le ha già in mano tutte — proprietario,
   azienda, regione — quindi le si mette da parte nello stesso passaggio,
   in un file a sé (`company-abroad`): zero richieste in più. "Estero" =
   la regione non è della nazione di cui il proprietario è cittadino
   secondo il censimento dei cittadini. È una fotografia della notte:
   un'azienda spostata oggi si vede domani. plusApi ricalcola la nazione
   ospite sulle regioni di adesso, quindi una nostra regione persa in
   giornata cambia bandiera subito; una conquistata in giornata, invece,
   aspetta il giro dopo.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const FILE = 'company-census';
const FILE_ESTERO = 'company-abroad';
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
// Quanto indietro si può RICOSTRUIRE un giorno mai misurato (vedi "la
// ricostruzione si ferma a 7 giorni" in testa).
const BACKFILL_GIORNI = 7;

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
  // Pulizia dei giorni ricostruiti troppo indietro, scritti prima che la
  // regola esistesse (il primo giro del 2026-10-08 ne aveva scritti 30).
  // In memoria subito; su disco al prossimo giro.
  for (const g of Object.keys(_mem.wages)) {
    const m = _mem.measured[g];
    if (m && g < giornoMeno(m, BACKFILL_GIORNI)) { delete _mem.wages[g]; delete _mem.measured[g]; }
  }
  return _mem;
}

function _write(store) {
  _mem = store;
  deps.writeCache(FILE, store, { compact: true });
}

// ── I dati che servono e ci sono già ───────────────────────────────────
/** id → nazione di cui è cittadino, dal censimento dei cittadini. */
function _cittadinanze() {
  const c = deps.readCache(deps.citizensFile, null);
  const out = new Map();
  for (const [cid, v] of Object.entries(c?.data || {})) for (const id of v.ids || []) out.set(id, cid);
  return out;
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
  await _perBlocchi(proc, inputs, dimensione, (res) => { out.push(...res); });
  return out;
}

/** Come _aBlocchi, ma consegna ogni blocco a `suBlocco(risultati, inizio)`
 *  e non tiene niente: con la v0.27 le statistiche si chiedono per TUTTE
 *  le aziende (~52.000 × 31 giorni), che tutte insieme in memoria
 *  starebbero strette nei 954 MB del VPS. */
async function _perBlocchi(proc, inputs, dimensione, suBlocco) {
  for (let i = 0; i < inputs.length; i += dimensione) {
    const blocco = inputs.slice(i, i + dimensione);
    const res = await deps.trpcBatch(blocco.map((x) => [proc, x]), { useWorker: true });
    suBlocco(res, i);
    if (i + dimensione < inputs.length) await sleep(PAUSA_MS);
  }
}

// ── Il giro ────────────────────────────────────────────────────────────
async function runCompanyCensus({ motivo = 'programmato', forza = false } = {}) {
  if (!deps || _inCorso) return;
  const store = _read();
  const oggi = giornoDi();
  if (!forza && store.day === oggi) return;   // già fatto oggi

  const cittadinanza = _cittadinanze();
  const proprietari = [...cittadinanza.keys()];
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
    const proprietarioDi = new Map();   // azienda → proprietario (per le aziende all'estero)
    elenchi.forEach((r, i) => {
      if (!r?.items) return;
      risposte++;
      for (const id of r.items) {
        idAziende.push(id);
        proprietarioDi.set(id, proprietari[i]);
      }
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

    // WarEra+ v0.27 — `company.getById` non porta più `workerCount`: i
    // dipendenti sono NPC che con la chiave non si vedono (employee.* →
    // 403). Quanti sono non lo dice più nessuno; si sa invece, dalle
    // statistiche, se IERI i dipendenti di un'azienda hanno prodotto. Quindi
    // senza `workerCount` le statistiche si chiedono per tutte le aziende
    // (con la v0.27 le hanno quasi tutti: il filtro risparmierebbe poco),
    // "con dipendenti" vuol dire "con produzione dei dipendenti ieri" e il
    // numero dei dipendenti resta null. Riconosciuto dal dato, non dalla
    // data: lo stesso codice gira prima e dopo il rilascio.
    const conteggioNoto = aziende.some((c) => c.workerCount !== undefined);

    // 3. Chi interrogare: con il conteggio, le sole aziende con dipendenti
    //    (senza dipendenti non c'è salario, quindi non c'è tassa).
    const daInterrogare = [];
    for (const c of aziende) {
      const w = Number(c.workerCount) || 0;
      if (!conteggioNoto || w > 0) daInterrogare.push({ id: c._id, code: c.itemCode, cid: nazioneDi(c.region) });
    }

    // 4. I salari pagati, giorno per giorno, blocco per blocco.
    const ieriUtc = giornoMeno(giornoUtc(), 1);
    const oggiUtc = giornoUtc();
    const perGiorno = {};        // giornoUtc → code → cid → salari
    const prodottoIeri = new Set();   // id delle aziende i cui dipendenti hanno prodotto ieri
    let statsOk = 0;
    await _perBlocchi('work.getStatsByCompany',
      daInterrogare.map((x) => ({ companyId: x.id })), CHUNK_STATS, (res, inizio) => {
        res.forEach((righe, j) => {
          if (!Array.isArray(righe)) return;
          statsOk++;
          const { id, code, cid } = daInterrogare[inizio + j];
          for (const r of righe) {
            const g = r?.dailyDate;
            if (g === ieriUtc && Number(r?.employeeProd) > 0) prodottoIeri.add(id);
            const wage = Number(r?.wage) || 0;
            // Oggi è una giornata a metà: entra domani, intera.
            if (!cid || !g || g >= oggiUtc || wage <= 0) continue;
            const pg = perGiorno[g] || (perGiorno[g] = {});
            const pc = pg[code] || (pg[code] = {});
            pc[cid] = (pc[cid] || 0) + wage;
          }
        });
      });

    // 5. La fotografia: per risorsa e per nazione dove opera l'azienda.
    //    [aziende, conDipendenti, dipendenti] — il terzo null senza conteggio.
    const items = {};
    const countries = {};
    let conDipendenti = 0, dipendenti = conteggioNoto ? 0 : null;
    const conta = (riga, conDip, w) => {
      riga[0]++;
      if (conDip) riga[1]++;
      riga[2] = conteggioNoto ? riga[2] + w : null;
    };
    for (const c of aziende) {
      const code = c.itemCode;
      const w = Number(c.workerCount) || 0;
      const conDip = conteggioNoto ? w > 0 : prodottoIeri.has(c._id);
      const cid = nazioneDi(c.region);
      conta(items[code] || (items[code] = [0, 0, 0]), conDip, w);
      if (cid) {
        const pc = countries[cid] || (countries[cid] = {});
        conta(pc[code] || (pc[code] = [0, 0, 0]), conDip, w);
      }
      if (conDip) {
        conDipendenti++;
        if (conteggioNoto) dipendenti += w;
      }
    }

    // Un giorno già misurato non si riscrive: il giro di oggi, per un
    // giorno di due settimane fa, ne sa MENO di quello di allora (vedi
    // "sopravvivenza" in testa). L'eccezione è ieri, che nessun giro
    // precedente ha potuto vedere intero.
    // E un giorno MAI misurato si ricostruisce solo se è abbastanza
    // recente: più indietro mancano troppe aziende per chiamarlo un dato.
    const limiteRicostruzione = giornoMeno(oggiUtc, BACKFILL_GIORNI);
    let giorniScritti = 0;
    for (const [g, perCode] of Object.entries(perGiorno)) {
      if (store.wages[g] && g !== ieriUtc) continue;
      if (!store.wages[g] && g < limiteRicostruzione) continue;
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

    // 6. Le aziende all'estero, per nazione del proprietario (vedi testata).
    //    [userId, companyId, itemCode, regionId, nazioneOspite, valore,
    //     disabilitata 0/1, con dipendenti 0/1]
    const estero = {};
    for (const c of aziende) {
      const uid = proprietarioDi.get(c._id);
      const suo = uid && cittadinanza.get(uid);
      const ospite = nazioneDi(c.region);
      if (!suo || !c.region || ospite === suo) continue;
      const conDip = conteggioNoto ? (Number(c.workerCount) || 0) > 0 : prodottoIeri.has(c._id);
      (estero[suo] || (estero[suo] = [])).push([uid, c._id, c.itemCode, c.region, ospite || null,
        Math.round(Number(c.estimatedValue) || 0), c.disabledAt ? 1 : 0, conDip ? 1 : 0]);
    }
    const proprietariPer = {};
    for (const cid of cittadinanza.values()) proprietariPer[cid] = (proprietariPer[cid] || 0) + 1;
    deps.writeCache(FILE_ESTERO, { day: oggi, updatedAt: Date.now(), owners: proprietariPer, byCountry: estero }, { compact: true });

    store.latest = { items, countries };
    store.counts[oggi] = items;
    store.rates = aliquote;
    store.coverage = {
      owners: proprietari.length,
      ownersOk: risposte,
      companies: aziende.length,
      withWorkers: conDipendenti,
      workers: dipendenti,
      // false dalla v0.27: "con dipendenti" = dipendenti che hanno prodotto
      // ieri, e il numero dei dipendenti non si conosce (vedi sopra).
      workersKnown: conteggioNoto,
      statsAsked: daInterrogare.length,
      statsOk,
      seconds: Math.round((Date.now() - t0) / 1000),
    };
    store.day = oggi;
    store.updatedAt = Date.now();
    if (!store.startedAt) store.startedAt = store.updatedAt;
    _write(store);
    console.log(`[company-census] ${aziende.length} aziende (${conDipendenti} con dipendenti, ${dipendenti ?? '?'} dipendenti), `
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

/** Le aziende dei cittadini di `countryId` in regioni di altre nazioni.
 *  Righe compatte, vedi il passo 6 del giro. */
function readCompanyAbroad(countryId) {
  const f = deps.readCache(FILE_ESTERO, null);
  if (!f?.byCountry) return { available: false };
  return {
    available: true,
    day: f.day,
    updatedAt: f.updatedAt,
    countryId,
    owners: f.owners?.[countryId] ?? 0,   // cittadini attivi guardati
    rows: f.byCountry[countryId] || [],
  };
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
  readCompanyAbroad,
  statoCompanyCensus,
};
