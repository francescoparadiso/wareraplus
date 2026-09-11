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
  battaglieVive, baseDannoGiornaliero, bonifici, timeline,
  cittadiniTutti, conteggiCittadini, eventiTicker, archivioBattaglie, speseGuerra, direttorioMu, elezioniDi,
} = require('./fonti');
const { quadroConfini, relazione } = require('./confini');
const { quadroNemici, giocatoriNemico, idNemici } = require('./nemici');
const { estrai, riferimento } = require('./istantanee');

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
    // ⚠️ Il tesoro è `rankings.countryWealth`, NON `money`. `money` è un
    // campo FERMO: 398,2651000000014 identico al decimale per più di un
    // giorno, mentre il tesoro incassa la tassa sul reddito ogni ora.
    // Verificato l'11/09 alle 15:03 UTC: countryWealth 5.213,18 = la voce
    // "Inventario 5.213K" della pagina Account del governo in gioco. Il
    // gioco lo ricalcola una volta all'ora (verso le hh:01), come tutte le
    // classifiche. Il resto del tool leggeva già così (countryPanel,
    // blocStats, metrics): era solo questa scheda a sbagliare.
    tesoro: r.countryWealth?.value ?? null,
    tasse: n.taxes || null,
    popolazione: n.currentPopulation ?? null,
    popolazioneAttiva: rk(r.countryActivePopulation),
    sviluppo: rk(r.countryDevelopment),
    dannoSettimana: rk(r.weeklyCountryDamages),
    dannoPerCittadino: rk(r.weeklyCountryDamagesPerCitizen),
    dannoTotale: rk(r.countryDamages),
    tesoroRank: rk(r.countryWealth),
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
  // Due settimane per nazione: con chi scambiamo soldi, non solo le ultime
  // righe. L'archivio copre dal 30/08 (coverageFrom): prima non si sa.
  const da14 = Date.now() - 14 * 24 * 3600_000;
  const perPaese = new Map();
  for (const x of body?.data || []) {
    if (!(x.a >= da14) || (x.f !== countryId && x.t !== countryId)) continue;
    const altro = x.f === countryId ? x.t : x.f;
    const p = perPaese.get(altro) || { paese: altro, entrati: 0, usciti: 0 };
    if (x.t === countryId) p.entrati += x.m || 0; else p.usciti += x.m || 0;
    perPaese.set(altro, p);
  }
  const partner = [...perPaese.values()].sort((a, b) => (b.entrati + b.usciti) - (a.entrati + a.usciti));
  return {
    finestraOre: FINESTRA_BONIFICI_MS / 3600_000,
    coverageFrom: body?.coverageFrom ?? null,
    entrati: entrati.sort((a, b) => b.at - a.at),
    usciti: usciti.sort((a, b) => b.at - a.at),
    totaleEntrati: tot(entrati),
    totaleUsciti: tot(usciti),
    quattordici: {
      entrati: partner.reduce((t, p) => t + p.entrati, 0),
      usciti: partner.reduce((t, p) => t + p.usciti, 0),
      partner: partner.slice(0, 8),
    },
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
    // Il danno GIORNO per giorno degli ultimi 14: la stessa griglia oraria
    // sommata, con `hours` a dire su quante ore è calcolato ogni giorno.
    giorni: (tl.daily || []).map((g) => ({ giorno: g.day, d: g.d, ore: g.hours, parziale: Boolean(g.partial), pPicco: g.pPeak })),
  };
}

// ---------------------------------------------------------------------------
// Le sezioni aggiunte l'11/09: storia, cittadini, guerra, unità, elezioni
// ---------------------------------------------------------------------------
// Tutte da cache che il cache-server tiene già per altre viste: nessuna
// chiamata nuova a WarEra. Ognuna fallisce per conto suo (null), e la
// vista al posto suo scrive "non disponibile".

const GIORNO_MS = 24 * 3600_000;

