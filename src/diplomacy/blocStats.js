import { state } from './state.js';
import { trackEvent } from '../shared/analytics.js';

/* ── Helpers ── */
function fmt(n, d = 1, full = false) {
  if (n == null || isNaN(n)) return '—';
  if (full) return Math.round(n).toLocaleString();
  if (n >= 1e9) return (n / 1e9).toFixed(d) + 'B';
  if (n >= 1e6) return (n / 1e6).toFixed(d) + 'M';
  if (n >= 1e3) return (n / 1e3).toFixed(d) + 'K';
  return Math.round(n).toLocaleString();
}

function flagImg(code, h = '14px') {
  if (!code) return '';
  return `<img src="https://media.warera.io/images/flags/${code.toLowerCase()}.svg?v=16" style="height:${h};width:auto;border-radius:2px;vertical-align:middle;flex-shrink:0;" onerror="this.style.display='none'">`;
}

/* ── State ── */
let allStats = [], currentTab = 'factions', faction1Blocs = [], faction2Blocs = [];
const manualAssign = new Map();       // nationId → target bloc name (original)
const mergedBlocs = new Map();        // mergeId → { displayName: string, originals: [string] }
const blocColors = new Map();         // blocName → color
let mergeCounter = 0;
let dragData = null;
let eventsAttached = false;
// Ricerca tracciata una volta sola PER APERTURA del pannello (non per ogni
// carattere digitato, che sarebbe rumore): azzerato in renderBlocStats,
// cioè al vero punto di ingresso "il pannello si apre da capo".
let searchTracked = false;

/* ── Compute Stats ── */
export function computeBlocStats() {
  blocColors.clear();
  state.externalBlocsInfo.forEach(b => blocColors.set(b.name, b.color));
  blocColors.set('🌐 Unaligned', '#484f58');

  const blocMembers = new Map();
  state.externalBlocsInfo.forEach(b => blocMembers.set(b.name, new Set()));

  for (const [cid, color] of state.blocColorMap) {
    const bloc = state.externalBlocsInfo.find(x => x.color === color);
    if (bloc && !manualAssign.has(cid)) {
      blocMembers.get(bloc.name).add(cid);
    }
  }

  for (const [cid, bname] of manualAssign) {
    if (!blocMembers.has(bname)) blocMembers.set(bname, new Set());
    blocMembers.get(bname).add(cid);
  }

  const alignedIds = new Set();
  for (const [, ids] of blocMembers) ids.forEach(id => alignedIds.add(id));

  const unalignedIds = new Set();
  for (const [cid] of state.nationMap) {
    if (!alignedIds.has(cid)) unalignedIds.add(cid);
  }
  blocMembers.set('unaligned', unalignedIds);

  const stats = [];
  const processedNames = new Set();

  for (const [mergeId, mergeData] of mergedBlocs) {
    const { displayName, originals } = mergeData;
    const combined = new Set();
    originals.forEach(name => {
      if (blocMembers.has(name)) blocMembers.get(name).forEach(id => combined.add(id));
      processedNames.add(name);
    });
    const color = blocColors.get(originals[0]) || '#555';
    stats.push(buildBlocStat(displayName, mergeId, combined, color, true));
  }

  for (const [bname, ids] of blocMembers) {
    if (processedNames.has(bname)) continue;
    const displayName = (bname === 'unaligned') ? '🌐 Unaligned' : bname;
    const isUnaligned = (bname === 'unaligned');
    stats.push(buildBlocStat(displayName, bname, ids, blocColors.get(displayName) || '#555', false, isUnaligned));
  }

  return stats.sort((a, b) => b.totalDmg - a.totalDmg);
}

function buildMember(cid) {
  const n = state.nationMap.get(cid);
  if (!n) return null;
  return {
    id: cid, name: n.name, code: n.code || '',
    pop:   n?.rankings?.countryActivePopulation?.value || 0,
    dmg:   n?.rankings?.weeklyCountryDamages?.value || 0,
    totalDmg: n?.rankings?.countryDamages?.value || 0,
    money: n?.rankings?.countryWealth?.value ?? n.money ?? 0,
    dev:   n?.rankings?.countryDevelopment?.value || 0,
    bounty: n?.rankings?.countryBounty?.value || 0,
    dpc:   n?.rankings?.weeklyCountryDamagesPerCitizen?.value || 0,
    wars:  n?.warsWith?.length || 0,
    sworn: n?.swornEnemies?.length || 0,
    allies:n?.allies?.length || 0,
  };
}

function buildBlocStat(displayName, internalId, idSet, color, isMerged = false, isUnaligned = false) {
  let totalPop = 0, totalDmg = 0, totalMoney = 0, totalWars = 0, totalSworn = 0, totalAllies = 0, totalAbsoluteDmg = 0;
  let totalBounty = 0, totalDev = 0;
  const members = [];
  idSet.forEach(cid => {
    const m = buildMember(cid); if (!m) return;
    totalPop += m.pop; totalDmg += m.dmg; totalMoney += m.money;
    totalWars += m.wars; totalSworn += m.sworn; totalAllies += m.allies;
    totalAbsoluteDmg += m.totalDmg; totalBounty += m.bounty; totalDev += m.dev;
    members.push(m);
  });
  const countryCount = members.length;
  return {
    id: internalId,
    name: displayName,
    color, isMerged, isUnaligned,
    members: members.sort((a, b) => b.dmg - a.dmg),
    countryCount,
    totalPop, totalDmg, totalMoney, totalWars, totalSworn, totalAllies, totalAbsoluteDmg,
    totalBounty, totalDev,
    // Derivate: sviluppo medio e danno settimanale per cittadino dell'alleanza.
    avgDev: countryCount ? totalDev / countryCount : 0,
    dpc: totalPop ? totalDmg / totalPop : 0,
  };
}

/* ── Entry ── */
export function renderBlocStats(stats) {
  const c = document.getElementById('bloc-stats-content');
  if (!c) return;
  if (!stats.length) { c.innerHTML = '<p style="text-align:center;color:#8b949e;padding:40px;">No data.</p>'; return; }
  allStats = stats;
  injectStyles();
  if (!eventsAttached) { attachEvents(c); eventsAttached = true; }
  searchTracked = false;
  buildUI();
}

