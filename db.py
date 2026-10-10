"""
db.py - Single Database Abstraction Module for Metro Transit Ops
================================================================
ALL database queries and operations MUST live in this module.
No other file in this project should import sqlite3 or execute raw SQL.

HOW TO SWAP DATABASE ENGINES:
-----------------------------
To replace SQLite with PostgreSQL, MySQL, DuckDB, or an external cloud DB:
1. Change the connection factory in `get_connection()` below (e.g., use `psycopg2`,
   `asyncpg`, `duckdb`, or `sqlalchemy.engine`).
2. Adjust parameter placeholders in the query helper if needed (e.g., `%s` vs `?`).
3. Keep the public function signatures (get_all_stations, create_station, etc.)
   identical so that `main.py`, `ai_engine.py`, and `seed.py` require zero changes.
"""

import sqlite3
import os
from contextlib import contextmanager
from typing import List, Dict, Any, Optional

DB_PATH = os.path.join(os.path.dirname(__file__), "metro.db")


# ============================================================================
# CONNECTION MANAGEMENT
# ============================================================================

@contextmanager
def get_connection():
    """
    Context manager yielding a database connection.
    Configured with Row factory so query results behave like Python dicts.
    """
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def query_all(query: str, params: tuple = ()) -> List[Dict[str, Any]]:
    """Helper: execute query and return list of dicts."""
    with get_connection() as conn:
        cursor = conn.execute(query, params)
        return [dict(row) for row in cursor.fetchall()]


def query_one(query: str, params: tuple = ()) -> Optional[Dict[str, Any]]:
    """Helper: execute query and return a single dict or None."""
    with get_connection() as conn:
        cursor = conn.execute(query, params)
        row = cursor.fetchone()
        return dict(row) if row else None


def execute_commit(query: str, params: tuple = ()) -> int:
    """Helper: execute INSERT/UPDATE/DELETE and return lastrowid or affected rows."""
    with get_connection() as conn:
        cursor = conn.execute(query, params)
        return cursor.lastrowid


# ============================================================================
# SCHEMA INITIALIZATION
# ============================================================================

def init_db():
    """Creates tables, foreign keys, and indices if they do not exist."""
    with get_connection() as conn:
        conn.executescript("""
        CREATE TABLE IF NOT EXISTS stations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT UNIQUE NOT NULL,
            name TEXT NOT NULL,
            line_name TEXT NOT NULL,
            zone INTEGER DEFAULT 1,
            status TEXT DEFAULT 'Operational',
            daily_capacity INTEGER DEFAULT 50000,
            is_accessible INTEGER DEFAULT 1,
            latitude REAL,
            longitude REAL,
            opened_year INTEGER DEFAULT 2018,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS ridership_hourly (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
            recorded_at TEXT NOT NULL,
            day_of_week INTEGER NOT NULL,
            hour INTEGER NOT NULL,
            tap_ins INTEGER NOT NULL,
            tap_outs INTEGER NOT NULL,
            is_anomaly INTEGER DEFAULT 0,
            anomaly_note TEXT
        );

        CREATE TABLE IF NOT EXISTS asset_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
            asset_name TEXT NOT NULL,
            category TEXT NOT NULL,
            health_score INTEGER DEFAULT 95,
            status TEXT DEFAULT 'Good',
            last_serviced TEXT,
            notes TEXT
        );

        CREATE TABLE IF NOT EXISTS fault_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
            title TEXT NOT NULL,
            component TEXT NOT NULL,
            severity TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'Active',
            reported_at TEXT NOT NULL,
            resolved_at TEXT,
            description TEXT
        );

        CREATE TABLE IF NOT EXISTS bus_connections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            station_id INTEGER NOT NULL REFERENCES stations(id) ON DELETE CASCADE,
            route_number TEXT NOT NULL,
            destination TEXT NOT NULL,
            frequency_mins INTEGER NOT NULL,
            status TEXT DEFAULT 'On Time'
        );

        -- Performance Indices
        CREATE INDEX IF NOT EXISTS idx_ridership_station_time ON ridership_hourly(station_id, recorded_at);
        CREATE INDEX IF NOT EXISTS idx_ridership_anomaly ON ridership_hourly(is_anomaly);
        CREATE INDEX IF NOT EXISTS idx_faults_status ON fault_events(status, severity);
        CREATE INDEX IF NOT EXISTS idx_assets_station ON asset_logs(station_id);
        CREATE INDEX IF NOT EXISTS idx_bus_station ON bus_connections(station_id);
        """)


