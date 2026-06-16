// ═══════════════════════════════════════════════════════════════
//  ORDERS.JS — TraficCam Dashboard
//  Supabase-connected officer browser + order dispatch
// ═══════════════════════════════════════════════════════════════

// ── Supabase Config (mirrors SupabaseService.dart) ─────────────
const SUPABASE_URL  = 'https://nqwldumrmksaiyyomiaz.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xd2xkdW1ybWtzYWl5eW9taWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MTA4NDcsImV4cCI6MjA5NjA4Njg0N30.2DI6Bn971sJXRNVqpEtpAf-V4AxKEJIk6W8JNNjRViE';

const { createClient } = supabase;
const sb = createClient(SUPABASE_URL, SUPABASE_ANON);

// ── State ───────────────────────────────────────────────────────
let allOfficers     = [];   // raw from Supabase
let filteredOfficers= [];   // after filters
let selectedOfficer = null; // currently chosen officer
let ordersMap       = null; // Leaflet instance
let officerMarkers  = {};   // { officerId: L.Marker }
let targetMapMarker = null; // Map click target marker
let recentOrders    = [];   // local session log

// ── Avatar colour cycling ───────────────────────────────────────
const AV_CLASSES = ['av-0','av-1','av-2','av-3','av-4'];
function avatarClass(id) {
  // stable colour from UUID/string hash
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return AV_CLASSES[h % AV_CLASSES.length];
}

function initials(name = '') {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

// ── Status helpers ──────────────────────────────────────────────
const STATUS_LABEL = {
  onDuty:    'On Duty',
  offDuty:   'Off Duty',
  atIncident:'At Incident',
  onBreak:   'On Break',
  moving:    'Moving',
};

const STATUS_COLOR = {
  onDuty:    '#16a34a',
  moving:    '#2563eb',
  atIncident:'#ef4444',
  onBreak:   '#f59e0b',
  offDuty:   '#94a3b8',
};

function statusDotClass(status) {
  return `status-${status || 'offDuty'}`;
}

// ── Map initialisation ──────────────────────────────────────────
function initMap() {
  ordersMap = L.map('orders-map', { zoomControl: true });

  // Respect current theme
  const isDark = document.body.classList.contains('dark');
  const tileUrl = isDark
    ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  L.tileLayer(tileUrl, {
    attribution: isDark
      ? '&copy; OpenStreetMap &copy; CartoDB'
      : '&copy; OpenStreetMap contributors',
    maxZoom: 18,
  }).addTo(ordersMap);

  ordersMap.setView([36.8065, 10.1815], 9);

  // Handle map click to set target coordinates
  ordersMap.on('click', function(e) {
    const lat = e.latlng.lat.toFixed(6);
    const lng = e.latlng.lng.toFixed(6);
    
    document.getElementById('order-lat').value = lat;
    document.getElementById('order-lng').value = lng;
    
    if (targetMapMarker) {
      targetMapMarker.setLatLng(e.latlng);
    } else {
      targetMapMarker = L.marker(e.latlng, {
        icon: L.divIcon({
          html: '<i class="fa-solid fa-location-crosshairs" style="color:#ef4444;font-size:24px;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.3));"></i>',
          className: '',
          iconSize: [24, 24],
          iconAnchor: [12, 24]
        })
      }).addTo(ordersMap);
    }
  });
}

// Custom officer SVG marker
function officerIcon(officer) {
  const color = STATUS_COLOR[officer.status] || '#94a3b8';
  const ini   = initials(officer.full_name || officer.badge_number || '?');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="38" height="46" viewBox="0 0 38 46">
      <filter id="sh" x="-30%" y="-20%" width="160%" height="160%">
        <feDropShadow dx="0" dy="2" stdDeviation="2" flood-opacity="0.25"/>
      </filter>
      <path d="M19 0 C8.5 0 0 8.5 0 19 C0 31.5 19 46 19 46 C19 46 38 31.5 38 19 C38 8.5 29.5 0 19 0Z"
            fill="${color}" filter="url(#sh)"/>
      <circle cx="19" cy="19" r="13" fill="rgba(255,255,255,0.22)"/>
      <text x="19" y="24" text-anchor="middle"
            font-family="Inter,sans-serif" font-size="11" font-weight="700"
            fill="#fff" letter-spacing="0.5">${ini}</text>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [38, 46],
    iconAnchor: [19, 46],
    popupAnchor: [0, -48],
  });
}

