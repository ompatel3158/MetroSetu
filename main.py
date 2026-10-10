"""
main.py - FastAPI Backend for Metro Transit Ops (Offline-First)
==============================================================
Runs purely on localhost with zero external network calls.
All database access is routed strictly through `db.py`.
All AI functions run locally via `ai_engine.py`.
"""

import os
from datetime import datetime
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, Query, Body, Response
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

import db
import ai_engine

# Ensure database is initialized on server startup
db.init_db()

app = FastAPI(
    title="Metro Transit Ops",
    description="Offline-first operations platform for metro transit management",
    version="1.0.0"
)

# Localhost CORS (allows local offline caching and PWA service worker)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

BASE_DIR = os.path.dirname(__file__)
STATIC_DIR = os.path.join(BASE_DIR, "static")


# ============================================================================
# PYDANTIC SCHEMAS FOR REQUEST VALIDATION
# ============================================================================

class StationCreate(BaseModel):
    code: str = Field(..., example="MET-11")
    name: str = Field(..., example="Westside Junction")
    line_name: str = Field("Red Line", example="Red Line")
    zone: int = Field(1, ge=1, le=5)
    status: str = Field("Operational")
    daily_capacity: int = Field(50000, ge=1000)
    is_accessible: bool = Field(True)
    latitude: Optional[float] = Field(40.7128)
    longitude: Optional[float] = Field(-74.0060)
    opened_year: Optional[int] = Field(2022)


class StationUpdate(BaseModel):
    code: str
    name: str
    line_name: str
    zone: int
    status: str
    daily_capacity: int
    is_accessible: bool
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    opened_year: Optional[int] = None


class FaultCreate(BaseModel):
    station_id: int
    title: str
    component: str
    severity: str = Field("Warning", example="Warning")
    status: str = Field("Active", example="Active")
    description: Optional[str] = None


class FaultStatusUpdate(BaseModel):
    status: str = Field(..., example="Resolved")


class AssetCreate(BaseModel):
    station_id: int
    asset_name: str
    category: str = Field("Mechanical")
    health_score: int = Field(100, ge=0, le=100)
    status: str = Field("Good")
    notes: Optional[str] = None


# ============================================================================
# ROOT & SERVICE WORKER ROUTES (Must be at root scope for PWA offline control)
# ============================================================================

@app.get("/", include_in_schema=False)
async def serve_index():
    """Serves the single-page frontend application."""
    index_path = os.path.join(STATIC_DIR, "index.html")
    return FileResponse(index_path, media_type="text/html")


@app.get("/sw.js", include_in_schema=False)
async def serve_service_worker():
    """
    Serves the Service Worker at root scope so it can cache
    all static files and /api routes for offline use.
    """
    sw_path = os.path.join(STATIC_DIR, "sw.js")
    response = FileResponse(sw_path, media_type="application/javascript")
    response.headers["Service-Worker-Allowed"] = "/"
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response


# ============================================================================
# API: SYSTEM HEALTH & KPIS
# ============================================================================

