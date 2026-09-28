// Run: node --test sports.test.js
var test = require("node:test");
var assert = require("node:assert");
var S = require("./sports.js");
S.setTable(require("./data/activities.json"));
function r(text, opts) { var x = S.read(text, opts); return x ? x.key + " " + x.minutes + " " + x.code : null; }

test("the Compendium table loads", function () {
  assert.ok(S.ready());
  assert.strictEqual(S.row("15030").met, 5.5);
  for (var f of S.families()) assert.ok(S.row(f.code), "usual row exists for " + f.key + " (" + f.code + ")");
});

test("common sports with a time", function () {
  var cases = [
    ["Badminton for 1 hour", "badminton 60 15030"],
    ["badminton competitive 1hr", "badminton 60 15025"],
    ["casual badminton 90 min", "badminton 90 15030"],
    ["1 hr 15 min badminton", "badminton 75 15030"],
    ["an hour and 30 minutes of badminton", "badminton 90 15030"],
    ["tennis doubles 1 hr", "tennis 60 15685"],
    ["tennis singles 1 hr", "tennis 60 15690"],
    ["played tennis 1h30", "tennis 90 15675"],
    ["table tennis 45 min", "table-tennis 45 15660"],
    ["football 1 hour", "football 60 15610"],
    ["5 a side football 60 min competitive", "football 60 15605"],
    ["cricket nets 90 min", "cricket 90 15150"],
    ["swam 30 min", "swimming 30 18310"],
    ["swimming laps 45 min breaststroke", "swimming 45 18265"],
    ["yoga 45 min", "yoga 45 02175"],
    ["surya namaskar 20 min", "yoga 20 02180"],
    ["squash 45 min", "squash 45 15652"],
    ["treadmill walk 30 min", "walking 30 17355"],
  ];
  for (var c of cases) assert.strictEqual(r(c[0]), c[1], c[0]);
});

test("pace picks the row for running, walking, cycling and swimming", function () {
  assert.strictEqual(r("ran 5 km in 30 min"), "running 30 12050");      // 10 km/h ≈ 6.2 mph
  assert.strictEqual(r("ran 5k in 25 mins"), "running 25 12080");       // 12 km/h ≈ 7.5 mph
  assert.strictEqual(r("walked 4 km in 40 min"), "walking 40 17200");   // 6 km/h brisk
  assert.strictEqual(r("cycled 20 km in 1 hour"), "cycling 60 01030");  // 12.4 mph
  assert.strictEqual(r("swam 1 km in 30 min"), "swimming 30 18292");    // ~36 yd/min
  var hm = S.read("half marathon 2h10m"); assert.strictEqual(hm.minutes, 130); assert.strictEqual(hm.km, 21.1);
  var d = S.read("ran 5 km"); assert.strictEqual(d.minutes, 31); assert.ok(/usual running pace/.test(d.assumed));
  var sw = S.read("swam 400 m"); assert.strictEqual(sw.km, 0.4); assert.ok(sw.minutes < 30, "400 m is metres, not minutes");
});

test("cricket numbers are kept for bowling load", function () {
  assert.deepStrictEqual(S.read("cricket nets 90 min bowled 6 overs").stats, { balls_bowled: 36 });
  assert.deepStrictEqual(S.read("cricket match 3 hours bowled 4.2 overs faced 20 balls").stats, { balls_bowled: 26, balls_faced: 20 });
});

test("no time given: usual session length, else an hour", function () {
  var a = S.read("played badminton"); assert.strictEqual(a.minutes, 60); assert.ok(a.assumed);
  assert.strictEqual(S.read("played badminton", { profile: { minutes: 75, text: "" } }).minutes, 75);
  assert.strictEqual(S.read("badminton 1 hr", { profile: { text: "Advanced Competitive games" } }).code, "15025");
});

test("foods and other things are left alone", function () {
  for (var t of ["1 yoga bar", "butternut squash soup 1 bowl", "squash 200g", "took the shuttle to office", "2 idli", "kabaddi 1 hour", "bench press 60kg 3x8", "walking"])
    assert.strictEqual(r(t), null, t);
});

test("an entry mixing a session and food is split", function () {
  assert.deepStrictEqual(S.split("badminton 1 hr and 2 idli"), { acts: ["badminton 1 hr"], rest: ["2 idli"] });
  assert.deepStrictEqual(S.split("30 min badminton then 30 min swimming"), { acts: ["30 min badminton", "30 min swimming"], rest: [] });
  assert.deepStrictEqual(S.split("badminton singles and doubles 1 hour"), { acts: ["badminton singles doubles 1 hour"], rest: [] });
  assert.ok(S.isDetail("bowled 6 overs")); assert.ok(!S.isDetail("2 roti"));
});
