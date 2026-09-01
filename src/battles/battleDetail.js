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
  const m = _dir?.find(x => x._id === id);
  return m?.name || null;
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
  const { label, color, countryId, expanded, entityName, entityFlag, truncated, entityHeader } = opts;
  const totDmg = rows.reduce((s, r) => s + r.damage, 0);
  const totMoney = rows.reduce((s, r) => s + r.money, 0);
  const shown = expanded ? rows : rows.slice(0, TOP);

  return `
    <div class="wp-btl-side-col wp-btl-side-${sideKey}">
      <div class="wp-btl-side-head" style="--side:${color}">
        ${countryId ? flagHtml(countryId) : ''}
        <span class="wp-btl-side-name">${escapeHtml(nationName(countryId) || typeLabel(battle.type))}</span>
        <span class="wp-btl-side-role">${label}</span>
        ${battle.wonBy === sideKey ? `<span class="wp-btl-winner">🏆</span>` : ''}
      </div>
      <table class="wp-btl-table wp-btl-side-table">
        <thead><tr>
          <th>${entityHeader}</th>
          <th class="wp-btl-num">${btlT('colDamage')}</th>
          <th class="wp-btl-num">%</th>
          <th class="wp-btl-num" title="${btlT('earnedHint')}">${btlT('colEarned')}</th>
        </tr></thead>
        <tbody>
          ${shown.map(r => `
            <tr>
              <td class="wp-btl-nation">${entityFlag(r.id)}${escapeHtml(entityName(r.id) || '—')}</td>
              <td class="wp-btl-num">${fmtNum(r.damage)}</td>
              <td class="wp-btl-num wp-btl-pct">${totDmg ? (r.damage / totDmg * 100).toFixed(1) : '0.0'}%</td>
              <td class="wp-btl-num wp-btl-bounty">${r.money ? fmtMoney(r.money) : '—'}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td>${btlT('colTotalRow', { n: rows.length })}</td>
          <td class="wp-btl-num">${fmtNum(totDmg)}</td>
          <td class="wp-btl-num">100%</td>
          <td class="wp-btl-num wp-btl-bounty">${fmtMoney(totMoney)}</td>
        </tr></tfoot>
      </table>
      ${truncated ? `<p class="wp-btl-foot wp-btl-foot-tight wp-btl-side-note">${btlT('rankTruncated')}</p>` : ''}
      ${rows.length > TOP
        ? `<button type="button" class="wp-btl-more wp-btl-side-more" data-side="${sideKey}">${
            expanded ? btlT('showTop', { n: TOP }) : btlT('showAll', { n: rows.length })}</button>`
        : ''}
    </div>`;
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
              <td>${escapeHtml(muName(c.mu) || btlT('unknownMu'))}</td>
              <td class="wp-btl-num">${fmtNum(c.minDamage)}</td>
              <td class="wp-btl-num">${c.perK ? c.perK.toFixed(3) : '—'}</td>
              <td class="wp-btl-num wp-btl-contracts">${fmtMoney(c.payout)}</td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>
    ${truncated ? `<p class="wp-btl-foot">⚠️ ${btlT('contractsTruncated')}</p>` : ''}`;
}

function muSectionHtml(battle) {
  if (_muState === 'closed') {
    return `<button type="button" class="wp-btl-more" id="wp-btl-mu-open">${btlT('showMus')}</button>`;
  }
  if (_muState === 'loading') return `<div class="wp-btl-loading">${btlT('loadingCost')}</div>`;
  if (_muState === 'error' || !_mu) return `<p class="wp-btl-foot">${btlT('costUnavailable')}</p>`;

  const nm = (id) => muName(id) || btlT('unknownMu');
  const noFlag = () => '';
  return `
    <div class="wp-btl-sides">
      ${sideTable(_mu.defender, 'defender', battle, {
        label: btlT('defender'), color: 'var(--wp-btl-def)', countryId: battle.defender.countryId,
        expanded: _expanded.defender, entityName: nm, entityFlag: noFlag,
        entityHeader: btlT('colUnit'), truncated: _mu.truncated?.defender })}
      ${sideTable(_mu.attacker, 'attacker', battle, {
        label: btlT('attacker'), color: 'var(--wp-btl-atk)', countryId: battle.attacker.countryId,
        expanded: _expanded.attacker, entityName: nm, entityFlag: noFlag,
        entityHeader: btlT('colUnit'), truncated: _mu.truncated?.attacker })}
    </div>
    ${!_dir ? `<p class="wp-btl-foot">${btlT('muNamesMissing')}</p>` : ''}`;
}

export function renderBattleDetail(battle) {
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
      <div class="wp-btl-card"><span>${btlT('colBounty')}</span><strong>${fmtMoney((battle.defender.bounty ?? 0) + (battle.attacker.bounty ?? 0))}</strong></div>
      <div class="wp-btl-card"><span>${btlT('colContracts')}</span><strong>${fmtMoney(battle.contracts ?? 0)}</strong>
        <em>${btlT('contractsCount', { n: battle.contractCount ?? 0 })}</em></div>
      <div class="wp-btl-card"><span>${btlT('colCost')}</span><strong>${fmtMoney((battle.defender.bounty ?? 0) + (battle.attacker.bounty ?? 0) + (battle.contracts ?? 0))}</strong></div>
    </div>`;

  if (!_detail) {
    return `<div class="wp-btl-detail">${head}<div class="wp-btl-loading">${btlT('loading')}</div></div>`;
  }

  const nm = (id) => nationName(id);
  return `
    <div class="wp-btl-detail">
      ${head}
      <h3 class="wp-btl-h3">${btlT('byNation')}</h3>
      <p class="wp-btl-foot wp-btl-foot-tight">${btlT('earnedNote')}</p>
      <div class="wp-btl-sides">
        ${sideTable(_detail.sides.defender, 'defender', battle, {
          label: btlT('defender'), color: 'var(--wp-btl-def)', countryId: battle.defender.countryId,
          expanded: _expanded.defender, entityName: nm, entityFlag: flagHtml,
          entityHeader: btlT('colNation'), truncated: _detail.truncated?.defender })}
        ${sideTable(_detail.sides.attacker, 'attacker', battle, {
          label: btlT('attacker'), color: 'var(--wp-btl-atk)', countryId: battle.attacker.countryId,
          expanded: _expanded.attacker, entityName: nm, entityFlag: flagHtml,
          entityHeader: btlT('colNation'), truncated: _detail.truncated?.attacker })}
      </div>

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
  _muState = 'closed';
  _expanded = { attacker: false, defender: false };
  repaint();
  // `live`: su una battaglia in corso le classifiche cambiano ad ogni tick,
  // quindi api.js non le memorizza — riaprirla ridà i numeri aggiornati.
  _detail = await getBattleDetail(battle.id, { live: Boolean(battle.live) });
  repaint();
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
  });
}

/** Azzera lo stato quando si esce dal dettaglio, così riaprendo un'altra
 *  battaglia non si eredita la sezione MU aperta di quella precedente. */
export function resetBattleDetail() {
  _detail = null;
  _mu = null;
  _muState = 'closed';
  _expanded = { attacker: false, defender: false };
  // _dir NON si azzera: è la cache dei nomi, buona per tutta la sessione.
}
