// damageTimeline.js
//
// ══════════════════════════════════════════════════════════════
// WarEra+ — Danno ora per ora e giocatori "pillati"
// ------------------------------------------------------------------
// Modulo a sé (stesso pattern di battleArchive.js e proxyIndex.js: riceve
// gli attrezzi del server per iniezione invece di duplicarli) che risponde
// a due domande che il gioco non risponde da nessuna parte:
//
//   1. «A che ora del giorno questa nazione picchia davvero?»
//   2. «Quanti dei suoi giocatori erano sotto pillola in quell'ora?»
//
// Le due cose stanno nello STESSO file e nella stessa griglia oraria
// apposta: la domanda vera non è nessuna delle due da sola, è se il picco
// di danno coincide col picco di pillole — cioè se la nazione si coordina
// o se ognuno spara per conto suo. Due file separati avrebbero significato
// due griglie da riallineare al momento di disegnarle.
//
// ── 1. DANNO ORARIO: perché serve accumularlo ─────────────────────
// WarEra pubblica solo il CUMULATO settimanale
// (`rankings.weeklyCountryDamages`, già dentro country.getAllCountries).
// Il danno di un'ora non esiste come dato e non è ricostruibile a
// ritroso: è la differenza fra due letture, e se nessuno ha letto un'ora
// fa quel numero è perso per sempre. Quindi questa serie ACCUMULA dal
// primo avvio e non si recupera indietro — stesso vincolo dei bonifici
// fra tesori (moneyTransfers.js) e della ricchezza unità
// (plusApi/wealth.js), e come là si dichiara con `coverageFrom` invece di
// far sembrare un buco di copertura uno zero.
//
// ⚠️ La tentazione da non seguire è l'archivio battaglie: `ad`/`dd` di
// battleArchive.js sono il danno TOTALE di uno schieramento a battaglia
// CONCLUSA. Spalmarlo sulle ore della battaglia produrrebbe una curva
// perfettamente credibile e inventata — il picco che si vedrebbe sarebbe
// quello delle battaglie aperte, non quello dei colpi. Meglio dire "da
// qui in qua" che disegnare una linea finta.
//
// Il campione si prende una volta all'ora dalla cache `countries` (che
// pollCountries riscrive ogni 10 minuti): questo modulo non fa NESSUNA
// chiamata a WarEra per il danno.
//
// ── 2. PILLATI: perché invece questi si ricostruiscono ────────────
// La "pillola" è l'item `cocain`: +60% attacco per 8 ore, poi -60% per
// altre 15,5 (gameConfig.items.cocain.flatStats, letto dal vivo qui
// sotto — se il gioco ribilancia, ribilancia anche questo).
//
// `user.getUserLite` porta `buffs`, che è il regalo:
//     buff attivo   → { buffCodes: ['cocain'],   buffEndAt }
//     dopo-sbornia  → { debuffCodes: ['cocain'], debuffEndAt }
// Sono due timestamp FUTURI e fissi, quindi l'ora in cui la pillola è
// stata presa si calcola all'indietro ed è esatta:
//     in buff   → presa = buffEndAt − 8h
//     in debuff → presa = debuffEndAt − 8h − 15,5h  (= debuffEndAt − 23,5h)
// Cioè: un giocatore osservato in un qualunque momento dei 23,5 ore
// successive alla pillola ci dice a che ora precisa l'ha presa. Il
// cache-server rirosolve ogni cittadino con getUserLite almeno ogni 2 ore
// (REFRESH_WINDOW_MS nel file principale), quindi non ne sfugge nessuno,
// e — al contrario del danno — la curva delle prime 24 ore c'è già al
// primo giro, senza aspettare che l'archivio si riempia.
//
// Costo in chiamate: ZERO. `buffs` arriva dentro risposte che il server
// scarica già per lo stile di gioco e le statistiche cittadino; prima
// veniva buttato via. È lo stesso ragionamento che ha portato
// `citizenStats` dentro quella stessa risposta.
//
// ── DEDUP ──────────────────────────────────────────────────────────
// Lo stesso giocatore viene osservato più volte durante le sue 23,5 ore,
// e ogni volta racconta la STESSA pillola: `presa` esce identica al
// millisecondo da entrambe le fasi, quindi la chiave `userId|presa`
// riconosce l'evento già contato. Il set di dedup si pota a 26 ore (oltre
// non può più arrivare un'osservazione di quella pillola).
//
// ── FORMA SU DISCO ─────────────────────────────────────────────────
// Un file solo, `damage-timeline.json`, con gli id nazione in un indice
// e le ore come array di NUMERI posizionali: 180 nazioni × 360 ore ×
// due serie, scritte per esteso con la chiave-oggetto, sarebbero
// megabyte di id ripetuti. Così sta sotto il mezzo mega e si riscrive
// una volta all'ora.
// ══════════════════════════════════════════════════════════════

