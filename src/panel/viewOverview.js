/* ══════════════════════════════════════════════════════════════
   WarEra+ — Riepilogo della vista nel pannello laterale
   ------------------------------------------------------------------
   Perché esiste: entrando in vista "Sfera d'influenza" il pannello si
   apre da solo sul riepilogo di tutte le sfere (countryPanel.js:
   renderSphereOverviewPanel) — la domanda iniziale non è "com'è fatta
   questa", ma "cosa sto guardando". Le altre viste della mappa non
   avevano niente del genere: alleanze, popolazione, danni settimanali,
   regioni contese, storico bellico e guerra vs eco aprivano una mappa
   colorata e basta, con la sola barra del gradiente in legenda. Si
   capiva la scala, non il contenuto: nessun nome, nessuna classifica,
   e per tre di loro nemmeno cosa venisse misurato.

   Qui si costruisce quel riepilogo, uno per vista: una classifica
   leggibile in dieci secondi, e — per le viste non ovvie (contese,
   storico bellico, guerra vs eco) — due righe che dicono cosa sta
   effettivamente contando il colore.

   Divisione dei compiti: questo file produce SOLO markup e dati.
   L'apertura/chiusura, la linguetta mobile e i click stanno in
   countryPanel.js, che possiede il pannello (renderViewOverviewPanel).

   Zero fetch: tutto arriva da `state`, già popolato dalla vista
   (nationMap, allianceMap, contestedCounts, warIntensityData,
   nationPlaystyle, regionData). Se il dato della vista sta ancora
   arrivando, buildViewOverviewHtml ritorna lo stato "in caricamento" e
   countryPanel.js ridisegna quando la fetch atterra
   (refreshViewOverviewPanel, chiamata da diplomacy/main.js).

   I colori delle barrette non sono inventati per il pannello: vengono
   dalle stesse funzioni che tingono la mappa (population.js,
   weeklyDamage.js, contestedHeatmap.js, warIntensityHeatmap.js,
   playstyleHeatmap.js), così una riga dell'elenco ha esattamente la
   tinta del territorio a cui si riferisce.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { escapeHtml, fmtNumber } from '../diplomacy/utils.js';
import { t } from '../shared/i18n.js';
import { flagImgHtml } from './nationFlag.js';
import { getPopulationColor } from '../diplomacy/population.js';
import { getDamageColor } from '../diplomacy/weeklyDamage.js';
import { contestedRankedList, getContestedStats } from '../diplomacy/contestedHeatmap.js';
import { warIntensityRankedList, getWarIntensityStats } from '../diplomacy/warIntensityHeatmap.js';
import { buildPlaystyleScale, getBalanceColor, getPlaystyleStats } from '../diplomacy/playstyleHeatmap.js';
import { getTrendColor, getTrendStats } from '../diplomacy/playstyleTrendHeatmap.js';
import { activeDeposits, depositsByCountry, getProductionColor, getProductionStats, productionRankedList, RESOURCE_TYPES } from '../diplomacy/productionHeatmap.js';
import { openElectionRows, getPoliticsStats, POLITICS_COLORS, turnoutColor } from '../diplomacy/politicsHeatmap.js';
import { travelOverviewHtml } from '../diplomacy/travelDistance.js';
import { mig, migrationRanking, getMigrationStats, focusFlows, migrationValue, migrationColor, migrationCanHover,
  MIGRATION_DAYS, MIN_RATE_CITIZENS, OUT_COLOR, IN_COLOR } from '../diplomacy/migrationFlows.js';
import { mT } from '../diplomacy/migrationI18n.js';

/** Le viste che hanno un riepilogo. Chi chiama usa questo elenco per
 *  decidere se aprire il pannello: tenerlo qui evita che countryPanel.js
 *  e map.js abbiano due liste da tenere allineate a mano. */
export const OVERVIEW_MODES = ['blocs', 'population', 'weeklyDamage', 'production', 'contested', 'warIntensity', 'playstyle', 'politics', 'travel', 'migration'];

export function hasViewOverview(mode) {
  return OVERVIEW_MODES.includes(mode);
}

/** Quante righe per classifica. Il pannello scorre, ma un elenco infinito
 *  smette di essere un riepilogo: per l'elenco completo ci sono
 *  Statistiche nazioni e Statistiche alleanze. */
const TOP_NATIONS = 20;
const TOP_REGIONS = 20;
const TOP_PLAYSTYLE = 10;
const TOP_DEPOSITS = 12;

function fmt(n) {
  if (n == null || isNaN(n)) return '—';
  return fmtNumber(n);
}

// ══════════════════ PEZZI DI MARKUP COMUNI ══════════════════

function headerHtml(title, badge) {
  return `
    <div class="wp-panel-header">
      <div>
        <div class="wp-panel-name">${escapeHtml(title)}</div>
        ${badge != null ? `<span class="wp-panel-bloc" style="background:#58a6ff22;color:#58a6ff">${escapeHtml(String(badge))}</span>` : ''}
      </div>
    </div>`;
}

/** Riga di spiegazione delle viste non ovvie. Classe diversa da
 *  .wp-panel-hint (che è un suggerimento d'uso di una riga): questa è il
 *  "cosa stai guardando", e deve reggere due o tre righe di testo. */
function aboutHtml(text) {
  return `<div class="wp-vo-about">${escapeHtml(text)}</div>`;
}

