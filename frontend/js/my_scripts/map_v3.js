// ------------------------------------------------ Initialize the map -----------------------------------------------
// ------------------------------------------------ Initialize the map -----------------------------------------------
let map = L.map('map', {
    zoomControl: true,
    attributionControl: true
}).setView([36.602575, 10.122528], 9);

// IMPORTANT: Do NOT add tile layer here anymore!
// We let theme.js handle it via initMapWithTheme()

// Call this after map is created
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
let ipAdress = "192.168.1.16";

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
                        } else {
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
                            if (selectedNodeLayer && selectedNodeLayer.data.node_id === nodeId && !recenteredNodes.has(nodeId)) {
                                map.setView([intersection.latitude, intersection.longitude], map.getZoom());
                                recenteredNodes.add(nodeId);
                                setTimeout(() => recenteredNodes.delete(nodeId), 10000);
                                console.log(`Recentered map for selected node ${nodeId} via polling`);
                            }
                            if (selectedNodeLayer && selectedNodeLayer.data.node_id === nodeId) {
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
                            if (selectedNodeLayer && selectedNodeLayer.data.node_id === nodeId && !recenteredNodes.has(nodeId)) {
                                map.setView([intersection.latitude, intersection.longitude], map.getZoom());
                                recenteredNodes.add(nodeId);
                                setTimeout(() => recenteredNodes.delete(nodeId), 10000);
                                console.log(`Recentered map for selected node ${nodeId} via polling`);
                            }
                            if (selectedNodeLayer && selectedNodeLayer.data.node_id === nodeId) {
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
    
    ws.onopen = () => console.log("Connected to WebSocket server");
    
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

            if (selectedNodeLayer && selectedNodeLayer.data.node_id === nodeId && !recenteredNodes.has(nodeId)) {
                map.setView([newLat, newLng], map.getZoom());
                recenteredNodes.add(nodeId);
                setTimeout(() => recenteredNodes.delete(nodeId), 10000);
                console.log(`Recentered map for new node ${nodeId}`);
            }

            map.invalidateSize();

            if (selectedNodeLayer && selectedNodeLayer.data.node_id === nodeId) {
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

            if (selectedNodeLayer && selectedNodeLayer.data.node_id === nodeId && !recenteredNodes.has(nodeId)) {
                map.setView([newLat, newLng], map.getZoom());
                recenteredNodes.add(nodeId);
                setTimeout(() => recenteredNodes.delete(nodeId), 10000);
                console.log(`Recentered map for updated node ${nodeId}`);
            }

            map.invalidateSize();

            if (selectedNodeLayer && selectedNodeLayer.data.node_id === nodeId) {
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
        console.warn("WebSocket connection closed:", event);
        setTimeout(connectWebSocket, 8766);
    };
    
    ws.onerror = function(error) {
        console.error("WebSocket error:", error);
        ws.close();
    };
}

// ----------------------------------- layers and nodes management ----------------------------------------------
function updateNodeData(data) {
    const nodeId = parseInt(data.node_id);
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
    } else {
        console.log(`Updating circle for node ${nodeId} to lat=${lat}, lng=${lng}`);
        nodeLayers[nodeId].circle.setLatLng([lat, lng]);
        nodeLayers[nodeId].data.latitude = lat;
        nodeLayers[nodeId].data.longitude = lng;
        updateCircleLayer(nodeId, color, data);
    }

    // Reset timeout for node activity
    clearTimeout(nodeLayers[nodeId].timeout);
    nodeLayers[nodeId].timeout = setTimeout(() => {
        console.log(`Node ${nodeId} inactive, removing circle`);
        map.removeLayer(nodeLayers[nodeId].circle);
        delete nodeLayers[nodeId];
        // Only create a marker if no circle exists
        if (!markerLayers[nodeId]) {
            console.log(`Creating new marker for node ${nodeId}`);
            markerLayers[nodeId] = createMarkerLayer(lat, lng, data);
        } else {
            console.log(`Restoring marker for node ${nodeId}`);
            map.addLayer(markerLayers[nodeId]);
        }
    }, DATA_TIMEOUT);

    if (selectedNodeLayer && selectedNodeLayer.data.node_id === nodeId) {
        selectedNodeLayer.data = { ...data, latitude: lat, longitude: lng };
        fetchIntersectionDetails(lat, lng);
        debouncedUpdateUIElements(selectedNodeLayer.data);
    }

    map.invalidateSize();
}

function createCircleLayer(lat, lng, color, data) {
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
    });
    return { circle, data, timeout: null };
}

function updateCircleLayer(nodeId, color, data) {
    const { circle } = nodeLayers[nodeId];
    circle.setStyle({ color, fillColor: color });
    nodeLayers[nodeId].data = data;
}

