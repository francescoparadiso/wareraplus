/* ══════════════════════════════════════════════════════════════
   WarEra+ — Grafico Parlamento & Governo (nativo, nessun iframe)
   ------------------------------------------------------------------
   Componente NUOVO, disegnato appositamente per riempire la colonna
   del pannello nazione — non è una vista di Political View incorporata
   (quell'approccio, testato, prendeva il layout mobile ed era comunque
   "un tool dentro un tool"). Qui si costruisce un emiciclo SVG da zero:

   - Fette colorate ad anello (una per partito, sull'intervallo angolare
     occupato dai suoi seggi) come sfondo.
   - Seggi individuali sopra, cerchio colorato + avatar del player se
     disponibile.

   L'algoritmo di distribuzione dei seggi su più archi concentrici è
   ispirato a quello di senate.js (_computeSemicircleLayout): stessa
   idea — più righe, capacità per riga proporzionale alla lunghezza
   dell'arco — ma riscritto qui in versione più semplice, tarata su
   una larghezza fissa di colonna invece che sull'intera finestra.

   Dati: fetch diretto via trpcBatch (stesso client già usato da
   Diplomacy in utils.js) verso le stesse procedure tRPC ufficiali
   usate da Political View (election.*, government.*, user.*, party.*),
   senza passare dal Worker proxy (non necessario per il volume di
   chiamate di questo componente).
   ══════════════════════════════════════════════════════════════ */

import { trpcBatch, hashColor, escapeHtml } from '../diplomacy/utils.js';
import { fetchPartiesDetailViaCache, fetchElectionsForCountryViaCache, fetchElectionDetailViaCache } from '../diplomacy/cacheClient.js';
import { t } from '../shared/i18n.js';

// Cache leggera per country: evita di rifare tutte le fetch se l'utente
// riseleziona la stessa nazione più volte nella stessa sessione.
// Separata per fase: _cacheSeats (elezioni+governo+partiti, senza utenti)
// e _cacheUsers (solo avatar/nomi), coerente con la fetch in due fasi.
const _cacheSeats = new Map(); // countryId -> seatsResult | Promise
const _cacheUsers = new Map(); // countryId -> Map(userId -> user) | Promise

// Guardia anti-race-condition: se l'utente clicca rapidamente più
// nazioni in sequenza (es. A -> B -> di nuovo A), le fetch partono in
// parallelo e possono risolversi in un ordine diverso da quello dei
// click. Ogni chiamata a renderParliamentChart cattura un token PER
// CONTENITORE (WeakMap, non un contatore globale condiviso): un
// contatore unico avrebbe fatto abortire tutti i grafici tranne
// l'ultimo quando se ne renderizzano più contemporaneamente (es. il
// pannello blocco, un grafico per ogni nazione membro).
const _renderTokens = new WeakMap(); // container -> token

function _unwrapList(res) {
  if (!res) return [];
  if (Array.isArray(res)) return res;
  if (Array.isArray(res.items)) return res.items;
  if (Array.isArray(res.docs)) return res.docs;
  if (Array.isArray(res.results)) return res.results;
  return [];
}

/* ── FETCH DATI — FASE 1: seggi + governo (SENZA avatar/nomi player) ──
   Separata dalla fase utenti (sotto) su richiesta esplicita: con blocchi
   da 15-20+ nazioni, caricare TUTTO insieme (seggi + governo + nomi
   partito + avatar di ogni player eletto) per ogni nazione contemporaneamente
   generava troppe richieste in rapida successione → 429 anche passando dal
   Worker. Separando in due fasi, la fase 1 (più leggera: niente
   user.getUserLite, spesso la chiamata più pesante per nazioni con molti
   seggi) può completarsi per TUTTE le nazioni del blocco prima di avviare
   la fase 2 (avatar), riducendo il picco di richieste simultanee. */
