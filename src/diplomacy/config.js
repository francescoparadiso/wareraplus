// config.js
//export const API_BASE_URL = 'https://apidev.warera.io';  // per test
export const API_BASE_URL = 'https://api6.warera.io'; // per produzione
export const CACHE_API_BASE_URL = 'https://gateway.warerastats.io'

// WarEra+: server di cache/proxy su VPS esterno (nginx davanti a un Express
// gestito da pm2), scritto per ridurre il carico diretto su api6/Worker: fa
// lui il poll periodico delle API WarEra (ogni endpoint con un proprio
// offset) e serve dati già pronti via HTTP. Non è lo stesso servizio di
// CACHE_API_BASE_URL sopra (dominio diverso, gateway.warerastats.io — quella
// costante resta non referenziata altrove, era già così prima). Vedi
// src/diplomacy/cacheClient.js per come viene consumato (sempre con
// fallback alla chiamata diretta se il server è irraggiungibile o i dati
// sono troppo vecchi — non deve MAI essere un punto di fallimento unico).
export const WARERA_CACHE_BASE = 'https://warera-oracle.duckdns.org/warera-cache';

// WarEra+: Worker Cloudflare con API_TOKEN server-side (limite 500
// batch/minuto invece di 100). Il codice del worker incollato dall'utente
// corrisponde esattamente a quello già in uso da Political View
// (public/political/config.js: stesso pattern di proxy verso
// api2.warera.io, stessa descrizione "limite più alto (500) senza
// esporre la key nel frontend") — assunto quindi essere lo STESSO worker
// già deployato, non uno nuovo da creare. Se in realtà è un worker
// diverso/con altro URL, va corretta questa singola costante.
// Usato SOLO per battaglie ed elezioni/parlamenti (vedi trpcBatch in
// utils.js, opzione { useWorker: true }), non per tutte le chiamate.
export const WORKER_API_BASE = 'https://politicalview-proxy.fra-paradiso2.workers.dev';

// WarEra+: base per l'Ottimizzatore industriale (src/eco/*). Alcuni endpoint
// economici sono TOKEN-GATED (worker.getWorkers,
// transaction.getPaginatedTransactions,
// company.getRecommendedRegionIdsByItemCode): rispondono "API token required"
// (401) senza X-API-Key. Coprono 2 delle 3 funzioni del tool (Lavoratori,
// Posizione) + il reddito-lavoratori di Competenze, quindi servono davvero.
// Passano dallo STESSO Worker Cloudflare, che inietta la key server-side come
// header X-API-Key (secret Cloudflare, mai nel browser). NB: perché funzioni,
// il worker deve aggiungere `X-API-Key: <token>` — NON `Authorization: Bearer`
// (WarEra ignora quest'ultimo → 401). Se il tool mostra lo stato "setup", il
// worker non sta iniettando la key: controlla il secret API_TOKEN e l'header.
export const ECO_PROXY_BASE = WORKER_API_BASE;

// ⚠️ RIMOSSA: la chiave era in chiaro nel bundle servito al browser, quindi
// leggibile da chiunque aprisse i devtools. Nessun modulo la usava davvero
// (fetchWithAuth non era chiamata da nessuna parte).
// Se in futuro serve una chiamata autenticata, va fatta dietro un proxy
// server-side: qualunque valore messo qui e' pubblico.
// REVOCA la vecchia chiave sul pannello Warera, e' gia' stata esposta.

export const COLORS = {
  SELECTED: '#ffcc00',
  // WarEra+ — schema colori guerra/nemici, rivisto due volte:
  // 1) WAR_INDIRECT (alleati dei tuoi nemici) portato ad arancione: prima
  //    era rosso scuro e si confondeva con WAR_DIRECT.
  // 2) WAR_DIRECT e SWORN_ENEMY scambiati: lo sworn enemy (relazione
  //    permanente, più grave) ora ha il rosso più acceso; la guerra
  //    diretta "normale" il rosso scuro.
  WAR_DIRECT: '#b30000',
  WAR_INDIRECT: '#e67e22',
  ALLY_DIRECT: '#2ecc71',
  NAP: '#00d4ff',
  DEFAULT_LAND: '#4a4e5a',
  NEUTRAL_UNSELECTED: '#3a3d46',
  OCEAN: '#000000',
  ITALIAN_BLOC: '#1b557a',
  WESTERN_BLOC: '#55a5d9',
  AFRICAN_UNION: '#e67e22',
  ASIAN_FEDERATION: '#8e44ad',
  ICDP: '#c0392b',
  HOLY_LEAGUE: '#FFD700',
  // Nuovi colori
  DEFENSIVE_PACT: '#9b59b6', // viola
  SWORN_ENEMY: '#ff0000',    // rosso acceso (vedi nota sopra su WAR_DIRECT)
};

