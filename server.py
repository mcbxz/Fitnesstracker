"""Lokaler Server für das Trainings-Dashboard.

Liefert die Oberfläche aus ``web/`` aus und stellt eine kleine API bereit:

  GET  /api/data   gespeicherte Garmin-Daten (data/garmin.json)
  POST /api/sync   Daten neu aus Garmin Connect laden
  GET  /api/plan   Trainingsplan (data/plan.json)
  PUT  /api/plan   Trainingsplan speichern

Der Server lauscht standardmäßig nur auf 127.0.0.1, da er Zugriff auf das
Garmin-Konto hat.  Aufruf:  python server.py [--port 8000]
"""

from __future__ import annotations

import argparse
import json
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock

import garmin_sync

ROOT = Path(__file__).resolve().parent
WEB_DIR = ROOT / "web"
PLAN_FILE = ROOT / "data" / "plan.json"
MAX_BODY = 256 * 1024

_sync_lock = Lock()


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self) -> None:
        # Oberfläche nach Updates ohne veralteten Browser-Cache laden
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _json(self, status: int, payload) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self):
        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY:
            raise ValueError("Anfrage zu groß")
        return json.loads(self.rfile.read(length) or b"{}")

    def do_GET(self) -> None:
        if self.path == "/api/data":
            if not garmin_sync.DATA_FILE.exists():
                return self._json(HTTPStatus.NOT_FOUND, {"error": "Noch keine Garmin-Daten synchronisiert."})
            return self._json(HTTPStatus.OK, json.loads(garmin_sync.DATA_FILE.read_text(encoding="utf-8")))
        if self.path == "/api/plan":
            if not PLAN_FILE.exists():
                return self._json(HTTPStatus.NOT_FOUND, {"error": "Kein Trainingsplan gespeichert."})
            return self._json(HTTPStatus.OK, json.loads(PLAN_FILE.read_text(encoding="utf-8")))
        return super().do_GET()

    def do_POST(self) -> None:
        if self.path != "/api/sync":
            return self._json(HTTPStatus.NOT_FOUND, {"error": "Unbekannter Endpunkt"})
        try:
            days = int(self._read_json().get("days", 120))
        except (ValueError, TypeError, AttributeError):
            return self._json(HTTPStatus.BAD_REQUEST, {"error": "Ungültige Anfrage"})
        if not _sync_lock.acquire(blocking=False):
            return self._json(HTTPStatus.CONFLICT, {"error": "Synchronisation läuft bereits."})
        try:
            return self._json(HTTPStatus.OK, garmin_sync.sync(max(7, min(days, 365))))
        except garmin_sync.SyncError as exc:
            return self._json(HTTPStatus.UNAUTHORIZED, {"error": str(exc)})
        except Exception as exc:  # Netzwerk- oder API-Fehler an die Oberfläche melden
            return self._json(HTTPStatus.BAD_GATEWAY, {"error": f"Garmin Connect nicht erreichbar: {exc}"})
        finally:
            _sync_lock.release()

    def do_PUT(self) -> None:
        if self.path != "/api/plan":
            return self._json(HTTPStatus.NOT_FOUND, {"error": "Unbekannter Endpunkt"})
        try:
            plan = self._read_json()
            if not isinstance(plan, dict) or not isinstance(plan.get("week"), list):
                raise ValueError("Plan benötigt das Feld 'week'")
        except ValueError as exc:
            return self._json(HTTPStatus.BAD_REQUEST, {"error": str(exc)})
        PLAN_FILE.parent.mkdir(exist_ok=True)
        PLAN_FILE.write_text(json.dumps(plan, ensure_ascii=False, indent=1), encoding="utf-8")
        return self._json(HTTPStatus.OK, plan)


def main() -> None:
    parser = argparse.ArgumentParser(description="Trainings-Dashboard starten")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8000)
    args = parser.parse_args()
    server = ThreadingHTTPServer((args.host, args.port), partial(Handler, directory=str(WEB_DIR)))
    print(f"Dashboard läuft auf http://{args.host}:{args.port}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
