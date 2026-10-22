"""Synchronisiert Aktivitäten und Erholungswerte aus Garmin Connect.

Nutzt die inoffizielle Bibliothek ``garminconnect``. Beim ersten Aufruf werden
E-Mail und Passwort (aus Umgebungsvariablen oder interaktiv) abgefragt; danach
werden nur noch die Tokens aus ``~/.garminconnect`` verwendet.

Aufruf:  python garmin_sync.py [--days 120]
         python garmin_sync.py --export-tokens   (Tokens als JSON für GARMINTOKENS ausgeben)
"""

from __future__ import annotations

import argparse
import getpass
import json
import os
import sys
from datetime import date, datetime, timedelta, timezone
from itertools import permutations
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DATA_FILE = ROOT / "data" / "garmin.json"
TOKENSTORE = os.getenv("GARMINTOKENS", "~/.garminconnect")

# Garmin-Aktivitätstypen -> vereinfachte Sportart der Oberfläche
SPORT_MAP = {
    "running": "run", "trail_running": "run", "treadmill_running": "run", "track_running": "run",
    "cycling": "bike", "road_biking": "bike", "mountain_biking": "bike", "gravel_cycling": "bike",
    "indoor_cycling": "bike", "virtual_ride": "bike",
    "lap_swimming": "swim", "open_water_swimming": "swim",
    "strength_training": "strength", "hiit": "strength",
    "walking": "walk", "hiking": "walk",
    "yoga": "mobility", "pilates": "mobility",
}


class SyncError(Exception):
    pass


def _client(interactive: bool):
    try:
        from garminconnect import Garmin, GarminConnectAuthenticationError
    except ImportError as exc:
        raise SyncError("Paket 'garminconnect' fehlt: pip install -r requirements.txt") from exc

    email = os.getenv("GARMIN_EMAIL")
    password = os.getenv("GARMIN_PASSWORD")
    if TOKENSTORE.lstrip().startswith("{"):
        has_tokens = True  # Tokens direkt als JSON in GARMINTOKENS (z. B. als Umgebungs-Secret in der Cloud)
    else:
        tokens = Path(TOKENSTORE).expanduser()
        has_tokens = tokens.exists() and any(tokens.iterdir()) if tokens.is_dir() else tokens.exists()

    if not has_tokens and not (email and password):
        if not interactive:
            raise SyncError(
                "Keine gespeicherte Anmeldung. Bitte einmalig 'python garmin_sync.py' im Terminal "
                "ausführen oder GARMIN_EMAIL/GARMIN_PASSWORD setzen."
            )
        email = input("Garmin-E-Mail: ").strip()
        password = getpass.getpass("Garmin-Passwort: ")

    prompt_mfa = (lambda: input("MFA-Code (Multi-Faktor-Authentifizierung): ").strip()) if interactive else None
    client = Garmin(email, password, prompt_mfa=prompt_mfa, return_on_mfa=not interactive)
    try:
        needs_mfa, _ = client.login(TOKENSTORE)
    except GarminConnectAuthenticationError as exc:
        raise SyncError(f"Anmeldung bei Garmin Connect fehlgeschlagen: {exc}") from exc
    if needs_mfa:
        raise SyncError("Garmin verlangt einen MFA-Code. Bitte einmalig 'python garmin_sync.py' im Terminal ausführen.")
    return client


def _safe(fn, *args, default=None):
    try:
        return fn(*args)
    except Exception as exc:  # einzelne fehlende Tageswerte sollen die Synchronisation nicht abbrechen
        print(f"  Hinweis: {fn.__name__}{args} nicht verfügbar ({exc.__class__.__name__})", file=sys.stderr)
        return default


def _activity(raw: dict) -> dict:
    type_key = (raw.get("activityType") or {}).get("typeKey", "other")
    start = raw.get("startTimeLocal") or raw.get("startTimeGMT") or ""
    return {
        "id": f"garmin-{raw.get('activityId')}",
        "start": start.replace(" ", "T"),
        "sport": SPORT_MAP.get(type_key, "other"),
        "name": raw.get("activityName") or type_key,
        "durationSec": round(raw.get("movingDuration") or raw.get("duration") or 0),
        "distanceM": round(raw.get("distance") or 0),
        "avgHr": raw.get("averageHR"),
        "maxHr": raw.get("maxHR"),
        "elevationM": round(raw.get("elevationGain") or 0),
        "avgSpeed": raw.get("averageSpeed"),
        "aerobicTE": raw.get("aerobicTrainingEffect"),
        "anaerobicTE": raw.get("anaerobicTrainingEffect"),
        "trainingLoad": raw.get("activityTrainingLoad"),
        "vo2max": raw.get("vO2MaxValue"),
        "source": "garmin",
    }


# Garmin unterscheidet vier Schlafphasen: tief, leicht, REM und wach.
# Vermutete Kodierung von activityLevel in sleepLevels; wird je Nacht gegen die Phasensummen geprüft.
SLEEP_LEVELS = {0: "deep", 1: "light", 2: "rem", 3: "awake"}
STAGE_FIELDS = {"deep": "deepSleepSeconds", "light": "lightSleepSeconds", "rem": "remSleepSeconds", "awake": "awakeSleepSeconds"}


