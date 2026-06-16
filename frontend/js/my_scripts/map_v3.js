// ------------------------------------------------ Initialize the map -----------------------------------------------
// ------------------------------------------------ Initialize the map -----------------------------------------------
let map = L.map('map', {
    zoomControl: true,
    attributionControl: false   // hide attribution entirely
}).setView([36.602575, 10.122528], 9);


if (typeof window.initMapWithTheme === 'function') {
    window.initMapWithTheme(map);
} else {
    // Fallback in case theme.js loads after
    console.warn("initMapWithTheme not found, using default light tiles");
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors'
    }).addTo(map);
}

// ------------------------------------------------ Initializations ---------------------------------------------------
//## IP address of the backend server

let ipAdress = "192.168.100.6";

//## marker icon
const customIcon = L.icon({
    iconUrl: '../img/marker.png',
    iconSize: [36, 36],
    iconAnchor: [16, 32],
    popupAnchor: [0, -32]
});

//## Nodes and layers management
let nodeLayers = {};
let markerLayers = {};
let selectedNodeLayer = null;
let previouslySelectedCircle = null;
const DATA_TIMEOUT = 5000;
let lastNodeId = 0; // Track the last node ID for polling
let recentAlerts = {}; // Store the latest alert per node_id
let ws = null; 
let recenteredNodes = new Set(); // Track nodes that have been recentered
let selectedIntersectionCapacity = 100;
const badge = document.getElementById('status-badge');
let totalNodes = 0;
let connectedNodes = 0;

//## Debounce utility for UI updates
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

//## Debounced updateUIElements
const debouncedUpdateUIElements = debounce(updateUIElements, 300);


//## Initial fetch to display all intersections with markers ##
fetch(`http://${ipAdress}:5000/get_intersections`)
    .then(response => response.json())
    .then(data => {
        console.log("Initial intersections:", data);
        data.forEach(intersection => {
            const nodeId = parseInt(intersection.node_id);
            console.log(`Creating initial marker for node ${nodeId}`);
            markerLayers[nodeId] = createMarkerLayer(intersection.latitude, intersection.longitude, { node_id: nodeId, latitude: intersection.latitude, longitude: intersection.longitude });
            if (nodeId > lastNodeId) {
                lastNodeId = nodeId;
            }
        });
        console.log(`Starting polling and WebSocket connection`);
        totalNodes = data.length;        
        updateNodeCount();
        selectDefaultNode();
        updateAlertWidget();
        startPolling();
        connectWebSocket();
    })
    .catch(error => console.error("Error fetching initial intersections:", error));


// --------------------------------------------- Polling for Node Updates ---------------------------------------
function startPolling() {
    function poll() {
        console.log(`Polling for node updates with last_node_id=${lastNodeId}`);
        // Poll for new nodes
        fetch(`http://${ipAdress}:5000/poll_new_nodes?last_node_id=${lastNodeId}`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("Poll new nodes response:", data);
                if (data && data.length > 0) {
                    data.forEach(intersection => {
                        const nodeId = intersection.node_id;
                        // Only create a marker if no circle exists
                        if (!nodeLayers[nodeId] && !markerLayers[nodeId]) {
                            console.log(`Creating marker for new node ${nodeId} via polling`);
                            markerLayers[nodeId] = createMarkerLayer(intersection.latitude, intersection.longitude, { node_id: nodeId, latitude: intersection.latitude, longitude: intersection.longitude });
                            if (nodeId > lastNodeId) {
                                lastNodeId = nodeId;
                            }
                            console.log(`Node ${nodeId} already exists or is active, skipping marker creation`);
                        }
                    });
                }
            })
            .catch(error => console.error("Error polling new nodes:", error));

        // Poll for all intersections to check for updates
        fetch(`http://${ipAdress}:5000/get_intersections`)
            .then(response => {
                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }
                return response.json();
            })
            .then(data => {
                console.log("Poll intersections response:", data);
                totalNodes = data.length;     
                updateNodeCount();
                data.forEach(intersection => {
                    const nodeId = intersection.node_id;
                    if (markerLayers[nodeId]) {
                        const currentLatLng = markerLayers[nodeId].getLatLng();
                        if (Math.abs(currentLatLng.lat - intersection.latitude) > 0.0001 ||
                            Math.abs(currentLatLng.lng - intersection.longitude) > 0.0001) {
                            console.log(`Updating marker for node ${nodeId} via polling`);
                            markerLayers[nodeId].setLatLng([intersection.latitude, intersection.longitude]);
                            markerLayers[nodeId].data.latitude = intersection.latitude;
                            markerLayers[nodeId].data.longitude = intersection.longitude;
                            if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId && !recenteredNodes.has(nodeId)) {
                                map.setView([intersection.latitude, intersection.longitude], map.getZoom());
                                recenteredNodes.add(nodeId);
                                setTimeout(() => recenteredNodes.delete(nodeId), 10000);
                                console.log(`Recentered map for selected node ${nodeId} via polling`);
                            }
                            if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId) {
                                fetchIntersectionDetails(intersection.latitude, intersection.longitude);
                                debouncedUpdateUIElements(markerLayers[nodeId].data);
                            }
                        }
                    }
                    if (nodeLayers[nodeId]) {
                        const currentLatLng = nodeLayers[nodeId].circle.getLatLng();
                        if (Math.abs(currentLatLng.lat - intersection.latitude) > 0.0001 ||
                            Math.abs(currentLatLng.lng - intersection.longitude) > 0.0001) {
                            console.log(`Updating circle for node ${nodeId} via polling`);
                            nodeLayers[nodeId].circle.setLatLng([intersection.latitude, intersection.longitude]);
                            nodeLayers[nodeId].data.latitude = intersection.latitude;
                            nodeLayers[nodeId].data.longitude = intersection.longitude;
                            if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId && !recenteredNodes.has(nodeId)) {
                                map.setView([intersection.latitude, intersection.longitude], map.getZoom());
                                recenteredNodes.add(nodeId);
                                setTimeout(() => recenteredNodes.delete(nodeId), 10000);
                                console.log(`Recentered map for selected node ${nodeId} via polling`);
                            }
                            if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId) {
                                fetchIntersectionDetails(intersection.latitude, intersection.longitude);
                                debouncedUpdateUIElements(nodeLayers[nodeId].data);
                            }
                        }
                    }
                });
                setTimeout(poll, 30000);
            })
            .catch(error => {
                console.error("Error polling intersections:", error);
                setTimeout(poll, 5000);
            });
    }
    poll();
}

