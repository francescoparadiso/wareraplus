/* ══════════════════════════════════════════════════════════════
   WarEra+ — Scheda "Spese di guerra"
   ------------------------------------------------------------------
   Quanto spende una nazione al giorno per combattere: taglie pagate ai
   propri combattenti + contratti mercenari aggiudicati. Classifica su
   una finestra scelta (7/30/90 giorni), e cliccando una nazione la sua
   serie giorno per giorno.

   ── PERCHÉ NON È LA CLASSIFICA BOUNTY DEL GIOCO ────────────────────
   Nel gioco esiste già un ranking "bounty" per nazione, ed è un'altra
   cosa: è quanto i cittadini di quella nazione hanno INCASSATO
   combattendo (correla 0,87 col danno, 0,11 con la ricchezza). Qui si
   mostra l'uscita di cassa del governo. Le due grandezze non sono
   confrontabili e la nota in fondo lo dice a chi guarda.

   ── IL GRAFICO ─────────────────────────────────────────────────────
   Barre in SVG scritte a mano, come src/nations/charts.js: niente
   Chart.js per due dozzine di barre impilate.

   ── LA BARRA NELLA CLASSIFICA (rifatta, era il punto confuso) ──────
   Prima c'era una colonna senza intestazione con dentro una barretta
   monocroma lunga quanto la colonna ordinata: ripeteva un numero che
   stava già due colonne più in là, non diceva niente di nuovo, e
   spingeva le cifre lontano dalle loro intestazioni.
   Adesso la barra è IMPILATA e dice una cosa che nessuna colonna dice:
   quanto di quella spesa è taglia (ambra) e quanto contratti (viola).
   La lunghezza resta la spesa totale rispetto alla prima in classifica
   — sempre il totale, mai la colonna ordinata, così l'occhio ha un
   metro che non cambia sotto i piedi quando si riordina. I due colori
   sono gli stessi del grafico e della legenda, dichiarati
   nell'intestazione della colonna così non serve cercarli altrove.

   ── PER ALLEANZA E FLUSSO DEL DENARO (WarEra+, 2026-11-13) ──────────
   Due aggiunte, richieste insieme, per vedere dove va il denaro:
   · interruttore "Per nazione / Per alleanza": le stesse righe sommate sui
     membri di ogni alleanza (state.nationAlliancesMap). Una nazione in più
     alleanze conta in ciascuna, e la nota in fondo lo dice. Chi non è in
     nessuna alleanza sta in una riga a parte.
   · colonne "Incassato" e "Saldo": l'altra metà dei contratti, cioè quanto
     hanno incassato le UNITÀ di una nazione (server /war-flows, vedi
     aggregateFlows in api.js). Saldo = incassato − contratti pagati, sullo
     STESSO periodo; per un'alleanza i soldi che girano fra i suoi membri si
     annullano da soli, quindi il saldo è quello verso l'esterno.
   Il dettaglio di una nazione o alleanza elenca a chi paga e da chi incassa.
   Senza il rideploy del server (flows === null) la vista è identica a prima
   salvo l'interruttore per alleanza, e lo dichiara.

   ── I CONTI ACCANTO ALLA SPESA (WarEra+, 2026-11-26) ───────────────
   Richiesta dell'utente: «capire se una spesa economica di una nazione si
   riversa sui conti dei cittadini/nazioni». Interruttore "Colonne: Spese /
   Conti": la seconda mette accanto alla spesa il TESORO (adesso e quanto è
   cambiato nella finestra, e quanto pesa la spesa sul tesoro di partenza)
   e i CITTADINI (variazione dei soldi e della ricchezza), più l'incassato
   delle unità. Nel dettaglio due grafici giorno per giorno: tesoro con la
   spesa sotto, soldi dei cittadini con gli incassi delle unità sotto.
   Fonti e capi della variazione in api.js (getWarEconomy, econDelta).
   ⚠️ Non è un conto causale: il tesoro si muove anche per tasse, bonifici e
   donazioni, i cittadini per lavoro, mercato e trasferimenti di
   cittadinanza. Le due cose accanto dicono se si muovono insieme, e la nota
   in fondo lo scrive. Per un'alleanza sono le somme dei membri di OGGI.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { btlT } from './i18n.js';
import { scrollHintHtml } from '../shared/scrollHint.js';
import { tipAttr } from '../shared/chartTip.js';
import { aggregateExpenses, aggregateFlows, countrySeries, coveredDays, effectiveDays,
  econDelta, econDaily, earnedDaily } from './api.js';
import { copyLinkHtml, battlesHref } from './links.js';

const WINDOWS = [
  { days: 7, key: 'days7' },
  { days: 30, key: 'days30' },
  { days: 90, key: 'days90' },
];

let _days = 30;
let _sort = 'total';          // 'total' | 'bounty' | 'contracts' | 'earned' | 'net'
let _group = 'nation';        // 'nation' | 'alliance'
let _selected = null;         // countryId aperto nel dettaglio
let _selectedAlliance = null; // allianceId (o NO_ALLIANCE) aperto nel dettaglio
let _cols = 'spend';          // 'spend' | 'econ' — WarEra+ 2026-11-26
const NO_ALLIANCE = '__none';
const ECON_SORTS = new Set(['total', 'treasury', 'dTreasury', 'spendShare', 'dMoney', 'dWealth', 'earned']);
const SPEND_SORTS = new Set(['total', 'bounty', 'contracts', 'earned', 'net']);

/** Stato da mettere nel link (main.js: linkState). */
export function getExpensesLinkState() {
  return {
    by: _group === 'alliance' ? 'alliance' : undefined,
    nation: _selected || undefined,
    ally: _selectedAlliance || undefined,
    days: _days !== 30 ? _days : undefined,
    cols: _cols === 'econ' ? 'econ' : undefined,
  };
}
export function setExpensesLinkState({ by, nation, ally, days, cols } = {}) {
  if (by === 'alliance') _group = 'alliance';
  if (WINDOWS.some(w => w.days === Number(days))) _days = Number(days);
  if (cols === 'econ') _cols = 'econ';
  if (ally) _selectedAlliance = ally;
  if (nation && /^[0-9a-f]{24}$/i.test(nation)) _selected = nation;
}
function fmtMoney(n) {
  if (n == null || !Number.isFinite(n)) return '—';
  if (n >= 1e6) return (n / 1e6).toFixed(2) + 'M';
  if (n >= 10000) return Math.round(n).toLocaleString();
  if (n >= 10) return n.toFixed(0);
  return n.toFixed(2);
}

