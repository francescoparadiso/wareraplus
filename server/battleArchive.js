// battleArchive.js
//
// ══════════════════════════════════════════════════════════════
// WarEra+ — Archivio battaglie e spese di guerra
// ------------------------------------------------------------------
// Modulo a sé (stesso pattern di proxyIndex.js: riceve gli attrezzi del
// server per iniezione invece di duplicarli) che risponde a due domande
// che il gioco non risponde da nessuna parte:
//
//   1. «Com'è andata quella battaglia di tre settimane fa, e quanto è
//      costata?»  → /battle-archive
//   2. «Quanto spende una nazione al giorno di taglie e contratti
//      mercenari?»  → /war-expenses
//
// ── PERCHÉ SERVE UN SERVER PER QUESTO ──────────────────────────────
// Il costo di una battaglia sta in due posti, e nessuno dei due è una
// lista sfogliabile:
//   · la TAGLIA uscita da uno schieramento è la somma della classifica
//     `battleRanking.getRanking {dataType:'money'}` di quel lato — due
//     chiamate per battaglia, una per lato;
//   · i CONTRATTI MERCENARI sono aste (`mercenaryContractAuction`), ~300-540
//     aggiudicate al giorno, sfogliabili solo 50 alla volta.
// Con ~40 battaglie finite al giorno, novanta giorni di storia sono ~7.200
// chiamate per le taglie e ~700 pagine per le aste: fuori discussione per
// un browser, una passeggiata per questo server che le fa una volta per
// tutti. È lo stesso ragionamento che ha portato qui la region-history.
//
// ── ⚠️ LA TRAPPOLA DA NON RIFARE ───────────────────────────────────
// `country.getAllCountries` porta già `rankings.countryBounty`, che sembra
// la risposta pronta a "quanto ha speso di taglie questa nazione" — a
// costo zero, senza una riga di questo file. NON LO È. Misurato il
// 2026-08-31 su tutte e 180 le nazioni:
//     corr(countryBounty, danno totale) = 0,87
//     corr(countryBounty, ricchezza)    = 0,11
// e il Giappone ha 47 giocatori attivi, 1 guerra, 541k di countryBounty.
// È quanto i cittadini di quella nazione hanno INCASSATO combattendo, non
// quanto il governo ha PAGATO. Usarlo qui produrrebbe una classifica
// sbagliata e perfettamente credibile, il tipo di errore peggiore.
// La spesa vera si ricava solo battaglia per battaglia, come si fa qui.
//
// ── COSA SI PUÒ SOMMARE E COSA NO ──────────────────────────────────
// Taglia e contratti sono portafogli disgiunti: le regole del gioco dicono
// che i colpi fatti sotto contratto non incassano anche la taglia. Quindi
// taglia + contratti = spesa totale, senza doppi conteggi.
//
// ── DUE LAVORI, DUE STATI SU DISCO ─────────────────────────────────
// Ognuno ha un bootstrap lento (una manciata di pagine per tick, cursore
// persistito: sopravvive a un riavvio pm2 e riprende da dov'era) e un
// giro incrementale che aggancia solo il nuovo. Stesso schema di
// pollBootstrapPage nel file principale, e per la stessa ragione: mai una
// raffica di richieste che faccia scattare i 429.
// ══════════════════════════════════════════════════════════════

// Attrezzi iniettati dal server principale (vedi initBattleArchive).
let trpcBatch = null;
let readCache = null;
let writeCache = null;

// ── File su disco ──
const ARCHIVE_FILE = 'battle-archive';            // battaglie + costi
const ARCHIVE_STATE_FILE = 'battle-archive-state';// cursore del bootstrap battaglie
const MERC_FILE = 'merc-archive';                 // aggregato aste per giorno/nazione
const MERC_STATE_FILE = 'merc-archive-state';     // cursore del bootstrap aste