function statsHtml(cells) {
  return `<div class="wp-panel-grid wp-vo-grid">${cells.map(c => `
      <div class="wp-stat">
        <div class="wp-stat-label">${escapeHtml(c.label)}</div>
        <div class="wp-stat-value">${escapeHtml(String(c.value))}</div>
      </div>`).join('')}</div>`;
}

/**
 * Riga di classifica: posizione, bandiera/pallino colorato, nome, valore,
 * e sotto la barretta proporzionale — è la barra a far capire in un colpo
 * d'occhio se il primo stacca tutti o se sono appaiati, cosa che una
 * colonna di numeri non dice.
 */
function rowHtml({ rank, icon, name, sub, value, share, color, dataset = '' }) {
  // <button> e non <div> quando la riga apre qualcosa: su telefono un
  // riquadro che si puo' toccare deve sembrarlo (chevron in coda, come le
  // pastiglie del riepilogo sfere) e deve rispondere al tocco senza
  // dipendere da un listener su un elemento non interattivo.
  const tag = dataset ? 'button' : 'div';
  const attrs = dataset ? ` type="button"${dataset}` : '';
  return `
    <${tag} class="wp-vo-row"${attrs}>
      <span class="wp-vo-rank">${rank}</span>
      ${icon || ''}
      <span class="wp-vo-name">${escapeHtml(name)}</span>
      <span class="wp-vo-value">${escapeHtml(String(value))}</span>
      ${dataset ? '<span class="wp-vo-go" aria-hidden="true">›</span>' : ''}
      ${sub ? `<span class="wp-vo-sub">${escapeHtml(sub)}</span>` : '<span class="wp-vo-sub"></span>'}
      <span class="wp-vo-bar"><i style="width:${Math.max(2, Math.round((share || 0) * 100))}%;background:${color}"></i></span>
    </${tag}>`;
}

function emptyHtml(text) {
  return `<div class="wp-panel-empty">${escapeHtml(text)}</div>`;
}

/** Nome leggibile di una regione + chi la possiede oggi. */
function regionLabel(regionId) {
  const region = state.regionData?.[regionId];
  const name = region?.name || region?.mainCity || state.regionCache?.get(regionId)?.name || '';
  const owner = region?.country ? state.nationMap.get(region.country) : null;
  return { name: name || regionId, owner };
}

// ══════════════════ ALLEANZE ══════════════════

function alliancesHtml() {
  // WarEra+: con l'anteprima di Alliance Builder attiva (builderPreview.js)
  // il riepilogo deve elencare i blocchi COSTRUITI — quello che la mappa
  // sta dipingendo — non le alleanze di gioco. I numeri sono gia' calcolati
  // dal builder, quindi qui non si somma nulla di nuovo; le righe non
  // aprono il dettaglio blocco perche' in anteprima il focus e' spento.
  if (state.builderPreview) return builderPreviewAlliancesHtml();
  const rows = state.externalBlocsInfo.map(b => {
    const alliance = state.allianceMap.get(b.id);
    const members = alliance?.memberCountries || [];
    let pop = 0, dmg = 0;
    for (const m of members) {
      const nation = state.nationMap.get(m.country);
      if (!nation) continue;
      pop += nation?.rankings?.countryActivePopulation?.value || 0;
      dmg += nation?.rankings?.weeklyCountryDamages?.value || 0;
    }
    return { id: b.id, name: b.name, color: b.color, members: members.length, pop, dmg };
  }).filter(r => r.members > 0);

  if (!rows.length) return headerHtml(t('vo_alliances_title')) + emptyHtml(t('vo_no_data'));

  // Ordinate per danno settimanale, come il riepilogo delle sfere: è il
  // criterio che mette in cima chi conta davvero nella guerra in corso —
  // un blocco numeroso ma inattivo non è il primo titolo della vista.
  rows.sort((a, b) => b.dmg - a.dmg || b.members - a.members);
  const maxDmg = Math.max(...rows.map(r => r.dmg), 1);
  const totalMembers = rows.reduce((s, r) => s + r.members, 0);
  const totalDmg = rows.reduce((s, r) => s + r.dmg, 0);
  const totalPop = rows.reduce((s, r) => s + r.pop, 0);

  return headerHtml(t('vo_alliances_title'), rows.length)
    + `<div class="wp-panel-hint">${escapeHtml(t('vo_alliances_hint'))}</div>`
    + statsHtml([
      { label: t('vo_stat_nations_in_alliances'), value: fmt(totalMembers) },
      { label: t('vo_stat_active'), value: fmt(totalPop) },
      { label: t('vo_stat_week_damage'), value: fmt(totalDmg) },
      { label: t('vo_stat_alliances'), value: rows.length },
    ])
    + rows.map((r, i) => rowHtml({
      rank: i + 1,
      icon: `<span class="wp-vo-dot" style="background:${r.color}"></span>`,
      name: r.name,
      value: `💥 ${fmt(r.dmg)}`,
      sub: `${r.members} ${t('vo_nations')} · 👥 ${fmt(r.pop)}`,
      share: r.dmg / maxDmg,
      color: r.color,
      dataset: ` data-bloc-id="${r.id}"`,
    })).join('');
}