/* ── CSS ── */
function injectStyles() {
  if (document.getElementById('bss')) return;
  const s = document.createElement('style'); s.id = 'bss';
  s.textContent = `
    /* ===== DARK THEME (default) ===== */
    .bsw{max-width:1500px;margin:0 auto;padding:24px;color:#e6edf3;font-family:'Inter',-apple-system,sans-serif}
    .bs-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px}
    .bs-reset-btn{background:rgba(255,80,80,.15);border:1px solid rgba(255,80,80,.5);border-radius:8px;padding:6px 14px;color:#ff6b6b;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s}
    .bs-reset-btn:hover{background:rgba(255,80,80,.25);border-color:#ff6b6b}
    .bs-tabs{display:flex;gap:8px;margin-bottom:28px;border-bottom:1px solid rgba(255,255,255,.1);padding-bottom:12px;flex-wrap:wrap}
    .bs-tab{padding:8px 18px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#8b949e;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s}
    .bs-tab:hover{background:rgba(255,255,255,.08);color:#e6edf3}
    .bs-tab.active{background:rgba(88,166,255,.15);border-color:#58a6ff;color:#58a6ff}
    .bs-sum{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px}
    .bs-sc{background:rgba(13,17,23,.6);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:18px}
    .bs-sl{font-size:11px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
    .bs-sv{font-size:22px;font-weight:700}
    .bs-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(380px,1fr));gap:18px;margin-top:24px}
    .bs-card{background:rgba(13,17,23,.85);border:1px solid rgba(255,255,255,.1);border-radius:12px;overflow:hidden;transition:transform .2s,box-shadow .2s}
    .bs-card:hover{transform:translateY(-2px);box-shadow:0 8px 24px rgba(0,0,0,.4)}
    .bs-card.unaligned{border-style:dashed;border-color:rgba(255,255,255,.2)}
    .bs-card.drag-over{border-color:#58a6ff !important;border-style:solid !important;box-shadow:0 0 20px rgba(88,166,255,.4)}
    .bs-card.dragging{opacity:.4;transform:scale(.96)}
    .bs-hdr{padding:14px 18px;display:flex;justify-content:space-between;align-items:center;font-weight:700;font-size:15px;cursor:grab}
    .bs-hdr:active{cursor:grabbing}
    .bs-stats-row{display:flex;flex-wrap:wrap;gap:8px;padding:10px 18px;border-bottom:1px solid rgba(255,255,255,.05)}
    .bs-chip{background:rgba(255,255,255,.05);border-radius:6px;padding:5px 10px;font-size:12px;display:flex;align-items:center;gap:5px;color:#c9d1d9}
    .bs-members{padding:12px 18px;display:flex;flex-wrap:wrap;gap:6px;max-height:180px;overflow-y:auto}
    .bs-members::-webkit-scrollbar{width:4px}
    .bs-members::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:2px}
    .bs-pill{background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:4px 10px;font-size:12px;display:flex;align-items:center;gap:5px;color:#c9d1d9;white-space:nowrap;transition:background .15s;cursor:pointer}
    .bs-pill:hover{background:rgba(88,166,255,.2);border-color:#58a6ff}
    .bs-pill[draggable="true"]{cursor:grab}
    .bs-pill[draggable="true"]:hover{border-color:#58a6ff;background:rgba(88,166,255,.1)}
    .bs-split-btn{background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);border-radius:6px;padding:4px 10px;font-size:11px;color:#e6edf3;cursor:pointer;margin-left:8px}
    .bs-split-btn:hover{background:rgba(255,255,255,.2)}
    .bs-mergebtn{background:rgba(88,166,255,.15);border:1px solid rgba(88,166,255,.4);border-radius:6px;padding:2px 8px;font-size:14px;color:#58a6ff;cursor:pointer;line-height:1;transition:all .2s}
    .bs-mergebtn:hover{background:rgba(88,166,255,.3);border-color:#58a6ff}
    .bs-unaligned-hint{font-size:11px;color:#8b949e;padding:8px 18px 12px;font-style:italic}

    /* Merge menu */
    .bs-merge-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.5);z-index:10001;backdrop-filter:blur(2px)}
    .bs-merge-menu{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#1e242c;border:1px solid #30363d;border-radius:16px;padding:20px;min-width:280px;max-width:400px;box-shadow:0 20px 40px rgba(0,0,0,.6);z-index:10002}
    .bs-merge-menu h3{margin:0 0 12px 0;font-size:18px;color:#e6edf3}
    .bs-merge-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;max-height:400px;overflow-y:auto;padding:4px}
    .bs-merge-option{display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.1);border-radius:8px;cursor:pointer;transition:all .15s}
    .bs-merge-option:hover{background:rgba(88,166,255,.15);border-color:#58a6ff}
    .bs-merge-color{width:20px;height:20px;border-radius:20px;flex-shrink:0}
    .bs-merge-name{font-weight:500;color:#e6edf3}
    .bs-merge-close{position:absolute;top:12px;right:16px;cursor:pointer;color:#8b949e;font-size:20px}
    .bs-merge-close:hover{color:#fff}

    /* Popup */
    .bs-popup-overlay{position:fixed;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.7);z-index:9999;backdrop-filter:blur(3px)}
    .bs-popup{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:#161b22;border:1px solid #30363d;border-radius:14px;padding:24px;z-index:10000;box-shadow:0 24px 80px rgba(0,0,0,.85);max-width:92vw}
    .bs-popup.nation-popup{width:560px}
    .bs-popup.bloc-popup{width:780px}
    .bs-popup-header{display:flex;align-items:center;gap:12px;padding-bottom:14px;border-bottom:1px solid #30363d;margin-bottom:16px}
    .bs-popup-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px 16px;font-size:14px}
    .bs-popup-item{display:flex;flex-direction:column;color:#8b949e;padding:10px 12px;background:rgba(255,255,255,.03);border-radius:8px}
    .bs-popup-item span{color:#e6edf3;font-weight:600;font-size:17px;margin-top:2px}
    .bs-popup-percent{grid-column:span 2;background:linear-gradient(90deg,rgba(88,166,255,.18),rgba(88,166,255,.08));padding:14px;border-radius:8px;text-align:center;font-weight:700;color:#58a6ff;font-size:16px;margin-top:6px;border:1px solid rgba(88,166,255,.3)}
    .bs-popup-close{position:absolute;top:12px;right:14px;cursor:pointer;color:#8b949e;font-size:22px;width:32px;height:32px;display:flex;align-items:center;justify-content:center;border-radius:6px;transition:all .15s}
    .bs-popup-close:hover{color:#fff;background:rgba(255,255,255,.1)}

    /* Bloc popup breakdown */
    .bs-breakdown-header{display:flex;align-items:center;gap:8px;padding:8px 12px;font-size:12px;color:#8b949e;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid rgba(255,255,255,.08);background:rgba(0,0,0,.2);border-radius:6px;margin-bottom:6px}
    .bs-breakdown-header .col{font-weight:600;cursor:pointer;transition:color .15s;user-select:none}
    .bs-breakdown-header .col:hover{color:#58a6ff}
    .bs-breakdown-header .col.active{color:#58a6ff}
    .bs-breakdown-row{display:flex;align-items:center;gap:10px;padding:8px 12px;border-bottom:1px solid rgba(255,255,255,.04);font-size:13px;transition:background .15s}
    .bs-breakdown-row:hover{background:rgba(255,255,255,.04)}
    .bs-breakdown-row .flag-name{flex:1;display:flex;align-items:center;gap:8px;min-width:0}
    .bs-breakdown-row .flag-name span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e6edf3;font-weight:500}
    .bs-breakdown-row .bar-wrap{flex:1;height:6px;background:rgba(255,255,255,.08);border-radius:3px;overflow:hidden;min-width:60px}
    .bs-breakdown-row .bar-fill{height:100%;border-radius:3px;transition:width .3s}
    .bs-breakdown-row .val{min-width:60px;text-align:right;font-weight:600;font-size:13px}
    .bs-breakdown-row .val.pct{color:#58a6ff;min-width:50px}
    .bs-breakdown-body{max-height:340px;overflow-y:auto}
    .bs-breakdown-body::-webkit-scrollbar{width:6px}
    .bs-breakdown-body::-webkit-scrollbar-thumb{background:rgba(255,255,255,.15);border-radius:3px}

    @keyframes glowPulse{0%,100%{opacity:.6;box-shadow:0 0 6px currentColor}50%{opacity:1;box-shadow:0 0 14px currentColor}}
    .bs-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0;animation:glowPulse 2s ease-in-out infinite}

    .bs-sel{display:grid;grid-template-columns:1fr auto 1fr;gap:20px;margin-bottom:28px;align-items:start}
    .bs-fsec{background:rgba(13,17,23,.6);border:1px solid rgba(255,255,255,.1);border-radius:12px;padding:14px}
    .bs-ftitle{font-size:13px;font-weight:600;margin-bottom:10px;display:flex;align-items:center;gap:8px}
    .bs-ftitle.f1{color:#58a6ff} .bs-ftitle.f2{color:#3fb950}
    .bs-bi{display:flex;align-items:center;gap:8px;padding:7px 10px;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.08);border-radius:6px;cursor:pointer;transition:all .2s;font-size:13px;margin-bottom:6px}
    .bs-bi:hover{background:rgba(255,255,255,.06)}
    .bs-bi.sel1{background:rgba(88,166,255,.15);border-color:#58a6ff}
    .bs-bi.sel2{background:rgba(63,185,80,.15);border-color:#3fb950}
    .bs-bi.taken{opacity:.3;pointer-events:none;filter:grayscale(1)}
    .bs-vs{display:flex;align-items:center;justify-content:center;font-size:28px;font-weight:800;color:#8b949e;opacity:.6;padding:20px}
    .bs-fcmp{display:grid;grid-template-columns:1fr auto 1fr;gap:20px;align-items:center;margin-bottom:28px}
    .bs-fcard{background:rgba(88,166,255,.1);border:1px solid rgba(88,166,255,.3);border-radius:14px;padding:20px;text-align:center}
    .bs-fcard.f2{background:rgba(63,185,80,.1);border-color:rgba(63,185,80,.3)}
    .bs-sgrid{background:rgba(13,17,23,.6);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:20px}
    .bs-srow{display:grid;grid-template-columns:1fr auto 1fr;gap:20px;align-items:center;padding:10px 0;border-bottom:1px solid rgba(255,255,255,.05)}
    .bs-srow:last-child{border:none}
    .bs-slbl{text-align:center;color:#8b949e;font-size:13px;white-space:nowrap}
    .bs-bwrap{display:flex;align-items:center;gap:10px}
    .bs-btrack{flex:1;height:7px;background:rgba(255,255,255,.1);border-radius:4px;overflow:hidden;min-width:60px}
    .bs-bfill{height:100%;border-radius:4px}
    .bs-bfill.f1{background:#58a6ff} .bs-bfill.f2{background:#3fb950}
    .bs-bval{min-width:70px;font-weight:600;font-size:13px}
    .bs-bval.f1{color:#58a6ff;text-align:left} .bs-bval.f2{color:#3fb950;text-align:right}
    .bs-wsec{background:rgba(13,17,23,.6);border:1px solid rgba(255,255,255,.1);border-radius:14px;padding:20px;margin-top:16px}
    .bs-wi{display:flex;align-items:center;gap:10px;padding:10px;background:rgba(255,255,255,.03);border-radius:8px;margin-bottom:7px;font-size:13px}
    .bs-linput{width:100%;padding:11px 14px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.1);border-radius:8px;color:#e6edf3;font-size:14px;margin-bottom:14px;box-sizing:border-box}
    .bs-linput:focus{outline:none;border-color:#58a6ff}
    .bs-addbtn{padding:5px 10px;background:rgba(255,255,255,.05);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:#e6edf3;cursor:pointer;font-size:11px;transition:background .2s}
    .bs-addbtn:hover{background:rgba(255,255,255,.1)}
    .bs-addbtn.f1{border-color:#58a6ff;color:#58a6ff} .bs-addbtn.f2{border-color:#3fb950;color:#3fb950}
    @media(max-width:1024px){.bs-sum{grid-template-columns:repeat(2,1fr)}.bs-sel,.bs-fcmp{grid-template-columns:1fr}.bs-popup.bloc-popup{width:95vw}.bs-popup.nation-popup{width:95vw}}
    @media(max-width:640px){.bs-sum{grid-template-columns:1fr}.bs-grid{grid-template-columns:1fr}
      /* 1vs1: le barre di confronto (bs-srow) restavano a 3 colonne con
         valori/tracce a min-width fissa → sforavano in orizzontale sul
         telefono. Qui riduciamo gap e min-width così la barra "tiro alla
         fune" rientra nella larghezza dello schermo. */
      .bs-srow{gap:8px}
      .bs-sgrid,.bs-wsec{padding:14px}
      .bs-bwrap{gap:6px}
      .bs-btrack{min-width:0}
      .bs-bval{min-width:0}
      .bs-slbl{font-size:11px;white-space:normal}
      .bs-vs{padding:8px;font-size:22px}}

    /* ===== LIGHT THEME ===== */
    body.light-theme .bsw{color:#3e2f1c}
    body.light-theme .bs-tabs{border-bottom-color:rgba(0,0,0,.1)}
    body.light-theme .bs-tab{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.1);color:#6b5a47}
    body.light-theme .bs-tab:hover{background:rgba(0,0,0,.08);color:#2e1f0c}
    body.light-theme .bs-tab.active{background:rgba(139,90,43,.15);border-color:#8b5a2b;color:#8b5a2b}
    body.light-theme .bs-sum .bs-sc{background:rgba(240,230,210,.6);border-color:rgba(0,0,0,.1)}
    body.light-theme .bs-sl{color:#6b5a47}
    body.light-theme .bs-sv{color:#3e2f1c}
    body.light-theme .bs-card{background:rgba(255,245,235,.9);border-color:rgba(0,0,0,.1);box-shadow:0 4px 12px rgba(0,0,0,.1)}
    body.light-theme .bs-card:hover{box-shadow:0 8px 24px rgba(0,0,0,.2)}
    body.light-theme .bs-card.unaligned{border-color:rgba(0,0,0,.15)}
    body.light-theme .bs-hdr{background:rgba(139,90,43,.1) !important}
    body.light-theme .bs-stats-row{border-bottom-color:rgba(0,0,0,.05)}
    body.light-theme .bs-chip{background:rgba(0,0,0,.05);color:#3e2f1c}
    body.light-theme .bs-members::-webkit-scrollbar-thumb{background:rgba(0,0,0,.2)}
    body.light-theme .bs-pill{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.08);color:#3e2f1c}
    body.light-theme .bs-pill:hover{background:rgba(139,90,43,.15);border-color:#8b5a2b}
    body.light-theme .bs-split-btn{background:rgba(0,0,0,.1);border-color:rgba(0,0,0,.2);color:#3e2f1c}
    body.light-theme .bs-split-btn:hover{background:rgba(0,0,0,.2)}
    body.light-theme .bs-mergebtn{background:rgba(139,90,43,.15);border-color:rgba(139,90,43,.4);color:#8b5a2b}
    body.light-theme .bs-mergebtn:hover{background:rgba(139,90,43,.3)}
    body.light-theme .bs-unaligned-hint{color:#6b5a47}
    body.light-theme .bs-merge-overlay{background:rgba(240,230,210,.7)}
    body.light-theme .bs-merge-menu{background:#fdfaf5;border-color:#c4b394;box-shadow:0 10px 30px rgba(0,0,0,.2)}
    body.light-theme .bs-merge-menu h3{color:#3e2f1c}
    body.light-theme .bs-merge-option{background:rgba(0,0,0,.02);border-color:rgba(0,0,0,.08)}
    body.light-theme .bs-merge-option:hover{background:rgba(139,90,43,.1);border-color:#8b5a2b}
    body.light-theme .bs-merge-name{color:#3e2f1c}
    body.light-theme .bs-merge-close{color:#6b5a47}
    body.light-theme .bs-merge-close:hover{color:#2e1f0c}
    body.light-theme .bs-popup-overlay{background:rgba(240,230,210,.7)}
    body.light-theme .bs-popup{background:#fdfaf5;border-color:#c4b394;box-shadow:0 24px 80px rgba(0,0,0,.3)}
    body.light-theme .bs-popup-header{border-bottom-color:#c4b394}
    body.light-theme .bs-popup-item{background:rgba(0,0,0,.03);color:#3e2f1c}
    body.light-theme .bs-popup-item span{color:#3e2f1c}
    body.light-theme .bs-popup-percent{background:linear-gradient(90deg,rgba(139,90,43,.15),rgba(139,90,43,.05));border-color:rgba(139,90,43,.3);color:#8b5a2b}
    body.light-theme .bs-popup-close{color:#6b5a47}
    body.light-theme .bs-popup-close:hover{color:#2e1f0c;background:rgba(0,0,0,.05)}
    body.light-theme .bs-breakdown-header{background:rgba(0,0,0,.03);color:#6b5a47;border-bottom-color:rgba(0,0,0,.08)}
    body.light-theme .bs-breakdown-header .col:hover{color:#8b5a2b}
    body.light-theme .bs-breakdown-header .col.active{color:#8b5a2b}
    body.light-theme .bs-breakdown-row{border-bottom-color:rgba(0,0,0,.04)}
    body.light-theme .bs-breakdown-row:hover{background:rgba(0,0,0,.02)}
    body.light-theme .bs-breakdown-row .flag-name span{color:#3e2f1c}
    body.light-theme .bs-breakdown-row .bar-wrap{background:rgba(0,0,0,.08)}
    body.light-theme .bs-breakdown-row .val{color:#3e2f1c}
    body.light-theme .bs-breakdown-row .val.pct{color:#8b5a2b}
    body.light-theme .bs-breakdown-body::-webkit-scrollbar-thumb{background:rgba(0,0,0,.15)}
    body.light-theme .bs-dot{animation:glowPulse 2s ease-in-out infinite}
    body.light-theme .bs-sel .bs-fsec{background:rgba(240,230,210,.6);border-color:rgba(0,0,0,.1)}
    body.light-theme .bs-ftitle.f1{color:#8b5a2b} body.light-theme .bs-ftitle.f2{color:#3fb950}
    body.light-theme .bs-bi{background:rgba(0,0,0,.02);border-color:rgba(0,0,0,.06);color:#3e2f1c}
    body.light-theme .bs-bi:hover{background:rgba(0,0,0,.05)}
    body.light-theme .bs-bi.sel1{background:rgba(139,90,43,.15);border-color:#8b5a2b}
    body.light-theme .bs-bi.sel2{background:rgba(63,185,80,.15);border-color:#3fb950}
    body.light-theme .bs-vs{color:#6b5a47}
    body.light-theme .bs-fcard{background:rgba(139,90,43,.1);border-color:rgba(139,90,43,.2)}
    body.light-theme .bs-fcard.f2{background:rgba(63,185,80,.1);border-color:rgba(63,185,80,.2)}
    body.light-theme .bs-sgrid{background:rgba(240,230,210,.6);border-color:rgba(0,0,0,.1)}
    body.light-theme .bs-srow{border-bottom-color:rgba(0,0,0,.05)}
    body.light-theme .bs-slbl{color:#6b5a47}
    body.light-theme .bs-btrack{background:rgba(0,0,0,.1)}
    body.light-theme .bs-bval{color:#3e2f1c}
    body.light-theme .bs-bval.f1{color:#8b5a2b} body.light-theme .bs-bval.f2{color:#3fb950}
    body.light-theme .bs-wsec{background:rgba(240,230,210,.6);border-color:rgba(0,0,0,.1)}
    body.light-theme .bs-wi{background:rgba(0,0,0,.02);color:#3e2f1c}
    body.light-theme .bs-linput{background:rgba(0,0,0,.02);border-color:rgba(0,0,0,.1);color:#3e2f1c}
    body.light-theme .bs-linput:focus{border-color:#8b5a2b}
    body.light-theme .bs-addbtn{background:rgba(0,0,0,.05);border-color:rgba(0,0,0,.1);color:#3e2f1c}
    body.light-theme .bs-addbtn:hover{background:rgba(0,0,0,.1)}
    body.light-theme .bs-addbtn.f1{border-color:#8b5a2b;color:#8b5a2b} body.light-theme .bs-addbtn.f2{border-color:#3fb950;color:#3fb950}
    body.light-theme #bloc-stats-page {
      background: #f0e6d2 !important;
    }
    body.light-theme #bloc-stats-content {
      background: #f0e6d2;
    }

    /* ── Faction 1vs2: toolbar reset selezione ── */
    .bs-f-toolbar{display:flex;justify-content:flex-end;margin-bottom:14px}
    .bs-f-reset{background:rgba(255,80,80,.15);border:1px solid rgba(255,80,80,.5);border-radius:8px;padding:6px 14px;color:#ff6b6b;cursor:pointer;font-size:13px;font-weight:500;transition:all .2s}
    .bs-f-reset:hover:not(:disabled){background:rgba(255,80,80,.25);border-color:#ff6b6b}
    .bs-f-reset:disabled{opacity:.4;cursor:default}
    body.light-theme .bs-f-reset{background:rgba(158,43,43,.12);border-color:rgba(140,40,40,.4);color:#9e2b2b}
    body.light-theme .bs-f-reset:hover:not(:disabled){background:rgba(158,43,43,.2);border-color:#7e1f1f}

    /* ── Alliance Overview: banner istruzioni drag & drop ── */
    .bs-dnd-tip{display:flex;align-items:center;gap:14px;padding:14px 18px;margin-bottom:22px;background:linear-gradient(90deg,rgba(88,166,255,.14),rgba(88,166,255,.04));border:1px solid rgba(88,166,255,.3);border-radius:12px}
    .bs-dnd-ico{font-size:22px;flex-shrink:0}
    .bs-dnd-txt{display:flex;flex-direction:column;gap:3px;font-size:13px;line-height:1.45}
    .bs-dnd-txt strong{color:#58a6ff;font-size:14px}
    .bs-dnd-txt span{color:#8b949e}
    .bs-dnd-txt em{color:#c9d1d9;font-style:normal;background:rgba(255,255,255,.08);padding:1px 6px;border-radius:4px}
    body.light-theme .bs-dnd-tip{background:linear-gradient(90deg,rgba(139,90,43,.14),rgba(139,90,43,.04));border-color:rgba(139,90,43,.3)}
    body.light-theme .bs-dnd-txt strong{color:#8b5a2b}
    body.light-theme .bs-dnd-txt span{color:#6b5a47}
    body.light-theme .bs-dnd-txt em{color:#3e2f1c;background:rgba(0,0,0,.06)}

    /* ── Wars & Enemies: bar chart orizzontale per alleanze ── */
    .bs-hbar-row{display:flex;align-items:center;gap:10px;padding:6px 0;font-size:13px}
    .bs-hbar-label{flex:0 0 140px;display:flex;align-items:center;gap:7px;min-width:0}
    .bs-hbar-label span:last-child{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#e6edf3;font-weight:500}
    .bs-hbar-dot{width:9px;height:9px;border-radius:50%;flex-shrink:0}
    .bs-hbar-track{flex:1;height:9px;background:rgba(255,255,255,.06);border-radius:5px;overflow:hidden;min-width:40px}
    .bs-hbar-fill{height:100%;border-radius:5px;transition:width .4s ease}
    .bs-hbar-val{flex:0 0 auto;min-width:64px;text-align:right;font-weight:600;font-size:12.5px;color:#c9d1d9}
    body.light-theme .bs-hbar-label span:last-child{color:#3e2f1c}
    body.light-theme .bs-hbar-track{background:rgba(0,0,0,.08)}
    body.light-theme .bs-hbar-val{color:#3e2f1c}
  `;
  document.head.appendChild(s);
}

