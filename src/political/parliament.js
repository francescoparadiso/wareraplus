/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: parliament.js come modulo ES (Fase 2, Stage 6)
   ------------------------------------------------------------------
   Conversione dell'IIFE `Parliament` a modulo con export diretti.
   `d3` da CDN globale a import npm.

   NOTA verificata dal vivo sul codice reale (non solo dall'analisi
   preliminare): l'unico uso di `window.innerWidth` (riga 88 originale,
   dentro `render()`, come fallback se `container.clientWidth` non è
   disponibile) è già dentro la funzione, letto ad ogni chiamata — NON
   un valore "congelato" a top-level dell'IIFE come inizialmente
   ipotizzato nel piano. Nessun fix necessario su questo punto.

   `openPartyModal` (mai definito in nessun file, guardato con `typeof`
   nell'originale) rimosso: era già dead code lì (typeof su identificatore
   mai dichiarato non lancia mai, ma il ramo non scattava comunque mai).
   ══════════════════════════════════════════════════════════════ */

import * as d3 from 'd3';
import { t } from './i18n.js';
import { escapeHtml, APP_BASE } from './config.js';

let _lastRenderData = null;   // salva { parties, container, legendContainer, tooltip }

function computeLayout(nSeats, innerR, outerR) {
  if (nSeats <= 0) return null;
  for (let nRows = 2; nRows <= 12; nRows++) {
    const rowSpan = outerR - innerR;
    const rowH = rowSpan / Math.max(nRows - 1, 1);
    const dotR = rowH * 0.28;
    const step = dotR * 2 * 1.10;
    const radii = Array.from({ length: nRows }, (_, i) => innerR + rowH * i);
    const caps = radii.map(r => Math.max(1, Math.floor(Math.PI * r / step)));
    const total = caps.reduce((a, b) => a + b, 0);
    if (total >= nSeats) {
      const rowSeats = _distributePro(nSeats, caps);
      return { dotR, radii, rowSeats };
    }
  }
  const nRows = 12;
  const rowH = (outerR - innerR) / (nRows - 1);
  const dotR = rowH * 0.28;
  const step = dotR * 2 * 1.10;
  const radii = Array.from({ length: nRows }, (_, i) => innerR + rowH * i);
  const caps = radii.map(r => Math.max(1, Math.floor(Math.PI * r / step)));
  const rowSeats = _distributePro(nSeats, caps);
  return { dotR, radii, rowSeats };
}

function _distributePro(total, caps) {
  const capSum = caps.reduce((a, b) => a + b, 0);
  const result = new Array(caps.length).fill(0);
  let assigned = 0;
  caps.forEach((cap, i) => {
    if (i === caps.length - 1) {
      result[i] = total - assigned;
    } else {
      const s = Math.min(cap, Math.round(total * cap / capSum));
      result[i] = s;
      assigned += s;
    }
  });
  let diff = total - result.reduce((a, b) => a + b, 0);
  for (let i = caps.length - 1; i >= 0 && diff !== 0; i--) {
    const canAdd = caps[i] - result[i];
    const canSub = result[i];
    if (diff > 0 && canAdd > 0) {
      const add = Math.min(diff, canAdd);
      result[i] += add;
      diff -= add;
    } else if (diff < 0 && canSub > 0) {
      const sub = Math.min(-diff, canSub);
      result[i] -= sub;
      diff += sub;
    }
  }
  return result;
}

function generatePoints(layout) {
  const { radii, rowSeats } = layout;
  const pts = [];
  radii.forEach((radius, row) => {
    const n = rowSeats[row];
    if (n <= 0) return;
    for (let i = 0; i < n; i++) {
      const angle = -Math.PI + Math.PI * (i / (n - 1 || 1));
      pts.push({ angle, radius, row });
    }
  });
  pts.sort((a, b) => a.angle - b.angle);
  return pts;
}

