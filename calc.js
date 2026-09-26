/* MaxxTempo — calculation engine.
   Every number the app shows comes from here, so it is kept free of DOM code
   and covered by calc.test.js (run: node --test calc.test.js).

   Sources
   - BMR: Mifflin-St Jeor (1990); Katch-McArdle when body fat % is known.
   - Activity energy: Compendium of Physical Activities METs
     (gross kcal/min = MET x 3.5 x kg / 200), ACSM metabolic equations for
     walking/running with distance, Keytel et al. (2005) for heart rate.
   - Exercise is counted as NET energy (gross minus your own resting burn for
     the same minutes) because resting burn is already inside maintenance.
   - Body fat: U.S. Navy circumference method (Hodgdon & Beckett, 1984).
   - Estimated 1RM: Epley. Step length: height x 0.415 (men) / 0.413 (women).
   - Energy density of body-weight change: 7,700 kcal per kg. */
(function (root) {
  "use strict";

  var KCAL_PER_KG = 7700;
  var KCAL_PER_L_O2 = 5.0;

  var ACTIVITY_LEVELS = [
    { id: "sedentary", factor: 1.2,   label: "Mostly sitting: desk job, under ~5,000 steps" },
    { id: "light",     factor: 1.375, label: "Lightly active: some walking, 5,000–7,500 steps" },
    { id: "moderate",  factor: 1.55,  label: "Active: on your feet most of the day, 7,500–10,000 steps" },
    { id: "very",      factor: 1.725, label: "Very active: physical job, 10,000+ steps" }
  ];

  /* kind: how calories are worked out when you give more detail.
     walk/run → ACSM equation if distance is entered. strength → heart rate
     is ignored (HR overstates energy use during lifting). */
  var ACTIVITIES = [
    { id: "walk",        name: "Walking",                  met: 3.5,  kind: "walk" },
    { id: "brisk_walk",  name: "Walking, brisk",           met: 5.0,  kind: "walk" },
    { id: "hike",        name: "Hiking",                   met: 6.0,  kind: "walk" },
    { id: "run",         name: "Running",                  met: 9.8,  kind: "run" },
    { id: "treadmill",   name: "Treadmill run",            met: 9.8,  kind: "run" },
    { id: "cycle_easy",  name: "Cycling, easy (<16 km/h)",  met: 4.0,  kind: "cardio" },
    { id: "cycle_mod",   name: "Cycling, moderate (19–22 km/h)", met: 8.0, kind: "cardio" },
    { id: "cycle_fast",  name: "Cycling, fast (22–26 km/h)", met: 10.0, kind: "cardio" },
    { id: "spin",        name: "Stationary bike",          met: 6.8,  kind: "cardio" },
    { id: "swim_easy",   name: "Swimming, easy",           met: 5.8,  kind: "cardio" },
    { id: "swim_hard",   name: "Swimming, hard laps",      met: 9.8,  kind: "cardio" },
    { id: "elliptical",  name: "Elliptical",               met: 5.0,  kind: "cardio" },
    { id: "rower",       name: "Rowing machine",           met: 7.0,  kind: "cardio" },
    { id: "stairs",      name: "Stair climber",            met: 9.0,  kind: "cardio" },
    { id: "rope",        name: "Jump rope",                met: 11.8, kind: "cardio" },
    { id: "hiit",        name: "HIIT / circuit",           met: 8.0,  kind: "cardio" },
    { id: "strength",    name: "Weight training",          met: 3.5,  kind: "strength" },
    { id: "strength_hard", name: "Weight training, hard",  met: 6.0,  kind: "strength" },
    { id: "yoga",        name: "Yoga",                     met: 2.5,  kind: "cardio" },
    { id: "pilates",     name: "Pilates",                  met: 3.0,  kind: "cardio" },
    { id: "cricket",     name: "Cricket",                  met: 4.8,  kind: "sport" },
    { id: "football",    name: "Football",                 met: 7.0,  kind: "sport" },
    { id: "basketball",  name: "Basketball",               met: 6.5,  kind: "sport" },
    { id: "badminton",   name: "Badminton",                met: 5.5,  kind: "sport" },
    { id: "tennis",      name: "Tennis, singles",          met: 8.0,  kind: "sport" },
    { id: "boxing",      name: "Boxing, bag work",         met: 5.5,  kind: "sport" },
    { id: "dance",       name: "Dancing",                  met: 5.0,  kind: "cardio" },
    { id: "surf",        name: "Surfing",                  met: 3.0,  kind: "sport" }
  ];

  function activityById(id) {
    for (var i = 0; i < ACTIVITIES.length; i++) if (ACTIVITIES[i].id === id) return ACTIVITIES[i];
    return null;
  }
  function levelById(id) {
    for (var i = 0; i < ACTIVITY_LEVELS.length; i++) if (ACTIVITY_LEVELS[i].id === id) return ACTIVITY_LEVELS[i];
    return ACTIVITY_LEVELS[0];
  }

  function num(x) { var n = Number(x); return isFinite(n) ? n : NaN; }
  function round(x, dp) { var m = Math.pow(10, dp || 0); return Math.round(x * m) / m; }

  /* ---------- Dates ---------- */
  function parseYmd(s) {
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return m ? { y: +m[1], m: +m[2], d: +m[3] } : null;
  }
  function ymdToUtc(s) { var p = parseYmd(s); return p ? Date.UTC(p.y, p.m - 1, p.d) : NaN; }
  function daysBetween(a, b) { return Math.round((ymdToUtc(b) - ymdToUtc(a)) / 86400000); }
  function addDays(s, n) {
    var t = new Date(ymdToUtc(s) + n * 86400000);
    return t.getUTCFullYear() + "-" + pad2(t.getUTCMonth() + 1) + "-" + pad2(t.getUTCDate());
  }
  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  /* Exact age in whole years on a given date (birthday-aware). */
  function ageOn(birthYmd, onYmd) {
    var b = parseYmd(birthYmd), o = parseYmd(onYmd);
    if (!b || !o) return NaN;
    var age = o.y - b.y;
    if (o.m < b.m || (o.m === b.m && o.d < b.d)) age--;
    return age;
  }

  /* ---------- Resting energy ---------- */
  function bmrMifflin(sex, kg, cm, age) {
    return 10 * kg + 6.25 * cm - 5 * age + (sex === "female" ? -161 : 5);
  }
  function bmrKatch(kg, bodyFatPct) {
    return 370 + 21.6 * kg * (1 - bodyFatPct / 100);
  }
  /* Uses Katch-McArdle when a plausible body-fat % is known (it accounts for
     muscle), otherwise Mifflin-St Jeor — the most accurate general equation. */
  function bmr(p) {
    var bf = num(p.bodyFat);
    if (bf >= 3 && bf <= 60) return { kcal: bmrKatch(p.kg, bf), method: "Katch-McArdle (uses body fat)" };
    return { kcal: bmrMifflin(p.sex, p.kg, p.cm, p.age), method: "Mifflin-St Jeor" };
  }

  /* ---------- Exercise energy ---------- */
  function grossKcalFromMet(met, kg, minutes) { return met * 3.5 * kg / 200 * minutes; }

  // ACSM: speed in m/min, grade as a fraction (5% incline = 0.05). Result ml O2/kg/min.
  function acsmWalkVO2(speed, grade) { return 0.1 * speed + 1.8 * speed * (grade || 0) + 3.5; }
  function acsmRunVO2(speed, grade) { return 0.2 * speed + 0.9 * speed * (grade || 0) + 3.5; }

  // Keytel et al. 2005, gross kcal/min, without VO2max.
  function keytelKcalPerMin(sex, hr, kg, age) {
    if (sex === "female") return (-20.4022 + 0.4472 * hr - 0.1263 * kg + 0.074 * age) / 4.184;
    return (-55.0969 + 0.6309 * hr + 0.1988 * kg + 0.2017 * age) / 4.184;
  }

  /* w: {activity, minutes, distanceKm?, inclinePct?, avgHr?}
     who: {sex, kg, age, bmrKcal}
     Returns {gross, net, method}. Picks the most specific method available:
     heart rate → ACSM (walk/run with distance) → MET. */
  function workoutEnergy(w, who) {
    var minutes = num(w.minutes);
    if (!(minutes > 0)) return { gross: 0, net: 0, method: "—" };
    var act = activityById(w.activity) || { met: num(w.met) || 4, kind: "cardio" };
    var restPerMin = who.bmrKcal / 1440;
    var gross = NaN, method = "";

    var hr = num(w.avgHr);
    if (hr >= 90 && hr <= 200 && act.kind !== "strength") {
      var perMin = keytelKcalPerMin(who.sex, hr, who.kg, who.age);
      if (perMin > restPerMin * 1.5) { gross = perMin * minutes; method = "Heart rate (Keytel)"; }
    }
    var dist = num(w.distanceKm);
    if (isNaN(gross) && dist > 0 && (act.kind === "walk" || act.kind === "run")) {
      var speed = dist * 1000 / minutes;              // m/min
      var grade = (num(w.inclinePct) || 0) / 100;
      // Past ~8 km/h walking turns into running biomechanically.
      var running = act.kind === "run" || speed > 134;
      var vo2 = running ? acsmRunVO2(speed, grade) : acsmWalkVO2(speed, grade);
      gross = vo2 * who.kg / 1000 * KCAL_PER_L_O2 * minutes;
      method = "ACSM " + (running ? "running" : "walking") + " equation (pace" + (grade ? " + incline" : "") + ")";
    }
    if (isNaN(gross)) {
      gross = grossKcalFromMet(act.met, who.kg, minutes);
      method = "MET " + act.met + " (Compendium)";
    }
    var net = Math.max(0, gross - restPerMin * minutes);
    return { gross: gross, net: net, method: method };
  }

  /* ---------- Targets ---------- */
  function calorieTarget(opts) {
    // opts: {maintenance, goal, rateKgWeek, sex, bmrKcal}
    var rate = Math.abs(num(opts.rateKgWeek) || 0);
    var delta = 0;
    if (opts.goal === "lose") delta = -rate * KCAL_PER_KG / 7;
    else if (opts.goal === "gain") delta = rate * KCAL_PER_KG / 7;
    var raw = opts.maintenance + delta;
    // Safety floor: below this it is hard to get enough protein and nutrients.
    var floor = Math.max(opts.sex === "female" ? 1200 : 1500, Math.round(opts.bmrKcal * 0.9));
    var kcal = opts.goal === "lose" ? Math.max(raw, floor) : raw;
    return { kcal: kcal, delta: kcal - opts.maintenance, floored: kcal > raw, floor: floor };
  }

  /* Protein by g/kg of a reference weight (weight at BMI 25 when BMI is over
     27, so heavier people aren't told to eat far more than they need);
     fat at 27% of energy but never under 0.6 g/kg; carbs fill the rest. */
  function macroTargets(kcal, kg, cm, proteinPerKg) {
    var m = cm / 100;
    var refKg = kg / (m * m) > 27 ? 25 * m * m : kg;
    var p = proteinPerKg * refKg;
    var f = Math.max(kcal * 0.27 / 9, 0.6 * kg);
    var c = Math.max(0, (kcal - p * 4 - f * 9) / 4);
    return { p: Math.round(p), f: Math.round(f), c: Math.round(c), refKg: refKg };
  }
  function defaultProteinPerKg(goal) { return goal === "lose" ? 2.0 : goal === "gain" ? 1.8 : 1.6; }

  // ~35 ml/kg/day from drinks, plus ~500 ml per hour of exercise.
  function waterTargetMl(kg, exerciseMinutes) {
    return Math.round((kg * 35 + (exerciseMinutes || 0) / 60 * 500) / 50) * 50;
  }

  /* ---------- Body ---------- */
  function bmi(kg, cm) { var m = cm / 100; return kg / (m * m); }
  function bmiCategory(v) {
    return v < 18.5 ? "Underweight" : v < 25 ? "Healthy range" : v < 30 ? "Overweight" : "Obese range";
  }
  function navyBodyFat(sex, heightCm, neckCm, waistCm, hipCm) {
    var v;
    if (sex === "female") {
      if (!(waistCm + hipCm - neckCm > 0)) return NaN;
      v = 495 / (1.29579 - 0.35004 * Math.log10(waistCm + hipCm - neckCm) + 0.221 * Math.log10(heightCm)) - 450;
    } else {
      if (!(waistCm - neckCm > 0)) return NaN;
      v = 495 / (1.0324 - 0.19077 * Math.log10(waistCm - neckCm) + 0.15456 * Math.log10(heightCm)) - 450;
    }
    return v > 2 && v < 70 ? v : NaN;
  }

  /* Estimated one-rep max (Epley). Beyond 12 reps estimates get unreliable. */
  function e1rm(kg, reps) {
    kg = num(kg); reps = num(reps);
    if (!(kg > 0) || !(reps >= 1) || reps > 12) return NaN;
    return reps === 1 ? kg : kg * (1 + reps / 30);
  }

  /* Net energy of an activity described by a MET value: gross cost minus
     the resting burn you'd have had anyway in those minutes. */
  function netKcalFromMet(met, kg, minutes, bmrKcal) {
    var gross = grossKcalFromMet(met, kg, minutes);
    return { gross: gross, net: Math.max(0, gross - bmrKcal / 1440 * minutes) };
  }

  /* Daily reference intakes (US National Academies DRIs; sodium per WHO),
     by sex and age band. */
  function microTargets(sex, age) {
    var f = sex === "female", teen = age < 19, a = age || 30;
    return {
      cholesterol_mg: 300, sodium_mg: 2000,
      potassium_mg: teen ? (f ? 2300 : 3000) : (f ? 2600 : 3400),
      calcium_mg: teen ? 1300 : (f ? (a > 50 ? 1200 : 1000) : (a > 70 ? 1200 : 1000)),
      iron_mg: teen ? (f ? 15 : 11) : (f ? (a > 50 ? 8 : 18) : 8),
      magnesium_mg: teen ? (f ? 360 : 410) : (f ? (a > 30 ? 320 : 310) : (a > 30 ? 420 : 400)),
      zinc_mg: teen && f ? 9 : (f ? 8 : 11),
      vitamin_a_mcg: f ? 700 : 900,
      vitamin_c_mg: teen ? (f ? 65 : 75) : (f ? 75 : 90),
      vitamin_d_mcg: a > 70 ? 20 : 15,
      vitamin_b12_mcg: 2.4,
      folate_mcg: 400,
      omega3_g: f ? 1.1 : 1.6
    };
  }

  /* Do a food's calories agree with its macros? Carbs may or may not include
     fibre (Indian tables usually exclude it, USDA includes it), so both
     readings are tried. Returns the relative mismatch (0 = perfect). */
  function atwaterMismatch(kcal, p, c, f, fibre, alcohol) {
    if (!(kcal > 0)) return 0;
    var base = p * 4 + f * 9 + (alcohol || 0) * 7;
    var a = base + c * 4, b = base + Math.max(0, c - (fibre || 0)) * 4 + (fibre || 0) * 2;
    return Math.min(Math.abs(a - kcal), Math.abs(b - kcal)) / kcal;
  }

  function stepLengthM(cm, sex) { return cm * (sex === "female" ? 0.413 : 0.415) / 100; }
  function stepsToKm(steps, cm, sex) { return steps * stepLengthM(cm, sex) / 1000; }
  // Tudor-Locke & Bassett step bands → our activity levels.
  function levelFromSteps(avg) {
    return avg < 5000 ? "sedentary" : avg < 7500 ? "light" : avg < 10000 ? "moderate" : "very";
  }

  /* ---------- Trends ---------- */
  // Exponentially smoothed weight, one point per weigh-in, gaps handled by
  // decaying per elapsed day so a week off doesn't weigh like one day.
  function weightTrend(points, alphaPerDay) {
    var a = alphaPerDay || 0.1;
    var out = [], prev = null;
    points.slice().sort(function (x, y) { return x.date < y.date ? -1 : 1; }).forEach(function (pt) {
      var t;
      if (!prev) t = pt.kg;
      else {
        var gap = Math.max(1, daysBetween(prev.date, pt.date));
        var k = 1 - Math.pow(1 - a, gap);
        t = prev.trend + k * (pt.kg - prev.trend);
      }
      prev = { date: pt.date, kg: pt.kg, trend: t };
      out.push(prev);
    });
    return out;
  }

  function linreg(xy) {
    var n = xy.length;
    if (n < 2) return null;
    var sx = 0, sy = 0, sxx = 0, sxy = 0;
    for (var i = 0; i < n; i++) { sx += xy[i][0]; sy += xy[i][1]; sxx += xy[i][0] * xy[i][0]; sxy += xy[i][0] * xy[i][1]; }
    var d = n * sxx - sx * sx;
    if (d === 0) return null;
    var slope = (n * sxy - sx * sy) / d;
    return { slope: slope, intercept: (sy - slope * sx) / n };
  }

  /* Measured maintenance from your own logs (energy balance):
       maintenance = average intake − (weight slope × 7,700)
     days: {ymd: {intake, exerciseNet, complete}}
     weights: [{date, kg}]
     Only days you logged fully count. Returns null + reason if not enough data. */
  function adaptiveMaintenance(days, weights, endYmd, windowDays, bmrKcal) {
    windowDays = windowDays || 28;
    var start = addDays(endYmd, -(windowDays - 1));
    var intake = 0, ex = 0, logged = 0;
    for (var i = 0; i < windowDays; i++) {
      var d = days[addDays(start, i)];
      if (d && d.complete !== false && d.intake > 0) { intake += d.intake; ex += d.exerciseNet || 0; logged++; }
    }
    var ws = weights.filter(function (w) { return w.date >= start && w.date <= endYmd; });
    var span = ws.length ? daysBetween(ws.reduce(function (a, w) { return w.date < a ? w.date : a; }, ws[0].date),
                                       ws.reduce(function (a, w) { return w.date > a ? w.date : a; }, ws[0].date)) : 0;
    var need = [];
    if (logged < 10) need.push((10 - logged) + " more fully-logged day" + (10 - logged === 1 ? "" : "s"));
    if (ws.length < 5) need.push((5 - ws.length) + " more weigh-in" + (5 - ws.length === 1 ? "" : "s"));
    else if (span < 14) need.push("weigh-ins spread over at least 14 days");
    if (need.length) return { ready: false, need: need, logged: logged, weighIns: ws.length };

    var fit = linreg(ws.map(function (w) { return [daysBetween(start, w.date), w.kg]; }));
    var avgIntake = intake / logged;
    var tdee = avgIntake - fit.slope * KCAL_PER_KG;
    var avgEx = ex / logged;
    var plausible = !bmrKcal || (tdee > bmrKcal * 1.05 && tdee < bmrKcal * 2.6);
    return {
      ready: plausible,
      need: plausible ? [] : ["data that looks consistent — check for missed meals or a wrong weigh-in"],
      tdee: tdee,
      baseWithoutExercise: tdee - avgEx,
      avgIntake: avgIntake,
      avgExercise: avgEx,
      kgPerWeek: fit.slope * 7,
      logged: logged,
      weighIns: ws.length,
      confidence: logged >= 21 && ws.length >= 10 ? "high" : "medium"
    };
  }

  /* ---------- Food ---------- */
  function scaleFood(per100, grams) {
    var k = grams / 100;
    return {
      kcal: per100.kcal * k, p: (per100.p || 0) * k, c: (per100.c || 0) * k,
      f: (per100.f || 0) * k, a: (per100.a || 0) * k
    };
  }
  // Atwater check: kcal from macros (4/4/9, alcohol 7).
  function kcalFromMacros(p, c, f, a) { return p * 4 + c * 4 + f * 9 + (a || 0) * 7; }

  var api = {
    KCAL_PER_KG: KCAL_PER_KG, ACTIVITY_LEVELS: ACTIVITY_LEVELS, ACTIVITIES: ACTIVITIES,
    activityById: activityById, levelById: levelById, round: round,
    parseYmd: parseYmd, daysBetween: daysBetween, addDays: addDays, ageOn: ageOn,
    bmrMifflin: bmrMifflin, bmrKatch: bmrKatch, bmr: bmr,
    grossKcalFromMet: grossKcalFromMet, acsmWalkVO2: acsmWalkVO2, acsmRunVO2: acsmRunVO2,
    keytelKcalPerMin: keytelKcalPerMin, workoutEnergy: workoutEnergy,
    calorieTarget: calorieTarget, macroTargets: macroTargets, defaultProteinPerKg: defaultProteinPerKg,
    waterTargetMl: waterTargetMl, bmi: bmi, bmiCategory: bmiCategory, navyBodyFat: navyBodyFat,
    e1rm: e1rm, netKcalFromMet: netKcalFromMet, microTargets: microTargets, atwaterMismatch: atwaterMismatch,
    stepLengthM: stepLengthM, stepsToKm: stepsToKm, levelFromSteps: levelFromSteps,
    weightTrend: weightTrend, linreg: linreg, adaptiveMaintenance: adaptiveMaintenance,
    scaleFood: scaleFood, kcalFromMacros: kcalFromMacros
  };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Calc = api;
})(this);