def _level_mapping(durations: dict[int, float], dto: dict) -> dict[int, str]:
    """Ordnet die Zahlencodes den Phasen so zu, dass die Minuten zu Garmins Phasensummen passen."""
    totals = {stage: (dto.get(field) or 0) / 60 for stage, field in STAGE_FIELDS.items()}
    if not any(totals.values()):
        return SLEEP_LEVELS
    codes = sorted(durations)
    best, best_err = SLEEP_LEVELS, None
    for stages in permutations(STAGE_FIELDS, len(codes)):
        err = sum(abs(durations[c] - totals[st]) for c, st in zip(codes, stages))
        if best_err is None or err < best_err:
            best, best_err = dict(zip(codes, stages)), err
    # Die Standardzuordnung behalten, wenn sie praktisch genauso gut passt
    default_err = sum(abs(durations[c] - totals.get(SLEEP_LEVELS.get(c, ""), 0)) for c in codes)
    return SLEEP_LEVELS if default_err <= best_err + 1 else best


def _hypnogram(sleep_raw: dict, dto: dict) -> dict | None:
    """Schlafphasen als Minuten seit Einschlafen (Ortszeit)."""
    levels = sleep_raw.get("sleepLevels") or []
    start_gmt = dto.get("sleepStartTimestampGMT")
    start_local = dto.get("sleepStartTimestampLocal")
    if not levels or not start_gmt or not start_local:
        return None

    def minutes(ts: str) -> int:
        t = datetime.fromisoformat(ts.replace("Z", "")).replace(tzinfo=timezone.utc)
        return round((t.timestamp() * 1000 - start_gmt) / 60000)

    raw_segments = [
        (minutes(lv["startGMT"]), minutes(lv["endGMT"]), round(lv["activityLevel"]))
        for lv in levels
        if lv.get("startGMT") and lv.get("endGMT") and lv.get("activityLevel") is not None
    ]
    durations: dict[int, float] = {}
    for a, b, code in raw_segments:
        durations[code] = durations.get(code, 0) + (b - a)
    mapping = _level_mapping(durations, dto) if 0 < len(durations) <= 4 else SLEEP_LEVELS
    segments = [[a, b, mapping[code]] for a, b, code in raw_segments if code in mapping]
    start = datetime.fromtimestamp(start_local / 1000, tz=timezone.utc).strftime("%H:%M")
    return {"start": start, "segments": segments} if segments else None