function createMarkerLayer(lat, lng, data) {
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

                if (selectedNodeLayer && selectedNodeLayer.data.node_id === data.node_id) {
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
    const toast = bootstrap.Toast.getOrCreateInstance(toastEl);
    const nodeId = data.node_id;
    const lat = data.latitude;
    const lng = data.longitude;

    // Fetch the address for the node
    fetch(`http://${ipAdress}:5000/get_address?node_id=${nodeId}`)
        .then(response => response.json())
        .then(recievedAddress => {
            const message = messageType === 'new_node' ? 'New node added' : 'Node activated';
            if (recievedAddress.address) {
                console.log(`Showing ${message} notification for node ${nodeId} at ${recievedAddress.address}`);
                toastEl.querySelector('.toast-body').innerText = `${message} at ${recievedAddress.address}`;
            } else {
                console.log(`Showing ${message} notification for node ${nodeId} at unknown location`);
                toastEl.querySelector('.toast-body').innerText = `${message} at unknown location`;
            }

            // Update the toast header title dynamically
            toastEl.querySelector('.toast-header .font-weight-bold').innerText = message;

            toastEl.onclick = null;
            toastEl.onclick = (event) => {
                // To avoid triggering the click event when closing the toast
                if (event.target.classList.contains('fa-times') || event.target.closest('.fa-times')) {
                    return;
                }
                map.setView([lat, lng], 12); 
                toast.hide(); 
                // Select the node to update UI
                if (markerLayers[nodeId]) {
                    selectedNodeLayer = { marker: markerLayers[nodeId], data: markerLayers[nodeId].data };
                    fetchIntersectionDetails(lat, lng);
                    updateUIElements(markerLayers[nodeId].data);
                } else if (nodeLayers[nodeId]) {
                    selectedNodeLayer = { circle: nodeLayers[nodeId].circle, data: nodeLayers[nodeId].data };
                    nodeLayers[nodeId].circle.setStyle({
                        weight: 6,
                        dashArray: '12',
                    });
                    if (previouslySelectedCircle && previouslySelectedCircle !== nodeLayers[nodeId].circle) {
                        previouslySelectedCircle.setStyle({
                            weight: 2,
                            dashArray: null,
                        });
                    }
                    previouslySelectedCircle = nodeLayers[nodeId].circle;
                    fetchIntersectionDetails(lat, lng);
                    updateUIElements(nodeLayers[nodeId].data);
                }
            };

            toast.show();
        })
        .catch(error => {
            console.error("Error fetching address for node notification:", error);
            toastEl.querySelector('.toast-body').innerText = 
                `${messageType === 'new_node' ? 'New node added' : 'Node updated'} at unknown location`;
            toastEl.querySelector('.toast-header .font-weight-bold').innerText = 
                messageType === 'new_node' ? 'New node added' : 'Node updated';
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
        })
        .catch(error => {
            console.error("Error fetching notification count:", error);
            alertsContainer.innerHTML = `<span class="text-sm">Error loading alerts</span>`;
            alertsCountContainer.innerHTML = `<p class="mb-0 text-sm"><span class="text-danger font-weight-bolder">0 alerts</span> today</p>`;
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

function updateUIElements(data) {
    const densityValues = [];
    
    // Get and sort lane keys
    const laneKeys = Object.keys(data || {})
        .filter(key => key.startsWith("voie_"))
        .sort((a, b) => parseInt(a.split("_")[1]) - parseInt(b.split("_")[1]));

    // Calculate density for each lane and store for average
    laneKeys.forEach(laneKey => {
        const laneNumber = laneKey.split("_")[1];
        const counter = data[laneKey] || 0;
        const speedKey = `avg_speed_${laneNumber}`;
        let speed = data[speedKey] || 0;
        if (laneKeys.length === 1 && data.avg_speed !== undefined && data.avg_speed !== null) {
            speed = data.avg_speed;
        }
        const density = speed > 0 ? (counter / speed).toFixed(1) : "0.0";
        densityValues.push(parseFloat(density));
    });

    // Set average density in average-density
    const avgDensity = densityValues.length > 0 
        ? (densityValues.reduce((sum, d) => sum + d, 0) / densityValues.length).toFixed(1) 
        : "0.0";
    const averageDensityEl = document.getElementById("average-density");
    if (averageDensityEl) {
        averageDensityEl.innerText = `${avgDensity}`;
    }

    // In case of four lanes at once 
    const isFourLanes = laneKeys.length === 4;
    const iconSize = isFourLanes ? 12 : 18; 
    const fontClass = isFourLanes ? "text-xs" : "text-sm"; 
    const gapClass = isFourLanes ? "gap-0" : "gap-1"; 

    const lanesContainer = document.getElementById("lanes_container");
    // tooltips
    const existingLaneTooltips = lanesContainer.querySelectorAll('[data-bs-toggle="tooltip"]');
    existingLaneTooltips.forEach(tooltipEl => {
        const tooltipInstance = bootstrap.Tooltip.getInstance(tooltipEl);
        if (tooltipInstance) {
            tooltipInstance.hide(); 
            tooltipInstance.dispose();
        }
    });
    lanesContainer.innerHTML = "";
    laneKeys.forEach(laneKey => {
        const laneNumber = laneKey.split("_")[1];
        const laneValue = data[laneKey] || 0;
        const laneDiv = document.createElement("div");
        laneDiv.className = `d-flex align-items-center ${gapClass}`;
        const laneImg = document.createElement("img");
        laneImg.src = "../img/double-arrows.png";
        laneImg.alt = `Lane ${laneNumber}`;
        laneImg.width = iconSize;
        laneImg.height = iconSize;
        laneImg.setAttribute("data-bs-toggle", "tooltip");
        laneImg.setAttribute("data-bs-placement", "top");
        laneImg.setAttribute("title", `Lane ${laneNumber}`);
        if (parseInt(laneNumber) % 2 === 0) {
            laneImg.style.transform = "rotate(180deg)";
        }
        const laneCount = document.createElement("div");
        laneCount.className = `fw-bold ${fontClass}`;
        laneCount.innerText = laneValue;
        laneDiv.appendChild(laneImg);
        laneDiv.appendChild(laneCount);
        lanesContainer.appendChild(laneDiv);
    });

    // Initialize tooltips for lanes container
    const laneTooltips = lanesContainer.querySelectorAll('[data-bs-toggle="tooltip"]');
    laneTooltips.forEach(tooltipTriggerEl => {
        new bootstrap.Tooltip(tooltipTriggerEl);
    });

    const speedsContainer = document.getElementById("speeds_container");
    // tooltips
    const existingSpeedTooltips = speedsContainer.querySelectorAll('[data-bs-toggle="tooltip"]');
    existingSpeedTooltips.forEach(tooltipEl => {
        const tooltipInstance = bootstrap.Tooltip.getInstance(tooltipEl);
        if (tooltipInstance) {
            tooltipInstance.hide(); 
            tooltipInstance.dispose();
        }
    });
    speedsContainer.innerHTML = "";
    laneKeys.forEach(laneKey => {
        const laneNumber = laneKey.split("_")[1];
        const speedKey = `avg_speed_${laneNumber}`;
        let speedValue = data[speedKey];
        if (laneKeys.length === 1 && data.avg_speed !== undefined && data.avg_speed !== null) {
            speedValue = data.avg_speed;
        }
        const speedDiv = document.createElement("div");
        speedDiv.className = "d-flex align-items-center gap-1";
        const speedImg = document.createElement("img");
        speedImg.src = "../img/double-arrows.png";
        speedImg.alt = `Speed Lane ${laneNumber}`;
        speedImg.width = iconSize;
        speedImg.height = iconSize;
        speedImg.setAttribute("data-bs-toggle", "tooltip");
        speedImg.setAttribute("data-bs-placement", "top");
        speedImg.setAttribute("title", `Lane ${laneNumber}`);
        if (parseInt(laneNumber) % 2 === 0) {
            speedImg.style.transform = "rotate(180deg)";
        }
        const speedCount = document.createElement("div");
        speedCount.className = `fw-bold ${fontClass}`;
        speedCount.innerHTML = speedValue !== undefined && speedValue !== null 
            ? `${Math.round(speedValue)}` 
            : "...";
        speedDiv.appendChild(speedImg);
        speedDiv.appendChild(speedCount);
        speedsContainer.appendChild(speedDiv);
    });

    // Tooltips for speeds container
    const speedTooltips = speedsContainer.querySelectorAll('[data-bs-toggle="tooltip"]');
    speedTooltips.forEach(tooltipTriggerEl => {
        new bootstrap.Tooltip(tooltipTriggerEl);
    });

    const densityContainer = document.getElementById('vehicle_present');
    // tooltips
    const existingDensityTooltips = densityContainer.querySelectorAll('[data-bs-toggle="tooltip"]');
    existingDensityTooltips.forEach(tooltipEl => {
        const tooltipInstance = bootstrap.Tooltip.getInstance(tooltipEl);
        if (tooltipInstance) {
            tooltipInstance.hide(); 
            tooltipInstance.dispose();
        }
    });
    densityContainer.innerHTML = "";
    laneKeys.forEach(laneKey => {
        const laneNumber = laneKey.split("_")[1];
        const counter = data[laneKey] || 0;
        const speedKey = `avg_speed_${laneNumber}`;
        let speed = data[speedKey] || 0;
        if (laneKeys.length === 1 && data.avg_speed !== undefined && data.avg_speed !== null) {
            speed = data.avg_speed;
        }
        const density = speed > 0 ? (counter / speed).toFixed(1) : "0.0";
        const densityDiv = document.createElement("div");
        densityDiv.className = "d-flex align-items-center gap-1";
        const densityImg = document.createElement("img");
        densityImg.src = "../img/double-arrows.png";
        densityImg.alt = `Density Lane ${laneNumber}`;
        densityImg.width = iconSize;
        densityImg.height = iconSize;
        densityImg.setAttribute("data-bs-toggle", "tooltip");
        densityImg.setAttribute("data-bs-placement", "top");
        densityImg.setAttribute("title", `Lane ${laneNumber}`);
        if (parseInt(laneNumber) % 2 === 0) {
            densityImg.style.transform = "rotate(180deg)";
        }
        const densityValue = document.createElement("span");
        densityValue.className = `font-weight-bolder ${fontClass}`;
        densityValue.innerText = `${density}`;
        densityDiv.appendChild(densityImg);
        densityDiv.appendChild(densityValue);
        densityContainer.appendChild(densityDiv);
    });

    // Tooltips for density container
    const densityTooltips = densityContainer.querySelectorAll('[data-bs-toggle="tooltip"]');
    densityTooltips.forEach(tooltipTriggerEl => {
        new bootstrap.Tooltip(tooltipTriggerEl, {
            trigger: 'hover' 
        });
    });
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

const openBtn = document.getElementById('openModalBtn');
const closeBtn = document.getElementById('modalCloseBtn');
const streamFrame = document.getElementById('streamFrame');
const cameraSelector = document.getElementById('cameraSelector');
const modal = new bootstrap.Modal(document.getElementById('streamModal'));

openBtn.onclick = function () {
    if (selectedNodeLayer) {
        const nodeId = selectedNodeLayer.data.node_id;
        console.log("stream opened for node", nodeId);
        modal.show();
        fetchCamerasForNode(nodeId);
    } else {
        const toast = new bootstrap.Toast(document.getElementById('streamToast'));
        toast.show();
    }
};

closeBtn.onclick = function() {
    modal.hide();
    streamFrame.src = "";
    cameraSelector.innerHTML = '<option value="" disabled selected>Select a camera</option>';
};

window.onclick = function(event) {
    if (event.target == modal) {
        modal.hide();
        streamFrame.src = "";
    }
};

function fetchCamerasForNode(nodeId) {
    fetch(`http://${ipAdress}:5000/get_node_cams?node_id=${nodeId}`)
        .then(res => res.json())
        .then(cams => {
            cameraSelector.innerHTML = '<option value="" disabled selected>Select a camera</option>';
            cams.forEach((cam, index) => {
                const option = document.createElement('option');
                option.value = cam.ip_address;
                option.textContent = `Camera ${index + 1}`;
                cameraSelector.appendChild(option);
            });
        })
        .catch(err => {
            console.error("Failed to fetch cameras:", err);
        });
}

cameraSelector.addEventListener('change', function() {
    const selectedUrl = this.value;
    streamFrame.src = selectedUrl;
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

            // chartInstance = new Chart(ctx, {
            //     type: "bar",
            //     data: {
            //         labels: labels,
            //         datasets: [{
            //             label: 'Median density',
            //             data: counts,
            //             tension: 0.4,
            //             borderWidth: 0,
            //             borderRadius: 4,
            //             borderSkipped: false,
            //             backgroundColor: "#43A047",
            //             barThickness: 30
            //         }]
            //     },
            //     options: {
            //         responsive: false,
            //         maintainAspectRatio: false,
            //         plugins: {
            //             legend: {
            //                 display: true, 
            //             },
            //             tooltip: {
            //                 callbacks: {
            //                     label: function(context) {
            //                         return `Median Vehicles: ${context.parsed.y}`;
            //                     }
            //                 }
            //             }
            //         },
            //         scales: {
            //             y: {
            //                 beginAtZero: true,
            //                 grid: {
            //                     drawBorder: false,
            //                     color: '#e5e5e5'
            //                 },
            //                 ticks: {
            //                     color: "#737373",
            //                     callback: function(value) {
            //                         return value; 
            //                     }
            //                 },
            //                 title: {
            //                     display: true,
            //                     text: 'Median Vehicle Count',
            //                     color: '#737373'
            //                 }
            //             },
            //             x: {
            //                 grid: {
            //                     display: false,
            //                 },
            //                 ticks: {
            //                     color: '#737373'
            //                 },
            //                 title: {
            //                     display: true,
            //                     text: 'Weekday',
            //                     color: '#737373'
            //                 }
            //             }
            //         }
            //     }
            // });
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

