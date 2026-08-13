/* ══════════════════════════════════════════════════════════════
   WarEra+ — Political View: organizer.js come modulo ES (Fase 2, Stage 7)
   ------------------------------------------------------------------
   Conversione diretta. TomSelect da CDN a import npm. _lastMinVotesToWin
   -> minVotesToWin (config.js, Stage 2 — unificata con l'unica scrittura
   in party.js, niente più window.* duplicato).

   Solo `initMemberOrganizer` è consumata da fuori (party.js) — le altre
   funzioni restano private al modulo, a differenza dell'originale dove
   erano tutte "esportate" solo per hoisting implicito di script classici.
   ══════════════════════════════════════════════════════════════ */

import TomSelect from 'tom-select';
import { t } from './i18n.js';
import { escapeHtml, minVotesToWin } from './config.js';

let _endorsementGroups = [];

export function initMemberOrganizer(members, partyId) {
  const container = document.getElementById('endorsementGroupsContainer');
  if (!container) return;

  const saved = localStorage.getItem(`endorsement_groups_${partyId}`);
  if (saved) {
    try { _endorsementGroups = JSON.parse(saved); } catch (e) { _endorsementGroups = []; }
  } else {
    _endorsementGroups = [];
  }

  renderEndorsementGroups(members, partyId);

  const addBtn = document.getElementById('addEndorsementGroupBtn');
  if (addBtn) {
    addBtn.onclick = () => {
      _endorsementGroups.push({ candidateId: null, supporterIds: [] });
      renderEndorsementGroups(members, partyId);
    };
  }

  const autoBtn = document.getElementById('autoAssignSupportersBtn');
  if (autoBtn) {
    autoBtn.onclick = () => {
      if (!minVotesToWin) {
        alert(t('no_election_threshold'));
        return;
      }
      autoAssignSupporters(members, partyId, minVotesToWin);
    };
  }
}

function autoAssignSupporters(members, partyId, minVotesToWinArg) {
  const groupsWithCandidate = _endorsementGroups.filter(g => g.candidateId !== null);
  if (groupsWithCandidate.length === 0) {
    alert(t('no_candidate_selected'));
    return;
  }

  const assignedUserIds = new Set();
  _endorsementGroups.forEach(g => {
    if (g.candidateId) assignedUserIds.add(g.candidateId);
    g.supporterIds.forEach(sid => assignedUserIds.add(sid));
  });

  let unassigned = [...members].filter(m => !assignedUserIds.has(m._id));

  const groupsNeeds = groupsWithCandidate.map(g => ({
    group: g,
    needed: Math.max(0, minVotesToWinArg - g.supporterIds.length),
  }));

  for (const need of groupsNeeds) {
    if (need.needed <= 0 || unassigned.length === 0) continue;
    const toTake = Math.min(need.needed, unassigned.length);
    need.group.supporterIds.push(...unassigned.splice(0, toTake).map(m => m._id));
  }

  if (unassigned.length > 0) {
    let idx = 0;
    while (unassigned.length > 0) {
      groupsWithCandidate[idx % groupsWithCandidate.length].supporterIds.push(unassigned.shift()._id);
      idx++;
    }
  }

  if (!_saveEndorsementGroups(partyId)) return;
  renderEndorsementGroups(members, partyId);

  const totalAssigned = _endorsementGroups.reduce((sum, g) => sum + g.supporterIds.length, 0);
  alert(t('auto_assign_done', { assigned: totalAssigned, groups: groupsWithCandidate.length }));
}

