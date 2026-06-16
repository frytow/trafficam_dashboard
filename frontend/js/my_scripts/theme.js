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

const translations = {
  en: {
    navDashboard: 'Dashboard',
    navDatabase: 'Database',
    navStatistics: 'Statistics',
    navNotifications: 'Notifications',
    navRecords: 'Records',
    navOrders: 'Orders',
    navSettings: 'Settings',
    statusDisconnected: 'System Disconnected',
    topbarLabel: 'Control Center — Dashboard',

    densityLabel: 'Density — vh/km',
    densityFooter: 'avg density',
    avgSpeedLabel: 'AVG Speed — km/h',
    flowFooter: 'flow',
    passedVehiclesLabel: 'Passed Vehicles',
    activeAreaFooter: 'area today',
    trafficAlertsLabel: 'Traffic Jam Alerts',
    viewAll: 'View all →',

    nodesLabel: 'Nodes:',
    selectedNode: 'Selected Node',
    noNodeSelected: 'No node selected',

    camerasLabel: 'Cameras',
    lanesLabel: 'Lanes',
    locationLabel: 'Capacity',
    capacity: 'Capacity',

    currentDensity: 'Current Density',
    status: 'Status',
    liveStream: 'Live Stream',
    LiveStream: 'Live Stream',

    statistics: 'Statistics',
    trafficStatistics: 'Traffic Statistics',
    dailyTraffic: 'Daily Traffic',
    averageDailyDensity: 'Average daily density — last 7 days',
    chartPlaceholder: 'Chart renders here',
    lastUpdated: 'Last updated: just now',
    recordsPageTitle: 'Recorded Streams',

    selectIntersection: '— Select an intersection',
    selectCameraPrompt: 'Select a camera',

    streamBtn: 'Stream',
    statsBtn: 'Stats',
    recordsBtn: 'Records',

    nodeDrawerTitle: 'Active Operations Nodes',
    nodeSearchPlaceholder: 'Search node or ID…',

    legendActive: 'Active',
    legendClear: 'Clear',
    legendAlert: 'Alert',

    themeToggleTitle: 'Toggle Light / Dark',
    languageToggleTitle: 'Switch to Arabic'
  },
  ar: {
    navDashboard: 'لوحة القيادة',
    navDatabase: 'قاعدة البيانات',
    navStatistics: 'الإحصائيات',
    navNotifications: 'الإشعارات',
    navRecords: 'السجلات',
    navOrders: 'الأوامر',
    navSettings: 'الإعدادات',
    statusDisconnected: 'النظام غير متصل',
    topbarLabel: 'مركز التحكم — لوحة القيادة',

    densityLabel: 'الكثافة — مركبات/كم',
    densityFooter: 'متوسط الكثافة',
    avgSpeedLabel: 'متوسط السرعة — كم/س',
    flowFooter: 'التدفق',
    passedVehiclesLabel: 'المركبات المارة',
    activeAreaFooter: 'المنطقة اليوم',
    trafficAlertsLabel: 'إشعارات الاختناقات',
    viewAll: 'عرض الكل →',

    nodesLabel: 'العقد:',
    selectedNode: 'العقدة المحددة',
    noNodeSelected: 'لم يتم اختيار عقدة',

    camerasLabel: 'الكاميرات',
    lanesLabel: 'المسارات',
    locationLabel: 'السعة',
    capacity: 'السعة',

    currentDensity: 'الكثافة الحالية',
    status: 'الحالة',
    liveStream: 'البث المباشر',
    LiveStream: 'البث المباشر',

    statistics: 'الإحصائيات',
    trafficStatistics: 'إحصائيات المرور',
    dailyTraffic: 'المرور اليومي',
    averageDailyDensity: 'متوسط الكثافة اليومية — آخر 7 أيام',
    chartPlaceholder: 'يتم عرض المخطط هنا',
    lastUpdated: 'آخر تحديث: الآن',
    recordsPageTitle: 'التسجيلات',

    selectIntersection: '— اختر تقاطعاً',
    selectCameraPrompt: 'اختر كاميرا',

    streamBtn: 'تشغيل',
    statsBtn: 'إحصائيات',
    recordsBtn: 'السجلات',

    nodeDrawerTitle: 'عقد العمليات النشطة',
    nodeSearchPlaceholder: 'ابحث عن عقدة أو معرف…',

    legendActive: 'نشط',
    legendClear: 'صافي',
    legendAlert: 'تنبيه',

    themeToggleTitle: 'تبديل فاتح / داكن',
    languageToggleTitle: 'التبديل إلى الإنجليزية'
  }
};

function setTheme(isDark) {
  const body = document.body;
  const toggle = document.getElementById('themeToggle');
  const logo = document.getElementById('logo_img');

  if (isDark) {
    body.classList.add('dark');
    if (toggle) toggle.innerHTML = '<i class="fa-solid fa-moon"></i>';
    if (logo) logo.src = '../img/logo_dark_theme.png';
    if (mapInstance && currentTileLayer) {
      mapInstance.removeLayer(currentTileLayer);
      currentTileLayer = darkTiles;
      mapInstance.addLayer(currentTileLayer);
    }
  } else {
    body.classList.remove('dark');
    if (toggle) toggle.innerHTML = '<i class="fa-solid fa-sun"></i>';
    if (logo) logo.src = '../img/traficam_logo_net.png';
    if (mapInstance && currentTileLayer) {
      mapInstance.removeLayer(currentTileLayer);
      currentTileLayer = lightTiles;
      mapInstance.addLayer(currentTileLayer);
    }
  }
  localStorage.setItem('theme', isDark ? 'dark' : 'light');
}

