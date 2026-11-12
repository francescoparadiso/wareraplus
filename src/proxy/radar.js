/* ══════════════════════════════════════════════════════════════
   WarEra+ — Radar dei proxy
   ------------------------------------------------------------------
   Le sfere d'influenza della vista Sphere sono SOLO quelle di questo radar.
   Fino al 2026-11-12 c'era anche un CSV compilato a mano
   (SphereOfInfluence.csv): è stato tolto perché non era più affidabile,
   invecchiava senza che si vedesse.

   Il modulo stima dai dati pubblici, per ogni nazione, QUALE altra nazione
   la controlla e con che sicurezza. Ogni riga porta la sua percentuale: è
   una stima, mai una fonte.

   ── Perché serve un modello e non una soglia ──────────────────────
   Un proxy cancella il dato che lo identificherebbe: chi si trasferisce in
   Slovenia per l'API È sloveno, non esiste un campo "origine". Quindi non
   si osserva il controllo, si osservano RESIDUI — cose che chi migra non
   porta con sé. Nessun residuo da solo basta, e vanno quindi composti.

   ── I tre segnali calcolabili qui, nel browser ────────────────────
   S1  DOVE MILITANO I CITTADINI. Per ogni nazione, la nazionalità di
       registrazione delle unità militari in cui stanno i suoi cittadini.
       Chi si trasferisce raramente lascia la sua unità di prima. Viene
       dalla directory MU del server di cache (una fetch per sessione,
       condivisa con la vista Unità Militari: vedi src/mu/api.js).
   S4  IL LEGAME DIPLOMATICO col candidato patrono (stessa alleanza, patto
       difensivo, alleato). Da solo non prova niente — un alleato è legato
       quanto un proxy — ma alza o abbassa una tesi già formulata da S1.
       Gratis: è già in state.nazioniGlobal.
   S5  L'ANOMALIA PER ABITANTE. Un proxy è spesso un guscio: pochi
       cittadini che picchiano come una nazione grande. Debole (46 nazioni
       su 180 stanno sopra il doppio della mediana) ma a costo zero.

   NON ci sono qui i due segnali più forti — la lingua di chi governa e la
   storia delle cittadinanze — perché richiedono rispettivamente una
   chiamata per utente (troppe dal browser) e una sessione di gioco
   autenticata. Vanno calcolati sul server di cache e serviti già pronti;
   questo modulo è scritto perché quel punteggio, quando ci sarà, entri da
   `applyServerIndex()` senza toccare il resto.

   ── Come si combinano: rapporti di verosimiglianza ────────────────
   Ogni segnale moltiplica le probabilità a favore (odds), che alla fine
   tornano una percentuale. È il modo di comporre indizi indipendenti in
   cui ogni pezzo resta LEGGIBILE: la vista mostra le stesse evidenze che
   il calcolo ha usato, non un numero che esce da una scatola.

   I moltiplicatori sono stati tarati sul CSV delle sfere (poi tolto, il
   2026-11-12) come verità di riferimento (30 proxy noti contro le altre
   150 nazioni, dati del 25 agosto 2026):

     · quota in unità straniere ≥ 90%  →  proxy 17%, altre nazioni 3%
     · legame diplomatico presente     →  proxy 80%, altre nazioni 42%
     · danno per cittadino oltre 2×    →  proxy 27%, altre nazioni 9%

   ⚠️ Taratura DICHIARATAMENTE approssimativa, per un motivo strutturale:
   fra le 150 "non proxy" ci sono quasi certamente proxy non ancora
   schedati (il modello stesso ne propone una trentina), quindi i rapporti
   misurati sono più bassi del vero. L'errore va nella direzione prudente —
   sottostima, non sovrastima.

   ── Verifica del 26 agosto 2026 ───────────────────────────────────
   La soglia del 75% non è più una scelta prudenziale a occhio: è stata
   misurata contro una fonte che questo modello non vede mai — i cluster di
   migrazione ricavati dalla storia delle cittadinanze da un'analisi
   esterna (24 coppie nazione→patrono, osservazione diretta del meccanismo).

     · sopra il 75%, accordo sul patrono 10 su 10;
     · fra il 50% e il 75%, 12 su 13.

   Cioè: il limite di questo modello NON è l'esattezza di quello che dice,
   è quanto poco riesce a vedere — delle 24 coppie ne ritrova 10. Le
   mancanti sono proxy CONSOLIDATI, dove chi è migrato si è fatto unità
   militari locali: misurato sulle undici sfuggite, il governo di Trinidad
   è 8 su 8 in unità proprie, quello dello Yemen 10 su 10, la Bosnia 11 su
   12. Nessuna soglia più bassa le recupera — servirebbe la storia delle
   cittadinanze, che dal browser non è raggiungibile.
   ══════════════════════════════════════════════════════════════ */