function nationName(id) { return state.nationMap?.get(id)?.name || id; }

function flagHtml(id) {
  const n = state.nationMap?.get(id);
  if (!n) return '';
  const url = getFlagUrl(getNationCode(id, n));
  return url ? `<img class="wp-btl-flag" src="${url}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
}

function fmtSigned(n) {
  if (n == null || !Number.isFinite(n) || Math.round(n) === 0) return '—';
  return (n > 0 ? '+' : '−') + fmtMoney(Math.abs(n));
}
const netClass = (n) => (Math.round(n) > 0 ? 'wp-btl-pos' : Math.round(n) < 0 ? 'wp-btl-neg' : 'wp-btl-dim');

function allianceName(id) {
  return id === NO_ALLIANCE ? btlT('noAlliance') : (state.allianceMap?.get(id)?.name || id);
}
function allianceSwatch(id) {
  const color = id === NO_ALLIANCE ? null : state.allianceColorMap?.get(id);
  return `<i class="wp-btl-aswatch"${color ? ` style="background:${escapeHtml(color)}"` : ''}></i>`;
}

/* ── Righe: una per nazione, poi (a richiesta) sommate per alleanza ──
   La spesa e l'incasso vanno sullo stesso periodo: se l'archivio degli
   incassi parte più tardi dell'inizio della finestra, i contratti del saldo
   si contano da lì (aggregateExpenses con minDay), non su tutta la finestra:
   altrimenti il saldo sarebbe un numero storto che sembra giusto. */
function buildNationRows(data, flowAgg, showBounty) {
  const exp = aggregateExpenses(data.byDay, _days);
  const expSame = flowAgg.days ? aggregateExpenses(data.byDay, _days, flowAgg.from) : null;
  const ids = new Set([...exp.keys(), ...flowAgg.earned.keys()]);
  const zero = { bounty: 0, contracts: 0, contractCount: 0, battles: 0 };
  return [...ids].map(cid => {
    const v = exp.get(cid) || zero;
    const e = flowAgg.earned.get(cid);
    const earned = e?.c || 0;
    const total = (showBounty ? v.bounty : 0) + v.contracts;
    return {
      cid, ...v,
      total,
      earned, earnedCount: e?.n || 0,
      net: earned - (expSame?.get(cid)?.contracts || 0),
      ...econOf(data.econ, [cid], total),
    };
  }).filter(r => r.total > 0 || r.earned > 0);
}

/** I conti di un gruppo di nazioni nella finestra (vedi la testata). I
 *  campi piatti servono all'ordinamento delle colonne; `econ` porta le
 *  variazioni intere (capi, date, quante nazioni avevano il dato). */
function econOf(econ, ids, total) {
  if (!econ) return { econ: null };
  const t = econDelta(econ.treasury, 'series', ids, _days);
  const m = econDelta(econ.citizens, 'money', ids, _days);
  const w = econDelta(econ.citizens, 'series', ids, _days);
  const p = econDelta(econ.citizens, 'players', ids, _days);
  return {
    econ: { t, m, w, p },
    treasury: t?.end ?? null,
    dTreasury: t?.delta ?? null,
    spendShare: t && t.start > 0 ? total / t.start : null,
    dMoney: m?.delta ?? null,
    dWealth: w?.delta ?? null,
  };
}

function buildAllianceRows(nationRows, flowAgg, econ) {
  const acc = new Map();
  for (const r of nationRows) {
    const aids = [...(state.nationAlliancesMap?.get(r.cid) || [])];
    for (const aid of (aids.length ? aids : [NO_ALLIANCE])) {
      const a = acc.get(aid) || { aid, members: [], bounty: 0, contracts: 0, contractCount: 0, total: 0, earned: 0, earnedCount: 0, net: 0, internal: 0 };
      a.members.push(r);
      for (const k of ['bounty', 'contracts', 'contractCount', 'total', 'earned', 'earnedCount', 'net']) a[k] += r[k];
      acc.set(aid, a);
    }
  }
  // Soldi passati fra membri della stessa alleanza (escluso "senza alleanza":
  // non sono un gruppo).
  for (const a of acc.values()) {
    if (a.aid === NO_ALLIANCE) continue;
    const ids = new Set(a.members.map(m => m.cid));
    for (const payer of ids) {
      for (const [to, v] of flowAgg.pairs.get(payer) || []) if (ids.has(to)) a.internal += v.c;
    }
  }
  // I conti di un'alleanza sono di TUTTI i suoi membri, anche di chi nella
  // finestra non ha speso niente: il tesoro di un membro in pace è comunque
  // parte dei conti del blocco.
  for (const a of acc.values()) {
    a.econIds = a.aid === NO_ALLIANCE ? a.members.map(m => m.cid) : allianceMemberIds(a.aid, a.members);
    Object.assign(a, econOf(econ, a.econIds, a.total));
  }
  return [...acc.values()];
}

function allianceMemberIds(aid, members) {
  const ids = new Set(members.map(m => m.cid));
  for (const [cid, set] of state.nationAlliancesMap || []) if (set.has(aid)) ids.add(cid);
  return [...ids];
}

function sumSeries(byDay, ids, days) {
  const per = ids.map(id => countrySeries(byDay, id, days));
  return per[0].map((d, i) => per.reduce((s, ser) => ({
    day: d.day,
    bounty: s.bounty + ser[i].bounty,
    contracts: s.contracts + ser[i].contracts,
    contractCount: s.contractCount + ser[i].contractCount,
    battles: s.battles + ser[i].battles,
  }), { day: d.day, bounty: 0, contracts: 0, contractCount: 0, battles: 0 }));
}

/* ── Grafico a barre impilate: taglia sotto, contratti sopra ──
   Scritto a mano in SVG. Larghezza in percentuale (viewBox +
   preserveAspectRatio="none" sarebbe deformante sul testo, quindi si
   disegna in coordinate reali e si lascia scorrere il contenitore). */
function seriesChart(series, showBounty) {
  const max = Math.max(...series.map(d => (showBounty ? d.bounty : 0) + d.contracts), 1);
  const W = Math.max(320, series.length * 22);
  const H = 140;
  const pad = 18;
  const bw = (W - pad) / series.length;

  const bars = series.map((d, i) => {
    const x = pad + i * bw;
    const b = showBounty ? d.bounty : 0;
    const c = d.contracts;
    const hb = ((b / max) * (H - 24));
    const hc = ((c / max) * (H - 24));
    const title = `${d.day} — ${btlT('bountyLabel')}: ${fmtMoney(d.bounty)} · ${btlT('contractsLabel')}: ${fmtMoney(d.contracts)}`;
    return `<g><title>${escapeHtml(title)}</title>
      <rect x="${x + 1}" y="${H - 16 - hc - hb}" width="${bw - 2}" height="${hc}" class="wp-btl-bar-c" rx="1"/>
      ${showBounty ? `<rect x="${x + 1}" y="${H - 16 - hb}" width="${bw - 2}" height="${hb}" class="wp-btl-bar-b" rx="1"/>` : ''}
    </g>`;
  }).join('');

  const first = series[0]?.day || '';
  const last = series.at(-1)?.day || '';
  return `
    <div class="wp-btl-chartwrap">
      <svg class="wp-btl-chart" width="${W}" height="${H}" role="img">
        <line x1="${pad}" y1="${H - 16}" x2="${W}" y2="${H - 16}" class="wp-btl-axis"/>
        ${bars}
        <text x="${pad}" y="${H - 4}" class="wp-btl-axislbl">${first.slice(5)}</text>
        <text x="${W - 2}" y="${H - 4}" class="wp-btl-axislbl" text-anchor="end">${last.slice(5)}</text>
      </svg>
    </div>
    <div class="wp-btl-legend">
      ${showBounty ? `<span class="wp-btl-key"><i class="wp-btl-sw-b"></i>${btlT('bountyLabel')}</span>` : ''}
      <span class="wp-btl-key"><i class="wp-btl-sw-c"></i>${btlT('contractsLabel')}</span>
    </div>`;
}

/* ── Elenco "a chi paga / da chi incassa" ──
   Solo le controparti ESTERNE a chi si guarda (per un'alleanza: fuori
   dall'alleanza): i soldi che restano dentro il gruppo sono la scheda
   "Fra membri". Cliccando una riga si apre il dettaglio di quella nazione. */
function flowListHtml(title, map) {
  const rows = [...map.entries()].sort((a, b) => b[1].c - a[1].c).slice(0, 8);
  if (!rows.length) return '';
  const max = rows[0][1].c || 1;
  return `<div class="wp-btl-flowcol">
    <h3 class="wp-btl-h3">${title}</h3>
    <ul class="wp-btl-flowlist">${rows.map(([cid, v]) => `
      <li class="wp-btl-flowrow" data-open-nation="${escapeHtml(cid)}">
        <span class="wp-btl-nation">${flagHtml(cid)}${escapeHtml(nationName(cid))}</span>
        <span class="wp-btl-flowbar"><i style="width:${Math.max(2, (v.c / max) * 100).toFixed(1)}%"></i></span>
        <b>${fmtMoney(v.c)}</b><span class="wp-btl-sub">×${v.n}</span>
      </li>`).join('')}</ul>
  </div>`;
}

function flowListsHtml(ids, flowAgg) {
  const set = new Set(ids);
  const paysTo = new Map(), earnsFrom = new Map();
  const add = (m, k, v) => { const e = m.get(k) || { c: 0, n: 0 }; e.c += v.c; e.n += v.n; m.set(k, e); };
  for (const [payer, row] of flowAgg.pairs) {
    for (const [to, v] of row) {
      if (set.has(payer) && !set.has(to)) add(paysTo, to, v);
      else if (!set.has(payer) && set.has(to)) add(earnsFrom, payer, v);
    }
  }
  const html = flowListHtml(btlT('paysTo'), paysTo) + flowListHtml(btlT('earnsFrom'), earnsFrom);
  return html ? `<div class="wp-btl-flows">${html}</div>` : '';
}

function detailHtml(data, sel, flowAgg, nationRows) {
  const showBounty = !data.bountyMissing;
  const hasFlows = flowAgg.days > 0;
  const isAlliance = sel.kind === 'alliance';
  const aRow = isAlliance ? buildAllianceRows(nationRows, flowAgg, data.econ).find(a => a.aid === sel.id) : null;
  const nRow = !isAlliance ? nationRows.find(r => r.cid === sel.id) : null;
  const members = isAlliance ? (aRow?.members || []) : [];
  const ids = isAlliance ? members.map(m => m.cid) : [sel.id];

  const series = ids.length ? sumSeries(data.byDay, ids, _days) : countrySeries(data.byDay, '', _days);
  const tot = series.reduce((s, d) => ({
    bounty: s.bounty + d.bounty,
    contracts: s.contracts + d.contracts,
    contractCount: s.contractCount + d.contractCount,
    battles: s.battles + d.battles,
  }), { bounty: 0, contracts: 0, contractCount: 0, battles: 0 });
  const total = (showBounty ? tot.bounty : 0) + tot.contracts;
  const peak = series.reduce((a, d) => {
    const v = (showBounty ? d.bounty : 0) + d.contracts;
    return v > a.v ? { v, day: d.day } : a;
  }, { v: 0, day: '—' });
  // Denominatore = giorni per cui abbiamo davvero dati dentro la finestra,
  // non l'ampiezza della finestra: vedi effectiveDays in api.js.
  const denom = effectiveDays(data.byDay, _days);
  const earned = isAlliance ? (aRow?.earned || 0) : (nRow?.earned || 0);
  const net = isAlliance ? (aRow?.net || 0) : (nRow?.net || 0);

  const title = isAlliance
    ? `${allianceSwatch(sel.id)}${escapeHtml(allianceName(sel.id))}`
    : `${flagHtml(sel.id)}${escapeHtml(nationName(sel.id))}`;

  const memberRows = members.slice().sort((a, b) => (b[_sort] || 0) - (a[_sort] || 0));
  const memberMax = Math.max(...memberRows.map(r => r.total), 1);

  return `
    <div class="wp-btl-detail">
      <button type="button" class="wp-btl-back" id="wp-btl-back">← ${btlT('backToList')}</button>
      <h2 class="wp-btl-dtitle">${title} — ${btlT('detailTitle')}</h2>
      <div class="wp-btl-cards">
        <div class="wp-btl-card"><span>${btlT('colTotal')}</span><strong>${fmtMoney(total)}</strong></div>
        ${showBounty ? `<div class="wp-btl-card"><span>${btlT('bountyLabel')}</span><strong>${fmtMoney(tot.bounty)}</strong></div>` : ''}
        <div class="wp-btl-card"><span>${btlT('contractsLabel')}</span><strong>${fmtMoney(tot.contracts)}</strong>
          <em>${btlT('contractsCount', { n: tot.contractCount })}</em></div>
        <div class="wp-btl-card"><span>${btlT('perDayAvg')}</span><strong>${fmtMoney(total / denom)}</strong>
          ${denom < _days ? `<em>${btlT('overDays', { n: denom })}</em>` : ''}</div>
        <div class="wp-btl-card"><span>${btlT('peak')}</span><strong>${fmtMoney(peak.v)}</strong><em>${peak.day}</em></div>
        ${showBounty && !isAlliance ? `<div class="wp-btl-card"><span>${btlT('colBattles')}</span><strong>${tot.battles}</strong></div>` : ''}
        ${hasFlows ? `
          <div class="wp-btl-card wp-btl-card-in"><span>${btlT('earnedCard')}</span><strong>${fmtMoney(earned)}</strong></div>
          <div class="wp-btl-card"><span>${btlT('netCard')}</span><strong class="${netClass(net)}">${fmtSigned(net)}</strong></div>
          ${isAlliance && aRow && aRow.aid !== NO_ALLIANCE ? `<div class="wp-btl-card"><span>${btlT('internalCard')}</span><strong>${fmtMoney(aRow.internal)}</strong></div>` : ''}` : ''}
      </div>
      ${seriesChart(series, showBounty)}
      ${econSectionHtml(data, isAlliance ? (aRow?.econIds || ids) : [sel.id], series, showBounty, total)}
      ${hasFlows ? flowListsHtml(ids, flowAgg) : ''}
      ${isAlliance && memberRows.length ? `
        <h3 class="wp-btl-h3">${btlT('membersTitle')}</h3>
        ${tableHtml(memberRows, { kind: 'nation', max: memberMax, denom, showBounty, hasFlows })}` : ''}
      ${isAlliance ? '' : `<button type="button" class="wp-btl-seebattles" data-see="${escapeHtml(sel.id)}">${btlT('tabArchive')} →</button>`}
    </div>`;
}

/* ══ SITUAZIONE ECONOMICA (dettaglio) ═══════════════════════════
   Caselle con le variazioni nella finestra e due grafici giorno per giorno:
   tesoro (linea) con la spesa (barre) sotto; soldi dei cittadini (linea)
   con gli incassi delle unità (barre) sotto. Linea e barre hanno scale
   DIVERSE, e le etichette lo dicono: sulla stessa scala la spesa di un
   giorno sarebbe una riga piatta sotto un tesoro cento volte più grande. */
function signedCard(label, d, { pct = null } = {}) {
  if (!d) return `<div class="wp-btl-card"><span>${label}</span><strong class="wp-btl-dim">—</strong></div>`;
  return `<div class="wp-btl-card"><span>${label}</span><strong class="${netClass(d.delta)}">${fmtSigned(d.delta)}</strong>
    <em>${fmtMoney(d.start)} → ${fmtMoney(d.end)}${pct != null ? ` · ${pct}` : ''}</em></div>`;
}

function econSectionHtml(data, ids, series, showBounty, total) {
  const econ = data.econ;
  const head = `<h3 class="wp-btl-h3" data-sec="btl-econ">${btlT('econTitle')}</h3>`;
  if (econ === undefined) return `${head}<div class="wp-btl-loading">${btlT('loading')}</div>`;
  if (!econ || (!econ.treasury && !econ.citizens)) return `${head}<div class="wp-btl-notice warn">${btlT('econMissing')}</div>`;

  const e = econOf(econ, ids, total).econ;
  const dayList = series.map(d => d.day);
  const spendByDay = new Map(series.map(d => [d.day, (showBounty ? d.bounty : 0) + d.contracts]));
  const pctOf = (v, base) => (base > 0 ? `${((v / base) * 100).toFixed(1)}%` : null);
  const share = e.t && e.t.start > 0 ? pctOf(total, e.t.start) : null;
  const from = (d) => (d?.partial ? btlT('econSince', { d: d.from }) : null);
  const partialNote = [from(e.t) && `${btlT('econTreasury')}: ${from(e.t)}`, from(e.m) && `${btlT('econCitizens')}: ${from(e.m)}`]
    .filter(Boolean).join(' · ');

  const charts = [];
  if (econ.treasury) {
    charts.push(econChart({
      days: dayList, line: econDaily(econ.treasury, 'series', ids), bars: spendByDay,
      lineLabel: btlT('econTreasury'), barLabel: btlT('econSpendDay'), lineClass: 'wp-btl-econ-line-t', barClass: 'wp-btl-bar-c',
      title: btlT('econChartTreasury'),
    }));
  }
  if (econ.citizens) {
    charts.push(econChart({
      days: dayList, line: econDaily(econ.citizens, 'money', ids), bars: earnedDaily(data.flows, ids),
      lineLabel: btlT('econCitMoney'), barLabel: btlT('econEarnedDay'), lineClass: 'wp-btl-econ-line-c', barClass: 'wp-btl-bar-in',
      title: btlT('econChartCitizens'),
    }));
  }

  return `
    ${head}
    <div class="wp-btl-cards">
      ${signedCard(btlT('econTreasury'), e.t)}
      <div class="wp-btl-card"><span>${btlT('econShare')}</span><strong>${share || '—'}</strong><em>${btlT('econShareSub')}</em></div>
      ${signedCard(btlT('econCitMoney'), e.m)}
      ${signedCard(btlT('econCitWealth'), e.w)}
      ${e.p ? `<div class="wp-btl-card"><span>${btlT('econCitCount')}</span><strong>${Math.round(e.p.end).toLocaleString()}</strong>
        <em>${e.p.delta ? `${e.p.delta > 0 ? '+' : '−'}${Math.abs(Math.round(e.p.delta))} · ` : ''}${btlT('econSince', { d: e.p.from })}</em></div>` : ''}
    </div>
    ${partialNote ? `<p class="wp-btl-meta">${escapeHtml(partialNote)}</p>` : ''}
    <div class="wp-btl-econcharts">${charts.join('')}</div>
    <p class="wp-btl-foot">${btlT('econNote')}</p>`;
}

function econChart({ days, line, bars, lineLabel, barLabel, lineClass, barClass, title }) {
  const n = days.length;
  const lv = days.map(d => (line.has(d) ? line.get(d) : null));
  const bv = days.map(d => bars.get(d) || 0);
  const vals = lv.filter(v => v != null);
  if (vals.length < 2) {
    return `<div class="wp-btl-econchart"><div class="wp-btl-econchart-t">${title}</div><div class="wp-btl-empty">${btlT('econNoSeries')}</div></div>`;
  }
  const W = Math.max(320, n * 18), H = 170, padL = 52, padR = 6, padT = 10, padB = 18;
  const plotH = H - padT - padB;
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const span = hi - lo || Math.max(1, Math.abs(hi) * 0.05);
  lo -= span * 0.08; hi += span * 0.08;
  const bmax = Math.max(...bv, 1);
  const bw = (W - padL - padR) / n;
  const x = (i) => padL + (i + 0.5) * bw;
  const y = (v) => padT + (1 - (v - lo) / (hi - lo)) * plotH;

  // Linea spezzata sui buchi: un giorno senza scatto non è un giorno uguale.
  let d = '', pen = false;
  lv.forEach((v, i) => {
    if (v == null) { pen = false; return; }
    d += `${pen ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    pen = true;
  });
  // Le barre stanno nella metà bassa, con la loro scala.
  const barH = (v) => (v / bmax) * plotH * 0.45;
  const barsSvg = bv.map((v, i) => (v > 0
    ? `<rect x="${(x(i) - bw / 2 + 1).toFixed(1)}" y="${(H - padB - barH(v)).toFixed(1)}" width="${Math.max(1, bw - 2).toFixed(1)}" height="${barH(v).toFixed(1)}" class="${barClass}" rx="1"/>`
    : '')).join('');
  const hits = days.map((day, i) => `<rect class="wp-tip-hit" x="${(x(i) - bw / 2).toFixed(1)}" y="${padT}" width="${bw.toFixed(1)}" height="${plotH}"${tipAttr(
    day, `${lineLabel}\t${lv[i] == null ? '—' : fmtMoney(lv[i])}`, `${barLabel}\t${fmtMoney(bv[i])}`)}/>`).join('');

  return `
    <div class="wp-btl-econchart">
      <div class="wp-btl-econchart-t">${title}</div>
      <div class="wp-btl-chartwrap">
        <svg class="wp-btl-chart" width="${W}" height="${H}" role="img" aria-label="${escapeHtml(title)}">
          <line x1="${padL}" y1="${H - padB}" x2="${W - padR}" y2="${H - padB}" class="wp-btl-axis"/>
          <text x="${padL - 4}" y="${padT + 8}" class="wp-btl-axislbl" text-anchor="end">${fmtMoney(hi)}</text>
          <text x="${padL - 4}" y="${H - padB - 2}" class="wp-btl-axislbl" text-anchor="end">${fmtMoney(lo)}</text>
          ${barsSvg}
          <path d="${d.trim()}" class="${lineClass}" fill="none"/>
          ${hits}
          <text x="${padL}" y="${H - 4}" class="wp-btl-axislbl">${days[0].slice(5)}</text>
          <text x="${W - padR}" y="${H - 4}" class="wp-btl-axislbl" text-anchor="end">${days[n - 1].slice(5)}</text>
        </svg>
      </div>
      <div class="wp-btl-legend">
        <span class="wp-btl-key"><i class="wp-btl-sw-line ${lineClass}"></i>${lineLabel}</span>
        <span class="wp-btl-key"><i class="${barClass === 'wp-btl-bar-in' ? 'wp-btl-sw-in' : 'wp-btl-sw-c'}"></i>${barLabel} · ${btlT('econBarScale', { v: fmtMoney(bmax) })}</span>
      </div>
    </div>`;
}

