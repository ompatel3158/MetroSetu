"""
ai_engine.py - Pure Python On-Device AI Engine
==============================================
Provides local, deterministic AI capabilities without any external API calls:
1. Robust Statistical Anomaly Detection (Modified Z-Score + MAD & Seasonal Baselines)
2. Seasonal Demand Forecasting (Holt-Winters / Additive Seasonal Smoothing with 95% Confidence Intervals)

Zero external dependencies: uses only Python standard library (math, statistics, datetime).
"""

import math
import statistics
from datetime import datetime, timedelta
from typing import List, Dict, Any, Optional
import db


# ============================================================================
# 1. ANOMALY DETECTION ENGINE (Robust Statistical Learning)
# ============================================================================

def detect_ridership_anomalies(
    station_id: Optional[int] = None,
    lookback_records: int = 168,
    sensitivity_threshold: float = 2.5,
    auto_persist_flags: bool = True
) -> Dict[str, Any]:
    """
    Performs on-device anomaly detection on recent hourly ridership.
    
    Algorithm:
    - Learns the baseline ridership distribution conditioned on (day_of_week, hour).
    - Computes robust statistics: Median and Median Absolute Deviation (MAD).
    - Calculates Modified Z-Scores: 0.6745 * (observation - median) / MAD
    - Identifies Surges (overcrowding / unannounced events) and Drops (outages / disruptions).
    - Returns structured diagnostic telemetry and flags records in the database.
    """
    # Fetch historical readings via db abstraction
    history = db.get_ridership_history(station_id=station_id, limit=lookback_records)
    if len(history) < 12:
        return {
            "status": "insufficient_data",
            "message": "Need at least 12 data points to calibrate baseline",
            "anomalies": []
        }

    # Group baseline readings by (day_of_week, hour) or overall hour of day
    hourly_buckets: Dict[int, List[int]] = {h: [] for h in range(24)}
    for record in history:
        h = record["hour"]
        hourly_buckets[h].append(record["tap_ins"])

    # Compute baseline parameters per hour: median, MAD, mean, std
    baselines: Dict[int, Dict[str, float]] = {}
    for h, vals in hourly_buckets.items():
        if not vals:
            continue
        med = statistics.median(vals)
        deviations = [abs(v - med) for v in vals]
        mad = statistics.median(deviations) if deviations else 0.0
        # If MAD is zero (identical values), fall back to std deviation or minimal variance
        mean = statistics.mean(vals)
        stdev = statistics.stdev(vals) if len(vals) > 1 else (mad or 10.0)
        baselines[h] = {
            "median": med,
            "mad": mad if mad > 0 else (stdev * 0.6745 or 10.0),
            "mean": mean,
            "stdev": stdev if stdev > 0 else 10.0
        }

    # Evaluate each record
    detected_anomalies = []
    total_evaluated = len(history)

    for record in history:
        h = record["hour"]
        val = record["tap_ins"]
        base = baselines.get(h)
        if not base:
            continue

        median_val = base["median"]
        mad_val = base["mad"]

        # Modified Z-Score (Boris Iglewicz and David Hoaglin robust outlier score)
        mod_z = 0.6745 * (val - median_val) / mad_val
        std_z = (val - base["mean"]) / base["stdev"]

        is_surge = mod_z >= sensitivity_threshold
        is_drop = mod_z <= -sensitivity_threshold

        if is_surge or is_drop:
            pct_diff = ((val - median_val) / (median_val if median_val > 0 else 1.0)) * 100
            anomaly_type = "SURGE_ANOMALY" if is_surge else "DROP_ANOMALY"
            severity = "Critical" if abs(mod_z) >= 3.5 else "Warning"
            
            diagnostic = (
                f"{'Ridership spike' if is_surge else 'Severe ridership drop'}: "
                f"{val:,} passengers vs expected baseline {int(median_val):,} "
                f"({'+' if pct_diff > 0 else ''}{pct_diff:.1f}%, mod-Z: {mod_z:.2f})"
            )

            anomaly_info = {
                "record_id": record["id"],
                "station_id": record["station_id"],
                "station_name": record.get("station_name", f"Station #{record['station_id']}"),
                "line_name": record.get("line_name", "Transit Line"),
                "recorded_at": record["recorded_at"],
                "hour": h,
                "observed_value": val,
                "expected_median": round(median_val, 1),
                "modified_z_score": round(mod_z, 2),
                "standard_z_score": round(std_z, 2),
                "pct_deviation": round(pct_diff, 1),
                "type": anomaly_type,
                "severity": severity,
                "diagnostic": diagnostic
            }
            detected_anomalies.append(anomaly_info)

            # Persist flag into SQLite via db module
            if auto_persist_flags:
                db.flag_ridership_anomaly(record["id"], 1, diagnostic)

    # Sort anomalies with most recent or highest severity first
    detected_anomalies.sort(key=lambda a: abs(a["modified_z_score"]), reverse=True)

    return {
        "status": "success",
        "evaluated_records": total_evaluated,
        "anomalies_found": len(detected_anomalies),
        "sensitivity_threshold": sensitivity_threshold,
        "anomalies": detected_anomalies
    }


