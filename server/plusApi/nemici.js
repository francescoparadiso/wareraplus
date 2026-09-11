/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — i nemici: pillole, danno, danno per colpo
   ----------------------------------------------------------------------
   Per ogni nazione con cui siamo in guerra (`warsWith`) più il nemico
   giurato (`enemy`), tre domande che il gioco non fa — su TUTTI i suoi
   giocatori, non su un campione:

     1. PILLOLE   Chi è sotto pillola adesso, chi nel dopo-sbornia, e
                  QUANDO cambia. La pillola (`cocain`) dà +60% d'attacco
                  per 8 ore e poi −60% per 15,5: un nemico appena pillato
                  è il peggior momento per attaccarlo, uno in malus il
                  migliore. L'ora del cambio è scritta nei suoi `buffs`.
     2. DANNO     Quanto hanno fatto davvero: settimana, ultime 24 ore, la
                  loro ora migliore e il loro giorno migliore degli ultimi
                  14 — dall'archivio /damage-timeline, che accumula.
     3. COLPO     Quanto fa ciascuno a ogni colpo, adesso e con la pillola.

   ── TUTTI, DAL VIVO ───────────────────────────────────────────────────
   ⚠️ La versione di prima prendeva i giocatori dal censimento del
   cache-server, che ne rilegge ognuno ogni 2-3 ore: le pillole prese
   nel frattempo non c'erano. Misurato l'11/09 sulla Germania, tutti i
   1.123 cittadini letti uno per uno: 206 sotto pillola (lo stesso numero
   di warerastats), di cui 70 presa nelle ultime due ore — un terzo, cioè
   esattamente la parte che conta, sparito.

   Quindi ora si leggono TUTTI con `user.getUserLite`, a blocchi di 30 (a
   100 l'URL supera il limite), attraverso il proxy /trpc del cache-server
   sulla loopback: ha la chiave API, e così queste letture non pesano sul
   limite per IP delle chiamate pubbliche che il cache-server fa per tutti.
   Una FILA sola per tutti i nemici: una richiesta alla volta, PASSO_MS fra
   l'una e l'altra. La Germania sono 38 richieste, ~25 secondi.

   Per non far aspettare 25 secondi a ogni apertura: la scheda si tiene
   dieci minuti e, finché qualcuno ha guardato quel nemico nell'ultima ora,
   si rilegge da sola in sottofondo. Chi apre la pagina riceve subito
   l'ultima lettura (con l'ora in cui è stata fatta), non una rotella.
   Il censimento resta la lista di CHI leggere, e il ripiego per chi dal
   vivo non risponde.

   ── IL COLPO, E COSA NON È ────────────────────────────────────────────
   Danno atteso per colpo, dal codex (ENGINE, verificato sui profili):

       attacco × (0,5 + 0,5·precisione + precisione·critico·danno critico)

   con l'attacco come lo dà il gioco (grado, munizioni e pillola dentro),
   ma la pillola rimessa com'è ADESSO. La somma su tutti i giocatori
   attivi è "un colpo a testa": la forza della nazione in questo momento,
   confrontabile fra nemici e fra un'ora e l'altra.

   ⚠️ Un "quanto possono fare in una giornata" NON c'è, e non per
   dimenticanza: dipende dal cibo che hanno in inventario, che il gioco
   non mostra a nessuno (né getUserById né inventory.fetchCurrentEquipment
   lo portano, e inventory.getInventory rifiuta le chiavi API — misurato il
   2026-09-11). Due tentativi scartati:
     · dalla sola rigenerazione della vita: dieci volte sotto il danno
       osservato (e `currentBarValue` non si muove fra due letture a 90 s);
     · vita + barra della fame col pasto migliore: "2,3 milioni in canna"
       per una nazione che nelle 24 ore ne aveva fatti 471. Vero e inutile.
   Il ritmo lo dice il danno OSSERVATO (24 ore, ora migliore), che sta
   accanto. Restano fuori armatura e schivata di chi riceve e i bonus di
   battaglia (ordini, alleanza, patriottico, basi).
   ══════════════════════════════════════════════════════════════════════ */