/* ── Popup Nazione ── */
function showPopup(nationId) {
  const nation = state.nationMap.get(nationId);
  if (!nation) return;

  let blocDmg = 0, blocAbsDmg = 0, blocName = 'Unknown', blocSize = 0;
  for (const b of allStats) {
    if (b.members.some(m => m.id === nationId)) {
      blocDmg = b.totalDmg; blocAbsDmg = b.totalAbsoluteDmg;
      blocName = b.name; blocSize = b.countryCount; break;
    }
  }

  const nationDmg = nation?.rankings?.weeklyCountryDamages?.value || 0;
  const nationAbsDmg = nation?.rankings?.countryDamages?.value || 0;
  const pct = blocDmg > 0 ? (nationDmg / blocDmg * 100).toFixed(1) : '0.0';
  const pctAbs = blocAbsDmg > 0 ? (nationAbsDmg / blocAbsDmg * 100).toFixed(1) : '0.0';

  document.querySelectorAll('.bs-popup-overlay, .bs-popup').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'bs-popup-overlay';
  overlay.onclick = () => { overlay.remove(); document.querySelector('.bs-popup')?.remove(); };

  const popup = document.createElement('div');
  popup.className = 'bs-popup nation-popup';
  popup.innerHTML = `
    <div class="bs-popup-close">✕</div>
    <div class="bs-popup-header">
      ${flagImg(nation.code, '32px')}
      <div style="flex:1">
        <div style="font-weight:700;font-size:20px;color:#fff">${nation.name}</div>
        <div style="font-size:12px;color:#8b949e">${blocName} · ${blocSize} nations · ${nation.code?.toUpperCase() || ''}</div>
      </div>
    </div>
    <div class="bs-popup-grid">
      <div class="bs-popup-item">Population <span>${fmt(nation.rankings?.countryActivePopulation?.value)}</span></div>
      <div class="bs-popup-item">Wealth <span>${fmt(nation.rankings?.countryWealth?.value ?? nation.money)}</span></div>
      <div class="bs-popup-item">Weekly Damage <span style="color:#58a6ff">${fmt(nationDmg)}</span></div>
      <div class="bs-popup-item">Total Damage <span style="color:#f0ad4e">${fmt(nationAbsDmg)}</span></div>
      <div class="bs-popup-item">Active Wars <span style="color:#f85149">${nation.warsWith?.length || 0}</span></div>
      <div class="bs-popup-item">Allies <span style="color:#3fb950">${nation.allies?.length || 0}</span></div>
      <div class="bs-popup-item">Development <span>${nation.rankings?.countryDevelopment?.value?.toFixed(1) ?? '—'}</span></div>
      <div class="bs-popup-percent"> ${pct}% of ${blocName} Weekly Damage · ${pctAbs}% Total Damage</div>
    </div>
  `;

  popup.querySelector('.bs-popup-close').onclick = () => { overlay.remove(); popup.remove(); };
  document.body.appendChild(overlay);
  document.body.appendChild(popup);
}

