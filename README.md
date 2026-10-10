# MetroSetu // મેટ્રો સેતુ (Transit Grievance Ops)

> **Gujarat Metro Hacks (DevFest Gandhinagar) — Problem Statement PS-07: "Every Complaint Heard"**  
> *100% Offline-First Multilingual Passenger Grievance Triage with Dual-Engine Persistence (UltSQL + SQLite).*

[![GitHub](https://img.shields.io/badge/GitHub-ompatel3158%2FMetroSetu-10b981?logo=github)](https://github.com/ompatel3158/MetroSetu.git)
[![Offline First](https://img.shields.io/badge/Architecture-100%25%20Offline-06b6d4)](#offline-first-architecture)
[![Python](https://img.shields.io/badge/Backend-FastAPI%203.10%2B-3b82f6)](#quickstart-setup-guide)
[![NLP Engine](https://img.shields.io/badge/NLP-Pure%20Python%20%280%20APIs%29-8b5cf6)](#on-device-nlp-engine)
[![Languages](https://img.shields.io/badge/Languages-Gujarati%20%7C%20Hindi%20%7C%20Gujlish%20%7C%20English-f59e0b)](#language-and-script-coverage)

---

## 📑 Table of Contents
1. [The Problem Statement (PS-07)](#-the-problem-statement-ps-07)
2. [What is MetroSetu?](#-what-is-metrosetu)
3. [Quickstart Setup Guide (Zero to Running in 2 Minutes)](#-quickstart-setup-guide)
4. [Step-by-Step Environment Setup](#-step-by-step-environment-setup)
5. [Running from a Mobile Phone on the Train](#-running-from-a-mobile-phone-on-the-train)
6. [PWA Installation ("Add to Home Screen")](#-pwa-installation-add-to-home-screen)
7. [On-Device NLP Engine Architecture](#-on-device-nlp-engine-architecture)
8. [Dual Database Architecture (UltSQL + SQLite Fallback)](#-dual-database-architecture)
9. [Universal UltSQL Installation & Setup Guide](#-universal-ultsql-installation--setup-guide)
10. [Role-Based Access Control (Passenger vs. Staff vs. Admin)](#-role-based-access-control-passenger-public-mode-vs-gmrc-officials--admin)
11. [Automated Test Suite & Verification](#-automated-test-suite--verification)
12. [Live 2-Minute Judge Demonstration Script](#-live-2-minute-judge-demonstration-script)
13. [Project Structure](#-project-structure)
14. [Git Workflow & Repository](#-git-workflow--repository)

---

## 🚇 The Problem Statement (PS-07)

On board the **Gujarat Metro (Ahmedabad – Gandhinagar)**, passenger grievances arrive through mobile applications, email, paper forms, and social media written in **Gujarati (`ગુજરાતી`)**, **Hindi (`हिंदी`)**, **English**, and mixed **"Gujlish"** (phonetic transliterated Gujarati in Latin alphabet, e.g. *"Lift bandh che Kalupur par, senior citizen atvayela che"*).

### Critical Hackathon Constraints:
- **Zero Network in Tunnels**: The hackathon takes place on an active moving train. In underground tunnels and remote track sectors, network coverage drops to zero.
- **Urgent Issues Get Buried**: Critical safety hazards (fires, live wires, trapped passengers) get mixed in with routine timetable inquiries.
- **Station Controller Pain Point**: Station controllers in underground equipment rooms need to triage, prioritize, and respond to grievances **without internet access**.

---

## 💡 What is MetroSetu?

**MetroSetu (મેટ્રો સેતુ)** is a zero-cloud-dependency, on-device operations console built for station controllers and transit supervisors:

- **⚡ Sub-5ms Language & Script Classification**: Detects Gujarati, Hindi, English, and Gujlish locally using Unicode ranges and phonetic tokens.
- **🚨 Automated Urgency Matrix**: Categorizes complaints into **P1 Critical (5)** (<15 min SLA), **P2 High (4)** (<1 hour SLA), **P3 Medium (3)** (<4 hour SLA), and **P4 Low (1-2)** (<24 hour SLA) with plain-English diagnostic reasoning.
- **🏢 5 Department Routing Queues**:
  1. 🚨 **Safety & Security** (fire, electrical sparks, medical emergencies, assault)
  2. 🛗 **Lifts & Escalators** (trapped passengers, broken escalators, wheelchair access)
  3. 🧹 **Cleanliness & Sanitation** (restrooms, paan stains, garbage, water leaks)
  4. 🎫 **Fare & Ticketing** (UPI deduction failure, turnstile gates, TVM errors)
  5. 👤 **Staff Behaviour** (counter conduct, shouting guards, overcharging)
- **✍️ Multilingual Empathetic Draft Replies**: Synthesizes polite, official replies in the passenger’s language with station context.
- **🎨 Gujarat Metro Saffron/Orange & White UI**: Designed with official Gujarat Metro brand colors (`#ea580c` / `#f97316` / `#ffffff`) eliminating dark blue hues.
- **☀️/🌙 Instant Light & Dark Mode**: High-contrast operations mode for daytime station booths + sleek dark mode for dimly lit tunnel cabins.
- **📱 Fully Mobile Responsive & Hamburger Navigation**: Touch-friendly navigation drawer, adaptive KPI cards, and thumb-friendly resolution actions on smartphones.
- **🔄 Two-Way Connectivity Sync**: Offline queue in `localStorage` captures resolutions and grievances created in tunnels; auto-synchronizes atomically via `POST /api/sync` once line connectivity or station Wi-Fi is restored (with manual "Sync Now" button).
- **💾 Dual-Engine Persistence**: Connects to high-speed **UltSQL** when available, with automatic and silent fallback to embedded **SQLite (`metro.db`)**.
- **📱 100% Offline PWA**: Installable standalone mobile app with local action queueing and sync when connectivity returns.

---

## ⚡ Quickstart Setup Guide

If you just want to run the project immediately:

```bash
# 1. Clone the repository
git clone https://github.com/ompatel3158/MetroSetu.git
cd MetroSetu

# 2. Install dependencies (only FastAPI & Uvicorn needed)
pip install -r requirements.txt

# 3. Seed realistic Gujarat Metro stations and 37 multilingual complaints
python seed.py

# 4. Run the automated verification suite (100% offline)
python test_triage.py

# 5. Launch the local server
python -m uvicorn main:app --reload --port 8000
```

Open your browser to: **`http://localhost:8000`**

### 🔐 Default Admin & Government Official Login Credentials

By default, MetroSetu opens in **Public Passenger Mode (Zero Login Required)** so any commuter can report a problem immediately via **`🚨 Report`** / **`#passenger`**.
To access **GMRC Operations, Grievance Triage, Add/Edit Stations, or Manage Staff**, click **`🏛️ Login`** in the top navbar and use these pre-seeded credentials (or click the 1-tap auto-fill buttons inside the login modal):

| Account Type | Username | Password | Assigned Role & Access Level |
| :--- | :--- | :--- | :--- |
| **🛡️ Chief Operations Admin** | `admin` | `admin123` | **Full Admin Access**: Dashboard, Grievance Triage, Alerts, **`+ Station`** (Add/Edit/Delete Stations), **`Staff`** (Add/Delete Government Staff Accounts), and **`Re-seed`**. |
| **👮 Station Controller** | `controller` | `metro123` | **Government Staff Access**: Operations Dashboard, Multilingual Grievance Triage Console (All Queues), and AI Alerts. |
| **🚨 Chief Safety Officer** | `safety_officer` | `metro123` | **Government Staff Access**: Safety & Security Department Queue, Triage Console, and AI Alerts. |
| **🛗 Mechanical Engineer** | `lifts_eng` | `metro123` | **Government Staff Access**: Lifts & Escalators Department Queue, Triage Console, and AI Alerts. |

---

## 🛠️ Step-by-Step Environment Setup

### Prerequisites
- Python **3.10 or newer** (tested and verified on Python 3.14).
- Modern web browser (Chrome, Edge, Firefox, Safari).
- Git.

### 1. Create a Python Virtual Environment (Recommended)

#### Windows (PowerShell):
```powershell
python -m venv venv
.\venv\Scripts\Activate.ps1
```

#### Linux / macOS:
```bash
python3 -m venv venv
source venv/bin/activate
```

### 2. Install Dependencies
```bash
pip install -r requirements.txt
```
*Contents of `requirements.txt`:*
```
fastapi>=0.110.0
uvicorn>=0.28.0
```
*(Notice: Zero heavy ML frameworks like PyTorch or TensorFlow, and zero external cloud SDKs. All NLP and database operations use the Python Standard Library).*

### 3. Initialize & Seed the Database
```bash
python seed.py
```
This script creates `metro.db` with:
- **10 Gujarat Metro Stations**: Motera Stadium, Kalupur Railway Station, APMC, Gandhinagar Capital, Old High Court Interchange, Thaltej, Gujarat University, Infocity Gandhinagar, Kankaria East, Sabarmati.
- **1,680 Hours of Ridership Telemetry**: 7 days of realistic passenger commute curves with synthetic rush-hour anomalies.
- **80 Equipment Assets**: Escalators, elevators, signaling relays, transformers, and turnstiles with health scores.
- **7 Fault Events**: Historical and active infrastructure incidents.
- **12 Feeder Bus Routes**: Connecting stations to nearby business and academic hubs.
- **37 Multilingual Complaints**: Real-world grievances in Gujarati, Hindi, English, and Gujlish across all 5 departments.

### 4. Start the Application Server
```bash
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
- Access locally: `http://localhost:8000`
- Access on local network: `http://<your-ip>:8000`

---

## 📱 Running from a Mobile Phone on the Train

During the hackathon ride on the metro train, you can use your laptop as a local server and access the full UI from smartphones without an internet connection:

1. **Turn on Mobile Hotspot** on your phone (or create a local ad-hoc Wi-Fi network). Connect your laptop to this hotspot.
   *(Internet access is NOT required; only local Wi-Fi communication).*
2. **Find your Laptop's Local IP Address**:
   - **Windows**: Run `ipconfig` in PowerShell and look for `IPv4 Address` (e.g. `192.168.43.120`).
   - **Linux / Mac**: Run `ifconfig` or `ip a` (e.g. `192.168.1.50`).
3. **Start Uvicorn with `--host 0.0.0.0`**:
   ```bash
   python -m uvicorn main:app --host 0.0.0.0 --port 8000
   ```
4. **Open the Browser on Any Phone**:
   Navigate to `http://192.168.43.120:8000/#triage`.
5. The full MetroSetu console loads instantly on the phone!

---

## 📲 PWA Installation ("Add to Home Screen")

MetroSetu includes a Web App Manifest ([`static/manifest.json`](file:///b:/temp/static/manifest.json)) and a Service Worker ([`static/sw.js`](file:///b:/temp/static/sw.js)):

1. Open `http://localhost:8000` (or `http://<ip>:8000`) in Chrome or Safari.
2. In Chrome: Click the **Install** icon in the address bar (or Menu &rarr; **Add to Home screen**).
3. In Safari (iOS): Tap the **Share** button &rarr; **Add to Home Screen**.
4. MetroSetu launches as a **standalone native app** without browser address bars, complete with offline icons and launch shortcuts.

---

## 🧠 On-Device NLP Engine Architecture

The NLP engine ([`ai_engine.py`](file:///b:/temp/ai_engine.py)) runs 100% locally in Python without any external API keys or models:

### 1. Language & Script Coverage
- **Gujarati (`ગુજરાતી`)**: Evaluates characters within the Unicode block `U+0A80` through `U+0AFF`.
- **Hindi (`हिंदी`)**: Evaluates characters within the Devanagari block `U+0900` through `U+097F`.
- **Gujlish**: Evaluates Latin text for phonetic Gujarati tokens (`che`, `chhe`, `nathi`, `chokhkhaai`, `bhaadu`, `bandh`, `atvayela`, `fasayela`, `kem`, `karvanu`, `dhuvado`, `jokham`, `loko`, `paisa`).
- **English**: Standard Latin transit lexicon.

### 2. Department Keyword Matrices
- **Safety**: `fire`, `smoke`, `wire`, `shock`, `spark`, `blood`, `fight`, `theft`, `chori`, `maar`, `aag`, `dhuvado`, `dhakka`, `emergency`.
- **Lifts & Escalators**: `lift`, `elevator`, `escalator`, `stuck`, `broken`, `wheelchair`, `ramp`, `atvayela`, `fasayela`, `pagathiya`, `bandh`.
- **Cleanliness**: `dirty`, `smell`, `garbage`, `toilet`, `washroom`, `kachro`, `badbu`, `gandki`, `chokhkhaai`, `paan`, `spit`.
- **Fare & Ticketing**: `ticket`, `token`, `fare`, `bhaadu`, `upi`, `qr`, `deducted`, `refund`, `gate`, `turnstile`, `tvm`, `paisa`.
- **Staff Behaviour**: `staff`, `rude`, `guard`, `shout`, `misbehave`, `badtameezi`, `gussa`, `counter`.

### 3. Urgency Scoring Algorithm
```python
# ai_engine.py logic
if has_life_safety_hazard or trapped_in_lift:
    score = 5  # P1 Critical (SLA: < 15 mins)
elif accessibility_block or aggressive_behavior:
    score = 4  # P2 High (SLA: < 1 hour)
elif sanitation_failure or fare_deduction_error:
    score = 3  # P3 Medium (SLA: < 4 hours)
else:
    score = 1 or 2  # P4 Low (SLA: < 24 hours)
```

---

## 💾 Dual Database Architecture

All database queries are strictly routed through [`db.py`](file:///b:/temp/db.py). Neither [`main.py`](file:///b:/temp/main.py) nor [`ai_engine.py`](file:///b:/temp/ai_engine.py) import `sqlite3` or run raw SQL.

```mermaid
flowchart LR
    A["FastAPI Routes (main.py)"] --> B["Database Abstraction Layer (db.py)"]
    B --> C{"UltSQL Probe (localhost:8080)"}
    C -->|Daemon Running| D["UltSQL High-Speed Multimodal Engine"]
    C -->|Daemon Offline / Error| E["Embedded SQLite Engine (metro.db)"]
```

### Automatic Fallback Behavior:
1. On startup or first query, `db.py` checks `http://localhost:8080/health`.
2. **If UltSQL is running**: Queries use UltSQL for high-speed persistence.
3. **If UltSQL is offline**: `db.py` silently falls back to SQLite (`metro.db`) with zero downtime.
4. You can check the active database engine at any time:
   ```bash
   curl http://localhost:8000/api/db/engine
   ```
   *Response:* `{"engine": "SQLite", "status": "active", "fallback": true, ...}`

---

## ⚡ Universal UltSQL Installation & Setup Guide

**ULTSQL** ([github.com/ompatel3158/ULTSQL](https://github.com/ompatel3158/ULTSQL) | [pub.dev/packages/ultsql](https://pub.dev/packages/ultsql) | [ultsql.tech](https://ultsql.tech)) is a **5-in-1 converged multimodal database engine** written in 100% pure Dart with **zero native C/C++ dependencies**. It unites **Relational SQL**, **MongoDB-Style NoSQL Document Collections**, **Redis-Style High-Throughput Key-Value Caching** (`1.28M ops/sec`), **PL/SQL Procedural Scripting**, and **AI-Native HNSW Vector RAG Search** (`<6 ms`) into a single ACID storage engine (`2.08M rows/sec` durable NVMe ingestion).

### 🌍 Universal Installation for All Languages & Operating Systems

```mermaid
graph TD
    subgraph "Your Application (Any System)"
        Py[🐍 Python]
        Node[🟢 Node.js / TS]
        Dart[💙 Flutter / Dart]
        CLI[🖥️ Windows / Mac / Linux Executable]
        Docker[🐳 Docker Container]
    end

    subgraph "Package Registries"
        PyPI[PyPI: pip install ultsql]
        NPM[NPM: npm install ultsql]
        Pub[Pub.dev: package:ultsql]
        Releases[GitHub Releases: ultsql.exe]
        Hub[Docker Hub: docker run]
    end

    Py --> PyPI
    Node --> NPM
    Dart --> Pub
    CLI --> Releases
    Docker --> Hub
```

#### 1. 🖥️ 1-Line Standalone CLI Installers (Windows, macOS, Linux)
**Zero Dependencies! Automatically downloads the standalone binary and adds `ultsql` to your system PATH:**

- **Windows (PowerShell)**:
  ```powershell
  iwr -useb https://raw.githubusercontent.com/ompatel3158/ULTSQL/main/install.ps1 | iex
  ```
- **Linux & macOS (Bash)**:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/ompatel3158/ULTSQL/main/install.sh | bash
  ```
- **Pre-Bundled Offline Binary in this Repo (Windows)**:
  This repository also includes `ultsql.exe` right in the root folder for 100% offline tunnel execution:
  ```powershell
  .\ultsql.exe serve --port=8080 --pgwire=5432 --db=./metro_ultsql_db
  ```

#### 2. 🐍 Python Developers (Used by MetroSetu `db.py`)
**No Dart or Flutter required!**
```bash
pip install ultsql
```
```python
from ultsql import UltSQLClient

db = UltSQLClient("http://localhost:8080")
db.insert("complaints", {"id": 1, "passenger_name": "Jayesh Patel", "urgency_level": "P1 Critical"})
print(db.query("complaints"))
```

#### 3. 💙 Building & Running UltSQL from Source (Dart / Flutter SDK)
If you have [Dart SDK 3.4+](https://dart.dev) or [Flutter SDK 3.22+](https://flutter.dev) installed:
```bash
# 1. Clone the official ULTSQL repository
git clone https://github.com/ompatel3158/ULTSQL.git
cd ULTSQL

# 2. Install pure-Dart dependencies
dart pub get

# 3. Run the interactive CLI REPL or start the HTTP + PGWire server
dart run bin/ultsql_cli.dart serve --port=8080 --pgwire=5432 --db=./metro_ultsql_db

# 4. (Optional) Compile a standalone zero-dependency native executable
dart compile exe bin/ultsql_cli.dart -o ultsql.exe
```

#### 4. 🟢 Node.js & TypeScript Developers
```bash
npm install ultsql
```
```javascript
const { UltSQLClient } = require('ultsql');
const db = new UltSQLClient({ host: 'localhost', port: 8080 });
await db.insert('users', { id: 1, name: 'Alice' });
console.log(await db.query('users'));
```

#### 5. 🐹 Go & 🦀 Rust & 💻 C/C++ Developers
- **Go**:
  ```bash
  go get github.com/ompatel3158/ULTSQL/bindings/go
  ```
- **Rust (`Cargo.toml`)**:
  ```toml
  [dependencies]
  ultsql = "1.0.24"
  ```
- **C / C++ (`CMakeLists.txt`)**:
  ```cmake
  include(FetchContent)
  FetchContent_Declare(ultsql GIT_REPOSITORY https://github.com/ompatel3158/ULTSQL.git GIT_TAG v1.0.24)
  FetchContent_MakeAvailable(ultsql)
  target_link_libraries(my_app PRIVATE ultsql)
  ```

#### 6. 🐳 Docker Container & 🔌 PostgreSQL Wire Protocol
```bash
# Run UltSQL Server via Docker
docker run -p 8080:8080 -v ./data:/db ompatel3158/ultsql serve --port 8080 --db /db

# Or start the PostgreSQL v3 Wire Server (compatible with psql, psycopg2, JDBC, DBeaver)
ultsql pgwire --port=5432 --db=./metro_ultsql_db
```

---

### 🖥️ UltSQL CLI Subcommands & REPL Reference

Once installed (`ultsql` or `.\ultsql.exe`), you can run these commands from any terminal:

```bash
ultsql metro_ultsql_db                                       # Interactive REPL with auto-completion
ultsql bench 1000000                                         # Live 1M-row disk ingestion benchmark (2.08M rows/sec)
ultsql metro_ultsql_db -c "SELECT * FROM complaints;" -m box # Headless query (modes: box, table, json, csv, markdown, line)
ultsql export complaints complaints.json --db=./metro_ultsql_db  # Streaming table export to CSV or JSON
ultsql import data.json complaints --db=./metro_ultsql_db        # High-speed batch import from CSV or JSON
ultsql serve --port=8080 --pgwire=5432 --db=./metro_ultsql_db    # Combined REST API (:8080) & PostgreSQL wire daemon (:5432)
```

| REPL Meta Command | Description |
| :--- | :--- |
| `.tables` / `.schema [table]` | List all relational tables or inspect `CREATE TABLE` DDL and Row/Columnar layout. |
| `.collections` | List all schema-less NoSQL document collections and document counts. |
| `.kv [list\|get\|set\|del]` | Interactive Redis-style Key-Value operations with prefix matching and TTL. |
| `db.<coll>.<action>(...)` | Direct MongoDB shell syntax (`find`, `insertOne`, `updateOne`, `count`). |
| `.branch [list\|create\|switch\|merge]` | Git-like Copy-on-Write database branching for zero-risk testing & staging. |
| `.explain <sql>` | Render the Volcano query iterator execution plan tree. |

### 🔗 Verifying UltSQL Connection in MetroSetu
With the UltSQL daemon running (`.\ultsql.exe serve --port=8080 --db=./ultsql_data`):
```bash
curl http://localhost:8080/health
curl http://localhost:8000/api/db/engine
```
*Expected output:*
```json
{
  "engine": "UltSQL",
  "status": "connected",
  "url": "http://localhost:8080",
  "fallback": false,
  "mode": "converged_sql_vector"
}
```
> **100% Resilient Fallback**: If `ultsql.exe` is stopped or not running, [`db.py`](file:///b:/temp/db.py) automatically and silently falls back to embedded **SQLite (`metro.db`)** so the app never crashes during an offline tunnel ride!

---

## 🔐 Role-Based Access Control (Passenger Public Mode vs. GMRC Officials & Admin)

MetroSetu separates **public commuter features (no login required)** from **internal Government / GMRC Operations & Admin tools**:

| Role / Mode | Sign-In Required? | Accessible Features | Default Demo Credentials |
| :--- | :--- | :--- | :--- |
| **👤 Normal Passenger (Public Commuter)** | **No Sign-In Needed** | • Prominent **`🚨 Report`** quick button in navbar<br>• **Public Passenger Helpdesk (`#passenger`)**: Submit complaints in Gujarati, Hindi, Gujlish, or English with instant AI routing & ticket ID<br>• **Live Station Status (`#stations`)**: View station accessibility, lines, and feeder buses (read-only; cannot add/edit/delete stations) | *Public (No Login Required)* |
| **👮 GMRC Station Staff / Controller** | **Yes (`🏛️ Login`)** | • Everything in Public Mode, PLUS:<br>• **System Operations Dashboard (`#dashboard`)**<br>• **Multilingual Grievance Triage Console (`#triage`)** with trilingual reply dispatch<br>• **Alerts & On-Device AI Diagnostics (`#alerts`)** & fault logging | • `controller` / `metro123` *(All Depts)*<br>• `safety_officer` / `metro123` *(Safety)*<br>• `lifts_eng` / `metro123` *(Lifts & Escalators)* |
| **🛡️ GMRC Chief Admin** | **Yes (`🏛️ Login`)** | • Everything in Staff Mode, PLUS:<br>• **`Staff` (`#staff`)**: Create new government staff/official accounts, assign stations & departments, and revoke accounts<br>• **`+ Station` (`#station-form`)**, Edit/Delete stations, and **`Re-seed`** database | • **Username:** `admin`<br>• **Password:** `admin123` |

### How Admin Adds New Government Staff Accounts (`#staff`):
1. Click **`🏛️ Login`** in the top-right navbar and sign in as **Admin** (`admin` / `admin123`).
2. Click **`Staff`** in the navbar (or navigate to `http://localhost:8000/#staff`).
3. Fill out the **+ Add New Government Staff Account** form (Full Name, Username, Password, Role `staff` or `admin`, Assigned Department Queue, Designation, and Station) and click **Create Official Account**.
4. The new account is immediately persisted to SQLite/UltSQL (`staff_users` table) and can sign in right away via **`🏛️ Login`**.

---

## 🧪 Automated Test Suite & Verification

Run the comprehensive integration test suite to verify the entire system:

```bash
python test_triage.py
```

### What `test_triage.py` Verifies:
1. **Database Engine Probe**: Confirms UltSQL check and SQLite fallback integrity.
2. **NLP Triage Accuracy**: Evaluates 17 pre-defined test cases across Gujarati, Hindi, Gujlish, and English with strict assertion for language, department, and draft reply script.
3. **Database CRUD Operations**: Tests complaint insertion, status transitions to `Resolved`, and real-time KPI aggregations.
4. **FastAPI Endpoints**: Directly tests 7 REST routes including `/api/complaints/triage` and `/api/complaints/kpis`.

---

## 🎪 Live 2-Minute Judge Demonstration Script

Follow these steps when judges visit your team on board the Gujarat Metro:

### Step 1: Disconnect Internet (The "Hook")
- **Action**: Turn off Wi-Fi on your laptop in front of the judges.
- **Say**: *"Judges, we are in an underground tunnel with zero connectivity. MetroSetu is built 100% offline-first. Watch as we triage multilingual passenger grievances on-device."*

### Step 2: Open the Triage Console
- **Action**: Open `http://localhost:8000/#triage`.
- **Point Out**: Notice the **`🟢 ONLINE (Localhost)`** indicator and the department queues for **Safety**, **Lifts**, **Cleanliness**, **Fare**, and **Staff**.

### Step 3: Trigger the 1-Click Test Simulator
- **Action**: Click the **"🇬🇯 Gujarati"** sample button in the top drawer.
- **Observe**: A new card instantly appears in the queue:
  - **Text**: *"મોટેરા સ્ટેડિયમ પ્લેટફોર્મ ૧ પર લિફ્ટ અચાનક બંધ પડી ગઈ છે અને વરિષ્ઠ નાગરિકો ફસાયા છે!"*
  - **Classification**: **`P1 Critical`** &rarr; **`🛗 Lifts & Escalators`** (Latency: <5ms).
  - **Language Badge**: Emerald `Gujarati` badge.

### Step 4: Inspect the AI Reasoning & Trilingual Reply
- **Action**: Click on the complaint card to open the Inspector on the right.
- **Show Judges**:
  - The **Urgency Score Meter (100/100)** with **SLA target (<15 min)**.
  - The **AI Diagnostic**: *"Trapped passengers detected in lift/elevator; immediate rescue dispatch required."*
  - The **Auto-Drafted Response** in fluent, polite Gujarati:
    *"નમસ્તે... મોટેરા સ્ટેડિયમ સ્ટેશન પર Lifts & Escalators સંબંધિત તમારી ફરિયાદ બદલ અમે ક્ષમાપ્રાર્થી છીએ... અમારી ટેકનિકલ ટીમને તાત્કાલિક રવાના કરવામાં આવી છે..."*

### Step 5: Test Gujlish & Hindi
- **Action**: Click the **"🔤 Gujlish"** and **"🇮🇳 Hindi"** test buttons.
- **Show Judges**: MetroSetu seamlessly understands transliterated Gujlish (*"Water leakage chhe Kalupur par..."*) and routes it to **Safety** with P1 urgency!

### Step 6: Dispatch & Resolve
- **Action**: Edit the response text slightly in the studio and click **"Dispatch Reply & Resolve"**.
- **Observe**: The ticket marks as `Resolved` in real-time, the SLA counter updates, and the action is saved locally.

---

## 📁 Project Structure

```
├── README.md               # Complete setup, architecture & demo guide
├── requirements.txt        # Backend dependencies (fastapi, uvicorn)
├── db.py                   # Single DB abstraction: UltSQL probe + SQLite fallback
├── ai_engine.py            # Pure Python on-device Multilingual NLP Engine
├── seed.py                 # CLI seeder (10 stations, 1,680h telemetry, 37 complaints)
├── test_triage.py          # Automated verification test suite (17/17 NLP test cases)
├── metro.db                # Local SQLite database
├── .gitignore              # Clean git tracking
└── static/
    ├── index.html          # Single-Page UI (Dashboard, Stations, Triage Console, Alerts)
    ├── manifest.json       # PWA Web Manifest (Add to Home Screen)
    ├── sw.js               # Service Worker (pre-cached shell & offline API fallback)
    ├── icon-192.svg        # 192x192 transit icon
    ├── icon-512.svg        # 512x512 transit icon
    ├── css/
    │   └── app.css         # Modern dark-slate UI, neon urgency badges, system fonts
    └── js/
        ├── chart.min.js    # Locally bundled Chart.js 4.4.7 (zero CDN)
        └── app.js          # Client router, triage console, offline sync queue
```

---

## 🔗 Git Workflow & Repository

- **Repository**: [https://github.com/ompatel3158/MetroSetu.git](https://github.com/ompatel3158/MetroSetu.git)
- **Primary Branch**: `main`

### Routine Git Commands
```bash
# Check status
git status

# Stage and commit updates
git add .
git commit -m "feat: your update message"

# Push to GitHub
git push origin main
```

---

## 🏆 Summary: Why MetroSetu Wins PS-07

| Judging Criterion | MetroSetu Implementation |
|---|---|
| **Relevance to Operator** | Directly addresses station controllers handling multilingual grievances in underground stations. |
| **Working Prototype** | End-to-end working system: ingestion &rarr; NLP classification &rarr; queue routing &rarr; draft reply &rarr; resolution. |
| **Resilience (100% Offline)** | Zero external CDNs, zero cloud APIs, local SQLite/UltSQL, Service Worker caching, and offline mutation queueing. |
| **Technical Depth** | Pure-Python multilingual NLP handling Unicode Gujarati, Hindi, and transliterated Gujlish in <5ms. |
| **PPP & Feasibility** | Ready to integrate into Gujarat Metro Rail Corporation (GMRC) passenger portals and station control rooms. |

---
*Built with ❤️ for DevFest Gandhinagar · Metro Hacks 2026 by Om Patel.*
