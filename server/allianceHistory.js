/* ═══════════════════════════════════════════════════════════════════════
   WarEra+ — Storia delle alleanze (per la time machine)
   -----------------------------------------------------------------------
   Richiesta dell'utente: nella time machine, accanto a guerre e patti di
   una nazione, anche le sue alleanze — «da quando ne hai contezza».

   Ne abbiamo contezza da SEMPRE, e non per merito nostro: il registro
   eventi del gioco (`event.getEventsPaginated`, PUBBLICO su api6) tiene
   tutto dall'inizio, e con gli eventi giusti. Misurato il 2026-09-24:

   - ALLEANZE BILATERALI (`allianceFormed` / `allianceBroken`, una coppia di
     nazioni per evento): 10.749 eventi dal 1° maggio 2025 — il giorno di
     lancio del gioco — al 10 giugno 2026 alle 13:01, poi più niente;
   - ALLEANZE A BLOCCO (`allianceMemberJoined` / `Left` / `Excluded`, con id
     e NOME dell'alleanza in quel momento): 498 eventi dal 10 giugno 2026
     alle 13:38 a oggi.

   Cioè il 10 giugno il gioco ha sostituito le alleanze a due con i blocchi.
   ⚠️ Il campo `allies` delle nazioni esiste ancora ed è un FOSSILE: le sue
   493 coppie stanno tutte nello stato bilaterale del 10 giugno, e da allora
   non è nato niente. Non usarlo come "alleati di oggi".

   ── COME SI RICOSTRUISCE UN GIORNO (lo fa il client, qui si servono i dati)
   Blocchi: ALL'INDIETRO dall'appartenenza di oggi (`allianceId` delle
   nazioni), annullando gli eventi successivi all'istante chiesto. Non in
   avanti da zero, perché chi FONDA un'alleanza non riceve l'evento "joined":
   rigiocato da zero, 12 nazioni su 180 sbagliavano, 11 delle quali erano i
   fondatori, una per alleanza. All'indietro i fondatori ancora dentro
   escono giusti; per non farli risultare membri PRIMA che l'alleanza
   esistesse, ogni alleanza ha la sua data di nascita (`created`) sotto la
   quale non si è membri di niente.
   Bilaterali: in avanti da zero, che al lancio del gioco era esatto.

   ── COSTO ──────────────────────────────────────────────────────────────
   Il primo giro sfoglia ~115 pagine (una volta sola nella vita del file).
   Dopo, un giro all'ora con UNA richiesta per famiglia, che si ferma al
   primo evento già visto. I bilaterali non producono più niente dal 10
   giugno: si ricontrollano lo stesso, costa una richiesta e se il gioco li
   riaccendesse ce ne accorgeremmo.
   Il file va al browser con le nazioni come INDICI in una tabella (`c`) e il
   tempo in secondi: 11.000 eventi in poche decine di KB compressi, scaricati
   una volta per sessione e solo selezionando una nazione nella time machine.
   ═══════════════════════════════════════════════════════════════════════ */

let deps = null;

const FILE = 'alliance-history';
const PAGE = 100;
const MAX_PAGES_BOOT = 400;   // i bilaterali sono ~110 pagine: margine ampio
const MAX_PAGES_GIRO = 10;
const PAUSA_MS = 400;

const FAMIGLIE = {
  bloc: ['allianceMemberJoined', 'allianceMemberLeft', 'allianceMemberExcluded'],
  pair: ['allianceFormed', 'allianceBroken'],
};
const TIPO_BREVE = {
  allianceMemberJoined: 'j', allianceMemberLeft: 'l', allianceMemberExcluded: 'x',
  allianceFormed: 'f', allianceBroken: 'b',
};

function initAllianceHistory(tools) {
  deps = tools;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function _read() {
  const s = deps.readCache(FILE, null) || {};
  return {
    fetchedAt: s.fetchedAt || null,
    // righe: { i: id evento, t: ms, k: tipo breve, c: nazione | [a,b], a: alleanza, n: nome }
    bloc: Array.isArray(s.bloc) ? s.bloc : [],
    pair: Array.isArray(s.pair) ? s.pair : [],
  };
}

async function _pagina(tipi, cursor) {
  const input = { limit: PAGE, eventTypes: tipi };
  if (cursor) input.cursor = cursor;
  const url = `${deps.apiBase}/trpc/event.getEventsPaginated?input=${encodeURIComponent(JSON.stringify(input))}`;
  for (let tentativo = 0; tentativo < 4; tentativo++) {
    const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 || res.status >= 500) { await sleep(3000 * (tentativo + 1)); continue; }
    if (!res.ok) throw new Error(`getEventsPaginated: HTTP ${res.status}`);
    const data = (await res.json())?.result?.data;
    if (!data || !Array.isArray(data.items)) throw new Error('getEventsPaginated: risposta inattesa');
    return { items: data.items, nextCursor: data.nextCursor || null };
  }
  throw new Error('getEventsPaginated: troppi 429/5xx');
}

function _riga(e) {
  const t = Date.parse(e?.createdAt || '');
  const d = e?.data || {};
  const k = TIPO_BREVE[d.type];
  if (!e?._id || !Number.isFinite(t) || !k) return null;
  if (k === 'f' || k === 'b') {
    const [a, b] = d.countries || e.countries || [];
    if (!a || !b) return null;
    return { i: e._id, t, k, c: [a, b] };
  }
  if (!d.country || !d.allianceId) return null;
  return { i: e._id, t, k, c: d.country, a: d.allianceId, n: d.allianceName || null };
}

/** Sfoglia una famiglia dal più recente e si ferma al primo evento già in
 *  archivio (o alla fine, al primo giro). */