async function fetchParliamentSeatsData(countryId) {
  // 1) elezioni del paese → individua l'ultimo congresso.
  // WarEra+: dalla cache Oracle (server/warera-cache-server.js:pollElections)
  // invece che dal Worker — vedi cacheClient.js.
  const electionsRaw = await fetchElectionsForCountryViaCache(countryId).catch(() => []);
  const elections = _unwrapList(electionsRaw)
    .filter(e => e.type === 'congress')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  const latestCongress = elections[elections.length - 1];

  // 2) dettaglio ultimo congresso (cache Oracle) + governo (resta su
  //    trpcBatch/Worker: nessun equivalente cache per government.getByCountryId
  //    in questo progetto)
  const [electionDetail, [gov]] = await Promise.all([
    latestCongress ? fetchElectionDetailViaCache(latestCongress._id).catch(() => null) : Promise.resolve(null),
    trpcBatch([['government.getByCountryId', { countryId }]], { useWorker: true }),
  ]);

  const candidates = (electionDetail?.candidates || []).filter(c => c.isElected);

  // 3) SOLO nomi partito (batch, id unici) — gli utenti arrivano in fase 2.
  // WarEra+: dalla cache Oracle (server/warera-cache-server.js:pollParties)
  // invece che dal Worker direttamente — vedi cacheClient.js.
  const partyIds = [...new Set(candidates.map(c => c.party || c.partyId).filter(Boolean))];
  const partyMap = partyIds.length ? await fetchPartiesDetailViaCache(partyIds) : new Map();

  const seats = candidates.map(c => {
    const partyId = c.party || c.partyId || 'unknown';
    const party = partyMap.get(partyId);
    return {
      partyId,
      partyName: party?.name || partyId,
      color: hashColor(String(partyId)),
      userId: c.user || c.userId || null,
      username: null,   // popolato in fase 2 (fetchParliamentUserData)
      avatarUrl: null,  // idem
    };
  });

  const govRoleKeys = ['president', 'vicePresident', 'minOfDefense', 'minOfEconomy', 'minOfForeignAffairs'];
  const govRoleIds = gov ? Object.fromEntries(govRoleKeys.map(k => [k, gov[k] || null])) : null;

  return { seats, govRoleIds, electionDate: latestCongress?.createdAt || null };
}

/* ── FETCH DATI — FASE 2: avatar/nomi dei player (candidati eletti +
   membri del governo) — chiamata separatamente, tipicamente più tardi
   e con calma maggiore quando ci sono molte nazioni in coda (vedi
   countryPanel.js: pannello blocco). ── */
async function fetchParliamentUserData(seatsResult) {
  const candidateUserIds = seatsResult.seats.map(s => s.userId).filter(Boolean);
  const govUserIds = seatsResult.govRoleIds ? Object.values(seatsResult.govRoleIds).filter(Boolean) : [];
  const allUserIds = [...new Set([...candidateUserIds, ...govUserIds])];
  if (!allUserIds.length) return new Map();

  const results = await trpcBatch(allUserIds.map(id => ['user.getUserLite', { userId: id }]), { useWorker: true });
  const userMap = new Map();
  allUserIds.forEach((id, i) => { if (results[i]) userMap.set(id, results[i]); });
  return userMap;
}

/* Unisce i dati utente (fase 2) alla struttura seggi/governo (fase 1),
   producendo la forma finale attesa da buildSvg/buildGovernmentHtml. */
function _mergeUserData(seatsResult, userMap) {
  const seats = seatsResult.seats.map(s => {
    const user = s.userId ? userMap.get(s.userId) : null;
    return { ...s, username: user?.username || null, avatarUrl: user?.avatarUrl || null };
  });

  let government = null;
  if (seatsResult.govRoleIds) {
    const roleDataKeys = {
      president: 'presidentData',
      vicePresident: 'vicePresidentData',
      minOfDefense: 'minOfDefenseData',
      minOfEconomy: 'minOfEconomyData',
      minOfForeignAffairs: 'minOfForeignAffairsData',
    };
    government = {};
    Object.entries(seatsResult.govRoleIds).forEach(([role, uid]) => {
      government[roleDataKeys[role]] = uid ? (userMap.get(uid) || null) : null;
    });
  }

  return { seats, government };
}