export function render({ container, legendContainer, parties, tooltip }) {
  container.innerHTML = '';
  legendContainer.innerHTML = '';

  const totalSeats = parties.reduce((s, p) => s + p.seats, 0);
  if (!totalSeats) {
    container.innerHTML = `<p class="empty">${t('no_seats_available')}</p>`;
    return;
  }

  const totalVotesAll = parties.reduce((s, p) => s + (p.votes || 0), 0);

// ✅ FIX MOBILE: usa larghezza reale, minimo più basso su schermi piccoli
let W = container.clientWidth || window.innerWidth;
const isMobile = W < 600;
if (!W || W < (isMobile ? 260 : 340)) {
  W = isMobile ? 260 : 340;
}
  const H = Math.round(W * 0.55);
  const cx = W / 2;
  const cy = H * 0.90;
  const outerR = Math.min(W * 0.47, H * 0.93);
  const innerR = outerR * 0.24;

  const layout = computeLayout(totalSeats, innerR, outerR);
  if (!layout) return;

  const pts = generatePoints(layout);
  const sorted = [...parties].sort((a, b) => b.seats - a.seats);
  let idx = 0;
  const colored = [];
  sorted.forEach(party => {
    const users = party.users || [];
    const partyVotesPct = totalVotesAll > 0 && party.votes > 0 ? ((party.votes / totalVotesAll) * 100).toFixed(1) : null;
    const rankedUsers = [...users].sort((a, b) => (b.votes || 0) - (a.votes || 0));
    const rankMap = new Map(rankedUsers.map((u, i) => [u.userId, i + 1]));
    const topVotesInParty = rankedUsers[0]?.votes || 0;
    for (let i = 0; i < party.seats; i++) {
      if (idx >= pts.length) break;
      colored.push({
        ...pts[idx],
        party: party.name,
        partyId: party.id || null,
        color: party.color,
        seatIdx: i,
        total: party.seats,
        username: users[i]?.username || null,
        userId: users[i]?.userId || null,
        avatarUrl: users[i]?.avatarUrl || null,
        level: users[i]?.level ?? users[i]?.lvl ?? null,
        userVotes: users[i]?.votes ?? null,
        partyVotesPct,
        partyVotes: party.votes || null,
        partyMembers: party.members || null,
        partyRank: users[i]?.userId ? rankMap.get(users[i].userId) : null,
        topVotesInParty,
      });
      idx++;
    }
  });

  // Track hidden parties
  const hiddenParties = new Set();

  const redrawOpacity = () => {
    svg.selectAll('g.seat-group')
      .style('opacity', d => hiddenParties.has(d.party) ? 0.08 : 1);
  };

  // Calcolo majority e angolo prima di usarli per il bounding box
  const majority = Math.floor(totalSeats / 2) + 1;
  const majAngle = -Math.PI + Math.PI * (majority / totalSeats);

  // Calcola i limiti di tutti gli elementi (pallini, linee, testo)
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

  colored.forEach(d => {
    const x = cx + d.radius * Math.cos(d.angle);
    const y = cy + d.radius * Math.sin(d.angle);
    minX = Math.min(minX, x - layout.dotR);
    minY = Math.min(minY, y - layout.dotR);
    maxX = Math.max(maxX, x + layout.dotR);
    maxY = Math.max(maxY, y + layout.dotR);
  });

  const lx1 = cx + (innerR - 6) * Math.cos(majAngle);
  const ly1 = cy + (innerR - 6) * Math.sin(majAngle);
  const lx2 = cx + (outerR + 6) * Math.cos(majAngle);
  const ly2 = cy + (outerR + 6) * Math.sin(majAngle);
  minX = Math.min(minX, lx1, lx2);
  maxX = Math.max(maxX, lx1, lx2);
  minY = Math.min(minY, ly1, ly2);
  maxY = Math.max(maxY, ly1, ly2);

  const textX = cx + (outerR + 13) * Math.cos(majAngle);
  const textY = cy + (outerR + 13) * Math.sin(majAngle) + 3;
  minX = Math.min(minX, textX - 20);
  maxX = Math.max(maxX, textX + 20);
  minY = Math.min(minY, textY - 10);
  maxY = Math.max(maxY, textY + 10);

  const centerTextY = cy - 6;
  minX = Math.min(minX, cx - 30);
  maxX = Math.max(maxX, cx + 30);
  minY = Math.min(minY, centerTextY - 10);
  maxY = Math.max(maxY, centerTextY + 10);

  minX = Math.min(minX, cx - outerR - layout.dotR - 10);
  maxX = Math.max(maxX, cx + outerR + layout.dotR + 10);
  minY = Math.min(minY, cy - outerR - layout.dotR - 10);
  maxY = Math.max(maxY, cy + 10);

  const padding = 10;
  const viewBoxX = minX - padding;
  const viewBoxY = minY - padding;
  const viewBoxW = maxX - minX + 2 * padding;
  const viewBoxH = maxY - minY + 2 * padding;

  const svg = d3.select(container)
    .append('svg')
    .attr('viewBox', `${viewBoxX} ${viewBoxY} ${viewBoxW} ${viewBoxH}`)
    .style('width', '100%')
    .style('height', 'auto')
    .style('overflow', 'visible');

  const defs = svg.append('defs');
  colored.forEach(d => {
    if (d.avatarUrl) {
      const patternId = 'avatar-' + d.userId;
      if (!svg.select(`#${patternId}`).size()) {
        const pattern = defs.append('pattern')
          .attr('id', patternId)
          .attr('patternUnits', 'objectBoundingBox')
          .attr('width', 1)
          .attr('height', 1);
        pattern.append('image')
          .attr('x', 0)
          .attr('y', 0)
          .attr('width', 1)
          .attr('height', 1)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('href', d.avatarUrl);
      }
    }
  });

  const arcPath = (r) => `M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`;
  svg.append('path').attr('d', arcPath(outerR + layout.dotR + 2))
    .attr('fill', 'none').attr('stroke', 'rgba(255,255,255,0.04)').attr('stroke-width', layout.dotR * 2 + 4);
  svg.append('path').attr('d', arcPath(outerR + layout.dotR + 2))
    .attr('fill', 'none').attr('stroke', 'rgba(255,255,255,0.06)').attr('stroke-width', 0.5);
  svg.append('path').attr('d', arcPath(innerR - layout.dotR - 2))
    .attr('fill', 'none').attr('stroke', 'rgba(255,255,255,0.06)').attr('stroke-width', 0.5);

  svg.append('line')
    .attr('x1', lx1).attr('y1', ly1)
    .attr('x2', lx2).attr('y2', ly2)
    .attr('stroke', 'rgba(197,150,74,.55)')
    .attr('stroke-width', 1.2)
    .attr('stroke-dasharray', '3 3');

  svg.append('text')
    .attr('x', textX)
    .attr('y', textY)
    .attr('fill', 'rgba(197,150,74,.7)')
    .attr('font-size', 9)
    .attr('font-family', 'Sora, sans-serif')
    .text('50%+1');

  svg.selectAll('g.seat-group')
    .data(colored)
    .enter()
    .append('g')
    .attr('class', 'seat-group')
    .attr('transform', d => `translate(${cx + d.radius * Math.cos(d.angle)}, ${cy + d.radius * Math.sin(d.angle)})`)
    .style('opacity', 0)
    .each(function (d, i) {
      d3.select(this)
        .transition()
        .delay(i * (500 / colored.length))
        .duration(180)
        .style('opacity', 1);
    })
    .each(function (d) {
      const inner = d3.select(this).append('g').attr('class', 'seat-inner');
      inner.append('circle')
        .attr('r', layout.dotR)
        .attr('fill', d.color)
        .attr('stroke', d.color)
        .attr('stroke-width', 3.5);
      if (d.avatarUrl) {
        const clipId = 'clip-' + d.userId + '-' + Math.random().toString(36).substr(2, 6);
        defs.append('clipPath')
          .attr('id', clipId)
          .append('circle')
          .attr('cx', 0)
          .attr('cy', 0)
          .attr('r', layout.dotR - 2);
        inner.append('image')
          .attr('x', -(layout.dotR - 2))
          .attr('y', -(layout.dotR - 2))
          .attr('width', (layout.dotR - 2) * 2)
          .attr('height', (layout.dotR - 2) * 2)
          .attr('preserveAspectRatio', 'xMidYMid slice')
          .attr('href', d.avatarUrl)
          .attr('clip-path', `url(#${clipId})`);
      }
    })
    .on('mouseover', function (event, d) {
      d3.select(this).select('.seat-inner')
        .transition().duration(150)
        .attr('transform', 'scale(1.8)');
      tooltip.style.opacity = 1;
      const avatarHtml = d.avatarUrl
        ? `<img src="${d.avatarUrl}" class="tooltip-avatar" onerror="this.style.display='none'">`
        : `<span style="width:30px;height:30px;border-radius:50%;background:${d.color}33;display:inline-flex;align-items:center;justify-content:center;font-size:13px;color:${d.color};flex-shrink:0;border:1.5px solid ${d.color}66;">${(d.username||'?')[0].toUpperCase()}</span>`;
      const partyColor = d.color || '#c5964a';
      // compute party seat share from colored array
      const partyTotal = colored.filter(x => x.party === d.party).length;
      const totalAll   = colored.length;
      const partySeatPct = totalAll > 0 ? ((partyTotal / totalAll) * 100).toFixed(1) : '—';
      const partyVotesPct = d.partyVotesPct != null ? `<div class="tt-row"><span class="tt-label">${t('party_votes_label')}</span><span class="tt-val" style="color:${partyColor}">${d.partyVotesPct}%</span></div>` : '';
      const partyVotesAbs = d.partyVotes != null ? `<div class="tt-row"><span class="tt-label">${t('total_votes_label')}</span><span class="tt-val">${Number(d.partyVotes).toLocaleString()}</span></div>` : '';
      tooltip.innerHTML = `
        <div class="tt-party-header" style="border-left:3px solid ${partyColor};padding-left:8px;margin-bottom:8px;">
          <div style="font-weight:700;font-size:.85rem;color:${partyColor};">${d.party}</div>
          <div style="font-size:.7rem;color:var(--text3);margin-top:2px;">${partyTotal} seats · ${partySeatPct}% of parliament</div>
        </div>
        ${d.username ? `<div class="tt-user" style="display:flex;align-items:center;gap:8px;margin-bottom:8px;padding:6px 8px;background:rgba(255,255,255,0.04);border-radius:6px;">${avatarHtml}<div><strong style="font-size:.82rem;">${d.username}</strong><div style="font-size:.68rem;color:var(--text3);margin-top:1px;">Seat ${d.seatIdx + 1} of ${d.total}</div></div></div>` : `<div style="font-size:.72rem;color:var(--text3);margin-bottom:6px;">Seat ${d.seatIdx + 1} of ${d.total}</div>`}
        <div class="tt-stats" style="display:flex;flex-direction:column;gap:3px;font-size:.72rem;">
          <div class="tt-row"><span class="tt-label">Seats</span><span class="tt-val">${partyTotal} / ${totalAll}</span></div>
          <div class="tt-row"><span class="tt-label">Seat share</span><span class="tt-val" style="color:${partyColor}">${partySeatPct}%</span></div>
          ${partyVotesPct}
          ${partyVotesAbs}
        </div>
        ${d.userId ? '<div style="font-size:.63rem;color:var(--gold);margin-top:6px;opacity:.8;">click for player card ↗</div>' : ''}
      `;
    })
    .on('mousemove', event => {
      tooltip.style.left = (event.clientX + 14) + 'px';
      tooltip.style.top = (event.clientY - 36) + 'px';
    })
    .on('mouseout', function (event, d) {
      d3.select(this).select('.seat-inner')
        .transition().duration(150)
        .attr('transform', 'scale(1)');
      tooltip.style.opacity = 0;
    })
    .on('click', (event, d) => {
      if (d.userId) {
        openPlayerCard(d);
      }
    });

  svg.append('text')
    .attr('x', cx).attr('y', cy - 6)
    .attr('text-anchor', 'middle')
    .attr('fill', '#535e72')
    .attr('font-size', 10)
    .attr('font-family', 'Sora, sans-serif')
    .text(`${totalSeats} seggi`);

  sorted.forEach(p => {
    const seatPct = totalSeats > 0 ? ((p.seats / totalSeats) * 100).toFixed(1) : '0';
    const votePct = totalVotesAll > 0 && p.votes > 0 ? ((p.votes / totalVotesAll) * 100).toFixed(1) : null;
    const el = document.createElement('div');
    el.className = 'leg-item leg-toggle';
    el.title = `${p.name} — ${p.seats} seats (${seatPct}%)${votePct ? ` · ${votePct}% votes` : ''}`;
    el.innerHTML = `
      <span class="leg-dot" style="background:${p.color}"></span>
      <span class="leg-name">${p.abbr || p.name}</span>
      <span class="leg-seats">${p.seats}</span>
      <span class="leg-pct" style="color:${p.color};opacity:.75;font-size:.65rem;margin-left:2px;">${seatPct}%</span>
      ${votePct ? `<span class="leg-vote-pct" style="font-size:.6rem;color:var(--text3);margin-left:3px;" title="${votePct}% of votes">🗳${votePct}%</span>` : ''}
    `;
    el.style.cursor = 'pointer';
    el.addEventListener('click', () => {
      if (hiddenParties.has(p.name)) {
        hiddenParties.delete(p.name);
        el.style.opacity = '1';
        el.querySelector('.leg-dot').style.opacity = '1';
      } else {
        hiddenParties.add(p.name);
        el.style.opacity = '0.4';
        el.querySelector('.leg-dot').style.opacity = '0.3';
      }
      redrawOpacity();
    });
    legendContainer.appendChild(el);
  });

  _lastRenderData = { parties, container, legendContainer, tooltip };
}

