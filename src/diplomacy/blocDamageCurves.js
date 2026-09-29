/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche alleanze: danno ora per ora e pillati
   ------------------------------------------------------------------
   Richiesta dell'utente: «nella schermata delle stat alleanze vorrei
   vedere anche il totale dei pillati e dei danni orari, come già c'è per
   le nazioni» — e poi «voglio poter sovrapporre i grafici di due
   alleanze».

   Stessi due grafici della scheda nazione (src/nations/damageCurves.js),
   per un GRUPPO di nazioni:
     · nella scheda di un'alleanza (showBlocPopup) un gruppo solo:
       area del danno all'ora + linea dei pillati, come per le nazioni;
     · nel "Fazione 1 vs 2" due gruppi sullo STESSO riquadro e sugli
       stessi assi: danno a linea piena, pillati a puntini, ognuno nel
       colore della sua fazione. Assi comuni di proposito — con due scale
       diverse due curve di grandezza diversa sembrerebbero pari.

   ── DA DOVE VENGONO I NUMERI ─────────────────────────────────────
   /damage-timeline?countryIds=a,b,c: il server somma le nazioni in una
   risposta sola (vedi readTimeline in server/damageTimeline.js). La
   risposta RIPETE `countryIds`, ed è l'unico modo di riconoscere un
   server vecchio: quello ignora il parametro e risponde col MONDO, che
   disegnato qui passerebbe per il danno dell'alleanza. Se l'eco manca si
   ricade sulle nazioni una per una, sommate qui: ogni nazione si
   scarica UNA volta per sessione (tre alleanze per lato sono facilmente
   quaranta nazioni, e aggiungerne una quarta deve scaricare solo le sue),
   al massimo FALLBACK_PARALLEL richieste per volta.

   ── LE STESSE REGOLE DELLA VISTA NAZIONE ─────────────────────────
     · un'ora senza misura (`d: null`) è un BUCO, la linea si spezza —
       mai uno zero ("hanno smesso di sparare" sarebbe falso);
     · il danno orario accumula dal deploy del server: la fascia in cima
       lo dice finché non ci sono 14 giorni;
     · le ultime ore dei pillati possono ancora crescere (settledUntil):
       quel tratto è attenuato, non spacciato per un calo.

   ── SOLO PER I GOVERNI P.A.S.T.A. ───────────────────────────────
   Richiesta dell'utente (2026-09-29): questi grafici li vede solo chi è
   entrato con Discord, ha collegato il personaggio, è di una nazione
   dell'alleanza (`nazione.abilitata` di /roles/me, il filtro dell'area
   riservata) E siede nel governo — presidente, vice o ministro, cioè
   `capacita.gestisceNazione` non vuota, lo stesso criterio che apre "La
   mia nazione" (il congresso no). Più gli amministratori del tool. Il
   cittadino comune P.A.S.T.A. no: prima bastava la cittadinanza, poi
   ristretto lo stesso giorno. Senza token NON parte nessuna richiesta:
   Statistiche alleanze la apre chiunque, come la vista unità per il
   Bilancio. Agli altri la sezione semplicemente non c'è.
   ⚠️ È un cancello di INTERFACCIA: la serie per nazione resta pubblica
   (/damage-timeline sul cache-server, la usa la scheda nazione), quindi
   qui si decide cosa mostrare, non si protegge un dato segreto.
   ══════════════════════════════════════════════════════════════ */

import { WARERA_CACHE_BASE } from './config.js';
import { bT } from './blocStatsI18n.js';
import { getToken, leggiRuoli } from '../private/api.js';

const HOUR_MS = 3600 * 1000;
const RANGES = [24, 48, 72];
const RANGE_KEY = 'we_bloc_curve_hours';
const PILL_COLOR = '#a371f7';
const FALLBACK_PARALLEL = 6;
const TIMEOUT_MS = 8000;