# ============================================================================
# 2. DEMAND FORECASTING ENGINE (Pure Python Seasonal Additive Smoothing)
# ============================================================================

def forecast_hourly_demand(
    station_id: Optional[int] = None,
    horizon_hours: int = 24
) -> Dict[str, Any]:
    """
    Generates next N hours ridership forecast using seasonal decomposition.
    
    Model:
    Y_{t+h} = (Level + Trend * h) * Seasonal_Hour * Day_Multiplier
    Plus calculates 95% Confidence Prediction Intervals (upper / lower bounds).
    
    Returns structured series formatted for Chart.js.
    """
    # Grab last 7 days (168 hours) of hourly data
    if station_id:
        history = db.get_station_hourly_profile(station_id, hours=168)
        station_info = db.get_station_by_id(station_id)
        series_label = station_info["name"] if station_info else f"Station #{station_id}"
    else:
        history = db.get_system_hourly_series(hours=168)
        series_label = "Whole Metro System"

    if len(history) < 24:
        return {
            "status": "insufficient_data",
            "message": "At least 24 hours of history required to build forecast model",
            "forecast": []
        }

    # Extract historical values
    timestamps = [r["recorded_at"] for r in history]
    values = [r["total_tap_ins"] if "total_tap_ins" in r else r["tap_ins"] for r in history]
    hours = [r["hour"] for r in history]

    # Compute hourly diurnal seasonal indices (average fraction of daily mean)
    overall_mean = statistics.mean(values) if values else 1000.0
    if overall_mean <= 0:
        overall_mean = 1.0

    hourly_sums = {h: [] for h in range(24)}
    for h, v in zip(hours, values):
        hourly_sums[h].append(v)

    seasonal_factors = {}
    for h in range(24):
        h_vals = hourly_sums[h]
        seasonal_factors[h] = (statistics.mean(h_vals) / overall_mean) if h_vals else 1.0

    # Estimate short-term trend (linear slope over recent 24-48 hours)
    recent_n = min(48, len(values))
    recent_vals = values[-recent_n:]
    x_mean = (recent_n - 1) / 2.0
    y_mean = statistics.mean(recent_vals)

    numerator = sum((i - x_mean) * (y - y_mean) for i, y in enumerate(recent_vals))
    denominator = sum((i - x_mean) ** 2 for i in range(recent_n))
    slope = (numerator / denominator) if denominator != 0 else 0.0

    # Base level smoothed
    alpha = 0.3
    level = recent_vals[-1]
    for v in reversed(recent_vals[:-1]):
        level = alpha * v + (1 - alpha) * level

    # Compute residual variance to establish 95% confidence intervals (approx 1.96 * std_err)
    residuals = []
    for h, v in zip(hours[-recent_n:], recent_vals):
        expected = level * seasonal_factors.get(h, 1.0)
        residuals.append(abs(v - expected))
    mean_err = statistics.mean(residuals) if residuals else 50.0
    margin_multiplier = 1.96 * mean_err

    # Generate forward projections
    last_dt_str = timestamps[-1]
    try:
        last_dt = datetime.fromisoformat(last_dt_str)
    except Exception:
        last_dt = datetime.now()

    forecast_points = []
    for step in range(1, horizon_hours + 1):
        future_dt = last_dt + timedelta(hours=step)
        f_hour = future_dt.hour
        weekday = future_dt.weekday() # 0 = Monday, 6 = Sunday

        # Weekend adjustment factor (Saturdays/Sundays usually have ~70-75% ridership)
        dow_factor = 0.75 if weekday in (5, 6) else 1.0

        projected_level = max(0.0, level + (slope * step * 0.1)) # damped trend
        point_forecast = projected_level * seasonal_factors.get(f_hour, 1.0) * dow_factor

        # Unpack realistic bounds (non-negative)
        ci_spread = margin_multiplier * math.sqrt(1 + (step * 0.05)) # spread widens into the future
        lower_bound = max(0, int(point_forecast - ci_spread))
        upper_bound = int(point_forecast + ci_spread)
        pred_val = int(point_forecast)

        forecast_points.append({
            "timestamp": future_dt.strftime("%Y-%m-%dT%H:00:00"),
            "hour_label": future_dt.strftime("%a %H:00"),
            "forecast_passengers": pred_val,
            "lower_bound_95": lower_bound,
            "upper_bound_95": upper_bound
        })

    return {
        "status": "success",
        "series_label": series_label,
        "horizon_hours": horizon_hours,
        "current_base_level": round(level, 1),
        "trend_slope": round(slope, 3),
        "forecast": forecast_points
    }