export const THEMES = {
  dark: {
    OCEAN: '#00042679',
    DEFAULT_LAND: '#4a4e5a',
    NEUTRAL_UNSELECTED: '#3a3d46',
    // WarEra+: Antartide — non è una regione del gioco (nessun countryId,
    // nessuna interazione), aggiunta solo come sfondo geografico. Colore
    // volutamente diverso da NEUTRAL_UNSELECTED così non sembra un paese
    // cliccabile "spento".
    ANTARCTICA: '#8a94a3',
    TEXT: '#e6edf3',
    TEXT_SECONDARY: '#8b949e',
    PANEL_BG: 'rgba(10,10,10,0.95)',
    PANEL_BORDER: '#333',
    BUTTON_BG: '#1a1a1a',
    BUTTON_BORDER: '#444',
    INPUT_BG: '#1a1a1a',
    INPUT_BORDER: '#444',
    SWITCH_BG: '#333',
    SWITCH_BORDER: '#444',
    LEGEND_BG: 'rgba(13,17,23,0.92)',
    LEGEND_BORDER: '#30363d',
    COAST_COLOR: '#ffffff',
    BORDER_COLOR: '#ffffff',
    OUTLINE_COLOR: '#000000',
  },
  light: {
    OCEAN: '#a2986f',
    DEFAULT_LAND: '#ffe7a6',
    NEUTRAL_UNSELECTED: '#352700',
    ANTARCTICA: '#e8e1cd', // vedi nota nel tema dark sopra
    TEXT: '#1a1a1a',
    TEXT_SECONDARY: '#555555',
    PANEL_BG: 'rgba(255,255,255,0.95)',
    PANEL_BORDER: '#cccccc',
    BUTTON_BG: '#f0f0f0',
    BUTTON_BORDER: '#cccccc',
    INPUT_BG: '#ffffff',
    INPUT_BORDER: '#cccccc',
    SWITCH_BG: '#dddddd',
    SWITCH_BORDER: '#bbbbbb',
    LEGEND_BG: 'rgba(255,255,255,0.95)',
    LEGEND_BORDER: '#cccccc',
    COAST_COLOR: '#000000',
    BORDER_COLOR: '#000000',
    OUTLINE_COLOR: '#000000',
  }
};

export const LAYER_IDS = {
  SRC_REGIONS: 'regions-src',
  SRC_BORDERS: 'borders-src',
  // SRC_LABELS ('labels-src') rimossa: sorgente senza alcun layer che la
  // leggesse (le etichette sono disegnate sul canvas 2D di labels.js).
  SRC_DIPLOMACY_DUAL_BORDER: 'diplomacy-dual-border-src',
  SRC_BORDER_STYLED: 'border-styled-src', // WarEra+: confini con proprietà per segmento (vedi borderStyle.js)
  SRC_BATTLE_REGION: 'battle-region-src', // WarEra+: contorno della regione della battaglia selezionata
  LYR_FILL: 'regions-fill',
  LYR_OUTLINE: 'regions-outline',
  LYR_COAST: 'regions-coast',
  LYR_BORDER: 'borders-line',
  LYR_MULTI_BLOC: 'multi-bloc-pattern',
  LYR_DIPLOMACY_DUAL: 'diplomacy-dual-pattern',
  LYR_BORDER_CASING: 'borders-casing-line',    // WarEra+: bordo nero sotto al confine colorato (come nel gioco)
  LYR_REGION_INNER: 'regions-inner-line',      // WarEra+: confini interni nella tinta della nazione
  LYR_BORDER_RELATION: 'borders-relation-line', // WarEra+: confini nazionali colorati per relazione
  LYR_BATTLE_REGION: 'battle-region-outline',
  LYR_BATTLE_REGION_FILL: 'battle-region-fill', // WarEra+: riempimento dell'intera regione, non solo contorno
  LYR_BLOC_FLASH: 'bloc-flash-highlight', // WarEra+: effetto "blink" al click su un'alleanza nella legenda
  LYR_HEATMAP_FADE: 'heatmap-fade-overlay', // WarEra+: dissolvenza in ingresso della heatmap battaglia (vedi map.js)
  LYR_ANTARCTICA: 'antarctica-fill', // WarEra+: landmass decorativa, non è una regione del gioco (vedi map.js)
  LYR_ANTARCTICA_COAST: 'antarctica-coast',
};

export const EXTERNAL_NAPS_URL =
  'https://raw.githubusercontent.com/francescoparadiso/warera-tactical-diplomacy-os/refs/heads/main/warera_naps.csv';

export const EXTERNAL_SPHERE_URL =
  'https://raw.githubusercontent.com/francescoparadiso/warera-tactical-diplomacy-os/refs/heads/main/SphereOfInfluence.csv';