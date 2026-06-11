// ══════════════════════════════════════════════════════════════
//  TraficCam — map_v3.js  (redesign)
// ══════════════════════════════════════════════════════════════

// ── Map init ──────────────────────────────────────────────────
let map = L.map('map', {
    zoomControl: false,
    attributionControl: false
}).setView([36.602575, 10.122528], 9);

if (typeof window.initMapWithTheme === 'function') {
    window.initMapWithTheme(map);
} else {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: ''
    }).addTo(map);
}

// ── Config ────────────────────────────────────────────────────
const ipAdress = "192.168.100.6";

const customIcon = L.icon({
    iconUrl: '../img/marker.png',
    iconSize: [36, 36],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
});

// ── State ─────────────────────────────────────────────────────
let nodeLayers = {};          // active (live) nodes  { circle, data, timeout }
let markerLayers = {};        // inactive nodes        L.Marker
let selectedNodeLayer = null;
let previouslySelectedCircle = null;
const DATA_TIMEOUT = 5000;
let lastNodeId = 0;
let recentAlerts = {};
let ws = null;
let recenteredNodes = new Set();
let selectedIntersectionCapacity = 100;
let totalNodes = 0;
let connectedNodes = 0;

// All known nodes for the drawer  { node_id, address, lat, lng, active }
let allNodes = {};

const badge = document.getElementById('status-badge');
const nodePanelEl  = document.getElementById('nodePanel');
const npCloseBtn   = document.getElementById('npClose');
const nodeDrawerEl = document.getElementById('nodeDrawer');
const ndHandle     = document.getElementById('ndHandle');
const ndList       = document.getElementById('ndList');
const ndSearch     = document.getElementById('ndSearch');

// ── Utilities ─────────────────────────────────────────────────
function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
const debouncedUpdateUIElements = debounce(updateUIElements, 300);

// ── Bootstrap badge helper ────────────────────────────────────
function setBadge(connected) {
    const dot = badge.querySelector('.status-dot') || badge;
    if (connected) {
        badge.textContent = '';
        const d = document.createElement('span');
        d.className = 'status-dot';
        badge.appendChild(d);
        badge.appendChild(document.createTextNode(' System Live'));
        badge.className = 'status-badge connected';
    } else {
        badge.textContent = '';
        const d = document.createElement('span');
        d.className = 'status-dot';
        badge.appendChild(d);
        badge.appendChild(document.createTextNode(' Disconnected'));
        badge.className = 'status-badge disconnected';
    }
}

// ── Node Panel open / close ───────────────────────────────────
function openNodePanel() { nodePanelEl.classList.add('open'); }
function closeNodePanel() { nodePanelEl.classList.remove('open'); }

npCloseBtn.addEventListener('click', () => {
    closeNodePanel();
    selectedNodeLayer = null;
    if (previouslySelectedCircle) {
        previouslySelectedCircle.setStyle({ weight: 2, dashArray: null });
        previouslySelectedCircle = null;
    }
});

// ── Node Drawer toggle ────────────────────────────────────────
ndHandle.addEventListener('click', () => {
    nodeDrawerEl.classList.toggle('open');
});

// ── Node Drawer search filter ─────────────────────────────────
ndSearch.addEventListener('input', () => {
    const q = ndSearch.value.toLowerCase();
    document.querySelectorAll('.nd-item').forEach(item => {
        const name = item.dataset.name || '';
        item.style.display = name.toLowerCase().includes(q) ? '' : 'none';
    });
});

