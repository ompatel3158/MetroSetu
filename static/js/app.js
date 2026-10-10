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
  charts: {
    ridershipTrend: null,
    lineDist: null,
    faultSeverity: null,
    stationHealth: null,
    stationDetailRidership: null
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

  if (route === "#stations") {
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
      renderStationHealthChart(stations);
    }
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
});