/** Il tesoro ora per ora e la popolazione attiva, dagli eventi del ticker.
 *  Il tesoro è `countryWealth` (vedi formaPaese), che il ticker registra a
 *  ogni ricalcolo orario del gioco: è la sua storia vera, non una stima. */
function formaStorico(eventi, countryId) {
  const da = Date.now() - 14 * GIORNO_MS;
  const tesoro = []; const popolazione = [];
  for (const e of eventi || []) {
    if (e?.countryId !== countryId || !(e.timestamp >= da)) continue;
    if (e.category === 'wealth' && e.value != null) tesoro.push({ t: e.timestamp, v: e.value });
    else if (e.category === 'population' && e.value != null) popolazione.push({ t: e.timestamp, v: e.value });
  }
  tesoro.sort((a, b) => a.t - b.t);
  popolazione.sort((a, b) => a.t - b.t);
  // La variazione su una finestra: ultimo valore meno l'ultimo valore
  // registrato PRIMA dell'inizio della finestra. Senza un punto così
  // vecchio la variazione non si sa, e resta null invece di uno zero.
  const variazione = (serie, ms) => {
    if (!serie.length) return null;
    const ultimo = serie[serie.length - 1];
    let base = null;
    for (const p of serie) { if (p.t <= ultimo.t - ms) base = p; else break; }
    return base ? ultimo.v - base.v : null;
  };
  return {
    tesoro, popolazione,
    tesoro24h: variazione(tesoro, GIORNO_MS),
    tesoro7g: variazione(tesoro, 7 * GIORNO_MS),
    popolazione7g: variazione(popolazione, 7 * GIORNO_MS),
  };
}

/** I cittadini in numeri, dal censimento: chi c'è, chi gioca, come. */
function formaCittadini(cit, conteggi) {
  const ora = Date.now();
  const d = cit?.data || [];
  const visti = (ms) => d.filter((c) => c.seen && ora - c.seen < ms).length;
  const fasce = [[1, 9], [10, 19], [20, 29], [30, 39], [40, Infinity]];
  const livelli = fasce.map(([a, b]) => ({ da: a, a: Number.isFinite(b) ? b : null, n: d.filter((c) => c.lv >= a && c.lv <= b).length }));
  const stile = { war: 0, eco: 0, mixed: 0, undecided: 0 };
  for (const c of d) if (c.ps && c.ps in stile) stile[c.ps] += 1;
  const somma = (k) => d.reduce((t, c) => t + (c[k] || 0), 0);
  const persona = (c) => ({ id: c.id, nome: c.u, avatar: c.a || null, livello: c.lv ?? null, settimana: c.wk ?? null, ricchezza: c.w ?? null, stile: c.ps || null });
  return {
    censiti: cit?.total ?? d.length,
    letti: cit?.known ?? d.length,
    nuovi24h: conteggi?.new24h ?? null,
    nuovi7g: conteggi?.new7d ?? null,
    attivi24h: visti(GIORNO_MS),
    attivi72h: visti(3 * GIORNO_MS),
    attivi7g: visti(7 * GIORNO_MS),
    livelli,
    stile,
    ricchezzaTotale: somma('w'),
    ricchezzaMedia: d.length ? somma('w') / d.length : null,
    topDanno: d.slice(0, 10).map(persona),            // il censimento arriva già per danno settimanale
    topRicchezza: [...d].sort((a, b) => (b.w || 0) - (a.w || 0)).slice(0, 8).map(persona),
    aggiornatoIl: cit?.fetchedAt ?? null,
  };
}

/** Trenta giorni di guerra dall'archivio battaglie, e le spese giorno per
 *  giorno. ⚠️ ab/db sono la taglia INCASSATA dai due lati, non spesa:
 *  la spesa vera sta in war-expenses (vedi battleArchive.js). */