/* ── Popup Blocco (ordinamento decrescente corretto) ── */
function showBlocPopup(blocId) {
  const bloc = allStats.find(b => b.name === blocId || b.id === blocId);
  if (!bloc) return;

  document.querySelectorAll('.bs-popup-overlay, .bs-popup').forEach(el => el.remove());

  const overlay = document.createElement('div');
  overlay.className = 'bs-popup-overlay';
  overlay.onclick = () => { overlay.remove(); document.querySelector('.bs-popup')?.remove(); };

  let sortKey = 'dmg';
  let sortDir = 1; // -1 = decrescente (default: più alto prima)

  function renderRows(key, dir) {
    const sorted = [...bloc.members].sort((a, b) => {
      const valA = a[key] || 0;
      const valB = b[key] || 0;
      return dir * (valB - valA);
    });
    const maxVal = Math.max(...sorted.map(m => m[key] || 0), 1);
    return sorted.map(m => {
      const pctDmg = bloc.totalDmg > 0 ? (m.dmg / bloc.totalDmg * 100).toFixed(1) : '0.0';
      return `
        <div class="bs-breakdown-row">
          <div class="flag-name">${flagImg(m.code, '16px')}<span title="${m.name}">${m.name}</span></div>
          <div class="bar-wrap"><div class="bar-fill" style="width:${(m[key] / maxVal) * 100}%;background:${bloc.color}"></div></div>
          <div class="val" style="color:#58a6ff">${fmt(m[key])}</div>
          ${key === 'dmg' ? `<div class="val pct">${pctDmg}%</div>` : ''}
        </div>
      `;
    }).join('');
  }

  const popup = document.createElement('div');
  popup.className = 'bs-popup bloc-popup';
  popup.innerHTML = `
    <div class="bs-popup-close">✕</div>
    <div class="bs-popup-header">
      <div style="width:16px;height:16px;border-radius:50%;background:${bloc.color};flex-shrink:0;box-shadow:0 0 12px ${bloc.color}88"></div>
      <div style="flex:1">
        <div style="font-weight:700;font-size:22px;color:#fff">${bloc.name}</div>
        <div style="font-size:12px;color:#8b949e">${bloc.countryCount} nations${bloc.isMerged ? ' · MERGED' : ''}</div>
      </div>
    </div>
    <div class="bs-popup-grid" style="margin-bottom:18px">
      <div class="bs-popup-item">Weekly Damage <span style="color:#58a6ff">${fmt(bloc.totalDmg)}</span></div>
      <div class="bs-popup-item">Total Damage <span style="color:#f0ad4e">${fmt(bloc.totalAbsoluteDmg)}</span></div>
      <div class="bs-popup-item">Population <span>${fmt(bloc.totalPop)}</span></div>
      <div class="bs-popup-item">Wealth <span style="color:#3fb950">${fmt(bloc.totalMoney)}</span></div>
      <div class="bs-popup-item">Active Wars <span style="color:#f85149">${bloc.totalWars}</span></div>
      <div class="bs-popup-item">Allies <span>${bloc.totalAllies}</span></div>
      <div class="bs-popup-item">Avg Dmg/Nation <span>${fmt(bloc.countryCount ? bloc.totalDmg / bloc.countryCount : 0)}</span></div>
      <div class="bs-popup-item">Avg Pop/Nation <span>${fmt(bloc.countryCount ? bloc.totalPop / bloc.countryCount : 0)}</span></div>
    </div>
    <div class="bs-breakdown-header">
      <span style="flex:1">Nation</span>
      <span class="col ${sortKey === 'dmg' ? 'active' : ''}" data-key="dmg" style="flex:1">Wk Dmg</span>
      <span class="col ${sortKey === 'totalDmg' ? 'active' : ''}" data-key="totalDmg" style="flex:1">Total Dmg</span>
      <span class="col ${sortKey === 'money' ? 'active' : ''}" data-key="money" style="flex:1">Wealth</span>
      <span class="col ${sortKey === 'pop' ? 'active' : ''}" data-key="pop" style="flex:1">Pop</span>
      <span class="col ${sortKey === 'wars' ? 'active' : ''}" data-key="wars" style="min-width:40px">Wars</span>
    </div>
    <div class="bs-breakdown-body" id="bloc-popup-rows">${renderRows(sortKey, sortDir)}</div>
  `;

  popup.querySelectorAll('.col').forEach(hdr => {
    hdr.addEventListener('click', () => {
      const key = hdr.dataset.key;
      if (key === sortKey) {
        sortDir *= -1;
      } else {
        sortKey = key;
        sortDir = 1;
      }
      const rowsContainer = popup.querySelector('#bloc-popup-rows');
      if (rowsContainer) rowsContainer.innerHTML = renderRows(sortKey, sortDir);
      popup.querySelectorAll('.col').forEach(c => c.classList.toggle('active', c.dataset.key === sortKey));
    });
  });

  popup.querySelector('.bs-popup-close').onclick = () => { overlay.remove(); popup.remove(); };
  document.body.appendChild(overlay);
  document.body.appendChild(popup);
}

