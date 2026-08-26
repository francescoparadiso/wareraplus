// state.js
export const state = {
  map: null,
  nazioniGlobal: [],
  mapDataGlobal: null,
  selectedCountryId: null,
  selectedBlocId: null, // WarEra+: alleanza attualmente in focus in modalità 'blocs'
  showBlocLabels: true, // WarEra+: toggle per nascondere i nomi delle alleanze sulla mappa
  // WarEra+: in vista Sphere la mappa colora i proxy del CSV più quelli che
  // il radar (src/proxy/radar.js) dà per sicuri almeno al 75%. Con questo a
  // true colora anche i rilevamenti sotto soglia. Non persiste: ogni
  // apertura riparte dalla vista prudente.
  showAllDetectedProxies: false,
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
  // WarEra+ (borderStyle.js): coppie di nazioni CONFINANTI, ricavate in una
  // passata sugli archi del topology. Solo per queste serve calcolare una
  // relazione da dipingere sul confine.
  borderPairs: [], // [{ key: 'idA|idB', a, b }] — vista ATTUALE
  borderPairsOriginal: [], // le stesse coppie sui confini di inizio partita (vista ORIGINALE)
  battleHeatmapData: null,
  // WarEra+ heatmap storiche: caricate su richiesta alla prima attivazione
  // della relativa vista, poi tenute qui per la sessione (dati che cambiano
  // lentamente, non vale un refetch ad ogni cambio di modalità).
  contestedCounts: null,      // {regionId: passaggi di mano}
  warIntensityData: null,     // {regionId: danno storico totale}
  warIntensityError: null,    // messaggio se il server non espone l'endpoint
  nationPlaystyle: null,      // {countryId: {war, eco, mixed, undecided, known, total}}
  playstyleTrend: null,       // scala della variante "variazione 7 giorni" (playstyleTrendHeatmap.js)
  playstyleTrendMode: false,  // toggle nel riepilogo: fotografia (false) o variazione nel tempo (true)
  playstyleTrendDays: 7,      // quanti giorni indietro guarda la variazione (slider del riepilogo, 1-7)
  playstyleHistory: null,     // storico grezzo per nazione, scaricato una volta e ri-affettato dallo slider
  playstyleTrendError: null,  // messaggio se lo storico non è disponibile
  regionData: null,
  regionCache: new Map(), // regionId → { position: [lng,lat], name: string }
  // Indici O(1) per evitare le scansioni lineari (nazioniGlobal.find /
  // alliancesList.find) che erano sparse dentro loop annidati.
  nationByCode: new Map(),   // 'IT' (uppercase) → nation
  allianceMap: new Map(),    // allianceId → alliance

  // WarEra+: true mentre il pannello "Time machine" è aperto (src/app/timeMachine.js).
  // Letto SOLO da _onRegionClick (map.js) per non aprire la selezione/pannello
  // nazione live mentre si sta guardando lo storico — nessun altro punto del
  // codice esistente lo tocca, additivo con fallback (default false = comportamento invariato).
  timeMachineActive: false,
};