function formaGuerra(archivio, spese, countryId, reg) {
  const da = Date.now() - 30 * GIORNO_MS;
  const mie = (archivio || []).filter((b) => b.e >= da && (b.ac === countryId || b.dc === countryId));
  const perAvversario = new Map();
  let vinte = 0; let attacchi = 0; let dannoFatto = 0; let dannoSubito = 0;
  const righe = mie.map((b) => {
    const lato = b.ac === countryId ? 'attacker' : 'defender';
    const vinta = b.w === lato;
    const noi = lato === 'attacker' ? b.ad : b.dd;
    const loro = lato === 'attacker' ? b.dd : b.ad;
    const avversario = lato === 'attacker' ? b.dc : b.ac;
    if (vinta) vinte += 1;
    if (lato === 'attacker') attacchi += 1;
    dannoFatto += noi || 0; dannoSubito += loro || 0;
    if (avversario) {
      const a = perAvversario.get(avversario) || { paese: avversario, battaglie: 0, vinte: 0, dannoNoi: 0, dannoLoro: 0 };
      a.battaglie += 1; if (vinta) a.vinte += 1; a.dannoNoi += noi || 0; a.dannoLoro += loro || 0;
      perAvversario.set(avversario, a);
    }
    return { id: b.i, fine: b.e, regione: reg?.[b.r]?.name || null, lato, vinta, avversario, dannoNoi: noi || 0, dannoLoro: loro || 0 };
  });

  const giorni = [];
  for (let k = 13; k >= 0; k -= 1) {
    const g = new Date(Date.now() - k * GIORNO_MS).toISOString().slice(0, 10);
    const s = spese?.byDay?.[g]?.[countryId];
    giorni.push({ giorno: g, taglie: s?.bounty ?? 0, contratti: s?.contracts ?? 0, nContratti: s?.contractCount ?? 0, battaglie: s?.battles ?? 0 });
  }
  const somma = (n) => Object.entries(spese?.byDay || {})
    .filter(([g]) => g >= new Date(Date.now() - (n - 1) * GIORNO_MS).toISOString().slice(0, 10))
    .reduce((t, [, per]) => t + (per?.[countryId]?.bounty || 0) + (per?.[countryId]?.contracts || 0), 0);

  return {
    battaglie: mie.length, vinte, perse: mie.length - vinte, attacchi, difese: mie.length - attacchi,
    dannoFatto, dannoSubito,
    avversari: [...perAvversario.values()].sort((a, b) => b.battaglie - a.battaglie).slice(0, 6),
    ultime: righe.sort((a, b) => b.fine - a.fine).slice(0, 8),
    spese: { giorni, ultimi7g: somma(7), ultimi30g: somma(30) },
  };
}

/**
 * Di quanto è cambiato ogni numero delle tessere, e rispetto a QUANDO.
 *
 * Tre fonti, dalla più lunga alla più corta:
 *   · tesoro e giocatori attivi: il ticker del cache-server, 14 giorni;
 *   · danno di oggi: la curva oraria, confrontata con IERI alla stessa ora
 *     (la stessa finestra dalle 02:00 italiane, un giorno prima);
 *   · tutto il resto (sviluppo, danno per cittadino, bonus, disordini,
 *     tasse, posizioni): le fotografie orarie di istantanee.js, che si
 *     accumulano da quando esistono.
 * Ogni variazione porta `da`, l'istante del valore di confronto: la vista
 * scrive "rispetto a 24 h fa" solo quando lo è davvero.
 */