// ── Refresh drawer list ───────────────────────────────────────
function refreshDrawer() {
    const ids = Object.keys(allNodes);
    if (ids.length === 0) {
        ndList.innerHTML = '<div class="nd-empty">No nodes registered yet.</div>';
        return;
    }
    ndList.innerHTML = '';
    ids.forEach(id => {
        const n = allNodes[id];
        const isActive = !!nodeLayers[id];
        const div = document.createElement('div');
        div.className = 'nd-item' + (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === Number(id) ? ' selected' : '');
        div.dataset.name = n.address || `Node ${id}`;
        div.innerHTML = `
            <span class="nd-dot ${isActive ? 'active' : 'inactive'}"></span>
            <span class="nd-item-name">${n.address || 'Node ' + id}</span>
            <span class="nd-item-id">#${id}</span>
        `;
        div.addEventListener('click', () => {
            map.flyTo([n.lat, n.lng], 13, { duration: 1.2 });
            nodeDrawerEl.classList.remove('open');
            // trigger selection
            const nodeId = Number(id);
            if (nodeLayers[nodeId]) {
                const { circle, data } = nodeLayers[nodeId];
                if (previouslySelectedCircle && previouslySelectedCircle !== circle) {
                    previouslySelectedCircle.setStyle({ weight: 2, dashArray: null });
                }
                circle.setStyle({ weight: 6, dashArray: '12' });
                previouslySelectedCircle = circle;
                selectedNodeLayer = { circle, data };
            } else if (markerLayers[nodeId]) {
                selectedNodeLayer = { marker: markerLayers[nodeId], data: markerLayers[nodeId].data };
            }
            if (selectedNodeLayer) {
                fetchIntersectionDetails(n.lat, n.lng);
                updateUIElements(selectedNodeLayer.data || {});
                openNodePanel();
            }
        });
        ndList.appendChild(div);
    });
}

// ── Stream modal – block inactive nodes ───────────────────────
const streamModalEl = document.getElementById('streamModal');
const streamModal   = new bootstrap.Modal(streamModalEl);
const streamFrame   = document.getElementById('streamFrame');
const cameraSelector = document.getElementById('cameraSelector');
const streamBlockedEl = document.getElementById('streamBlocked');
const streamActiveEl  = document.getElementById('streamActive');
const streamOpenBtn   = document.getElementById('openModalBtn');
let currentNodeId = null;

function isNodeActive(nodeId) {
    return !!nodeLayers[nodeId];
}

streamOpenBtn.addEventListener('click', () => {
    if (!selectedNodeLayer || !selectedNodeLayer.data.node_id) return;

    currentNodeId = selectedNodeLayer.data.node_id;
    streamModal.show();

    const active = isNodeActive(currentNodeId);
    streamBlockedEl.style.display = active ? 'none' : '';
    streamActiveEl.style.display  = active ? '' : 'none';

    document.getElementById('stream_intersection_name').textContent =
        document.getElementById('intersection-name').textContent || 'Selected Node';

    if (active) {
        cameraSelector.innerHTML = '<option value="" disabled selected>Loading cameras…</option>';
        streamFrame.src = '';
        fetchCamerasForNode(currentNodeId);
    }
});

streamModalEl.addEventListener('hidden.bs.modal', () => {
    streamFrame.src = '';
    cameraSelector.innerHTML = '<option value="" disabled selected>Select a camera</option>';
    currentNodeId = null;
});

function fetchCamerasForNode(nodeId) {
    fetch(`http://${ipAdress}:5000/get_node_cams?node_id=${nodeId}`)
        .then(r => { if (!r.ok) throw new Error(); return r.json(); })
        .then(cams => {
            cameraSelector.innerHTML = '<option value="" disabled selected>Select a camera</option>';
            if (cams && cams.length > 0) {
                cams.forEach((cam, i) => {
                    const o = document.createElement('option');
                    o.value = cam.ip_address || cam.url || '';
                    o.textContent = cam.name || `Camera ${i + 1}`;
                    cameraSelector.appendChild(o);
                });
            } else {
                const o = document.createElement('option');
                o.value = ''; o.textContent = 'No cameras available'; o.disabled = true;
                cameraSelector.appendChild(o);
            }
        })
        .catch(() => {
            cameraSelector.innerHTML = '<option value="" disabled selected>Error loading cameras</option>';
        });
}

