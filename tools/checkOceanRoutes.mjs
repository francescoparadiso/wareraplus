/* ══════════════════════════════════════════════════════════════
   WarEra+ — Controllo delle rotte marittime contro la terraferma
   ------------------------------------------------------------------
   `npm run check:routes`

   Le rotte decorative di src/diplomacy/oceanRoutes.js sono tappe messe
   a mano e incurvate da multiStopPath. Il 2026-10-20 si è scoperto che 8
   rotte su 13 passavano per oltre il 10% sopra i paesi (Portogallo,
   Oman, Patagonia, Sumatra…): disegnate SOTTO al riempimento dei paesi,
   si vedevano in trasparenza e le navi ci sparivano dentro. A occhio non
   lo si nota finché non si guarda proprio lì, quindi serve un controllo.

   Cosa fa: scarica la mappa di WarEra (map.getMapData, la stessa che usa
   l'app, pubblica), ricostruisce ogni rotta con la STESSA funzione del
   client (routePath) e prova un punto ogni frazione di segmento contro i
   poligoni delle regioni. Stampa per ogni rotta i tratti contigui sopra la
   terra, con le regioni attraversate, ed esce con codice 1 se ce n'è
   almeno uno.

   Unica eccezione: i CANALS dichiarati in oceanRoutes.js (Suez, che sulla
   mappa di WarEra è terra continua). Gli stretti NON hanno tolleranza:
   le loro coordinate sono già punti in mare.

   Strumento di sviluppo: non è importato dall'app e non finisce nel
   bundle. Usa topojson-client e d3-geo già presenti fra le dipendenze.
   ══════════════════════════════════════════════════════════════ */

import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'package.json'));
const topojson = require('topojson-client');
const d3 = require('d3-geo');
const { ROUTES, CANALS, ROUTE_ENDPOINTS, routePath } =
  await import(pathToFileURL(path.join(root, 'src/diplomacy/oceanRoutes.js')).href);

const CANAL_TOLERANCE = 0.3;  // gradi attorno all'asse di un canale
const SAMPLES_PER_SEGMENT = 6;

const res = await fetch('https://api6.warera.io/trpc/map.getMapData');
if (!res.ok) { console.error(`map.getMapData: HTTP ${res.status}`); process.exit(2); }
const topo = (await res.json()).result.data.map;
const regions = topojson.feature(topo, topo.objects.regions).features
  .map(f => ({ f, b: d3.geoBounds(f) }));

const norm = lng => ((lng + 540) % 360) - 180;

function regionAt(p) {
  const q = [norm(p[0]), p[1]];
  for (const { f, b } of regions) {
    if (b[0][0] <= b[1][0] && (q[0] < b[0][0] || q[0] > b[1][0])) continue;
    if (q[1] < b[0][1] || q[1] > b[1][1]) continue;
    if (d3.geoContains(f, q)) return f.properties?.regionCode || '?';
  }
  return null;
}

function distToSegment(p, a, b) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

const tolerated = p => {
  const q = [norm(p[0]), p[1]];
  return (CANALS || []).some(([a, b]) => distToSegment(q, a, b) < CANAL_TOLERANCE);
};

const fmt = p => `[${norm(p[0]).toFixed(1)}, ${p[1].toFixed(1)}]`;
let total = 0;

ROUTES.forEach((stops, i) => {
  const coords = routePath(stops);
  const runs = [];
  let run = null;
  let samples = 0;
  for (let k = 0; k < coords.length - 1; k++) {
    for (let s = 0; s < SAMPLES_PER_SEGMENT; s++) {
      const t = s / SAMPLES_PER_SEGMENT;
      const p = [coords[k][0] + (coords[k + 1][0] - coords[k][0]) * t, coords[k][1] + (coords[k + 1][1] - coords[k][1]) * t];
      samples++;
      const region = tolerated(p) ? null : regionAt(p);
      if (region) {
        if (!run) { run = { from: p, to: p, n: 0, regions: new Set() }; runs.push(run); }
        run.to = p; run.n++; run.regions.add(region);
      } else run = null;
    }
  }
  const bad = runs.reduce((s, r) => s + r.n, 0);
  total += bad;
  const { from, to } = ROUTE_ENDPOINTS[i];
  console.log(`${bad ? '✗' : '✓'} #${i} ${from} → ${to}: ${bad}/${samples} punti su terra`);
  for (const r of runs) console.log(`    ${fmt(r.from)} → ${fmt(r.to)}  (${r.n})  ${[...r.regions].join(', ')}`);
});

console.log(total ? `\n${total} punti sopra la terraferma.` : '\nNessuna rotta passa sopra la terraferma.');
process.exit(total ? 1 : 0);