# ============================================================================
# 3. MULTILINGUAL NLP TRIAGE ENGINE (Pure Python, Zero Bloat)
# ============================================================================

import re

# Phonetic token lexicon for Gujlish (Romanized Gujarati)
GUJLISH_PHONETIC_TOKENS = {
    "che", "chhe", "nathi", "chokhkhaai", "chokhani", "bhaadu", "bandh",
    "atvayela", "fasayela", "fasai", "kem", "karvanu", "shu", "karo",
    "aavshe", "aavyo", "gayo", "hatu", "hata", "pan", "mane", "tame",
    "krupaya", "madad", "takleef", "taklif", "kharab", "paani", "bhai",
    "saheb", "ketla", "kyare", "javu", "kya", "aavi", "joye", "joyie",
    "bagado", "chodva", "chaloo", "badhi", "haji", "var", "sharu",
    "loko", "mathi", "karyu", "thaya", "thayeli", "batavay", "lidhu",
    "aapi", "sudhi", "gandki", "kachro", "kachra", "safai", "badbu",
    "thunkvu", "mutradi", "vruddh", "divyang", "chori", "kutru",
    "dhuvado", "jokham", "saathe", "vastral", "gam", "rokvi", "padshe",
    "bau", "picho", "valao", "aapyo", "aape"
}