const { API } = require('./wareraApi');
const { CACHE_BASE, paesiMappa, timeline, configGioco, dalCache } = require('./fonti');
const { relazione } = require('./confini');

const CHUNK_UTENTI = 30;
const PASSO_MS = 250;              // fra una richiesta e l'altra, per tutta la fila
const ATTIVO_MS = 72 * 3600_000;
const TTL_MS = 10 * 60_000;        // quanto vale una lettura
const INTERESSE_MS = 60 * 60_000;  // per quanto si rilegge da sola dopo l'ultima occhiata
const PILLOLA = 'cocain';
const PILL_PCT_DEFAULT = 60;
const ORA_MS = 3600_000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const frazione = (v) => Math.min(Math.max((num(v) ?? 0) / 100, 0), 1);
const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

async function parametri() {
  try {
    const g = await configGioco();
    const fs = g?.items?.[PILLOLA]?.flatStats || {};
    return {
      pillPct: Number(fs.percentAttack) || PILL_PCT_DEFAULT,
      buffH: Number(fs.buffDurationHours) || 8,
      debuffH: Number(fs.debuffDurationHours) || 15.5,
    };
  } catch {
    return { pillPct: PILL_PCT_DEFAULT, buffH: 8, debuffH: 15.5 };
  }
}

// ---------------------------------------------------------------------------
// La fila delle letture
// ---------------------------------------------------------------------------

let _fila = Promise.resolve();

/** Esegue `fn` quando tocca a lei: una richiesta alla volta per TUTTI i
 *  nemici insieme, con PASSO_MS di respiro dopo ciascuna. */
function inFila(fn) {
  const esito = _fila.then(fn);
  _fila = esito.catch(() => {}).then(() => pausa(PASSO_MS));
  return esito;
}

async function batchUtenti(base, ids) {
  const input = Object.fromEntries(ids.map((userId, k) => [k, { userId }]));
  const url = `${base}/${ids.map(() => 'user.getUserLite').join(',')}?batch=1&input=${encodeURIComponent(JSON.stringify(input))}`;
  const res = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return (Array.isArray(body) ? body : [body]).map((x) => x?.result?.data ?? null);
}

/** Un blocco di giocatori: dal proxy con la chiave, e se il proxy non
 *  risponde da api6 pubblico — il cache-server è un'ottimizzazione, mai un
 *  punto di rottura. */
async function leggiBlocco(ids) {
  try { return await batchUtenti(`${CACHE_BASE}/trpc`, ids); }
  catch (err) {
    console.warn('[nemici] proxy non disponibile, provo api6:', err.message);
    return batchUtenti(API, ids);
  }
}

// ---------------------------------------------------------------------------
// Un giocatore
// ---------------------------------------------------------------------------

/** Il moltiplicatore del colpo per precisione e critici. Il danno critico
 *  NON si tronca a 1: 255 vuol dire +255%. */
function fattoreColpo(precisione, critico, dannoCritico) {
  const p = frazione(precisione);
  const c = frazione(critico);
  const d = Math.max((num(dannoCritico) ?? 0) / 100, 0);
  return 0.5 + 0.5 * p + p * c * d;
}

/**
 * Lo stato della pillola ADESSO, dai timestamp di fine.
 * Un buff letto e poi scaduto è un malus adesso: il malus comincia quando
 * il buff finisce, e dura `debuffH`.
 */
function statoPillola(buffEnd, debuffEnd, cfg, ora) {
  if (buffEnd && ora < buffEnd) return { pillola: 'buff', fine: buffEnd };
  const malusDaBuff = buffEnd ? buffEnd + cfg.debuffH * ORA_MS : null;
  if (malusDaBuff && ora < malusDaBuff) return { pillola: 'malus', fine: malusDaBuff };
  if (debuffEnd && ora < debuffEnd) return { pillola: 'malus', fine: debuffEnd };
  return { pillola: 'pulito', fine: null };
}

