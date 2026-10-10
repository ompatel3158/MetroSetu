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


class ComplaintTriageRequest(BaseModel):
    raw_text: str = Field(..., example="લિફ્ટ બંધ છે અને વૃદ્ધ મુસાફરો ફસાયા છે")
    station_name: Optional[str] = Field("", example="Motera Stadium")
    passenger_name: Optional[str] = Field("Passenger", example="Jayesh Patel")
    complaint_id: Optional[int] = None


class ComplaintCreate(BaseModel):
    station_id: Optional[int] = None
    passenger_name: Optional[str] = "Anonymous Passenger"
    channel: Optional[str] = "WhatsApp"
    raw_text: str
    department: Optional[str] = None
    urgency_level: Optional[str] = None
    urgency_score: Optional[int] = None
    urgency_reason: Optional[str] = None
    detected_language: Optional[str] = None
    draft_reply: Optional[str] = None
    status: Optional[str] = "Open"
    reported_at: Optional[str] = None
    resolved_at: Optional[str] = None


class ComplaintStatusUpdate(BaseModel):
    status: str = Field(..., example="Resolved")
    draft_reply: Optional[str] = None
    resolution_notes: Optional[str] = None


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


@app.get("/manifest.json", include_in_schema=False)
async def serve_manifest():
    """Serves the PWA Web App Manifest."""
    manifest_path = os.path.join(STATIC_DIR, "manifest.json")
    return FileResponse(manifest_path, media_type="application/manifest+json")


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
# API: PASSENGER COMPLAINTS & MULTILINGUAL TRIAGE (PS-07)
# ============================================================================

@app.get("/api/complaints")
async def list_complaints(
    station_id: Optional[int] = None,
    status: Optional[str] = None,
    department: Optional[str] = None,
    urgency_level: Optional[str] = None,
    language: Optional[str] = None,
    search: Optional[str] = None,
    limit: int = 100,
    offset: int = 0
):
    """Retrieve passenger complaints with multi-field filtering and keyword search."""
    complaints = db.get_complaints(
        station_id=station_id,
        status=status,
        department=department,
        urgency_level=urgency_level,
        language=language,
        limit=limit,
        offset=offset
    )
    if search:
        s_lower = search.lower()
        complaints = [
            c for c in complaints
            if s_lower in c.get("raw_text", "").lower()
            or s_lower in c.get("passenger_name", "").lower()
            or s_lower in c.get("station_name", "").lower()
            or s_lower in c.get("department", "").lower()
            or s_lower in str(c.get("id", "")).lower()
        ]
    return complaints


@app.get("/api/complaints/kpis")
async def get_complaints_kpis():
    """Summary metrics, SLA resolution rates, and department triage distribution."""
    return db.get_complaint_kpis()


@app.get("/api/complaints/{complaint_id}")
async def get_complaint_detail(complaint_id: int):
    """Retrieve full details of a single passenger complaint."""
    complaint = db.get_complaint_by_id(complaint_id)
    if not complaint:
        raise HTTPException(status_code=404, detail="Complaint not found")
    return complaint


@app.post("/api/complaints/triage")
async def triage_complaint_endpoint(payload: ComplaintTriageRequest):
    """
    On-device multilingual NLP triage for raw complaint text:
    Detects script and language (Gujarati, Hindi, Gujlish, English),
    classifies target transit department, scores urgency (P1 Critical to P4 Low),
    and synthesizes an empathetic official draft response.
    """
    result = ai_engine.triage_complaint(
        text=payload.raw_text,
        station_name=payload.station_name or "",
        passenger_name=payload.passenger_name or "Passenger",
        complaint_id=payload.complaint_id
    )
    return result


