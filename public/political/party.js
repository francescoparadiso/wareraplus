/* ── PARTY SELECTOR ── */
async function loadPartiesForSelector() {
  const select = document.getElementById('partySelect');
  if (!select) return;
  if (select.tomselect) select.tomselect.destroy();
  const tomSelect = new TomSelect(select, {
    placeholder: 'Search party…',
    allowEmptyOption: true,
    create: false,
    sortField: { field: 'text', direction: 'asc' },
  });
  try {
    const parties = await loadPartiesForCountry(_currentCountryId);
    parties.forEach(p => tomSelect.addOption({ value: p._id, text: p.name || p._id }));
    if (_currentPartyId && tomSelect.options[_currentPartyId]) {
      tomSelect.setValue(_currentPartyId);
    } else {
      tomSelect.setValue('');
    }
    select.tomselect = tomSelect;
    tomSelect.on('change', value => loadPartyDetails(value || null));
  } catch (err) {
    console.warn('Error loading parties:', err);
  }

  // Wire refresh button
  const refreshBtn = document.getElementById('refreshPartyBtn');
  if (refreshBtn) {
    refreshBtn.onclick = async () => {
      if (!_currentPartyId) return;
      refreshBtn.classList.add('spinning');
      // Bust cache for party + user calls
      const key = 'we_/party_' + JSON.stringify({ id: _currentPartyId });
      try { localStorage.removeItem(key); } catch (_) {}
      await loadPartyDetails(_currentPartyId);
      setTimeout(() => refreshBtn.classList.remove('spinning'), 650);
    };
  }
}

