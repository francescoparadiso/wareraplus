// battleFront/momentum.js
//
// WarEra+ — analisi "momentum" (chi sta guadagnando terreno, a che ritmo,
// fra quanto sorpasserebbe) usata dalla HUD di battleFront.js. Sottosistema
// autonomo: tiene il proprio storico danni e il proprio ultimo risultato
// calcolato SOLO qui dentro, letto/scritto dal resto del modulo solo tramite
// le funzioni esportate sotto — quindi resta isolato dallo stato del resto
// della vista (nessuna scena da sincronizzare, a differenza della vecchia
// battleWall3D.js: questo file è identico a quello, spostato senza modifiche
// di logica quando la vista 3D è stata sostituita da battleFront.js).

// Finestra corta: 3 minuti rendevano il momentum lentissimo a reagire — un
// cambio di ritmo impiegava minuti a comparire. 45s con pesi esponenziali
// (metà peso ogni HALF_LIFE_MS) reagisce in pochi secondi restando stabile.
const MOMENTUM_WINDOW_MS = 45000;
const MOMENTUM_HALF_LIFE_MS = 12000;
const MIN_SAMPLES = 2;

let damageHistory = [];
let lastMomentum = null;
let momentumAt = 0;

export function pushDamageSample(totalDef, totalAtk) {
  const now = Date.now();
  damageHistory.push({ t: now, def: totalDef, atk: totalAtk });
  while (damageHistory.length && now - damageHistory[0].t > MOMENTUM_WINDOW_MS) {
    damageHistory.shift();
  }
}

// Pendenza (danno al secondo) via minimi quadrati PESATI: i campioni recenti
// contano di più (peso 0.5^(eta/HALF_LIFE)), così un'accelerazione improvvisa
// si vede subito invece di essere diluita su tutta la finestra.
function slopePerSec(samples, key) {
  const n = samples.length;
  if (n < 2) return 0;
  const t0 = samples[0].t;
  const tEnd = samples[n - 1].t;
  let sw = 0, sx = 0, sy = 0, sxy = 0, sxx = 0;
  for (const s of samples) {
    const w = Math.pow(0.5, (tEnd - s.t) / MOMENTUM_HALF_LIFE_MS);
    const x = (s.t - t0) / 1000;
    const y = s[key];
    sw += w; sx += w * x; sy += w * y; sxy += w * x * y; sxx += w * x * x;
  }
  const denom = sw * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return 0;
  return (sw * sxy - sx * sy) / denom;
}

function computeMomentum(totalDef, totalAtk) {
  const samples = damageHistory;
  const spanSec = samples.length >= 2 ? (samples[samples.length - 1].t - samples[0].t) / 1000 : 0;
  if (samples.length < MIN_SAMPLES || spanSec < 3) {
    return { ready: false, spanSec };
  }

  const rateDef = Math.max(0, slopePerSec(samples, 'def'));
  const rateAtk = Math.max(0, slopePerSec(samples, 'atk'));

  const leader = totalDef >= totalAtk ? 'defender' : 'attacker';
  const lead = Math.abs(totalDef - totalAtk);
  const leadRate = leader === 'defender' ? rateDef : rateAtk;
  const trailRate = leader === 'defender' ? rateAtk : rateDef;
  const gain = trailRate - leadRate;   // >0 = chi insegue sta recuperando

  // Tempo al sorpasso: distacco diviso il ritmo di recupero. Ha senso solo se
  // il recupero è significativo (>0.5% del ritmo del leader) e la finestra
  // temporale è abbastanza lunga da non amplificare il rumore.
  let etaSec = null;
  if (gain > 0 && gain > leadRate * 0.005 && lead > 0) {
    etaSec = lead / gain;
    if (etaSec > 86400) etaSec = null;   // oltre 24h non è un'informazione utile
  }

  // Indice di inerzia -1..1: quota del ritmo totale presa da ciascun lato.
  const rateSum = rateDef + rateAtk;
  const balance = rateSum > 0 ? (rateDef - rateAtk) / rateSum : 0;

  return {
    ready: true, spanSec, rateDef, rateAtk,
    leader, lead, trailer: leader === 'defender' ? 'attacker' : 'defender',
    gain, etaSec, balance,
  };
}

// Chiamata ad ogni poll: ricalcola i ritmi dallo storico e memorizza il
// risultato + l'istante (serve al chiamante per estrapolare fra un poll e
// l'altro). Ritorna il risultato anche per chi vuole usarlo subito.
export function updateMomentum(totalDef, totalAtk) {
  const m = computeMomentum(totalDef, totalAtk);
  lastMomentum = m.ready ? m : null;
  momentumAt = Date.now();
  return lastMomentum;
}

export function getLastMomentum() {
  return lastMomentum;
}

export function getMomentumAt() {
  return momentumAt;
}

export function resetMomentum() {
  damageHistory = [];
  lastMomentum = null;
  momentumAt = 0;
}
