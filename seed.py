#!/usr/bin/env python3
"""
seed.py - Metro System Realistic Data Seeder
============================================
Populates the SQLite database with realistic metro stations, equipment assets,
hourly ridership trends (with embedded synthetic anomalies), fault events,
and feeder bus routes.

Usage:
    python seed.py
    python seed.py --hours 168
"""

import sys
import argparse
import db


def main():
    parser = argparse.ArgumentParser(description="Seed the Metro Transit Ops database.")
    parser.add_argument(
        "--hours",
        type=int,
        default=168,
        help="Number of hours of historical ridership to generate (default: 168 = 7 days)"
    )
    args = parser.parse_args()

    print(f"[*] Initializing database schema at {db.DB_PATH}...")
    db.init_db()

    print(f"[*] Generating {args.hours} hours of realistic transit telemetry...")
    summary = db.seed_metro_data(hours_history=args.hours)

    print("\n[+] Database seeded successfully!")
    print(f"    - Metro Stations:    {summary['stations']}")
    print(f"    - Hourly Ridership:  {summary['ridership_records']:,} data points")
    print(f"    - Infrastructure Assets: {summary['assets']}")
    print(f"    - Fault Events:      {summary['faults']}")
    print(f"    - Feeder Bus Routes: {summary['bus_connections']}")
    print(f"    - Multilingual Complaints Triage: {summary.get('complaints', 0)}")
    print("\n[+] Ready for local operations. Start server with: python -m uvicorn main:app --reload")


if __name__ == "__main__":
    main()