/* ── FETCH DI GRUPPO (WarEra+) ──
   Le funzioni fetchParliamentSeatsData/fetchParliamentUserData sopra
   raggruppano le chiamate DENTRO una singola nazione (es. dettaglio
   elezione + governo in un'unica richiesta), ma restano comunque ~3
   richieste HTTP sequenziali PER NAZIONE. Con un blocco di 21 membri,
   anche scaglionando l'AVVIO di ciascuna nazione, il totale restava
   ~60+ richieste in pochi secondi — non davvero "raggruppato tra
   nazioni", da qui la sensazione (corretta) che il batching non
   funzionasse per i blocchi.

   Queste due funzioni raggruppano la STESSA fase su un intero gruppo di
   nazioni in un numero FISSO di richieste (circa 3 per la fase seggi,
   1 per la fase avatar), indipendentemente da quante nazioni compongono
   il gruppo — lo stesso principio già usato da trpcBatch per unire più
   procedure in un solo POST, applicato qui su più nazioni insieme
   invece che sui singoli passaggi di una nazione sola. Popolano le
   stesse cache (_cacheSeats/_cacheUsers) usate dalle funzioni di
   rendering per-nazione, che quindi non devono cambiare: renderParliamentSeats/
   renderParliamentAvatars trovano i dati già pronti e non rifanno
   fetch. ── */

export async function fetchGroupSeatsData(countryIds) {
  const idsToFetch = countryIds.filter(id => !_cacheSeats.has(id));
  if (!idsToFetch.length) return;

  // 1) elezioni di TUTTE le nazioni del gruppo — dalla cache Oracle, una
  //    fetch per nazione ma verso il server di cache (non il Worker),
  //    quindi nessun rischio 429: vedi cacheClient.js/
  //    server/warera-cache-server.js:pollElections.
  const electionsResults = await Promise.all(
    idsToFetch.map(id => fetchElectionsForCountryViaCache(id).catch(() => []))
  );

  const latestCongressByCountry = new Map(); // countryId -> election | null
  idsToFetch.forEach((id, i) => {
    const elections = _unwrapList(electionsResults[i])
      .filter(e => e.type === 'congress')
      .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
    latestCongressByCountry.set(id, elections[elections.length - 1] || null);
  });

  // 2) dettaglio elezione (cache Oracle, per nazione) + governo di TUTTE
  //    le nazioni in un'unica richiesta batch (government.getByCountryId
  //    resta su trpcBatch/Worker: nessun equivalente cache in questo progetto)
  const idsWithElection = idsToFetch.filter(id => latestCongressByCountry.get(id));
  const [electionDetails, govResults] = await Promise.all([
    Promise.all(idsWithElection.map(id => fetchElectionDetailViaCache(latestCongressByCountry.get(id)._id).catch(() => null))),
    trpcBatch(idsToFetch.map(id => ['government.getByCountryId', { countryId: id }]), { useWorker: true }),
  ]);

  const electionDetailByCountry = new Map();
  idsWithElection.forEach((id, i) => electionDetailByCountry.set(id, electionDetails[i]));
  const govByCountry = new Map();
  idsToFetch.forEach((id, i) => govByCountry.set(id, govResults[i]));

  // 3) candidati eletti per nazione + party id UNICI su tutto il gruppo,
  //    in un'unica richiesta batch
  const candidatesByCountry = new Map();
  const allPartyIds = new Set();
  idsToFetch.forEach(id => {
    const detail = electionDetailByCountry.get(id);
    const candidates = (detail?.candidates || []).filter(c => c.isElected);
    candidatesByCountry.set(id, candidates);
    candidates.forEach(c => { const p = c.party || c.partyId; if (p) allPartyIds.add(p); });
  });

  // WarEra+: dalla cache Oracle invece che dal Worker — vedi cacheClient.js.
  const partyIdsArr = [...allPartyIds];
  const partyMap = partyIdsArr.length ? await fetchPartiesDetailViaCache(partyIdsArr) : new Map();

  // 4) costruisce e salva in cache il risultato per OGNI nazione del gruppo
  const govRoleKeys = ['president', 'vicePresident', 'minOfDefense', 'minOfEconomy', 'minOfForeignAffairs'];
  idsToFetch.forEach(id => {
    const candidates = candidatesByCountry.get(id) || [];
    const seats = candidates.map(c => {
      const partyId = c.party || c.partyId || 'unknown';
      const party = partyMap.get(partyId);
      return {
        partyId,
        partyName: party?.name || partyId,
        color: hashColor(String(partyId)),
        userId: c.user || c.userId || null,
        username: null,
        avatarUrl: null,
      };
    });
    const gov = govByCountry.get(id);
    const govRoleIds = gov ? Object.fromEntries(govRoleKeys.map(k => [k, gov[k] || null])) : null;
    const latest = latestCongressByCountry.get(id);
    _cacheSeats.set(id, { seats, govRoleIds, electionDate: latest?.createdAt || null });
  });
}