function switchMapTheme(isDark) {
  if (!mapInstance) return;
  if (currentTileLayer) {
    mapInstance.removeLayer(currentTileLayer);
  }
  currentTileLayer = isDark ? darkTiles : lightTiles;
  currentTileLayer.addTo(mapInstance);
}

function translatePage(lang) {
  const strings = translations[lang] || translations.en;

  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.dataset.i18n;
    if (!key) return;
    const translation = strings[key];
    if (translation) el.textContent = translation;
  });

  document.querySelectorAll('[data-i18n-title]').forEach(el => {
    const key = el.dataset.i18nTitle;
    if (!key) return;
    const translation = strings[key];
    if (translation) el.title = translation;
  });

  const cameraOption = document.querySelector('#cameraSelector option[disabled]');
  if (cameraOption) {
    cameraOption.textContent = strings.selectCameraPrompt || cameraOption.textContent;
  }

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.title = strings.themeToggleTitle || themeToggle.title;
  }
}

// Also translate some elements that don't use data-i18n attributes
function translateExtras(strings) {
  const ndTitle = document.querySelector('.nd-handle span');
  if (ndTitle && strings.nodeDrawerTitle) ndTitle.textContent = strings.nodeDrawerTitle;

  const ndSearch = document.getElementById('ndSearch');
  if (ndSearch && strings.nodeSearchPlaceholder) ndSearch.placeholder = strings.nodeSearchPlaceholder;

  const intersectionName = document.getElementById('intersection-name');
  if (intersectionName) intersectionName.textContent = strings.selectIntersection || intersectionName.textContent;

  const liveStreamHeader = document.querySelector('.alert-widget .alert-widget-header span');
  if (liveStreamHeader && strings.LiveStream) liveStreamHeader.textContent = strings.LiveStream;

  const legendActive = document.querySelector('.map-legend .map-badge.blue');
  const legendClear = document.querySelector('.map-legend .map-badge.green');
  const legendAlert = document.querySelector('.map-legend .map-badge.red');
  if (legendActive && strings.legendActive) legendActive.childNodes[1] ? legendActive.childNodes[1].textContent = ' ' + strings.legendActive : legendActive.textContent = strings.legendActive;
  if (legendClear && strings.legendClear) legendClear.childNodes[1] ? legendClear.childNodes[1].textContent = ' ' + strings.legendClear : legendClear.textContent = strings.legendClear;
  if (legendAlert && strings.legendAlert) legendAlert.childNodes[1] ? legendAlert.childNodes[1].textContent = ' ' + strings.legendAlert : legendAlert.textContent = strings.legendAlert;
}

function setLanguage(lang) {
  const languageToggle = document.getElementById('languageToggle');
  const active = lang === 'ar';

  document.documentElement.lang = lang;
  document.body.classList.toggle('rtl', active);

  if (languageToggle) {
    const label = languageToggle.querySelector('.lang-label');
    if (label) label.textContent = active ? 'AR' : 'EN';
    languageToggle.title = active ? translations.ar.languageToggleTitle : translations.en.languageToggleTitle;
  }

  localStorage.setItem('language', lang);
  translateAll(lang);
}

// ensure extras are translated whenever page language changes
function translateAll(lang) {
  translatePage(lang);
  const strings = translations[lang] || translations.en;
  translateExtras(strings);
}

function initTheme() {
  const savedTheme = localStorage.getItem('theme');
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  const shouldBeDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
  setTheme(shouldBeDark);
}

function initLanguage() {
  const savedLanguage = localStorage.getItem('language') || 'en';
  setLanguage(savedLanguage);
}

// Expose to map script
window.setTheme = setTheme;
window.initMapWithTheme = function(map) {
  mapInstance = map;
  mapInstance.setView([36.8065, 10.1815], 4.5);
  
  setTimeout(() => {
    mapInstance.flyTo([36.8065, 10.1815], 9, {
      duration: 3,   // Animation duration in seconds (increase for a slower, smoother ride)
      easeLinearity: 0.4
    });
  }, 500); 
  currentTileLayer = document.body.classList.contains('dark') ? darkTiles : lightTiles;
  currentTileLayer.addTo(map);
};

// Toggle buttons
document.addEventListener('DOMContentLoaded', () => {
  const toggleBtn = document.getElementById('themeToggle');
  if (toggleBtn) {
    toggleBtn.addEventListener('click', () => {
      setTheme(!document.body.classList.contains('dark'));
    });
  }

  const languageToggle = document.getElementById('languageToggle');
  if (languageToggle) {
    languageToggle.addEventListener('click', () => {
      const currentLang = localStorage.getItem('language') || 'en';
      setLanguage(currentLang === 'ar' ? 'en' : 'ar');
    });
  }

  const recordsModalBtn = document.getElementById('recordsModalBtn');
  if (recordsModalBtn) {
    recordsModalBtn.addEventListener('click', () => {
      // Try stream modal intersection name first, fall back to intersection-name
      const streamNameEl = document.getElementById('stream_intersection_name');
      const intersectionEl = document.getElementById('intersection-name');
      let name = '';
      if (streamNameEl && streamNameEl.textContent && streamNameEl.textContent.trim() && !streamNameEl.textContent.includes('Select')) {
        name = streamNameEl.textContent.trim();
      } else if (intersectionEl && intersectionEl.textContent) {
        name = intersectionEl.textContent.trim();
      }
      const target = '../pages/records.html' + (name ? '?node=' + encodeURIComponent(name) : '');
      window.location.href = target;
    });
  }

  initTheme();
  initLanguage();
});


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


