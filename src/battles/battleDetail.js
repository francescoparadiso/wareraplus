/* ══════════════════════════════════════════════════════════════
   WarEra+ — Dettaglio di una battaglia
   ------------------------------------------------------------------
   Si apre cliccando una riga dell'archivio. Risponde alla domanda che
   l'elenco non può rispondere: dietro a "57M di danno e 4.019 di costo",
   CHI c'era e chi ha preso cosa.

   In cima il riepilogo (regione, esito, danno, costo), sempre visibile.
   Sotto, una SCHEDA alla volta (_dtab):
   - NAZIONI per schieramento — danno, quota del lato, taglia incassata;
   - le stesse nazioni sommate per ALLEANZA (di quando è iniziata);
   - unità militari, stesse colonne, caricate all'apertura della scheda;
   - ANDAMENTO minuto per minuto (quando è entrata ogni nazione, dove si
     è girata) — solo per le battaglie che il server ha registrato, vedi
     battleTimeline.js;
   - finanziatori dei due belligeranti;
   - contratti mercenari: chi paga, quale unità, quanto;
   - BONUS (solo battaglie in corso): per ogni lato le nazioni con un
     bonus danno loro e le voci che lo compongono, più il tuo se in
     Giocatori hai detto "Sono io". Calcolo in src/shared/battleBonus.js.
   Prima stavano tutte una sotto l'altra, e la pagina era un muro.

   ── ⚠️ LA PAROLA "TAGLIA" QUI VUOL DIRE UN'ALTRA COSA ──────────────
   Nell'elenco e nelle spese di guerra la taglia è quanto uno
   schieramento ha SPESO. Qui, riga per riga, è quanto quella nazione ha
   INCASSATO: la classifica money elenca chi riceve, non chi paga, e su
   una battaglia sola incassano anche cinquanta nazioni alleate.
   Coincidono solo sommando l'intera colonna di uno schieramento — che
   infatti è il totale mostrato in fondo. Le intestazioni lo dicono, e
   non è pignoleria: è lo stesso equivoco che rende inutilizzabile
   `rankings.countryBounty` come misura di spesa.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { getFlagUrl, getNationCode } from '../panel/nationFlag.js';
import { btlT } from './i18n.js';
import { getBattleDetail, getBattleMuBreakdown, getRoundRanking } from './api.js';
import { fetchMoneyTransfers, transfersFor, windowIsShort } from './moneyTransfers.js';
import { fetchBattleTimeline, timelineSectionHtml, wireTimeline, resetTimeline } from './battleTimeline.js';
import {
  loadBonusRules, fetchBattleOrders, loadMe, myPlayerId, sideContext, sideNationRows, personalBonus,
  orderPct, PRIORITIES,
} from '../shared/battleBonus.js';
import { fetchActiveBattles } from '../diplomacy/battleHeatmap.js';
import { bvT } from '../diplomacy/bonusView.js';

// Righe mostrate prima del "mostra tutte": una battaglia grossa ha ~77
// nazioni per lato, e le prime dieci fanno quasi tutto il danno.
const TOP = 10;

let _detail = null;
let _mu = null;
let _muState = 'closed';   // 'closed' | 'loading' | 'open' | 'error'
let _expanded = { attacker: false, defender: false };
// Directory unità militari: serve solo a dare un NOME agli id delle
// classifiche MU. Vive qui e non nello stato della vista perché è una
// cache di sessione — scaricata al massimo una volta, condivisa con la
// vista Unità Militari, e sopravvive alla chiusura di un dettaglio.
let _dir = null;
// Nome + avatar risolti uno per uno (mu.getById in batch), per gli id che
// servono SUBITO e in numero piccolo: i contratti mercenari. Vedi
// fetchMuBriefs in src/mu/api.js per il perché non si scarica la
// directory intera.
let _muInfo = new Map();
// Finanziamenti fra tesori. Lista unica per la sessione (vedi
// moneyTransfers.js), filtrata qui sulla finestra della battaglia.
let _money = null;
let _spend = null;   // taglia stimata + contratti (src/diplomacy/battleSpending.js), per la testata
// Andamento minuto per minuto (battleTimeline.js). null = il server non
// l'ha registrata, e la sezione semplicemente non compare.
let _tl = null;
// Registro delle alleanze (src/app/timeMachineAlliances.js, ~80 KB gzip,
// una volta per sessione). `_allyHist` = il modulo, se il registro è
// arrivato; `_allyTried` dice che il tentativo è finito, riuscito o no.
// Sopravvivono fra una battaglia e l'altra: il registro è lo stesso.
let _allyHist = null;
let _allyTried = false;
// Scheda del dettaglio in vista. Prima tutte le sezioni stavano una sotto
// l'altra (finanziatori, andamento, sorpassi, ingressi, nazioni, alleanze,
// unità, contratti) e la pagina era un muro: ora se ne vede una alla
// volta. NON si azzera cambiando battaglia: chi sta confrontando le
// alleanze di tre battaglie le vuole vedere tutte e tre lì.
let _dtab = 'nations';
// Scheda Bonus: null (non caricata) | 'loading' | 'error' | { ... }.
let _bonus = null;
let _ctrAll = false;   // contratti: tutti o solo i primi CTR_TOP
// Ultimo repaint/battaglia passati a wireBattleDetail: il listener
// delegato si aggancia UNA volta sola al contenitore (che sopravvive ai
// repaint) e legge questi, non quelli del primo giro.
let _wired = { battle: null, repaint: null };

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
function fmtDate(ms) {
  if (!ms) return '—';
  return new Date(ms).toLocaleString(undefined, {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

function nationName(id) { return state.nationMap?.get(id)?.name || null; }
function regionName(id) { return state.regionData?.[id]?.name || null; }

function flagHtml(id) {
  const n = state.nationMap?.get(id);
  if (!n) return '<span class="wp-btl-flag"></span>';
  const url = getFlagUrl(getNationCode(id, n));
  return url ? `<img class="wp-btl-flag" src="${url}" alt="" loading="lazy" onerror="this.style.visibility='hidden'">` : '<span class="wp-btl-flag"></span>';
}

/** Nome unità militare dalla directory GIÀ in memoria. Non la scarica:
 *  quella scelta la fa il chiamante (vedi openMuSection). */
function muName(id) {
  const brief = _muInfo.get(id);
  if (brief?.name) return brief.name;
  const m = _dir?.find(x => x._id === id);
  return m?.name || null;
}

function muAvatarUrl(id) {
  const brief = _muInfo.get(id);
  if (brief) return brief.avatarUrl || null;
  return _dir?.find(x => x._id === id)?.avatarUrl || null;
}

/* ── Una unità militare come si deve: logo, nome, e un click che porta
   alla sua scheda. Le stesse unità hanno già una vista dedicata —
   leggerne il nome qui e dover poi andare a cercarla a mano in Esplora
   Unità Militari era lavoro scaricato sull'utente.
   Se il nome non si è risolto NON diventa un link: un bottone che porta
   a una scheda vuota è peggio di un testo inerte. ── */
function muCellHtml(id) {
  const name = muName(id);
  const url = muAvatarUrl(id);
  const av = `<span class="wp-btl-mu-av">${
    url ? `<img src="${escapeHtml(url)}" alt="" loading="lazy" onerror="this.remove()">` : ''
  }</span>`;
  if (!name) return `${av}<span class="wp-btl-mu-unres">${btlT('unknownMu')}</span>`;
  return `<button type="button" class="wp-btl-mu-link" data-mu-id="${escapeHtml(id)}"
    title="${btlT('openMuHint')}">${av}<span>${escapeHtml(name)}</span></button>`;
}

function typeLabel(t) {
  if (t === 'resistance') return btlT('typeResistance');
  if (t === 'tournament') return btlT('typeTournament');
  return btlT('typeWar');
}

function sideHeadHtml(battle, sideKey, label, color, countryId) {
  return `
      <div class="wp-btl-side-head" style="--side:${color}">
        ${countryId ? flagHtml(countryId) : ''}
        <span class="wp-btl-side-name">${escapeHtml(nationName(countryId) || typeLabel(battle.type))}</span>
        <span class="wp-btl-side-role">${label}</span>
        ${battle.wonBy === sideKey ? `<span class="wp-btl-winner">🏆</span>` : ''}
      </div>`;
}