function renderEndorsementGroups(members, partyId) {
  const container = document.getElementById('endorsementGroupsContainer');
  if (!container) return;

  if (_endorsementGroups.length === 0) {
    container.innerHTML = `<p class="empty">${t('no_candidates_yet')}</p>`;
    return;
  }

  container.innerHTML = _endorsementGroups.map((group, idx) => {
    const candidate  = members.find(m => m._id === group.candidateId);
    const supporters = group.supporterIds.map(sid => members.find(m => m._id === sid)).filter(Boolean);

    const candidateCard = candidate ? `
      <div class="candidate-card">
        <img src="${candidate.avatarUrl || ''}" class="candidate-avatar" onerror="this.src=''">
        <div class="candidate-info">
          <div class="candidate-name">${escapeHtml(candidate.username)}</div>
          <div class="candidate-role">Candidate</div>
        </div>
        <div class="candidate-stats">
          <span class="supporter-count">${supporters.length} / ${minVotesToWin}</span>
          <button class="change-candidate-btn" data-group-idx="${idx}">✎ Change</button>
        </div>
      </div>
    ` : `
      <div class="candidate-card empty">
        <div class="candidate-info">
          <div class="candidate-name">No candidate selected</div>
          <button class="select-candidate-btn" data-group-idx="${idx}">+ Select candidate</button>
        </div>
      </div>
    `;

    const supportersHtml = supporters.map(s => `
      <div class="supporter-pill">
        <img src="${s.avatarUrl || ''}" onerror="this.src=''">
        ${escapeHtml(s.username)}
        <button class="remove-supporter" data-group-idx="${idx}" data-supporter-id="${s._id}">✕</button>
      </div>
    `).join('');

    const availableForSupporter = members.filter(m => m._id !== group.candidateId && !group.supporterIds.includes(m._id));
    const supporterSelectOptions = availableForSupporter.map(m => `<option value="${m._id}">${escapeHtml(m.username)}</option>`).join('');

    return `
      <div class="endorsement-group-card" data-group-idx="${idx}">
        <div style="display:flex;justify-content:flex-end;margin-bottom:8px;">
          <button class="group-remove" data-group-idx="${idx}" style="background:none;border:none;color:var(--red);font-size:1.2rem;cursor:pointer;">✕</button>
        </div>
        ${candidateCard}
        <div class="group-supporters">
          <div class="supporter-list">${supportersHtml || '<em>No supporters yet</em>'}</div>
          <div class="add-supporter">
            <select class="supporter-select" data-group-idx="${idx}" style="width:auto;flex:1;">
              <option value="">-- Add supporter --</option>
              ${supporterSelectOptions}
            </select>
            <button class="add-supporter-btn" data-group-idx="${idx}">+</button>
          </div>
        </div>
      </div>
    `;
  }).join('');

  initTomSelectForSupporters(members);
  attachGroupEvents(members, partyId);
}

/* ── TOM SELECT for supporters ── */
function _tomSelectMemberRender(members) {
  return {
    option: (data, escape) => {
      const m = members.find(m => m._id === data.value);
      if (!m) return `<div>${escape(data.text)}</div>`;
      const av = m.avatarUrl ? `<img src="${m.avatarUrl}" style="width:20px;height:20px;border-radius:50%;vertical-align:middle;margin-right:8px;">` : '';
      return `<div>${av}${escape(m.username)}</div>`;
    },
    item: (data, escape) => {
      const m = members.find(m => m._id === data.value);
      if (!m) return `<div>${escape(data.text)}</div>`;
      const av = m.avatarUrl ? `<img src="${m.avatarUrl}" style="width:18px;height:18px;border-radius:50%;vertical-align:middle;margin-right:6px;">` : '';
      return `<div>${av}${escape(m.username)}</div>`;
    },
  };
}
function initTomSelectForSupporters(members) {
  document.querySelectorAll('.supporter-select').forEach(select => {
    if (select.tomselect) select.tomselect.destroy();
    new TomSelect(select, {
      placeholder: 'Search member...', allowEmptyOption: true, create: false, sortField: 'text',
      render: _tomSelectMemberRender(members),
    });
  });
}