# Department keywords across Gujarati, Hindi, English, and Gujlish
DEPARTMENT_KEYWORDS: Dict[str, Dict[str, int]] = {
    "Safety": {
        # English
        "safety": 4, "emergency": 5, "hazard": 4, "danger": 4, "dangerous": 4,
        "accident": 5, "fire": 5, "smoke": 5, "spark": 5, "sparking": 5,
        "electric shock": 5, "shock": 4, "exposed wire": 5, "wire": 3,
        "slippery": 4, "slip": 4, "falling": 4, "stampede": 5, "crush": 4,
        "theft": 4, "thief": 4, "pickpocket": 4, "stolen": 4, "harassment": 5,
        "harass": 5, "fight": 4, "fighting": 4, "violence": 5, "blood": 5,
        "injury": 5, "injured": 5, "hurt": 4, "medical": 5, "faint": 5,
        "fainted": 5, "unconscious": 5, "police": 4, "panic": 4, "weapon": 5,
        "track": 4, "tracks": 4, "screen door": 3, "unattended": 4, "suspicious": 4,
        # Gujarati script
        "સુરક્ષા": 4, "જોખમ": 4, "ઈમરજન્સી": 5, "ઇમરજન્સી": 5, "અકસ્માત": 5,
        "આગ": 5, "ધૂમાડો": 5, "તણખા": 5, "શોર્ટ સર્કિટ": 5, "વાયર": 3,
        "ખુલ્લા વાયર": 5, "લપસી": 4, "પડવું": 3, "પડ્યા": 4, "ચોરી": 4,
        "છેડતી": 5, "ઝઘડો": 4, "લોહી": 5, "ઈજા": 5, "બેભાન": 5, "પોલીસ": 4,
        "ડર": 3, "ભય": 3, "જોખમી": 4, "મહિલા કોચ": 4, "પાટા": 4,
        # Hindi script
        "सुरक्षा": 4, "खतरा": 4, "आपातकाल": 5, "इमरजेंसी": 5, "दुर्घटना": 5,
        "हादसा": 5, "आग": 5, "धुआं": 5, "शॉर्ट सर्किट": 5, "बिजली": 4,
        "खुला तार": 5, "फिसलन": 4, "गिरना": 3, "गिर रहे": 4, "चोरी": 4,
        "छेड़छाड़": 5, "मारपीट": 4, "खून": 5, "चोट": 5, "बेहोश": 5, "पुलिस": 4,
        "भगदड़": 5, "लावारिस": 4, "पटरी": 4, "महिला कोच": 4,
        # Gujlish
        "jokham": 4, "dhuvado": 5, "current": 4, "chhedti": 5, "lapasi": 4,
        "padi gya": 4, "bhagdad": 5, "kutru": 4, "rokvi": 4
    },
    "Lifts & Escalators": {
        # English
        "lift": 5, "lifts": 5, "elevator": 5, "elevators": 5, "escalator": 5,
        "escalators": 5, "stairs": 3, "staircase": 3, "moving walk": 4,
        "trapped": 5, "stuck": 4, "ramp": 3, "wheelchair": 4, "out of service": 4,
        "breakdown": 4, "stoppage": 4, "jerk": 3,
        # Gujarati script
        "લિફ્ટ": 5, "એસ્કેલેટર": 5, "સરકતી સીડી": 4, "સીડી": 3, "લિફ્ટ બંધ": 5,
        "એસ્કેલેટર બંધ": 5, "ફસાયા": 5, "ફસાયેલા": 5, "અટવાયા": 4, "ચાલતું નથી": 3,
        "વ્હીલચેર": 4, "વૃદ્ધ": 3, "વરિષ્ઠ": 3,
        # Hindi script
        "लिफ्ट": 5, "एस्केलेटर": 5, "स्वचालित सीढ़ी": 4, "सीढ़ियां": 3, "लिफ्ट बंद": 5,
        "एस्केलेटर बंद": 5, "फंसे": 5, "फंसा": 5, "फंसे हुए": 5, "अटक गए": 4,
        "काम नहीं कर रही": 3, "बटन खराब": 3, "झटका": 3, "व्हीलचेयर": 4,
        # Gujlish
        "sidi": 3, "fasayela": 5, "atvayela": 4, "fasai": 5, "bandh che": 3
    },
    "Cleanliness": {
        # English
        "clean": 4, "cleanliness": 5, "cleaning": 4, "dirty": 5, "garbage": 5,
        "trash": 5, "waste": 4, "dustbin": 5, "smell": 4, "stink": 5,
        "odor": 4, "spit": 5, "spitting": 5, "gutkha": 5, "pan masala": 5,
        "toilet": 5, "toilets": 5, "washroom": 5, "washrooms": 5, "restroom": 5,
        "urinal": 5, "urinals": 5, "urine": 5, "leakage": 4, "water leak": 4,
        "unhygienic": 5, "filth": 5, "stain": 4, "litter": 4, "drain": 4,
        # Gujarati script
        "સ્વચ્છતા": 5, "ગંદકી": 5, "કચરો": 5, "ડસ્ટબિન": 5, "દુર્ગંધ": 5,
        "વાસ": 4, "થૂંકવું": 5, "ગુટખા": 5, "પાનની પિચકારી": 5, "ટોયલેટ": 5,
        "શૌચાલય": 5, "વોશરૂમ": 5, "પાણી ભરાવું": 4, "લીકેજ": 4, "ગંદુ": 5,
        # Hindi script
        "स्वच्छता": 5, "सफाई": 5, "गंदगी": 5, "कचरा": 5, "कूड़ा": 5,
        "डस्टबिन": 5, "बदबू": 5, "दुर्गंध": 5, "थूक": 5, "गुटखा": 5,
        "पान की पीक": 5, "टॉयलेट": 5, "शौचालय": 5, "वॉशरूम": 5, "गंदा": 5,
        "लीकेज": 4, "पीने का पानी": 3,
        # Gujlish
        "chokhkhaai": 5, "chokhani": 5, "safai": 5, "gandki": 5, "kachro": 5,
        "kachra": 5, "badbu": 5, "vas": 4, "thunkvu": 5, "mutradi": 5, "pichkari": 5
    },
    "Fare & Ticketing": {
        # English
        "ticket": 5, "tickets": 5, "ticketing": 5, "fare": 4, "fares": 4,
        "smart card": 5, "smartcard": 5, "card": 3, "recharge": 5, "tvm": 5,
        "token": 5, "tokens": 5, "qr code": 5, "qr ticket": 5, "qr": 4,
        "refund": 5, "deducted": 5, "money deducted": 5, "gate": 4, "gates": 4,
        "turnstile": 5, "afc gate": 5, "afc": 4, "flap barrier": 4, "overcharge": 5,
        "balance": 4, "payment failed": 5, "upi": 4, "scanner": 4, "vending": 4,
        # Gujarati script
        "ટિકિટ": 5, "ભાડું": 5, "સ્માર્ટ કાર્ડ": 5, "રિચાર્જ": 5, "ટોકન": 5,
        "ક્યૂઆર કોડ": 5, "ક્યૂઆર": 4, "પૈસા કપાઈ": 5, "રિફંડ": 5, "ગેટ": 4,
        "પેમેન્ટ ફેલ": 5, "યુપીઆઈ": 4, "બેલેન્સ": 4, "મશીન": 4,
        # Hindi script
        "टिकट": 5, "किराया": 5, "स्मार्ट कार्ड": 5, "रिचार्ज": 5, "टोकन": 5,
        "क्यूआर कोड": 5, "क्यूआर": 4, "पैसे कट": 5, "रिफंड": 5, "गेट": 4,
        "पेमेंट फेल": 5, "यूपीआई": 4, "कार्ड स्कैन": 4, "मशीन": 4,
        # Gujlish
        "bhaadu": 5, "paisa kapai": 5, "gate khulatu": 4, "turnstile": 5,
        "balance nathi": 4, "extra bhaadu": 5, "receipt": 4
    },
    "Staff Behaviour": {
        # English
        "staff": 5, "officer": 4, "operator": 4, "security guard": 5, "guard": 4,
        "conductor": 4, "counter": 3, "employee": 4, "personnel": 4, "rude": 5,
        "rudely": 5, "misbehave": 5, "misbehaviour": 5, "abusive": 5, "abuse": 5,
        "refused": 4, "unhelpful": 4, "bribe": 5, "shouting": 5, "ignored": 4,
        "attitude": 4, "sleeping on duty": 5, "asleep": 4, "arrogant": 5,
        # Gujarati script
        "સ્ટાફ": 5, "કર્મચારી": 5, "ગાર્ડ": 4, "સિક્યોરિટી": 4, "કાઉન્ટર": 3,
        "ખરાબ વર્તન": 5, "ઉદ્ધત": 5, "ગાળાગાળી": 5, "મદદ ના કરી": 4,
        "ધ્યાન નથી": 4, "અભદ્ર": 5, "ઝઘડો": 4, "બૂમો": 4,
        # Hindi script
        "स्टाफ": 5, "कर्मचारी": 5, "गार्ड": 4, "सुरक्षा गार्ड": 5, "अभद्र": 5,
        "बदतमीजी": 5, "रूखा": 4, "गाली": 5, "मदद से इनकार": 4, "चिल्लाना": 5,
        "चिल्ला रहा": 5, "लापरवाही": 4, "सो रहा": 5,
        # Gujlish
        "karmachari": 4, "kharab vartan": 5, "uddhat": 5, "madad nathi": 4,
        "shouting": 5, "gaal": 5, "dhyan nathi": 4
    }
}