cameraSelector.addEventListener('change', function () {
    if (this.value) streamFrame.src = this.value;
    else streamFrame.src = '';
});

// ── Stats modal ───────────────────────────────────────────────
let chartInstance = null;
document.getElementById('chartModal').addEventListener('shown.bs.modal', () => {
    if (!selectedNodeLayer) return;
    const nodeId = selectedNodeLayer.data.node_id;
    fetch(`http://${ipAdress}:5000/get_vehicle_count_by_day?node_id=${nodeId}`)
        .then(r => r.json())
        .then(data => { /* chart logic here */ })
        .catch(console.error);
});

// ── Initial fetch ─────────────────────────────────────────────
fetch(`http://${ipAdress}:5000/get_intersections`)
    .then(r => r.json())
    .then(data => {
        data.forEach(n => {
            const nodeId = parseInt(n.node_id);
            markerLayers[nodeId] = createMarkerLayer(n.latitude, n.longitude, {
                node_id: nodeId, latitude: n.latitude, longitude: n.longitude
            });
            allNodes[nodeId] = { lat: n.latitude, lng: n.longitude, address: null };
            if (nodeId > lastNodeId) lastNodeId = nodeId;
        });
        totalNodes = data.length;
        updateNodeCount();
        // fetch addresses for drawer
        fetchAllAddresses();
        startPolling();
        connectWebSocket();
    })
    .catch(err => console.error('Error fetching intersections:', err));

// Fetch addresses for all known nodes and populate drawer
function fetchAllAddresses() {
    Object.keys(allNodes).forEach(id => {
        const n = allNodes[id];
        fetch(`http://${ipAdress}:5000/get_address?node_id=${id}`)
            .then(r => r.json())
            .then(d => {
                if (d.address) allNodes[id].address = d.address;
                refreshDrawer();
            })
            .catch(() => refreshDrawer());
    });
    refreshDrawer();
}

// ── Polling ───────────────────────────────────────────────────
function startPolling() {
    function poll() {
        fetch(`http://${ipAdress}:5000/poll_new_nodes?last_node_id=${lastNodeId}`)
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(data => {
                if (data && data.length > 0) {
                    data.forEach(n => {
                        const nodeId = n.node_id;
                        if (!nodeLayers[nodeId] && !markerLayers[nodeId]) {
                            markerLayers[nodeId] = createMarkerLayer(n.latitude, n.longitude, {
                                node_id: nodeId, latitude: n.latitude, longitude: n.longitude
                            });
                            if (!allNodes[nodeId]) allNodes[nodeId] = { lat: n.latitude, lng: n.longitude, address: null };
                            if (nodeId > lastNodeId) lastNodeId = nodeId;
                        }
                    });
                    refreshDrawer();
                }
            })
            .catch(console.error);

        fetch(`http://${ipAdress}:5000/get_intersections`)
            .then(r => { if (!r.ok) throw new Error(); return r.json(); })
            .then(data => {
                totalNodes = data.length;
                updateNodeCount();
                data.forEach(n => {
                    const nodeId = n.node_id;
                    // update positions if changed
                    const upd = (layer, latFn, lngFn) => {
                        const cur = layer.getLatLng ? layer.getLatLng() : null;
                        if (!cur) return;
                        if (Math.abs(cur.lat - n.latitude) > 0.0001 || Math.abs(cur.lng - n.longitude) > 0.0001) {
                            layer.setLatLng([n.latitude, n.longitude]);
                        }
                    };
                    if (markerLayers[nodeId]) upd(markerLayers[nodeId]);
                    if (nodeLayers[nodeId])   upd(nodeLayers[nodeId].circle);
                    if (!allNodes[nodeId]) allNodes[nodeId] = { lat: n.latitude, lng: n.longitude, address: null };
                    else { allNodes[nodeId].lat = n.latitude; allNodes[nodeId].lng = n.longitude; }
                });
                setTimeout(poll, 30000);
            })
            .catch(() => setTimeout(poll, 5000));
    }
    poll();
}

