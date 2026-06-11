// ══════════════════════════════════════════════════════════════
//  TraficCam — theme.js  (redesign)
// ══════════════════════════════════════════════════════════════

// ── Map tile layers ───────────────────────────────────────────
let mapInstance = null;
let currentTileLayer = null;

const lightTiles = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: ''
});

const darkTiles = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: ''
});

// ── Theme setter ──────────────────────────────────────────────
function setTheme(isDark) {
    const body = document.body;
    const toggle = document.getElementById('themeToggle');
    const logo   = document.getElementById('logo_img');

    if (isDark) {
        body.classList.add('dark');
        if (toggle) toggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
        if (logo)   logo.src = '../img/logo_dark_theme.png';
        if (mapInstance && currentTileLayer) {
            mapInstance.removeLayer(currentTileLayer);
            currentTileLayer = darkTiles;
            mapInstance.addLayer(currentTileLayer);
        }
    } else {
        body.classList.remove('dark');
        if (toggle) toggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
        if (logo)   logo.src = '../img/traficam_logo_net.png';
        if (mapInstance && currentTileLayer) {
            mapInstance.removeLayer(currentTileLayer);
            currentTileLayer = lightTiles;
            mapInstance.addLayer(currentTileLayer);
        }
    }
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function initTheme() {
    const saved = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    setTheme(saved === 'dark' || (!saved && prefersDark));
}

// ── Expose to map script ──────────────────────────────────────
window.setTheme = setTheme;
window.initMapWithTheme = function (map) {
    mapInstance = map;
    const isDark = document.body.classList.contains('dark');
    currentTileLayer = isDark ? darkTiles : lightTiles;
    currentTileLayer.addTo(map);
};

// ── Clock ─────────────────────────────────────────────────────
function updateClock() {
    const el = document.getElementById('live-clock');
    if (el) el.textContent = new Date().toLocaleTimeString('en-GB', { hour12: false });
}
setInterval(updateClock, 1000);
updateClock();

// ── Weather ───────────────────────────────────────────────────
async function fetchWeather() {
    const tempEl = document.getElementById('weather-temp');
    const iconEl = document.getElementById('weather-icon');
    const descEl = document.getElementById('weather-desc');
    if (!tempEl) return;
    try {
        const res  = await fetch('https://api.open-meteo.com/v1/forecast?latitude=36.8065&longitude=10.1815&current_weather=true&timezone=Africa/Tunis');
        const data = await res.json();
        const cw   = data.current_weather;
        const temp = Math.round(cw.temperature);
        const code = cw.weathercode;
        tempEl.textContent = `${temp}°C`;
        const iconMap = { 0:'fa-sun', 1:'fa-sun', 2:'fa-cloud-sun', 3:'fa-cloud', 45:'fa-smog', 51:'fa-cloud-rain', 61:'fa-cloud-rain', 71:'fa-snowflake', 95:'fa-cloud-bolt' };
        const descMap = { 0:'Clear', 1:'Clear', 2:'Partly Cloudy', 3:'Overcast', 45:'Fog', 61:'Rain', 95:'Thunderstorm' };
        iconEl.className = `fa-solid ${iconMap[code] || 'fa-cloud-sun'}`;
        if (descEl) descEl.textContent = descMap[code] || 'Cloudy';
    } catch {
        if (tempEl) tempEl.textContent = '--°C';
        if (descEl) descEl.textContent = 'Offline';
    }
}

window.addEventListener('load', fetchWeather);
setInterval(fetchWeather, 10 * 60 * 1000);

// ── Init on DOM ready ─────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
    const toggleBtn = document.getElementById('themeToggle');
    if (toggleBtn) {
        toggleBtn.addEventListener('click', () => setTheme(!document.body.classList.contains('dark')));
    }
    initTheme();
});
