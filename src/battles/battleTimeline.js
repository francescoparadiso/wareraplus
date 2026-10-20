/* ══════════════════════════════════════════════════════════════
   WarEra+ — Andamento di una battaglia (scheda battaglia)
   ------------------------------------------------------------------
   La domanda: QUANDO è entrata una nazione, e la battaglia si è girata
   lì? Le classifiche sotto dicono chi ha fatto quanto in totale; qui si
   vede in che ordine.

   Tre pezzi, tutti da /battle-timeline (server/battleTimeline.js):
   1. il grafico — danno al minuto per lato (barre specchiate, difesa
      sopra e attacco sotto, come le colonne della scheda) e i punti del
      round sotto, con i sorpassi segnati;
   2. i SORPASSI — ogni volta che il lato in testa nel danno del round
      cambia, chi del lato che passa avanti ha fatto il danno nei 10
      minuti prima, con "appena entrata" su chi è arrivato lì;
   3. gli INGRESSI — per ogni nazione, il primo tick in cui compare.
   Più, in una sezione sua ma con lo stesso intervallo di zoom, i SOLDI
   SPESI: totale, taglia e contratti cumulati, per lato — vedi
   analyzeMoney più sotto e la testata di timelineChart.js.

   ⚠️ Niente fallback e niente ricostruzione: il gioco non conserva
   l'andamento di una battaglia (vedi la testata del modulo server), e un
   browser aperto adesso non ha le letture di un'ora fa. Se il server non
   ha la battaglia — chiusa prima del deploy, o server giù — la sezione
   non compare.

   ⚠️ Il danno per nazione arriva SOLO al tick (2 minuti) mentre quello
   per lato arriva al minuto: le ore di ingresso hanno ±2 minuti, e la
   nota lo dice. Una battaglia già aperta quando la registrazione è
   partita ha la prima lettura come FONDO (`baseAt`): chi c'era già NON
   è un ingresso, e il suo danno precedente non va distribuito nel tempo.
   ══════════════════════════════════════════════════════════════ */

import { WARERA_CACHE_BASE } from '../diplomacy/config.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { tlT } from './timelineI18n.js';
import { chartBlockHtml, wireChart, resetChart } from './timelineChart.js';

const GAP_MS = 3.5 * 60 * 1000;     // fra due campioni al minuto: oltre è un buco
const WINDOW_MS = 10 * 60 * 1000;    // "chi ha spinto prima del sorpasso"
const TICK_SLACK_MS = 2.5 * 60 * 1000; // la classifica arriva al tick DOPO il colpo
const NEW_MS = 15 * 60 * 1000;       // "appena entrata": entro 15 min dal sorpasso
const MINOR_SHARE = 0.01;            // sotto l'1% del lato: in coda, nascoste
const TIMEOUT_MS = 8000;

/* ── Dati ─────────────────────────────────────────────────────── */

// battleId -> { at, p }. Una battaglia chiusa non cambia più (cache di
// sessione); una viva si rilegge dopo un minuto, il ritmo del server.
const _cache = new Map();
const LIVE_TTL_MS = 60 * 1000;

/** null se il server non ce l'ha (404) o non risponde: la sezione sparisce. */
export function fetchBattleTimeline(battleId, { live = false } = {}) {
  const hit = _cache.get(battleId);
  if (hit && (!hit.live || Date.now() - hit.at < LIVE_TTL_MS)) return hit.p;
  const p = (async () => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(`${WARERA_CACHE_BASE}/battle-timeline?battleId=${encodeURIComponent(battleId)}`,
        { signal: ctrl.signal });
      if (!res.ok) return null;
      const json = await res.json();
      return json && Array.isArray(json.s) ? json : null;
    } catch (err) {
      console.warn('WarEra+ battles: /battle-timeline non disponibile:', err.message);
      return null;
    } finally {
      clearTimeout(timer);
    }
  })();
  _cache.set(battleId, { at: Date.now(), p, live });
  p.then(v => { if (!v && _cache.get(battleId)?.p === p) _cache.delete(battleId); });
  return p;
}

/* ── Analisi ──────────────────────────────────────────────────── */

const SIDES = ['defender', 'attacker'];