/* ── PLAYER CARD MODAL ── */
export function openPlayerCard(d) {
  closePlayerCard();

  const partyColor = d.color || '#c5964a';
  const seatShare = (d.partyVotesPct != null) ? `${d.partyVotesPct}%` : null;
  const avatarHtml = d.avatarUrl
    ? `<img src="${d.avatarUrl}" class="pc-avatar" onerror="this.style.display='none'">`
    : `<div class="pc-avatar pc-avatar-fallback" style="background:${partyColor}33;color:${partyColor};border-color:${partyColor}66;">${(d.username || '?')[0].toUpperCase()}</div>`;

  const topVotes = d.topVotesInParty || d.userVotes || 1;
  const votePct = Math.max(2, Math.min(100, Math.round(((d.userVotes || 0) / topVotes) * 100)));
  const isTopOfParty = d.partyRank === 1;
  const rankLabel = d.partyRank ? `#${d.partyRank}${d.total ? ` of ${d.total}` : ''} in party` : null;

  const overlay = document.createElement('div');
  overlay.className = 'pc-modal-overlay';
  overlay.innerHTML = `
    <div class="pc-modal-box" style="--pc-color:${partyColor};">
      <button class="pc-modal-close" aria-label="Close">✕</button>
      <div class="pc-modal-header">
        <div class="pc-avatar-ring">${avatarHtml}</div>
        <div class="pc-header-info">
          <div class="pc-username">${escapeHtml(d.username || 'Unknown')} ${isTopOfParty ? '<span class="pc-crown" title="Top vote-getter in party">👑</span>' : ''}</div>
          <div class="pc-party" style="color:${partyColor};">${escapeHtml(d.party || 'Independent')}</div>
          ${rankLabel ? `<div class="pc-rank-badge">${rankLabel}</div>` : ''}
        </div>
      </div>

      <div class="pc-vote-section">
        <div class="pc-vote-header">
          <span class="pc-stat-label">${t('votes_received')}</span>
          <span class="pc-vote-number" data-target="${d.userVotes || 0}">0</span>
        </div>
        <div class="pc-bar-track">
          <div class="pc-bar-fill" style="background:${partyColor};width:0%;" data-w="${votePct}"></div>
        </div>
        <div class="pc-bar-caption">${d.partyRank && d.total > 1 ? (isTopOfParty ? 'Top of the party' : `${votePct}% of the party's top vote-getter`) : ''}</div>
      </div>

      <div class="pc-stats-grid">
        ${d.level != null ? `
          <div class="pc-stat"><span class="pc-stat-label">Level</span><span class="pc-stat-val">⭐ ${d.level}</span></div>
        ` : ''}
        <div class="pc-stat"><span class="pc-stat-label">Seat</span><span class="pc-stat-val">${d.seatIdx + 1} / ${d.total}</span></div>
        ${d.partyMembers != null ? `<div class="pc-stat"><span class="pc-stat-label">Party members</span><span class="pc-stat-val">${d.partyMembers}</span></div>` : ''}
        ${seatShare ? `<div class="pc-stat"><span class="pc-stat-label">Party vote share</span><span class="pc-stat-val" style="color:${partyColor}">${seatShare}</span></div>` : ''}
        ${d.partyVotes != null ? `<div class="pc-stat"><span class="pc-stat-label">${t('party_total_votes_label')}</span><span class="pc-stat-val">${Number(d.partyVotes).toLocaleString()}</span></div>` : ''}
      </div>

      <a class="pc-profile-link" href="${APP_BASE}/user/${d.userId}" target="_blank" rel="noopener">Open profile ↗</a>
    </div>
  `;
  document.body.appendChild(overlay);
  document.body.style.overflow = 'hidden';

  // Animate the vote bar and count-up number in on the next frame
  requestAnimationFrame(() => {
    const bar = overlay.querySelector('.pc-bar-fill');
    if (bar) bar.style.width = bar.dataset.w + '%';
    const numEl = overlay.querySelector('.pc-vote-number');
    if (numEl) _animateCount(numEl, 0, parseInt(numEl.dataset.target, 10) || 0, 650);
  });

  const close = () => closePlayerCard();
  overlay.querySelector('.pc-modal-close').addEventListener('click', close);
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', _pcEscHandler);
}

function _animateCount(el, from, to, duration) {
  const start = performance.now();
  const step = now => {
    const t = Math.min(1, (now - start) / duration);
    const eased = 1 - Math.pow(1 - t, 3);
    el.textContent = Math.round(from + (to - from) * eased).toLocaleString();
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function closePlayerCard() {
  document.querySelectorAll('.pc-modal-overlay').forEach(el => el.remove());
  document.body.style.overflow = '';
  document.removeEventListener('keydown', _pcEscHandler);
}

function _pcEscHandler(e) {
  if (e.key === 'Escape') closePlayerCard();
}