// ── Parametri ──
// Novanta giorni: scelta esplicita dell'utente. Copre tutta la fase recente
// interessante (compreso il ribilanciamento del bonus alleanza del 1 set
// 2026) tenendo il bootstrap a qualche ora e il file a poche centinaia di KB.
// Alzarlo è una riga sola: il bootstrap riprende da dove si era fermato e
// scende più in basso da solo.
const RETENTION_DAYS = 90;
const RETENTION_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

const BATTLE_PAGE = 50;      // tetto di battle.getBattles
const AUCTION_PAGE = 50;     // tetto misurato di getPaginatedAuctions
// Quante battaglie mandare in un solo batch di classifiche. Ogni battaglia
// costa 2 call, quindi 25 battaglie = 50 call = un solo POST (MAX_BATCH lato
// server è 100).
const RANK_CHUNK = 25;
// Pagine per tick durante il bootstrap. Le battaglie costano molto di più
// per pagina (50 battaglie = 100 chiamate di classifica), le aste sono
// pagine secche: da qui il rapporto 1:4.
const BOOT_BATTLE_PAGES_PER_TICK = 1;
const BOOT_MERC_PAGES_PER_TICK = 4;
// Rete di sicurezza: se un cursore non finisse mai (formato cambiato lato
// WarEra), meglio fermarsi che sfogliare per sempre.
const MAX_BOOT_PAGES = 4000;

// ── FINESTRA NOTTURNA DEL BOOTSTRAP (richiesta esplicita dell'utente) ──
// Il bootstrap è l'unico lavoro pesante di questo modulo: ~72 pagine di
// battaglie (con 100 chiamate di classifica ciascuna) e ~700 pagine di
// aste. Farlo mentre il gioco è pieno di gente significa contendere il
// rate limit con i giocatori veri e con gli altri poll di questo server.
// Gira quindi solo fra le 02:00 e le 06:59 italiane, che è il minimo di
// attività per una base giocatori in larga maggioranza europea.
//
// Il conto torna in UNA sola notte: 5 ore = ~300 tick da un minuto, contro
// 72 pagine di battaglie (1/tick) e ~700 di aste (4/tick = 1200 possibili).
// Il giro INCREMENTALE invece resta attivo tutto il giorno: è una o due
// richieste ogni dieci minuti, il carico di un poll qualsiasi.
const BOOT_TZ = 'Europe/Rome';
const BOOT_HOURS = [2, 3, 4, 5, 6];

/** Vero se adesso siamo nella finestra notturna. Il cron è già ristretto a
 *  quelle ore, ma il controllo è ripetuto qui perché `runAllPolls` allo
 *  start-up chiama i poll fuori dal cron: senza, un riavvio pm2 a mezzogiorno
 *  farebbe partire il bootstrap in pieno giorno. */