// Attrezzi iniettati dal server principale (vedi initDamageTimeline).
let trpcBatch = null;
let readCache = null;
let writeCache = null;

const TIMELINE_FILE = 'damage-timeline';

const HOUR_MS = 3600 * 1000;
const RETENTION_HOURS = 16 * 24;      // 16 giorni: i 14 chiesti dalla curva + margine
const DEDUP_MS = 26 * HOUR_MS;        // oltre, di una pillola non arriva più notizia
// Quanto può discostarsi da un'ora l'intervallo fra due campioni perché la
// differenza valga ancora come "danno di quell'ora" (vedi sampleDamage).
const MIN_SPAN_MS = 50 * 60 * 1000;
const MAX_SPAN_MS = 70 * 60 * 1000;
// Quanto ci mette il server principale a rirosolvere TUTTI i cittadini una
// volta: REFRESH_WINDOW_MS in warera-cache-server.js (2 ore), più un giro di
// margine. È il ritardo con cui una pillola presa adesso entra nel conto,
// quindi le ultime ore della curva possono ancora crescere e la vista le
// dichiara "in assestamento" invece di farle leggere come un calo.
const PILL_SWEEP_MS = 2.5 * HOUR_MS;

// Fallback se gameConfig non risponde: i valori misurati il 2026-09-08.
// Non sono "costanti del gioco" ma l'ultimo valore noto, per questo il
// modulo li rilegge (vedi refreshPillConfig).
const DEFAULT_BUFF_H = 8;
const DEFAULT_DEBUFF_H = 15.5;
const PILL_CODE = 'cocain';
const PILL_CONFIG_TTL_MS = 6 * HOUR_MS;

let _pillCfg = { buffH: DEFAULT_BUFF_H, debuffH: DEFAULT_DEBUFF_H, fetchedAt: 0, live: false };

