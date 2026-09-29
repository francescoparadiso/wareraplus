/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: i ponti verso il resto dell'app
   ------------------------------------------------------------------
   Political era un vicolo cieco: ogni nome portava fuori, su
   app.warera.io, e nient'altro. Eppure i dati per dire CHI è un
   candidato o un partito ci sono già, e senza una sola chiamata in
   più: `user.getUserLite`, che Political scarica comunque per ogni
   membro e ogni candidato, porta anche

     · `mu`          — l'unità militare del giocatore;
     · `skills`      — da cui src/mu/playstyle.js ricava guerra/eco;
     · `leveling`, `rankings` — livello, danno settimanale, ricchezza.

   Qui si trasformano in collegamenti: l'unità apre Esplora Unità
   Militari sulla sua scheda, la nazione apre Statistiche nazioni.
   I nomi delle unità passano da fetchMuBriefs (src/mu/api.js): cache
   dei nomi → directory se è già in memoria → mu.getById per il resto.

   ⚠️ Gli overlay si impilano per ordine nel DOM: Political è il primo,
   Unità e Nazioni vengono dopo, quindi si aprono SOPRA e chiudendoli
   si torna qui. Nessuna chiusura di Political serve (ed è quello che
   fa già battleDetail.js per le unità).

   Un solo listener delegato su `document`, installato una volta: le
   liste si ridisegnano spesso e la scheda giocatore vive fuori da
   #wp-political-root (è appesa a <body>).
   ══════════════════════════════════════════════════════════════ */

import { classifyPlaystyle } from '../mu/playstyle.js';
import { fetchMuBriefs } from '../mu/api.js';
import { escapeHtml, APP_BASE } from './config.js';
import { pT } from './plusI18n.js';

let _wired = false;

/** Installa (una volta) il listener delegato per i collegamenti. */
export function initPoliticalLinks() {
  if (_wired) return;
  _wired = true;
  document.addEventListener('click', (e) => {
    const mu = e.target.closest?.('[data-wp-mu]');
    const nation = !mu && e.target.closest?.('[data-wp-nation]');
    if (!mu && !nation) return;
    // Solo dentro Political o dentro la sua scheda giocatore: altrove
    // qualcun altro potrebbe usare gli stessi attributi per altro.
    if (!e.target.closest('#wp-political-root, .pc-modal-overlay')) return;
    e.preventDefault();
    e.stopPropagation();
    document.querySelectorAll('.pc-modal-overlay').forEach(el => el.remove());
    document.body.style.overflow = '';
    if (mu) {
      const id = mu.getAttribute('data-wp-mu');
      import('../app/muOverlay.js').then(m => m.openMuView(id)).catch(() => {});
    } else {
      const id = nation.getAttribute('data-wp-nation');
      import('../app/nationsOverlay.js').then(m => m.openNationsView(id)).catch(() => {});
    }
  });
}

/* ── Stile di gioco ── */

const PS_KEYS = { war: 'ps_war', eco: 'ps_eco', mixed: 'ps_mixed', undecided: 'ps_undecided' };

export function playstyleOf(user) {
  return user?.skills ? classifyPlaystyle(user).mode : null;
}

/** Pallino colorato (per le card fitte). */
export function psDot(mode) {
  if (!mode) return '';
  return `<span class="wp-pol-ps-dot wp-pol-ps-${mode}" title="${escapeHtml(pT(PS_KEYS[mode]))}"></span>`;
}

/** Etichetta estesa (per la scheda giocatore). */
export function psPill(mode) {
  if (!mode) return '';
  return `<span class="wp-pol-ps-pill wp-pol-ps-${mode}">${escapeHtml(pT(PS_KEYS[mode]))}</span>`;
}

/** Bottone unità militare. Senza nome risolto mostra l'id accorciato:
 *  mai un nome inventato. */
export function muChip(muId, brief) {
  if (!muId) return '';
  const name = brief?.name || `#${String(muId).slice(-6)}`;
  const av = brief?.avatarUrl ? `<img src="${escapeHtml(brief.avatarUrl)}" alt="" onerror="this.remove()">` : '<span class="wp-pol-mu-ico">⚔</span>';
  return `<button type="button" class="wp-pol-mu" data-wp-mu="${escapeHtml(muId)}" title="${escapeHtml(pT('open_mu'))}">${av}<span>${escapeHtml(name)}</span></button>`;
}