function colpi(attaccoPulito, fattore, pillola, cfg) {
  const su = 1 + cfg.pillPct / 100;
  const giu = 1 - cfg.pillPct / 100;
  const adesso = attaccoPulito * (pillola === 'buff' ? su : pillola === 'malus' ? giu : 1) * fattore;
  // Con la pillola: chi è pulito la prende; chi è in malus resta in malus
  // (non può prenderne un'altra che conti), chi è in buff ce l'ha già.
  const massimo = pillola === 'pulito' ? attaccoPulito * su * fattore : adesso;
  return { perColpo: Math.round(adesso), perColpoMax: Math.round(massimo) };
}

/** Un giocatore letto in diretta con getUserLite. */
function daLive(u, cfg, ora) {
  const s = u.skills || {};
  const a = s.attack || {};
  const mult = a.buffsPercent ? 1 + a.buffsPercent / 100 : a.debuffsPercent ? 1 - a.debuffsPercent / 100 : 1;
  const attaccoPulito = (num(a.total) ?? 0) / (mult > 0 ? mult : 1);
  const b = u.buffs || {};
  const fine = (codici, quando) => ((codici || []).includes(PILLOLA) ? (Date.parse(quando || '') || null) : null);
  const p = statoPillola(fine(b.buffCodes, b.buffEndAt), fine(b.debuffCodes, b.debuffEndAt), cfg, ora);
  return {
    id: u._id,
    nome: u.username || null,
    avatar: u.avatarUrl || null,
    livello: u.leveling?.level ?? null,
    settimana: num(u.rankings?.weeklyUserDamages?.value),
    visto: Date.parse(u.dates?.lastConnectionAt || '') || null,
    ...p,
    ...colpi(attaccoPulito, fattoreColpo(s.precision?.total, s.criticalChance?.total, s.criticalDamages?.total), p.pillola, cfg),
    fonte: 'live',
  };
}

/** Ripiego: il giocatore dal censimento del cache-server, se dal vivo non
 *  ha risposto. Senza i campi di combattimento resta 'ignoto': meglio un
 *  buco dichiarato che un "pulito" inventato. */
function daCensimento(c, cfg, ora) {
  const base = {
    id: c.id, nome: c.u || null, avatar: c.a || null, livello: c.lv ?? null,
    settimana: c.wk ?? null, visto: c.seen || null, letto: c.ts || null, fonte: 'censimento',
  };
  if (c.aC == null) return { ...base, pillola: 'ignoto', fine: null, perColpo: null, perColpoMax: null };
  const p = statoPillola(c.bE, c.dE, cfg, ora);
  return { ...base, ...p, ...colpi(c.aC, fattoreColpo(c.pc, c.cc, c.cd), p.pillola, cfg) };
}

/** Il danno osservato, dall'archivio che accumula. Un'ora non misurata è
 *  `d: null` e NON conta come zero: vedi damageTimeline.js. */
function dannoOsservato(tl) {
  const serie = tl?.series || [];
  const ora = Date.now();
  let ultime24 = 0; let misurate24 = 0;
  let picco = null;
  for (const p of serie) {
    if (p.d == null) continue;
    if (p.to > ora - 24 * ORA_MS) { ultime24 += p.d; misurate24 += (p.min || 60); }
    const allOra = p.d * (60 / (p.min || 60));
    if (!picco || allOra > picco.allOra) picco = { allOra, t: p.t, to: p.to, d: p.d, min: p.min || 60 };
  }
  const giorni = (tl?.daily || []).filter((g) => g.d != null && !g.partial);
  const giornoMax = giorni.reduce((m, g) => (!m || g.d > m.d ? g : m), null);
  return {
    ultime24h: misurate24 ? ultime24 : null,
    oreMisurate24h: Math.round(misurate24 / 6) / 10,
    piccoOra: picco,
    giornoMax: giornoMax ? { giorno: giornoMax.day, d: giornoMax.d } : null,
    coverageFrom: tl?.coverageFrom ?? null,
  };
}

// ---------------------------------------------------------------------------
// La scheda di un nemico
// ---------------------------------------------------------------------------