export async function fetchGroupUserData(countryIds) {
  const idsNeeding = countryIds.filter(id => _cacheSeats.has(id) && !_cacheUsers.has(id));
  if (!idsNeeding.length) return;

  const seatsPairs = await Promise.all(idsNeeding.map(async id => {
    const cached = _cacheSeats.get(id);
    return [id, cached instanceof Promise ? await cached : cached];
  }));

  // Un'unica richiesta batch per gli avatar di TUTTE le nazioni del gruppo.
  const allUserIds = new Set();
  seatsPairs.forEach(([, sr]) => {
    if (!sr) return;
    sr.seats.forEach(s => { if (s.userId) allUserIds.add(s.userId); });
    if (sr.govRoleIds) Object.values(sr.govRoleIds).forEach(uid => { if (uid) allUserIds.add(uid); });
  });

  const idsArr = [...allUserIds];
  const results = idsArr.length
    ? await trpcBatch(idsArr.map(id => ['user.getUserLite', { userId: id }]), { useWorker: true })
    : [];
  const sharedUserMap = new Map();
  idsArr.forEach((id, i) => { if (results[i]) sharedUserMap.set(id, results[i]); });

  // Tutte le nazioni del gruppo condividono la STESSA mappa: contiene
  // l'unione degli id necessari a tutto il gruppo, ma i lookup per
  // singolo userId restano corretti per ciascuna nazione.
  idsNeeding.forEach(id => _cacheUsers.set(id, sharedUserMap));
}

/** Vero se i dati "seggi" di questa nazione sono già in cache (nessuna
 *  nuova fetch necessaria) — usato per evitare fetch accidentali su
 *  nazioni non ancora caricate (es. durante un resize del pannello). */
export function hasParliamentSeatsCached(countryId) {
  return _cacheSeats.has(countryId);
}

/* ── LAYOUT AD ARCO (ispirato a senate.js:_computeSemicircleLayout) ──
   Fix rispetto alla prima versione: quella legava innerR alla sola
   larghezza (`availW * 0.16`) ma il numero di righe restava comunque
   vincolato dall'altezza fissa — su pannelli larghi innerR cresceva
   oltre l'altezza disponibile, il ciclo si fermava sempre a 1 riga, e
   per far entrare tutti i seggi in una singola riga sempre più larga
   l'unica leva rimasta era rimpicciolire seatSize: risultato,
   "pannello più largo → avatar più piccoli". Qui invece si esplora la
   combinazione (scala, numero di righe) esattamente come senate.js:
   più righe è un'opzione esplicita, non conseguenza indiretta di un
   parametro accoppiato alla larghezza. */