def reset_db():
    """Drops all tables and re-initializes the schema (useful for re-seeding)."""
    with get_connection() as conn:
        conn.executescript("""
        DROP TABLE IF EXISTS bus_connections;
        DROP TABLE IF EXISTS fault_events;
        DROP TABLE IF EXISTS asset_logs;
        DROP TABLE IF EXISTS ridership_hourly;
        DROP TABLE IF EXISTS stations;
        """)
    init_db()


# ============================================================================
# STATIONS CRUD
# ============================================================================

def get_all_stations(
    search: Optional[str] = None,
    line: Optional[str] = None,
    status: Optional[str] = None,
    accessible: Optional[bool] = None
) -> List[Dict[str, Any]]:
    """Fetch all stations with optional search, line, status, accessibility filters."""
    query = """
        SELECT s.*,
            (SELECT COUNT(*) FROM fault_events f WHERE f.station_id = s.id AND f.status = 'Active') AS active_faults,
            (SELECT ROUND(AVG(health_score), 1) FROM asset_logs a WHERE a.station_id = s.id) AS avg_asset_health,
            (SELECT COUNT(*) FROM bus_connections b WHERE b.station_id = s.id) AS bus_route_count
        FROM stations s
        WHERE 1=1
    """
    params = []

    if search:
        query += " AND (s.name LIKE ? OR s.code LIKE ?)"
        params.extend([f"%{search}%", f"%{search}%"])
    if line:
        query += " AND s.line_name = ?"
        params.append(line)
    if status:
        query += " AND s.status = ?"
        params.append(status)
    if accessible is not None:
        query += " AND s.is_accessible = ?"
        params.append(1 if accessible else 0)

    query += " ORDER BY s.name ASC"
    return query_all(query, tuple(params))


def get_station_by_id(station_id: int) -> Optional[Dict[str, Any]]:
    """Fetch complete station details by station ID."""
    return query_one("SELECT * FROM stations WHERE id = ?", (station_id,))


def create_station(data: Dict[str, Any]) -> int:
    """Insert a new station and return the new ID."""
    query = """
        INSERT INTO stations (
            code, name, line_name, zone, status,
            daily_capacity, is_accessible, latitude, longitude, opened_year
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """
    params = (
        data.get("code"),
        data.get("name"),
        data.get("line_name", "Red Line"),
        data.get("zone", 1),
        data.get("status", "Operational"),
        data.get("daily_capacity", 50000),
        1 if data.get("is_accessible", True) else 0,
        data.get("latitude", 40.7128),
        data.get("longitude", -74.0060),
        data.get("opened_year", 2020)
    )
    return execute_commit(query, params)


def update_station(station_id: int, data: Dict[str, Any]) -> bool:
    """Update existing station fields."""
    query = """
        UPDATE stations SET
            code = ?,
            name = ?,
            line_name = ?,
            zone = ?,
            status = ?,
            daily_capacity = ?,
            is_accessible = ?,
            latitude = ?,
            longitude = ?,
            opened_year = ?
        WHERE id = ?
    """
    params = (
        data.get("code"),
        data.get("name"),
        data.get("line_name"),
        data.get("zone"),
        data.get("status"),
        data.get("daily_capacity"),
        1 if data.get("is_accessible") else 0,
        data.get("latitude"),
        data.get("longitude"),
        data.get("opened_year"),
        station_id
    )
    with get_connection() as conn:
        cursor = conn.execute(query, params)
        return cursor.rowcount > 0


