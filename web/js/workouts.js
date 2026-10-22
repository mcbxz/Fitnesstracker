// Strukturierte Workouts aus den Tagesempfehlungen: Aufbau, Export als Garmin-Connect-Workout
// (Upload über den lokalen Server) und als FIT-Workout-Datei (per USB nach GARMIN/NewFiles).
import { SPORTS } from "./analysis.js";

const SUPPORTED = { run: { id: 1, key: "running", fit: "running" }, bike: { id: 2, key: "cycling", fit: "cycling" } };

const step = (kind, min, hr, note) => ({ kind, sec: Math.round(min * 60), hr, note });

// Pulsbereiche aus dem Profil: locker bis zur 1. Schwelle, Schwelle zwischen den Schwellen,
// Intervalle bei 90–95 % HFmax (Helgerud et al. 2007)
function targets(p) {
  return {
    easy: [Math.round(p.hrRest + 0.5 * (p.hrMax - p.hrRest)), Math.round(p.lt1Pct * p.hrMax)],
    threshold: [Math.round(p.lt1Pct * p.hrMax), Math.round(p.lt2Pct * p.hrMax)],
    vo2: [Math.round(0.9 * p.hrMax), Math.round(0.95 * p.hrMax)],
  };
}

export function buildWorkout(day, profile) {
  if (!SUPPORTED[day.sport] || ["rest", "race"].includes(day.intensity) || day.durationMin < 15) return null;
  const t = targets(profile);
  const total = day.durationMin;
  const steps = [];

  if (day.intensity === "hard") {
    const reps = Math.max(2, Math.min(6, Math.floor((total - 20) / 7)));
    steps.push(step("warmup", 12, t.easy, "Locker einlaufen"));
    steps.push({ kind: "repeat", n: reps, steps: [step("interval", 4, t.vo2, "90–95 % HFmax"), step("recovery", 3, t.easy, "Aktive Pause")] });
    steps.push(step("cooldown", Math.max(5, total - 12 - reps * 7), t.easy, "Auslaufen"));
  } else if (day.intensity === "moderate") {
    const reps = Math.max(2, Math.min(4, Math.floor((total - 20) / 13)));
    steps.push(step("warmup", 12, t.easy, "Locker einlaufen"));
    steps.push({ kind: "repeat", n: reps, steps: [step("interval", 10, t.threshold, "Schwellenbereich"), step("recovery", 3, t.easy, "Trabpause")] });
    steps.push(step("cooldown", Math.max(5, total - 12 - reps * 13), t.easy, "Auslaufen"));
  } else {
    steps.push(step("warmup", 10, null, "Langsam beginnen"));
    steps.push(step("interval", Math.max(5, total - 15), t.easy, day.intensity === "long" ? "Gleichmäßig, Grundlage" : "Sprechtempo"));
    steps.push(step("cooldown", 5, null, "Auslaufen"));
  }

  const name = `${day.title || SPORTS[day.sport]}`.slice(0, 40);
  return { name, sport: day.sport, date: day.date, intensity: day.intensity, steps };
}

export function totalSeconds(steps) {
  return steps.reduce((s, x) => s + (x.kind === "repeat" ? x.n * totalSeconds(x.steps) : x.sec), 0);
}

// ---------- Garmin Connect (Workout-Service-Format) ----------

const STEP_TYPES = {
  warmup: { stepTypeId: 1, stepTypeKey: "warmup", displayOrder: 1 },
  cooldown: { stepTypeId: 2, stepTypeKey: "cooldown", displayOrder: 2 },
  interval: { stepTypeId: 3, stepTypeKey: "interval", displayOrder: 3 },
  recovery: { stepTypeId: 4, stepTypeKey: "recovery", displayOrder: 4 },
  repeat: { stepTypeId: 6, stepTypeKey: "repeat", displayOrder: 6 },
};

export function toGarminWorkout(w) {
  const sport = SUPPORTED[w.sport];
  const sportType = { sportTypeId: sport.id, sportTypeKey: sport.key, displayOrder: 1 };
  let order = 0;
  const convert = (s) => {
    order += 1;
    if (s.kind === "repeat") {
      const stepOrder = order;
      return {
        type: "RepeatGroupDTO",
        stepOrder,
        stepType: STEP_TYPES.repeat,
        numberOfIterations: s.n,
        workoutSteps: s.steps.map(convert),
        endCondition: { conditionTypeId: 7, conditionTypeKey: "iterations", displayOrder: 7, displayable: false },
        endConditionValue: s.n,
        smartRepeat: false,
      };
    }
    const out = {
      type: "ExecutableStepDTO",
      stepOrder: order,
      stepType: STEP_TYPES[s.kind],
      endCondition: { conditionTypeId: 2, conditionTypeKey: "time", displayOrder: 2, displayable: true },
      endConditionValue: s.sec,
      targetType: s.hr
        ? { workoutTargetTypeId: 4, workoutTargetTypeKey: "heart.rate.zone", displayOrder: 4 }
        : { workoutTargetTypeId: 1, workoutTargetTypeKey: "no.target", displayOrder: 1 },
      description: s.note,
    };
    if (s.hr) {
      out.targetValueOne = s.hr[0];
      out.targetValueTwo = s.hr[1];
    }
    return out;
  };
  return {
    workoutName: w.name,
    description: "Erstellt vom Trainings-Dashboard",
    sportType,
    estimatedDurationInSecs: totalSeconds(w.steps),
    workoutSegments: [{ segmentOrder: 1, sportType, workoutSteps: w.steps.map(convert) }],
  };
}

// ---------- FIT-Workout-Datei ----------

const FIT_INTENSITY = { warmup: "warmup", interval: "active", recovery: "recovery", cooldown: "cooldown" };

// Flacht die Schritte für das FIT-Format ab: Wiederholungen werden als Schritt
// "repeatUntilStepsCmplt" hinter ihre Unterschritte gesetzt und verweisen auf den ersten davon.
export function fitSteps(steps) {
  const out = [];
  const add = (s) => {
    if (s.kind === "repeat") {
      const first = out.length;
      s.steps.forEach(add);
      out.push({ messageIndex: out.length, durationType: "repeatUntilStepsCmplt", durationValue: first, targetValue: s.n });
      return;
    }
    const m = {
      messageIndex: out.length,
      wktStepName: s.note,
      durationType: "time",
      durationValue: s.sec * 1000,
      intensity: FIT_INTENSITY[s.kind],
      targetType: s.hr ? "heartRate" : "open",
      targetValue: 0,
    };
    if (s.hr) {
      // Eigene Pulsbereiche werden im FIT-Protokoll als bpm + 100 kodiert
      m.customTargetValueLow = s.hr[0] + 100;
      m.customTargetValueHigh = s.hr[1] + 100;
    }
    out.push(m);
  };
  steps.forEach(add);
  return out;
}

export function encodeFitWorkout(w, sdk) {
  const { Encoder, Profile } = sdk;
  const encoder = new Encoder();
  const steps = fitSteps(w.steps);
  encoder.onMesg(Profile.MesgNum.FILE_ID, {
    type: "workout",
    manufacturer: "development",
    product: 0,
    serialNumber: Date.now() % 4294967295,
    timeCreated: new Date(),
  });
  encoder.onMesg(Profile.MesgNum.WORKOUT, { wktName: w.name, sport: SUPPORTED[w.sport].fit, numValidSteps: steps.length });
  steps.forEach((s) => encoder.onMesg(Profile.MesgNum.WORKOUT_STEP, s));
  return encoder.close();
}