function computeArcLayout(n, availW, availH) {
  if (n === 0) return null;

  const baseSeatSize = Math.min(30, Math.max(10, availW / (n * 0.35 + 6)));
  let fallback = null;

  for (let scale = 1; scale >= 0.3; scale -= 0.05) {
    const seatSize = Math.max(6, baseSeatSize * scale);
    const rowGap = seatSize * 1.3;

    for (let rowCount = 1; rowCount <= 6; rowCount++) {
      const innerR = Math.min(availW * 0.42, Math.max(seatSize * 1.3, availW * 0.14));
      const outerR = innerR + (rowCount - 1) * rowGap;
      // Vincoli indipendenti: il semicerchio non deve superare né la
      // larghezza (diametro = 2*outerR) né l'altezza disponibile
      // (outerR, dato che l'arco si sviluppa da un baseline in basso).
      if (outerR * 2 > availW) continue;
      if (outerR + seatSize > availH) continue;

      const rows = [];
      let totalCap = 0;
      for (let i = 0; i < rowCount; i++) {
        const radius = innerR + i * rowGap;
        const cap = Math.max(1, Math.floor((Math.PI * radius) / (seatSize * 1.25)));
        rows.push({ radius, cap });
        totalCap += cap;
      }

      if (totalCap >= n) {
        return { rows, seatSize };
      }
      if (!fallback || totalCap > fallback.totalCap) {
        fallback = { rows, seatSize, totalCap };
      }
    }
  }

  // Estremo: nessuna combinazione trovata entro i limiti (contenitore
  // minuscolo) — usa comunque la migliore capacità trovata, forzando
  // tutti i seggi su di essa (mai persi, come in senate.js:_distributeForce).
  return fallback ? { rows: fallback.rows, seatSize: fallback.seatSize } : null;
}

function distributeSeats(n, rows) {
  const capSum = rows.reduce((s, r) => s + r.cap, 0);
  const counts = rows.map(r => Math.floor(n * r.cap / capSum));
  let diff = n - counts.reduce((a, b) => a + b, 0);
  for (let i = 0; diff > 0 && i < counts.length; i++) {
    while (diff > 0 && counts[i] < rows[i].cap) { counts[i]++; diff--; }
  }
  let i = 0;
  while (diff > 0) { counts[i % counts.length]++; diff--; i++; }
  return counts;
}

/* Raggruppa i seggi per partito (contigui, dal più numeroso), come in
   senate.js:_groupSeatsForArc — così le "fette" colorate hanno senso. */
function groupSeatsByParty(seats) {
  const map = new Map();
  seats.forEach(s => {
    if (!map.has(s.partyId)) map.set(s.partyId, []);
    map.get(s.partyId).push(s);
  });
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length);
}

/* ── RENDER SVG ── */
// WarEra+ fix: gli id SVG (clipPath) sono globali al documento, non
// scoped al singolo <svg>. Con un solo grafico attivo (pannello nazione)
// non si notava, ma nel pannello blocco più parlamenti coesistono nella
// pagina insieme: senza un prefisso univoco per istanza, tutti
// generavano gli stessi id (wp-seat-clip-0, -1, ...) e i riferimenti
// url(#wp-seat-clip-0) finivano per puntare al cerchio SBAGLIATO (di un
// altro grafico) — causa degli avatar "che non caricano bene" segnalati,
// in realtà clippati sulla posizione di un seggio di un'altra nazione.
let _svgInstanceCounter = 0;