/* ── Una colonna: un lato della battaglia ──
   La percentuale è sul danno del LATO, non della battaglia intera: la
   domanda è "quanto ha pesato questa nazione fra i suoi", e con due lati
   sbilanciati la quota sul totale non risponderebbe. */
function sideTable(rows, sideKey, battle, opts) {
  const { label, color, countryId, expanded, entityName, entityFlag, truncated, entityHeader,
          entityCell, sentBy, pay } = opts;
  // entityCell: cella già in HTML (unità militari, che sono cliccabili).
  // Senza, si resta al comportamento originale nome+bandiera come testo.
  const cell = entityCell || ((id) => `${entityFlag(id)}${escapeHtml(entityName(id) || '—')}`);
  const totDmg = rows.reduce((s, r) => s + r.damage, 0);
  const totMoney = rows.reduce((s, r) => s + r.money, 0);
  const shown = expanded ? rows : rows.slice(0, TOP);
  // Solo per le nazioni (vedi payPerK): contratti incassati + prezzo per 1k.
  const withContracts = pay && pay.totContracts > 0;
  // Incassato ÷ danno: la classifica "money" contiene GIÀ la paga dei
  // contratti (vedi il ⚠️ in src/diplomacy/battleSpending.js). Sommarci i
  // contratti li contava due volte — l'Italia risultava a 0,107 per 1k.
  const avgK = pay ? perK(totMoney, totDmg) : null;

  return `
    <div class="wp-btl-side-col wp-btl-side-${sideKey}">
      ${sideHeadHtml(battle, sideKey, label, color, countryId)}
      <table class="wp-btl-table wp-btl-side-table${pay ? ' wp-btl-has-pay' : ''}">
        <thead><tr>
          <th>${entityHeader}</th>
          <th class="wp-btl-num">${btlT('colDamage')}</th>
          <th class="wp-btl-num wp-btl-pct">%</th>
          <th class="wp-btl-num" title="${btlT('earnedHint')}">${btlT('colEarned')}</th>
          ${withContracts ? `<th class="wp-btl-num wp-btl-col-ctr" title="${btlT('ctrEarnedHint')}">${btlT('colCtrEarned')}</th>` : ''}
          ${pay ? `<th class="wp-btl-num" title="${btlT('paidPerKHint')}">${btlT('colPaidPerK')}</th>` : ''}
        </tr></thead>
        <tbody>
          ${shown.map(r => `
            <tr>
              <td class="wp-btl-nation">${cell(r.id)}</td>
              <td class="wp-btl-num">${fmtNum(r.damage)}</td>
              <td class="wp-btl-num wp-btl-pct">${totDmg ? (r.damage / totDmg * 100).toFixed(1) : '0.0'}%</td>
              <td class="wp-btl-num wp-btl-bounty">${r.money ? fmtMoney(r.money) : '—'}${sentHtml(sentBy, r.id)}</td>
              ${withContracts ? `<td class="wp-btl-num wp-btl-contracts wp-btl-col-ctr">${pay.byCountry.get(r.id) ? fmtMoney(pay.byCountry.get(r.id)) : '—'}</td>` : ''}
              ${pay ? perKCell(perK(r.money, r.damage), avgK) : ''}
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>${btlT('colTotalRow', { n: rows.length })}</td>
          <td class="wp-btl-num">${fmtNum(totDmg)}</td>
          <td class="wp-btl-num wp-btl-pct">100%</td>
          <td class="wp-btl-num wp-btl-bounty">${fmtMoney(totMoney)}</td>
          ${withContracts ? `<td class="wp-btl-num wp-btl-contracts wp-btl-col-ctr">${fmtMoney(pay.totContracts)}</td>` : ''}
          ${pay ? `<td class="wp-btl-num wp-btl-perk">${fmtPerK(avgK)}</td>` : ''}
        </tr></tfoot>
      </table>
      ${truncated ? `<p class="wp-btl-foot wp-btl-foot-tight wp-btl-side-note">${btlT('rankTruncated')}</p>` : ''}
      ${rows.length > TOP
        ? `<button type="button" class="wp-btl-more wp-btl-side-more" data-side="${sideKey}">${
            expanded ? btlT('showTop', { n: TOP }) : btlT('showAll', { n: rows.length })}</button>`
        : ''}
    </div>`;
}

/* ── Quanto è stato PAGATO il danno, nazione per nazione ──
   incassato ÷ danno × 1000: quanti soldi sono entrati in tasca ai
   cittadini di quella nazione per ogni mille danni fatti su questo
   schieramento. L'incassato è la classifica "money", che contiene GIÀ sia
   la taglia sia la paga dei contratti (misurato il 2026-09-29, vedi
   src/diplomacy/battleSpending.js): prima ci si sommavano anche i
   contratti, e venivano contati due volte. La colonna contratti resta, ma
   come "di cui", informativa.

   ⚠️ Il contratto lo vince un'UNITÀ, non una nazione: qui il compenso va
   alla nazione dell'unità (`mu.country`). Chi nell'unità ha un'altra
   cittadinanza viene così contato sotto quella dell'unità — un'approssimazione
   dichiarata nella nota, non un dato del gioco.
   ⚠️ Un contratto conta per il compenso PATTUITO appena è aggiudicato,
   anche se su una battaglia in corso il danno non è ancora stato
   consegnato: finché non finisce, il prezzo per 1k di chi ha contratti
   aperti è gonfiato. La nota lo dice.

   Il confronto è con la media del PROPRIO schieramento, non con un costo
   "di pareggio": quello richiede il costo di un colpo, che non è ancora
   calibrato. Sopra la media = pagato meglio degli altri sullo stesso lato. ── */
function payPerK(sideKey) {
  const byCountry = new Map();
  let totContracts = 0;
  let unresolved = 0;
  for (const c of _detail?.contracts || []) {
    if (c.side !== sideKey) continue;
    totContracts += c.payout;
    const country = _muInfo.get(c.mu)?.country;
    if (!country) { unresolved += c.payout; continue; }
    byCountry.set(country, (byCountry.get(country) || 0) + c.payout);
  }
  return { byCountry, totContracts, unresolved };
}

function perK(money, damage) {
  return damage > 0 ? money / damage * 1000 : null;
}
function fmtPerK(v) {
  if (v == null || !Number.isFinite(v)) return '—';
  return v >= 1 ? v.toFixed(2) : v.toFixed(3);
}
// ±15% dalla media: sotto quella soglia la differenza è rumore (un
// membro di governo col +50% di taglia basta a spostare una nazione piccola).
function perKCell(v, avg) {
  let cls = '';
  if (v != null && avg) {
    if (v > avg * 1.15) cls = ' wp-btl-perk-hi';
    else if (v < avg * 0.85) cls = ' wp-btl-perk-lo';
  }
  return `<td class="wp-btl-num wp-btl-perk${cls}">${fmtPerK(v)}</td>`;
}

/** Quanto quella nazione aveva VERSATO a questo schieramento, accanto a
 *  quanto ha incassato. Compare solo per chi ha versato davvero: uno
 *  "− 0" su tutte le altre righe sarebbe rumore su un dato raro.
 *
 *  ⚠️ i due numeri NON si sottraggono per davvero: il versato entra nel
 *  tesoro del belligerante, l'incassato lo prendono i cittadini di chi
 *  versa. Il rosso segna un'uscita, non un saldo — vedi la nota sotto la
 *  tabella. */
function sentHtml(sentBy, countryId) {
  const sent = sentBy?.get(countryId);
  if (!sent) return '';
  return `<span class="wp-btl-sent-dash">−</span><span class="wp-btl-sent"
    title="${btlT('sentHint')}">${fmtMoney(sent)}</span>`;
}

/** Somma per nazione dei bonifici entrati in `countryId` nella finestra. */
function sentTotals(countryId, fromMs, toMs) {
  const out = new Map();
  if (!_money || !countryId || !fromMs) return out;
  for (const t of transfersFor(_money, countryId, fromMs, toMs)) {
    out.set(t.from, (out.get(t.from) || 0) + t.money);
  }
  return out;
}

// Contratti mostrati prima del "mostra tutti": una battaglia grossa ne ha
// centinaia (169 sulla Francia–Italia del 13 ottobre, ~7.000 px di
// tabella), e sono in ordine di compenso — i primi sono quelli che contano.
const CTR_TOP = 20;

function contractsHtml(contracts, truncated) {
  if (!contracts.length) return `<p class="wp-btl-foot">${btlT('noContracts')}</p>`;
  const total = contracts.reduce((s, c) => s + c.payout, 0);
  const shown = _ctrAll ? contracts : contracts.slice(0, CTR_TOP);
  return `
    <h3 class="wp-btl-h3">${btlT('contractsLabel')} <span class="wp-btl-sub">${btlT('contractsCount', { n: contracts.length })} · ${fmtMoney(total)}</span></h3>
    <div class="wp-btl-tablewrap">
      <table class="wp-btl-table">
        <thead><tr>
          <th>${btlT('colPayer')}</th>
          <th>${btlT('colSideFor')}</th>
          <th>${btlT('colHiredMu')}</th>
          <th class="wp-btl-num">${btlT('colMinDamage')}</th>
          <th class="wp-btl-num">${btlT('colPerK')}</th>
          <th class="wp-btl-num">${btlT('colPayout')}</th>
        </tr></thead>
        <tbody>
          ${shown.map(c => `
            <tr>
              <td class="wp-btl-nation">${flagHtml(c.payer)}${escapeHtml(nationName(c.payer) || '—')}</td>
              <td><span class="wp-btl-type">${c.side === 'defender' ? btlT('defender') : btlT('attacker')}</span></td>
              <td class="wp-btl-nation">${muCellHtml(c.mu)}</td>
              <td class="wp-btl-num">${fmtNum(c.minDamage)}</td>
              <td class="wp-btl-num">${c.perK ? c.perK.toFixed(3) : '—'}</td>
              <td class="wp-btl-num wp-btl-contracts">${fmtMoney(c.payout)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${contracts.length > CTR_TOP
      ? `<button type="button" class="wp-btl-more" id="wp-btl-ctr-more">${
          _ctrAll ? btlT('showTopCtr', { n: CTR_TOP }) : btlT('showAllCtr', { n: contracts.length })}</button>`
      : ''}
    ${truncated ? `<p class="wp-btl-foot">⚠️ ${btlT('contractsTruncated')}</p>` : ''}`;
}

/** La nota "nomi non disponibili" va mostrata solo se manca davvero un
 *  nome, non solo perché la directory non è arrivata: adesso i nomi
 *  possono venire anche da mu.getById, e una nota che contraddice quello
 *  che si legge nella tabella è peggio di nessuna nota. */
function muNamesMissing(mu) {
  if (!mu) return false;
  return [...(mu.defender || []), ...(mu.attacker || [])].some(r => !muName(r.id));
}

function muSectionHtml(battle) {
  if (_muState === 'closed') {
    return `<button type="button" class="wp-btl-more" id="wp-btl-mu-open">${btlT('showMus')}</button>`;
  }
  if (_muState === 'loading') return `<div class="wp-btl-loading">${btlT('loadingCost')}</div>`;
  if (_muState === 'error' || !_mu) return `<p class="wp-btl-foot">${btlT('costUnavailable')}</p>`;

  return `
    <div class="wp-btl-sides">
      ${sideTable(_mu.defender, 'defender', battle, {
        label: btlT('defender'), color: 'var(--wp-btl-def)', countryId: battle.defender.countryId,
        expanded: _expanded.defender, entityCell: muCellHtml,
        entityHeader: btlT('colUnit'), truncated: _mu.truncated?.defender })}
      ${sideTable(_mu.attacker, 'attacker', battle, {
        label: btlT('attacker'), color: 'var(--wp-btl-atk)', countryId: battle.attacker.countryId,
        expanded: _expanded.attacker, entityCell: muCellHtml,
        entityHeader: btlT('colUnit'), truncated: _mu.truncated?.attacker })}
    </div>
    ${muNamesMissing(_mu) ? `<p class="wp-btl-foot">${btlT('muNamesMissing')}</p>` : ''}`;
}

/* ══ PER ALLEANZA ══════════════════════════════════════════
   Le stesse righe per nazione, sommate per alleanza: la domanda "quanto
   ha messo il blocco X in questa battaglia" prima si faceva a mano,
   riconoscendo le bandiere una per una. Zero fetch sulle classifiche: è
   _detail.sides raggruppato.

   ⚠️ L'alleanza è quella di QUANDO È INIZIATA la battaglia, dal registro
   eventi (la stessa fonte della time machine), non quella di oggi: un
   archivio di novanta giorni ha nazioni che nel frattempo hanno cambiato
   blocco, e con l'appartenenza di oggi il loro danno finirebbe
   all'alleanza sbagliata senza che niente lo faccia notare. Se il
   registro non arriva si usa quella di oggi (state.nationAlliancesMap),
   e la nota sotto lo dichiara.
   ─────────────────────────────────────────────────────────── */
function allianceOf(countryId, ts) {
  if (_allyHist && ts) {
    const a = _allyHist.alliancesAt(countryId, ts);
    if (a?.tipo === 'blocco') {
      return { id: a.id, name: a.nome || state.allianceMap?.get(a.id)?.name || null, then: a.allora, today: false };
    }
  }
  const ids = state.nationAlliancesMap?.get(countryId);
  const id = ids?.size ? [...ids][0] : null;
  return { id, name: id ? state.allianceMap?.get(id)?.name || null : null, then: null, today: true };
}

function allianceRows(sideKey, ts, sides = _detail?.sides) {
  const by = new Map();
  let today = false;
  for (const r of sides?.[sideKey] || []) {
    const a = allianceOf(r.id, ts);
    if (a.today) today = true;
    const key = a.id || '';
    const cur = by.get(key) || { id: a.id, name: a.name, then: a.then, damage: 0, money: 0, nations: [] };
    cur.damage += r.damage;
    cur.money += r.money;
    cur.nations.push(r.id);     // già in ordine di danno, come le righe
    by.set(key, cur);
  }
  // Per danno, ma "senza alleanza" sempre in fondo: non è un blocco, e in
  // cima sembrerebbe il più grosso di tutti.
  const rows = [...by.values()].sort((a, b) => (!a.id - !b.id) || (b.damage - a.damage));
  return { rows, today };
}

const ALLY_FLAGS = 8;

function allianceCellHtml(a, both) {
  const color = a.id ? (state.allianceColorMap?.get(a.id) || '#888888') : null;
  const name = a.id ? escapeHtml(a.name || '—') : btlT('noAlliance');
  const flags = a.nations.slice(0, ALLY_FLAGS)
    .map(id => `<span title="${escapeHtml(nationName(id) || '')}">${flagHtml(id)}</span>`).join('');
  const more = a.nations.length > ALLY_FLAGS ? `<span class="wp-btl-ally-more">+${a.nations.length - ALLY_FLAGS}</span>` : '';
  return `
    <span class="wp-btl-ally-name">
      <i class="wp-btl-ally-dot${color ? '' : ' wp-btl-ally-dot-none'}"${color ? ` style="background:${color}"` : ''}></i>
      <span>${name}${a.then ? ` <em class="wp-btl-ally-then">${btlT('allyThen', { name: escapeHtml(a.then) })}</em>` : ''}</span>
      ${both ? `<em class="wp-btl-ally-both">${btlT('allyBoth')}</em>` : ''}
    </span>
    <span class="wp-btl-ally-flags">${flags}${more}</span>`;
}

function allianceTable(rows, sideKey, battle, opts) {
  const { label, color, countryId, both } = opts;
  const totDmg = rows.reduce((s, r) => s + r.damage, 0);
  const totMoney = rows.reduce((s, r) => s + r.money, 0);
  return `
    <div class="wp-btl-side-col wp-btl-side-${sideKey}">
      ${sideHeadHtml(battle, sideKey, label, color, countryId)}
      <table class="wp-btl-table wp-btl-side-table wp-btl-ally-table">
        <thead><tr>
          <th>${btlT('colAlliance')}</th>
          <th class="wp-btl-num">${btlT('colDamage')}</th>
          <th class="wp-btl-num wp-btl-pct">%</th>
          <th class="wp-btl-num" title="${btlT('earnedHint')}">${btlT('colEarned')}</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="wp-btl-ally">${allianceCellHtml(r, r.id && both.has(r.id))}</td>
              <td class="wp-btl-num">${fmtNum(r.damage)}</td>
              <td class="wp-btl-num wp-btl-pct">${totDmg ? (r.damage / totDmg * 100).toFixed(1) : '0.0'}%</td>
              <td class="wp-btl-num wp-btl-bounty">${r.money ? fmtMoney(r.money) : '—'}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>${btlT('colTotalRow', { n: rows.length })}</td>
          <td class="wp-btl-num">${fmtNum(totDmg)}</td>
          <td class="wp-btl-num wp-btl-pct">100%</td>
          <td class="wp-btl-num wp-btl-bounty">${fmtMoney(totMoney)}</td>
        </tr></tfoot>
      </table>
    </div>`;
}

/** `sides`: le classifiche di un round (roundSides), o niente per la
 *  battaglia intera. */
function alliancesHtml(battle, sides = null) {
  // Finché il registro non ha risposto non si disegna niente: mostrare
  // prima l'appartenenza di oggi e poi spostare le righe sarebbe peggio.
  if (!_allyTried || !_detail) return '';
  const ts = _detail.startedAt || battle.endedAt || Date.now();
  const def = allianceRows('defender', ts, sides || _detail.sides);
  const atk = allianceRows('attacker', ts, sides || _detail.sides);
  if (!def.rows.length && !atk.rows.length) return '';
  // La stessa alleanza su tutti e due i lati: membri che si combattono,
  // ed è proprio la cosa che una tabella per alleanza deve far vedere.
  // Almeno l'1% del danno di OGNI lato: senza soglia il cartellino
  // finiva su quasi tutte le righe (sulla Francia–Italia del 13 ottobre
  // 12 alleanze su 12), perché basta un cittadino che colpisce dall'altra
  // parte per qualche migliaio di danno.
  const ids = (rows) => {
    const tot = rows.reduce((s, r) => s + r.damage, 0);
    return new Set(rows.filter(r => r.id && tot && r.damage / tot >= 0.01).map(r => r.id));
  };
  const atkIds = ids(atk.rows);
  const both = new Set([...ids(def.rows)].filter(id => atkIds.has(id)));
  return `
    <div class="wp-btl-sides">
      ${allianceTable(def.rows, 'defender', battle, { label: btlT('defender'), color: 'var(--wp-btl-def)',
        countryId: battle.defender.countryId, both })}
      ${allianceTable(atk.rows, 'attacker', battle, { label: btlT('attacker'), color: 'var(--wp-btl-atk)',
        countryId: battle.attacker.countryId, both })}
    </div>
    <p class="wp-btl-foot wp-btl-foot-tight">${def.today || atk.today ? btlT('allyNoteToday') : btlT('allyNoteThen')}</p>`;
}

/* ══ I FINANZIATORI ════════════════════════════════════════
   Due tabelle sopra la scomposizione per nazione, una per schieramento:
   chi ha versato soldi nel tesoro di quel belligerante MENTRE la
   battaglia era aperta. Sta in cima e non in fondo perché è la domanda
   che viene prima delle altre — chi ha pagato per far succedere questo
   — e le classifiche di danno si leggono diversamente sapendo che
   dietro a uno dei due c'erano altre sei nazioni.

   ⚠️ Una tabella vuota vuol dire due cose diverse: "nessuno ha
   finanziato" oppure "la nostra finestra non arriva così indietro".
   windowIsShort() distingue, e la nota lo dice: mai lasciare che il
   secondo caso si legga come il primo.
   ─────────────────────────────────────────────────────────── */
function fundersTable(rows, sideKey, opts) {
  const { label, color, countryId, short } = opts;
  const tot = rows.reduce((s, r) => s + r.money, 0);
  return `
    <div class="wp-btl-side-col wp-btl-side-${sideKey}">
      <div class="wp-btl-side-head" style="--side:${color}">
        ${countryId ? flagHtml(countryId) : ''}
        <span class="wp-btl-side-name">${escapeHtml(nationName(countryId) || '—')}</span>
        <span class="wp-btl-side-role">${label}</span>
      </div>
      ${rows.length ? `
      <table class="wp-btl-table wp-btl-side-table">
        <thead><tr>
          <th>${btlT('colFunder')}</th>
          <th>${btlT('colWhenSent')}</th>
          <th class="wp-btl-num">${btlT('colAmount')}</th>
        </tr></thead>
        <tbody>
          ${rows.map(r => `
            <tr>
              <td class="wp-btl-nation">${flagHtml(r.from)}${escapeHtml(nationName(r.from) || '—')}</td>
              <td class="wp-btl-when">${fmtDate(r.at)}</td>
              <td class="wp-btl-num wp-btl-bounty">${fmtMoney(r.money)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>${btlT('colTotalRow', { n: rows.length })}</td>
          <td></td>
          <td class="wp-btl-num wp-btl-bounty">${fmtMoney(tot)}</td>
        </tr></tfoot>
      </table>` : `<p class="wp-btl-foot wp-btl-foot-tight">${
        short ? btlT('fundersOutOfRange') : btlT('noFunders')}</p>`}
    </div>`;
}

function fundersHtml(battle) {
  const from = _detail?.startedAt;
  if (!from) return '';
  const to = _detail?.finishedAt || (battle.live ? Date.now() : battle.endedAt);

  // Ancora in volo, o proxy giu': in entrambi i casi non si disegna una
  // tabella vuota che sembrerebbe una risposta.
  if (!_money) {
    return `
      <h3 class="wp-btl-h3">${btlT('fundersLabel')}</h3>
      <p class="wp-btl-foot wp-btl-foot-tight">${btlT('fundersLoading')}</p>`;
  }

  const short = windowIsShort(_money, from);
  const def = transfersFor(_money, battle.defender.countryId, from, to);
  const atk = transfersFor(_money, battle.attacker.countryId, from, to);
  return `
    <h3 class="wp-btl-h3">${btlT('fundersLabel')}
      <span class="wp-btl-sub">${btlT('fundersSub')}</span></h3>
    <div class="wp-btl-sides">
      ${fundersTable(def, 'defender', { label: btlT('defender'), color: 'var(--wp-btl-def)',
        countryId: battle.defender.countryId, short })}
      ${fundersTable(atk, 'attacker', { label: btlT('attacker'), color: 'var(--wp-btl-atk)',
        countryId: battle.attacker.countryId, short })}
    </div>`;
}

/* ── Taglia, contratti e costo in testa alla scheda ──
   Dalla STESSA fonte del tooltip sulla mappa (fetchBattleSpending), che
   stima la taglia unità per unità: su una battaglia in corso l'archivio non
   ha ancora niente (la riga viva porta bounty/contracts null) e prima la
   testata mostrava 0,00. Finché quella risposta non arriva vale la riga
   dell'archivio, dove la taglia è già separata dai contratti (api.js). */
function headCost(battle) {
  if (_spend) {
    const b = [_spend.bounty.defender?.total, _spend.bounty.attacker?.total];
    const won = _spend.merc.won;
    return {
      bounty: b.every(x => x == null) ? null : (b[0] || 0) + (b[1] || 0),
      contracts: won.defender.total + won.attacker.total,
      count: won.defender.count + won.attacker.count,
    };
  }
  const known = battle.defender.bounty != null || battle.attacker.bounty != null;
  return {
    bounty: known ? (battle.defender.bounty ?? 0) + (battle.attacker.bounty ?? 0) : null,
    contracts: battle.contracts,
    count: battle.contractCount,
  };
}

/* ── Danno in testata ──
   Di una battaglia IN CORSO la riga dell'elenco viene da /battles, che il
   server rilegge ogni 3 minuti e il client tiene altri 4: la testata
   diceva 208,1M mentre le tabelle sotto, lette dal gioco un attimo prima,
   sommavano 208,8M (segnalato il 2026-10-15). Con le classifiche in mano
   la testata È la loro somma — stessa fonte, stesso istante. Non se sono
   troncate (oltre 100 nazioni per lato): lì la somma direbbe meno del
   vero, e si torna alla riga. Le battaglie finite non cambiano più, e
   la riga dell'archivio resta il dato. */
function headDamage(battle) {
  const side = (k) => _detail.sides[k].reduce((s, r) => s + r.damage, 0);
  if (battle.live && _detail && !_detail.truncated?.attacker && !_detail.truncated?.defender) {
    return side('defender') + side('attacker');
  }
  return (battle.defender.damages || 0) + (battle.attacker.damages || 0);
}

export function renderBattleDetail(battle) {
  const cost = headCost(battle);
  const head = `
    <button type="button" class="wp-btl-back" id="wp-btl-detail-back">← ${btlT('backToList')}</button>
    <h2 class="wp-btl-dtitle">
      ${flagHtml(battle.defender.countryId)}${escapeHtml(nationName(battle.defender.countryId) || '—')}
      <span class="wp-btl-vs">vs</span>
      ${flagHtml(battle.attacker.countryId)}${escapeHtml(nationName(battle.attacker.countryId) || '—')}
      <span class="wp-btl-type">${typeLabel(battle.type)}</span>
    </h2>
    <div class="wp-btl-cards">
      <div class="wp-btl-card"><span>${btlT('colRegion')}</span><strong class="wp-btl-card-sm">${escapeHtml(regionName(battle.regionId) || '—')}</strong></div>
      <div class="wp-btl-card"><span>${battle.live ? btlT('colWhenMixed') : btlT('colWhen')}</span><strong class="wp-btl-card-sm">${battle.live
        ? `<span class="wp-btl-livedot"></span>${btlT('liveNow')}`
        : fmtDate(battle.endedAt)}</strong>${battle.live && _detail && _detailAt
        ? `<em>${btlT('detailUpdated', { time: new Date(_detailAt).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}</em>`
        : ''}</div>
      <div class="wp-btl-card"><span>${btlT('colDamage')}</span><strong>${fmtNum(headDamage(battle))}</strong></div>
      <div class="wp-btl-card"><span>${btlT('colBounty')}</span><strong>${fmtMoney(cost.bounty)}</strong></div>
      <div class="wp-btl-card"><span>${btlT('colContracts')}</span><strong>${fmtMoney(cost.contracts)}</strong>
        <em>${btlT('contractsCount', { n: cost.count ?? 0 })}</em></div>
      <div class="wp-btl-card"><span>${btlT('colCost')}</span><strong>${fmtMoney(cost.bounty == null && cost.contracts == null ? null : (cost.bounty || 0) + (cost.contracts || 0))}</strong></div>
    </div>`;

  if (!_detail) {
    return `<div class="wp-btl-detail">${head}<div class="wp-btl-loading">${btlT('loading')}</div></div>`;
  }

  const nm = (id) => nationName(id);
  const wFrom = _detail?.startedAt;
  const wTo = _detail?.finishedAt || (battle.live ? Date.now() : battle.endedAt);
  const sentDef = sentTotals(battle.defender.countryId, wFrom, wTo);
  const sentAtk = sentTotals(battle.attacker.countryId, wFrom, wTo);
  const anySent = sentDef.size || sentAtk.size;
  const payDef = payPerK('defender');
  const payAtk = payPerK('attacker');
  const anyCtr = payDef.totContracts > 0 || payAtk.totContracts > 0;

  const timeline = timelineSectionHtml(_tl, { nationName: nm, flagHtml });
  // La scheda Andamento esiste solo se il server ha registrato la
  // battaglia: chi la teneva aperta e passa a una che non ce l'ha torna
  // alle nazioni invece di guardare una scheda vuota.
  if (_dtab === 'timeline' && !timeline) _dtab = 'nations';
  if (_dtab === 'bonus' && !battle.live) _dtab = 'nations';
  const nFunders = _money && wFrom
    ? transfersFor(_money, battle.defender.countryId, wFrom, wTo).length
      + transfersFor(_money, battle.attacker.countryId, wFrom, wTo).length
    : null;
  const tabs = [
    // Niente numero sulle nazioni: sommare i due lati conta due volte chi
    // ha combattuto da tutte e due le parti, e il numero vero è già in
    // fondo a ciascuna tabella.
    { id: 'nations', label: btlT('tabNations') },
    // I bonus dipendono da ordini e costruzioni ATTIVI: di una battaglia
    // finita non si sanno più, quindi la scheda c'è solo per quelle in corso.
    battle.live && { id: 'bonus', label: btlT('tabBonus') },
    { id: 'alliances', label: btlT('tabAlliances') },
    { id: 'mu', label: btlT('tabMu') },
    timeline && { id: 'timeline', label: btlT('tabTimeline') },
    { id: 'funders', label: btlT('tabFunders'), n: nFunders },
    { id: 'contracts', label: btlT('tabContracts'), n: _detail.contracts.length },
  ].filter(Boolean);

  // Le tre schede "chi ha fatto cosa" si possono guardare round per round
  // (roundBarHtml). Senza round scelto restano esattamente com'erano.
  const roundBar = ['nations', 'alliances', 'mu'].includes(_dtab) ? roundBarHtml(battle) : '';
  const rCountry = _round && (_dtab === 'nations' || _dtab === 'alliances') ? roundSides('country') : null;
  const rWait = (r) => (r === 'loading' ? `<div class="wp-btl-loading">${btlT('loading')}</div>`
    : r === 'error' ? `<p class="wp-btl-foot">${btlT('roundError')}</p>` : null);

  let body;
  if (rCountry && rWait(rCountry)) body = rWait(rCountry);
  else if (_dtab === 'alliances') body = alliancesHtml(battle, rCountry) || `<div class="wp-btl-loading">${btlT('loading')}</div>`;
  else if (_dtab === 'bonus') body = bonusHtml(battle);
  else if (_dtab === 'mu') body = _round ? (rWait(roundSides('mu')) || muRoundHtml(battle, roundSides('mu'))) : muSectionHtml(battle);
  else if (_dtab === 'timeline') body = timeline;
  else if (_dtab === 'funders') body = fundersHtml(battle);
  else if (_dtab === 'contracts') body = contractsHtml(_detail.contracts, _detail.contractsTruncated);
  // Un round: le stesse tabelle, senza le colonne che sono della battaglia
  // intera (contratti, versamenti dei finanziatori). Il prezzo per 1k resta:
  // incassato ÷ danno di quel round.
  else if (rCountry) body = `
      <p class="wp-btl-foot wp-btl-foot-tight">${btlT('earnedNote')}</p>
      <div class="wp-btl-sides">
        ${['defender', 'attacker'].map(k => sideTable(rCountry[k], k, battle, {
          label: btlT(k), color: `var(--wp-btl-${k === 'defender' ? 'def' : 'atk'})`, countryId: battle[k].countryId,
          expanded: _expanded[k], entityName: nm, entityFlag: flagHtml,
          pay: { byCountry: new Map(), totContracts: 0 },
          entityHeader: btlT('colNation'), truncated: rCountry.truncated?.[k] })).join('')}
      </div>
      <p class="wp-btl-foot wp-btl-foot-tight">${btlT('paidPerKNote')}</p>`;
  else body = `
      <p class="wp-btl-foot wp-btl-foot-tight">${btlT('earnedNote')}</p>
      <div class="wp-btl-sides">
        ${sideTable(_detail.sides.defender, 'defender', battle, {
          label: btlT('defender'), color: 'var(--wp-btl-def)', countryId: battle.defender.countryId,
          expanded: _expanded.defender, entityName: nm, entityFlag: flagHtml, sentBy: sentDef, pay: payDef,
          entityHeader: btlT('colNation'), truncated: _detail.truncated?.defender })}
        ${sideTable(_detail.sides.attacker, 'attacker', battle, {
          label: btlT('attacker'), color: 'var(--wp-btl-atk)', countryId: battle.attacker.countryId,
          expanded: _expanded.attacker, entityName: nm, entityFlag: flagHtml, sentBy: sentAtk, pay: payAtk,
          entityHeader: btlT('colNation'), truncated: _detail.truncated?.attacker })}
      </div>
      ${anySent ? `<p class="wp-btl-foot wp-btl-foot-tight">${btlT('sentNote')}</p>` : ''}
      <p class="wp-btl-foot wp-btl-foot-tight">${btlT('paidPerKNote')}${anyCtr ? ' ' + btlT('paidPerKCtrNote') : ''}${
        anyCtr && battle.live ? ' ' + btlT('paidPerKLiveNote') : ''}</p>`;

  return `
    <div class="wp-btl-detail">
      ${head}
      <nav class="wp-btl-dtabs" role="tablist">
        ${tabs.map(t => `
          <button type="button" role="tab" class="wp-btl-dtab${_dtab === t.id ? ' active' : ''}"
            aria-selected="${_dtab === t.id}" data-dtab="${t.id}">${t.label}${
            t.n != null ? `<span class="wp-btl-dtab-n">${t.n}</span>` : ''}</button>`).join('')}
      </nav>
      ${roundBar}
      ${body}
    </div>`;
}

/* ══ ROUND PER ROUND ═══════════════════════════════════════
   Richiesta dell'utente (2026-10-15): «oltre all'aggregato le tabelle
   divise per round, mettendo in evidenza il round in corso se la
   battaglia è attiva». Una fila di bottoni sopra Nazioni, Alleanze e
   Unità: "Tutta la battaglia" (le tabelle di sempre) e un bottone per
   round, col vincitore e i punti se è chiuso, il pallino rosso se è
   quello in corso. Le classifiche del round si scaricano alla prima
   apertura (getRoundRanking in api.js: quattro procedure in un batch);
   quelle dei round chiusi restano in memoria, quella del round in corso
   si rilegge a ogni giro di refreshBattleDetail come le altre.
   Con un round solo la fila non c'è: sarebbe la battaglia intera due volte.
   ─────────────────────────────────────────────────────────── */
let _round = null;          // id del round in vista, null = tutta la battaglia
const _rk = new Map();      // `${roundId}|${type}` -> 'loading' | 'error' | { data, live }

function roundSides(type) {
  const v = _rk.get(`${_round}|${type}`);
  if (!v) return 'loading';
  return typeof v === 'string' ? v : v.data;
}

function roundBarHtml(battle) {
  const rounds = _detail?.rounds || [];
  if (rounds.length < 2) return '';
  const chip = (id, inner, cls = '', title = '') => `
    <button type="button" class="wp-btl-rchip${_round === id ? ' active' : ''}${cls}" data-round="${id || ''}"
      ${title ? `title="${escapeHtml(title)}"` : ''}>${inner}</button>`;
  return `
    <div class="wp-btl-rounds" role="group" aria-label="${escapeHtml(btlT('roundsLabel'))}">
      ${chip(null, escapeHtml(btlT('roundAll')))}
      ${rounds.map(r => {
        const name = escapeHtml(btlT('roundN', { n: r.number }));
        if (r.live) {
          return chip(r.id, `<span class="wp-btl-livedot"></span>${name} <em>${escapeHtml(btlT('liveNow'))}</em>`, ' live');
        }
        const winner = r.wonBy ? battle[r.wonBy]?.countryId : null;
        const pts = r.points ? `${r.points.defender}–${r.points.attacker}` : '';
        const title = winner ? btlT('roundWonBy', { name: nationName(winner) || '—', pts }) : '';
        return chip(r.id, `${name}${winner ? ` ${flagHtml(winner)}` : ''}${pts ? ` <em>${pts}</em>` : ''}`, '', title);
      }).join('')}
    </div>
    ${(rounds.find(r => r.id === _round)?.live)
      ? `<p class="wp-btl-foot wp-btl-foot-tight">${btlT('roundLiveNote')}</p>` : ''}`;
}

/** Scarica le classifiche di un round (se non ci sono già) e ridisegna. */
async function loadRound(battle, roundId, type, repaint, { force = false } = {}) {
  const key = `${roundId}|${type}`;
  if (!force && _rk.has(key)) return;
  const live = !!_detail?.rounds?.find(r => r.id === roundId)?.live;
  if (!_rk.has(key)) _rk.set(key, 'loading');
  const data = await getRoundRanking(roundId, type, { live });
  if (_wired.battle?.id !== battle.id) return;
  // Un giro andato storto su dati che c'erano già: si tengono quelli.
  if (data) _rk.set(key, { data, live });
  else if (!force || typeof _rk.get(key) === 'string') _rk.set(key, 'error');
  if (data && type === 'mu') {
    await resolveMuBriefs([...data.defender, ...data.attacker].map(r => r.id));
    if (_wired.battle?.id !== battle.id) return;
  }
  repaint();
}

/** Unità militari di un round: stessa tabella della battaglia intera. */
function muRoundHtml(battle, r) {
  return `
    <div class="wp-btl-sides">
      ${['defender', 'attacker'].map(k => sideTable(r[k], k, battle, {
        label: btlT(k), color: `var(--wp-btl-${k === 'defender' ? 'def' : 'atk'})`, countryId: battle[k].countryId,
        expanded: _expanded[k], entityCell: muCellHtml,
        entityHeader: btlT('colUnit'), truncated: r.truncated?.[k] })).join('')}
    </div>`;
}

/** Carica il dettaglio e ridisegna. Separato dal render perché la vista
 *  si apre SUBITO col riepilogo (che ha già in mano dall'elenco) e si
 *  completa quando le classifiche atterrano: nessuna schermata vuota. */
export async function loadBattleDetail(battle, repaint) {
  _detail = null;
  _round = null;      // gli id dei round sono di quella battaglia
  _rk.clear();
  _mu = null;
  _money = null;
  _spend = null;
  _tl = null;
  _muState = 'closed';
  _expanded = { attacker: false, defender: false };
  _ctrAll = false;
  _bonus = null;
  repaint();
  // `live`: su una battaglia in corso le classifiche cambiano ad ogni tick,
  // quindi api.js non le memorizza — riaprirla ridà i numeri aggiornati.
  _detail = await getBattleDetail(battle.id, { live: Boolean(battle.live) });
  _detailAt = Date.now();
  repaint();
  // In parallelo: i nomi delle unita' dei contratti e la lista dei
  // finanziamenti. Sono indipendenti, e in serie l'utente aspetterebbe
  // la somma di due attese invece della piu' lunga delle due.
  await Promise.all([
    resolveMuBriefs((_detail?.contracts || []).map(c => c.mu)),
    fetchMoneyTransfers().then(d => { _money = d; }).catch(() => {}),
    import('../diplomacy/battleSpending.js').then(m => m.fetchBattleSpending(battle.id))
      .then(d => { _spend = d; }).catch(() => {}),
    fetchBattleTimeline(battle.id, { live: Boolean(battle.live) }).then(d => { _tl = d; }),
    loadAllianceRegistry(),
  ]);
  repaint();
}

/* ── Battaglia IN CORSO con la scheda aperta ──
   Segnalato dall'utente (2026-10-15, «questi dati non mi sembrano
   aggiornati»): il giro di aggiornamento in main.js si fermava appena si
   apriva una battaglia, quindi classifiche, taglia e contratti restavano
   quelli del clic per tutto il tempo in cui la scheda stava aperta — su
   una battaglia viva, ore. Questa rilegge tutto ciò che si muove senza
   azzerare niente: scheda, "mostra tutte" e unità aperte restano dove
   sono, e niente "Caricamento…" al posto delle tabelle.
   Le cache sotto (taglia e andamento) durano 60 s: chiamata ogni tick
   (2 minuti) rilegge davvero. */
let _detailAt = 0;   // quando sono arrivate le classifiche mostrate

export async function refreshBattleDetail(battle, repaint) {
  if (!battle?.live || !_detail) return;
  const id = battle.id;
  const [detail, spend, tl, mu] = await Promise.all([
    getBattleDetail(id, { live: true }),
    import('../diplomacy/battleSpending.js').then(m => m.fetchBattleSpending(id)).catch(() => null),
    fetchBattleTimeline(id, { live: true }),
    _muState === 'open' ? getBattleMuBreakdown(id, { live: true }) : Promise.resolve(null),
  ]);
  if (_wired.battle?.id !== id) return;   // nel frattempo si è passati a un'altra
  // Un giro andato storto non cancella quello che c'era: meglio i numeri
  // di due minuti fa che una tabella vuota.
  if (detail) { _detail = detail; _detailAt = Date.now(); }
  if (spend) _spend = spend;
  if (tl) _tl = tl;
  if (mu) _mu = mu;
  // Le classifiche di round scaricate quando il round era in corso: si
  // rileggono (se nel frattempo è finito, questa è l'ultima volta e poi
  // restano in memoria come le altre).
  await Promise.all([..._rk.entries()]
    .filter(([, v]) => v?.live)
    .map(([key]) => { const [roundId, type] = key.split('|'); return loadRound(battle, roundId, type, () => {}, { force: true }); }));
  // Contratti nuovi = unità nuove da battezzare (le altre sono già in _muInfo).
  await resolveMuBriefs((_detail?.contracts || []).map(c => c.mu));
  if (_wired.battle?.id !== id) return;
  repaint();
}

/** Il registro delle alleanze, una volta per sessione. Senza server la
 *  tabella per alleanza c'è lo stesso, con l'appartenenza di oggi. */
async function loadAllianceRegistry() {
  if (_allyTried) return;
  try {
    const m = await import('../app/timeMachineAlliances.js');
    if (await m.loadAllianceHistory()) _allyHist = m;
  } catch (_) { /* resta l'appartenenza di oggi */ }
  _allyTried = true;
}

/** Risolve nome e logo di POCHE unità (una richiesta sola, vedi
 *  fetchMuBriefs) e ridisegna. Volutamente dopo il primo repaint: la
 *  tabella deve comparire subito, i nomi ci si posano sopra un attimo
 *  dopo. Se fallisce non succede niente di brutto — restano le righe
 *  senza link, che è esattamente lo stato di prima. */
async function resolveMuBriefs(ids) {
  const wanted = [...new Set((ids || []).filter(Boolean))].filter(id => !_muInfo.has(id));
  if (!wanted.length) return;
  try {
    const { fetchMuBriefs } = await import('../mu/api.js');
    const got = await fetchMuBriefs(wanted);
    got.forEach((brief, id) => _muInfo.set(id, brief));
  } catch (_) {
    // silenzioso: i nomi sono un di più, la tabella resta leggibile
  }
}

export function wireBattleDetail(root, battle, { onBack, repaint }) {
  root.querySelector('#wp-btl-detail-back')?.addEventListener('click', onBack);
  wireTimeline(root);

  root.querySelectorAll('.wp-btl-side-more').forEach(btn => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.side;
      _expanded[side] = !_expanded[side];
      repaint();
    });
  });

  _wired = { battle, repaint };
  // Un solo listener delegato: le righe si ridisegnano ad ogni repaint,
  // e riagganciare un handler per bottone ad ogni giro è il modo classico
  // di ritrovarsi con listener duplicati. ⚠️ `root` è il corpo della
  // sezione e SOPRAVVIVE ai repaint (cambia solo l'innerHTML): prima il
  // listener si riagganciava a ogni giro, e un clic su un'unità apriva la
  // sua scheda tante volte quanti repaint c'erano stati. Da qui il flag.
  if (!root.dataset.btlDetailWired) {
    root.dataset.btlDetailWired = '1';
    root.addEventListener('click', (e) => {
      const tab = e.target.closest?.('.wp-btl-dtab');
      if (tab) {
        _dtab = tab.dataset.dtab;
        _wired.repaint?.();
        return;
      }
      if (e.target.closest?.('[data-btl-players]')) {
        import('../app/playersOverlay.js').then(m => m.openPlayersView()).catch(() => {});
        return;
      }
      const rb = e.target.closest?.('[data-round]');
      if (rb) {
        _round = rb.dataset.round || null;
        _expanded = { attacker: false, defender: false };
        _wired.repaint?.();
        return;
      }
      if (bmanClick(e.target)) {
        _wired.repaint?.();
        return;
      }
      if (e.target.closest?.('#wp-btl-ctr-more')) {
        _ctrAll = !_ctrAll;
        _wired.repaint?.();
        return;
      }
      const link = e.target.closest?.('.wp-btl-mu-link');
      if (!link) return;
      const muId = link.dataset.muId;
      if (!muId) return;
      import('../app/muOverlay.js')
        .then(m => m.openMuView(muId))
        .catch(() => {});
    });
  }

  // Scheda Unità militari: la si carica quando la si apre (2 chiamate in
  // più + la directory), non prima — è la scheda che si guarda di meno.
  if (_dtab === 'mu' && _muState === 'closed' && !_round) loadMuSection(battle, repaint);
  if (_round && ['nations', 'alliances', 'mu'].includes(_dtab)) {
    loadRound(battle, _round, _dtab === 'mu' ? 'mu' : 'country', repaint);
  }
  if (_dtab === 'bonus' && _bonus == null) loadBonus(battle, repaint);
  root.querySelector('#wp-btl-mu-open')?.addEventListener('click', () => loadMuSection(battle, repaint));
}

async function loadMuSection(battle, repaint) {
  _muState = 'loading';
  repaint();
  // La directory MU (~550 KB) si scarica SOLO qui, e una volta per
  // sessione: è condivisa con la vista Unità Militari, quindi spesso è
  // già calda. Se non arriva, le classifiche si mostrano comunque, con
  // gli identificativi al posto dei nomi.
  const [mu, dir] = await Promise.all([
    getBattleMuBreakdown(battle.id, { live: Boolean(battle.live) }),
    import('../mu/api.js').then(m => m.fetchMuDirectory()).catch(() => null),
  ]);
  if (dir) _dir = dir;
  // Nel frattempo si è passati a un'altra battaglia: queste classifiche
  // non sono le sue.
  if (_wired.battle?.id !== battle.id) return;
  _mu = mu;
  _muState = mu ? 'open' : 'error';
  repaint();
  // La directory copre già quasi tutto; questo raccoglie le briciole
  // (unità nate dopo l'ultimo giro del server, o directory non arrivata).
  if (mu) {
    await resolveMuBriefs([...(mu.defender || []), ...(mu.attacker || [])].map(r => r.id));
    repaint();
  }
}

/* ── Scheda Bonus ─────────────────────────────────────────────────
   Si calcola all'apertura della scheda: la battaglia grezza (quella dei
   marcatori della mappa, già in cache: serve la regione d'attacco e il
   tipo), gli ordini (due chiamate pubbliche, cache 60 s) e, se c'è "Sono
   io", il tuo profilo. */
async function loadBonus(battle, repaint) {
  _bonus = 'loading';
  repaint();
  let out = 'error';
  try {
    const [rules, raw, me] = await Promise.all([
      loadBonusRules(),
      fetchActiveBattles(),
      myPlayerId() ? loadMe() : Promise.resolve(null),
    ]);
    const b = (Array.isArray(raw) ? raw : []).find(x => x?._id === battle.id);
    if (b) {
      const orders = (await fetchBattleOrders([b._id])).get(b._id) ?? null;
      const ctxs = {
        defender: sideContext(b, 'defender', rules, orders),
        attacker: sideContext(b, 'attacker', rules, orders),
      };
      out = {
        ctxs,
        rows: { defender: sideNationRows(ctxs.defender), attacker: sideNationRows(ctxs.attacker) },
        mine: me ? personalBonus(b, rules, orders, me) : null,
        hasMe: !!myPlayerId(),
        ordersKnown: !!orders,
      };
    }
  } catch (err) {
    console.warn('WarEra+ battaglie: bonus non calcolati', err);
  }
  if (_wired.battle?.id !== battle.id) return; // passati a un'altra battaglia
  _bonus = out;
  repaint();
}

const fmtPct = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

function bonusChips(parts, side) {
  const KEYS = { home: 'partHome', enemy: 'partEnemy', pact: 'partPact', ally: 'partAlly', order: 'partOrder',
    muOrder: 'partMuOrder', muHq: 'partMuHq', revolt: 'partRevolt', malus: 'partMalus' };
  const out = [];
  for (const [k, v] of Object.entries(parts)) {
    if (!v || Array.isArray(v)) continue;
    const label = k === 'building' ? btlT(side === 'defender' ? 'partBunker' : 'partBase') : btlT(KEYS[k]);
    const neg = v < 0;
    const ord = (k === 'order' || k === 'muOrder') ? (v >= 15 ? ' o-high' : v >= 10 ? ' o-medium' : ' o-low') : '';
    out.push(`<span class="wp-btl-bchip${neg ? ' neg' : ord}">${escapeHtml(label)} ${neg ? '' : '+'}${fmtPct(v)}%</span>`);
  }
  return out.join('');
}

/* ── Bonus dell'unità, a mano ──
   Richiesta dell'utente (2026-10-15): «aggiungi nella sezione bonus un
   toggle per aggiungere manualmente il bonus MU e il QG MU». Le righe per
   nazione contano solo le voci della NAZIONE (vedi NATION_KEYS in
   battleBonus.js): ordine e QG dell'unità dipendono dal giocatore. Chi
   vuole sapere "io, con la mia unità, dove rendo di più" — senza aver
   impostato "Sono io", o per un'unità che non è la sua — li accende qui:
   si sommano a ogni riga e a "Qualunque altra nazione", con lo stesso
   valore su tutti e due i lati (sono dell'unità, non del lato).
   Percentuali dalle regole del gioco (orderPct, rules.hq), non scritte qui.
   Preferenza del singolo browser: localStorage, e se non c'è si parte
   spenti. "Il tuo bonus" resta com'è: usa già ordine e QG VERI della tua
   unità, e sommarci questi li conterebbe due volte. */
const BMAN_KEY = 'we_btl_bonus_manual';
let _bman = (() => {
  const def = { order: false, priority: 'medium', hq: false, level: 1 };
  try { return { ...def, ...JSON.parse(localStorage.getItem(BMAN_KEY) || '{}') }; } catch { return def; }
})();
function saveBman() {
  try { localStorage.setItem(BMAN_KEY, JSON.stringify(_bman)); } catch { /* storage negato */ }
}

/** Le voci accese, nella forma delle parti di battleBonus ({ muOrder, muHq }). */
function bmanParts(rules) {
  const out = {};
  if (_bman.order) out.muOrder = orderPct(rules.muOrder, _bman.priority);
  const lv = Math.min(_bman.level, rules.hq.length - 1);
  if (_bman.hq && lv > 0) out.muHq = rules.hq[lv] || 0;
  return out;
}

function bmanHtml(rules) {
  const sw = (key, label) => `
    <button type="button" class="wp-btl-bman-sw" role="switch" aria-checked="${_bman[key]}" data-bman="${key}">
      <i></i>${escapeHtml(label)}
    </button>`;
  const seg = (key, opts) => `
    <div class="wp-btl-bman-seg${_bman[key === 'priority' ? 'order' : 'hq'] ? '' : ' off'}" role="group">
      ${opts.map(([v, label, cls]) => `<button type="button" class="${cls || ''}${String(_bman[key]) === String(v) ? ' active' : ''}"
        data-bman-${key}="${v}">${escapeHtml(label)}</button>`).join('')}
    </div>`;
  const prLabel = { high: 'prHigh', medium: 'prMedium', low: 'prLow' };
  const levels = rules.hq.map((p, lv) => lv).filter(lv => lv > 0);
  return `
    <div class="wp-btl-bman">
      <div class="wp-btl-bonus-title">${escapeHtml(btlT('bmanTitle'))}</div>
      <div class="wp-btl-bman-rows">
        <div class="wp-btl-bman-row">${sw('order', btlT('partMuOrder'))}
          ${seg('priority', PRIORITIES.map(pr => [pr, `${btlT(prLabel[pr])} +${orderPct(rules.muOrder, pr)}%`, `o-${pr}`]))}</div>
        <div class="wp-btl-bman-row">${sw('hq', btlT('partMuHq'))}
          ${seg('level', levels.map(lv => [lv, `${btlT('lvN', { n: lv })} +${fmtPct(rules.hq[lv])}%`]))}</div>
      </div>
      <p class="wp-btl-foot wp-btl-foot-tight">${escapeHtml(btlT('bmanNote'))}</p>
    </div>`;
}

/** Clic dentro il riquadro: true se l'ha gestito lui. */
function bmanClick(target) {
  const sw = target.closest?.('[data-bman]');
  const pr = target.closest?.('[data-bman-priority]');
  const lv = target.closest?.('[data-bman-level]');
  if (sw) _bman[sw.dataset.bman] = !_bman[sw.dataset.bman];
  // Scegliere un livello accende anche l'interruttore: è quello che si vuole.
  else if (pr) { _bman.priority = pr.dataset.bmanPriority; _bman.order = true; }
  else if (lv) { _bman.level = Number(lv.dataset.bmanLevel); _bman.hq = true; }
  else return false;
  saveBman();
  return true;
}

function bonusHtml(battle) {
  if (_bonus == null || _bonus === 'loading') return `<div class="wp-btl-loading">${btlT('loading')}</div>`;
  if (_bonus === 'error') return `<div class="wp-btl-notice warn">${btlT('bonusError')}</div>`;
  const b = _bonus;
  const signed = (v) => `≈${v > 0 ? '+' : ''}${fmtPct(v)}%`;
  const rules = b.ctxs.defender.rules;
  const extra = bmanParts(rules);
  const extraTot = Object.values(extra).reduce((s, v) => s + v, 0);

  let you = '';
  if (b.mine) {
    const cell = (side) => `
      <div class="wp-btl-bonus-cell${b.mine.best === side ? ' best' : ''}">
        <span class="wp-btl-bonus-lab">${side === 'defender' ? '🛡️ ' + btlT('colDefending') : '⚔️ ' + btlT('colAttacking')}</span>
        <strong>${signed(b.mine[side].total)}</strong>
        <div class="wp-btl-bchips">${bonusChips(b.mine[side].parts, side)}</div>
      </div>`;
    you = `<div class="wp-btl-bonus-you"><div class="wp-btl-bonus-title">★ ${escapeHtml(bvT('you'))}</div>
      <div class="wp-btl-bonus-cells">${cell('defender')}${cell('attacker')}</div></div>`;
  } else if (!b.hasMe) {
    you = `<div class="wp-btl-notice">${escapeHtml(bvT('setMe'))}
      <button type="button" class="wp-btl-chip" data-btl-players>${escapeHtml(bvT('openPlayers'))}</button></div>`;
  }

  const col = (side) => {
    const ctx = b.ctxs[side];
    const facts = [];
    if (side === 'defender') {
      facts.push(ctx.building ? bvT('bunker', { n: ctx.buildingLevel, p: ctx.building }) : bvT('bunkerOff'));
      if (ctx.notLinked) facts.push(bvT('notLinked', { p: ctx.notLinked }));
    } else {
      facts.push(!ctx.buildingKnown ? bvT('baseUnknown') : ctx.building ? bvT('base', { n: ctx.buildingLevel, p: ctx.building }) : bvT('baseOff'));
      if (ctx.revoltBar) facts.push(bvT('revolt', { p: fmtPct(Math.round(ctx.revoltBar * 1000) / 10) }));
    }
    // Le voci dell'unità accese a mano si sommano a ogni riga, e chi non ha
    // niente di suo prende comunque quelle: la riga "qualunque altra".
    const rows = b.rows[side].map(r => ({ ...r, v: r.v + extraTot, parts: { ...r.parts, ...extra } }));
    if (extraTot) rows.push({ id: null, v: extraTot, parts: extra });
    const max = Math.max(1, rows[0]?.v || 1);
    const list = rows.length ? rows.map(r => `
      <div class="wp-btl-brow${r.id ? '' : ' wp-btl-brow-others'}">
        <div class="wp-btl-brow-top">
          ${r.id ? flagHtml(r.id) : '<span class="wp-btl-flag"></span>'}<span class="wp-btl-brow-name">${
            escapeHtml(r.id ? nationName(r.id) || '—' : btlT('bonusOthers'))}</span>
          <strong>${signed(r.v)}</strong>
        </div>
        <div class="wp-btl-brow-bar"><i style="width:${Math.max(3, Math.round(r.v / max * 100))}%"></i></div>
        <div class="wp-btl-bchips">${bonusChips(r.parts, side)}</div>
      </div>`).join('') : `<div class="wp-btl-empty">${btlT('bonusNone')}</div>`;
    return `<section class="wp-btl-bcol wp-btl-bcol-${side}">
      <h3 class="wp-btl-bcol-h">${flagHtml(ctx.countryId)}${escapeHtml(btlT(side))} · ${escapeHtml(nationName(ctx.countryId) || '—')}</h3>
      <p class="wp-btl-foot wp-btl-foot-tight">${facts.map(escapeHtml).join(' · ')}</p>
      ${list}
    </section>`;
  };

  return `
    <p class="wp-btl-foot wp-btl-foot-tight">${btlT('bonusIntro')}</p>
    ${b.ordersKnown ? '' : `<div class="wp-btl-notice warn">${escapeHtml(bvT('ordersUnknown'))}</div>`}
    ${you}
    ${bmanHtml(rules)}
    <div class="wp-btl-bonus-sides">${col('defender')}${col('attacker')}</div>
    <p class="wp-btl-foot">${escapeHtml(bvT('note'))}</p>`;
}

/** Azzera lo stato quando si esce dal dettaglio, così riaprendo un'altra
 *  battaglia non si eredita la sezione MU aperta di quella precedente. */
export function resetBattleDetail() {
  _detail = null;
  _mu = null;
  _money = null;
  _tl = null;
  resetTimeline();
  _bonus = null;
  _muState = 'closed';
  _expanded = { attacker: false, defender: false };
  // _dir NON si azzera: è la cache dei nomi, buona per tutta la sessione.
}