def detect_language(text: str) -> Dict[str, Any]:
    """
    Detects language of complaint text:
    - Gujarati (Unicode U+0A80 to U+0AFF)
    - Hindi / Devanagari (Unicode U+0900 to U+097F)
    - Gujlish (Latin script with phonetic Gujarati tokens)
    - English (standard Latin text)
    """
    if not text:
        return {"language": "English", "confidence": 0.5, "script": "Latin"}

    # Unicode script character counts
    gujarati_chars = sum(1 for c in text if '\u0A80' <= c <= '\u0AFF')
    hindi_chars = sum(1 for c in text if '\u0900' <= c <= '\u097F')
    total_len = max(1, len(text.strip()))

    if gujarati_chars >= 2:
        conf = min(1.0, 0.75 + (gujarati_chars / total_len) * 0.25)
        return {"language": "Gujarati", "confidence": round(conf, 2), "script": "Gujarati"}

    if hindi_chars >= 2:
        conf = min(1.0, 0.75 + (hindi_chars / total_len) * 0.25)
        return {"language": "Hindi", "confidence": round(conf, 2), "script": "Devanagari"}

    # Latin text analysis: check Gujlish phonetic tokens
    lower_text = text.lower()
    words = set(re.findall(r'[a-zA-Z]+', lower_text))
    matched_gujlish = words.intersection(GUJLISH_PHONETIC_TOKENS)

    if len(matched_gujlish) >= 1:
        # Gujlish detected
        token_ratio = len(matched_gujlish) / max(1, len(words))
        conf = min(1.0, 0.65 + token_ratio * 0.35)
        return {
            "language": "Gujlish",
            "confidence": round(conf, 2),
            "script": "Latin",
            "matched_tokens": list(matched_gujlish)
        }

    return {"language": "English", "confidence": 0.92, "script": "Latin"}


