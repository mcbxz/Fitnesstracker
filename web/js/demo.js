// Beispieldaten, solange keine Garmin-Daten vorliegen (deterministisch erzeugt).
import { addDays, dateKey, weekdayIndex, DEFAULT_PLAN } from "./analysis.js";

function rng(seed) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

const PACE = { easy: 345, long: 355, moderate: 290, hard: 300 }; // Sekunden pro km beim Laufen
const HR_PCT = { easy: 0.72, long: 0.74, moderate: 0.84, hard: 0.86 };

export function demoData(todayKey = dateKey(new Date())) {
  const r = rng(42);
  const profile = { name: "Demo", age: 34, sex: "male", observedHrMax: 186 };
  const hrMax = 186;
  const activities = [];
  const daily = [];

  for (let i = 119; i >= 0; i--) {
    const date = addDays(todayKey, -i);
    const block = Math.floor((119 - i) / 28); // alle 4 Wochen etwas mehr Umfang
    const recentPush = i <= 6 ? 1.25 : 1;
    const session = DEFAULT_PLAN.week[weekdayIndex(date)];

    if (session.sport !== "rest" && r() > 0.12 && i > 0) {
      const scale = (0.85 + block * 0.07) * recentPush * (0.9 + r() * 0.2);
      const durationSec = Math.round(session.durationMin * 60 * scale);
      const avgHr = session.sport === "strength" ? Math.round(hrMax * 0.62) : Math.round(hrMax * (HR_PCT[session.intensity] + (r() - 0.5) * 0.04));
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
        source: "demo",
      };
      if (session.sport === "run") act.distanceM = Math.round((durationSec / PACE[session.intensity]) * 1000);
      if (session.sport === "bike") act.distanceM = Math.round((durationSec / 3600) * 27000);
      if (session.intensity === "hard") act.intensitySec = [0.58, 0.12, 0.3].map((f) => Math.round(f * durationSec));
      if (session.intensity === "moderate") act.intensitySec = [0.35, 0.55, 0.1].map((f) => Math.round(f * durationSec));
      activities.push(act);
    }

    const tired = i === 0;
    daily.push({
      date,
      hrv: tired ? 46 : Math.round(58 + (r() - 0.5) * 10),
      restingHr: tired ? 55 : Math.round(49 + (r() - 0.5) * 4),
      sleepHours: tired ? 6.3 : Math.round((7.2 + (r() - 0.5) * 1.2) * 10) / 10,
      sleepScore: tired ? 61 : Math.round(78 + (r() - 0.5) * 14),
    });
  }

  return { source: "demo", syncedAt: null, profile, activities, daily };
}
