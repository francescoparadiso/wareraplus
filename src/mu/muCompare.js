/* ══════════════════════════════════════════════════════════════
   WarEra+ — Unità Militari: confronto 1 vs 1
   ------------------------------------------------------------------
   Un'unità contro un'altra. Nato con la grafica del "1 vs 2" delle
   nazioni; dal 2026-10-18 nello stile del versus dei giocatori, comune a
   tutti i confronti (src/shared/versus.js + src/styles/versus.css):
   richiesta dell'utente, «unifica lo stile di tutti i 1 vs 1 su quello
   dei giocatori, che è il più bello».

   Qui i lati sono UNA unità ciascuno: niente somme né medie, il dubbio
   del confronto fra nazioni non si pone.

   DUE FONTI:
     · la directory in memoria (src/mu/api.js): le sei classifiche, i
       membri, composizione e stile di gioco. Zero fetch. Senza server di
       cache lo stile di gioco manca e il suo gruppo non compare (mai zeri
       inventati);
     · /mu-damage-history (server/muBattleDamage.js), per «DANNI NEL
       TEMPO»: la domanda che ha fatto nascere la sezione è «da quando sono
       nati i Praetorians, hanno fatto più danni loro o gli Hospitaller?».
       Una richiesta per coppia. Il server vecchio risponde 404 e il
       gruppo non compare.

   ⚠️ Il giorno dello storico è quello in cui FINISCE la battaglia (UTC):
   giorno per giorno è rumoroso (una battaglia dura anche un giorno), la
   settimana e il cumulato no. Per questo i grafici sono il DISTACCO
   cumulato e le SETTIMANE, mai barre giornaliere — e la nota lo dice.
   Il periodo di partenza è «da quando esistono entrambe» (la nascita
   della più giovane), tagliato a `coverageFrom` del server: prima di
   quella data il dato non c'è e non si disegna, dichiarandolo.

   Il punteggio in cima conta le classifiche di adesso; i danni nel
   tempo hanno il loro parziale nel titolo del riquadro, perché arrivano
   dopo e il punteggio non deve cambiare sotto gli occhi.

   SELEZIONE: due elenchi, uno per lato, con la loro ricerca (stessa
   scelta delle nazioni: si aggiunge dove si intende aggiungere). Un'unità
   scelta da una parte che si sceglie dall'altra si SPOSTA. Di partenza
   l'elenco mostra le prime per danno settimanale.
   ══════════════════════════════════════════════════════════════ */

import '../styles/nations.css';    // i due elenchi di scelta (wp-nat-picker)
import { vsRow, vsGroup, vsTally, vsFighter, vsHero, countUpScore } from '../shared/versus.js';
import { animationsOn } from '../shared/motion.js';
import { MU_RANKING_TYPES, fetchMuDamageHistory } from './api.js';
import { muT } from './i18n.js';
import { avatarImg, countryName, dominantCountry, escapeHtml, flagImg, fmtCompact, fmtDate, tierBadge } from './ui.js';

const PICK_LIMIT = 40;
const DAY_MS = 86400000;

const sost = (s, vars) => Object.entries(vars).reduce((t, [k, v]) => t.split('{' + k + '}').join(String(v)), s);
const rv = (m, type) => m?.rankings?.[type]?.value ?? 0;
const rk = (m, type) => m?.rankings?.[type]?.rank;
const weekly = m => rv(m, 'muWeeklyDamages');
const perMember = (v, m) => (m.memberCount ? v / m.memberCount : 0);
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const lang = () => document.documentElement.lang || undefined;
/** Come fmtCompact, ma i miliardi con due decimali: due unità a 1,93 e
 *  1,99 miliardi non devono leggersi "1,9G contro 2G". */
const fmtBig = (v) => (Math.abs(v) >= 1e9
  ? `${(v / 1e9).toLocaleString(lang(), { maximumFractionDigits: 2 })}G` : fmtCompact(v));

// Stato del modulo: sopravvive ai ridisegni (la ricerca ridisegna a ogni
// lettera) ma non deve rifare intro e richieste.
let _lastPair = null;             // l'ultima coppia completa disegnata: l'intro parte solo su una nuova
let _period = 'both';             // 'both' | '90' | '30' | 'all'
const _hist = new Map();          // chiave coppia → dati del server | null (non c'è) ; assente = in arrivo

