// Import von FIT-Dateien per USB (GARMIN/Activity, GARMIN/Monitor, GARMIN/Sleep) mit dem offiziellen Garmin FIT SDK.
import { isSleepFile, isWellnessFile, parseSleep, parseWellness } from "./wellness.js";

const FIT_SDK_URL = "https://cdn.jsdelivr.net/npm/@garmin/fitsdk@21.214.0/+esm";

const SPORT_MAP = {
  running: "run", cycling: "bike", swimming: "swim", training: "strength",
  fitnessEquipment: "strength", walking: "walk", hiking: "hike", hiit: "hiit",
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
  return parseFitMessages(messages, profile, file.name);
}

// Wertet bereits dekodierte FIT-Nachrichten aus (auch unter Node nutzbar).
export function parseFitMessages(messages, profile, name = "FIT-Datei") {
  // Wellness- und Schlafdateien liefern Tageswerte statt einer Aktivität
  if (isWellnessFile(messages)) return { kind: "daily", days: parseWellness(messages) };
  if (isSleepFile(messages)) {
    const night = parseSleep(messages);
    return { kind: "daily", days: night ? [night] : [], note: night ? null : `${name}: keine Schlafphasen enthalten (nur Wachzeit).` };
  }

  const session = messages.sessionMesgs?.[0];
  if (!session) throw new Error(`${name} enthält weder eine Aktivität noch Wellness- oder Schlafdaten.`);
  const start = new Date(session.startTime);
  const pad = (n) => String(n).padStart(2, "0");
  // Ortszeit der Aufzeichnung aus activity.local_timestamp; sonst Zeitzone des Browsers
  const act = messages.activityMesgs?.[0];
  const offsetSec = act?.localTimestamp != null && act.timestamp ? act.localTimestamp - (Math.round(new Date(act.timestamp).getTime() / 1000) - 631065600) : null;
  const startLocal = offsetSec != null
    ? new Date(start.getTime() + offsetSec * 1000).toISOString().slice(0, 16) + ":00"
    : `${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}T${pad(start.getHours())}:${pad(start.getMinutes())}:00`;
  const profileName = session.sportProfileName || "";
  const sport = /hiit/i.test(profileName) ? "hiit" : SPORT_MAP[session.sport] || "other";
  const user = messages.userProfileMesgs?.[0];
  const zones = messages.zonesTargetMesgs?.[0];

  return {
    kind: "activity",
    activity: {
      id: `fit-${start.getTime()}`,
      start: startLocal,
      sport,
      name: profileName || session.sport || name,
      durationSec: Math.round(session.totalTimerTime || 0),
      distanceM: Math.round(session.totalDistance || 0),
      avgHr: session.avgHeartRate,
      maxHr: session.maxHeartRate,
      avgSpeed: session.enhancedAvgSpeed ?? session.avgSpeed,
      calories: session.totalCalories,
      elevationM: Math.round(session.totalAscent || 0),
      aerobicTE: session.totalTrainingEffect,
      anaerobicTE: session.totalAnaerobicTrainingEffect,
      intensitySec: intensityFromRecords(messages.recordMesgs || [], profile),
      source: "fit",
    },
    // Angaben aus den Einstellungen der Uhr (Maximalpuls, Geschlecht, Gewicht)
    profile: {
      ...(zones?.maxHeartRate ? { deviceHrMax: zones.maxHeartRate } : {}),
      ...(user?.gender === "male" || user?.gender === "female" ? { sex: user.gender } : {}),
      ...(user?.weight ? { weightKg: user.weight } : {}),
    },
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