/* ── GROUP EVENTS ── */
function attachGroupEvents(members, partyId) {
  const on = (sel, handler) => {
    document.querySelectorAll(sel).forEach(btn => {
      btn.removeEventListener('click', btn._handler);
      btn._handler = handler;
      btn.addEventListener('click', handler);
    });
  };

  on('.group-remove', e => {
    _endorsementGroups.splice(parseInt(e.target.getAttribute('data-group-idx')), 1);
    saveAndRefresh(members, partyId);
  });
  on('.select-candidate-btn, .change-candidate-btn', e => {
    openCandidateSelector(parseInt(e.target.getAttribute('data-group-idx')), members, partyId);
  });
  on('.add-supporter-btn', e => {
    const idx     = parseInt(e.target.getAttribute('data-group-idx'));
    const select  = document.querySelector(`.supporter-select[data-group-idx="${idx}"]`);
    const supporterId = select.tomselect ? select.tomselect.getValue() : select.value;
    if (!supporterId) return;
    if (!_endorsementGroups[idx].supporterIds.includes(supporterId)) {
      _endorsementGroups[idx].supporterIds.push(supporterId);
      saveAndRefresh(members, partyId);
    }
    if (select.tomselect) select.tomselect.clear(); else select.value = '';
  });
  on('.remove-supporter', e => {
    const idx         = parseInt(e.target.getAttribute('data-group-idx'));
    const supporterId = e.target.getAttribute('data-supporter-id');
    _endorsementGroups[idx].supporterIds = _endorsementGroups[idx].supporterIds.filter(id => id !== supporterId);
    saveAndRefresh(members, partyId);
  });
}

function openCandidateSelector(groupIdx, members, partyId) {
  const dialog = document.createElement('div');
  dialog.className = 'candidate-selector-dialog';
  dialog.innerHTML = `
    <div class="dialog-content">
      <h3>Select Candidate</h3>
      <select id="temp-candidate-select" style="width:100%;">
        <option value="">-- Choose candidate --</option>
        ${members.map(m => `<option value="${m._id}">${escapeHtml(m.username)}</option>`).join('')}
      </select>
      <div class="dialog-buttons">
        <button id="confirm-candidate">Confirm</button>
        <button id="cancel-candidate">Cancel</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  new TomSelect('#temp-candidate-select', {
    placeholder: 'Search member...', allowEmptyOption: true, create: false, sortField: 'text',
    render: _tomSelectMemberRender(members),
  });
  dialog.querySelector('#confirm-candidate').onclick = () => {
    const candidateId = document.getElementById('temp-candidate-select').value;
    if (candidateId) {
      _endorsementGroups[groupIdx].candidateId   = candidateId;
      _endorsementGroups[groupIdx].supporterIds  = _endorsementGroups[groupIdx].supporterIds.filter(id => id !== candidateId);
      saveAndRefresh(members, partyId);
    }
    dialog.remove();
  };
  dialog.querySelector('#cancel-candidate').onclick = () => dialog.remove();
  dialog.querySelector('.dialog-content').addEventListener('click', e => e.stopPropagation());
  dialog.onclick = () => dialog.remove();
}

function _saveEndorsementGroups(partyId) {
  const key = `endorsement_groups_${partyId}`;
  const payload = JSON.stringify(_endorsementGroups);
  try {
    localStorage.setItem(key, payload);
    return true;
  } catch (err) {
    if (err.name !== 'QuotaExceededError') throw err;
    // Libera spazio rimuovendo la cache 'we_*' e riprova
    try { Object.keys(localStorage).filter(k => k.startsWith('we_')).forEach(k => localStorage.removeItem(k)); } catch (_) {}
    try {
      localStorage.setItem(key, payload);
      return true;
    } catch (err2) {
      console.error('Unable to save endorsement groups (storage full):', err2);
      alert(t('storage_full_alert'));
      return false;
    }
  }
}

function saveAndRefresh(members, partyId) {
  _saveEndorsementGroups(partyId);
  renderEndorsementGroups(members, partyId);
}
