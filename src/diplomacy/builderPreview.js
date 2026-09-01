/* ══════════════════════════════════════════════════════════════
   WarEra+ — Le alleanze costruite nel builder, viste sulla mappa
   ------------------------------------------------------------------
   Alliance Builder (src/diplomacy/blocStats.js) sa gia' rispondere a
   "quanto danno farebbe questa fusione": il numero c'e', sulla scheda.
   Quello che mancava e' la domanda geografica — che FORMA ha il blocco
   che sto costruendo, e' contiguo, chi resta in mezzo — perche' il
   builder e' un elenco e la risposta e' una mappa.

   Qui si prende una FOTOGRAFIA dei blocchi del builder (l'uscita di
   computeBlocStats(), che gia' tiene conto di fusioni, riassegnazioni,
   alleanze inventate e cancellate) e la si mette in state.builderPreview.
   Da li' la legge la vista Alleanze:

     - diplomacy.js          → il colore delle nazioni sulla mappa
     - labels.js             → i nomi delle alleanze e il colore dei nomi nazione
     - ui.js                 → la legenda
     - panel/viewOverview.js → il riepilogo nel pannello

   Ognuno di quei punti fa `state.builderPreview ? ... : <come prima>`:
   additivo con fallback, secondo la regola del progetto. Nessuno scrive
   in state.blocColorMap / state.externalBlocsInfo, che restano dato di
   gioco condiviso — l'anteprima e' una lente sopra la mappa, non una
   modifica del mondo, e si toglie con un bottone (o cambiando vista).

   ⚠️ E' una fotografia, non un collegamento vivo: se si torna nel
   builder e si sposta un'altra nazione, la mappa non cambia finche' non
   si ripreme "Show on map". Deliberato — il builder si usa trascinando
   decine di pastiglie, e una mappa che si ridisegna ad ogni drop sarebbe
   solo rumore.
   ══════════════════════════════════════════════════════════════ */
import { state } from './state.js';
import { geometricMedian } from './alliances.js';

const BAR_ID = 'wp-builder-preview-bar';

export function isBuilderPreviewActive() {
  return !!state.builderPreview;
}

/* Posizione del nome dell'alleanza: la stessa mediana geometrica pesata
   per popolazione che processAlliancesData usa per le alleanze vere
   (alliances.js), cosi' un blocco inventato non si comporta diversamente
   da uno di gioco con gli stessi membri. */
function labelPosition(memberIds) {
  const points = [], weights = [];
  for (const id of memberIds) {
    const coord = state.labelsData.find(l => l.properties.countryId === id)?.coordinates;
    if (!coord) continue;
    const pop = state.nationMap.get(id)?.rankings?.countryActivePopulation?.value || 0;
    points.push(coord);
    weights.push(Math.max(pop, 1));
  }
  if (!points.length) return [null, null];
  const m = geometricMedian(points, weights);
  return [m[0], m[1]];
}

/* Da `allStats` del builder alla fotografia. Gli Unaligned non entrano:
   sulla mappa sono il colore di sfondo, esattamente come le nazioni senza
   alleanza nella vista vera. Le alleanze senza membri nemmeno — non
   colorano nulla, e nella legenda sarebbero una riga vuota. */
export function buildBuilderPreview(stats) {
  const colorMap = new Map();
  const blocs = [];
  for (const b of stats) {
    if (b.isUnaligned || !b.countryCount) continue;
    const memberIds = b.members.map(m => m.id);
    memberIds.forEach(id => colorMap.set(id, b.color));
    const [labelLng, labelLat] = labelPosition(memberIds);
    blocs.push({
      id: b.id,
      name: b.name,
      color: b.color,
      memberIds,
      memberCount: b.countryCount,
      pop: b.totalPop,
      dmg: b.totalDmg,
      bonus: b.bonus,
      labelLng,
      labelLat,
      // Solo per la barra: quante delle sue nazioni non stavano qui nel
      // mondo vero. E' la misura di "quanto e' inventata" questa alleanza.
      movedCount: memberIds.filter(id => state.blocColorMap.get(id) !== b.color).length,
    });
  }
  return { blocs, colorMap };
}

/* Entra in anteprima: fotografa, chiude il builder, porta la mappa in
   vista Alleanze. Il cambio vista passa dal bottone originale
   (#mode-blocs) invece che da setColoringMode: cosi' si aggiornano da
   soli anche la classe .active, le barre menu' e tutto quello che ci sta
   appeso, senza duplicare qui quella catena. */
export function enterBuilderPreview(stats) {
  const preview = buildBuilderPreview(stats);
  // Un builder senza nemmeno un'alleanza con membri non ha niente da
  // mostrare: si dice invece di aprire una mappa vuota.
  if (!preview.blocs.length) return false;
  state.builderPreview = preview;
  state.selectedBlocId = null;
  document.getElementById('bloc-stats-close')?.click();
  const modeBtn = document.getElementById('mode-blocs');
  if (modeBtn) modeBtn.click();
  else import('./map.js').then(m => m.setColoringMode('blocs')).catch(() => {});
  showBar();
  import('./map.js').then(m => m.renderMap()).catch(() => {});
  return true;
}

