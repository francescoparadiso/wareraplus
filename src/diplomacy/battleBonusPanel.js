/* ══════════════════════════════════════════════════════════════
   WarEra+ — Sezione "Damage bonuses" della scheda battaglia
   ------------------------------------------------------------------
   Il disegno dei bonus calcolati in src/shared/battleBonus.js, dentro
   il tooltip della battaglia sulla mappa (battleMarkers.js lo carica
   alla prima apertura della sezione, come "Battle spending"):

     · in cima il bonus di CHI GUARDA, se in Giocatori ha detto "Sono
       io": quanto farebbe difendendo e attaccando, col lato migliore
       acceso;
     · poi, per ogni lato, chi prende quanto: i cittadini, le nazioni con
       un ordine o col nemico giurato dall'altra parte, i gruppi
       (alleanza, patto) e tutti gli altri;
     · infine i tre bottoni della mappa: colorarla per danno (la heatmap
       di sempre) o per il bonus che ogni nazione avrebbe in difesa o in
       attacco (battleHeatmap.js: setBattleBonusMap).

   Testi in inglese come il resto del tooltip battaglia.
   ══════════════════════════════════════════════════════════════ */

import { state } from './state.js';
import { escapeHtml } from './utils.js';
import {
  loadBonusRules, fetchBattleOrders, loadMe, myPlayerId,
  sideContext, sideRows, bonusByCountry, personalBonus,
} from '../shared/battleBonus.js';

const FLAG = (code) => (code ? `https://media.warera.io/images/flags/${String(code).toLowerCase()}.svg?v=16` : '');

const PART_LABELS = {
  home: 'Home', enemy: 'Sworn enemy', pact: 'Pact', ally: 'Alliance', order: 'Order',
  muOrder: 'MU order', muHq: 'MU HQ', building: null, revolt: 'Revolt', malus: 'Not linked',
};

let _stylesDone = false;
function injectStyles() {
  if (_stylesDone) return;
  _stylesDone = true;
  const s = document.createElement('style');
  s.textContent = `
    .bfm-bonus-panel { display: none; margin-top: 6px; padding-top: 6px; }
    #battle-tooltip.bfm-bonus-open .bfm-bonus-panel { display: block; }
    .bfm-bn-me { border-radius: 8px; padding: 7px 9px; margin-bottom: 8px; background: rgba(88,166,255,.08); border: 1px solid rgba(88,166,255,.28); }
    .bfm-bn-me-head { font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: .4px; opacity: .85; margin-bottom: 5px; }
    .bfm-bn-me-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
    .bfm-bn-me-side { border-radius: 6px; padding: 5px 7px; border: 1px solid rgba(128,128,128,.25); }
    .bfm-bn-me-side.best { border-color: #3fb950; box-shadow: 0 0 0 1px rgba(63,185,80,.35) inset; }
    .bfm-bn-me-side .lab { font-size: 9.5px; opacity: .8; }
    .bfm-bn-me-side .tot { font-size: 17px; font-weight: 800; font-variant-numeric: tabular-nums; }
    .bfm-bn-hint { font-size: 10px; opacity: .8; line-height: 1.4; margin-bottom: 8px; }
    .bfm-bn-hint button { font: inherit; font-size: 10px; margin-left: 4px; cursor: pointer; border-radius: 5px; padding: 1px 7px; background: transparent; color: inherit; border: 1px solid rgba(128,128,128,.4); }
    .bfm-bn-side { margin-top: 8px; }
    .bfm-bn-side-head { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 10px; margin-bottom: 4px; }
    .bfm-bn-side-head .who { font-weight: 700; text-transform: uppercase; letter-spacing: .4px; font-size: 9.5px; }
    .bfm-bn-side-head .who.def { color: var(--bfm-c-def-ink, #8fc3e8); }
    .bfm-bn-side-head .who.atk { color: var(--bfm-c-atk-ink, #ef9269); }
    .bfm-bn-side-head .fact { opacity: .85; }
    .bfm-bn-side-head .warn { color: #f0883e; font-weight: 600; }
    .bfm-bn-list { max-height: 210px; overflow-y: auto; scrollbar-width: thin; scrollbar-color: var(--bfm-sb-thumb, rgba(139,148,158,.45)) transparent; }
    .bfm-bn-row { padding: 4px 0; border-top: 1px solid rgba(128,128,128,.14); }
    .bfm-bn-row-top { display: flex; align-items: center; gap: 6px; font-size: 10.5px; }
    .bfm-bn-row-top img { height: 10px; border-radius: 1px; flex-shrink: 0; }
    .bfm-bn-row-top .nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
    .bfm-bn-row-top .tot { font-weight: 800; font-variant-numeric: tabular-nums; }
    .bfm-bn-chips { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 3px; }
    .bfm-bn-chip { font-size: 9px; border-radius: 4px; padding: 0 5px; line-height: 15px; background: rgba(128,128,128,.14); white-space: nowrap; }
    .bfm-bn-chip.neg { background: rgba(248,81,73,.16); color: #f85149; }
    .bfm-bn-chip.o-high { background: rgba(248,81,73,.18); }
    .bfm-bn-chip.o-medium { background: rgba(227,179,65,.2); }
    .bfm-bn-chip.o-low { background: rgba(63,185,80,.18); }
    .bfm-bn-map { display: flex; flex-wrap: wrap; align-items: center; gap: 4px; margin-top: 10px; font-size: 10px; }
    .bfm-bn-map button { font: inherit; font-size: 10px; cursor: pointer; border-radius: 5px; padding: 2px 8px; background: transparent; color: inherit; border: 1px solid rgba(128,128,128,.35); }
    .bfm-bn-map button.on { border-color: #58a6ff; background: rgba(88,166,255,.15); }
    .bfm-bn-note { font-size: 9.5px; opacity: .7; margin-top: 8px; line-height: 1.4; }
  `;
  document.head.appendChild(s);
}

