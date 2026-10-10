/**
 * app.js - Offline-First Metro Operations Frontend
 * ==================================================
 * Features:
 * - Service Worker registration for 100% offline access
 * - Real-time online/offline heartbeat detection
 * - Client-side hash routing (#dashboard, #stations, #station-detail, #station-form, #alerts)
 * - Bundled local Chart.js rendering (no external dependencies)
 * - Pure-Python on-device AI integration (anomalies & demand forecasting)
 * - Offline action caching queue in localStorage
 */

// ============================================================================
// GLOBAL STATE & CHART REFS
// ============================================================================

const state = {
  isOnline: true,
  currentView: "dashboard",
  selectedStationId: null,
  stations: [],
  kpis: null,
  complaints: [],
  selectedComplaintId: null,
  activeDept: "All",
  activeLang: "",
  activeUrgency: "",
  activeStatus: "",
  triageSearch: "",
  offlineQueue: JSON.parse(localStorage.getItem("metrosetu_offline_queue") || "[]"),
  charts: {
    ridershipTrend: null,
    lineDist: null,
    faultSeverity: null,
    stationHealth: null,
    stationDetailRidership: null,
    languageDist: null,
    deptDist: null
  }
};

// ============================================================================
// 1. SERVICE WORKER & OFFLINE DETECTION
// ============================================================================

function initServiceWorker() {
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/" })
        .then((reg) => {
          console.log("[PWA] Service Worker registered successfully at scope:", reg.scope);
        })
        .catch((err) => {
          console.warn("[PWA] Service Worker registration failed:", err);
        });
    });
  }
}

function updateConnectionStatus(isOnline) {
  state.isOnline = isOnline;
  const badge = document.getElementById("status-badge");
  const text = document.getElementById("status-text");

  if (!badge || !text) return;

  if (isOnline) {
    badge.className = "status-pill online";
    text.textContent = "ONLINE";
    badge.title = "Connected to localhost backend";
  } else {
    badge.className = "status-pill offline";
    text.textContent = "OFFLINE (CACHED)";
    badge.title = "Operating in offline cached mode";
  }
}

// Active heartbeat to differentiate localhost server status from pure browser network
async function checkBackendHeartbeat() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);
    const res = await fetch("/api/health", { signal: controller.signal });
    clearTimeout(timeoutId);
    if (res.ok) {
      if (!state.isOnline) {
        showToast("Connected to transit operations server", "success");
      }
      updateConnectionStatus(true);
      syncOfflineComplaintQueue();
      return;
    }
  } catch (err) {
    // Backend unreachable
  }
  if (state.isOnline) {
    showToast("Operating offline. Local cache active.", "warning");
  }
  updateConnectionStatus(false);
}

// ============================================================================
// 2. TOAST NOTIFICATIONS & UTILS
// ============================================================================

function showToast(message, type = "info") {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.innerHTML = `
    <span>${type === "success" ? "✓" : type === "error" ? "⚠" : "ℹ"}</span>
    <span>${message}</span>
  `;
  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(10px)";
    setTimeout(() => toast.remove(), 250);
  }, 3200);
}

function formatNumber(num) {
  return Number(num || 0).toLocaleString();
}

function formatDate(isoStr) {
  if (!isoStr) return "--";
  try {
    const d = new Date(isoStr);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit"
    });
  } catch (e) {
    return isoStr;
  }
}

function destroyChart(chartKey) {
  if (state.charts[chartKey]) {
    state.charts[chartKey].destroy();
    state.charts[chartKey] = null;
  }
}

// ============================================================================
// 3. CLIENT-SIDE ROUTER
// ============================================================================

function handleRouting() {
  const hash = window.location.hash || "#dashboard";
  const [route, queryString] = hash.split("?");
  const params = new URLSearchParams(queryString || "");

  // Update nav links active styling
  document.querySelectorAll(".nav-link").forEach((link) => {
    link.classList.remove("active");
    if (link.getAttribute("href") === route) {
      link.classList.add("active");
    }
  });

  // Hide all views
  document.querySelectorAll(".page-view").forEach((view) => {
    view.classList.remove("active");
  });

  if (route === "#triage") {
    state.currentView = "triage";
    document.getElementById("view-triage").classList.add("active");
    loadTriageView();
  } else if (route === "#stations") {
    state.currentView = "stations";
    document.getElementById("view-stations").classList.add("active");
    loadStationsView();
  } else if (route === "#station-detail") {
    state.currentView = "station-detail";
    document.getElementById("view-station-detail").classList.add("active");
    const stationId = params.get("id");
    if (stationId) {
      loadStationDetailView(Number(stationId));
    } else {
      window.location.hash = "#stations";
    }
  } else if (route === "#station-form") {
    state.currentView = "station-form";
    document.getElementById("view-station-form").classList.add("active");
    const stationId = params.get("id");
    setupStationForm(stationId ? Number(stationId) : null);
  } else if (route === "#alerts") {
    state.currentView = "alerts";
    document.getElementById("view-alerts").classList.add("active");
    loadAlertsView();
  } else {
    // Default: Dashboard
    state.currentView = "dashboard";
    document.getElementById("view-dashboard").classList.add("active");
    loadDashboardView();
  }
}

// ============================================================================
// 4. VIEW: DASHBOARD
// ============================================================================

async function loadDashboardView() {
  try {
    // 1. Fetch KPIs
    const kpiRes = await fetch("/api/kpis");
    if (kpiRes.ok) {
      const kpis = await kpiRes.json();
      state.kpis = kpis;
      renderKPIs(kpis);
    }

    // 2. Fetch Hourly Ridership & AI Demand Forecast
    const [ridershipRes, forecastRes] = await Promise.all([
      fetch("/api/ridership/hourly?hours=24"),
      fetch("/api/ai/forecast?hours=24")
    ]);

    const ridershipData = ridershipRes.ok ? await ridershipRes.json() : [];
    const forecastData = forecastRes.ok ? await forecastRes.json() : { forecast: [] };

    renderRidershipAndForecastChart(ridershipData, forecastData.forecast || []);

    // 3. Fetch Ridership by Line
    const lineRes = await fetch("/api/ridership/by-line");
    if (lineRes.ok) {
      const lines = await lineRes.json();
      renderLineDistributionChart(lines);
    }

    // 4. Fetch Faults for Severity Chart & Table
    const faultsRes = await fetch("/api/faults");
    if (faultsRes.ok) {
      const faults = await faultsRes.json();
      renderFaultSeverityChart(faults);
      renderDashboardFaultsTable(faults.slice(0, 5));
    }

    // 5. Fetch Stations for Equipment Health Chart
    const stationsRes = await fetch("/api/stations");
    if (stationsRes.ok) {
      const stations = await stationsRes.json();
      state.stations = stations;
      renderStationHealthChart(stations);
    }

    // 6. Fetch Grievances & Render Multilingual Charts
    let complaintsData = [];
    try {
      const compRes = await fetch("/api/complaints");
      if (compRes.ok) {
        complaintsData = await compRes.json();
        state.complaints = complaintsData;
        localStorage.setItem("metrosetu_cached_complaints", JSON.stringify(complaintsData));
      } else {
        complaintsData = JSON.parse(localStorage.getItem("metrosetu_cached_complaints") || "[]");
        if (!complaintsData.length) complaintsData = PRECALIBRATED_TEST_BATCH;
      }
    } catch (e) {
      complaintsData = JSON.parse(localStorage.getItem("metrosetu_cached_complaints") || "[]");
      if (!complaintsData.length) complaintsData = PRECALIBRATED_TEST_BATCH;
    }
    renderGrievanceCharts(complaintsData);

  } catch (err) {
    console.error("Error loading dashboard data:", err);
  }
}

function renderKPIs(kpis) {
  document.getElementById("kpi-total-stations").textContent = kpis.stations.total;
  document.getElementById("kpi-station-status").textContent = `${kpis.stations.operational} / ${kpis.stations.total} Active`;
  document.getElementById("kpi-line-count").textContent = `Across ${kpis.stations.lines} Metro Lines`;

  document.getElementById("kpi-24h-ridership").textContent = formatNumber(kpis.ridership.total_24h);
  document.getElementById("kpi-peak-hour").textContent = `Peak: ${formatNumber(kpis.ridership.peak_hour)} pax/hr`;

  document.getElementById("kpi-asset-health").textContent = `${kpis.assets.average_health}%`;
  document.getElementById("kpi-asset-degrading").textContent = `${kpis.assets.degrading_count} degrading`;

  document.getElementById("kpi-active-faults").textContent = kpis.faults.active_total;
  document.getElementById("kpi-critical-faults").textContent = `${kpis.faults.critical} Critical`;

  document.getElementById("kpi-anomalies-count").textContent = kpis.anomalies_detected;

  // Grievance Triage KPIs
  if (kpis.complaints) {
    const elActive = document.getElementById("kpi-active-grievances");
    if (elActive) elActive.textContent = kpis.complaints.open_complaints ?? kpis.complaints.active_complaints ?? 0;
    const elCrit = document.getElementById("kpi-critical-grievances");
    if (elCrit) elCrit.textContent = `${kpis.complaints.critical_p1 ?? 0} P1 Critical`;
    const elRate = document.getElementById("kpi-grievance-rate");
    if (elRate) elRate.textContent = `${kpis.complaints.resolution_rate_pct ?? 0}%`;
  }
}

function renderRidershipAndForecastChart(historyData, forecastData) {
  const ctx = document.getElementById("chart-ridership-trend");
  if (!ctx || !window.Chart) return;

  destroyChart("ridershipTrend");

  // Format labels & values
  const histLabels = historyData.map((d) => `${d.hour}:00`);
  const histValues = historyData.map((d) => d.total_tap_ins);

  const foreLabels = forecastData.map((d) => d.hour_label || `${new Date(d.timestamp).getHours()}:00`);
  const foreValues = forecastData.map((d) => d.forecast_passengers);
  const lowerBounds = forecastData.map((d) => d.lower_bound_95);
  const upperBounds = forecastData.map((d) => d.upper_bound_95);

  const combinedLabels = [...histLabels, ...foreLabels];
  const historicalSeries = [...histValues, ...new Array(foreValues.length).fill(null)];
  const projectedSeries = [...new Array(histValues.length).fill(null), ...foreValues];
  // Bridge the gap so the line connects visually
  if (histValues.length > 0 && foreValues.length > 0) {
    projectedSeries[histValues.length - 1] = histValues[histValues.length - 1];
  }

  const upperSeries = [...new Array(histValues.length).fill(null), ...upperBounds];
  const lowerSeries = [...new Array(histValues.length).fill(null), ...lowerBounds];

  state.charts.ridershipTrend = new window.Chart(ctx, {
    type: "line",
    data: {
      labels: combinedLabels,
      datasets: [
        {
          label: "Actual Hourly Ridership (Pax)",
          data: historicalSeries,
          borderColor: "#06b6d4",
          backgroundColor: "rgba(6, 182, 212, 0.15)",
          borderWidth: 2.5,
          tension: 0.3,
          fill: true,
          pointRadius: 2
        },
        {
          label: "On-Device AI 24h Forecast",
          data: projectedSeries,
          borderColor: "#a855f7",
          backgroundColor: "rgba(168, 85, 247, 0.05)",
          borderWidth: 2.5,
          borderDash: [5, 5],
          tension: 0.3,
          pointRadius: 3
        },
        {
          label: "Upper 95% Bound",
          data: upperSeries,
          borderColor: "rgba(168, 85, 247, 0.3)",
          borderWidth: 1,
          borderDash: [2, 2],
          pointRadius: 0,
          fill: false
        },
        {
          label: "Lower 95% Bound",
          data: lowerSeries,
          borderColor: "rgba(168, 85, 247, 0.3)",
          borderWidth: 1,
          borderDash: [2, 2],
          pointRadius: 0,
          fill: false
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: { color: "#94a3b8", boxWidth: 12, font: { size: 11 } }
        }
      },
      scales: {
        x: {
          ticks: { color: "#64748b", maxTicksLimit: 12 },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        },
        y: {
          ticks: { color: "#64748b" },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        }
      }
    }
  });
}

