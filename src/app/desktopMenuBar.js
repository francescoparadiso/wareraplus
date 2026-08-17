/* ══════════════════════════════════════════════════════════════
   WarEra+ — Barra menù desktop (TEST, desktop-only)
   ------------------------------------------------------------------
   Barra fissa SOPRA il ticker, estetica "dashboard militare": dark,
   compatta, icone flat (SVG currentColor) che si illuminano in
   hover/attivo. Menù a tendina senza bordi, apertura in hover. Search
   come command box (⌘K). Battaglie/Time machine come bottoni evidenti
   (contornati, rosso/ambra). Tema chiaro: variante "mappa antica".

   PURAMENTE ADDITIVO e reversibile. Tre tecniche a rischio minimo:
   1) DELEGA (.click() sui controlli originali) per modi, approfondimenti,
      battaglie, time machine — stato letto dalle classi che il codice
      Diplomacy già gestisce (MutationObserver).
   2) PROXY (checkbox nuove che pilotano quelle reali) per i 4 switch.
   3) RILOCAZIONE DOM reversibile per NAP e #wp-top-controls.

   Tutto gated su matchMedia('(min-width: 769px)'): sotto la soglia è
   display:none e i nodi rilocati tornano al loro posto → mobile identico.

   i18n: le etichette NUOVE della barra hanno un mini-dizionario locale
   (MB_DICT) invece di sporcare src/shared/i18n.js — così il test resta
   self-contained. Si ritraducono all'evento 'wareraplus:langchange'. Gli
   switch proxy usano invece le chiavi data-i18n condivise (già esistenti),
   tradotte da applyTranslations().
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { renderMap, setColoringMode } from '../diplomacy/map.js';
import { openPoliticalView, closePoliticalView } from './politicalOverlay.js';
import { trackEvent } from '../shared/analytics.js';
import { getLang } from '../shared/i18n.js';
import { getPinned, isPinned, togglePin } from './pins.js';

const FLAG_BASE = 'https://media.warera.io/images/flags';

// ══ i18n locale della barra ═══════════════════════════════════════
const MB_DICT = {
  en: { views: 'Views', insights: 'Insights', settings: 'Settings', battles: 'Battles', timeMachine: 'Time machine', diplomacy: 'Diplomacy', alliances: 'Alliances', sphere: 'Sphere', damage: 'Weekly Dmg', population: 'Population', politics: 'Politics', allianceStats: 'Alliance stats', searchPh: 'Search nation or alliance…', groupNations: 'Nations', groupAlliances: 'Alliances', noResults: 'No results', favorites: 'Favorites', back: 'Back', noFavorites: 'No pinned items yet' },
  it: { views: 'Viste mappa', insights: 'Approfondimenti', settings: 'Impostazioni', battles: 'Battaglie', timeMachine: 'Time machine', diplomacy: 'Diplomazia', alliances: 'Alleanze', sphere: 'Sfera', damage: 'Danni Sett.', population: 'Popolazione', politics: 'Politica', allianceStats: 'Statistiche alleanze', searchPh: 'Cerca nazione o alleanza…', groupNations: 'Nazioni', groupAlliances: 'Alleanze', noResults: 'Nessun risultato', favorites: 'Preferiti', back: 'Indietro', noFavorites: 'Nessun elemento salvato' },
  es: { views: 'Vistas', insights: 'Análisis', settings: 'Ajustes', battles: 'Batallas', timeMachine: 'Time machine', diplomacy: 'Diplomacia', alliances: 'Alianzas', sphere: 'Esfera', damage: 'Daño Sem.', population: 'Población', politics: 'Política', allianceStats: 'Estadísticas de alianzas', searchPh: 'Buscar nación o alianza…', groupNations: 'Naciones', groupAlliances: 'Alianzas', noResults: 'Sin resultados', favorites: 'Favoritos', back: 'Atrás', noFavorites: 'Aún no hay elementos guardados' },
  de: { views: 'Ansichten', insights: 'Einblicke', settings: 'Einstellungen', battles: 'Schlachten', timeMachine: 'Zeitmaschine', diplomacy: 'Diplomatie', alliances: 'Bündnisse', sphere: 'Sphäre', damage: 'Wöch. Schaden', population: 'Bevölkerung', politics: 'Politik', allianceStats: 'Bündnisstatistiken', searchPh: 'Nation oder Bündnis suchen…', groupNations: 'Nationen', groupAlliances: 'Bündnisse', noResults: 'Keine Ergebnisse', favorites: 'Favoriten', back: 'Zurück', noFavorites: 'Noch nichts angeheftet' },
  fr: { views: 'Vues', insights: 'Analyses', settings: 'Paramètres', battles: 'Batailles', timeMachine: 'Time machine', diplomacy: 'Diplomatie', alliances: 'Alliances', sphere: 'Sphère', damage: 'Dégâts Hebdo.', population: 'Population', politics: 'Politique', allianceStats: 'Stats des alliances', searchPh: 'Rechercher nation ou alliance…', groupNations: 'Nations', groupAlliances: 'Alliances', noResults: 'Aucun résultat', favorites: 'Favoris', back: 'Retour', noFavorites: 'Aucun élément épinglé' },
  nl: { views: 'Weergaven', insights: 'Inzichten', settings: 'Instellingen', battles: 'Veldslagen', timeMachine: 'Tijdmachine', diplomacy: 'Diplomatie', alliances: 'Bondgenootschappen', sphere: 'Invloedssfeer', damage: 'Wekel. Schade', population: 'Bevolking', politics: 'Politiek', allianceStats: 'Alliantiestatistieken', searchPh: 'Zoek natie of alliantie…', groupNations: 'Naties', groupAlliances: 'Bondgenootschappen', noResults: 'Geen resultaten', favorites: 'Favorieten', back: 'Terug', noFavorites: 'Nog niets vastgezet' },
  sv: { views: 'Vyer', insights: 'Insikter', settings: 'Inställningar', battles: 'Strider', timeMachine: 'Tidsmaskin', diplomacy: 'Diplomati', alliances: 'Allianser', sphere: 'Sfär', damage: 'Veckoskada', population: 'Befolkning', politics: 'Politik', allianceStats: 'Alliansstatistik', searchPh: 'Sök nation eller allians…', groupNations: 'Nationer', groupAlliances: 'Allianser', noResults: 'Inga resultat', favorites: 'Favoriter', back: 'Tillbaka', noFavorites: 'Inget fäst ännu' },
  pt: { views: 'Vistas', insights: 'Análises', settings: 'Definições', battles: 'Batalhas', timeMachine: 'Máquina do tempo', diplomacy: 'Diplomacia', alliances: 'Alianças', sphere: 'Esfera', damage: 'Dano Sem.', population: 'População', politics: 'Política', allianceStats: 'Estatísticas de alianças', searchPh: 'Procurar nação ou aliança…', groupNations: 'Nações', groupAlliances: 'Alianças', noResults: 'Sem resultados', favorites: 'Favoritos', back: 'Voltar', noFavorites: 'Nada fixado ainda' },
  ar: { views: 'العروض', insights: 'رؤى', settings: 'الإعدادات', battles: 'المعارك', timeMachine: 'آلة الزمن', diplomacy: 'الدبلوماسية', alliances: 'التحالفات', sphere: 'النطاق', damage: 'الضرر الأسبوعي', population: 'السكان', politics: 'السياسة', allianceStats: 'إحصاءات التحالفات', searchPh: 'ابحث عن دولة أو تحالف…', groupNations: 'الدول', groupAlliances: 'التحالفات', noResults: 'لا نتائج', favorites: 'المفضلة', back: 'رجوع', noFavorites: 'لا عناصر مثبتة بعد' },
};
function mbT(key) {
  return MB_DICT[getLang()]?.[key] ?? MB_DICT.en[key] ?? key;
}
// Registri {span/el, key} per ritradurre al cambio lingua.
const i18nRegistry = [];
const i18nTitles = [];
function regSpan(key) {
  const s = document.createElement('span');
  s.textContent = mbT(key);
  i18nRegistry.push({ el: s, key });
  return s;
}
function translateBar() {
  i18nRegistry.forEach(({ el, key }) => { el.textContent = mbT(key); });
  i18nTitles.forEach(({ el, key }) => { el.title = mbT(key); });
  if (searchInput) searchInput.placeholder = mbT('searchPh');
}

// ---- Rilocazione DOM reversibile ---------------------------------
const relocStash = new Map();
function relocate(el, target) {
  if (!el || relocStash.has(el)) return;
  relocStash.set(el, { parent: el.parentNode, next: el.nextSibling, style: el.getAttribute('style') });
  el.removeAttribute('style');
  target.appendChild(el);
}
function restore(el) {
  const s = relocStash.get(el);
  if (!s) return;
  if (s.style != null) el.setAttribute('style', s.style); else el.removeAttribute('style');
  if (s.next && s.next.parentNode === s.parent) s.parent.insertBefore(el, s.next);
  else if (s.parent) s.parent.appendChild(el);
  relocStash.delete(el);
}

// ---- Helper DOM ---------------------------------------------------
function el(tag, cls, attrs = {}) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'text') n.textContent = v;
    else n.setAttribute(k, v);
  }
  return n;
}
function nationFlagCode(n) {
  const label = state.labelsData?.find(l => l.properties?.countryId === n._id);
  return (label?.properties?.countryCode || n.code || '').toLowerCase();
}

// ---- Icone flat (SVG, stroke=currentColor) -----------------------
const ICON_PATHS = {
  map: '<polygon points="1 6 8 3 16 6 23 3 23 18 16 21 8 18 1 21"/><line x1="8" y1="3" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="21"/>',
  insights: '<line x1="6" y1="20" x2="6" y2="15"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="18" y1="20" x2="18" y2="10"/>',
  settings: '<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>',
  swords: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="9" y2="18"/><line x1="7" y1="17" x2="4" y2="20"/><line x1="3" y1="19" x2="5" y2="21"/>',
  history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  caret: '<polyline points="6 9 12 15 18 9"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  flame: '<path d="M12 2c1 3.5 4 5 4 8.5a4 4 0 1 1-8 0c0-1.2.5-2 .5-2C9 11 10 11 10 11c0-2.5 1-4.5 2-6z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  landmark: '<polygon points="12 2 21 8 3 8 12 2"/><line x1="5" y1="10" x2="5" y2="18"/><line x1="10" y1="10" x2="10" y2="18"/><line x1="14" y1="10" x2="14" y2="18"/><line x1="19" y1="10" x2="19" y2="18"/><line x1="3" y1="21" x2="21" y2="21"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
};
function iconSvg(key, cls) {
  return `<svg${cls ? ` class="${cls}"` : ''} viewBox="0 0 24 24" aria-hidden="true">${ICON_PATHS[key] || ''}</svg>`;
}
function iconEl(key, cls) {
  const tmp = document.createElement('template');
  tmp.innerHTML = iconSvg(key, cls);
  return tmp.content.firstChild;
}

// Ultima nazione selezionata (fallback per "Politica").
let lastSelectedCountryId = null;

// ══════════════════════════════════════════════════════════════
// Costruzione barra
// ══════════════════════════════════════════════════════════════
let bar, settingsPanel, rightSlot;
let dropdowns = [];

export function initDesktopMenuBar() {
  if (document.querySelector('.wp-menubar')) return; // idempotente

  bar = el('nav', 'wp-menubar', { 'aria-label': 'WarEra+ menu bar' });

  // Ordine: brand · indietro · menù · preferiti · ricerca · [spazio] ·
  // Battaglie · gap · Time machine · [spazio] · cluster destro.
  bar.appendChild(buildBrand());
  bar.appendChild(buildBackButton());
  bar.appendChild(buildMapViewsDropdown());
  bar.appendChild(buildInsightsDropdown());
  bar.appendChild(buildSettingsDropdown());
  bar.appendChild(buildFavoritesDropdown());
  bar.appendChild(buildSearch());
  bar.appendChild(el('div', 'wp-mb-spacer'));
  bar.appendChild(buildBattlesButton());
  bar.appendChild(el('div', 'wp-mb-gap'));
  bar.appendChild(buildTimeMachineButton());
  bar.appendChild(el('div', 'wp-mb-spacer'));
  rightSlot = el('div', 'wp-mb-right');
  bar.appendChild(rightSlot);

  document.body.insertBefore(bar, document.body.firstChild);

  document.addEventListener('click', (e) => { if (!bar.contains(e.target)) closeAllDropdowns(); });

  setupModeSync();
  setupToggleMirror();
  setupSubviewWatch();
  translateBar();
  window.addEventListener('wareraplus:langchange', translateBar);
  window.addEventListener('wareraplus:pins-changed', () => { if (favoritesPanel) renderFavorites(favoritesPanel); });

  const mq = window.matchMedia('(min-width: 769px)');
  const apply = () => (mq.matches ? enterDesktop() : exitDesktop());
  mq.addEventListener('change', apply);
  apply();
}

// ---- Brand (logo + nome, in alto a sinistra) ---------------------
function buildBrand() {
  const brand = el('div', 'wp-mb-brand');
  const img = el('img', 'wp-mb-logo', { src: '/icons/logo-full.png', alt: '' });
  const name = el('span', 'wp-mb-brand-name', { text: 'WarEra+' });
  brand.appendChild(img);
  brand.appendChild(name);
  return brand;
}

// ---- Bottone "Indietro" (solo dentro Political/Statistiche) -------
function buildBackButton() {
  const btn = el('button', 'wp-mb-btn wp-mb-back', { type: 'button' });
  btn.appendChild(iconEl('back'));
  btn.appendChild(regSpan('back'));
  btn.addEventListener('click', closeAnySubview);
  return btn;
}
function isPoliticalOpen() {
  return document.getElementById('wp-political-overlay')?.classList.contains('open');
}
function isStatsOpen() {
  const p = document.getElementById('bloc-stats-page');
  return !!p && getComputedStyle(p).display !== 'none';
}
function closeAnySubview() {
  if (isPoliticalOpen()) closePoliticalView();
  if (isStatsOpen()) document.getElementById('bloc-stats-close')?.click();
  closeAllDropdowns();
}
// Marca <body> quando una sub-view è aperta → CSS mostra "Indietro" e
// spinge la vista sotto la barra.
function setupSubviewWatch() {
  const pol = document.getElementById('wp-political-overlay');
  const stats = document.getElementById('bloc-stats-page');
  const update = () => document.body.classList.toggle('wp-subview-open', isPoliticalOpen() || isStatsOpen());
  if (pol) new MutationObserver(update).observe(pol, { attributes: true, attributeFilter: ['class'] });
  if (stats) new MutationObserver(update).observe(stats, { attributes: true, attributeFilter: ['style'] });
  update();
}

// ---- Preferiti (dropdown, sempre accessibile) --------------------
let favoritesPanel;
function buildFavoritesDropdown() {
  const { root, panel } = makeDropdown('favorites', 'star', { iconOnly: true });
  favoritesPanel = panel;
  panel.classList.add('wp-mb-fav-panel');
  root.addEventListener('mouseenter', () => renderFavorites(panel));
  root.querySelector('.wp-mb-btn').addEventListener('click', () => renderFavorites(panel));
  renderFavorites(panel);
  return root;
}
function renderFavorites(panel) {
  panel.innerHTML = '';
  const { nation, alliance } = getPinned();
  if (!nation.length && !alliance.length) {
    panel.appendChild(el('div', 'wp-mb-res-empty', { text: mbT('noFavorites') }));
    return;
  }
  if (nation.length) {
    panel.appendChild(el('div', 'wp-mb-res-group', { text: mbT('groupNations') }));
    nation.forEach(id => {
      const n = state.nazioniGlobal?.find(x => x._id === id);
      if (n) panel.appendChild(favRow('nation', id, n.name, flagUrlForCode(nationFlagCode(n)), false));
    });
  }
  if (alliance.length) {
    panel.appendChild(el('div', 'wp-mb-res-group', { text: mbT('groupAlliances') }));
    alliance.forEach(id => {
      const a = state.allianceMap?.get(id);
      if (a) panel.appendChild(favRow('alliance', id, a.name, a.avatarUrl, true));
    });
  }
}
function favRow(type, id, name, imgSrc, isLogo) {
  const row = el('div', 'wp-mb-res-row wp-mb-fav-row');
  const img = el('img', `wp-mb-res-img${isLogo ? ' wp-mb-res-logo' : ''}`, { alt: '', loading: 'lazy' });
  if (imgSrc) img.src = imgSrc; else img.style.visibility = 'hidden';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  row.appendChild(img);
  row.appendChild(el('span', 'wp-mb-fav-name', { text: name }));
  // Bottone rimozione (spilla)
  const unpin = el('button', 'wp-mb-unpin', { type: 'button', title: 'Rimuovi', 'aria-label': 'Rimuovi' });
  unpin.textContent = '×';
  unpin.addEventListener('click', (e) => { e.stopPropagation(); togglePin(type, id); });
  row.appendChild(unpin);
  row.addEventListener('click', () => goToDetail(type, id));
  return row;
}
function flagUrlForCode(code) {
  return code ? `${FLAG_BASE}/${code}.svg?v=16` : '';
}
// Click su un preferito → apre il pannello di dettaglio (scelta utente).
function goToDetail(type, id) {
  closeAnySubview();
  if (type === 'nation') {
    state.selectedCountryId = id;
    lastSelectedCountryId = id;
    renderMap();
    const label = state.labelsData?.find(l => l.properties?.countryId === id);
    if (label && state.map) state.map.flyTo({ center: label.coordinates, zoom: Math.max(state.map.getZoom(), 3) });
    import('../panel/countryPanel.js').then(m => m.selectNationInPanel(id)).catch(() => {});
  } else {
    setColoringMode('blocs');
    state.selectedBlocId = id;
    renderMap();
    const bloc = state.externalBlocsInfo?.find(b => b.id === id);
    if (bloc && bloc.labelLng != null && state.map) state.map.flyTo({ center: [bloc.labelLng, bloc.labelLat], zoom: Math.max(state.map.getZoom(), 3) });
    import('../panel/countryPanel.js').then(m => m.selectBlocInPanel(id)).catch(() => {});
  }
  trackEvent('favorite-open', { type, id });
  closeAllDropdowns();
}

// ---- Viste mappa --------------------------------------------------
const MODES = [
  { btn: 'mode-diplomacy', key: 'diplomacy', icon: 'shield' },
  { btn: 'mode-blocs', key: 'alliances', icon: 'layers' },   // "Blocchi" → "Alleanze"
  { btn: 'mode-sphereOfInfluence', key: 'sphere', icon: 'target' },
  { btn: 'mode-weeklyDamage', key: 'damage', icon: 'flame' },
  { btn: 'mode-population', key: 'population', icon: 'users' },
];
let modeItems = [];

function buildMapViewsDropdown() {
  const { root, panel } = makeDropdown('views', 'map');
  modeItems = [];
  MODES.forEach(({ btn, key, icon }) => {
    const src = document.getElementById(btn);
    if (!src) return;
    const item = el('button', 'wp-mb-item', { type: 'button' });
    item.appendChild(iconEl(icon));
    item.appendChild(regSpan(key));
    item.addEventListener('click', () => { closeAnySubview(); src.click(); closeAllDropdowns(); });
    panel.appendChild(item);
    modeItems.push({ srcId: btn, item });
  });
  syncModeActive();
  return root;
}
function syncModeActive() {
  modeItems.forEach(({ srcId, item }) => {
    const src = document.getElementById(srcId);
    item.classList.toggle('active', !!src && src.classList.contains('active'));
  });
}
function setupModeSync() {
  const obs = new MutationObserver(syncModeActive);
  MODES.forEach(({ btn }) => {
    const src = document.getElementById(btn);
    if (src) obs.observe(src, { attributes: true, attributeFilter: ['class'] });
  });
}

// ---- Approfondimenti ---------------------------------------------
function buildInsightsDropdown() {
  const { root, panel } = makeDropdown('insights', 'insights');

  const politicaItem = el('button', 'wp-mb-item', { type: 'button' });
  politicaItem.appendChild(iconEl('landmark'));
  politicaItem.appendChild(regSpan('politics'));
  politicaItem.addEventListener('click', () => {
    if (isStatsOpen()) document.getElementById('bloc-stats-close')?.click();
    const id = state.selectedCountryId || lastSelectedCountryId;
    if (id) {
      state.selectedCountryId = id;
      lastSelectedCountryId = id;
      const nation = state.nazioniGlobal?.find(n => n._id === id);
      openPoliticalView(id, nation?.name || '');
      trackEvent('menubar-open-political', { countryId: id });
    } else {
      openPoliticalView(); // Political usa la sua nazione di default + selettore interno
      trackEvent('menubar-open-political', { countryId: null });
    }
    closeAllDropdowns();
  });
  panel.appendChild(politicaItem);

  const stats = el('button', 'wp-mb-item', { type: 'button' });
  stats.appendChild(iconEl('pie'));
  stats.appendChild(regSpan('allianceStats'));
  stats.addEventListener('click', () => { if (isPoliticalOpen()) closePoliticalView(); document.getElementById('bloc-stats-btn')?.click(); closeAllDropdowns(); });
  panel.appendChild(stats);

  root.addEventListener('mouseenter', rememberSelection);
  root.querySelector('.wp-mb-btn').addEventListener('click', rememberSelection);
  return root;
}
function rememberSelection() {
  if (state.selectedCountryId) lastSelectedCountryId = state.selectedCountryId;
}

// ---- Impostazioni (proxy switch + NAP rilocati) ------------------
// Gli switch usano le chiavi data-i18n CONDIVISE (già tradotte da
// applyTranslations): non passano da MB_DICT.
const SWITCHES = [
  { id: 'checkLabels', i18n: 'switch_show_names', fallback: 'Show Nation Names' },
  { id: 'wp-checkBlocLabels', i18n: 'switch_show_bloc_names', fallback: 'Show Alliance Names' },
  { id: 'checkActiveBattles', i18n: 'switch_active_battles', fallback: 'Active Battles' },
  { id: 'checkExcludeExternalNaps', i18n: 'switch_exclude_external_naps', fallback: 'Exclude External NAPs' },
];
function buildSettingsDropdown() {
  const { root, panel } = makeDropdown('settings', 'settings');
  panel.classList.add('wp-mb-settings-panel');
  settingsPanel = panel;

  SWITCHES.forEach(({ id, i18n, fallback }) => {
    const real = document.getElementById(id);
    if (!real) return;
    const row = el('label', 'wp-mb-proxy-switch');
    const span = el('span', null, { 'data-i18n': i18n });
    const realLabel = real.closest('.switch-container')?.querySelector('.switch-label');
    span.textContent = realLabel?.textContent || fallback;
    const cb = el('input', null, { type: 'checkbox' });
    cb.checked = real.checked;
    cb.addEventListener('change', () => {
      real.checked = cb.checked;
      real.dispatchEvent(new Event('change', { bubbles: true }));
    });
    real.addEventListener('change', () => { cb.checked = real.checked; });
    row.appendChild(span);
    row.appendChild(cb);
    panel.appendChild(row);
  });
  return root;
}

// ---- Battaglie / Time machine (delega + specchio stato) ----------
let battlesBtn, timeMachineBtn;
function buildBattlesButton() {
  battlesBtn = el('button', 'wp-mb-btn wp-mb-action wp-mb-battles', { type: 'button' });
  battlesBtn.appendChild(iconEl('swords'));
  battlesBtn.appendChild(regSpan('battles'));
  battlesBtn.addEventListener('click', () => document.getElementById('wp-battles-toggle-btn')?.click());
  return battlesBtn;
}
function buildTimeMachineButton() {
  timeMachineBtn = el('button', 'wp-mb-btn wp-mb-action wp-mb-timemachine', { type: 'button' });
  timeMachineBtn.appendChild(iconEl('history'));
  timeMachineBtn.appendChild(regSpan('timeMachine'));
  timeMachineBtn.addEventListener('click', () => document.getElementById('wp-time-machine-btn')?.click());
  return timeMachineBtn;
}
function setupToggleMirror() {
  const src1 = document.getElementById('wp-battles-toggle-btn');
  const src2 = document.getElementById('wp-time-machine-btn');
  const mirror = () => {
    if (src1 && battlesBtn) battlesBtn.classList.toggle('wp-mb-off', src1.classList.contains('wp-battles-hidden'));
    if (src2 && timeMachineBtn) timeMachineBtn.classList.toggle('wp-mb-active', src2.classList.contains('wp-time-machine-btn-active'));
  };
  const obs = new MutationObserver(mirror);
  if (src1) obs.observe(src1, { attributes: true, attributeFilter: ['class'] });
  if (src2) obs.observe(src2, { attributes: true, attributeFilter: ['class'] });
  mirror();
}

// ---- Ricerca (nazioni + alleanze, con bandiere/loghi) ------------
let searchWrap, searchInput, searchResults;
let currentRows = [];
let activeIdx = -1;

function buildSearch() {
  searchWrap = el('div', 'wp-mb-search');
  searchWrap.appendChild(iconEl('search', 'wp-mb-search-icon'));
  searchInput = el('input', 'wp-mb-search-input', { type: 'text', placeholder: mbT('searchPh'), autocomplete: 'off' });
  const isMac = /mac/i.test(navigator.platform || navigator.userAgent);
  const kbd = el('kbd', 'wp-mb-kbd', { text: isMac ? '⌘K' : 'Ctrl K' });
  searchResults = el('div', 'wp-mb-search-results');

  searchInput.addEventListener('input', () => renderResults(searchInput.value));
  searchInput.addEventListener('focus', () => { if (searchInput.value.trim()) renderResults(searchInput.value); });
  searchInput.addEventListener('keydown', onSearchKey);

  searchWrap.appendChild(searchInput);
  searchWrap.appendChild(kbd);
  searchWrap.appendChild(searchResults);

  document.addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
      e.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });
  return searchWrap;
}

function renderResults(query) {
  const q = query.trim().toLowerCase();
  currentRows = [];
  activeIdx = -1;
  searchResults.innerHTML = '';
  if (!q) { searchWrap.classList.remove('open'); return; }

  const rank = (name) => { const nl = name.toLowerCase(); if (nl === q) return 0; if (nl.startsWith(q)) return 1; return 2; };
  const byRelevance = (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);

  const nations = (state.nazioniGlobal || []).filter(n => n.name?.toLowerCase().includes(q)).sort(byRelevance).slice(0, 8);
  const alliances = (state.alliancesList || []).filter(a => a.name?.toLowerCase().includes(q)).sort(byRelevance).slice(0, 6);

  if (!nations.length && !alliances.length) {
    searchResults.appendChild(el('div', 'wp-mb-res-empty', { text: mbT('noResults') }));
    searchWrap.classList.add('open');
    return;
  }
  if (nations.length) {
    searchResults.appendChild(el('div', 'wp-mb-res-group', { text: mbT('groupNations') }));
    nations.forEach(n => searchResults.appendChild(makeNationRow(n)));
  }
  if (alliances.length) {
    searchResults.appendChild(el('div', 'wp-mb-res-group', { text: mbT('groupAlliances') }));
    alliances.forEach(a => searchResults.appendChild(makeAllianceRow(a)));
  }
  searchWrap.classList.add('open');
}

function makeNationRow(n) {
  const row = el('div', 'wp-mb-res-row');
  const code = nationFlagCode(n);
  const img = el('img', 'wp-mb-res-img', { alt: '', loading: 'lazy' });
  if (code) img.src = `${FLAG_BASE}/${code}.svg?v=16`;
  img.onerror = () => { img.style.visibility = 'hidden'; };
  row.appendChild(img);
  row.appendChild(el('span', 'wp-mb-fav-name', { text: n.name }));
  row.appendChild(pinToggle('nation', n._id));
  row.addEventListener('click', () => selectNation(n));
  currentRows.push(row);
  return row;
}
function makeAllianceRow(a) {
  const row = el('div', 'wp-mb-res-row');
  const img = el('img', 'wp-mb-res-img wp-mb-res-logo', { alt: '', loading: 'lazy' });
  if (a.avatarUrl) img.src = a.avatarUrl; else img.style.visibility = 'hidden';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  row.appendChild(img);
  row.appendChild(el('span', 'wp-mb-fav-name', { text: a.name }));
  row.appendChild(pinToggle('alliance', a._id));
  row.addEventListener('click', () => selectAlliance(a));
  currentRows.push(row);
  return row;
}
// Stella per pinnare/spinnare direttamente da un risultato di ricerca.
function pinToggle(type, id) {
  const btn = el('button', 'wp-mb-pin', { type: 'button', 'aria-label': 'Preferiti' });
  const paint = () => {
    const on = isPinned(type, id);
    btn.classList.toggle('pinned', on);
    btn.textContent = on ? '★' : '☆';
    btn.title = on ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti';
  };
  paint();
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePin(type, id);
    paint();
    trackEvent('pin-toggle', { type, id, pinned: isPinned(type, id), source: 'search' });
  });
  return btn;
}
function selectNation(n) {
  closeAnySubview();
  state.selectedCountryId = n._id;
  lastSelectedCountryId = n._id;
  renderMap();
  const label = state.labelsData?.find(l => l.properties?.countryId === n._id);
  if (label && state.map) state.map.flyTo({ center: label.coordinates, zoom: Math.max(state.map.getZoom(), 3) });
  trackEvent('search-nation', { query: n.name.toLowerCase(), found: true, source: 'menubar' });
  closeSearch(n.name);
}
function selectAlliance(a) {
  closeAnySubview();
  setColoringMode('blocs');
  state.selectedBlocId = a._id;
  renderMap();
  const bloc = state.externalBlocsInfo?.find(b => b.id === a._id);
  if (bloc && bloc.labelLng != null && state.map) state.map.flyTo({ center: [bloc.labelLng, bloc.labelLat], zoom: Math.max(state.map.getZoom(), 3) });
  import('../panel/countryPanel.js').then(m => m.selectBlocInPanel(a._id)).catch(() => {});
  trackEvent('search-alliance', { query: a.name.toLowerCase(), allianceId: a._id, source: 'menubar' });
  closeSearch(a.name);
}
function onSearchKey(e) {
  if (e.key === 'Escape') { closeSearch(); searchInput.blur(); return; }
  if (!currentRows.length) { if (e.key === 'Enter') renderResults(searchInput.value); return; }
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % currentRows.length; highlightActive(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + currentRows.length) % currentRows.length; highlightActive(); }
  else if (e.key === 'Enter') { e.preventDefault(); (currentRows[activeIdx] || currentRows[0]).click(); }
}
function highlightActive() {
  currentRows.forEach((r, i) => r.classList.toggle('wp-mb-res-active', i === activeIdx));
  currentRows[activeIdx]?.scrollIntoView({ block: 'nearest' });
}
function closeSearch(value) {
  if (typeof value === 'string') searchInput.value = value;
  searchWrap.classList.remove('open');
  searchResults.innerHTML = '';
  currentRows = [];
  activeIdx = -1;
}

// ---- Dropdown generico (apertura in hover) -----------------------
function makeDropdown(labelKey, iconKey, opts = {}) {
  const root = el('div', 'wp-mb-dropdown');
  const btn = el('button', `wp-mb-btn${opts.iconOnly ? ' wp-mb-icon-only' : ''}`, { type: 'button' });
  if (iconKey) btn.appendChild(iconEl(iconKey));
  if (opts.iconOnly) {
    btn.title = mbT(labelKey);
    i18nTitles.push({ el: btn, key: labelKey });
  } else {
    btn.appendChild(regSpan(labelKey));
  }
  btn.appendChild(iconEl('caret', 'wp-mb-caret'));
  const panel = el('div', 'wp-mb-panel');

  let closeTimer;
  const open = () => { clearTimeout(closeTimer); openOnly(root); };
  const scheduleClose = () => { closeTimer = setTimeout(() => root.classList.remove('open'), 140); };
  root.addEventListener('mouseenter', open);
  root.addEventListener('mouseleave', scheduleClose);
  btn.addEventListener('click', (e) => { e.stopPropagation(); open(); });

  root.appendChild(btn);
  root.appendChild(panel);
  dropdowns.push({ root, panel });
  return { root, panel };
}
function openOnly(target) {
  dropdowns.forEach(({ root }) => root.classList.toggle('open', root === target));
  if (searchWrap) closeSearch();
}
function closeAllDropdowns() {
  dropdowns.forEach(({ root }) => root.classList.remove('open'));
  if (searchWrap) closeSearch();
}

// ---- Layout responsive (relocazioni) -----------------------------
function enterDesktop() {
  relocate(document.getElementById('wp-top-controls'), rightSlot);
  const napManual = document.getElementById('napInput')?.closest('.menu-section');
  const napExternal = document.getElementById('externalNapToggle')?.closest('.menu-section');
  if (napManual) relocate(napManual, settingsPanel);
  if (napExternal) relocate(napExternal, settingsPanel);
}
function exitDesktop() {
  [...relocStash.keys()].forEach(restore);
}