import { state } from '../diplomacy/state.js';
import { WARERA_CACHE_BASE } from '../diplomacy/config.js';
// `src/mu/api.js` si importa a richiesta dentro runRadar(): è il modulo della
// vista Unità Militari, che vive nel suo chunk. Importarlo qui in cima lo
// trascinerebbe nel bundle principale solo per la vista Sphere.

/** L'indice già calcolato dal server, se c'è. Timeout corto: questa è la
 *  scorciatoia, non la strada — se tarda si calcola in proprio invece di
 *  far aspettare la vista. Non lancia mai. */
async function fetchServerIndex() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch(`${WARERA_CACHE_BASE}/proxy-index`, { signal: controller.signal });
    if (!res.ok) return null;
    const json = await res.json();
    return Array.isArray(json?.data) && json.data.length ? json.data : null;
  } catch {
    return null;   // server giù, non ancora rideployato, rete lenta: pace
  } finally {
    clearTimeout(timer);
  }
}

/* ── Parametri del modello ────────────────────────────────────────
   Tenuti insieme e con un nome, non sparsi come numeri magici: sono
   l'unica cosa da ritoccare quando arriva una taratura migliore. */
const PRIOR = 0.20;          // ~1 nazione su 5 è un proxy (30 nel CSV + una trentina proposti, su 180)
const W_SHARE = 3.6;         // pendenza del segnale S1 attorno al punto di equilibrio
const F_NEUTRAL = 0.35;      // sotto questa quota di stranieri, S1 gioca CONTRO
const MIN_KNOWN = 6;         // meno di così di membri risolti: campione troppo piccolo, si tace
const FULL_CONF_N = 15;      // da qui in su S1 vale a piena forza
// ⚠️ La guerra col presunto patrono NON è una smentita (correzione del
// 2026-08-26, su indicazione dell'utente poi verificata sui dati). Nel
// gioco capita spesso che una potenza conquisti i propri proxy o ci vada
// in guerra per ragioni di comodo. Misurato sulle 24 coppie documentate da
// cluster di migrazione: il 13% è in guerra col proprio patrono, contro un
// 3,5% di due nazioni qualsiasi — Trinidad/Venezuela, Guinea-Bissau/
// Brasile, Iraq/Egitto. È quindi semmai un indizio A FAVORE, ma tre casi
// non bastano per farne un moltiplicatore positivo: resta NEUTRO, e la
// guerra si continua a mostrare fra le evidenze perché chi legge la sappia.
const LR_AT_WAR = 1.0;
// Patti e alleanze vanno e vengono di continuo (l'Armenia ne ha perso uno
// nelle dieci ore fra due giri di questo indice). Il legame resta un
// indizio misurato — 79% delle coppie documentate ce l'ha — ma i pesi sono
// smorzati verso l'1: un segnale che cambia di settimana in settimana non
// deve far ballare la percentuale di un fattore quattro.
const LR_LINK = 1.6;
const LR_NO_LINK = 0.6;
const LR_HIGH_DMG = 2.2;     // danno per cittadino oltre il doppio della mediana mondiale
const LR_LOW_DMG = 0.7;      // sotto la mediana

/** Soglia oltre la quale un proxy rilevato finisce SULLA MAPPA. Sotto,
 *  resta nell'elenco del pannello e compare in mappa solo col toggle. */
export const MAP_THRESHOLD = 0.75;

let _radar = null;           // Map(countryId → rilevamento)
let _promise = null;

/** Il rilevamento di una nazione, se il radar è già stato calcolato. */
export function getDetection(countryId) {
  return _radar?.get(countryId) || null;
}

/** Tutti i rilevamenti, ordinati per sicurezza decrescente. Vuoto finché
 *  `runRadar()` non ha finito. */
export function getDetections() {
  return _radar ? [..._radar.values()].sort((a, b) => b.p - a.p) : [];
}

export function isRadarReady() {
  return !!_radar;
}

/* ── S1: dove militano i cittadini di ogni nazione ────────────────
   Si gira la directory al contrario: ogni unità militare dichiara la
   propria nazione di registrazione e la composizione per nazionalità dei
   membri, quindi sommando si ottiene, per ogni nazione, dove stanno
   tesserati i suoi cittadini.

   `composition.top` porta solo le prime cinque nazionalità di ciascuna
   unità: misurato dal server, una MU ha 1 nazionalità in mediana e 3 al
   90° percentile, quindi il taglio non perde praticamente nulla. */
