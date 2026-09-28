/* MaxxTempo — sports and other activities without AI.
   Reads entries like "badminton 1 hour", "ran 5 km in 28 min" or "cricket nets 90 min,
   bowled 6 overs" and picks the matching row of the 2024 Adult Compendium of Physical
   Activities (data/activities.json, see DATA-LICENSES.md). Calories are worked out in
   app.js from the MET, the person's weight and their own resting burn (height, age, sex).
   Loaded before app.js; also required by sports.test.js. */
(function (root) {
'use strict';

let ROWS = [], BY = new Map();
function setTable(t) {
  ROWS = ((t && t.items) || []).map(([code, met, desc, cat]) => ({ code, met, desc, cat, d: String(desc).toLowerCase() }));
  BY = new Map(ROWS.map(r => [r.code, r]));
}
const ready = () => ROWS.length > 0;

/* [key, name, words people use, which Compendium rows, usual row, how it's measured]
   speed: running / walking / cycling rows are picked by pace when a distance is given. */
const FAM = [
  ['table-tennis', 'Table tennis', /\b(table ?tennis|ping ?pong)\b/, /^table tennis/, '15660'],
  ['badminton', 'Badminton', /\b(badminton|shuttle ?cock)\b/, /^badminton/, '15030'],
  ['squash', 'Squash', /\bsquash\b/, /^squash/, '15652'],
  ['tennis', 'Tennis', /\b(lawn )?tennis\b/, /^tennis/, '15675'],
  ['pickleball', 'Pickleball', /\bpickle ?ball\b/, /^paddleball/, '15500'],
  ['cricket', 'Cricket', /\bcricket\b/, /^cricket/, '15150'],
  ['futsal', 'Futsal', /\bfutsal\b/, /^futsal/, '15195'],
  ['football', 'Football', /\b(football|soccer)\b/, /^soccer|^walking football/, '15610'],
  ['basketball', 'Basketball', /\bbasket ?ball\b/, /^basketball, (?!officiating)/, '15055'],
  ['volleyball', 'Volleyball', /\bvolley ?ball\b/, /^volleyball/, '15710'],
  ['hockey', 'Hockey', /\bhockey\b/, /^hockey/, '15350'],
  ['handball', 'Handball', /\bhandball\b/, /^handball/, '15330'],
  ['rugby', 'Rugby', /\brugby\b/, /^rugby/, '15560'],
  ['netball', 'Netball', /\bnetball\b/, /^netball/, '15477'],
  ['baseball', 'Baseball', /\b(baseball|softball)\b/, /^softball|^softball or baseball/, '15620'],
  ['golf', 'Golf', /\bgolf\b/, /^golf/, '15255'],
  ['frisbee', 'Ultimate frisbee', /\b(ultimate|frisbee)\b/, /^frisbee/, '15250'],
  ['kickboxing', 'Kickboxing', /\bkick ?boxing\b/, /^kickboxing/, '15457'],
  ['boxing', 'Boxing', /\bboxing\b/, /^boxing/, '15120'],
  ['martial-arts', 'Martial arts', /\b(martial arts?|karate|judo|taekwondo|tae kwon do|jiu ?jitsu|mma|muay thai|kung ?fu|kalaripayattu)\b/, /^martial arts|^judo|^taekwondo|^kendo/, '15430'],
  ['wrestling', 'Wrestling', /\bwrestl(ing|ed)\b/, /^wrestling/, '15730'],
  ['climbing', 'Climbing', /\b(rock climbing|bouldering|wall climbing)\b/, /^rock/, '15537'],
  ['skating', 'Skating', /\b(skating|roller ?blading|skateboard(ing)?)\b/, /^skating|^roller ?blading|^skateboard/, '15590'],
  ['skipping', 'Skipping', /\b(skipping|jump(ing)? ?rope|rope ?(jumping|skipping))\b/, /^rope jumping|^rope skipping|^jumping rope/, '02068'],
  ['trampoline', 'Trampoline', /\btrampoline\b/, /^trampoline/, '15700'],
  ['jogging', 'Jogging', /\b(jog|jogs|jogging|jogged)\b/, /^jogging, general|^running/, '12020', 'run'],
  ['running', 'Running', /\b(run|runs|running|ran|marathon)\b/, /^running/, '12145', 'run'],
  ['hiking', 'Hiking', /\b(hike|hikes|hiking|hiked|trek|treks|trekking|trekked)\b/, /^hiking|^backpacking/, '17082'],
  ['walking', 'Walking', /\b(walk|walks|walked|walking|stroll|strolled)\b/, /^walking/, '17190', 'walk'],
  ['cycling', 'Cycling', /\b(cycling|cycled|cycle ride|bike ride|biking|biked|bicycling|spin class|spinning)\b/, /^bicycling/, '01014', 'bike'],
  ['swimming', 'Swimming', /\b(swim|swims|swimming|swam)\b/, /^swimming/, '18310', 'swim'],
  ['rowing', 'Rowing', /\b(rowing|rower|rowed)\b/, /^rowing/, '02071'],
  ['kayaking', 'Kayaking', /\b(kayak(ing)?|canoe(ing)?)\b/, /^kayaking|^canoeing/, '18100'],
  ['water-aerobics', 'Water aerobics', /\b(water|aqua) aerobics\b/, /^water aerobics/, '18355'],
  ['surfing', 'Surfing', /\bsurf(ing)?\b/, /^surfing/, '18220'],
  ['yoga', 'Yoga', /\b(yoga|surya namaskar|sun salutations?)\b/, /^yoga/, '02175'],
  ['pilates', 'Pilates', /\bpilates\b/, /^pilates/, '02105'],
  ['zumba', 'Zumba', /\bzumba\b/, /^zumba/, '02310'],
  ['aerobics', 'Aerobics', /\baerobics?\b/, /^aerobic/, '02005'],
  ['hiit', 'HIIT', /\b(hiit|high intensity interval)\b/, /^high intensity interval/, '02210'],
  ['circuit', 'Circuit training', /\bcircuit( training)?\b/, /^circuit training/, '02040'],
  ['calisthenics', 'Calisthenics', /\bcalisthenics\b/, /^calisthenics/, '02030'],
  ['elliptical', 'Elliptical', /\b(elliptical|cross ?trainer)\b/, /^elliptical/, '02048'],
  ['stairs', 'Stair climbing', /\b(stair ?(climb(ing)?|master|mill)|climbed stairs|stairs)\b/, /^stair climbing/, '17131'],
  ['stretching', 'Stretching', /\b(stretching|mobility)\b/, /^stretching/, '02101'],
  ['tai-chi', 'Tai chi', /\btai ?chi\b/, /^tai chi/, '15670'],
  ['dance', 'Dance', /\b(danc(e|es|ing|ed)|bhangra|garba|bharatanatyam|kathak|salsa|hip ?hop)\b/, /danc|^ballet|^salsa|^tap$/, '03025'],
  ['skiing', 'Skiing', /\bski(ing)?\b/, /^skiing/, '19075'],
  ['horse-riding', 'Horse riding', /\bhorse ?(riding|back)\b/, /^horseback riding/, '15370'],
];
const FAM_BY = new Map(FAM.map(f => [f[0], f]));

/* Words people use, grouped with the Compendium words that mean the same thing. */
const GROUPS = [
  [/\b(casual|friendly|fun|social|recreational|leisure(ly)?|easy|light|relaxed|gentle|chill|rallies)\b/, ['social', 'recreational', 'leisurely', 'leisure', 'light', 'easy', 'non-competitive', 'slow', 'general'], 1],
  [/\b(competitive|match|matches|tournament|league|game|games|intense|hard|vigorous|fast|race|racing|power)\b/, ['competitive', 'match', 'game', 'vigorous', 'fast', 'racing', 'power'], 1],
  [/\b(practice|drills?|training|nets|coaching)\b/, ['practice', 'drills', 'training', 'non-game'], 1],
  [/\bsingles\b/, ['singles']], [/\bdoubles\b/, ['doubles']],
  [/\bbeach\b/, ['beach']], [/\bice\b/, ['ice']], [/\bfield\b/, ['field']],
  [/\b(freestyle|crawl|front crawl)\b/, ['freestyle', 'crawl']], [/\bbreast ?stroke\b/, ['breaststroke']],
  [/\bback ?stroke\b/, ['backstroke']], [/\bbutterfly\b/, ['butterfly']], [/\blaps?\b/, ['laps'], 1],
  [/\b(sea|ocean|lake|river|open water)\b/, ['lake', 'ocean', 'river', 'open water']],
  [/\b(bag|heavy bag|punching)\b/, ['punching bag']], [/\bsparring\b/, ['sparring']], [/\bring\b/, ['in ring']],
  [/\b(stationary|spin|spinning|indoor cycl\w*|peloton)\b/, ['stationary', 'spin']], [/\b(mountain|mtb|trail)\b/, ['mountain']],
  [/\bhatha\b/, ['hatha']], [/\bvinyasa\b/, ['vinyasa']], [/\bhot yoga\b/, ['hot']], [/\bpower yoga\b/, ['power']],
  [/\b(surya namaskar|sun salutations?)\b/, ['surya namaskar']],
  [/\b(shooting|shoot around)\b/, ['shooting baskets']], [/\b(bouldering)\b/, ['bouldering']],
  [/\b(brisk|quick)\b/, ['brisk']], [/\b(treadmill)\b/, ['treadmill']],
  [/\b(backpack|daypack|with a bag)\b/, ['backpacking', 'daypack']],
  [/\b(cross ?country)\b/, ['cross country']], [/\b(marathon)\b/, ['marathon']],
  [/\b(track)\b/, ['track']], [/\b(roller ?blading|inline)\b/, ['roller blading']], [/\bskateboard/, ['skateboard']],
];
// Specific words (a stroke, singles, beach…) count double against effort words.
const intents = t => GROUPS.filter(([re]) => re.test(t)).map(g => ({ words: g[1], w: g[2] || 2 }));

const num = s => { const w = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 }; return w[s] != null ? w[s] : parseFloat(s); };
function duration(t) {
  let min = 0, m;
  if ((m = t.match(/(\d+(?:\.\d+)?)\s*h(?:r|rs|our|ours)?\s*(?:and\s*)?(\d+)\s*m(?:in|ins|inute|inutes)?\b/))) return +m[1] * 60 + +m[2];
  if ((m = t.match(/\b(\d+):(\d{2})\s*(?:h|hr|hrs|hours?)\b/))) return +m[1] * 60 + +m[2];
  if ((m = t.match(/\b(\d+)\s*h\s*(\d{1,2})\b(?!\s*(?:km|k|kg|g)\b)/))) return +m[1] * 60 + +m[2];
  if (/\b(an|one) and a half hours?\b|\b1\.5 ?h/.test(t)) return 90;
  if (/\bhalf an? hour\b/.test(t)) return 30;
  if ((m = t.match(/\b(\d+(?:\.\d+)?|an?|one|two|three|four|five)\s*(?:h|hr|hrs|hour|hours)\b/))) min += num(m[1]) * 60;
  // "400 m" is metres (and any "m" when swimming); "40 m" is minutes.
  if ((m = t.match(/\b(\d+(?:\.\d+)?)\s*(min|mins|minute|minutes|m)\b/)) && !(m[2] === 'm' && (+m[1] >= 200 || /swim|swam|pool|lap/.test(t)))) min += +m[1];
  return min;
}
function distance(t) {
  let m;
  if ((m = t.match(/\b(\d+(?:\.\d+)?)\s*(?:km|kms|k|kilomet(?:er|re)s?)\b/))) return +m[1];
  if ((m = t.match(/\b(\d+(?:\.\d+)?)\s*(?:mi|miles?)\b/))) return +m[1] * 1.609;
  if ((m = t.match(/\b(\d{2,5})\s*(mtr|mtrs|meters?|metres?|m)\b/)) && (m[2] !== 'm' || +m[1] >= 200 || /swim|swam|lap|pool/.test(t))) return +m[1] / 1000;
  if ((m = t.match(/\b(\d+)\s*laps?\b/)) && /swim|swam|pool/.test(t)) return +m[1] * 0.05; // 25 m pool, there and back
  if ((m = t.match(/\b(\d+(?:\.\d+)?)\s*(?:half )?marathons?\b/))) return +m[1] * (/half/.test(t) ? 21.1 : 42.2);
  if (/\bhalf marathon\b/.test(t)) return 21.1; if (/\bmarathon\b/.test(t)) return 42.2;
  return null;
}
// Cricket numbers the app tracks for bowling load.
function cricketStats(t) {
  const s = {}; let m;
  if ((m = t.match(/\b(?:bowled|bowl|bowling)\s*(\d+(?:\.\d)?)\s*overs?\b/) || t.match(/\b(\d+(?:\.\d)?)\s*overs?\s*(?:bowled|of bowling|bowling)\b/))) { const o = m[1].split('.'); s.balls_bowled = +o[0] * 6 + (+(o[1] || 0)); }
  else if ((m = t.match(/\b(?:bowled|bowl)\s*(\d+)\s*balls?\b/) || t.match(/\b(\d+)\s*balls?\s*bowled\b/))) s.balls_bowled = +m[1];
  if ((m = t.match(/\bfaced\s*(\d+)\s*balls?\b/) || t.match(/\b(\d+)\s*balls?\s*faced\b/))) s.balls_faced = +m[1];
  if ((m = t.match(/\bbatted\s*(?:for\s*)?(\d+)\s*(?:min|mins|minutes)\b/))) s.minutes_batted = +m[1];
  if ((m = t.match(/\bfielded\s*(?:for\s*)?(\d+)\s*overs?\b/) || t.match(/\b(\d+)\s*overs?\s*(?:of\s*)?fielding\b/))) s.overs_fielded = +m[1];
  return s;
}
const DETAIL_RE = /\b(bowled|bowling|overs?|faced|batted|fielded|fielding|wickets?|runs? scored|scored|innings|won|lost|sets?|goals?|points?)\b/;

function speedMph(d) {
  let m;
  if ((m = d.match(/(\d+(?:\.\d+)?)\s*(?:-|to|–)\s*(\d+(?:\.\d+)?)\s*mph/))) return (+m[1] + +m[2]) / 2;
  if ((m = d.match(/<\s*(\d+(?:\.\d+)?)\s*mph/))) return +m[1] - 2;
  if ((m = d.match(/>\s*(\d+(?:\.\d+)?)\s*mph/))) return +m[1] + 2;
  if ((m = d.match(/(\d+(?:\.\d+)?)\s*mph/))) return +m[1];
  return null;
}
const PLAIN_PACE = /treadmill|uphill|downhill|stroller|backpack|barefoot|curved|nordic|poles|backward|load|incline|grade|seated|standing|stationary|walker|e-bike|mountain|hands|rpm|firm|dirt/;
function bySpeed(rows, kmh, text) {
  const tm = /treadmill/.test(text);
  const cands = rows.filter(r => speedMph(r.d) != null && (tm ? /treadmill, (?!downhill|backwards)[^,]*mph[^,]*, 0% grade|^running, [\d.]/.test(r.d) : !PLAIN_PACE.test(r.d.replace(/firm, level surface|firm surface|level, firm/g, ''))));
  if (!cands.length) return null;
  const mph = kmh / 1.609;
  return cands.reduce((b, r) => Math.abs(speedMph(r.d) - mph) < Math.abs(speedMph(b.d) - mph) ? r : b);
}
function swimByPace(rows, km, min) {
  const ypm = km * 1094 / min, crawl = rows.filter(r => /crawl/.test(r.d) && /yards/.test(r.d) && !/elite/.test(r.d));
  const at = r => { const m = r.d.match(/(\d+)\s*-\s*(\d+) yards|~(\d+) yards/); return m ? (m[3] ? +m[3] : (+m[1] + +m[2]) / 2) : null; };
  if (ypm > 90) return BY.get('18294');
  return crawl.reduce((b, r) => Math.abs(at(r) - ypm) < Math.abs(at(b) - ypm) ? r : b, crawl[0]);
}

// Rows for a special setting (a track, a treadmill, uphill, on ice…) only when the entry says so.
const SETTING = /\b(track|marathon|stairs|treadmill|uphill|downhill|stroller|backpack|barefoot|wheelchair|cross country|triathlon|hilly|mountain|stationary|bmx|e-bike|in place|mini-tramp|beach|sand|ice|water tank|ergometer|digi-jump|weights|robot|virtual|video|curved|nordic|backward|elite|synchronized|treading)\b/g;
function pickRow(fam, text, profileText) {
  const def0 = BY.get(fam[4]);
  const rows = ROWS.filter(r => fam[3].test(r.d) && !/officiating|coaching|spectator/.test(r.d) && (r === def0 || (r.d.match(SETTING) || []).every(q => text.includes(q))));
  if (!rows.length) return null;
  let want = intents(text);
  if (!want.length && profileText) want = intents(profileText.toLowerCase());
  const def = BY.get(fam[4]) || rows[0];
  if (!want.length) return def;
  const score = r => want.reduce((s, g) => s + (g.words.some(w => r.d.includes(w)) ? g.w : 0), 0);
  const best = Math.max(...rows.map(score)); if (!best) return def;
  const top = rows.filter(r => score(r) === best);
  if (top.includes(def)) return def;
  // Among equal matches: the newer measured rows over the older Taylor codes, then the one
  // nearest the usual effort.
  return top.sort((a, b) => (/taylor/.test(a.d) - /taylor/.test(b.d)) || (Math.abs(a.met - def.met) - Math.abs(b.met - def.met)))[0];
}

const LEVEL = met => met < 3 ? 'light' : met < 6 ? 'moderate' : 'vigorous';
/* Returns null when the text isn't a recognisable activity, or
   {key, name, minutes, km, met, code, desc, stats, assumed, level}. */
function read(text, opts) {
  opts = opts || {};
  const t = String(text || '').toLowerCase().replace(/[!?,;]/g, ' ').replace(/(\d)\s*(k|km|h|hr|hrs|m|min|mins)(\d)/g, '$1 $2 $3').replace(/\s+/g, ' ').trim();
  if (!t || !ready()) return null;
  const fam = FAM.find(f => f[2].test(t)); if (!fam) return null;
  let min = duration(t); const km = distance(t); const prof = opts.profile || {};
  // Needs a sign it was a session: a time, a distance, a verb, or the activity on its own
  // ("yoga bar" and "butternut squash" are foods).
  const timed = min > 0 || !!km;
  const played = /\b(play|played|playing|did|do|done|went|go|session|match|game|practice|training|class|nets)\b/.test(t);
  const bare = !t.replace(fam[2], ' ').replace(/\b(today|morning|evening|night|afternoon|some|in|the|this|at|with|friends?|a|an|my|for)\b/g, ' ').trim();
  if (!timed && !played && !bare) return null;
  if (/^(walking|stairs|stretching)$/.test(fam[0]) && !timed) return null;
  if (/^(squash|surfing|dance|skiing)$/.test(fam[0]) && !timed && !played) return null;
  if (fam[0] === 'squash' && /\b(butternut|pumpkin|sabzi|curry|soup|roasted|grams?|cup|bowl)\b|\d\s*g\b/.test(t)) return null;
  let assumed = '';
  const kind = fam[5];
  const PACE = { run: 9.7, walk: 5, bike: 16, swim: 2 }; // km/h at a usual self-selected pace
  if (!(min > 0) && km && kind) { min = Math.round(km / PACE[kind] * 60); assumed = `Took about ${min} min at a usual ${fam[1].toLowerCase()} pace.`; }
  if (!(min > 0) && prof.minutes > 0) { min = prof.minutes; assumed = `Used your usual ${min}-minute session; add the time for a better estimate.`; }
  if (!(min > 0) && !km) { min = 60; assumed = 'Assumed 60 minutes; add the time for a better estimate.'; }
  if (!(min > 0) || min > 720) return null;
  let row = null;
  const fams = ROWS.filter(r => fam[3].test(r.d));
  if (km && (kind === 'run' || kind === 'walk' || kind === 'bike') && !/stationary|spin/.test(t)) row = bySpeed(fams, km / (min / 60), t);
  if (km && kind === 'swim' && !/breast|back ?stroke|butterfly/.test(t)) row = swimByPace(fams, km, min);
  if (!row) row = pickRow(fam, t, prof.text);
  if (!row) return null;
  const stats = fam[0] === 'cricket' ? cricketStats(t) : {};
  return { key: fam[0], name: fam[1], text: t, minutes: Math.round(min), km, met: row.met, code: row.code, desc: row.desc, stats, assumed, level: LEVEL(row.met) };
}

/* One entry chunk may mix a session with food ("badminton 1 hr and 2 idli"):
   split on and/then, keep the parts about the activity, hand back the rest. */
function split(chunk) {
  const parts = String(chunk).split(/\s*(?:\band then\b|\bthen\b|\bafter that\b|\band\b|\bplus\b|&|\+)\s*/i).map(x => x.trim()).filter(Boolean);
  const acts = [], rest = [];
  for (const p of parts) {
    const low = p.toLowerCase();
    if (FAM.some(f => f[2].test(low))) acts.push(p);
    else if (acts.length && (DETAIL_RE.test(low) || duration(low) > 0 || distance(low) || intents(low).length)) acts[acts.length - 1] += ' ' + p;
    else rest.push(p);
  }
  return { acts, rest };
}
const isDetail = t => DETAIL_RE.test(String(t).toLowerCase()) && !FAM.some(f => f[2].test(String(t).toLowerCase()));

const families = () => FAM.map(f => ({ key: f[0], name: f[1], code: f[4] }));
const row = code => BY.get(code) || null;
const api = { setTable, ready, read, split, isDetail, cricketStats, families, row, family: k => FAM_BY.get(k) || null };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Sports = api;
})(this);