/* ── UI Builder ── */
function buildUI() {
  const c = document.getElementById('bloc-stats-content');
  let html = `<div class="bsw">
    <div class="bs-header">
      <div></div>
      <button class="bs-reset-btn" id="bs-reset-all">⟳ Reset all merges & assignments</button>
    </div>
    <div class="bs-tabs">
      ${['factions', 'faction1vs2', 'wars'].map(t => `
        <div class="bs-tab${currentTab === t ? ' active' : ''}" data-tab="${t}">
          ${t === 'factions' ? 'Alliance Overview' : t === 'faction1vs2' ? 'Faction 1 vs 2' : 'Wars & Enemies'}
        </div>`).join('')}
    </div>`;
  if (currentTab === 'faction1vs2') html += render1vs1();
  else if (currentTab === 'wars') html += renderWars();
  else html += renderFactions();
  html += '</div>';
  c.innerHTML = html;
  attachSearchEvent(c);
  const resetBtn = c.querySelector('#bs-reset-all');
  if (resetBtn) {
    resetBtn.onclick = () => {
      manualAssign.clear();
      mergedBlocs.clear();
      mergeCounter = 0;
      allStats = computeBlocStats();
      buildUI();
    };
  }
}

/* ── Tabs Content ── */
function renderFactions() {
  const aligned = allStats.filter(b => !b.isUnaligned);
  const unaligned = allStats.find(b => b.isUnaligned);
  const globalNations = allStats.reduce((sum, b) => sum + b.countryCount, 0);
  const globalWeeklyDmg = allStats.reduce((sum, b) => sum + b.totalDmg, 0);
  const globalTotalDmg = allStats.reduce((sum, b) => sum + b.totalAbsoluteDmg, 0);
  const globalMoney = allStats.reduce((sum, b) => sum + b.totalMoney, 0);
  const globalPop = allStats.reduce((sum, b) => sum + b.totalPop, 0);
  const globalWars = allStats.reduce((sum, b) => sum + b.totalWars, 0);

  let html = `<div class="bs-sum">
    <div class="bs-sc"><div class="bs-sl">Nations</div><div class="bs-sv" style="color:#e6edf3">${fmt(globalNations, 0, true)}</div></div>
    <div class="bs-sc"><div class="bs-sl">Weekly Damage</div><div class="bs-sv" style="color:#58a6ff">${fmt(globalWeeklyDmg)}</div></div>
    <div class="bs-sc"><div class="bs-sl">Total Damage</div><div class="bs-sv" style="color:#f0ad4e">${fmt(globalTotalDmg)}</div></div>
    <div class="bs-sc"><div class="bs-sl">Active Wars</div><div class="bs-sv" style="color:#f85149">${fmt(globalWars, 0, true)}</div></div>
    <div class="bs-sc"><div class="bs-sl">Unaligned</div><div class="bs-sv" style="color:#8b949e">${unaligned?.countryCount || 0}</div></div>
    <div class="bs-sc"><div class="bs-sl">Total Wealth</div><div class="bs-sv" style="color:#3fb950">${fmt(globalMoney)}</div></div>
    <div class="bs-sc"><div class="bs-sl">Total Population</div><div class="bs-sv" style="color:#e6edf3">${fmt(globalPop)}</div></div>
  </div>
  <div class="bs-dnd-tip">
    <span class="bs-dnd-ico">✋</span>
    <div class="bs-dnd-txt">
      <strong>Drag &amp; drop to reorganize alliances</strong>
      <span>Drag a nation from one alliance card to another, drop an <em>Unaligned</em> nation into any alliance, or drag an alliance's header onto another to merge them.</span>
    </div>
  </div>
  <div class="bs-grid">`;
  for (const b of aligned) html += blocCard(b, false);
  if (unaligned) html += blocCard(unaligned, true);
  html += '</div>';
  return html;
}