function formaVariazioni(countryId, paese, storico, orario, oggi) {
  const ora = Date.now();
  const adesso = estrai(paese);
  const out = {};

  const rif = riferimento(countryId, ora);
  if (rif) {
    for (const k of Object.keys(adesso)) {
      if (k.endsWith('R')) continue;
      const prima = rif.dati[k];
      if (prima == null || adesso[k] == null) continue;
      const v = { delta: adesso[k] - prima, prima, da: rif.at };
      if (adesso[`${k}R`] != null && rif.dati[`${k}R`] != null) v.rank = { prima: rif.dati[`${k}R`], adesso: adesso[`${k}R`] };
      out[k] = v;
    }
  }

  const daSerie = (serie, k) => {
    if (!serie?.length || adesso[k] == null) return;
    let base = null;
    for (const p of serie) { if (p.t <= ora - GIORNO_MS) base = p; else break; }
    if (base) out[k] = { ...(out[k] || {}), delta: adesso[k] - base.v, prima: base.v, da: base.t };
  };
  daSerie(storico?.tesoro, 'tesoro');
  daSerie(storico?.popolazione, 'attivi');

  // Il cumulato settimanale riparte il lunedì: una "variazione" negativa è
  // il reset, non un crollo, e non si disegna come freccia in giù.
  if (out.dannoSett && out.dannoSett.delta < 0) out.dannoSett.reset = true;

  // Danno di oggi contro ieri alla stessa ora: la stessa finestra un giorno
  // prima, sommata sulle ore misurate. Se ne manca una non si confronta —
  // un'ora non misurata non è un'ora senza danno.
  if (oggi?.dal && orario?.serie?.length) {
    const inizio = oggi.dal - GIORNO_MS;
    const fine = ora - GIORNO_MS;
    let somma = 0; let attese = 0; let viste = 0;
    for (const p of orario.serie) {
      if (p.t < inizio || p.to > fine) continue;
      attese += 1;
      if (p.d != null) { somma += p.d; viste += 1; }
    }
    if (attese && viste === attese) out.dannoOggi = { delta: oggi.danno - somma, prima: somma, da: inizio, ieri: true };
  }
  return out;
}

/** Le unità militari della nazione: registrate qui, oppure nostre DI
 *  FATTO (la maggioranza dei membri è nostra, stesso marchio dell'elenco
 *  unità del tool). */
function formaUnita(dir, countryId) {
  const mie = (dir || []).filter((m) => m.country === countryId || m.composition?.top?.[0]?.country === countryId);
  const righe = mie.map((m) => ({
    id: m._id, nome: m.name, avatar: m.avatarUrl || null,
    membri: m.memberCount ?? 0, livello: m.level ?? null,
    registrata: m.country === countryId,
    dannoSettimana: m.rankings?.muWeeklyDamages?.value ?? 0,
    ricchezza: m.rankings?.muWealth?.value ?? null,
    guerra: m.playstyle?.war ?? 0, eco: m.playstyle?.eco ?? 0,
  })).sort((a, b) => b.dannoSettimana - a.dannoSettimana);
  return {
    n: righe.length,
    registrate: righe.filter((u) => u.registrata).length,
    deFatto: righe.filter((u) => !u.registrata).length,
    membri: righe.reduce((t, u) => t + u.membri, 0),
    dannoSettimana: righe.reduce((t, u) => t + u.dannoSettimana, 0),
    top: righe.slice(0, 10),
  };
}

/** Ultime elezioni e le prossime. Le prossime sono una STIMA dal ciclo
 *  mensile del gioco (presidenziali il 2, congresso il 6, misurato sugli
 *  archivi) e la vista la chiama così. */
async function formaElezioni(lista) {
  const ordinate = [...(lista || [])].sort((a, b) => Date.parse(b.votesStartAt || 0) - Date.parse(a.votesStartAt || 0));
  const ultima = (tipo) => ordinate.find((e) => e.type === tipo) || null;
  const pres = ultima('president');
  const cong = ultima('congress');
  const vincitore = pres?.candidates?.find((c) => c.isElected)?.user || null;
  const nomi = await nomiUtenti([vincitore].filter(Boolean));
  const meseDopo = (iso) => {
    const t = Date.parse(iso || ''); if (!t) return null;
    const d = new Date(t); d.setUTCMonth(d.getUTCMonth() + 1); return d.getTime();
  };
  const forma = (e) => e && ({
    tipo: e.type, inizio: Date.parse(e.votesStartAt || '') || null, fine: Date.parse(e.votesEndAt || '') || null,
    stato: e.status || null, attiva: Boolean(e.isActive), voti: e.votesCount ?? null,
    candidati: (e.candidates || []).length, eletti: e.electedCount ?? null,
  });
  return {
    presidente: pres && {
      ...forma(pres),
      vincitore: vincitore ? { id: vincitore, nome: nomi[vincitore]?.username || null, avatar: nomi[vincitore]?.avatarUrl || null, voti: pres.votes?.[vincitore] ?? null } : null,
    },
    congresso: forma(cong),
    inCorso: ordinate.filter((e) => e.isActive || (e.status && e.status !== 'finished')).map(forma),
    prossime: { presidente: meseDopo(pres?.votesStartAt), congresso: meseDopo(cong?.votesStartAt) },
  };
}

