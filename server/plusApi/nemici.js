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
                  migliore. L'ora del cambio è scritta nei suoi `buffs`
                  (buffEndAt / debuffEndAt), timestamp FISSI: lo stato di
                  adesso si calcola esatto anche da una lettura vecchia.
     2. DANNO     Quanto hanno fatto davvero: settimana, ultime 24 ore, la
                  loro ora migliore e il loro giorno migliore degli ultimi
                  14 — dall'archivio /damage-timeline, che accumula.
     3. COLPO     Quanto fa ciascuno a ogni colpo, adesso e con la pillola.

   ── DA DOVE, PER TUTTI ────────────────────────────────────────────────
   Il cache-server rilegge `user.getUserLite` di OGNI cittadino di ogni
   nazione almeno ogni 2 ore (lo fa già per stile di gioco e statistiche),
   e da lì tiene anche pillola e abilità di combattimento
   (/country-citizens?fields=combat, vedi citizenStats [11..16]). Qui
   quindi TUTTI i giocatori costano zero chiamate a WarEra.

   In più, i ROSTER_LIVE giocatori attivi che fanno più danno si rileggono
   in diretta, a blocchi di 30 (a 100 l'URL supera il limite): sono quelli
   che pesano, e per loro una pillola presa venti minuti fa deve già
   vedersi. Per gli altri il dato ha al massimo ~2 ore, e la vista lo dice.

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
   lo portano, misurato il 2026-09-11). Due tentativi scartati:
     · dalla sola rigenerazione della vita: dieci volte sotto il danno
       osservato (e `currentBarValue` non si muove fra due letture a 90 s);
     · vita + barra della fame col pasto migliore: "2,3 milioni in canna"
       per una nazione che nelle 24 ore ne aveva fatti 471. Vero e inutile.
   Il ritmo lo dice il danno OSSERVATO (24 ore, ora migliore), che sta
   accanto. Restano fuori armatura e schivata di chi riceve e i bonus di
   battaglia (ordini, alleanza, patriottico, basi).

   Costo: una lettura della cache sulla loopback e tre richieste pubbliche
   per nemico ogni dieci minuti, e solo se qualcuno guarda.
   ══════════════════════════════════════════════════════════════════════ */

const { trpcBatch } = require('./wareraApi');
const { paesiMappa, timeline, configGioco, memo, dalCache } = require('./fonti');
const { relazione } = require('./confini');

const ROSTER_LIVE = 90;
const CHUNK_UTENTI = 30;
const ATTIVO_MS = 72 * 3600_000;
const PILLOLA = 'cocain';
const PILL_PCT_DEFAULT = 60;
const ORA_MS = 3600_000;

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const frazione = (v) => Math.min(Math.max((num(v) ?? 0) / 100, 0), 1);

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
 * Un buff visto dal censimento e poi scaduto è un malus adesso: il malus
 * comincia quando il buff finisce, e dura `debuffH`.
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
    letto: ora,
  };
}

/** Un giocatore dal censimento del cache-server. Senza i campi di
 *  combattimento (non ancora riletto dopo il deploy) resta 'ignoto':
 *  meglio un buco dichiarato che un "pulito" inventato. */
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
    // Il picco si confronta A PARITÀ DI DURATA: un secchio da un'ora
    // (l'archivio vecchio) contro uno da mezz'ora non sono la stessa
    // misura, quindi si confronta il ritmo orario.
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

/** Tutti i giocatori di un nemico, più il riepilogo. Dieci minuti in
 *  memoria: la stessa scheda la vedono tutti i ministri della nazione. */
const schedaNemico = memo(10 * 60_000, async (countryId) => {
  const [cfg, tl, cit] = await Promise.all([
    parametri(),
    timeline(`${countryId}|336`).catch(() => null),
    dalCache(`/country-citizens?countryId=${encodeURIComponent(countryId)}&limit=5000&fields=combat`).catch(() => null),
  ]);

  const ora = Date.now();
  const censimento = cit?.data || [];     // già ordinato per danno settimanale
  const attivi = new Set(censimento.filter((c) => c.seen && ora - c.seen < ATTIVO_MS).map((c) => c.id));

  const roster = censimento.filter((c) => attivi.has(c.id)).slice(0, ROSTER_LIVE).map((c) => c.id);
  const live = new Map();
  for (let i = 0; i < roster.length; i += CHUNK_UTENTI) {
    const pezzo = roster.slice(i, i + CHUNK_UTENTI);
    try {
      const risp = await trpcBatch(pezzo.map((userId) => ['user.getUserLite', { userId }]));
      for (const u of risp) if (u?._id) live.set(u._id, daLive(u, cfg, ora));
    } catch (err) {
      console.warn('[nemici] lettura giocatori fallita:', err.message);
    }
  }

  const giocatori = censimento.map((c) => ({
    ...(live.get(c.id) || daCensimento(c, cfg, ora)),
    attivo: attivi.has(c.id),
  }));
  giocatori.sort((a, b) => (b.perColpo ?? -1) - (a.perColpo ?? -1));

  const inGioco = giocatori.filter((g) => g.attivo);
  const conta = (s) => inGioco.filter((g) => g.pillola === s).length;
  const fini = (s) => inGioco.filter((g) => g.pillola === s && g.fine).map((g) => g.fine).sort((a, b) => a - b).slice(0, 20);
  const somma = (k) => inGioco.reduce((t, g) => t + (g[k] || 0), 0);

  return {
    sommario: {
      letto: ora,
      censiti: cit?.total ?? null,
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
});

/**
 * I nemici di una nazione con i loro riepiloghi. Le nazioni si decidono qui,
 * sui dati di adesso: una pace firmata stamattina toglie una scheda.
 */
async function quadroNemici(countryId) {
  const paesi = await paesiMappa();
  const noi = paesi.get(countryId);
  if (!noi) return { nemici: [] };

  const nemici = await Promise.all(idNemici(noi).map(async (id) => {
    const loro = paesi.get(id);
    let scheda = null; let errore = null;
    try { scheda = (await schedaNemico(id)).sommario; } catch (err) { errore = err.message; }
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
  return { nemici };
}

function idNemici(noi) {
  return [...new Set([...(noi?.warsWith || []), noi?.enemy].filter(Boolean))];
}

/** L'elenco completo dei giocatori di UN nemico, per la tabella. A parte
 *  dal riepilogo perché pesa (la Germania ha 1.131 cittadini) e lo apre
 *  solo chi lo chiede. */
async function giocatoriNemico(countryId) {
  const s = await schedaNemico(countryId);
  return { letto: s.sommario.letto, censiti: s.sommario.censiti, attivi72h: s.sommario.attivi72h, giocatori: s.giocatori };
}

module.exports = { quadroNemici, giocatoriNemico, idNemici, statoPillola, colpi, fattoreColpo, dannoOsservato };
