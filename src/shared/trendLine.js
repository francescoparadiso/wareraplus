/* ══════════════════════════════════════════════════════════════
   WarEra+ — Linee che cambiano colore con la direzione
   ------------------------------------------------------------------
   Nei grafici a UNA serie nel tempo (prezzi, ricchezza, soldi) ogni
   tratto fra due punti è verde se il valore sale, rosso se scende, grigio
   se non cambia. Lo stesso verde e lo stesso rosso delle variazioni in
   percentuale (`--wp-ecn-up` / `--wp-ecn-down`), così il colore della
   linea e quello del "+3,2%" accanto dicono la stessa cosa.

   NON si usa per i grafici a più serie (stile di gioco, nazioni a
   confronto, schieramenti): lì il colore dice CHI è, e farlo dire anche
   «sale/scende» li renderebbe illeggibili. Né per i grafici dove salire
   non è «bene» o «male» in sé (danni, pillole).

   Il colore dipende dal valore, non dalla posizione sullo schermo: la
   scala può essere capovolta o troncata senza che cambi il verso.

   Uno stesso colore per tratti consecutivi diventa UN solo percorso, non
   uno per segmento: una serie da 365 giorni resta tre `<path>` e non
   trecento.
   ══════════════════════════════════════════════════════════════ */

/**
 * @param {Array<{x:number, y:number, v:number, gap?:boolean}>} pts punti nello
 *   spazio dello schermo (`x`, `y`) col loro valore (`v`). `gap: true` stacca
 *   il punto da quello prima (un buco nella serie non si attraversa).
 * @returns {{ up:string, down:string, flat:string, last:'up'|'down'|'flat'|null }}
 */
export function trendPaths(pts) {
  const out = { up: '', down: '', flat: '', last: null };
  let dir = null;
  let run = '';
  const flush = () => { if (run) out[dir] += run; run = ''; };
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (b.gap || !Number.isFinite(a.v) || !Number.isFinite(b.v)) { flush(); dir = null; continue; }
    const d = b.v > a.v ? 'up' : b.v < a.v ? 'down' : 'flat';
    if (d !== dir || !run) {
      flush();
      dir = d;
      run = `M${a.x.toFixed(1)},${a.y.toFixed(1)}`;
    }
    run += `L${b.x.toFixed(1)},${b.y.toFixed(1)}`;
    out.last = d;
  }
  flush();
  return out;
}

/** I `<path>` pronti, uno per colore, con `cls` come classe di base (quella
 *  che dà spessore e angoli) più `wp-trend-up|down|flat`. */
export function trendLineSvg(pts, cls) {
  const t = trendPaths(pts);
  return ['flat', 'down', 'up']
    .filter(k => t[k])
    .map(k => `<path d="${t[k]}" class="${cls} wp-trend-${k}"/>`)
    .join('');
}

/** Il colore del punto finale: quello dell'ultimo tratto. */
export function trendLast(pts) {
  return trendPaths(pts).last || 'flat';
}