function blocCard(bloc, isUnaligned) {
  const pills = bloc.members.map(m => `
    <div class="bs-pill" draggable="true" data-nid="${m.id}" title="Click for stats">
      ${flagImg(m.code)} ${m.name}
    </div>`).join('');
  const splitBtn = bloc.isMerged ? `<button class="bs-split-btn" data-split="${bloc.id}">✂ Split</button>` : '';
  const mergeBtn = `<button class="bs-mergebtn" data-merge-src="${bloc.id}" title="Merge with another bloc">＋</button>`;
  return `<div class="bs-card${isUnaligned ? ' unaligned' : ''}" data-drop-bloc="${bloc.id}">
    <div class="bs-hdr" draggable="true" data-bloc-drag="${bloc.id}" data-bloc-id="${bloc.name}" style="background:linear-gradient(135deg,${bloc.color}30,${bloc.color}08);cursor:pointer" title="Click for bloc stats">
      <span>${bloc.name}${splitBtn}</span>
      <span style="font-size:13px;opacity:.8;display:flex;align-items:center;gap:6px">${bloc.countryCount} nations${mergeBtn}</span>
    </div>
    ${!isUnaligned ? `<div class="bs-stats-row">
      <div class="bs-chip">🔥 Wk ${fmt(bloc.totalDmg)}</div>
      <div class="bs-chip">💥 Tot ${fmt(bloc.totalAbsoluteDmg)}</div>
      <div class="bs-chip">👥 ${fmt(bloc.totalPop)}</div>
      <div class="bs-chip">💰 ${fmt(bloc.totalMoney)}</div>
      <div class="bs-chip">⚔️ ${bloc.totalWars} wars</div>
    </div>` : `<div class="bs-unaligned-hint">Drag nations onto an alliance bloc to assign them</div>`}
    <div class="bs-members">${pills || '<span style="color:#484f58;font-size:12px;">No members</span>'}</div>
  </div>`;
}

function render1vs1() {
  const f1 = aggFaction(faction1Blocs), f2 = aggFaction(faction2Blocs);
  const hasSel = faction1Blocs.length || faction2Blocs.length;
  return `<div class="bs-f-toolbar">
    <button class="bs-f-reset" id="bs-faction-reset"${hasSel ? '' : ' disabled'}>⟳ Reset selection</button>
  </div>
  <div class="bs-sel">
    ${factionSel(1, f1)}
    <div class="bs-vs">VS</div>
    ${factionSel(2, f2)}
  </div>
  <div class="bs-fcmp">
    <div class="bs-fcard"><div style="font-size:18px;font-weight:700">${f1.name || 'Select blocs'}</div><div style="color:#8b949e;font-size:13px">${f1.countryCount} nations</div></div>
    <div class="bs-vs">VS</div>
    <div class="bs-fcard f2"><div style="font-size:18px;font-weight:700">${f2.name || 'Select blocs'}</div><div style="color:#8b949e;font-size:13px">${f2.countryCount} nations</div></div>
  </div>
  ${cmpStats(f1, f2)}`;
}

function factionSel(n, fst) {
  const cls = n === 1 ? 'f1' : 'f2';
  const selfSel  = n === 1 ? faction1Blocs : faction2Blocs;
  const otherSel = n === 1 ? faction2Blocs : faction1Blocs;
  const selCls   = n === 1 ? 'sel1' : 'sel2';
  return `<div class="bs-fsec">
    <div class="bs-ftitle ${cls}">
      <span>${n === 1 ? '🔵' : '🟢'} Faction ${n}</span>
      <span style="color:#8b949e;font-size:12px">${fst.countryCount} nations</span>
      <button class="bs-addbtn ${cls}" data-addf="${n}" style="margin-left:auto">+ Random</button>
    </div>
    ${allStats.map(b => {
      const biCls = selfSel.includes(b.id) ? selCls : otherSel.includes(b.id) ? 'taken' : '';
      return `
      <div class="bs-bi ${biCls}" data-bloc="${b.id}" data-faction="${n}">
        <div class="bs-dot" style="background:${b.color}"></div>
        <span style="flex:1">${b.name}</span>
        <span style="color:#8b949e;font-size:11px">${b.countryCount}</span>
        <button class="bs-addbtn ${cls}" data-bloc="${b.id}" data-faction="${n}" style="padding:2px 6px;font-size:10px;margin-left:4px">+</button>
      </div>`;
    }).join('')}
  </div>`;
}

function aggFaction(ids) {
  if (!ids.length) return { name: '', countryCount: 0, totalPop: 0, totalDmg: 0, totalAbsoluteDmg: 0, totalMoney: 0, totalWars: 0, totalAllies: 0 };
  return allStats.filter(b => ids.includes(b.id)).reduce((a, b) => ({
    name: a.name ? `${a.name} + ${b.name}` : b.name,
    countryCount: a.countryCount + b.countryCount, totalPop: a.totalPop + b.totalPop,
    totalDmg: a.totalDmg + b.totalDmg, totalAbsoluteDmg: a.totalAbsoluteDmg + b.totalAbsoluteDmg,
    totalMoney: a.totalMoney + b.totalMoney, totalWars: a.totalWars + b.totalWars,
    totalAllies: a.totalAllies + b.totalAllies,
  }), { name: '', countryCount: 0, totalPop: 0, totalDmg: 0, totalAbsoluteDmg: 0, totalMoney: 0, totalWars: 0, totalAllies: 0 });
}

function cmpRow(v1, v2, lbl, f = v => fmt(v)) {
  const mx = Math.max(v1, v2) || 1;
  return `<div class="bs-srow">
    <div class="bs-bwrap"><div class="bs-bval f1">${f(v1)}</div><div class="bs-btrack"><div class="bs-bfill f1" style="width:${(v1 / mx) * 100}%"></div></div></div>
    <div class="bs-slbl">${lbl}</div>
    <div class="bs-bwrap"><div class="bs-btrack"><div class="bs-bfill f2" style="width:${(v2 / mx) * 100}%"></div></div><div class="bs-bval f2">${f(v2)}</div></div>
  </div>`;
}

function cmpStats(f1, f2) {
  const fi = v => fmt(v, 0, true);
  return `<div class="bs-sgrid">
    ${cmpRow(f1.countryCount, f2.countryCount, 'Countries', fi)}
    ${cmpRow(f1.totalPop, f2.totalPop, 'Population')}
    ${cmpRow(f1.totalDmg, f2.totalDmg, 'Weekly Damage')}
    ${cmpRow(f1.totalAbsoluteDmg, f2.totalAbsoluteDmg, 'Total Damage')}
    ${cmpRow(f1.totalMoney, f2.totalMoney, 'Wealth')}
    ${cmpRow(f1.totalAllies, f2.totalAllies, 'Allies', fi)}
    ${cmpRow(f1.totalWars, f2.totalWars, 'Active Wars', fi)}
  </div>`;
}