def delete_station(station_id: int) -> bool:
    """Delete a station and cascade related records."""
    with get_connection() as conn:
        cursor = conn.execute("DELETE FROM stations WHERE id = ?", (station_id,))
        return cursor.rowcount > 0


# ============================================================================
# RIDERSHIP & ANALYTICS
# ============================================================================

def get_ridership_history(
    station_id: Optional[int] = None,
    limit: int = 168
) -> List[Dict[str, Any]]:
    """Retrieve chronologically ordered hourly ridership records."""
    if station_id:
        query = """
            SELECT r.*, s.name as station_name, s.line_name
            FROM ridership_hourly r
            JOIN stations s ON s.id = r.station_id
            WHERE r.station_id = ?
            ORDER BY r.recorded_at DESC
            LIMIT ?
        """
        rows = query_all(query, (station_id, limit))
    else:
        query = """
            SELECT r.*, s.name as station_name, s.line_name
            FROM ridership_hourly r
            JOIN stations s ON s.id = r.station_id
            ORDER BY r.recorded_at DESC
            LIMIT ?
        """
        rows = query_all(query, (limit,))
    # Return in chronological order
    rows.reverse()
    return rows


def get_system_hourly_series(hours: int = 24) -> List[Dict[str, Any]]:
    """Retrieve system-wide aggregated tap-ins and tap-outs for the last N hours."""
    query = """
        SELECT
            recorded_at,
            hour,
            SUM(tap_ins) as total_tap_ins,
            SUM(tap_outs) as total_tap_outs,
            SUM(is_anomaly) as anomaly_count
        FROM ridership_hourly
        GROUP BY recorded_at
        ORDER BY recorded_at DESC
        LIMIT ?
    """
    rows = query_all(query, (hours,))
    rows.reverse()
    return rows


def get_ridership_by_line() -> List[Dict[str, Any]]:
    """Aggregate total ridership grouped by line name for charts."""
    query = """
        SELECT
            s.line_name,
            SUM(r.tap_ins) as total_tap_ins,
            SUM(r.tap_outs) as total_tap_outs,
            COUNT(DISTINCT s.id) as station_count
        FROM stations s
        LEFT JOIN ridership_hourly r ON s.id = r.station_id
        GROUP BY s.line_name
        ORDER BY total_tap_ins DESC
    """
    return query_all(query)


def get_station_hourly_profile(station_id: int, hours: int = 24) -> List[Dict[str, Any]]:
    """Recent hourly timeline for a single station."""
    query = """
        SELECT recorded_at, hour, tap_ins, tap_outs, is_anomaly, anomaly_note
        FROM ridership_hourly
        WHERE station_id = ?
        ORDER BY recorded_at DESC
        LIMIT ?
    """
    rows = query_all(query, (station_id, hours))
    rows.reverse()
    return rows


def flag_ridership_anomaly(record_id: int, is_anomaly: int, note: Optional[str] = None):
    """Mark a ridership data point as anomalous with diagnostic note."""
    execute_commit(
        "UPDATE ridership_hourly SET is_anomaly = ?, anomaly_note = ? WHERE id = ?",
        (is_anomaly, note, record_id)
    )


# ============================================================================
# ASSETS & MAINTENANCE
# ============================================================================

def get_assets_by_station(station_id: int) -> List[Dict[str, Any]]:
    """Fetch all equipment assets for a given station."""
    return query_all(
        "SELECT * FROM asset_logs WHERE station_id = ? ORDER BY health_score ASC",
        (station_id,)
    )


def get_all_assets(status: Optional[str] = None) -> List[Dict[str, Any]]:
    """Fetch all assets across the network."""
    query = """
        SELECT a.*, s.name as station_name, s.line_name
        FROM asset_logs a
        JOIN stations s ON s.id = a.station_id
        WHERE 1=1
    """
    params = []
    if status:
        query += " AND a.status = ?"
        params.append(status)
    query += " ORDER BY a.health_score ASC"
    return query_all(query, tuple(params))