@app.post("/api/complaints", status_code=201)
async def create_new_complaint(payload: ComplaintCreate):
    """
    Submits a new grievance.
    Automatically runs on-device multilingual triage (language detection,
    department classification, urgency scoring, and draft response generation).
    """
    station_name = "Gujarat Metro"
    if payload.station_id:
        st = db.get_station_by_id(payload.station_id)
        if st:
            station_name = st["name"]

    triage_res = ai_engine.triage_complaint(
        text=payload.raw_text,
        passenger_name=payload.passenger_name or "Passenger",
        station_name=station_name
    )

    dept = payload.department or triage_res.get("department")
    urgency_level = payload.urgency_level or triage_res.get("urgency_level")
    urgency_score = payload.urgency_score or triage_res.get("urgency_score")
    urgency_reason = payload.urgency_reason or triage_res.get("urgency_reason")
    detected_language = payload.detected_language or triage_res.get("detected_language")
    draft_reply = payload.draft_reply or triage_res.get("draft_reply", "")

    data = {
        "station_id": payload.station_id or 1,
        "passenger_name": payload.passenger_name or "Anonymous Passenger",
        "channel": payload.channel or "WhatsApp",
        "raw_text": payload.raw_text,
        "detected_language": detected_language,
        "department": dept,
        "urgency_score": urgency_score,
        "urgency_level": urgency_level,
        "urgency_reason": urgency_reason,
        "draft_reply": draft_reply,
        "status": payload.status or "Open",
        "reported_at": payload.reported_at or datetime.now().strftime("%Y-%m-%dT%H:%M:%S"),
        "resolved_at": payload.resolved_at,
        "synced": 1
    }
    new_id = db.create_complaint(data)
    created = db.get_complaint_by_id(new_id)
    return {"id": new_id, "complaint": created, "message": "Grievance registered and triaged"}


@app.post("/api/complaints/batch", status_code=201)
async def create_complaints_batch(payload: Any = Body(...)):
    """
    Batch ingests complaints, runs pure-Python NLP triage for each,
    and bulk-persists them to the database.
    """
    items = []
    if isinstance(payload, list):
        items = payload
    elif isinstance(payload, dict) and "complaints" in payload:
        items = payload["complaints"]
    elif isinstance(payload, dict):
        items = [payload]

    batch_to_insert = []
    now_iso = datetime.now().strftime("%Y-%m-%dT%H:%M:%S")

    for item in items:
        raw_text = item.get("raw_text") or item.get("complaint_text") or ""
        p_name = item.get("passenger_name", "Anonymous Passenger")
        st_id = item.get("station_id") or 1
        st = db.get_station_by_id(st_id)
        st_name = st["name"] if st else "Gujarat Metro"

        triage_res = ai_engine.triage_complaint(
            text=raw_text,
            passenger_name=p_name,
            station_name=st_name
        )

        dept = item.get("department") or triage_res.get("department")
        urg_lvl = item.get("urgency_level") or triage_res.get("urgency_level")
        urg_score = item.get("urgency_score") or triage_res.get("urgency_score")
        urg_reason = item.get("urgency_reason") or triage_res.get("urgency_reason")
        lang = item.get("detected_language") or triage_res.get("detected_language")
        draft = item.get("draft_reply") or triage_res.get("draft_reply", "")

        batch_to_insert.append({
            "station_id": st_id,
            "passenger_name": p_name,
            "channel": item.get("channel", "WhatsApp"),
            "raw_text": raw_text,
            "detected_language": lang,
            "department": dept,
            "urgency_score": urg_score,
            "urgency_level": urg_lvl,
            "urgency_reason": urg_reason,
            "draft_reply": draft,
            "status": item.get("status", "Open"),
            "reported_at": item.get("reported_at") or now_iso,
            "resolved_at": item.get("resolved_at"),
            "synced": 1
        })

    inserted_count = db.bulk_create_complaints(batch_to_insert)

    return {
        "status": "success",
        "count": inserted_count,
        "message": f"Successfully triaged and ingested {inserted_count} complaints"
    }


@app.patch("/api/complaints/{complaint_id}/status")
async def update_complaint_status_endpoint(complaint_id: int, payload: ComplaintStatusUpdate):
    """
    Updates complaint status (e.g. Open -> In Progress -> Resolved) and records resolution timestamp.
    """
    resolved_at = datetime.now().strftime("%Y-%m-%dT%H:%M:%S") if payload.status == "Resolved" else None
    success = db.update_complaint_status(complaint_id, payload.status, resolved_at=resolved_at)
    if not success:
        raise HTTPException(status_code=404, detail="Complaint not found")
    updated = db.get_complaint_by_id(complaint_id)
    return {
        "message": f"Complaint status updated to {payload.status}",
        "complaint": updated
    }


# ============================================================================
# API: DATABASE ENGINE TELEMETRY
# ============================================================================

@app.get("/api/db/engine")
async def get_database_engine():
    """Returns active database engine telemetry (UltSQL probe status + SQLite fallback)."""
    return db.get_active_db_engine()


# ============================================================================
# STATIC ASSETS MOUNT
# ============================================================================
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