function buildSvg(seats, width, height) {
  const svgInstanceId = ++_svgInstanceCounter;
  const n = seats.length;
  const availW = width - 16;
  const availH = height - 8;
  const layout = computeArcLayout(n, availW, availH);
  if (!layout) return `<div class="wp-parliament-empty-msg">${t('no_arc_data')}</div>`;

  const { rows, seatSize } = layout;
  const counts = distributeSeats(n, rows);
  const grouped = groupSeatsByParty(seats);

  const cx = width / 2;
  const cy = height - 10;
  const angleStart = Math.PI; // 180°, sinistra
  const angleEnd = 0;         // 0°, destra

  // ── Fix allineato a senate.js:_renderSemicircle ──
  // L'errore precedente: riempivo una riga (un solo raggio) per volta,
  // così ogni partito finiva spezzato su archi interi invece che in uno
  // spicchio coerente sinistra→destra. senate.js genera invece TUTTI i
  // punti di TUTTE le righe insieme, poi li ordina globalmente per
  // posizione (sinistra→destra) prima di assegnare i seggi in sequenza:
  // così il primo partito (il più numeroso) occupa la fascia più a
  // sinistra su tutti i raggi contemporaneamente, poi il secondo, ecc.
  const orderedSeats = grouped.flatMap(([, list]) => list);
  const points = [];
  rows.forEach((row, rowIdx) => {
    const countInRow = counts[rowIdx];
    for (let i = 0; i < countInRow; i++) {
      const t = countInRow === 1 ? 0.5 : i / (countInRow - 1);
      const angle = angleStart + (angleEnd - angleStart) * t;
      const x = cx + row.radius * Math.cos(angle);
      const y = cy - row.radius * Math.sin(angle);
      points.push({ x, y, angle, radius: row.radius, rowIdx });
    }
  });
  points.sort((a, b) => a.x - b.x); // globalmente, sinistra → destra

  const positioned = [];
  for (let i = 0; i < points.length; i++) {
    const seat = orderedSeats[i];
    if (!seat) break;
    positioned.push({ seat, ...points[i] });
  }

  // Fette colorate: spicchi PIENI dal centro (cx, cy) fino a outerR.
  // Fix rispetto alla versione precedente: calcolavo i confini di ogni
  // fetta dagli angoli REALI min/max dei singoli seggi di quel partito,
  // con un margine fisso piccolo (pad=0.02 rad) per farle "toccare" —
  // ma lo spazio angolare reale tra l'ultimo seggio di un partito e il
  // primo del successivo può essere più ampio di quel margine (dipende
  // da quanti seggi ci sono per riga), lasciando un vuoto visibile
  // (lo sfondo scuro tra le fette nell'immagine segnalata). Qui invece
  // i confini sono calcolati in modo puramente PROPORZIONALE al numero
  // di seggi di ciascun partito sul totale, indipendentemente da dove
  // cadono fisicamente i singoli seggi: questo garantisce che le fette
  // si tassellino esattamente, senza vuoti né sovrapposizioni, coprendo
  // l'intero angolo 180°→0° dell'emiciclo.
  const outerR = rows[rows.length - 1].radius + seatSize * 0.9;
  const totalSeats = orderedSeats.length;
  let _cursor = 0;
  const wedges = grouped.map(([, list]) => {
    const startFrac = _cursor / totalSeats;
    _cursor += list.length;
    const endFrac = _cursor / totalSeats;
    const start = angleStart + (angleEnd - angleStart) * startFrac;
    const end = angleStart + (angleEnd - angleStart) * endFrac;
    const color = list[0].color;
    return _pieWedgePath(cx, cy, outerR, start, end, color);
  }).join('');

  const clipDefs = positioned.filter(p => p.seat.avatarUrl).map((p, i) => `
    <clipPath id="wp-seat-clip-${svgInstanceId}-${i}"><circle cx="${p.x}" cy="${p.y}" r="${seatSize / 2}" /></clipPath>
  `).join('');

  let avatarIdx = 0;
  const seatEls = positioned.map(p => {
    const r = seatSize / 2;
    const title = escapeHtml(p.seat.username || p.seat.partyName || 'Seggio');
    if (p.seat.avatarUrl) {
      const clipId = `wp-seat-clip-${svgInstanceId}-${avatarIdx++}`;
      return `
        <g>
          <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${p.seat.color}" />
          <image href="${p.seat.avatarUrl}" x="${p.x - r}" y="${p.y - r}" width="${seatSize}" height="${seatSize}" clip-path="url(#${clipId})" preserveAspectRatio="xMidYMid slice" />
          <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="none" stroke="${p.seat.color}" stroke-width="1.5" />
          <title>${title}</title>
        </g>`;
    }
    return `
      <circle cx="${p.x}" cy="${p.y}" r="${r}" fill="${p.seat.color}" stroke="rgba(255,255,255,0.25)" stroke-width="1">
        <title>${title}</title>
      </circle>`;
  }).join('');

  return `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg">
      <defs>${clipDefs}</defs>
      <g opacity="0.28">${wedges}</g>
      ${seatEls}
    </svg>
  `;
}