def create_asset_log(data: Dict[str, Any]) -> int:
    """Register a new asset or maintenance log."""
    query = """
        INSERT INTO asset_logs (station_id, asset_name, category, health_score, status, last_serviced, notes)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    """
    params = (
        data.get("station_id"),
        data.get("asset_name"),
        data.get("category", "Mechanical"),
        data.get("health_score", 100),
        data.get("status", "Good"),
        data.get("last_serviced"),
        data.get("notes")
    )
    return execute_commit(query, params)


def update_asset_health(asset_id: int, health_score: int, status: str, notes: Optional[str] = None):
    """Update asset condition after inspection."""
    execute_commit(
        "UPDATE asset_logs SET health_score = ?, status = ?, notes = ? WHERE id = ?",
        (health_score, status, notes, asset_id)
    )


# ============================================================================
# FAULT EVENTS & ALERTS
# ============================================================================

def get_all_faults(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    station_id: Optional[int] = None
) -> List[Dict[str, Any]]:
    """Retrieve fault events with optional filters."""
    query = """
        SELECT f.*, s.name as station_name, s.line_name
        FROM fault_events f
        JOIN stations s ON s.id = f.station_id
        WHERE 1=1
    """
    params = []
    if status:
        query += " AND f.status = ?"
        params.append(status)
    if severity:
        query += " AND f.severity = ?"
        params.append(severity)
    if station_id:
        query += " AND f.station_id = ?"
        params.append(station_id)

    query += " ORDER BY CASE f.severity WHEN 'Critical' THEN 1 WHEN 'Warning' THEN 2 ELSE 3 END, f.reported_at DESC"
    return query_all(query, tuple(params))


def get_fault_by_id(fault_id: int) -> Optional[Dict[str, Any]]:
    """Retrieve a single fault event."""
    query = """
        SELECT f.*, s.name as station_name, s.line_name
        FROM fault_events f
        JOIN stations s ON s.id = f.station_id
        WHERE f.id = ?
    """
    return query_one(query, (fault_id,))


def create_fault(data: Dict[str, Any]) -> int:
    """Log a new fault or alert event."""
    query = """
        INSERT INTO fault_events (
            station_id, title, component, severity, status, reported_at, resolved_at, description
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """
    params = (
        data.get("station_id"),
        data.get("title"),
        data.get("component"),
        data.get("severity", "Warning"),
        data.get("status", "Active"),
        data.get("reported_at"),
        data.get("resolved_at"),
        data.get("description")
    )
    return execute_commit(query, params)


def update_fault_status(fault_id: int, status: str, resolved_at: Optional[str] = None) -> bool:
    """Update status of a fault event (e.g. mark Resolved)."""
    with get_connection() as conn:
        cursor = conn.execute(
            "UPDATE fault_events SET status = ?, resolved_at = ? WHERE id = ?",
            (status, resolved_at, fault_id)
        )
        return cursor.rowcount > 0


# ============================================================================
# BUS CONNECTIONS
# ============================================================================

def get_bus_connections(station_id: Optional[int] = None) -> List[Dict[str, Any]]:
    """Retrieve feeder bus connections for a station or all stations."""
    if station_id:
        return query_all(
            "SELECT * FROM bus_connections WHERE station_id = ? ORDER BY route_number ASC",
            (station_id,)
        )
    query = """
        SELECT b.*, s.name as station_name
        FROM bus_connections b
        JOIN stations s ON s.id = b.station_id
        ORDER BY b.route_number ASC
    """
    return query_all(query)


def create_bus_connection(data: Dict[str, Any]) -> int:
    """Add a feeder bus connection."""
    query = """
        INSERT INTO bus_connections (station_id, route_number, destination, frequency_mins, status)
        VALUES (?, ?, ?, ?, ?)
    """
    params = (
        data.get("station_id"),
        data.get("route_number"),
        data.get("destination"),
        data.get("frequency_mins", 15),
        data.get("status", "On Time")
    )
    return execute_commit(query, params)


