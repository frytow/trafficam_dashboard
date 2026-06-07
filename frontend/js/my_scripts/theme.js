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
let mapInstance;
let currentTileLayer;

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
    toggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
    if (mapInstance && currentTileLayer) {
      mapInstance.removeLayer(currentTileLayer);
      currentTileLayer = darkTiles;
      mapInstance.addLayer(currentTileLayer);
    }
  } else {
    body.classList.remove('dark');
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

// Dynamic Traffic Flow Gauge
function updateTrafficFlow(percentage = 78) {
  const offset = 94.2 - (94.2 * percentage / 100);
  document.getElementById('flow-progress').setAttribute('stroke-dashoffset', offset);
  document.getElementById('flow-percentage').textContent = Math.round(percentage) + '%';

  const statusEl = document.getElementById('flow-status');
  const descEl = document.getElementById('flow-desc');

  if (percentage > 75) {
    statusEl.textContent = "Smooth Flow";
    statusEl.style.color = "var(--green)";
    descEl.textContent = "Traffic is moving well across monitored intersections";
  } else if (percentage > 50) {
    statusEl.textContent = "Moderate Flow";
    statusEl.style.color = "var(--accent3)";
    descEl.textContent = "Some congestion detected in central areas";
  } else {
    statusEl.textContent = "Heavy Flow";
    statusEl.style.color = "var(--accent2)";
    descEl.textContent = "Significant delays reported - consider alternate routes";
  }
}

// Initialize
window.addEventListener('load', () => {
  updateTrafficFlow(78);   // Change this number dynamically later
});