function initDamageTimeline(tools) {
  trpcBatch = tools.trpcBatch;
  readCache = tools.readCache;
  writeCache = tools.writeCache;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

/** Inizio dell'ora UTC che contiene `ms`. UTC e non Europe/Rome: il giorno
 *  di gioco cambia a 00:00 UTC (gameConfig.getDates: nextDayAt), quindi i
 *  giorni della curva a 14 giorni cadono dove il gioco li fa cadere. Il
 *  client lo dichiara in interfaccia, come già fa l'archivio battaglie. */
const _hourFloor = (ms) => Math.floor(ms / HOUR_MS) * HOUR_MS;

const _num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function _emptyState() {
  return { startedAt: null, pillsFrom: null, ids: [], last: null, hours: {}, seen: {} };
}

function _readState() {
  const st = readCache(TIMELINE_FILE, null);
  if (!st || !Array.isArray(st.ids) || !st.hours) return _emptyState();
  return st;
}

function _writeState(st) {
  writeCache(TIMELINE_FILE, st, { compact: true });
}

/** Indice posizionale di una nazione, creandolo se è la prima volta che la
 *  si vede (nazioni nuove nascono, vedi la potatura in fondo al file). */
function _idx(st, countryId) {
  let i = st.ids.indexOf(countryId);
  if (i === -1) { st.ids.push(countryId); i = st.ids.length - 1; }
  return i;
}

/** Il secchio di un'ora, creandolo vuoto se non c'è.
 *  `d` = danno per nazione, `p` = pillati per nazione, `r` = in quest'ora
 *  il contatore settimanale è ripartito (vedi sampleDamage). */
function _bucket(st, hourTs) {
  const k = String(hourTs);
  if (!st.hours[k]) st.hours[k] = { d: [], p: [], r: 0 };
  return st.hours[k];
}

function _bump(arr, i, by) {
  while (arr.length <= i) arr.push(0);
  arr[i] += by;
}

function _set(arr, i, v) {
  while (arr.length <= i) arr.push(0);
  arr[i] = v;
}

// ---------------------------------------------------------------------------
// 1. DANNO ORARIO — campione dalla cache countries, nessuna fetch
// ---------------------------------------------------------------------------

/** Le nazioni come le ha lasciate pollCountries (stesso srotolamento che
 *  fa pollAlliances: la cache può contenere la risposta tRPC intera o già
 *  l'array, a seconda di quale poll l'ha scritta). */
function _cachedCountries() {
  const c = readCache('countries', null);
  const data = c?.data?.result?.data || c?.data || [];
  return Array.isArray(data) ? data : [];
}

/**
 * Chiude l'ora appena trascorsa: differenza fra il cumulato settimanale di
 * adesso e quello del campione precedente.
 *
 * ⚠️ Reset settimanale (lunedì 00:00 UTC): il cumulato riparte da zero e
 * la differenza sarebbe negativa. In quell'ora però il valore NUOVO è già
 * di per sé il danno fatto dal reset in poi, quindi si usa quello e si
 * marca l'ora come `r: 1` — il pezzo di ora PRIMA del reset è perso, e la
 * vista lo dichiara invece di far sembrare quell'ora un crollo.
 */
function sampleDamage() {
  const countries = _cachedCountries();
  if (!countries.length) {
    console.warn('[damage-timeline] cache countries vuota, campione saltato');
    return;
  }

  const now = Date.now();
  const st = _readState();
  if (!st.startedAt) st.startedAt = now;

  const w = [];                       // cumulato settimanale per indice
  for (const n of countries) {
    const v = _num(n?.rankings?.weeklyCountryDamages?.value);
    if (v == null) continue;
    _set(w, _idx(st, n._id), v);
  }

  const prev = st.last;
  const span = prev ? now - prev.ts : 0;

  // L'ora da chiudere è quella del campione PRECEDENTE: i campioni cadono a
  // inizio ora (cron a :02, subito dopo pollCountries), quindi l'intervallo
  // [12:02, 13:02] è l'ora 12 e va etichettato 12:00.
  //
  // ⚠️ Solo se l'intervallo è davvero un'ora. Dopo un riavvio pm2 i due
  // campioni distano quello che distano, e spalmare 18 minuti di danno
  // sull'etichetta di un'ora intera (o un buco di cinque ore su una sola)
  // darebbe un numero sbagliato e credibile. Quelle ore restano ASSENTI
  // dalla serie — chi disegna ci mette un buco, che è la verità: in
  // quell'ora il server non stava guardando.
  if (prev && Array.isArray(prev.w) && span >= MIN_SPAN_MS && span <= MAX_SPAN_MS) {
    const b = _bucket(st, _hourFloor(prev.ts));
    let resets = 0, counted = 0;

    for (let i = 0; i < w.length; i++) {
      const cur = w[i];
      const before = _num(prev.w[i]);
      if (before == null || cur == null) continue;   // nazione nuova: niente base
      counted++;
      if (cur < before) { resets++; _set(b.d, i, cur); }
      else _set(b.d, i, cur - before);
    }
    // Il reset è globale e simultaneo: se è sceso UNO solo è una correzione
    // del gioco, non l'inizio della settimana.
    if (counted && resets > counted / 2) b.r = 1;
  } else if (prev) {
    console.warn(`[damage-timeline] intervallo di ${Math.round(span / 60000)} min fra due campioni: ora saltata (riavvio o server fermo)`);
  }

  st.last = { ts: now, w };
  _prune(st, now);
  _writeState(st);

  const hours = Object.keys(st.hours).length;
  console.log(`[damage-timeline] campione preso: ${w.length} nazioni, ${hours} ore in archivio`);
}

// ---------------------------------------------------------------------------
// 2. PILLATI — ricostruzione da buffs, zero chiamate proprie
// ---------------------------------------------------------------------------

/** Durate della pillola dal gioco, una volta ogni 6 ore. Se non risponde
 *  restano le ultime note (o i default): meglio una curva con la durata di
 *  ieri che nessuna curva. */
async function refreshPillConfig() {
  if (Date.now() - _pillCfg.fetchedAt < PILL_CONFIG_TTL_MS) return _pillCfg;
  try {
    const [cfg] = await trpcBatch([['gameConfig.getGameConfig', {}]]);
    const st = cfg?.items?.[PILL_CODE]?.flatStats;
    const buffH = _num(st?.buffDurationHours);
    const debuffH = _num(st?.debuffDurationHours);
    if (buffH) {
      _pillCfg = { buffH, debuffH: debuffH || DEFAULT_DEBUFF_H, fetchedAt: Date.now(), live: true };
      console.log(`[damage-timeline] pillola: +${st?.percentAttack ?? '?'}% per ${buffH}h, poi ${_pillCfg.debuffH}h di malus`);
    }
  } catch (err) {
    console.warn('[damage-timeline] gameConfig non letto, uso le durate note:', err.message);
  }
  return _pillCfg;
}

/**
 * Quando questo giocatore ha preso la pillola, dal suo `buffs`.
 * null = nessuna pillola in corso (né buff né dopo-sbornia).
 */
function pillTakenAt(buffs, cfg = _pillCfg) {
  if (!buffs) return null;
  const buffCodes = buffs.buffCodes || [];
  const debuffCodes = buffs.debuffCodes || [];

  if (buffCodes.includes(PILL_CODE)) {
    const end = Date.parse(buffs.buffEndAt || '');
    if (Number.isFinite(end)) return end - cfg.buffH * HOUR_MS;
  }
  if (debuffCodes.includes(PILL_CODE)) {
    const end = Date.parse(buffs.debuffEndAt || '');
    if (Number.isFinite(end)) return end - (cfg.buffH + cfg.debuffH) * HOUR_MS;
  }
  return null;
}

/**
 * Registra le pillole viste in un giro di `user.getUserLite`.
 *
 * Chiamata dal loop che risolve i cittadini nel server principale: quelle
 * risposte sono già state scaricate per altro, qui si legge un campo che
 * prima finiva nel cestino.
 *
 * @param {Array<object|null>} users  risposte getUserLite (buchi ammessi)
 */
function recordPills(users) {
  if (!Array.isArray(users) || !users.length) return;

  const now = Date.now();
  const st = _readState();
  if (!st.startedAt) st.startedAt = now;
  const first = !st.pillsFrom;
  // Quando questo modulo ha guardato le pillole per la prima volta. Da qui
  // readTimeline ricava due date diverse e le espone entrambe, perché
  // dicono due cose diverse:
  //   · da quanto indietro si VEDE  → first − 23,5h, la ricostruzione
  //     all'indietro arriva fin lì anche per pillole prese prima del deploy;
  //   · da quando il conto è COMPLETO → first + 2h, il tempo che il server
  //     principale impiega a rirosolvere tutti i cittadini una volta
  //     (REFRESH_WINDOW_MS). Prima di allora si è visto solo un pezzo di
  //     popolazione per volta, quindi la curva è vera ma bassa.
  if (first) st.pillsFrom = now;

  const cfg = _pillCfg;
  const spanMs = cfg.buffH * HOUR_MS;
  let added = 0;

  for (const u of users) {
    if (!u?.country) continue;
    const taken = pillTakenAt(u.buffs, cfg);
    if (taken == null) continue;
    // Pillola più vecchia della finestra ricostruibile: già contata, o
    // presa prima che questo archivio esistesse.
    if (now - taken > DEDUP_MS) continue;

    const key = `${u._id}|${taken}`;
    if (st.seen[key]) continue;
    st.seen[key] = taken;
    added++;

    // Un giocatore è "pillato" per tutte le ore coperte dalle 8 ore di
    // buff, prima inclusa e ultima inclusa: chi la prende alle 14:50 conta
    // per le 14, e conta ancora per le 22 (fino alle 22:50).
    const i = _idx(st, u.country);
    const from = _hourFloor(taken);
    const to = _hourFloor(taken + spanMs);
    for (let h = from; h <= to; h += HOUR_MS) _bump(_bucket(st, h).p, i, 1);
  }

  // `first` anche senza pillole nuove: la data di prima osservazione è
  // essa stessa un dato (è quella che distingue "zero pillole" da "non
  // stavo ancora guardando"), e va persistita comunque.
  if (!added && !first) return;
  _prune(st, now);
  _writeState(st);
  console.log(`[damage-timeline] ${added} pillole nuove registrate (${Object.keys(st.seen).length} in finestra di dedup)`);
}

// ---------------------------------------------------------------------------
// Potatura
// ---------------------------------------------------------------------------

function _prune(st, now) {
  const cutoff = _hourFloor(now) - RETENTION_HOURS * HOUR_MS;
  for (const k of Object.keys(st.hours)) {
    if (Number(k) < cutoff) delete st.hours[k];
  }
  const dedupCutoff = now - DEDUP_MS;
  for (const k of Object.keys(st.seen)) {
    if (st.seen[k] < dedupCutoff) delete st.seen[k];
  }
}

// ---------------------------------------------------------------------------
// Lettura: /damage-timeline
// ---------------------------------------------------------------------------

/**
 * La serie oraria e la curva giornaliera di UNA nazione, o del mondo se
 * `countryId` manca.
 *
 * ⚠️ `coverageFrom` NON è decorativo: è la sola cosa che distingue "in
 * quell'ora non ha sparato nessuno" da "in quell'ora questo archivio non
 * esisteva ancora". Chi disegna deve tagliare lì, non riempire di zeri.
 *
 * L'ora IN CORSO non c'è: si chiude col campione successivo, e mostrarla
 * a metà farebbe sembrare che il danno sia crollato nell'ultima ora.
 */
function readTimeline({ countryId = null, hours = 48, days = 14 } = {}) {
  const st = _readState();
  const cfg = _pillCfg;
  const nowHour = _hourFloor(Date.now());

  // Le due date della copertura pillole, che dicono cose diverse: vedi il
  // commento in recordPills.
  const pillsSeenFrom = st.pillsFrom ? st.pillsFrom - (cfg.buffH + cfg.debuffH) * HOUR_MS : null;
  const pillsCompleteFrom = st.pillsFrom ? st.pillsFrom + PILL_SWEEP_MS : null;

  const meta = {
    coverageFrom: st.startedAt || null,
    tz: 'UTC',
    pill: {
      buffHours: cfg.buffH, debuffHours: cfg.debuffH, live: cfg.live,
      seenFrom: pillsSeenFrom,
      completeFrom: pillsCompleteFrom,
      // L'ultima fetta di ore può ancora crescere: chi ha preso la pillola
      // adesso lo sapremo al suo prossimo giro di risoluzione.
      settledUntil: nowHour - PILL_SWEEP_MS,
    },
  };

  const i = countryId ? st.ids.indexOf(countryId) : -1;
  if (countryId && i === -1) return { ...meta, known: false, series: [], daily: [] };

  const keys = Object.keys(st.hours).map(Number).sort((a, b) => a - b);

  // ⚠️ Distinguere "misurato zero" da "non misurato" è il punto delicato di
  // tutta la lettura. Un array `d` VUOTO vuol dire che quell'ora non ha mai
  // avuto un campione (server fermo, riavvio, ora anteriore al primo
  // campione); un array pieno di zeri vuol dire che in quell'ora nessuno ha
  // sparato. Restituire 0 in entrambi i casi farebbe disegnare una nazione
  // in pace là dove il server semplicemente non stava guardando — lo stesso
  // errore che `coverageFrom` esiste per evitare, un livello più in basso.
  const dmgAt = (b) => {
    if (!b.d || !b.d.length) return null;
    return i >= 0 ? (b.d[i] || 0) : b.d.reduce((s, x) => s + (x || 0), 0);
  };
  // Per le pillole il criterio è il tempo, non l'array: un'ora senza
  // nessuna pillola resta con `p` vuoto ed è uno zero legittimo, purché
  // cada dentro la finestra che sappiamo di aver guardato.
  const pillAt = (b, h) => {
    if (pillsSeenFrom == null || h < pillsSeenFrom) return null;
    if (!b.p || !b.p.length) return 0;
    return i >= 0 ? (b.p[i] || 0) : b.p.reduce((s, x) => s + (x || 0), 0);
  };

  const series = [];
  const cut = nowHour - Math.max(1, hours) * HOUR_MS;
  // Si scorrono le ore del CALENDARIO, non le chiavi presenti: un'ora
  // mancante deve comparire come buco esplicito, altrimenti chi disegna
  // congiunge due punti lontani e inventa una linea dove non c'è niente.
  //
  // L'inizio è la più VECCHIA fra le due coperture, non `startedAt`: le
  // pillole arrivano da prima che il modulo esistesse (ricostruzione
  // all'indietro), e partire dal primo campione di danno le butterebbe via
  // — cioè butterebbe via proprio le uniche ore disponibili al primo
  // avvio, quando la serie del danno è ancora vuota.
  const earliest = Math.min(
    st.startedAt ?? Infinity,
    pillsSeenFrom ?? Infinity,
  );
  const from = Number.isFinite(earliest) ? Math.max(cut, _hourFloor(earliest)) : cut;
  for (let h = from; h < nowHour; h += HOUR_MS) {
    const b = st.hours[String(h)];
    const d = b ? dmgAt(b) : null;
    const p = b ? pillAt(b, h) : (pillsSeenFrom != null && h >= pillsSeenFrom ? 0 : null);
    if (d == null && p == null) continue;
    series.push({ t: h, d, p, ...(b?.r ? { r: 1 } : {}) });
  }

  // Curva giornaliera: aggregazione della STESSA griglia oraria — una
  // seconda serie salvata a parte divergerebbe dalla prima al primo
  // arrotondamento. Giorni UTC, come li fa il gioco.
  const byDay = new Map();
  const dayCut = nowHour - Math.max(1, days) * 24 * HOUR_MS;
  for (const h of keys) {
    if (h < dayCut || h >= nowHour) continue;
    const b = st.hours[String(h)];
    const day = new Date(h).toISOString().slice(0, 10);
    let row = byDay.get(day);
    if (!row) { row = { day, d: 0, dHours: 0, pPeak: 0, pSum: 0, pHours: 0, r: 0 }; byDay.set(day, row); }
    const d = dmgAt(b);
    if (d != null) { row.d += d; row.dHours++; }
    const p = pillAt(b, h);
    if (p != null) { row.pPeak = Math.max(row.pPeak, p); row.pSum += p; row.pHours++; }
    if (b.r) row.r = 1;
  }
  const daily = [...byDay.values()]
    .sort((a, b) => (a.day < b.day ? -1 : 1))
    .map(r => ({
      // Un giorno a cui mancano ore NON è un giorno con meno danno, ed è
      // così che si leggerebbe se il totale uscisse liscio: `hours` dice su
      // quante ore delle 24 è calcolato, e chi disegna lo tratteggia. Il
      // primo giorno e quello in corso sono sempre parziali.
      day: r.day,
      d: r.dHours ? r.d : null,
      hours: r.dHours,
      pPeak: r.pHours ? r.pPeak : null,
      pAvg: r.pHours ? Math.round(r.pSum / r.pHours) : null,
      ...(r.dHours < 24 ? { partial: 1 } : {}),
      ...(r.r ? { r: 1 } : {}),
    }));

  return { ...meta, known: true, series, daily };
}

/** Riga per /health. */
function timelineStatus() {
  const st = _readState();
  const keys = Object.keys(st.hours).map(Number);
  return {
    coverageFrom: st.startedAt ? new Date(st.startedAt).toISOString() : null,
    ore: keys.length,
    nazioni: st.ids.length,
    pilloleInFinestra: Object.keys(st.seen || {}).length,
    pillola: _pillCfg.live
      ? `${_pillCfg.buffH}h buff / ${_pillCfg.debuffH}h malus (da gameConfig)`
      : `${_pillCfg.buffH}h buff / ${_pillCfg.debuffH}h malus (valori noti, gameConfig non letto)`,
  };
}

module.exports = {
  initDamageTimeline,
  sampleDamage,
  refreshPillConfig,
  recordPills,
  readTimeline,
  timelineStatus,
  pillTakenAt,      // esportata per i test: è la sola aritmetica non ovvia
};
