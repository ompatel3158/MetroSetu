# MetroSetu // મેટ્રો સેતુ (Transit Grievance Ops)

> **Gujarat Metro Hacks (DevFest Gandhinagar) — Problem Statement PS-07: "Every Complaint Heard"**  
> *An on-device, 100% offline-first multilingual grievance triage platform with dual-engine persistence (UltSQL + SQLite).*

[![GitHub](https://img.shields.io/badge/GitHub-MetroSetu-10b981?logo=github)](https://github.com/ompatel3158/MetroSetu)
[![Offline First](https://img.shields.io/badge/Architecture-100%25%20Offline-06b6d4)](#offline-first-architecture)
[![Python](https://img.shields.io/badge/Backend-FastAPI%20%2B%20Python-3b82f6)](#quickstart)
[![Languages](https://img.shields.io/badge/Languages-Gujarati%20%7C%20Hindi%20%7C%20Gujlish%20%7C%20English-8b5cf6)](#on-device-nlp-engine)

---

## 🚇 The Problem (PS-07: Every Complaint Heard)

On board the Gujarat Metro (Ahmedabad – Gandhinagar corridor), passenger complaints arrive through mobile apps, social media, QR portals, and paper forms written in **Gujarati (`ગુજરાતી`)**, **Hindi (`हिंदी`)**, **English**, and mixed **"Gujlish"** (phonetic Gujarati in English alphabet, e.g. *"Lift bandh che, vruddh loko atvayela che"*).

Manual sorting by urgency and department takes hours, and **station controllers working in underground tunnels or station control rooms frequently have zero network connectivity**. Urgent safety hazards and trapped passengers get buried under routine ticketing inquiries.

---

## 💡 The Solution: MetroSetu (મેટ્રો સેતુ)

**MetroSetu** is a zero-cloud-dependency, on-device operations console that:
1. **Detects Language & Script in <5ms**: Native Unicode script ranges + Gujlish phonetic token analysis.
2. **Prioritizes Urgency**: Automatic scoring from **P1 Critical (5)** (immediate safety hazard, trapped commuters) down to **P4 Low (1-2)** (routine queries) with plain-language diagnostic reasoning.
3. **Routes to 5 Department Queues**:
   - 🚨 **Safety** (fires, electrical sparks, platform overcrowding)
   - 🛗 **Lifts & Escalators** (trapped passengers, out-of-order escalators)
   - 🧹 **Cleanliness** (washrooms, platform trash, paan stains)
   - 🎫 **Fare & Ticketing** (UPI deduction failure, turnstile gates, TVM errors)
   - 👤 **Staff Behaviour** (counter conduct, shouting guards)
4. **Synthesizes Empathetic Draft Replies**: Produces polite, culturally tailored responses in the complainant's language with station context.
5. **Dual-Engine Graceful Fallback**: Probes **UltSQL** on startup; automatically falls back to embedded **SQLite** with zero downtime or config changes.
6. **100% Offline PWA**: Installable on phones and tablets ("Add to Home Screen"), backed by a Service Worker and offline action queue.

---

## 🚀 Quickstart: Exact Run Commands

### 1. Install Dependencies
```bash
pip install -r requirements.txt
```
*(Only `fastapi` and `uvicorn` required; all NLP and database engines run on Python standard library).*

### 2. Seed Realistic Gujarat Metro Data
Populates 10 Gujarat Metro stations, 1,680 hours of ridership telemetry, 80 assets, and **37 realistic multilingual complaints**:
```bash
python seed.py
```

### 3. Run the Automated Test Suite (100% Offline)
Verifies NLP accuracy across Gujarati, Hindi, Gujlish, and English, plus database CRUD and API endpoints:
```bash
python test_triage.py
```
*(Expected output: `NLP Accuracy: 17/17 (100.0%) - ALL TESTS PASSED`)*

### 4. Launch the Localhost Operations Server
```bash
python -m uvicorn main:app --reload --port 8000
```

### 5. Open in Your Browser
- **Operations Console**: `http://localhost:8000/#triage`
- **Full Dashboard**: `http://localhost:8000/#dashboard`
- **Mobile Access**: Open `http://<laptop-ip>:8000` from any smartphone connected to your local hotspot.

---

## 🎪 Live Judge Demo Script (2 Minutes on the Train)

When presenting to judges on board the Gujarat Metro:

1. **Turn OFF Wi-Fi / Hotspot** on your laptop to prove 100% offline functionality.
2. Navigate to `http://localhost:8000/#triage`.
3. In the **Test Batch Simulator Drawer** at the top, click any of the 1-click test buttons:
   - 🇬🇯 **Gujarati**: *"લિફ્ટ બંધ છે અને વરિષ્ઠ નાગરિકો ફસાયા છે!"* &rarr; Instant **P1 Critical &rarr; Lifts & Escalators**.
   - 🔤 **Gujlish**: *"Water leakage chhe Kalupur station par, loko slip thavay che"* &rarr; Instant **P1 Critical &rarr; Safety**.
   - 🇮🇳 **Hindi**: *"TVM मशीन में ₹100 कट गए पर टिकट नहीं आया"* &rarr; Instant **P2 High &rarr; Fare & Ticketing**.
   - 🇬🇧 **English**: *"Platform screen door failed to open at Motera"* &rarr; Instant **P2 High &rarr; Lifts & Escalators**.
4. Click on the newly triaged card:
   - Observe the **Urgency Score Meter (100/100)** and **SLA target (<15 min)**.
   - Inspect the **On-Device AI Diagnostic Reasoning**.
   - Review the **Auto-Drafted Response** in the passenger's language.
5. Click **"Dispatch Reply & Resolve"**:
   - The ticket updates instantly to `Resolved`.
   - If offline, the mutation is queued in `localStorage` and automatically syncs when the server reconnects!

---

## 🏗️ Architecture

```
b:\temp\
├── main.py                 # FastAPI backend, REST API endpoints, PWA router
├── db.py                   # Single DB abstraction: UltSQL probe + SQLite fallback
├── ai_engine.py            # Pure Python on-device Multilingual NLP Engine
├── seed.py                 # Seeder CLI (stations, telemetry, multilingual complaints)
├── test_triage.py          # Integration test runner (100% NLP test coverage)
├── requirements.txt        # fastapi, uvicorn
├── .gitignore              # Clean git tracking
└── static/
    ├── index.html          # Single-Page UI (Dashboard, Stations, Triage Console, Alerts)
    ├── manifest.json       # PWA Web Manifest (installable mobile app)
    ├── sw.js               # Service Worker (pre-cached app shell & API fallback)
    ├── icon-192.svg        # 192x192 transit icon
    ├── icon-512.svg        # 512x512 transit icon
    ├── css/
    │   └── app.css         # Modern dark-slate UI, neon urgency badges, system fonts
    └── js/
        ├── chart.min.js    # Locally bundled Chart.js 4.4.7 (zero CDN)
        └── app.js          # Client router, triage console, offline sync queue
```

---

## 🧠 On-Device NLP Engine Details

### Language & Script Detection
- **Gujarati (`\u0A80` - `\u0AFF`)**: Detected via character frequency ratio ($\ge 12\%$).
- **Hindi (`\u0900` - `\u097F`)**: Detected via Devanagari character frequency ratio ($\ge 12\%$).
- **Gujlish**: Detected via phonetic transliteration token matching (`che`, `chhe`, `nathi`, `chokhkhaai`, `bhaadu`, `bandh`, `atvayela`, `fasayela`, `kem`, `karvanu`, `dhuvado`, `jokham`, etc.).
- **English**: Standard Latin text syntax.

### Urgency Matrix
- **P1 Critical (Score 5)**: Life safety hazards, fire, smoke, electric shock, trapped passengers in lifts. SLA: Immediate (<15 mins).
- **P2 High (Score 4)**: Escalator outages affecting disabled/elderly passengers, active water leakage, physical intimidation. SLA: <1 hour.
- **P3 Medium (Score 3)**: Restroom sanitation, TVM currency deduction failure, turnstile gate malfunction. SLA: <4 hours.
- **P4 Low (Score 1-2)**: Timetable questions, lost item inquiries, general feedback. SLA: <24 hours.

---

## 📦 Dual Database Support

[`db.py`](file:///b:/temp/db.py) implements transparent dual-engine persistence:
1. **UltSQL**: When the Dart-based UltSQL daemon is active on `http://localhost:8080`, queries route to UltSQL.
2. **SQLite (`metro.db`)**: If the UltSQL daemon is offline or unreachable, `db.py` seamlessly executes against local SQLite with zero errors or downtime.

---

## 👥 Hackathon Team
Built for **Metro Hacks @ DevFest Gandhinagar** by Om Patel.
Repository: [https://github.com/ompatel3158/MetroSetu.git](https://github.com/ompatel3158/MetroSetu.git)
