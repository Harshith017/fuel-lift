// Run: node --test calc.test.js
var test = require("node:test");
var assert = require("node:assert");
var C = require("./calc.js");
var FOODS = require("./foods.js");

function near(actual, expected, tol, msg) {
  assert.ok(Math.abs(actual - expected) <= tol, (msg || "") + " expected " + expected + " ± " + tol + ", got " + actual);
}

test("age is birthday-aware", function () {
  assert.strictEqual(C.ageOn("1996-09-27", "2026-09-26"), 29);
  assert.strictEqual(C.ageOn("1996-09-26", "2026-09-26"), 30);
});

test("Mifflin-St Jeor matches published examples", function () {
  near(C.bmrMifflin("male", 80, 180, 30), 1780, 0.01);
  near(C.bmrMifflin("female", 60, 165, 25), 1345.25, 0.01);
});

test("Katch-McArdle is used when body fat is known", function () {
  var r = C.bmr({ sex: "male", kg: 80, cm: 180, age: 30, bodyFat: 20 });
  near(r.kcal, 1752.4, 0.01);
  assert.match(r.method, /Katch/);
  assert.match(C.bmr({ sex: "male", kg: 80, cm: 180, age: 30 }).method, /Mifflin/);
});

test("ACSM running at 10 km/h ≈ 10.5 METs", function () {
  var vo2 = C.acsmRunVO2(10000 / 60, 0);
  near(vo2 / 3.5, 10.52, 0.01);
});

test("running with distance uses ACSM and counts net energy", function () {
  var who = { sex: "male", kg: 70, age: 30, bmrKcal: 1680 };
  var r = C.workoutEnergy({ activity: "run", minutes: 60, distanceKm: 10 }, who);
  near(r.gross, 773.5, 1);
  near(r.net, 773.5 - 70, 1);           // minus 1 hour of resting burn
  assert.match(r.method, /ACSM running/);
});

test("fast 'walk' switches to the running equation", function () {
  var who = { sex: "male", kg: 70, age: 30, bmrKcal: 1680 };
  var r = C.workoutEnergy({ activity: "walk", minutes: 30, distanceKm: 5 }, who); // 10 km/h
  assert.match(r.method, /running/);
});

test("Keytel heart-rate formula", function () {
  near(C.keytelKcalPerMin("male", 140, 80, 30), 13.19, 0.01);
  var who = { sex: "male", kg: 80, age: 30, bmrKcal: 1780 };
  assert.match(C.workoutEnergy({ activity: "cycle_mod", minutes: 45, avgHr: 140 }, who).method, /Heart rate/);
  // Heart rate is ignored for lifting (HR rises without matching energy use).
  assert.match(C.workoutEnergy({ activity: "strength", minutes: 45, avgHr: 140 }, who).method, /MET/);
});

test("MET fallback: 30 min cricket, 70 kg", function () {
  var who = { sex: "male", kg: 70, age: 30, bmrKcal: 1680 };
  var r = C.workoutEnergy({ activity: "cricket", minutes: 30 }, who);
  near(r.gross, 4.8 * 3.5 * 70 / 200 * 30, 0.001);
});

test("calorie target respects rate and safety floor", function () {
  var t = C.calorieTarget({ maintenance: 2500, goal: "lose", rateKgWeek: 0.5, sex: "male", bmrKcal: 1700 });
  near(t.kcal, 1950, 0.01);
  var f = C.calorieTarget({ maintenance: 1700, goal: "lose", rateKgWeek: 1, sex: "female", bmrKcal: 1300 });
  assert.ok(f.floored);
  assert.strictEqual(f.kcal, 1200);
  near(C.calorieTarget({ maintenance: 2500, goal: "gain", rateKgWeek: 0.25, sex: "male", bmrKcal: 1700 }).kcal, 2775, 0.01);
});

test("macros add back up to the calorie target", function () {
  var m = C.macroTargets(2200, 75, 178, 1.8);
  near(C.kcalFromMacros(m.p, m.c, m.f), 2200, 15);
  assert.strictEqual(m.p, 135);
  // BMI > 27 → protein uses weight at BMI 25.
  var h = C.macroTargets(2200, 110, 175, 2.0);
  near(h.refKg, 76.56, 0.01);
});