/* ── Ritratti ─────────────────────────────────────────────────── */

function fighterHtml(m, side, leader) {
  if (!m) {
    return vsFighter({
      side,
      avatar: `<span class="wp-vs-av wp-vs-av-empty">?</span>`,
      name: `<span class="wp-vs-name wp-vs-name-empty">${escapeHtml(muT(side === 'a' ? 'cmpUnitA' : 'cmpUnitB'))}</span>`,
      sub: escapeHtml(muT('cmpEmpty')),
    });
  }
  const dom = dominantCountry(m);
  const defacto = dom?.foreign
    ? `<span class="wp-mu-cmp-defacto">${flagImg(dom.country)} ${escapeHtml(muT('deFacto'))}</span>` : '';
  return vsFighter({
    side, leader,
    avatar: avatarImg(m.avatarUrl, m.name, 'wp-vs-av'),
    name: `<button type="button" class="wp-vs-name" data-open="${escapeHtml(m._id)}" title="${escapeHtml(muT('cmpOpen'))}">${escapeHtml(m.name)}</button>`,
    lines: [
      `<span class="wp-vs-meta">${flagImg(m.country)}<span>${escapeHtml(countryName(m.country))}</span>${defacto}</span>`,
    ],
    tags: [
      `<span class="wp-vs-lv">${escapeHtml(muT('members'))} ${m.memberCount ?? '—'}</span>`,
      tierBadge(m.rankings?.muWeeklyDamages),
    ],
    sub: m.createdAt ? escapeHtml(sost(muT('cmpFounded'), { d: fmtDate(m.createdAt) })) : '',
  });
}

/* ── Le misure di adesso ──────────────────────────────────────── */

function rankingRow(a, b, type) {
  const sub = (m) => (rk(m, type) ? `#${rk(m, type)}` : '');
  return vsRow(muT(type), rv(a, type), rv(b, type), { fmt: fmtCompact, subA: sub(a), subB: sub(b) });
}

function measureGroups(a, b) {
  const groups = [
    { title: muT('cmpGroupDmg'), icon: '⚔', rows: [
      rankingRow(a, b, 'muWeeklyDamages'),
      rankingRow(a, b, 'muDamages'),
      vsRow(muT('cmpDmgPerMember'), perMember(weekly(a), a), perMember(weekly(b), b), { fmt: fmtCompact }),
      rankingRow(a, b, 'muBounty'),
      rankingRow(a, b, 'muTerrain'),
    ] },
    { title: muT('cmpGroupSize'), icon: '💰', rows: [
      vsRow(muT('members'), a.memberCount ?? 0, b.memberCount ?? 0),
      rankingRow(a, b, 'muWealth'),
      vsRow(muT('cmpWealthPerMember'), perMember(rv(a, 'muWealth'), a), perMember(rv(b, 'muWealth'), b), { fmt: fmtCompact }),
      rankingRow(a, b, 'muReputation'),
    ] },
  ];
  // Le classifiche che il modulo conosce ma che qui sopra non compaiono
  // (se un giorno MU_RANKING_TYPES cresce) finiscono nel primo gruppo:
  // meglio una riga in più che una misura sparita in silenzio.
  const shown = new Set(['muWeeklyDamages', 'muDamages', 'muBounty', 'muTerrain', 'muWealth', 'muReputation']);
  for (const type of MU_RANKING_TYPES) if (!shown.has(type)) groups[0].rows.push(rankingRow(a, b, type));

  // Come giocano i membri: le QUOTE sono neutre, i CONTEGGI no (più
  // giocatori da guerra = più forza in battaglia).
  const pa = a.playstyle, pb = b.playstyle;
  if (pa?.known && pb?.known) {
    const pct = v => v.toFixed(1) + '%';
    const q = (p, k) => ((p[k] || 0) / p.known) * 100;
    groups.push({ title: muT('cmpBuilds'), icon: '🎯', rows: [
      vsRow(muT('cmpWarN'), pa.war || 0, pb.war || 0),
      vsRow(muT('cmpEcoN'), pa.eco || 0, pb.eco || 0),
      vsRow(muT('cmpWarPct'), q(pa, 'war'), q(pb, 'war'), { fmt: pct, neutral: true }),
      vsRow(muT('cmpEcoPct'), q(pa, 'eco'), q(pb, 'eco'), { fmt: pct, neutral: true }),
      vsRow(muT('cmpHybN'), pa.mixed || 0, pb.mixed || 0, { neutral: true }),
    ] });
  }
  return groups;
}

