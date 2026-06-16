// ═══════════════════════════════════════════════════════════════
//  GLOBAL_INCIDENT_ALERTS.JS — TraficCam Dashboard
//  Global real-time listener for incoming incidents via Supabase
// ═══════════════════════════════════════════════════════════════

// We use the same Supabase credentials as the app
const ALERT_SUPABASE_URL  = 'https://nqwldumrmksaiyyomiaz.supabase.co';
const ALERT_SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5xd2xkdW1ybWtzYWl5eW9taWF6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA1MTA4NDcsImV4cCI6MjA5NjA4Njg0N30.2DI6Bn971sJXRNVqpEtpAf-V4AxKEJIk6W8JNNjRViE';

// Create a short alert beep (base64) so we don't need external audio files
const alertSound = new Audio('data:audio/mp3;base64,//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq//NExAAAAANIAAAAAExBTUUzLjEwMKqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq');

document.addEventListener('DOMContentLoaded', () => {
  // 1. Ensure Supabase is loaded via CDN
  if (typeof supabase === 'undefined') {
    console.warn('Supabase not found. Incident alerts cannot start.');
    return;
  }

  // 2. Init client just for alerts
  const { createClient } = supabase;
  const alertSb = createClient(ALERT_SUPABASE_URL, ALERT_SUPABASE_ANON);

  // 3. Inject the Toast HTML container into the DOM if it doesn't exist
  if (!document.getElementById('global-alert-container')) {
    const container = document.createElement('div');
    container.id = 'global-alert-container';
    container.className = 'toast-container position-fixed top-0 end-0 p-3';
    container.style.zIndex = '99999';
    container.style.marginTop = '60px'; // clear the topbar
    document.body.appendChild(container);
  }

  // 4. Subscribe to new incident INSERTS
  alertSb
    .channel('public:incidents')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'incidents' }, payload => {
      console.log('🚨 NEW INCIDENT RECEIVED:', payload.new);
      showIncidentAlert(payload.new);
    })
    .subscribe((status) => {
      if (status === 'SUBSCRIBED') {
        console.log('✅ Connected to real-time incident alerts');
      }
    });
});

function showIncidentAlert(incident) {
  const container = document.getElementById('global-alert-container');
  if (!container) return;

  const officerName = incident.officer_name || `Officer #${incident.officer_badge || 'Unknown'}`;
  const severity = incident.severity || 'medium';
  const location = incident.location_description || 'Unknown location';
  
  // Choose color based on severity
  let color = '#f59e0b'; // warning (medium)
  if (severity === 'critical' || severity === 'high') color = '#ef4444'; // danger
  if (severity === 'low') color = '#3b82f6'; // info

  const toastId = 'alert-' + Date.now();
  const html = `
    <div id="${toastId}" class="toast" role="alert" aria-live="assertive" aria-atomic="true" data-bs-delay="10000" style="border:1px solid ${color};box-shadow:0 8px 24px rgba(0,0,0,0.15);">
      <div class="toast-header" style="background:${color}22; color:${color}; border-bottom:1px solid ${color}44;">
        <i class="fa-solid fa-triangle-exclamation me-2"></i>
        <strong class="me-auto" style="font-family:var(--font-display);font-weight:800;letter-spacing:0.5px;">NEW INCIDENT</strong>
        <small style="font-weight:600;text-transform:uppercase;">${severity}</small>
        <button type="button" class="btn-close" data-bs-dismiss="toast" aria-label="Close"></button>
      </div>
      <div class="toast-body" style="background:var(--surface); color:var(--text); display:flex; flex-direction:column; gap:8px;">
        <div><strong style="color:var(--text);">Reported by:</strong> ${officerName}</div>
        <div><strong style="color:var(--text);">Location:</strong> ${location}</div>
        ${incident.ai_description ? `<div style="font-size:11px;color:var(--muted);background:var(--surface2);padding:6px;border-radius:4px;">${incident.ai_description}</div>` : ''}
        <div style="margin-top:6px;">
          <a href="../pages/records.html" class="btn btn-sm w-100" style="background:${color};color:#fff;font-size:11px;font-weight:700;">View in Records</a>
        </div>
      </div>
    </div>
  `;

  // Append toast
  container.insertAdjacentHTML('beforeend', html);

  // Try to play sound (browsers might block it if no interaction, but we try)
  try { alertSound.play().catch(e=>console.log('Audio blocked:', e)); } catch(err){}

  // Init and show with Bootstrap
  const toastEl = document.getElementById(toastId);
  if (typeof bootstrap !== 'undefined') {
    const bsToast = new bootstrap.Toast(toastEl);
    bsToast.show();
  }

  // Cleanup DOM after hide
  toastEl.addEventListener('hidden.bs.toast', () => {
    toastEl.remove();
  });
}
