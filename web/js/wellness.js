// Auswertung von Garmin-Wellness-Dateien (GARMIN/Monitor, Dateityp "monitoring") und
// Schlafdateien (GARMIN/Sleep) zu Tageswerten. Erwartet die Nachrichten, wie sie der
// Decoder des Garmin FIT SDK liefert; ohne DOM-Zugriff, damit auch mit Node testbar.

const FIT_EPOCH = 631065600; // Sekunden zwischen 1970-01-01 und 1989-12-31 (FIT-Zeitbasis)
const toFitSec = (d) => Math.round(new Date(d).getTime() / 1000) - FIT_EPOCH;

function localClock(fitSec, offset) {
  const d = new Date((fitSec + offset + FIT_EPOCH) * 1000);
  return { date: d.toISOString().slice(0, 10), minute: d.getUTCHours() * 60 + d.getUTCMinutes(), iso: d.toISOString().slice(0, 16) };
}

// Zeitverschiebung zur Ortszeit aus monitoring_info (local_timestamp − timestamp)
function utcOffset(messages) {
  const info = messages.monitoringInfoMesgs?.[0];
  if (info?.localTimestamp != null && info.timestamp) return info.localTimestamp - toFitSec(info.timestamp);
  const sleepInfo = (messages[273] || [])[0]; // Schlafdatei: Feld 2 = Ortszeit, Feld 253 = UTC
  if (sleepInfo && sleepInfo[2] != null && sleepInfo[253] != null) return sleepInfo[2] - sleepInfo[253];
  return 0;
}

export function isWellnessFile(messages) {
  const type = messages.fileIdMesgs?.[0]?.type;
  return type === "monitoringA" || type === "monitoringB" || type === "monitoringDaily" || !!messages.monitoringMesgs?.length;
}

export function isSleepFile(messages) {
  return !!messages.sleepLevelMesgs?.length;
}

export function parseWellness(messages) {
  const offset = utcOffset(messages);
  const rmr = messages.monitoringInfoMesgs?.[0]?.restingMetabolicRate ?? null;
  const days = new Map();
  const day = (date) => {
    if (!days.has(date)) days.set(date, { date, byType: {}, hr: [], stress: [], restingHr: null });
    return days.get(date);
  };

  let last = null;
  for (const m of messages.monitoringMesgs || []) {
    let t;
    if (m.timestamp) t = toFitSec(m.timestamp);
    else if (m.timestamp16 != null && last != null) {
      // Komprimierter Zeitstempel: untere 16 Bit relativ zum letzten vollständigen Zeitstempel
      t = last - (last & 0xffff) + m.timestamp16;
      if (t < last) t += 0x10000;
    } else continue;
    last = t;
    const c = localClock(t, offset);
    // Tagessummen je Aktivitätsart sind kumuliert seit Mitternacht; der letzte Wert zählt
    if (m.durationMin != null && m.activityType != null) {
      day(c.date).byType[m.activityType] = { steps: m.steps || 0, distance: m.distance || 0, activeCalories: m.activeCalories || 0 };
    }
    if (m.heartRate) day(c.date).hr.push([c.minute, m.heartRate]);
  }
  for (const m of messages.monitoringHrDataMesgs || []) {
    const rhr = m.currentDayRestingHeartRate ?? m.restingHeartRate;
    if (rhr && m.timestamp) day(localClock(toFitSec(m.timestamp), offset).date).restingHr = rhr;
  }
  for (const m of messages.stressLevelMesgs || []) {
    // Negative Werte bedeuten "nicht messbar" (z. B. Bewegung)
    if (m.stressLevelValue >= 0 && m.stressLevelTime) day(localClock(toFitSec(m.stressLevelTime), offset).date).stress.push(m.stressLevelValue);
  }

  return [...days.values()].map((d) => {
    const types = Object.values(d.byType);
    const out = { date: d.date };
    if (types.length) {
      out.steps = types.reduce((s, x) => s + x.steps, 0);
      out.distanceKm = Math.round(types.reduce((s, x) => s + x.distance, 0) / 10) / 100;
      out.activeCalories = types.reduce((s, x) => s + x.activeCalories, 0);
      // Garmin-Gesamtkalorien = Grundumsatz des Tages + aktive Kalorien
      if (rmr) out.calories = rmr + out.activeCalories;
    }
    if (d.restingHr) out.restingHr = d.restingHr;
    if (d.stress.length) out.stress = Math.round(d.stress.reduce((s, x) => s + x, 0) / d.stress.length);
    if (d.hr.length) {
      const buckets = Array.from({ length: 144 }, () => []);
      for (const [minute, hr] of d.hr) buckets[Math.min(143, Math.floor(minute / 10))].push(hr);
      out.hrDay = buckets.map((b) => (b.length ? Math.round(b.reduce((s, x) => s + x, 0) / b.length) : null));
    }
    return out;
  });
}

// Schlafphasen aus sleep_level; liefert nur eine Nacht, wenn tatsächlich Schlaf erkannt wurde.
const LEVELS = { deep: "deep", light: "light", rem: "rem", awake: "awake" };
export function parseSleep(messages) {
  const offset = utcOffset(messages);
  const levels = (messages.sleepLevelMesgs || [])
    .filter((m) => m.timestamp && LEVELS[m.sleepLevel])
    .map((m) => ({ t: toFitSec(m.timestamp), level: LEVELS[m.sleepLevel] }))
    .sort((a, b) => a.t - b.t);
  if (levels.length < 2 || levels.every((l) => l.level === "awake")) return null;

  const start = levels[0].t;
  const segments = [];
  for (let i = 0; i < levels.length - 1; i++) {
    const a = Math.round((levels[i].t - start) / 60);
    const b = Math.round((levels[i + 1].t - start) / 60);
    const prev = segments.at(-1);
    if (prev && prev[2] === levels[i].level && prev[1] === a) prev[1] = b;
    else if (b > a) segments.push([a, b, levels[i].level]);
  }
  const stages = { deep: 0, light: 0, rem: 0, awake: 0 };
  for (const [a, b, level] of segments) stages[level] += b - a;
  const begin = localClock(start, offset);
  const end = localClock(levels.at(-1).t, offset);
  return {
    date: end.date, // Garmin ordnet eine Nacht dem Tag des Aufwachens zu
    sleepHours: Math.round(((stages.deep + stages.light + stages.rem) / 60) * 100) / 100,
    sleepStages: stages,
    sleepLevels: { start: begin.iso.slice(11, 16), segments },
  };
}

// Führt Tageswerte zusammen; vorhandene Werte werden ergänzt, Tagesverläufe je 10-Minuten-Block gemischt.
export function mergeDaily(existing, incoming) {
  const map = new Map(existing.map((d) => [d.date, { ...d }]));
  for (const d of incoming) {
    const cur = map.get(d.date) || { date: d.date };
    for (const [k, v] of Object.entries(d)) {
      if (k === "hrDay" && cur.hrDay) cur.hrDay = cur.hrDay.map((x, i) => v[i] ?? x);
      else if (k === "steps" || k === "activeCalories" || k === "calories" || k === "distanceKm") cur[k] = Math.max(cur[k] ?? 0, v);
      else cur[k] = v;
    }
    map.set(d.date, cur);
  }
  return [...map.values()].sort((a, b) => a.date.localeCompare(b.date));
}
