import { state } from './state.js';
import { parseCSV, showToast, showLoading, hideLoading } from './utils.js';
import { EXTERNAL_BLOCS_URL, HARDCODED_BLOCS } from './config.js';
import { buildMultiBlocPatternExpression } from './patterns.js';
import { renderMap } from './map.js';
import { updateDynamicLegend } from './ui.js';

export async function loadExternalBlocs() {
  try {
    showLoading();
    const resp = await fetch(EXTERNAL_BLOCS_URL + `?t=${Date.now()}`);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const csv = await resp.text();
    const data = parseCSV(csv);
    buildBlocMapFromData(data);
    updateDynamicLegend();
    if (state.coloringMode === 'blocs') renderMap();
    showToast('Alliance blocs loaded successfully!', 'success');
  } catch (err) {
    console.error('Errore blocchi esterni:', err);
    buildBlocMapFromData([]);   // usa hardcoded come fallback
    showToast('External blocs unavailable.', 'warning');
  } finally {
    hideLoading();
  }
}

export function buildBlocMapFromData(blocsData) {
  state.blocColorMap.clear();
  state.multiBlocMap.clear();
  state.externalBlocsInfo = [];

  if (!blocsData || blocsData.length === 0) blocsData = HARDCODED_BLOCS;

  for (const bloc of blocsData) {
    const blocName  = bloc.nome_blocco;
    const blocColor = bloc.colore;
    const labelLng  = parseFloat(bloc.label_lng);
    const labelLat  = parseFloat(bloc.label_lat);
    if (!blocColor) continue;

    state.externalBlocsInfo.push({
      name: blocName,
      color: blocColor,
      labelLng: isNaN(labelLng) ? null : labelLng,
      labelLat: isNaN(labelLat) ? null : labelLat,
    });

    const codes = bloc.codici_nazioni.split(',').map(c => c.trim().toUpperCase());
    for (const code of codes) {
      const country = state.nazioniGlobal.find(n => n.code?.toUpperCase() === code);
      if (!country) continue;
      const cId = country._id;
      if (state.blocColorMap.has(cId)) {
        const existing = state.multiBlocMap.get(cId)?.colors || [state.blocColorMap.get(cId)];
        state.multiBlocMap.set(cId, { colors: [...existing, blocColor] });
      } else {
        state.blocColorMap.set(cId, blocColor);
      }
    }
  }

  // precarica i pattern in background
  buildMultiBlocPatternExpression();
}