// --------------------------------------------- WebSocket connection ---------------------------------------
function connectWebSocket() {
    // ws = new WebSocket(`ws://${ipAdress}:5000/ws`);
    ws = new WebSocket(`ws://${ipAdress}:8766`);
    
    ws.onopen = () => {
        console.log("Connected to WebSocket server");
        badge.textContent = 'System Live';
        badge.classList.remove('disconnected');
        badge.classList.add('connected');
    }
    
    ws.onmessage = function(event) {
        let data = JSON.parse(event.data);
        console.log("Received WebSocket data:", data);

        if (data.message_type === "new_node" || data.message_type === "node_update") {
            data.node_id = parseInt(data.node_id);  
        }
        if (data.message_type === "data") {
            updateNodeData(data);
        } else if (data.message_type === "notif") {
            showTrafficNotification(data);
        } else if (data.message_type === "new_node") {
            connectedNodes = Object.keys(nodeLayers).length;
            updateNodeCount();
            const nodeId = data.node_id;
            const newLat = data.latitude;
            const newLng = data.longitude;
            console.log(`Processing new_node for node ${nodeId} at lat=${newLat}, lng=${newLng}`);

            // Only create a marker if no circle exists (i.e., node is not active)
            if (!nodeLayers[nodeId]) {
                if (markerLayers[nodeId]) {
                    console.log(`Updating existing marker for node ${nodeId}`);
                    markerLayers[nodeId].setLatLng([newLat, newLng]);
                    markerLayers[nodeId].data.latitude = newLat;
                    markerLayers[nodeId].data.longitude = newLng;
                } else {
                    console.log(`Creating new marker for node ${nodeId}`);
                    markerLayers[nodeId] = createMarkerLayer(newLat, newLng, { node_id: nodeId, latitude: newLat, longitude: newLng });
                }
            } else {
                console.log(`Node ${nodeId} is already active with a circle, skipping marker creation`);
            }

            if (nodeId > lastNodeId) {
                lastNodeId = nodeId;
            }

            // Show notification for new node
            showNodeNotification(data, "new_node");

            if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId && !recenteredNodes.has(nodeId)) {
                map.setView([newLat, newLng], map.getZoom());
                recenteredNodes.add(nodeId);
                setTimeout(() => recenteredNodes.delete(nodeId), 10000);
                console.log(`Recentered map for new node ${nodeId}`);
            }

            map.invalidateSize();

            if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId) {
                selectedNodeLayer.data.latitude = newLat;
                selectedNodeLayer.data.longitude = newLng;
                fetchIntersectionDetails(newLat, newLng);
                debouncedUpdateUIElements(selectedNodeLayer.data);
            }
        } else if (data.message_type === "node_update") {
            const nodeId = data.node_id;
            const newLat = data.latitude;
            const newLng = data.longitude;
            console.log(`Received node_update for node ${nodeId}: lat=${newLat}, lng=${newLng}`);

            if (markerLayers[nodeId]) {
                console.log(`Updating marker position for node ${nodeId}`);
                markerLayers[nodeId].setLatLng([newLat, newLng]);
                markerLayers[nodeId].data.latitude = newLat;
                markerLayers[nodeId].data.longitude = newLng;
            }

            if (nodeLayers[nodeId]) {
                console.log(`Updating circle position for node ${nodeId}`);
                nodeLayers[nodeId].circle.setLatLng([newLat, newLng]);
                nodeLayers[nodeId].data.latitude = newLat;
                nodeLayers[nodeId].data.longitude = newLng;
            }

            // Show notification for updated node
            showNodeNotification(data, "node_update");

            if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId && !recenteredNodes.has(nodeId)) {
                map.setView([newLat, newLng], map.getZoom());
                recenteredNodes.add(nodeId);
                setTimeout(() => recenteredNodes.delete(nodeId), 10000);
                console.log(`Recentered map for updated node ${nodeId}`);
            }

            map.invalidateSize();

            if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId) {
                selectedNodeLayer.data.latitude = newLat;
                selectedNodeLayer.data.longitude = newLng;
                fetchIntersectionDetails(newLat, newLng);
                debouncedUpdateUIElements(selectedNodeLayer.data);
            }
        } else {
            console.error('Invalid data received:', data);
        }
    };
    
    ws.onclose = function(event) {
        badge.textContent = 'System Disconnected';
        badge.classList.remove('connected');
        badge.classList.add('disconnected');
        console.warn("WebSocket connection closed:", event);
        setTimeout(connectWebSocket, 8766);
    };
    
    ws.onerror = function(error) {
        console.error("WebSocket error:", error);
        ws.close();
        badge.textContent = 'System Disconnected';
        badge.classList.remove('connected');
        badge.classList.add('disconnected');
    };
}