function renderWars() {
  const wars = [];
  for (const b of allStats) for (const m of b.members) {
    if (m.wars > 0) wars.push({ ...m, blocName: b.name, blocColor: b.color });
  }
  const allMembers = allStats.flatMap(b => b.members.map(m => ({ ...m, blocName: b.name, blocColor: b.color })));
  const aligned = allStats.filter(b => !b.isUnaligned);

  // ── Metriche di sintesi globali (in cima alla scheda) ──
  const gWeekly = allStats.reduce((s, b) => s + b.totalDmg, 0);
  const gPop    = allStats.reduce((s, b) => s + b.totalPop, 0);
  const gBounty = allStats.reduce((s, b) => s + b.totalBounty, 0);
  const globalDpc = gPop ? gWeekly / gPop : 0;

  const statRow = (m, val, color = '#e6edf3') => `<div class="bs-wi">${flagImg(m.code, '16px')}
    <span style="font-weight:600">${m.name}</span>
    <span style="color:#8b949e;font-size:12px">${m.blocName}</span>
    <span style="margin-left:auto;font-weight:600;color:${color}">${val}</span>
  </div>`;

  const topWeekly = [...allMembers].sort((a,b) => b.dmg - a.dmg).slice(0, 10);
  const topTotal  = [...allMembers].sort((a,b) => b.totalDmg - a.totalDmg).slice(0, 10);
  const topPop    = [...allMembers].sort((a,b) => b.pop - a.pop).slice(0, 10);
  const topWealth = [...allMembers].sort((a,b) => b.money - a.money).slice(0, 10);
  const topDev    = [...allMembers].sort((a,b) => b.dev - a.dev).slice(0, 10);
  const topDpc    = [...allMembers].sort((a,b) => b.dpc - a.dpc).slice(0, 10);
  const topBounty = [...allMembers].sort((a,b) => b.bounty - a.bounty).slice(0, 10);
  const topAllies = [...allMembers].sort((a,b) => b.allies - a.allies).slice(0, 10);

  // ── Bar chart orizzontale per le classifiche alleanze (barra
  //    proporzionale al massimo della lista, colore = colore alleanza). ──
  const blocBar = (metric, fmtFn) => {
    const items = [...aligned].sort((a, b) => (b[metric] || 0) - (a[metric] || 0)).slice(0, 8);
    const max = Math.max(...items.map(b => b[metric] || 0), 1);
    return items.map(b => {
      const v = b[metric] || 0;
      return `<div class="bs-hbar-row">
        <div class="bs-hbar-label"><span class="bs-hbar-dot" style="background:${b.color}"></span><span title="${b.name}">${b.name}</span></div>
        <div class="bs-hbar-track"><div class="bs-hbar-fill" style="width:${(v / max * 100).toFixed(1)}%;background:${b.color}"></div></div>
        <div class="bs-hbar-val">${fmtFn(v)}</div>
      </div>`;
    }).join('') || '<p style="color:#8b949e">No data</p>';
  };
  const dev1 = v => v.toFixed(1);

  return `
    <div class="bs-sum" style="grid-template-columns:repeat(4,1fr)">
      <div class="bs-sc"><div class="bs-sl">Alliances</div><div class="bs-sv" style="color:#e6edf3">${aligned.length}</div></div>
      <div class="bs-sc"><div class="bs-sl">Nations at War</div><div class="bs-sv" style="color:#f85149">${fmt(wars.length, 0, true)}</div></div>
      <div class="bs-sc"><div class="bs-sl">Avg Dmg / Citizen</div><div class="bs-sv" style="color:#58a6ff">${fmt(globalDpc)}</div></div>
      <div class="bs-sc"><div class="bs-sl">Total Bounty</div><div class="bs-sv" style="color:#f0ad4e">${fmt(gBounty)}</div></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="bs-wsec">
        <h3 style="margin:0 0 14px">🏆 Alliance Ranking — Weekly Damage</h3>
        ${blocBar('totalDmg', v => fmt(v))}
      </div>
      <div class="bs-wsec">
        <h3 style="margin:0 0 14px">🏆 Alliance Ranking — Total Damage</h3>
        ${blocBar('totalAbsoluteDmg', v => fmt(v))}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="bs-wsec">
        <h3 style="margin:0 0 14px">🏆 Alliance Ranking — Population</h3>
        ${blocBar('totalPop', v => fmt(v))}
      </div>
      <div class="bs-wsec">
        <h3 style="margin:0 0 14px">🏆 Alliance Ranking — Wealth</h3>
        ${blocBar('totalMoney', v => fmt(v))}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="bs-wsec">
        <h3 style="margin:0 0 14px">🏆 Alliance Ranking — Avg Development</h3>
        ${blocBar('avgDev', dev1)}
      </div>
      <div class="bs-wsec">
        <h3 style="margin:0 0 14px">🏆 Alliance Ranking — Weekly Dmg / Citizen</h3>
        ${blocBar('dpc', v => fmt(v))}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="bs-wsec">
        <h3 style="margin:0 0 10px">Top 10 Weekly Damage</h3>
        ${topWeekly.map(m => statRow(m, fmt(m.dmg), '#58a6ff')).join('')}
      </div>
      <div class="bs-wsec">
        <h3 style="margin:0 0 10px">Top 10 Total Damage</h3>
        ${topTotal.map(m => statRow(m, fmt(m.totalDmg), '#f0ad4e')).join('')}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="bs-wsec">
        <h3 style="margin:0 0 10px">Top 10 Dmg / Citizen</h3>
        ${topDpc.map(m => statRow(m, fmt(m.dpc), '#58a6ff')).join('')}
      </div>
      <div class="bs-wsec">
        <h3 style="margin:0 0 10px">Top 10 Development</h3>
        ${topDev.map(m => statRow(m, m.dev.toFixed(1), '#a371f7')).join('')}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
      <div class="bs-wsec">
        <h3 style="margin:0 0 10px">Top 10 Population</h3>
        ${topPop.map(m => statRow(m, fmt(m.pop), '#e6edf3')).join('')}
      </div>
      <div class="bs-wsec">
        <h3 style="margin:0 0 10px">Top 10 Wealth</h3>
        ${topWealth.map(m => statRow(m, fmt(m.money), '#3fb950')).join('')}
      </div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="bs-wsec">
        <h3 style="margin:0 0 10px">Top 10 Bounty</h3>
        ${topBounty.map(m => statRow(m, fmt(m.bounty), '#f0ad4e')).join('')}
      </div>
      <div class="bs-wsec">
        <h3 style="margin:0 0 10px">Top 10 Allies</h3>
        ${topAllies.map(m => statRow(m, `🤝 ${m.allies}`, '#3fb950')).join('')}
      </div>
    </div>`;
}

/* ── Merge Menu (visivo) ── */
function showMergeMenu(srcBlocId, srcBlocName) {
  document.querySelectorAll('.bs-merge-overlay').forEach(el => el.remove());
  const others = allStats.filter(b => b.id !== srcBlocId);
  if (!others.length) return;

  const overlay = document.createElement('div');
  overlay.className = 'bs-merge-overlay';
  const menu = document.createElement('div');
  menu.className = 'bs-merge-menu';
  menu.innerHTML = `
    <div class="bs-merge-close">✕</div>
    <h3>Merge "${srcBlocName}" with:</h3>
    <div class="bs-merge-grid">
      ${others.map(b => `
        <div class="bs-merge-option" data-target-id="${b.id}">
          <div class="bs-merge-color" style="background:${b.color}"></div>
          <span class="bs-merge-name">${b.name}</span>
        </div>
      `).join('')}
    </div>
  `;
  overlay.appendChild(menu);
  document.body.appendChild(overlay);

  const closeMenu = () => overlay.remove();
  menu.querySelector('.bs-merge-close').onclick = closeMenu;
  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeMenu(); });

  menu.querySelectorAll('.bs-merge-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const targetId = opt.dataset.targetId;
      const target = allStats.find(b => b.id === targetId);
      if (!target) { closeMenu(); return; }

      const expandMerge = name => mergedBlocs.has(name) ? mergedBlocs.get(name).originals.flatMap(expandMerge) : [name];
      const combined = [...new Set([...expandMerge(srcBlocId), ...expandMerge(targetId)])];
      if (combined.length > 1) {
        const newId = `merge_${++mergeCounter}`;
        mergedBlocs.set(newId, { displayName: combined.join(' + '), originals: combined });
        if (mergedBlocs.has(srcBlocId)) mergedBlocs.delete(srcBlocId);
        if (mergedBlocs.has(targetId)) mergedBlocs.delete(targetId);
        allStats = computeBlocStats();
        buildUI();
        trackEvent('bloc-stats-merge', { a: srcBlocName, b: target.name });
      }
      closeMenu();
    });
  });
}

