/* ══════════════════════════════════════════════════════════════════════
   AREA RISERVATA — i nemici: pillole, danno, potenziale
   ----------------------------------------------------------------------
   Per ogni nazione con cui siamo in guerra (`warsWith`) più il nemico
   giurato (`enemy`), tre domande che il gioco non fa:

     1. PILLOLE   Quanti dei loro sono sotto pillola adesso, quanti nel
                  dopo-sbornia, e QUANDO cambia. La pillola (`cocain`) dà
                  +60% d'attacco per 8 ore e poi −60% per 15,5: un nemico
                  appena pillato è il peggior momento per attaccarlo, uno
                  in malus il migliore, e l'ora in cui si passa dall'uno
                  all'altro è scritta nei suoi `buffs` (buffEndAt /
                  debuffEndAt). Vedi server/damageTimeline.js.
     2. DANNO     Quanto hanno fatto davvero: settimana, ultime 24 ore, la
                  loro ora migliore e il loro giorno migliore degli ultimi
                  14 — dall'archivio /damage-timeline, che accumula.
     3. POTENZIALE Quanto POTREBBERO fare adesso con quello che hanno.

   ── IL POTENZIALE, E COSA NON È ───────────────────────────────────────
   Danno atteso per colpo, dal codex (ENGINE, verificato sui profili):

       attacco × (0,5 + 0,5·precisione + precisione·critico·danno critico)

   con `skills.attack.total`, che contiene GIÀ grado, munizioni e pillola
   (verificato: 289 × 1,27 × 0,4 = 147 su un giocatore in malus). Poi:

     · adesso   i colpi che hanno in canna × danno per colpo. I colpi
                sono la vita attuale PIÙ quella che la barra della fame
                permette di rimettere mangiando: ogni punto fame è un
                pasto, e un pasto rende `healthRegenPercent` della vita
                massima (pane 10, bistecca 15, pesce cotto 20 —
                gameConfig.items, letti dal vivo). Il tutto diviso per
                `battle.healthCost` (10).
     · massimo  come sopra, ma chi è pulito prende la pillola adesso.
                Chi è in malus resta in malus: è il tetto realistico dei
                prossimi minuti, non una fantasia con tutti al +60%.

   ⚠️ Un "all'ora" NON c'è, e non per dimenticanza. Si è provato a
   ricavarlo da `hourlyBarRegen` e dava un ritmo dieci volte sotto il
   danno osservato; misurato dal vivo (60 giocatori letti due volte a 90
   secondi, 2026-09-10) `currentBarValue` non si muove mai fra due
   letture: il gioco aggiorna vita e fame a scatti o sulle azioni, e da
   fuori il ritmo vero non si vede. Il ritmo che reggono lo dice meglio il
   danno OSSERVATO (ultime 24 ore, ora migliore), che sta accanto.

   ⚠️ La prima versione contava la sola vita, e diceva 0,7 milioni "in
   canna" per una nazione che nelle 24 ore prima ne aveva fatti 348: i
   giocatori la vita la rimettono mangiando, e senza la fame il numero
   era vero e inutile. Il cibo si conta col pasto MIGLIORE del gioco:
   l'inventario non è pubblico, quindi è un tetto, e la vista lo dice.

   Restano fuori armatura e schivata di chi riceve e i bonus di
   battaglia (ordini, alleanza, patriottico, basi, munizioni non
   impugnate). Sono il danno dei giocatori, non della battaglia.

   ── SU CHI SI CALCOLA ─────────────────────────────────────────────────
   Sui ROSTER giocatori che hanno fatto più danno questa settimana e che
   si sono visti nelle ultime 72 ore, da /country-citizens (il cache-server
   li ha già). Per quelli si legge `user.getUserLite` in diretta — è lì
   che stanno pillola e vita di adesso — a blocchi di 30 (a 100 l'URL
   supera il limite, vedi CHUNK_UTENTI in wealth.js).

   Costo: tre richieste per nemico ogni dieci minuti, e solo se qualcuno
   guarda. Tutte pubbliche.
   ══════════════════════════════════════════════════════════════════════ */

const { trpcBatch } = require('./wareraApi');
const { paesiMappa, cittadini, timeline, configGioco, memo } = require('./fonti');
const { relazione } = require('./confini');

