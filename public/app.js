/* GeoGrid Rank Tracker UI */
(() => {
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmt = (n, d = 1) => (n == null ? '–' : Number(n).toFixed(d).replace(/\.0+$/, ''));

  const state = {
    config: null,
    centre: null,
    target: null,
    scanId: null,
    poll: null,
    previewLayer: null,
    scanLayer: null,
    pw: '',
    armed: false,
    armTimer: null,
    centreMarker: null,
    targetMarker: null,
  };

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
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  function colourFor(rank) {
    if (rank == null) return 'var(--nf)';
    if (rank <= 3) return 'var(--r1)';
    if (rank <= 10) return 'var(--r2)';
    return 'var(--r3)';
  }

  function pinIcon(point, depth) {
    let cls = 'pin';
    let label = '';
    let style = '';
    if (point.pending) cls += ' pending';
    else if (point.error) { cls += ' err'; label = '!'; }
    else { style = `background:${colourFor(point.rank)}`; label = point.rank == null ? `${depth}+` : point.rank; }
    return L.divIcon({ className: '', html: `<div class="${cls}" style="${style}">${label}</div>`, iconSize: [30, 30], iconAnchor: [15, 15] });
  }

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
    if (!state.centre) return;
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
      showError(err.message);
    }
  }

  function updateEstimate(n) {
    const engine = state.config.engines[0];
    const demo = $('demo').checked;
    $('estimate').innerHTML = demo
      ? `<b>${n} points</b> · demo mode, no API cost`
      : `<b>${n} points</b> · est. <b>$${(n * engine.costPerPoint).toFixed(3)}</b> (Live Maps SERP)`;
    validateForm();
  }

  function disarm() {
    state.armed = false;
    clearTimeout(state.armTimer);
    $('runBtn').textContent = 'Run scan';
    $('runBtn').classList.remove('armed');
  }

  function validateForm() {
    $('runBtn').disabled = !(state.target && $('keyword').value.trim() && state.centre);
  }

  function showError(msg) {
    $('formError').textContent = msg;
    $('formError').hidden = !msg;
  }

  // ---------- Business picker ----------
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
    $('bizSelected').innerHTML = `<strong>${esc(b.title)}</strong><small>${esc(b.address || '')}</small><small>CID ${esc(b.cid || 'n/a')}</small><button type="button" id="bizClear">Change</button>`;
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
    if (t.lat == null) return;
    state.targetMarker = L.marker([t.lat, t.lng], {
      icon: L.divIcon({ className: '', html: '<div class="target-pin">★</div>', iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 1000,
    }).bindTooltip(esc(t.title)).addTo(map);
  }

  ['size', 'spacing', 'unit'].forEach((id) => $(id).addEventListener('change', () => { if (state.scanId) clearScanView(); previewGrid(); }));
  $('demo').addEventListener('change', previewGrid);
  $('keyword').addEventListener('input', validateForm);
  ['keyword', 'size', 'spacing', 'unit', 'zoom', 'device', 'demo'].forEach((id) => $(id).addEventListener('input', disarm));

  // ---------- Scans ----------
  $('runBtn').addEventListener('click', async () => {
    showError('');
    const body = {
      engine: 'google_maps',
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
    // (In-page confirm rather than window.confirm, which some embedded browsers block.)
    if (!body.demo && !state.armed) {
      const n = body.size * body.size;
      const cost = (n * state.config.engines[0].costPerPoint).toFixed(3);
      state.armed = true;
      $('runBtn').textContent = `Confirm: run ${n} live searches (~$${cost})`;
      $('runBtn').classList.add('armed');
      clearTimeout(state.armTimer);
      state.armTimer = setTimeout(disarm, 10000);
      return;
    }
    disarm();
    $('runBtn').disabled = true;
    try {
      const { id } = await api('/api/scans', { method: 'POST', body: JSON.stringify(body) });
      await openScan(id);
      loadHistory();
    } catch (err) {
      showError(err.message);
    } finally {
      validateForm();
    }
  });

  async function loadHistory() {
    const { scans } = await api('/api/scans');
    $('history').innerHTML = scans.length
      ? scans
          .map((s) => {
            const when = new Date(s.createdAt).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
            const score = s.summary ? `ATRP ${fmt(s.summary.atrp)} · SoLV ${fmt(s.summary.solv, 0)}%` : esc(s.status);
            return `<li data-id="${s.id}" class="${s.id === state.scanId ? 'active' : ''}">${esc(s.keyword)}${s.demo ? '<span class="tag">DEMO</span>' : ''}<small>${esc(s.business || '')} · ${s.gridSize}x${s.gridSize}</small><small>${when} · ${score}</small></li>`;
          })
          .join('')
      : '<li style="cursor:default"><small>No scans yet.</small></li>';
    [...$('history').querySelectorAll('li[data-id]')].forEach((li) => li.addEventListener('click', () => openScan(li.dataset.id)));
  }

  function clearScanView() {
    state.scanId = null;
    clearInterval(state.poll);
    if (state.scanLayer) state.scanLayer.remove();
    state.scanLayer = null;
    ['scanHeader', 'metrics', 'compWrap', 'progress'].forEach((id) => ($(id).hidden = true));
    [...$('history').children].forEach((li) => li.classList.remove('active'));
  }

  async function openScan(id) {
    clearInterval(state.poll);
    state.scanId = id;
    if (state.previewLayer) { state.previewLayer.remove(); state.previewLayer = null; }
    const scan = await api(`/api/scans/${id}`);
    renderScan(scan, true);
    if (scan.status === 'running') {
      state.poll = setInterval(async () => {
        if (state.scanId !== id) return clearInterval(state.poll);
        const s = await api(`/api/scans/${id}`);
        renderScan(s, false);
        if (s.status !== 'running') { clearInterval(state.poll); loadHistory(); }
      }, 1500);
    }
    [...$('history').children].forEach((li) => li.classList.toggle('active', li.dataset.id === id));
  }

  function renderScan(scan, fit) {
    const g = scan.grid;
    $('scanHeader').hidden = false;
    $('scanHeader').innerHTML = `<h1>${esc(scan.keyword)}</h1><span>${esc(scan.target.title)} · ${g.size}x${g.size} grid · ${g.spacing} ${g.unit} spacing · zoom ${g.zoom} · ${scan.device}${scan.demo ? ' · <b style="color:#b45309">demo data</b>' : ` · est. $${scan.estCost}`}</span>`;

    const running = scan.status === 'running';
    $('progress').hidden = !running;
    if (running) {
      const pct = Math.round((scan.progress.done / scan.progress.total) * 100);
      $('progress').querySelector('.bar').style.width = `${pct}%`;
      $('progress').querySelector('span').textContent = `Scanning ${scan.progress.done} of ${scan.progress.total} points`;
    }

    if (state.scanLayer) state.scanLayer.remove();
    const markers = scan.results.map((p) => {
      const pending = running && p.pending;
      return L.marker([p.lat, p.lng], { icon: pinIcon({ ...p, pending }, scan.depth) }).bindPopup(() => popupHtml(p, scan), { maxWidth: 300 });
    });
    state.scanLayer = L.layerGroup(markers).addTo(map);
    drawTargetMarker(scan.target);
    if (fit) map.fitBounds(L.latLngBounds(scan.results.map((p) => [p.lat, p.lng])).pad(0.12));

    if (scan.status === 'failed') {
      showError(`Scan failed: ${scan.error || 'unknown error'}`);
    }
    if (scan.summary) renderMetrics(scan);
    else { $('metrics').hidden = true; $('compWrap').hidden = true; }
  }

  function popupHtml(p, scan) {
    if (p.error) return `<div class="popup"><h4>Point ${p.row + 1},${p.col + 1}</h4><div class="meta">Error: ${esc(p.error)}</div></div>`;
    const list = p.listings
      .map((l) => {
        const hit = l.cid && scan.target.cid ? l.cid === scan.target.cid : l.title === scan.target.title;
        return `<li class="${hit ? 'hit' : ''}">${esc(l.title)}${l.rating ? ` <span style="color:#667085">★ ${l.rating}</span>` : ''}</li>`;
      })
      .join('');
    return `<div class="popup"><h4>${p.rank ? `Ranked #${p.rank}` : `Not in top ${scan.depth}`}</h4><div class="meta">${p.lat}, ${p.lng} · ${p.distanceKm} km from centre</div><ol>${list || '<li>No results</li>'}</ol></div>`;
  }

  function renderMetrics(scan) {
    const s = scan.summary;
    $('metrics').hidden = false;
    $('metrics').innerHTML = [
      ['ATRP', fmt(s.atrp, 2), `Average across all points (not found = ${scan.depth + 1})`],
      ['ARP', fmt(s.arp, 2), 'Average where it appears'],
      ['SoLV', `${fmt(s.solv, 0)}%`, `${s.top3} of ${s.scanned} points in the top 3`],
      ['Found', `${s.found}/${s.scanned}`, `Points in the top ${scan.depth}`],
      ['Errors', s.errors, s.errors ? 'Points that failed' : 'All points returned'],
    ]
      .map(([label, value, sub]) => `<div class="metric"><div class="label">${label}</div><div class="value">${value}</div><div class="sub">${sub}</div></div>`)
      .join('');

    $('compWrap').hidden = false;
    $('compTable').innerHTML =
      '<thead><tr><th>#</th><th>Business</th><th>Category</th><th class="num">Rating</th><th class="num">Found</th><th class="num">ARP</th><th class="num">ATRP</th><th>SoLV</th></tr></thead><tbody>' +
      scan.competitors
        .map(
          (c, i) => `<tr class="${c.isTarget ? 'is-target' : ''}"><td>${i + 1}</td><td>${esc(c.title)}${c.domain ? `<br><small style="color:#667085">${esc(c.domain)}</small>` : ''}</td><td>${esc(c.category || '')}</td><td class="num">${c.rating ? `${c.rating} (${c.votes})` : '–'}</td><td class="num">${c.found}/${s.scanned}</td><td class="num">${fmt(c.arp, 2)}</td><td class="num">${fmt(c.atrp, 2)}</td><td><span class="solv-bar" style="width:${Math.max(2, c.solv * 0.6)}px"></span>${fmt(c.solv, 0)}%</td></tr>`,
        )
        .join('') +
      '</tbody>';
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
      badge.textContent = !c.hasCredentials
        ? 'Demo mode · DataForSEO keys not set'
        : 'Demo mode · set APP_PASSWORD to enable live scans';
      badge.className = 'badge demo';
      $('demo').checked = true;
      $('demo').disabled = true;
    }
    const d = state.config.defaults;
    map.setView([d.lat, d.lng], 12);
    setCentre(d.lat, d.lng);
    if (c.authRequired && !storage.get()) showLogin();
    else loadHistory().catch(() => {});
  })().catch((err) => showError(err.message));
})();
