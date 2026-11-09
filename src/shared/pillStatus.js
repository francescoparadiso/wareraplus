/* ══════════════════════════════════════════════════════════════
   WarEra+ — Pillole di un gruppo di giocatori (scheda unità, 1 vs 1,
   torneo)
   ------------------------------------------------------------------
   Una sola implementazione per tutte le viste che mostrano "chi può
   pillare, chi è pillato, chi è in debuff", con vita e cibo di ognuno.
   Parte dal solo `user.getUserLite`: `buffs` dice lo stato, `skills.health`
   e `skills.hunger` le barre. Zero fetch dedicate.

   ⚠️ Le barre sono quelle del momento della lettura, nessuna proiezione
   della rigenerazione. Contano solo le fini di buff/debuff nel FUTURO,
   come pillHtml() in src/players/main.js.
   ══════════════════════════════════════════════════════════════ */

import '../styles/pills.css';
import { avatarImg, escapeHtml, flagImg } from '../mu/ui.js';

const APP_BASE = 'https://app.warera.io';

export function pillState(u, now = Date.now()) {
  const b = u?.buffs || {};
  const on = Date.parse(b.buffEndAt || '');
  const down = Date.parse(b.debuffEndAt || '');
  if (on > now) return { group: 'on', end: on };
  if (down > now) return { group: 'down', end: down };
  return { group: 'can', end: null };
}

export function fmtLeft(ms) {
  const m = Math.max(1, Math.round(ms / 60000));
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
}

/** I giocatori divisi nei tre gruppi, già ordinati: chi può pillare dal più
 *  in forma, gli altri due da chi cambia stato per primo. */
export function groupPills(users, now = Date.now()) {
  const groups = { can: [], on: [], down: [] };
  for (const u of users) {
    if (!u) continue;
    const st = pillState(u, now);
    groups[st.group].push({ u, st });
  }
  const hp = (u) => u.skills?.health?.currentBarValue ?? 0;
  groups.can.sort((a, b) => hp(b.u) - hp(a.u));
  groups.on.sort((a, b) => a.st.end - b.st.end);
  groups.down.sort((a, b) => a.st.end - b.st.end);
  return groups;
}

/* ── Barre vita / fame con riempimento ────────────────────────────
   Per chi deve capire SE un giocatore ha ancora colpi da dare (assalto alla
   classifica di una battaglia, dove i drop dipendono dalla posizione): un
   numero "21,8 / 160" da solo si legge male, la barra dice a colpo d'occhio
   quanto è carico. Usata dall'elenco membri delle unità (lista e card) e
   dalla scheda giocatore. Stessi dati di pillRow: `skills.health` /
   `skills.hunger` di getUserById, quindi la lettura del momento — la
   rigenerazione oraria (`hourlyBarRegen`) è nel tooltip, non proiettata. */

function fmtBar(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return '—';
  return String(n >= 100 ? Math.round(n) : Math.round(n * 10) / 10);
}

/** Una barra: `kind` = 'hp' | 'food' (colore), `s` = skills.health/hunger,
 *  `label` = nome nel tooltip. Senza dati, un trattino. */
export function resourceBarHtml(s, kind, label) {
  if (s?.total == null) return '<span class="wp-res-bar wp-res-empty">—</span>';
  const cur = Number(s.currentBarValue ?? s.value ?? 0);
  const tot = Number(s.total) || 0;
  const pct = tot > 0 ? Math.max(0, Math.min(100, (cur / tot) * 100)) : 0;
  const regen = Number(s.hourlyBarRegen);
  const tip = `${label}: ${fmtBar(cur)} / ${fmtBar(tot)}${Number.isFinite(regen) && regen > 0 ? ` (+${fmtBar(regen)}/h)` : ''}`;
  return `
    <span class="wp-res-bar wp-res-${kind}" title="${escapeHtml(tip)}">
      <i style="width:${pct.toFixed(1)}%"></i>
      <b>${fmtBar(cur)}<small>/${fmtBar(tot)}</small></b>
    </span>`;
}

function rowHtml({ u, st }, now, labels) {
  const bar = (label, icon, s) => `
    <span class="wp-mu-pill-bar" title="${escapeHtml(label)}">
      <span class="wp-mu-pill-bar-k">${icon}</span>
      <span class="wp-mu-pill-bar-v">${s?.total != null ? `${Math.round(s.currentBarValue ?? s.value ?? 0)}<small>/${Math.round(s.total)}</small>` : '—'}</span>
    </span>`;
  return `
    <a class="wp-mu-pill-row" href="${APP_BASE}/user/${encodeURIComponent(u._id)}" target="_blank" rel="noopener noreferrer">
      ${avatarImg(u.avatarUrl, u.username, 'wp-mu-avatar wp-mu-avatar-xs')}
      ${flagImg(u.country)}
      <span class="wp-mu-pill-nick">${escapeHtml(u.username)}</span>
      ${bar(labels.health, '❤', u.skills?.health)}
      ${bar(labels.food, '🍗', u.skills?.hunger)}
      ${st.end ? `<span class="wp-mu-pill-left">${escapeHtml(fmtLeft(st.end - now))}</span>` : ''}
    </a>`;
}

/** Le tre colonne. `labels`: { can, on, down, none, health, food, canHint,
 *  onHint, downHint } — le passa la vista, col suo dizionario. */
export function pillColumnsHtml(users, labels) {
  const now = Date.now();
  const groups = groupPills(users, now);
  const col = (key, title, hint) => `
    <div class="wp-mu-pills-col wp-mu-pills-${key}">
      <h4 class="wp-mu-pills-head" title="${escapeHtml(hint)}">${escapeHtml(title)} <span class="wp-mu-count">${groups[key].length}</span></h4>
      <div class="wp-mu-pills-list">
        ${groups[key].length ? groups[key].map(g => rowHtml(g, now, labels)).join('') : `<div class="wp-mu-empty">${escapeHtml(labels.none)}</div>`}
      </div>
    </div>`;
  return `<div class="wp-mu-pills-grid">
    ${col('can', labels.can, labels.canHint)}
    ${col('on', labels.on, labels.onHint)}
    ${col('down', labels.down, labels.downHint)}
  </div>`;
}