// ----------------------------------- layers and nodes management ----------------------------------------------
function updateNodeData(data) {
    const nodeId = parseInt(data.node_id);
    data.node_id = nodeId;
    const lat = data.latitude;
    const lng = data.longitude;

    // Calculate average density for color
    const laneKeys = Object.keys(data || {})
        .filter(key => key.startsWith("voie_"))
        .sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));
    const densityValues = [];
    laneKeys.forEach(laneKey => {
        const laneNumber = laneKey.split("_")[1];
        const counter = data[laneKey] || 0;
        const speedKey = `avg_speed_${laneNumber}`;
        let speed = data[speedKey] || 0;
        if (laneKeys.length === 1 && data.avg_speed !== undefined && data.avg_speed !== null) {
            speed = data.avg_speed;
        }
        const density = speed > 0 ? (counter / speed) : 0.0;
        densityValues.push(density);
    });
    const avgDensity = densityValues.length > 0 
        ? densityValues.reduce((sum, d) => sum + d, 0) / densityValues.length 
        : 0.0;
    const color = getColorByDensity(avgDensity);

    if (!nodeLayers[nodeId]) {
        console.log(`Creating circle for node ${nodeId}`);
        nodeLayers[nodeId] = createCircleLayer(lat, lng, color, data);
        // Remove any existing marker
        if (markerLayers[nodeId]) {
            console.log(`Removing marker for node ${nodeId}`);
            map.removeLayer(markerLayers[nodeId]);
            delete markerLayers[nodeId];
        }
        connectedNodes = Object.keys(nodeLayers).length;  
        updateNodeCount();
    } else {
        console.log(`Updating circle for node ${nodeId} to lat=${lat}, lng=${lng}`);
        nodeLayers[nodeId].circle.setLatLng([lat, lng]);
        nodeLayers[nodeId].data.latitude = lat;
        nodeLayers[nodeId].data.longitude = lng;
        updateCircleLayer(nodeId, color, data);
        connectedNodes = Object.keys(nodeLayers).length;   
        updateNodeCount();
    }

    // Reset timeout for node activity
    clearTimeout(nodeLayers[nodeId].timeout);
    nodeLayers[nodeId].timeout = setTimeout(() => {
        console.log(`Node ${nodeId} inactive, removing circle`);
        map.removeLayer(nodeLayers[nodeId].circle);
        delete nodeLayers[nodeId];
        connectedNodes = Object.keys(nodeLayers).length;   
        updateNodeCount();
        // Only create a marker if no circle exists
        if (!markerLayers[nodeId]) {
            console.log(`Creating new marker for node ${nodeId}`);
            markerLayers[nodeId] = createMarkerLayer(lat, lng, data);
        } else {
            console.log(`Restoring marker for node ${nodeId}`);
            map.addLayer(markerLayers[nodeId]);
        }
    }, DATA_TIMEOUT);

    if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === nodeId) {
        selectedNodeLayer.data = { ...data, node_id: nodeId, latitude: lat, longitude: lng };
        fetchIntersectionDetails(lat, lng);
        debouncedUpdateUIElements(selectedNodeLayer.data);
    }

    map.invalidateSize();
}

function createCircleLayer(lat, lng, color, data) {
    data.node_id = parseInt(data.node_id);
    const circle = L.circle([lat, lng], {
        color: color,
        fillColor: color,
        fillOpacity: 0.4,
        radius: 200
    }).addTo(map);

    circle.on('click', function () {
        if (previouslySelectedCircle && previouslySelectedCircle !== circle) {
            previouslySelectedCircle.setStyle({ weight: 2, dashArray: null });
        }
        circle.setStyle({ weight: 6, dashArray: '12' });
        previouslySelectedCircle = circle;
        selectedNodeLayer = { circle, data };
        map.setView([lat, lng], 13);
        fetchIntersectionDetails(lat, lng);      // ← keep: populates hidden fields + triggers updateAlertsCard
        updateUIElements(data);                  // ← keep: populates hidden status-bar mirrors
        _openPopupWhenReady(data);               // ← NEW: open the node popup panel
        updateAlertWidget();
    });
    return { circle, data, timeout: null };
}

function updateCircleLayer(nodeId, color, data) {
    const { circle } = nodeLayers[nodeId];
    circle.setStyle({ color, fillColor: color });
    nodeLayers[nodeId].data = data;
}

function createMarkerLayer(lat, lng, data) {
    data.node_id = parseInt(data.node_id);
    const marker = L.marker([lat, lng], { icon: customIcon }).addTo(map);
    marker.data = data;
    marker.bindPopup(
        `<img src="../img/inactive.png" width="18px" height="18px"><b> inactive</b>`
    );
    marker.on('mouseover', () => marker.openPopup());
    marker.on('mouseout', () => marker.closePopup());
    marker.on('click', () => {
        selectedNodeLayer = { marker, data };
        map.setView([lat, lng], 12);
        fetchIntersectionDetails(lat, lng);
        updateUIElements(data || {});
        _openPopupWhenReady(data);   // ← NEW
        updateAlertWidget();
    });
    return marker;
}

