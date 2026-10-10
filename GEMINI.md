# Workspace Rules: 100% Offline-First Architecture

## Core Directive
This project is built for the **Gujarat Metro Hacks (DevFest Gandhinagar)** hackathon, which takes place on board an active metro train with patchy or zero connectivity in tunnels.
**Demonstration will be conducted 100% OFFLINE.**

### Non-Negotiable Requirements:
1. **Zero External CDNs & Web Fonts**: All CSS, JS libraries (e.g., Chart.js), and assets MUST be bundled locally inside `static/`. System fonts only.
2. **Single Database Abstraction**: SQLite access MUST strictly go through `db.py`. Zero SQL queries or `sqlite3` imports elsewhere.
3. **On-Device Local AI**: All anomaly detection, NLP triage, prediction, or recommendation algorithms must run locally in Python without external cloud APIs.
4. **Offline PWA / Service Worker**: Service worker at `/sw.js` must pre-cache the app shell and provide offline fallbacks for `/api/*` routes.
5. **Clear Offline Indicator**: UI must have an active online/offline heartbeat badge.
