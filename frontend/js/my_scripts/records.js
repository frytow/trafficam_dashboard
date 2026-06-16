// ─── Records page ────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {

  const IP = "192.168.100.6";

  // ── DOM refs ────────────────────────────────────────────
  const nodeSelect      = document.getElementById('recNodeSelect');
  const recSelect       = document.getElementById('recRecordingSelect');
  const recNodeName     = document.getElementById('rec-node-name');
  const recVideoWrap    = document.getElementById('recVideoWrap');
  const recEmpty        = document.getElementById('recEmpty');
  const recStatusDot    = document.getElementById('recStatusDot');
  const recStatusLabel  = document.getElementById('recStatusLabel');
  const recDateLabel    = document.getElementById('recDateLabel');
  const recDurLabel     = document.getElementById('recDurLabel');
  const recNodeIdLabel  = document.getElementById('recNodeIdLabel');
  const recIncBanner    = document.getElementById('recIncidentBanner');
  const recIncText      = document.getElementById('recIncidentText');
  const recEventGrid    = document.getElementById('recEventGrid');

  // ── Clock ────────────────────────────────────────────────
  function tick() {
    const el = document.getElementById('live-clock');
    if (el) el.textContent = new Date().toTimeString().split(' ')[0];
  }
  tick(); setInterval(tick, 1000);

  // ── Chart instances ──────────────────────────────────────
  const charts = {};

  // ── Demo data ────────────────────────────────────────────
  // In production replace these with real API calls.

  const DEMO_NODES = [
    { id: 1, name: 'Bardo Roundabout' },
    { id: 2, name: 'Habib Bourguiba Sq.' },
    { id: 3, name: 'GP1 Highway — Sect A' },
    { id: 4, name: 'Sousse Main St.' },
  ];

  function demoRecordings(nodeId) {
    // Simulate 4 recordings per node
    return [
      { id: `${nodeId}-1`, label: 'Today 08:00 — 09:00',  date: 'Today',      duration: '60 min',  url: '' },
      { id: `${nodeId}-2`, label: 'Today 12:00 — 13:00',  date: 'Today',      duration: '60 min',  url: '' },
      { id: `${nodeId}-3`, label: 'Yesterday 07:30 — 08:30', date: 'Yesterday', duration: '60 min', url: '' },
      { id: `${nodeId}-4`, label: 'Yesterday 17:00 — 18:00', date: 'Yesterday', duration: '60 min', url: '' },
    ];
  }

  function demoAnalysis() {
    const rand = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
    return {
      vehicleTypes: {
        Cars:   rand(60, 200),
        Trucks: rand(10, 50),
        Buses:  rand(5,  30),
        Bikes:  rand(15, 80),
        Vans:   rand(8,  40),
      },
      colours: {
        White:  rand(30, 80),
        Black:  rand(20, 70),
        Silver: rand(25, 60),
        Red:    rand(10, 40),
        Blue:   rand(10, 40),
        Other:  rand(5,  25),
      },
      events: [
        { key: 'ambulance',  label: 'Ambulance',    icon: 'fa-truck-medical',       detected: Math.random() > 0.5 },
        { key: 'police',     label: 'Police car',   icon: 'fa-shield-halved',       detected: Math.random() > 0.6 },
        { key: 'fire',       label: 'Fire truck',   icon: 'fa-fire-extinguisher',   detected: Math.random() > 0.75 },
        { key: 'accident',   label: 'Accident',     icon: 'fa-car-burst',           detected: Math.random() > 0.7 },
        { key: 'wrongway',   label: 'Wrong-way',    icon: 'fa-arrow-right-arrow-left', detected: Math.random() > 0.8 },
        { key: 'jaywalker',  label: 'Pedestrian',   icon: 'fa-person-walking',      detected: Math.random() > 0.5 },
      ],
    };
  }

  // ── Populate node selector ───────────────────────────────
  // Try real backend first, fall back to demo
  fetch(`http://${IP}:5000/get_intersections`)
    .then(r => r.json())
    .then(data => {
      data.forEach(n => appendOption(nodeSelect, n.node_id, `Node ${n.node_id}`));
    })
    .catch(() => {
      DEMO_NODES.forEach(n => appendOption(nodeSelect, n.id, n.name));
    })
    .finally(() => {
      const params = new URLSearchParams(window.location.search);
      const qnode  = params.get('node');
      if (qnode && Array.from(nodeSelect.options).some(o => String(o.value) === String(qnode))) {
        nodeSelect.value = qnode;
        onNodeChange();
      }
    });

  // ── Node selected ────────────────────────────────────────
  nodeSelect.addEventListener('change', onNodeChange);

  function onNodeChange() {
    const nodeId    = nodeSelect.value;
    const nodeLabel = nodeSelect.options[nodeSelect.selectedIndex]?.textContent || `Node ${nodeId}`;

    recNodeName.textContent = nodeLabel;
    recNodeIdLabel.textContent = `Node ${nodeId}`;

    // Reset recording selector
    recSelect.innerHTML = '<option value="" disabled selected>Recording…</option>';
    recSelect.disabled  = true;

    clearPlayer();
    clearAnalysis();

    // Populate recordings (demo)
    const recs = demoRecordings(nodeId);
    recs.forEach(r => appendOption(recSelect, r.id, r.label));
    recSelect.disabled = false;
  }

  // ── Recording selected ───────────────────────────────────
  recSelect.addEventListener('change', onRecordingChange);

  function onRecordingChange() {
    const recId  = recSelect.value;
    const nodeId = nodeSelect.value;

    // Find the demo recording object
    const recs = demoRecordings(nodeId);
    const rec  = recs.find(r => r.id === recId);
    if (!rec) return;

    // Meta bar
    recStatusDot.style.color   = 'var(--green)';
    recStatusLabel.textContent = 'Recording loaded';
    recDateLabel.textContent   = rec.date;
    recDurLabel.textContent    = rec.duration;

    // Player
    loadPlayer(rec.url);

    // Analysis
    const analysis = demoAnalysis();
    renderAnalysis(analysis);
  }

  // ── Player helpers ───────────────────────────────────────
  function clearPlayer() {
    const iframe = recVideoWrap.querySelector('iframe');
    if (iframe) iframe.remove();
    recEmpty.style.display    = 'flex';
    recStatusDot.style.color  = 'var(--muted)';
    recStatusLabel.textContent = 'No recording loaded';
    recDateLabel.textContent  = '—';
    recDurLabel.textContent   = '—';
    recIncBanner.style.display = 'none';
  }

  function loadPlayer(url) {
    recEmpty.style.display = 'none';
    let iframe = recVideoWrap.querySelector('iframe');
    if (!iframe) {
      iframe = document.createElement('iframe');
      iframe.title           = 'Recorded stream';
      iframe.allowFullscreen = true;
      iframe.style.cssText   = 'border:0;width:calc(100% + 18px);height:100%;display:block;margin-right:-18px;pointer-events:auto;';
      recVideoWrap.appendChild(iframe);
    }
    // In demo mode url is empty — show a placeholder background instead
    iframe.src = url || 'about:blank';

    if (!url) {
      // Demo: just show the meta, no actual stream
      recEmpty.style.display = 'flex';
      recEmpty.innerHTML = `
        <i class="fa-solid fa-film" style="font-size:44px;color:var(--muted);margin-bottom:14px;"></i>
        <div style="font-size:13px;font-weight:700;color:var(--text);">Demo mode — no stream URL</div>
        <div style="font-size:11px;color:var(--muted);margin-top:5px;">Analysis results are shown on the right</div>
      `;
      iframe.remove();
    }
  }

  // ── Analysis renderers ───────────────────────────────────
  function clearAnalysis() {
    destroyChart('chartVehicleTypes');
    destroyChart('chartColours');
    recEventGrid.innerHTML = '';
    recIncBanner.style.display = 'none';
  }

  function renderAnalysis(data) {
    renderVehicleTypes(data.vehicleTypes);
    renderColours(data.colours);
    renderEvents(data.events);
  }

  // Chart 1 — Vehicle types (horizontal bar)
  function renderVehicleTypes(types) {
    destroyChart('chartVehicleTypes');
    const canvas = document.getElementById('chartVehicleTypes');
    if (!canvas) return;

    const labels = Object.keys(types);
    const values = Object.values(types);
    const colors = ['#2563eb','#f59e0b','#16a34a','#7c3aed','#0891b2'];

    charts['chartVehicleTypes'] = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: colors.map(c => c + 'cc'),
          borderColor: colors,
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.x} detected` } }
        },
        scales: {
          x: {
            beginAtZero: true,
            grid: { color: 'rgba(148,163,184,0.1)', drawBorder: false },
            ticks: { color: '#94a3b8', font: { size: 10 } },
          },
          y: {
            grid: { display: false },
            ticks: { color: '#94a3b8', font: { size: 11, weight: '600' } },
          }
        }
      }
    });
  }

  // Chart 2 — Colours (doughnut)
  function renderColours(colours) {
    destroyChart('chartColours');
    const canvas = document.getElementById('chartColours');
    if (!canvas) return;

    const labels = Object.keys(colours);
    const values = Object.values(colours);
    // Real colour hex values for the car colours
    const colorMap = {
      White: '#f1f5f9', Black: '#1e293b', Silver: '#94a3b8',
      Red: '#ef4444', Blue: '#3b82f6', Other: '#a3a3a3',
    };
    const bgColors     = labels.map(l => colorMap[l] || '#888');
    const borderColors = labels.map(l => l === 'White' ? '#cbd5e1' : colorMap[l] || '#888');

    charts['chartColours'] = new Chart(canvas.getContext('2d'), {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{
          data: values,
          backgroundColor: bgColors,
          borderColor: borderColors,
          borderWidth: 2,
          hoverOffset: 6,
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '68%',
        plugins: {
          legend: {
            display: true,
            position: 'right',
            labels: {
              color: '#94a3b8',
              font: { size: 10 },
              boxWidth: 10,
              padding: 8,
            }
          },
          tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${ctx.parsed}` } }
        }
      }
    });
  }

  // Event pills
  function renderEvents(events) {
    recEventGrid.innerHTML = '';
    let hasIncident = false;

    events.forEach(ev => {
      const pill = document.createElement('div');
      pill.className = `rec-event-pill ${ev.detected ? 'rec-event-detected' : 'rec-event-none'}`;
      pill.innerHTML = `
        <i class="fa-solid ${ev.icon}"></i>
        <span>${ev.label}</span>
        <span class="rec-event-badge">${ev.detected ? 'YES' : 'NO'}</span>
      `;
      recEventGrid.appendChild(pill);

      if (ev.detected && ['ambulance','police','fire','accident','wrongway'].includes(ev.key)) {
        hasIncident = true;
      }
    });

    // Incident banner
    if (hasIncident) {
      const detected = events.filter(e => e.detected && ['ambulance','police','fire','accident','wrongway'].includes(e.key));
      recIncText.textContent = `Detected: ${detected.map(e => e.label).join(', ')}`;
      recIncBanner.style.display = 'flex';
    } else {
      recIncBanner.style.display = 'none';
    }
  }

  // ── Utils ────────────────────────────────────────────────
  function appendOption(sel, value, text) {
    const opt = document.createElement('option');
    opt.value = value;
    opt.textContent = text;
    sel.appendChild(opt);
  }

  function destroyChart(id) {
    if (charts[id]) {
      try { charts[id].destroy(); } catch (_) {}
      delete charts[id];
    }
  }
});