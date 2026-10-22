// Beispieldaten, solange keine Garmin-Daten vorliegen (deterministisch erzeugt).
// Die letzten Nächte zeigen bewusst ein Warnmuster (HRV sinkt, Ruhepuls und Atemfrequenz steigen).
import { addDays, dateKey, weekdayIndex, DEFAULT_PLAN } from "./analysis.js";

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const PACE = { easy: 345, long: 355, moderate: 290, hard: 300 }; // Sekunden pro km beim Laufen
const HR_PCT = { easy: 0.72, long: 0.74, moderate: 0.84, hard: 0.86 };
const TE = { easy: [2.8, 0.2], long: [3.7, 0.4], moderate: [3.8, 1.2], hard: [3.9, 2.6] }; // aerob, anaerob

export function demoData(todayKey = dateKey(new Date())) {
  const r = rng(42);
  const profile = { name: "Demo", age: 34, sex: "male", observedHrMax: 186 };
  const hrMax = 186;
  const activities = [];
  const daily = [];
  const vo2max = [];
  const warn = { 2: 0.4, 1: 0.7, 0: 1 }; // Stärke des Warnmusters in den letzten Nächten

  for (let i = 119; i >= 0; i--) {
    const date = addDays(todayKey, -i);
    const block = Math.floor((119 - i) / 28); // alle 4 Wochen etwas mehr Umfang
    const recentPush = i <= 6 ? 1.25 : 1;
    const session = DEFAULT_PLAN.week[weekdayIndex(date)];
    const vo2 = 49.5 + (119 - i) * 0.02 + (r() - 0.5) * 0.4;
    vo2max.push({ date, vo2max: Math.round(vo2 * 10) / 10 });

    if (session.sport !== "rest" && r() > 0.12 && i > 0) {
      const scale = (0.85 + block * 0.07) * recentPush * (0.9 + r() * 0.2);
      const durationSec = Math.round(session.durationMin * 60 * scale);
      const strength = session.sport === "strength";
      const avgHr = strength ? Math.round(hrMax * 0.62) : Math.round(hrMax * (HR_PCT[session.intensity] + (r() - 0.5) * 0.04));
      const te = strength ? [1.8, 0.8] : TE[session.intensity];
      const act = {
        id: `demo-${date}`,
        start: `${date}T${session.intensity === "long" ? "08:30" : "18:15"}:00`,
        sport: session.sport,
        name: session.title,
        durationSec,
        avgHr,
        maxHr: Math.min(hrMax, avgHr + 12 + Math.round(r() * 10)),
        distanceM: 0,
        elevationM: Math.round(r() * 120),
        aerobicTE: Math.round((te[0] + (r() - 0.5) * 0.6) * 10) / 10,
        anaerobicTE: Math.round(Math.max(0, te[1] + (r() - 0.5) * 0.6) * 10) / 10,
        trainingLoad: Math.round((durationSec / 60) * (strength ? 0.8 : 1 + HR_PCT[session.intensity] * 1.2) * (0.9 + r() * 0.2)),
        source: "demo",
      };
      if (session.sport === "run") {
        // Effizienz steigt leicht mit der Fitness: gleiche Pace bei etwas niedrigerem Puls
        const pace = PACE[session.intensity] * (1.03 - block * 0.01);
        act.distanceM = Math.round((durationSec / pace) * 1000);
        act.avgSpeed = Math.round((1000 / pace) * 1000) / 1000;
        act.vo2max = Math.round(vo2);
      }
      if (session.sport === "bike") {
        act.distanceM = Math.round((durationSec / 3600) * 27000);
        act.avgSpeed = 7.5;
      }
      if (session.intensity === "hard") act.intensitySec = [0.58, 0.12, 0.3].map((f) => Math.round(f * durationSec));
      if (session.intensity === "moderate") act.intensitySec = [0.35, 0.55, 0.1].map((f) => Math.round(f * durationSec));
      activities.push(act);
    }

    const w = warn[i] || 0;
    const sleepHours = Math.round((7.3 - w * 1.1 + (r() - 0.5) * 1.2) * 10) / 10;
    const quality = 0.9 + r() * 0.2 - w * 0.25;
    const deep = Math.round(sleepHours * 60 * 0.17 * quality);
    const rem = Math.round(sleepHours * 60 * 0.22 * quality);
    const awake = Math.round(18 + r() * 15 + w * 25);
    const hrv = Math.round(58 + (r() - 0.5) * 10 - w * 12);
    daily.push({
      date,
      hrv,
      hrvStatus: hrv < 50 ? "UNBALANCED" : "BALANCED",
      hrvBaseline: [53, 64],
      restingHr: Math.round(49 + (r() - 0.5) * 4 + w * 6),
      respiration: Math.round((14.4 + (r() - 0.5) * 0.6 + w * 1.6) * 10) / 10,
      sleepHours,
      sleepScore: Math.round(80 + (r() - 0.5) * 14 - w * 20),
      sleepStages: { deep, rem, awake, light: Math.max(0, Math.round(sleepHours * 60) - deep - rem) },
      bodyBattery: Math.round(88 + (r() - 0.5) * 14 - w * 30),
      bodyBatteryLow: Math.round(22 + (r() - 0.5) * 14),
      stress: Math.round(26 + (r() - 0.5) * 10 + w * 12),
    });
  }

  return { source: "demo", syncedAt: null, profile, activities, daily, vo2max };
}