/* ── PARTY DETAILS ── */
async function loadPartyDetails(partyId) {
  startHeavyOperation('Loading party details...');
  if (!partyId) {
    document.getElementById('partyOverview').innerHTML = '<p>Select a party to see details.</p>';
    document.getElementById('partyMembersContainer').innerHTML = '';
    document.getElementById('partyElectedContainer').innerHTML = '';
    document.getElementById('partyLeadershipContainer').innerHTML = '';
    document.getElementById('memberCountBadge').textContent = '—';
    const orgPanel = document.querySelector('#party-view details.panel:has(.member-organizer)');
    if (orgPanel) orgPanel.style.display = 'none';
    return;
  }
  _currentPartyId = partyId;
  try {
    localStorage.setItem('preferredPartyId', partyId);
  } catch (err) {
    if (err.name === 'QuotaExceededError') {
      // Libera spazio rimuovendo la cache 'we_*' e riprova
      try { Object.keys(localStorage).filter(k => k.startsWith('we_')).forEach(k => localStorage.removeItem(k)); } catch (_) {}
      try { localStorage.setItem('preferredPartyId', partyId); } catch (_) { console.warn('Unable to save preferredPartyId (storage full)'); }
    } else {
      throw err;
    }
  }

  // ── Clear stale content immediately before any async work ──
  showSkeletonPartyView();

  const memberCountSpan = document.getElementById('memberCountBadge');
  if (memberCountSpan) memberCountSpan.textContent = '⏳';

  try {
    // /elections non dipende dai dati del partito: la lanciamo subito, in parallelo con /party,
    // così è già pronta (o quasi) quando serve più avanti per "LAST CONGRESS ELECTION".
    const electionsDataPromise = localFetch('/elections', { countryId: _currentCountryId });

    const partyData = await localFetch('/party', { id: partyId });
    _currentPartyData = partyData;

    /* OVERVIEW */
    document.getElementById('partyOverview').innerHTML = `
      ${partyData.avatarUrl ? `<img src="${partyData.avatarUrl}" style="width:64px;height:64px;border-radius:50%;margin-bottom:8px;">` : ''}
      <div class="party-overview-item"><span class="party-overview-label">${t('party_name')}</span><span>${escapeHtml(partyData.name)}</span></div>
      <div class="party-overview-item"><span class="party-overview-label">${t('party_country')}</span><span>${_countryNamesMap.get(partyData.country) || partyData.country || _currentCountryId}</span></div>
      <div class="party-overview-item"><span class="party-overview-label">${t('party_founded')}</span><span>${partyData.createdAt ? new Date(partyData.createdAt).toLocaleDateString() : '—'}</span></div>
      ${partyData.description ? `<div class="party-overview-item"><span class="party-overview-label">${t('party_description')}</span><span>${escapeHtml(partyData.description)}</span></div>` : ''}
      ${partyData.ethics ? `
        <div class="party-overview-item"><span class="party-overview-label">${t('party_ethics')}</span><span>
          Militarism: ${partyData.ethics.militarism ?? '—'} |
          Isolationism: ${partyData.ethics.isolationism ?? '—'} |
          Imperialism: ${partyData.ethics.imperialism ?? '—'} |
          Industrialism: ${partyData.ethics.industrialism ?? '—'}
        </span></div>
      ` : ''}
    `;

    /* MEMBERS + LEADERSHIP — le due liste di utenti non dipendono l'una dall'altra: le scarichiamo insieme */
    const memberIds = partyData.members || [];
    if (memberCountSpan) memberCountSpan.textContent = `loading ${memberIds.length} members...`;
    const councilMembers = (partyData.councilMembers || []).filter(uid => uid !== partyData.leader && uid !== partyData.treasurer);
    const allLeaderIds = [partyData.leader, partyData.treasurer, ...councilMembers].filter(Boolean);

    const [membersRaw, leaderUsers] = await Promise.all([
      Promise.all(memberIds.map(uid => localFetch('/user', { id: uid }).catch(() => null))),
      Promise.all(allLeaderIds.map(uid => localFetch('/user', { id: uid }).catch(() => null))),
    ]);
    const members = membersRaw.filter(u => u && u._id);
    if (memberCountSpan) memberCountSpan.textContent = `${members.length} / ${memberIds.length}`;

    const now = new Date();
    const threeDays = 3 * 24 * 60 * 60 * 1000;
    const activeMembers = members.filter(m => m.dates && (now - new Date(m.dates.lastConnectionAt)) < threeDays);
    const inactiveMembers = members.filter(m => !activeMembers.includes(m));

    document.getElementById('partyMembersContainer').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:4px;">
        <div class="member-section-title"><span style="color:var(--green);">●</span> ${t('active_members')} · ${activeMembers.length}</div>
        <div class="member-card-grid">
          ${activeMembers.map(m => _memberCard(m, true)).join('') || `<p class="empty">${t('no_active_members')}</p>`}
        </div>
        <div class="member-section-title" style="margin-top:16px;"><span style="color:var(--text3);">●</span> ${t('inactive_members')} · ${inactiveMembers.length}</div>
        <div class="member-card-grid">
          ${inactiveMembers.map(m => _memberCard(m, false)).join('') || `<p class="empty">${t('no_inactive_members')}</p>`}
        </div>
      </div>
    `;

    /* LEADERSHIP */
    const leaderMap = {};
    allLeaderIds.forEach((uid, i) => { if (leaderUsers[i]) leaderMap[uid] = leaderUsers[i]; });
    document.getElementById('partyLeadershipContainer').innerHTML = `
      <div style="display:flex;flex-direction:column;gap:16px;">
        ${_leaderSection('👑 Leader', partyData.leader, leaderMap)}
        ${_leaderSection('💰 Treasurer', partyData.treasurer, leaderMap)}
        <div>
          <h3>🏛️ Council Members</h3>
          <div class="party-member-list">
            ${councilMembers.map(uid => {
      const u = leaderMap[uid];
      return u ? `<div class="member-row">
                <img src="${u.avatarUrl || ''}" class="member-avatar">
                <div class="member-info"><div class="member-name"><a href="${APP_BASE}/user/${uid}" target="_blank">${escapeHtml(u.username)}</a></div></div>
              </div>` : `<div>User ${uid}</div>`;
    }).join('') || '<p>None</p>'}
          </div>
        </div>
      </div>
    `;

    /* LAST CONGRESS ELECTION */
    const electionsData = await electionsDataPromise;
    const congressElections = (electionsData.items || []).filter(e => e.type === 'congress').sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    _lastCongressElection = congressElections[0];

    if (_lastCongressElection) {
      const electionData = await localFetch('/election', { id: _lastCongressElection._id });
      const electedList = electionData.candidates.filter(c => c.isElected);
      let minVotesToWin = Infinity;
      electedList.forEach(c => {
        let votes = c.voteCount || 0;
        if (electionData.votes?.[c.user || c.userId]) votes = electionData.votes[c.user || c.userId];
        if (votes < minVotesToWin) minVotesToWin = votes;
      });
      if (minVotesToWin === Infinity) minVotesToWin = 0;
      _lastMinVotesToWin = window._lastMinVotesToWin = minVotesToWin;

      const allPartyCandidates = electionData.candidates.filter(c => String(c.party || c.partyId) === partyId);
      const candidatesWithDetails = await Promise.all(allPartyCandidates.map(async c => {
        const user = await localFetch('/user', { id: c.user || c.userId });
        let voteCount = c.voteCount || 0;
        if (electionData.votes?.[c.user || c.userId]) voteCount = electionData.votes[c.user || c.userId];
        return { ...c, user, votes: voteCount, isElected: c.isElected };
      }));
      const elected = candidatesWithDetails.filter(c => c.isElected);
      const notElected = candidatesWithDetails.filter(c => !c.isElected);

      document.getElementById('partyElectedContainer').innerHTML = `
        <div class="candidate-threshold">${t('minimum_votes_elected', { n: minVotesToWin.toLocaleString() })}</div>
        <h3>${t('elected_count', { n: elected.length })}</h3>
        <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px;">
          ${elected.map(c => _candidatePill(c)).join('') || `<p>${t('no_elected_candidates')}</p>`}
        </div>
        <h3>${t('not_elected_count', { n: notElected.length })}</h3>
        <div style="display:flex;flex-wrap:wrap;gap:12px;">
          ${notElected.map(c => _candidatePill(c)).join('') || `<p>${t('no_non_elected_candidates')}</p>`}
        </div>
      `;
    } else {
      document.getElementById('partyElectedContainer').innerHTML = `<p>${t('no_congress_elections')}</p>`;
    }

    /* MEMBER ORGANIZER */
    if (activeMembers.length > 0 && document.getElementById('endorsementGroupsContainer')) {
      initMemberOrganizer(activeMembers, partyId);
    }
    endHeavyOperation();
    hideSkeletonPartyView();
  } catch (err) {
    console.error(err);
    document.getElementById('partyOverview').innerHTML = `<p>${t('error_loading_party')}</p>`;
    endHeavyOperation();
    hideSkeletonPartyView();
  }
}

/* ── PRIVATE HELPERS ── */
function _memberPill(m) {
  const lastSeen = m.dates?.lastConnectionAt ? new Date(m.dates.lastConnectionAt).toLocaleDateString() : '—';
  return `<div class="member-pill">
    <img src="${m.avatarUrl || ''}" class="member-avatar" onerror="this.src=''" style="width:28px;height:28px;border-radius:50%;object-fit:cover;">
    <div>
      <div class="member-name"><a href="${APP_BASE}/user/${m._id}" target="_blank">${escapeHtml(m.username)}</a></div>
      <div class="member-status">Last seen: ${lastSeen}</div>
    </div>
  </div>`;
}
function _candidatePill(c) {
  return `<div class="member-pill">
    <img src="${c.user?.avatarUrl || ''}" class="member-avatar" style="width:28px;height:28px;border-radius:50%;">
    <div>
      <div class="member-name"><a href="${APP_BASE}/user/${c.user?._id}" target="_blank">${escapeHtml(c.user?.username)}</a></div>
      <div>Votes: ${c.votes.toLocaleString()}</div>
    </div>
  </div>`;
}
function _leaderSection(title, uid, leaderMap) {
  const u = uid ? leaderMap[uid] : null;
  return `<div>
    <h3>${title}</h3>
    <div class="party-member-list">
      ${u ? `<div class="member-row">
        <img src="${u.avatarUrl || ''}" class="member-avatar">
        <div class="member-info"><div class="member-name"><a href="${APP_BASE}/user/${uid}" target="_blank">${escapeHtml(u.username)}</a></div></div>
      </div>` : '<p>None</p>'}
    </div>
  </div>`;
}

/* ── MEMBER CARD (grid layout) ── */
function _memberCard(m, isActive) {
  const lastSeen = m.dates?.lastConnectionAt ? _relativeTime(new Date(m.dates.lastConnectionAt)) : '—';
  const avatarClass = isActive ? 'member-card-avatar active' : 'member-card-avatar inactive';
  const badgeClass  = isActive ? 'member-card-badge active'  : 'member-card-badge inactive';
  const avatarSrc   = m.avatarUrl || '';
  return `<div class="member-card">
    <div class="${badgeClass}"></div>
    <img src="${avatarSrc}" class="${avatarClass}" onerror="this.src=''" alt="">
    <div class="member-card-name"><a href="${APP_BASE}/user/${m._id}" target="_blank">${escapeHtml(m.username)}</a></div>
    <div class="member-card-seen">${isActive ? '🟢 ' : ''}${lastSeen}</div>
  </div>`;
}

function _relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60)   return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24)    return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30)   return `${days}d ago`;
  const months = Math.floor(days / 30);
  return `${months}mo ago`;
}