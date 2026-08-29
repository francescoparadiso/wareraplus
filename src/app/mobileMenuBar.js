/* ══════════════════════════════════════════════════════════════
   WarEra+ — Barra menù MOBILE (≤768px)
   ------------------------------------------------------------------
   Equivalente mobile della barra desktop (src/app/desktopMenuBar.js):
   STESSI pattern, layout diverso. Tre superfici fisse:

     ┌ Top bar ───────────────────────────────┐
     │ [Logo]              [🔍]        [☰/←]   │
     ├ Drawer (da ☰) ─────────────────────────┤
     │ Lingua · Tema · Attuale/Originale       │ ← riga fissa (relocate)
     │ ▸ Viste mappa (aperto)                  │ ← accordion (delega)
     │ ▸ Approfondimenti                       │
     │ ▸ Impostazioni (switch proxy + NAP)     │
     │ ▸ Preferiti                             │
     ├ Bottom tab bar ────────────────────────┤
     │      ⚔️ Battaglie      🕐 Time machine  │ ← delega, 1 tap
     └─────────────────────────────────────────┘

   PURAMENTE ADDITIVO e reversibile, come il file desktop. Stesse tre
   tecniche a rischio minimo:
   1) DELEGA (.click() sui controlli originali #mode-*, battaglie, TM),
      stato letto via MutationObserver dalle classi che Diplomacy gestisce.
   2) PROXY (checkbox nuove che pilotano quelle reali) per i 4 switch.
   3) RILOCAZIONE DOM reversibile per #wp-top-controls e le sezioni NAP,
      con bersaglio il drawer invece di rightSlot.

   Gating: matchMedia('(max-width: 768px)') — l'inverso esatto del
   desktop (min-width:769px). Sopra la soglia è display:none e i nodi
   rilocati tornano al loro posto → desktop identico a prima.

   ⚠️ Nodi CONDIVISI col desktop (#wp-top-controls, sezioni NAP): i due
   file spostano gli stessi nodi. Il gating è mutuamente esclusivo, ma al
   passaggio LIVE della soglia (resize di una finestra desktop) i due
   'matchMedia change' scattano nello stesso task in ordine non garantito.
   Mitigazione lato mobile (non tocchiamo desktopMenuBar.js, vincolo):
     · la home ORIGINALE dei nodi condivisi è catturata UNA VOLTA all'init
       (mobile init gira PRIMA di desktop init in src/main.js), e il
       restore punta a quell'ancora fissa, non al parent transitorio;
     · enterMobile è differito in rAF, exitMobile è sincrono → su
       restringimento il desktop-exit gira prima.
   Resta un residuo teorico (desktop-enter che legge un nodo mobile durante
   un allargamento live): raro — i dispositivi restano nella loro classe.

   i18n: mini-dizionario locale MB_DICT (stesse chiavi/stringhe del file
   desktop, duplicate perché non esportate — mirror deliberato della scelta
   "self-contained" del desktop). Gli switch proxy usano invece le chiavi
   data-i18n condivise (già tradotte da applyTranslations).
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { renderMap, setColoringMode } from '../diplomacy/map.js';
import { openPoliticalView, closePoliticalView } from './politicalOverlay.js';
import { openEcoView, closeEcoView, isEcoViewOpen } from './ecoOverlay.js';
import { openMarketView, closeMarketView, isMarketViewOpen } from './marketOverlay.js';
import { openNewsView, closeNewsView, isNewsViewOpen } from './newsOverlay.js';
import { openMuView, closeMuView, isMuViewOpen } from './muOverlay.js';
import { openNationsView, closeNationsView, isNationsViewOpen } from './nationsOverlay.js';
import { openGuideView, closeGuideView, isGuideViewOpen } from './guideOverlay.js';
import { fetchMuDirectory, getCachedDirectory, getCachedMu } from '../mu/api.js';
import { trackEvent } from '../shared/analytics.js';
import { getLang } from '../shared/i18n.js';
import { getPinned, getMuPinMeta, isPinned, togglePin } from './pins.js';

const FLAG_BASE = 'https://media.warera.io/images/flags';

// ══ i18n locale (mirror del MB_DICT desktop) ══════════════════════
const MB_DICT = {
  en: { views: 'Views', insights: 'Insights', settings: 'Settings', battles: 'Battles', timeMachine: 'Time machine', diplomacy: 'Diplomacy', alliances: 'Alliances', sphere: 'Sphere', damage: 'Weekly Dmg', population: 'Population', production: 'Production', contested: 'Contested', warIntensity: 'War history', playstyle: 'War vs Eco', politics: 'Politics', allianceStats: 'Alliance stats', ecoOptimizer: 'Industrial Optimizer', market: 'Production yields', news: 'News', searchPh: 'Search nation or alliance…', groupNations: 'Nations', groupAlliances: 'Alliances', noResults: 'No results', favorites: 'Favorites', back: 'Back', muExplorer: 'Military Units', nationStats: 'Nation stats', howTo: 'How to use', groupMus: 'Military units', noFavorites: 'No pinned items yet', menu: 'Menu', search: 'Search' },
  it: { views: 'Viste mappa', insights: 'Approfondimenti', settings: 'Impostazioni', battles: 'Battaglie', timeMachine: 'Time machine', diplomacy: 'Diplomazia', alliances: 'Alleanze', sphere: 'Sfera', damage: 'Danni Sett.', population: 'Popolazione', production: 'Produzione', contested: 'Regioni contese', warIntensity: 'Storico bellico', playstyle: 'Guerra vs Eco', politics: 'Politica', allianceStats: 'Statistiche alleanze', ecoOptimizer: 'Ottimizzatore industriale', market: 'Rendite di produzione', news: 'News', searchPh: 'Cerca nazione o alleanza…', groupNations: 'Nazioni', groupAlliances: 'Alleanze', noResults: 'Nessun risultato', favorites: 'Preferiti', back: 'Indietro', muExplorer: 'Unità Militari', nationStats: 'Statistiche nazioni', howTo: 'Come si usa', groupMus: 'Unità militari', noFavorites: 'Nessun elemento salvato', menu: 'Menù', search: 'Cerca' },
  es: { views: 'Vistas', insights: 'Análisis', settings: 'Ajustes', battles: 'Batallas', timeMachine: 'Time machine', diplomacy: 'Diplomacia', alliances: 'Alianzas', sphere: 'Esfera', damage: 'Daño Sem.', population: 'Población', production: 'Producción', contested: 'Regiones disputadas', warIntensity: 'Histórico bélico', playstyle: 'Guerra vs Eco', politics: 'Política', allianceStats: 'Estadísticas de alianzas', ecoOptimizer: 'Optimizador industrial', market: 'Rendimientos de producción', news: 'News', searchPh: 'Buscar nación o alianza…', groupNations: 'Naciones', groupAlliances: 'Alianzas', noResults: 'Sin resultados', favorites: 'Favoritos', back: 'Atrás', muExplorer: 'Unidades Militares', nationStats: 'Estadísticas de naciones', howTo: 'Cómo se usa', groupMus: 'Unidades militares', noFavorites: 'Aún no hay elementos guardados', menu: 'Menú', search: 'Buscar' },
  de: { views: 'Ansichten', insights: 'Einblicke', settings: 'Einstellungen', battles: 'Schlachten', timeMachine: 'Zeitmaschine', diplomacy: 'Diplomatie', alliances: 'Bündnisse', sphere: 'Sphäre', damage: 'Wöch. Schaden', population: 'Bevölkerung', production: 'Produktion', contested: 'Umkämpfte Regionen', warIntensity: 'Kriegsgeschichte', playstyle: 'Krieg vs Eco', politics: 'Politik', allianceStats: 'Bündnisstatistiken', ecoOptimizer: 'Industrie-Optimierer', market: 'Produktionserträge', news: 'News', searchPh: 'Nation oder Bündnis suchen…', groupNations: 'Nationen', groupAlliances: 'Bündnisse', noResults: 'Keine Ergebnisse', favorites: 'Favoriten', back: 'Zurück', muExplorer: 'Militäreinheiten', nationStats: 'Nationsstatistiken', howTo: 'Anleitung', groupMus: 'Militäreinheiten', noFavorites: 'Noch nichts angeheftet', menu: 'Menü', search: 'Suchen' },
  fr: { views: 'Vues', insights: 'Analyses', settings: 'Paramètres', battles: 'Batailles', timeMachine: 'Time machine', diplomacy: 'Diplomatie', alliances: 'Alliances', sphere: 'Sphère', damage: 'Dégâts Hebdo.', population: 'Population', production: 'Production', contested: 'Régions disputées', warIntensity: 'Historique de guerre', playstyle: 'Guerre vs Éco', politics: 'Politique', allianceStats: 'Stats des alliances', ecoOptimizer: 'Optimiseur industriel', market: 'Rendements de production', news: 'News', searchPh: 'Rechercher nation ou alliance…', groupNations: 'Nations', groupAlliances: 'Alliances', noResults: 'Aucun résultat', favorites: 'Favoris', back: 'Retour', muExplorer: 'Unités Militaires', nationStats: 'Statistiques des nations', howTo: "Mode d'emploi", groupMus: 'Unités militaires', noFavorites: 'Aucun élément épinglé', menu: 'Menu', search: 'Rechercher' },
  nl: { views: 'Weergaven', insights: 'Inzichten', settings: 'Instellingen', battles: 'Veldslagen', timeMachine: 'Tijdmachine', diplomacy: 'Diplomatie', alliances: 'Bondgenootschappen', sphere: 'Invloedssfeer', damage: 'Wekel. Schade', population: 'Bevolking', production: 'Productie', contested: 'Betwiste regio’s', warIntensity: 'Oorlogsgeschiedenis', playstyle: 'Oorlog vs Eco', politics: 'Politiek', allianceStats: 'Alliantiestatistieken', ecoOptimizer: 'Industriële optimizer', market: 'Productieopbrengsten', news: 'News', searchPh: 'Zoek natie of alliantie…', groupNations: 'Naties', groupAlliances: 'Bondgenootschappen', noResults: 'Geen resultaten', favorites: 'Favorieten', back: 'Terug', muExplorer: 'Militaire Eenheden', nationStats: 'Natiestatistieken', howTo: 'Uitleg', groupMus: 'Militaire eenheden', noFavorites: 'Nog niets vastgezet', menu: 'Menu', search: 'Zoeken' },
  sv: { views: 'Vyer', insights: 'Insikter', settings: 'Inställningar', battles: 'Strider', timeMachine: 'Tidsmaskin', diplomacy: 'Diplomati', alliances: 'Allianser', sphere: 'Sfär', damage: 'Veckoskada', population: 'Befolkning', production: 'Produktion', contested: 'Omstridda regioner', warIntensity: 'Krigshistorik', playstyle: 'Krig vs Eco', politics: 'Politik', allianceStats: 'Alliansstatistik', ecoOptimizer: 'Industrioptimerare', market: 'Produktionsavkastning', news: 'News', searchPh: 'Sök nation eller allians…', groupNations: 'Nationer', groupAlliances: 'Allianser', noResults: 'Inga resultat', favorites: 'Favoriter', back: 'Tillbaka', muExplorer: 'Militära Enheter', nationStats: 'Nationsstatistik', howTo: 'Så funkar det', groupMus: 'Militära enheter', noFavorites: 'Inget fäst ännu', menu: 'Meny', search: 'Sök' },
  pt: { views: 'Vistas', insights: 'Análises', settings: 'Definições', battles: 'Batalhas', timeMachine: 'Máquina do tempo', diplomacy: 'Diplomacia', alliances: 'Alianças', sphere: 'Esfera', damage: 'Dano Sem.', population: 'População', production: 'Produção', contested: 'Regiões disputadas', warIntensity: 'Histórico bélico', playstyle: 'Guerra vs Eco', politics: 'Política', allianceStats: 'Estatísticas de alianças', ecoOptimizer: 'Otimizador industrial', market: 'Rendimentos de produção', news: 'News', searchPh: 'Procurar nação ou aliança…', groupNations: 'Nações', groupAlliances: 'Alianças', noResults: 'Sem resultados', favorites: 'Favoritos', back: 'Voltar', muExplorer: 'Unidades Militares', nationStats: 'Estatísticas das nações', howTo: 'Como usar', groupMus: 'Unidades militares', noFavorites: 'Nada fixado ainda', menu: 'Menu', search: 'Procurar' },
  ar: { views: 'العروض', insights: 'رؤى', settings: 'الإعدادات', battles: 'المعارك', timeMachine: 'آلة الزمن', diplomacy: 'الدبلوماسية', alliances: 'التحالفات', sphere: 'النطاق', damage: 'الضرر الأسبوعي', population: 'السكان', production: 'الإنتاج', contested: 'المناطق المتنازع عليها', warIntensity: 'تاريخ الحرب', playstyle: 'حرب مقابل اقتصاد', politics: 'السياسة', allianceStats: 'إحصاءات التحالفات', ecoOptimizer: 'مُحسِّن صناعي', market: 'عوائد الإنتاج', news: 'الأخبار', searchPh: 'ابحث عن دولة أو تحالف…', groupNations: 'الدول', groupAlliances: 'التحالفات', noResults: 'لا نتائج', favorites: 'المفضلة', back: 'رجوع', muExplorer: 'الوحدات العسكرية', nationStats: 'إحصاءات الدول', howTo: 'كيفية الاستخدام', groupMus: 'الوحدات العسكرية', noFavorites: 'لا عناصر مثبتة بعد', menu: 'القائمة', search: 'بحث' },
};
function mbT(key) {
  return MB_DICT[getLang()]?.[key] ?? MB_DICT.en[key] ?? key;
}
const i18nRegistry = [];
const i18nTitles = [];
function regSpan(key) {
  const s = document.createElement('span');
  s.textContent = mbT(key);
  i18nRegistry.push({ el: s, key });
  return s;
}
// Vedi desktopMenuBar: le label degli switch originali iniziano con
// un'emoji, che stona con le icone flat della barra. La togliamo nei proxy.
function stripLeadingEmoji(s) {
  return (s || '').replace(/^[\p{Extended_Pictographic}️‍\s]+/u, '').trim();
}
const proxyLabels = [];
function translateBar() {
  i18nRegistry.forEach(({ el, key }) => { el.textContent = mbT(key); });
  i18nTitles.forEach(({ el, key }) => { el.setAttribute('aria-label', mbT(key)); el.title = mbT(key); });
  proxyLabels.forEach(({ span, realLabel, fallback }) => {
    span.textContent = stripLeadingEmoji(realLabel?.textContent || fallback);
  });
  if (searchInput) searchInput.placeholder = mbT('searchPh');
}

// ---- Rilocazione DOM reversibile (home catturata all'init) --------
// A differenza del desktop (che stasha al momento del relocate), qui la
// home è catturata UNA VOLTA quando il DOM è ancora pristine (vedi header,
// nota nodi condivisi). restoreHome() punta sempre a quell'ancora fissa.
const originalHome = new Map();
function captureHome(el) {
  if (!el || originalHome.has(el)) return;
  originalHome.set(el, { parent: el.parentNode, next: el.nextSibling, style: el.getAttribute('style') });
}
function relocate(el, target) {
  if (!el || !target) return;
  captureHome(el); // no-op se già catturata all'init
  el.removeAttribute('style');
  target.appendChild(el);
}
function restoreHome(el) {
  const h = originalHome.get(el);
  if (!h) return;
  if (h.style != null) el.setAttribute('style', h.style); else el.removeAttribute('style');
  if (h.next && h.next.parentNode === h.parent) h.parent.insertBefore(el, h.next);
  else if (h.parent) h.parent.appendChild(el);
}
// Elenco dei nodi che il mobile riloca (per exitMobile).
let relocatedEls = [];

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
function flagUrlForCode(code) {
  return code ? `${FLAG_BASE}/${code}.svg?v=16` : '';
}

// ---- Icone flat (sottoinsieme di quelle desktop) -----------------
const ICON_PATHS = {
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  layers: '<polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/>',
  target: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/>',
  flame: '<path d="M12 2c1 3.5 4 5 4 8.5a4 4 0 1 1-8 0c0-1.2.5-2 .5-2C9 11 10 11 10 11c0-2.5 1-4.5 2-6z"/>',
  flag: '<path d="M4 21V4"/><path d="M4 4h11l-1.6 3.5L15 11H4z"/>',
  burst: '<path d="M12 2l2.2 5.2L20 6l-3.2 4.4L21 14l-5.6.6L14 20l-3-4.3L7 20l-1.4-5.4L1 14l4.2-3.6L2 6l5.8 1.2z"/>',
  scales: '<line x1="12" y1="3" x2="12" y2="20"/><line x1="7" y1="20" x2="17" y2="20"/><path d="M5 7h14"/><path d="M5 7l-3 6h6z"/><path d="M19 7l-3 6h6z"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>',
  landmark: '<polygon points="12 2 21 8 3 8 12 2"/><line x1="5" y1="10" x2="5" y2="18"/><line x1="10" y1="10" x2="10" y2="18"/><line x1="14" y1="10" x2="14" y2="18"/><line x1="19" y1="10" x2="19" y2="18"/><line x1="3" y1="21" x2="21" y2="21"/>',
  pie: '<path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/>',
  factory: '<path d="M2 20h20"/><path d="M3 20V9l6 4V9l6 4V6l6 3v11"/><line x1="7" y1="16" x2="7" y2="16.5"/><line x1="12" y1="16" x2="12" y2="16.5"/><line x1="17" y1="16" x2="17" y2="16.5"/>',
  newspaper: '<path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9h4"/><line x1="10" y1="6" x2="18" y2="6"/><line x1="10" y1="10" x2="18" y2="10"/><line x1="10" y1="14" x2="14" y2="14"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
  swords: '<polyline points="14.5 17.5 3 6 3 3 6 3 17.5 14.5"/><line x1="13" y1="19" x2="19" y2="13"/><line x1="16" y1="16" x2="20" y2="20"/><line x1="19" y1="21" x2="21" y2="19"/><polyline points="14.5 6.5 18 3 21 3 21 6 17.5 9.5"/><line x1="5" y1="14" x2="9" y2="18"/><line x1="7" y1="17" x2="4" y2="20"/><line x1="3" y1="19" x2="5" y2="21"/>',
  history: '<path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/>',
  search: '<circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  menu: '<line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>',
  help: '<circle cx="12" cy="12" r="10"/><path d="M9.2 9.2a3 3 0 0 1 5.8 1c0 2-2.9 2.4-2.9 4.3"/><line x1="12" y1="17.6" x2="12" y2="18"/>',
  back: '<line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/>',
  caret: '<polyline points="6 9 12 15 18 9"/>',
  close: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
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
// Costruzione
// ══════════════════════════════════════════════════════════════
let topbar, drawer, drawerScrim, bottombar, drawerTopRow, settingsBody, favoritesBody, drawerCredits;
let hamburgerBtn, initialized = false;

export function initMobileMenuBar() {
  if (initialized || document.querySelector('.wp-mmb-topbar')) return; // idempotente
  initialized = true;

  // Cattura home PRISTINE dei nodi condivisi PRIMA che il desktop li
  // riloci (mobile init gira prima di desktop init — vedi src/main.js).
  captureHome(document.getElementById('wp-top-controls'));
  const napManual = document.getElementById('napInput')?.closest('.menu-section');
  const napExternal = document.getElementById('externalNapToggle')?.closest('.menu-section');
  captureHome(napManual);
  captureHome(napExternal);

  buildTopbar();
  buildDrawer();
  buildBottombar();
  buildSearchOverlay();

  document.body.appendChild(topbar);
  document.body.appendChild(drawerScrim);
  document.body.appendChild(drawer);
  document.body.appendChild(bottombar);
  document.body.appendChild(searchOverlay);

  setupModeSync();
  setupToggleMirror();
  translateBar();
  window.addEventListener('wareraplus:langchange', translateBar);
  window.addEventListener('wareraplus:pins-changed', () => { if (favoritesBody) renderFavorites(favoritesBody); });

  const mq = window.matchMedia('(max-width: 768px)');
  const apply = () => (mq.matches ? enterMobile() : exitMobile());
  mq.addEventListener('change', apply);
  apply();
}

// ---- Top bar ------------------------------------------------------
function buildTopbar() {
  topbar = el('header', 'wp-mmb-topbar', { 'aria-label': 'WarEra+ mobile bar' });

  const brand = el('button', 'wp-mmb-brand', { type: 'button', 'aria-label': 'WarEra+' });
  brand.appendChild(el('img', 'wp-mmb-logo', { src: '/icons/logo-full.png', alt: '' }));
  brand.addEventListener('click', resetView);

  // Nome del tool centrato nella barra (richiesto dall'utente: la barra
  // risultava "spoglia" col solo logo a sinistra). Posizionato in absolute
  // dal CSS (centrato sull'intera topbar, non sullo spazio fra logo e
  // icone) così resta fermo al centro indipendentemente da quanti bottoni
  // ci sono a destra.
  const title = el('div', 'wp-mmb-title');
  title.textContent = 'WarEra+';

  const spacer = el('div', 'wp-mmb-spacer');

  const searchBtn = el('button', 'wp-mmb-icon-btn', { type: 'button' });
  searchBtn.appendChild(iconEl('search'));
  i18nTitles.push({ el: searchBtn, key: 'search' });
  searchBtn.addEventListener('click', openSearchOverlay);

  // ☰ / ← : lo stesso bottone; CSS mostra ← quando body.wp-subview-open,
  // altrimenti ☰. La classe è mantenuta dal watcher del file desktop
  // (setupSubviewWatch, sempre attivo) — la riusiamo 1:1.
  hamburgerBtn = el('button', 'wp-mmb-icon-btn wp-mmb-menu-btn', { type: 'button' });
  hamburgerBtn.appendChild(iconEl('menu', 'wp-mmb-i-menu'));
  hamburgerBtn.appendChild(iconEl('back', 'wp-mmb-i-back'));
  i18nTitles.push({ el: hamburgerBtn, key: 'menu' });
  hamburgerBtn.addEventListener('click', () => {
    if (document.body.classList.contains('wp-subview-open')) closeAnySubview();
    else toggleDrawer();
  });

  topbar.append(brand, title, spacer, searchBtn, hamburgerBtn);
}
function resetView() {
  closeAnySubview();
  closeDrawer();
  state.selectedCountryId = null;
  state.selectedBlocId = null;
  renderMap();
  import('../panel/countryPanel.js').then(m => m.closePanel?.()).catch(() => {});
  trackEvent('mobile-reset-view');
}

// ---- Sub-view (riusa la classe body.wp-subview-open del desktop) ---
function isPoliticalOpen() {
  return document.getElementById('wp-political-overlay')?.classList.contains('open');
}
function isStatsOpen() {
  const p = document.getElementById('bloc-stats-page');
  return !!p && getComputedStyle(p).display !== 'none';
}
function closeAnySubview() {
  if (isPoliticalOpen()) closePoliticalView();
  if (isEcoViewOpen()) closeEcoView();
  if (isMarketViewOpen()) closeMarketView();
  if (isNewsViewOpen()) closeNewsView();
  if (isMuViewOpen()) closeMuView();
  if (isNationsViewOpen()) closeNationsView();
  if (isGuideViewOpen()) closeGuideView();
  if (isStatsOpen()) document.getElementById('bloc-stats-close')?.click();
}

// ---- Drawer -------------------------------------------------------
function buildDrawer() {
  drawerScrim = el('div', 'wp-mmb-scrim', { 'aria-hidden': 'true' });
  drawerScrim.addEventListener('click', closeDrawer);

  drawer = el('aside', 'wp-mmb-drawer', { 'aria-label': mbT('menu') });

  // Riga fissa in cima: Lingua/Tema/Attuale-Originale (relocate di
  // #wp-top-controls, non un accordion — toggle ad uso frequente).
  drawerTopRow = el('div', 'wp-mmb-toprow');
  drawer.appendChild(drawerTopRow);

  // Accordion
  drawer.appendChild(buildViewsAccordion());   // aperto di default
  drawer.appendChild(buildInsightsAccordion());
  drawer.appendChild(buildSettingsAccordion());
  drawer.appendChild(buildFavoritesAccordion());

  // WarEra+ fix (segnalato dall'utente: "non si vede più la pill del
  // donate e del created by"). #wp-bottom-credits è fixed a bottom:10px
  // con z-index 3000, ma la barra inferiore mobile è alta 58px e sta a
  // z-index 7000: su telefono i due pill finivano ESATTAMENTE sotto la
  // barra, invisibili. Non si possono semplicemente alzare — sopra la
  // barra passa già la linguetta "Vedi dettagli" (bottom:64px), che ora
  // compare su ogni vista mappa, e su 375px non c'è spazio per due
  // strisce fluttuanti sovrapposte alla mappa.
  // Vanno quindi qui, in fondo al drawer ☰ e FUORI dagli accordion (si
  // vedono aprendo il menù, senza dover espandere nulla) — la stessa
  // casa che il credit autore aveva già su mobile, solo non sepolta.
  drawerCredits = el('div', 'wp-mmb-credits');
  drawer.appendChild(drawerCredits);
}
let drawerOpen = false;
function toggleDrawer() { drawerOpen ? closeDrawer() : openDrawer(); }
function openDrawer() {
  drawerOpen = true;
  drawer.classList.add('open');
  drawerScrim.classList.add('open');
  document.body.classList.add('wp-mmb-drawer-open');
}
function closeDrawer() {
  drawerOpen = false;
  drawer.classList.remove('open');
  drawerScrim.classList.remove('open');
  document.body.classList.remove('wp-mmb-drawer-open');
}

// Accordion generico
const accordions = [];
function makeAccordion(labelKey, iconKey, { open = false } = {}) {
  const sec = el('section', 'wp-mmb-acc');
  const header = el('button', 'wp-mmb-acc-header', { type: 'button', 'aria-expanded': String(open) });
  header.appendChild(iconEl(iconKey, 'wp-mmb-acc-icon'));
  header.appendChild(regSpan(labelKey));
  header.appendChild(iconEl('caret', 'wp-mmb-acc-caret'));
  const body = el('div', 'wp-mmb-acc-body');
  header.addEventListener('click', () => {
    const isOpen = sec.classList.toggle('open');
    header.setAttribute('aria-expanded', String(isOpen));
  });
  if (open) sec.classList.add('open');
  sec.append(header, body);
  accordions.push(sec);
  return { sec, body };
}

// ---- Viste mappa (delega #mode-*) ---------------------------------
const MODES = [
  { btn: 'mode-diplomacy', key: 'diplomacy', icon: 'shield' },
  { btn: 'mode-blocs', key: 'alliances', icon: 'layers' },
  { btn: 'mode-sphereOfInfluence', key: 'sphere', icon: 'target' },
  { btn: 'mode-weeklyDamage', key: 'damage', icon: 'flame' },
  { btn: 'mode-population', key: 'population', icon: 'users' },
  { btn: 'mode-production', key: 'production', icon: 'factory' },
  { btn: 'mode-contested', key: 'contested', icon: 'flag' },
  { btn: 'mode-warIntensity', key: 'warIntensity', icon: 'burst' },
  { btn: 'mode-playstyle', key: 'playstyle', icon: 'scales' },
];
let modeItems = [];
function buildViewsAccordion() {
  const { sec, body } = makeAccordion('views', 'layers', { open: true });
  body.classList.add('wp-mmb-modes-grid');
  modeItems = [];
  MODES.forEach(({ btn, key, icon }) => {
    const src = document.getElementById(btn);
    if (!src) return;
    const item = el('button', 'wp-mmb-mode', { type: 'button' });
    item.appendChild(iconEl(icon));
    item.appendChild(regSpan(key));
    item.addEventListener('click', () => { closeAnySubview(); src.click(); closeDrawer(); });
    body.appendChild(item);
    modeItems.push({ srcId: btn, item });
  });
  syncModeActive();
  return sec;
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

// ---- Approfondimenti (Politica / Stats / Eco) ---------------------
function buildInsightsAccordion() {
  const { sec, body } = makeAccordion('insights', 'pie');

  const politica = el('button', 'wp-mmb-item', { type: 'button' });
  politica.appendChild(iconEl('landmark'));
  politica.appendChild(regSpan('politics'));
  politica.addEventListener('click', () => {
    // Chiude ogni sub-view (inclusa l'Ottimizzatore) prima di aprire Political,
    // altrimenti l'eco resta sopra e la vista non cambia (bug segnalato).
    closeAnySubview();
    const id = state.selectedCountryId || lastSelectedCountryId;
    if (id) {
      state.selectedCountryId = id;
      lastSelectedCountryId = id;
      const nation = state.nazioniGlobal?.find(n => n._id === id);
      openPoliticalView(id, nation?.name || '');
      trackEvent('menubar-open-political', { countryId: id, source: 'mobile' });
    } else {
      openPoliticalView();
      trackEvent('menubar-open-political', { countryId: null, source: 'mobile' });
    }
    closeDrawer();
  });
  body.appendChild(politica);

  // Statistiche nazioni (src/nations/*) — stessa voce del menù desktop.
  const nat = el('button', 'wp-mmb-item', { type: 'button' });
  nat.appendChild(iconEl('globe'));
  nat.appendChild(regSpan('nationStats'));
  nat.addEventListener('click', () => {
    closeAnySubview();
    openNationsView();
    trackEvent('menubar-open-nations', { source: 'mobile' });
    closeDrawer();
  });
  body.appendChild(nat);

  // Statistiche alleanze — FUSIONE del vecchio bottone fluttuante
  // #bloc-stats-btn (📊), qui via delega. Un float in meno.
  const stats = el('button', 'wp-mmb-item', { type: 'button' });
  stats.appendChild(iconEl('pie'));
  stats.appendChild(regSpan('allianceStats'));
  stats.addEventListener('click', () => {
    closeAnySubview();
    document.getElementById('bloc-stats-btn')?.click();
    closeDrawer();
  });
  body.appendChild(stats);

  const eco = el('button', 'wp-mmb-item', { type: 'button' });
  eco.appendChild(iconEl('factory'));
  eco.appendChild(regSpan('ecoOptimizer'));
  eco.addEventListener('click', () => {
    closeAnySubview();
    openEcoView();
    trackEvent('menubar-open-eco', { source: 'mobile' });
    closeDrawer();
  });
  body.appendChild(eco);

  // Rendite di produzione (src/market/*) — stessa voce del menù desktop.
  const mkt = el('button', 'wp-mmb-item', { type: 'button' });
  mkt.appendChild(iconEl('scales'));
  mkt.appendChild(regSpan('market'));
  mkt.addEventListener('click', () => {
    closeAnySubview();
    openMarketView();
    trackEvent('menubar-open-market', { source: 'mobile' });
    closeDrawer();
  });
  body.appendChild(mkt);

  // News: il notiziario completo (src/app/newsView.js) — tutte le notizie
  // che il ticker in cima alla mappa mostra solo a campione.
  const news = el('button', 'wp-mmb-item', { type: 'button' });
  news.appendChild(iconEl('newspaper'));
  news.appendChild(regSpan('news'));
  news.addEventListener('click', () => {
    closeAnySubview();
    openNewsView();
    trackEvent('menubar-open-news', { source: 'mobile' });
    closeDrawer();
  });
  body.appendChild(news);

  // Unità Militari (src/mu/*) — stessa voce del menù desktop.
  const mu = el('button', 'wp-mmb-item', { type: 'button' });
  mu.appendChild(iconEl('users'));
  mu.appendChild(regSpan('muExplorer'));
  mu.addEventListener('click', () => {
    closeAnySubview();
    openMuView();
    trackEvent('menubar-open-mu', { source: 'mobile' });
    closeDrawer();
  });
  body.appendChild(mu);

  // Guida "Come si usa" (src/guide/*) — ultima voce, dopo le sezioni
  // che spiega. Stessa voce del menù desktop.
  const guide = el('button', 'wp-mmb-item', { type: 'button' });
  guide.appendChild(iconEl('help'));
  guide.appendChild(regSpan('howTo'));
  guide.addEventListener('click', () => {
    closeAnySubview();
    openGuideView();
    closeDrawer();
  });
  body.appendChild(guide);

  return sec;
}

// ---- Impostazioni (switch proxy + NAP rilocati) -------------------
const SWITCHES = [
  { id: 'checkLabels', i18n: 'switch_show_names', fallback: 'Show Nation Names' },
  { id: 'wp-checkBlocLabels', i18n: 'switch_show_bloc_names', fallback: 'Show Alliance Names' },
  { id: 'checkActiveBattles', i18n: 'switch_active_battles', fallback: 'Active Battles' },
  { id: 'checkExcludeExternalNaps', i18n: 'switch_exclude_external_naps', fallback: 'Exclude External NAPs' },
];
function buildSettingsAccordion() {
  const { sec, body } = makeAccordion('settings', 'shield');
  body.classList.add('wp-mmb-settings-body');
  settingsBody = body;

  SWITCHES.forEach(({ id, i18n, fallback }) => {
    const real = document.getElementById(id);
    if (!real) return;
    const row = el('label', 'wp-mmb-proxy-switch');
    // Niente data-i18n: ritradotto in translateBar dalla label reale, senza
    // emoji (vedi desktopMenuBar).
    const span = el('span', null);
    const realLabel = real.closest('.switch-container')?.querySelector('.switch-label');
    span.textContent = stripLeadingEmoji(realLabel?.textContent || fallback);
    proxyLabels.push({ span, realLabel, fallback });
    const cb = el('input', null, { type: 'checkbox' });
    cb.checked = real.checked;
    cb.addEventListener('change', () => {
      real.checked = cb.checked;
      real.dispatchEvent(new Event('change', { bubbles: true }));
    });
    real.addEventListener('change', () => { cb.checked = real.checked; });
    row.append(span, cb);
    body.appendChild(row);
  });
  // Le sezioni NAP vengono rilocate qui da enterMobile().
  return sec;
}

// ---- Preferiti ----------------------------------------------------
function buildFavoritesAccordion() {
  const { sec, body } = makeAccordion('favorites', 'star');
  favoritesBody = body;
  body.classList.add('wp-mmb-fav-body');
  renderFavorites(body);
  return sec;
}
function renderFavorites(panel) {
  panel.innerHTML = '';
  const { nation, alliance, mu } = getPinned();
  if (!nation.length && !alliance.length && !mu.length) {
    panel.appendChild(el('div', 'wp-mmb-res-empty', { text: mbT('noFavorites') }));
    return;
  }
  if (nation.length) {
    panel.appendChild(el('div', 'wp-mmb-res-group', { text: mbT('groupNations') }));
    nation.forEach(id => {
      const n = state.nazioniGlobal?.find(x => x._id === id);
      if (n) panel.appendChild(favRow('nation', id, n.name, flagUrlForCode(nationFlagCode(n)), false));
    });
  }
  if (alliance.length) {
    panel.appendChild(el('div', 'wp-mmb-res-group', { text: mbT('groupAlliances') }));
    alliance.forEach(id => {
      const a = state.allianceMap?.get(id);
      if (a) panel.appendChild(favRow('alliance', id, a.name, a.avatarUrl, true));
    });
  }
  if (mu.length) {
    panel.appendChild(el('div', 'wp-mmb-res-group', { text: mbT('groupMus') }));
    mu.forEach(id => {
      // Vedi desktopMenuBar: dato vivo se la directory è in memoria,
      // altrimenti i metadati salvati al momento del pin.
      const m = getCachedMu(id) || getMuPinMeta(id);
      if (m) panel.appendChild(favRow('mu', id, m.name, m.avatarUrl, true));
    });
  }
}
function favRow(type, id, name, imgSrc, isLogo) {
  const row = el('div', 'wp-mmb-res-row');
  const img = el('img', `wp-mmb-res-img${isLogo ? ' wp-mmb-res-logo' : ''}`, { alt: '', loading: 'lazy' });
  if (imgSrc) img.src = imgSrc; else img.style.visibility = 'hidden';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  row.appendChild(img);
  row.appendChild(el('span', 'wp-mmb-res-name', { text: name }));
  const unpin = el('button', 'wp-mmb-unpin', { type: 'button', 'aria-label': 'Rimuovi' });
  unpin.textContent = '×';
  unpin.addEventListener('click', (e) => { e.stopPropagation(); togglePin(type, id); });
  row.appendChild(unpin);
  row.addEventListener('click', () => goToDetail(type, id));
  return row;
}
function goToDetail(type, id) {
  closeAnySubview();
  closeDrawer();
  if (type === 'mu') {
    openMuView(id);
    trackEvent('favorite-open', { type, id, source: 'mobile' });
    return;
  }
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
  trackEvent('favorite-open', { type, id, source: 'mobile' });
}

// ---- Bottom tab bar (Battaglie / Time machine, delega) ------------
let battlesTab, timeMachineTab;
function buildBottombar() {
  bottombar = el('nav', 'wp-mmb-bottombar', { 'aria-label': 'WarEra+ actions' });

  battlesTab = el('button', 'wp-mmb-tab wp-mmb-tab-battles', { type: 'button' });
  battlesTab.appendChild(iconEl('swords'));
  battlesTab.appendChild(regSpan('battles'));
  battlesTab.addEventListener('click', () => document.getElementById('wp-battles-toggle-btn')?.click());

  timeMachineTab = el('button', 'wp-mmb-tab wp-mmb-tab-timemachine', { type: 'button' });
  timeMachineTab.appendChild(iconEl('history'));
  timeMachineTab.appendChild(regSpan('timeMachine'));
  timeMachineTab.addEventListener('click', () => {
    // Vedi desktopMenuBar: la mappa dedicata della time machine finirebbe
    // sotto una sub-view aperta (Political/Statistiche/Eco). Chiudila prima.
    closeAnySubview();
    document.getElementById('wp-time-machine-btn')?.click();
  });

  bottombar.append(battlesTab, timeMachineTab);
}
function setupToggleMirror() {
  const src1 = document.getElementById('wp-battles-toggle-btn');
  const src2 = document.getElementById('wp-time-machine-btn');
  const mirror = () => {
    if (src1 && battlesTab) battlesTab.classList.toggle('wp-mmb-off', src1.classList.contains('wp-battles-hidden'));
    if (src2 && timeMachineTab) timeMachineTab.classList.toggle('wp-mmb-active', src2.classList.contains('wp-time-machine-btn-active'));
  };
  const obs = new MutationObserver(mirror);
  if (src1) obs.observe(src1, { attributes: true, attributeFilter: ['class'] });
  if (src2) obs.observe(src2, { attributes: true, attributeFilter: ['class'] });
  mirror();
}

// ---- Ricerca (overlay fullscreen) ---------------------------------
let searchOverlay, searchInput, searchResults;
let currentRows = [];
let activeIdx = -1;
function buildSearchOverlay() {
  searchOverlay = el('div', 'wp-mmb-search-overlay', { 'aria-hidden': 'true' });

  const bar = el('div', 'wp-mmb-search-bar');
  bar.appendChild(iconEl('search', 'wp-mmb-search-icon'));
  searchInput = el('input', 'wp-mmb-search-input', { type: 'text', placeholder: mbT('searchPh'), autocomplete: 'off', enterkeyhint: 'search' });
  const closeBtn = el('button', 'wp-mmb-search-close', { type: 'button', 'aria-label': mbT('back') });
  closeBtn.appendChild(iconEl('close'));
  closeBtn.addEventListener('click', closeSearchOverlay);
  bar.append(searchInput, closeBtn);

  searchResults = el('div', 'wp-mmb-search-results');

  searchInput.addEventListener('input', () => renderResults(searchInput.value));
  searchInput.addEventListener('keydown', onSearchKey);

  searchOverlay.append(bar, searchResults);
}
function openSearchOverlay() {
  closeDrawer();
  searchOverlay.classList.add('open');
  document.body.classList.add('wp-mmb-search-open');
  renderResults(searchInput.value);
  setTimeout(() => searchInput.focus(), 50);
}
function closeSearchOverlay() {
  searchOverlay.classList.remove('open');
  document.body.classList.remove('wp-mmb-search-open');
  searchInput.blur();
}
function renderResults(query) {
  const q = query.trim().toLowerCase();
  currentRows = [];
  activeIdx = -1;
  searchResults.innerHTML = '';
  if (!q) return;

  const rank = (name) => { const nl = name.toLowerCase(); if (nl === q) return 0; if (nl.startsWith(q)) return 1; return 2; };
  const byRelevance = (a, b) => rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);

  const nations = (state.nazioniGlobal || []).filter(n => n.name?.toLowerCase().includes(q)).sort(byRelevance).slice(0, 12);
  const alliances = (state.alliancesList || []).filter(a => a.name?.toLowerCase().includes(q)).sort(byRelevance).slice(0, 10);
  ensureMuDirectoryForSearch(q);
  const mus = (getCachedDirectory() || []).filter(m => m.name?.toLowerCase().includes(q)).sort(byRelevance).slice(0, 10);

  if (!nations.length && !alliances.length && !mus.length) {
    searchResults.appendChild(el('div', 'wp-mmb-res-empty', { text: mbT('noResults') }));
    return;
  }
  if (nations.length) {
    searchResults.appendChild(el('div', 'wp-mmb-res-group', { text: mbT('groupNations') }));
    nations.forEach(n => searchResults.appendChild(makeNationRow(n)));
  }
  if (alliances.length) {
    searchResults.appendChild(el('div', 'wp-mmb-res-group', { text: mbT('groupAlliances') }));
    alliances.forEach(a => searchResults.appendChild(makeAllianceRow(a)));
  }
  if (mus.length) {
    searchResults.appendChild(el('div', 'wp-mmb-res-group', { text: mbT('groupMus') }));
    mus.forEach(m => searchResults.appendChild(makeMuRow(m)));
  }
}
// ---- Unità militari nella ricerca --------------------------------
// La directory MU (src/mu/api.js) vive in memoria solo dopo che l'utente
// ha aperto almeno una volta la vista Unità Militari. Perché la ricerca
// globale le trovi comunque, la si scarica in sottofondo al primo termine
// di ricerca di almeno 3 caratteri: una volta sola per sessione, ~140 KB
// gzip, e senza bloccare nulla — i risultati già pronti (nazioni,
// alleanze) sono a schermo subito, le unità si aggiungono quando
// arrivano. Sotto i 3 caratteri non si scarica: non si scomoda un
// download per chi ha appena premuto un tasto.
let muPrefetchStarted = false;
function ensureMuDirectoryForSearch(q) {
  if (muPrefetchStarted || getCachedDirectory() || q.length < 3) return;
  muPrefetchStarted = true;
  fetchMuDirectory()
    .then(() => {
      const now = searchInput.value.trim();
      if (now.length >= 3) renderResults(now); // ridisegna solo se sta ancora cercando
    })
    .catch(() => { muPrefetchStarted = false; }); // riprovabile al prossimo termine
}
function makeMuRow(m) {
  const row = el('div', 'wp-mmb-res-row');
  const img = el('img', 'wp-mmb-res-img wp-mmb-res-logo', { alt: '', loading: 'lazy' });
  if (m.avatarUrl) img.src = m.avatarUrl; else img.style.visibility = 'hidden';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  row.appendChild(img);
  row.appendChild(el('span', 'wp-mmb-res-name', { text: m.name }));
  row.appendChild(pinToggle('mu', m._id, { name: m.name, avatarUrl: m.avatarUrl, country: m.country }));
  row.addEventListener('click', () => {
    closeAnySubview();
    openMuView(m._id);
    trackEvent('search-mu', { muId: m._id, source: 'mobile' });
    closeSearchOverlay();
  });
  currentRows.push(row);
  return row;
}

function makeNationRow(n) {
  const row = el('div', 'wp-mmb-res-row');
  const code = nationFlagCode(n);
  const img = el('img', 'wp-mmb-res-img', { alt: '', loading: 'lazy' });
  if (code) img.src = `${FLAG_BASE}/${code}.svg?v=16`;
  img.onerror = () => { img.style.visibility = 'hidden'; };
  row.appendChild(img);
  row.appendChild(el('span', 'wp-mmb-res-name', { text: n.name }));
  row.appendChild(pinToggle('nation', n._id));
  row.addEventListener('click', () => selectNation(n));
  currentRows.push(row);
  return row;
}
function makeAllianceRow(a) {
  const row = el('div', 'wp-mmb-res-row');
  const img = el('img', 'wp-mmb-res-img wp-mmb-res-logo', { alt: '', loading: 'lazy' });
  if (a.avatarUrl) img.src = a.avatarUrl; else img.style.visibility = 'hidden';
  img.onerror = () => { img.style.visibility = 'hidden'; };
  row.appendChild(img);
  row.appendChild(el('span', 'wp-mmb-res-name', { text: a.name }));
  row.appendChild(pinToggle('alliance', a._id));
  row.addEventListener('click', () => selectAlliance(a));
  currentRows.push(row);
  return row;
}
function pinToggle(type, id, meta) {
  const btn = el('button', 'wp-mmb-pin', { type: 'button', 'aria-label': 'Preferiti' });
  const paint = () => {
    const on = isPinned(type, id);
    btn.classList.toggle('pinned', on);
    btn.textContent = on ? '★' : '☆';
  };
  paint();
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    togglePin(type, id, meta);
    paint();
    trackEvent('pin-toggle', { type, id, pinned: isPinned(type, id), source: 'mobile-search' });
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
  import('../panel/countryPanel.js').then(m => m.selectNationInPanel(n._id)).catch(() => {});
  trackEvent('search-nation', { query: n.name.toLowerCase(), found: true, source: 'mobile' });
  closeSearchOverlay();
}
function selectAlliance(a) {
  closeAnySubview();
  setColoringMode('blocs');
  state.selectedBlocId = a._id;
  renderMap();
  const bloc = state.externalBlocsInfo?.find(b => b.id === a._id);
  if (bloc && bloc.labelLng != null && state.map) state.map.flyTo({ center: [bloc.labelLng, bloc.labelLat], zoom: Math.max(state.map.getZoom(), 3) });
  import('../panel/countryPanel.js').then(m => m.selectBlocInPanel(a._id)).catch(() => {});
  trackEvent('search-alliance', { query: a.name.toLowerCase(), allianceId: a._id, source: 'mobile' });
  closeSearchOverlay();
}
function onSearchKey(e) {
  if (e.key === 'Escape') { closeSearchOverlay(); return; }
  if (!currentRows.length) return;
  if (e.key === 'ArrowDown') { e.preventDefault(); activeIdx = (activeIdx + 1) % currentRows.length; highlightActive(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); activeIdx = (activeIdx - 1 + currentRows.length) % currentRows.length; highlightActive(); }
  else if (e.key === 'Enter') { e.preventDefault(); (currentRows[activeIdx] || currentRows[0]).click(); }
}
function highlightActive() {
  currentRows.forEach((r, i) => r.classList.toggle('wp-mmb-res-active', i === activeIdx));
  currentRows[activeIdx]?.scrollIntoView({ block: 'nearest' });
}

// ---- Enter / exit (relocazioni) -----------------------------------
function enterMobile() {
  // Differito in rAF: su restringimento live, lascia girare prima
  // l'exitDesktop (che riporta i nodi condivisi alla home pristine).
  requestAnimationFrame(() => {
    if (!window.matchMedia('(max-width: 768px)').matches) return; // annullato nel frattempo
    const topControls = document.getElementById('wp-top-controls');
    const napManual = document.getElementById('napInput')?.closest('.menu-section');
    const napExternal = document.getElementById('externalNapToggle')?.closest('.menu-section');
    const bottomCredits = document.getElementById('wp-bottom-credits');
    relocatedEls = [];
    if (topControls && drawerTopRow) { relocate(topControls, drawerTopRow); relocatedEls.push(topControls); }
    if (napManual && settingsBody) { relocate(napManual, settingsBody); relocatedEls.push(napManual); }
    if (napExternal && settingsBody) { relocate(napExternal, settingsBody); relocatedEls.push(napExternal); }
    // Ko-fi + pill autore: dal fondo dello schermo (dove la barra
    // inferiore li copriva, vedi buildDrawer) al fondo del drawer. Si
    // sposta il WRAPPER, non i due pill separatamente, così restano
    // appaiati come su desktop. La classe dice al CSS che ora è un
    // blocco in flusso e non più un elemento fisso sulla mappa — ed è
    // anche ciò che riaccende la pill autore, nascosta sotto i 769px
    // finché galleggiava sulla mappa (vedi shell.css .wp-author-pill).
    // #wp-author-credit (la riga di testo dentro Impostazioni) NON viene
    // più rilocato qui: sarebbe lo stesso credito due volte nello stesso
    // drawer, e la pill è la versione ricca (avatar + link).
    if (bottomCredits && drawerCredits) {
      relocate(bottomCredits, drawerCredits);
      bottomCredits.classList.add('wp-credits-in-drawer');
      relocatedEls.push(bottomCredits);
    }
  });
}
function exitMobile() {
  closeDrawer();
  closeSearchOverlay();
  // La classe va tolta PRIMA del ritorno a casa: tornando su desktop i
  // due pill devono ridiventare l'elemento fisso centrato in basso.
  document.getElementById('wp-bottom-credits')?.classList.remove('wp-credits-in-drawer');
  relocatedEls.forEach(restoreHome);
  relocatedEls = [];
}