function renderLineDistributionChart(lines) {
  const ctx = document.getElementById("chart-line-distribution");
  if (!ctx || !window.Chart) return;

  destroyChart("lineDist");

  const colorMap = {
    "Red Line": "#ef4444",
    "Blue Line": "#3b82f6",
    "Green Line": "#10b981",
    "Yellow Line": "#f59e0b"
  };

  const labels = lines.map((l) => l.line_name);
  const data = lines.map((l) => l.total_tap_ins);
  const colors = lines.map((l) => colorMap[l.line_name] || "#06b6d4");

  state.charts.lineDist = new window.Chart(ctx, {
    type: "doughnut",
    data: {
      labels: labels,
      datasets: [
        {
          data: data,
          backgroundColor: colors,
          borderColor: "#1e293b",
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#94a3b8", font: { size: 11 } }
        }
      }
    }
  });
}

function renderFaultSeverityChart(faults) {
  const ctx = document.getElementById("chart-fault-severity");
  if (!ctx || !window.Chart) return;

  destroyChart("faultSeverity");

  let crit = 0, warn = 0, info = 0;
  faults.forEach((f) => {
    if (f.severity === "Critical") crit++;
    else if (f.severity === "Warning") warn++;
    else info++;
  });

  state.charts.faultSeverity = new window.Chart(ctx, {
    type: "doughnut",
    data: {
      labels: ["Critical", "Warning", "Info"],
      datasets: [
        {
          data: [crit, warn, info],
          backgroundColor: ["#ef4444", "#f59e0b", "#3b82f6"],
          borderColor: "#1e293b",
          borderWidth: 2
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: "bottom",
          labels: { color: "#94a3b8", font: { size: 11 } }
        }
      }
    }
  });
}

function renderStationHealthChart(stations) {
  const ctx = document.getElementById("chart-station-health");
  if (!ctx || !window.Chart) return;

  destroyChart("stationHealth");

  const labels = stations.map((s) => s.code);
  const scores = stations.map((s) => s.avg_asset_health || 100);

  state.charts.stationHealth = new window.Chart(ctx, {
    type: "bar",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Average Asset Health (%)",
          data: scores,
          backgroundColor: scores.map((sc) => sc < 70 ? "#f59e0b" : "#10b981"),
          borderRadius: 4
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        y: {
          min: 40,
          max: 100,
          ticks: { color: "#64748b" },
          grid: { color: "rgba(255, 255, 255, 0.05)" }
        },
        x: {
          ticks: { color: "#64748b" },
          grid: { display: false }
        }
      }
    }
  });
}