function showTrafficNotification(data) {
    const toastEl = document.getElementById('dangerToast');
    const toast = bootstrap.Toast.getOrCreateInstance(toastEl);
    fetch(`http://${ipAdress}:5000/get_address?node_id=${data.node_id}`)
        .then(response => response.json())
        .then(recievedAddress => {
            if (recievedAddress.address) {
                console.log("notif here from ", data.node_id);
                console.log("notif here from ", recievedAddress.address);
                toastEl.querySelector('.toast-body').innerText = recievedAddress.address;
                const alert = {
                    node_id: data.node_id,
                    address: recievedAddress.address,
                    timestamp: new Date().toLocaleTimeString()
                };
                // Check if the alert content has changed
                const prevAlert = recentAlerts[data.node_id];
                const alertChanged = !prevAlert || prevAlert.address !== alert.address || prevAlert.timestamp !== alert.timestamp;
                recentAlerts[data.node_id] = alert;

                if (selectedNodeLayer && Number(selectedNodeLayer.data.node_id) === Number(data.node_id)) {
                    if (alertChanged) {
                        updateAlertsCard();
                    } else {
                        updateAlertsCount();
                    }
                    debouncedUpdateUIElements(selectedNodeLayer.data);
                }
            }
        })
        .catch(error => {
            console.error("Error fetching address:", error);
            toastEl.querySelector('.toast-body').innerText = "not found";
        });

    toast.show();
}

function showNodeNotification(data, messageType) {
    const toastEl = document.getElementById('nodeToast');
    if (!toastEl) {
        console.error("nodeToast element not found in HTML!");
        return;
    }

    const toast = bootstrap.Toast.getOrCreateInstance(toastEl);
    const nodeId = parseInt(data.node_id);
    const lat = parseFloat(data.latitude);
    const lng = parseFloat(data.longitude);

    const message = messageType === 'new_node' ? 'New node added' : 'Node activated';

    // Fetch address
    fetch(`http://${ipAdress}:5000/get_address?node_id=${nodeId}`)
        .then(response => response.json())
        .then(recievedAddress => {
            let bodyText = `${message} at unknown location`;
            if (recievedAddress.address) {
                bodyText = `${message} at ${recievedAddress.address}`;
            }

            toastEl.querySelector('.toast-body').innerText = bodyText;
            toastEl.querySelector('strong').innerText = message;

            // Click handler to jump to node
            toastEl.onclick = (event) => {
                if (event.target.closest('.btn-close')) return;
                
                map.flyTo([lat, lng], 13, {duration: 1.8,easeLinearity: 0.25});
                toast.hide();

                // Select the node
                if (nodeLayers[nodeId]) {
                    selectedNodeLayer = { circle: nodeLayers[nodeId].circle, data: nodeLayers[nodeId].data };
                    nodeLayers[nodeId].circle.setStyle({ weight: 6, dashArray: '12' });
                } else if (markerLayers[nodeId]) {
                    selectedNodeLayer = { marker: markerLayers[nodeId], data: markerLayers[nodeId].data };
                }

                if (selectedNodeLayer) {
                    fetchIntersectionDetails(lat, lng);
                    updateUIElements(selectedNodeLayer.data);
                    updateAlertWidget();
                }
            };

            toast.show();
        })
        .catch(err => {
            console.error("Address fetch failed:", err);
            toastEl.querySelector('.toast-body').innerText = `${message} at unknown location`;
            toast.show();
        });
}

function updateAlertsCard() {
    const alertsContainer = document.getElementById('alerts_container');
    const alertsCountContainer = document.getElementById('alerts-count');
    alertsContainer.innerHTML = '';
    alertsCountContainer.innerHTML = '';

    if (!selectedNodeLayer) {
        alertsContainer.innerHTML = `<span class="text-sm">No alerts available</span>`;
        alertsCountContainer.innerHTML = `<p class="mb-0 text-sm"><span class="text-danger font-weight-bolder">0 alerts</span> today</p>`;
        updateAlertWidget();
        return;
    }

    const nodeId = selectedNodeLayer.data.node_id;
    const today = new Date().toISOString().split('T')[0];
    fetch(`http://${ipAdress}:5000/get_notifications_count?node_id=${nodeId}&date=${today}`)
        .then(response => response.json())
        .then(data => {
            const alertCount = data.count || 0;
            const alertText = alertCount === 1 ? 'alert' : 'alerts';
            const alert = recentAlerts[nodeId];
            alertsContainer.innerHTML = alert
                ? `<span class="text-sm"><strong class="text-danger">${alert.timestamp}</strong>: ${alert.address}</span>`
                : `<span class="text-sm">No alerts available</span>`;
            alertsCountContainer.innerHTML = `<p class="mb-0 text-sm"><span class="text-danger font-weight-bolder">${alertCount} ${alertText}</span> today</p>`;
            updateAlertWidget();
        })
        .catch(error => {
            console.error("Error fetching notification count:", error);
            alertsContainer.innerHTML = `<span class="text-sm">Error loading alerts</span>`;
            alertsCountContainer.innerHTML = `<p class="mb-0 text-sm"><span class="text-danger font-weight-bolder">0 alerts</span> today</p>`;
            updateAlertWidget();
        });
}

function updateAlertsCount() {
    const alertsCountContainer = document.getElementById('alerts-count');
    if (!selectedNodeLayer) {
        alertsCountContainer.innerHTML = `<p class="mb-0 text-sm"><span class="text-danger font-weight-bolder">0 alerts</span> today</p>`;
        return;
    }

    const nodeId = selectedNodeLayer.data.node_id;
    const today = new Date().toISOString().split('T')[0];
    fetch(`http://${ipAdress}:5000/get_notifications_count?node_id=${nodeId}&date=${today}`)
        .then(response => response.json())
        .then(data => {
            const alertCount = data.count || 0;
            const alertText = alertCount === 1 ? 'alert' : 'alerts';
            alertsCountContainer.innerHTML = `<p class="mb-0 text-sm"><span class="text-danger font-weight-bolder">${alertCount} ${alertText}</span> today</p>`;
        })
        .catch(error => {
            console.error("Error fetching notification count:", error);
            alertsCountContainer.innerHTML = `<p class="mb-0 text-sm"><span class="text-danger font-weight-bolder">0 alerts</span> today</p>`;
        });
}