function _pieWedgePath(cx, cy, r, a0, a1, color) {
  const p = (a) => [cx + r * Math.cos(a), cy - r * Math.sin(a)];
  const [x0, y0] = p(a0);
  const [x1, y1] = p(a1);
  const largeArc = Math.abs(a0 - a1) > Math.PI ? 1 : 0;
  return `<path d="M ${cx} ${cy} L ${x0} ${y0} A ${r} ${r} 0 ${largeArc} 1 ${x1} ${y1} Z" fill="${color}" />`;
}

/* ── GOVERNO (box nativo, non riusa DOM/CSS di Political) ── */
function buildGovernmentHtml(gov) {
  if (!gov || !gov.presidentData) return '';
  const roles = [
    ['presidentData', t('role_president'), true],
    ['vicePresidentData', t('role_vp'), false],
    ['minOfDefenseData', t('role_defense'), false],
    ['minOfEconomyData', t('role_economy'), false],
    ['minOfForeignAffairsData', t('role_foreign'), false],
  ];
  const memberHtml = (user, label, big) => {
    if (!user) return '';
    const avatar = user.avatarUrl
      ? `<img src="${user.avatarUrl}" class="wp-gov-avatar${big ? ' wp-gov-avatar-big' : ''}" alt="" loading="lazy">`
      : `<div class="wp-gov-avatar${big ? ' wp-gov-avatar-big' : ''} wp-gov-avatar-fallback">👤</div>`;
    return `
      <div class="wp-gov-member${big ? ' wp-gov-member-president' : ''}">
        ${avatar}
        <div class="wp-gov-member-info">
          <div class="wp-gov-member-name">${escapeHtml(user.username || '—')}</div>
          <div class="wp-gov-member-role">${label}</div>
        </div>
      </div>`;
  };
  return `
    <div class="wp-gov-box">
      ${roles.map(([key, label, big]) => memberHtml(gov[key], label, big)).join('')}
    </div>
  `;
}

/* ── ENTRY POINT — FASE 1: seggi colorati (senza avatar), veloce.
   Non mostra il box governo (richiede gli utenti, fase 2). ── */