function buildMuMix(directory) {
  const mix = new Map();  // countryId dei cittadini → Map(countryId dell'unità → quanti)
  for (const mu of directory) {
    const home = mu.country;
    if (!home) continue;
    for (const entry of mu.composition?.top || []) {
      if (!entry?.country) continue;
      let row = mix.get(entry.country);
      if (!row) mix.set(entry.country, row = new Map());
      row.set(home, (row.get(home) || 0) + entry.n);
    }
  }
  return mix;
}

/** Mediana mondiale del danno settimanale per cittadino: il termine di
 *  paragone di S5. Ricalcolata ad ogni giro perché il mondo cambia. */
function weeklyDamagePerCitizenMedian(nations) {
  const values = nations
    .map(n => n.rankings?.weeklyCountryDamagesPerCitizen?.value || 0)
    .filter(Boolean)
    .sort((a, b) => a - b);
  return values.length ? values[Math.floor(values.length / 2)] : 0;
}

function hasDiplomaticTie(nation, patron) {
  if (!nation || !patron) return false;
  return (!!nation.allianceId && nation.allianceId === patron.allianceId)
    || (nation.defensivePacts || []).includes(patron._id)
    || (patron.defensivePacts || []).includes(nation._id)
    || (nation.allies || []).includes(patron._id)
    || (patron.allies || []).includes(nation._id);
}

/**
 * Il punteggio di UNA nazione. Ritorna null quando non c'è abbastanza
 * materiale per dire qualcosa: meglio nessun rilevamento che un
 * rilevamento su tre persone.
 *
 * `evidence` è la parte che l'interfaccia mostra: chiavi i18n più i numeri
 * che le riempiono, così la percentuale resta spiegabile riga per riga.
 */
function scoreNation(nation, mix, medianDamage, nationById) {
  const row = mix.get(nation._id);
  if (!row) return null;

  const known = [...row.values()].reduce((a, b) => a + b, 0);
  if (known < MIN_KNOWN) return null;

  const foreign = [...row.entries()]
    .filter(([countryId]) => countryId !== nation._id)
    .sort((a, b) => b[1] - a[1]);
  if (!foreign.length) return null;

  const [patronId, count] = foreign[0];
  const share = count / known;
  const confidence = Math.min(1, known / FULL_CONF_N);

  let odds = (PRIOR / (1 - PRIOR)) * Math.exp(W_SHARE * (share - F_NEUTRAL) * confidence);
  const evidence = [{ key: 'radar_ev_units', share: Math.round(share * 100), count, known, patronId }];

  const patron = nationById.get(patronId);
  if (patron) {
    if (hasDiplomaticTie(nation, patron)) {
      odds *= LR_LINK;
      evidence.push({ key: 'radar_ev_tie' });
    } else {
      odds *= LR_NO_LINK;
      evidence.push({ key: 'radar_ev_no_tie' });
    }
    if ((nation.warsWith || []).includes(patron._id)) {
      odds *= LR_AT_WAR;
      evidence.push({ key: 'radar_ev_at_war' });
    }
  }

  const perCitizen = nation.rankings?.weeklyCountryDamagesPerCitizen?.value || 0;
  const ratio = medianDamage ? perCitizen / medianDamage : 0;
  if (ratio >= 2) {
    odds *= LR_HIGH_DMG;
    evidence.push({ key: 'radar_ev_damage', ratio: Math.round(ratio * 10) / 10 });
  } else if (ratio > 0 && ratio < 1) {
    odds *= LR_LOW_DMG;
  }

  return {
    countryId: nation._id,
    patronId,
    p: odds / (1 + odds),
    share,
    known,
    evidence,
    source: 'radar',
  };
}

/**
 * Calcola il radar. Una volta per sessione: la directory MU cambia ogni
 * mezz'ora lato server e nulla qui giustifica di rifarlo più spesso.
 *
 * Non lancia MAI: se la directory non arriva (server di cache giù, rete
 * lenta) il radar resta vuoto e la vista Sphere resta senza sfere, senza
 * rompere il resto. Stessa regola di
 * src/diplomacy/cacheClient.js — questo è un potenziamento, non un nuovo
 * punto di rottura.
 */