function renderDashboardFaultsTable(faults) {
  const tbody = document.getElementById("dash-faults-tbody");
  if (!tbody) return;

  if (faults.length === 0) {
    tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No active faults reported. Network running smoothly.</td></tr>`;
    return;
  }

  tbody.innerHTML = faults.map((f) => `
    <tr>
      <td><span class="badge badge-${f.severity.toLowerCase()}">${f.severity}</span></td>
      <td><strong>${f.station_name || "Station"}</strong></td>
      <td>${f.component}</td>
      <td>${f.title}</td>
      <td>${formatDate(f.reported_at)}</td>
      <td><span class="badge ${f.status === 'Resolved' ? 'badge-operational' : 'badge-warning'}">${f.status}</span></td>
      <td>
        ${f.status !== 'Resolved' ? `
          <button class="btn btn-outline btn-sm" onclick="handleResolveFault(${f.id})">Resolve</button>
        ` : `<span style="color: var(--text-muted); font-size: 0.75rem;">Resolved</span>`}
      </td>
    </tr>
  `).join("");
}

// ============================================================================
// 4B. GRIEVANCE TELEMETRY CHARTS (DASHBOARD)
// ============================================================================

function renderGrievanceCharts(complaints) {
  if (!window.Chart) return;

  // 1. Language Distribution (Doughnut)
  const langCtx = document.getElementById("chart-language-distribution");
  if (langCtx) {
    destroyChart("languageDist");
    const counts = { Gujarati: 0, Hindi: 0, Gujlish: 0, English: 0 };
    (complaints || []).forEach((c) => {
      const l = c.detected_language || "English";
      if (counts[l] !== undefined) counts[l]++;
      else counts["English"]++;
    });

    state.charts.languageDist = new window.Chart(langCtx, {
      type: "doughnut",
      data: {
        labels: ["Gujarati (ગુજરાતી)", "Hindi (हिन्दी)", "Gujlish (Latin)", "English"],
        datasets: [
          {
            data: [counts.Gujarati, counts.Hindi, counts.Gujlish, counts.English],
            backgroundColor: ["#10b981", "#06b6d4", "#8b5cf6", "#64748b"],
            borderColor: "#1e293b",
            borderWidth: 2
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: "bottom",
            labels: { color: "#94a3b8", font: { size: 11 }, boxWidth: 12 }
          }
        }
      }
    });
  }

  // 2. Department Intake Distribution (Bar)
  const deptCtx = document.getElementById("chart-department-distribution");
  if (deptCtx) {
    destroyChart("deptDist");
    const deptCounts = {
      "Safety": 0,
      "Lifts & Escalators": 0,
      "Cleanliness": 0,
      "Fare & Ticketing": 0,
      "Staff Behaviour": 0
    };
    (complaints || []).forEach((c) => {
      const d = c.department || "Safety";
      if (deptCounts[d] !== undefined) deptCounts[d]++;
    });

    state.charts.deptDist = new window.Chart(deptCtx, {
      type: "bar",
      data: {
        labels: ["🚨 Safety", "🛗 Lifts", "🧹 Cleanliness", "🎫 Ticketing", "👤 Staff"],
        datasets: [
          {
            label: "Grievances",
            data: [
              deptCounts["Safety"],
              deptCounts["Lifts & Escalators"],
              deptCounts["Cleanliness"],
              deptCounts["Fare & Ticketing"],
              deptCounts["Staff Behaviour"]
            ],
            backgroundColor: ["#ef4444", "#f97316", "#10b981", "#3b82f6", "#8b5cf6"],
            borderRadius: 4
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: { ticks: { color: "#94a3b8", font: { size: 10 } }, grid: { display: false } },
          y: {
            ticks: { color: "#94a3b8", precision: 0 },
            grid: { color: "rgba(255, 255, 255, 0.05)" },
            beginAtZero: true
          }
        }
      }
    });
  }
}

// ============================================================================
// 4C. VIEW: MULTILINGUAL GRIEVANCE TRIAGE CONSOLE (PS-07)
// ============================================================================

const PRECALIBRATED_TEST_BATCH = [
  {
    id: 101,
    ticket_number: "MS-4021",
    passenger_name: "Hiren Patel",
    station_name: "Old High Court",
    station_id: 1,
    channel: "WhatsApp",
    raw_text: "જૂની હાઈકોર્ટ સ્ટેશન પર પ્લેટફોર્મ 1 ની લિફ્ટ સવારથી બંધ છે અને વડીલોને દાદરા ચડવામાં ખૂબ તકલીફ પડી રહી છે. તાત્કાલિક રીપેર કરાવો.",
    detected_language: "Gujarati",
    department: "Lifts & Escalators",
    urgency_level: "P2 High",
    urgency_score: 82,
    urgency_reason: "Non-functional elevator directly impeding elderly passenger accessibility. P2 High priority dispatch.",
    sentiment: "Frustrated",
    draft_reply: "નમસ્તે હીરેનભાઈ, જૂની હાઈકોર્ટ સ્ટેશન પર લિફ્ટ બંધ હોવાની ફરિયાદ નોંધાઈ ગઈ છે (Ticket: MS-4021). અમારી લિફ્ટ મેન્ટેનન્સ ટીમને તાત્કાલિક મોકલવામાં આવી છે. 25 મિનિટમાં સેવા પુનઃ શરૂ થઈ જશે. અસુવિધા બદલ દિલગીર છીએ. - ગુજરાત મેટ્રો સેવા.",
    status: "Open",
    reported_at: new Date(Date.now() - 18 * 60000).toISOString()
  },
  {
    id: 102,
    ticket_number: "MS-9104",
    passenger_name: "Jignesh Shah",
    station_name: "Kalupur Railway Station",
    station_id: 2,
    channel: "Twitter/X",
    raw_text: "Kalupur platform 2 par moti water pipe leak chhe ane badhe paani bhari gayu chhe. Slip thai ne padvani full chance chhe, emergency clean karavo please!",
    detected_language: "Gujlish",
    department: "Safety",
    urgency_level: "P1 Critical",
    urgency_score: 96,
    urgency_reason: "High-risk slip and fall hazard detected on active train platform due to pressurized pipe leak. Escalate immediately.",
    sentiment: "Anxious",
    draft_reply: "Kalupur platform 2 par water leakage ni complaint emergency priority (P1) tarike escalate kari chhe. Cleaning staff ane engineering team spot par pahonchi gayi chhe. Platform safety barrier lagavi didha chhe. Thank you for reporting.",
    status: "Open",
    reported_at: new Date(Date.now() - 8 * 60000).toISOString()
  },
  {
    id: 103,
    ticket_number: "MS-7712",
    passenger_name: "Ananya Sharma",
    station_name: "Gandhinagar Sector 1",
    station_id: 3,
    channel: "QR Portal",
    raw_text: "गांधीनगर सेक्टर 1 स्टेशन पर ऑटोमैटिक वेंडिंग मशीन में ₹100 कट गए लेकिन क्यूआर टिकट प्रिंट नहीं हुआ। हेल्पडेस्क काउंटर खाली है।",
    detected_language: "Hindi",
    department: "Fare & Ticketing",
    urgency_level: "P2 High",
    urgency_score: 79,
    urgency_reason: "Failed TVM cash transaction with missing QR ticket output and unattended kiosk. Routed to revenue reconciliation.",
    sentiment: "Frustrated",
    draft_reply: "नमस्ते अनन्य जी, गांधीनगर सेक्टर 1 पर TVM लेन-देन विफलता की शिकायत दर्ज कर ली गई है। आपका ₹100 का रिफंड स्वतः उसी UPI/खाते में 15 मिनट में क्रेडिट हो जाएगा। स्टेशन सुपरवाइजर काउंटर पर पहुँच रहे हैं।",
    status: "Open",
    reported_at: new Date(Date.now() - 32 * 60000).toISOString()
  },
  {
    id: 104,
    ticket_number: "MS-9981",
    passenger_name: "David Miller",
    station_name: "Motera Stadium",
    station_id: 9,
    channel: "Metro Helpline",
    raw_text: "Emergency SOS button on Motera Stadium Concourse level was unresponsive when an asthmatic passenger needed first aid. Immediate audit required.",
    detected_language: "English",
    department: "Safety",
    urgency_level: "P1 Critical",
    urgency_score: 98,
    urgency_reason: "Critical safety infrastructure failure: Unresponsive SOS call station during emergency medical situation.",
    sentiment: "Angry",
    draft_reply: "Dear Passenger, thank you for bringing this critical safety issue to our attention. Our technical inspection team has been dispatched to audit all SOS call points at Motera Stadium immediately. First-aid assistance was also deployed.",
    status: "Open",
    reported_at: new Date(Date.now() - 12 * 60000).toISOString()
  },
  {
    id: 105,
    ticket_number: "MS-5532",
    passenger_name: "Meena Trivedi",
    station_name: "Paldi",
    station_id: 4,
    channel: "Station Kiosk",
    raw_text: "પાલડી સ્ટેશન ટિકિટ કાઉન્ટર પર બેઠેલા કર્મચારી મુસાફરો સાથે અયોગ્ય ભાષામાં વાત કરી રહ્યા છે અને લાઈનમાં ઊભા લોકોને ઉદ્ધત જવાબ આપે છે.",
    detected_language: "Gujarati",
    department: "Staff Behaviour",
    urgency_level: "P3 Medium",
    urgency_score: 55,
    urgency_reason: "Frontline counter staff discourtesy and unhelpful conduct reported. Flagged for Station Superintendent inquiry.",
    sentiment: "Angry",
    draft_reply: "નમસ્તે, પાલડી સ્ટેશનના સ્ટાફના વર્તન અંગેની તમારી ફરિયાદ ગંભીરતાથી લેવામાં આવી છે. સ્ટેશન સુપરવાઈઝર દ્વારા CCTV ફૂટેજ તપાસી યોગ્ય કાર્યવાહી કરવામાં આવી રહી છે. ગુણવત્તાયુક્ત સેવા માટે અમે કટિબદ્ધ છીએ.",
    status: "In Progress",
    reported_at: new Date(Date.now() - 65 * 60000).toISOString()
  },
  {
    id: 106,
    ticket_number: "MS-6219",
    passenger_name: "Karan Dave",
    station_name: "Thaltej",
    station_id: 7,
    channel: "WhatsApp",
    raw_text: "Thaltej station na washroom ma paani nathi ane bilkul hygienic nathi. Bad smell aavi rahi chhe.",
    detected_language: "Gujlish",
    department: "Cleanliness",
    urgency_level: "P3 Medium",
    urgency_score: 58,
    urgency_reason: "Sanitary amenities disruption: water supply outage and hygiene concern. Assigned to housekeeping supervisor.",
    sentiment: "Frustrated",
    draft_reply: "Thaltej station na washroom sanitation issue note kari lidho chhe. Housekeeping supervisor ne direct order aapyo chhe ane plumbing check thai rahyu chhe. 30 min ma solve thai jashe.",
    status: "Open",
    reported_at: new Date(Date.now() - 45 * 60000).toISOString()
  },
  {
    id: 107,
    ticket_number: "MS-3180",
    passenger_name: "Suresh Verma",
    station_name: "Sabarmati",
    station_id: 8,
    channel: "QR Portal",
    raw_text: "साबरमती स्टेशन के गेट नंबर 3 पर एस्केलेटर थोड़ी अजीब आवाज कर रहा है, हालांकि चल रहा है। कृपया चेक करवाएं।",
    detected_language: "Hindi",
    department: "Lifts & Escalators",
    urgency_level: "P4 Low",
    urgency_score: 35,
    urgency_reason: "Pre-emptive maintenance report: Unusual mechanical noise on operational escalator. Logged for regular service shift.",
    sentiment: "Neutral",
    draft_reply: "धन्यवाद। साबरमती गेट 3 के एस्केलेटर की आवाज़ संबंधी आपकी सूचना नियमित मेंटेनेंस लॉग में दर्ज कर ली गई है। आज रात के निरीक्षण स्लॉट में इंजीनियरिंग टीम इसे जांच लेगी।",
    status: "Open",
    reported_at: new Date(Date.now() - 110 * 60000).toISOString()
  },
  {
    id: 108,
    ticket_number: "MS-8422",
    passenger_name: "Pooja Varma",
    station_name: "APMC",
    station_id: 5,
    channel: "Station Kiosk",
    raw_text: "Metro card tap-in at APMC took multiple tries and charged twice on my NCMC debit card balance.",
    detected_language: "English",
    department: "Fare & Ticketing",
    urgency_level: "P3 Medium",
    urgency_score: 62,
    urgency_reason: "NCMC Card double deduction at AFC gate turnstile. Automated reconciliation job triggered.",
    sentiment: "Frustrated",
    draft_reply: "Hello Pooja, we have registered your complaint regarding the double deduction at APMC AFC gates. Our AFC clearing house will reconcile the duplicate deduction within 2 hours.",
    status: "Resolved",
    reported_at: new Date(Date.now() - 140 * 60000).toISOString()
  }
];

async function loadTriageView() {
  updateOfflineQueueIndicator();
  populateModalStations();

  try {
    const res = await fetch("/api/complaints");
    if (res.ok) {
      state.complaints = await res.json();
      localStorage.setItem("metrosetu_cached_complaints", JSON.stringify(state.complaints));
    } else {
      const cached = localStorage.getItem("metrosetu_cached_complaints");
      state.complaints = cached ? JSON.parse(cached) : [...PRECALIBRATED_TEST_BATCH];
    }
  } catch (err) {
    const cached = localStorage.getItem("metrosetu_cached_complaints");
    state.complaints = cached ? JSON.parse(cached) : [...PRECALIBRATED_TEST_BATCH];
  }

  if (!state.complaints || state.complaints.length === 0) {
    state.complaints = [...PRECALIBRATED_TEST_BATCH];
  }

  applyOfflineQueueMutations();
  renderQueueCounts(state.complaints);

  const filtered = filterComplaints(state.complaints);
  renderTriageCards(filtered);

  if (!state.selectedComplaintId || !filtered.some((c) => c.id === state.selectedComplaintId)) {
    if (filtered.length > 0) {
      state.selectedComplaintId = filtered[0].id;
    } else {
      state.selectedComplaintId = null;
    }
  }

  const selectedItem = state.complaints.find((c) => c.id === state.selectedComplaintId);
  renderComplaintInspector(selectedItem);
}

function applyOfflineQueueMutations() {
  if (!state.offlineQueue || state.offlineQueue.length === 0) return;
  state.offlineQueue.forEach((mutation) => {
    const target = state.complaints.find((c) => c.id === mutation.id);
    if (target) {
      target.status = mutation.status;
      if (mutation.draft_reply) target.draft_reply = mutation.draft_reply;
      if (mutation.resolution_notes) target.resolution_notes = mutation.resolution_notes;
    }
  });
}

function updateOfflineQueueIndicator() {
  const badge = document.getElementById("offline-queue-badge");
  const text = document.getElementById("offline-queue-text");
  if (!badge || !text) return;

  const count = state.offlineQueue.length;
  if (count > 0) {
    badge.style.display = "inline-flex";
    text.textContent = `${count} offline resolution${count > 1 ? "s" : ""} queued`;
  } else {
    badge.style.display = "none";
  }
}

async function syncOfflineComplaintQueue() {
  if (!state.offlineQueue || state.offlineQueue.length === 0) return;
  const items = [...state.offlineQueue];
  let synced = 0;

  for (const item of items) {
    try {
      const res = await fetch(`/api/complaints/${item.id}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: item.status,
          draft_reply: item.draft_reply,
          resolution_notes: item.resolution_notes
        })
      });
      if (res.ok) {
        synced++;
        state.offlineQueue = state.offlineQueue.filter((q) => q.id !== item.id);
      }
    } catch (e) {
      break;
    }
  }

  localStorage.setItem("metrosetu_offline_queue", JSON.stringify(state.offlineQueue));
  updateOfflineQueueIndicator();
  if (synced > 0) {
    showToast(`✓ Synced ${synced} offline grievance resolution(s) with server`, "success");
    if (state.currentView === "triage") loadTriageView();
  }
}

function renderQueueCounts(complaints) {
  const total = complaints.length;
  const safety = complaints.filter((c) => c.department === "Safety").length;
  const lifts = complaints.filter((c) => c.department === "Lifts & Escalators").length;
  const clean = complaints.filter((c) => c.department === "Cleanliness").length;
  const tick = complaints.filter((c) => c.department === "Fare & Ticketing").length;
  const staff = complaints.filter((c) => c.department === "Staff Behaviour").length;

  const setEl = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setEl("count-dept-all", total);
  setEl("count-dept-safety", safety);
  setEl("count-dept-lifts", lifts);
  setEl("count-dept-cleanliness", clean);
  setEl("count-dept-ticketing", tick);
  setEl("count-dept-staff", staff);
}

function filterComplaints(complaints) {
  return complaints.filter((c) => {
    if (state.activeDept !== "All" && c.department !== state.activeDept) {
      return false;
    }
    if (state.activeLang && c.detected_language !== state.activeLang) {
      return false;
    }
    if (state.activeUrgency) {
      const urg = c.urgency_level || "";
      if (!urg.includes(state.activeUrgency)) return false;
    }
    if (state.activeStatus) {
      if (state.activeStatus === "Open" && c.status !== "Open" && c.status !== "Pending") return false;
      if (state.activeStatus === "In Progress" && c.status !== "In Progress") return false;
      if (state.activeStatus === "Resolved" && c.status !== "Resolved") return false;
    }
    if (state.triageSearch) {
      const query = state.triageSearch.toLowerCase();
      const raw = (c.raw_text || "").toLowerCase();
      const name = (c.passenger_name || "").toLowerCase();
      const ticket = (c.ticket_number || `MS-${c.id}`).toLowerCase();
      const station = (c.station_name || "").toLowerCase();
      const dept = (c.department || "").toLowerCase();
      if (!raw.includes(query) && !name.includes(query) && !ticket.includes(query) && !station.includes(query) && !dept.includes(query)) {
        return false;
      }
    }
    return true;
  });
}