// ── WebSocket ─────────────────────────────────────────────────
function connectWebSocket() {
    ws = new WebSocket(`ws://${ipAdress}:8766`);

    ws.onopen = () => setBadge(true);

    ws.onmessage = function (event) {
        const data = JSON.parse(event.data);

        if (data.message_type === 'new_node' || data.message_type === 'node_update') {
            data.node_id = parseInt(data.node_id);
        }

        if (data.message_type === 'data') {
            updateNodeData(data);
        } else if (data.message_type === 'notif') {
            showTrafficNotification(data);
        } else if (data.message_type === 'new_node') {
            connectedNodes = Object.keys(nodeLayers).length;
            updateNodeCount();
            const nodeId = data.node_id;
            if (!nodeLayers[nodeId]) {
                if (markerLayers[nodeId]) {
                    markerLayers[nodeId].setLatLng([data.latitude, data.longitude]);
                } else {
                    markerLayers[nodeId] = createMarkerLayer(data.latitude, data.longitude, {
                        node_id: nodeId, latitude: data.latitude, longitude: data.longitude
                    });
                }
            }
            if (!allNodes[nodeId]) allNodes[nodeId] = { lat: data.latitude, lng: data.longitude, address: null };
            if (nodeId > lastNodeId) lastNodeId = nodeId;
            showNodeNotification(data, 'new_node');
            refreshDrawer();
            map.invalidateSize();
        } else if (data.message_type === 'node_update') {
            const nodeId = data.node_id;
            if (markerLayers[nodeId]) markerLayers[nodeId].setLatLng([data.latitude, data.longitude]);
            if (nodeLayers[nodeId])   nodeLayers[nodeId].circle.setLatLng([data.latitude, data.longitude]);
            if (allNodes[nodeId]) { allNodes[nodeId].lat = data.latitude; allNodes[nodeId].lng = data.longitude; }
            showNodeNotification(data, 'node_update');
            refreshDrawer();
            map.invalidateSize();
        }
    };

    ws.onclose = () => {
        setBadge(false);
        setTimeout(connectWebSocket, 5000);
    };
    ws.onerror = () => { ws.close(); setBadge(false); };
}

// ── Layer creation ────────────────────────────────────────────
function createCircleLayer(lat, lng, color, data) {
    data.node_id = parseInt(data.node_id);
    const circle = L.circle([lat, lng], {
        color, fillColor: color, fillOpacity: 0.4, radius: 200
    }).addTo(map);

    circle.on('click', () => {
        if (previouslySelectedCircle && previouslySelectedCircle !== circle) {
            previouslySelectedCircle.setStyle({ weight: 2, dashArray: null });
        }
        circle.setStyle({ weight: 6, dashArray: '12' });
        previouslySelectedCircle = circle;
        selectedNodeLayer = { circle, data };
        map.setView([lat, lng], 13);
        fetchIntersectionDetails(lat, lng);
        updateUIElements(data);
        openNodePanel();
        refreshDrawer();
        // update stream btn state
        updateStreamBtn(data.node_id);
    });
    return { circle, data, timeout: null };
}

function updateCircleLayer(nodeId, color, data) {
    nodeLayers[nodeId].circle.setStyle({ color, fillColor: color });
    nodeLayers[nodeId].data = data;
}

function createMarkerLayer(lat, lng, data) {
    data.node_id = parseInt(data.node_id);
    const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
    marker.data = data;
    marker.bindPopup(`<img src="../img/inactive.png" width="16"> <b>Inactive</b>`);
    marker.on('mouseover', () => marker.openPopup());
    marker.on('mouseout', () => marker.closePopup());
    marker.on('click', () => {
        selectedNodeLayer = { marker, data };
        map.setView([lat, lng], 12);
        fetchIntersectionDetails(lat, lng);
        updateUIElements(data || {});
        openNodePanel();
        refreshDrawer();
        updateStreamBtn(data.node_id);
    });
    return marker;
}