function updateNodeCount() {
    const nodeCountEl = document.getElementById('node-count');
    if (nodeCountEl) {
        nodeCountEl.textContent = `${connectedNodes}/${totalNodes}`;
    }
}

function updateUIElements(data) {
    // Get and sort lane keys
    const laneKeys = Object.keys(data || {})
        .filter(key => key.startsWith("voie_"))
        .sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));

    // ==================== DENSITY - Horizontal Bars ====================
    const densityContainer = document.getElementById('vehicle_present');
    densityContainer.innerHTML = "";

    laneKeys.forEach(laneKey => {
        const laneNumber = laneKey.split("_")[1];
        const counter = data[laneKey] || 0;
        const speedKey = `avg_speed_${laneNumber}`;
        let speed = data[speedKey] || 0;
        if (laneKeys.length === 1 && data.avg_speed !== undefined && data.avg_speed !== null) {
            speed = data.avg_speed;
        }
        const density = speed > 0 ? (counter / speed) : 0;
        const densityPercent = Math.min(Math.max(density * 6, 0), 100); // Visual scaling

        const densityClass = density > 40 ? 'density-high' : density > 15 ? 'density-med' : 'density-low';

        const barHTML = `
            <div class="stat-bar">
                <span class="lane-label">L${laneNumber}</span>
                <div class="bar-wrapper">
                    <div class="bar ${densityClass}" style="width: ${densityPercent}%"></div>
                </div>
                <span class="bar-label">${density.toFixed(1)}</span>
            </div>
        `;
        densityContainer.innerHTML += barHTML;
    });

    // ==================== AVG SPEED ====================
    const speedsContainer = document.getElementById("speeds_container");
    speedsContainer.innerHTML = "";

    laneKeys.forEach(laneKey => {
        const laneNumber = laneKey.split("_")[1];
        let speedValue = data[`avg_speed_${laneNumber}`];
        if (laneKeys.length === 1 && data.avg_speed !== undefined && data.avg_speed !== null) {
            speedValue = data.avg_speed;
        }

        const div = document.createElement("div");
        div.className = "stat-bar";
        div.innerHTML = `
            <span class="lane-label">L${laneNumber}</span>
            <i class="fa-solid fa-gauge-high" style="color: var(--green); width: 22px; font-size: 15px;"></i>
            <span class="bar-label">${speedValue ? Math.round(speedValue) : '—'} <small>km/h</small></span>
        `;
        speedsContainer.appendChild(div);
    });

    // ==================== PASSED VEHICLES ====================
    const vehiclesContainer = document.getElementById("lanes_container");
    vehiclesContainer.innerHTML = "";

    laneKeys.forEach(laneKey => {
        const laneNumber = laneKey.split("_")[1];
        const count = data[laneKey] || 0;

        const div = document.createElement("div");
        div.className = "stat-bar";
        div.innerHTML = `
            <span class="lane-label">L${laneNumber}</span>
            <i class="fa-solid fa-car-side" style="color: var(--accent); width: 22px; font-size: 15px;"></i>
            <span class="bar-label">${count}</span>
        `;
        vehiclesContainer.appendChild(div);
    });

    // ==================== FOOTER UPDATES (unchanged) ====================
    const densityValues = laneKeys.map(laneKey => {
        const laneNumber = laneKey.split("_")[1];
        const counter = data[laneKey] || 0;
        const speedKey = `avg_speed_${laneNumber}`;
        let speed = data[speedKey] || 0;
        if (laneKeys.length === 1 && data.avg_speed !== undefined && data.avg_speed !== null) {
            speed = data.avg_speed;
        }
        return speed > 0 ? parseFloat((counter / speed).toFixed(1)) : 0;
    });

    // Update flow-footer
    const speedFooter = document.getElementById('flow-footer');
    let speeds = laneKeys.map(key => data[`avg_speed_${key.split('_')[1]}`] || 0);
    if (laneKeys.length === 1 && data.avg_speed !== undefined) {
        speeds = [data.avg_speed];
    }
    const avgSpeed = speeds.length > 0 ? speeds.reduce((sum, s) => sum + s, 0) / speeds.length : 0;
    let flowStatus = avgSpeed > 60 ? 'smooth' : avgSpeed > 30 ? 'moderate' : 'congested';
    let flowColor = avgSpeed > 60 ? 'text-success' : avgSpeed > 30 ? 'text-warning' : 'text-danger';
    speedFooter.innerHTML = `<span class="${flowColor} font-weight-bolder">${flowStatus} </span>traffic flow`;

    // Update activity-footer
    const activityFooter = document.getElementById('activity-footer');
    const totalPassed = laneKeys.reduce((sum, key) => sum + (data[key] || 0), 0);
    let activityStatus = totalPassed > 100 ? 'Active' : totalPassed > 50 ? 'Moderate' : 'Quiet';
    let activityColor = totalPassed > 100 ? 'text-danger' : totalPassed > 50 ? 'text-warning' : 'text-success';
    activityFooter.innerHTML = `<span class="${activityColor} font-weight-bolder">${activityStatus} </span>area today`;

    // Update density footer
    const densityFooter = document.getElementById('density-footer');
    const sumDensity = densityValues.length > 0 ? densityValues.reduce((sum, d) => sum + d, 0).toFixed(1) : "0.0";
    const totalCapacity = selectedIntersectionCapacity * laneKeys.length;
    const densityPercentage = totalCapacity > 0 ? ((sumDensity / totalCapacity) * 100).toFixed(0) : 0;
    let densityStatus = densityPercentage > 80 ? 'High' : densityPercentage > 40 ? 'Moderate' : 'Low';
    let densityColor = densityPercentage > 80 ? 'text-danger' : densityPercentage > 40 ? 'text-warning' : 'text-success';
    densityFooter.innerHTML = `<span class="${densityColor} font-weight-bolder">${densityPercentage}% </span>${densityStatus} density`;

    // Popup panel sync (keep your existing logic)
    if (
        document.getElementById('nodePopupPanel') &&
        document.getElementById('nodePopupPanel').classList.contains('active') &&
        selectedNodeLayer
    ) {
        const addrEl = document.getElementById('intersection-name');
        const address = addrEl ? addrEl.textContent : '';
        if (typeof window.openNodePopup === 'function') {
            window.openNodePopup({ ...selectedNodeLayer.data, capacity: selectedIntersectionCapacity }, address);
        }
    }
}