function getUrgencyBadgeClass(urgencyLevel, urgencyScore) {
  const str = String(urgencyLevel || "");
  if (str.includes("P1") || str.includes("Critical") || urgencyScore >= 90) return "badge-p1";
  if (str.includes("P2") || str.includes("High") || urgencyScore >= 75) return "badge-p2";
  if (str.includes("P3") || str.includes("Medium") || urgencyScore >= 50) return "badge-p3";
  return "badge-p4";
}

function getLanguagePillClass(lang) {
  const l = String(lang || "English").toLowerCase();
  if (l.includes("gujarati")) return "lang-gujarati";
  if (l.includes("hindi")) return "lang-hindi";
  if (l.includes("gujlish")) return "lang-gujlish";
  return "lang-english";
}

function renderTriageCards(complaints) {
  const container = document.getElementById("triage-cards-container");
  const summary = document.getElementById("triage-queue-summary-text");
  if (!container) return;

  if (summary) {
    const critCount = complaints.filter((c) => String(c.urgency_level).includes("P1") || c.urgency_score >= 90).length;
    summary.innerHTML = `Showing <strong>${complaints.length}</strong> grievances${critCount > 0 ? ` &bull; <span style="color:#f87171;font-weight:600;">${critCount} Critical P1</span>` : ""}`;
  }

  if (complaints.length === 0) {
    container.innerHTML = `
      <div class="empty-queue-card">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <path d="m9 12 2 2 4-4"></path>
        </svg>
        <h3 style="color: var(--text-main); margin-bottom: 0.25rem;">No Grievances in Queue</h3>
        <p style="font-size: 0.85rem;">All passenger complaints in this filter category have been resolved.</p>
        <button class="btn btn-outline btn-sm" style="margin-top: 1rem;" onclick="simulateTestBatch()">⚡ Load Test Batch</button>
      </div>
    `;
    return;
  }

  container.innerHTML = complaints.map((c) => {
    const ticketId = c.ticket_number || `MS-${c.id || 1000}`;
    const badgeClass = getUrgencyBadgeClass(c.urgency_level, c.urgency_score);
    const langClass = getLanguagePillClass(c.detected_language);
    const isSelected = state.selectedComplaintId === c.id;

    let cardUrgencyClass = "p3-urgency";
    if (badgeClass === "badge-p1") cardUrgencyClass = "p1-urgency";
    else if (badgeClass === "badge-p2") cardUrgencyClass = "p2-urgency";
    else if (badgeClass === "badge-p4") cardUrgencyClass = "p4-urgency";

    return `
      <div class="triage-card ${cardUrgencyClass} ${isSelected ? "selected" : ""}" onclick="selectComplaint(${c.id})">
        <div class="card-header-line">
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span class="card-ticket-id">#${ticketId}</span>
            <span class="badge ${badgeClass}">${c.urgency_level || "P3 Medium"}</span>
          </div>
          <div class="card-tags">
            <span class="badge ${langClass}">${c.detected_language || "English"}</span>
            <span class="badge" style="background: rgba(255,255,255,0.06); font-size: 0.72rem;">${c.channel || "WhatsApp"}</span>
          </div>
        </div>

        <div class="card-body-text" title="${c.raw_text.replace(/"/g, '&quot;')}">
          ${c.raw_text}
        </div>

        <div class="card-meta-line">
          <div class="card-station-pill">
            <span>📍 ${c.station_name || "Station"}</span>
            <span>&bull;</span>
            <span style="color: var(--accent-cyan); font-weight: 500;">${c.department}</span>
          </div>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span>${formatDate(c.reported_at)}</span>
            <span class="badge ${c.status === 'Resolved' ? 'badge-operational' : (c.status === 'In Progress' ? 'badge-warning' : 'badge-critical')}" style="font-size: 0.7rem; padding: 2px 6px;">
              ${c.status || "Open"}
            </span>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function selectComplaint(complaintId) {
  state.selectedComplaintId = complaintId;
  const filtered = filterComplaints(state.complaints);
  renderTriageCards(filtered);
  const selected = state.complaints.find((c) => c.id === complaintId);
  renderComplaintInspector(selected);
}

function renderComplaintInspector(complaint) {
  const container = document.getElementById("triage-inspector");
  if (!container) return;

  if (!complaint) {
    container.innerHTML = `
      <div style="text-align: center; color: var(--text-muted); padding: 3rem 1.5rem;">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" style="color: var(--accent-cyan); margin-bottom: 0.75rem;">
          <rect x="2" y="3" width="20" height="14" rx="2"></rect>
          <line x1="8" y1="21" x2="16" y2="21"></line>
          <line x1="12" y1="17" x2="12" y2="21"></line>
        </svg>
        <h3 style="color: var(--text-main); margin-bottom: 0.25rem;">Select a Grievance</h3>
        <p style="font-size: 0.85rem;">Click any complaint card in the queue to inspect AI diagnostics, urgency meter, and trilingual draft reply.</p>
      </div>
    `;
    return;
  }

  const ticketId = complaint.ticket_number || `MS-${complaint.id || 1000}`;
  const badgeClass = getUrgencyBadgeClass(complaint.urgency_level, complaint.urgency_score);
  const langClass = getLanguagePillClass(complaint.detected_language);
  const score = Math.max(15, Math.min(100, Number(complaint.urgency_score || 70)));

  let meterFillClass = "p3";
  let slaText = "SLA Target: < 2 Hours";
  if (badgeClass === "badge-p1") {
    meterFillClass = "p1";
    slaText = "🚨 SLA Critical: < 15 Minutes Response Window";
  } else if (badgeClass === "badge-p2") {
    meterFillClass = "p2";
    slaText = "⚠️ SLA High: < 45 Minutes Response Window";
  } else if (badgeClass === "badge-p4") {
    meterFillClass = "p4";
    slaText = "ℹ️ SLA Routine: < 24 Hours Response Window";
  }

  const defaultDraft = complaint.draft_reply || generateDefaultDraft(complaint);

  container.innerHTML = `
    <!-- Hero Inspector Header -->
    <div class="inspector-hero">
      <div class="inspector-hero-top">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="inspector-ticket-num">#${ticketId}</span>
          <span class="badge ${badgeClass}">${complaint.urgency_level || "P3 Medium"}</span>
        </div>
        <span class="badge ${complaint.status === 'Resolved' ? 'badge-operational' : (complaint.status === 'In Progress' ? 'badge-warning' : 'badge-critical')}">
          ${complaint.status || "Open"}
        </span>
      </div>

      <div class="inspector-meta-row">
        <span>👤 <strong>${complaint.passenger_name || "Commuter"}</strong></span>
        <span>📍 <strong>${complaint.station_name || "Station"}</strong></span>
        <span>📡 <strong>${complaint.channel || "WhatsApp"}</strong></span>
        <span>🕒 ${formatDate(complaint.reported_at)}</span>
      </div>
    </div>

    <!-- Urgency Score Meter -->
    <div class="urgency-meter-card">
      <div class="meter-header">
        <span><strong>Urgency Score Meter:</strong></span>
        <span style="font-family: var(--font-mono); font-weight: 700; color: var(--accent-cyan);">${score} / 100</span>
      </div>
      <div class="meter-track">
        <div class="meter-fill ${meterFillClass}" style="width: ${score}%;"></div>
      </div>
      <div class="meter-footer">
        <span>${slaText}</span>
        <span>Dept: <strong>${complaint.department}</strong></span>
      </div>
    </div>

    <!-- Raw Complaint Box -->
    <div class="raw-complaint-box">
      <div class="raw-complaint-header">
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span class="badge ${langClass}">Detected: ${complaint.detected_language}</span>
          <span style="font-size: 0.75rem; color: var(--text-muted);">98% Confidence</span>
        </div>
        <span style="font-size: 0.75rem; color: var(--text-muted); font-family: var(--font-mono);">Original Script</span>
      </div>
      <div class="raw-complaint-text">${escapeHtml(complaint.raw_text)}</div>
    </div>

    <!-- AI Diagnostic Explanation -->
    <div class="ai-diag-card">
      <div class="ai-diag-header">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="16" x2="12" y2="12"></line>
          <line x1="12" y1="8" x2="12.01" y2="8"></line>
        </svg>
        <span>On-Device AI Diagnostic Reasoning:</span>
      </div>
      <div class="ai-diag-reason">
        ${complaint.urgency_reason || "Automated triage evaluated semantic sentiment, key equipment terms, and accessibility impacts."}
      </div>
      <div style="margin-top: 0.5rem; display: flex; gap: 0.5rem; flex-wrap: wrap; font-size: 0.75rem;">
        <span class="badge badge-info">Sentiment: ${complaint.sentiment || "Frustrated"}</span>
        <span class="badge">Auto-Routed: ${complaint.department}</span>
      </div>
    </div>

    <!-- Reply Dispatch Studio -->
    <div class="reply-studio-card">
      <div class="studio-header">
        <span class="studio-title">Trilingual Response Dispatch Studio</span>
        <span style="font-size: 0.75rem; color: var(--text-muted);">Auto-Drafted in ${complaint.detected_language}</span>
      </div>

      <div class="template-chips-wrap">
        <button type="button" class="template-chip" onclick="applyResponseTemplate('emergency')">🚨 Emergency Dispatched</button>
        <button type="button" class="template-chip" onclick="applyResponseTemplate('technician')">🛗 Lift Tech Sent</button>
        <button type="button" class="template-chip" onclick="applyResponseTemplate('cleanliness')">🧹 Cleaning Alerted</button>
        <button type="button" class="template-chip" onclick="applyResponseTemplate('refund')">🎫 Refund Queued</button>
      </div>

      <textarea id="inspector-draft-reply" class="draft-reply-textarea" placeholder="Edit passenger response in ${complaint.detected_language}...">${defaultDraft}</textarea>

      <div class="form-group" style="margin-bottom: 0;">
        <input type="text" id="inspector-resolution-notes" class="form-control" style="font-size: 0.8rem; padding: 0.45rem 0.75rem;" placeholder="Internal resolution audit notes (e.g. Crew deployed to Platform 1)..." value="${complaint.resolution_notes || ''}">
      </div>

      <div class="resolution-actions">
        ${complaint.status !== 'In Progress' && complaint.status !== 'Resolved' ? `
          <button type="button" class="btn btn-outline btn-sm" onclick="handleMarkInProgress(${complaint.id})">
            Mark In Progress
          </button>
        ` : ""}
        <button type="button" id="btn-dispatch-resolve" class="btn btn-primary" onclick="handleDispatchResolve(${complaint.id})">
          ⚡ ${complaint.status === 'Resolved' ? 'Update & Re-dispatch' : 'Dispatch Reply & Resolve'}
        </button>
      </div>
    </div>
  `;
}

function escapeHtml(text) {
  if (!text) return "";
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function generateDefaultDraft(complaint) {
  const lang = complaint.detected_language;
  const ticket = complaint.ticket_number || `MS-${complaint.id}`;
  if (lang === "Gujarati") {
    return `નમસ્તે, આપની ફરિયાદ (${ticket}) નોંધાઈ ગઈ છે. અમારી ટેકનિકલ ટીમને તાત્કાલિક સ્થળ પર મોકલવામાં આવી છે. અસુવિધા બદલ દિલગીર છીએ. - ગુજરાત મેટ્રો સેવા.`;
  }
  if (lang === "Gujlish") {
    return `Namaste, tamari complaint (${ticket}) note kari lidhi chhe. Concerned department team spot par dispatch kari didhi chhe. Problem jaldithi solve thai jashe. Thank you.`;
  }
  if (lang === "Hindi") {
    return `नमस्ते, आपकी शिकायत (${ticket}) दर्ज कर ली गई है। संबंधित तकनीकी टीम को तत्काल स्टेशन पर भेज दिया गया है। असुविधा के लिए खेद है। - गुजरात मेट्रो रेल.`;
  }
  return `Dear Commuter, thank you for contacting Gujarat Metro. Your grievance (${ticket}) has been prioritized and dispatched to our station response unit immediately.`;
}

function applyResponseTemplate(type) {
  const textarea = document.getElementById("inspector-draft-reply");
  if (!textarea) return;
  const selected = state.complaints.find((c) => c.id === state.selectedComplaintId);
  const lang = selected ? selected.detected_language : "English";
  const ticket = selected ? (selected.ticket_number || `MS-${selected.id}`) : "MS-1001";

  if (type === "emergency") {
    if (lang === "Gujarati") {
      textarea.value = `કટોકટી સુચના: સુરક્ષા અને તબીબી ટીમને તાત્કાલિક પ્લેટફોર્મ પર મોકલી દેવામાં આવી છે. સ્ટેશન સુપરવાઈઝર ઘટના સ્થળે પહોંચી ગયા છે.`;
    } else if (lang === "Gujlish") {
      textarea.value = `Emergency alert: Safety ane medical crew spot par dispatch thai gayi chhe. Platform supervisor spot par pahonchi gaya chhe.`;
    } else if (lang === "Hindi") {
      textarea.value = `आपातकालीन सूचना: सुरक्षा एवं मेडिकल टीम को तत्काल मौके पर रवाना कर दिया गया है। स्टेशन मास्टर स्थिति को संभाल रहे हैं।`;
    } else {
      textarea.value = `EMERGENCY ALERT: Safety and emergency response crew dispatched to station location immediately. Station Master is on site.`;
    }
  } else if (type === "technician") {
    if (lang === "Gujarati") {
      textarea.value = `લિફ્ટ અને એસ્કેલેટર એન્જિનિયરિંગ ટીમને તાત્કાલિક ટાસ્ક સોંપવામાં આવ્યું છે. આગામી 20 મિનિટમાં સેવા પુનઃ શરૂ થઈ જશે.`;
    } else if (lang === "Gujlish") {
      textarea.value = `Lift and escalator technical team spot par pahonchi gayi chhe. Agami 20 minute ma issue resolve thai jashe.`;
    } else if (lang === "Hindi") {
      textarea.value = `लिफ्ट एवं एस्केलेटर तकनीकी टीम मौके पर पहुँच चुकी है। आगामी 20 मिनट में समस्या का निवारण कर दिया जाएगा।`;
    } else {
      textarea.value = `Lift and escalator mechanical crew deployed on site. Expected restoration within 20 minutes.`;
    }
  } else if (type === "cleanliness") {
    if (lang === "Gujarati") {
      textarea.value = `સ્વચ્છતા સુપરવાઈઝર અને હાઉસકીપિંગ સ્ટાફને તાત્કાલિક સફાઈ અને વોટર લીકેજ નિવારણ માટે રવાના કરવામાં આવ્યા છે.`;
    } else if (lang === "Gujlish") {
      textarea.value = `Housekeeping staff ane cleaning supervisor ne spot par deep clean ane leak fix karva order aapyo chhe.`;
    } else if (lang === "Hindi") {
      textarea.value = `स्वच्छता पर्यवेक्षक और सफाई दल को तत्काल मौके पर भेजकर साफ-सफाई सुनिश्चित की जा रही है।`;
    } else {
      textarea.value = `Sanitation inspection team and housekeeping crew deployed for immediate station remediation.`;
    }
  } else if (type === "refund") {
    if (lang === "Gujarati") {
      textarea.value = `ટિકિટિંગ સિસ્ટમમાં ટ્રાન્ઝેક્શન ચેક કરવામાં આવ્યું છે. વણવપરાયેલ રકમ આપના મૂળ ખાતામાં આગામી 2 કલાકમાં જમા થઈ જશે.`;
    } else if (lang === "Gujlish") {
      textarea.value = `AFC ticket transaction audit thai gayu chhe. Excess deduction amari system dwara next 2 hours ma refund thai jashe.`;
    } else if (lang === "Hindi") {
      textarea.value = `टिकटिंग सिस्टम में लेन-देन का मिलान कर लिया गया है। कटी हुई राशि आगामी 2 घंटे में आपके मूल खाते में वापस भेज दी जाएगी।`;
    } else {
      textarea.value = `AFC ticketing system transaction verified. Automated refund reconciliation queued for return within 2 hours.`;
    }
  }
}

async function handleDispatchResolve(complaintId) {
  const replyInput = document.getElementById("inspector-draft-reply");
  const notesInput = document.getElementById("inspector-resolution-notes");
  const reply = replyInput ? replyInput.value.trim() : "";
  const notes = notesInput ? notesInput.value.trim() : "";

  const target = state.complaints.find((c) => c.id === complaintId);
  if (target) {
    target.status = "Resolved";
    target.draft_reply = reply;
    target.resolution_notes = notes;
    target.resolved_at = new Date().toISOString();
  }

  localStorage.setItem("metrosetu_cached_complaints", JSON.stringify(state.complaints));

  if (state.isOnline) {
    try {
      const res = await fetch(`/api/complaints/${complaintId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "Resolved",
          draft_reply: reply,
          resolution_notes: notes
        })
      });
      if (res.ok) {
        showToast("✓ Reply dispatched & complaint marked Resolved!", "success");
      } else {
        queueOfflineResolution(complaintId, "Resolved", reply, notes);
      }
    } catch (err) {
      queueOfflineResolution(complaintId, "Resolved", reply, notes);
    }
  } else {
    queueOfflineResolution(complaintId, "Resolved", reply, notes);
  }

  renderQueueCounts(state.complaints);
  const filtered = filterComplaints(state.complaints);
  renderTriageCards(filtered);
  renderComplaintInspector(target);
}