const ROSTER = 90;
const CHUNK_UTENTI = 30;
const ATTIVO_MS = 72 * 3600_000;
const TOP = 8;
const PILLOLA = 'cocain';

const HEALTH_COST_DEFAULT = 10;
const PILL_PCT_DEFAULT = 60;
const CIBO_PCT_DEFAULT = 20;      // pesce cotto, misurato il 2026-09-10

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const frazione = (v) => Math.min(Math.max((num(v) ?? 0) / 100, 0), 1);

/** Quanto la pillola sta moltiplicando l'attacco di adesso. */
function moltiplicatorePillola(atk) {
  if (atk?.buffsPercent) return 1 + atk.buffsPercent / 100;
  if (atk?.debuffsPercent) return 1 - atk.debuffsPercent / 100;
  return 1;
}

function giocatore(u, cfg) {
  const s = u.skills || {};
  const atk = num(s.attack?.total) ?? 0;
  const mult = moltiplicatorePillola(s.attack);
  const pulito = mult > 0 ? atk / mult : atk;

  const prec = frazione(s.precision?.total);
  const cc = frazione(s.criticalChance?.total);
  // Il danno critico NON si tronca a 1: 255 vuol dire +255%.
  const cd = Math.max((num(s.criticalDamages?.total) ?? 0) / 100, 0);
  const fattore = 0.5 + 0.5 * prec + prec * cc * cd;

  const buffFine = (u.buffs?.buffCodes || []).includes(PILLOLA) ? Date.parse(u.buffs.buffEndAt || '') : NaN;
  const malusFine = (u.buffs?.debuffCodes || []).includes(PILLOLA) ? Date.parse(u.buffs.debuffEndAt || '') : NaN;
  const pillola = Number.isFinite(buffFine) ? 'buff' : Number.isFinite(malusFine) ? 'malus' : 'pulito';

  const perColpo = atk * fattore;
  const perColpoMax = pillola === 'pulito' ? pulito * (1 + cfg.pillPct / 100) * fattore : perColpo;

  // La vita si rimette mangiando: ogni punto fame è un pasto, e un pasto
  // rende una percentuale della vita MASSIMA (vedi la testata).
  const vita = num(s.health?.currentBarValue) ?? 0;
  const vitaMax = num(s.health?.value) ?? num(s.health?.total) ?? 0;
  const pasto = (vitaMax * cfg.ciboPct) / 100;
  const fame = num(s.hunger?.currentBarValue) ?? 0;
  const colpi = Math.floor((vita + fame * pasto) / cfg.healthCost);

  return {
    id: u._id,
    nome: u.username || null,
    avatar: u.avatarUrl || null,
    livello: u.leveling?.level ?? null,
    pillola,
    fine: pillola === 'buff' ? buffFine : pillola === 'malus' ? malusFine : null,
    perColpo: Math.round(perColpo),
    colpi,
    vita,
    adesso: colpi * perColpo,
    massimo: colpi * perColpoMax,
    settimana: num(u.rankings?.weeklyUserDamages?.value) ?? null,
  };
}

async function parametri() {
  try {
    const g = await configGioco();
    // Il pasto migliore del gioco, qualunque sia: se domani arriva un
    // cibo nuovo che rende il 25%, il tetto sale da solo.
    const ciboPct = Math.max(0, ...Object.values(g?.items || {})
      .map((it) => Number(it?.flatStats?.healthRegenPercent) || 0));
    return {
      healthCost: Number(g?.battle?.healthCost) || HEALTH_COST_DEFAULT,
      pillPct: Number(g?.items?.[PILLOLA]?.flatStats?.percentAttack) || PILL_PCT_DEFAULT,
      buffH: Number(g?.items?.[PILLOLA]?.flatStats?.buffDurationHours) || 8,
      ciboPct: ciboPct || CIBO_PCT_DEFAULT,
    };
  } catch {
    return { healthCost: HEALTH_COST_DEFAULT, pillPct: PILL_PCT_DEFAULT, buffH: 8, ciboPct: CIBO_PCT_DEFAULT };
  }
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
    if (p.to > ora - 24 * 3600_000) { ultime24 += p.d; misurate24 += (p.min || 60); }
    // Il picco si confronta A PARITÀ DI DURATA: un secchio da un'ora
    // (l'archivio vecchio) contro uno da mezz'ora non sono la stessa
    // misura, quindi si confronta il ritmo orario.
    const allOra = p.d * (60 / (p.min || 60));
    if (!picco || allOra > picco.allOra) picco = { allOra, t: p.t, to: p.to, d: p.d, min: p.min || 60 };
  }
  const giorni = (tl?.daily || []).filter((g) => g.d != null && !g.partial);
  const giornoMax = giorni.reduce((m, g) => (!m || g.d > m.d ? g : m), null);

  // Pillati in tutta la nazione, dal censimento: l'ultimo secchio. Le
  // ultime ore possono ancora crescere (il giro completo dei cittadini
  // dura ~2 ore), e il campo `assestato` lo dice.
  const conP = serie.filter((p) => p.p != null);
  const ultimo = conP[conP.length - 1] || null;

  return {
    ultime24h: misurate24 ? ultime24 : null,
    oreMisurate24h: Math.round(misurate24 / 6) / 10,
    piccoOra: picco,
    giornoMax: giornoMax ? { giorno: giornoMax.day, d: giornoMax.d } : null,
    pillatiNazione: ultimo ? { n: ultimo.p, t: ultimo.t, assestato: ultimo.t <= (tl?.pill?.settledUntil ?? 0) } : null,
    coverageFrom: tl?.coverageFrom ?? null,
  };
}