async function costruisciScheda(countryId) {
  const [cfg, tl, cit] = await Promise.all([
    parametri(),
    timeline(`${countryId}|336`).catch(() => null),
    dalCache(`/country-citizens?countryId=${encodeURIComponent(countryId)}&limit=5000&fields=combat`).catch(() => null),
  ]);
  // Il censimento dice CHI leggere (e ce l'ha già ordinato per danno):
  // WarEra dà i cittadini di una nazione solo a pagine di id, e rifarlo
  // qui sarebbe una seconda copia dello stesso lavoro.
  const censimento = cit?.data || [];
  const ids = censimento.map((c) => c.id);

  const live = new Map();
  for (let i = 0; i < ids.length; i += CHUNK_UTENTI) {
    const pezzo = ids.slice(i, i + CHUNK_UTENTI);
    try {
      const lista = await inFila(() => leggiBlocco(pezzo));
      const ora = Date.now();
      // `cfg` è la stessa per tutti; `ora` è quella della lettura del
      // blocco, così lo stato della pillola è quello di quel momento.
      for (const u of lista) if (u?._id) live.set(u._id, daLive(u, cfg, ora));
    } catch (err) {
      console.warn(`[nemici] blocco di ${pezzo.length} giocatori non letto:`, err.message);
    }
  }

  const ora = Date.now();
  const giocatori = censimento.map((c) => {
    const g = live.get(c.id) || daCensimento(c, cfg, ora);
    const visto = g.visto ?? c.seen ?? null;
    return { ...g, visto, attivo: Boolean(visto && ora - visto < ATTIVO_MS) };
  });
  giocatori.sort((a, b) => (b.perColpo ?? -1) - (a.perColpo ?? -1));

  const inGioco = giocatori.filter((g) => g.attivo);
  const conta = (s) => inGioco.filter((g) => g.pillola === s).length;
  const fini = (s) => inGioco.filter((g) => g.pillola === s && g.fine).map((g) => g.fine).sort((a, b) => a - b).slice(0, 20);
  const somma = (k) => inGioco.reduce((t, g) => t + (g[k] || 0), 0);

  return {
    sommario: {
      letto: ora,
      censiti: cit?.total ?? censimento.length,
      attivi72h: inGioco.length,
      live: live.size,
      pillole: {
        buff: conta('buff'), malus: conta('malus'), pulito: conta('pulito'), ignoto: conta('ignoto'),
        // Le scadenze: è il "quando" che serve a decidere, più del quanti.
        fineBuff: fini('buff'), fineMalus: fini('malus'),
        durataBuffOre: cfg.buffH,
      },
      // Un colpo a testa, tutti gli attivi: adesso e con la pillola.
      salva: { adesso: Math.round(somma('perColpo')), massimo: Math.round(somma('perColpoMax')) },
      osservato: dannoOsservato(tl),
    },
    giocatori,
  };
}

// Le schede lette, e quando qualcuno le ha chieste l'ultima volta.
const _schede = new Map();     // countryId → { at, val, p }
const _interesse = new Map();  // countryId → ultima richiesta

function avvia(countryId) {
  const prima = _schede.get(countryId) || {};
  const p = costruisciScheda(countryId)
    .then((val) => { _schede.set(countryId, { at: Date.now(), val }); return val; })
    .catch((err) => {
      _schede.set(countryId, { at: prima.at, val: prima.val });
      if (prima.val) return prima.val;
      throw err;
    });
  _schede.set(countryId, { ...prima, p });
  return p;
}

/**
 * La scheda per chi la chiede. Fresca: subito. In lettura: si aspetta
 * quella. Vecchia: si dà la vecchia SUBITO e la si rilegge in sottofondo
 * — chi apre la pagina non deve aspettare 25 secondi per una lettura di
 * dieci minuti fa, basta che l'ora della lettura sia scritta accanto.
 */