// Update stream button appearance based on node active state
function updateStreamBtn(nodeId) {
    const btn = streamOpenBtn;
    if (isNodeActive(nodeId)) {
        btn.disabled = false;
        btn.title = 'Open live stream';
    } else {
        btn.disabled = false; // still clickable, but shows blocked screen
        btn.title = 'Node is offline — stream unavailable';
    }
}

// ── Node data update ──────────────────────────────────────────
function updateNodeData(data) {
    const nodeId = parseInt(data.node_id);
    data.node_id = nodeId;
    const lat = data.latitude, lng = data.longitude;

    const laneKeys = Object.keys(data).filter(k => k.startsWith('voie_'))
        .sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]));

    const densityValues = laneKeys.map(lk => {
        const ln = lk.split('_')[1];
        const counter = data[lk] || 0;
        let speed = data[`avg_speed_${ln}`] || 0;
        if (laneKeys.length === 1 && data.avg_speed != null) speed = data.avg_speed;
        return speed > 0 ? counter / speed : 0;
    });
    const avgDensity = densityValues.length ? densityValues.reduce((s, d) => s + d, 0) / densityValues.length : 0;
    const color = getColorByDensity(avgDensity);

    if (!nodeLayers[nodeId]) {
        nodeLayers[nodeId] = createCircleLayer(lat, lng, color, data);
        if (markerLayers[nodeId]) { map.removeLayer(markerLayers[nodeId]); delete markerLayers[nodeId]; }
        connectedNodes = Object.keys(nodeLayers).length;
        updateNodeCount();
        refreshDrawer();
    } else {
        nodeLayers[nodeId].circle.setLatLng([lat, lng]);
        nodeLayers[nodeId].data.latitude = lat;
        nodeLayers[nodeId].data.longitude = lng;
        updateCircleLayer(nodeId, color, data);
        connectedNodes = Object.keys(nodeLayers).length;
        updateNodeCount();
    }

    clearTimeout(nodeLayers[nodeId].timeout);
    nodeLayers[nodeId].timeout = setTimeout(() => {
        map.removeLayer(nodeLayers[nodeId].circle);
        delete nodeLayers[nodeId];
        connectedNodes = Object.keys(nodeLayers).length;
        updateNodeCount();
        if (!markerLayers[nodeId]) markerLayers[nodeId] = createMarkerLayer(lat, lng, data);
        else map.addLayer(markerLayers[nodeId]);
        refreshDrawer();
        // if this was selected, update stream btn
        if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId) {
            updateStreamBtn(nodeId);
        }
    }, DATA_TIMEOUT);

    if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId) {
        selectedNodeLayer.data = { ...data, node_id: nodeId, latitude: lat, longitude: lng };
        fetchIntersectionDetails(lat, lng);
        debouncedUpdateUIElements(selectedNodeLayer.data);
    }

    map.invalidateSize();
}