async function _giroFamiglia(nome, noti) {
  const conosciuti = new Set(noti.map((r) => r.i));
  const boot = !noti.length;
  const nuovi = [];
  let cursor = null;
  for (let p = 0; p < (boot ? MAX_PAGES_BOOT : MAX_PAGES_GIRO); p++) {
    const { items, nextCursor } = await _pagina(FAMIGLIE[nome], cursor);
    let visto = false;
    for (const e of items) {
      if (conosciuti.has(e?._id)) { visto = true; break; }
      const r = _riga(e);
      if (r) nuovi.push(r);
    }
    cursor = nextCursor;
    if (visto || !cursor || !items.length) return { nuovi, completo: true };
    await sleep(PAUSA_MS);
  }
  // Al primo giro un taglio a metà lascerebbe un buco in fondo alla storia:
  // meglio non scrivere niente e riprovare al giro dopo.
  return { nuovi, completo: !boot };
}

async function pollAllianceHistory() {
  if (!deps) return;
  const store = _read();
  let cambiato = false;
  for (const nome of Object.keys(FAMIGLIE)) {
    try {
      const { nuovi, completo } = await _giroFamiglia(nome, store[nome]);
      if (!completo) {
        console.warn(`[alliance-history] ${nome}: primo giro incompleto, si riprova al prossimo`);
        continue;
      }
      if (nuovi.length) {
        store[nome] = [...store[nome], ...nuovi].sort((a, b) => a.t - b.t);
        cambiato = true;
        console.log(`[alliance-history] ${nome}: +${nuovi.length} (totale ${store[nome].length})`);
      }
    } catch (err) {
      console.error(`[alliance-history] ${nome}: giro fallito:`, err.message);
    }
  }
  // Si scrive anche senza novità: `fetchedAt` dice in /health che il giro
  // gira, e un file mai scritto (primo giro fallito) non deve sembrare vuoto.
  store.fetchedAt = Date.now();
  deps.writeCache(FILE, store, { compact: true });
  return cambiato;
}

/**
 * Quello che va al browser. Nazioni come indici nella tabella `c`, tempi in
 * secondi, niente id degli eventi (servono solo qui, al dedup).
 *
 *   bloc.e: [t, tipo 'j'|'l'|'x', nazione, alleanza]
 *   bloc.names: { alleanza: [[t, nome], ...] }  il nome negli eventi, nel tempo
 *   bloc.current: { alleanza: nome }            il nome di oggi (esistenti)
 *   bloc.now: { nazione: alleanza }             appartenenza di oggi
 *   bloc.created: { alleanza: t }               nascita (sotto: nessun membro)
 *   pair.e: [t, 'f'|'b', a, b]
 */
function readAllianceHistory() {
  const store = _read();
  const tab = [];
  const idx = new Map();
  const ix = (id) => {
    if (!idx.has(id)) { idx.set(id, tab.length); tab.push(id); }
    return idx.get(id);
  };
  const sec = (ms) => Math.floor(ms / 1000);

  const countriesCache = deps.readCache('countries', null);
  const countries = countriesCache?.data?.result?.data || countriesCache?.data || [];
  const alliancesCache = deps.readCache('alliances', null);

  const names = {};
  const current = {};
  const created = {};
  for (const r of store.bloc) {
    if (r.n) {
      const lista = names[r.a] || (names[r.a] = []);
      if (!lista.length || lista[lista.length - 1][1] !== r.n) lista.push([sec(r.t), r.n]);
    }
    if (created[r.a] == null || sec(r.t) < created[r.a]) created[r.a] = sec(r.t);
  }
  // La data di nascita vera, per le alleanze che esistono ancora: il primo
  // evento può essere il primo "joined" DOPO la fondazione.
  for (const a of alliancesCache?.data || []) {
    const t = Date.parse(a?.data?.createdAt || '');
    if (a?.allianceId && Number.isFinite(t)) created[a.allianceId] = Math.min(created[a.allianceId] ?? Infinity, sec(t));
    // Il nome di OGGI a parte: i cambi di nome non stanno nel registro
    // (P.A.S.T.A. era "Balkan Bloc", poi "Reservoir Dogs", poi "The Olive
    // Union", e il passaggio all'ultimo nome non ha data). Il client mostra
    // questo come nome e quello dell'epoca accanto, invece di inventarsi da
    // quando vale.
    if (a?.allianceId && a?.data?.name) current[a.allianceId] = a.data.name;
  }

  const now = {};
  for (const n of countries) if (n?._id && n.allianceId) now[ix(n._id)] = n.allianceId;

  return {
    fetchedAt: store.fetchedAt,
    c: tab,
    bloc: {
      from: store.bloc.length ? sec(store.bloc[0].t) : null,
      e: store.bloc.map((r) => [sec(r.t), r.k, ix(r.c), r.a]),
      names, current, now, created,
    },
    pair: {
      from: store.pair.length ? sec(store.pair[0].t) : null,
      until: store.pair.length ? sec(store.pair[store.pair.length - 1].t) : null,
      e: store.pair.map((r) => [sec(r.t), r.k, ix(r.c[0]), ix(r.c[1])]),
    },
  };
}

function statoAllianceHistory() {
  const s = _read();
  const iso = (ms) => (ms ? new Date(ms).toISOString() : null);
  return {
    ultimoGiro: iso(s.fetchedAt),
    blocchi: { eventi: s.bloc.length, dal: iso(s.bloc[0]?.t), al: iso(s.bloc[s.bloc.length - 1]?.t) },
    bilaterali: { eventi: s.pair.length, dal: iso(s.pair[0]?.t), al: iso(s.pair[s.pair.length - 1]?.t) },
  };
}

module.exports = { initAllianceHistory, pollAllianceHistory, readAllianceHistory, statoAllianceHistory };