function fetchIntersectionDetails(lat, lng) {
    fetch(`http://${ipAdress}:5000/get_intersection_info?lat=${lat}&lng=${lng}`)
        .then(response => response.json())
        .then(data => {
            selectedIntersectionCapacity = data.capacity;
            document.getElementById("intersection-name").innerText = data.address || "Unknown Location";
            document.getElementById("cam-number").innerText = data.cams || "Unknown";
            document.getElementById("lanes-number").innerText = data.total_lanes || "Unknown";
            document.getElementById("capacity").innerText = data.capacity || "Unknown";
            document.getElementById("stream_intersection_name").innerText = data.address || "Unknown";
            document.getElementById("stats_stream_intersection_name").innerText = data.address || "Unknown";
            if (selectedNodeLayer) {
                selectedNodeLayer.data.capacity = data.capacity;
                debouncedUpdateUIElements(selectedNodeLayer.data);
                updateAlertsCard();
            }
        })
        .catch(error => {
            console.error("Error fetching traffic data:", error);
        });
}

function getColorByDensity(density) {
    if (density > 50) return 'red';
    else if (density > 20) return 'orange';
    else return 'green';
}

function viewAllNotifications() {
    if (selectedNodeLayer && selectedNodeLayer.data && selectedNodeLayer.data.node_id) {
        const nodeId = selectedNodeLayer.data.node_id;
        window.location.href = `../pages/notifications.html?node_id=${nodeId}`;
    } else {
        alert("Please select a node first to view its notifications.");
    }
}

function getSelectedNodeId() {
    return selectedNodeLayer && selectedNodeLayer.data && selectedNodeLayer.data.node_id ? selectedNodeLayer.data.node_id : null;
}

function selectNodeById(nodeId) {
    const activeLayer = nodeLayers[nodeId];
    const inactiveMarker = markerLayers[nodeId];
    if (!activeLayer && !inactiveMarker) return false;

    if (previouslySelectedCircle && previouslySelectedCircle !== (activeLayer && activeLayer.circle)) {
        previouslySelectedCircle.setStyle({ weight: 2, dashArray: null });
        previouslySelectedCircle = null;
    }

    if (activeLayer) {
        selectedNodeLayer = { circle: activeLayer.circle, data: activeLayer.data };
        activeLayer.circle.setStyle({ weight: 6, dashArray: '12' });
        previouslySelectedCircle = activeLayer.circle;
    } else {
        selectedNodeLayer = { marker: inactiveMarker, data: inactiveMarker.data };
    }

    const lat = selectedNodeLayer.data.latitude;
    const lng = selectedNodeLayer.data.longitude;
    if (lat && lng) {
        map.setView([lat, lng], 13);
        fetchIntersectionDetails(lat, lng);
        updateUIElements(selectedNodeLayer.data);
        _openPopupWhenReady(selectedNodeLayer.data);
        updateAlertWidget();
    }
    return true;
}

function selectDefaultNode() {
    if (selectedNodeLayer) return;
    const activeIds = Object.keys(nodeLayers).map(Number).sort((a, b) => a - b);
    if (activeIds.length > 0) {
        return selectNodeById(activeIds[0]);
    }
    const inactiveIds = Object.keys(markerLayers).map(Number).sort((a, b) => a - b);
    if (inactiveIds.length > 0) {
        return selectNodeById(inactiveIds[0]);
    }
    return false;
}

function isSelectedNodeActive() {
    const nodeId = getSelectedNodeId();
    return nodeId !== null && nodeLayers[nodeId] && nodeLayers[nodeId].circle;
}

function renderAlertWidgetPlaceholder(message, submessage = "") {
    if (!alertListEl) return;
    alertListEl.innerHTML = `
        <div class="alert-widget-empty">
            <div>${message}</div>
            ${submessage ? `<div style="margin-top:6px;font-size:11px;">${submessage}</div>` : ''}
        </div>
    `;
}

function clearAlertWidgetStream() {
    if (!alertListEl) return;
    alertListEl.innerHTML = '';
    alertWidgetStreamFrame = null;
    alertWidgetCameraOptions = null;
}

function setAlertWidgetStream(url, cameraName = "Camera 1") {
    if (!alertListEl) return;
    if (!alertWidgetStreamFrame) {
        alertListEl.innerHTML = `
                <div class="alert-stream-card">
                    <iframe id="alertWidgetStreamFrame" src="" title="Node stream preview" allowfullscreen
                        style="border:0;width:100%;height:100%;display:block;pointer-events:none;"></iframe>
                </div>
            `;
        alertWidgetStreamFrame = document.getElementById('alertWidgetStreamFrame');
    }
    if (alertWidgetStreamFrame) {
        alertWidgetStreamFrame.src = url || "about:blank";
    }
}