# ============================================================================
# DASHBOARD KPIS & STATS
# ============================================================================

def get_kpis() -> Dict[str, Any]:
    """Calculate aggregate system KPIs for the dashboard cards."""
    with get_connection() as conn:
        # Station counts
        station_stats = conn.execute("""
            SELECT
                COUNT(*) as total_stations,
                SUM(CASE WHEN status = 'Operational' THEN 1 ELSE 0 END) as operational_stations,
                COUNT(DISTINCT line_name) as total_lines
            FROM stations
        """).fetchone()

        # Ridership metrics (last 24 hours vs previous 24 hours)
        ridership_stats = conn.execute("""
            SELECT
                COALESCE(SUM(tap_ins), 0) as total_tap_ins,
                COALESCE(SUM(tap_outs), 0) as total_tap_outs,
                COALESCE(MAX(tap_ins), 0) as peak_hour_tap_ins
            FROM ridership_hourly
            WHERE recorded_at >= datetime('now', '-24 hours')
        """).fetchone()

        # Active faults count
        fault_stats = conn.execute("""
            SELECT
                COUNT(*) as total_active_faults,
                SUM(CASE WHEN severity = 'Critical' THEN 1 ELSE 0 END) as critical_faults,
                SUM(CASE WHEN severity = 'Warning' THEN 1 ELSE 0 END) as warning_faults
            FROM fault_events
            WHERE status != 'Resolved'
        """).fetchone()

        # Fleet asset health
        asset_stats = conn.execute("""
            SELECT
                ROUND(AVG(health_score), 1) as avg_health,
                SUM(CASE WHEN health_score < 70 THEN 1 ELSE 0 END) as degrading_assets
            FROM asset_logs
        """).fetchone()

        # Anomaly count
        anomaly_count = conn.execute("""
            SELECT COUNT(*) FROM ridership_hourly WHERE is_anomaly = 1
        """).fetchone()[0]

    return {
        "stations": {
            "total": station_stats["total_stations"] or 0,
            "operational": station_stats["operational_stations"] or 0,
            "lines": station_stats["total_lines"] or 0
        },
        "ridership": {
            "total_24h": ridership_stats["total_tap_ins"] or 0,
            "peak_hour": ridership_stats["peak_hour_tap_ins"] or 0
        },
        "faults": {
            "active_total": fault_stats["total_active_faults"] or 0,
            "critical": fault_stats["critical_faults"] or 0,
            "warning": fault_stats["warning_faults"] or 0
        },
        "assets": {
            "average_health": asset_stats["avg_health"] or 100.0,
            "degrading_count": asset_stats["degrading_assets"] or 0
        },
        "anomalies_detected": anomaly_count
    }


# ============================================================================
# SEED SCRIPT CORE (Accessed via db.py)
# ============================================================================