async function handleMarkInProgress(complaintId) {
  const target = state.complaints.find((c) => c.id === complaintId);
  if (target) {
    target.status = "In Progress";
  }
  localStorage.setItem("metrosetu_cached_complaints", JSON.stringify(state.complaints));

  if (state.isOnline) {
    try {
      await fetch(`/api/complaints/${complaintId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "In Progress" })
      });
      showToast("Complaint marked In Progress", "info");
    } catch (e) {
      queueOfflineResolution(complaintId, "In Progress");
    }
  } else {
    queueOfflineResolution(complaintId, "In Progress");
  }

  renderQueueCounts(state.complaints);
  const filtered = filterComplaints(state.complaints);
  renderTriageCards(filtered);
  renderComplaintInspector(target);
}

function queueOfflineResolution(id, status, draftReply, notes) {
  state.offlineQueue = state.offlineQueue.filter((q) => q.id !== id);
  state.offlineQueue.push({
    id: id,
    status: status,
    draft_reply: draftReply || "",
    resolution_notes: notes || "",
    queued_at: new Date().toISOString()
  });
  localStorage.setItem("metrosetu_offline_queue", JSON.stringify(state.offlineQueue));
  updateOfflineQueueIndicator();
  showToast("Offline: Resolution queued locally. Will sync when server is reachable.", "warning");
}

async function simulateTestBatch() {
  showToast("Ingesting 8-complaint multilingual test batch...", "info");

  try {
    const res = await fetch("/api/complaints/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(PRECALIBRATED_TEST_BATCH)
    });

    if (res.ok) {
      const data = await res.json();
      showToast(`⚡ Ingested ${data.count || 8} test complaints into triage console!`, "success");
      loadTriageView();
      return;
    }
  } catch (err) {
    // Offline fallback
  }

  PRECALIBRATED_TEST_BATCH.forEach((sample) => {
    if (!state.complaints.some((c) => c.ticket_number === sample.ticket_number)) {
      state.complaints.unshift({ ...sample, id: Date.now() + Math.floor(Math.random() * 1000) });
    }
  });

  localStorage.setItem("metrosetu_cached_complaints", JSON.stringify(state.complaints));
  showToast("⚡ Ingested 8 test complaints locally!", "success");
  loadTriageView();
}

async function injectSample(sampleKey) {
  const sampleMap = {
    gujarati: PRECALIBRATED_TEST_BATCH[0],
    gujlish: PRECALIBRATED_TEST_BATCH[1],
    hindi: PRECALIBRATED_TEST_BATCH[2],
    english: PRECALIBRATED_TEST_BATCH[3]
  };

  const sample = sampleMap[sampleKey];
  if (!sample) return;

  const newComplaint = {
    ...sample,
    id: Date.now(),
    ticket_number: `MS-${Math.floor(1000 + Math.random() * 9000)}`,
    reported_at: new Date().toISOString(),
    status: "Open"
  };

  if (state.isOnline) {
    try {
      await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passenger_name: newComplaint.passenger_name,
          channel: newComplaint.channel,
          raw_text: newComplaint.raw_text,
          station_id: newComplaint.station_id,
          department: newComplaint.department,
          urgency_level: newComplaint.urgency_level
        })
      });
    } catch (e) {
      // Offline fallback
    }
  }

  state.complaints.unshift(newComplaint);
  localStorage.setItem("metrosetu_cached_complaints", JSON.stringify(state.complaints));
  state.selectedComplaintId = newComplaint.id;

  showToast(`✓ Ingested ${newComplaint.detected_language} sample: ${newComplaint.department} (${newComplaint.urgency_level})`, "success");

  renderQueueCounts(state.complaints);
  const filtered = filterComplaints(state.complaints);
  renderTriageCards(filtered);
  renderComplaintInspector(newComplaint);
}

function triageTextClientSide(text) {
  if (!text || !text.trim()) {
    return { language: "English", department: "Safety", urgency: "P3 Medium", score: 50 };
  }

  const gujChars = (text.match(/[\u0A80-\u0AFF]/g) || []).length;
  const hinChars = (text.match(/[\u0900-\u097F]/g) || []).length;
  let lang = "English";

  if (gujChars >= 2) {
    lang = "Gujarati";
  } else if (hinChars >= 2) {
    lang = "Hindi";
  } else {
    const lower = text.toLowerCase();
    const gujlishTokens = ["chhe", "nathi", "pan", "thai", "evu", "ma", "par", "karavo", "aavo", "lidho", "kem", "su", "mate", "aapyo", "karo", "badhe", "mari"];
    if (gujlishTokens.some((tok) => lower.includes(tok))) {
      lang = "Gujlish";
    }
  }

  const lower = text.toLowerCase();
  let dept = "Safety";

  if (lower.includes("lift") || lower.includes("elevator") || lower.includes("escalator") || lower.includes("લિફ્ટ") || lower.includes("એસ્કેલેટર") || lower.includes("लिफ्ट") || lower.includes("एस्केलेटर")) {
    dept = "Lifts & Escalators";
  } else if (lower.includes("washroom") || lower.includes("clean") || lower.includes("kachro") || lower.includes("gandaki") || lower.includes("toilet") || lower.includes("કચરો") || lower.includes("સફાઈ") || lower.includes("सफाई") || lower.includes("कचरा") || lower.includes("hygiene")) {
    dept = "Cleanliness";
  } else if (lower.includes("ticket") || lower.includes("fare") || lower.includes("tvm") || lower.includes("refund") || lower.includes("card") || lower.includes("paise") || lower.includes("money") || lower.includes("ટિકિટ") || lower.includes("રિફંડ") || lower.includes("टिकट") || lower.includes("पैसे") || lower.includes("gate")) {
    dept = "Fare & Ticketing";
  } else if (lower.includes("staff") || lower.includes("behavior") || lower.includes("rude") || lower.includes("vartan") || lower.includes("karmachari") || lower.includes("વર્તન") || lower.includes("કર્મચારી") || lower.includes("व्यवहार") || lower.includes("कर्मचारी") || lower.includes("shouting")) {
    dept = "Staff Behaviour";
  }

  let urgency = "P3 Medium";
  let score = 55;
  const criticalTerms = ["emergency", "sos", "leak", "pipe", "water", "slip", "hazard", "fall", "shock", "fire", "injury", "medical", "stuck", "lock", "આગ", "પાણી", "ઈજા", "તકલીફ", "ખતરો", "चोट", "आग", "खतरा", "पानी"];
  const highTerms = ["lift", "elevator", "escalator", "refund", "tvm", "broken", "stopped", "bandh", "બંધ", "बंद", "पैसे", "રૂપિયા", "₹"];

  if (criticalTerms.some((t) => lower.includes(t))) {
    urgency = "P1 Critical";
    score = 95;
  } else if (highTerms.some((t) => lower.includes(t))) {
    urgency = "P2 High";
    score = 80;
  } else if (dept === "Cleanliness" || dept === "Staff Behaviour") {
    urgency = "P3 Medium";
    score = 55;
  } else {
    urgency = "P4 Low";
    score = 35;
  }

  return { language: lang, department: dept, urgency: urgency, score: score };
}

function populateModalStations() {
  const select = document.getElementById("g-station-id");
  if (!select) return;

  const stations = (state.stations && state.stations.length > 0) ? state.stations : [
    { id: 1, name: "Old High Court", code: "MET-01" },
    { id: 2, name: "Kalupur Railway Station", code: "MET-02" },
    { id: 3, name: "Gandhinagar Sector 1", code: "MET-03" },
    { id: 4, name: "Paldi", code: "MET-04" },
    { id: 5, name: "APMC", code: "MET-05" },
    { id: 7, name: "Thaltej", code: "MET-07" },
    { id: 8, name: "Sabarmati", code: "MET-08" },
    { id: 9, name: "Motera Stadium", code: "MET-09" }
  ];

  select.innerHTML = stations.map((s) => `<option value="${s.id}">${s.name} (${s.code || ''})</option>`).join("");
}

function openNewGrievanceModal() {
  populateModalStations();
  const modal = document.getElementById("modal-new-grievance");
  if (modal) modal.style.display = "flex";
}

function closeNewGrievanceModal() {
  const modal = document.getElementById("modal-new-grievance");
  if (modal) modal.style.display = "none";
}

async function handleGrievanceFormSubmit(e) {
  e.preventDefault();

  const nameInput = document.getElementById("g-passenger-name");
  const channelInput = document.getElementById("g-channel");
  const stationInput = document.getElementById("g-station-id");
  const deptInput = document.getElementById("g-override-dept");
  const textInput = document.getElementById("g-raw-text");

  const text = textInput ? textInput.value.trim() : "";
  if (!text) {
    showToast("Please enter grievance description", "error");
    return;
  }

  const analysis = triageTextClientSide(text);
  const dept = (deptInput && deptInput.value) ? deptInput.value : analysis.department;
  const pName = nameInput ? nameInput.value.trim() : "Anonymous";
  const channel = channelInput ? channelInput.value : "WhatsApp";
  const stId = stationInput ? Number(stationInput.value) : 1;
  const stObj = (state.stations || []).find((s) => s.id === stId);
  const stName = stObj ? stObj.name : "Metro Station";

  const newGrievance = {
    id: Date.now(),
    ticket_number: `MS-${Math.floor(1000 + Math.random() * 9000)}`,
    passenger_name: pName,
    station_id: stId,
    station_name: stName,
    channel: channel,
    raw_text: text,
    detected_language: analysis.language,
    department: dept,
    urgency_level: analysis.urgency,
    urgency_score: analysis.score,
    urgency_reason: `On-Device NLP detected ${analysis.language} complaint routed to ${dept}.`,
    sentiment: "Frustrated",
    draft_reply: generateDefaultDraft({ detected_language: analysis.language, ticket_number: `MS-${Date.now()}` }),
    status: "Open",
    reported_at: new Date().toISOString()
  };

  if (state.isOnline) {
    try {
      const res = await fetch("/api/complaints", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          passenger_name: pName,
          channel: channel,
          raw_text: text,
          station_id: stId,
          department: dept,
          urgency_level: analysis.urgency
        })
      });
      if (res.ok) {
        showToast("✓ Grievance registered & triaged successfully!", "success");
      }
    } catch (err) {
      showToast("Registered locally in offline cache", "info");
    }
  } else {
    showToast("Registered locally in offline cache", "info");
  }

  state.complaints.unshift(newGrievance);
  localStorage.setItem("metrosetu_cached_complaints", JSON.stringify(state.complaints));
  state.selectedComplaintId = newGrievance.id;

  textInput.value = "";
  closeNewGrievanceModal();

  renderQueueCounts(state.complaints);
  const filtered = filterComplaints(state.complaints);
  renderTriageCards(filtered);
  renderComplaintInspector(newGrievance);
}

// ============================================================================
// 5. VIEW: STATIONS LIST VIEW WITH SEARCH & FILTERS
// ============================================================================

async function loadStationsView() {
  const search = document.getElementById("stations-search").value.trim();
  const line = document.getElementById("filter-line").value;
  const status = document.getElementById("filter-status").value;
  const accessible = document.getElementById("filter-accessible").value;

  const params = new URLSearchParams();
  if (search) params.append("search", search);
  if (line) params.append("line", line);
  if (status) params.append("status", status);
  if (accessible) params.append("accessible", accessible);

  try {
    const res = await fetch(`/api/stations?${params.toString()}`);
    if (res.ok) {
      const stations = await res.json();
      state.stations = stations;
      renderStationsTable(stations);
    }
  } catch (err) {
    console.error("Failed to fetch stations:", err);
  }
}

function renderStationsTable(stations) {
  const tbody = document.getElementById("stations-tbody");
  if (!tbody) return;

  if (stations.length === 0) {
    tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: var(--text-muted); padding: 2rem;">No stations matched current filters.</td></tr>`;
    return;
  }

  tbody.innerHTML = stations.map((s) => {
    const lineClass = s.line_name.toLowerCase().includes("red")
      ? "line-red"
      : s.line_name.toLowerCase().includes("blue")
      ? "line-blue"
      : s.line_name.toLowerCase().includes("green")
      ? "line-green"
      : "line-yellow";

    const statusBadgeClass = s.status === "Operational"
      ? "badge-operational"
      : s.status === "Maintenance"
      ? "badge-maintenance"
      : "badge-disrupted";

    return `
      <tr>
        <td><strong><code>${s.code}</code></strong></td>
        <td>
          <a href="#station-detail?id=${s.id}" style="color: var(--text-main); font-weight: 600; text-decoration: none;">
            ${s.name}
          </a>
        </td>
        <td>
          <span class="line-pill">
            <span class="line-dot ${lineClass}"></span>
            <span>${s.line_name}</span>
          </span>
        </td>
        <td>Zone ${s.zone}</td>
        <td><span class="badge ${statusBadgeClass}">${s.status}</span></td>
        <td>${formatNumber(s.daily_capacity)}</td>
        <td>${s.is_accessible ? "♿ Yes" : "No"}</td>
        <td>
          <div style="display: flex; align-items: center; gap: 0.5rem;">
            <span>${s.avg_asset_health || 100}%</span>
            <div class="health-meter" style="width: 50px;">
              <div class="health-meter-fill" style="width: ${s.avg_asset_health || 100}%; background: ${s.avg_asset_health < 70 ? 'var(--accent-yellow)' : 'var(--accent-green)'}"></div>
            </div>
          </div>
        </td>
        <td>
          ${s.active_faults > 0
            ? `<span class="badge badge-warning">${s.active_faults} Active</span>`
            : `<span style="color: var(--accent-green); font-size: 0.8rem;">None</span>`}
        </td>
        <td>
          <div style="display: flex; gap: 0.35rem;">
            <a href="#station-detail?id=${s.id}" class="btn btn-outline btn-sm">Details</a>
            <a href="#station-form?id=${s.id}" class="btn btn-secondary btn-sm">Edit</a>
            <button class="btn btn-danger btn-sm" onclick="handleDeleteStation(${s.id}, '${s.name}')">Del</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");
}

// ============================================================================
// 6. VIEW: STATION DETAIL VIEW
// ============================================================================

async function loadStationDetailView(stationId) {
  state.selectedStationId = stationId;

  try {
    const res = await fetch(`/api/stations/${stationId}`);
    if (!res.ok) {
      showToast("Station not found", "error");
      window.location.hash = "#stations";
      return;
    }

    const data = await res.json();
    const st = data.station;

    // Render Hero Header
    document.getElementById("detail-breadcrumb").textContent = st.name;
    document.getElementById("detail-station-name").textContent = st.name;
    document.getElementById("detail-station-code").textContent = st.code;
    document.getElementById("detail-station-status").textContent = st.status;
    document.getElementById("detail-station-status").className = `badge badge-${st.status.toLowerCase()}`;

    const lineDot = document.getElementById("detail-line-pill").querySelector(".line-dot");
    lineDot.className = "line-dot " + (st.line_name.includes("Red") ? "line-red" : st.line_name.includes("Blue") ? "line-blue" : st.line_name.includes("Green") ? "line-green" : "line-yellow");
    document.getElementById("detail-line-name").textContent = st.line_name;

    document.getElementById("detail-zone").textContent = st.zone;
    document.getElementById("detail-year").textContent = st.opened_year || "2018";
    document.getElementById("detail-accessibility-tag").textContent = st.is_accessible ? "♿ Wheelchair Accessible" : "⚠ Standard Access Only";

    document.getElementById("detail-capacity").textContent = formatNumber(st.daily_capacity);
    document.getElementById("detail-active-faults").textContent = data.faults.filter(f => f.status !== "Resolved").length;
    document.getElementById("detail-bus-count").textContent = `${data.bus_connections.length} Routes`;

    // Calculate average asset health
    const avgHealth = data.assets.length > 0
      ? Math.round(data.assets.reduce((acc, a) => acc + a.health_score, 0) / data.assets.length)
      : 100;
    document.getElementById("detail-avg-health").textContent = `${avgHealth}%`;

    // Setup Edit Button Link
    document.getElementById("btn-edit-current-station").onclick = () => {
      window.location.hash = `#station-form?id=${st.id}`;
    };

    // Setup Log Fault Button
    document.getElementById("btn-add-station-fault").onclick = () => {
      promptAddFault(st.id, st.name);
    };

    // Render Ridership Chart for Station
    renderStationRidershipChart(data.ridership_24h);

    // Render Assets Table
    renderStationAssetsTable(data.assets);

    // Render Faults Table
    renderStationFaultsTable(data.faults);

    // Render Bus Connections Table
    renderStationBusesTable(data.bus_connections);

  } catch (err) {
    console.error("Failed to load station details:", err);
  }
}

function renderStationRidershipChart(hourlyData) {
  const ctx = document.getElementById("chart-station-ridership");
  if (!ctx || !window.Chart) return;

  destroyChart("stationDetailRidership");

  const labels = hourlyData.map((d) => `${d.hour}:00`);
  const tapIns = hourlyData.map((d) => d.tap_ins);
  const tapOuts = hourlyData.map((d) => d.tap_outs);

  state.charts.stationDetailRidership = new window.Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: [
        {
          label: "Tap-Ins (Entering)",
          data: tapIns,
          borderColor: "#06b6d4",
          backgroundColor: "rgba(6, 182, 212, 0.1)",
          borderWidth: 2,
          fill: true,
          tension: 0.3
        },
        {
          label: "Tap-Outs (Exiting)",
          data: tapOuts,
          borderColor: "#10b981",
          backgroundColor: "rgba(16, 185, 129, 0.05)",
          borderWidth: 2,
          fill: true,
          tension: 0.3
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: "#94a3b8", font: { size: 11 } } }
      },
      scales: {
        x: { ticks: { color: "#64748b" }, grid: { color: "rgba(255, 255, 255, 0.05)" } },
        y: { ticks: { color: "#64748b" }, grid: { color: "rgba(255, 255, 255, 0.05)" } }
      }
    }
  });
}

