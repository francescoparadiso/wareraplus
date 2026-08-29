/* ══════════════════════════════════════════════════════════════
   WarEra+ — Statistiche nazioni: le metriche, in un posto solo
   ------------------------------------------------------------------
   Panoramica, confronto 1vs2, grafici e scheda nazione parlano tutti
   degli stessi numeri. Definirli una volta qui evita che la stessa
   colonna significhi due cose diverse in due schede (è già successo
   altrove: vedi la nota su `value`/`total` in src/mu/playstyle.js).

   Ogni metrica dichiara: chiave, etichetta i18n, come si estrae da una
   nazione, come si formatta e se è "più alto = meglio" (serve al
   confronto, dove tasse e malcontento vanno letti al contrario).

   I dati vengono tutti da `state.nazioniGlobal`, cioè dall'unica
   country.getAllCountries che l'app fa al boot: nessuna metrica qui
   dentro costa una richiesta.
   ══════════════════════════════════════════════════════════════ */

import { fmtCompact, fmtFull } from '../mu/ui.js';

const num = v => (Number.isFinite(v) ? v : 0);

/** Popolazione: `currentPopulation` è il dato del gioco; il censimento del
 *  server (/citizens) conta le anagrafiche vere e le due non coincidono
 *  sempre. Qui vince il gioco, il censimento resta un dato a parte nella
 *  scheda — sono due domande diverse ("quanti attivi" vs "quanti iscritti"). */
export const METRICS = [
  { key: 'pop',     label: 'citizens',    get: n => num(n.currentPopulation ?? n.rankings?.countryActivePopulation?.value), fmt: fmtCompact },
  { key: 'weekly',  label: 'weekly',      get: n => num(n.rankings?.weeklyCountryDamages?.value), fmt: fmtCompact, cls: 'wk' },
  { key: 'total',   label: 'total',       get: n => num(n.rankings?.countryDamages?.value), fmt: fmtCompact },
  { key: 'wealth',  label: 'wealth',      get: n => num(n.rankings?.countryWealth?.value ?? n.money), fmt: fmtCompact, cls: 'money' },
  { key: 'dev',     label: 'development', get: n => num(n.currentDevelopment ?? n.rankings?.countryDevelopment?.value), fmt: v => v.toFixed(1) },
  { key: 'coreDev', label: 'coreDev',     get: n => num(n.coreDevelopment), fmt: v => v.toFixed(1) },
  { key: 'regions', label: 'regions',     get: n => num(n.rankings?.countryRegionDiff?.value), fmt: v => signed(v), signed: true },
  { key: 'wars',    label: 'wars',        get: n => (n.warsWith?.length || 0), fmt: v => String(v), higherIsBetter: false },
  { key: 'allies',  label: 'allies',      get: n => (n.allies?.length || 0), fmt: v => String(v) },
  { key: 'taxes',   label: 'taxes',       get: n => num(avgTax(n)), fmt: v => `${v.toFixed(1)}%`, higherIsBetter: false },
  // `unrest` non e' una percentuale ma { bar, barMax }: quanto e' pieno il
  // serbatoio del malcontento. Qui si mostra come quota del massimo.
  { key: 'unrest',  label: 'unrest',      get: n => unrestPct(n), fmt: v => `${v.toFixed(1)}%`, higherIsBetter: false },
  { key: 'perCit',  label: 'perCitizen',  get: n => num(n.rankings?.weeklyCountryDamagesPerCitizen?.value), fmt: fmtCompact },
  { key: 'bounty',  label: 'bounty',      get: n => num(n.rankings?.countryBounty?.value), fmt: fmtCompact },
  // Bonus produzione dalle risorse strategiche: il gioco lo espone già in
  // due posti nella stessa risposta — `strategicResources.bonuses.
  // productionPercent` e la classifica `countryProductionBonus`. Si legge
  // il primo e si ricade sul secondo, che è lo stesso numero.
  { key: 'prod',    label: 'production',  get: n => num(n.strategicResources?.bonuses?.productionPercent ?? n.rankings?.countryProductionBonus?.value), fmt: v => `+${v.toFixed(0)}%` },
];

function unrestPct(n) {
  const max = n?.unrest?.barMax;
  if (!Number.isFinite(max) || max <= 0) return 0;
  return (num(n.unrest.bar) / max) * 100;
}

/** Le tasse in WarEra sono più d'una (import/export/lavoro…): in
 *  panoramica ne serve una sola, la media di quelle dichiarate. */
function avgTax(n) {
  const t = n.taxes;
  if (!t) return 0;
  const vals = Object.values(t).filter(v => Number.isFinite(v));
  return vals.length ? vals.reduce((s, v) => s + v, 0) / vals.length : 0;
}

export function signed(v) {
  if (!Number.isFinite(v) || v === 0) return '0';
  return v > 0 ? `+${v}` : String(v);
}

export function metric(key) {
  return METRICS.find(m => m.key === key) || METRICS[1];
}

export function metricValue(nation, key) {
  return metric(key).get(nation);
}

export function metricText(nation, key) {
  const m = metric(key);
  return m.fmt(m.get(nation));
}

export { fmtCompact, fmtFull };