function _inQuietHours() {
  const h = Number(new Intl.DateTimeFormat('en-GB', {
    timeZone: BOOT_TZ, hour: '2-digit', hour12: false,
  }).format(new Date()));
  return BOOT_HOURS.includes(h);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

/** Chiamato una volta dal server principale, prima di qualunque poll. */
function initBattleArchive(tools) {
  trpcBatch = tools.trpcBatch;
  readCache = tools.readCache;
  writeCache = tools.writeCache;
}

// ---------------------------------------------------------------------------
// Helper
// ---------------------------------------------------------------------------

const _ts = (iso) => { const t = Date.parse(iso || ''); return Number.isFinite(t) ? t : null; };
// Giorno in UTC. Volutamente UTC e non Europe/Rome (a differenza dello
// snapshot dei danni, che confronta due letture istantanee e quindi ha
// bisogno di un'ora fissa): qui si raggruppano eventi già datati, e l'unico
// fuso su cui tutti i client concordano senza doverlo comunicare è UTC.
// Il client lo dichiara in interfaccia.
const _day = (ms) => new Date(ms).toISOString().slice(0, 10);

/** Una pagina di battaglie concluse. `cursor` null = la più recente. */
async function _fetchFinishedPage(cursor) {
  const input = { isActive: false, limit: BATTLE_PAGE };
  if (cursor) input.cursor = cursor;
  const [res] = await trpcBatch([['battle.getBattles', input]]);
  if (!res || !Array.isArray(res.items)) throw new Error('battle.getBattles: risposta inattesa');
  return { items: res.items, nextCursor: res.nextCursor || null };
}

/** Una pagina di aste aggiudicate, dalla più recente all'indietro.
 *  ⚠️ Senza `status` l'API assume 'active': va passato sempre esplicito,
 *  altrimenti si sfoglia il vuoto. */
async function _fetchWonAuctionsPage(cursor) {
  const input = { status: 'won', limit: AUCTION_PAGE, sortBy: 'createdAt', sortOrder: 'desc' };
  if (cursor) input.cursor = cursor;
  const [res] = await trpcBatch([['mercenaryContractAuction.getPaginatedAuctions', input]]);
  if (!res || !Array.isArray(res.items)) throw new Error('getPaginatedAuctions: risposta inattesa');
  return { items: res.items, nextCursor: res.nextCursor || null };
}

/** Taglia uscita dai due schieramenti di N battaglie, in batch.
 *  `limit: 100` non è decorativo: SENZA, la classifica torna solo 20 voci e
 *  la somma sarebbe silenziosamente troppo bassa (in una battaglia grossa
 *  incassano ~77 nazioni). Restituisce Map<battleId, {atk, def}>. */
async function _fetchBountyFor(battleIds) {
  const out = new Map();
  for (let i = 0; i < battleIds.length; i += RANK_CHUNK) {
    const chunk = battleIds.slice(i, i + RANK_CHUNK);
    const calls = [];
    for (const id of chunk) {
      calls.push(['battleRanking.getRanking', { battleId: id, dataType: 'money', type: 'country', side: 'attacker', limit: 100 }]);
      calls.push(['battleRanking.getRanking', { battleId: id, dataType: 'money', type: 'country', side: 'defender', limit: 100 }]);
    }
    const res = await trpcBatch(calls);
    chunk.forEach((id, k) => {
      const sum = (r) => Array.isArray(r?.items)
        ? r.items.reduce((s, x) => s + (Number(x.value) || 0), 0)
        : null;
      out.set(id, { atk: sum(res[k * 2]), def: sum(res[k * 2 + 1]) });
    });
    // Respiro fra un chunk e l'altro: il bootstrap non ha fretta e il resto
    // del server continua a pollare in parallelo.
    if (i + RANK_CHUNK < battleIds.length) await sleep(800);
  }
  return out;
}

/** Riga d'archivio compatta. Chiavi corte di proposito: 3.600 battaglie ×
 *  nomi di campo estesi sono ~200 KB di sole chiavi ripetute, e questo file
 *  viaggia intero verso il browser. Il client le riespande (battles/api.js). */
function _toRow(b, bounty) {
  const endedAt = _ts(b.endedAt) || _ts(b.updatedAt);
  return {
    i: b._id,
    t: b.type || 'war',
    e: endedAt,
    w: b.wonBy || null,
    r: b.defender?.region || b.attacker?.region || null,
    ac: b.attacker?.country || null,
    ad: b.attacker?.damages || 0,
    ab: bounty?.atk ?? null,
    dc: b.defender?.country || null,
    dd: b.defender?.damages || 0,
    db: bounty?.def ?? null,
    // Contratti: riempiti dall'aggregato aste (_applyMercToArchive), non da
    // una chiamata per battaglia — le aste si sfogliano una volta sola per
    // tutte.
    mc: 0,
    mn: 0,
  };
}

// ---------------------------------------------------------------------------
// ARCHIVIO BATTAGLIE
// ---------------------------------------------------------------------------

function _readArchive() {
  return readCache(ARCHIVE_FILE, { fetchedAt: null, retentionDays: RETENTION_DAYS, data: [] });
}

/** Scrive l'archivio ordinato dal più recente, potato oltre la finestra di
 *  ritenzione. `compact` perché è il file più grande che questo modulo
 *  produce e viaggia gzippato verso ogni browser. */
function _writeArchive(rows) {
  const cutoff = Date.now() - RETENTION_MS;
  const kept = rows
    .filter(r => r.e && r.e >= cutoff)
    .sort((a, b) => b.e - a.e);
  writeCache(ARCHIVE_FILE, {
    fetchedAt: Date.now(),
    retentionDays: RETENTION_DAYS,
    data: kept,
  }, { compact: true });
  return kept;
}

/** Aggiunge/aggiorna righe nell'archivio senza duplicare (chiave = id). */
function _mergeRows(existing, incoming) {
  const byId = new Map(existing.map(r => [r.i, r]));
  for (const r of incoming) {
    const prev = byId.get(r.i);
    // Una battaglia già archiviata non cambia più: si conservano i contratti
    // già attribuiti (mc/mn) invece di azzerarli con la riga nuova.
    if (prev) byId.set(r.i, { ...r, mc: prev.mc || r.mc, mn: prev.mn || r.mn });
    else byId.set(r.i, r);
  }
  return [...byId.values()];
}

/** GIRO INCREMENTALE: le battaglie finite da poco che non sono ancora
 *  nell'archivio. Si ferma alla prima pagina interamente già nota — con
 *  ~40 battaglie concluse al giorno, una pagina da 50 copre più di mezza
 *  giornata, quindi in regime normale è una sola richiesta. */
async function pollBattleArchive() {
  if (!trpcBatch) return;
  try {
    const archive = _readArchive();
    const known = new Set(archive.data.map(r => r.i));
    const fresh = [];
    let cursor = null;

    for (let page = 0; page < 6; page++) {
      const { items, nextCursor } = await _fetchFinishedPage(cursor);
      const unknown = items.filter(b => !known.has(b._id));
      fresh.push(...unknown);
      // Pagina tutta già nota: da qui in giù è tutto vecchio.
      if (unknown.length === 0) break;
      cursor = nextCursor;
      if (!cursor) break;
      await sleep(500);
    }

    if (!fresh.length) {
      console.log('[battle-archive] nessuna battaglia nuova');
      return;
    }

    const bounty = await _fetchBountyFor(fresh.map(b => b._id));
    const rows = fresh.map(b => _toRow(b, bounty.get(b._id)));
    const merged = _mergeRows(archive.data, rows);
    const kept = _writeArchive(merged);
    _applyMercToArchive();
    console.log(`[battle-archive] +${rows.length} battaglie (${kept.length} in archivio, ${RETENTION_DAYS}gg)`);
  } catch (err) {
    console.error('[battle-archive] giro fallito:', err.message);
  }
}

/** BOOTSTRAP: scende all'indietro una pagina per tick finché non copre la
 *  finestra di ritenzione. Cursore su disco: un riavvio non ricomincia. */
async function pollBattleArchiveBootstrap() {
  if (!trpcBatch) return;
  if (!_inQuietHours()) return; // vedi BOOT_HOURS
  const st = readCache(ARCHIVE_STATE_FILE, { cursor: null, done: false, pages: 0, oldestSeen: null });
  if (st.done) return;

  if (st.pages >= MAX_BOOT_PAGES) {
    console.error(`[battle-archive] bootstrap: limite di sicurezza (${MAX_BOOT_PAGES} pagine), mi fermo`);
    st.done = true; writeCache(ARCHIVE_STATE_FILE, st);
    return;
  }

  const cutoff = Date.now() - RETENTION_MS;
  try {
    for (let n = 0; n < BOOT_BATTLE_PAGES_PER_TICK; n++) {
      const { items, nextCursor } = await _fetchFinishedPage(st.cursor);
      if (!items.length) { st.done = true; break; }

      const inWindow = items.filter(b => {
        const e = _ts(b.endedAt) || _ts(b.updatedAt);
        return e && e >= cutoff;
      });

      if (inWindow.length) {
        const archive = _readArchive();
        const known = new Set(archive.data.map(r => r.i));
        const todo = inWindow.filter(b => !known.has(b._id));
        if (todo.length) {
          const bounty = await _fetchBountyFor(todo.map(b => b._id));
          const rows = todo.map(b => _toRow(b, bounty.get(b._id)));
          _writeArchive(_mergeRows(archive.data, rows));
        }
      }

      const oldest = items[items.length - 1];
      st.oldestSeen = _ts(oldest.endedAt) || _ts(oldest.updatedAt) || st.oldestSeen;
      st.pages++;
      st.cursor = nextCursor;

      // Superata la finestra: la pagina successiva sarebbe tutta da buttare.
      if (!nextCursor || (st.oldestSeen && st.oldestSeen < cutoff)) { st.done = true; break; }
      await sleep(1000);
    }

    writeCache(ARCHIVE_STATE_FILE, st);
    if (st.done) {
      _applyMercToArchive();
      console.log(`[battle-archive] bootstrap COMPLETATO: ${st.pages} pagine, archivio a ${_readArchive().data.length} battaglie`);
    } else {
      console.log(`[battle-archive] bootstrap pagina ${st.pages}, indietro fino a ${st.oldestSeen ? new Date(st.oldestSeen).toISOString().slice(0, 10) : '—'}`);
    }
  } catch (err) {
    // Cursore non avanzato: il prossimo tick ritenta la stessa pagina.
    console.error('[battle-archive] bootstrap pagina fallita, ritento:', err.message);
  }
}

// ---------------------------------------------------------------------------
// ASTE MERCENARIE → aggregato per giorno e nazione pagante
// ---------------------------------------------------------------------------
//
// Si tengono solo gli aggregati, non i 35.000 record grezzi: la domanda è
// "quanto al giorno", non "quale contratto". Due viste dello stesso dato:
//   · byDay[giorno][countryId] = {c: monete, n: contratti}
//   · byBattle[battleId]       = {c: monete, n: contratti}
// La seconda serve a riempire le colonne mc/mn dell'archivio battaglie
// senza una chiamata per battaglia.
//
// ⚠️ `country` è chi PAGA, `forCountry` è per chi si combatte: non sempre
// coincidono (un alleato può finanziare contratti sul fronte altrui) ed è
// proprio uno dei numeri interessanti. Qui si attribuisce sempre al pagante.

function _readMerc() {
  return readCache(MERC_FILE, { fetchedAt: null, byDay: {}, byBattle: {}, seen: [] });
}

function _foldAuctionsInto(store, items) {
  const seen = new Set(store.seen || []);
  let added = 0;
  for (const a of items) {
    if (!a?._id || seen.has(a._id)) continue;
    const payer = a.country;
    const amount = Number(a.currentPayout);
    const at = _ts(a.createdAt);
    if (!payer || !Number.isFinite(amount) || !at) continue;
    seen.add(a._id);
    added++;

    const d = _day(at);
    store.byDay[d] = store.byDay[d] || {};
    const cell = store.byDay[d][payer] = store.byDay[d][payer] || { c: 0, n: 0 };
    cell.c += amount; cell.n += 1;

    if (a.battle) {
      const b = store.byBattle[a.battle] = store.byBattle[a.battle] || { c: 0, n: 0 };
      b.c += amount; b.n += 1;
    }
  }
  store.seen = [...seen];
  return added;
}

/** Pota giorni e id fuori finestra: senza questo `seen` cresce senza fine
 *  (è l'unica struttura di questo modulo che non ha un limite naturale). */
function _pruneMerc(store) {
  const cutoffDay = _day(Date.now() - RETENTION_MS);
  for (const d of Object.keys(store.byDay)) if (d < cutoffDay) delete store.byDay[d];
  // `seen` serve solo a non ricontare un'asta già vista in un giro
  // successivo: oltre la finestra non può più ripresentarsi, quindi si
  // tiene solo la coda recente (le aste arrivano ordinate per data).
  const MAX_SEEN = 60000;
  if (store.seen.length > MAX_SEEN) store.seen = store.seen.slice(-MAX_SEEN);
  return store;
}

function _writeMerc(store) {
  store.fetchedAt = Date.now();
  writeCache(MERC_FILE, _pruneMerc(store), { compact: true });
}

/** Riversa byBattle sulle colonne mc/mn dell'archivio. Chiamata dopo ogni
 *  aggiornamento dei due lati, così le due strutture non si disallineano
 *  (una battaglia può essere archiviata prima che le sue aste siano state
 *  sfogliate, o viceversa). */
function _applyMercToArchive() {
  try {
    const merc = _readMerc();
    const archive = _readArchive();
    if (!archive.data.length) return;
    let touched = 0;
    for (const row of archive.data) {
      const m = merc.byBattle[row.i];
      const c = m ? m.c : 0;
      const n = m ? m.n : 0;
      if (row.mc !== c || row.mn !== n) { row.mc = c; row.mn = n; touched++; }
    }
    if (touched) _writeArchive(archive.data);
  } catch (err) {
    console.error('[battle-archive] riversamento contratti fallito:', err.message);
  }
}

/** GIRO INCREMENTALE aste: dalla più recente all'indietro finché non si
 *  incontra una pagina interamente già vista. */
async function pollMercArchive() {
  if (!trpcBatch) return;
  try {
    const store = _readMerc();
    let cursor = null;
    let added = 0;

    for (let page = 0; page < 12; page++) {
      const { items, nextCursor } = await _fetchWonAuctionsPage(cursor);
      if (!items.length) break;
      const n = _foldAuctionsInto(store, items);
      added += n;
      if (n === 0) break; // pagina tutta nota: sotto è tutto vecchio
      cursor = nextCursor;
      if (!cursor) break;
      await sleep(400);
    }

    _writeMerc(store);
    if (added) {
      _applyMercToArchive();
      console.log(`[war-expenses] +${added} contratti aggiudicati`);
    } else {
      console.log('[war-expenses] nessun contratto nuovo');
    }
  } catch (err) {
    console.error('[war-expenses] giro fallito:', err.message);
  }
}

/** BOOTSTRAP aste: scende all'indietro qualche pagina per tick fino alla
 *  finestra di ritenzione. ~700 pagine per 90 giorni. */
async function pollMercArchiveBootstrap() {
  if (!trpcBatch) return;
  if (!_inQuietHours()) return; // vedi BOOT_HOURS
  const st = readCache(MERC_STATE_FILE, { cursor: null, done: false, pages: 0, oldestSeen: null });
  if (st.done) return;

  if (st.pages >= MAX_BOOT_PAGES) {
    console.error(`[war-expenses] bootstrap: limite di sicurezza (${MAX_BOOT_PAGES} pagine), mi fermo`);
    st.done = true; writeCache(MERC_STATE_FILE, st);
    return;
  }

  const cutoff = Date.now() - RETENTION_MS;
  try {
    const store = _readMerc();
    for (let n = 0; n < BOOT_MERC_PAGES_PER_TICK; n++) {
      const { items, nextCursor } = await _fetchWonAuctionsPage(st.cursor);
      if (!items.length) { st.done = true; break; }
      _foldAuctionsInto(store, items);

      const oldest = _ts(items[items.length - 1].createdAt);
      if (oldest) st.oldestSeen = oldest;
      st.pages++;
      st.cursor = nextCursor;

      if (!nextCursor || (st.oldestSeen && st.oldestSeen < cutoff)) { st.done = true; break; }
      await sleep(600);
    }
    _writeMerc(store);
    writeCache(MERC_STATE_FILE, st);

    if (st.done) {
      _applyMercToArchive();
      console.log(`[war-expenses] bootstrap COMPLETATO: ${st.pages} pagine di aste`);
    } else {
      console.log(`[war-expenses] bootstrap pagina ${st.pages}, indietro fino a ${st.oldestSeen ? new Date(st.oldestSeen).toISOString().slice(0, 10) : '—'}`);
    }
  } catch (err) {
    console.error('[war-expenses] bootstrap pagina fallita, ritento:', err.message);
  }
}

// ---------------------------------------------------------------------------
// LETTURA (endpoint)
// ---------------------------------------------------------------------------

function readBattleArchive() {
  return _readArchive();
}

/** Serie giornaliera per nazione: taglie (dalle battaglie) + contratti
 *  (dalle aste) nello stesso oggetto.
 *
 *  ⚠️ Attribuzione della taglia dichiarata qui una volta per tutte: la
 *  classifica money dà il TOTALE di fine battaglia, non una ripartizione
 *  per giorno. La spesa di una battaglia viene quindi imputata INTERAMENTE
 *  al giorno in cui è finita. Con battaglie che durano poche ore è
 *  praticamente esatto; per le rare che scavallano la mezzanotte UTC il
 *  giorno di chiusura si prende tutto. Il client lo dice in chiaro. */
function readWarExpenses() {
  const archive = _readArchive();
  const merc = _readMerc();
  const byDay = {};

  const cell = (d, c) => {
    byDay[d] = byDay[d] || {};
    return byDay[d][c] = byDay[d][c] || { bounty: 0, contracts: 0, contractCount: 0, battles: 0 };
  };

  for (const r of archive.data) {
    if (!r.e) continue;
    // Le battaglie di torneo non hanno una nazione a cui imputare nulla
    // (hanno `tournamentTeam` al posto di `country`): fuori da qui.
    if (r.t === 'tournament') continue;
    const d = _day(r.e);
    if (r.ac) { const k = cell(d, r.ac); k.bounty += r.ab || 0; k.battles += 1; }
    if (r.dc) { const k = cell(d, r.dc); k.bounty += r.db || 0; k.battles += 1; }
  }

  for (const [d, byCountry] of Object.entries(merc.byDay)) {
    for (const [c, v] of Object.entries(byCountry)) {
      const k = cell(d, c);
      k.contracts += v.c || 0;
      k.contractCount += v.n || 0;
    }
  }

  return {
    fetchedAt: Math.max(archive.fetchedAt || 0, merc.fetchedAt || 0) || null,
    retentionDays: RETENTION_DAYS,
    tz: 'UTC',
    byDay,
  };
}

/** Stato dei due bootstrap, per /health e per la diagnostica. */
function readArchiveStatus() {
  const bs = readCache(ARCHIVE_STATE_FILE, { cursor: null, done: false, pages: 0, oldestSeen: null });
  const ms = readCache(MERC_STATE_FILE, { cursor: null, done: false, pages: 0, oldestSeen: null });
  const archive = _readArchive();
  const merc = _readMerc();
  return {
    retentionDays: RETENTION_DAYS,
    battles: {
      archived: archive.data.length,
      fetchedAt: archive.fetchedAt,
      bootstrap: { done: bs.done, pages: bs.pages, oldestSeen: bs.oldestSeen },
    },
    contracts: {
      days: Object.keys(merc.byDay).length,
      battlesWithContracts: Object.keys(merc.byBattle).length,
      fetchedAt: merc.fetchedAt,
      bootstrap: { done: ms.done, pages: ms.pages, oldestSeen: ms.oldestSeen },
    },
  };
}

module.exports = {
  initBattleArchive,
  BOOT_TZ,
  pollBattleArchive,
  pollBattleArchiveBootstrap,
  pollMercArchive,
  pollMercArchiveBootstrap,
  readBattleArchive,
  readWarExpenses,
  readArchiveStatus,
};