/* Le stesse righe del riepilogo alleanze, ma dai blocchi del builder. */
function builderPreviewAlliancesHtml() {
  const rows = state.builderPreview.blocs.slice().sort((a, b) => b.dmg - a.dmg || b.memberCount - a.memberCount);
  if (!rows.length) return headerHtml(t('vo_alliances_title')) + emptyHtml(t('vo_no_data'));
  const maxDmg = Math.max(...rows.map(r => r.dmg), 1);
  const totalMembers = rows.reduce((s, r) => s + r.memberCount, 0);
  const totalDmg = rows.reduce((s, r) => s + r.dmg, 0);
  const totalPop = rows.reduce((s, r) => s + r.pop, 0);
  return headerHtml(t('vo_alliances_title'), rows.length)
    + '<div class="wp-panel-hint">Alliance Builder preview — these blocs do not exist in game.</div>'
    + statsHtml([
      { label: t('vo_stat_nations_in_alliances'), value: fmt(totalMembers) },
      { label: t('vo_stat_active'), value: fmt(totalPop) },
      { label: t('vo_stat_week_damage'), value: fmt(totalDmg) },
      { label: t('vo_stat_alliances'), value: rows.length },
    ])
    + rows.map((r, i) => rowHtml({
      rank: i + 1,
      icon: `<span class="wp-vo-dot" style="background:${r.color}"></span>`,
      name: r.name,
      value: `💥 ${fmt(r.dmg)}`,
      sub: `${r.memberCount} ${t('vo_nations')} · 👥 ${fmt(r.pop)}`,
      share: r.dmg / maxDmg,
      color: r.color,
    })).join('');
}

// ══════════════════ CLASSIFICHE PER NAZIONE ══════════════════

/** Popolazione attiva e danno settimanale hanno la stessa forma: un numero
 *  per nazione, già in memoria. Cambia il campo, il colore e le etichette. */