async function quadroNazione(countryId) {
  const [paeseR, govR, battR, baseR, tlR, bonR, regR, confR, tickR, citR, contR, archR, speseR, dirR, eleR] = await Promise.allSettled([
    paeseLive(countryId),
    formaGoverno(countryId),
    battaglieVive(),
    baseDannoGiornaliero(),
    timeline(`${countryId}|48`),
    bonifici(),
    regioniMappa(),
    quadroConfini(countryId),
    eventiTicker(),
    cittadiniTutti(countryId),
    conteggiCittadini(countryId),
    archivioBattaglie(),
    speseGuerra(),
    direttorioMu(),
    elezioniDi(countryId),
  ]);

  const paese = esito(paeseR);
  if (!paese) throw new Error('nazione_non_leggibile');
  const reg = esito(regR);
  let elezioni = null;
  try { elezioni = esito(eleR) ? await formaElezioni(esito(eleR)) : null; } catch { /* una sezione in meno */ }

  const oggi = formaOggi(esito(baseR), paese);
  const orario = formaOrario(esito(tlR));
  const storico = esito(tickR) ? formaStorico(esito(tickR), countryId) : null;
  let variazioni = {};
  try { variazioni = formaVariazioni(countryId, paese, storico, orario, oggi); } catch (err) {
    console.warn('[nazione] variazioni non calcolate:', err.message);
  }

  return {
    paese: formaPaese(paese),
    governo: esito(govR),
    oggi,
    orario,
    variazioni,
    battaglie: esito(battR) ? formaBattaglie(esito(battR), countryId, reg) : null,
    bonifici: esito(bonR) ? formaBonifici(esito(bonR), countryId) : null,
    confini: esito(confR),
    storico,
    cittadini: esito(citR) ? formaCittadini(esito(citR), esito(contR)) : null,
    guerra: esito(archR) ? formaGuerra(esito(archR), esito(speseR), countryId, reg) : null,
    unita: esito(dirR) ? formaUnita(esito(dirR), countryId) : null,
    elezioni,
    generatoIl: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Chi altro vede la pagina
// ---------------------------------------------------------------------------

/** L'elenco completo dei cittadini, per cercarne uno per nome. Tutti e non
 *  i primi 400 come per i nemici: chi il governo vuole aggiungere è spesso
 *  proprio uno che fa poco danno (un diplomatico, un economista). */
const tuttiICittadini = cittadiniTutti;

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

  /** Tutti i giocatori di UN nemico. Solo dei nemici di adesso: la pagina
   *  è la scheda di guerra di questa nazione, non un censimento del mondo. */
  router.get('/nemici/:id/giocatori', async (req, res) => {
    try {
      const ctx = await contesto(req);
      if (!ctx.countryId) return res.status(404).json({ error: 'nazione_sconosciuta' });
      if (!ctx.accesso) return negato(res, ctx.countryId);
      const noi = (await paesiMappa()).get(ctx.countryId);
      // I nostri giocatori sì (la scheda "la nostra forza" apre la stessa
      // tabella), quelli di nazioni che non ci riguardano no.
      if (req.params.id !== ctx.countryId && !idNemici(noi).includes(req.params.id)) {
        return res.status(403).json({ error: 'non_nemico' });
      }
      res.json(await giocatoriNemico(req.params.id));
    } catch (err) {
      console.error('[nazione] giocatori nemici falliti:', err.message);
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
