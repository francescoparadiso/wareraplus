/* ══════════════════════════════════════════════════════════════
   WarEra+ — Pillati a un istante: adesso, N ore fa, curva a 15 minuti
   ------------------------------------------------------------------
   Modulo NUOVO (2026-10-15), condiviso dai due grafici "danno ora per ora
   e pillati": la scheda nazione (src/nations/damageCurves.js) e quelli di
   gruppo — scheda alleanza, Faction 1 vs 2, 1 vs 2 delle nazioni
   (src/diplomacy/blocDamageCurves.js). Richiesta dell'utente: «i grafici
   delle pill devono dare quei dati ovunque».

   Da dove vengono i numeri (server/damageTimeline.js, /damage-timeline):
     · `pill.instant` — quanti erano sotto pillola ADESSO e 24h/48h/72h/
       7g/14g fa, contati sull'ora vera di ogni presa (registro di 14
       giorni, TAKES_KEEP_MS). null dove il registro non arriva ancora;
     · `pill.fine` — lo stesso conteggio ogni 15 minuti, fino ad adesso;
     · `series[].p` — il punto orario dell'archivio di prima. ⚠️ È anch'esso
       un ISTANTE, non il massimo dell'ora: _pillSlots conta chi è pillato
       al centro del secchio, le hh:30 (misurato: 08:00 → 39, coi quarti
       15·30·39·42). Per questo si può confrontare con i conteggi esatti e
       continuare la stessa linea.
   ══════════════════════════════════════════════════════════════ */

const HOUR_MS = 3600 * 1000;
const HALF_MS = HOUR_MS / 2;

/** I punti della curva fine dentro la finestra: [{ t, v }], v null dove il
 *  registro del server non arriva. [] con un server che non la manda. */
export function finePoints(tl, t0) {
  const f = tl?.pill?.fine;
  if (!f || !Array.isArray(f.n) || !f.step) return [];
  return f.n.map((v, k) => ({ t: f.from + k * f.step, v })).filter(p => p.t >= t0);
}

/**
 * Pillati adesso e `hours` ore prima, per il riquadro sopra il grafico.
 * { now: { n, at }, then: { n, at }, exact } — `exact` false quando "then"
 * viene dal punto orario (le hh:30 più vicine, al massimo mezz'ora di
 * scarto: la casella dice quale). null se non c'è niente da confrontare.
 * "Adesso" è sempre il conteggio di adesso; solo un server che non lo
 * manda ricade sull'ultima hh:30.
 */
export function pillCompare(tl, hours) {
  if (!tl) return null;
  const inst = tl.pill?.instant;
  const rows = (tl.series || []).filter(r => r.p != null);

  let now;
  if (inst?.now?.n != null) now = { n: inst.now.n, at: inst.now.at };
  else {
    const last = rows[rows.length - 1];
    if (!last) return null;
    now = { n: last.p, at: last.t + HALF_MS };
  }

  const ago = inst?.ago?.find(a => a.h === hours);
  if (ago?.n != null) return { now, then: { n: ago.n, at: ago.at }, exact: true };

  const target = now.at - hours * HOUR_MS;
  let best = null;
  for (const r of rows) {
    if (!best || Math.abs(r.t + HALF_MS - target) < Math.abs(best.t + HALF_MS - target)) best = r;
  }
  // Più di un'ora di scarto: la serie non arriva fin lì.
  if (!best || Math.abs(best.t + HALF_MS - target) > HOUR_MS) return null;
  return { now, then: { n: best.p, at: best.t + HALF_MS }, exact: false };
}

/**
 * La linea dei pillati come tratti di punti { t, v }: i punti orari (alle
 * hh:30) dove la curva fine non arriva, poi quelli ogni 15 minuti. Stessa
 * misura, quindi un tratto unico dove si toccano; spezzata solo sui buchi.
 * `rows`: la serie oraria già ristretta alla finestra.
 */
export function pillSegments(rows, fine) {
  const fineStart = fine.find(p => p.v != null)?.t ?? Infinity;
  const pts = [];
  for (const r of rows) {
    const t = r.t + HALF_MS;
    if (t < fineStart) pts.push({ t, v: r.p ?? null });
  }
  for (const p of fine) if (p.t >= fineStart) pts.push({ t: p.t, v: p.v });
  const segs = [];
  let cur = [];
  let prevT = null;
  for (const p of pts) {
    // Un buco nella serie oraria (ora senza riga) spezza come un null.
    const gap = prevT != null && p.t - prevT > HOUR_MS + 1000;
    if (p.v == null || gap) { if (cur.length > 1) segs.push(cur); cur = []; }
    if (p.v != null) cur.push(p);
    prevT = p.t;
  }
  if (cur.length > 1) segs.push(cur);
  return segs;
}
