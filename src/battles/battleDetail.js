/* ══════════════════════════════════════════════════════════════
   WarEra+ — Dettaglio di una battaglia
   ------------------------------------------------------------------
   Si apre cliccando una riga dell'archivio. Risponde alla domanda che
   l'elenco non può rispondere: dietro a "57M di danno e 4.019 di costo",
   CHI c'era e chi ha preso cosa.

   Quattro blocchi:
   1. riepilogo (regione, esito, danno, costo);
   2. NAZIONI per schieramento — danno, quota del lato, taglia incassata;
   3. unità militari, stesse colonne, a richiesta (2 chiamate in più);
   4. contratti mercenari: chi paga, quale unità, quanto.

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
import { getBattleDetail, getBattleMuBreakdown } from './api.js';
import { fetchMoneyTransfers, transfersFor, windowIsShort } from './moneyTransfers.js';

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
      <div class="wp-btl-side-head" style="--side:${color}">
        ${countryId ? flagHtml(countryId) : ''}
        <span class="wp-btl-side-name">${escapeHtml(nationName(countryId) || typeLabel(battle.type))}</span>
        <span class="wp-btl-side-role">${label}</span>
        ${battle.wonBy === sideKey ? `<span class="wp-btl-winner">🏆</span>` : ''}
      </div>
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

function contractsHtml(contracts, truncated) {
  if (!contracts.length) return `<p class="wp-btl-foot">${btlT('noContracts')}</p>`;
  const total = contracts.reduce((s, c) => s + c.payout, 0);
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
          ${contracts.map(c => `
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
        : fmtDate(battle.endedAt)}</strong></div>
      <div class="wp-btl-card"><span>${btlT('colDamage')}</span><strong>${fmtNum((battle.defender.damages || 0) + (battle.attacker.damages || 0))}</strong></div>
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
  return `
    <div class="wp-btl-detail">
      ${head}
      ${fundersHtml(battle)}

      <h3 class="wp-btl-h3">${btlT('byNation')}</h3>
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
        anyCtr && battle.live ? ' ' + btlT('paidPerKLiveNote') : ''}</p>

      <h3 class="wp-btl-h3">${btlT('byMu')}</h3>
      ${muSectionHtml(battle)}

      ${contractsHtml(_detail.contracts, _detail.contractsTruncated)}
    </div>`;
}

/** Carica il dettaglio e ridisegna. Separato dal render perché la vista
 *  si apre SUBITO col riepilogo (che ha già in mano dall'elenco) e si
 *  completa quando le classifiche atterrano: nessuna schermata vuota. */
export async function loadBattleDetail(battle, repaint) {
  _detail = null;
  _mu = null;
  _money = null;
  _spend = null;
  _muState = 'closed';
  _expanded = { attacker: false, defender: false };
  repaint();
  // `live`: su una battaglia in corso le classifiche cambiano ad ogni tick,
  // quindi api.js non le memorizza — riaprirla ridà i numeri aggiornati.
  _detail = await getBattleDetail(battle.id, { live: Boolean(battle.live) });
  repaint();
  // In parallelo: i nomi delle unita' dei contratti e la lista dei
  // finanziamenti. Sono indipendenti, e in serie l'utente aspetterebbe
  // la somma di due attese invece della piu' lunga delle due.
  await Promise.all([
    resolveMuBriefs((_detail?.contracts || []).map(c => c.mu)),
    fetchMoneyTransfers().then(d => { _money = d; }).catch(() => {}),
    import('../diplomacy/battleSpending.js').then(m => m.fetchBattleSpending(battle.id))
      .then(d => { _spend = d; }).catch(() => {}),
  ]);
  repaint();
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

  root.querySelectorAll('.wp-btl-side-more').forEach(btn => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.side;
      _expanded[side] = !_expanded[side];
      repaint();
    });
  });

  // Un solo listener delegato: le righe si ridisegnano ad ogni repaint,
  // e riagganciare un handler per bottone ad ogni giro è il modo classico
  // di ritrovarsi con listener duplicati.
  root.addEventListener('click', (e) => {
    const link = e.target.closest?.('.wp-btl-mu-link');
    if (!link) return;
    const muId = link.dataset.muId;
    if (!muId) return;
    import('../app/muOverlay.js')
      .then(m => m.openMuView(muId))
      .catch(() => {});
  });

  root.querySelector('#wp-btl-mu-open')?.addEventListener('click', async () => {
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
    _mu = mu;
    if (dir) _dir = dir;
    _muState = mu ? 'open' : 'error';
    repaint();
    // La directory copre già quasi tutto; questo raccoglie le briciole
    // (unità nate dopo l'ultimo giro del server, o directory non arrivata).
    if (mu) {
      await resolveMuBriefs([...(mu.defender || []), ...(mu.attacker || [])].map(r => r.id));
      repaint();
    }
  });
}

/** Azzera lo stato quando si esce dal dettaglio, così riaprendo un'altra
 *  battaglia non si eredita la sezione MU aperta di quella precedente. */
export function resetBattleDetail() {
  _detail = null;
  _mu = null;
  _money = null;
  _muState = 'closed';
  _expanded = { attacker: false, defender: false };
  // _dir NON si azzera: è la cache dei nomi, buona per tutta la sessione.
}
