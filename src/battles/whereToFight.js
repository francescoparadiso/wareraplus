/* ══════════════════════════════════════════════════════════════
   WarEra+ — Battaglie: scheda "Dove combattere"
   ------------------------------------------------------------------
   Tutte le battaglie in corso ordinate per il bonus danno che avresti TU
   da una parte o dall'altra: la tua nazione, la tua alleanza, i patti, il
   tuo nemico giurato, gli ordini (della tua nazione e della tua unità) e
   il quartier generale della tua unità. Il calcolo è quello della scheda
   battaglia sulla mappa (src/shared/battleBonus.js); qui si fa per tutte
   insieme, per rispondere a "dove conviene andare adesso".

   Chi sei lo dice "Sono io" in Giocatori (`we_my_player`): senza, la
   scheda spiega come impostarlo invece di indovinare.

   Costo: le battaglie sono quelle della mappa (fetchActiveBattles, già in
   cache), gli ordini due chiamate per battaglia in UN batch (cache 60 s),
   il tuo profilo e il quartier generale una volta ogni 5 minuti. Tutto
   pubblico su api6.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { escapeHtml } from '../diplomacy/utils.js';
import { getFlagUrl } from '../panel/nationFlag.js';
import { fetchActiveBattles } from '../diplomacy/battleHeatmap.js';
import { loadBonusRules, fetchBattleOrders, loadMe, myPlayerId, personalBonus } from '../shared/battleBonus.js';
import { btlT } from './i18n.js';

const PART_KEYS = {
  home: 'partHome', enemy: 'partEnemy', pact: 'partPact', ally: 'partAlly', order: 'partOrder',
  muOrder: 'partMuOrder', muHq: 'partMuHq', revolt: 'partRevolt', malus: 'partMalus',
};

/** Tutto quello che serve alla scheda. Non lancia mai. */
export async function loadWhere() {
  if (!myPlayerId()) return { noMe: true };
  try {
    const [me, rules, raw] = await Promise.all([loadMe(), loadBonusRules(), fetchActiveBattles()]);
    if (!me?.countryId) return { noProfile: true };
    const battles = (Array.isArray(raw) ? raw : []).filter(b => b?._id && b.attacker?.country && b.defender?.country);
    const orders = await fetchBattleOrders(battles.map(b => b._id));
    const rows = battles.map(b => {
      const mine = personalBonus(b, rules, orders.get(b._id) ?? null, me);
      return { battle: b, mine, best: Math.max(mine.defender.total, mine.attacker.total), ordersKnown: !!orders.get(b._id) };
    }).sort((a, b) => b.best - a.best);
    return { me, rows, at: Date.now() };
  } catch (err) {
    console.warn('WarEra+ dove combattere: calcolo non riuscito', err);
    return { error: true };
  }
}

const nation = (id) => state.nationMap?.get(id) || null;
const fmt = (v) => (Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));
const sign = (t) => (t > 0 ? '+' : '') + fmt(t);

function flag(id) {
  const n = nation(id);
  const url = getFlagUrl(n?.code?.toLowerCase());
  return url ? `<img class="wp-btl-flag" src="${url}" alt="" loading="lazy" onerror="this.style.display='none'">` : '';
}

function chips(parts, side) {
  const out = [];
  for (const [key, v] of Object.entries(parts)) {
    if (!v) continue;
    const label = key === 'building' ? btlT(side === 'defender' ? 'partBunker' : 'partBase') : btlT(PART_KEYS[key]);
    const neg = v < 0;
    const ord = (key === 'order' || key === 'muOrder') ? (v >= 15 ? ' o-high' : v >= 10 ? ' o-medium' : ' o-low') : '';
    out.push(`<span class="wp-btl-bchip${neg ? ' neg' : ord}">${escapeHtml(label)} ${neg ? '' : '+'}${fmt(v)}%</span>`);
  }
  return out.join('');
}

function sideCell(row, side) {
  const b = row.mine[side];
  const best = row.mine.best === side && b.total > 0;
  return `<td class="wp-btl-bside${best ? ' best' : ''}">
    <div class="wp-btl-btot">≈${sign(b.total)}%</div>
    <div class="wp-btl-bchips">${chips(b.parts, side)}</div>
  </td>`;
}

