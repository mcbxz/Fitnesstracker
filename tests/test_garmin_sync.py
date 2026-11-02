"""Tests für die Umrechnung der Garmin-Schlafphasen (ohne Netzwerkzugriff)."""

import unittest

import garmin_sync

START = 1_761_000_000_000  # Einschlafzeitpunkt in ms (GMT)


def iso(minute: int) -> str:
    from datetime import datetime, timezone

    return datetime.fromtimestamp(START / 1000 + minute * 60, tz=timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.0")


def night(codes):
    levels, t = [], 0
    for code, length in codes:
        levels.append({"startGMT": iso(t), "endGMT": iso(t + length), "activityLevel": float(code)})
        t += length
    return {"sleepLevels": levels}


class HypnogramTest(unittest.TestCase):
    dto = {
        "sleepStartTimestampGMT": START,
        "sleepStartTimestampLocal": START + 2 * 3600 * 1000,
        "deepSleepSeconds": 90 * 60,
        "lightSleepSeconds": 200 * 60,
        "remSleepSeconds": 100 * 60,
        "awakeSleepSeconds": 20 * 60,
    }

    def stages(self, result):
        totals = {}
        for a, b, level in result["segments"]:
            totals[level] = totals.get(level, 0) + b - a
        return totals

    def test_standard_coding(self):
        raw = night([(1, 100), (0, 90), (1, 100), (2, 100), (3, 20)])
        result = garmin_sync._hypnogram(raw, self.dto)
        self.assertEqual(result["start"], "00:40")
        self.assertEqual(self.stages(result), {"light": 200, "deep": 90, "rem": 100, "awake": 20})

    def test_other_coding_is_detected(self):
        # Gleiche Nacht, aber vertauschte Codes für tief und leicht
        raw = night([(0, 100), (1, 90), (0, 100), (2, 100), (3, 20)])
        result = garmin_sync._hypnogram(raw, self.dto)
        self.assertEqual(self.stages(result), {"light": 200, "deep": 90, "rem": 100, "awake": 20})


if __name__ == "__main__":
    unittest.main()