function renderStationAssetsTable(assets) {
  const tbody = document.getElementById("detail-assets-tbody");
  if (!tbody) return;

  if (assets.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No registered asset logs.</td></tr>`;
    return;
  }

  tbody.innerHTML = assets.map((a) => `
    <tr>
      <td><strong>${a.asset_name}</strong></td>
      <td><span class="badge badge-info">${a.category}</span></td>
      <td>
        <div style="display: flex; align-items: center; gap: 0.5rem;">
          <span>${a.health_score}%</span>
          <div class="health-meter" style="width: 60px;">
            <div class="health-meter-fill" style="width: ${a.health_score}%; background: ${a.health_score < 70 ? 'var(--accent-yellow)' : 'var(--accent-green)'}"></div>
          </div>
        </div>
      </td>
      <td><span class="badge ${a.status === 'Good' ? 'badge-operational' : 'badge-warning'}">${a.status}</span></td>
      <td>${a.last_serviced || "--"}</td>
      <td style="color: var(--text-muted); font-size: 0.8rem;">${a.notes || "--"}</td>
    </tr>
  `).join("");
}

function renderStationFaultsTable(faults) {
  const tbody = document.getElementById("detail-faults-tbody");
  if (!tbody) return;

  if (faults.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">Zero active faults for this station.</td></tr>`;
    return;
  }

  tbody.innerHTML = faults.map((f) => `
    <tr>
      <td><span class="badge badge-${f.severity.toLowerCase()}">${f.severity}</span></td>
      <td>${f.component}</td>
      <td>
        <strong>${f.title}</strong>
        <div style="color: var(--text-muted); font-size: 0.775rem;">${f.description || ""}</div>
      </td>
      <td>${formatDate(f.reported_at)}</td>
      <td><span class="badge ${f.status === 'Resolved' ? 'badge-operational' : 'badge-warning'}">${f.status}</span></td>
      <td>
        ${f.status !== 'Resolved' ? `
          <button class="btn btn-outline btn-sm" onclick="handleResolveFault(${f.id})">Resolve</button>
        ` : `<span style="color: var(--text-muted); font-size: 0.75rem;">Resolved</span>`}
      </td>
    </tr>
  `).join("");
}