function selectedOfficerIcon(officer) {
  const color = STATUS_COLOR[officer.status] || '#94a3b8';
  const ini   = initials(officer.full_name || officer.badge_number || '?');
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="46" height="56" viewBox="0 0 46 56">
      <filter id="sh2" x="-30%" y="-20%" width="160%" height="160%">
        <feDropShadow dx="0" dy="3" stdDeviation="3" flood-opacity="0.35"/>
      </filter>
      <path d="M23 0 C10.3 0 0 10.3 0 23 C0 38 23 56 23 56 C23 56 46 38 46 23 C46 10.3 35.7 0 23 0Z"
            fill="${color}" filter="url(#sh2)"/>
      <circle cx="23" cy="23" r="17" fill="rgba(255,255,255,0.2)"/>
      <circle cx="23" cy="23" r="14" fill="rgba(255,255,255,0.15)" stroke="#fff" stroke-width="1.5" stroke-dasharray="3 2"/>
      <text x="23" y="28" text-anchor="middle"
            font-family="Inter,sans-serif" font-size="13" font-weight="800"
            fill="#fff" letter-spacing="0.5">${ini}</text>
    </svg>`;
  return L.divIcon({
    html: svg,
    className: '',
    iconSize: [46, 56],
    iconAnchor: [23, 56],
    popupAnchor: [0, -58],
  });
}

// ── Fetch officers from Supabase ────────────────────────────────
async function fetchOfficers() {
  try {
    const { data, error } = await sb.from('officers').select('*');
    if (error) throw error;
    allOfficers = data || [];
    updateConnectionBadge(true);
    applyFilters();
  } catch (err) {
    console.error('Failed to fetch officers:', err);
    updateConnectionBadge(false);
    showEmptyState('Cannot reach Supabase. Check connection.');
  }
}

// ── Fetch recent orders (for the log panel) ─────────────────────
async function fetchRecentOrders() {
  try {
    const { data, error } = await sb
      .from('orders')
      .select('*, officers!orders_to_officer_id_fkey(full_name, badge_number)')
      .order('issued_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    recentOrders = data || [];
    renderOrdersLog();
  } catch (err) {
    console.warn('Could not load recent orders:', err.message);
  }
}

// ── Apply zone + status + search filters ───────────────────────
function applyFilters() {
  const zone   = document.getElementById('zone-filter').value;
  const status = document.getElementById('status-filter').value;
  const search = (document.getElementById('officer-search').value || '').toLowerCase();

  filteredOfficers = allOfficers.filter(o => {
    const inZone   = !zone   || (o.current_zone || '').toLowerCase().includes(zone.toLowerCase());
    const inStatus = !status || o.status === status;
    const inSearch = !search ||
      (o.full_name    || '').toLowerCase().includes(search) ||
      (o.badge_number || '').toLowerCase().includes(search);
    return inZone && inStatus && inSearch;
  });

  renderOfficerList();
  renderMapMarkers();
}

// ── Render officer cards ────────────────────────────────────────
function renderOfficerList() {
  const container = document.getElementById('officers-list');
  document.getElementById('officer-count').textContent = filteredOfficers.length;

  // Remove loading indicator
  const loading = document.getElementById('officers-loading');
  if (loading) loading.remove();

  if (filteredOfficers.length === 0) {
    container.innerHTML = `
      <div class="officers-empty">
        <i class="fa-solid fa-users-slash"></i>
        <p>No officers match the current filters.</p>
      </div>`;
    return;
  }

  container.innerHTML = '';
  filteredOfficers.forEach(officer => {
    const card = buildOfficerCard(officer);
    container.appendChild(card);
  });
}

function buildOfficerCard(officer) {
  const div = document.createElement('div');
  div.className = 'officer-card' + (selectedOfficer?.id === officer.id ? ' selected' : '');
  div.dataset.id = officer.id;

  const av     = avatarClass(officer.id);
  const ini    = initials(officer.full_name || officer.badge_number || '?');
  const dotCls = statusDotClass(officer.status);
  const label  = STATUS_LABEL[officer.status] || officer.status || 'Unknown';
  const zone   = officer.current_zone || 'Unknown zone';
  const badge  = officer.badge_number || '—';

  div.innerHTML = `
    <div class="officer-card-top">
      <div class="officer-avatar ${av}">${ini}</div>
      <div class="officer-info">
        <div class="officer-name">${officer.full_name || badge}</div>
        <div class="officer-badge">#${badge}</div>
      </div>
      <div class="officer-status-dot ${dotCls}" title="${label}"></div>
    </div>
    <div class="officer-card-meta">
      <span class="officer-tag"><i class="fa-solid fa-location-dot"></i>${zone}</span>
      <span class="officer-tag"><i class="fa-solid fa-circle-half-stroke"></i>${label}</span>
    </div>`;

  div.addEventListener('click', () => selectOfficer(officer));
  return div;
}

// ── Render Leaflet markers ──────────────────────────────────────
function renderMapMarkers() {
  // Clear old markers
  Object.values(officerMarkers).forEach(m => m.remove());
  officerMarkers = {};

  const validOfficers = filteredOfficers.filter(o => o.latitude && o.longitude);
  document.getElementById('map-count').textContent = validOfficers.length;

  validOfficers.forEach(officer => {
    const icon   = officer.id === selectedOfficer?.id
      ? selectedOfficerIcon(officer)
      : officerIcon(officer);

    const marker = L.marker([officer.latitude, officer.longitude], { icon })
      .addTo(ordersMap);

    const zone   = officer.current_zone || 'Unknown';
    const label  = STATUS_LABEL[officer.status] || officer.status || '—';
    const color  = STATUS_COLOR[officer.status] || '#94a3b8';

    marker.bindPopup(`
      <div style="min-width:170px;font-family:Inter,sans-serif;">
        <div style="font-size:12px;font-weight:700;margin-bottom:3px;">
          ${officer.full_name || '#' + officer.badge_number}
        </div>
        <div style="font-size:10px;color:#888;margin-bottom:6px;">Badge #${officer.badge_number || '—'}</div>
        <div style="display:flex;gap:5px;flex-wrap:wrap;">
          <span style="background:${color}22;color:${color};border:1px solid ${color}44;
            border-radius:99px;padding:1px 8px;font-size:10px;font-weight:600;">${label}</span>
          <span style="background:#f1f5f9;color:#64748b;border:1px solid #e2e8f0;
            border-radius:99px;padding:1px 8px;font-size:10px;">${zone}</span>
        </div>
        <button onclick="selectOfficerById('${officer.id}')"
          style="margin-top:8px;width:100%;background:#2563eb;color:#fff;border:none;
          border-radius:7px;padding:6px;font-size:11px;font-weight:600;cursor:pointer;">
          Select &amp; Dispatch
        </button>
      </div>`, { closeButton: false });

    marker.on('click', () => selectOfficer(officer));
    officerMarkers[officer.id] = marker;
  });
}

// Global lookup used by popup button
window.selectOfficerById = function(id) {
  const officer = allOfficers.find(o => o.id === id);
  if (officer) selectOfficer(officer);
};

// ── Officer selection ───────────────────────────────────────────
function selectOfficer(officer) {
  selectedOfficer = officer;

  // Highlight card
  document.querySelectorAll('.officer-card').forEach(c => {
    c.classList.toggle('selected', c.dataset.id === officer.id);
  });

  // Update form display
  renderSelectedOfficerPill(officer);

  // Enable send button
  document.getElementById('send-order-btn').disabled = false;

  // Update map markers (selected gets bigger icon)
  renderMapMarkers();

  // Fly to officer if they have coordinates
  if (officer.latitude && officer.longitude) {
    ordersMap.flyTo([officer.latitude, officer.longitude], 14, {
      duration: 1.2,
      easeLinearity: 0.25,
    });
    // Open popup after fly animation
    setTimeout(() => {
      const m = officerMarkers[officer.id];
      if (m) m.openPopup();
    }, 1300);
  }

  // Update top bar pill
  const pill = document.getElementById('selected-map-pill');
  pill.style.display = 'flex';
  document.getElementById('selected-map-pill-name').textContent =
    officer.full_name || '#' + officer.badge_number;
}

function renderSelectedOfficerPill(officer) {
  const container = document.getElementById('selected-officer-display');
  const av  = avatarClass(officer.id);
  const ini = initials(officer.full_name || officer.badge_number || '?');
  const zone = officer.current_zone || 'Unknown zone';

  container.innerHTML = `
    <div class="selected-officer-pill">
      <div class="avatar-sm ${av}">${ini}</div>
      <div style="flex:1;min-width:0;">
        <div class="name">${officer.full_name || '#' + officer.badge_number}</div>
        <div class="zone">${zone}</div>
      </div>
      <button onclick="clearSelection()"
        style="background:none;border:none;color:var(--muted);cursor:pointer;padding:2px 4px;font-size:11px;"
        title="Clear selection">
        <i class="fa-solid fa-xmark"></i>
      </button>
    </div>`;
}

window.clearSelection = function() {
  selectedOfficer = null;
  document.querySelectorAll('.officer-card').forEach(c => c.classList.remove('selected'));
  document.getElementById('send-order-btn').disabled = true;
  document.getElementById('selected-officer-display').innerHTML = `
    <div class="no-officer-hint">
      <i class="fa-solid fa-arrow-left" style="font-size:10px;"></i>
      <span>Click an officer from the list</span>
    </div>`;
  document.getElementById('selected-map-pill').style.display = 'none';
  if (targetMapMarker) {
    targetMapMarker.remove();
    targetMapMarker = null;
  }
  document.getElementById('order-lat').value = '';
  document.getElementById('order-lng').value = '';
  renderMapMarkers();
};

// ── Dispatch order to Supabase ──────────────────────────────────
async function sendOrder() {
  if (!selectedOfficer) return;

  const btn      = document.getElementById('send-order-btn');
  const type     = document.getElementById('order-type').value;
  const location = document.getElementById('order-location').value;
  const latStr   = document.getElementById('order-lat').value;
  const lngStr   = document.getElementById('order-lng').value;
  const priority = document.getElementById('order-priority').value;   // routine | urgent | emergency
  const message  = document.getElementById('order-message').value.trim();

  if (!location && !latStr && !lngStr) {
    showErrorToast('Please select a location or map coordinates.');
    return;
  }

  const targetLat = latStr ? parseFloat(latStr) : null;
  const targetLng = lngStr ? parseFloat(lngStr) : null;

  // Build a human-readable message combining order type + notes
  const fullMessage = [
    `[${type.replace(/_/g, ' ').toUpperCase()}]`,
    message || '',
  ].filter(Boolean).join(' — ');

  // Payload matches ControlOrder.toJson() / Supabase table schema exactly
  const orderPayload = {
    to_officer_id:    selectedOfficer.id,
    from_control_room:'Control Room — Dashboard',
    message:          fullMessage,
    target_location:  location || 'Coordonnées GPS',
    target_lat:       targetLat,
    target_lng:       targetLng,
    priority:         priority,   // routine | urgent | emergency
    status:           'pending',
    issued_at:        new Date().toISOString(),
  };

  btn.disabled = true;
  btn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Dispatching…';

  try {
    const { data, error } = await sb
      .from('orders')
      .insert(orderPayload)
      .select()
      .single();

    if (error) throw error;

    // Success
    showSuccessToast(
      `Order dispatched to ${selectedOfficer.full_name || '#' + selectedOfficer.badge_number} · ${location}`
    );

    // Add to local log immediately
    recentOrders.unshift({
      ...data,
      officers: {
        full_name:    selectedOfficer.full_name,
        badge_number: selectedOfficer.badge_number,
      },
    });
    renderOrdersLog();

    // Reset form (keep officer selected for rapid re-dispatch)
    document.getElementById('order-message').value = '';
    document.getElementById('order-location').value = '';
    document.getElementById('order-lat').value = '';
    document.getElementById('order-lng').value = '';
    if (targetMapMarker) {
      targetMapMarker.remove();
      targetMapMarker = null;
    }

  } catch (err) {
    console.error('Order dispatch failed:', err);
    showErrorToast('Failed to dispatch: ' + (err.message || 'Unknown error'));
  } finally {
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-paper-plane"></i> Dispatch Order';
  }
}

// ── Render recent orders log ────────────────────────────────────
function renderOrdersLog() {
  const container = document.getElementById('orders-log-list');

  if (!recentOrders.length) {
    container.innerHTML = `<div style="padding:16px;text-align:center;color:var(--muted);font-size:11px;">
      No orders sent yet.
    </div>`;
    return;
  }

  container.innerHTML = '';
  recentOrders.slice(0, 15).forEach(order => {
    const officerName = order.officers?.full_name
      || (order.officers?.badge_number ? '#' + order.officers.badge_number : 'Unknown');
    const statusCls  = order.status === 'acknowledged' ? 'acknowledged' : 'pending';
    const statusLbl  = order.status === 'acknowledged' ? 'Acknowledged' : 'Pending';
    const when       = formatRelTime(order.issued_at);
    const dest       = order.target_location || order.message || '—';

    const item = document.createElement('div');
    item.className = 'log-item';
    item.innerHTML = `
      <div class="log-item-top">
        <span class="log-item-name">${officerName}</span>
        <span class="log-item-status ${statusCls}">${statusLbl}</span>
      </div>
      <div class="log-item-msg">${dest}</div>
      <div class="log-item-time">${when}</div>`;
    container.appendChild(item);
  });
}

function formatRelTime(isoStr) {
  if (!isoStr) return '—';
  const diff = (Date.now() - new Date(isoStr)) / 1000;
  if (diff < 60) return 'just now';
  if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return new Date(isoStr).toLocaleDateString('en-GB');
}

// ── Connection badge ────────────────────────────────────────────
function updateConnectionBadge(connected) {
  const badge = document.getElementById('conn-badge');
  if (!badge) return;
  if (connected) {
    badge.className = 'status-badge connected';
    badge.textContent = 'Supabase Connected';
  } else {
    badge.className = 'status-badge';
    badge.textContent = 'Connection Failed';
  }
}

function showEmptyState(msg) {
  const container = document.getElementById('officers-list');
  const loading   = document.getElementById('officers-loading');
  if (loading) loading.remove();
  container.innerHTML = `
    <div class="officers-empty">
      <i class="fa-solid fa-wifi-exclamation" style="color:var(--accent2)"></i>
      <p>${msg}</p>
    </div>`;
}

// ── Toast helpers ───────────────────────────────────────────────
function showSuccessToast(msg) {
  document.getElementById('success-toast-body').textContent = msg;
  const toast = bootstrap.Toast.getOrCreateInstance(document.getElementById('successToast'));
  toast.show();
}

function showErrorToast(msg) {
  document.getElementById('error-toast-body').textContent = msg;
  const toast = bootstrap.Toast.getOrCreateInstance(document.getElementById('errorToast'));
  toast.show();
}

// ── Clock ───────────────────────────────────────────────────────
function updateClock() {
  const el = document.getElementById('live-clock');
  if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

// ── Real-time subscription for orders updates ───────────────────
function subscribeToOrders() {
  sb
    .channel('orders-dashboard')
    .on('postgres_changes', {
      event:  '*',
      schema: 'public',
      table:  'orders',
    }, payload => {
      // Refresh the log when an order is acknowledged by an officer
      fetchRecentOrders();
    })
    .subscribe();
}

// ── Event listeners ─────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  // Map
  initMap();

  // Fetch data
  fetchOfficers();
  fetchRecentOrders();

  // Real-time updates
  subscribeToOrders();

  // Filters
  document.getElementById('zone-filter').addEventListener('change', applyFilters);
  document.getElementById('status-filter').addEventListener('change', applyFilters);
  document.getElementById('officer-search').addEventListener('input', applyFilters);

  // Send order
  document.getElementById('send-order-btn').addEventListener('click', sendOrder);

  // Refresh officers every 30 s (live status updates)
  setInterval(fetchOfficers, 30_000);
});
