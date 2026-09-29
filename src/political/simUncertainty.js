/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political: quanto è incerta la proiezione dei seggi
   ------------------------------------------------------------------
   Il simulatore del congresso proiettava un numero secco: "7 seggi".
   Ma quel numero viene dalla quota di voti dell'ultima elezione (o dal
   parziale di quella in corso), e le quote si muovono. Quanto si
   muovono si può MISURARE sulla storia di QUELLA nazione, invece di
   inventarlo:

     k = scarto quadratico medio di  Δquota / √(q·(1−q))

   su una coppia di congressi consecutivi, per ogni partito presente in
   almeno una delle due — e poi la mediana delle ultime cinque coppie. La divisione per √(q(1−q)) rende confrontabili
   un partito al 40% e uno al 3% (un piccolo non può perdere dieci
   punti), ed è la stessa forma dell'errore di un campione binomiale —
   per questo k si legge come "quante volte più mobile di un sondaggio
   perfetto".

   Poi Monte Carlo: DRAWS estrazioni con quote perturbate da un rumore
   normale di deviazione k·√(q(1−q))·√f, riportate a somma 1 e
   ridistribuite col metodo dei resti più alti (lo stesso del
   simulatore). L'intervallo è l'80% centrale dei seggi di ogni partito.

   `f` è la parte di elettorato che deve ancora votare: 1 prima del
   voto, e scende durante lo spoglio (votanti attuali / attesi). A
   scrutinio quasi finito l'incertezza si chiude da sola.

   ⚠️ Senza almeno due coppie di elezioni (tre congressi) k non si
   stima e non si inventa: nessun intervallo, e il simulatore lo dice.
   Un seme fisso rende l'intervallo stabile fra un ridisegno e l'altro.
   ══════════════════════════════════════════════════════════════ */

const DRAWS = 600;
const MIN_PAIRS = 2;
const PAIRS_USED = 5;

/** Quote di voto per partito di un'elezione congressuale (lista cache:
 *  i voti per candidato stanno in `votes`, voteCount fa da ripiego). */
function sharesOf(election) {
  const votes = election?.votes && typeof election.votes === 'object' ? election.votes : {};
  const by = new Map();
  let tot = 0;
  for (const c of election?.candidates || []) {
    const uid = String(c.user || c.userId || '');
    const pid = String(c.party || c.partyId || 'independent');
    const v = Number(votes[uid] ?? c.voteCount ?? 0) || 0;
    by.set(pid, (by.get(pid) || 0) + v);
    tot += v;
  }
  if (!tot) return null;
  for (const [k, v] of by) by.set(k, v / tot);
  return by;
}

/**
 * Volatilità normalizzata della nazione. `null` se la storia è corta.
 * @param {Array} history elezioni (electionHistory di Political)
 * @param {string} [excludeId] l'elezione in corso, da non contare
 */
export function volatilityK(history, excludeId = null) {
  const cong = (history || [])
    .filter(e => e.type === 'congress' && e._id !== excludeId)
    .filter(e => e.status == null || e.status === 'finished')
    .sort((a, b) => new Date(a.votesEndAt || a.createdAt) - new Date(b.votesEndAt || b.createdAt))
    .map(sharesOf)
    .filter(Boolean);
  // Un k per coppia, poi la MEDIANA delle ultime PAIRS_USED. Non la media
  // di tutto: la coppia in cui il sistema dei partiti si forma (un partito
  // da 0 a 48% — Italia, marzo 2026, k 1,28 contro 0,13-0,22 dei mesi
  // dopo) da sola raddoppiava l'intervallo di ogni proiezione di oggi.
  const ks = [];
  for (let i = 1; i < cong.length; i++) {
    const a = cong[i - 1], b = cong[i];
    let sum = 0, n = 0;
    for (const k of new Set([...a.keys(), ...b.keys()])) {
      const qa = a.get(k) || 0, qb = b.get(k) || 0;
      const q = (qa + qb) / 2;
      if (q < 0.01 || q > 0.99) continue;   // briciole, o un partito unico: niente da misurare
      const z = (qb - qa) / Math.sqrt(q * (1 - q));
      sum += z * z; n++;
    }
    if (n) ks.push(Math.sqrt(sum / n));
  }
  const recent = ks.slice(-PAIRS_USED).sort((x, y) => x - y);
  if (recent.length < MIN_PAIRS) return null;
  const mid = recent.length >> 1;
  const k = recent.length % 2 ? recent[mid] : (recent[mid - 1] + recent[mid]) / 2;
  return { k, pairs: recent.length };
}

function largestRemainder(shares, total) {
  const s = shares.reduce((a, b) => a + b, 0);
  if (!s) return shares.map(() => 0);
  const q = shares.map(x => (x / s) * total);
  const fl = q.map(Math.floor);
  let rest = total - fl.reduce((a, b) => a + b, 0);
  q.map((x, i) => ({ i, r: x - fl[i] })).sort((a, b) => b.r - a.r).forEach(o => { if (rest-- > 0) fl[o.i]++; });
  return fl;
}

/** Generatore deterministico (mulberry32): stesso input, stesso intervallo. */
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gauss(r) {
  const u = Math.max(1e-12, r()), v = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/**
 * Intervallo 80% dei seggi per ogni partito.
 * @param {number[]} shares quote (o voti, o iscritti) nello stesso ordine della proiezione
 * @param {number} totalSeats
 * @param {number} k volatilità normalizzata
 * @param {number} remaining quota di elettorato che deve ancora votare (0..1)
 * @returns {Array<{lo:number, hi:number}>}
 */
export function seatIntervals(shares, totalSeats, k, remaining = 1) {
  const s = shares.reduce((a, b) => a + b, 0);
  if (!s || !totalSeats || !(k > 0)) return null;
  const q = shares.map(x => x / s);
  const f = Math.sqrt(Math.min(1, Math.max(0, remaining)));
  const r = rng(Math.round(s * 1000) ^ (totalSeats * 7919) ^ shares.length);
  const samples = q.map(() => []);
  for (let d = 0; d < DRAWS; d++) {
    const noisy = q.map(x => Math.max(0, x + gauss(r) * k * Math.sqrt(x * (1 - x)) * f));
    largestRemainder(noisy, totalSeats).forEach((seats, i) => samples[i].push(seats));
  }
  return samples.map(arr => {
    arr.sort((a, b) => a - b);
    return { lo: arr[Math.floor(arr.length * 0.1)], hi: arr[Math.ceil(arr.length * 0.9) - 1] };
  });
}
