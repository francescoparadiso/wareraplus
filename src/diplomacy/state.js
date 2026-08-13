// state.js
export const state = {
  map: null,
  nazioniGlobal: [],
  mapDataGlobal: null,
  selectedCountryId: null,
  selectedBlocId: null, // WarEra+: alleanza attualmente in focus in modalità 'blocs'
  showBlocLabels: true, // WarEra+: toggle per nascondere i nomi delle alleanze sulla mappa
  blocFocusColorMap: new Map(), // WarEra+: colori calcolati per il blocco in focus, condivisi tra mappa ed etichette
  customNaps: [],
  nationBaseColorMap: new Map(),
  externalBlocsInfo: [],
  externalNapsList: [],
  externalNapsSet: new Set(),
  nationMap: new Map(),
  multiBlocMap: new Map(),
  blocColorMap: new Map(),
  baseGeoJSON: null,
  originalLabelsData: [],
  labelsData: [],
  mapSource: 'actual',
  coloringMode: 'diplomacy',
  patternImageCache: new Map(),
  flagImageCache: new Map(),
  labelCanvas: null,
  theme: 'dark',
  labelCtx: null,
  alliancesList: [],
  allianceColorMap: new Map(),
  nationAlliancesMap: new Map(),
  sphereMap: new Map(),
  spherePrimaries: new Set(),
  sphereInfo: [],
  diplomacyData: new Map(),
  centroids: new Map(),
  battleHeatmapData: null,
  regionData: null,
  regionCache: new Map(), // regionId → { position: [lng,lat], name: string }
  // Indici O(1) per evitare le scansioni lineari (nazioniGlobal.find /
  // alliancesList.find) che erano sparse dentro loop annidati.
  nationByCode: new Map(),   // 'IT' (uppercase) → nation
  allianceMap: new Map(),    // allianceId → alliance

};