function nationRankingHtml({ title, hint, field, colorFn, valuePrefix, statLabel }) {
  const entries = [];
  let min = Infinity, max = -Infinity;
  for (const [id, nation] of state.nationMap) {
    const v = nation?.rankings?.[field]?.value;
    if (typeof v === 'number' && v > 0) {
      entries.push({ id, nation, v });
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  if (!entries.length) return headerHtml(title) + emptyHtml(t('vo_no_data'));

  entries.sort((a, b) => b.v - a.v);
  const total = entries.reduce((s, e) => s + e.v, 0);

  return headerHtml(title, entries.length)
    + `<div class="wp-panel-hint">${escapeHtml(hint)}</div>`
    + statsHtml([
      { label: statLabel, value: fmt(total) },
      { label: t('vo_stat_nations_ranked'), value: entries.length },
      { label: t('vo_stat_leader'), value: entries[0].nation.name || '—' },
      { label: t('vo_stat_leader_share'), value: `${Math.round((entries[0].v / total) * 100)}%` },
    ])
    + entries.slice(0, TOP_NATIONS).map((e, i) => rowHtml({
      rank: i + 1,
      icon: flagImgHtml(e.id, e.nation, 'wp-vo-flag'),
      name: e.nation.name || '—',
      value: `${valuePrefix} ${fmt(e.v)}`,
      sub: `${((e.v / total) * 100).toFixed(1)}%`,
      share: e.v / entries[0].v,
      color: colorFn(e.v, min, max),
      dataset: ` data-nation-id="${e.id}"`,
    })).join('')
    + (entries.length > TOP_NATIONS
      ? `<div class="wp-vo-more">${escapeHtml(t('vo_more', { n: entries.length - TOP_NATIONS }))}</div>`
      : '');
}

// ══════════════════ CLASSIFICHE PER REGIONE ══════════════════

function regionRankingHtml({ title, about, ranked, stats, valueLabel, unavailable }) {
  if (unavailable) return headerHtml(title) + aboutHtml(about) + emptyHtml(unavailable);
  if (!ranked.length) return headerHtml(title) + aboutHtml(about) + emptyHtml(t('vo_loading'));

  const top = ranked[0].value || 1;
  return headerHtml(title, stats.regions)
    + aboutHtml(about)
    + statsHtml(stats.cells)
    + ranked.map((r, i) => {
      const { name, owner } = regionLabel(r.regionId);
      return rowHtml({
        rank: i + 1,
        icon: owner ? flagImgHtml(owner._id, owner, 'wp-vo-flag') : '<span class="wp-vo-dot" style="background:#30363d"></span>',
        name,
        value: `${fmt(r.value)} ${valueLabel}`,
        sub: owner?.name || '',
        share: r.value / top,
        color: r.color,
        dataset: owner ? ` data-nation-id="${owner._id}"` : '',
      });
    }).join('');
}

// ══════════════════ GUERRA vs ECO ══════════════════

/** Qui la classifica ha due estremi, non uno: la vista è bipolare (rosso
 *  guerra ↔ verde economia) e mostrare solo la coda guerrafondaia
 *  racconterebbe metà storia. Da qui i due elenchi affiancati. */
function playstyleHtml() {
  const title = t('vo_playstyle_title');
  const about = t('vo_playstyle_about');
  const trendOn = !!state.playstyleTrendMode;
  const head = headerHtml(title) + aboutHtml(about) + playstyleToggleHtml(trendOn);

  // Seconda lettura della stessa vista: la variazione a 7 giorni. Il toggle
  // resta in cima, così si torna indietro da dove si è partiti.
  if (trendOn) return head + playstyleTrendBodyHtml();

  const byCountry = state.nationPlaystyle;
  if (!byCountry) return head + emptyHtml(t('vo_loading'));

  // Stessa scala della mappa (shrinkage + distanza dalla media mondiale,
  // vedi playstyleHeatmap.js): l'elenco deve ordinare e colorare come il
  // territorio, non con la percentuale grezza che la mappa non usa più.
  const scale = buildPlaystyleScale(byCountry);
  const rows = [];
  for (const r of scale.all) {
    const nation = state.nationMap.get(r.countryId);
    if (!nation) continue;
    const entry = byCountry[r.countryId];
    rows.push({ countryId: r.countryId, nation, balance: r.z, entry, known: r.known });
  }
  if (!rows.length) return head + emptyHtml(t('vo_no_data'));

  rows.sort((a, b) => b.balance - a.balance);
  const stats = getPlaystyleStats(byCountry);

  const row = (r, i) => {
    const warPct = Math.round(((r.entry.war || 0) / r.known) * 100);
    const ecoPct = Math.round(((r.entry.eco || 0) / r.known) * 100);
    return rowHtml({
      rank: i + 1,
      icon: flagImgHtml(r.countryId, r.nation, 'wp-vo-flag'),
      name: r.nation.name || '—',
      value: `${warPct}% / ${ecoPct}%`,
      sub: t('vo_sampled', { n: r.known }),
      // La barra qui non è "quanto è grande" ma "quanto pende": lo zero
      // sta a metà, quindi si normalizza |balance| su tutta la larghezza.
      share: Math.abs(r.balance),
      color: getBalanceColor(r.balance),
      dataset: ` data-nation-id="${r.countryId}"`,
    });
  };

  const war = rows.slice(0, TOP_PLAYSTYLE);
  const eco = rows.slice().reverse().slice(0, TOP_PLAYSTYLE).filter(r => !war.includes(r));

  return head
    + statsHtml([
      { label: t('vo_stat_war_leaning'), value: stats.warLeaning },
      { label: t('vo_stat_balanced'), value: stats.balanced },
      { label: t('vo_stat_eco_leaning'), value: stats.ecoLeaning },
      { label: t('vo_stat_small_sample'), value: stats.skipped },
    ])
    + `<div class="wp-panel-section-title">${escapeHtml(t('vo_most_war'))}</div>`
    + war.map(row).join('')
    + (eco.length ? `<div class="wp-panel-section-title">${escapeHtml(t('vo_most_eco'))}</div>` + eco.map(row).join('') : '');
}

/* ── Variazione 7 giorni ──
   Non è una vista a parte: è la seconda lettura della STESSA vista Guerra
   vs Eco, scambiata dal toggle qui sotto. La mappa cambia insieme al
   riepilogo (state.playstyleTrendMode, letto da map.js e dalla legenda).

   Solo in questa lettura compare la spiegazione del conto: com'è fatta la
   heatmap non è ovvio (percentile, campione, attenuazione), mentre "sette
   giorni fa contro oggi" si capisce da sé. */
function playstyleToggleHtml(trendOn) {
  const btn = (mode, label, on) =>
    `<button type="button" class="wp-vo-toggle-btn${on ? ' on' : ''}" data-vo-playstyle-mode="${mode}">${escapeHtml(label)}</button>`;
  return `<div class="wp-vo-toggle">`
    + btn('now', t('vo_trend_toggle_now'), !trendOn)
    + btn('trend', t('vo_trend_toggle_shift'), trendOn)
    + `</div>`;
}

function howHtml(lines) {
  return `<div class="wp-vo-about"><ol class="wp-vo-how">`
    + lines.map(l => `<li>${escapeHtml(l)}</li>`).join('')
    + `</ol></div>`;
}

/** Slider dei giorni: l'estremo destro del confronto è sempre adesso,
 *  questo sposta quello sinistro. Da 1 (ieri) a 7 (settimana scorsa). */
function trendDaysSliderHtml(days) {
  return `
    <div class="wp-vo-days">
      <input type="range" min="1" max="7" step="1" value="${days}" id="wp-vo-days" class="wp-vo-days-range">
      <div class="wp-vo-days-ends">
        <span>${escapeHtml(t('vo_trend_end_yesterday'))}</span>
        <span id="wp-vo-days-label" class="wp-vo-days-label">${escapeHtml(trendDaysLabel(days))}</span>
        <span>${escapeHtml(t('vo_trend_end_week'))}</span>
      </div>
    </div>`;
}

export function trendDaysLabel(days) {
  return days === 1 ? t('vo_trend_vs_yesterday') : t('vo_trend_vs_days', { n: days });
}

function playstyleTrendBodyHtml() {
  const trend = state.playstyleTrend;
  const days = state.playstyleTrendDays || 7;
  const head = trendDaysSliderHtml(days)
    + howHtml([t('vo_trend_how_1'), t('vo_trend_how_2'), t('vo_trend_how_3'), t('vo_trend_how_4')]);
  if (!trend) return head + emptyHtml(t('vo_loading'));

  const stats = getTrendStats(trend);
  if (!stats.covered) return head + emptyHtml(state.playstyleTrendError || t('vo_no_data'));

  const rows = trend.rows
    .map(r => ({ r, nation: state.nationMap.get(r.countryId) }))
    .filter(x => x.nation)
    .sort((a, b) => b.r.delta - a.r.delta);

  const row = ({ r, nation }, i) => {
    // I punti sono la differenza fra i due equilibri per 100: leggibile
    // ("+18 punti") e indipendente dalla dimensione del campione.
    const pts = Math.round(r.delta * 100);
    const pctNow = Math.round(((r.balNow + 1) / 2) * 100);
    return rowHtml({
      rank: i + 1,
      icon: flagImgHtml(r.countryId, nation, 'wp-vo-flag'),
      name: nation.name || '—',
      value: `${pts > 0 ? '+' : ''}${pts} ${t('vo_trend_points')}`,
      sub: t('vo_trend_sub', { war: pctNow, n: r.knownNow }),
      share: Math.abs(r.z),
      color: getTrendColor(r.z),
      dataset: ` data-nation-id="${r.countryId}"`,
    });
  };

  const toWar = rows.slice(0, TOP_PLAYSTYLE);
  const toEco = rows.slice().reverse().slice(0, TOP_PLAYSTYLE).filter(x => !toWar.includes(x));

  return head
    + statsHtml([
      { label: t('vo_trend_stat_to_war'), value: stats.toWar },
      { label: t('vo_trend_stat_steady'), value: stats.still },
      { label: t('vo_trend_stat_to_eco'), value: stats.toEco },
      { label: t('vo_trend_stat_days'), value: stats.spanDays },
    ])
    + `<div class="wp-panel-section-title">${escapeHtml(t('vo_trend_most_war'))}</div>`
    + toWar.map(row).join('')
    + (toEco.length ? `<div class="wp-panel-section-title">${escapeHtml(t('vo_trend_most_eco'))}</div>` + toEco.map(row).join('') : '');
}

// ══════════════════ BONUS PRODUZIONE ══════════════════

/** La classifica del bonus, con SOTTO ogni nazione quali risorse lo
 *  producono: "+25%" da solo non dice se sono cinque risorse diverse o una
 *  sola in cinque regioni, e sono due situazioni diverse (la seconda si
 *  perde tutta insieme se cade quella regione). Il conto per risorsa in
 *  fondo dice invece quanto è rara ciascuna nel mondo. */
function productionHtml() {
  const title = t('vo_production_title');
  const about = t('vo_production_about');
  const rows = productionRankedList(TOP_NATIONS);
  if (!rows.length) return headerHtml(title) + aboutHtml(about) + emptyHtml(t('vo_no_data'));

  const s = getProductionStats();
  const top = rows[0].bonus || 1;
  const deposits = activeDeposits();
  const depByCountry = depositsByCountry();
  const worldSpread = RESOURCE_TYPES
    .map(r => `${r.icon} ${s.byResource[r.key] || 0}`)
    .join('  ');

  return headerHtml(title, s.withBonus)
    + aboutHtml(about)
    + statsHtml([
      { label: t('vo_stat_nations_with_bonus'), value: fmt(s.withBonus) },
      { label: t('vo_stat_nations_without_bonus'), value: fmt(s.without) },
      { label: t('vo_stat_best_bonus'), value: `+${s.best}%` },
      { label: t('vo_stat_ethic_nations'), value: s.ethicsLoaded ? fmt(s.withEthic) : '…' },
    ])
    + rows.map((r, i) => rowHtml({
      rank: i + 1,
      icon: flagImgHtml(r.id, r.nation, 'wp-vo-flag'),
      name: r.nation.name || '—',
      value: `+${r.bonus}%`,
      // Una risorsa per icona, col numero solo quando le regioni sono più
      // di una: "⚫💎 ☢️2" si legge, "⚫1 💎1 ☢️2" no.
      // Icone delle risorse fisse + i giacimenti a tempo attivi in casa
      // (⛏), che sono l'altro bonus alla produzione ma dura pochi giorni.
      // Sotto il totale, da cosa è fatto: risorse (icone) + etica
      // industrialista (⚙ +30 sull'item specializzato) + giacimenti a
      // tempo attivi in casa (⛏). Il numero grande è la somma.
      sub: [
        r.types.map(x => `${x.icon}${x.regions > 1 ? x.regions : ''}`).join(' '),
        r.ethic ? `⚙+${r.ethic}${r.specializedItem ? ` ${r.specializedItem}` : ''}` : '',
        depByCountry.get(r.id) ? `⛏${depByCountry.get(r.id)}` : '',
      ].filter(Boolean).join('  '),
      share: r.bonus / top,
      color: getProductionColor(r.bonus),
      dataset: ` data-nation-id="${r.id}"`,
    })).join('')
    + `<div class="wp-vo-more">${escapeHtml(t('vo_production_world', { n: s.regions }))} ${worldSpread}`
      + (s.ethicsLoaded ? '' : ` · ${escapeHtml(t('vo_production_ethics_loading'))}`)
      + '</div>'
    + depositsHtml(deposits);
}

// ══════════════════ ELEZIONI (WarEra+) ══════════════════

/* Il calendario del mondo: prima dove si vota (in ordine di chiusura),
   poi dove si raccolgono le candidature (in ordine di apertura del voto).
   Una riga apre la situazione politica di quella nazione, non il pannello
   nazione: è la domanda naturale davanti a un'elezione. */
function _politicsLeft(ms) {
  if (ms <= 0) return '0m';
  const h = Math.floor(ms / 36e5), m = Math.floor((ms % 36e5) / 6e4);
  if (h >= 48) return `${Math.round(h / 24)}d`;
  return h ? `${h}h ${m}m` : `${m}m`;
}

function politicsHtml() {
  const title = t('vo_politics_title');
  if (!state.openElections) {
    return headerHtml(title) + aboutHtml(t('vo_politics_about'))
      + emptyHtml(state.openElectionsError ? t('vo_politics_unavailable') : t('vo_loading'));
  }
  const rows = openElectionRows();
  const s = getPoliticsStats();
  const now = Date.now();
  const head = headerHtml(title, rows.length) + aboutHtml(t('vo_politics_about'))
    + statsHtml([
      { label: t('vo_stat_voting'), value: fmt(s.voting) },
      { label: t('vo_stat_candidacy'), value: fmt(s.candidacy) },
      { label: t('vo_stat_avg_turnout'), value: s.avgTurnout != null ? `${Math.round(s.avgTurnout * 100)}%` : '—' },
      { label: t('vo_stat_votes_cast'), value: fmt(s.votes) },
    ]);
  if (!rows.length) return head + emptyHtml(t('vo_politics_empty'));
  // Prima chi vota, dal più partecipato: la barra è l'affluenza (su scala
  // 0–100%), con la stessa tinta della nazione sulla mappa. Le
  // candidature restano in fondo, nell'ordine di apertura del voto.
  rows.sort((a, b) => (a.phase === b.phase ? 0 : a.phase === 'voting' ? -1 : 1)
    || (a.phase === 'voting' ? (b.turnout ?? -1) - (a.turnout ?? -1) : 0));
  return head + rows.map((r, i) => rowHtml({
    rank: i + 1,
    icon: r.nation ? flagImgHtml(r.countryId, r.nation, 'wp-vo-flag') : '',
    name: r.nation?.name || '—',
    value: r.phase === 'voting'
      ? (r.turnout != null ? `${Math.round(r.turnout * 100)}% · ` : '') + t('vo_votes_n', { n: fmt(r.votes) })
      : t('vo_cand_n', { n: fmt(r.candidates) }),
    sub: `${r.type === 'president' ? t('vo_pres') : t('vo_cong')} · ${r.phase === 'voting'
      ? t('vo_closes', { t: _politicsLeft((r.end || 0) - now) })
      : t('vo_opens', { t: _politicsLeft((r.start || 0) - now) })}`,
    share: r.phase === 'voting' ? (r.turnout ?? 0) : 0.04,
    color: r.phase === 'voting' ? turnoutColor(r.turnout) : POLITICS_COLORS[r.phase],
    dataset: ` data-vo-political="${escapeHtml(r.countryId)}"`,
  })).join('');
}

/* ══════════════════ MIGRAZIONI ══════════════════
   Il markup della vista Migrazioni (dato, colori e frecce stanno in
   diplomacy/migrationFlows.js, i comandi li collega wireMigrationOverview).
   Due livelli: il MONDO (chi guadagna, chi perde, i flussi più grossi) e
   la NAZIONE cliccata (dove vanno i suoi, da dove arrivano gli altri).
   Le righe mettono a fuoco una nazione, non aprono il suo pannello: per
   quello c'è il bottone in fondo, che porta all'elenco per nome. */

const DAY_MS = 24 * 60 * 60 * 1000;

function migSigned(v, metric) {
  if (v == null) return '—';
  const abs = Math.abs(v);
  const txt = metric === 'rate' ? abs.toFixed(abs >= 10 ? 0 : 1) : fmt(abs);
  return v > 0 ? `+${txt}` : v < 0 ? `−${txt}` : '0';
}

function migSegHtml(label, attr, options, current) {
  return `
    <div class="wp-mig-seg" role="group" aria-label="${escapeHtml(label)}">
      <span class="wp-mig-seg-label">${escapeHtml(label)}</span>
      ${options.map(([v, text]) => `<button type="button" class="wp-travel-btn" data-${attr}="${v}" aria-pressed="${String(v) === String(current)}">${escapeHtml(text)}</button>`).join('')}
    </div>`;
}

/** Le fasce di onestà: archivio più giovane della finestra, e chi resta
 *  fuori dal conto. Un elenco filtrato che non lo dice sembra completo. */
function migNotesHtml(d) {
  let html = '';
  const windowStart = (d.fetchedAt || Date.now()) - d.days * DAY_MS;
  if (d.coverageFrom && d.coverageFrom > windowStart) {
    html += `<div class="wp-mig-note">${escapeHtml(mT('The archive has been watching since {date}: moves before then do not show up, so this window is not full yet.', {
      date: new Date(d.coverageFrom).toLocaleDateString(),
    }))}</div>`;
  }
  const tot = d.totals || {};
  if (tot.lowLevel || tot.inactive) {
    html += `<div class="wp-mig-note">${escapeHtml(mT('Left out: {low} below level {lv}, {inactive} who only went inactive.', {
      low: fmt(tot.lowLevel || 0), lv: d.minLevel || 10, inactive: fmt(tot.inactive || 0),
    }))}</div>`;
  }
  return html;
}

function migrationHtml() {
  const s = mig();
  const d = s.data;
  const controls = migSegHtml(mT('Window'), 'mig-days',
    MIGRATION_DAYS.map(n => [n, n === 1 ? mT('24 hours') : mT('{n} days', { n })]), s.days);
  const about = aboutHtml(mT('Who changed citizenship. The game does not publish it: it is worked out by comparing every nation\'s citizen list hour by hour. Only players of level {lv}+ (or with prestige) count, and a player who simply went inactive is not a departure.', { lv: d?.minLevel || 10 }));

  if (!d || d.days !== s.days) {
    const msg = s.loading || !s.error ? mT('Loading…')
      : s.error === 'missing' ? mT('Migration data is not available yet (cache server not updated).')
        : mT('Cache server unreachable right now — reopen this view to retry.');
    return headerHtml(mT('Migration')) + controls + emptyHtml(msg) + about;
  }
  if (s.focus) return migrationFocusHtml(s, d, controls);

  const st = getMigrationStats();
  const { gaining, losing, flows } = migrationRanking(10);
  const metric = s.metric;
  const metricSeg = migSegHtml(mT('Colour by'), 'mig-metric',
    [['net', mT('Net')], ['rate', mT('Per 100 citizens')]], metric);
  const hint = `<div class="wp-mig-hint">${escapeHtml(migrationCanHover()
    ? mT('Click a nation to see where its players are going.')
    : mT('Tap a nation to see where its players are going.'))}</div>`;

  const maxAbs = Math.max(1e-9, ...[...gaining, ...losing].map(r => Math.abs(r.value)));
  const nationRow = (r, i) => {
    const nation = state.nationMap.get(r.id);
    const sub = mT('in {i} · out {o}', { i: fmt(r.in), o: fmt(r.out) })
      + (metric === 'rate' ? ` · ${migSigned(r.net, 'net')}` : '');
    return rowHtml({
      rank: i + 1,
      icon: nation ? flagImgHtml(r.id, nation, 'wp-vo-flag') : '',
      name: nation?.name || '—',
      value: migSigned(r.value, metric),
      sub,
      share: Math.abs(r.value) / maxAbs,
      color: migrationColor(r.value),
      dataset: ` data-mig-country="${escapeHtml(r.id)}"`,
    });
  };
  const maxFlow = Math.max(1, ...flows.map(f => f.n));
  const flowRows = flows.map((f, i) => {
    const a = state.nationMap.get(f.f), b = state.nationMap.get(f.t);
    return rowHtml({
      rank: i + 1,
      icon: a ? flagImgHtml(f.f, a, 'wp-vo-flag') : '',
      name: `${a?.name || '—'} → ${b?.name || '—'}`,
      value: fmt(f.n),
      share: f.n / maxFlow,
      color: OUT_COLOR,
      dataset: ` data-mig-country="${escapeHtml(f.f)}"`,
    });
  }).join('');

  const section = (title, body) => body
    ? `<div class="wp-panel-section-title wp-mig-title">${escapeHtml(title)}</div>${body}` : '';

  return headerHtml(mT('Migration'), s.days === 1 ? mT('24 hours') : mT('{n} days', { n: s.days }))
    + controls + metricSeg
    + statsHtml([
      { label: mT('Moves'), value: fmt(st.moves) },
      { label: mT('Players'), value: fmt(st.people) },
      { label: mT('Nations gaining'), value: fmt(st.gaining) },
      { label: mT('Nations losing'), value: fmt(st.losing) },
    ])
    + hint
    + migNotesHtml(d)
    + (st.moves
      ? section(mT('Gaining players'), gaining.map(nationRow).join(''))
        + section(mT('Losing players'), losing.map(nationRow).join(''))
        + section(mT('Biggest flows'), flowRows)
      : emptyHtml(mT('No moves recorded in this window.')))
    + about;
}

function migrationFocusHtml(s, d, controls) {
  const id = s.focus;
  const nation = state.nationMap.get(id);
  const { out, in: inn, country } = focusFlows(id);
  const c = country || { in: 0, out: 0, net: 0, citizens: 0 };
  const rate = migrationValue(c, 'rate');
  const dirSeg = migSegHtml(mT('Arrows'), 'mig-dir',
    [['out', mT('Departures')], ['in', mT('Arrivals')], ['both', mT('Both')]], s.dir);

  const partnerRows = (list, total, color, shareKey) => {
    const max = Math.max(1, ...list.map(r => r.n));
    return list.slice(0, TOP_NATIONS).map((r, i) => {
      const n = state.nationMap.get(r.id);
      return rowHtml({
        rank: i + 1,
        icon: n ? flagImgHtml(r.id, n, 'wp-vo-flag') : '',
        name: n?.name || '—',
        value: fmt(r.n),
        sub: mT(shareKey, { p: Math.round(r.n / Math.max(1, total) * 100) }),
        share: r.n / max,
        color,
        dataset: ` data-mig-country="${escapeHtml(r.id)}"`,
      });
    }).join('');
  };

  const flag = nation ? flagImgHtml(id, nation, 'wp-vo-flag') : '';
  const body = (out.length || inn.length)
    ? (out.length ? `<div class="wp-panel-section-title wp-mig-title"><span class="wp-mig-swatch" style="background:${OUT_COLOR}"></span>${escapeHtml(mT('Where they go'))}</div>`
        + partnerRows(out, c.out, OUT_COLOR, '{p}% of departures') : '')
      + (inn.length ? `<div class="wp-panel-section-title wp-mig-title"><span class="wp-mig-swatch" style="background:${IN_COLOR}"></span>${escapeHtml(mT('Where they come from'))}</div>`
        + partnerRows(inn, c.in, IN_COLOR, '{p}% of arrivals') : '')
    : emptyHtml(mT('Nobody left or arrived in this window.'));

  return `<button class="wp-sphere-back" type="button" data-mig-action="unfocus">${escapeHtml(mT('← All nations'))}</button>`
    + `<div class="wp-panel-header"><div><div class="wp-panel-name wp-mig-name">${flag}${escapeHtml(nation?.name || '—')}</div></div></div>`
    + controls + dirSeg
    + statsHtml([
      { label: mT('Arrived'), value: fmt(c.in) },
      { label: mT('Left'), value: fmt(c.out) },
      { label: mT('Balance'), value: migSigned(c.net, 'net') },
      { label: mT('Per 100 citizens'), value: c.citizens >= MIN_RATE_CITIZENS ? migSigned(rate, 'rate') : '—' },
    ])
    + migNotesHtml(d)
    + body
    + `<button type="button" class="wp-travel-btn wp-mig-open" data-mig-action="open-nation">${escapeHtml(mT('Players by name in the nation panel'))} ›</button>`;
}

/* I GIACIMENTI: l'altro bonus alla produzione, e l'unico che scade.
   `region.deposit` vale +30% su UN item in UNA regione per pochi giorni
   (vedi productionHeatmap.js), quindi la cosa che conta non è la
   classifica ma quanto manca: l'elenco è ordinato per scadenza. */
function depositsHtml(deposits) {
  if (!deposits.length) return '';
  const now = Date.now();
  const rows = deposits.slice(0, TOP_DEPOSITS).map(d => {
    const nation = d.countryId ? state.nationMap.get(d.countryId) : null;
    const hours = Math.max(0, Math.round((d.endsAt - now) / 3600000));
    const left = hours >= 24
      ? t('vo_deposit_days', { n: Math.floor(hours / 24) })
      : t('vo_deposit_hours', { n: hours });
    return rowHtml({
      rank: '⛏',
      icon: nation ? flagImgHtml(d.countryId, nation, 'wp-vo-flag') : '<span class="wp-vo-dot" style="background:#30363d"></span>',
      name: `${d.name} · ${d.type}`,
      value: `+${d.bonusPercent}%`,
      sub: `${nation?.name || '—'} · ${left}`,
      // Barra = quanto ne resta sulla durata intera: si vede a colpo
      // d'occhio quali stanno per spegnersi.
      share: d.startsAt && d.endsAt > d.startsAt
        ? Math.max(0, Math.min(1, (d.endsAt - now) / (d.endsAt - d.startsAt)))
        : 0.5,
      color: '#e3b341',
      dataset: nation ? ` data-nation-id="${d.countryId}"` : '',
    });
  }).join('');

  return `<div class="wp-panel-section-title">${escapeHtml(t('vo_deposits_title'))} (${deposits.length})</div>`
    + `<div class="wp-vo-about">${escapeHtml(t('vo_deposits_about'))}</div>`
    + rows
    + (deposits.length > TOP_DEPOSITS
      ? `<div class="wp-vo-more">${escapeHtml(t('vo_more', { n: deposits.length - TOP_DEPOSITS }))}</div>`
      : '');
}

// ══════════════════ INGRESSO ══════════════════

/** @returns {string} markup del riepilogo, o stringa vuota se la vista non ne ha uno. */
export function buildViewOverviewHtml(mode) {
  if (mode === 'blocs') return alliancesHtml();

  if (mode === 'population') {
    return nationRankingHtml({
      title: t('vo_population_title'),
      hint: t('vo_population_hint'),
      field: 'countryActivePopulation',
      colorFn: getPopulationColor,
      valuePrefix: '👥',
      statLabel: t('vo_stat_world_active'),
    });
  }

  if (mode === 'weeklyDamage') {
    return nationRankingHtml({
      title: t('vo_damage_title'),
      hint: t('vo_damage_hint'),
      field: 'weeklyCountryDamages',
      colorFn: getDamageColor,
      valuePrefix: '💥',
      statLabel: t('vo_stat_world_week_damage'),
    });
  }

  if (mode === 'production') return productionHtml();

  if (mode === 'politics') return politicsHtml();

  // WarEra+ vista Distanze: tutto (numeri, giro delle casse, istogramma) sta
  // in travelDistance.js, che possiede anche lo stato della vista.
  if (mode === 'travel') return travelOverviewHtml();

  if (mode === 'migration') return migrationHtml();

  if (mode === 'contested') {
    const counts = state.contestedCounts;
    const s = counts ? getContestedStats(counts) : { regions: 0 };
    return regionRankingHtml({
      title: t('vo_contested_title'),
      about: t('vo_contested_about'),
      ranked: counts ? contestedRankedList(counts, TOP_REGIONS) : [],
      valueLabel: t('vo_handovers'),
      stats: {
        regions: s.regions,
        cells: [
          { label: t('vo_stat_regions_moved'), value: fmt(s.regions) },
          { label: t('vo_stat_total_handovers'), value: fmt(s.total) },
          { label: t('vo_stat_most_contested'), value: `${fmt(s.max)}×` },
          { label: t('vo_stat_median'), value: `${fmt(s.median)}×` },
        ],
      },
    });
  }

  if (mode === 'warIntensity') {
    const data = state.warIntensityData;
    const s = data ? getWarIntensityStats(data) : { regions: 0 };
    return regionRankingHtml({
      title: t('vo_warint_title'),
      about: t('vo_warint_about'),
      ranked: data ? warIntensityRankedList(data, TOP_REGIONS) : [],
      valueLabel: t('vo_damage_word'),
      unavailable: state.warIntensityError || null,
      stats: {
        regions: s.regions,
        cells: [
          { label: t('vo_stat_regions_fought'), value: fmt(s.regions) },
          { label: t('vo_stat_total_damage'), value: fmt(s.total) },
          { label: t('vo_stat_worst_region'), value: fmt(s.max) },
          { label: t('vo_stat_median'), value: fmt(s.median) },
        ],
      },
    });
  }

  if (mode === 'playstyle') return playstyleHtml();

  return '';
}