/** Dai campioni grezzi a: intervalli (danno al minuto), sorpassi, ingressi. */
export function analyzeTimeline(tl) {
  // s: [t, round, ticks, dannoAtk, dannoDef, puntiAtk, puntiDef]
  const S = (tl.s || []).slice().sort((a, b) => a[0] - b[0]);
  // k: [t, round, ticks, {nazione: cumulato}atk, {...}def] — solo i cambiati
  const K = (tl.k || []).slice().sort((a, b) => a[0] - b[0]);

  // 1. Danno al minuto fra due campioni. Al cambio round il contatore
  //    riparte da zero: il pezzo mancante del round chiuso lo dà
  //    roundsHistory (danno finale), altrimenti si perde e basta.
  const iv = [];
  for (let i = 1; i < S.length; i++) {
    const p = S[i - 1], c = S[i];
    const dt = c[0] - p[0];
    if (dt <= 0) continue;
    let dA, dD;
    if (c[1] === p[1]) { dA = c[3] - p[3]; dD = c[4] - p[4]; }
    else {
      const fin = tl.rounds?.[p[1] - 1];
      dA = (fin ? Math.max(0, (fin.attackerDamages || 0) - p[3]) : 0) + c[3];
      dD = (fin ? Math.max(0, (fin.defenderDamages || 0) - p[4]) : 0) + c[4];
    }
    const min = dt / 60000;
    iv.push({ t0: p[0], t1: c[0], gap: dt > GAP_MS, a: Math.max(0, dA) / min, d: Math.max(0, dD) / min,
      round: c[1], ad: c[3], dd: c[4], ap: c[5], dp: c[6] });
  }

  // 2. Delta per nazione a ogni tick, e ingressi.
  const cum = { attacker: {}, defender: {} };
  const ticks = [];
  const seen = { attacker: new Set(), defender: new Set() };
  // Nazioni, non righe: chi combatte su tutti e due i lati è una sola.
  const preSet = new Set();
  K.forEach((k, j) => {
    const base = j === 0 && Boolean(tl.baseAt);
    const delta = { attacker: {}, defender: {} };
    for (const [side, m] of [['attacker', k[3]], ['defender', k[4]]]) {
      for (const [c, v] of Object.entries(m || {})) {
        const prev = cum[side][c] || 0;
        if (base) { if (v > 0) { seen[side].add(c); preSet.add(c); } }
        else delta[side][c] = Math.max(0, v - prev);
        cum[side][c] = v;
      }
    }
    ticks.push({ t: k[0], prevT: j ? K[j - 1][0] : (tl.createdAt || k[0]), base, delta });
  });

  const sideTotal = { attacker: 0, defender: 0 };
  for (const tk of ticks) for (const side of SIDES) for (const v of Object.values(tk.delta[side])) sideTotal[side] += v;

  const entries = [];
  for (const tk of ticks) {
    if (tk.base) continue;
    for (const side of SIDES) {
      for (const [c, v] of Object.entries(tk.delta[side])) {
        if (v <= 0 || seen[side].has(c)) continue;
        seen[side].add(c);
        entries.push({ side, country: c, at: tk.t, from: tk.prevT });
      }
    }
  }
  const sumWindow = (side, from, to, country) => {
    let s = 0;
    for (const tk of ticks) {
      if (tk.base || tk.t < from || tk.t > to) continue;
      if (country) s += tk.delta[side][country] || 0;
      else for (const v of Object.values(tk.delta[side])) s += v;
    }
    return s;
  };
  for (const e of entries) {
    e.first10 = sumWindow(e.side, e.at, e.at + WINDOW_MS, e.country);
    const side10 = sumWindow(e.side, e.at, e.at + WINDOW_MS, null);
    e.share10 = side10 > 0 ? e.first10 / side10 : 0;
    e.total = cum[e.side][e.country] || 0;
    e.minor = sideTotal[e.side] > 0 && e.total / sideTotal[e.side] < MINOR_SHARE;
  }

  // 3. Sorpassi: cambia il segno di (dannoAtk − dannoDef) nel round.
  //    Il primo vantaggio di un round non è un sorpasso, e si fissa solo
  //    dal secondo tick (a round appena aperto il segno è rumore). Un
  //    sorpasso che il campione dopo smentisce è un'oscillazione, non conta.
  const flips = [];
  let lead = 0, leadRound = null;
  for (let i = 0; i < S.length; i++) {
    const [t, r, tk, ad, dd] = S[i];
    if (r !== leadRound) { lead = 0; leadRound = r; }
    const L = Math.sign(ad - dd);
    if (!L) continue;
    if (!lead) { if ((tk ?? 0) >= 2) lead = L; continue; }
    if (L === lead) continue;
    const nx = S[i + 1];
    const nL = nx && nx[1] === r ? Math.sign(nx[3] - nx[4]) : L;
    if (nL === -L) continue;
    lead = L;
    const side = L > 0 ? 'attacker' : 'defender';
    const other = side === 'attacker' ? 'defender' : 'attacker';
    const from = t - WINDOW_MS, to = t + TICK_SLACK_MS;
    const sideWin = sumWindow(side, from, to, null);
    const byC = {};
    for (const tk2 of ticks) {
      if (tk2.base || tk2.t < from || tk2.t > to) continue;
      for (const [c, v] of Object.entries(tk2.delta[side])) byC[c] = (byC[c] || 0) + v;
    }
    const top = Object.entries(byC).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5)
      .map(([c, v]) => {
        const ent = entries.find(e => e.side === side && e.country === c);
        return { country: c, damage: v, share: sideWin > 0 ? v / sideWin : 0,
          isNew: Boolean(ent && ent.at >= t - NEW_MS && ent.at <= to) };
      });
    flips.push({ t, round: r, side, top, sideWin, oppWin: sumWindow(other, from, to, null) });
  }

  return { S, iv, flips, entries, preexisting: preSet.size, gapMs: GAP_MS };
}