def classify_department(text: str) -> Dict[str, Any]:
    """
    Classifies complaint text into one of 5 transit departments:
    Safety, Lifts & Escalators, Cleanliness, Fare & Ticketing, Staff Behaviour.
    """
    lower_text = text.lower()
    scores: Dict[str, int] = {dept: 0 for dept in DEPARTMENT_KEYWORDS}
    matched_reasons: Dict[str, List[str]] = {dept: [] for dept in DEPARTMENT_KEYWORDS}

    # Contextual override: if lift/escalator mentioned along with stuck/broken, prioritize Lifts & Escalators
    lift_terms = ["lift", "elevator", "escalator", "લિફ્ટ", "એસ્કેલેટર", "लिफ्ट", "एस्केलेटर"]
    has_lift = any(lt in lower_text for lt in lift_terms)

    for dept, kw_dict in DEPARTMENT_KEYWORDS.items():
        for kw, weight in kw_dict.items():
            if kw in lower_text:
                scores[dept] += weight
                matched_reasons[dept].append(kw)

    # If lift is explicitly mentioned and tied with Safety, route to Lifts & Escalators
    if has_lift and scores["Lifts & Escalators"] > 0:
        scores["Lifts & Escalators"] += 6

    # Select department with highest score
    best_dept = max(scores, key=lambda d: scores[d])
    max_score = scores[best_dept]

    if max_score == 0:
        # Default fallback
        best_dept = "Fare & Ticketing" if "metro" in lower_text else "Safety"

    total_score = sum(scores.values()) or 1
    confidence = min(0.99, round(max(0.60, max_score / total_score), 2))

    return {
        "department": best_dept,
        "confidence": confidence,
        "matched_keywords": matched_reasons[best_dept][:5]
    }


def score_urgency(text: str, department: str) -> Dict[str, Any]:
    """
    Scores urgency on 1-5 scale with SLA levels and diagnostic reasoning:
    - P1 Critical (5): Immediate danger to human life, fire, smoke, live wire, trapped passengers
    - P2 High (4): Vulnerable commuters blocked (elderly/wheelchair), active fight, major crowd bottleneck
    - P3 Medium (3): Dirty washrooms, ticketing deduction, turnstile failure, rude staff
    - P4 Low (1-2): Suggestions, feedback, general inquiries
    """
    lower = text.lower()

    # P1 Critical triggers
    p1_indicators = [
        "fire", "smoke", "spark", "sparking", "short circuit", "electric shock",
        "live wire", "trapped", "stuck inside", "unconscious", "faint", "fainted",
        "blood", "heart attack", "weapon", "bomb", "blast", "emergency", "track par",
        "on track", "fall on track", "stampede", "crush", "dense smoke",
        # Gujarati
        "આગ", "ધૂમાડો", "તણખા", "શોર્ટ સર્કિટ", "ખુલ્લા વાયર", "ફસાયા", "ફસાયેલા",
        "બેભાન", "લોહી", "પાટા પર", "ભાગદોડ", "મોટો અકસ્માત",
        # Hindi
        "आग", "धुआं", "शॉर्ट सर्किट", "खुला तार", "फंसे हुए", "फंसा", "बेहोश",
        "खून", "पटरी पर", "भगदड़", "गंभीर चोट", "लावारिस बैग",
        # Gujlish
        "dhuvado", "aag lagi", "fasayela che", "fasai", "kutru aavi"
    ]

    # P2 High triggers
    p2_indicators = [
        "elderly", "wheelchair", "disabled", "pregnant", "slip", "slippery",
        "fall", "fallen", "injured", "theft", "pickpocket", "fight", "assault",
        "women coach", "aggressive", "overflowing", "escalator stopped",
        "escalator bandh", "lift bandh", "broken lift", "out of service",
        # Gujarati
        "વૃદ્ધ", "વરિષ્ઠ", "દિવ્યાંગ", "વ્હીલચેર", "સગર્ભા", "લપસી", "ચોરી",
        "મહિલા કોચ", "એસ્કેલેટર બંધ", "લિફ્ટ બંધ",
        # Hindi
        "वृद्ध", "वरिष्ठ", "दिव्यांग", "व्हीलचेयर", "गर्भवती", "फिसल", "गिर रहे",
        "चोरी", "महिला कोच", "झटका लग रहा", "सो रहा था",
        # Gujlish
        "vruddh", "divyang", "atvayela", "lapasi", "chori", "escalator bandh"
    ]

    # P3 Medium triggers
    p3_indicators = [
        "recharge", "money deducted", "deducted", "refund", "turnstile", "tvm",
        "gate not opening", "washroom", "toilet", "dirty", "stink", "smell",
        "dustbin", "rude", "misbehave", "shouting", "extra fare", "balance",
        # Gujarati
        "રૂપિયા કપાઈ", "પૈસા કપાઈ", "રિફંડ", "શૌચાલય", "ટોયલેટ", "ગંદકી",
        "દુર્ગંધ", "ઉદ્ધત", "બૂમો", "કચરો", "રિચાર્જ",
        # Hindi
        "पैसे कट गए", "रिफंड", "वॉशरूम", "टॉयलेट", "गंदगी", "दुर्गंध",
        "बदतमीजी", "चिल्ला रहा", "कचरा", "रिचार्ज",
        # Gujlish
        "chokhkhaai", "bhaadu", "paisa kapai", "gate khulatu", "badbu",
        "kachro", "safai", "karmachari"
    ]

    # P4 Low triggers
    p4_indicators = [
        "feedback", "suggestion", "timing", "schedule", "display", "time table",
        "information", "next train", "ક્યારે આવશે", "સમયપત્રક", "कब आएगी", "sujav"
    ]

    # Evaluate indicators
    if any(ind in lower for ind in p1_indicators):
        return {
            "score": 5,
            "level": "P1 Critical",
            "reason": "Immediate safety hazard or trapped passengers detected: requires emergency intervention."
        }

    if any(ind in lower for ind in p2_indicators):
        return {
            "score": 4,
            "level": "P2 High",
            "reason": "Significant accessibility barrier for vulnerable commuters or escalating risk requiring prompt mitigation."
        }

    if any(ind in lower for ind in p3_indicators):
        return {
            "score": 3,
            "level": "P3 Medium",
            "reason": "Service disruption in station amenities, ticketing transaction, or staff conduct within standard SLA."
        }

    if any(ind in lower for ind in p4_indicators):
        return {
            "score": 1,
            "level": "P4 Low",
            "reason": "General passenger feedback, route inquiry, or non-urgent operational suggestion."
        }

    # Department-based default fallback
    if department == "Safety":
        return {"score": 4, "level": "P2 High", "reason": "Safety incident reported without critical danger markers."}
    elif department in ("Lifts & Escalators", "Cleanliness", "Fare & Ticketing"):
        return {"score": 3, "level": "P3 Medium", "reason": "Routine passenger operational complaint."}
    else:
        return {"score": 2, "level": "P4 Low", "reason": "Standard service observation."}


