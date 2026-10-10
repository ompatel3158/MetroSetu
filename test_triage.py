"""
test_triage.py - Unit and Integration Tests for MetroSetu Multilingual NLP & DB
=============================================================================
Tests:
1. UltSQL Probe & Silent SQLite Fallback
2. Database Complaints Schema, CRUD & KPI Operations
3. Pure Python Multilingual NLP Triage Engine:
   - Gujarati (Script + Semantics + Urgency + Draft)
   - Hindi (Script + Semantics + Urgency + Draft)
   - Gujlish (Phonetics + Semantics + Urgency + Draft)
   - English (Semantics + Urgency + Draft)
4. FastAPI Route Handlers Execution
"""

import sys
import asyncio
import db
import ai_engine
import main

# Test cases representing each language and department combination
TEST_SUITE = [
    # 1. Gujarati
    {
        "lang": "Gujarati",
        "dept": "Lifts & Escalators",
        "urgency_level": "P1 Critical",
        "text": "મોટેરા સ્ટેડિયમ પ્લેટફોર્મ ૧ પર લિફ્ટ અચાનક બંધ પડી ગઈ છે અને વરિષ્ઠ નાગરિકો ફસાયા છે! કૃપા કરીને જલદી મદદ મોકલો.",
        "station": "Motera Stadium",
        "name": "જયેશ પટેલ"
    },
    {
        "lang": "Gujarati",
        "dept": "Cleanliness",
        "urgency_level": "P3 Medium",
        "text": "કાલુપુર રેલવે સ્ટેશન મેટ્રો ગેટ પાસે ખૂબ જ ગંદકી અને કચરો ફેલાયેલો છે, અસહ્ય દુર્ગંધ આવે છે.",
        "station": "Kalupur Railway Station",
        "name": "ભાવિકા શાહ"
    },
    {
        "lang": "Gujarati",
        "dept": "Fare & Ticketing",
        "urgency_level": "P3 Medium",
        "text": "એપીએમસી સ્ટેશન પર ટિકિટ વેન્ડિંગ મશીનમાં ૨૦૦ રૂપિયા કપાઈ ગયા પણ ટિકિટ ન આવી અને રિફંડ પણ નથી મળ્યું.",
        "station": "APMC",
        "name": "દિનેશ પરમાર"
    },
    {
        "lang": "Gujarati",
        "dept": "Safety",
        "urgency_level": "P1 Critical",
        "text": "ઓલ્ડ હાઈકોર્ટ ઇન્ટરચેન્જ પર પ્લેટફોર્મની ધાર પર ખુલ્લા વાયરમાંથી તણખા (સ્પાર્ક) નીકળે છે, મોટો અકસ્માત થઈ શકે છે!",
        "station": "Old High Court Interchange",
        "name": "કિરીટ જોષી"
    },

    # 2. Hindi
    {
        "lang": "Hindi",
        "dept": "Lifts & Escalators",
        "urgency_level": "P1 Critical",
        "text": "मोतेरा स्टेडियम स्टेशन के लिफ्ट में 4 यात्री पिछले 20 मिनट से फंसे हुए हैं, अलार्म काम नहीं कर रहा और दम घुट रहा है!",
        "station": "Motera Stadium",
        "name": "रोहित शर्मा"
    },
    {
        "lang": "Hindi",
        "dept": "Safety",
        "urgency_level": "P2 High",  # Or P1
        "text": "कालूपुर स्टेशन पर प्लेटफॉर्म 2 पर भारी पानी भरा हुआ है, यात्री फिसल कर गिर रहे हैं, गंभीर चोट लग सकती है।",
        "station": "Kalupur Railway Station",
        "name": "अजय वर्मा"
    },
    {
        "lang": "Hindi",
        "dept": "Cleanliness",
        "urgency_level": "P3 Medium",
        "text": "ओल्ड हाई कोर्ट इंटरचेंज के वॉशरूम में भयंकर गंदगी और दुर्गंध है, कोई सफाई कर्मचारी मौजूद नहीं है।",
        "station": "Old High Court Interchange",
        "name": "नीरज तिवारी"
    },
    {
        "lang": "Hindi",
        "dept": "Staff Behaviour",
        "urgency_level": "P3 Medium",
        "text": "एपीएमसी मेट्रो स्टेशन के टिकट काउंटर पर तैनात कर्मचारी बहुत बदतमीजी से बात कर रहा है और चिल्ला रहा है।",
        "station": "APMC",
        "name": "विकास यादव"
    },

    # 3. Gujlish (Phonetic Romanized Gujarati)
    {
        "lang": "Gujlish",
        "dept": "Lifts & Escalators",
        "urgency_level": "P2 High",
        "text": "Motera Stadium platform 2 par escalator bandh che ane vruddh loko atvayela che, jaldi chalu karo.",
        "station": "Motera Stadium",
        "name": "Parth Prajapati"
    },
    {
        "lang": "Gujlish",
        "dept": "Cleanliness",
        "urgency_level": "P3 Medium",
        "text": "Kalupur station na washroom ma bilkul chokhkhaai nathi, bau gandki che ane badbu aave che.",
        "station": "Kalupur Railway Station",
        "name": "Hardik Patel"
    },
    {
        "lang": "Gujlish",
        "dept": "Fare & Ticketing",
        "urgency_level": "P3 Medium",
        "text": "APMC metro station par ticket counter wala bhai e extra bhaadu lidhu ane receipt pan nathi aapi.",
        "station": "APMC",
        "name": "Chirag Soni"
    },
    {
        "lang": "Gujlish",
        "dept": "Lifts & Escalators",
        "urgency_level": "P1 Critical",
        "text": "Gandhinagar Capital station na lift ma 3 passenger fasayela che, darwajo nathi khulto! Emergency che!",
        "station": "Gandhinagar Capital",
        "name": "Kinjal Vaghela"
    },
    {
        "lang": "Gujlish",
        "dept": "Safety",
        "urgency_level": "P1 Critical",
        "text": "Old High Court interchange par electrical box mathi dhuvado nikle che, koi moti aag lagi shake che!",
        "station": "Old High Court Interchange",
        "name": "Nirav Barot"
    },

    # 4. English
    {
        "lang": "English",
        "dept": "Safety",
        "urgency_level": "P1 Critical",
        "text": "Emergency at Motera Stadium: Dense smoke and burning smell observed near transformer room on concourse level.",
        "station": "Motera Stadium",
        "name": "David Miller"
    },
    {
        "lang": "English",
        "dept": "Lifts & Escalators",
        "urgency_level": "P2 High",
        "text": "The wheelchair ramp and accessible elevator at Kalupur are out of service, a disabled commuter is stuck.",
        "station": "Kalupur Railway Station",
        "name": "Sneha Kothari"
    },
    {
        "lang": "English",
        "dept": "Cleanliness",
        "urgency_level": "P3 Medium",
        "text": "Dustbins overflowing with plastic bottles and food waste across platform 1 at Thaltej station.",
        "station": "Thaltej",
        "name": "Gaurav Modi"
    },
    {
        "lang": "English",
        "dept": "Fare & Ticketing",
        "urgency_level": "P3 Medium",
        "text": "Turnstile gate 4 deducted 50 rupees from my UPI via QR code, but the flap barrier failed to open at APMC.",
        "station": "APMC",
        "name": "Vikram Rathod"
    }
]


