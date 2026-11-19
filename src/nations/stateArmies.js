/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: Eserciti di Stato (v0.28.3)
   ------------------------------------------------------------------
   Dal 16 novembre 2026 una nazione può sponsorizzare unità militari come
   Esercito di Stato: lo propone con una legge (che costa carta), l'unità
   accetta, e da lì la nazione le paga ogni ora il petrolio del quartier
   generale (HQ 1/2/3/4 = 1/2/5/10 barili all'ora, gameConfig
   upgradesConfig.headquarters). Questa sezione dice quali unità, da
   quando, e quanto costano.

   Tutto pubblico, due richieste quando si apre la scheda:
     · muSponsorship.getByCountry {countryId}
         → { active, offered, past, mus: { id: { name, membersCount, hqLevel } } }
       `past` porta `endReason` (es. 'citizenship') ed `endedAt`;
     · stateArmyExpense.getLedger {countryId, limit ≤ 100, cursor?}
         → { items: [{ mu, kind: 'hqOil'|'sponsorLaw', itemCode, quantity, day }], nextCursor }
       Una riga per unità, tipo e GIORNO (UTC): quella di oggi cresce ogni
       ora, non è un movimento per ora. Si leggono al massimo 5 pagine.
   Il prezzo di petrolio e carta è quello di ADESSO (itemTrading.getPrices):
   il costo in monete è una stima a prezzi di oggi e lo si dice.

   Se una delle due letture fallisce la sezione semplicemente non compare:
   è un di più sul resto della scheda.
   ══════════════════════════════════════════════════════════════ */

import { escapeHtml, fmtCompact, avatarImg } from '../mu/ui.js';
import { trpcCall } from '../shared/trpcClient.js';
import { ecoT } from './i18nEco.js';

const LEDGER_PAGES = 5;
const KNOWN_END = new Set(['citizenship']);
const TTL_MS = 5 * 60 * 1000;
const _cache = new Map();   // countryId -> { at, p }

/** Le tre letture, tenute 5 minuti: cambiare l'ordinamento della tabella
 *  sopra ridisegna anche questa sezione, e non deve rifare le richieste. */