/* ── Danni nel tempo ──────────────────────────────────────────── */

const pairKey = (a, b) => [a._id, b._id].sort().join(',');
const utcDay = (ms) => new Date(ms).toISOString().slice(0, 10);
const dayMs = (d) => Date.parse(d + 'T00:00:00Z');
const fmtDay = (d) => new Date(dayMs(d)).toLocaleDateString(lang(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
/** Lunedì (UTC) della settimana di un giorno. */
const weekOf = (d) => { const t = dayMs(d); const dow = (new Date(t).getUTCDay() + 6) % 7; return utcDay(t - dow * DAY_MS); };

/** Tutto quello che i due grafici e le quattro righe devono sapere. */
function histModel(a, b, data) {
  const today = utcDay(Date.now());
  const cov = data.coverageFrom || null;
  const series = (id) => new Map((data.data?.[id] || []).map(([d, v]) => [d, Number(v) || 0]));
  const sa = series(a._id), sb = series(b._id);

  const born = [a, b].map(m => Date.parse(m.createdAt || '')).filter(Number.isFinite);
  const wanted = _period === 'both' ? (born.length ? utcDay(Math.max(...born)) : cov)
    : _period === 'all' ? cov
    : utcDay(Date.now() - (Number(_period) - 1) * DAY_MS);
  let start = wanted || cov || today;
  const clipped = !!(cov && start < cov);
  if (clipped) start = cov;
  if (start > today) start = today;

  const days = [];
  for (let t = dayMs(start); t <= dayMs(today); t += DAY_MS) days.push(utcDay(t));
  let ca = 0, cb = 0;
  const cum = days.map(d => { ca += sa.get(d) || 0; cb += sb.get(d) || 0; return { d, a: ca, b: cb, gap: ca - cb }; });

  const weeks = [];
  for (const d of days) {
    const w = weekOf(d);
    let row = weeks[weeks.length - 1];
    if (!row || row.w !== w) weeks.push(row = { w, a: 0, b: 0, from: d, to: d });
    row.a += sa.get(d) || 0; row.b += sb.get(d) || 0; row.to = d;
  }
  const lastWeek = weeks[weeks.length - 1];
  if (lastWeek) lastWeek.live = true;   // la settimana di oggi è sempre a metà

  // Media al giorno sulle ultime due settimane INTERE di giorni (oggi escluso).
  const avg = (s) => { let t = 0; for (let k = 1; k <= 14; k++) t += s.get(utcDay(Date.now() - k * DAY_MS)) || 0; return t / 14; };

  return {
    start, wanted, clipped, cov, days, cum, weeks,
    totA: ca, totB: cb,
    avgA: avg(sa), avgB: avg(sb),
    winsA: weeks.filter(w => w.a > w.b).length, winsB: weeks.filter(w => w.b > w.a).length,
    bestA: Math.max(0, ...weeks.map(w => w.a)), bestB: Math.max(0, ...weeks.map(w => w.b)),
  };
}

/** Tre-quattro valori "tondi" per l'asse, fra lo zero e il massimo. */
function niceTicks(lo, hi, n = 4) {
  const span = hi - lo || 1;
  const raw = span / n, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map(k => k * mag).find(s => s >= raw) || raw;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi + 1e-9; v += step) out.push(v);
  return out;
}

/** Etichette dell'asse dei tempi: il primo del mese se il periodo è
 *  lungo, i lunedì se è corto. Mai più di ~8. */
function timeTicks(days) {
  const monthly = days.length > 50;
  let idx = days.map((d, i) => (monthly ? d.endsWith('-01') : new Date(dayMs(d)).getUTCDay() === 1) ? i : -1).filter(i => i >= 0);
  const every = Math.ceil(idx.length / 8) || 1;
  idx = idx.filter((_, k) => k % every === 0);
  return idx;
}

/** Il distacco cumulato: sopra lo zero è avanti A (nel suo colore), sotto
 *  B. Una linea sola, colorata dalla parte in cui sta, con l'area sotto. */
function gapSvg(model, a, b, W) {
  const H = 230, L = 52, R = 14, T = 22, B = 26;
  const pts = model.cum;
  const n = pts.length;
  const lo = Math.min(0, ...pts.map(p => p.gap)), hi = Math.max(0, ...pts.map(p => p.gap));
  // Sempre un po' di spazio da ENTRAMBE le parti dello zero: ci vanno le
  // due scritte "chi è avanti", anche quando uno non lo è mai stato.
  const span = hi - lo || 1;
  const y0 = Math.min(lo - span * 0.1, -span * 0.16), y1 = Math.max(hi + span * 0.1, span * 0.16);
  const x = i => L + (n > 1 ? (i * (W - L - R)) / (n - 1) : (W - L - R) / 2);
  const y = v => T + ((y1 - v) / (y1 - y0 || 1)) * (H - T - B);
  const zy = y(0);

  let s = '';
  for (const v of niceTicks(y0, y1)) {
    s += `<line class="wp-vs-cgrid${v === 0 ? ' wp-vs-czero' : ''}" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`
      + `<text class="wp-vs-ctick" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${escapeHtml(v === 0 ? '0' : fmtCompact(Math.abs(v)))}</text>`;
  }
  for (const i of timeTicks(model.days)) {
    s += `<text class="wp-vs-ctick" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${escapeHtml(fmtDay(model.days[i]))}</text>`;
  }
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.gap).toFixed(1)}`).join('');
  const area = `${line}L${x(n - 1).toFixed(1)},${zy.toFixed(1)}L${x(0).toFixed(1)},${zy.toFixed(1)}Z`;
  const id = 'wpvsg' + Math.random().toString(36).slice(2, 8);
  s += `<defs>
      <clipPath id="${id}a"><rect x="0" y="0" width="${W}" height="${zy.toFixed(1)}"/></clipPath>
      <clipPath id="${id}b"><rect x="0" y="${zy.toFixed(1)}" width="${W}" height="${H}"/></clipPath>
    </defs>
    <path d="${area}" class="wp-vs-carea-a" clip-path="url(#${id}a)"/>
    <path d="${area}" class="wp-vs-carea-b" clip-path="url(#${id}b)"/>
    <path d="${line}" class="wp-vs-cline-a" clip-path="url(#${id}a)"/>
    <path d="${line}" class="wp-vs-cline-b" clip-path="url(#${id}b)"/>`;

  // Da che parte sta chi: le due scritte nei colori dei lati, a sinistra.
  s += `<text class="wp-vs-cside wp-vs-cside-a" x="${L + 8}" y="${(T + 14).toFixed(1)}">▲ ${escapeHtml(a.name)}</text>`
    + `<text class="wp-vs-cside wp-vs-cside-b" x="${L + 8}" y="${(H - B - 8).toFixed(1)}">▼ ${escapeHtml(b.name)}</text>`;

  // Due annotazioni al massimo: il picco di chi è stato più avanti e il
  // valore di oggi. Il picco solo se non coincide quasi con oggi. La
  // scritta va dalla parte opposta a dove arriva la linea, se no ci finisce
  // sopra: il picco verso fuori, "oggi" dal lato da cui la linea NON viene.
  const last = pts[n - 1];
  const peakI = pts.reduce((bi, p, i) => (Math.abs(p.gap) > Math.abs(pts[bi].gap) ? i : bi), 0);
  const note = (i, text, anchor, above) => {
    const p = pts[i];
    return `<circle class="${p.gap >= 0 ? 'wp-vs-cdot-a' : 'wp-vs-cdot-b'}" cx="${x(i).toFixed(1)}" cy="${y(p.gap).toFixed(1)}" r="4.5"/>`
      + `<text class="wp-vs-cnote" x="${(x(i) + (anchor === 'start' ? 8 : -6)).toFixed(1)}" y="${(y(p.gap) + (above ? -11 : 19)).toFixed(1)}" text-anchor="${anchor}">${escapeHtml(text)}</text>`;
  };
  const who = (g) => (g >= 0 ? a.name : b.name);
  if (pts[peakI].gap !== 0 && peakI < n - Math.max(3, n * 0.15)) {
    s += note(peakI, sost(muT('cmpPeak'), { v: `${who(pts[peakI].gap)} +${fmtBig(Math.abs(pts[peakI].gap))}`, d: fmtDay(pts[peakI].d) }), peakI > n * 0.6 ? 'end' : 'start', pts[peakI].gap >= 0);
  }
  if (n > 1) {
    const before = pts[Math.max(0, n - 1 - Math.max(2, Math.round(n * 0.06)))].gap;
    s += note(n - 1, sost(muT('cmpNow'), { v: last.gap === 0 ? '0' : `${who(last.gap)} +${fmtBig(Math.abs(last.gap))}` }), 'end', before <= last.gap);
  }

  // Il livello del passaggio del mouse: linea verticale + riquadro, che
  // mountHist muove. I dati gli arrivano in data-*.
  s += `<line class="wp-vs-chair" x1="0" x2="0" y1="${T}" y2="${H - B}" style="display:none"/>
    <rect class="wp-vs-chit" x="${L}" y="${T}" width="${W - L - R}" height="${H - T - B}"/>`;
  return `<svg class="wp-vs-chart" data-kind="gap" data-l="${L}" data-r="${R}" data-n="${n}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeHtml(muT('cmpGapTitle'))}">${s}</svg>`;
}

/** Le settimane, barre affiancate A/B. La settimana in corso più tenue. */
function weeksSvg(model, a, b, W) {
  const H = 210, L = 52, R = 8, T = 16, B = 26;
  const ws = model.weeks;
  const n = ws.length || 1;
  const hi = Math.max(1, ...ws.map(w => Math.max(w.a, w.b))) * 1.12;
  const slot = (W - L - R) / n;
  const bw = Math.max(3, Math.min(22, slot * 0.36));
  const y = v => T + ((hi - v) / hi) * (H - T - B);
  const base = y(0);
  let s = '';
  for (const v of niceTicks(0, hi)) {
    s += `<line class="wp-vs-cgrid" x1="${L}" x2="${W - R}" y1="${y(v).toFixed(1)}" y2="${y(v).toFixed(1)}"/>`
      + `<text class="wp-vs-ctick" x="${L - 8}" y="${(y(v) + 4).toFixed(1)}" text-anchor="end">${escapeHtml(fmtCompact(v))}</text>`;
  }
  const bar = (cx, v, cls, title) => {
    const top = y(v), h = base - top, r = Math.min(4, h, bw / 2);
    if (h <= 0.5) return '';
    return `<path class="${cls}" d="M${cx.toFixed(1)},${base.toFixed(1)}V${(top + r).toFixed(1)}Q${cx.toFixed(1)},${top.toFixed(1)} ${(cx + r).toFixed(1)},${top.toFixed(1)}H${(cx + bw - r).toFixed(1)}Q${(cx + bw).toFixed(1)},${top.toFixed(1)} ${(cx + bw).toFixed(1)},${(top + r).toFixed(1)}V${base.toFixed(1)}Z"><title>${escapeHtml(title)}</title></path>`;
  };
  const every = Math.ceil(n / 8);
  ws.forEach((w, i) => {
    const c = L + slot * i + slot / 2;
    const when = `${fmtDay(w.from)} – ${fmtDay(w.to)}${w.live ? ` (${muT('cmpLive')})` : ''}`;
    const live = w.live ? ' wp-vs-cbar-live' : '';
    s += bar(c - bw - 1, w.a, `wp-vs-cbar-a${live}`, `${a.name} · ${when}: ${fmtCompact(w.a)}`)
      + bar(c + 1, w.b, `wp-vs-cbar-b${live}`, `${b.name} · ${when}: ${fmtCompact(w.b)}`);
    if (i % every === 0 || i === n - 1) {
      s += `<text class="wp-vs-ctick" x="${c.toFixed(1)}" y="${H - 6}" text-anchor="middle">${escapeHtml(w.live ? muT('cmpLive') : fmtDay(w.from))}</text>`;
    }
  });
  return `<svg class="wp-vs-chart" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" role="img" aria-label="${escapeHtml(muT('cmpWeeksTitle'))}">${s}</svg>`;
}

