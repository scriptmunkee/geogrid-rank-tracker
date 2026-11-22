/* GeoGrid Rank Tracker UI */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 1) => (n == null || Number.isNaN(n) ? '–' : Number(n).toFixed(d).replace(/\.0+$/, ''));
  const engineName = (id) => (id === 'google_search' ? 'Google Search' : 'Google Maps');

  const state = {
    config: null,
    centre: null,
    target: null,
    scanId: null,
    scan: null,
    poll: null,
    previewLayer: null,
    scanLayer: null,
    centreMarker: null,
    targetMarker: null,
    pw: '',
    armed: false,
    armTimer: null,
    layer: 'rank',
    focus: null, // competitor key whose ranks are shown on the map
    tab: 'overview',
    selected: null, // selected point index
  };

  // ---------- Auth + API ----------
  const storage = {
    get() { try { return localStorage.getItem('geogrid-pw') || ''; } catch { return state.pw || ''; } },
    set(v) { state.pw = v; try { localStorage.setItem('geogrid-pw', v); } catch {} },
    clear() { state.pw = ''; try { localStorage.removeItem('geogrid-pw'); } catch {} },
  };

  const api = async (path, opts = {}) => {
    const headers = { 'Content-Type': 'application/json' };
    const pw = storage.get();
    if (pw) headers.Authorization = `Bearer ${pw}`;
    const res = await fetch(path, { ...opts, headers });
    const body = await res.json().catch(() => ({}));
    if (res.status === 401) {
      showLogin();
      throw new Error('Password required');
    }
    if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
    return body;
  };

  function showLogin(msg) {
    $('login').hidden = false;
    $('loginError').hidden = !msg;
    $('loginError').textContent = msg || '';
    $('loginPw').focus();
  }

  $('loginForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    storage.set($('loginPw').value);
    try {
      await api('/api/auth-check');
      $('login').hidden = true;
      $('loginPw').value = '';
      showError('');
      previewGrid();
      loadHistory();
    } catch {
      storage.clear();
      showLogin('That password did not work');
    }
  });

  // ---------- Map ----------
  const map = L.map('map', { zoomControl: true });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);

  const RANK_COLOURS = { top3: '#16a34a', mid: '#f59e0b', low: '#ef4444', none: '#a3aab8' };
  function rankColour(rank) {
    if (rank == null) return RANK_COLOURS.none;
    if (rank <= 3) return RANK_COLOURS.top3;
    if (rank <= 10) return RANK_COLOURS.mid;
    return RANK_COLOURS.low;
  }
  const AI_COLOURS = { 1: '#16a34a', 2: '#65a30d', 3: '#65a30d', more: '#f59e0b', notNamed: '#ef4444', none: '#cbd2dc' };
  const AREA_COLOURS = ['#f1f5fb', '#e2eaf6', '#d0dcf0', '#bccde9', '#a6bde2', '#8eaada', '#7597d0', '#5c82c4', '#456eb6', '#2f5aa6'];

  function setCentre(lat, lng, pan = true) {
    state.centre = { lat: +lat.toFixed(7), lng: +lng.toFixed(7) };
    if (!state.centreMarker) {
      state.centreMarker = L.circleMarker([lat, lng], { radius: 5, color: '#2459e0', weight: 2, fillColor: '#fff', fillOpacity: 1 }).addTo(map);
    } else state.centreMarker.setLatLng([lat, lng]);
    if (pan) map.panTo([lat, lng]);
    previewGrid();
  }

  map.on('click', (e) => {
    if (state.scanId) clearScanView();
    setCentre(e.latlng.lat, e.latlng.lng, false);
  });

  async function previewGrid() {
    if (!state.centre || state.scanId) return;
    const body = { ...state.centre, size: +$('size').value, spacing: +$('spacing').value, unit: $('unit').value };
    try {
      const { points } = await api('/api/grid-preview', { method: 'POST', body: JSON.stringify(body) });
      if (state.previewLayer) state.previewLayer.remove();
      if (state.scanId) return;
      state.previewLayer = L.layerGroup(
        points.map((p) => L.circleMarker([p.lat, p.lng], { radius: 6, color: '#2459e0', weight: 1.5, fillColor: '#eaf0ff', fillOpacity: 0.9 })),
      ).addTo(map);
      map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng])).pad(0.15));
      updateEstimate(points.length);
    } catch (err) {
      if (err.message !== 'Password required') showError(err.message);
    }
  }

  // ---------- Form ----------
  const engineId = () => document.querySelector('input[name="engine"]:checked').value;

  function costPerPoint() {
    const e = state.config.engines.find((x) => x.id === engineId());
    if (!e) return 0;
    if (e.id !== 'google_search') return e.costs.base;
    let c = e.costs.base;
    if ($('optAio').checked) c += e.costs.aio;
    if ($('optFinder').checked) c += $('device').value === 'mobile' ? e.costs.finderMobile : e.costs.finderDesktop;
    return c;
  }

  function updateEstimate(n = Number($('size').value) ** 2) {
    const demo = $('demo').checked;
    const per = costPerPoint();
    $('estimate').innerHTML = demo
      ? `<b>${n} points</b> · demo mode, no API cost`
      : `<b>${n} points</b> · est. <b>$${(n * per).toFixed(3)}</b> ($${per.toFixed(3)} a point, ${engineName(engineId())})`;
    validateForm();
  }

  function onEngineChange() {
    const isSearch = engineId() === 'google_search';
    $('searchOpts').hidden = !isSearch;
    $('device').value = isSearch ? 'mobile' : 'desktop';
    disarm();
    updateEstimate();
  }
  document.querySelectorAll('input[name="engine"]').forEach((r) => r.addEventListener('change', onEngineChange));
  ['optAio', 'optFinder', 'device'].forEach((id) => $(id).addEventListener('change', () => { disarm(); updateEstimate(); }));

  function disarm() {
    state.armed = false;
    clearTimeout(state.armTimer);
    $('runBtn').textContent = 'Run scan';
    $('runBtn').classList.remove('armed');
  }

  function validateForm() {
    $('runBtn').disabled = Boolean(state.starting) || !(state.target && $('keyword').value.trim() && state.centre);
  }

  function showError(msg) {
    $('formError').textContent = msg;
    $('formError').hidden = !msg;
  }

  $('bizForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('bizQuery').value.trim();
    if (!q) return;
    showError('');
    $('bizResults').innerHTML = '<li>Searching…</li>';
    const c = map.getCenter();
    const qs = new URLSearchParams({ q, lat: c.lat.toFixed(6), lng: c.lng.toFixed(6), demo: $('demo').checked ? '1' : '0' });
    try {
      const { results } = await api(`/api/business-search?${qs}`);
      if (!results.length) {
        $('bizResults').innerHTML = '<li>No listings found. Try adding the town.</li>';
        return;
      }
      $('bizResults').innerHTML = results
        .map((r, i) => `<li data-i="${i}">${esc(r.title)}<small>${esc(r.category || '')}${r.rating ? ` · ★ ${r.rating} (${r.votes})` : ''}<br>${esc(r.address || '')}</small></li>`)
        .join('');
      [...$('bizResults').children].forEach((li) => li.addEventListener('click', () => pickBusiness(results[+li.dataset.i])));
    } catch (err) {
      $('bizResults').innerHTML = '';
      showError(err.message);
    }
  });

  function pickBusiness(b) {
    state.target = b;
    $('bizResults').innerHTML = '';
    $('bizSelected').hidden = false;
    $('bizSelected').innerHTML = `<strong>${esc(b.title)}</strong><small>${esc(b.address || '')}</small><small>CID ${esc(b.cid || 'n/a')}${b.domain ? ` · ${esc(b.domain)}` : ''}</small><button type="button" id="bizClear">Change</button>`;
    $('bizClear').addEventListener('click', () => {
      state.target = null;
      $('bizSelected').hidden = true;
      validateForm();
    });
    if (b.lat != null && b.lng != null) {
      if (state.scanId) clearScanView();
      setCentre(b.lat, b.lng);
      drawTargetMarker(b);
    }
    validateForm();
  }

  function drawTargetMarker(t) {
    if (state.targetMarker) state.targetMarker.remove();
    if (!t || t.lat == null) return;
    state.targetMarker = L.marker([t.lat, t.lng], {
      icon: L.divIcon({ className: '', html: '<div class="target-pin">★</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 1000,
    }).bindTooltip(esc(t.title)).addTo(map);
  }

  ['size', 'spacing', 'unit'].forEach((id) => $(id).addEventListener('change', () => { if (state.scanId) clearScanView(); previewGrid(); }));
  $('demo').addEventListener('change', () => updateEstimate());
  $('keyword').addEventListener('input', validateForm);
  ['keyword', 'size', 'spacing', 'unit', 'zoom', 'demo'].forEach((id) => $(id).addEventListener('input', disarm));

  $('runBtn').addEventListener('click', async () => {
    showError('');
    const body = {
      engine: engineId(),
      options: { aio: $('optAio').checked, finder: $('optFinder').checked },
      keyword: $('keyword').value.trim(),
      target: state.target,
      lat: state.centre.lat,
      lng: state.centre.lng,
      size: +$('size').value,
      spacing: +$('spacing').value,
      unit: $('unit').value,
      zoom: +$('zoom').value,
      device: $('device').value,
      demo: $('demo').checked,
    };
    // Live scans spend credit: first click arms the button, second click runs it.
    if (!body.demo && !state.armed) {
      const n = body.size * body.size;
      state.armed = true;
      $('runBtn').textContent = `Confirm: run ${n} live points (~$${(n * costPerPoint()).toFixed(3)})`;
      $('runBtn').classList.add('armed');
      clearTimeout(state.armTimer);
      state.armTimer = setTimeout(disarm, 10000);
      return;
    }
    if (state.starting) return;
    disarm();
    state.starting = true;
    $('runBtn').disabled = true;
    $('runBtn').textContent = 'Starting scan…';
    try {
      const { id } = await api('/api/scans', { method: 'POST', body: JSON.stringify(body) });
      $('runBtn').textContent = 'Scan started';
      await openScan(id);
      loadHistory();
    } catch (err) {
      showError(err.message);
    } finally {
      // Short cool-down so a double click can't start the same scan twice
      setTimeout(() => {
        state.starting = false;
        $('runBtn').textContent = 'Run scan';
        validateForm();
      }, 4000);
    }
  });

  // ---------- History ----------
  async function loadHistory() {
    const { scans } = await api('/api/scans');
    $('history').innerHTML = scans.length
      ? scans
          .map((s) => {
            const when = new Date(s.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const score = s.summary ? `SoLV ${fmt(s.summary.solv, 0)}% · ATRP ${fmt(s.summary.atrp)}` : esc(s.status);
            const tag = s.engine === 'google_search' ? '<span class="tag search">SEARCH</span>' : '<span class="tag maps">MAPS</span>';
            return `<li data-id="${s.id}" class="${s.id === state.scanId ? 'active' : ''}">${esc(s.keyword)} ${tag}${s.demo ? '<span class="tag">DEMO</span>' : ''}<small>${esc(s.business || '')} · ${s.gridSize}x${s.gridSize}</small><small>${when} · ${score}</small></li>`;
          })
          .join('')
      : '<li style="cursor:default"><small>No scans yet.</small></li>';
    [...$('history').querySelectorAll('li[data-id]')].forEach((li) => li.addEventListener('click', () => openScan(li.dataset.id)));
  }

  function clearScanView() {
    state.scanId = null;
    state.scan = null;
    state.focus = null;
    state.selected = null;
    clearInterval(state.poll);
    if (state.scanLayer) state.scanLayer.remove();
    state.scanLayer = null;
    ['scanHeader', 'metrics', 'insights', 'overviewGrid', 'overviewExtra', 'progress', 'tabs', 'layerBar', 'focusBar'].forEach((id) => ($(id).hidden = true));
    setTab('overview');
    renderLegend('preview');
    [...$('history').children].forEach((li) => li.classList.remove('active'));
  }

  async function openScan(id) {
    clearInterval(state.poll);
    state.scanId = id;
    state.focus = null;
    state.selected = null;
    state.layer = 'rank';
    if (state.previewLayer) { state.previewLayer.remove(); state.previewLayer = null; }
    const scan = await api(`/api/scans/${id}`);
    renderScan(scan, true);
    if (scan.status === 'running') {
      state.poll = setInterval(async () => {
        if (state.scanId !== id) return clearInterval(state.poll);
        const s = await api(`/api/scans/${id}`);
        renderScan(s, false);
        if (s.status !== 'running') { clearInterval(state.poll); loadHistory(); }
      }, 2000);
    }
    [...$('history').children].forEach((li) => li.classList.toggle('active', li.dataset.id === id));
  }

  // ---------- Tabs ----------
  function setTab(tab) {
    state.tab = tab;
    document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    ['overview', 'ai', 'competitors', 'points'].forEach((t) => ($(`tab-${t}`).hidden = t !== tab));
    if (tab === 'overview') setTimeout(() => map.invalidateSize(), 0);
  }
  document.querySelectorAll('#tabs button').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

  // ---------- Scan rendering ----------
  function renderScan(scan, fit) {
    state.scan = scan;
    const g = scan.grid;
    const isSearch = scan.engine === 'google_search';
    const when = new Date(scan.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    $('scanHeader').hidden = false;
    $('scanHeader').innerHTML = `
      <div><h1>${esc(scan.target.title)}</h1>
      <span>${esc(scan.keyword)} · ${engineName(scan.engine)} · ${g.size}x${g.size} at ${g.spacing} ${g.unit} · ${scan.device} · ${when}${scan.demo ? ' · <b class="demo-text">demo data</b>' : ` · est. $${scan.estCost}`}</span></div>
      <div class="header-actions">${scan.report ? '<button class="btn ghost" id="csvComp">Export competitors CSV</button><button class="btn ghost" id="csvPoints">Export points CSV</button>' : ''}</div>`;
    if (scan.report) {
      $('csvComp').onclick = () => exportCompetitors(scan);
      $('csvPoints').onclick = () => exportPoints(scan);
    }

    const running = scan.status === 'running';
    $('progress').hidden = !running;
    if (running) {
      const pct = Math.round((scan.progress.done / scan.progress.total) * 100);
      $('progress').querySelector('.bar').style.width = `${pct}%`;
      $('progress').querySelector('span').textContent = `Scanning ${scan.progress.done} of ${scan.progress.total} points`;
    }
    if (scan.status === 'failed') showError(`Scan failed: ${scan.error || 'unknown error'}`);
    else showError('');

    $('tabs').hidden = !scan.report;
    document.querySelector('#tabs [data-search]').hidden = !isSearch;
    if (!isSearch && state.tab === 'ai') setTab('overview');

    renderLayerBar(scan);
    renderMap(scan, fit);
    drawTargetMarker(scan.target);

    if (scan.report) {
      renderOverview(scan);
      if (isSearch) renderAiTab(scan);
      renderCompetitorsTab(scan);
      renderPointsTab(scan);
    } else {
      ['metrics', 'insights', 'overviewGrid', 'overviewExtra'].forEach((id) => ($(id).hidden = true));
    }
  }

  // ---------- Map layers ----------
  function layersFor(scan) {
    const layers = [['rank', 'Rank']];
    if (scan.engine === 'google_search') {
      if (scan.options && scan.options.aio) layers.push(['ai', 'AI Overview']);
      layers.push(['ads', 'Ads above you']);
    }
    if (scan.report && scan.report.affluence) layers.push(['area', 'Area affluence']);
    return layers;
  }

  function renderLayerBar(scan) {
    const layers = layersFor(scan);
    if (!layers.find(([id]) => id === state.layer)) state.layer = 'rank';
    $('layerBar').hidden = layers.length < 2;
    $('layerBar').innerHTML = layers.map(([id, label]) => `<button data-layer="${id}" class="${id === state.layer ? 'active' : ''}">${label}</button>`).join('');
    $('layerBar').querySelectorAll('button').forEach((b) =>
      b.addEventListener('click', () => {
        state.layer = b.dataset.layer;
        state.focus = null;
        renderLayerBar(state.scan);
        renderMap(state.scan, false);
      }),
    );
    const focusRow = state.focus && scan.report ? scan.report.competitors.find((c) => compKey(c) === state.focus) : null;
    $('focusBar').hidden = !focusRow;
    if (focusRow) {
      $('focusBar').innerHTML = `Showing ranks for <b>${esc(focusRow.title)}</b> <button id="clearFocus">Back to ${esc(scan.target.title)}</button>`;
      $('clearFocus').onclick = () => { state.focus = null; renderLayerBar(state.scan); renderMap(state.scan, false); };
    }
  }

  const compKey = (c) => c.cid || (c.title || '').toLowerCase();
  function listingRankFor(p, key) {
    const l = (p.listings || []).find((x) => (x.cid || (x.title || '').toLowerCase()) === key);
    return l ? l.rank : null;
  }

  function markerFor(p, scan) {
    const running = scan.status === 'running';
    if (running && p.pending) return { cls: 'pin pending', label: '', style: '' };
    if (p.error) return { cls: 'pin err', label: '!', style: '' };
    const layer = state.focus ? 'rank' : state.layer;
    if (layer === 'rank') {
      const rank = state.focus ? listingRankFor(p, state.focus) : p.rank;
      let cls = 'pin';
      if (!state.focus && p.single) cls += ' onebox';
      if (!state.focus && p.ai && p.ai.targetNamed) cls += ' ai-ring';
      return { cls, label: rank == null ? `${scan.depth}+` : rank, style: `background:${rankColour(rank)}` };
    }
    if (layer === 'ai') {
      if (!p.ai || !p.ai.shown) return { cls: 'pin muted', label: '–', style: `background:${AI_COLOURS.none}` };
      if (!p.ai.targetNamed) return { cls: 'pin', label: '✕', style: `background:${AI_COLOURS.notNamed}` };
      const place = p.ai.targetPlace;
      const c = place === 1 ? AI_COLOURS[1] : place <= 3 ? AI_COLOURS[2] : AI_COLOURS.more;
      return { cls: `pin${p.ai.targetCited ? ' cited' : ''}`, label: place, style: `background:${c}` };
    }
    if (layer === 'ads') {
      const n = p.adsAboveYou || 0;
      const shade = n === 0 ? '#16a34a' : n <= 2 ? '#f59e0b' : '#ef4444';
      return { cls: 'pin', label: n, style: `background:${shade}` };
    }
    if (layer === 'area') {
      const d = p.area && p.area.imdDecile;
      if (!d) return { cls: 'pin muted', label: '?', style: 'background:#cbd2dc' };
      return { cls: 'pin', label: d, style: `background:${AREA_COLOURS[d - 1]};color:${d >= 6 ? '#fff' : '#1d2433'}` };
    }
    return { cls: 'pin', label: '', style: '' };
  }

  function renderMap(scan, fit) {
    if (state.scanLayer) state.scanLayer.remove();
    const markers = scan.results.map((p, i) => {
      const m = markerFor(p, scan);
      const icon = L.divIcon({ className: '', html: `<div class="${m.cls}" style="${m.style}">${m.label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
      return L.marker([p.lat, p.lng], { icon }).bindPopup(() => popupHtml(p, i, scan), { maxWidth: 300 });
    });
    state.scanLayer = L.layerGroup(markers).addTo(map);
    if (fit) map.fitBounds(L.latLngBounds(scan.results.map((p) => [p.lat, p.lng])).pad(0.12));
    renderLegend(state.focus ? 'rank' : state.layer, scan);
  }

  function renderLegend(layer, scan) {
    const dot = (c, t) => `<span><i style="background:${c}"></i>${t}</span>`;
    let html = '';
    if (layer === 'preview') html = '<span>Grid preview: click the map to move it</span>';
    else if (layer === 'rank') {
      html = dot(RANK_COLOURS.top3, '1 to 3') + dot(RANK_COLOURS.mid, '4 to 10') + dot(RANK_COLOURS.low, '11 to 20') + dot(RANK_COLOURS.none, 'Not found');
      if (scan && scan.engine === 'google_search' && !state.focus) html += '<span><i class="ring-ai"></i>Named in AI Overview</span><span><i class="ring-onebox"></i>1-Box shown</span>';
    } else if (layer === 'ai') {
      html = dot(AI_COLOURS[1], 'Named 1st') + dot(AI_COLOURS[2], '2nd to 3rd') + dot(AI_COLOURS.more, '4th+') + dot(AI_COLOURS.notNamed, 'Not named') + dot(AI_COLOURS.none, 'No AI Overview') + '<span><i class="ring-cited"></i>Your site cited</span>';
    } else if (layer === 'ads') {
      html = '<span>Ads above you:</span>' + dot('#16a34a', '0') + dot('#f59e0b', '1 to 2') + dot('#ef4444', '3+');
    } else if (layer === 'area') {
      html = `<span>IMD 2025 decile:</span><span class="ramp">${AREA_COLOURS.map((c) => `<i style="background:${c}"></i>`).join('')}</span><span>1 most deprived, 10 least</span>`;
    }
    $('legend').innerHTML = html;
  }

  function popupHtml(p, i, scan) {
    const head = `<h4>${p.error ? 'Error' : p.rank ? `Ranked #${p.rank}` : `Not in top ${scan.depth}`}${p.rankFrom ? ` <small>(${rankFromLabel(p.rankFrom)})</small>` : ''}</h4>`;
    const meta = `<div class="meta">${fmt(p.distFromBusinessKm, 1)} km from the business${p.area && p.area.lsoaName ? ` · ${esc(p.area.lsoaName)}` : ''}</div>`;
    const top = (p.listings || []).slice(0, 5).map((l) => `<li class="${isTarget(l, scan) ? 'hit' : ''}">${esc(l.title)}</li>`).join('');
    return `<div class="popup">${head}${meta}<ol>${top}</ol><button class="link-btn" onclick="window.__geogridOpenPoint(${i})">Full detail for this point →</button></div>`;
  }
  window.__geogridOpenPoint = (i) => {
    map.closePopup();
    state.selected = i;
    renderPointsTab(state.scan);
    setTab('points');
  };

  const rankFromLabel = (r) => ({ pack: 'map pack', single: '1-Box', finder: 'Local Finder' }[r] || r);
  function isTarget(l, scan) {
    const t = scan.target;
    if (t.cid && l.cid) return String(l.cid) === String(t.cid);
    return (l.title || '').toLowerCase() === (t.title || '').toLowerCase();
  }

  // ---------- Overview ----------
  function metricCard(label, value, sub, cls = '') {
    return `<div class="metric ${cls}"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`;
  }

  function solvBand(v) {
    if (v == null) return '';
    if (v >= 60) return '<span class="band good">Strong</span>';
    if (v >= 30) return '<span class="band ok">Fair</span>';
    return '<span class="band weak">Weak</span>';
  }

  function renderOverview(scan) {
    const r = scan.report;
    const s = r.summary;
    const sx = r.search;
    const unit = scan.grid.unit;
    const dist = (km) => (km == null ? '–' : unit === 'mi' ? `${fmt(km / 1.609344, 1)} mi` : `${fmt(km, 1)} km`);

    const cards = [
      metricCard(`Share of local voice ${solvBand(s.solv)}`, `${fmt(s.solv, 0)}%`, `Top 3 at ${s.top3} of ${s.scanned} points, #1 at ${r.distribution.first}`, 'hero'),
      metricCard('Average rank', fmt(s.arp, 1), `Where found (${s.found} of ${s.scanned} points)`),
      metricCard('ATRP', fmt(s.atrp, 1), `All points, not found = ${scan.depth + 1}`),
      metricCard('Winning radius', r.radius.winningKm ? dist(r.radius.winningKm) : 'None', 'Top 3 without a break from the business'),
    ];
    if (sx && sx.ai) cards.push(metricCard('AI Overview', `${sx.ai.namedAt}/${sx.ai.shownAt}`, `Named where shown · avg place ${fmt(sx.ai.avgPlace)}`, 'ai'));
    if (sx) cards.push(metricCard('Ads above you', fmt(sx.ads.avgAdsAboveYou), `Ads at ${sx.ads.pointsWithAds} of ${s.scanned} points`));
    if (r.affluence) {
      const d = r.affluence.weightedSolv - r.affluence.solv;
      cards.push(metricCard('Affluence SoLV', `${fmt(r.affluence.weightedSolv, 0)}%`, `${d >= 0 ? '+' : ''}${fmt(d, 1)} vs SoLV · ${r.affluence.areas} areas`));
    }
    if (sx && sx.organic.found) cards.push(metricCard('Your site, organic', `#${fmt(sx.organic.avgRank)}`, `Average, found at ${sx.organic.found} points`));
    $('metrics').hidden = false;
    $('metrics').innerHTML = cards.join('');

    // Insights
    $('insights').hidden = !r.insights.length;
    $('insights').innerHTML = `<h3>What this scan shows</h3><ul class="insights">${r.insights
      .map((x) => `<li data-layer="${x.layer}"><span class="ik ik-${x.kind}">${insightIcon(x.kind)}</span>${esc(x.text)}</li>`)
      .join('')}</ul><p class="hint">Select one to show it on the map.</p>`;
    $('insights').querySelectorAll('li').forEach((li) =>
      li.addEventListener('click', () => {
        if (layersFor(scan).find(([id]) => id === li.dataset.layer)) state.layer = li.dataset.layer;
        state.focus = null;
        renderLayerBar(scan);
        renderMap(scan, false);
        document.querySelector('.map-card').scrollIntoView({ behavior: 'smooth' });
      }),
    );

    // Distribution + who holds #1
    const d = r.distribution;
    const total = s.scanned || 1;
    const segs = [
      ['#1', d.first, '#15803d'],
      ['#2 to 3', d.top3, '#22c55e'],
      ['#4 to 10', d.top10, '#f59e0b'],
      ['#11+', d.beyond, '#ef4444'],
      ['Not found', d.notFound, '#a3aab8'],
    ];
    const maxFirst = Math.max(1, ...r.holdsFirst.map((h) => h.points));
    $('overviewGrid').hidden = false;
    $('overviewGrid').innerHTML = `
      <div class="card"><h3>Rank distribution</h3>
        <div class="stackbar">${segs.filter(([, v]) => v).map(([l, v, c]) => `<div style="flex:${v};background:${c}" title="${l}: ${v}"></div>`).join('')}</div>
        <div class="dist-legend">${segs.map(([l, v, c]) => `<div><i style="background:${c}"></i>${l}<b>${v}</b></div>`).join('')}</div>
        <h3 style="margin-top:18px">Rank by distance from the business</h3>${distanceChart(r.radius.byDistance, scan)}
      </div>
      <div class="card"><h3>Who holds #1</h3><p class="hint" style="margin:0 0 10px">The business ranked first, point by point.</p>
        <div class="bars">${r.holdsFirst
          .map((h) => `<div class="bar-row ${h.isTarget ? 'you' : ''}"><span class="bar-label">${esc(h.title)}${h.isTarget ? ' <em>you</em>' : ''}</span><span class="bar"><i style="width:${(h.points / maxFirst) * 100}%"></i></span><b>${h.points} of ${total}</b></div>`)
          .join('')}</div>
      </div>`;

    // Search extras
    const extra = [];
    if (sx && sx.singleBusiness.count) {
      extra.push(`<div class="card callout"><h3>Single-business results (1-Box)</h3>
        <p>At <b>${sx.singleBusiness.count} of ${total}</b> points Google showed one business and no map pack: the whole local answer went to one company.</p>
        <table class="mini"><tbody>${sx.singleBusiness.holders.map((h) => `<tr class="${h.isTarget ? 'is-target' : ''}"><td>${esc(h.title)}${h.isTarget ? ' <em>you</em>' : ''}</td><td class="num">${h.points} point${h.points === 1 ? '' : 's'}</td></tr>`).join('')}</tbody></table></div>`);
    }
    if (sx && sx.ads.advertisers.length) {
      const whereLabel = { search: 'Search ads', local_services: 'Local Services', local_finder: 'Local Finder', map_pack: 'Map pack' };
      extra.push(`<div class="card"><h3>Paid pressure</h3><p class="hint" style="margin:0 0 10px">Advertisers across the grid. Ads at ${sx.ads.pointsWithAds} of ${total} points, about ${fmt(sx.ads.avgAdsAboveYou)} above you on average.</p>
        <table class="mini"><thead><tr><th>Advertiser</th><th>Where</th><th class="num">Points</th></tr></thead><tbody>${sx.ads.advertisers
          .map((a) => `<tr class="${a.isTarget ? 'is-target' : ''}"><td>${esc(a.title)}${a.isTarget ? ' <em>you</em>' : ''}</td><td>${a.where.map((w) => `<span class="chip">${whereLabel[w] || w}</span>`).join(' ')}</td><td class="num">${a.points} of ${total}</td></tr>`)
          .join('')}</tbody></table></div>`);
    }
    if (sx && sx.noLocal) extra.push(`<div class="card"><p style="margin:0">At <b>${sx.noLocal}</b> points Google showed no local results at all for this keyword.</p></div>`);
    $('overviewExtra').hidden = !extra.length;
    $('overviewExtra').innerHTML = extra.length ? `<div class="two-col">${extra.join('')}</div>` : '';
  }

  function insightIcon(kind) {
    return { visibility: '#', competitor: 'vs', radius: '◎', affluence: '£', single: '1', ads: 'Ad', ai: 'AI' }[kind] || '•';
  }

  function distanceChart(points, scan) {
    if (!points.length) return '';
    const W = 460;
    const H = 170;
    const pad = { l: 34, r: 26, t: 10, b: 26 };
    const maxKm = Math.max(...points.map((p) => p.km), 0.1);
    const nf = scan.depth + 1;
    const x = (km) => pad.l + (km / maxKm) * (W - pad.l - pad.r);
    const y = (r) => pad.t + ((Math.min(r ?? nf, nf) - 1) / (nf - 1)) * (H - pad.t - pad.b);
    const unit = scan.grid.unit;
    const tickKm = [0, maxKm / 2, maxKm];
    const dots = points.map((p) => `<circle cx="${x(p.km).toFixed(1)}" cy="${y(p.rank).toFixed(1)}" r="4" fill="${rankColour(p.rank)}" fill-opacity="0.85"><title>${fmt(p.km)} km · ${p.rank ? `#${p.rank}` : 'not found'}</title></circle>`).join('');
    const yTicks = [1, 3, 10, nf].map((r) => `<line x1="${pad.l}" x2="${W - pad.r}" y1="${y(r)}" y2="${y(r)}" stroke="#eef1f5"/><text x="${pad.l - 6}" y="${y(r) + 3}" text-anchor="end">${r === nf ? `${scan.depth}+` : `#${r}`}</text>`).join('');
    const xTicks = tickKm.map((k) => `<text x="${x(k)}" y="${H - 6}" text-anchor="middle">${unit === 'mi' ? fmt(k / 1.609344, 1) : fmt(k, 1)} ${unit}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet">${yTicks}${xTicks}${dots}</svg>`;
  }

  // ---------- AI Overview tab ----------
  const CAT_LABEL = { you: 'Your site', competitor: 'Competitor', directory: 'Directory', other: 'Other' };

  function renderAiTab(scan) {
    const sx = scan.report.search;
    const el = $('tab-ai');
    if (!sx || !sx.ai) {
      el.innerHTML = '<div class="card"><p>AI Overview tracking was switched off for this scan.</p></div>';
      return;
    }
    const a = sx.ai;
    const n = scan.report.summary.scanned;
    const maxSrc = Math.max(1, ...a.sources.map((s) => s.points));
    el.innerHTML = `
      <div class="metrics">
        ${metricCard('AI Overview shown', `${a.shownAt}/${n}`, `${fmt(a.triggerRate, 0)}% of points`, 'ai')}
        ${metricCard('You were named', `${a.namedAt}/${a.shownAt}`, `${fmt(a.namedRate, 0)}% of AI Overviews`)}
        ${metricCard('Named first', a.firstAt, `Top 3 at ${a.top3At}`)}
        ${metricCard('Average place', a.avgPlace ? `#${fmt(a.avgPlace)}` : '–', 'Where you were named')}
        ${metricCard('Your site cited', `${a.citedAt}/${a.shownAt}`, `${a.sourceCount} different sources across the grid`)}
      </div>
      <div class="two-col">
        <div class="card"><h3>Websites the AI cited</h3>
          <table class="mini"><thead><tr><th>Website or source</th><th>Type</th><th>Cited at</th></tr></thead><tbody>${a.sources
            .map((s) => `<tr class="${s.category === 'you' ? 'is-target' : ''}"><td>${esc(s.domain)}</td><td><span class="chip cat-${s.category}">${CAT_LABEL[s.category]}</span></td><td><span class="bar small"><i style="width:${(s.points / maxSrc) * 100}%"></i></span> ${s.points} of ${a.shownAt}</td></tr>`)
            .join('') || '<tr><td colspan="3">No sources recorded.</td></tr>'}</tbody></table>
        </div>
        <div class="card"><h3>Businesses the AI named</h3><p class="hint" style="margin:0 0 10px">In order of how often the AI named them. Arrows compare with their position in the local leaderboard.</p>
          <table class="mini"><thead><tr><th>#</th><th>Business</th><th class="num">Named at</th><th class="num">First</th><th class="num">Avg place</th></tr></thead><tbody>${a.named
            .map((r) => `<tr class="${r.isTarget ? 'is-target' : ''}"><td>${r.aiPosition}</td><td>${esc(r.title)}${r.isTarget ? ' <em>you</em>' : ''}<br>${deltaTag(r)}</td><td class="num">${r.points} of ${a.shownAt}</td><td class="num">${r.firstAt}</td><td class="num">#${fmt(r.avgPlace)}</td></tr>`)
            .join('') || '<tr><td colspan="5">No businesses named.</td></tr>'}</tbody></table>
        </div>
      </div>
      <p class="hint">Names are matched against every business seen in the local results, plus bold list items in the AI text. A business named in the AI Overview but never in the local results is flagged "not in local results".</p>`;
  }

  function deltaTag(r) {
    if (r.localPosition == null) return '<span class="chip warn">not in local results</span>';
    if (!r.delta) return '<span class="chip">same as local</span>';
    return r.delta > 0 ? `<span class="chip up">▲ ${r.delta} in AI</span>` : `<span class="chip down">▼ ${-r.delta} in AI</span>`;
  }

  // ---------- Competitors tab ----------
  function renderCompetitorsTab(scan) {
    const r = scan.report;
    const n = r.summary.scanned;
    const hasAi = r.search && r.search.ai;
    const hasAff = Boolean(r.affluence);
    const rows = r.competitors;
    $('tab-competitors').innerHTML = `
      <div class="card"><div class="card-head"><h3>Competitor leaderboard <small>${rows.length} businesses</small></h3><button class="btn ghost" id="csvComp2">Export CSV</button></div>
        <p class="hint" style="margin:0 0 10px">Select a business to see its ranks on the map.</p>
        <div class="table-wrap"><table class="leader"><thead><tr>
          <th>#</th><th>Business</th><th class="num">Top 3 at</th><th class="num">#1 at</th><th class="num">Found at</th><th class="num">Avg rank</th><th class="num">ATRP</th>
          ${hasAff ? '<th class="num">Affluence share</th>' : ''}${hasAi ? '<th class="num">AI named</th><th class="num">AI cited</th>' : ''}<th class="num">Rating</th>
        </tr></thead><tbody>${rows
          .map(
            (c, i) => `<tr class="${c.isTarget ? 'is-target' : ''}" data-key="${esc(compKey(c))}">
              <td>${i + 1}</td>
              <td>${esc(c.title)}${c.isTarget ? ' <em>you</em>' : ''}${c.domain ? `<br><small>${esc(c.domain)}</small>` : ''}</td>
              <td class="num"><span class="bar small"><i style="width:${c.solv}%"></i></span> ${c.top3} · ${fmt(c.solv, 0)}%</td>
              <td class="num">${c.first}</td>
              <td class="num">${c.found} of ${n}</td>
              <td class="num">${fmt(c.arp)}</td>
              <td class="num">${fmt(c.atrp)}</td>
              ${hasAff ? `<td class="num">${fmt(c.affluenceShare, 0)}%</td>` : ''}
              ${hasAi ? `<td class="num">${c.aiNamedAt ?? 0}</td><td class="num">${c.aiCitedAt ?? 0}</td>` : ''}
              <td class="num">${c.rating ? `★ ${c.rating}${c.votes ? ` (${c.votes})` : ''}` : '–'}</td>
            </tr>`,
          )
          .join('')}</tbody></table></div></div>`;
    $('csvComp2').onclick = () => exportCompetitors(scan);
    $('tab-competitors').querySelectorAll('tbody tr').forEach((tr) =>
      tr.addEventListener('click', () => {
        const row = rows.find((c) => compKey(c) === tr.dataset.key);
        state.focus = row && row.isTarget ? null : tr.dataset.key;
        state.layer = 'rank';
        setTab('overview');
        renderLayerBar(scan);
        renderMap(scan, false);
      }),
    );
  }

  // ---------- Points tab ----------
  function renderPointsTab(scan) {
    const size = scan.grid.size;
    const sel = state.selected;
    const squares = scan.results
      .map((p, i) => {
        const m = markerFor(p, scan);
        return `<button class="sq ${i === sel ? 'sel' : ''} ${m.cls.replace('pin', '')}" style="${m.style}" data-i="${i}" title="Row ${p.row + 1}, column ${p.col + 1}">${m.label}</button>`;
      })
      .join('');
    $('tab-points').innerHTML = `
      <div class="points-layout">
        <div class="card"><h3>Grid</h3><p class="hint" style="margin:0 0 10px">North at the top. ${focusName(scan) ? `Showing ranks for <b>${esc(focusName(scan))}</b>, as selected in Competitors.` : `Colours follow the map layer (${esc(state.layer)}).`}</p>
          <div class="sq-grid" style="grid-template-columns:repeat(${size}, 1fr)">${squares}</div></div>
        <div class="card point-detail">${sel == null ? '<p class="hint">Choose a square, or a pin on the map, to see exactly what was found at that spot.</p>' : pointDetail(scan.results[sel], scan)}</div>
      </div>`;
    $('tab-points').querySelectorAll('.sq').forEach((b) =>
      b.addEventListener('click', () => {
        state.selected = +b.dataset.i;
        renderPointsTab(scan);
      }),
    );
  }

  function focusName(scan) {
    if (!state.focus || !scan.report) return null;
    const row = scan.report.competitors.find((c) => compKey(c) === state.focus);
    return row ? row.title : null;
  }

  function mdLite(md) {
    const clean = String(md || '')
      .replace(/\[\[\d+\]\]\([^)]*\)/g, '')
      .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/`/g, '')
      .replace(/^#{1,6}\s*(.*)$/gm, '**$1**');
    const lines = esc(clean).split('\n');
    let html = '';
    let inList = false;
    for (const raw of lines) {
      const line = raw.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
      const li = line.match(/^\s*(?:[*\-•]|\d+\.)\s+(.*)$/);
      if (li) {
        if (!inList) { html += '<ul>'; inList = true; }
        html += `<li>${li[1]}</li>`;
      } else {
        if (inList) { html += '</ul>'; inList = false; }
        if (line.trim()) html += `<p>${line}</p>`;
      }
    }
    if (inList) html += '</ul>';
    return html;
  }

  function pointDetail(p, scan) {
    const parts = [];
    parts.push(`<h3>Row ${p.row + 1}, column ${p.col + 1}</h3>
      <div class="kv">
        <div><span>Rank</span><b>${p.error ? 'Error' : p.rank ? `#${p.rank}` : `Not in top ${scan.depth}`}</b>${p.rankFrom ? `<small>${rankFromLabel(p.rankFrom)}</small>` : ''}</div>
        <div><span>From the business</span><b>${fmt(p.distFromBusinessKm, 1)} km</b>${p.distanceKm != null ? `<small>Google showed ${fmt(p.distanceKm, 1)} km</small>` : ''}</div>
        ${p.finderRank != null ? `<div><span>Local Finder</span><b>#${p.finderRank}</b></div>` : ''}
        ${p.organicRank != null ? `<div><span>Your site, organic</span><b>#${p.organicRank}</b></div>` : ''}
        ${p.adsAboveYou != null ? `<div><span>Ads above you</span><b>${p.adsAboveYou}</b></div>` : ''}
        ${p.area ? `<div><span>Area</span><b>${esc(p.area.postcode || '')}</b><small>${esc(p.area.lsoaName || '')}${p.area.imdDecile ? ` · IMD decile ${p.area.imdDecile}` : ''}</small></div>` : ''}
      </div>
      <p class="meta">${p.lat}, ${p.lng}</p>`);
    if (p.error) parts.push(`<p class="error">${esc(p.error)}</p>`);
    if (p.single) parts.push(`<div class="callout small">Google showed a single business here: <b>${esc(p.single.title)}</b>${p.single.isTarget ? ' (you)' : ''}.</div>`);
    if (p.noLocal) parts.push('<div class="callout small">No local results were shown here.</div>');

    if ((p.listings || []).length) {
      parts.push(`<h4>${scan.engine === 'google_search' ? 'Map pack, then Local Finder' : 'Google Maps results'}</h4><ol class="listing">${p.listings
        .map((l) => `<li class="${isTarget(l, scan) ? 'hit' : ''}">${esc(l.title)}${l.rating ? ` <small>★ ${l.rating}</small>` : ''}${l.distanceKm != null ? ` <small>${fmt(l.distanceKm, 1)} km</small>` : ''}</li>`)
        .join('')}</ol>`);
    }
    if (p.ai) {
      if (!p.ai.shown) parts.push('<h4>AI Overview</h4><p class="hint">No AI Overview at this point.</p>');
      else {
        parts.push(`<h4>AI Overview ${p.ai.targetNamed ? `<span class="chip up">you are named #${p.ai.targetPlace}</span>` : '<span class="chip down">you are not named</span>'} ${p.ai.targetCited ? '<span class="chip cat-you">your site cited</span>' : ''}</h4>
          ${p.ai.named.length ? `<p class="hint">Named in order: ${p.ai.named.map((x) => esc(x)).join(' → ')}</p>` : ''}
          <div class="aio-text">${mdLite((p.aio && p.aio.markdown) || '')}</div>
          ${p.ai.sources.length ? `<p class="hint">Sources: ${p.ai.sources.map((d) => `<span class="chip">${esc(d)}</span>`).join(' ')}</p>` : ''}`);
      }
    }
    if ((p.ads || []).length) {
      parts.push(`<h4>Ads at this point</h4><ul class="plain">${p.ads.map((a) => `<li>${esc(a.title || a.domain)} <span class="chip">${esc(String(a.where).replace('_', ' '))}</span></li>`).join('')}</ul>`);
    }
    return parts.join('');
  }

  // ---------- CSV ----------
  function download(name, rows) {
    const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  const slug = (scan) => `${scan.keyword}-${scan.grid.size}x${scan.grid.size}-${scan.createdAt.slice(0, 10)}`.replace(/[^a-z0-9-]+/gi, '-');

  function exportCompetitors(scan) {
    const head = ['Rank', 'Business', 'Domain', 'Is you', 'Top 3 at', 'SoLV %', '#1 at', 'Found at', 'Avg rank', 'ATRP', 'Affluence share %', 'AI named at', 'AI cited at', 'Rating', 'Reviews'];
    download(`competitors-${slug(scan)}.csv`, [
      head,
      ...scan.report.competitors.map((c, i) => [i + 1, c.title, c.domain, c.isTarget ? 'yes' : '', c.top3, c.solv, c.first, c.found, c.arp, c.atrp, c.affluenceShare, c.aiNamedAt, c.aiCitedAt, c.rating, c.votes]),
    ]);
  }

  function exportPoints(scan) {
    const head = ['Row', 'Col', 'Lat', 'Lng', 'Km from business', 'Rank', 'Rank from', 'Local Finder rank', '1-Box holder', 'Ads above you', 'AI Overview', 'AI named you', 'AI place', 'Your site cited', 'AI sources', 'Top 3', 'Postcode', 'LSOA', 'IMD decile', 'Error'];
    download(`points-${slug(scan)}.csv`, [
      head,
      ...scan.results.map((p) => [
        p.row + 1, p.col + 1, p.lat, p.lng, p.distFromBusinessKm, p.rank, p.rankFrom, p.finderRank, p.single ? p.single.title : '', p.adsAboveYou,
        p.ai ? (p.ai.shown ? 'yes' : 'no') : '', p.ai && p.ai.shown ? (p.ai.targetNamed ? 'yes' : 'no') : '', p.ai ? p.ai.targetPlace : '', p.ai && p.ai.shown ? (p.ai.targetCited ? 'yes' : 'no') : '',
        p.ai && p.ai.sources ? p.ai.sources.join(' | ') : '', (p.listings || []).slice(0, 3).map((l) => l.title).join(' | '),
        p.area ? p.area.postcode : '', p.area ? p.area.lsoaName : '', p.area ? p.area.imdDecile : '', p.error,
      ]),
    ]);
  }

  // ---------- Boot ----------
  (async () => {
    state.config = await api('/api/config');
    const badge = $('modeBadge');
    const c = state.config;
    if (c.live) {
      badge.textContent = 'Live · DataForSEO connected';
      badge.className = 'badge live';
    } else {
      badge.textContent = !c.hasCredentials ? 'Demo mode · DataForSEO keys not set' : 'Demo mode · set APP_PASSWORD to enable live scans';
      badge.className = 'badge demo';
      $('demo').checked = true;
      $('demo').disabled = true;
    }
    const d = c.defaults;
    map.setView([d.lat, d.lng], 12);
    renderLegend('preview');
    setCentre(d.lat, d.lng);
    if (c.authRequired && !storage.get()) showLogin();
    else loadHistory().catch(() => {});
  })().catch((err) => showError(err.message));
})();
