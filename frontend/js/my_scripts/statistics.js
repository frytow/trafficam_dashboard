const ipAddress = "192.168.1.16";
let congestionTimesChart = null;
let map = null;
let congestionLayers = {};

document.addEventListener('DOMContentLoaded', function () {
    const governorateSelect = document.getElementById('governorateSelect');
    governorateSelect.addEventListener('change', updateStatistics);
    
    initializeMap();
    updateStatistics(); 
});

// Initialize Map with theme support
function initializeMap() {
    map = L.map('congestion-map', {
        zoomControl: true,
        attributionControl: true
    }).setView([36.8065, 10.1815], 11);

    // This will be handled by theme.js
    if (typeof window.initMapWithTheme === 'function') {
        window.initMapWithTheme(map);
    } else {
        // Fallback
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '© OpenStreetMap'
        }).addTo(map);
    }
}

// Fetch and update statistics based on selected governorate
function updateStatistics() {
    const governorate = document.getElementById('governorateSelect').value;
    if (!governorate) return;

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${governorate}, Tunisia`)
        .then(response => response.json())
        .then(data => {
            if (data.length > 0) {
                map.setView([data[0].lat, data[0].lon], 12);
            }
        })
        .catch(error => console.error('Error fetching governorate coordinates:', error));

    // Fetch congestion times
    fetch(`http://${ipAddress}:5000/get_congestion_times?governorate=${governorate}`)
        .then(response => response.json())
        .then(data => {
            updateCongestionTimesChart(data);
        })
        .catch(error => console.error('Error fetching congestion times:', error));

    // Fetch congestion areas
    fetch(`http://${ipAddress}:5000/get_congestion_areas?governorate=${governorate}`)
        .then(response => response.json())
        .then(data => {
            updateCongestionAreasList(data);
            updateCongestionMap(data);
        })
        .catch(error => {
            console.error('Error fetching congestion areas:', error);
            const areasContainer = document.getElementById('congestion-areas');
            areasContainer.innerHTML = '<p class="text-sm text-danger">Error loading congested areas.</p>';
        });
}

// Update the congestion times chart
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
                label: 'Average Vehicles per Hour',
                data: counts,
                backgroundColor: '#E53935', // Red for congestion
                borderRadius: 4,
                barThickness: 20
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: true,
                    position: 'top'
                }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    title: {
                        display: true,
                        text: 'Average Vehicles (veh/km)'
                    },
                    grid: {
                        color: '#e5e5e5'
                    },
                    ticks: {
                        color: '#737373'
                    }
                },
                x: {
                    title: {
                        display: true,
                        text: 'Hour of Day'
                    },
                    grid: {
                        display: false
                    },
                    ticks: {
                        color: '#737373'
                    }
                }
            }
        }
    });
}

// Update the congestion areas list
function updateCongestionAreasList(data) {
    const areasContainer = document.getElementById('congestion-areas');
    areasContainer.innerHTML = '';

    if (!data || data.length === 0) {
        areasContainer.innerHTML = '<p class="text-sm">No congested areas found for this governorate.</p>';
        return;
    }

    data.forEach(area => {
        const avgVehicles = typeof area.avg_vehicles === 'number' && !isNaN(area.avg_vehicles)
            ? area.avg_vehicles.toFixed(1)
            : 'N/A';
        
        const item = document.createElement('a');
        item.className = 'list-group-item list-group-item-action';
        item.innerHTML = `
            <div class="d-flex justify-content-between">
                <div>
                    <h6 class="mb-0">${area.address || 'Unknown'}</h6>
                    <p class="text-sm mb-0">Avg Density: ${avgVehicles} veh/km</p>
                </div>
                <span class="badge bg-gradient-danger">${area.peak_hour !== null ? area.peak_hour : 'N/A'}:00</span>
            </div>
        `;
        // Add click event to navigate map to this area
        item.addEventListener('click', () => {
            const circle = congestionLayers[area.address];
            if (circle) {
                map.panTo([area.latitude, area.longitude], { animate: true, duration: 0.5 });
                circle.openPopup();
            }
        });
        areasContainer.appendChild(item);
    });
}

// Update the congestion map
function updateCongestionMap(data) {
    // Clear existing layers
    Object.values(congestionLayers).forEach(layer => map.removeLayer(layer));
    congestionLayers = {};

    if (!data || data.length === 0) {
        return;
    }

    data.forEach(area => {
        if (area.latitude && area.longitude) {
            const color = getColorByDensity(area.avg_vehicles);
            const circle = L.circle([area.latitude, area.longitude], {
                color: color,
                fillColor: color,
                fillOpacity: 0.4,
                radius: 200
            }).addTo(map);

            circle.bindPopup(`
                <b>${area.address || 'Unknown'}</b><br>
                Avg Density: ${typeof area.avg_vehicles === 'number' ? area.avg_vehicles.toFixed(1) : 'N/A'} veh/km<br>
                Peak Hour: ${area.peak_hour !== null ? area.peak_hour : 'N/A'}:00
            `);

            circle.on('mouseover', () => circle.openPopup());
            circle.on('mouseout', () => circle.closePopup());

            congestionLayers[area.address] = circle;
        } else {
            console.warn('Missing coordinates for area:', area);
        }
    });
}

// Get color based on vehicle density
function getColorByDensity(density) {
    if (typeof density !== 'number' || isNaN(density)) return 'gray';
    if (density > 50) return 'red';      // High density
    else if (density > 20) return 'orange'; // Medium density
    else return 'green';                 // Low density
}