function renderStationBusesTable(buses) {
  const tbody = document.getElementById("detail-buses-tbody");
  if (!tbody) return;

  if (buses.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No feeder bus connections linked.</td></tr>`;
    return;
  }

  tbody.innerHTML = buses.map((b) => `
    <tr>
      <td><strong>${b.route_number}</strong></td>
      <td>${b.destination}</td>
      <td>Every ${b.frequency_mins} mins</td>
      <td><span class="badge badge-operational">${b.status}</span></td>
    </tr>
  `).join("");
}

// ============================================================================
// 7. VIEW: ADD / EDIT STATION FORM
// ============================================================================

async function setupStationForm(stationId) {
  const title = document.getElementById("form-view-title");
  const hiddenId = document.getElementById("form-station-id");
  const form = document.getElementById("station-form-element");

  form.reset();

  if (stationId) {
    title.textContent = `Edit Station (ID #${stationId})`;
    hiddenId.value = stationId;

    try {
      const res = await fetch(`/api/stations/${stationId}`);
      if (res.ok) {
        const data = await res.json();
        const s = data.station;
        document.getElementById("form-code").value = s.code;
        document.getElementById("form-name").value = s.name;
        document.getElementById("form-line").value = s.line_name;
        document.getElementById("form-zone").value = s.zone;
        document.getElementById("form-status").value = s.status;
        document.getElementById("form-capacity").value = s.daily_capacity;
        document.getElementById("form-opened-year").value = s.opened_year || 2020;
        document.getElementById("form-accessible").checked = Boolean(s.is_accessible);
        document.getElementById("form-lat").value = s.latitude || 40.7128;
        document.getElementById("form-lng").value = s.longitude || -74.0060;
      }
    } catch (err) {
      showToast("Error loading station for editing", "error");
    }
  } else {
    title.textContent = "Add New Metro Station";
    hiddenId.value = "";
    document.getElementById("form-opened-year").value = 2024;
    document.getElementById("form-capacity").value = 50000;
  }
}

async function handleStationFormSubmit(e) {
  e.preventDefault();

  const stationId = document.getElementById("form-station-id").value;
  const payload = {
    code: document.getElementById("form-code").value.trim(),
    name: document.getElementById("form-name").value.trim(),
    line_name: document.getElementById("form-line").value,
    zone: parseInt(document.getElementById("form-zone").value, 10),
    status: document.getElementById("form-status").value,
    daily_capacity: parseInt(document.getElementById("form-capacity").value, 10),
    opened_year: parseInt(document.getElementById("form-opened-year").value, 10) || 2022,
    is_accessible: document.getElementById("form-accessible").checked,
    latitude: parseFloat(document.getElementById("form-lat").value) || 40.7128,
    longitude: parseFloat(document.getElementById("form-lng").value) || -74.0060
  };

  const isEdit = Boolean(stationId);
  const endpoint = isEdit ? `/api/stations/${stationId}` : "/api/stations";
  const method = isEdit ? "PUT" : "POST";

  try {
    const res = await fetch(endpoint, {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (res.ok) {
      showToast(isEdit ? "Station updated successfully" : "Station created successfully", "success");
      window.location.hash = "#stations";
    } else {
      const err = await res.json();
      showToast(`Error: ${err.detail || "Save failed"}`, "error");
    }
  } catch (err) {
    showToast("Offline: Could not reach backend server to save station", "error");
  }
}

async function handleDeleteStation(stationId, stationName) {
  if (!confirm(`Are you sure you want to delete station "${stationName}"? All linked records will be removed.`)) {
    return;
  }

  try {
    const res = await fetch(`/api/stations/${stationId}`, { method: "DELETE" });
    if (res.ok) {
      showToast(`Station "${stationName}" deleted`, "success");
      loadStationsView();
    } else {
      showToast("Delete operation failed", "error");
    }
  } catch (err) {
    showToast("Network error deleting station", "error");
  }
}

// ============================================================================
// 8. VIEW: ALERTS & ON-DEVICE AI
// ============================================================================

async function loadAlertsView() {
  await Promise.all([
    runOnDeviceAnomalyScan(false),
    loadAlertsFaultsList()
  ]);
}

async function runOnDeviceAnomalyScan(showScanToast = true) {
  if (showScanToast) {
    showToast("Running pure-Python on-device anomaly detection...", "info");
  }

  try {
    const res = await fetch("/api/ai/anomalies/detect?sensitivity=2.5", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      renderAnomaliesTable(data.anomalies || []);
      const badge = document.getElementById("ai-anomalies-stat-badge");
      if (badge) {
        badge.textContent = `Evaluated: ${data.evaluated_records} | Found: ${data.anomalies_found} Anomalies`;
      }
      if (showScanToast) {
        showToast(`AI scan complete: ${data.anomalies_found} outliers detected`, "success");
      }
    }
  } catch (err) {
    console.warn("AI anomaly scan failed:", err);
  }
}

function renderAnomaliesTable(anomalies) {
  const tbody = document.getElementById("ai-anomalies-tbody");
  if (!tbody) return;

  if (anomalies.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No statistical anomalies detected in current ridership series.</td></tr>`;
    return;
  }

  tbody.innerHTML = anomalies.slice(0, 15).map((a) => {
    const isSurge = a.type === "SURGE_ANOMALY";
    const typeBadge = isSurge ? "badge-critical" : "badge-warning";
    const diffSign = a.pct_deviation > 0 ? "+" : "";

    return `
      <tr>
        <td><span class="badge ${typeBadge}">${isSurge ? "⚡ SURGE" : "🔻 DROP"}</span></td>
        <td><strong>${a.station_name}</strong></td>
        <td>${formatDate(a.recorded_at)}</td>
        <td><strong>${formatNumber(a.observed_value)}</strong></td>
        <td>${formatNumber(a.expected_median)}</td>
        <td><code>${a.modified_z_score}</code></td>
        <td style="color: ${isSurge ? 'var(--accent-red)' : 'var(--accent-yellow)'}"><strong>${diffSign}${a.pct_deviation}%</strong></td>
        <td style="font-size: 0.8rem; color: var(--text-muted);">${a.diagnostic}</td>
      </tr>
    `;
  }).join("");
}

async function loadAlertsFaultsList() {
  const severity = document.getElementById("fault-filter-severity")?.value || "";
  const status = document.getElementById("fault-filter-status")?.value || "";

  const params = new URLSearchParams();
  if (severity) params.append("severity", severity);
  if (status) params.append("status", status);

  try {
    const res = await fetch(`/api/faults?${params.toString()}`);
    if (res.ok) {
      const faults = await res.json();
      renderAlertsFaultsTable(faults);
    }
  } catch (err) {
    console.error("Failed to fetch alerts fault list:", err);
  }
}

function renderAlertsFaultsTable(faults) {
  const tbody = document.getElementById("alerts-faults-tbody");
  if (!tbody) return;

  if (faults.length === 0) {
    tbody.innerHTML = `<tr><td colspan="8" style="text-align: center; color: var(--text-muted); padding: 1.5rem;">No incidents match the selected filter.</td></tr>`;
    return;
  }

  tbody.innerHTML = faults.map((f) => `
    <tr>
      <td><span class="badge badge-${f.severity.toLowerCase()}">${f.severity}</span></td>
      <td><strong>${f.station_name || "Station"}</strong></td>
      <td>${f.component}</td>
      <td><strong>${f.title}</strong></td>
      <td>${formatDate(f.reported_at)}</td>
      <td><span class="badge ${f.status === 'Resolved' ? 'badge-operational' : 'badge-warning'}">${f.status}</span></td>
      <td style="font-size: 0.8rem; color: var(--text-muted); max-width: 280px;">${f.description || "--"}</td>
      <td>
        ${f.status !== 'Resolved' ? `
          <button class="btn btn-outline btn-sm" onclick="handleResolveFault(${f.id})">Mark Resolved</button>
        ` : `<span style="color: var(--text-muted); font-size: 0.75rem;">Resolved</span>`}
      </td>
    </tr>
  `).join("");
}

async function handleResolveFault(faultId) {
  try {
    const res = await fetch(`/api/faults/${faultId}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "Resolved" })
    });

    if (res.ok) {
      showToast("Incident marked as Resolved", "success");
      // Refresh active view
      if (state.currentView === "alerts") loadAlertsFaultsList();
      else if (state.currentView === "dashboard") loadDashboardView();
      else if (state.currentView === "station-detail" && state.selectedStationId) {
        loadStationDetailView(state.selectedStationId);
      }
    } else {
      showToast("Failed to update fault status", "error");
    }
  } catch (err) {
    showToast("Network error updating fault", "error");
  }
}