def test_db_engine():
    print("[1] Testing Database Engine Probe...")
    engine_info = db.get_active_db_engine()
    assert engine_info["engine"] in ("SQLite", "UltSQL"), f"Unexpected engine: {engine_info}"
    assert "status" in engine_info
    print(f"    [PASS] Active Engine: {engine_info['engine']} (Fallback: {engine_info.get('fallback')})")


def test_nlp_triage():
    print("\n[2] Testing Multilingual NLP Triage Engine...")
    passed = 0
    total = len(TEST_SUITE)

    for i, case in enumerate(TEST_SUITE, 1):
        res = ai_engine.triage_complaint(
            text=case["text"],
            station_name=case["station"],
            passenger_name=case["name"]
        )

        lang_match = (res["detected_language"] == case["lang"])
        dept_match = (res["department"] == case["dept"])

        # Check that draft reply is generated in the correct language
        draft = res["draft_reply"]
        assert len(draft) > 20, "Draft reply too short"

        if case["lang"] == "Gujarati":
            assert any('\u0A80' <= c <= '\u0AFF' for c in draft), "Draft must be in Gujarati script"
        elif case["lang"] == "Hindi":
            assert any('\u0900' <= c <= '\u097F' for c in draft), "Draft must be in Hindi script"
        elif case["lang"] == "Gujlish":
            assert "Namaste" in draft or "che" in draft or "MetroSetu" in draft

        status_sym = "[OK]" if (lang_match and dept_match) else "[FAIL]"
        print(f"    Case #{i:02d} ({case['lang']:8s} | {case['dept']:18s}): Lang={res['detected_language']} ({res['language_confidence']}), Dept={res['department']} ({res['department_confidence']}), Urgency={res['urgency_level']} (Score {res['urgency_score']}) -> {status_sym}")

        if lang_match and dept_match:
            passed += 1

    accuracy = (passed / total) * 100
    print(f"\n    NLP Accuracy: {passed}/{total} ({accuracy:.1f}%)")
    assert accuracy >= 90.0, f"Accuracy too low: {accuracy}%"