@app.get("/api/health")
async def health_check():
    """Health check endpoint used by the frontend offline/online heartbeat."""
    return {
        "status": "healthy",
        "mode": "localhost_offline_ready",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/kpis")
async def get_dashboard_kpis():
    """Summary metrics for the dashboard KPI cards."""
    return db.get_kpis()


# ============================================================================
# API: STATIONS
# ============================================================================

@app.get("/api/stations")
async def list_stations(
    search: Optional[str] = None,
    line: Optional[str] = None,
    status: Optional[str] = None,
    accessible: Optional[bool] = None
):
    """Retrieve all stations with search, line, status, and accessibility filters."""
    return db.get_all_stations(search=search, line=line, status=status, accessible=accessible)


@app.get("/api/stations/{station_id}")
async def get_station_detail(station_id: int):
    """Retrieve full station details including linked assets, faults, buses, and ridership."""
    station = db.get_station_by_id(station_id)
    if not station:
        raise HTTPException(status_code=404, detail="Station not found")

    assets = db.get_assets_by_station(station_id)
    faults = db.get_all_faults(station_id=station_id)
    buses = db.get_bus_connections(station_id=station_id)
    recent_ridership = db.get_station_hourly_profile(station_id, hours=24)

    return {
        "station": station,
        "assets": assets,
        "faults": faults,
        "bus_connections": buses,
        "ridership_24h": recent_ridership
    }


@app.post("/api/stations", status_code=201)
async def create_station(payload: StationCreate):
    """Register a new metro station."""
    try:
        new_id = db.create_station(payload.model_dump())
        return {"id": new_id, "message": "Station created successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@app.put("/api/stations/{station_id}")
async def update_station(station_id: int, payload: StationUpdate):
    """Update existing station details."""
    success = db.update_station(station_id, payload.model_dump())
    if not success:
        raise HTTPException(status_code=404, detail="Station not found or update failed")
    return {"message": "Station updated successfully"}


@app.delete("/api/stations/{station_id}")
async def delete_station(station_id: int):
    """Delete station and cascaded entities."""
    success = db.delete_station(station_id)
    if not success:
        raise HTTPException(status_code=404, detail="Station not found")
    return {"message": "Station deleted successfully"}


# ============================================================================
# API: RIDERSHIP & CHARTS
# ============================================================================

@app.get("/api/ridership/hourly")
async def get_hourly_ridership(
    station_id: Optional[int] = None,
    hours: int = Query(24, ge=1, le=168)
):
    """Time-series hourly data for charts."""
    if station_id:
        return db.get_station_hourly_profile(station_id, hours=hours)
    return db.get_system_hourly_series(hours=hours)


@app.get("/api/ridership/by-line")
async def get_ridership_by_line():
    """Ridership totals grouped by metro line."""
    return db.get_ridership_by_line()


# ============================================================================
# API: ASSETS & MAINTENANCE
# ============================================================================

@app.get("/api/assets")
async def list_assets(status: Optional[str] = None):
    """Retrieve asset logs across all stations."""
    return db.get_all_assets(status=status)


@app.post("/api/assets", status_code=201)
async def create_asset_log(payload: AssetCreate):
    """Log an equipment maintenance or inspection record."""
    data = payload.model_dump()
    data["last_serviced"] = datetime.now().strftime("%Y-%m-%d")
    new_id = db.create_asset_log(data)
    return {"id": new_id, "message": "Asset logged successfully"}


# ============================================================================
# API: FAULTS & ALERTS
# ============================================================================

@app.get("/api/faults")
async def list_faults(
    status: Optional[str] = None,
    severity: Optional[str] = None,
    station_id: Optional[int] = None
):
    """Retrieve operational fault events and alerts."""
    return db.get_all_faults(status=status, severity=severity, station_id=station_id)


@app.post("/api/faults", status_code=201)
async def create_fault(payload: FaultCreate):
    """Report an incident or equipment malfunction."""
    data = payload.model_dump()
    data["reported_at"] = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    new_id = db.create_fault(data)
    return {"id": new_id, "message": "Fault reported successfully"}


@app.patch("/api/faults/{fault_id}/status")
async def update_fault_status(fault_id: int, payload: FaultStatusUpdate):
    """Update status of a fault event (e.g. Active -> Resolved)."""
    resolved_at = datetime.now().strftime("%Y-%m-%dT%H:%M:%S") if payload.status == "Resolved" else None
    success = db.update_fault_status(fault_id, payload.status, resolved_at=resolved_at)
    if not success:
        raise HTTPException(status_code=404, detail="Fault not found")
    return {"message": f"Fault status updated to {payload.status}"}


# ============================================================================
# API: BUS CONNECTIONS
# ============================================================================

@app.get("/api/bus-connections")
async def list_bus_connections(station_id: Optional[int] = None):
    """Retrieve feeder bus connections."""
    return db.get_bus_connections(station_id=station_id)


# ============================================================================
# API: ON-DEVICE AI CAPABILITIES
# ============================================================================

@app.post("/api/ai/anomalies/detect")
async def trigger_anomaly_detection(
    station_id: Optional[int] = None,
    sensitivity: float = Query(2.5, ge=1.5, le=4.5)
):
    """
    Triggers the pure-Python on-device anomaly detection engine.
    Detects passenger surges and drops using Modified Z-Scores with MAD.
    """
    return ai_engine.detect_ridership_anomalies(
        station_id=station_id,
        lookback_records=168,
        sensitivity_threshold=sensitivity,
        auto_persist_flags=True
    )


@app.get("/api/ai/forecast")
async def get_demand_forecast(
    station_id: Optional[int] = None,
    hours: int = Query(24, ge=6, le=48)
):
    """
    Triggers the pure-Python demand forecasting engine.
    Generates point predictions with 95% confidence intervals.
    """
    return ai_engine.forecast_hourly_demand(station_id=station_id, horizon_hours=hours)


# ============================================================================
# API: SEED DATA RE-TRIGGER
# ============================================================================

@app.post("/api/seed")
async def trigger_seed(hours: int = Query(168, ge=24, le=336)):
    """Re-seeds sample metro data directly from the UI."""
    summary = db.seed_metro_data(hours_history=hours)
    return {"message": "Database re-seeded successfully", "summary": summary}


# ============================================================================
# STATIC ASSETS MOUNT
# ============================================================================
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
