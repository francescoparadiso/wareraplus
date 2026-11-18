/* ══════════════════════════════════════════════════════════════
   AREA RISERVATA — leggere i numeri come li scrive una persona
   ------------------------------------------------------------------
   "10M" è dieci milioni, "500k" cinquecentomila, "1,5m" un milione e
   mezzo, "1.000.000" un milione. Il campo del danno era un
   `<input type=number>`: non accettava lettere, quindi nessuna delle
   forme con cui si scrive davvero nel gioco e in chat.

   Lo STESSO ragionamento sta nel bot (`server/discordBot/contratti.js:
   leggiNumero`), che non può importare da qui: se cambi uno, cambia l'altro.

   ── SUFFISSI ───────────────────────────────────────────────────────
   k, mila, mille, thousand      → ×1.000
   m, mln, mio, milion*, million* → ×1.000.000
   b, bn, mld, miliard*, billion* → ×1.000.000.000
   (non "mil": in spagnolo vale mille, in altre lingue un milione.)

   ── SEPARATORI ─────────────────────────────────────────────────────
   Con punto E virgola, l'ultimo è il decimale ("1.234,5" e "1,234.5").
   Un separatore ripetuto è delle migliaia ("1.000.000"). Un separatore
   solo è decimale ("1,5m", "0,08"), tranne che per un numero senza suffisso
   fatto di 1–3 cifre + separatore + 3 cifre ("500.000", "1,000"), che sono
   migliaia. Con `decimali: true` (la taglia: "0,125") un separatore solo è
   SEMPRE decimale.
   ══════════════════════════════════════════════════════════════ */

const SUFFISSI = [
  [/^(k|mila|mille|thousand)$/, 1e3],
  [/^(m|mln|mio|milion[ei]?|million[s]?)$/, 1e6],
  [/^(b|bn|mld|miliard[oi]|billion[s]?)$/, 1e9],
];

/**
 * @param {string} testo
 * @param {{decimali?: boolean}} [opz]  un separatore solo e' sempre decimale
 * @returns {number} NaN se non si capisce (mai 0 per "boh")
 */
export function leggiNumero(testo, { decimali = false } = {}) {
  const t = String(testo ?? '').trim().toLowerCase().replace(/[\s_']/g, '');
  const m = t.match(/^(\d[\d.,]*|[.,]\d+)([a-z]*)$/);
  if (!m) return NaN;
  let [, n, suf] = m;

  let molt = 1;
  if (suf) {
    const s = SUFFISSI.find(([re]) => re.test(suf));
    if (!s) return NaN;
    molt = s[1];
  }

  const ultimoPunto = n.lastIndexOf('.');
  const ultimaVirgola = n.lastIndexOf(',');
  if (ultimoPunto >= 0 && ultimaVirgola >= 0) {
    // l'ultimo dei due e' il decimale, l'altro separa le migliaia
    const dec = ultimoPunto > ultimaVirgola ? '.' : ',';
    const mil = dec === '.' ? ',' : '.';
    n = n.split(mil).join('').replace(dec, '.');
  } else if (ultimoPunto >= 0 || ultimaVirgola >= 0) {
    const sep = ultimoPunto >= 0 ? '.' : ',';
    const parti = n.split(sep);
    if (parti.length > 2) n = parti.join('');                         // "1.000.000": migliaia
    else if (!decimali && !suf && parti[0].length <= 3 && parti[1].length === 3 && parti[0] !== '0' && parti[0] !== '') {
      n = parti.join('');                                              // "500.000", "1,000": migliaia
    } else n = parti.join('.');                                        // "1,5", "0,08": decimale
  }
  const v = Number(n);
  return Number.isFinite(v) ? v * molt : NaN;
}

/** Il numero com'e' stato capito, per mostrarlo sotto il campo ("= 10.000.000"). */
export function mostraNumero(v, lingua) {
  if (!Number.isFinite(v)) return '';
  return v.toLocaleString(lingua || undefined, { maximumFractionDigits: 3 });
}