/** La barra impilata di una riga: lunghezza = spesa totale rispetto alla
 *  prima in classifica, riempimento = quanto è taglia e quanto contratti.
 *  Il minimo del 2% esiste perché una nazione che ha speso poco resti
 *  comunque visibile come riga, invece di sembrare una casella vuota.
 *  Chi non ha speso niente (solo incassi) ha la pista vuota: una barra
 *  viola da 2% direbbe che ha speso in contratti. */
function compBar(r, max, showBounty) {
  if (!(r.total > 0)) return '<span class="wp-btl-track"></span>';
  const len = Math.max(2, (r.total / max) * 100);
  const bPart = r.total > 0 && showBounty ? (r.bounty / r.total) * 100 : 0;
  const cPart = 100 - bPart;
  const title = showBounty
    ? `${btlT('bountyLabel')} ${fmtMoney(r.bounty)} · ${btlT('contractsLabel')} ${fmtMoney(r.contracts)}`
    : `${btlT('contractsLabel')} ${fmtMoney(r.contracts)}`;
  return `<span class="wp-btl-track" title="${escapeHtml(title)}">
    <span class="wp-btl-fill" style="width:${len.toFixed(1)}%">
      ${bPart > 0 ? `<i class="wp-btl-seg-b" style="width:${bPart.toFixed(1)}%"></i>` : ''}
      <i class="wp-btl-seg-c" style="width:${cPart.toFixed(1)}%"></i>
    </span>
  </span>`;
}