/* ── Soldi spesi nel tempo ────────────────────────────────────────
   Richiesta dell'utente (2026-10-20): accanto al danno, «un grafico dei
   soldi spesi, con 3 linee: totale, solo taglia, solo contratti».
   Cumulati, cioè "speso finora"; poi (stesso giorno) in una sezione a
   parte e divisi fra difesa e attacco, con la somma dei lati a scelta.

   - TAGLIA: quanto è SCESO il salvadanaio di un lato fra due campioni
     (campi 7-8 di `s`, dal deploy del 2026-10-20). Non è una stima: è il
     salvadanaio stesso. Una salita è una ricarica e vale zero pagato. I
     buchi di lettura non fanno perdere niente (la discesa attraverso il
     buco è quella vera), solo la sua distribuzione nel tempo. Prima del
     primo campione col salvadanaio la taglia NON si sa: le linee taglia e
     totale partono da lì (`bountyFrom`) e la nota lo dice.
   - CONTRATTI: il compenso pattuito di ogni contratto aggiudicato,
     contato quando l'asta si chiude (`awardedAt`). Viene dalle aste, non
     dal server, quindi c'è sempre — anche per le battaglie registrate
     prima di quel deploy. ⚠️ È un impegno preso a quell'ora: l'unità lo
     incassa a danno consegnato, più tardi.
   Le due voci si sommano senza doppi conteggi: è la stessa regola del
   totale in testa alla scheda (vedi src/diplomacy/battleSpending.js). */

/* ⚠️ UN CALO DEL SALVADANAIO NON È SEMPRE TAGLIA PAGATA (misurato il
   2026-10-20 sulla prima ora di registrazione): quando una nazione RIMETTE
   la taglia (tariffa nuova, `bountyEffectiveAt` nuovo) il salvadanaio
   vecchio sparisce in un minuto — 7.834 → 800 con 0,75M di danno, cioè
   9,4 per 1k contro le 0,01–0,15 che si pagano davvero. Contarlo come
   speso gonfiava la linea di migliaia in un punto solo.
   Quindi un calo vale come pagato solo se è compatibile col danno fatto
   da quel lato in quell'intervallo: sopra MAX_PER_K per 1k è una
   sostituzione, e per quel minuto si stima il pagato con la tariffa
   osservata nei minuti prima (mai più del calo). La regola regge anche sui
   campioni già salvati, che non portano la tariffa. Resta un errore
   piccolo: una sostituzione con un salvadanaio di poco più basso, che
   sembra un pagamento. */
const MAX_PER_K = 1;
const _sideDmg = (prev, s, k, rounds) => {
  // danno di un lato fra due campioni: il contatore è del round e riparte
  // da zero al cambio, il pezzo mancante lo dà il risultato del round
  if (s[1] === prev[1]) return Math.max(0, s[k] - prev[k]);
  const fin = rounds?.[prev[1] - 1];
  const finK = k === 3 ? fin?.attackerDamages : fin?.defenderDamages;
  return (finK != null ? Math.max(0, finK - prev[k]) : 0) + s[k];
};

