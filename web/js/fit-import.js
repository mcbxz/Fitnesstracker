// Import von FIT-Dateien (z. B. per USB aus GARMIN/Activity kopiert) mit dem offiziellen Garmin FIT SDK.

const FIT_SDK_URL = "https://cdn.jsdelivr.net/npm/@garmin/fitsdk@21.214.0/+esm";

const SPORT_MAP = {
  running: "run", cycling: "bike", swimming: "swim", training: "strength",
  fitnessEquipment: "strength", walking: "walk", hiking: "walk",
};

let sdk;

export async function loadFitSdk() {
  sdk ??= await import(FIT_SDK_URL);
  return sdk;
}

export async function parseFitFile(file, profile) {
  await loadFitSdk();
  const stream = sdk.Stream.fromArrayBuffer(await file.arrayBuffer());
  const decoder = new sdk.Decoder(stream);
  if (!decoder.isFIT()) throw new Error(`${file.name} ist keine FIT-Datei.`);
  const { messages, errors } = decoder.read();
  if (errors.length) throw new Error(`${file.name}: ${errors[0].message}`);

  const session = messages.sessionMesgs?.[0];
  if (!session) throw new Error(`${file.name} enthält keine Aktivität.`);
  const start = new Date(session.startTime);
  const pad = (n) => String(n).padStart(2, "0");
  const startLocal = `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}:00`;

  return {
    id: `fit-${start.getTime()}`,
    start: startLocal,
    sport: SPORT_MAP[session.sport] || "other",
    name: session.sportProfileName || session.sport || file.name,
    durationSec: Math.round(session.totalTimerTime || 0),
    distanceM: Math.round(session.totalDistance || 0),
    avgHr: session.avgHeartRate,
    maxHr: session.maxHeartRate,
    elevationM: Math.round(session.totalAscent || 0),
    intensitySec: intensityFromRecords(messages.recordMesgs || [], profile),
    source: "fit",
  };
}

// Zeit pro Intensitätsbereich aus den sekündlichen bzw. intelligenten Aufzeichnungen
export function intensityFromRecords(records, profile) {
  const sec = [0, 0, 0];
  let any = false;
  for (let i = 1; i < records.length; i++) {
    const hr = records[i].heartRate;
    if (!hr) continue;
    const dt = (new Date(records[i].timestamp) - new Date(records[i - 1].timestamp)) / 1000;
    if (!(dt > 0 && dt <= 30)) continue; // Pausen nicht mitzählen
    const pct = hr / profile.hrMax;
    sec[pct < profile.lt1Pct ? 0 : pct < profile.lt2Pct ? 1 : 2] += dt;
    any = true;
  }
  return any ? sec.map(Math.round) : undefined;
}
