const ipAddress = "192.168.100.6";
let congestionTimesChart = null;
let predictionChart = null;
let map = null;
let congestionLayers = {};
let selectedNodeId = null;
let nodeMarkers = {};

const sampleNodes = [
  { id: 'N1', label: 'Avenue Habib Bourguiba', lat: 36.8065, lng: 10.1815, current_density: 64, status: 'Heavy', activity: 73 },
  { id: 'N2', label: 'Rue Mohamed V', lat: 36.8090, lng: 10.1700, current_density: 52, status: 'Moderate', activity: 41 },
  { id: 'N3', label: 'Avenue de la République', lat: 36.8030, lng: 10.1740, current_density: 35, status: 'Medium', activity: 32 },
  { id: 'N4', label: 'Boulevard Bab Saadoun', lat: 36.8110, lng: 10.1625, current_density: 45, status: 'Medium', activity: 27 },
  { id: 'N5', label: 'Corniche de Sidi Bou Saïd', lat: 36.8680, lng: 10.3410, current_density: 22, status: 'Light', activity: 16 }
];

const samplePredictions = [
  { label: '14:00', value: 36 },
  { label: '15:00', value: 42 },
  { label: '16:00', value: 53 },
  { label: '17:00', value: 68 },
  { label: '18:00', value: 79 },
  { label: '19:00', value: 63 },
  { label: '20:00', value: 48 }
];

const sampleCongestionAreas = [
  { address: 'Avenue Habib Bourguiba', latitude: 36.8065, longitude: 10.1815, avg_vehicles: 71, peak_hour: 18 },
  { address: 'Rue Mohamed V', latitude: 36.8090, longitude: 10.1700, avg_vehicles: 58, peak_hour: 17 },
  { address: 'Avenue de la République', latitude: 36.8030, longitude: 10.1740, avg_vehicles: 49, peak_hour: 16 },
  { address: 'Boulevard Bab Saadoun', latitude: 36.8110, longitude: 10.1625, avg_vehicles: 43, peak_hour: 15 },
  { address: 'Corniche de Sidi Bou Saïd', latitude: 36.8680, longitude: 10.3410, avg_vehicles: 27, peak_hour: 19 }
];

const sampleTimes = [
  { hour: '06:00', avg_vehicles: 28 },
  { hour: '08:00', avg_vehicles: 56 },
  { hour: '10:00', avg_vehicles: 42 },
  { hour: '12:00', avg_vehicles: 36 },
  { hour: '14:00', avg_vehicles: 49 },
  { hour: '16:00', avg_vehicles: 63 },
  { hour: '18:00', avg_vehicles: 77 },
  { hour: '20:00', avg_vehicles: 53 }
];

const sampleForecast = [
  { hour: '14:00', chance: 33, description: 'Rising congestion into the afternoon.' },
  { hour: '16:00', chance: 57, description: 'Peak period likely across the city.' },
  { hour: '18:00', chance: 81, description: 'Major traffic jam predicted.' }
];

document.addEventListener('DOMContentLoaded', function () {
  const governorateSelect = document.getElementById('governorateSelect');
  governorateSelect.addEventListener('change', updateStatistics);

  initializeMap();
  updateStatistics();
});

function initializeMap() {
  map = L.map('congestion-map', {
    zoomControl: true,
    attributionControl: true
  }).setView([36.8065, 10.1815], 12);

  if (typeof window.initMapWithTheme === 'function') {
    window.initMapWithTheme(map);
  } else {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap'
    }).addTo(map);
  }

  addNodeMarkers(sampleNodes);
}

