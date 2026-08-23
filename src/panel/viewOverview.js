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
import { playstyleBalance, getBalanceColor, getPlaystyleStats } from '../diplomacy/playstyleHeatmap.js';

/** Le viste che hanno un riepilogo. Chi chiama usa questo elenco per
 *  decidere se aprire il pannello: tenerlo qui evita che countryPanel.js
 *  e map.js abbiano due liste da tenere allineate a mano. */
export const OVERVIEW_MODES = ['blocs', 'population', 'weeklyDamage', 'contested', 'warIntensity', 'playstyle'];

export function hasViewOverview(mode) {
  return OVERVIEW_MODES.includes(mode);
}

/** Quante righe per classifica. Il pannello scorre, ma un elenco infinito
 *  smette di essere un riepilogo: per l'elenco completo ci sono
 *  Statistiche nazioni e Statistiche alleanze. */
const TOP_NATIONS = 20;
const TOP_REGIONS = 20;
const TOP_PLAYSTYLE = 10;

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
  const byCountry = state.nationPlaystyle;
  if (!byCountry) return headerHtml(title) + aboutHtml(about) + emptyHtml(t('vo_loading'));

  const rows = [];
  for (const [countryId, entry] of Object.entries(byCountry)) {
    const balance = playstyleBalance(entry);
    if (balance == null) continue;
    const nation = state.nationMap.get(countryId);
    if (!nation) continue;
    const known = (entry.war || 0) + (entry.eco || 0) + (entry.mixed || 0);
    rows.push({ countryId, nation, balance, entry, known });
  }
  if (!rows.length) return headerHtml(title) + aboutHtml(about) + emptyHtml(t('vo_no_data'));

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

  return headerHtml(title, stats.colored)
    + aboutHtml(about)
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