function histGroupHtml(a, b, W) {
  const key = pairKey(a, b);
  if (!_hist.has(key)) {
    return vsGroup({ title: muT('cmpHist'), icon: '📈', g: 3, score: false, id: 'wp-mu-cmp-hist',
      body: `<div class="wp-vs-empty">${escapeHtml(muT('cmpHistLoading'))}</div>` });
  }
  const data = _hist.get(key);
  if (!data) return '';   // server senza la rotta: il gruppo non c'è

  const m = histModel(a, b, data);
  const chips = ['both', '90', '30', 'all'].map(p => `<button type="button" class="wp-vs-chip${_period === p ? ' on' : ''}" data-period="${p}">${escapeHtml(muT({ both: 'cmpPerBoth', 90: 'cmpPer90', 30: 'cmpPer30', all: 'cmpPerAll' }[p]))}</button>`).join('');

  const notes = [];
  if (data.backfill?.pending > 0 && m.cov) notes.push(sost(muT('cmpHistFilling'), { n: data.backfill.pending.toLocaleString(lang()), d: fmtDay(m.cov) }));
  else if (m.clipped) notes.push(sost(muT('cmpHistCoverage'), { d: fmtDay(m.cov) }));
  notes.push(muT('cmpHistNote'));

  const rows = [
    vsRow(muT('cmpHistTotal'), m.totA, m.totB, { fmt: fmtBig }),
    vsRow(muT('cmpHistAvg14'), m.avgA, m.avgB, { fmt: fmtCompact }),
    vsRow(muT('cmpHistWeeks'), m.winsA, m.winsB),
    vsRow(muT('cmpHistBestWeek'), m.bestA, m.bestB, { fmt: fmtCompact }),
  ];
  const empty = !m.totA && !m.totB;
  const legend = `<div class="wp-vs-legend"><span><i class="wp-vs-key-a"></i>${escapeHtml(a.name)}</span><span><i class="wp-vs-key-b"></i>${escapeHtml(b.name)}</span></div>`;
  const body = `
    <div class="wp-vs-periods">${chips}</div>
    ${empty ? `<div class="wp-vs-empty">${escapeHtml(muT('cmpHistEmpty'))}</div>` : `
    <div class="wp-vs-cblock">
      <div class="wp-vs-ctitle">${escapeHtml(muT('cmpGapTitle'))} <span>· ${escapeHtml(sost(muT('cmpGapSub'), { d: fmtDay(m.start) }))}</span></div>
      <div class="wp-vs-cwrap">${gapSvg(m, a, b, W)}<div class="wp-vs-ctip" hidden></div></div>
    </div>
    <div class="wp-vs-cblock">
      <div class="wp-vs-ctitle">${escapeHtml(muT('cmpWeeksTitle'))}</div>
      ${legend}
      <div class="wp-vs-cwrap">${weeksSvg(m, a, b, W)}</div>
    </div>`}
    ${notes.map(t => `<p class="wp-vs-note">${escapeHtml(t)}</p>`).join('')}`;
  return vsGroup({ title: muT('cmpHist'), icon: '📈', g: 3, rows: empty ? [] : rows, body, id: 'wp-mu-cmp-hist' });
}