// ── UI update ─────────────────────────────────────────────────
function updateUIElements(data) {
    const laneKeys = Object.keys(data || {}).filter(k => k.startsWith('voie_'))
        .sort((a, b) => parseInt(a.split('_')[1]) - parseInt(b.split('_')[1]));

    // ── Density widget ──
    const densityEl = document.getElementById('vehicle_present');
    densityEl.innerHTML = '';
    if (!laneKeys.length) {
        densityEl.innerHTML = '<span class="hw-empty">—</span>';
    } else {
        laneKeys.forEach(lk => {
            const ln = lk.split('_')[1];
            const counter = data[lk] || 0;
            let speed = data[`avg_speed_${ln}`] || 0;
            if (laneKeys.length === 1 && data.avg_speed != null) speed = data.avg_speed;
            const density = speed > 0 ? counter / speed : 0;
            const pct = Math.min(Math.max(density * 6, 0), 100);
            const cls = density > 40 ? 'high' : density > 15 ? 'med' : 'low';
            densityEl.innerHTML += `
                <div class="stat-row">
                    <span class="stat-lane">L${ln}</span>
                    <div class="stat-bar-wrap"><div class="stat-bar-fill ${cls}" style="width:${pct}%"></div></div>
                    <span class="stat-val">${density.toFixed(1)}</span>
                </div>`;
        });
    }

    // ── Speed widget ──
    const speedEl = document.getElementById('speeds_container');
    speedEl.innerHTML = '';
    if (!laneKeys.length) {
        speedEl.innerHTML = '<span class="hw-empty">—</span>';
    } else {
        laneKeys.forEach(lk => {
            const ln = lk.split('_')[1];
            let sv = data[`avg_speed_${ln}`];
            if (laneKeys.length === 1 && data.avg_speed != null) sv = data.avg_speed;
            speedEl.innerHTML += `
                <div class="stat-row">
                    <span class="stat-lane">L${ln}</span>
                    <span class="stat-val" style="width:auto;font-size:12px;">${sv ? Math.round(sv) : '—'}</span>
                </div>`;
        });
    }

    // ── Vehicles widget ──
    const vehEl = document.getElementById('lanes_container');
    vehEl.innerHTML = '';
    if (!laneKeys.length) {
        vehEl.innerHTML = '<span class="hw-empty">—</span>';
    } else {
        laneKeys.forEach(lk => {
            const ln = lk.split('_')[1];
            const count = data[lk] || 0;
            vehEl.innerHTML += `
                <div class="stat-row">
                    <span class="stat-lane">L${ln}</span>
                    <span class="stat-val" style="width:auto;font-size:12px;">${count}</span>
                </div>`;
        });
    }
}

// ── Alert update ──────────────────────────────────────────────
function updateAlertsCard() {
    const alertsEl = document.getElementById('alerts_container');
    const countEl  = document.getElementById('alerts-count');
    if (!selectedNodeLayer) {
        alertsEl.textContent = '—';
        countEl.innerHTML = '<a onclick="viewAllNotifications()" class="hw-link">View all</a>';
        return;
    }
    const nodeId = selectedNodeLayer.data.node_id;
    const today  = new Date().toISOString().split('T')[0];
    fetch(`http://${ipAdress}:5000/get_notifications_count?node_id=${nodeId}&date=${today}`)
        .then(r => r.json())
        .then(d => {
            const cnt = d.count || 0;
            alertsEl.textContent = cnt;
            countEl.innerHTML = `<a onclick="viewAllNotifications()" class="hw-link">${cnt === 1 ? '1 alert' : cnt + ' alerts'} today</a>`;
        })
        .catch(() => { alertsEl.textContent = '—'; });
}

function updateAlertsCount() { updateAlertsCard(); }

function updateNodeCount() {
    const el = document.getElementById('node-count');
    if (el) el.textContent = `${connectedNodes}/${totalNodes}`;
}

// ── Intersection details ───────────────────────────────────────
function fetchIntersectionDetails(lat, lng) {
    fetch(`http://${ipAdress}:5000/get_intersection_info?lat=${lat}&lng=${lng}`)
        .then(r => r.json())
        .then(d => {
            selectedIntersectionCapacity = d.capacity;
            document.getElementById('intersection-name').textContent   = d.address || 'Unknown';
            document.getElementById('cam-number').textContent          = d.cams || '—';
            document.getElementById('lanes-number').textContent        = d.total_lanes || '—';
            document.getElementById('capacity').textContent            = d.capacity || '—';
            // also update stats modal title
            const sn = document.querySelector('#stats_stream_intersection_name');
            if (sn) sn.textContent = d.address || 'Unknown';

            // Update allNodes address cache
            if (selectedNodeLayer) {
                const nid = selectedNodeLayer.data.node_id;
                if (allNodes[nid]) allNodes[nid].address = d.address || null;
                selectedNodeLayer.data.capacity = d.capacity;
                debouncedUpdateUIElements(selectedNodeLayer.data);
                updateAlertsCard();
                refreshDrawer();
            }
        })
        .catch(console.error);
}