const fmtNum = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
function fmtPart(v) {
  if (Array.isArray(v)) return v[0] === v[1] ? fmtNum(v[1]) : (v[0] === 0 ? `≤${fmtNum(v[1])}` : `${fmtNum(v[0])}–${fmtNum(v[1])}`);
  return fmtNum(v);
}
const isZero = (v) => (Array.isArray(v) ? v[1] === 0 : !v);
const sign = (t) => (t > 0 ? '+' : '') + fmtNum(t);

function orderClass(v) {
  const n = Array.isArray(v) ? v[1] : v;
  return n >= 15 ? 'o-high' : n >= 10 ? 'o-medium' : 'o-low';
}

function chipsHtml(parts, ctx) {
  const out = [];
  for (const [key, v] of Object.entries(parts)) {
    if (isZero(v)) continue;
    let label = PART_LABELS[key];
    if (key === 'building') label = ctx.buildingKind === 'bunker' ? 'Bunker' : 'Base';
    const neg = !Array.isArray(v) && v < 0;
    const cls = neg ? ' neg' : (key === 'order' || key === 'muOrder') ? ` ${orderClass(v)}` : '';
    out.push(`<span class="bfm-bn-chip${cls}">${label} ${neg ? '' : '+'}${fmtPart(v)}%</span>`);
  }
  return out.length ? `<div class="bfm-bn-chips">${out.join('')}</div>` : '';
}

function rowName(row) {
  const n = row.countryId ? state.nationMap?.get(row.countryId) : null;
  switch (row.kind) {
    case 'own': return { label: `${n?.name || 'Own'} — citizens`, code: n?.code };
    case 'country': return { label: n?.name || '—', code: n?.code };
    case 'allyPact': return { label: `Alliance members with a pact (${row.count})` };
    case 'ally': return { label: `Alliance members (${row.count})` };
    case 'pact': return { label: `Pact partners (${row.count})` };
    default: return { label: 'Everyone else' };
  }
}

function sideHtml(ctx) {
  const n = state.nationMap?.get(ctx.countryId);
  const isDef = ctx.side === 'defender';
  const facts = [];
  const bName = isDef ? 'Bunker' : 'Military base';
  if (!ctx.buildingKnown) facts.push(`<span class="fact">${bName}: ?</span>`);
  else if (ctx.building) facts.push(`<span class="fact">${bName} lv ${ctx.buildingLevel}: +${ctx.building}% (allies +${Math.ceil(ctx.building / 2)}%)</span>`);
  else facts.push(`<span class="fact">${bName}: not active</span>`);
  if (ctx.notLinked) facts.push(`<span class="warn">⚠ not linked to capital ${ctx.notLinked}%</span>`);
  if (ctx.revoltBar) facts.push(`<span class="fact">Revolt bar ${Math.round(ctx.revoltBar * 1000) / 10}%</span>`);
  if (!ctx.ordersKnown) facts.push('<span class="warn">orders not loaded</span>');

  const rows = sideRows(ctx).map(row => {
    const { label, code } = rowName(row);
    return `<div class="bfm-bn-row">
      <div class="bfm-bn-row-top">
        ${code ? `<img src="${FLAG(code)}" alt="" onerror="this.style.display='none'">` : ''}
        <span class="nm" title="${escapeHtml(label)}">${escapeHtml(label)}</span>
        <span class="tot">≈${sign(row.total)}%</span>
      </div>
      ${chipsHtml(row.parts, ctx)}
    </div>`;
  }).join('');

  return `<div class="bfm-bn-side">
    <div class="bfm-bn-side-head">
      <span class="who ${isDef ? 'def' : 'atk'}">${isDef ? '🛡️ Defender' : '⚔️ Attacker'} · ${escapeHtml(n?.name || '—')}</span>
      ${facts.join('')}
    </div>
    <div class="bfm-bn-list">${rows}</div>
  </div>`;
}

