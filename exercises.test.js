// Run: node --test exercises.test.js
var test = require("node:test");
var assert = require("node:assert");
var G = require("./exercises.js");
var idx = G.buildIndex([]);
function sets(text, prev) {
  var r = G.parsePart(text, { index: idx, prev: prev || null });
  return r ? { name: r.exercise.name, group: r.exercise.muscle_group, sets: (r.continued ? r.sets : r.exercise.sets).map(function (s) { return s.weight + "x" + s.reps; }).join(" "), ex: r.exercise } : null;
}

test("common ways of writing sets", function () {
  var cases = [
    ["bench 60kg 3x8", "Barbell Bench Press", "60x8 60x8 60x8"],
    ["bench 60x8", "Barbell Bench Press", "60x8"],
    ["incline db 22.5 x10 x10 x8", "Incline Dumbbell Press", "22.5x10 22.5x10 22.5x8"],
    ["lat pulldown 50kg 3x12", "Lat Pulldown", "50x12 50x12 50x12"],
    ["bench press 60 kg for 3 sets of 8 reps", "Barbell Bench Press", "60x8 60x8 60x8"],
    ["bench 3 sets of 8 @ 60", "Barbell Bench Press", "60x8 60x8 60x8"],
    ["3x8x60 bench", "Barbell Bench Press", "60x8 60x8 60x8"],
    ["deadlift 100x5x5", "Deadlift", "100x5 100x5 100x5 100x5 100x5"],
    ["bench 60x8x6", "Barbell Bench Press", "60x8 60x6"],
    ["8 x 60 kg bench", "Barbell Bench Press", "60x8"],
    ["ohp 40kg 3x8", "Overhead Press", "40x8 40x8 40x8"],
    ["rdl 60kg 3x10", "Romanian Deadlift", "60x10 60x10 60x10"],
    ["bicep curls 12.5kg 3x12", "Dumbbell Curl", "12.5x12 12.5x12 12.5x12"],
    ["tricep pushdown 25 x12 x12 x10", "Tricep Pushdown", "25x12 25x12 25x10"],
    ["pull ups 3x10", "Pull-Up", "0x10 0x10 0x10"],
    ["pull ups +10kg 3x8", "Pull-Up", "10x8 10x8 10x8"],
    ["push ups 20 20 15", "Push-Up", "0x20 0x20 0x15"],
    ["bench 135lb 3x5", "Barbell Bench Press", "61.23x5 61.23x5 61.23x5"],
  ];
  cases.forEach(function (c) { var r = sets(c[0]); assert.ok(r, c[0] + " should parse"); assert.strictEqual(r.name, c[1], c[0]); assert.strictEqual(r.sets, c[2], c[0]); });
});

test("more sets of the same exercise after a comma", function () {
  var first = sets("squat 80x5").ex;
  assert.strictEqual(sets("85x5", first).sets, "85x5");
  var bench = sets("bench 60kg 8").ex;
  assert.strictEqual(sets("8", bench).sets, "60x8");
  assert.strictEqual(sets("85x5", null), null);
});

test("cardio machines by time", function () {
  var t = sets("treadmill 20 min 3 km incline 8").ex;
  assert.deepStrictEqual([t.name, t.duration_min, t.distance_km, t.incline_pct], ["Treadmill", 20, 3, 8]);
  assert.strictEqual(sets("treadmill 30 min avg hr 140").ex.avg_hr, 140);
  assert.strictEqual(sets("elliptical 1 hr").ex.duration_min, 60);
  assert.strictEqual(sets("skipping 10 min").ex.met, 11);
});

test("anything unclear is left for the AI", function () {
  ["dumbbell squat 20kg 3x10", "plank 3x60s", "chicken 200g", "2 roti", "bench", "treadmill", "bench 60x8 felt heavy today", "played cricket 2 hours"].forEach(function (t) {
    assert.strictEqual(sets(t), null, t);
  });
});

test("names this person already uses take over", function () {
  var mine = G.buildIndex([{ name: "Bench Press", group: "chest" }, { name: "Cable Crossover", group: "chest" }]);
  assert.strictEqual(G.parsePart("bench 60x8", { index: mine, prev: null }).exercise.name, "Bench Press");
  assert.strictEqual(G.parsePart("flat bench 60x8", { index: mine, prev: null }).exercise.name, "Bench Press");
  assert.strictEqual(G.parsePart("cable crossover 15kg 3x12", { index: mine, prev: null }).exercise.name, "Cable Crossover");
});

test("recovery from the sets logged", function () {
  var legs = G.recovery([{ muscle_group: "legs", sets: [{ weight: 100, reps: 5 }, { weight: 100, reps: 5 }] }]);
  assert.strictEqual(legs.hours, 72);
  var arms = G.recovery([{ muscle_group: "biceps", sets: [{ weight: 12, reps: 12 }, { weight: 12, reps: 12 }] }]);
  assert.strictEqual(arms.hours, 36);
  assert.strictEqual(G.recovery([{ muscle_group: "cardio", sets: [] }]), null);
});

test("every built-in exercise is findable by its own name and aliases", function () {
  G.EXERCISES.forEach(function (e) {
    e.aliases.forEach(function (a) {
      var r = G.parsePart(a + (e.kind === "c" ? " 20 min" : " 20x10"), { index: idx, prev: null });
      assert.ok(r, a);
    });
  });
});

test("open exercise libraries: logging by full name, how-to and search", function () {
  var fs = require("node:fs");
  var libs = ["ex-free", "ex-wger", "ex-edb"].map(function (f) { return JSON.parse(fs.readFileSync(__dirname + "/data/" + f + ".json", "utf8")); });
  libs.forEach(function (l) { assert.ok(l.items.length > 500 && l.license && l.credit, l.source); });
  G.setLibraries(libs);
  var big = G.buildIndex([]);
  assert.strictEqual(G.parsePart("zercher squat 60x5", { index: big, prev: null }).exercise.sets.length, 1);
  assert.strictEqual(G.parsePart("bench 60x8", { index: big, prev: null }).exercise.name, "Barbell Bench Press", "built-in names still win");
  var h = G.howto("Barbell Bench Press");
  assert.ok(h.length >= 2 && h.every(function (x) { return !/decline|incline/i.test(x.item.n); }), h.map(function (x) { return x.item.n; }).join(", "));
  assert.ok(G.search("lat pulldown").length > 3);
  G.setLibraries([]);
});

test("built-in food data files are well formed", function () {
  var fs = require("node:fs");
  var indb = JSON.parse(fs.readFileSync(__dirname + "/data/indb.json", "utf8"));
  var usda = JSON.parse(fs.readFileSync(__dirname + "/data/usda.json", "utf8"));
  assert.ok(indb.items.length >= 1000 && usda.items.length >= 7000);
  [indb, usda].forEach(function (d) { d.items.forEach(function (r) { assert.ok(r[0] && r[3] > 0 && r[3] < 950, d.source + ": " + r[0]); }); });
  var almonds = usda.items.find(function (r) { return r[0] === "Nuts, almonds"; });
  assert.ok(Math.abs(almonds[3] - 579) < 5 && Math.abs(almonds[4] - 21.2) < 1);
});