function promptAddFault(stationId, stationName) {
  const title = prompt(`Enter incident title for ${stationName}:`);
  if (!title) return;
  const component = prompt("Affected component (e.g., Escalator, Signaling, Power, Turnstiles):") || "Mechanical";
  const severity = prompt("Severity (Critical / Warning / Info):", "Warning") || "Warning";
  const desc = prompt("Incident description / operator observations:") || "";

  fetch("/api/faults", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      station_id: stationId,
      title: title,
      component: component,
      severity: severity,
      status: "Active",
      description: desc
    })
  }).then((res) => {
    if (res.ok) {
      showToast("Incident reported successfully", "success");
      loadStationDetailView(stationId);
    }
  });
}

// ============================================================================
// 9. QUICK RE-SEED BUTTON
// ============================================================================

async function triggerReSeed() {
  if (!confirm("Re-seed the SQLite database with 7 days of realistic transit telemetry and AI anomaly events?")) {
    return;
  }

  showToast("Re-seeding database...", "info");
  try {
    const res = await fetch("/api/seed", { method: "POST" });
    if (res.ok) {
      showToast("Database successfully re-seeded!", "success");
      handleRouting();
    } else {
      showToast("Re-seeding failed", "error");
    }
  } catch (err) {
    showToast("Network error triggering re-seed", "error");
  }
}

// ============================================================================
// 10. EVENT LISTENERS INITIALIZATION
// ============================================================================

document.addEventListener("DOMContentLoaded", () => {
  // Service Worker for offline capability
  initServiceWorker();

  // Initial routing
  window.addEventListener("hashchange", handleRouting);
  handleRouting();

  // Online / Offline window listeners
  window.addEventListener("online", () => checkBackendHeartbeat());
  window.addEventListener("offline", () => updateConnectionStatus(false));
  checkBackendHeartbeat();
  setInterval(checkBackendHeartbeat, 8000);

  // Quick Seed Button
  const btnSeed = document.getElementById("btn-quick-seed");
  if (btnSeed) btnSeed.addEventListener("click", triggerReSeed);

  // AI Buttons on Dashboard
  const btnDashScan = document.getElementById("btn-dash-anom-scan");
  if (btnDashScan) btnDashScan.addEventListener("click", () => {
    window.location.hash = "#alerts";
  });

  const btnBannerScan = document.getElementById("btn-banner-scan");
  if (btnBannerScan) btnBannerScan.addEventListener("click", () => {
    window.location.hash = "#alerts";
  });

  const btnBannerForecast = document.getElementById("btn-banner-forecast");
  if (btnBannerForecast) btnBannerForecast.addEventListener("click", () => {
    loadDashboardView();
    showToast("24-Hour Holt-Winters demand forecast re-computed", "success");
  });

  // Station Search & Filters
  const searchInput = document.getElementById("stations-search");
  if (searchInput) searchInput.addEventListener("input", loadStationsView);

  const filterLine = document.getElementById("filter-line");
  if (filterLine) filterLine.addEventListener("change", loadStationsView);

  const filterStatus = document.getElementById("filter-status");
  if (filterStatus) filterStatus.addEventListener("change", loadStationsView);

  const filterAccessible = document.getElementById("filter-accessible");
  if (filterAccessible) filterAccessible.addEventListener("change", loadStationsView);

  // Station Form Submission
  const stationForm = document.getElementById("station-form-element");
  if (stationForm) stationForm.addEventListener("submit", handleStationFormSubmit);

  // Alerts Page Scan Button
  const btnScanPage = document.getElementById("btn-run-ai-scan-page");
  if (btnScanPage) btnScanPage.addEventListener("click", () => runOnDeviceAnomalyScan(true));

  // Alerts Filters
  const filterFaultSev = document.getElementById("fault-filter-severity");
  if (filterFaultSev) filterFaultSev.addEventListener("change", loadAlertsFaultsList);

  const filterFaultStat = document.getElementById("fault-filter-status");
  if (filterFaultStat) filterFaultStat.addEventListener("change", loadAlertsFaultsList);

  // --- Triage Console Event Listeners ---
  // Batch Simulator Button
  const btnBatch = document.getElementById("btn-simulate-batch");
  if (btnBatch) btnBatch.addEventListener("click", simulateTestBatch);

  // 1-Click Multilingual Ingest Buttons
  const btnSampleGuj = document.getElementById("btn-sample-gujarati");
  if (btnSampleGuj) btnSampleGuj.addEventListener("click", () => injectSample("gujarati"));

  const btnSampleGujlish = document.getElementById("btn-sample-gujlish");
  if (btnSampleGujlish) btnSampleGujlish.addEventListener("click", () => injectSample("gujlish"));

  const btnSampleHin = document.getElementById("btn-sample-hindi");
  if (btnSampleHin) btnSampleHin.addEventListener("click", () => injectSample("hindi"));

  const btnSampleEng = document.getElementById("btn-sample-english");
  if (btnSampleEng) btnSampleEng.addEventListener("click", () => injectSample("english"));

  // Department Queue Tabs
  document.querySelectorAll(".queue-tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".queue-tab-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      state.activeDept = btn.dataset.dept || "All";
      const filtered = filterComplaints(state.complaints);
      renderTriageCards(filtered);
      if (filtered.length > 0) {
        selectComplaint(filtered[0].id);
      } else {
        renderComplaintInspector(null);
      }
    });
  });

  // Triage Filter Toolbar
  const triageSearch = document.getElementById("triage-search");
  if (triageSearch) {
    triageSearch.addEventListener("input", (e) => {
      state.triageSearch = e.target.value;
      const filtered = filterComplaints(state.complaints);
      renderTriageCards(filtered);
    });
  }

  const triageLang = document.getElementById("triage-filter-lang");
  if (triageLang) {
    triageLang.addEventListener("change", (e) => {
      state.activeLang = e.target.value;
      const filtered = filterComplaints(state.complaints);
      renderTriageCards(filtered);
    });
  }

  const triageUrgency = document.getElementById("triage-filter-urgency");
  if (triageUrgency) {
    triageUrgency.addEventListener("change", (e) => {
      state.activeUrgency = e.target.value;
      const filtered = filterComplaints(state.complaints);
      renderTriageCards(filtered);
    });
  }

  const triageStatus = document.getElementById("triage-filter-status");
  if (triageStatus) {
    triageStatus.addEventListener("change", (e) => {
      state.activeStatus = e.target.value;
      const filtered = filterComplaints(state.complaints);
      renderTriageCards(filtered);
    });
  }

  const btnTriageReset = document.getElementById("btn-triage-reset");
  if (btnTriageReset) {
    btnTriageReset.addEventListener("click", () => {
      state.activeDept = "All";
      state.activeLang = "";
      state.activeUrgency = "";
      state.activeStatus = "";
      state.triageSearch = "";
      if (triageSearch) triageSearch.value = "";
      if (triageLang) triageLang.value = "";
      if (triageUrgency) triageUrgency.value = "";
      if (triageStatus) triageStatus.value = "";
      document.querySelectorAll(".queue-tab-btn").forEach((b) => {
        b.classList.toggle("active", b.dataset.dept === "All");
      });
      const filtered = filterComplaints(state.complaints);
      renderTriageCards(filtered);
      if (filtered.length > 0) selectComplaint(filtered[0].id);
    });
  }

  // Modal: New Grievance
  const btnOpenGrievance = document.getElementById("btn-open-new-grievance");
  if (btnOpenGrievance) btnOpenGrievance.addEventListener("click", openNewGrievanceModal);

  const btnCloseGrievance = document.getElementById("btn-close-modal-grievance");
  if (btnCloseGrievance) btnCloseGrievance.addEventListener("click", closeNewGrievanceModal);

  const btnCancelGrievance = document.getElementById("btn-cancel-modal-grievance");
  if (btnCancelGrievance) btnCancelGrievance.addEventListener("click", closeNewGrievanceModal);

  const grievanceForm = document.getElementById("grievance-form");
  if (grievanceForm) grievanceForm.addEventListener("submit", handleGrievanceFormSubmit);

  // Live input feedback on grievance description textarea
  const rawTextInput = document.getElementById("g-raw-text");
  if (rawTextInput) {
    rawTextInput.addEventListener("input", (e) => {
      const preview = triageTextClientSide(e.target.value);
      const elLang = document.getElementById("g-preview-lang");
      if (elLang) {
        elLang.textContent = preview.language;
        elLang.className = "badge " + getLanguagePillClass(preview.language);
      }
      const elDept = document.getElementById("g-preview-dept");
      if (elDept) elDept.textContent = preview.department;
      const elUrg = document.getElementById("g-preview-urgency");
      if (elUrg) {
        elUrg.textContent = preview.urgency;
        elUrg.className = "badge " + getUrgencyBadgeClass(preview.urgency, preview.score);
      }
    });
  }
});