export async function renderParliamentSeats(container, countryId) {
  const myToken = (_renderTokens.get(container) || 0) + 1;
  _renderTokens.set(container, myToken);
  container.innerHTML = `<div class="wp-parliament-loading">${t('loading_parliament')}</div>`;

  let seatsResult;
  try {
    if (_cacheSeats.has(countryId)) {
      const cached = _cacheSeats.get(countryId);
      seatsResult = cached instanceof Promise ? await cached : cached;
    } else {
      const promise = fetchParliamentSeatsData(countryId);
      _cacheSeats.set(countryId, promise);
      seatsResult = await promise;
      _cacheSeats.set(countryId, seatsResult);
    }
  } catch (err) {
    console.error('WarEra+ parliamentChart: errore fetch seggi', err);
    if (myToken !== _renderTokens.get(container)) return;
    container.innerHTML = `<div class="wp-parliament-empty-msg">${t('cannot_load_parliament')}</div>`;
    return;
  }

  if (myToken !== _renderTokens.get(container)) return; // richiesta più recente già partita su questo contenitore

  if (!seatsResult.seats.length) {
    container.innerHTML = `<div class="wp-parliament-empty-msg">${t('no_congress_election')}</div>`;
    return;
  }

  // Prima inseriamo un contenitore vuoto con l'altezza definita via CSS
  // (shell.css: .wp-parliament-svg-wrap), poi ne leggiamo le dimensioni
  // REALI per calcolare il layout — invece di un'altezza fissa hardcoded
  // in JS, che non seguiva lo spazio realmente disponibile.
  container.innerHTML = `<div class="wp-parliament-svg-wrap"></div>`;
  const wrapEl = container.querySelector('.wp-parliament-svg-wrap');
  const rect = wrapEl.getBoundingClientRect();
  const width = Math.max(200, rect.width || 320);
  const height = Math.max(150, rect.height || 240);

  if (myToken !== _renderTokens.get(container)) return;
  wrapEl.innerHTML = buildSvg(seatsResult.seats, width, height);
}

/* ── ENTRY POINT — FASE 2: avatar dei player + box governo. Richiede
   che renderParliamentSeats sia già stata chiamata per questo
   contenitore/nazione (legge dalla cache di fase 1); se non lo è, esce
   senza fare nulla invece di duplicare il lavoro. ── */
export async function renderParliamentAvatars(container, countryId) {
  if (!_cacheSeats.has(countryId)) return;
  let seatsResult;
  try {
    const cached = _cacheSeats.get(countryId);
    seatsResult = cached instanceof Promise ? await cached : cached;
  } catch (_) { return; }
  if (!seatsResult || !seatsResult.seats.length) return;

  const myToken = _renderTokens.get(container);
  if (!myToken) return; // questo contenitore non ha mai avviato un render valido

  let userMap;
  try {
    if (_cacheUsers.has(countryId)) {
      const cached = _cacheUsers.get(countryId);
      userMap = cached instanceof Promise ? await cached : cached;
    } else {
      const promise = fetchParliamentUserData(seatsResult);
      _cacheUsers.set(countryId, promise);
      userMap = await promise;
      _cacheUsers.set(countryId, userMap);
    }
  } catch (err) {
    console.warn('WarEra+ parliamentChart: errore fetch avatar (i seggi restano visibili senza avatar)', err);
    return;
  }

  // Nel frattempo questo contenitore ha iniziato a mostrare un'altra
  // nazione (es. si è cambiato blocco): non sovrascrivere.
  if (myToken !== _renderTokens.get(container)) return;

  const { seats, government } = _mergeUserData(seatsResult, userMap);
  const govHtml = buildGovernmentHtml(government);
  const wrapEl = container.querySelector('.wp-parliament-svg-wrap');
  if (!wrapEl) return; // il contenitore è stato sovrascritto (es. stato vuoto) nel frattempo
  const rect = wrapEl.getBoundingClientRect();
  const width = Math.max(200, rect.width || 320);
  const height = Math.max(150, rect.height || 240);
  wrapEl.innerHTML = buildSvg(seats, width, height);
  if (govHtml && !container.querySelector('.wp-gov-box')) {
    wrapEl.insertAdjacentHTML('beforebegin', govHtml);
  }
}

/* ── ENTRY POINT — comodo per il caso singola-nazione (pannello nazione):
   entrambe le fasi in sequenza, senza attese aggiuntive tra l'una e
   l'altra. Il pannello blocco invece chiama le due fasi separatamente
   e le scagliona (vedi countryPanel.js). ── */
export async function renderParliamentChart(container, countryId) {
  await renderParliamentSeats(container, countryId);
  await renderParliamentAvatars(container, countryId);
}