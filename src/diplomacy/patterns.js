// patterns.js
import { state } from './state.js';

export function createBlendPattern(colors, seed, sz = 16) {
  const canvas = document.createElement('canvas');
  canvas.width = sz;
  canvas.height = sz;
  const ctx = canvas.getContext('2d');
  const seedNum = typeof seed === 'string' ? parseInt(seed, 36) : Number(seed) || 0;
  const orientation = Math.abs(seedNum) % 4;
  const stripeWidth = 2 + (Math.abs(seedNum) % 4);

  ctx.clearRect(0, 0, sz, sz);
  ctx.fillStyle = colors[0];
  ctx.fillRect(0, 0, sz, sz);

  for (let i = 1; i < colors.length; i++) {
    ctx.fillStyle = colors[i];
    const step = colors.length * stripeWidth;
    switch (orientation) {
      case 0:
        for (let y = i * stripeWidth; y < sz; y += step) ctx.fillRect(0, y, sz, stripeWidth);
        break;
      case 1:
        for (let x = i * stripeWidth; x < sz; x += step) ctx.fillRect(x, 0, stripeWidth, sz);
        break;
      case 2:
        ctx.save();
        ctx.rotate(Math.PI / 4);
        for (let d = -sz; d < sz * 2; d += step * 1.5) ctx.fillRect(d + i * stripeWidth * 1.5, -sz, stripeWidth, sz * 3);
        ctx.restore();
        break;
      case 3:
        ctx.save();
        ctx.translate(sz, 0);
        ctx.rotate(-Math.PI / 4);
        for (let d = -sz; d < sz * 2; d += step * 1.5) ctx.fillRect(d + i * stripeWidth * 1.5, -sz, stripeWidth, sz * 3);
        ctx.restore();
        break;
    }
  }
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 0.5;
  ctx.strokeRect(0, 0, sz, sz);
  return canvas;
}

export function preloadPatternImage(patternKey, colors, seed) {
  return new Promise(resolve => {
    if (state.patternImageCache.has(patternKey)) { resolve(state.patternImageCache.get(patternKey)); return; }
    const canvas = createBlendPattern(colors, seed, 16);
    const img = new Image();
    img.onload = () => {
      state.patternImageCache.set(patternKey, img);
      if (state.map && !state.map.hasImage(patternKey)) state.map.addImage(patternKey, img);
      resolve(img);
    };
    img.onerror = () => resolve(null);
    img.src = canvas.toDataURL();
  });
}

export async function buildMultiBlocPatternExpression() {
  const entries = [...state.multiBlocMap.entries()];
  if (entries.length === 0) return '';
  await Promise.all(entries.map(([id, { colors }]) => {
    const patternKey = `stripe-${id}-${colors.join('-')}`;
    return preloadPatternImage(patternKey, colors, id);
  }));
  return _makePatternExpr(entries, 'countryId');
}

export function getMultiBlocPatternExpression() {
  return _makePatternExpr([...state.multiBlocMap.entries()], 'countryId');
}

export function getMultiBlocPatternExpressionOriginal() {
  return _makePatternExpr([...state.multiBlocMap.entries()], 'initialCountryId');
}

function _makePatternExpr(entries, propKey) {
  if (!entries.length) return '';
  const expr = ['match', ['get', propKey]];
  entries.forEach(([id, { colors }]) => {
    expr.push(id, `stripe-${id}-${colors.join('-')}`);
  });
  const [firstId, { colors: firstColors }] = entries[0];
  expr.push(`stripe-${firstId}-${firstColors.join('-')}`);
  return expr;
}

// WarEra+: il pattern a strisce "alleato + patto difensivo" è stato
// sostituito da bordo colorato (map.js, LYR_DIPLOMACY_DUAL, Opzione A)
// + badge al centroide (dualBadges.js, Opzione B) — più leggibile a
// qualunque livello di zoom rispetto alle strisce su tile 16px.