def generate_draft_reply(
    language: str,
    department: str,
    station_name: str = "",
    passenger_name: str = "Passenger",
    complaint_id: Optional[int] = None
) -> str:
    """
    Generates polite, empathetic, official Gujarat Metro draft response
    in the passenger's detected language (Gujarati, Hindi, Gujlish, or English).
    """
    token_str = str(complaint_id) if complaint_id else f"{abs(hash(passenger_name + station_name)) % 90000 + 10000}"
    st_label_gu = station_name if station_name else "ગુજરાત મેટ્રો સ્ટેશન"
    st_label_hi = station_name if station_name else "गुजरात मेट्रो स्टेशन"
    st_label_en = station_name if station_name else "Gujarat Metro Network"

    if language == "Gujarati":
        dept_topics_gu = {
            "Safety": "સુરક્ષા અને સલામતી વ્યવસ્થા",
            "Lifts & Escalators": "લિફ્ટ અને એસ્કેલેટર સુવિધા",
            "Cleanliness": "સ્વચ્છતા અને સફાઈ",
            "Fare & Ticketing": "ટિકિટિંગ અને ભાડાં વ્યવહાર",
            "Staff Behaviour": "કર્મચારી સેવા અને વર્તણૂક"
        }
        topic = dept_topics_gu.get(department, "મેટ્રો સુવિધા")
        name = passenger_name if passenger_name != "Passenger" else "મુસાફરશ્રી"
        return (
            f"નમસ્તે {name}. ગુજરાત મેટ્રો (MetroSetu) નો સંપર્ક કરવા બદલ આભાર. "
            f"{st_label_gu} ખાતે {topic} અંગેની આપની ફરિયાદ (ટોકન #{token_str}) ની તાત્કાલિક નોંધ લેવામાં આવી છે. "
            f"અમારા સ્ટેશન કંટ્રોલર અને સંબંધિત સુપરવાઇઝરને ત્વરિત પગલાં લેવા માટે સૂચના આપવામાં આવી છે. "
            f"આપની સુરક્ષા અને સુવિધા અમારી સર્વોચ્ચ પ્રાથમિકતા છે."
        )

    elif language == "Hindi":
        dept_topics_hi = {
            "Safety": "सुरक्षा और संरक्षा",
            "Lifts & Escalators": "लिफ्ट एवं एस्केलेटर सुविधा",
            "Cleanliness": "स्वच्छता और सफाई व्यवस्था",
            "Fare & Ticketing": "टिकटिंग एवं किराया प्रणाली",
            "Staff Behaviour": "कर्मचारी आचरण एवं सेवा"
        }
        topic = dept_topics_hi.get(department, "मेट्रो सेवा")
        name = passenger_name if passenger_name != "Passenger" else "यात्री"
        return (
            f"नमस्ते {name}। गुजरात मेट्रो (MetroSetu) से संपर्क करने के लिए धन्यवाद। "
            f"{st_label_hi} पर {topic} से संबंधित आपकी शिकायत (टोकन #{token_str}) दर्ज कर ली गई है। "
            f"हमारे स्टेशन नियंत्रक एवं तकनीकी दल द्वारा त्वरित समाधान के लिए आवश्यक कदम उठाए जा रहे हैं। "
            f"आपकी सुरक्षा और सुविधा हमारी सर्वोच्च प्राथमिकता है।"
        )

    elif language == "Gujlish":
        dept_topics_gj = {
            "Safety": "Safety ane suraksha",
            "Lifts & Escalators": "Lift ane escalator suvidha",
            "Cleanliness": "Chokhkhaai ane safai",
            "Fare & Ticketing": "Ticketing ane fare baabate",
            "Staff Behaviour": "Staff na vartan baabate"
        }
        topic = dept_topics_gj.get(department, "Metro suvidha")
        name = passenger_name if passenger_name != "Passenger" else "Passenger"
        return (
            f"Namaste {name}. Gujarat Metro (MetroSetu) no sampark karva badal aabhar. "
            f"{st_label_en} par {topic} baabate tamari fariyad (Token #{token_str}) nondhi levama aavi che. "
            f"Amara station controller ane technical team dwara turant pagla levama aavi rahya che. "
            f"MetroSetu portal par tame status track kari shako cho. Aabhar!"
        )

    else:  # English
        dept_topics_en = {
            "Safety": "passenger safety and hazard prevention",
            "Lifts & Escalators": "lift and escalator accessibility",
            "Cleanliness": "station cleanliness and hygiene",
            "Fare & Ticketing": "ticketing and fare transactions",
            "Staff Behaviour": "staff conduct and passenger service"
        }
        topic = dept_topics_en.get(department, "metro transit operations")
        name = passenger_name if passenger_name != "Passenger" else "Commuter"
        return (
            f"Dear {name}, thank you for contacting Gujarat Metro (MetroSetu). "
            f"Your complaint regarding {topic} at {st_label_en} has been registered under Ticket #{token_str}. "
            f"Our station superintendent and technical operations team have been alerted for immediate action. "
            f"Passenger safety and seamless service remain our highest priority."
        )


