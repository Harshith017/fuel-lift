/* MaxxTempo — built-in gym exercises and a reader for how people write sets,
   so common gym entries log instantly without AI. Loaded before app.js; also
   required by exercises.test.js. Anything it can't read confidently is left
   for the AI. */
(function (root) {
'use strict';

/* [name, muscle group, aliases (| separated), kind, cardio MET]
   kind: w = weights (default weight unknown), b = bodyweight (0 kg unless added), c = cardio.
   Cardio METs from the Compendium of Physical Activities (2024), moderate effort. */
const ROWS = [
// chest
['Barbell Bench Press','chest','bench|bench press|flat bench|flat bench press|barbell bench|bb bench|flat barbell bench','w'],
['Incline Barbell Bench Press','chest','incline bench|incline bench press|incline barbell|incline barbell press|incline bb bench','w'],
['Decline Bench Press','chest','decline bench|decline press|decline bench press','w'],
['Dumbbell Bench Press','chest','dumbbell bench|dumbbell press|flat dumbbell press|flat dumbbell|dumbbell bench press|flat dumbbell bench','w'],
['Incline Dumbbell Press','chest','incline dumbbell|incline dumbbell press|incline dumbbell bench','w'],
['Decline Dumbbell Press','chest','decline dumbbell|decline dumbbell press','w'],
['Machine Chest Press','chest','chest press|machine chest press|machine press|seated chest press','w'],
['Incline Machine Press','chest','incline machine press|incline chest press|incline machine','w'],
['Smith Machine Bench Press','chest','smith bench|smith machine bench|smith bench press','w'],
['Smith Machine Incline Press','chest','smith incline|smith incline press|smith machine incline','w'],
['Cable Fly','chest','cable fly|cable flye|cable flies|cable flyes|cable crossover|cable crossovers|crossover|crossovers','w'],
['Low-to-High Cable Fly','chest','low to high cable fly|low to high fly|low cable fly','w'],
['Pec Deck','chest','pec deck|pec fly|pec dec|machine fly|butterfly|chest fly machine','w'],
['Dumbbell Fly','chest','dumbbell fly|dumbbell flye|dumbbell flies|chest fly|flat fly','w'],
['Incline Dumbbell Fly','chest','incline fly|incline dumbbell fly|incline flye','w'],
['Push-Up','chest','push up|push ups|pushup|pushups|press up|press ups','b'],
['Chest Dip','chest','chest dip|chest dips','b'],
// back
['Deadlift','back','deadlift|deadlifts|conventional deadlift|barbell deadlift|dl','w'],
['Sumo Deadlift','back','sumo deadlift|sumo','w'],
['Rack Pull','back','rack pull|rack pulls','w'],
['Lat Pulldown','back','lat pulldown|lat pull down|pulldown|pull down|lat pulldowns|wide grip pulldown','w'],
['Close-Grip Lat Pulldown','back','close grip pulldown|close grip lat pulldown|v bar pulldown|narrow grip pulldown','w'],
['Pull-Up','back','pull up|pull ups|pullup|pullups|wide grip pull up','b'],
['Chin-Up','back','chin up|chin ups|chinup|chinups','b'],
['Assisted Pull-Up','back','assisted pull up|assisted pull ups|assisted pullup','w'],
['Barbell Row','back','barbell row|bent over row|bent over barbell row|bb row|pendlay row|barbell rows','w'],
['Dumbbell Row','back','dumbbell row|one arm row|single arm row|one arm dumbbell row|single arm dumbbell row|dumbbell rows','w'],
['Seated Cable Row','back','seated row|cable row|seated cable row|low row|seated rows|cable rows','w'],
['T-Bar Row','back','t bar row|tbar row|t bar rows','w'],
['Machine Row','back','machine row|chest supported row|hammer strength row|seal row','w'],
['Straight-Arm Pulldown','back','straight arm pulldown|straight arm pull down|pullover|cable pullover','w'],
['Back Extension','back','back extension|back extensions|hyperextension|hyperextensions|hyper extension','b'],
['Shrug','back','shrug|shrugs|barbell shrug|dumbbell shrug|dumbbell shrugs|barbell shrugs','w'],
['Face Pull','shoulders','face pull|face pulls','w'],
// shoulders
['Overhead Press','shoulders','overhead press|ohp|military press|standing press|barbell overhead press|barbell shoulder press','w'],
['Dumbbell Shoulder Press','shoulders','shoulder press|dumbbell shoulder press|seated dumbbell press|seated shoulder press|dumbbell overhead press','w'],
['Machine Shoulder Press','shoulders','machine shoulder press|shoulder press machine','w'],
['Arnold Press','shoulders','arnold press|arnold','w'],
['Lateral Raise','shoulders','lateral raise|lateral raises|side raise|side raises|side lateral|side lateral raise|dumbbell lateral raise|laterals','w'],
['Cable Lateral Raise','shoulders','cable lateral raise|cable lateral|cable laterals|cable side raise','w'],
['Front Raise','shoulders','front raise|front raises|dumbbell front raise|plate front raise','w'],
['Rear Delt Fly','shoulders','rear delt fly|rear delt|rear delts|reverse fly|reverse pec deck|rear delt raise|reverse flye','w'],
['Upright Row','shoulders','upright row|upright rows','w'],
// biceps
['Barbell Curl','biceps','barbell curl|barbell curls|bb curl|bicep curl barbell|straight bar curl','w'],
['EZ-Bar Curl','biceps','ez bar curl|ez curl|ez bar curls|ez curls','w'],
['Dumbbell Curl','biceps','dumbbell curl|dumbbell curls|bicep curl|bicep curls|biceps curl|curl|curls|alternating curl|alternate curl','w'],
['Hammer Curl','biceps','hammer curl|hammer curls|hammers','w'],
['Preacher Curl','biceps','preacher curl|preacher curls|preacher','w'],
['Incline Dumbbell Curl','biceps','incline curl|incline curls|incline dumbbell curl','w'],
['Cable Curl','biceps','cable curl|cable curls|cable bicep curl','w'],
['Concentration Curl','biceps','concentration curl|concentration curls','w'],
// triceps
['Tricep Pushdown','triceps','tricep pushdown|triceps pushdown|pushdown|pushdowns|push down|tricep push down|cable pushdown|bar pushdown','w'],
['Rope Pushdown','triceps','rope pushdown|rope pushdowns|rope push down|tricep rope pushdown|rope extension','w'],
['Overhead Tricep Extension','triceps','overhead tricep extension|overhead extension|overhead triceps extension|tricep extension|triceps extension|overhead cable extension','w'],
['Skull Crusher','triceps','skull crusher|skull crushers|skullcrusher|skullcrushers|lying tricep extension','w'],
['Close-Grip Bench Press','triceps','close grip bench|close grip bench press|cgbp','w'],
['Tricep Dip','triceps','dip|dips|tricep dip|tricep dips|triceps dips|parallel bar dip|bench dip|bench dips','b'],
['Tricep Kickback','triceps','kickback|kickbacks|tricep kickback|tricep kickbacks','w'],
// legs
['Back Squat','legs','squat|squats|back squat|back squats|barbell squat|bb squat','w'],
['Front Squat','legs','front squat|front squats','w'],
['Goblet Squat','legs','goblet squat|goblet squats','w'],
['Smith Machine Squat','legs','smith squat|smith machine squat|smith squats','w'],
['Hack Squat','legs','hack squat|hack squats','w'],
['Leg Press','legs','leg press|leg presses|leg press machine','w'],
['Romanian Deadlift','legs','romanian deadlift|rdl|rdls|stiff leg deadlift|sldl|dumbbell rdl','w'],
['Walking Lunge','legs','lunge|lunges|walking lunge|walking lunges|dumbbell lunges','w'],
['Bulgarian Split Squat','legs','bulgarian split squat|bulgarian|split squat|split squats|bss','w'],
['Step-Up','legs','step up|step ups|stepup|stepups','w'],
['Leg Extension','legs','leg extension|leg extensions|quad extension','w'],
['Lying Leg Curl','legs','leg curl|leg curls|lying leg curl|hamstring curl|hamstring curls','w'],
['Seated Leg Curl','legs','seated leg curl|seated leg curls|seated hamstring curl','w'],
['Standing Calf Raise','legs','calf raise|calf raises|standing calf raise|calves','w'],
['Seated Calf Raise','legs','seated calf raise|seated calf raises|seated calves','w'],
['Adductor Machine','legs','adductor|adductors|adductor machine|inner thigh','w'],
['Bodyweight Squat','legs','bodyweight squat|bodyweight squats|air squat|air squats','b'],
// glutes
['Hip Thrust','glutes','hip thrust|hip thrusts|barbell hip thrust|glute bridge|glute bridges','w'],
['Abductor Machine','glutes','abductor|abductors|abductor machine|hip abduction|outer thigh','w'],
['Cable Kickback','glutes','glute kickback|cable kickback|glute kickbacks|cable kickbacks','w'],
// core
['Crunch','core','crunch|crunches|ab crunch|ab crunches','b'],
['Cable Crunch','core','cable crunch|cable crunches|kneeling cable crunch','w'],
['Hanging Leg Raise','core','hanging leg raise|hanging leg raises|leg raise|leg raises|knee raise|knee raises|hanging knee raise','b'],
['Sit-Up','core','sit up|sit ups|situp|situps','b'],
['Russian Twist','core','russian twist|russian twists','b'],
['Ab Wheel Rollout','core','ab wheel|ab rollout|ab rollouts|ab wheel rollout','b'],
['Decline Crunch','core','decline crunch|decline crunches|decline sit up|decline sit ups','b'],
['Bicycle Crunch','core','bicycle crunch|bicycle crunches|bicycles','b'],
['Mountain Climber','core','mountain climber|mountain climbers','b'],
// full body
['Kettlebell Swing','full body','kettlebell swing|kettlebell swings|kb swing|kb swings','w'],
['Clean and Press','full body','clean and press|clean & press','w'],
['Power Clean','full body','power clean|power cleans|clean|cleans','w'],
['Thruster','full body','thruster|thrusters','w'],
['Burpee','full body','burpee|burpees','b'],
['Farmer’s Walk','full body','farmers walk|farmer walk|farmers carry|farmer carry','w'],
// cardio machines (sessions logged by time)
['Treadmill','cardio','treadmill|treadmill run|treadmill walk|incline walk|incline treadmill|treadmill running|treadmill walking','c',5],
['Stationary Bike','cardio','stationary bike|exercise bike|spin bike|spin|spinning|cycle machine|bike|cycling machine|indoor cycling|air bike|assault bike','c',7],
['Elliptical','cardio','elliptical|cross trainer|crosstrainer|elliptical trainer','c',5],
['Rowing Machine','cardio','rowing machine|rower|rowing|erg|row machine|concept2','c',7],
['Stair Climber','cardio','stair climber|stairmaster|stair master|stairs machine|stepmill','c',9],
['Jump Rope','cardio','jump rope|skipping|skipping rope|skip rope|rope skipping','c',11],
];

const EX = ROWS.map(([name, group, aliases, kind, met]) => ({ name, group, kind, met: met || null, aliases: aliases.split('|') }));

// Words that may sit around the numbers without changing their meaning.
const FILLER = new Set(('sets set reps rep of at for kg lb x each side per arm with total and then did done i my ' +
  'min mins minute minutes hr hrs hour hours h km k incline avg bpm heart rate speed level pace sec secs seconds ' +
  'working work heavy light warm up warmup warmups top backoff off weight weighted added plus bodyweight bw a an the on in').split(' '));
// Shorthand people use in the gym.
const ABBR = [
  [/\bdbs?\b/g, 'dumbbell'], [/\bdumbells?\b/g, 'dumbbell'], [/\bdumbbells\b/g, 'dumbbell'], [/\bbb\b/g, 'barbell'], [/\bkbs?\b/g, 'kettlebell'],
  [/\bpull[- ]?ups?\b/g, 'pull up'], [/\bchin[- ]?ups?\b/g, 'chin up'], [/\bpush[- ]?ups?\b/g, 'push up'], [/\bsit[- ]?ups?\b/g, 'sit up'],
  [/\bstep[- ]?ups?\b/g, 'step up'], [/\btri(?:s|ceps?)?\b/g, 'tricep'], [/\bbi(?:s|ceps?)\b/g, 'bicep'], [/\bextensions\b/g, 'extension'],
  [/\braises\b/g, 'raise'], [/\bcurls\b/g, 'curl'], [/\brows\b/g, 'row'], [/\bpresses\b/g, 'press'], [/\b(?:flyes|flys|flies)\b/g, 'fly'],
  [/\bsquats\b/g, 'squat'], [/\blunges\b/g, 'lunge'], [/\bdips\b/g, 'dip'], [/\bshrugs\b/g, 'shrug'], [/\bdeadlifts\b/g, 'deadlift'],
];
const norm = s => {
  let t = String(s || '').toLowerCase().replace(/[’']/g, '').replace(/[×*]/g, ' x ').replace(/&/g, ' and ');
  t = t.replace(/(\d)\s*(kgs?|kilos?)\b/g, '$1 kg').replace(/(\d)\s*(lbs?|pounds?)\b/g, '$1 lb');
  t = t.replace(/(\d)\s*x\s*(?=\d)/g, '$1 x ').replace(/\bx(?=\d)/g, 'x ');
  t = t.replace(/[^a-z0-9.@%+ ]+/g, ' ');
  for (const [re, to] of ABBR) t = t.replace(re, to);
  return t.replace(/\s+/g, ' ').trim();
};
const normAlias = a => norm(a);

// Index: longest alias first, so "incline dumbbell press" wins over "dumbbell press".
function buildIndex(known) {
  const idx = [];
  for (const e of EX) for (const a of [e.name, ...e.aliases]) { const k = normAlias(a); if (k) idx.push({ k, e }); }
  // Exercises this person has logged before: matchable by their own name, and they
  // take over a built-in entry when one of its aliases is the same words.
  for (const kx of known || []) {
    const k = normAlias(kx.name); if (!k || !kx.name) continue;
    const lib = idx.find(x => x.k === k);
    const old = lib && lib.e;
    const e = old ? { ...old, name: kx.name } : { name: kx.name, group: kx.group || 'full body', kind: kx.group === 'cardio' ? 'c' : 'w', met: kx.met || null, aliases: [] };
    if (old) for (const x of idx) if (x.e === old) x.e = e;
    idx.push({ k, e });
  }
  idx.sort((a, b) => b.k.length - a.k.length);
  return idx;
}

function findExercise(t, idx) {
  const padded = ' ' + t + ' ';
  for (const x of idx) {
    const at = padded.indexOf(' ' + x.k + ' ');
    if (at >= 0) return { e: x.e, rest: (padded.slice(0, at) + ' ' + padded.slice(at + x.k.length + 1)).replace(/\s+/g, ' ').trim() };
  }
  return null;
}

const ok = (v, lo, hi) => Number.isFinite(v) && v >= lo && v <= hi;
const r2 = v => Math.round(v * 100) / 100;

/* Sets from the text around the name. Returns {sets:[{weight,reps}], weight} or null.
   prevWeight: weight of the previous set when this part continues an exercise ("60x8, 65x6"). */
function readSets(text, kind, prevWeight, allow) {
  let t = ' ' + text + ' ';
  const lbToKg = v => r2(v * 0.45359237);
  t = t.replace(/(\d+(?:\.\d+)?) lb\b/g, (_, v) => lbToKg(+v) + ' kg');
  const sets = []; let W = null;
  // 1. Default weight: "@ 60", "at 60 kg", "+10 kg", or a lone "60 kg" not followed by x.
  let m = t.match(/(?:@|\bat\b)\s*(\d+(?:\.\d+)?)(?:\s*kg)?/) || t.match(/\+\s*(\d+(?:\.\d+)?)\s*kg?/) || t.match(/(\d+(?:\.\d+)?)\s*kg\b(?!\s*x)/);
  if (m) { W = +m[1]; t = t.replace(m[0], ' '); }
  const add = (n, reps, w) => { for (let i = 0; i < n; i++) sets.push({ weight: w, reps }); };
  // 2. "3 sets of 8", "3 sets x 8 reps", "8 reps x 3 sets", "3 sets 8 reps"
  t = t.replace(/(\d+)\s*sets?\s*(?:of|x)?\s*(\d+)(?:\s*reps?)?/g, (_, s, r) => { add(+s, +r, null); return ' '; });
  t = t.replace(/(\d+)\s*reps?\s*(?:x|for)?\s*(\d+)\s*sets?/g, (_, r, s) => { add(+s, +r, null); return ' '; });
  // 3. Chains: "60 x 8", "22.5 x 10 x 10 x 8", "3 x 8 x 60", "60 kg x 5 x 5"
  t = t.replace(/(\d+(?:\.\d+)?)(\s*kg)?((?:\s*x\s*\d+(?:\.\d+)?)+)(\s*kg)?/g, (_, a, akg, xs, lastKg) => {
    const n = xs.split('x').map(s => s.trim()).filter(Boolean).map(Number); a = +a;
    if (n.length === 1) {
      const b = n[0];
      if (lastKg) add(1, a, b);                                    // "8 x 60 kg": reps at weight
      else if (akg) add(1, b, a);
      else if (W != null) add(a, b, W);
      else if (kind === 'b') { if (a <= 10) add(a, b, 0); else if (b <= 10) add(b, a, 0); else add(1, b, a); }
      else if (a <= 5 && b <= 30) add(a, b, null);
      else add(1, b, a);
    } else if (n.length === 2 && !akg && !lastKg && a <= 10 && n[1] > 10) add(a, n[0], n[1]);          // 3 x 8 x 60
    else if (n.length === 2 && lastKg) add(a, n[0], n[1]);                                                  // 3 x 8 x 60 kg
    else if (n.length === 2 && n[0] <= 5) add(n[0], n[1], a);                                               // 100 x 5 x 5 → 5 sets of 5
    else for (const r of n) add(1, r, a);                                                                   // 22.5 x 10 x 10 x 8
    return ' ';
  });
  // 4. Bare rep counts: "push ups 20 20 15", "bench 60 kg 8", or "8" continuing a previous set.
  const bare = [...t.matchAll(/(?:^|\s)(\d+)(?=\s|$)/g)].map(x => +x[1]);
  if (bare.length) { t = t.replace(/(?:^|\s)\d+(?=\s|$)/g, ' '); for (const r of bare) add(1, r, null); }
  // Anything else left means we didn't understand it.
  const left = t.replace(/[.@%+]/g, ' ').split(' ').filter(w => w && !FILLER.has(w) && !(allow && allow.has(w)));
  if (left.length || !sets.length) return null;
  const fill = W != null ? W : (kind === 'b' ? 0 : prevWeight != null ? prevWeight : 0);
  for (const s of sets) if (s.weight == null) s.weight = fill;
  if (sets.length > 20 || !sets.every(s => ok(s.reps, 1, 100) && ok(s.weight, 0, 500))) return null;
  return { sets: sets.map(s => ({ weight: r2(s.weight), reps: Math.round(s.reps) })), weight: W };
}

// Cardio: "20 min", "1 hr", "5 km", "incline 8" / "8% incline", "avg hr 140" / "140 bpm", "speed 6", "level 8".
function readCardio(text, allow) {
  let t = ' ' + text + ' '; const out = { duration_min: null, distance_km: null, incline_pct: null, avg_hr: null };
  const take = (re, fn) => { const m = t.match(re); if (m) { fn(m); t = t.replace(m[0], ' '); } };
  take(/(?:avg\s*)?(?:hr|heart rate)\s*(\d{2,3})\b|(\d{2,3})\s*bpm/, m => out.avg_hr = +(m[1] || m[2]));
  take(/(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\b/, m => out.duration_min = +m[1] * 60);
  take(/(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)\b/, m => out.duration_min = (out.duration_min || 0) + +m[1]);
  take(/(\d+(?:\.\d+)?)\s*(?:km|k)\b/, m => out.distance_km = +m[1]);
  take(/incline\s*(\d+(?:\.\d+)?)\s*%?|(\d+(?:\.\d+)?)\s*%\s*incline/, m => out.incline_pct = +(m[1] || m[2]));
  take(/(?:speed|level|resistance)\s*(\d+(?:\.\d+)?)/, () => {});
  const left = t.replace(/[.@%+]/g, ' ').split(' ').filter(w => w && !FILLER.has(w) && !(allow && allow.has(w)));
  if (left.length || !ok(out.duration_min, 1, 600)) return null;
  if (out.distance_km != null && !ok(out.distance_km, 0.1, 100)) return null;
  if (out.incline_pct != null && !ok(out.incline_pct, 0, 40)) return null;
  if (out.avg_hr != null && !ok(out.avg_hr, 60, 220)) return null;
  return out;
}

/* One comma-separated part of an entry.
   ctx: {index (from buildIndex), prev: the exercise the previous part produced, or null}
   Returns {exercise, continued} or null when this part isn't a gym entry we can read. */
function parsePart(raw, ctx) {
  const t = norm(raw); if (!t) return null;
  const hit = findExercise(t, ctx.index);
  if (!hit) {
    // "65x6" or "8" right after "bench 60x8": more sets of the same exercise.
    const p = ctx.prev; if (!p || p.muscle_group === 'cardio' || /[a-z]{2,}/.test(t.replace(/\b(kg|lb|x|reps?|sets?|of|at)\b/g, ''))) return null;
    const last = p.sets[p.sets.length - 1];
    const r = readSets(t, p.kind, last ? last.weight : null); if (!r) return null;
    return { exercise: p, continued: true, sets: r.sets };
  }
  const e = hit.e;
  // Words from the exercise's own aliases may surround the match ("treadmill incline walk").
  const own = new Set(e.aliases.concat(e.name).flatMap(a => normAlias(a).split(' ')));
  const rest = hit.rest;
  if (e.kind === 'c') {
    const c = readCardio(rest, own); if (!c) return null;
    return { exercise: { name: e.name, muscle_group: 'cardio', kind: 'c', sets: [], met: e.met, ...c } };
  }
  const r = readSets(rest, e.kind, null, own); if (!r) return null;
  return { exercise: { name: e.name, muscle_group: e.group, kind: e.kind, sets: r.sets, duration_min: null, distance_km: null, incline_pct: null, avg_hr: null, met: null } };
}

/* Recovery for the muscles trained, from the sets logged: big muscle groups and
   heavy or high-volume work need longer. */
const BIG = new Set(['legs', 'back', 'glutes', 'chest', 'full body']);
function recovery(exercises) {
  const by = new Map();
  for (const x of exercises) { if (x.muscle_group === 'cardio') continue;
    const g = by.get(x.muscle_group) || { sets: 0, heavy: 0 }; g.sets += x.sets.length; g.heavy += x.sets.filter(s => s.reps <= 6 && s.weight > 0).length; by.set(x.muscle_group, g); }
  if (!by.size) return null;
  let hours = 0;
  for (const [m, g] of by) {
    const hard = g.heavy >= g.sets / 2 || g.sets >= 10;
    hours = Math.max(hours, BIG.has(m) ? (hard ? 72 : 48) : (hard ? 48 : 36));
  }
  const muscles = [...by.keys()];
  const list = muscles.length > 1 ? muscles.slice(0, -1).join(', ') + ' and ' + muscles[muscles.length - 1] : muscles[0];
  return { muscles, hours, source: 'app',
    summary: `Give your ${list} about ${hours} hours before training them hard again.`,
    tips: ['Hit your protein target today and tomorrow.', 'Aim for 7–9 hours of sleep tonight.', hours >= 72 ? 'Light movement or mobility work tomorrow helps; skip heavy work for these muscles.' : 'Other muscle groups or light cardio are fine tomorrow.'] };
}

const api = { EXERCISES: EX, norm, buildIndex, parsePart, readSets, readCardio, recovery };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Gym = api;
})(this);