def _intraday_hr(client, iso: str) -> list | None:
    """Herzfrequenz im Tagesverlauf, gemittelt auf 10-Minuten-Blöcke (Ortszeit)."""
    raw = _safe(client.get_heart_rates, iso) or {}
    values = raw.get("heartRateValues") or []
    offset = (raw.get("startTimestampLocal") and raw.get("startTimestampGMT")) and (
        datetime.fromisoformat(raw["startTimestampLocal"]) - datetime.fromisoformat(raw["startTimestampGMT"])
    )
    if not values or offset is None:
        return None
    buckets: list[list[int]] = [[] for _ in range(144)]
    for ts, bpm in values:
        if bpm is None:
            continue
        local = datetime.fromtimestamp(ts / 1000, tz=timezone.utc).replace(tzinfo=None) + offset
        if local.date().isoformat() == iso:
            buckets[(local.hour * 60 + local.minute) // 10].append(bpm)
    series = [round(sum(b) / len(b)) if b else None for b in buckets]
    return series if any(series) else None


def _daily(client, day: date, detailed: bool = False) -> dict:
    iso = day.isoformat()
    entry: dict = {"date": iso}

    hrv = _safe(client.get_hrv_data, iso) or {}
    summary = hrv.get("hrvSummary") or {}
    baseline = summary.get("baseline") or {}
    entry["hrv"] = summary.get("lastNightAvg")
    entry["hrvWeeklyAvg"] = summary.get("weeklyAvg")
    entry["hrvStatus"] = summary.get("status")
    if baseline.get("balancedLow") and baseline.get("balancedUpper"):
        entry["hrvBaseline"] = [baseline["balancedLow"], baseline["balancedUpper"]]

    sleep_raw = _safe(client.get_sleep_data, iso) or {}
    sleep = sleep_raw.get("dailySleepDTO") or {}
    if sleep.get("sleepTimeSeconds"):
        entry["sleepHours"] = round(sleep["sleepTimeSeconds"] / 3600, 2)
        for key, field in (("deep", "deepSleepSeconds"), ("rem", "remSleepSeconds"),
                           ("light", "lightSleepSeconds"), ("awake", "awakeSleepSeconds")):
            if sleep.get(field) is not None:
                entry.setdefault("sleepStages", {})[key] = round(sleep[field] / 60)
    score = ((sleep.get("sleepScores") or {}).get("overall") or {}).get("value")
    if score is not None:
        entry["sleepScore"] = score
    entry["respiration"] = sleep.get("averageRespirationValue")

    stats = _safe(client.get_stats, iso) or {}
    entry["restingHr"] = stats.get("restingHeartRate")
    entry["bodyBattery"] = stats.get("bodyBatteryHighestValue")
    entry["bodyBatteryLow"] = stats.get("bodyBatteryLowestValue")
    entry["bodyBatteryCharged"] = stats.get("bodyBatteryChargedValue")
    entry["stress"] = stats.get("averageStressLevel")
    entry["steps"] = stats.get("totalSteps")
    entry["stepGoal"] = stats.get("dailyStepGoal")
    entry["calories"] = stats.get("totalKilocalories")
    entry["activeCalories"] = stats.get("activeKilocalories")
    if stats.get("totalDistanceMeters") is not None:
        entry["distanceKm"] = round(stats["totalDistanceMeters"] / 1000, 2)

    # Tagesverlauf und Schlafphasen nur für die letzten Tage, um Abrufe zu begrenzen
    if detailed:
        entry["hrDay"] = _intraday_hr(client, iso)
        entry["sleepLevels"] = _hypnogram(sleep_raw, sleep)
    return {k: v for k, v in entry.items() if v is not None}


def _vo2max_series(client, start: date, end: date) -> list[dict]:
    """VO2max-Verlauf (Tageswerte), soweit Garmin ihn liefert."""
    raw = _safe(client.get_max_metrics_range, start.isoformat(), end.isoformat()) or []
    entries = raw if isinstance(raw, list) else raw.get("maxMetrics") or raw.get("allMetrics") or []
    series = []
    for e in entries:
        generic = (e or {}).get("generic") or {}
        value = generic.get("vo2MaxPreciseValue") or generic.get("vo2MaxValue")
        day = generic.get("calendarDate") or (e or {}).get("calendarDate")
        if value and day:
            series.append({"date": day[:10], "vo2max": round(float(value), 1)})
    return sorted(series, key=lambda x: x["date"])


def _profile(client, activities: list[dict]) -> dict:
    profile: dict = {"name": _safe(client.get_full_name) or ""}
    user = (_safe(client.get_user_profile) or {}).get("userData") or {}
    if user.get("gender"):
        profile["sex"] = "female" if user["gender"].upper() == "FEMALE" else "male"
    if user.get("birthDate"):
        born = date.fromisoformat(user["birthDate"])
        today = date.today()
        profile["age"] = today.year - born.year - ((today.month, today.day) < (born.month, born.day))
    observed = [a["maxHr"] for a in activities if a.get("maxHr")]
    if observed:
        profile["observedHrMax"] = max(observed)
    return profile


def sync(days: int = 120, interactive: bool = False) -> dict:
    client = _client(interactive)
    end = date.today()
    start = end - timedelta(days=days - 1)

    print(f"Lade Aktivitäten {start} bis {end} …", file=sys.stderr)
    raw = client.get_activities_by_date(start.isoformat(), end.isoformat()) or []
    activities = sorted((_activity(a) for a in raw), key=lambda a: a["start"])

    # Tageswerte (Schritte, HRV, Ruhepuls, Schlaf …) für gut zwei Monate, damit Monatsvergleiche möglich sind
    daily_days = min(days, 62)
    print(f"Lade Tageswerte der letzten {daily_days} Tage …", file=sys.stderr)
    daily = [_daily(client, end - timedelta(days=i), detailed=i < 14) for i in range(daily_days - 1, -1, -1)]

    vo2max = _vo2max_series(client, start, end)

    data = {
        "source": "garmin",
        "syncedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "profile": _profile(client, activities),
        "activities": activities,
        "daily": daily,
        "vo2max": vo2max,
    }
    DATA_FILE.parent.mkdir(exist_ok=True)
    DATA_FILE.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(activities)} Aktivitäten gespeichert in {DATA_FILE}", file=sys.stderr)
    return data


def send_workout(workout: dict, schedule_date: str | None = None) -> dict:
    """Lädt ein Workout (Garmin-Connect-JSON) hoch und plant es optional im Kalender ein.

    Die Uhr übernimmt geplante Workouts bei der nächsten Synchronisation mit Garmin Connect.
    """
    client = _client(interactive=False)
    created = client.upload_workout(workout)
    workout_id = created.get("workoutId")
    if not workout_id:
        raise SyncError("Garmin Connect hat das Workout nicht angenommen.")
    result = {"workoutId": workout_id, "scheduled": None}
    if schedule_date:
        date.fromisoformat(schedule_date)  # wirft ValueError bei ungültigem Datum
        client.schedule_workout(workout_id, schedule_date)
        result["scheduled"] = schedule_date
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=120, help="Zeitraum in Tagen (Standard: 120)")
    parser.add_argument("--export-tokens", action="store_true",
                        help="Anmelden und die Tokens als JSON ausgeben (für GARMINTOKENS in einer Cloud-Umgebung)")
    args = parser.parse_args()
    try:
        if args.export_tokens:
            print(_client(interactive=sys.stdin.isatty()).client.dumps())
            return
        sync(args.days, interactive=sys.stdin.isatty())
    except SyncError as exc:
        sys.exit(str(exc))


if __name__ == "__main__":
    main()