def triage_complaint(
    text: str,
    station_name: str = "",
    passenger_name: str = "Passenger",
    complaint_id: Optional[int] = None
) -> Dict[str, Any]:
    """
    Unified on-device Multilingual NLP Triage pipeline:
    1. Detects script and language (Gujarati, Hindi, Gujlish, English).
    2. Classifies target transit department (Safety, Lifts & Escalators, Cleanliness, Fare & Ticketing, Staff Behaviour).
    3. Scores urgency (P1 to P4) with diagnostic reasoning.
    4. Generates trilingual/multilingual empathetic response.
    """
    lang_info = detect_language(text)
    detected_lang = lang_info["language"]

    dept_info = classify_department(text)
    dept = dept_info["department"]

    urgency_info = score_urgency(text, dept)

    draft_reply = generate_draft_reply(
        language=detected_lang,
        department=dept,
        station_name=station_name,
        passenger_name=passenger_name,
        complaint_id=complaint_id
    )

    return {
        "detected_language": detected_lang,
        "language_confidence": lang_info["confidence"],
        "script": lang_info.get("script", "Latin"),
        "department": dept,
        "department_confidence": dept_info["confidence"],
        "urgency_score": urgency_info["score"],
        "urgency_level": urgency_info["level"],
        "urgency_reason": urgency_info["reason"],
        "draft_reply": draft_reply
    }


def batch_triage_complaints(complaints: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Performs batch NLP triage across a list of complaints in-memory.
    """
    results = []
    for item in complaints:
        raw_text = item.get("raw_text", "")
        station_name = item.get("station_name", "")
        passenger_name = item.get("passenger_name", "Passenger")
        c_id = item.get("id")

        triage = triage_complaint(
            text=raw_text,
            station_name=station_name,
            passenger_name=passenger_name,
            complaint_id=c_id
        )

        merged = dict(item)
        merged.update(triage)
        results.append(merged)

    return results