/* ── Search event ── */
function attachSearchEvent(c) {
  const si = c.querySelector('#bs-search');
  if (!si) return;
  si.addEventListener('input', e => {
    const q = e.target.value.toLowerCase().trim(), rd = c.querySelector('#bs-results');
    if (!q) { rd.innerHTML = ''; return; }
    if (!searchTracked) { searchTracked = true; trackEvent('bloc-stats-search'); }
    const hits = [];
    for (const b of allStats) for (const m of b.members) if (m.name.toLowerCase().includes(q)) hits.push({ ...m, blocName: b.name, blocColor: b.color });
    rd.innerHTML = hits.length
      ? `<div class="bs-grid">${hits.slice(0, 20).map(m => `
          <div class="bs-card" style="border-top:3px solid ${m.blocColor}">
            <div class="bs-hdr" style="background:linear-gradient(135deg,${m.blocColor}30,${m.blocColor}08)">
              <span style="display:flex;align-items:center;gap:8px">${flagImg(m.code, '18px')} ${m.name}</span>
              <span style="font-size:12px;color:#8b949e">${m.blocName}</span>
            </div>
            <div class="bs-stats-row">
              <div class="bs-chip">👥 ${fmt(m.pop, 2)}</div>
              <div class="bs-chip">🔥 Wk ${fmt(m.dmg)}</div>
              <div class="bs-chip">💥 Tot ${fmt(m.totalDmg)}</div>
              <div class="bs-chip">💰 ${fmt(m.money)}</div>
              <div class="bs-chip">⚔️ Wars: ${m.wars}</div>
              <div class="bs-chip">🤝 Allies: ${m.allies}</div>
            </div>
          </div>`).join('')}</div>`
      : '<p style="color:#8b949e;text-align:center;padding:20px">No nations found</p>';
  });
}

/* ── Eventi principali (Drag & Drop, click) ── */
function attachEvents(c) {
  c.addEventListener('click', e => {
    const tab = e.target.closest('.bs-tab');
    if (tab) { currentTab = tab.dataset.tab; buildUI(); return; }

    const mergeBtn = e.target.closest('.bs-mergebtn');
    if (mergeBtn) {
      e.stopPropagation();
      const srcId = mergeBtn.dataset.mergeSrc;
      const srcName = allStats.find(b => b.id === srcId)?.name || srcId;
      showMergeMenu(srcId, srcName);
      return;
    }

    const hdrClick = e.target.closest('[data-bloc-id]');
    if (hdrClick && !e.target.closest('.bs-split-btn') && !e.target.closest('.bs-pill') && !e.target.closest('.bs-mergebtn')) {
      showBlocPopup(hdrClick.dataset.blocId);
      return;
    }

    const pill = e.target.closest('.bs-pill');
    if (pill && !pill.classList.contains('dragging')) {
      e.preventDefault();
      showPopup(pill.dataset.nid);
      return;
    }

    const split = e.target.closest('.bs-split-btn');
    if (split) {
      mergedBlocs.delete(split.dataset.split);
      allStats = computeBlocStats();
      buildUI();
      return;
    }

    const factionReset = e.target.closest('#bs-faction-reset');
    if (factionReset) {
      faction1Blocs = [];
      faction2Blocs = [];
      buildUI();
      return;
    }

    const bi = e.target.closest('.bs-bi');
    if (bi) {
      const id = bi.dataset.bloc, f = parseInt(bi.dataset.faction);
      if (f === 1) { faction1Blocs = faction1Blocs.includes(id) ? faction1Blocs.filter(x => x !== id) : [...faction1Blocs, id]; faction2Blocs = faction2Blocs.filter(x => x !== id); }
      else { faction2Blocs = faction2Blocs.includes(id) ? faction2Blocs.filter(x => x !== id) : [...faction2Blocs, id]; faction1Blocs = faction1Blocs.filter(x => x !== id); }
      buildUI();
      return;
    }

    const quickAdd = e.target.closest('.bs-addbtn[data-bloc]');
    if (quickAdd) {
      e.stopPropagation();
      const blocId = quickAdd.dataset.bloc;
      const f = parseInt(quickAdd.dataset.faction);
      if (f === 1) { faction1Blocs = faction1Blocs.includes(blocId) ? faction1Blocs.filter(x => x !== blocId) : [...faction1Blocs, blocId]; faction2Blocs = faction2Blocs.filter(x => x !== blocId); }
      else { faction2Blocs = faction2Blocs.includes(blocId) ? faction2Blocs.filter(x => x !== blocId) : [...faction2Blocs, blocId]; faction1Blocs = faction1Blocs.filter(x => x !== blocId); }
      buildUI();
      return;
    }

    const add = e.target.closest('.bs-addbtn[data-addf]');
    if (add) {
      e.stopPropagation();
      const f = parseInt(add.dataset.addf);
      const avail = allStats.filter(b => !faction1Blocs.includes(b.id) && !faction2Blocs.includes(b.id));
      if (avail.length) {
        const rnd = avail[Math.floor(Math.random() * avail.length)];
        if (f === 1) faction1Blocs = [...faction1Blocs, rnd.id]; else faction2Blocs = [...faction2Blocs, rnd.id];
        buildUI();
      }
      return;
    }

    if (e.target.classList.contains('bs-popup-overlay')) {
      e.target.remove();
      document.querySelector('.bs-popup')?.remove();
    }
  });

  c.addEventListener('dragstart', e => {
    const pill = e.target.closest('.bs-pill');
    const hdr = e.target.closest('.bs-hdr');
    if (pill) {
      dragData = { type: 'nation', id: pill.dataset.nid };
      e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
      pill.style.opacity = '.4';
      e.stopPropagation();
    } else if (hdr && hdr.dataset.blocDrag) {
      const card = hdr.closest('.bs-card');
      if (card) {
        dragData = { type: 'bloc', id: hdr.dataset.blocDrag };
        e.dataTransfer.setData('text/plain', JSON.stringify(dragData));
        card.classList.add('dragging');
      }
    }
  });

  c.addEventListener('dragend', e => {
    document.querySelectorAll('.bs-pill, .bs-card').forEach(el => el.style.opacity = '');
    document.querySelectorAll('.bs-card').forEach(el => el.classList.remove('dragging', 'drag-over'));
    dragData = null;
  });

  c.addEventListener('dragover', e => {
    const card = e.target.closest('[data-drop-bloc]');
    if (card) { e.preventDefault(); card.classList.add('drag-over'); }
  });

  c.addEventListener('dragleave', e => {
    const card = e.target.closest('[data-drop-bloc]');
    if (card) card.classList.remove('drag-over');
  });

  c.addEventListener('drop', e => {
    e.preventDefault();
    const card = e.target.closest('[data-drop-bloc]');
    if (!card || !dragData) return;
    card.classList.remove('drag-over');
    const target = card.dataset.dropBloc;

    if (dragData.type === 'nation') {
      let resolvedTarget = target;
      if (target === 'unaligned') {
        manualAssign.delete(dragData.id);
      } else {
        if (mergedBlocs.has(target)) resolvedTarget = mergedBlocs.get(target).originals[0];
        manualAssign.set(dragData.id, resolvedTarget);
      }
      allStats = computeBlocStats();
      buildUI();
    } else if (dragData.type === 'bloc' && dragData.id !== target) {
      const expandMerge = (name) => {
        if (mergedBlocs.has(name)) return mergedBlocs.get(name).originals.flatMap(expandMerge);
        return [name];
      };
      const sourceOriginals = expandMerge(dragData.id);
      const targetOriginals = expandMerge(target);
      const combined = [...new Set([...sourceOriginals, ...targetOriginals])];

      if (combined.length > 1) {
        const displayName = combined.join(' + ');
        const newMergeId = `merge_${++mergeCounter}`;
        mergedBlocs.set(newMergeId, { displayName, originals: combined });
        if (mergedBlocs.has(dragData.id)) mergedBlocs.delete(dragData.id);
        if (mergedBlocs.has(target)) mergedBlocs.delete(target);
        allStats = computeBlocStats();
        buildUI();
      }
    }
  });
}