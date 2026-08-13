/* ── LOAD ELECTION (entry point) ── */
async function loadElection(id) {
  // Se non viene passato un id, usa quello selezionato nel dropdown
  let electionId = id;
  if (!electionId) {
    const select = document.getElementById('electionSelect');
    electionId = select ? select.value : '';
  }
  if (!electionId) { setStatus(t('no_election_selected'), 'error'); return; }

  if (_pendingRequest) {
    clearTimeout(_pendingRequest.timeout);
    if (_pendingRequest.controller) _pendingRequest.controller.abort();
  }

  const selectEl = document.getElementById('electionSelect');
  const btnEl = document.getElementById('loadBtn');
  selectEl.disabled = true; btnEl.disabled = true;

  // NB: il lavoro vero e proprio è debounced di 300ms dentro il setTimeout.
  // Avvolgiamo tutto in una Promise che si risolve solo a lavoro concluso
  // (successo, errore o early-return), così chi fa `await loadElection(id)`
  // (es. SenateView) ottiene davvero i dati aggiornati, invece di risolversi
  // subito e leggere `window._lastElectedParties` ancora vecchio.
  return new Promise(resolveOuter => {
    _pendingRequest = {};
    _pendingRequest.timeout = setTimeout(async () => {
      _pendingRequest = null;
      setStatus(t('loading_election'), 'loading');

      try {
        const controller = new AbortController();
        _pendingRequest = { controller };

        const election = await localFetch('/election', { id: electionId });

        if (_congressCountdownInterval) { clearInterval(_congressCountdownInterval); _congressCountdownInterval = null; }
        if (window._presCountdown) { clearInterval(window._presCountdown); window._presCountdown = null; }

        if (!election || !election.candidates) {
          console.warn('No detail for this ID:', electionId);
          showView('congress');
          hideSkeleton();
          setStatus(t('election_not_found'), 'error');
          return;
        }

        const isLatestPresidential = (election.type === 'president' && election._id === _latestPresidentialElectionId);
        _currentIsLatestPresidential = isLatestPresidential;

        if (election.type === 'president') await loadPresidentialElection(election, isLatestPresidential);
        else if (election.type === 'congress') await loadCongressElection(election);
        else throw new Error(`Unknown election type: ${election.type}`);

        setStatus(t('updated_data'), '');

        if (window.umami) {
          window.umami.track('election-load', {
            electionId: election._id,
            type: election.type,
            countryId: election.country || _currentCountryId,
          });
        }
      } catch (err) {
        console.error(err);
        hideSkeleton();
        if (err.message.includes('429')) {
          setStatus(t('too_many_requests'), 'error');
        } else if (err.name !== 'AbortError') {
          setStatus(t('generic_error', { msg: err.message }), 'error');
        }
      } finally {
        selectEl.disabled = false; btnEl.disabled = false;
        resolveOuter();
      }
    }, 300);
  });
}

