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

/* ── Formattazione ────────────────────────────────────────────── */

function fmtNum(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
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

/**
 * @param tl        risposta di /battle-timeline, o null/undefined
 * @param helpers   { nationName(id), flagHtml(id) } — quelli della scheda
 */
export function timelineSectionHtml(tl, { nationName, flagHtml }) {
  if (!tl || !Array.isArray(tl.s) || tl.s.length < 2) return '';
  const an = analyzeTimeline(tl);
  const nat = (id) => `${flagHtml(id)}${escapeHtml(nationName(id) || '—')}`;
  const sideLbl = (s) => s === 'attacker' ? tlT('attacker') : tlT('defender');
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
    ${chartBlockHtml(an, tl, { nationName })}
    ${anyGap ? `<p class="wp-btl-foot wp-btl-foot-tight">${tlT('gapNote')}</p>` : ''}

    <h3 class="wp-btl-h3">${tlT('flipsTitle')}</h3>
    ${flipsHtml}

    <h3 class="wp-btl-h3">${tlT('entriesTitle')}</h3>
    ${an.preexisting ? `<p class="wp-btl-foot wp-btl-foot-tight">${tlT('alreadyIn', { n: an.preexisting })}</p>` : ''}
    ${entriesHtml}
    <p class="wp-btl-foot wp-btl-foot-tight">${tlT('precisionNote')}${tl.truncated ? ' ' + tlT('truncatedNote') : ''}</p>`;
}

function _chartDaySpan(an) {
  const S = an.S;
  return S.length > 1 && S[S.length - 1][0] - S[0][0] > 20 * 3600 * 1000;
}

/** Gesti del grafico (zoom, spostamento, riquadro): da richiamare a ogni
 *  repaint, l'HTML è nuovo ogni volta. Lo zoom sopravvive ai repaint. */
export function wireTimeline(root) { wireChart(root); }

export function resetTimeline() { resetChart(); }
