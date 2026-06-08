//  Real Weather for Tunisia -----------------------------------------------------------------------

async function fetchWeather() {
  const weatherDisplay = document.getElementById('weatherDisplay');
  const tempEl = document.getElementById('weather-temp');
  const iconEl = document.getElementById('weather-icon');
  const descEl = document.getElementById('weather-desc');

  try {
    // Tunis coordinates (you can change based on selected governorate later)
    const response = await fetch(
      'https://api.open-meteo.com/v1/forecast?latitude=36.8065&longitude=10.1815&current_weather=true&timezone=Africa/Tunis'
    );
    
    const data = await response.json();
    const current = data.current_weather;

    const temp = Math.round(current.temperature);
    const code = current.weathercode;

    tempEl.textContent = `${temp}°C`;

    // Simple weather code to icon mapping
    const iconMap = {
      0: "fa-sun",           // Clear sky
      1: "fa-sun",           // Mainly clear
      2: "fa-cloud-sun",     // Partly cloudy
      3: "fa-cloud",         // Overcast
      45: "fa-smog",         // Fog
      51: "fa-cloud-rain",   // Light drizzle
      61: "fa-cloud-rain",   // Rain
      71: "fa-snowflake",    // Snow
      95: "fa-cloud-bolt"    // Thunderstorm
    };

    iconEl.className = `fa-solid ${iconMap[code] || "fa-cloud-sun"}`;

    // Description
    const descMap = {
      0: "Clear",
      1: "Mainly Clear",
      2: "Partly Cloudy",
      3: "Overcast",
      45: "Fog",
      61: "Rain",
      95: "Thunderstorm"
    };
    descEl.textContent = descMap[code] || "Cloudy";

  } catch (error) {
    console.error("Weather fetch failed", error);
    tempEl.textContent = "--°C";
    descEl.textContent = "Offline";
  }
}

// Load weather when page loads
window.addEventListener('load', fetchWeather);

// Optional: Refresh every 10 minutes
setInterval(fetchWeather, 10 * 60 * 1000);

// clock update ------------------------------------------------------------------------

function updateClock() {
      const now = new Date();
      document.getElementById('live-clock').textContent = now.toLocaleTimeString('en-GB', { hour12: false });
    }
    setInterval(updateClock, 1000);
    updateClock();


// Theme Toggle + Map Tile Switching -------------------------------------------------------------------------------
// =============================================
//  THEME + MAP TILE SWITCHING
// =============================================

let mapInstance = null;
let currentTileLayer = null;

const lightTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors'
});

const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; OpenStreetMap &copy; CartoDB'
});

function setTheme(isDark) {
    const body = document.body;
    const toggle = document.getElementById('themeToggle');

    if (isDark) {
        body.classList.add('dark');
        if (toggle) toggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
    } else {
        body.classList.remove('dark');
        if (toggle) toggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
    }

    // Switch map tiles if map exists
    if (mapInstance) {
        switchMapTheme(isDark);
    }

    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function switchMapTheme(isDark) {
    if (!mapInstance) return;

    // Remove current tile layer
    if (currentTileLayer) {
        mapInstance.removeLayer(currentTileLayer);
    }

    // Add the new one
    currentTileLayer = isDark ? darkTiles : lightTiles;
    currentTileLayer.addTo(mapInstance);
}

// Initialize theme
function initTheme() {
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    const shouldBeDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    
    setTheme(shouldBeDark);
}

// Expose to map script
window.setTheme = setTheme;
window.initMapWithTheme = function(map) {
    mapInstance = map;
    
    // Apply current theme to the map
    const isDark = document.body.classList.contains('dark');
    currentTileLayer = isDark ? darkTiles : lightTiles;
    currentTileLayer.addTo(map);
    
    console.log(`Map initialized with ${isDark ? 'dark' : 'light'} theme`);
};

function setTheme(isDark) {
  const body = document.body;
  const toggle = document.getElementById('themeToggle');

  if (isDark) {
    body.classList.add('dark');
    document.getElementById("logo_img").src = "../img/logo_dark_theme.png";
    toggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
    if (mapInstance && currentTileLayer) {
      mapInstance.removeLayer(currentTileLayer);
      currentTileLayer = darkTiles;
      mapInstance.addLayer(currentTileLayer);
    }
  } else {
    body.classList.remove('dark');
    document.getElementById("logo_img").src = "../img/traficam_logo_net.png";
    toggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
    if (mapInstance && currentTileLayer) {
      mapInstance.removeLayer(currentTileLayer);
      currentTileLayer = lightTiles;
      mapInstance.addLayer(currentTileLayer);
    }
  }
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

// Initialize theme on load
function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const shouldBeDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
  setTheme(shouldBeDark);
}

// Toggle button
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('themeToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      setTheme(!document.body.classList.contains('dark'));
    });
  }
  
  initTheme();
});

// Make setTheme available globally for map script if needed
window.setTheme = setTheme;
window.initMapWithTheme = function(map) {
  mapInstance = map;
  currentTileLayer = document.body.classList.contains('dark') ? darkTiles : lightTiles;
  currentTileLayer.addTo(map);
};


// Governorate navigation using Nominatim (no hardcoded coords)
document.getElementById('governorateSelect').addEventListener('change', function() {
    const selected = this.value;
    if (!selected) return;

    // Convert value to proper search name
    const searchName = {
        "bardo": "Bardo, Tunis, Tunisia",
        "manouba": "Manouba, Tunisia",
        "Carthage": "Carthage, Tunisia",
        "ben arous": "Ben Arous, Tunisia",
        "nabeul": "Nabeul, Tunisia",
        "benzart": "Bizerte, Tunisia",        // Benzart = Bizerte
        "sousse": "Sousse, Tunisia",
        "sfax": "Sfax, Tunisia"
    }[selected];

    if (!searchName) return;

    // Show loading state
    this.disabled = true;

    fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchName)}&limit=1`)
        .then(response => response.json())
        .then(data => {
            if (data && data.length > 0) {
                const result = data[0];
                const lat = parseFloat(result.lat);
                const lon = parseFloat(result.lon);

                map.flyTo([lat, lon], 13, {
                    duration: 1.8,
                    easeLinearity: 0.25
                });

                console.log(`Navigated to ${selected} (${lat}, ${lon})`);
            } else {
                console.warn(`No location found for ${selected}`);
                alert("Location not found. Please try again.");
            }
        })
        .catch(error => {
            console.error("Geocoding error:", error);
            alert("Failed to navigate. Check your internet connection.");
        })
        .finally(() => {
            this.disabled = false;
        });
});