test("US Navy body fat", function () {
  near(C.navyBodyFat("male", 178, 38, 86), 17.2, 0.1);
  near(C.navyBodyFat("female", 165, 33, 75, 97), 27.5, 0.6);
});

test("Epley 1RM", function () {
  near(C.e1rm(100, 5), 116.67, 0.01);
  assert.strictEqual(C.e1rm(100, 1), 100);
  assert.ok(isNaN(C.e1rm(60, 20)));
});

test("weight trend smooths noise", function () {
  var pts = [], d = "2026-09-01";
  for (var i = 0; i < 20; i++) pts.push({ date: C.addDays(d, i), kg: 80 + (i % 2 ? 0.8 : -0.8) });
  var tr = C.weightTrend(pts);
  var last = tr[tr.length - 1].trend;
  near(last, 80, 0.5);
});

test("measured maintenance from energy balance", function () {
  var days = {}, weights = [], end = "2026-09-25", start = C.addDays(end, -27);
  for (var i = 0; i < 28; i++) {
    var ymd = C.addDays(start, i);
    days[ymd] = { intake: 2500, exerciseNet: 200 };
    if (i % 2 === 0) weights.push({ date: ymd, kg: 85 - (0.5 / 7) * i }); // −0.5 kg/week
  }
  var r = C.adaptiveMaintenance(days, weights, end, 28, 1800);
  assert.ok(r.ready);
  near(r.tdee, 3050, 1);
  near(r.baseWithoutExercise, 2850, 1);
  near(r.kgPerWeek, -0.5, 0.001);
  assert.strictEqual(r.confidence, "high");
});

test("measured maintenance waits for enough data", function () {
  var r = C.adaptiveMaintenance({}, [], "2026-09-25", 28, 1800);
  assert.strictEqual(r.ready, false);
  assert.ok(r.need.length >= 2);
});

test("every built-in food's calories match its macros (within 12%)", function () {
  FOODS.FOOD_ROWS.forEach(function (r) {
    var name = r[0], kcal = r[3], p = r[4], c = r[5], f = r[6], fibre = r[7];
    var off = C.atwaterMismatch(kcal, p, c, f, fibre, FOODS.FOOD_ALCOHOL[name]);
    assert.ok(kcal < 40 || off <= 0.12, name + ": " + kcal + " kcal is " + Math.round(off * 100) + "% off its macros");
  });
});

test("every food row has all 14 micronutrient columns", function () {
  FOODS.FOOD_ROWS.forEach(function (r) {
    assert.strictEqual(r.length, 9 + FOODS.FOOD_MICRO_ORDER.length, r[0]);
  });
});

test("age- and sex-specific nutrient targets", function () {
  assert.strictEqual(C.microTargets("female", 25).iron_mg, 18);
  assert.strictEqual(C.microTargets("female", 55).iron_mg, 8);
  assert.strictEqual(C.microTargets("female", 55).calcium_mg, 1200);
  assert.strictEqual(C.microTargets("male", 35).magnesium_mg, 420);
  assert.strictEqual(C.microTargets("male", 17).calcium_mg, 1300);
});

test("net energy from a MET value removes resting burn", function () {
  var r = C.netKcalFromMet(7, 70, 60, 1680);
  near(r.gross, 514.5, 0.01);
  near(r.net, 514.5 - 70, 0.01);
});

test("Atwater check tolerates fibre either way and counts alcohol", function () {
  assert.ok(C.atwaterMismatch(43, 0.5, 3.6, 0, 0, 3.9) < 0.02);   // beer
  assert.ok(C.atwaterMismatch(400, 10, 10, 10, 0, 0) > 0.5);       // clearly wrong
});

test("step distance", function () {
  near(C.stepsToKm(10000, 180, "male"), 7.47, 0.01);
  assert.strictEqual(C.levelFromSteps(8200), "moderate");
});