export function renderWhere(data) {
  if (!data) return `<div class="wp-btl-loading">${btlT('whereLoading')}</div>`;
  const intro = `<p class="wp-btl-sub wp-btl-where-intro">${btlT('whereIntro')}</p>`;
  if (data.noMe) {
    return `${intro}<div class="wp-btl-notice">${btlT('whereNoMe')}
      <button type="button" class="wp-btl-chip" data-where-players>${btlT('whereOpenPlayers')}</button></div>`;
  }
  if (data.noProfile || data.error) return `${intro}<div class="wp-btl-notice warn">${btlT('whereNoProfile')}</div>`;

  const me = data.me;
  const country = nation(me.countryId);
  const who = [
    me.name ? `<b>${escapeHtml(me.name)}</b>` : '',
    country ? `${flag(me.countryId)} ${escapeHtml(country.name)}` : '',
    me.hqLevel ? escapeHtml(btlT('whereHq', { n: me.hqLevel })) : '',
  ].filter(Boolean).join(' · ');

  const body = data.rows.length ? `
    <div class="wp-btl-tablewrap">
      <table class="wp-btl-table wp-btl-where">
        <thead><tr>
          <th>${btlT('colBattle')}</th>
          <th class="wp-btl-th-region">${btlT('colRegion')}</th>
          <th>🛡️ ${btlT('colDefending')}</th>
          <th>⚔️ ${btlT('colAttacking')}</th>
        </tr></thead>
        <tbody>${data.rows.map(row => {
          const b = row.battle;
          const def = nation(b.defender.country);
          const atk = nation(b.attacker.country);
          const region = state.regionData?.[b.defender?.region]?.name || '';
          const mine = [b.defender.country, b.attacker.country].includes(me.countryId);
          return `<tr class="wp-btl-where-row wp-btl-clickable" data-where-open="${escapeHtml(b._id)}" tabindex="0">
            <td class="wp-btl-match">
              <span class="wp-btl-side">${flag(b.defender.country)} ${escapeHtml(def?.name || '—')}</span>
              <span class="wp-btl-vs">vs</span>
              <span class="wp-btl-side">${flag(b.attacker.country)} ${escapeHtml(atk?.name || '—')}</span>
              ${b.type === 'resistance' ? `<span class="wp-btl-type">${btlT('typeResistance')}</span>` : ''}
              ${mine ? `<span class="wp-btl-tag wp-btl-tag-mine">${btlT('whereYours')}</span>` : ''}
              ${row.ordersKnown ? '' : `<span class="wp-btl-tag">${btlT('whereOrdersUnknown')}</span>`}
            </td>
            <td class="wp-btl-region">${escapeHtml(region)}</td>
            ${sideCell(row, 'defender')}
            ${sideCell(row, 'attacker')}
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>` : `<div class="wp-btl-empty">${btlT('whereNone')}</div>`;

  return `${intro}
    <div class="wp-btl-toolbar">
      <span class="wp-btl-where-me">★ ${who}</span>
      <button type="button" class="wp-btl-chip" data-where-refresh>${btlT('whereRefresh')}</button>
      <span class="wp-btl-meta">${btlT('liveUpdated', { t: new Date(data.at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) })}</span>
    </div>
    ${body}
    <p class="wp-btl-foot">${btlT('whereNote')}</p>`;
}

export function wireWhere(root, { onOpenBattle, onRefresh }) {
  root.querySelector('[data-where-players]')?.addEventListener('click', () => {
    import('../app/playersOverlay.js').then(m => m.openPlayersView());
  });
  root.querySelector('[data-where-refresh]')?.addEventListener('click', () => onRefresh());
  root.querySelectorAll('[data-where-open]').forEach(tr => {
    const open = () => onOpenBattle(tr.dataset.whereOpen);
    tr.addEventListener('click', open);
    tr.addEventListener('keydown', (e) => { if (e.key === 'Enter') open(); });
  });
}