def seed_metro_data(hours_history: int = 168) -> Dict[str, int]:
    """
    Populates SQLite with realistic metro stations, equipment assets,
    hourly ridership patterns with synthetic anomalies, fault events, and bus routes.
    """
    import random
    from datetime import datetime, timedelta

    reset_db()

    # 1. Stations Data
    stations_data = [
        {"code": "MET-01", "name": "Central Hub Station", "line_name": "Red Line", "zone": 1, "status": "Operational", "daily_capacity": 85000, "is_accessible": 1, "latitude": 40.7527, "longitude": -73.9772, "opened_year": 2015},
        {"code": "MET-02", "name": "Financial District", "line_name": "Red Line", "zone": 1, "status": "Operational", "daily_capacity": 70000, "is_accessible": 1, "latitude": 40.7075, "longitude": -74.0090, "opened_year": 2016},
        {"code": "MET-03", "name": "North Tech Park", "line_name": "Red Line", "zone": 2, "status": "Operational", "daily_capacity": 60000, "is_accessible": 1, "latitude": 40.7831, "longitude": -73.9712, "opened_year": 2019},
        {"code": "MET-04", "name": "Innovation Quarter", "line_name": "Red Line", "zone": 2, "status": "Operational", "daily_capacity": 45000, "is_accessible": 1, "latitude": 40.8116, "longitude": -73.9465, "opened_year": 2021},
        {"code": "MET-05", "name": "Airport Terminal 1-3", "line_name": "Blue Line", "zone": 3, "status": "Operational", "daily_capacity": 65000, "is_accessible": 1, "latitude": 40.6413, "longitude": -73.7781, "opened_year": 2017},
        {"code": "MET-06", "name": "Harbor Point & Ferry", "line_name": "Blue Line", "zone": 1, "status": "Operational", "daily_capacity": 52000, "is_accessible": 1, "latitude": 40.7013, "longitude": -74.0152, "opened_year": 2016},
        {"code": "MET-07", "name": "University Campus", "line_name": "Green Line", "zone": 2, "status": "Operational", "daily_capacity": 55000, "is_accessible": 1, "latitude": 40.8075, "longitude": -73.9626, "opened_year": 2018},
        {"code": "MET-08", "name": "Botanical Gardens", "line_name": "Green Line", "zone": 2, "status": "Operational", "daily_capacity": 35000, "is_accessible": 1, "latitude": 40.8623, "longitude": -73.8772, "opened_year": 2020},
        {"code": "MET-09", "name": "Stadium & Arena", "line_name": "Yellow Line", "zone": 2, "status": "Maintenance", "daily_capacity": 95000, "is_accessible": 1, "latitude": 40.8296, "longitude": -73.9262, "opened_year": 2018},
        {"code": "MET-10", "name": "Grand Arts Pavilion", "line_name": "Yellow Line", "zone": 1, "status": "Operational", "daily_capacity": 40000, "is_accessible": 1, "latitude": 40.7725, "longitude": -73.9835, "opened_year": 2019},
    ]

    station_ids = []
    with get_connection() as conn:
        for st in stations_data:
            cursor = conn.execute("""
                INSERT INTO stations (code, name, line_name, zone, status, daily_capacity, is_accessible, latitude, longitude, opened_year)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (st["code"], st["name"], st["line_name"], st["zone"], st["status"], st["daily_capacity"], st["is_accessible"], st["latitude"], st["longitude"], st["opened_year"]))
            station_ids.append((cursor.lastrowid, st["code"], st["name"]))

    # 2. Hourly Ridership Generation
    # Diurnal multiplier curves for typical hours (0 to 23)
    diurnal_profile = [
        0.05, 0.02, 0.01, 0.01, 0.03, 0.15,  # 00:00 - 05:00 night
        0.45, 0.90, 1.00, 0.85, 0.55, 0.50,  # 06:00 - 11:00 morning rush
        0.52, 0.50, 0.55, 0.65, 0.85, 0.98,  # 12:00 - 17:00 evening rush
        0.80, 0.55, 0.40, 0.30, 0.20, 0.10   # 18:00 - 23:00 night taper
    ]

    now = datetime.now().replace(minute=0, second=0, microsecond=0)
    start_time = now - timedelta(hours=hours_history - 1)

    ridership_rows = []
    # Deterministic pseudo-random seed so test results are reproducible
    rng = random.Random(42)

    for step in range(hours_history):
        current_dt = start_time + timedelta(hours=step)
        hour = current_dt.hour
        dow = current_dt.weekday()
        dt_str = current_dt.strftime("%Y-%m-%dT%H:00:00")
        is_weekend = dow in (5, 6)

        for s_id, s_code, s_name in station_ids:
            # Base capacity factor
            if s_code == "MET-01": base_vol = 3500
            elif s_code == "MET-02": base_vol = 3000
            elif s_code == "MET-09": base_vol = 2800
            elif s_code == "MET-05": base_vol = 2400
            else: base_vol = 1600

            factor = diurnal_profile[hour]
            if is_weekend:
                factor = factor * 0.70
                # Shift peak to afternoon for weekends
                if 12 <= hour <= 16:
                    factor *= 1.35

            noise = rng.uniform(0.85, 1.15)
            tap_ins = int(base_vol * factor * noise)
            tap_outs = int(tap_ins * rng.uniform(0.90, 1.10))

            # Injected Synthetic Anomalies for on-device AI detection
            is_anomaly = 0
            anomaly_note = None

            # Stadium massive Friday surge (step near 30 hours ago)
            if s_code == "MET-09" and dow == 4 and 19 <= hour <= 21:
                tap_ins = int(tap_ins * 3.4) # Surge due to championship match
                tap_outs = int(tap_outs * 2.8)
                is_anomaly = 1
                anomaly_note = "Pre-season Championship Match: Unprecedented gate surge"

            # Airport sudden drop on Wednesday morning (security check conveyor breakdown)
            elif s_code == "MET-05" and dow == 2 and 9 <= hour <= 11:
                tap_ins = max(15, int(tap_ins * 0.12)) # 88% drop
                tap_outs = max(20, int(tap_outs * 0.15))
                is_anomaly = 1
                anomaly_note = "Baggage screening outage: Security checkpoint restriction"

            # Tech park morning spike
            elif s_code == "MET-03" and dow == 1 and hour == 8:
                tap_ins = int(tap_ins * 2.6)
                is_anomaly = 1
                anomaly_note = "Tech Summit Keynote: Heavy morning surge"

            ridership_rows.append((s_id, dt_str, dow, hour, tap_ins, tap_outs, is_anomaly, anomaly_note))

    with get_connection() as conn:
        conn.executemany("""
            INSERT INTO ridership_hourly (station_id, recorded_at, day_of_week, hour, tap_ins, tap_outs, is_anomaly, anomaly_note)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, ridership_rows)

    # 3. Asset Equipment Logs
    asset_templates = [
        ("Escalator Bank A (Mezzanine)", "Mechanical", 94, "Good", "Monthly chain lubrication complete"),
        ("Escalator Bank B (Platform)", "Mechanical", 62, "Warning", "Vibration sensor detected bearing friction in upper drive"),
        ("Turnstiles 1-6 Contactless", "Ticketing", 98, "Good", "Firmware v4.2 updated; NFC latency <120ms"),
        ("Traction Power Substation", "Electrical", 91, "Good", "Transformer oil temp 48°C normal; voltage steady"),
        ("Signaling Interlocking Relay", "Signaling", 88, "Good", "Block signal cycle verified; zero false reds"),
        ("Platform Screen Doors", "Mechanical", 95, "Good", "Obstruction sensors recalibrated"),
        ("Tunnel Ventilation Jet Fan", "HVAC", 78, "Good", "Airflow CFM at 98% nominal"),
        ("Ticket Vending Machines (TVMs)", "Ticketing", 85, "Good", "Cashless optical scanners operational"),
    ]

    asset_rows = []
    for s_id, _, _ in station_ids:
        # Give each station a subset or full set of assets
        for a_name, cat, base_h, stat, note in asset_templates:
            h = min(100, max(45, base_h + rng.randint(-8, 5)))
            c_stat = "Warning" if h < 70 else ("Critical" if h < 50 else "Good")
            last_date = (now - timedelta(days=rng.randint(3, 30))).strftime("%Y-%m-%d")
            asset_rows.append((s_id, a_name, cat, h, c_stat, last_date, note))

    with get_connection() as conn:
        conn.executemany("""
            INSERT INTO asset_logs (station_id, asset_name, category, health_score, status, last_serviced, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, asset_rows)

    # 4. Fault Events & Incident Logs
    faults_data = [
        (station_ids[0][0], "Track Circuit Frequency Mismatch", "Signaling", "Critical", "Active", (now - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S"), None, "Intermittent carrier loss detected on Track 1 approach circuit. Signal dropped to restrictive."),
        (station_ids[8][0], "Escalator Drive Motor Overheat", "Mechanical", "Critical", "Active", (now - timedelta(hours=4)).strftime("%Y-%m-%dT%H:%M:%S"), None, "Thermal safety relay tripped on Escalator B lower carriage after heavy stadium load."),
        (station_ids[4][0], "BVS Optical Scanner Timeout", "Ticketing", "Warning", "Investigating", (now - timedelta(hours=7)).strftime("%Y-%m-%dT%H:%M:%S"), None, "Gate 3 NFC reader failed to register smartcards on 12 consecutive tap attempts."),
        (station_ids[1][0], "Substation Voltage Fluctuation", "Electrical", "Warning", "Active", (now - timedelta(hours=14)).strftime("%Y-%m-%dT%H:%M:%S"), None, "Phase B voltage dropped 6% during 08:30 morning peak load; secondary rectifier engaged."),
        (station_ids[6][0], "Platform Screen Door Obstruction Sensor Alert", "Platform Doors", "Info", "Investigating", (now - timedelta(hours=18)).strftime("%Y-%m-%dT%H:%M:%S"), None, "Optical beam alignment test reported 15% signal attenuation at door panel 4."),
        (station_ids[2][0], "HVAC Compressor Belt Replacement", "HVAC", "Warning", "Resolved", (now - timedelta(days=2)).strftime("%Y-%m-%dT%H:%M:%S"), (now - timedelta(days=1)).strftime("%Y-%m-%dT%H:%M:%S"), "Completed preventive belt tensioning and filter element change."),
        (station_ids[3][0], "Emergency Lighting Circuit Test", "Electrical", "Info", "Resolved", (now - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S"), (now - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S"), "Mandatory bi-weekly 90-minute battery duration test completed with 100% compliance."),
    ]

    with get_connection() as conn:
        conn.executemany("""
            INSERT INTO fault_events (station_id, title, component, severity, status, reported_at, resolved_at, description)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, faults_data)

    # 5. Feeder Bus Connections
    bus_data = [
        (station_ids[0][0], "Route 101 Express", "Civic Center & North Plaza", 10, "On Time"),
        (station_ids[0][0], "Route 44 Crosstown", "East Waterfront District", 15, "On Time"),
        (station_ids[1][0], "Financial Rapid 12", "Battery Park & Wall St Ferry", 8, "On Time"),
        (station_ids[2][0], "Tech Shuttle 7", "Silicon Park North & Campus 2", 12, "On Time"),
        (station_ids[2][0], "Route 88 Circulator", "Innovation Commons", 15, "Delayed 5m"),
        (station_ids[3][0], "Route 52", "BioTech Center & Research Lab", 20, "On Time"),
        (station_ids[4][0], "AirLink Express A", "Long-Term Parking P4", 6, "On Time"),
        (station_ids[4][0], "AirLink Express B", "Car Rental Center & Cargo 2", 10, "On Time"),
        (station_ids[5][0], "Harbor Ferry Feeder 3", "Pier 11 Cruise Terminal", 15, "On Time"),
        (station_ids[6][0], "Campus Transit Blue", "Medical Science Tower & Clinic", 8, "On Time"),
        (station_ids[6][0], "Campus Transit Red", "Undergraduate Quad & Library", 10, "On Time"),
        (station_ids[7][0], "Parks Shuttle 19", "Arboretum South Gate", 20, "On Time"),
        (station_ids[8][0], "Arena Special Event 99", "East Parking Pavilion", 5, "On Time"),
        (station_ids[8][0], "Route 23 Local", "Grand Boulevard & West Side", 15, "Delayed 10m"),
        (station_ids[9][0], "Museum Link 6", "Symphony Hall & Arts Center", 12, "On Time"),
    ]

    with get_connection() as conn:
        conn.executemany("""
            INSERT INTO bus_connections (station_id, route_number, destination, frequency_mins, status)
            VALUES (?, ?, ?, ?, ?)
        """, bus_data)

    return {
        "stations": len(station_ids),
        "ridership_records": len(ridership_rows),
        "assets": len(asset_rows),
        "faults": len(faults_data),
        "bus_connections": len(bus_data)
    }