function leggiScheda(countryId) {
  _interesse.set(countryId, Date.now());
  const e = _schede.get(countryId);
  if (e?.val && Date.now() - e.at < TTL_MS) return Promise.resolve(e.val);
  if (e?.p) return e.val ? Promise.resolve(e.val) : e.p;
  if (e?.val) { avvia(countryId).catch(() => {}); return Promise.resolve(e.val); }
  return avvia(countryId);
}

// Finché qualcuno ha guardato un nemico nell'ultima ora, la sua scheda si
// rilegge da sola poco prima di scadere. Dopo, si smette: nessuno legge
// mille giocatori per una pagina che non guarda nessuno.
setInterval(() => {
  const ora = Date.now();
  for (const [id, t] of _interesse) {
    if (ora - t > INTERESSE_MS) { _interesse.delete(id); continue; }
    const e = _schede.get(id);
    if (!e?.p && (!e?.val || ora - e.at >= TTL_MS - 60_000)) avvia(id).catch(() => {});
  }
}, 60_000).unref();

function idNemici(noi) {
  return [...new Set([...(noi?.warsWith || []), noi?.enemy].filter(Boolean))];
}

/**
 * I nemici di una nazione con i loro riepiloghi. Le nazioni si decidono qui,
 * sui dati di adesso: una pace firmata stamattina toglie una scheda.
 */
async function quadroNemici(countryId) {
  const paesi = await paesiMappa();
  const noi = paesi.get(countryId);
  if (!noi) return { nemici: [] };

  // ── Noi, letti come loro ──────────────────────────────────────────
  // La forza di un nemico si legge solo accanto alla propria: "80 sotto
  // pillola" non vuol dire niente finché non si sa quanti sono i nostri.
  // Stessa lettura, stessa fila, stessa memoria — Italia 439 cittadini,
  // 15 richieste ogni dieci minuti mentre qualcuno guarda.
  let nostri = null;
  try {
    const s = await leggiScheda(countryId);
    nostri = { ...s.sommario, top: s.giocatori.filter((g) => g.attivo).slice(0, 10) };
  } catch (err) {
    console.warn('[nemici] lettura dei nostri fallita:', err.message);
  }

  const nemici = await Promise.all(idNemici(noi).map(async (id) => {
    const loro = paesi.get(id);
    let scheda = null; let errore = null;
    try { scheda = (await leggiScheda(id)).sommario; } catch (err) { errore = err.message; }
    return {
      id,
      relazione: relazione(noi, id),
      // Anche il nemico giurato può essere in guerra con noi: si dice
      // tutte e due le cose, perché cambiano i bonus in battaglia.
      giurato: noi.enemy === id,
      inGuerra: (noi.warsWith || []).includes(id),
      danno: {
        settimana: loro?.rankings?.weeklyCountryDamages?.value ?? null,
        settimanaRank: loro?.rankings?.weeklyCountryDamages?.rank ?? null,
        perCittadino: loro?.rankings?.weeklyCountryDamagesPerCitizen?.value ?? null,
      },
      ...(scheda || {}),
      errore,
    };
  }));

  // Prima chi picchia di più: è quello che arriva per primo alla porta.
  nemici.sort((a, b) => (b.danno.settimana || 0) - (a.danno.settimana || 0));
  return {
    noi: nostri && {
      id: countryId,
      danno: { settimana: noi.rankings?.weeklyCountryDamages?.value ?? null, settimanaRank: noi.rankings?.weeklyCountryDamages?.rank ?? null },
      ...nostri,
    },
    nemici,
  };
}

/** L'elenco completo dei giocatori di UN nemico, per la tabella. A parte
 *  dal riepilogo perché pesa (la Germania ha 1.123 cittadini) e lo apre
 *  solo chi lo chiede. */
async function giocatoriNemico(countryId) {
  const s = await leggiScheda(countryId);
  return { letto: s.sommario.letto, censiti: s.sommario.censiti, attivi72h: s.sommario.attivi72h, giocatori: s.giocatori };
}

module.exports = { quadroNemici, giocatoriNemico, idNemici, statoPillola, colpi, fattoreColpo, dannoOsservato };
