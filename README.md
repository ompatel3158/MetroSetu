# METRO-CORE // Transit Ops (Offline-First Website Template)

An **offline-first, zero-cloud-dependency** full-stack operations dashboard built for hackathons.

- **Backend**: Python [FastAPI](https://fastapi.tiangolo.com/) running on localhost.
- **Database**: SQLite isolated strictly inside a single [`db.py`](file:///b:/temp/db.py) module (so the engine can be swapped with zero changes to routes or AI code).
- **Frontend**: Plain HTML5, CSS3, and vanilla JS with [Chart.js 4.4.7](file:///b:/temp/static/js/chart.min.js) bundled locally (**no CDN links, no external fonts**).
- **Service Worker**: [`static/sw.js`](file:///b:/temp/static/sw.js) pre-caches the application shell and caches API responses for offline resilience.
- **On-Device AI**: Pure Python statistical learning engine ([`ai_engine.py`](file:///b:/temp/ai_engine.py)) implementing **Modified Z-Score / MAD Anomaly Detection** and **Seasonal Demand Forecasting** without any external APIs, PyTorch, or cloud keys.
- **Sample Metro Data**: Realistic seed generator ([`seed.py`](file:///b:/temp/seed.py)) with stations, hourly ridership, equipment asset logs, fault incidents, and feeder bus routes.

---

## Quickstart: Exact Run Commands

### 1. Install Dependencies
Run in your terminal (PowerShell, Command Prompt, or bash):

```bash
pip install -r requirements.txt
```

*(Only `fastapi` and `uvicorn` are required; all other libraries use the Python standard library).*

### 2. Seed Realistic Metro Data
Populate the local SQLite database with stations, 168 hours of hourly ridership with synthetic anomalies, asset equipment logs, fault events, and bus connections:

```bash
python seed.py
```

*Optional:* Specify a custom history window:
```bash
python seed.py --hours 336   # Seeds 14 days of hourly records
```

### 3. Launch the Localhost Server
Start the FastAPI server on port 8000:

```bash
python -m uvicorn main:app --reload --port 8000
```

### 4. Open in Your Browser
Navigate to:

```
http://localhost:8000
```

---

## Project Structure

```
├── README.md               # Documentation, architecture guide & hackathon tips
├── requirements.txt        # Backend dependencies (fastapi, uvicorn)
├── db.py                   # Single DB abstraction layer (ONLY place SQLite is accessed)
├── ai_engine.py            # Pure Python on-device AI (Anomalies + Demand Forecasting)
├── seed.py                 # Standalone CLI seeder script
├── main.py                 # FastAPI application, REST endpoints, PWA router
├── metro.db                # Auto-generated local SQLite database
└── static/
    ├── index.html          # Single-Page frontend containing all 5 views
    ├── sw.js               # Service Worker (offline shell & API cache)
    ├── css/
    │   └── app.css         # Modern transit UI (system fonts, dark slate, responsive)
    └── js/
        ├── chart.min.js    # Bundled Chart.js 4.4.7 UMD (local, zero CDN)
        └── app.js          # Client router, offline detector, charts, CRUD handlers
```

---

## Pages Included in Template

| View | Route | Features |
|---|---|---|
| **1. Operations Dashboard** | `/#dashboard` | 5 KPI summary cards, 24h Ridership + AI Demand Forecast chart, Line distribution donut, Equipment health bar chart, Priority incidents table, Quick action buttons. |
| **2. Stations Directory** | `/#stations` | Real-time search by name/code, filter by Line, Status (Operational/Maintenance/Disrupted), and Accessibility; actions for View Details, Edit, and Delete. |
| **3. Station Detail View** | `/#station-detail?id=X` | Station hero stats, 24-hour tap-in vs tap-out trend chart, Infrastructure asset health logs (escalators, turnstiles, power, signaling), Active fault events, Feeder bus connections. |
| **4. Add / Edit Station Form** | `/#station-form` | Responsive form to add new transit stations or edit existing station parameters (code, name, line, zone, status, capacity, wheelchair access, coordinates). |
| **5. Alerts & On-Device AI** | `/#alerts` | Interactive pure-Python anomaly scan, detailed outlier table with Z-scores & diagnostics, filterable system fault logs, one-click "Mark Resolved" action. |

---

## Offline-First Architecture

1. **Zero External Requests**:
   - No Google Fonts (`system-ui` font stack used instead).
   - No CDN `<script>` or `<link>` tags.
   - SVG icons are embedded inline.
   - Chart.js is bundled directly at [`static/js/chart.min.js`](file:///b:/temp/static/js/chart.min.js).
2. **Service Worker (`sw.js`)**:
   - **App Shell**: Uses a Cache-First strategy for HTML, CSS, JS, and Chart.js so the app loads instantly even when offline or when the server is temporarily stopped.
   - **API Routes**: Uses a Network-First strategy with Cache Fallback for `/api/*` endpoints. Fresh data is cached on every successful read; when offline, cached telemetry is served seamlessly.
3. **Live Connectivity Heartbeat**:
   - The UI header features a pulsing status indicator:
     - 🟢 **ONLINE**: Connected to localhost backend.
     - 🟡 **OFFLINE (CACHED)**: Operating from browser cache.
   - Combines `navigator.onLine` with an active 8-second polling ping to `/api/health`.

---

## Single Database Module (`db.py`)

All database operations are encapsulated inside [`db.py`](file:///b:/temp/db.py). Neither [`main.py`](file:///b:/temp/main.py), [`ai_engine.py`](file:///b:/temp/ai_engine.py), nor [`seed.py`](file:///b:/temp/seed.py) contain raw SQL or direct `sqlite3` imports.

### How to Swap the Database Engine

To replace SQLite with PostgreSQL, MySQL, DuckDB, or another database:
1. Open [`db.py`](file:///b:/temp/db.py).
2. Modify `get_connection()` to return your connection client (e.g. `psycopg2.connect(...)` or `duckdb.connect(...)`).
3. Replace query parameter placeholders if needed (e.g. `%s` for PostgreSQL vs `?` for SQLite).
4. All function signatures (`get_all_stations`, `create_station`, `get_kpis`, etc.) remain identical, ensuring zero refactoring in other files.

---

## Pure-Python On-Device AI Engine (`ai_engine.py`)

No external APIs, OpenAI keys, or heavy machine learning frameworks (PyTorch, TensorFlow, scikit-learn) required.

### 1. Robust Anomaly Detection
- Computes baseline hourly distributions conditioned on `(station, day_of_week, hour)`.
- Uses **Median** and **Median Absolute Deviation (MAD)** instead of standard deviation so historical outliers don't contaminate the baseline scale.
- Calculates the **Modified Z-Score** ($M_i = \frac{0.6745 \cdot (x_i - \text{median})}{\text{MAD}}$).
- Flags passenger **Surges** ($M_i \ge 2.5$) and **Drops** ($M_i \le -2.5$) with plain-English diagnostic explanations and severity ratings.

### 2. Seasonal Demand Forecasting
- Implements **Seasonal Exponential Smoothing (Holt-Winters decomposition)**.
- Computes 24-hour diurnal seasonal weights and day-of-week commuting multipliers.
- Projects point predictions $H$ hours into the future.
- Generates **95% Confidence Prediction Intervals** (upper and lower bounds) displayed as shaded prediction bands in Chart.js.

---

## Hackathon Customization Guide

### Adding a New Data Field
1. In [`db.py`](file:///b:/temp/db.py): Add the column to `init_db()` and update `create_station()` / `update_station()`.
2. In [`main.py`](file:///b:/temp/main.py): Add the field to `StationCreate` and `StationUpdate` Pydantic models.
3. In [`static/index.html`](file:///b:/temp/static/index.html): Add the `<input>` element inside the form grid.
4. In [`static/js/app.js`](file:///b:/temp/static/js/app.js): Add the value extraction in `setupStationForm()` and `handleStationFormSubmit()`.

### Adjusting AI Sensitivity
In the Alerts page or via API:
```bash
curl -X POST "http://localhost:8000/api/ai/anomalies/detect?sensitivity=3.0"
```
Lower values (e.g. `2.0`) flag more subtle deviations; higher values (e.g. `3.5`) flag only extreme emergencies.

---

## License
MIT - Free to use and adapt for any hackathon, workshop, or prototype.