function updateStatistics() {
  const governorate = document.getElementById('governorateSelect').value;
  if (!governorate) return;

  setTimeout(() => {
    updateTopArea(sampleCongestionAreas[0]);
    updatePeakHour(sampleTimes);
    updatePredictionWidgets(samplePredictions, sampleForecast);
    updateCongestionTimesChart(sampleTimes);
    updateCongestionAreasList(sampleCongestionAreas);
    updateCongestionMap(sampleCongestionAreas);
    updateNodeActivity(sampleNodes);
  }, 120);

  const query = encodeURIComponent(`${governorate}, Tunisia`);
  fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${query}`)
    .then(response => response.json())
    .then(data => {
      if (data.length > 0) {
        map.setView([data[0].lat, data[0].lon], 11);
      }
    })
    .catch(() => {
      map.setView([36.8065, 10.1815], 12);
    });
}

function updateTopArea(area) {
  document.getElementById('top-area-name').textContent = area.address;
  document.getElementById('top-area-note').textContent = `Average density ${area.avg_vehicles} veh/km, peak hour ${area.peak_hour}:00.`;
}

function updatePeakHour(times) {
  const top = times.reduce((prev, current) => current.avg_vehicles > prev.avg_vehicles ? current : prev, times[0]);
  document.getElementById('peak-hour').textContent = top.hour;
  document.getElementById('time-status').textContent = `${top.hour} busiest`;
}

function updatePredictionWidgets(predictions, forecast) {
  const predicted = predictions.reduce((prev, current) => current.value > prev.value ? current : prev, predictions[0]);
  document.getElementById('prediction-alert').textContent = `${predicted.label}`;
  document.getElementById('prediction-note').textContent = `Expected congestion value ${predicted.value} on ${predicted.label}.`;

  const forecastContainer = document.getElementById('prediction-forecast');
  forecastContainer.innerHTML = '';
  forecast.forEach(item => {
    const card = document.createElement('div');
    card.className = 'forecast-card';
    card.innerHTML = `
      <div>
        <div class="forecast-tag">${item.hour}</div>
        <div class="forecast-value">${item.chance}%</div>
      </div>
      <div class="forecast-note">${item.description}</div>
    `;
    forecastContainer.appendChild(card);
  });
}

function updateCongestionTimesChart(data) {
  const ctx = document.getElementById('congestion-times-chart').getContext('2d');
  const labels = data.map(item => item.hour);
  const counts = data.map(item => item.avg_vehicles);

  if (congestionTimesChart) {
    congestionTimesChart.destroy();
  }

  congestionTimesChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: 'Avg Vehicles / Hour',
        data: counts,
        backgroundColor: labels.map(hour => hour === '18:00' ? '#ef4444' : '#2563eb'),
        borderRadius: 10,
        barThickness: 28
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: { mode: 'index', intersect: false }
      },
      scales: {
        x: {
          grid: { display: false },
          ticks: { color: '#64748b' }
        },
        y: {
          beginAtZero: true,
          grid: { color: '#e2e8f0' },
          ticks: { color: '#64748b' }
        }
      }
    }
  });
}

function updateCongestionAreasList(data) {
  const areasContainer = document.getElementById('congestion-areas');
  areasContainer.innerHTML = '';

  if (!data || data.length === 0) {
    areasContainer.innerHTML = '<p class="text-sm">No congested areas found.</p>';
    return;
  }

  data.forEach(area => {
    const item = document.createElement('a');
    item.className = 'list-group-item list-group-item-action';
    item.innerHTML = `
      <div class="d-flex justify-content-between align-items-center">
        <div>
          <div class="node-title">${area.address}</div>
          <div class="node-sub">Avg density ${area.avg_vehicles} veh/km</div>
        </div>
        <span class="badge rounded-pill bg-danger">${area.peak_hour}:00</span>
      </div>
    `;

    item.addEventListener('click', () => {
      focusAreaOnMap(area);
    });

    areasContainer.appendChild(item);
  });
}

function updateCongestionMap(data) {
  Object.values(congestionLayers).forEach(layer => map.removeLayer(layer));
  congestionLayers = {};

  if (!data || data.length === 0) {
    return;
  }

  data.forEach(area => {
    if (!area.latitude || !area.longitude) return;

    const color = getColorByDensity(area.avg_vehicles);
    const marker = L.circle([area.latitude, area.longitude], {
      color: color,
      fillColor: color,
      fillOpacity: 0.35,
      radius: 190
    }).addTo(map);

    marker.bindPopup(`
      <strong>${area.address}</strong><br>
      Avg density: ${area.avg_vehicles} veh/km<br>
      Peak hour: ${area.peak_hour}:00
    `);

    marker.on('click', () => {
      setSelectedNode({
        id: area.address,
        label: area.address,
        current_density: area.avg_vehicles,
        status: area.avg_vehicles > 50 ? 'Heavy' : 'Moderate',
        activity: Math.min(Math.round(area.avg_vehicles * 1.2), 96)
      });
    });

    congestionLayers[area.address] = marker;
  });
}

function addNodeMarkers(nodes) {
  if (!Array.isArray(nodes)) return;

  nodes.forEach(node => {
    const marker = L.circleMarker([node.lat, node.lng], {
      radius: 12,
      fillColor: getColorByDensity(node.current_density),
      color: '#ffffff',
      weight: 2,
      fillOpacity: 0.9
    }).addTo(map);

    marker.bindTooltip(`${node.label}`);
    marker.on('click', () => {
      setSelectedNode(node);
      highlightNodeList(node.id);
      map.panTo([node.lat, node.lng], { animate: true, duration: 0.6 });
    });

    nodeMarkers[node.id] = marker;
  });
}

function updateNodeActivity(nodes) {
  const list = document.getElementById('node-activity-list');
  list.innerHTML = '';

  nodes.forEach(node => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'list-group-item list-group-item-action';
    item.innerHTML = `
      <div class="node-title">${node.label}</div>
      <div class="node-sub">Status: ${node.status} · Density: ${node.current_density} · Activity: ${node.activity}%</div>
    `;

    item.addEventListener('click', () => {
      setSelectedNode(node);
      highlightNodeList(node.id);
      if (nodeMarkers[node.id]) {
        map.panTo([node.lat, node.lng], { animate: true, duration: 0.6 });
        nodeMarkers[node.id].openTooltip();
      }
    });

    item.dataset.nodeId = node.id;
    list.appendChild(item);
  });
}

function setSelectedNode(node) {
  selectedNodeId = node.id;
  document.getElementById('selected-node-title').textContent = node.label;
  document.getElementById('selected-node-status').textContent = node.status;
}

function highlightNodeList(nodeId) {
  document.querySelectorAll('#node-activity-list .list-group-item').forEach(el => {
    el.classList.toggle('active', el.dataset.nodeId === nodeId);
  });
}

function focusAreaOnMap(area) {
  if (!area.latitude || !area.longitude) return;

  map.flyTo([area.latitude, area.longitude], 14, { duration: 0.7 });
  const marker = congestionLayers[area.address];
  if (marker) marker.openPopup();
}

function getColorByDensity(density) {
  if (typeof density !== 'number' || isNaN(density)) return 'gray';
  if (density >= 65) return '#dc2626';
  if (density >= 40) return '#f59e0b';
  return '#22c55e';
}