/** @returns {null | { pts:[t, taglia difesa, taglia attacco, contratti difesa, contratti attacco][],
 *            bountyFrom:number|null, pre:{defender,attacker}, hasContracts:boolean,
 *            total:number, resets:number }} */
export function analyzeMoney(S, contracts, T0, T1, rounds = null, { bountyNow = null, createdAt = null } = {}) {
  // ultima tariffa osservata per lato (soldi per 1k danni), per i minuti
  // in cui il salvadanaio è stato sostituito
  const lastRate = { 7: null, 8: null };
  let resets = 0;
  const paid = (prev, s, k) => {
    const p = prev[k], c = s[k];
    if (p == null || c == null || c >= p) return 0;
    const drop = p - c;
    const dmg = _sideDmg(prev, s, k === 7 ? 3 : 4, rounds);
    const perK = dmg > 0 ? drop / dmg * 1000 : Infinity;
    if (perK <= MAX_PER_K) { lastRate[k] = perK; return drop; }
    resets++;
    return lastRate[k] != null ? Math.min(drop, dmg * lastRate[k] / 1000) : 0;
  };
  const ctr = (contracts || [])
    .filter(c => c && c.payout > 0)
    .map(c => ({ t: Math.min(T1, Math.max(T0, c.awardedAt || c.createdAt || T0)), side: c.side, v: c.payout }))
    .sort((a, b) => a.t - b.t);
  const pool = S.filter(s => s.length > 8);
  if (!ctr.length && !pool.length) return null;

  // Tutti gli istanti in cui qualcosa cambia, in ordine: i campioni col
  // salvadanaio e le aste chiuse. A ogni istante il cumulato delle 4 voci.
  const pts = [];
  let bD = 0, bA = 0, cD = 0, cA = 0;
  let i = 0, j = 0, prev = null;
  const push = (t) => {
    const last = pts[pts.length - 1];
    if (last && last[0] === t) { last[1] = bD; last[2] = bA; last[3] = cD; last[4] = cA; }
    else pts.push([t, bD, bA, cD, cA]);
  };
  // i contratti chiusi prima del primo campione partono da T0
  push(T0);
  while (i < pool.length || j < ctr.length) {
    if (j < ctr.length && (i >= pool.length || ctr[j].t <= pool[i][0])) {
      const c = ctr[j++];
      if (c.side === 'defender') cD += c.v; else cA += c.v;
      push(c.t);
    } else {
      const s = pool[i++];
      if (prev) { bA += paid(prev, s, 7); bD += paid(prev, s, 8); }
      prev = s;
      push(s[0]);
    }
  }
  if (pts[pts.length - 1][0] < T1) push(T1);

  // La taglia pagata PRIMA del primo campione col salvadanaio (battaglia
  // già aperta al deploy, o al primo sguardo): il minuto per minuto non
  // c'è, ma il totale sì — è quello della testata della scheda (stima
  // dalle classifiche, battleSpending.js). La differenza fra quel totale
  // e il registrato entra come PUNTO DI PARTENZA a bountyFrom, così la
  // fine delle linee coincide con la scheda Nazioni. Segnalato
  // dall'utente il giorno stesso: «i valori sulla timeline non tornano».
  // Solo se la registrazione è partita a battaglia già aperta: se c'era
  // dall'inizio, la differenza sarebbe solo l'errore della stima.
  const bountyFrom = pool.length ? pool[0][0] : null;
  const pre = { defender: 0, attacker: 0 };
  if (bountyFrom != null && bountyNow && createdAt != null && bountyFrom > createdAt + 3 * 60 * 1000) {
    pre.defender = Math.max(0, (bountyNow.defender ?? 0) - bD);
    pre.attacker = Math.max(0, (bountyNow.attacker ?? 0) - bA);
    for (const p of pts) if (p[0] >= bountyFrom) { p[1] += pre.defender; p[2] += pre.attacker; }
  }

  const last = pts[pts.length - 1];
  const total = last[1] + last[2] + last[3] + last[4];
  if (total <= 0) return null;
  return { pts, bountyFrom, pre, hasContracts: ctr.length > 0, total, resets };
}

/* ── Formattazione ────────────────────────────────────────────── */

function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 10000) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(2);
}
function fmtTime(ms, withDay) {
  return new Date(ms).toLocaleString(undefined, withDay
    ? { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }
    : { hour: '2-digit', minute: '2-digit' });
}

/* ── Grafico ──────────────────────────────────────────────────── */

// Zoom, spostamento, riquadro e "allarga" stanno in timelineChart.js: qui
// resta solo dove il grafico si mette nella sezione.