function updateAlertWidget() {
    if (!alertListEl) return;

    const nodeId = getSelectedNodeId();

    // If no node or node is inactive, clear any existing stream first, then show message
    if (!nodeId) {
        clearAlertWidgetStream();
        if (selectDefaultNode()) return;
        renderAlertWidgetPlaceholder("No node selected.", "Select a node on the map to start live streaming.");
        return;
    }

    if (!isSelectedNodeActive()) {
        clearAlertWidgetStream();
        renderAlertWidgetPlaceholder(`Node ${nodeId} is inactive.`, "Live stream is unavailable until the node becomes active.");
        return;
    }

    // Only skip reload if the stream is already showing for the same active node
    if (alertWidgetStreamFrame && alertWidgetStreamFrame.src && alertWidgetStreamFrame.src !== "about:blank") return;

    renderAlertWidgetPlaceholder(`Loading live stream for node ${nodeId}...`);
    fetchCamerasForNode(nodeId, { mode: 'widget' });
}

const alertListEl = document.getElementById('alert-list');
let alertWidgetStreamFrame = null;
let alertWidgetCameraOptions = null;

const alertWidgetEl = document.getElementById('alert-widget');
if (alertWidgetEl) {
    alertWidgetEl.addEventListener('click', () => {
        if (!selectedNodeLayer || !selectedNodeLayer.data.node_id) return;
        if (!isSelectedNodeActive()) return;
        document.getElementById('openModalBtn').click();
    });
}

// -------------stream------------------ 
// ==================== STREAM MODAL LOGIC ====================
const streamModalEl = document.getElementById('streamModal');
const streamModal = new bootstrap.Modal(streamModalEl);
const streamFrame = document.getElementById('streamFrame');
const cameraSelector = document.getElementById('cameraSelector');
const streamIntersectionName = document.getElementById('stream_intersection_name');

let currentNodeId = null;

// Open Stream Button
document.getElementById('openModalBtn').onclick = function () {
    if (!selectedNodeLayer || !selectedNodeLayer.data.node_id) {
        showToast("Please select a node first", "warning");
        return;
    }

    currentNodeId = selectedNodeLayer.data.node_id;
    streamIntersectionName.textContent = document.getElementById('intersection-name').textContent || "Selected Node";

    // Reset modal
    cameraSelector.innerHTML = '<option value="" disabled selected>Loading cameras...</option>';
    streamFrame.src = "";

    streamModal.show();
    fetchCamerasForNode(currentNodeId);
};

// Close modal - clean up
streamModalEl.addEventListener('hidden.bs.modal', function () {
    streamFrame.src = "";           // Stop stream
    cameraSelector.innerHTML = '<option value="" disabled selected>Select a camera</option>';
    currentNodeId = null;
});

// Fetch cameras for the selected node
function fetchCamerasForNode(nodeId, options = {}) {
    const widgetMode = options.mode === 'widget';
    return fetch(`http://${ipAdress}:5000/get_node_cams?node_id=${nodeId}`)
        .then(response => {
            if (!response.ok) throw new Error("Failed to fetch cameras");
            return response.json();
        })
        .then(cams => {
            if (widgetMode) {
                if (cams && cams.length > 0) {
                    const firstCamUrl = cams[0].ip_address || cams[0].url || "";
                    const cameraName = cams[0].name || `Camera 1`;
                    if (firstCamUrl) {
                        setAlertWidgetStream(firstCamUrl, cameraName);
                    } else {
                        renderAlertWidgetPlaceholder(`No valid camera URL found for node ${nodeId}.`, "Open the stream modal to verify camera configuration.");
                    }
                } else {
                    renderAlertWidgetPlaceholder(`No cameras available for node ${nodeId}.`, "Open the stream modal to check available feeds.");
                }
            }

            if (!widgetMode) {
                cameraSelector.innerHTML = '<option value="" disabled selected>Select a camera</option>';

                if (cams && cams.length > 0) {
                    cams.forEach((cam, index) => {
                        const option = document.createElement('option');
                        option.value = cam.ip_address || cam.url || "";   // adjust if your backend field name is different
                        option.textContent = cam.name || `Camera ${index + 1}`;
                        cameraSelector.appendChild(option);
                    });
                } else {
                    const option = document.createElement('option');
                    option.value = "";
                    option.textContent = "No cameras available";
                    option.disabled = true;
                    cameraSelector.appendChild(option);
                }
            }

            return cams;
        })
        .catch(err => {
            console.error("Failed to fetch cameras:", err);
            if (widgetMode) {
                renderAlertWidgetPlaceholder(`Unable to load stream for node ${nodeId}.`, "Try again later or open the stream modal.");
            } else {
                cameraSelector.innerHTML = '<option value="" disabled selected>Error loading cameras</option>';
            }
            return [];
        });
}

// Camera selection → load stream
cameraSelector.addEventListener('change', function () {
    const selectedUrl = this.value.trim();
    if (selectedUrl) {
        streamFrame.src = selectedUrl;
    } else {
        streamFrame.src = "";
    }
});