// ── Notifications ─────────────────────────────────────────────
function showTrafficNotification(data) {
    const toastEl = document.getElementById('dangerToast');
    const toast   = bootstrap.Toast.getOrCreateInstance(toastEl);
    fetch(`http://${ipAdress}:5000/get_address?node_id=${data.node_id}`)
        .then(r => r.json())
        .then(d => {
            toastEl.querySelector('.toast-body').textContent = d.address || 'Unknown location';
            const alert = { node_id: data.node_id, address: d.address, timestamp: new Date().toLocaleTimeString() };
            recentAlerts[data.node_id] = alert;
            if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === Number(data.node_id)) {
                updateAlertsCard();
            }
        })
        .catch(() => { toastEl.querySelector('.toast-body').textContent = 'Location unavailable'; });
    toast.show();
}

function showNodeNotification(data, type) {
    const toastEl = document.getElementById('nodeToast');
    if (!toastEl) return;
    const toast   = bootstrap.Toast.getOrCreateInstance(toastEl);
    const msg     = type === 'new_node' ? 'New node registered' : 'Node activated';
    const nodeId  = parseInt(data.node_id);
    const lat = parseFloat(data.latitude), lng = parseFloat(data.longitude);

    fetch(`http://${ipAdress}:5000/get_address?node_id=${nodeId}`)
        .then(r => r.json())
        .then(d => {
            const addr = d.address || 'Unknown location';
            if (allNodes[nodeId]) allNodes[nodeId].address = addr;
            toastEl.querySelector('.toast-body').textContent = `${msg} — ${addr}`;
            toastEl.querySelector('strong').textContent = msg;
            toastEl.onclick = (e) => {
                if (e.target.closest('.btn-close')) return;
                map.flyTo([lat, lng], 13);
                toast.hide();
                if (nodeLayers[nodeId]) {
                    selectedNodeLayer = { circle: nodeLayers[nodeId].circle, data: nodeLayers[nodeId].data };
                    nodeLayers[nodeId].circle.setStyle({ weight: 6, dashArray: '12' });
                } else if (markerLayers[nodeId]) {
                    selectedNodeLayer = { marker: markerLayers[nodeId], data: markerLayers[nodeId].data };
                }
                if (selectedNodeLayer) { fetchIntersectionDetails(lat, lng); updateUIElements(selectedNodeLayer.data); openNodePanel(); }
            };
            toast.show();
            refreshDrawer();
        })
        .catch(() => toast.show());
}

function viewAllNotifications() {
    if (selectedNodeLayer?.data?.node_id) {
        window.location.href = `../pages/notifications.html?node_id=${selectedNodeLayer.data.node_id}`;
    } else {
        alert('Please select a node first to view its notifications.');
    }
}

// ── Color by density ─────────────────────────────────────────
function getColorByDensity(density) {
    if (density > 50) return '#ef4444';
    if (density > 20) return '#f59e0b';
    return '#00c48c';
}

// ── Governorate selector ──────────────────────────────────────
document.getElementById('governorateSelect').addEventListener('change', function () {
    const searchName = {
        bardo: 'Bardo, Tunis, Tunisia',
        manouba: 'Manouba, Tunisia',
        Carthage: 'Carthage, Tunisia',
        'ben arous': 'Ben Arous, Tunisia',
        nabeul: 'Nabeul, Tunisia',
        benzart: 'Bizerte, Tunisia',
        sousse: 'Sousse, Tunisia',
        sfax: 'Sfax, Tunisia'
    }[this.value];

    if (!searchName) return;
    this.disabled = true;
    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchName)}&limit=1`)
        .then(r => r.json())
        .then(data => {
            if (data && data.length > 0) {
                map.flyTo([parseFloat(data[0].lat), parseFloat(data[0].lon)], 13, { duration: 1.8 });
            }
        })
        .catch(console.error)
        .finally(() => { this.disabled = false; });
});