/* Esce e rimette la mappa com'era. Chiamata dal bottone della barra e da
   setColoringMode quando si lascia la vista Alleanze: un'anteprima che
   sopravvive a un cambio vista tornerebbe a sorpresa piu' tardi. */
export function exitBuilderPreview({ rerender = true } = {}) {
  if (!state.builderPreview) return;
  state.builderPreview = null;
  state.selectedBlocId = null;
  removeBar();
  if (rerender) import('./map.js').then(m => m.renderMap()).catch(() => {});
}

/* ── La barra ──────────────────────────────────────────────────
   Sta sopra la mappa perche' l'anteprima e' uno stato in cui si puo'
   restare a lungo (si zooma, si clicca, si cambia Attuale/Originale) e
   senza un'insegna fissa si finisce per credere che quelle siano le
   alleanze vere del gioco. Da qui si torna nel builder o si esce. */
function injectBarStyles() {
  if (document.getElementById('wp-bp-styles')) return;
  const s = document.createElement('style');
  s.id = 'wp-bp-styles';
  s.textContent = `
    /* In basso a sinistra e non in cima: la fascia alta della mappa in
       vista Alleanze e' gia' occupata dalla legenda larga (#legend-container,
       z-index 2100), e il centro-basso dalla pill dei crediti. Qui non
       copre nulla e resta sempre a vista. */
    #${BAR_ID}{position:fixed;left:12px;bottom:calc(env(safe-area-inset-bottom,0px) + 12px);z-index:2600;
      display:flex;align-items:center;gap:12px;flex-wrap:wrap;justify-content:flex-start;
      max-width:min(94vw,680px);padding:8px 14px;border-radius:12px;
      background:rgba(13,17,23,.92);border:1px solid rgba(163,113,247,.55);
      box-shadow:0 8px 26px rgba(0,0,0,.45);color:#e6edf3;
      font-family:'Inter',-apple-system,sans-serif;font-size:12.5px;backdrop-filter:blur(6px)}
    #${BAR_ID} .wp-bp-title{font-weight:700;color:#a371f7;display:flex;align-items:center;gap:6px}
    #${BAR_ID} .wp-bp-sub{color:#8b949e}
    #${BAR_ID} button{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.16);border-radius:8px;
      color:#c9d1d9;padding:5px 11px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s}
    #${BAR_ID} button:hover{background:rgba(255,255,255,.12);color:#fff;border-color:rgba(255,255,255,.32)}
    #${BAR_ID} button.wp-bp-exit:hover{color:#f85149;border-color:#f85149}
    body.light-theme #${BAR_ID}{background:rgba(255,255,255,.95);color:#24292f;border-color:rgba(110,64,201,.45)}
    body.light-theme #${BAR_ID} .wp-bp-title{color:#6e40c9}
    body.light-theme #${BAR_ID} .wp-bp-sub{color:#57606a}
    body.light-theme #${BAR_ID} button{border-color:rgba(0,0,0,.15);color:#24292f}
    @media (max-width:768px){
      /* Su telefono la pill dei crediti sta al centro in fondo: la barra
         sale sopra di lei e occupa tutta la larghezza utile. */
      #${BAR_ID}{left:8px;right:8px;max-width:none;bottom:calc(env(safe-area-inset-bottom,0px) + 68px);
        font-size:11.5px;padding:7px 11px;gap:8px;justify-content:center}
      #${BAR_ID} .wp-bp-sub{width:100%;text-align:center}
    }`;
  document.head.appendChild(s);
}

function showBar() {
  injectBarStyles();
  removeBar();
  const p = state.builderPreview;
  if (!p) return;
  const nations = p.blocs.reduce((s, b) => s + b.memberCount, 0);
  const moved = p.blocs.reduce((s, b) => s + b.movedCount, 0);
  const bar = document.createElement('div');
  bar.id = BAR_ID;
  bar.innerHTML = `
    <span class="wp-bp-title">🧭 Alliance Builder preview</span>
    <span class="wp-bp-sub">${p.blocs.length} alliances · ${nations} nations${moved ? ` · ${moved} reassigned` : ''}</span>
    <button type="button" data-bp="edit">✎ Back to builder</button>
    <button type="button" class="wp-bp-exit" data-bp="exit">✕ Exit preview</button>`;
  bar.querySelector('[data-bp="edit"]').addEventListener('click', () => {
    document.getElementById('bloc-stats-btn')?.click();
  });
  bar.querySelector('[data-bp="exit"]').addEventListener('click', () => exitBuilderPreview());
  document.body.appendChild(bar);
}

function removeBar() {
  document.getElementById(BAR_ID)?.remove();
}