/** Tabella delle righe, per nazioni o per alleanze: stesse colonne, cambia
 *  solo la cella del nome e l'attributo su cui si aggancia il clic. */
function tableHtml(rows, { kind, max, denom, showBounty, hasFlows }) {
  const isAlliance = kind === 'alliance';
  const sortable = (key, label, tip) =>
    `<th class="wp-btl-num wp-btl-tight wp-btl-sortable${_sort === key ? ' active' : ''}" data-sort="${key}"${tip ? ` title="${escapeHtml(tip)}"` : ''}>${label}${_sort === key ? '<span class="wp-btl-caret">▾</span>' : ''}</th>`;

  const nameCell = (r) => isAlliance
    ? `<span class="wp-btl-nation">${allianceSwatch(r.aid)}${escapeHtml(allianceName(r.aid))}<span class="wp-btl-sub">${btlT('nationsCount', { n: r.members.length })}</span></span>`
    : `<span class="wp-btl-nation">${flagHtml(r.cid)}${escapeHtml(nationName(r.cid))}</span>`;

  return `${scrollHintHtml(560)}
    <div class="wp-btl-tablewrap">
      <table class="wp-btl-table wp-btl-xp">
        <thead><tr>
          <th class="wp-btl-rank">#</th>
          <th class="wp-btl-xp-name">${isAlliance ? btlT('colAlliance') : btlT('colNation')}</th>
          <th class="wp-btl-comp">
            <span class="wp-btl-key-inline">
              ${showBounty ? `<span class="wp-btl-key"><i class="wp-btl-sw-b"></i>${btlT('bountyLabel')}</span>` : ''}
              <span class="wp-btl-key"><i class="wp-btl-sw-c"></i>${btlT('contractsLabel')}</span>
            </span>
          </th>
          ${showBounty ? sortable('bounty', btlT('colBounty')) : ''}
          ${sortable('contracts', btlT('colContracts'))}
          ${sortable('total', btlT('colTotal'))}
          <th class="wp-btl-num wp-btl-tight">${btlT('colPerDay')}</th>
          ${hasFlows ? sortable('earned', btlT('colEarned'), btlT('earnedTip')) : ''}
          ${hasFlows ? sortable('net', btlT('colNet'), btlT('netTip')) : ''}
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="wp-btl-row wp-btl-clickable" ${isAlliance ? `data-alliance="${escapeHtml(r.aid)}"` : `data-country="${escapeHtml(r.cid)}"`}>
              <td class="wp-btl-rank">${i + 1}</td>
              <td class="wp-btl-xp-name">${nameCell(r)}</td>
              <td class="wp-btl-comp">${compBar(r, max, showBounty)}</td>
              ${showBounty ? `<td class="wp-btl-num wp-btl-tight wp-btl-bounty">${fmtMoney(r.bounty)}</td>` : ''}
              <td class="wp-btl-num wp-btl-tight wp-btl-contracts">${fmtMoney(r.contracts)}<span class="wp-btl-sub">×${r.contractCount}</span></td>
              <td class="wp-btl-num wp-btl-tight wp-btl-total">${fmtMoney(r.total)}</td>
              <td class="wp-btl-num wp-btl-tight wp-btl-dim">${fmtMoney(r.total / denom)}</td>
              ${hasFlows ? `<td class="wp-btl-num wp-btl-tight wp-btl-earned">${r.earned > 0 ? fmtMoney(r.earned) : '—'}${r.earnedCount ? `<span class="wp-btl-sub">×${r.earnedCount}</span>` : ''}</td>` : ''}
              ${hasFlows ? `<td class="wp-btl-num wp-btl-tight ${netClass(r.net)}">${fmtSigned(r.net)}</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** Colonne "Conti": la spesa accanto al tesoro e ai cittadini. Stesse righe
 *  (e stesso clic) della tabella delle spese, altre colonne. */
function econTableHtml(rows, { kind, hasFlows, econ }) {
  const isAlliance = kind === 'alliance';
  const sortable = (key, label, tip) =>
    `<th class="wp-btl-num wp-btl-tight wp-btl-sortable${_sort === key ? ' active' : ''}" data-sort="${key}"${tip ? ` title="${escapeHtml(tip)}"` : ''}>${label}${_sort === key ? '<span class="wp-btl-caret">▾</span>' : ''}</th>`;
  const nameCell = (r) => isAlliance
    ? `<span class="wp-btl-nation">${allianceSwatch(r.aid)}${escapeHtml(allianceName(r.aid))}<span class="wp-btl-sub">${btlT('nationsCount', { n: (r.econIds || r.members).length })}</span></span>`
    : `<span class="wp-btl-nation">${flagHtml(r.cid)}${escapeHtml(nationName(r.cid))}</span>`;
  const signed = (v) => `<td class="wp-btl-num wp-btl-tight ${v == null ? 'wp-btl-dim' : netClass(v)}">${v == null ? '—' : fmtSigned(v)}</td>`;
  const share = (r) => {
    if (r.spendShare == null) return '<td class="wp-btl-num wp-btl-tight wp-btl-dim">—</td>';
    const p = r.spendShare * 100;
    return `<td class="wp-btl-num wp-btl-tight${p >= 100 ? ' wp-btl-neg' : ''}">${p >= 10 ? p.toFixed(0) : p.toFixed(1)}%</td>`;
  };
  return `${scrollHintHtml(640)}
    <div class="wp-btl-tablewrap">
      <table class="wp-btl-table wp-btl-xp wp-btl-econ">
        <thead><tr>
          <th class="wp-btl-rank">#</th>
          <th class="wp-btl-xp-name">${isAlliance ? btlT('colAlliance') : btlT('colNation')}</th>
          ${sortable('total', btlT('econColSpend'))}
          ${econ?.treasury ? `${sortable('treasury', btlT('econColTreasury'), btlT('econTreasuryTip'))}
          ${sortable('dTreasury', btlT('econColDTreasury'))}
          ${sortable('spendShare', btlT('econColShare'), btlT('econShareTip'))}` : ''}
          ${econ?.citizens ? `${sortable('dMoney', btlT('econColDMoney'), btlT('econCitTip'))}
          ${sortable('dWealth', btlT('econColDWealth'), btlT('econCitTip'))}` : ''}
          ${hasFlows ? sortable('earned', btlT('colEarned'), btlT('earnedTip')) : ''}
        </tr></thead>
        <tbody>
          ${rows.map((r, i) => `
            <tr class="wp-btl-row wp-btl-clickable" ${isAlliance ? `data-alliance="${escapeHtml(r.aid)}"` : `data-country="${escapeHtml(r.cid)}"`}>
              <td class="wp-btl-rank">${i + 1}</td>
              <td class="wp-btl-xp-name">${nameCell(r)}</td>
              <td class="wp-btl-num wp-btl-tight wp-btl-total">${fmtMoney(r.total)}</td>
              ${econ?.treasury ? `<td class="wp-btl-num wp-btl-tight">${r.treasury == null ? '—' : fmtMoney(r.treasury)}</td>${signed(r.dTreasury)}${share(r)}` : ''}
              ${econ?.citizens ? `${signed(r.dMoney)}${signed(r.dWealth)}` : ''}
              ${hasFlows ? `<td class="wp-btl-num wp-btl-tight wp-btl-earned">${r.earned > 0 ? fmtMoney(r.earned) : '—'}</td>` : ''}
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`;
}

/** Ordinamento con i "non lo so" in fondo, mai mescolati agli zeri. */
function sortRows(rows) {
  const v = (r) => (r[_sort] == null || !Number.isFinite(r[_sort]) ? -Infinity : r[_sort]);
  return rows.sort((a, b) => { const x = v(a), y = v(b); return x === y ? 0 : (y > x ? 1 : -1); });
}

export function renderWarExpenses(data) {
  const showBounty = !data.bountyMissing;
  // Una colonna di ordinamento che nelle colonne scelte non c'è torna al totale.
  if (!(_cols === 'econ' ? ECON_SORTS : SPEND_SORTS).has(_sort)) _sort = 'total';
  const flowAgg = aggregateFlows(data.flows, _days);
  const hasFlows = flowAgg.days > 0;

  const notices = [];
  if (data.degraded) notices.push(`<div class="wp-btl-notice warn">${btlT('degraded')}</div>`);
  if (data.bountyMissing) notices.push(`<div class="wp-btl-notice warn">${btlT('degradedBounty')}</div>`);
  // Incassi: senza server si dichiara; con l'archivio ancora parziale si dice
  // da che giorno sono completi (nella barra strumenti, come la copertura).
  if (!hasFlows && !data.degraded) notices.push(`<div class="wp-btl-notice warn">${btlT('flowMissing')}</div>`);

  // La copertura si dichiara SEMPRE, anche in modalità ridotta: è
  // l'informazione che spiega perché "al giorno" è calcolato su pochi
  // giorni invece che sull'intera finestra scelta. Sta nella barra
  // strumenti e non in un riquadro a tutta larghezza: è una nota di
  // contesto, e un riquadro grigio in cima alla pagina si legge come un
  // avviso di malfunzionamento che qui non c'è.
  const covered = coveredDays(data.byDay);
  const flowPartial = hasFlows && flowAgg.from > flowAgg.windowFrom;

  const head = `
    ${notices.join('')}
    <div class="wp-btl-toolbar">
      <div class="wp-btl-filters">
        <span class="wp-btl-lbl">${btlT('viewLabel')}</span>
        <button type="button" class="wp-btl-chip${_group === 'nation' ? ' active' : ''}" data-group="nation">${btlT('viewNation')}</button>
        <button type="button" class="wp-btl-chip${_group === 'alliance' ? ' active' : ''}" data-group="alliance">${btlT('viewAlliance')}</button>
      </div>
      <div class="wp-btl-filters">
        <span class="wp-btl-lbl">${btlT('windowLabel')}</span>
        ${WINDOWS.map(w => `<button type="button" class="wp-btl-chip${_days === w.days ? ' active' : ''}" data-days="${w.days}">${btlT(w.key)}</button>`).join('')}
      </div>
      <div class="wp-btl-filters">
        <span class="wp-btl-lbl">${btlT('colsLabel')}</span>
        <button type="button" class="wp-btl-chip${_cols === 'spend' ? ' active' : ''}" data-cols="spend">${btlT('colsSpend')}</button>
        <button type="button" class="wp-btl-chip${_cols === 'econ' ? ' active' : ''}" data-cols="econ">${btlT('colsEcon')}</button>
      </div>
      <span class="wp-btl-meta">${btlT('coverage', { n: covered })}${flowPartial ? ` · ${btlT('flowSince', { d: flowAgg.from })}` : ''}</span>
    </div>`;

  const nationRows = buildNationRows(data, flowAgg, showBounty);
  const linkBar = (params) => `<div class="wp-btl-linkbar">${copyLinkHtml(battlesHref({ tab: 'expenses', ...getExpensesLinkState(), ...params }))}</div>`;

  if (_selected) return head + linkBar({ ally: undefined }) + detailHtml(data, { kind: 'nation', id: _selected }, flowAgg, nationRows);
  if (_selectedAlliance) return head + linkBar({}) + detailHtml(data, { kind: 'alliance', id: _selectedAlliance }, flowAgg, nationRows);

  const isAlliance = _group === 'alliance';
  const rows = sortRows(isAlliance ? buildAllianceRows(nationRows, flowAgg, data.econ) : nationRows);

  if (!rows.length) return head + `<div class="wp-btl-empty">${btlT('noExpenses')}</div>`;

  // ⚠️ Il metro della barra è SEMPRE il totale più alto, mai il massimo
  // della colonna ordinata: riordinando cambierebbe la scala sotto agli
  // occhi e due schermate della stessa tabella non sarebbero confrontabili.
  const max = Math.max(...rows.map(r => r.total), 1);
  const denom = effectiveDays(data.byDay, _days);

  if (_cols === 'econ') {
    const econ = data.econ;
    const econNotices = [];
    if (econ === undefined) econNotices.push(`<div class="wp-btl-notice">${btlT('econLoading')}</div>`);
    else if (!econ?.treasury && !econ?.citizens) econNotices.push(`<div class="wp-btl-notice warn">${btlT('econMissing')}</div>`);
    else {
      // Da quando contano davvero le due variazioni, se la finestra parte prima.
      const any = rows.find(r => r.econ?.t) || {};
      const anyC = rows.find(r => r.econ?.m) || {};
      const parts = [];
      if (any.econ?.t) parts.push(`${btlT('econTreasury')}: ${any.econ.t.from} → ${any.econ.t.to}`);
      if (anyC.econ?.m) parts.push(`${btlT('econCitizens')}: ${anyC.econ.m.from} → ${anyC.econ.m.to}`);
      if (parts.length) econNotices.push(`<p class="wp-btl-meta">${btlT('econPeriod')} ${escapeHtml(parts.join(' · '))}</p>`);
    }
    return head + econNotices.join('') + econTableHtml(rows, { kind: isAlliance ? 'alliance' : 'nation', hasFlows, econ }) + `
      <p class="wp-btl-foot">${btlT('econNote')}</p>
      ${isAlliance ? `<p class="wp-btl-foot">${btlT('econAllianceNote')}</p>` : ''}
      <p class="wp-btl-foot">${btlT('notCountryBounty')}</p>`;
  }

  return head + tableHtml(rows, { kind: isAlliance ? 'alliance' : 'nation', max, denom, showBounty, hasFlows }) + `
    <p class="wp-btl-foot">${btlT('bountyNote')}</p>
    <p class="wp-btl-foot">${btlT('notCountryBounty')}</p>
    ${hasFlows ? `<p class="wp-btl-foot">${btlT('flowNote')}</p>` : ''}
    ${isAlliance ? `<p class="wp-btl-foot">${btlT('allianceNote')}</p>` : ''}
    <p class="wp-btl-foot">${btlT('tzNote')}</p>`;
}

export function wireWarExpenses(root, data, { onRepaint, onSeeBattles }) {
  root.querySelectorAll('.wp-btl-chip[data-days]').forEach(chip => {
    chip.addEventListener('click', () => { _days = Number(chip.dataset.days); onRepaint(); });
  });

  // Cambiare vista chiude qualunque dettaglio aperto: un'alleanza e una
  // nazione non sono lo stesso elenco, e restare su un dettaglio dopo aver
  // cliccato "Per alleanza" sembrerebbe che il clic non abbia fatto niente.
  root.querySelectorAll('.wp-btl-chip[data-group]').forEach(chip => {
    chip.addEventListener('click', () => {
      _group = chip.dataset.group;
      _selected = null; _selectedAlliance = null;
      onRepaint();
    });
  });

  root.querySelectorAll('.wp-btl-chip[data-cols]').forEach(chip => {
    chip.addEventListener('click', () => { _cols = chip.dataset.cols; onRepaint(); });
  });

  root.querySelectorAll('.wp-btl-sortable').forEach(th => {
    th.addEventListener('click', () => { _sort = th.dataset.sort; onRepaint(); });
  });

  root.querySelectorAll('.wp-btl-clickable').forEach(tr => {
    tr.addEventListener('click', () => {
      if (tr.dataset.alliance) _selectedAlliance = tr.dataset.alliance;
      else _selected = tr.dataset.country;
      onRepaint();
    });
  });

  // Dalle liste "paga a / incassa da" si salta alla nazione. Da un'alleanza
  // il "← indietro" torna all'alleanza (vedi sotto), da una nazione all'elenco.
  root.querySelectorAll('[data-open-nation]').forEach(li => {
    li.addEventListener('click', () => { _selected = li.dataset.openNation; onRepaint(); });
  });

  root.querySelector('#wp-btl-back')?.addEventListener('click', () => {
    if (_selected) _selected = null;           // torna all'alleanza se si veniva da lì
    else _selectedAlliance = null;
    onRepaint();
  });

  root.querySelector('.wp-btl-seebattles')?.addEventListener('click', (e) => {
    onSeeBattles(e.currentTarget.dataset.see);
  });
}