function load(countryId) {
  const hit = _cache.get(countryId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.p;
  const p = Promise.all([
    trpcCall('muSponsorship.getByCountry', { countryId }),
    fetchLedger(countryId),
    trpcCall('itemTrading.getPrices', {}).catch(() => null),
  ]);
  _cache.set(countryId, { at: Date.now(), p });
  p.catch(() => _cache.delete(countryId));
  return p;
}

async function fetchLedger(countryId) {
  const items = [];
  let cursor = null;
  for (let i = 0; i < LEDGER_PAGES; i++) {
    const input = { countryId, limit: 100 };
    if (cursor) input.cursor = cursor;
    const d = await trpcCall('stateArmyExpense.getLedger', input);
    items.push(...(d?.items || []));
    cursor = d?.nextCursor;
    if (!cursor) return { items, complete: true };
  }
  return { items, complete: false };
}

function fmtDay(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

/** Disegna la sezione in `host` (vuoto se la nazione non ne ha). */
export async function renderStateArmies(host, nation, directory) {
  host.innerHTML = '';
  let spons, ledger, prices;
  try {
    [spons, ledger, prices] = await load(nation._id);
  } catch (err) {
    console.warn('WarEra+ nations: eserciti di Stato non disponibili:', err.message);
    return;
  }
  if (!host.isConnected) return;
  const active = spons?.active || [];
  const offered = spons?.offered || [];
  const past = spons?.past || [];
  if (!active.length && !offered.length && !past.length && !ledger.items.length) {
    host.innerHTML = `<h3 class="wp-nat-section-title" data-sec="nat-state-armies">${escapeHtml(ecoT('saTitle'))}</h3>
      <p class="wp-nat-curve-note">${escapeHtml(ecoT('saNone', { nation: nation.name || '—' }))}</p>`;
    return;
  }

  const muInfo = spons?.mus || {};
  const dirById = new Map((directory || []).map(m => [m._id, m]));
  const oilP = Number(prices?.oil) || null;
  const paperP = Number(prices?.paper) || null;

  // Per unità: petrolio oggi / ieri / totale, carta delle leggi.
  const today = new Date().toISOString().slice(0, 10);
  const yest = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const per = new Map();
  const byDay = new Map();
  let oilTot = 0, paperTot = 0;
  for (const it of ledger.items) {
    const q = Number(it.quantity) || 0;
    const p = per.get(it.mu) || { oilToday: 0, oilYest: 0, oil: 0, paper: 0 };
    if (it.kind === 'hqOil') {
      p.oil += q; oilTot += q;
      if (it.day === today) p.oilToday += q;
      if (it.day === yest) p.oilYest += q;
      byDay.set(it.day, (byDay.get(it.day) || 0) + q);
    } else {
      p.paper += q; paperTot += q;
    }
    per.set(it.mu, p);
  }
  const firstDay = ledger.items.reduce((min, it) => (!min || it.day < min ? it.day : min), null);
  const hourlyNow = active.reduce((s, a) => s + ([0, 1, 2, 5, 10][muInfo[a.mu]?.hqLevel ?? dirById.get(a.mu)?.hq ?? 0] || 0), 0);
  const money = (oilP ? oilTot * oilP : 0) + (paperP ? paperTot * paperP : 0);

  const tiles = [
    [ecoT('saActive'), String(active.length)],
    [ecoT('saOffered'), String(offered.length)],
    [ecoT('saOilHour'), fmtCompact(hourlyNow)],
    [ecoT('saOilTot'), fmtCompact(oilTot)],
    [ecoT('saPaperTot'), fmtCompact(paperTot)],
    ...(oilP || paperP ? [[ecoT('saMoney'), fmtCompact(Math.round(money))]] : []),
  ].map(([lab, val]) => `
    <div class="wp-nat-lab-tile">
      <span class="wp-nat-lab-lab">${escapeHtml(lab)}</span>
      <strong class="wp-nat-lab-val">${escapeHtml(val)}</strong>
    </div>`).join('');

  const statusTxt = (s) => {
    if (s.status === 'active') return ecoT('saStActive');
    if (s.status === 'offered') return ecoT('saStOffered', { d: fmtDay(s.offerExpiresAt) });
    // L'unica causa vista finora è 'citizenship' (2026-11-17, Ungheria);
    // le altre si mostrano col nome che dà il gioco invece di inventarle.
    const why = s.endReason ? (KNOWN_END.has(s.endReason) ? ecoT('saEnd_' + s.endReason) : s.endReason) : '';
    return ecoT('saStEnded', { d: fmtDay(s.endedAt) }) + (why ? ` (${why})` : '');
  };
  const rows = [...active, ...offered, ...past].map(s => {
    const info = muInfo[s.mu] || {};
    const d = dirById.get(s.mu);
    const name = info.name || d?.name || '—';
    const p = per.get(s.mu) || { oilToday: 0, oilYest: 0, oil: 0, paper: 0 };
    return `<tr class="wp-nat-sa-${escapeHtml(s.status)}" data-mu="${escapeHtml(s.mu)}">
      <td><a href="#" class="wp-nat-cname" data-mu="${escapeHtml(s.mu)}">${avatarImg(d?.avatarUrl, name, 'wp-mu-avatar wp-mu-avatar-xs')}<span class="wp-nat-cnick">${escapeHtml(name)}</span></a></td>
      <td>${escapeHtml(statusTxt(s))}</td>
      <td class="wp-nat-num">${escapeHtml(fmtDay(s.acceptedAt || s.offeredAt))}</td>
      <td class="wp-nat-num">${escapeHtml(info.membersCount ?? d?.memberCount ?? '—')}</td>
      <td class="wp-nat-num">${escapeHtml(info.hqLevel ?? d?.hq ?? '—')}</td>
      <td class="wp-nat-num">${escapeHtml(fmtCompact(p.oilToday))}</td>
      <td class="wp-nat-num">${escapeHtml(fmtCompact(p.oilYest))}</td>
      <td class="wp-nat-num">${escapeHtml(fmtCompact(p.oil))}</td>
      <td class="wp-nat-num">${escapeHtml(fmtCompact(p.paper))}</td>
    </tr>`;
  }).join('');

  const days = [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const maxDay = Math.max(1, ...days.map(([, v]) => v));
  const dayBars = days.length > 1 ? `
    <div class="wp-nat-sa-days" aria-label="${escapeHtml(ecoT('saPerDay'))}">
      ${days.map(([d, v]) => `<span class="wp-nat-sa-day" title="${escapeHtml(`${d} · ${fmtCompact(v)}`)}">
        <span class="wp-nat-sa-bar" style="height:${Math.max(4, (v / maxDay) * 100)}%"></span>
        <span class="wp-nat-sa-dlab">${escapeHtml(d.slice(5))}</span></span>`).join('')}
    </div>` : '';

  host.innerHTML = `
    <h3 class="wp-nat-section-title" data-sec="nat-state-armies">${escapeHtml(ecoT('saTitle'))}</h3>
    <p class="wp-nat-curve-note">${escapeHtml(ecoT('saSub', { d: firstDay ? fmtDay(firstDay) : '—' }))}${ledger.complete ? '' : ` ${escapeHtml(ecoT('saCut'))}`}</p>
    <div class="wp-nat-lab-tiles">${tiles}</div>
    ${dayBars}
    <div class="wp-nat-sa-wrap"><table class="wp-nat-sa">
      <thead><tr>
        <th>${escapeHtml(ecoT('muUnit'))}</th><th>${escapeHtml(ecoT('saStatus'))}</th>
        <th class="wp-nat-num">${escapeHtml(ecoT('saSince'))}</th><th class="wp-nat-num">${escapeHtml(ecoT('muMembers'))}</th>
        <th class="wp-nat-num">HQ</th><th class="wp-nat-num">${escapeHtml(ecoT('saOilToday'))}</th>
        <th class="wp-nat-num">${escapeHtml(ecoT('saOilYest'))}</th><th class="wp-nat-num">${escapeHtml(ecoT('saOilTot'))}</th>
        <th class="wp-nat-num">${escapeHtml(ecoT('saPaperTot'))}</th>
      </tr></thead>
      <tbody>${rows}</tbody>
    </table></div>
    <p class="wp-nat-curve-note">${escapeHtml(ecoT('saNote'))}${oilP ? ` ${escapeHtml(ecoT('saPriceNote', { oil: oilP.toFixed(3), paper: paperP ? paperP.toFixed(3) : '—' }))}` : ''}</p>`;
}