let _hours = (() => {
  try {
    const v = Number(localStorage.getItem(RANGE_KEY));
    return RANGES.includes(v) ? v : 48;
  } catch { return 48; }
})();

/* ── Dati ──────────────────────────────────────────────────────── */

const _cache = new Map();   // chiave (id ordinati) → Promise<timeline|null>

async function cacheJson(path) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}${path}`, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

const qs = (extra) => new URLSearchParams({ hours: String(Math.max(...RANGES)), days: '14', ...extra });

/** Serie sommata di un gruppo di nazioni, o null (server giù, gruppo
 *  sconosciuto). */
export function fetchGroupTimeline(ids) {
  const list = [...new Set((ids || []).filter(Boolean))].sort();
  if (!list.length) return Promise.resolve(null);
  const key = list.join(',');
  if (_cache.has(key)) return _cache.get(key);

  const p = (async () => {
    try {
      const json = await cacheJson(`/damage-timeline?${qs({ countryIds: key })}`);
      if (json && Array.isArray(json.countryIds)) {
        return json.known && json.series?.length ? json : null;
      }
      // Server che non conosce `countryIds`: quella risposta è il mondo.
      return await sumOneByOne(list);
    } catch (err) {
      console.warn('WarEra+ blocStats: /damage-timeline non disponibile:', err.message);
      return null;
    }
  })();
  _cache.set(key, p);
  // Un errore di rete non resta in cache per tutta la sessione.
  p.then(v => { if (!v) _cache.delete(key); });
  return p;
}

/** Ripiego per un server non ancora rideployato: una richiesta per
 *  nazione, sommate qui. Stesse regole del server: un'ora è misurata
 *  solo se lo è per TUTTE le nazioni note. */
const _one = new Map();   // countryId → Promise<timeline|null>, per la sessione

function fetchOne(id) {
  if (!_one.has(id)) {
    const p = cacheJson(`/damage-timeline?${qs({ countryId: id })}`).catch(() => null);
    _one.set(id, p);
    p.then(v => { if (!v) _one.delete(id); });
  }
  return _one.get(id);
}

async function sumOneByOne(list) {
  // Coda a FALLBACK_PARALLEL: gli Unaligned sono oltre cento nazioni, e
  // cento richieste insieme sono il modo di farsene rifiutare la metà.
  const out = new Array(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const k = next++;
      out[k] = await fetchOne(list[k]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(FALLBACK_PARALLEL, list.length) }, worker));
  const parts = out.filter(tl => tl && tl.known && Array.isArray(tl.series));
  if (!parts.length) return null;

  const byT = new Map();
  for (const tl of parts) {
    for (const r of tl.series) {
      let row = byT.get(r.t);
      if (!row) { row = { t: r.t, to: r.to, min: r.min || 60, d: 0, p: 0, dn: 0, pn: 0 }; byT.set(r.t, row); }
      if (r.d != null) { row.d += r.d; row.dn += 1; }
      if (r.p != null) { row.p += r.p; row.pn += 1; }
      if (r.r) row.r = 1;
    }
  }
  const series = [...byT.values()].sort((a, b) => a.t - b.t).map(r => ({
    t: r.t, to: r.to, min: r.min,
    d: r.dn === parts.length ? r.d : null,
    p: r.pn === parts.length ? r.p : null,
    ...(r.r ? { r: 1 } : {}),
  }));

  const byDay = new Map();
  for (const tl of parts) {
    for (const r of tl.daily || []) {
      let row = byDay.get(r.day);
      if (!row) { row = { day: r.day, d: 0, n: 0, hours: r.hours, partial: r.partial }; byDay.set(r.day, row); }
      if (r.d != null) { row.d += r.d; row.n += 1; }
      if (r.partial) row.partial = 1;
    }
  }
  // Il picco dei pillati di un giorno NON è la somma dei picchi (cadono in
  // ore diverse): qui non si calcola, il tooltip giornaliero lo omette.
  const daily = [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1)).map(r => ({
    day: r.day, d: r.n === parts.length ? r.d : null, hours: r.hours, pPeak: null,
    ...(r.partial ? { partial: 1 } : {}),
  }));

  return { ...parts[0], known: true, series, daily };
}

/* ── Chi può vederli ─────────────────────────────────────────────── */

// Una domanda per sessione (e per token: dopo un login o un logout la
// risposta cambia). Server giù o errore = no, il verso giusto in cui
// sbagliare per una sezione riservata.
// Il governo si calcola dal gioco a ogni /roles/me (roles.js): chi decade
// da ministro smette di vederli alla sessione successiva.
function puoVedere(r) {
  if (!r?.nazione?.abilitata) return false;
  if (r.account?.admin) return true;
  return (r.capacita?.gestisceNazione || []).length > 0;
}

let _membro = { token: null, p: null };
function isPastaGovernment() {
  const token = getToken();
  if (!token) return Promise.resolve(false);
  if (_membro.token !== token || !_membro.p) {
    _membro = {
      token,
      p: leggiRuoli()
        .then(puoVedere)
        .catch(() => { _membro.p = null; return false; }),
    };
  }
  return _membro.p;
}

/* ── Ingresso ──────────────────────────────────────────────────── */

/**
 * Disegna la sezione dentro `host` per uno o due gruppi
 * ({ label, color, ids }). Se nessun gruppo ha dati la sezione non
 * compare: è il degrado voluto, come nella scheda nazione.
 */
export async function renderGroupCurves(host, groups) {
  const token = Symbol('curves');
  host._wpCurves = token;
  host.innerHTML = '';
  if (!(await isPastaGovernment())) return;
  if (host._wpCurves !== token || !host.isConnected) return;
  injectStyles();
  host.innerHTML = `<div class="bs-cv-loading">${bT('Loading hourly damage…')}</div>`;

  const tls = await Promise.all(groups.map(g => fetchGroupTimeline(g.ids)));
  if (host._wpCurves !== token || !host.isConnected) return;   // ridisegnato nel frattempo

  const ready = groups.map((g, i) => ({ ...g, tl: tls[i] })).filter(g => g.tl);
  if (!ready.length) { host.innerHTML = ''; return; }
  paint(host, ready, groups.length);
}

function paint(host, groups, asked) {
  // Conta quanti gruppi sono stati CHIESTI, non quanti hanno risposto: nel
  // 1 vs 2 con un lato senza dati l'altro deve restare disegnato da
  // confronto (colore della sua fazione, nome in legenda), non passare
  // per la scheda di un'alleanza sola.
  const multi = asked > 1;
  const missing = asked > groups.length;
  host.innerHTML = `
    <div class="bs-cv">
      <div class="bs-cv-title">${bT('Hourly damage & pilled players')}</div>
      ${coverageHtml(groups[0].tl)}
      ${missing ? `<p class="bs-cv-note">${bT('One of the two sides has no hourly data yet.')}</p>` : ''}
      <div class="bs-cv-card">
        <div class="bs-cv-head">
          ${legendHtml(groups, multi)}
          <div class="bs-cv-range" role="group">
            ${RANGES.map(h => `<button type="button" data-h="${h}" class="${h === _hours ? 'active' : ''}">${h}h</button>`).join('')}
          </div>
        </div>
        <div class="bs-cv-slot" data-slot="hourly"></div>
        <div class="bs-cv-tip" hidden></div>
        ${peakHtml(groups)}
      </div>
      <div class="bs-cv-card">
        <div class="bs-cv-sub">${bT('Damage per day, last 14 days')}</div>
        <div class="bs-cv-slot" data-slot="daily"></div>
        <div class="bs-cv-tip" hidden></div>
      </div>
    </div>`;

  host.querySelector('.bs-cv-range')?.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-h]');
    if (!btn) return;
    _hours = Number(btn.dataset.h);
    try { localStorage.setItem(RANGE_KEY, String(_hours)); } catch { /* storage negato */ }
    paint(host, groups, asked);
  });

  drawHourly(host.querySelector('[data-slot="hourly"]'), groups, multi);
  drawDaily(host.querySelector('[data-slot="daily"]'), groups, multi);
}

/* ── Pezzi di testo ────────────────────────────────────────────── */

function fmt(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}
function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
const lang = () => document.documentElement.lang || undefined;

function coverageHtml(tl) {
  const from = tl.coverageFrom;
  if (!from || (Date.now() - from) / (24 * HOUR_MS) >= 14) return '';
  const when = new Date(from).toLocaleDateString(lang(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  return `<p class="bs-cv-note">${bT('Hourly damage is recorded since {date}: earlier hours cannot be recovered.', { date: esc(when) })}</p>`;
}

function legendHtml(groups, multi) {
  if (!multi) {
    const g = groups[0];
    return `<ul class="bs-cv-legend">
      <li><span class="bs-cv-sw" style="background:${g.color}"></span>${bT('Damage per hour')}</li>
      <li><span class="bs-cv-sw bs-cv-sw-line" style="background:${PILL_COLOR}"></span>${bT('Pilled players')}</li>
    </ul>`;
  }
  return `<ul class="bs-cv-legend">
    ${groups.map(g => `<li><span class="bs-cv-sw" style="background:${g.color}"></span>${esc(g.label)}</li>`).join('')}
    <li class="bs-cv-legend-key"><span class="bs-cv-key-solid"></span>${bT('damage')}
      <span class="bs-cv-key-dots"></span>${bT('pilled')}</li>
  </ul>`;
}

/** L'ora di punta di ogni gruppo, e quanti erano pillati in quell'ora. */
function peakHtml(groups) {
  const hm = (ms) => new Date(ms).toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
  const lines = groups.map(g => {
    const rows = g.tl.series.filter(r => r.d != null && r.t >= Date.now() - _hours * HOUR_MS);
    if (rows.length < 3) return '';
    const peak = rows.reduce((a, b) => (b.d > a.d ? b : a));
    if (!peak.d) return '';
    const txt = bT('Peak {hour}: {dmg} damage', { hour: `${hm(peak.t)}–${hm(peak.to || peak.t + HOUR_MS)}`, dmg: fmt(peak.d) })
      + (peak.p != null ? ' · ' + bT('{n} pilled', { n: peak.p }) : '');
    return `<li>${groups.length > 1 ? `<span class="bs-cv-sw" style="background:${g.color}"></span>` : ''}${esc(txt)}</li>`;
  }).join('');
  return lines ? `<ul class="bs-cv-peak">${lines}</ul>` : '';
}

/* ── Grafico orario ────────────────────────────────────────────── */

const PAD = { top: 14, right: 40, bottom: 22, left: 46 };

function segments(rows, get) {
  const out = [];
  let cur = [];
  rows.forEach((r, i) => {
    const v = get(r);
    if (v == null) { if (cur.length > 1) out.push(cur); cur = []; return; }
    cur.push({ i, v });
  });
  if (cur.length > 1) out.push(cur);
  return out;
}

function drawHourly(slot, groups, multi) {
  if (!slot) return;
  const t0 = Date.now() - _hours * HOUR_MS;

  // Righe = unione delle ore dei gruppi; ogni riga porta un valore per
  // gruppo (null se quel gruppo in quell'ora non ha misura).
  const byT = new Map();
  groups.forEach((g, gi) => {
    for (const r of g.tl.series) {
      if (r.t < t0) continue;
      let row = byT.get(r.t);
      if (!row) { row = { t: r.t, to: r.to || r.t + HOUR_MS, v: groups.map(() => null) }; byT.set(r.t, row); }
      row.v[gi] = r;
    }
  });
  const rows = [...byT.values()].sort((a, b) => a.t - b.t);
  if (!rows.length) { slot.innerHTML = `<p class="bs-cv-empty">${bT('No hourly data yet.')}</p>`; return; }

  const W = Math.max(slot.clientWidth || 0, 300);
  const H = 210;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;

  const rate = (r) => (r?.d == null ? null : r.d / ((r.min || 60) / 60));
  const maxD = Math.max(1, ...rows.flatMap(r => r.v.map(x => rate(x) || 0)));
  const maxP = Math.max(1, ...rows.flatMap(r => r.v.map(x => x?.p || 0)));
  const hasDamage = rows.some(r => r.v.some(x => x?.d != null));

  const tStart = rows[0].t;
  const span = Math.max(1, rows[rows.length - 1].to - tStart);
  const x = (t) => PAD.left + ((t - tStart) / span) * plotW;
  const xMid = (r) => x(r.t + (r.to - r.t) / 2);
  const yD = (v) => PAD.top + plotH - (v / maxD) * plotH;
  const yP = (v) => PAD.top + plotH - (v / maxP) * plotH;

  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const y = PAD.top + (plotH / 4) * k;
    grid += `<line class="bs-cv-grid" x1="${PAD.left}" y1="${y.toFixed(1)}" x2="${W - PAD.right}" y2="${y.toFixed(1)}"/>
      ${hasDamage ? `<text class="bs-cv-axis" x="${PAD.left - 6}" y="${(y + 3.5).toFixed(1)}" text-anchor="end">${fmt(maxD * (1 - k / 4))}</text>` : ''}
      <text class="bs-cv-axis bs-cv-axis-r" x="${W - PAD.right + 6}" y="${(y + 3.5).toFixed(1)}">${Math.round(maxP * (1 - k / 4))}</text>`;
  }

  const pathOf = (seg, y) => seg.map(({ i, v }, k) => `${k ? 'L' : 'M'}${xMid(rows[i]).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  const base = (PAD.top + plotH).toFixed(1);

  let body = '';
  groups.forEach((g, gi) => {
    const dSegs = segments(rows, r => rate(r.v[gi]));
    // Area solo con un gruppo: due aree sovrapposte si impastano e non si
    // capisce più quale colore sta sopra.
    if (!multi) {
      body += dSegs.map(seg => `<path d="${pathOf(seg, yD)} L${xMid(rows[seg[seg.length - 1].i]).toFixed(1)},${base} L${xMid(rows[seg[0].i]).toFixed(1)},${base} Z"
        fill="${g.color}" fill-opacity=".14"/>`).join('');
    }
    body += dSegs.map(seg => `<path d="${pathOf(seg, yD)}" fill="none" stroke="${g.color}" stroke-width="2"
      stroke-linejoin="round" stroke-linecap="round"/>`).join('');

    // Pillati: coda ancora da assestare attenuata (vedi testata).
    const settled = g.tl.pill?.settledUntil ?? Infinity;
    const pColor = multi ? g.color : PILL_COLOR;
    const pStyle = multi ? ' stroke-dasharray="1.5 3.5" stroke-width="2.4"' : ' stroke-width="2"';
    const pPath = (pts, faded) => (pts.length < 2 ? '' : `<path d="${pathOf(pts, yP)}" fill="none" stroke="${pColor}"${pStyle}
      stroke-linejoin="round" stroke-linecap="round"${faded ? ' stroke-opacity=".4"' : ''}/>`);
    body += segments(rows, r => r.v[gi]?.p ?? null).map(seg => {
      const cut = seg.findIndex(({ i }) => rows[i].t > settled);
      if (cut === -1) return pPath(seg, false);
      return pPath(seg.slice(0, cut + 1), false) + pPath(seg.slice(Math.max(0, cut - 1)), true);
    }).join('');
  });

  const labels = rows.map(r => {
    const dt = new Date(r.t);
    if (dt.getMinutes() !== 0 || dt.getHours() % 6 !== 0) return '';
    return `<text class="bs-cv-axis" x="${x(r.t).toFixed(1)}" y="${H - 6}" text-anchor="middle">${dt.getHours()}</text>`;
  }).join('');
  const hits = rows.map((r, i) => `<rect class="bs-cv-hit" x="${x(r.t).toFixed(1)}" y="${PAD.top}"
    width="${Math.max(1, x(r.to) - x(r.t)).toFixed(1)}" height="${plotH}" data-i="${i}" fill="transparent"/>`).join('');

  slot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bs-cv-svg" role="img"
      aria-label="${esc(bT('Hourly damage & pilled players'))}">${grid}${body}${labels}${hits}</svg>`
    + (hasDamage ? '' : `<p class="bs-cv-note">${bT('Hourly damage starts filling in after the first full hour.')}</p>`);

  bindTip(slot, rows, (r) => {
    const from = new Date(r.t), to = new Date(r.to);
    const hm = (d) => d.toLocaleTimeString(lang(), { hour: '2-digit', minute: '2-digit' });
    const head = `${from.toLocaleDateString(lang(), { weekday: 'short' })} ${hm(from)}–${hm(to)}`;
    const items = groups.map((g, gi) => {
      const v = r.v[gi];
      const name = multi ? `<li class="bs-cv-tip-group"><span class="bs-cv-sw" style="background:${g.color}"></span>${esc(g.label)}</li>` : '';
      const dmg = v?.d == null
        ? `<li><span>${bT('not measured')}</span></li>`
        : `<li><span>${bT('Damage')}</span><strong>${fmt(v.d)}</strong></li>`;
      const pill = v?.p == null ? '' : `<li><span>${bT('Pilled players')}</span><strong>${v.p}</strong></li>`;
      return name + dmg + pill;
    }).join('');
    return `<div class="bs-cv-tip-head">${esc(head)}</div><ul>${items}</ul>`;
  });
}

/* ── Curva a 14 giorni ─────────────────────────────────────────── */

function drawDaily(slot, groups, multi) {
  if (!slot) return;
  const days = [...new Set(groups.flatMap(g => (g.tl.daily || []).filter(r => r.d != null).map(r => r.day)))].sort();
  if (days.length < 2) { slot.innerHTML = `<p class="bs-cv-empty">${bT('Not enough days recorded yet.')}</p>`; return; }
  const rows = days.map(day => ({ day, v: groups.map(g => (g.tl.daily || []).find(r => r.day === day && r.d != null) || null) }));

  const W = Math.max(slot.clientWidth || 0, 300);
  const H = 170;
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const maxD = Math.max(1, ...rows.flatMap(r => r.v.map(x => x?.d || 0)));
  const step = plotW / (rows.length - 1);
  const x = (i) => PAD.left + i * step;
  const y = (v) => PAD.top + plotH - (v / maxD) * plotH;

  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const yy = PAD.top + (plotH / 4) * k;
    grid += `<line class="bs-cv-grid" x1="${PAD.left}" y1="${yy.toFixed(1)}" x2="${W - PAD.right}" y2="${yy.toFixed(1)}"/>
      <text class="bs-cv-axis" x="${PAD.left - 6}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${fmt(maxD * (1 - k / 4))}</text>`;
  }

  let body = '';
  groups.forEach((g, gi) => {
    const segs = segments(rows, r => r.v[gi]?.d ?? null);
    const pathOf = (seg) => seg.map(({ i, v }, k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
    if (!multi) {
      const base = (PAD.top + plotH).toFixed(1);
      body += segs.map(seg => `<path d="${pathOf(seg)} L${x(seg[seg.length - 1].i).toFixed(1)},${base} L${x(seg[0].i).toFixed(1)},${base} Z" fill="${g.color}" fill-opacity=".13"/>`).join('');
    }
    body += segs.map(seg => `<path d="${pathOf(seg)}" fill="none" stroke="${g.color}" stroke-width="2" stroke-linejoin="round"/>`).join('');
    // Giorno PARZIALE = pallino vuoto: il suo totale è basso perché conta
    // meno ore, non perché si è combattuto meno.
    body += rows.map((r, i) => {
      const v = r.v[gi];
      if (!v) return '';
      return `<circle cx="${x(i).toFixed(1)}" cy="${y(v.d).toFixed(1)}" r="3.2" stroke="${g.color}" stroke-width="1.6"
        fill="${v.partial ? 'var(--wp-ov-surface, #161b22)' : g.color}"/>`;
    }).join('');
  });

  const labels = rows.map((r, i) => {
    if (rows.length > 8 && i % 2) return '';
    const txt = new Date(`${r.day}T00:00:00Z`).toLocaleDateString(lang(), { day: 'numeric', month: 'numeric' });
    return `<text class="bs-cv-axis" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="middle">${esc(txt)}</text>`;
  }).join('');
  const hits = rows.map((r, i) => `<rect class="bs-cv-hit" x="${(x(i) - step / 2).toFixed(1)}" y="${PAD.top}"
    width="${step.toFixed(1)}" height="${plotH}" data-i="${i}" fill="transparent"/>`).join('');

  slot.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" class="bs-cv-svg" role="img"
    aria-label="${esc(bT('Damage per day, last 14 days'))}">${grid}${body}${labels}${hits}</svg>`;

  bindTip(slot, rows, (r) => {
    const head = new Date(`${r.day}T00:00:00Z`).toLocaleDateString(lang(), { weekday: 'short', day: 'numeric', month: 'short' });
    const items = groups.map((g, gi) => {
      const v = r.v[gi];
      const name = multi ? `<li class="bs-cv-tip-group"><span class="bs-cv-sw" style="background:${g.color}"></span>${esc(g.label)}</li>` : '';
      if (!v) return name + `<li><span>${bT('not measured')}</span></li>`;
      return name + `<li><span>${bT('Damage')}</span><strong>${fmt(v.d)}</strong></li>`
        + (v.pPeak != null ? `<li><span>${bT('Peak pilled players')}</span><strong>${v.pPeak}</strong></li>` : '')
        + (v.partial ? `<li class="bs-cv-tip-warn">${bT('Partial day: {n} of 24 hours', { n: v.hours })}</li>` : '');
    }).join('');
    return `<div class="bs-cv-tip-head">${esc(head)}</div><ul>${items}</ul>`;
  });
}

/* ── Tooltip ───────────────────────────────────────────────────── */

function bindTip(slot, rows, build) {
  const tip = slot.parentElement?.querySelector('.bs-cv-tip');
  if (!tip) return;
  slot.addEventListener('mousemove', (e) => {
    const hit = e.target.closest('.bs-cv-hit');
    const r = hit && rows[Number(hit.dataset.i)];
    if (!r) { tip.hidden = true; return; }
    tip.innerHTML = build(r);
    tip.hidden = false;
    const box = slot.parentElement.getBoundingClientRect();
    const left = e.clientX - box.left;
    const flip = left > box.width / 2;
    tip.style.left = `${Math.max(4, Math.min(box.width - tip.offsetWidth - 4, flip ? left - tip.offsetWidth - 12 : left + 12))}px`;
    tip.style.top = `${Math.max(4, e.clientY - box.top - tip.offsetHeight - 10)}px`;
  });
  slot.addEventListener('mouseleave', () => { tip.hidden = true; });
}

/* ── Stile ─────────────────────────────────────────────────────── */

let _styled = false;
function injectStyles() {
  if (_styled) return;
  _styled = true;
  const s = document.createElement('style');
  s.id = 'bs-cv-styles';
  s.textContent = `
    .bs-cv{margin:14px 0 4px}
    .bs-cv-title{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.04em;color:#c9d1d9;margin-bottom:8px}
    .bs-cv-card{position:relative;background:rgba(13,17,23,.55);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:10px 12px;margin-bottom:10px}
    .bs-cv-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-bottom:4px}
    .bs-cv-sub{font-size:12px;font-weight:600;color:#8b949e;margin-bottom:4px}
    .bs-cv-legend{display:flex;flex-wrap:wrap;gap:4px 14px;list-style:none;margin:0;padding:0;font-size:12px;color:#c9d1d9}
    .bs-cv-legend li{display:flex;align-items:center;gap:6px}
    .bs-cv-legend-key{color:#8b949e}
    .bs-cv-sw{display:inline-block;width:10px;height:10px;border-radius:3px;flex-shrink:0}
    .bs-cv-sw-line{height:3px;border-radius:2px}
    .bs-cv-key-solid,.bs-cv-key-dots{display:inline-block;width:18px;height:0;border-top:2px solid #8b949e}
    .bs-cv-key-dots{border-top:2.4px dotted #8b949e;margin-left:6px}
    .bs-cv-range{display:flex;gap:4px}
    .bs-cv-range button{background:transparent;border:1px solid rgba(255,255,255,.15);color:#8b949e;border-radius:6px;padding:2px 8px;font-size:11px;cursor:pointer}
    .bs-cv-range button.active{border-color:#58a6ff;color:#58a6ff}
    .bs-cv-slot{width:100%;overflow:hidden}
    .bs-cv-svg{display:block;max-width:100%}
    .bs-cv-grid{stroke:rgba(255,255,255,.07);stroke-width:1}
    .bs-cv-axis{fill:#8b949e;font-size:10px}
    /* La colonna (ora o giorno) sotto il mouse: una fascia chiara, cosi' si
       vede a colpo d'occhio a quale ora si riferisce il tooltip. */
    .bs-cv-hit{cursor:crosshair}
    .bs-cv-hit:hover{fill:rgba(255,255,255,.1);stroke:rgba(255,255,255,.22);stroke-width:1}
    body.light-theme .bs-cv-hit:hover{fill:rgba(0,0,0,.08);stroke:rgba(0,0,0,.2)}
    .bs-cv-note,.bs-cv-empty,.bs-cv-loading{font-size:12px;color:#8b949e;margin:4px 0 8px}
    .bs-cv-peak{list-style:none;margin:6px 0 0;padding:0;font-size:12px;color:#c9d1d9;display:grid;gap:3px}
    .bs-cv-peak li{display:flex;align-items:center;gap:6px}
    .bs-cv-tip{position:absolute;z-index:5;pointer-events:none;background:#0d1117;border:1px solid rgba(255,255,255,.15);border-radius:8px;padding:6px 9px;font-size:12px;color:#c9d1d9;min-width:150px;box-shadow:0 6px 18px rgba(0,0,0,.4)}
    .bs-cv-tip-head{font-weight:700;margin-bottom:4px}
    .bs-cv-tip ul{list-style:none;margin:0;padding:0;display:grid;gap:2px}
    .bs-cv-tip li{display:flex;justify-content:space-between;gap:12px}
    .bs-cv-tip li.bs-cv-tip-group{justify-content:flex-start;gap:6px;font-weight:600;margin-top:3px}
    .bs-cv-tip-warn{color:#e3b341}
    body.light-theme .bs-cv-title{color:#24292f}
    body.light-theme .bs-cv-card{background:rgba(240,230,210,.6);border-color:rgba(0,0,0,.1)}
    body.light-theme .bs-cv-grid{stroke:rgba(0,0,0,.08)}
    body.light-theme .bs-cv-axis{fill:#57606a}
    body.light-theme .bs-cv-legend,body.light-theme .bs-cv-peak{color:#24292f}
    body.light-theme .bs-cv-tip{background:#fffaf0;color:#24292f;border-color:rgba(0,0,0,.15)}
  `;
  document.head.appendChild(s);
}