export function runRadar() {
  if (_radar) return Promise.resolve(_radar);
  if (_promise) return _promise;

  _promise = (async () => {
    try {
      const nations = state.nazioniGlobal || [];
      if (!nations.length) return new Map();

      // Prima si chiede al server di cache: il suo punteggio include anche
      // la lingua di chi governa, che dal browser costerebbe ~1.600
      // chiamate (server/proxyIndex.js). Se risponde, si evita pure di
      // scaricare la directory MU — sono ~140 KB gzip contro una manciata.
      const fromServer = await fetchServerIndex();
      if (fromServer?.length) {
        _radar = new Map(fromServer
          .filter(row => row?.countryId && typeof row.p === 'number')
          .map(row => [row.countryId, { ...row, source: 'server' }]));
        return _radar;
      }

      const { fetchMuDirectory } = await import('../mu/api.js');
      const directory = await fetchMuDirectory();
      if (!Array.isArray(directory) || !directory.length) return new Map();

      const mix = buildMuMix(directory);
      const medianDamage = weeklyDamagePerCitizenMedian(nations);
      const nationById = new Map(nations.map(n => [n._id, n]));

      const out = new Map();
      for (const nation of nations) {
        const hit = scoreNation(nation, mix, medianDamage, nationById);
        // Stesso taglio del server (server/proxyIndex.js): vedi lì la nota
        // sulla ritaratura contro i cluster di migrazione.
        if (hit && hit.p >= 0.40) out.set(nation._id, hit);
      }
      _radar = out;
      return out;
    } catch (err) {
      console.warn('WarEra+ radar proxy: calcolo non riuscito, nessuna sfera:', err.message);
      _radar = new Map();
      return _radar;
    }
  })();

  _promise.catch(() => { _promise = null; });
  return _promise;
}

/**
 * Punto d'innesto per il punteggio calcolato dal server di cache
 * (server/proxyIndex.js, non ancora deployato), che include anche i
 * segnali che dal browser non si possono avere — lingua di chi governa e
 * storia delle cittadinanze. Sostituisce i rilevamenti locali per le
 * nazioni che il server copre, lasciando gli altri dove sono.
 */
export function applyServerIndex(rows) {
  if (!Array.isArray(rows) || !rows.length) return;
  if (!_radar) _radar = new Map();
  for (const row of rows) {
    if (!row?.countryId || typeof row.p !== 'number') continue;
    _radar.set(row.countryId, { ...row, source: 'server' });
  }
}

/** Nazioni rilevate che vanno DISEGNATE, dato lo stato del toggle. */
export function detectionsForMap() {
  const all = getDetections();
  return state.showAllDetectedProxies ? all : all.filter(d => d.p >= MAP_THRESHOLD);
}

/**
 * Le sfere come vanno MOSTRATE: quelle che il radar ha trovato, raggruppate
 * per potenza.
 *
 * Una potenza con proxy suoi (sopra la soglia) non compare come proxy di
 * qualcun altro: dal 2026-11-12, tolto il CSV che lo garantiva, è questa
 * regola a impedire che l'Italia — che ha cittadini in unità straniere come
 * chiunque — finisca nella sfera di un'altra.
 *
 * @param {{forMap?: boolean}} opts  forMap applica la soglia del 75% e il
 *   toggle; l'elenco del pannello invece mostra tutto, con le percentuali.
 */
export function mergedSphereGroups({ forMap = false } = {}) {
  const detections = forMap ? detectionsForMap() : getDetections();
  const patrons = new Set(detections.filter(d => d.p >= MAP_THRESHOLD).map(d => d.patronId));
  const groups = new Map();
  for (const d of detections) {
    if (patrons.has(d.countryId)) continue;
    let g = groups.get(d.patronId);
    if (!g) {
      groups.set(d.patronId, g = {
        primaryId: d.patronId,
        primaryName: state.nationMap.get(d.patronId)?.name || '',
        proxies: [],
      });
    }
    g.proxies.push({ id: d.countryId, source: 'radar', p: d.p });
  }
  return [...groups.values()];
}

/** I proxy di UNA potenza. */
export function proxiesOfPrimary(primaryId, opts) {
  return mergedSphereGroups(opts).find(g => g.primaryId === primaryId)?.proxies || [];
}

/** Una nazione è una potenza se ha almeno un proxy rilevato. */
export function isSpherePrimary(nationId, opts) {
  return mergedSphereGroups(opts).some(g => g.primaryId === nationId);
}

/** La potenza di riferimento di una nazione, dal radar: serve al click sulla
 *  mappa e nel pannello, che devono aprire la sfera giusta anche per un
 *  proxy con una sicurezza bassa. */
export function patronOf(nationId) {
  return _radar?.get(nationId)?.patronId || null;
}