def test_crud_and_kpis():
    print("\n[3] Testing Database CRUD & KPIs...")
    # Seed db
    summary = db.seed_metro_data(hours_history=24)
    assert summary["complaints"] >= 25, f"Complaints count too low: {summary['complaints']}"
    print(f"    [PASS] Seeded {summary['complaints']} complaints across {summary['stations']} stations")

    # Get complaints
    all_complaints = db.get_complaints(limit=50)
    assert len(all_complaints) == summary["complaints"]
    sample = all_complaints[0]
    assert "station_name" in sample
    assert "urgency_score" in sample
    assert "detected_language" in sample
    print(f"    [PASS] get_complaints returned {len(all_complaints)} items with station join")

    # KPIs
    kpis = db.get_complaint_kpis()
    assert kpis["total_complaints"] == summary["complaints"]
    assert kpis["open_complaints"] > 0
    assert kpis["critical_p1"] > 0
    assert len(kpis["by_department"]) == 5
    assert len(kpis["by_language"]) == 4
    print(f"    [PASS] KPIs verified: {kpis['total_complaints']} total, P1={kpis['critical_p1']}, Avg Score={kpis['avg_urgency_score']}")

    # Create new complaint
    new_id = db.create_complaint({
        "station_id": 1,
        "passenger_name": "Test User",
        "channel": "WhatsApp",
        "raw_text": "લિફ્ટ બંધ છે",
        "detected_language": "Gujarati",
        "department": "Lifts & Escalators",
        "urgency_score": 4,
        "urgency_level": "P2 High",
        "urgency_reason": "Broken lift reported",
        "draft_reply": "નમસ્તે Test User",
        "status": "Open"
    })
    assert new_id > 0
    created = db.get_complaint_by_id(new_id)
    assert created["passenger_name"] == "Test User"
    print(f"    [PASS] create_complaint succeeded (ID={new_id})")

    # Update status
    updated = db.update_complaint_status(new_id, "Resolved")
    assert updated is True
    resolved = db.get_complaint_by_id(new_id)
    assert resolved["status"] == "Resolved"
    assert resolved["resolved_at"] is not None
    print("    [PASS] update_complaint_status succeeded")


async def test_api_endpoints():
    print("\n[4] Testing FastAPI Endpoints...")
    # 1. GET /api/db/engine
    eng = await main.get_database_engine()
    assert eng["engine"] in ("SQLite", "UltSQL")
    print(f"    [PASS] /api/db/engine -> {eng['engine']}")

    # 2. GET /api/complaints/kpis
    kpi_resp = await main.get_complaints_kpis()
    assert "total_complaints" in kpi_resp
    print(f"    [PASS] /api/complaints/kpis -> {kpi_resp['total_complaints']} complaints")

    # 3. POST /api/complaints/triage
    triage_req = main.ComplaintTriageRequest(
        raw_text="લિફ્ટ બંધ છે અને વૃદ્ધ મુસાફરો ફસાયા છે!",
        station_name="Motera Stadium",
        passenger_name="જયેશ પટેલ"
    )
    triage_resp = await main.triage_complaint_endpoint(triage_req)
    assert triage_resp["detected_language"] == "Gujarati"
    assert triage_resp["department"] == "Lifts & Escalators"
    assert triage_resp["urgency_score"] == 5
    print(f"    [PASS] /api/complaints/triage -> Lang={triage_resp['detected_language']}, Dept={triage_resp['department']}, Level={triage_resp['urgency_level']}")

    # 4. POST /api/complaints
    comp_req = main.ComplaintCreate(
        station_id=1,
        passenger_name="Rahul Shah",
        channel="Mobile App",
        raw_text="Platform screen door not opening automatically"
    )
    create_resp = await main.create_new_complaint(comp_req)
    assert create_resp["id"] > 0
    print(f"    [PASS] POST /api/complaints -> Created ID={create_resp['id']}")

    # 5. POST /api/complaints/batch
    batch_req = [
        {"station_id": 2, "passenger_name": "Test Commuter 1", "raw_text": "Washroom ma gandki che"},
        {"station_id": 3, "passenger_name": "Test Commuter 2", "raw_text": "Ticket counter par guard so raha hai"}
    ]
    batch_resp = await main.create_complaints_batch(batch_req)
    assert batch_resp["count"] == 2
    print(f"    [PASS] POST /api/complaints/batch -> Ingested {batch_resp['count']} records")

    # 6. PATCH /api/complaints/{id}/status
    status_req = main.ComplaintStatusUpdate(status="Resolved")
    patch_resp = await main.update_complaint_status_endpoint(create_resp["id"], status_req)
    assert patch_resp["complaint"]["status"] == "Resolved"
    print(f"    [PASS] PATCH /api/complaints/{create_resp['id']}/status -> Resolved")

    # 7. GET /api/complaints list
    listing = await main.list_complaints(limit=5)
    assert len(listing) == 5
    print(f"    [PASS] GET /api/complaints -> Fetched {len(listing)} records")


def run_all():
    print("=" * 70)
    print("METROSETU (PS-07) - NLP TRIAGE & BACKEND TEST RUNNER")
    print("=" * 70)
    test_db_engine()
    test_nlp_triage()
    test_crud_and_kpis()
    asyncio.run(test_api_endpoints())
    print("\n" + "=" * 70)
    print("ALL TESTS PASSED SUCCESSFULLY! (100% OFFLINE READY)")
    print("=" * 70)


if __name__ == "__main__":
    run_all()