/** Larghezza utile dei grafici: quella vera del riquadro, così il testo
 *  dell'SVG resta a 1:1 anche su un telefono. */
function chartWidth(host) {
  const w = host.querySelector('.wp-vs')?.clientWidth || host.clientWidth || 900;
  return Math.max(300, Math.round(w - 40));
}

/** Disegna (o ridisegna) solo il riquadro dei danni nel tempo e lo collega. */
function mountHist(host, a, b, ctx) {
  const old = host.querySelector('#wp-mu-cmp-hist');
  const html = histGroupHtml(a, b, chartWidth(host));
  if (old) {
    if (!html) { old.remove(); return; }
    const tmp = document.createElement('div');
    tmp.innerHTML = html.trim();
    old.replaceWith(tmp.firstElementChild);
  }
  const box = host.querySelector('#wp-mu-cmp-hist');
  if (!box) return;

  box.querySelectorAll('[data-period]').forEach(el => el.addEventListener('click', () => {
    _period = el.dataset.period;
    ctx.onTrack?.('mu-compare-period', { period: _period });
    mountHist(host, a, b, ctx);
  }));

  // Passaggio del mouse sul distacco: data, i due cumulati, chi è avanti.
  const svg = box.querySelector('svg[data-kind="gap"]');
  const tip = box.querySelector('.wp-vs-ctip');
  const data = _hist.get(pairKey(a, b));
  if (!svg || !tip || !data) return;
  const model = histModel(a, b, data);
  const hair = svg.querySelector('.wp-vs-chair');
  const L = Number(svg.dataset.l), R = Number(svg.dataset.r), n = model.cum.length;
  const W = svg.viewBox.baseVal.width;
  const move = (ev) => {
    const r = svg.getBoundingClientRect();
    const sx = ((ev.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(n - 1, Math.round(((sx - L) / (W - L - R)) * (n - 1))));
    const p = model.cum[i];
    const px = L + (n > 1 ? (i * (W - L - R)) / (n - 1) : 0);
    hair.setAttribute('x1', px); hair.setAttribute('x2', px); hair.style.display = '';
    const lead = p.gap === 0 ? muT('cmpEven') : `${p.gap > 0 ? a.name : b.name} +${fmtCompact(Math.abs(p.gap))}`;
    tip.innerHTML = `<b>${escapeHtml(fmtDay(p.d))}</b>`
      + `<span><i class="wp-vs-key-a"></i>${escapeHtml(a.name)} ${escapeHtml(fmtBig(p.a))}</span>`
      + `<span><i class="wp-vs-key-b"></i>${escapeHtml(b.name)} ${escapeHtml(fmtBig(p.b))}</span>`
      + `<em>${escapeHtml(lead)}</em>`;
    tip.hidden = false;
    const left = (px / W) * r.width;
    tip.style.left = `${Math.min(Math.max(left, 70), r.width - 70)}px`;
  };
  svg.addEventListener('mousemove', move);
  svg.addEventListener('mouseleave', () => { tip.hidden = true; hair.style.display = 'none'; });
}

/* ── Elenchi di scelta ────────────────────────────────────────── */

function pickerHtml(directory, side, cmp) {
  const query = side === 'a' ? cmp.qA : cmp.qB;
  const q = norm(query);
  const items = directory
    .filter(m => !q || norm(m.name).includes(q))
    .sort((x, y) => weekly(y) - weekly(x))
    .slice(0, PICK_LIMIT)
    .map(m => {
      const cur = m._id === cmp.a ? 'a' : m._id === cmp.b ? 'b' : '';
      return `
        <button type="button" class="wp-nat-pick${cur ? ` wp-nat-pick-${cur}` : ''}" data-mu="${escapeHtml(m._id)}" data-side="${side}">
          ${avatarImg(m.avatarUrl, m.name, 'wp-mu-avatar wp-mu-avatar-sm')}
          <span class="wp-nat-pick-name">${escapeHtml(m.name)}</span>
          ${flagImg(m.country)}
          <span class="wp-nat-pick-val">${escapeHtml(fmtCompact(weekly(m)))}</span>
        </button>`;
    }).join('');
  const chosen = side === 'a' ? cmp.a : cmp.b;
  return `
    <div class="wp-nat-picker wp-nat-picker-${side}">
      <h4>${escapeHtml(muT(side === 'a' ? 'cmpUnitA' : 'cmpUnitB'))}${chosen ? ` <button type="button" class="wp-vs-chip wp-vs-clear" data-clear="${side}">✕ ${escapeHtml(muT('cmpClear'))}</button>` : ''}</h4>
      <input type="search" id="wp-mu-cmp-search-${side}" class="wp-nat-search" data-side="${side}"
             placeholder="${escapeHtml(muT('cmpSearch'))}" value="${escapeHtml(query || '')}">
      <div class="wp-nat-picker-grid">${items || `<span class="wp-nat-empty-inline">${escapeHtml(muT('noResults'))}</span>`}</div>
    </div>`;
}

/**
 * @param {HTMLElement} host
 * @param {{ directory: object[], cmp: { a, b, qA, qB, focus },
 *   onPick: (side, id) => void, onClear: (side) => void, onSwap: () => void,
 *   onSearch: (side, q) => void, onOpenMu: (id) => void,
 *   onTrack?: (name, data) => void }} ctx
 */
export function renderMuCompare(host, ctx) {
  const { directory, cmp } = ctx;
  const a = cmp.a ? directory.find(m => m._id === cmp.a) : null;
  const b = cmp.b ? directory.find(m => m._id === cmp.b) : null;
  const swap = `<button type="button" class="wp-vs-chip" id="wp-mu-cmp-swap" title="${escapeHtml(muT('cmpSwap'))}"${a || b ? '' : ' disabled'}>⇄ ${escapeHtml(muT('cmpSwap'))}</button>`;

  let section;
  let intro = false;
  if (a && b) {
    const groups = measureGroups(a, b);
    const t = vsTally(groups.flatMap(g => g.rows));
    const verdict = t.a === t.b
      ? sost(muT('cmpTie'), { n: t.a })
      : sost(muT('cmpLead'), { name: (t.a > t.b ? a : b).name, n: Math.max(t.a, t.b), t: t.tot });
    // L'intro solo la prima volta che QUESTA coppia si vede: la ricerca
    // ridisegna a ogni lettera, e le barre ripartirebbero ogni volta. Lo
    // scambio dei lati è la stessa coppia: niente intro.
    const key = pairKey(a, b);
    if (key !== _lastPair) { _lastPair = key; intro = animationsOn(); }
    section = `
      <section class="wp-vs${intro ? ' wp-vs-intro' : ''}">
        ${vsHero({ a: fighterHtml(a, 'a', t.a > t.b), b: fighterHtml(b, 'b', t.b > t.a), winsA: t.a, winsB: t.b, verdict, intro, center: swap })}
        ${groups.map((g, gi) => vsGroup({ ...g, g: gi })).join('')}
        ${histGroupHtml(a, b, 900)}
      </section>`;
  } else {
    section = `
      <section class="wp-vs">
        ${vsHero({ a: fighterHtml(a, 'a'), b: fighterHtml(b, 'b'), winsA: 0, winsB: 0, verdict: muT('cmpPick'), center: swap, score: false })}
      </section>`;
  }

  host.innerHTML = `
    <div class="wp-mu-cmp wp-vs-scope">
      ${section}
      <div class="wp-nat-pickers">
        ${pickerHtml(directory, 'a', cmp)}
        ${pickerHtml(directory, 'b', cmp)}
      </div>
    </div>`;

  if (intro) countUpScore(host);

  if (a && b) {
    // I grafici col disegno vero della larghezza, adesso che il riquadro c'è.
    mountHist(host, a, b, ctx);
    const key = pairKey(a, b);
    if (!_hist.has(key)) {
      fetchMuDamageHistory([a._id, b._id]).then(data => {
        _hist.set(key, data);
        // Ridisegna solo se si sta ancora guardando la stessa coppia.
        if (host.isConnected && host.querySelector('#wp-mu-cmp-hist') && cmp.a && cmp.b && pairKey({ _id: cmp.a }, { _id: cmp.b }) === key) {
          mountHist(host, a, b, ctx);
        }
      });
    }
  }

  host.querySelectorAll('.wp-nat-pick[data-mu]').forEach(el => {
    el.addEventListener('click', () => ctx.onPick(el.dataset.side, el.dataset.mu));
  });
  host.querySelectorAll('[data-clear]').forEach(el => {
    el.addEventListener('click', () => ctx.onClear(el.dataset.clear));
  });
  host.querySelectorAll('[data-open]').forEach(el => {
    el.addEventListener('click', () => ctx.onOpenMu(el.dataset.open));
  });
  host.querySelector('#wp-mu-cmp-swap')?.addEventListener('click', () => ctx.onSwap());

  ['a', 'b'].forEach(side => {
    const input = host.querySelector(`#wp-mu-cmp-search-${side}`);
    if (!input) return;
    input.addEventListener('input', e => ctx.onSearch(side, e.target.value));
    // Il render ricostruisce l'HTML: senza questo il cursore uscirebbe
    // dalla casella a ogni lettera (stesso trattamento delle nazioni).
    if (cmp.focus === side) {
      input.focus();
      input.setSelectionRange(input.value.length, input.value.length);
    }
  });
}