const schedaNemico = memo(10 * 60_000, async (countryId) => {
  const [cfg, tl, cit] = await Promise.all([
    parametri(),
    timeline(`${countryId}|336`).catch(() => null),
    cittadini(countryId).catch(() => null),
  ]);

  const ora = Date.now();
  const elenco = (cit?.data || []).filter((c) => c.seen && ora - c.seen < ATTIVO_MS);
  const roster = elenco.slice(0, ROSTER).map((c) => c.id);

  const giocatori = [];
  for (let i = 0; i < roster.length; i += CHUNK_UTENTI) {
    const pezzo = roster.slice(i, i + CHUNK_UTENTI);
    try {
      const risp = await trpcBatch(pezzo.map((userId) => ['user.getUserLite', { userId }]));
      for (const u of risp) if (u?._id) giocatori.push(giocatore(u, cfg));
    } catch (err) {
      console.warn('[nemici] lettura giocatori fallita:', err.message);
    }
  }

  const somma = (k) => giocatori.reduce((t, g) => t + (g[k] || 0), 0);
  const conta = (stato) => giocatori.filter((g) => g.pillola === stato).length;
  const fini = (stato) => giocatori.filter((g) => g.pillola === stato && g.fine).map((g) => g.fine).sort((a, b) => a - b);

  return {
    letto: ora,
    censiti: cit?.total ?? null,
    attivi72h: elenco.length,
    analizzati: giocatori.length,
    pillole: {
      buff: conta('buff'),
      malus: conta('malus'),
      pulito: conta('pulito'),
      // Le scadenze: è il "quando" che serve a decidere, più del quanti.
      fineBuff: fini('buff'),
      fineMalus: fini('malus'),
      durataBuffOre: cfg.buffH,
    },
    potenziale: {
      adesso: Math.round(somma('adesso')),
      massimo: Math.round(somma('massimo')),
      colpi: somma('colpi'),
    },
    osservato: dannoOsservato(tl),
    top: [...giocatori].sort((a, b) => b.perColpo - a.perColpo).slice(0, TOP),
  };
});

/**
 * I nemici di una nazione con le loro schede. Le nazioni si decidono qui,
 * sui dati di adesso: una pace firmata stamattina toglie una scheda.
 */
async function quadroNemici(countryId) {
  const paesi = await paesiMappa();
  const noi = paesi.get(countryId);
  if (!noi) return { nemici: [] };

  const ids = [...new Set([...(noi.warsWith || []), noi.enemy].filter(Boolean))];
  const nemici = await Promise.all(ids.map(async (id) => {
    const loro = paesi.get(id);
    let scheda = null; let errore = null;
    try { scheda = await schedaNemico(id); } catch (err) { errore = err.message; }
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
      popolazioneAttiva: loro?.rankings?.countryActivePopulation?.value ?? null,
      ...(scheda || {}),
      errore,
    };
  }));

  // Prima chi picchia di più: è quello che arriva per primo alla porta.
  nemici.sort((a, b) => (b.danno.settimana || 0) - (a.danno.settimana || 0));
  return { nemici };
}

module.exports = { quadroNemici, giocatore, dannoOsservato };