let chartInstance = null;
const myModal = document.getElementById('chartModal');
myModal.addEventListener('shown.bs.modal', function() {
    const nodeId = selectedNodeLayer.data.node_id;
    fetch(`http://${ipAdress}:5000/get_vehicle_count_by_day?node_id=${nodeId}`)
        .then(response => response.json())
        .then(data => {
            const labels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
            const counts = labels.map(day => {
                const dayData = data.find(item => item.weekday.trim() === day);
                return dayData ? dayData.median_count : 0;
            });

            const ctx = document.getElementById("chart-bars").getContext("2d");

            if (chartInstance) {
                chartInstance.destroy();
            }

            chartInstance = new Chart(ctx, {
                type: "bar",
                data: {
                    labels: labels,
                    datasets: [{
                        label: 'Median density',
                        data: counts,
                        tension: 0.4,
                        borderWidth: 0,
                        borderRadius: 4,
                        borderSkipped: false,
                        backgroundColor: "#43A047",
                        barThickness: 30
                    }]
                },
                options: {
                    responsive: false,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            display: true, 
                        },
                        tooltip: {
                            callbacks: {
                                label: function(context) {
                                    return `Median Vehicles: ${context.parsed.y}`;
                                }
                            }
                        }
                    },
                    scales: {
                        y: {
                            beginAtZero: true,
                            grid: {
                                drawBorder: false,
                                color: '#e5e5e5'
                            },
                            ticks: {
                                color: "#737373",
                                callback: function(value) {
                                    return value; 
                                }
                            },
                            title: {
                                display: true,
                                text: 'Median Vehicle Count',
                                color: '#737373'
                            }
                        },
                        x: {
                            grid: {
                                display: false,
                            },
                            ticks: {
                                color: '#737373'
                            },
                            title: {
                                display: true,
                                text: 'Weekday',
                                color: '#737373'
                            }
                        }
                    }
                }
            });
        })
        .catch(error => console.error('Error fetching data:', error));
});

function _openPopupWhenReady(data) {
    // fetchIntersectionDetails is async; give it a short grace period so the
    // popup receives the latest address already stored by that call.
    setTimeout(() => {
        const addrEl = document.getElementById('intersection-name');
        const address = addrEl ? addrEl.textContent : '';
        if (typeof window.openNodePopup === 'function') {
            // Merge capacity into data if it was fetched
            const enriched = { ...data, capacity: selectedIntersectionCapacity };
            window.openNodePopup(enriched, address);
        }
    }, 350); // 350 ms is enough for the fetch to resolve on a local network
}


// ─── NODE DRAWER ─────────────────────────────────
function populateNodeDrawer(nodesList) {
  const container = document.getElementById('ndList');
  if (!container) return;
  container.innerHTML = '';

  if (!nodesList || nodesList.length === 0) {
    container.innerHTML = `<div style="font-size:12px;color:var(--muted);padding:4px 0">No nodes found.</div>`;
    return;
  }

  nodesList.forEach(nodeId => {
    const layer = nodeLayers[nodeId] || null;
    const markerLayer = markerLayers[nodeId] || null;
    const data = layer ? layer.data : (markerLayer ? markerLayer.data : null);
    const isActive = !!layer;

    const badgeColor = isActive ? 'var(--green)' : 'var(--muted)';
    const badgeBg   = isActive ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)';
    const badgeText = isActive ? 'Active' : 'Inactive';

    const card = document.createElement('div');
    card.className = 'nd-card';
    card.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;">
        <span class="nd-card-badge" style="background:${badgeBg};color:${badgeColor}">${badgeText}</span>
        <span class="nd-card-id">N-${nodeId}</span>
      </div>
      <div class="nd-card-title">Node ${nodeId}</div>
      <div class="nd-card-meta"><i class="fa-solid fa-location-dot"></i> ${data ? `${parseFloat(data.latitude).toFixed(4)}, ${parseFloat(data.longitude).toFixed(4)}` : '—'}</div>
    `;
    card.onclick = () => {
      if (!selectNodeById(nodeId)) {
        const target = layer || markerLayer;
        if (!target) return;
        const lat = target.data?.latitude;
        const lng = target.data?.longitude;
        if (lat && lng) {
          map.setView([lat, lng], 14);
          selectedNodeLayer = layer
            ? { circle: layer.circle, data: layer.data }
            : { marker: markerLayer, data: markerLayer.data };
          fetchIntersectionDetails(lat, lng);
          updateUIElements(target.data || {});
          updateAlertWidget();
        }
      }
      // close drawer after selection
      document.getElementById('nodeDrawer').classList.remove('open');
    };
    container.appendChild(card);
  });
}

function refreshNodeDrawer() {
  // Collect all known node IDs (active circles + inactive markers)
  const allIds = new Set([
    ...Object.keys(nodeLayers).map(Number),
    ...Object.keys(markerLayers).map(Number)
  ]);
  const sorted = [...allIds].sort((a, b) => a - b);
  populateNodeDrawer(sorted);
}

// Toggle drawer via the node-count chip
const nodeCountChip = document.getElementById('nodeCountChip');
if (nodeCountChip) {
  nodeCountChip.addEventListener('click', () => {
    const drawer = document.getElementById('nodeDrawer');
    const isOpen = drawer.classList.toggle('open');
    if (isOpen) refreshNodeDrawer();
  });
}

// Close button inside drawer
const ndClose = document.getElementById('ndClose');
if (ndClose) {
  ndClose.addEventListener('click', (e) => {
    e.stopPropagation();
    document.getElementById('nodeDrawer').classList.remove('open');
  });
}

// Search filter
const ndSearch = document.getElementById('ndSearch');
if (ndSearch) {
  ndSearch.addEventListener('input', (e) => {
    const q = e.target.value.toLowerCase();
    const container = document.getElementById('ndList');
    container.querySelectorAll('.nd-card').forEach(card => {
      card.style.display = card.textContent.toLowerCase().includes(q) ? '' : 'none';
    });
  });
}   