function meHtml(me, mine, ctxs) {
  if (!myPlayerId()) {
    return `<div class="bfm-bn-hint">Tell the tool who you are to see <b>your</b> bonus here: Players → your profile → “This is me”.
      <button type="button" data-bn-players>Open Players</button></div>`;
  }
  if (!me || !mine) return '<div class="bfm-bn-hint">Your profile could not be read right now.</div>';
  const country = state.nationMap?.get(me.countryId);
  const side = (s) => {
    const b = mine[s];
    return `<div class="bfm-bn-me-side${mine.best === s ? ' best' : ''}">
      <div class="lab">${s === 'defender' ? '🛡️ Defending' : '⚔️ Attacking'}</div>
      <div class="tot">≈${sign(b.total)}%</div>
      ${chipsHtml(b.parts, ctxs[s])}
    </div>`;
  };
  return `<div class="bfm-bn-me">
    <div class="bfm-bn-me-head">★ Your bonus${me.name ? ` · ${escapeHtml(me.name)}` : ''}${country ? ` · ${escapeHtml(country.name)}` : ''}${me.hqLevel ? ` · MU HQ lv ${me.hqLevel}` : ''}</div>
    <div class="bfm-bn-me-sides">${side('defender')}${side('attacker')}</div>
  </div>`;
}

function mapButtonsHtml(battleId) {
  const heatOn = state.coloringMode === 'battleHeatmap' && state.battleHeatmapData?.battleId === battleId;
  if (!heatOn) return '';
  const cur = state.battleBonusMap?.battleId === battleId ? state.battleBonusMap.side : null;
  const b = (side, label) => `<button type="button" data-bn-map="${side || ''}" class="${cur === side ? 'on' : ''}">${label}</button>`;
  return `<div class="bfm-bn-map">🗺 Map:
    ${b(null, 'Damage')}${b('defender', 'Defender bonus')}${b('attacker', 'Attacker bonus')}
  </div>`;
}

/**
 * Disegna la sezione in `host` per `battle` (oggetto grezzo della
 * battaglia, quello dei marker). `isCurrent()` dice se nel frattempo il
 * tooltip è passato a un'altra battaglia: in quel caso non si scrive.
 */
export async function renderBonusPanel(host, battle, { subColor, isCurrent }) {
  injectStyles();
  if (!host || !battle?._id) return;
  host.innerHTML = `<div class="bfm-spend-note" style="color:${subColor};">Loading…</div>`;

  const [rules, ordersMap, me] = await Promise.all([
    loadBonusRules(),
    fetchBattleOrders([battle._id]),
    loadMe(),
  ]);
  if (!host.isConnected || (isCurrent && !isCurrent())) return;

  const orders = ordersMap.get(battle._id) ?? null;
  const ctxs = {
    defender: sideContext(battle, 'defender', rules, orders),
    attacker: sideContext(battle, 'attacker', rules, orders),
  };
  const mine = me ? personalBonus(battle, rules, orders, me) : null;

  host.innerHTML = `
    ${meHtml(me, mine, ctxs)}
    ${sideHtml(ctxs.defender)}
    ${sideHtml(ctxs.attacker)}
    ${mapButtonsHtml(battle._id)}
    <div class="bfm-bn-note" style="color:${subColor};">
      ≈ = sum of the bonuses that apply, as on the in-game battle page. Orders: red +15%, yellow +10%,
      green +5%. “MU order” and “MU HQ” depend on your unit (≤ = up to). Who gets half of the
      bunker/base (alliance or pact) is our best reading of the rules. Rules from the game config${rules.fromConfig ? '' : ' (default values: config not loaded)'}.
    </div>`;

  host.querySelector('[data-bn-players]')?.addEventListener('click', (e) => {
    e.stopPropagation();
    import('../app/playersOverlay.js').then(m => m.openPlayersView());
  });
  host.querySelectorAll('[data-bn-map]').forEach(btn => btn.addEventListener('click', async (e) => {
    e.stopPropagation();
    const side = btn.dataset.bnMap || null;
    const hm = await import('./battleHeatmap.js');
    if (!side) hm.setBattleBonusMap(null);
    else hm.setBattleBonusMap({ battleId: battle._id, side, ...bonusByCountry(ctxs[side]) });
    host.querySelectorAll('[data-bn-map]').forEach(b => b.classList.toggle('on', (b.dataset.bnMap || null) === side));
  }));
}