/* ── Sezione ──────────────────────────────────────────────────── */

/* Le due schede ("Timeline battaglia" e "Timeline taglie", richiesta
   dell'utente del 2026-10-20) partono dalla stessa analisi: si rifà per
   ognuna (è qualche millisecondo) invece di tenerne una copia, così non
   c'è niente da invalidare quando una battaglia viva si aggiorna. */
function prepare(tl, { contracts = null, bountyNow = null } = {}) {
  if (!tl || !Array.isArray(tl.s) || tl.s.length < 2) return null;
  const an = analyzeTimeline(tl);
  const T0 = an.S[0][0];
  an.money = analyzeMoney(an.S, contracts, T0, Math.max(an.S[an.S.length - 1][0], T0 + 60000), tl.rounds,
    { bountyNow, createdAt: tl.createdAt ?? null });
  return an;
}

/**
 * Scheda "Timeline battaglia": danno, punti, sorpassi, ingressi.
 * @param tl        risposta di /battle-timeline, o null/undefined
 * @param helpers   { nationName(id), flagHtml(id) } — quelli della scheda;
 *                  `contracts` (aggiudicati, da getBattleDetail) e `bountyNow`
 *                  ({defender, attacker}, la taglia della testata) per i soldi
 */
export function timelineSectionHtml(tl, helpers) {
  const an = prepare(tl, helpers);
  if (!an) return '';
  const { nationName, flagHtml } = helpers;
  const nat = (id) => `${flagHtml(id)}${escapeHtml(nationName(id) || '—')}`;
  // il lato col nome della sua nazione (richiesta dell'utente); "Difesa" /
  // "Attacco" solo se la nazione non c'è (resistenze, tornei)
  const sideLbl = (s) => {
    const id = s === 'attacker' ? tl.attacker : tl.defender;
    return id && nationName(id) ? nat(id) : tlT(s);
  };
  const withDay = _chartDaySpan(an);

  const coverage = tl.baseAt
    ? tlT('coverageBase', { t: escapeHtml(fmtTime(tl.coverageFrom, true)), o: escapeHtml(fmtTime(tl.createdAt, true)) })
    : tlT('coverageFull');
  const anyGap = an.iv.some(v => v.gap);

  const flipsHtml = an.flips.length ? `
    <ol class="wp-btl-tl-flips">
      ${an.flips.map((f, i) => {
        const leader = f.side === 'attacker' ? tl.attacker : tl.defender;
        return `
        <li class="wp-btl-tl-fliprow wp-btl-tl-${f.side}" data-flip="${i}">
          <div class="wp-btl-tl-fliphead">
            <span class="wp-btl-tl-when">${escapeHtml(fmtTime(f.t, withDay))}</span>
            <strong>${tlT('flipLine', { n: nat(leader), r: f.round })}</strong>
          </div>
          ${f.top.length ? `
          <div class="wp-btl-tl-who"><span class="wp-btl-tl-wholbl">${tlT('flipWho')}:</span>
            ${f.top.map(c => `<span class="wp-btl-tl-chip">${nat(c.country)}
              <b>${fmtNum(c.damage)}</b><em>${Math.round(c.share * 100)}%</em>${
              c.isNew ? `<span class="wp-btl-tl-new">${tlT('newBadge')}</span>` : ''}</span>`).join('')}
            <span class="wp-btl-tl-opp">${tlT('flipOpp', { n: fmtNum(f.oppWin) })}</span>
          </div>` : ''}
        </li>`;
      }).join('')}
    </ol>` : `<p class="wp-btl-foot wp-btl-foot-tight">${tlT('flipNone')}</p>`;

  const major = an.entries.filter(e => !e.minor);
  const minorN = an.entries.length - major.length;
  const entriesHtml = an.entries.length ? `
    <div class="wp-btl-tablewrap">
      <table class="wp-btl-table wp-btl-tl-entries">
        <thead><tr>
          <th>${tlT('colEntered')}</th>
          <th>${tlT('colNation')}</th>
          <th>${tlT('colSide')}</th>
          <th class="wp-btl-num">${tlT('colFirst10')}</th>
          <th class="wp-btl-num">${tlT('colShare10')}</th>
          <th class="wp-btl-num">${tlT('colSince')}</th>
        </tr></thead>
        <tbody>
          ${major.map(e => `
            <tr>
              <td class="wp-btl-when">${escapeHtml(fmtTime(e.at, withDay))}</td>
              <td class="wp-btl-nation">${nat(e.country)}</td>
              <td><span class="wp-btl-tl-side wp-btl-tl-${e.side}">${sideLbl(e.side)}</span></td>
              <td class="wp-btl-num">${fmtNum(e.first10)}</td>
              <td class="wp-btl-num">${Math.round(e.share10 * 100)}%</td>
              <td class="wp-btl-num">${fmtNum(e.total)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${minorN ? `<p class="wp-btl-foot wp-btl-foot-tight">${tlT('minorHidden', { n: minorN })}</p>` : ''}`
    : `<p class="wp-btl-foot wp-btl-foot-tight">${tlT('entriesNone')}</p>`;

  return `
    <h3 class="wp-btl-h3">${tlT('title')} <span class="wp-btl-sub">${tlT('sub')}</span></h3>
    <p class="wp-btl-foot wp-btl-foot-tight">${coverage}${tl.live ? ' ' + tlT('liveNote') : ''}</p>
    ${chartBlockHtml(an, tl, { nationName }, 'battle')}
    ${anyGap ? `<p class="wp-btl-foot wp-btl-foot-tight">${tlT('gapNote')}</p>` : ''}

    <h3 class="wp-btl-h3">${tlT('flipsTitle')}</h3>
    ${flipsHtml}

    <h3 class="wp-btl-h3">${tlT('entriesTitle')}</h3>
    ${an.preexisting ? `<p class="wp-btl-foot wp-btl-foot-tight">${tlT('alreadyIn', { n: an.preexisting })}</p>` : ''}
    ${entriesHtml}
    <p class="wp-btl-foot wp-btl-foot-tight">${tlT('precisionNote')}${tl.truncated ? ' ' + tlT('truncatedNote') : ''}</p>`;
}

/**
 * Scheda "Timeline taglie": soldi spesi nel tempo, per lato. '' se la
 * battaglia non ha né taglia registrata né contratti.
 */
export function bountySectionHtml(tl, helpers) {
  const an = prepare(tl, helpers);
  if (!an?.money) return '';
  const { nationName, flagHtml, contractsTruncated = false } = helpers;
  const nat = (id) => `${flagHtml(id)}${escapeHtml(nationName(id) || '—')}`;
  return `
    <h3 class="wp-btl-h3">${tlT('moneyTitle')} <span class="wp-btl-sub">${tlT('moneySub')}</span></h3>
    ${chartBlockHtml(an, tl, { nationName }, 'money')}
    ${moneyNoteHtml(an.money, tl, contractsTruncated, nat)}`;
}

/** Cosa c'è e cosa no nel pannello dei soldi spesi. */
function moneyNoteHtml(m, tl, contractsTruncated, nat) {
  if (!m) return '';
  const parts = [tlT('moneyNote')];
  const late = m.bountyFrom != null && m.bountyFrom > (tl.createdAt || m.bountyFrom) + 3 * 60 * 1000;
  if (m.bountyFrom == null) parts.push(tlT('moneyNoBounty'));
  else if (late && (m.pre.defender > 0 || m.pre.attacker > 0)) {
    const who = (side) => (tl[side] && nat(tl[side])) || tlT(side);
    parts.push(tlT('moneyBountyPre', {
      t: escapeHtml(fmtTime(m.bountyFrom, true)),
      d: `${who('defender')} ${fmtMoney(m.pre.defender)}`,
      a: `${who('attacker')} ${fmtMoney(m.pre.attacker)}`,
    }));
  } else if (late) {
    parts.push(tlT('moneyBountyFrom', { t: escapeHtml(fmtTime(m.bountyFrom, true)) }));
  }
  if (m.resets) parts.push(tlT('moneyResets', { n: m.resets }));
  if (contractsTruncated) parts.push(tlT('moneyCtrTruncated'));
  return `<p class="wp-btl-foot wp-btl-foot-tight">${parts.join(' ')}</p>`;
}

function _chartDaySpan(an) {
  const S = an.S;
  return S.length > 1 && S[S.length - 1][0] - S[0][0] > 20 * 3600 * 1000;
}

/** Gesti del grafico (zoom, spostamento, riquadro): da richiamare a ogni
 *  repaint, l'HTML è nuovo ogni volta. Lo zoom sopravvive ai repaint. */
export function wireTimeline(root) { wireChart(root); }

export function resetTimeline() { resetChart(); }