function _fmt(n) {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(1).replace(/\.0$/, '') + 'B';
  if (a >= 1e6) return (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M';
  if (a >= 1e3) return (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

/* ── Scheda giocatore: il blocco WarEra+ ── */

/** Riempie il segnaposto `.pc-plus` della scheda giocatore con unità,
 *  stile di gioco e numeri del giocatore. `user` è la risposta di
 *  getUserLite (già in cache di Political quasi sempre). */
export async function fillPlayerCardPlus(slot, user) {
  if (!slot || !user) { if (slot) slot.remove(); return; }
  const mode = playstyleOf(user);
  let brief = null;
  if (user.mu) {
    try { brief = (await fetchMuBriefs([user.mu])).get(user.mu) || null; } catch (_) {}
  }
  if (!slot.isConnected) return;
  const weekly = user.rankings?.weeklyUserDamages?.value;
  const wealth = user.rankings?.userWealth?.value;
  const level = user.leveling?.level;
  slot.innerHTML = `
    <div class="pc-plus-row">
      <span class="pc-stat-label">${escapeHtml(pT('military_unit'))}</span>
      ${user.mu ? muChip(user.mu, brief) : `<span class="pc-plus-dim">${escapeHtml(pT('no_mu'))}</span>`}
    </div>
    <div class="pc-plus-row">
      <span class="pc-stat-label">${escapeHtml(pT('playstyle'))}</span>
      ${mode ? psPill(mode) : '<span class="pc-plus-dim">—</span>'}
    </div>
    <div class="pc-plus-nums">
      ${level != null ? `<span><strong>${level}</strong> ${escapeHtml(pT('level'))}</span>` : ''}
      ${Number.isFinite(weekly) ? `<span><strong>${_fmt(weekly)}</strong> ${escapeHtml(pT('weekly_damage'))}</span>` : ''}
      ${Number.isFinite(wealth) ? `<span><strong>${_fmt(wealth)}</strong> ${escapeHtml(pT('wealth'))}</span>` : ''}
    </div>
    ${user.country ? `<button type="button" class="pc-plus-nation" data-wp-nation="${escapeHtml(user.country)}">📊 ${escapeHtml(pT('open_nation'))}</button>` : ''}
  `;
}

/* ── Partito: composizione degli iscritti ── */

/**
 * Chi c'è dentro un partito, dai membri appena scaricati: quota guerra /
 * eco, livello medio, danno settimanale sommato e le unità militari da
 * cui vengono. È la domanda che la lista di avatar non risponde: un
 * partito di trenta guerrieri della stessa unità è un'altra cosa da un
 * partito di trenta imprenditori sparsi.
 */
export async function renderPartyComposition(container, members) {
  if (!container) return;
  const list = (members || []).filter(Boolean);
  if (!list.length) { container.innerHTML = `<p class="wp-pol-dim">${escapeHtml(pT('no_members'))}</p>`; return; }

  const counts = { war: 0, eco: 0, mixed: 0, undecided: 0 };
  let known = 0, lvSum = 0, lvN = 0, dmg = 0;
  const byMu = new Map();
  let noMu = 0;
  for (const u of list) {
    const mode = playstyleOf(u);
    if (mode) { counts[mode]++; known++; }
    const lv = u.leveling?.level;
    if (Number.isFinite(lv)) { lvSum += lv; lvN++; }
    dmg += u.rankings?.weeklyUserDamages?.value || 0;
    if (u.mu) byMu.set(u.mu, (byMu.get(u.mu) || 0) + 1);
    else noMu++;
  }

  const bar = known
    ? ['war', 'eco', 'mixed', 'undecided'].filter(k => counts[k]).map(k =>
        `<span class="wp-pol-ps-seg wp-pol-ps-${k}" style="flex:${counts[k]}" title="${escapeHtml(pT(PS_KEYS[k]))}: ${counts[k]}"></span>`).join('')
    : '';
  const legend = ['war', 'eco', 'mixed', 'undecided'].filter(k => counts[k]).map(k =>
    `<span>${psDot(k)} ${escapeHtml(pT(PS_KEYS[k]))} <strong>${counts[k]}</strong> <em>${Math.round(counts[k] / known * 100)}%</em></span>`).join('');

  const topMus = [...byMu.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);

  const paint = (briefs) => {
    container.innerHTML = `
      <div class="wp-pol-comp">
        <div class="wp-pol-comp-nums">
          <div><strong>${list.length}</strong><span>${escapeHtml(pT('members'))}</span></div>
          <div><strong>${lvN ? (lvSum / lvN).toFixed(1) : '—'}</strong><span>${escapeHtml(pT('avg_level'))}</span></div>
          <div><strong>${_fmt(dmg)}</strong><span>${escapeHtml(pT('weekly_damage'))}</span></div>
          <div><strong>${byMu.size}</strong><span>${escapeHtml(pT('units'))}</span></div>
        </div>
        ${known ? `<div class="wp-pol-comp-title">${escapeHtml(pT('playstyle'))}</div>
        <div class="wp-pol-ps-bar">${bar}</div>
        <div class="wp-pol-ps-legend">${legend}</div>` : ''}
        ${topMus.length ? `<div class="wp-pol-comp-title">${escapeHtml(pT('members_by_mu'))}</div>
        <div class="wp-pol-mu-list">
          ${topMus.map(([id, n]) => `<div class="wp-pol-mu-row">${muChip(id, briefs?.get(id))}<span class="wp-pol-mu-n">${n}</span></div>`).join('')}
          ${noMu ? `<div class="wp-pol-mu-row"><span class="wp-pol-dim">${escapeHtml(pT('no_mu'))}</span><span class="wp-pol-mu-n">${noMu}</span></div>` : ''}
        </div>` : ''}
      </div>`;
  };

  paint(null);
  if (!topMus.length) return;
  try {
    const briefs = await fetchMuBriefs(topMus.map(([id]) => id));
    if (container.isConnected) paint(briefs);
  } catch (_) { /* restano gli id accorciati */ }
}

/** Link al profilo di gioco (quello che c'era prima, invariato). */
export function profileHref(userId) {
  return `${APP_BASE}/user/${encodeURIComponent(userId)}`;
}