/* ── BOOT ── */
document.addEventListener('DOMContentLoaded', () => {
  initTheme();

  document.getElementById('partyViewBtn')?.addEventListener('click', showPartyView);
  document.getElementById('themeToggle')?.addEventListener('click', toggleTheme);

  loadPartyColors('parties_6813b6d446e731854c7ac7a2.csv').then(async () => {
    console.log(`🎨 ${_partyColorMap.size} colors loaded from CSV`);
    loadCountries();

    // La fetch di /countries (per _currentCountryData) non blocca più loadElectionsHistory:
    // girano in parallelo, e se rientrano nello stesso microtask finiscono nello stesso batch.
    const countryDataPromise = localFetch('/countries', {}, { useCache: false })
      .then(data => { _currentCountryData = (data?.items || []).find(c => c._id === _currentCountryId) || null; })
      .catch(() => { _currentCountryData = null; });

    await Promise.all([countryDataPromise, loadElectionsHistory()]);
    startTicker();
    initPanelSystem();
  });

  /* Re-render charts when a collapsed panel is opened */
  document.querySelectorAll('details.panel').forEach(details => {
    details.addEventListener('toggle', function () {
      if (!this.open) return;
      [
        ['seatsChart', _seatsChart],
        ['membersChart', _membersChart],
        ['allPartiesChart', _allPartiesChart],
        ['timelineChart', _timelineChart],
        ['votesChart', window._votesChart],
      ].forEach(([id, chart]) => {
        if (this.querySelector(`#${id}`) && chart) chart.update();
      });
    });
  });

  /* Country change */
  document.getElementById('countrySelect').addEventListener('change', async function () {
    const newCountryId = this.value;
    localStorage.setItem('preferredCountryId', newCountryId);
    if (newCountryId === _currentCountryId) return;

    _currentCountryId = newCountryId;
    _electionHistory = [];
    _currentCongressElectionId = null;
    _partyColorMap.clear();
    _partyNamesMap.clear();
     document.getElementById('candidatesContainer').style.display = 'none';

    try {
      const data = await localFetch('/countries', {}, { useCache: false });
      _currentCountryData = (data?.items || []).find(c => c._id === newCountryId) || null;
    } catch (_) { _currentCountryData = null; }

    setStatus('Loading…', 'loading');
    try {
      await loadPartiesForCountry(_currentCountryId);
      await loadElectionsHistory();
      // Forza il refresh della timeline dopo cambio paese
      if (typeof _timelineChart !== 'undefined' && _timelineChart) {
        _timelineChart.update();
      }
      
      if (window.umami) window.umami.track('country-change', { country: _currentCountryId });
    } catch (err) {
      console.error('Error switching country:', err);
      setStatus('Error loading data', 'error');
    }

    if (document.getElementById('party-view').style.display !== 'none') {
      loadPartiesForSelector();
      _currentPartyId = null;
      localStorage.removeItem('preferredPartyId');
      document.getElementById('partySelect').tomselect?.setValue('');
      loadPartyDetails(null);
    }
  });

  /* Election controls */
  document.getElementById('loadBtn').addEventListener('click', () => loadElection());
  document.getElementById('electionSelect').addEventListener('change', function () {
    if (this.value) loadElection(this.value);
  });

  /* Toolbar buttons */
  document.getElementById('exportCsvBtn')?.addEventListener('click', () => exportCSV(window._lastElectedParties));
  document.getElementById('fullscreenBtn')?.addEventListener('click', openParliamentFullscreen);
  document.getElementById('overlayClose')?.addEventListener('click', closeParliamentFullscreen);
  document.getElementById('parliamentOverlay')?.addEventListener('click', e => {
    if (e.target === document.getElementById('parliamentOverlay')) closeParliamentFullscreen();
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeParliamentFullscreen(); });

  /* Simulators */
  document.getElementById('simExpectedVotersInput')?.addEventListener('input', onExpectedVotersChange);
  document.getElementById('simSeatsInput')?.addEventListener('input', onSimSeatsChange);
  document.getElementById('presSimVoters')?.addEventListener('input', onPresSimInput);

  /* Back to elections */
  document.getElementById('backToElectionsBtn')?.addEventListener('click', () => {
    document.getElementById('party-view').style.display = 'none';
    document.getElementById('congress-view').style.display = '';
    if (_currentCongressElectionId) loadElection(_currentCongressElectionId);
  });

  /* Clear cache */
  document.getElementById('clearCacheBtn')?.addEventListener('click', () => {
    cacheClear();
    setStatus(t('cache_cleared'), '');
    setTimeout(() => setStatus('', ''), 2000);
  });
});

/* Re-render whatever dynamic view is currently visible whenever the
   language changes, so already-loaded content updates immediately
   instead of only the next time it's reloaded. */
document.addEventListener('langchange', () => {
  if (document.getElementById('senateOverlay')?.classList.contains('active')) {
    SenateView.render(window._lastElectedParties || []);
  }
  if (document.getElementById('party-view')?.style.display !== 'none' && _currentPartyId) {
    loadPartyDetails(_currentPartyId);
  }
  if (document.getElementById('congress-view')?.style.display !== 'none' && _currentCongressElectionId) {
    loadElection(_currentCongressElectionId);
  } else if (document.getElementById('president-view')?.style.display !== 'none' && window._lastPresData?.election) {
    loadPresidentialElection(window._lastPresData.election, _currentIsLatestPresidential);
  }
});
