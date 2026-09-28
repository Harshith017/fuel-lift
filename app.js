/* MaxxTempo — app. Ported from the claude.ai artifact: storage now goes
   through backend.js (Supabase + offline cache), AI through the `claude`
   edge function, and every number through calc.js. */
(() => {
'use strict';
const Calc = window.Calc;

/* ---------- constants ---------- */
const MICROS = [
  {key:'sodium_mg',label:'Sodium',unit:'mg',kind:'limit'},
  {key:'cholesterol_mg',label:'Cholesterol',unit:'mg',kind:'limit'},
  {key:'sat_fat_g',label:'Saturated fat',unit:'g',kind:'limit'},
  {key:'potassium_mg',label:'Potassium',unit:'mg'},
  {key:'calcium_mg',label:'Calcium',unit:'mg'},
  {key:'iron_mg',label:'Iron',unit:'mg'},
  {key:'magnesium_mg',label:'Magnesium',unit:'mg'},
  {key:'zinc_mg',label:'Zinc',unit:'mg'},
  {key:'vitamin_a_mcg',label:'Vitamin A',unit:'mcg'},
  {key:'vitamin_c_mg',label:'Vitamin C',unit:'mg'},
  {key:'vitamin_d_mcg',label:'Vitamin D',unit:'mcg'},
  {key:'vitamin_b12_mcg',label:'Vitamin B12',unit:'mcg'},
  {key:'folate_mcg',label:'Folate',unit:'mcg'},
  {key:'omega3_g',label:'Omega-3',unit:'g'},
];
const RDA = {
  male:{cholesterol_mg:300,sodium_mg:2000,potassium_mg:3400,calcium_mg:1000,iron_mg:8,magnesium_mg:400,zinc_mg:11,vitamin_a_mcg:900,vitamin_c_mg:90,vitamin_d_mcg:15,vitamin_b12_mcg:2.4,folate_mcg:400,omega3_g:1.6},
  female:{cholesterol_mg:300,sodium_mg:2000,potassium_mg:2600,calcium_mg:1000,iron_mg:18,magnesium_mg:310,zinc_mg:8,vitamin_a_mcg:700,vitamin_c_mg:75,vitamin_d_mcg:15,vitamin_b12_mcg:2.4,folate_mcg:400,omega3_g:1.1},
};
// Daily life only. Logged gym and sport sessions are added on the day you do them.
const ACTIVITY = Object.fromEntries(Calc.ACTIVITY_LEVELS.map(l => [l.id, {f:l.factor, label:l.label}]));
const actId = a => a==='athlete' ? 'very' : (ACTIVITY[a] ? a : 'light');
const GOALS = {lose:{label:'Lose fat',ppk:2.0},maintain:{label:'Maintain / recomp',ppk:1.6},gain:{label:'Build muscle',ppk:1.8}};
const DEFAULT_PROFILE = {name:'',sex:'male',age:25,birth:'',body_fat:null,maint_source:'auto',eat_back:true,height_cm:170,weight_kg:70,activity:'light',goal:'maintain',goal_rate:0.5,calorie_override:null,protein_override:null,carbs_override:null,fat_override:null,water_override_ml:null,steps_goal:10000,stack:[],watch_workouts:false};
const MEALS = ['breakfast','lunch','snack','dinner'];
const MUSCLES = ['chest','back','shoulders','biceps','triceps','legs','glutes','core','full body','cardio'];
const EXAMPLES = [
  '200g chicken breast, 150g cooked rice, 1 tbsp ghee',
  '2 rotis, 1 katori dal, 100g paneer bhurji',
  '500ml water',
  'slept 6h 50m, 8400 steps',
  'bench 60kg 3x8, incline db 22.5 x10 x10 x8',
  'squat 80x5, 85x5, 90x3; 20 min treadmill',
  'badminton doubles 1 hr',
  'cricket nets 90 min, bowled 6 overs pace, faced 40 balls',
];

/* ---------- helpers ---------- */
const $ = (s, el=document) => el.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pad = n => String(n).padStart(2,'0');
const localDate = (d=new Date()) => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
const nowTime = (d=new Date()) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
const addDays = (date,n) => { const t=new Date(date+'T00:00:00Z'); t.setUTCDate(t.getUTCDate()+n); return t.toISOString().slice(0,10); };
const weekStart = date => { const t=new Date(date+'T00:00:00Z'); return addDays(date, -((t.getUTCDay()+6)%7)); };
const monthStart = date => date.slice(0,8)+'01';
const fmtDate = (date,opts={weekday:'short',day:'numeric',month:'short'}) => new Date(date+'T00:00:00').toLocaleDateString('en-IN',opts);
const n0 = v => Math.round(Number(v)||0).toLocaleString('en-IN');
const fmtL = ml => { const l = Math.round((ml||0)/10)/100; return String(l); };
const n1 = v => { const x=Math.round((Number(v)||0)*10)/10; return x.toLocaleString('en-IN',{maximumFractionDigits:1}); };
const fmtAmt = (v,unit) => (unit==='g'||unit==='mcg'&&v<10 ? n1(v) : n0(v));
const num = (v,max=1e5) => { const x=Number(v); return Number.isFinite(x)&&x>0 ? Math.min(x,max) : 0; };
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())+Math.random().toString(16).slice(2)).slice(0,12);
const titleCase = s => String(s||'').trim().replace(/\s+/g,' ').replace(/\b\w/g,c=>c.toUpperCase());
const exKey = s => String(s||'').trim().toLowerCase().replace(/\s+/g,' ');

/* Who the person is on a given date: age from date of birth, and the smoothed
   weight trend (a single heavy morning shouldn't move every target). */
function weightPoints(){ const pts=[]; for (const [date,d] of S.days) if (d.weight_kg>0) pts.push({date, kg:d.weight_kg}); return pts.sort((a,b)=>a.date<b.date?-1:1); }
let _trend = {rev:-1, pts:[]};
function trendPoints(){ if (_trend.rev!==S.rev) _trend = {rev:S.rev, pts:Calc.weightTrend(weightPoints())}; return _trend.pts; }
function trendWeight(date, p){
  const pts = trendPoints(); let last=null;
  for (const x of pts) { if (x.date<=date) last=x; else break; }
  return last ? last.trend : (pts.length ? pts[0].trend : (Number(p.weight_kg)||70));
}
function ageOf(p, date){ const a = p.birth ? Calc.ageOn(p.birth, date||localDate()) : NaN; return a>=10 && a<=110 ? a : (Number(p.age)||25); }
function whoOf(p, date){
  date = date || localDate();
  const kg = trendWeight(date, p), age = ageOf(p, date), cm = Number(p.height_cm)||170, sex = p.sex==='female'?'female':'male';
  const b = Calc.bmr({sex, kg, cm, age, bodyFat:p.body_fat});
  return {sex, kg, cm, age, bmrKcal:b.kcal, bmrMethod:b.method};
}
const who = date => whoOf(prof(), date);

/* Measured maintenance: energy balance over the last 28 days of full logs. */
function adaptiveFor(date, p){
  if (!S._adapt || S._adapt.rev!==S.rev) {
    const sums = {};
    for (const [d, day] of S.days) {
      if (!(day.foods||[]).length) continue;
      const t = dayTotals(day);
      sums[d] = {intake:t.kcal, exerciseNet:t.burned, complete:day.incomplete!==true};
    }
    S._adapt = {rev:S.rev, sums, weights:weightPoints(), byDate:{}};
  }
  const A = S._adapt;
  return A.byDate[date] ||= Calc.adaptiveMaintenance(A.sums, A.weights, addDays(date,-1), 28, whoOf(p, date).bmrKcal);
}

function computeTargets(p, date){
  date = date || S.date || localDate();
  const w = whoOf(p, date), sex = w.sex, kg = w.kg;
  const lvl = ACTIVITY[actId(p.activity)];
  const formula = w.bmrKcal*lvl.f;
  const ad = adaptiveFor(date, p);
  const useAd = p.maint_source!=='formula' && ad.ready;
  const maint = useAd ? ad.baseWithoutExercise : formula;
  const goal = GOALS[p.goal]?p.goal:'maintain';
  const rate = Math.min(Math.max(Number(p.goal_rate)||0,0), goal==='gain'?0.5:1);
  const tg = Calc.calorieTarget({maintenance:maint, goal, rateKgWeek:goal==='maintain'?0:rate, sex, bmrKcal:w.bmrKcal});
  let kcal = Math.round(tg.kcal/10)*10;
  if (Number(p.calorie_override)>0) kcal = Math.round(Number(p.calorie_override));
  const ppk = GOALS[goal].ppk, auto = Calc.macroTargets(kcal, kg, w.cm, ppk);
  const protein = Number(p.protein_override)>0 ? Math.round(Number(p.protein_override)) : auto.p;
  const co = Number(p.carbs_override)>0 ? Math.round(Number(p.carbs_override)) : null;
  const fo = Number(p.fat_override)>0 ? Math.round(Number(p.fat_override)) : null;
  let fat, carbs;
  if (co && fo) { carbs=co; fat=fo; if (!(Number(p.calorie_override)>0)) kcal = protein*4+carbs*4+fat*9; }
  else if (co) { carbs=co; fat=Math.max(Math.round((kcal-protein*4-carbs*4)/9),0); }
  else if (fo) { fat=fo; carbs=Math.max(Math.round((kcal-protein*4-fat*9)/4),0); }
  else { fat=Math.max(Math.round(kcal*0.25/9), Math.round(0.6*kg)); carbs=Math.max(Math.round((kcal-protein*4-fat*9)/4),0); }
  const out = {bmr:Math.round(w.bmrKcal), bmrMethod:w.bmrMethod, age:w.age, weight:kg, refKg:auto.refKg, level:lvl,
    tdee:Math.round(formula), maint:Math.round(maint), maintSource:useAd?'measured':'formula', adaptive:ad,
    goalDelta:Math.round(tg.delta), floored:tg.floored && !(Number(p.calorie_override)>0), floor:tg.floor,
    kcal,protein,carbs,fat,
    fiber: Number(p.fiber_override)>0 ? Number(p.fiber_override) : Math.round(kcal/1000*14), sugar:Math.round(kcal*0.1/4),
    water_ml: Number(p.water_override_ml)>0 ? Number(p.water_override_ml) : Math.round(kg*35/250)*250,
    micros:{...Calc.microTargets(sex, w.age), sat_fat_g:Math.round(kcal*0.1/9)}, focus:[]};
  const ra = p.report_adjust;
  if (ra) {
    if (ra.sat_fat_pct) out.micros.sat_fat_g = Math.round(kcal*ra.sat_fat_pct/100/9);
    if (ra.cholesterol_mg) out.micros.cholesterol_mg = ra.cholesterol_mg;
    if (ra.sodium_mg) out.micros.sodium_mg = ra.sodium_mg;
    if (ra.sugar_pct) out.sugar = Math.round(kcal*ra.sugar_pct/100/4);
    if (ra.fiber_g) out.fiber = Math.max(out.fiber, ra.fiber_g);
    for (const [k,v] of Object.entries(ra.micro_targets||{})) if (k in out.micros) out.micros[k] = Math.max(out.micros[k], v);
    out.focus = ra.focus||[];
  }
  return out;
}
/* Targets for one day: the base target plus the net calories of that day's
   training (carbs carry the extra, since that's what training burns most). */
function dayTargets(day, T){
  T = T || computeTargets(prof(), day.date);
  const p = prof(), ex = dayTotals(day).burned;
  const add = p.eat_back===false || Number(p.calorie_override)>0 ? 0 : Math.round(ex);
  return {...T, base:T.kcal, training:add, kcal:T.kcal+add, carbs:T.carbs+Math.round(add/4), fiber: Number(p.fiber_override)>0 ? T.fiber : Math.round((T.kcal+add)/1000*14)};
}

/* ---------- state ---------- */
const S = {
  db:null, sample:null, dbState:'connecting', aiState:'connecting', canPhoto:false,
  profile:null, days:new Map(), date:localDate(), view:'today',
  gymPeriod:'week', gymEx:null, trendRange:30,
  libFoods:[], libBusy:false, libStatus:'', mcp:null,
  myFoods:{}, myFoodsVer:0, _fidx:null, _fidxVer:-1,
  reports:[], repSel:null, repMarker:null, repBusy:false, repStatus:'', reviews:[], plans:[], planBusy:false, planStatus:'', planFor:null, planNote:'', revBusy:false, revStatus:'',
  queue:[], qBusy:false, qStatus:'', setup:null, setupShown:false,
  photo:null, photoUrl:null, busy:false, ctl:null, status:'', statusErr:false,
  rev:0, openFolds:(()=>{ try { return new Set(JSON.parse(localStorage.getItem('fl:folds')||'[]')); } catch { return new Set(); } })(), sync:'saving', user:null, usage:null, auth:{step:'email', email:'', msg:'', busy:false},
};
const prof = () => ({...DEFAULT_PROFILE, ...(S.profile||{})});
const targets = (date) => computeTargets(prof(), date);
const suggestedTargets = () => computeTargets({...prof(), calorie_override:null, protein_override:null, carbs_override:null, fat_override:null, fiber_override:null, water_override_ml:null}, localDate());
const emptyDay = date => ({date, foods:[], water:[], exercises:[], weight_kg:null});
const getDay = date => S.days.get(date) || emptyDay(date);
function mergeDays(){
  const m = new Map(S.daysRaw || []);
  for (const [date, h] of S.healthSync || []) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    const add = {}; for (const k of ['steps','active_kcal','resting_kcal','sleep_min']) if (Number(h[k]) >= 0 && h[k] != null) add[k] = Number(h[k]);
    const d = m.get(date) || emptyDay(date);
    m.set(date, {...d, date, health:{...(d.health||{}), ...add}, health_synced_at:h.synced_at || null});
  }
  S.days = m;
}

/* ---------- storage ---------- */
const queues = {};
function writeDay(date, mutate){
  const run = async () => {
    const cur = structuredClone(getDay(date));
    mutate(cur);
    cur.date = date; cur.updated_at = Date.now();
    S.days.set(date, cur); S.rev++; render();
    if (!S.db) throw {code:'no_db'};
    await S.db.doc('days/'+date).set(cur);
    S.rev++;
  };
  const p = (queues[date]||Promise.resolve()).then(run, run);
  queues[date] = p.catch(()=>{});
  return p.catch(e => { toast(e?.code==='no_db' ? 'Not saved: sign in first.' : 'Couldn’t save that change. Try again.'); });
}
let profQ = Promise.resolve();
function saveProfile(p){
  S.profile = p; S.rev++; render();
  if (!S.db) { toast('Not saved: sign in first.'); return; }
  profQ = profQ.then(() => S.db.doc('profile/me').set(p)).catch(() => toast('Couldn’t save your profile. Try again.'));
  return profQ;
}

/* ---------- derived numbers ---------- */
function dayTotals(day){
  const t = {kcal:0,protein:0,carbs:0,fat:0,fiber:0,sugar:0,micros:{}};
  MICROS.forEach(m => t.micros[m.key]=0);
  for (const sp of day.supplements||[]) for (const m of MICROS) t.micros[m.key]+= (sp.micros&&sp.micros[m.key])||0;
  for (const f of day.foods||[]) {
    t.kcal+=f.kcal||0; t.protein+=f.protein||0; t.carbs+=f.carbs||0; t.fat+=f.fat||0; t.fiber+=f.fiber||0; t.sugar+=addedSugar(f); t.sugar_all=(t.sugar_all||0)+(f.sugar||0);
    for (const m of MICROS) t.micros[m.key]+= (f.micros&&f.micros[m.key])||0;
  }
  t.alcohol = (day.foods||[]).reduce((s,f)=>s+(f.alcohol||0),0);
  t.water = (day.water||[]).reduce((s,w)=>s+(w.ml||0),0);
  t.gym = (day.exercises||[]).reduce((s,e)=>s+(e.kcal||0),0);
  t.sport = (day.sports||[]).reduce((s,e)=>s+(e.kcal||0),0);
  t.burned = t.gym + t.sport;
  return t;
}
/* Net calories for one logged exercise (what it adds on top of resting).
   Cardio: heart rate (Keytel) > pace (ACSM) > MET, via calc.js.
   Lifting: Compendium METs over the session time (sets × ~2.5 min incl. rest);
   heavy sets (≤6 reps) are the vigorous 5.0, the rest 3.5. */
function exerciseKcal(ex, date){
  const w = who(date||S.date);
  if (ex.muscle_group==='cardio') {
    const name = String(ex.name||'').toLowerCase();
    // With a distance, walking and running use the ACSM pace equations; otherwise the MET.
    const activity = ex.distance_km>0 ? (/run|jog/.test(name) ? 'treadmill' : /walk|treadmill/.test(name) ? 'walk' : null) : null;
    const minutes = ex.duration_min>0 ? ex.duration_min : 0;
    if (minutes) {
      const e = Calc.workoutEnergy({activity, met:ex.met||(/run|jog/.test(name)?9.8:/walk/.test(name)?3.5:6), minutes, distanceKm:ex.distance_km, inclinePct:ex.incline_pct, avgHr:ex.avg_hr}, w);
      if (!activity && !ex.avg_hr && !ex.met && ex.kcal_hint>0) { ex.method='Estimated by AI'; ex.kcal_gross=ex.kcal_hint; return Math.round(Math.max(0, ex.kcal_hint - w.bmrKcal/1440*minutes)); }
      ex.method = e.method; ex.kcal_gross = Math.round(e.gross); return Math.round(e.net);
    }
    if (ex.kcal_hint>0) { ex.method='Estimated by AI'; return Math.round(ex.kcal_hint); }
    return 0;
  }
  const sets = ex.sets||[];
  const minutes = ex.duration_min>0 ? ex.duration_min : Math.max(3, sets.length*2.5);
  const heavy = sets.length && sets.filter(s=>s.reps<=6).length >= sets.length/2;
  const met = heavy ? 5.0 : 3.5;
  const e = Calc.netKcalFromMet(met, w.kg, minutes, w.bmrKcal);
  ex.method = `MET ${met} × ${n0(minutes)} min`; ex.kcal_gross = Math.round(e.gross);
  return Math.round(e.net);
}
const SPORTS = ['badminton','cricket','football','running','cycling','swimming','tennis','other'];
function sportKcal(a, date){
  const W = who(date||S.date); const k = (met,min) => Calc.netKcalFromMet(met, W.kg, min, W.bmrKcal).net;
  if (a.sport==='badminton') return Math.round(k(a.format==='singles'?7:a.intensity==='light'?4.5:5.5, a.minutes||0));
  if (a.sport==='cricket') {
    const match = a.session==='match'; let kc=0, used=0;
    if (a.balls_bowled) { const met={pace:6.5,medium:5.5,spin:4.5}[a.bowling_style]||5.5; const min=a.balls_bowled*(match?0.67:1); kc+=k(met,min); used+=min; }
    const bat = a.minutes_batted || (a.balls_faced ? a.balls_faced*(match?0.6:0.4) : 0);
    if (bat) { kc+=k(match?5.5:4.5, bat); used+=bat; }
    if (a.overs_fielded) { const min=a.overs_fielded*4; kc+=k(3.5,min); used+=min; }
    if (a.minutes && a.minutes>used) kc += k(used?(match?3.5:2.5):4.8, a.minutes-used);
    return Math.round(kc);
  }
  return Math.round(k(a.met||6, a.minutes||0));
}
function sportLine(a){
  const bits=[];
  if (a.format) bits.push(a.format);
  if (a.minutes) bits.push(`${n0(a.minutes)} min`);
  if (a.balls_bowled) bits.push(`bowled ${a.balls_bowled%6===0?`${a.balls_bowled/6} overs`:`${a.balls_bowled} balls`}${a.bowling_style?` (${a.bowling_style})`:''}`);
  if (a.balls_faced) bits.push(`faced ${a.balls_faced} balls`);
  if (a.minutes_batted) bits.push(`batted ${n0(a.minutes_batted)} min`);
  if (a.overs_fielded) bits.push(`fielded ${a.overs_fielded} overs`);
  return bits.join(' · ');
}
const sportTitle = a => titleCase(a.sport==='other'&&a.name?a.name:a.sport) + (a.session&&a.sport==='cricket'?` ${a.session}`:'');
/* Calories burned by moving: logged training and sports, plus walking.
   Resting burn (breathing, digestion) is left out on purpose.
   With Apple Health active energy, that already covers steps (and workouts
   when the Watch recorded them); otherwise steps are estimated. */
// Walking: stride ≈ 41.5% of height; net cost ≈ 0.5 kcal per kg per km above resting.
const stepsKcal = (steps, w) => Math.round((Number(steps)||0) * (w.cm*0.415/100) / 1000 * 0.5 * w.kg);
function burnedTotal(day){
  const p=prof(), H=day.health||{}, t=dayTotals(day), w=who(day.date);
  const training = Math.round(t.burned||0);
  if (H.active_kcal) {
    const moving = Math.round(H.active_kcal), trainingExtra = p.watch_workouts ? 0 : training;
    return {total:moving+trainingExtra, training, moving, fromHealth:true};
  }
  const moving = stepsKcal(H.steps, w);
  return {total:training+moving, training, moving, fromHealth:false};
}
const burnTip = B => B.fromHealth ? `Active energy from Apple Health ${n0(B.moving)}${prof().watch_workouts?'':` + logged training ${n0(B.training)}`} kcal` : `Training & sports ${n0(B.training)} + steps ${n0(B.moving)} kcal`;
// Epley; sets above 12 reps are scored as 12 (estimates past that are unreliable).
const e1rm = s => s.weight>0 ? Calc.e1rm(s.weight, Math.min(s.reps,12)) || 0 : 0;

// sessions per exercise, oldest first
function buildSessions(){
  if (S._bs && S._bsDays===S.days && S._bsRev===S.rev) return S._bs;
  const map = buildSessionsNow(); S._bs = map; S._bsDays = S.days; S._bsRev = S.rev; return map;
}
function buildSessionsNow(){
  const map = new Map();
  const dates = [...S.days.keys()].sort();
  for (const date of dates) {
    const day = S.days.get(date);
    const perDay = new Map();
    for (const ex of day.exercises||[]) {
      if (ex.muscle_group==='cardio' && !(ex.sets||[]).length) continue;
      const k = exKey(ex.name);
      if (!perDay.has(k)) perDay.set(k,{name:ex.name,group:ex.muscle_group,sets:[]});
      perDay.get(k).sets.push(...(ex.sets||[]));
    }
    for (const [k,s] of perDay) {
      if (!s.sets.length) continue;
      const bw = s.sets.every(x=>!(x.weight>0));
      const sess = {date, sets:s.sets, bodyweight:bw,
        best: bw ? Math.max(...s.sets.map(x=>x.reps)) : Math.max(...s.sets.map(e1rm)),
        top: Math.max(...s.sets.map(x=>x.weight||0)),
        volume: s.sets.reduce((a,x)=>a+(x.weight||0)*(x.reps||0),0),
        reps: s.sets.reduce((a,x)=>a+(x.reps||0),0)};
      if (!map.has(k)) map.set(k,{key:k,name:s.name,group:s.group,sessions:[]});
      const e = map.get(k); e.name = s.name; e.group = s.group || e.group; e.sessions.push(sess);
    }
  }
  return map;
}
function periodRanges(date, period){
  if (period==='week') { const s=weekStart(date); return {cur:[s,date], prev:[addDays(s,-7),addDays(s,-1)], label:'last week'}; }
  const s=monthStart(date); const pe=addDays(s,-1); return {cur:[s,date], prev:[monthStart(pe),pe], label:'last month'};
}
function periodStats(a,b){
  let days=0, sets=0, volume=0, kcal=0; const sp = {};
  for (const [date,day] of S.days) {
    if (date<a||date>b) continue;
    const ex = day.exercises||[], sports = day.sports||[]; if (!ex.length && !sports.length) continue;
    days++; for (const e of ex){ sets+=(e.sets||[]).length; volume+=(e.sets||[]).reduce((s,x)=>s+(x.weight||0)*(x.reps||0),0); kcal+=e.kcal||0; }
    for (const x of sports) { kcal+=x.kcal||0; const k = x.v===2 ? x.sport : sportTitle({...x, session:null});
      if (x.v===2) { const r = sp[k] ||= {name:k, sessions:0, minutes:0, kcal:0, bowled:0, faced:0}; r.sessions++; r.minutes+=x.minutes||0; r.kcal+=x.kcal||0; r.bowled+=(x.stats||{}).balls_bowled||0; r.faced+=(x.stats||{}).balls_faced||0; continue; }
      const r = sp[k] ||= {name:k, sessions:0, minutes:0, kcal:0, bowled:0, faced:0};
      r.sessions++; r.minutes += x.minutes || ((x.balls_bowled||0)*(x.session==='match'?0.67:1) + (x.minutes_batted||(x.balls_faced||0)*0.5) + (x.overs_fielded||0)*4);
      r.kcal += x.kcal||0; r.bowled += x.balls_bowled||0; r.faced += x.balls_faced||0; }
  }
  return {days,sets,volume,kcal,sp};
}

/* ---------- AI logging ---------- */
function buildPrompt(text, hasPhoto){
  const p = prof();
  const known = [...buildSessions().values()].map(e=>e.name).slice(0,80);
  const microSpec = MICROS.map(m=>`"${m.key}":0`).join(',');
  const W = who(S.date);
  return `You log food, water, supplements, training and health data for one person in India. Date ${S.date}, entry made at ${nowTime()}. Person: ${p.sex}, ${W.age} y, ${n1(W.kg)} kg, ${W.cm} cm.
Read the entry${hasPhoto?' and the attached photo of the food':''} and reply with ONLY one JSON object in exactly this shape:
{"foods":[{"name":"Paneer bhurji","quantity":"150 g","grams":150,"meal":"lunch","kcal":0,"protein_g":0,"carbs_g":0,"fat_g":0,"fiber_g":0,"sugar_g":0,"added_sugar_g":0,"alcohol_g":0,${microSpec},"confidence":"high"}],
"water_ml":0,
"supplements":[{"name":"Vitamin D3","dose":"60,000 IU",${microSpec}}],
"activities":[{"sport":"Cricket","entry":"played a T20 match, bowled 4 overs"}],
"exercises":[{"name":"Barbell Bench Press","muscle_group":"chest","sets":[{"weight_kg":60,"reps":8}],"duration_min":null,"distance_km":null,"incline_pct":null,"avg_hr":null,"met":null,"kcal_estimate":null}],
"gym_recovery":null,
"body_weight_kg":null,
"health":{"steps":null,"sleep_minutes":null,"bed_time":null,"wake_time":null,"active_kcal":null,"resting_kcal":null},
"notes":""}
Rules:
- One entry per distinct food. Every nutrient number is the TOTAL for that portion, not per 100 g. Use realistic values from standard food composition data (IFCT 2017 for Indian foods, USDA otherwise).
- Check each food: kcal must match 4 × protein + 4 × carbs + 9 × fat + 7 × alcohol within about 10%. Alcoholic drinks: put the grams of alcohol in alcohol_g (a 330 ml beer at 5% has about 13 g).
- sugar_g is all sugars. added_sugar_g is only sugar that was added: sugar, jaggery, honey, syrups, sweets and desserts, ice cream, cakes, biscuits, chocolate, sweetened drinks, fruit juices and sweetened milk drinks, and dates, raisins or grapes used to sweeten a dish. Sugar naturally in whole fruit, vegetables, plain milk, plain curd, eggs, rotis, rice, dal, meat and nuts is 0 added sugar.
- Weights the person gives are as eaten (cooked) unless they say raw, dry or uncooked.
- No weight given: assume a typical Indian home portion (1 roti ≈ 40 g, 1 katori dal ≈ 150 g, 1 cup cooked rice ≈ 160 g, 1 egg ≈ 50 g) and set confidence "medium".
- From a photo: name each item, estimate the portion from visual cues (a dinner plate is about 25 cm), set confidence "medium" or "low".
- Packaged or branded items: use their label values. Include cooking oil or ghee a dish normally contains.
- meal is one of breakfast, lunch, snack, dinner: from the entry, otherwise from the time.
- Plain water goes only in water_ml (1 glass ≈ 250 ml, 1 bottle ≈ 1000 ml). Other drinks (milk, tea, coffee, juice, shakes) are foods.
- Supplements (creatine, vitamins, minerals, fish oil, ashwagandha, electrolytes, pre-workout) go in "supplements" with the dose taken and the micronutrients that dose adds, converting units (vitamin D 1,000 IU = 25 mcg; a 1 g fish oil capsule has about 0.3 g omega-3 unless EPA/DHA are given). Leave nutrients the supplement doesn't contain at 0. Protein powders, mass gainers and protein bars have real calories, so they go in "foods" instead.
- Gym: "bench 60kg 3x8" means 3 sets of 8 reps at 60 kg; "60x8, 65x6" are separate sets of weight x reps; "22.5 x10 x10 x8" is three sets at 22.5 kg. Dumbbell weight is per dumbbell. Bodyweight moves use weight_kg 0 (or the added weight).
- Reuse one of these existing exercise names when it is the same movement: ${known.length?known.join('; '):'(none yet)'}. Otherwise use a clear standard name, e.g. "Incline Dumbbell Press".
- muscle_group is one of: ${MUSCLES.join(', ')}.
- Sports and other physical activities (badminton, cricket matches or nets, football, running outdoors, swimming, yoga, hiking…) go in "activities": the sport's plain name and the exact words from the entry about it. Do not estimate calories or fill details for them; a coach step handles that.
- When gym exercises are logged, set "gym_recovery" to {"muscles":["chest","triceps"],"hours":48,"summary":"one sentence on how long these muscles need before being trained hard again","tips":["2-3 short concrete tips"]} using the sets and reps logged. Otherwise null.
- Cardio (treadmill, cycling, rowing, skipping): muscle_group "cardio", sets [], duration_min, plus distance_km, incline_pct and avg_hr only when the entry gives them, and met: the Compendium of Physical Activities MET for that machine and intensity. The app works out calories from these; kcal_estimate is only a fallback.
- A body weight like "weight 72.5" or "weighed 72.5kg" goes in body_weight_kg.
- Apple Health data goes in "health": a line starting "health:", a screenshot of the Health app, or statements like "slept 6h 50m" or "8400 steps today". sleep_minutes is time actually asleep (not time in bed); if a sleep number over 1440 is given it is seconds, so divide by 60. bed_time and wake_time are "HH:MM" when known. active_kcal is Active Energy, resting_kcal is Resting Energy. Leave any value you don't see as null. If the photo is a Health screenshot, it is not food.
- Leave out anything that is not food, water, supplements, gym, activities, health data or body weight and say so briefly in notes. Put any important assumption in notes, in one short sentence. Use empty arrays when there is nothing.
Entry: """${text || '(no text, photo only)'}"""`;
}
function normalize(res, date){
  const foods = (Array.isArray(res?.foods)?res.foods:[]).map(f => {
    const micros = {}; for (const m of MICROS) micros[m.key] = num(f[m.key]);
    const meal = MEALS.includes(f.meal) ? f.meal : guessMeal();
    const x = {id:uid(), name:titleCase(f.name)||'Food', quantity:String(f.quantity||'').slice(0,40), grams:num(f.grams,5000), meal,
      time:nowTime(), kcal:num(f.kcal,5000), protein:num(f.protein_g,500), carbs:num(f.carbs_g,1000), fat:num(f.fat_g,500),
      fiber:num(f.fiber_g,200), sugar:num(f.sugar_g,500), added_sugar: f.added_sugar_g != null ? num(f.added_sugar_g,500) : (sweetName(f.name) ? num(f.sugar_g,500) : 0), alcohol:num(f.alcohol_g,300), micros, confidence:['high','medium','low'].includes(f.confidence)?f.confidence:'medium', source:S.photo?'photo':'text'};
    // Flag estimates whose calories don't add up from their macros.
    if (x.kcal>30 && Calc.atwaterMismatch(x.kcal, x.protein, x.carbs, x.fat, x.fiber, x.alcohol) > 0.15) x.check = true;
    return x;
  }).filter(f => f.name && (f.kcal>0 || f.grams>0));
  const supplements = (Array.isArray(res?.supplements)?res.supplements:[]).slice(0,20).map(x => {
    const micros = {}; for (const m of MICROS) micros[m.key] = num(x[m.key]);
    return {id:uid(), name:titleCase(x.name)||'Supplement', dose:String(x.dose||'').slice(0,40), micros, time:nowTime()};
  }).filter(x => x.name);
  const exercises = (Array.isArray(res?.exercises)?res.exercises:[]).map(e => {
    const sets = (Array.isArray(e.sets)?e.sets:[]).slice(0,30).map(s => ({weight:Math.round(num(s.weight_kg,1000)*100)/100, reps:Math.round(num(s.reps,1000))})).filter(s=>s.reps>0);
    const ex = {id:uid(), name:titleCase(e.name)||'Exercise', muscle_group:MUSCLES.includes(e.muscle_group)?e.muscle_group:'full body',
      sets, duration_min:num(e.duration_min,600)||null, distance_km:num(e.distance_km,300)||null, incline_pct:num(e.incline_pct,40)||null,
      avg_hr:Math.round(num(e.avg_hr,230))||null, met:num(e.met,20)||null, kcal_hint:num(e.kcal_estimate,3000)||null, time:nowTime()};
    ex.kcal = exerciseKcal(ex, date);
    return ex;
  }).filter(e => e.sets.length || e.duration_min);
  const h = res?.health||{}; const hm = s => (typeof s==='string' && /^\d{1,2}:\d{2}$/.test(s)) ? s.padStart(5,'0') : null;
  let sleep = num(h.sleep_minutes,100000); if (sleep>1440) sleep = sleep/60; if (sleep>1440) sleep = 0;
  const health = {steps:Math.round(num(h.steps,200000))||null, sleep_min:Math.round(sleep)||null, bed_time:hm(h.bed_time), wake_time:hm(h.wake_time),
    active_kcal:Math.round(num(h.active_kcal,10000))||null, resting_kcal:Math.round(num(h.resting_kcal,6000))||null};
  const hasHealth = Object.values(health).some(v=>v!==null);
  const activities = (Array.isArray(res?.activities)?res.activities:[]).slice(0,6).map(a => ({sport:titleCase(a.sport)||'Activity', entry:String(a.entry||'').slice(0,400)})).filter(a=>a.sport);
  const gr = res?.gym_recovery; const gym_recovery = gr && num(gr.hours,240) ? {muscles:(Array.isArray(gr.muscles)?gr.muscles:[]).slice(0,8).map(String), hours:num(gr.hours,240), summary:String(gr.summary||'').slice(0,300), tips:(Array.isArray(gr.tips)?gr.tips:[]).slice(0,4).map(x=>String(x).slice(0,160))} : null;
  return {foods, supplements, activities, gym_recovery, exercises, water_ml:Math.round(num(res?.water_ml,10000)), body_weight_kg:num(res?.body_weight_kg,400)||null, health: hasHealth?health:null, notes:String(res?.notes||'').slice(0,300)};
}
const fmtSleep = m => `${Math.floor(m/60)}h ${pad(Math.round(m%60))}m`;
function sleepVerdict(min, age){
  const [lo,hi] = age<18 ? [480,600] : age>=65 ? [420,480] : [420,540];
  const h = n => n/60;
  if (min < lo-60) return {cls:'bad', label:'Too little', note:`About ${n1(h(lo-min))} h short of the ${h(lo)}–${h(hi)} h adults need. Expect lower energy in training and more hunger today. An earlier night will help recovery.`};
  if (min < lo) return {cls:'warn', label:'A little short', note:`Just under the ${h(lo)}–${h(hi)} h range. Fine for one night; try not to stack several.`};
  if (min <= hi+30) return {cls:'good', label:'Enough', note:`Inside the ${h(lo)}–${h(hi)} h range recommended for your age. Good for recovery and muscle growth.`};
  return {cls:'warn', label:'Long night', note:`More than ${h(hi)} h. Fine after a hard week or a match; if it happens often and you still feel tired, it's worth looking into.`};
}
const findStack = name => (prof().stack||[]).find(x => exKey(x.name)===exKey(name));
/* How often a supplement is taken: {type:'daily'}, {type:'days', days:[0..6]} (0 = Sunday),
   or {type:'every', n, start}. Older items without one are daily. */
const WD = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
function suppDue(st, date){
  const f = st.freq || {type:'daily'};
  if (f.type==='days') return (f.days||[]).includes(new Date(date+'T12:00:00').getDay());
  if (f.type==='every') { const n = Math.max(1, f.n||1), d = Math.round((Date.parse(date+'T12:00:00') - Date.parse((f.start||date)+'T12:00:00'))/864e5); return d >= 0 && d % n === 0; }
  return true;
}
function freqText(f){
  f = f || {type:'daily'};
  if (f.type==='days') { const d = [...(f.days||[])].sort(); return d.length===7 ? 'Every day' : d.length===1 ? `Weekly on ${WD[d[0]]}` : d.map(x=>WD[x]).join(' · '); }
  if (f.type==='every') return f.n===1 ? 'Every day' : f.n===7 ? `Weekly (every 7 days)` : `Every ${f.n} days`;
  return 'Every day';
}
function supplementsPanel(day){
  const stack = (prof().stack||[]).filter(st => suppDue(st, day.date) || (day.supplements||[]).some(x=>x.stack_id===st.id)); const taken = day.supplements||[];
  const takenIds = new Set(taken.map(x=>x.stack_id).filter(Boolean));
  const extra = taken.filter(x => !x.stack_id);
  let h = '';
  if (stack.length) h += `<div class="stack">${stack.map(st => { const on = takenIds.has(st.id);
    return `<button class="stk${on?' on':''}" data-action="toggleStack" data-id="${st.id}" aria-pressed="${on}"><span class="box">${on?'✓':''}</span><span><b>${esc(st.name)}</b><span class="muted small"> ${esc(st.dose)}</span></span></button>`; }).join('')}</div>`;
  else h += `<div class="empty">Nothing due today.</div>`;
  if (extra.length) h += extra.map(x => `<div class="item"><div><div class="nm">${esc(x.name)}</div><div class="sub">${esc(x.dose)}${x.time?' · '+esc(x.time):''}</div></div>
    <button class="linkbtn" data-action="addStack" data-id="${x.id}">Add to daily list</button>
    <div class="acts"><button data-action="delSupp" data-id="${x.id}" aria-label="Delete ${esc(x.name)}">✕</button></div></div>`).join('');
  if (stack.length) h += `<div class="muted small">Tap to mark taken or skipped. Their vitamins and minerals count toward your daily totals in Trends.</div>`;
  return h;
}
function guessMeal(){ const h=new Date().getHours(); return h<11?'breakfast':h<16?'lunch':h<19?'snack':'dinner'; }
const AI_ERR = {
  session_expired:'You’ve been signed out. Sign in again, then log this entry.',
  daily_cap:'AI limit reached: you’ve used your 30 AI uses for today. Foods, gym sets, food search and barcodes still work without AI; AI is back tomorrow.',
  ai_day_limit:'AI limit reached for today: the free AI allowance shared by everyone on this app is used up. It resets once a day (early afternoon India time). Foods, gym sets, food search and barcodes still work without AI.',
  not_invited:'AI features are invite-only on this app. Ask the owner to add your email.',
  not_approved:'Your account is waiting for the owner’s approval.',
  server_config:'The app’s AI key isn’t set up correctly. The owner needs to check the GEMINI_API_KEY or ANTHROPIC_API_KEY secret.',
  unavailable:'Couldn’t reach AI. Your entry is still here; try again.',
  busy:'The AI is busy right now (Google’s free service is overloaded). Your entry is still here; try again in a minute.',
  offline:'You’re offline. Food-table items still log; try AI again when you’re back online.',
  rate_limited:'Too many AI requests in the last minute. Try again in a minute.',
  image_rejected:'That file couldn’t be read. Try a JPEG, PNG or PDF under 20 MB.',
  refused:'AI couldn’t process that entry. Try describing it differently.',
  invalid_json:'Couldn’t turn that into a log entry. Try rephrasing, e.g. “150 g paneer, 2 rotis”.',
  empty_completion:'Couldn’t turn that into a log entry. Try rephrasing, e.g. “150 g paneer, 2 rotis”.',
  prompt_too_large:'That entry is too long. Split it into smaller entries.',
  bad_request:'AI couldn’t read that request. Try again.',
};
async function toJpeg(file){
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, 1600/Math.max(bmp.width,bmp.height));
    const c = document.createElement('canvas'); c.width=Math.round(bmp.width*scale); c.height=Math.round(bmp.height*scale);
    c.getContext('2d').drawImage(bmp,0,0,c.width,c.height);
    return await new Promise(r => c.toBlob(b => r(b||file), 'image/jpeg', 0.85));
  } catch { return file; }
}

/* ---------- built-in food table (foods.js, checked by calc.test.js) ---------- */
const { FOOD_MICRO_ORDER, FOOD_ROWS, FOOD_ALCOHOL, FOOD_ADDED_SUGAR } = window;
/* Only added sugar counts toward the sugar limit: sugar, jaggery, honey, syrups, sweets,
   desserts, sweetened drinks and juices, and dates or raisins used to sweeten a dish.
   Sugar that is naturally in fruit, vegetables, milk, curd, eggs, rotis or dal doesn't. */
const SWEET_RE = /\b(sugar|sweet(?!\s*(potato|corn))|sweetened|dessert|ice ?cream|kulfi|cake|pastry|cookies?|biscuits?|brownie|muffin|dough?nut|chocolate|choco|candy|toffee|jam|jelly|honey|jaggery|gur|syrup|halwa|kheer|payasam|gulab|jamun|jalebi|lad(d)?oo|laddu|barfi|burfi|rasgulla|rasmalai|mithai|peda|sandesh|soda|cola|coke|pepsi|sprite|fanta|soft drink|energy drink|juice|milkshake|(mango|banana|strawberry|chikoo|chocolate|oreo|kitkat|dates?|butterscotch|vanilla) shake|smoothie|frooti|maaza|mango lassi|sweet lassi|cold coffee|frappe|mocha|cereal|granola|muesli|protein bar|pie|tart|waffle|pancakes?|custard|pudding|mousse|cheesecake|nutella|ketchup|shrikhand|basundi|rabri|payasa|modak|chikki|dates? (shake|smoothie|balls?|bar|roll|ladoo|halwa)|raisin)\b/i;
const NOT_SWEET_RE = /\b(sugar[- ]?free|no (added )?sugar|unsweetened|zero|diet)\b/i;
const sweetName = n => SWEET_RE.test(n||'') && !NOT_SWEET_RE.test(n||'');
// Added sugar per 100 g of a food from any source.
function addedPer100(f){
  const per = f.per || {};
  if (per.added_sugar != null) return per.added_sugar;
  if (f.src==='indb') return per.sugar || 0;                                  // INDB records free (added) sugar
  if (FOOD_ADDED_SUGAR && f.name in FOOD_ADDED_SUGAR) return FOOD_ADDED_SUGAR[f.name];
  if (f.src==='usda') return (/^(Sweets|Baked Products|Breakfast Cereals|Snacks|Fast Foods|Beverages)$/.test(f.cat||'') || sweetName(f.name) || sweetName((f.aliases||[])[0])) && !NOT_SWEET_RE.test(f.name) ? (per.sugar||0) : 0;
  if (f.src==='off') return per.sugar || 0;                                    // set from the label in offToFood
  if (!f.src || f.src==='builtin') return 0;                                   // built-in foods not in the table have none
  return sweetName(f.name) ? (per.sugar||0) : 0;
}
// Added sugar of a logged food; older entries without it are judged by name.
function addedSugar(f){
  if (f.added_sugar != null) return f.added_sugar;
  if (FOOD_ADDED_SUGAR && f.name in FOOD_ADDED_SUGAR) return (FOOD_ADDED_SUGAR[f.name]||0) * (f.grams||0) / 100;
  return sweetName(f.name) ? (f.sugar||0) : 0;
}
const FOODS = FOOD_ROWS.map(r => {
  const [name, aliases, units, kcal, protein, carbs, fat, fiber, sugar, ...m] = r;
  const micros = {}; FOOD_MICRO_ORDER.forEach((k,i)=>micros[k]=m[i]||0);
  return {name, aliases:aliases.split('|'), units, per:{kcal,protein,carbs,fat,fiber,sugar,micros}, src:'db'};
});
const GENERIC_UNITS = {katori:150, bowl:200, cup:200, glass:250, plate:250, tbsp:15, tsp:5, handful:30, slice:30, scoop:30, piece:100, serving:150, packet:50, can:330, bottle:500, bar:40, portion:150, cube:20};
const UNIT_WORDS = {g:'g',gm:'g',gms:'g',gram:'g',grams:'g',gr:'g',kg:'kg',ml:'ml',l:'l',ltr:'l',litre:'l',liter:'l',litres:'l',
  katori:'katori',katoris:'katori',bowl:'bowl',bowls:'bowl',cup:'cup',cups:'cup',glass:'glass',glasses:'glass',plate:'plate',plates:'plate',
  tbsp:'tbsp',tablespoon:'tbsp',tablespoons:'tbsp',tsp:'tsp',teaspoon:'tsp',teaspoons:'tsp',spoon:'tsp',spoons:'tsp',handful:'handful',handfuls:'handful',
  slice:'slice',slices:'slice',scoop:'scoop',scoops:'scoop',piece:'piece',pieces:'piece',pc:'piece',pcs:'piece',nos:'piece',no:'piece',
  serving:'serving',servings:'serving',packet:'packet',packets:'packet',pack:'packet',can:'can',cans:'can',bottle:'bottle',bottles:'bottle',bar:'bar',bars:'bar',cube:'cube',cubes:'cube',portion:'portion'};
const NUM_WORDS = {a:1,an:1,one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10,half:0.5,quarter:0.25,couple:2,few:3};
const FILLER = new Set(['cooked','boiled','plain','fresh','homemade','home','made','small','medium','large','big','my','the','some','hot','cold','warm','raw','cup','bowl','full','whole','little','extra','x']);
const normFood = s => String(s||'').toLowerCase().replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim();
const singular = w => w.length>3 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0,-2) : w.length>3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0,-1) : w;
/* ---------- INDB import (1,014 Indian recipes) ---------- */
function rowToFood(r, src){
  const [name, aliases, units, kcal, protein, carbs, fat, fiber, sugar, ...m] = r;
  const micros = {}; FOOD_MICRO_ORDER.forEach((k,i)=>micros[k]=m[i]||0);
  return {name, aliases:String(aliases||'').split('|').filter(Boolean), units:units||{}, per:{kcal,protein,carbs,fat,fiber,sugar,micros}, src};
}
function indbAliases(name){
  const out = new Set(); const n = String(name||'').trim();
  const base = n.replace(/\([^)]*\)/g,' ').replace(/\s+/g,' ').trim();
  out.add(normFood(n)); out.add(normFood(base));
  for (const m of n.matchAll(/\(([^)]*)\)/g)) for (const piece of m[1].split(/[\/,]| or /)) out.add(normFood(piece));
  for (const piece of base.split('/')) out.add(normFood(piece));
  return [...out].filter(a => a && a.length>=3).slice(0,8).join('|');
}
async function importIndb(file){
  if (!file) { $('#indbInput').click(); return; }
  S.libBusy=true; S.libStatus='Reading the spreadsheet…'; render();
  try {
    await loadXlsx();
    const wb = XLSX.read(new Uint8Array(await file.arrayBuffer()), {type:'array'}); const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], {defval:null});
    const v = (r,k) => { const x = Number(r[k]); return Number.isFinite(x) && x>0 ? x : 0; };
    const out = [];
    for (const r of rows) {
      const name = String(r.food_name||'').trim(); const kcal = v(r,'energy_kcal'); if (!name || !kcal) continue;
      const servKcal = v(r,'unit_serving_energy_kcal'); const servG = servKcal ? Math.round(servKcal/kcal*100) : 0;
      const unitWord = UNIT_WORDS[normFood(r.servings_unit||'').split(' ').pop()] || null;
      const units = servG>0 && servG<2000 ? {[unitWord && !['g','kg','ml','l'].includes(unitWord) ? unitWord : 'serving']:servG} : {serving:100};
      const d = v(r,'vitd2_ug') + v(r,'vitd3_ug');
      const rd = x => Math.round(x*100)/100;
      out.push([titleCase(name).slice(0,70), indbAliases(name), units, rd(kcal), rd(v(r,'protein_g')), rd(v(r,'carb_g')), rd(v(r,'fat_g')), rd(v(r,'fibre_g')), rd(v(r,'freesugar_g')),
        rd(v(r,'sfa_mg')/1000), rd(v(r,'cholesterol_mg')), rd(v(r,'sodium_mg')), rd(v(r,'potassium_mg')), rd(v(r,'calcium_mg')), rd(v(r,'iron_mg')), rd(v(r,'magnesium_mg')), rd(v(r,'zinc_mg')),
        rd(v(r,'vita_ug')), rd(v(r,'vitc_mg')), rd(d), 0, rd(v(r,'folate_ug')), 0]);
    }
    if (out.length < 50) throw {msg:`Only ${out.length} recipes could be read. Is this the INDB spreadsheet (INDB.xlsx)?`};
    S.libStatus=`Saving ${out.length} recipes…`; render();
    const size = 200; const chunks = Math.ceil(out.length/size);
    for (let i=0;i<chunks;i++) await S.db.doc('foodlib/indb-'+String(i).padStart(2,'0')).set({src:'INDB 2024', part:i, of:chunks, rows:JSON.stringify(out.slice(i*size,(i+1)*size)), saved:Date.now()});
    S.libFoods = out.map(r=>rowToFood(r,'indb')); S.myFoodsVer=(S.myFoodsVer||0)+1;
    S.libStatus=`Added ${out.length} Indian recipes from INDB. They now log instantly without AI.`;
  } catch(e) {
    S.libStatus = e?.msg || 'Couldn’t read that file. Make sure it’s INDB.xlsx and try again.';
  } finally { S.libBusy=false; render(); }
}
function foodIndex(){
  if (S._fidx && S._fidxVer===S.myFoodsVer) return S._fidx;
  const idx = [];
  for (const f of Object.values(S.myFoods||{})) for (const a of [f.name, ...(f.aliases||[])]) { const k=normFood(a); if (k) idx.push({k, f, mine:true}); }
  for (const f of FOODS) for (const a of [f.name, ...f.aliases]) { const k=normFood(a); if (k) idx.push({k, f, pr:2}); }
  for (const f of (S.libFoods||[])) for (const a of [f.name, ...f.aliases]) { const k=normFood(a); if (k && k.length>=3) idx.push({k, f, pr:1}); }
  for (const e of idx) if (e.mine) e.pr = 3;
  idx.sort((a,b)=> (b.k.length-a.k.length) || (b.pr-a.pr));
  S._fidx = idx; S._fidxVer = S.myFoodsVer; return idx;
}
function matchFood(text){
  const t = ' '+normFood(text).split(' ').map(singular).join(' ')+' ';
  const t2 = ' '+normFood(text)+' ';
  for (const e of foodIndex()) { const k=' '+e.k+' ', ks=' '+e.k.split(' ').map(singular).join(' ')+' ';
    if (t2.includes(k) || t.includes(ks)) return e; }
  return null;
}
const WATER_RE = /^(?:(\d+(?:\.\d+)?)\s*(ml|l|ltr|litres?|liters?|glass(?:es)?|bottles?)\s*(?:of\s+)?water|water\s*(\d+(?:\.\d+)?)\s*(ml|l|ltr|litres?|liters?|glass(?:es)?|bottles?)|(\d+|a|one|two|three|four)\s+(glass(?:es)?|bottles?)\s+(?:of\s+)?water)$/;
const NON_FOOD_RE = /\b(\d+\s*x\s*\d+|sets?|reps?|bench|squat|deadlift|press|curl|row|pull ?ups?|push ?ups?|lat|gym|workout|nets|match|bowled|overs?|batted|badminton|cricket|football|run|ran|running|walk|walked|cycling|swim|yoga|steps|slept|sleep|weight\s*\d|weighed|health:|creatine|vitamin|supplement|capsule|tablet|fish oil|omega|multivitamin|ashwagandha|electrolyte|pre-?workout|zinc|magnesium)\b/;
function parseQty(s){
  s = s.replace(/½/g,' 0.5 ').replace(/¼/g,' 0.25 ').replace(/¾/g,' 0.75 ').trim();
  let m = s.match(/^(\d+(?:\.\d+)?)\s*\/\s*(\d+)\s*(.*)$/); if (m) return {q:+m[1]/+m[2], rest:m[3]};
  m = s.match(/^(\d+(?:\.\d+)?)\s*(.*)$/); if (m) return {q:+m[1], rest:m[2]};
  const w = s.split(' ')[0]; if (w in NUM_WORDS) return {q:NUM_WORDS[w], rest:s.slice(w.length).trim()};
  return {q:null, rest:s};
}
function parsePart(raw){
  let s = normFood(raw.replace(/(\d)\s*(g|gm|gms|kg|ml|l)\b/gi,'$1 $2')).replace(/\b(of|some|about|around|approx|approximately|i ate|ate|had|have|having|for (breakfast|lunch|dinner|snack))\b/g,' ').replace(/\s+/g,' ').trim();
  if (!s) return {skip:true};
  const wm = s.match(WATER_RE);
  if (wm) { const q = parseQty((wm[1]||wm[3]||wm[5]||'1')).q || 1; const u = (wm[2]||wm[4]||wm[6]||'ml');
    const ml = /^l|ltr|litre|liter/.test(u) ? q*1000 : /glass/.test(u) ? q*250 : /bottle/.test(u) ? q*1000 : q; return {water:Math.round(ml)}; }
  if (NON_FOOD_RE.test(s)) return null;
  // quantity + unit first ("2 roti", "150 g chicken"), or trailing ("chicken 150 g", "rice 2 cups")
  let {q, rest} = parseQty(s); let unit=null;
  let w = rest.split(' ')[0]; if (UNIT_WORDS[w]) { unit=UNIT_WORDS[w]; rest=rest.slice(w.length).trim(); }
  if (q===null) { const m = rest.match(/^(.*?)\s+(\d+(?:\.\d+)?)\s*([a-z]+)?$/); if (m && (!m[3] || UNIT_WORDS[m[3]])) { rest=m[1]; q=+m[2]; unit=m[3]?UNIT_WORDS[m[3]]:null; } }
  const e = matchFood(rest); if (!e) return null;
  // any unknown word left over (e.g. "mom's special chicken sukka") means it's not this food: let Claude read it
  const aw = new Set(e.k.split(' ').map(singular));
  const left = normFood(rest).split(' ').map(singular).filter(w => w && !aw.has(w) && !FILLER.has(w));
  if (left.length) return null;
  const f = e.f; const qty = q ?? 1;
  let grams;
  if (unit==='g' || unit==='ml') grams = qty; else if (unit==='kg' || unit==='l') grams = qty*1000;
  else { const units = f.units||{}; const u = unit || Object.keys(units)[0] || 'serving'; grams = qty * (units[u] ?? GENERIC_UNITS[u] ?? 100); }
  if (!(grams>0) || grams>5000) return null;
  const label = unit==='g'||unit==='ml' ? `${n0(grams)} ${unit}` : unit==='kg'||unit==='l' ? `${qty} ${unit}` : `${qty} ${unit || Object.keys(f.units||{})[0] || 'serving'}${qty>1&&!/s$/.test(unit||'')?'s':''}`;
  return {food:f, grams, label, mine:!!e.mine};
}
/* Gym entries the built-in exercise table can read (exercises.js), with the
   names this person already uses taking over the built-in ones. */
function gymIndex(){
  if (S._gidx && S._gidxRev===S.days && S._gidxLib===Gym.libVersion()) return S._gidx;
  const known = new Map();
  for (const [,d] of S.days) for (const e of d.exercises||[]) if (e.name && !known.has(exKey(e.name))) known.set(exKey(e.name), {name:e.name, group:e.muscle_group, met:e.met});
  S._gidx = Gym.buildIndex([...known.values()]); S._gidxRev = S.days; S._gidxLib = Gym.libVersion(); return S._gidx;
}
function gymPart(text, prev){
  if (typeof Gym==='undefined') return null;
  try { return Gym.parsePart(text, {index:gymIndex(), prev}); } catch { return null; }
}
function localParse(text, date){
  const meal = /breakfast/i.test(text)?'breakfast':/lunch/i.test(text)?'lunch':/dinner/i.test(text)?'dinner':/snack/i.test(text)?'snack':guessMeal();
  const foods=[], rest=[], exercises=[]; let water=0, prev=null;
  const gymHit = (p) => { const g = gymPart(p, prev); if (!g) return false;
    if (g.continued) g.exercise.sets.push(...g.sets);
    else { prev = {id:uid(), ...g.exercise, kcal_hint:null, time:nowTime()}; delete prev.kind; exercises.push(prev); prev.kind = g.exercise.kind; }
    return true; };
  // Commas and new lines separate entries; gym sets are read before "and"/"+" split them ("pull ups +10kg 3x8").
  for (const chunk of text.split(/\s*(?:,|;|\n)\s*/).map(x=>x.trim()).filter(Boolean)) {
    if (gymHit(chunk)) continue;
    for (const p of chunk.split(/\s*(?:\+|&|\band\b|\bwith\b)\s*/i).map(x=>x.trim()).filter(Boolean)) {
      const r = parsePart(p);
      if (!r) { if (!gymHit(p)) { rest.push(p); prev = null; } continue; }
      prev = null; if (r.skip) continue; if (r.water) { water += r.water; continue; }
      const k = r.grams/100, per = r.food.per; const micros={}; for (const m of MICROS) micros[m.key] = (per.micros[m.key]||0)*k;
      foods.push({id:uid(), name:r.food.name, quantity:r.label, grams:Math.round(r.grams), meal, time:nowTime(), kcal:per.kcal*k, protein:per.protein*k, carbs:per.carbs*k, fat:per.fat*k,
        fiber:per.fiber*k, sugar:per.sugar*k, added_sugar:addedPer100(r.mine ? {...r.food, src:'mine'} : r.food)*k, alcohol:(FOOD_ALCOHOL[r.food.name]||0)*k, micros, confidence:'high', source:r.mine?'my-food':'food-db'});
    }
  }
  for (const e of exercises) { delete e.kind; e.source = 'exercise-db'; e.kcal = exerciseKcal(e, date); }
  return {foods, water, rest, exercises};
}
function saveMyFood(f, extraAlias){
  if (!S.db || !(f.grams>0) || !f.name) return;
  const key = normFood(f.name).replace(/ /g,'-').slice(0,60); if (!key) return;
  const k = 100/f.grams; const micros={}; for (const m of MICROS) micros[m.key] = Math.round(((f.micros||{})[m.key]||0)*k*100)/100;
  const prev = (S.myFoods||{})[key];
  const aliases = [...new Set([...(prev?.aliases||[]), ...(extraAlias?[extraAlias]:[])].map(normFood).filter(Boolean))].slice(0,10);
  const doc = {name:f.name, aliases, units:{serving:Math.round(f.grams)}, per:{kcal:r1(f.kcal*k), protein:r1(f.protein*k), carbs:r1(f.carbs*k), fat:r1(f.fat*k), fiber:r1((f.fiber||0)*k), sugar:r1((f.sugar||0)*k), added_sugar:r1(addedSugar(f)*k), micros},
    src:'mine', verified:!!f.verified || !!prev?.verified, updated:Date.now()};
  if (prev && prev.verified && !f.verified) return; // never overwrite a food the person corrected with a fresh estimate
  S.myFoods = {...(S.myFoods||{}), [key]:doc}; S.myFoodsVer=(S.myFoodsVer||0)+1;
  S.db.doc('foods/'+key).set(doc).catch(()=>{});
}
const r1 = v => Math.round((Number(v)||0)*10)/10;

async function submitLog(){
  const ta = $('#logText'); const text = (ta?.value||'').trim();
  if (!text && !S.photo) { setStatus('Type what you ate, drank or lifted, or add a photo.', true); return; }
  const date = S.date; const p = prof();
  const local = (text && !S.photo) ? localParse(text, date) : {foods:[], water:0, rest:text?[text]:[], exercises:[]};
  const localGym = local.exercises.length ? Gym.recovery(local.exercises) : null;
  const restText = local.rest.join(', ');
  const needAI = !!S.photo || restText.length > 0;
  if (needAI && !S.sample) {
    if (local.foods.length || local.water || local.exercises.length) { await saveEntry(date, {foods:local.foods, water_ml:local.water, exercises:local.exercises, gym_recovery:localGym}); if ($('#logText')) $('#logText').value = restText; setStatus(`Logged what’s in the built-in tables. AI isn’t set up yet, so this part wasn’t read: “${restText}”.`, true); }
    else setStatus('That isn’t in the built-in food or exercise tables, and AI isn’t set up for this app yet (see SETUP.md).', true);
    return;
  }
  S.busy = true; S.ctl = new AbortController();
  const nLocal = local.foods.length + local.exercises.length;
  if (needAI) { setStatus(S.photo ? 'Looking at your photo…' : nLocal ? `Found ${nLocal} in the built-in tables; reading the rest…` : 'Reading your entry…'); render(); }
  try {
    let r = {foods:[], supplements:[], activities:[], gym_recovery:null, exercises:[], water_ml:0, body_weight_kg:null, health:null, notes:''};
    if (needAI) {
      const opts = {signal:S.ctl.signal, task:'log'};
      if (S.photo) opts.images = [await toJpeg(S.photo)];
      r = normalize(await S.sample.json(buildPrompt(S.photo ? text : restText, !!S.photo), opts), date);
      // learn what Claude read so the next time is instant
      const alias = local.rest.length===1 && r.foods.length===1 ? (()=>{ let t=parseQty(normFood(local.rest[0])).rest; const w=t.split(' ')[0]; if (UNIT_WORDS[w]) t=t.slice(w.length).trim(); return t; })() : null;
      for (const f of r.foods) if (f.source!=='photo' && f.confidence!=='low') saveMyFood(f, alias);
    }
    const aiFoods = r.foods.length;
    r.foods = [...local.foods, ...r.foods]; r.water_ml = (r.water_ml||0) + local.water;
    r.exercises = [...local.exercises, ...r.exercises];
    if (local.exercises.length) r.gym_recovery = Gym.recovery(r.exercises) || r.gym_recovery;
    if (!r.foods.length && !r.exercises.length && !r.water_ml && !r.body_weight_kg && !r.health && !r.supplements.length && !r.activities.length) {
      setStatus(r.notes || 'Nothing to log was found in that entry.', true);
    } else {
      await saveEntry(date, r);
      const bits = [];
      if (r.foods.length) bits.push(`${r.foods.length} food${r.foods.length>1?'s':''} · ${n0(r.foods.reduce((s,f)=>s+f.kcal,0))} kcal`);
      if (r.water_ml) bits.push(`${n0(r.water_ml)} ml water`);
      if (r.exercises.length) bits.push(`${r.exercises.length} exercise${r.exercises.length>1?'s':''}`);
      if (r.body_weight_kg) bits.push(`weight ${n1(r.body_weight_kg)} kg`);
      if (r.supplements.length) bits.push(r.supplements.map(x=>x.name).join(', '));
      if (r.health) bits.push('Health data'+(r.health.steps?` (${n0(r.health.steps)} steps`:' (')+(r.health.sleep_min?`${r.health.steps?', ':''}${fmtSleep(r.health.sleep_min)} sleep`:'')+')');
      for (const a of r.activities) enqueueActivity(a, date);
      const how = !needAI ? ' From the built-in tables, no AI used.' : nLocal ? ` ${nLocal} from the built-in tables, the rest read by AI.` : aiFoods ? ' Saved to your food list, so next time it’s instant.' : r.exercises.length ? ' New exercises are remembered, so next time they’re instant.' : '';
      const newPrs = r.exercises.length ? [...prsOn(date).values()].filter(x => r.exercises.some(e => exKey(e.name)===exKey(x.name))) : [];
      setStatus((newPrs.length ? `New personal record: ${newPrs.map(x=>`${x.name}, ${x.text}`).join('; ')}! ` : '') + (bits.length ? 'Logged ' + bits.join(', ') + '.' + how + (r.notes ? ' ' + r.notes : '') : (r.notes||'')));
      if (date===localDate() && r.exercises.some(e => (e.sets||[]).length)) startRest();
      if ($('#logText')) $('#logText').value = ''; clearPhoto();
    }
  } catch (e) {
    if (e?.code === 'cancelled') setStatus('Stopped. Nothing was logged.');
    else {
      // Keep whatever the food table understood, even when Claude can't be reached.
      if (local.foods.length || local.water || local.exercises.length) { await saveEntry(date, {foods:local.foods, water_ml:local.water, exercises:local.exercises, gym_recovery:localGym}); if ($('#logText')) $('#logText').value = restText; }
      setStatus((local.foods.length||local.water||local.exercises.length ? 'Logged what the built-in tables know. ' : '') + (AI_ERR[e?.code] || AI_ERR.unavailable), true);
    }
  } finally { S.busy=false; S.ctl=null; render(); }
  if (S.queue.length) runQueue();
}
async function saveEntry(date, r){
  await writeDay(date, d => {
    d.foods.push(...(r.foods||[])); d.exercises.push(...(r.exercises||[]));
    if (r.gym_recovery) d.gym_recovery = {...r.gym_recovery, ready_at:new Date(Date.now()+r.gym_recovery.hours*3600e3).toISOString()};
    if (r.water_ml) d.water.push({id:uid(), ml:r.water_ml, time:nowTime()});
    if (r.body_weight_kg) d.weight_kg = r.body_weight_kg;
    if ((r.supplements||[]).length) d.supplements = [...(d.supplements||[]), ...r.supplements.map(x => { const st = findStack(x.name); return st ? {...x, stack_id:st.id} : x; })];
    if (r.health) { d.health = {...(d.health||{})}; for (const [k,v] of Object.entries(r.health)) if (v!==null) d.health[k]=v; }
  });
  if (r.body_weight_kg && date >= latestWeightDate()) saveProfile({...prof(), weight_kg:r.body_weight_kg});
}

/* ---------- sport profiles + coach ---------- */
const FREQ = ['Once a week or less','2–3 times a week','4+ times a week'];
const SPORT_Q = {
  cricket: [
    {id:'role', text:'What is your role in the team?', type:'choice', options:['Batter','Fast bowler','Medium pacer','Spinner','All-rounder (pace)','All-rounder (spin)','Wicketkeeper-batter']},
    {id:'runup', text:'If you bowl pace, how long is your run-up?', type:'choice', options:['Short (under 10 steps)','Medium (10–15 steps)','Long (15+ steps)','I don’t bowl pace']},
    {id:'ball', text:'What cricket do you usually play?', type:'choice', options:['Leather ball','Tennis ball','Both','Box cricket']},
    {id:'format', text:'Usual match format', type:'choice', options:['T10 / box','T20','30–40 overs','One-day (50 overs)']},
    {id:'level', text:'Level you play at', type:'choice', options:['Casual with friends','Club / league','Academy / competitive']},
    {id:'field', text:'Where do you usually field?', type:'choice', options:['Close-in / slips','Inner ring','Outfield / boundary','Varies']},
    {id:'nets_min', text:'Typical nets session length', type:'number', unit:'min'},
    {id:'nets_overs', text:'Overs you usually bowl in nets', type:'number', unit:'overs'},
    {id:'freq', text:'How often do you play (nets + matches)?', type:'choice', options:FREQ},
  ],
  badminton: [
    {id:'level', text:'Your level', type:'choice', options:['Beginner','Intermediate','Advanced','Tournament player']},
    {id:'format', text:'What do you mostly play?', type:'choice', options:['Mostly singles','Mostly doubles','Both equally']},
    {id:'style', text:'What are your sessions usually like?', type:'choice', options:['Casual rallies','Competitive games','Coaching / drills','A mix']},
    {id:'length', text:'Typical session length', type:'number', unit:'min'},
    {id:'freq', text:'How often do you play?', type:'choice', options:FREQ},
  ],
  gym: [
    {id:'exp', text:'How long have you been lifting?', type:'choice', options:['Under 6 months','6–24 months','2–5 years','5+ years']},
    {id:'split', text:'How do you split your training?', type:'choice', options:['Full body','Upper / lower','Push / pull / legs','One muscle group a day','It varies']},
    {id:'days', text:'Gym days per week', type:'number', unit:'days'},
    {id:'session', text:'Typical session length', type:'number', unit:'min'},
    {id:'focus', text:'Main focus', type:'choice', options:['Strength','Muscle size','Fat loss','General fitness','Sport performance']},
  ],
};
const SPORT_CHOICES = [['cricket','Cricket'],['badminton','Badminton'],['gym','Gym / weights'],['football','Football'],['running','Running'],['swimming','Swimming'],['tennis','Tennis'],['cycling','Cycling'],['yoga','Yoga']];
function sportKey(name){
  const k = String(name||'').trim().toLowerCase().replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,'-');
  if (/badminton|shuttle/.test(k)) return 'badminton';
  if (/cricket|nets|bowling/.test(k)) return 'cricket';
  if (/^gym|weight|lifting/.test(k)) return 'gym';
  if (/football|soccer/.test(k)) return 'football';
  if (/run|jog/.test(k)) return 'running';
  return k.slice(0,40) || 'activity';
}
const sportName = key => (SPORT_CHOICES.find(x=>x[0]===key)||[])[1] || titleCase(key.replace(/-/g,' '));
function sportProfileText(key){
  const sp = (prof().sports||{})[key];
  if (!sp || !sp.answers || !sp.answers.length) return 'No profile for this sport yet.';
  return sp.answers.filter(a=>a.a!==''&&a.a!=null).map(a=>`${a.q}: ${a.a}`).join('\n');
}
function dayContext(date){
  const d = getDay(date), t = dayTotals(d), T = dayTargets(d), H = d.health||{};
  const lines = [];
  lines.push(`Sleep last night: ${H.sleep_min?fmtSleep(H.sleep_min):'not logged'}`);
  lines.push(`Steps so far: ${H.steps?n0(H.steps):'not logged'}`);
  lines.push(`Eaten so far: ${n0(t.kcal)} of ${n0(T.kcal)} kcal, protein ${n0(t.protein)} of ${n0(T.protein)} g, carbs ${n0(t.carbs)} g, water ${n1(t.water/1000)} L`);
  if ((d.exercises||[]).length) lines.push(`Gym today: ${d.exercises.map(e=>`${e.name} ${(e.sets||[]).length} sets`).join(', ')}`);
  if ((d.sports||[]).length) lines.push(`Other activity today: ${d.sports.map(a=>`${actTitle(a)}${a.minutes?' '+n0(a.minutes)+' min':''}${a.rpe?' effort '+a.rpe+'/10':''}`).join('; ')}`);
  for (let i=1;i<=3;i++){ const dd=S.days.get(addDays(date,-i)); if(!dd) continue; const bits=[];
    if ((dd.exercises||[]).length) bits.push('gym: '+[...new Set(dd.exercises.map(e=>e.muscle_group))].join('/'));
    for (const a of dd.sports||[]) bits.push(`${actTitle(a)}${a.minutes?' '+n0(a.minutes)+' min':''}${a.rpe?' effort '+a.rpe+'/10':''}${a.stats&&a.stats.balls_bowled?' '+a.stats.balls_bowled+' balls bowled':''}`);
    if (dd.health&&dd.health.sleep_min) bits.push('slept '+fmtSleep(dd.health.sleep_min));
    if (bits.length) lines.push(`${i} day${i>1?'s':''} ago: ${bits.join('; ')}`); }
  return lines.join('\n');
}
function coachPrompt(item, allowQuestions){
  const p = prof(), W = who(item.date);
  const qa = (item.qa||[]).map(x=>`Q: ${x.q}\nA: ${x.a}`).join('\n');
  return `You are a sports scientist and coach estimating energy use and recovery for one amateur athlete in India.
Athlete: ${p.sex}, ${W.age} y, ${W.cm} cm, ${n1(W.kg)} kg, goal: ${(GOALS[p.goal]||{}).label||p.goal}.
How they play ${item.name}:
${sportProfileText(item.key)}
Their day so far and recent training:
${dayContext(item.date)}
What they logged (${item.date}, ${item.time}): "${item.entry}"
${qa?`Their answers to your questions:\n${qa}\n`:''}
${allowQuestions ? `If a missing detail would change the calories or the recovery advice a lot, ask about it instead of guessing. Use their profile so you don't ask what you already know (for example, don't ask a fast bowler what they bowl). Ask at most 4 short questions, prefer multiple choice with 3-5 options, and include an option like "Not sure" where useful. Reply with ONLY:
{"status":"questions","questions":[{"id":"overs","text":"How many overs did you bowl?","type":"number","unit":"overs"},{"id":"fielding","text":"How much fielding did you do?","type":"choice","options":["Whole innings in the outfield","Half the innings","Very little"]}]}
If you already have enough, skip the questions and give the result below.` : `Do not ask questions. Where a detail is missing, use what is typical for this athlete's profile and say so in assumptions.`}
The result is ONLY this JSON:
{"status":"done","title":"Cricket match (T20)","summary":"4 overs of fast bowling, 18 balls batting, fielded the full innings","minutes":190,
"components":[{"part":"Fast bowling, 4 overs with long run-up","minutes":20,"met":7.5},{"part":"Fielding 20 overs, outfield","minutes":80,"met":3.5}],
"rpe":7,"stats":{"balls_bowled":24,"balls_faced":18,"overs_fielded":20,"minutes_batted":15},
"recovery":{"hours":36,"level":"hard","summary":"Two sentences on how hard this was for them today and when they can train hard again.","tips":["3-4 short, specific actions: sleep, food with grams, what to avoid tomorrow, body areas to look after"]},
"assumptions":"one short sentence"}
Rules for the result:
- Split the whole session into components whose minutes add up to the session length, including waiting, walking back, drinks breaks and time on the bench (MET 1.5-2.5). Use MET values from the Compendium of Physical Activities (2024 edition), adjusted for their role, run-up, intensity, format and level. Fast bowling with a long run-up is roughly 7-8 MET while bowling; spin about 4.5. Give gross METs; the app subtracts this person's own resting burn.
- rpe is session effort from 1 to 10. stats uses only numbers that apply (null otherwise).
- recovery.hours is the time until they're ready for another hard session of this kind. Base it on this session's load plus last night's sleep, food and protein eaten so far versus their targets, and training in the last 3 days. For fast bowlers, mention bowling workload (overs this week) when relevant. level is "light", "moderate" or "hard".`;
}
function qHtml(questions, answers, ns){
  return questions.map(q => {
    const v = answers[q.id];
    if (q.type==='choice' && Array.isArray(q.options)) return `<div class="q"><div class="qt">${esc(q.text)}</div><div class="opts">${q.options.map(o=>`<button type="button" class="opt" data-action="ans" data-ns="${ns}" data-q="${esc(q.id)}" data-v="${esc(o)}" aria-pressed="${v===o}">${esc(o)}</button>`).join('')}</div></div>`;
    return `<label class="q"><span class="qt">${esc(q.text)}</span><span class="row"><input class="qin" ${q.type==='number'?'type="number" min="0" step="any" inputmode="decimal"':'type="text"'} data-bind="${ns}.${esc(q.id)}" value="${esc(v??'')}" style="max-width:${q.type==='number'?'140px':'100%'}">${q.unit?`<span class="muted small">${esc(q.unit)}</span>`:''}</span></label>`;
  }).join('');
}
function cleanQuestions(qs){
  return (Array.isArray(qs)?qs:[]).slice(0,6).map((q,i)=>({id:String(q.id||('q'+i)).replace(/[^\w-]/g,'').slice(0,30)||('q'+i), text:String(q.text||'').slice(0,200),
    type:['choice','number','text'].includes(q.type)?q.type:(Array.isArray(q.options)?'choice':'text'), options:Array.isArray(q.options)?q.options.slice(0,6).map(o=>String(o).slice(0,60)):undefined, unit:q.unit?String(q.unit).slice(0,16):undefined})).filter(q=>q.text);
}
function enqueueActivity(a, date){
  const key = sportKey(a.sport); const has = (prof().sports||{})[key];
  if (!has && !S.queue.some(x=>x.type==='profile'&&x.key===key)) S.queue.push({type:'profile', key, name:sportName(key), questions:SPORT_Q[key]||null, answers:{}, isNew:true});
  S.queue.push({type:'coach', key, name:sportName(key), entry:a.entry||a.sport, date, time:nowTime(), questions:null, answers:{}, qa:[]});
}
async function runQueue(){
  if (S.qBusy) return;
  while (S.queue.length) {
    const it = S.queue[0];
    if (it.type==='profile') {
      if (!it.questions) { S.qBusy=true; S.qStatus=`Preparing a few questions about ${it.name}…`; render();
        try { it.questions = cleanQuestions(await S.sample.json(`Write 4 to 6 short questions that profile how an amateur athlete in India does "${it.name}", so a coach can later estimate calories burned and recovery from a short description of a session. Cover role or position, level, usual session format and length, intensity, and how often. Prefer multiple choice with 3-5 options. Reply with ONLY a JSON array like [{"id":"level","text":"Your level","type":"choice","options":["Beginner","Intermediate","Advanced"]},{"id":"length","text":"Typical session length","type":"number","unit":"min"}]`, {task:'questions'})); }
        catch(e){ it.questions = []; }
        if (!it.questions.length) it.questions = [{id:'about', text:`Describe how you usually do ${it.name}: level, intensity, typical session length and how often.`, type:'text'}];
        S.qBusy=false; S.qStatus='';
      }
      render(); return; // wait for the person
    }
    if (it.type==='coach') {
      if (it.questions && !it.submitted) { render(); return; }
      S.qBusy=true; it.failed=false; S.qStatus = it.submitted ? `Working out your ${it.name} session…` : `Looking at your ${it.name} session…`; render();
      try {
        const res = await S.sample.json(coachPrompt(it, !it.submitted), {task:'coach'});
        if (res && res.status==='questions' && !it.submitted && cleanQuestions(res.questions).length) {
          it.questions = cleanQuestions(res.questions); S.qBusy=false; S.qStatus=''; render(); return;
        }
        await saveActivity(it, res); S.queue.shift();
      } catch(e) {
        S.qBusy=false; S.qStatus = (AI_ERR[e?.code]||`Couldn’t work out the ${it.name} session.`) + ' Tap Try again, or Discard to drop it.'; it.failed=true; render(); return;
      }
      S.qBusy=false; S.qStatus='';
    }
  }
  render();
}
async function saveActivity(it, res){
  const W = who(it.date);
  const comps = (Array.isArray(res?.components)?res.components:[]).slice(0,12).map(c=>({part:String(c.part||'').slice(0,90), minutes:num(c.minutes,600), met:Math.min(Math.max(Number(c.met)||0,1),16)})).filter(c=>c.minutes>0);
  const minutes = comps.reduce((a,c)=>a+c.minutes,0) || num(res?.minutes,1440);
  // Net of resting burn: resting is already counted in your daily maintenance.
  const kcal = Math.round(comps.reduce((a,c)=>a+Calc.netKcalFromMet(c.met, W.kg, c.minutes, W.bmrKcal).net,0));
  const kcal_gross = Math.round(comps.reduce((a,c)=>a+Calc.netKcalFromMet(c.met, W.kg, c.minutes, W.bmrKcal).gross,0));
  const rc = res?.recovery||{}; const hours = num(rc.hours,240)||null;
  const st = res?.stats||{}; const stats = {}; for (const k of ['balls_bowled','balls_faced','overs_fielded','minutes_batted']) { const v=num(st[k],1000); if (v) stats[k]=Math.round(v); }
  const base = it.date===localDate() ? new Date() : new Date(it.date+'T'+(it.time||'18:00')+':00');
  const act = {id:uid(), v:2, key:it.key, sport:it.name, title:String(res?.title||it.name).slice(0,60), summary:String(res?.summary||'').slice(0,200), entry:it.entry,
    minutes:Math.round(minutes), components:comps, kcal, kcal_gross, rpe:Math.min(10,Math.max(1,Math.round(Number(res?.rpe)||5))), stats,
    recovery: hours ? {hours, level:['light','moderate','hard'].includes(rc.level)?rc.level:'moderate', summary:String(rc.summary||'').slice(0,400), tips:(Array.isArray(rc.tips)?rc.tips:[]).slice(0,5).map(x=>String(x).slice(0,200)), ready_at:new Date(base.getTime()+hours*3600e3).toISOString()} : null,
    assumptions:String(res?.assumptions||'').slice(0,240), qa:it.qa, time:it.time};
  await writeDay(it.date, d => { d.sports = [...(d.sports||[]), act]; });
  setStatus(`${act.title}: about ${n0(kcal)} kcal on top of resting, over ${n0(act.minutes)} min.${act.recovery?` Recovery about ${Math.round(act.recovery.hours)} h.`:''}`);
}
function queueCard(){
  const it = S.queue[0]; if (!it) return '';
  if (S.qBusy) return `<div class="qcard"><div class="qhead">${esc(S.qStatus||'Working…')}</div></div>`;
  if (it.type==='coach' && it.failed) return `<div class="qcard"><div class="qhead">${esc(it.name)}</div><div class="status err">${esc(S.qStatus)}</div>
    <div class="row"><button class="btn ghost sm" data-action="qDiscard">Discard</button><span class="spacer"></span><button class="btn sm" data-action="qRetry">Try again</button></div></div>`;
  if (it.type==='profile') return `<div class="qcard"><div class="qhead">${it.isNew?`New sport: ${esc(it.name)}. Tell me how you play and I’ll remember it.`:`Update how you play ${esc(it.name)}`}</div>
    <div class="qs">${qHtml(it.questions||[], it.answers, 'q')}</div>
    <div class="row"><button class="btn ghost sm" data-action="qSkipProfile">Skip for now</button><span class="spacer"></span><button class="btn sm" data-action="qSaveProfile">Save${S.queue[1]?' and continue':''}</button></div></div>`;
  if (it.type==='coach' && it.questions) return `<div class="qcard"><div class="qhead">${esc(it.name)}: a few details so I can get this right</div>
    <div class="muted small">“${esc(it.entry)}”</div>
    <div class="qs">${qHtml(it.questions, it.answers, 'q')}</div>
    <div class="row"><button class="btn ghost sm" data-action="qDiscard">Discard</button><button class="btn ghost sm" data-action="qSkip">Skip, use typical</button><span class="spacer"></span><button class="btn sm" data-action="qSubmit">Calculate</button></div></div>`;
  return '';
}
function saveSportProfile(key, name, questions, answers){
  const p = prof(); const sports = {...(p.sports||{})};
  sports[key] = {name, answers:questions.map(q=>({id:q.id, q:q.text, a:answers[q.id]??''})), updated:localDate()};
  return saveProfile({...p, sports});
}
const actTitle = a => a.v===2 ? a.title : sportTitle(a);
const actLine = a => a.v===2 ? (a.summary || (a.components||[]).map(c=>c.part).join(' · ')) : sportLine(a);
function latestRecovery(){
  const now = Date.now(); let best=null;
  for (let i=0;i<4;i++){ const d=S.days.get(addDays(localDate(),-i)); if(!d) continue;
    const cands = [...(d.sports||[]).filter(a=>a.recovery&&a.recovery.ready_at).map(a=>({label:a.title, r:a.recovery})), ...(d.gym_recovery&&d.gym_recovery.ready_at?[{label:'Gym ('+(d.gym_recovery.muscles||[]).join(', ')+')', r:d.gym_recovery}]:[])];
    for (const c of cands) { const t=Date.parse(c.r.ready_at); if (!best || t>best.t) best={...c, t}; } }
  if (!best) return null; return {...best, recovering: best.t>now};
}
const fmtReady = t => new Date(t).toLocaleString('en-IN',{weekday:'short', hour:'numeric', minute:'2-digit'});


/* ---------- activity panel + setup ---------- */
function activityPanel(day){
  const acts = day.sports||[], ex = day.exercises||[], t = dayTotals(day);
  let h = '';
  if (!acts.length && !ex.length) h += `<div class="empty">Nothing yet. Type what you did in the box above, like “played a cricket match, bowled 4 overs” or “badminton 1 hr”. I’ll ask anything I need to know.</div>`;
  for (const a of acts) {
    h += `<div class="act"><div class="act-h"><div><div class="nm">${esc(actTitle(a))}${a.rpe?` <span class="tag">effort ${a.rpe}/10</span>`:''}</div><div class="sub">${esc(actLine(a))}${a.minutes?` · ${n0(a.minutes)} min`:''}</div></div>
      <div class="kc">${n0(a.kcal)}<span class="muted small"> kcal</span></div>
      <div class="acts"><button data-action="editSport" data-id="${a.id}" aria-label="Edit ${esc(actTitle(a))}">Edit</button><button data-action="delSport" data-id="${a.id}" aria-label="Delete ${esc(actTitle(a))}">✕</button></div></div>
      ${a.recovery ? recoveryHtml(a.recovery) : ''}
      ${a.v===2 && (a.components||[]).length ? `<details class="how"><summary>How this was worked out</summary><ul>${a.components.map(c=>`<li>${esc(c.part)} · ${n0(c.minutes)} min · MET ${n1(c.met)}</li>`).join('')}</ul><div class="muted small">${a.kcal_gross?`${n0(a.kcal_gross)} kcal in total, minus your resting burn for those minutes = ${n0(a.kcal)} kcal extra. `:''}${esc(a.assumptions||'')}</div></details>`:''}
    </div>`;
  }
  if (ex.length) {
    h += `<div class="act"><div class="act-h"><div><div class="nm">Gym session</div><div class="sub">${ex.length} exercise${ex.length>1?'s':''}${day.gym_recovery&&day.gym_recovery.muscles?.length?` · ${esc(day.gym_recovery.muscles.join(', '))}`:''}</div></div><div class="kc">${n0(t.gym)}<span class="muted small"> kcal</span></div><span></span></div>
      ${exerciseList(day)}
      ${day.gym_recovery ? recoveryHtml(day.gym_recovery) : ''}</div>`;
  }
  return h;
}
function recoveryHtml(r){
  const t = Date.parse(r.ready_at); const left = t - Date.now();
  const lvl = r.level==='hard'?'bad':r.level==='light'?'good':'warn';
  return `<div class="rec"><div class="row"><span class="pill ${lvl}">${left>0?`Recovering · ready ${esc(fmtReady(t))}`:'Recovered'}</span><span class="muted small">about ${Math.round(r.hours)} h</span></div>
    ${r.summary?`<div class="small">${esc(r.summary)}</div>`:''}
    ${(r.tips||[]).length?`<ul class="tips">${r.tips.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}</div>`;
}
function staleSports(){
  const cutoff = addDays(localDate(), -90);
  return Object.entries(prof().sports||{}).filter(([k,v]) => v.updated && v.updated < cutoff && v.checked !== localDate().slice(0,7));
}
// Monthly: after two weeks of logs with no backup, or 30 days since the last one; "Later" waits a week.
function backupDue(){
  if (!S.profile || S.date!==localDate()) return false;
  let later = 0; try { later = +localStorage.getItem('mt:backup-later')||0; } catch {}
  if (Date.now() - later < 7*864e5) return false;
  const last = prof().last_backup;
  if (last) return last <= addDays(localDate(), -30);
  const logged = [...S.days.values()].filter(d => (d.foods||[]).length || (d.exercises||[]).length).length;
  return logged >= 14;
}
function todayBanners(){
  let h='';
  const waiting = S.isAdmin ? (S.members||[]).filter(x=>x.status==='pending').length : 0;
  let later = false; try { later = !!localStorage.getItem('mt:faceid-later:'+(S.user?.id||'')); } catch {}
  if (S.bioOK && S.passkeys && !S.passkeys.length && !later) h += `<div class="banner" style="margin-bottom:16px;border-left-color:var(--accent)"><b>Sign in with ${bioName()} next time.</b> No password needed after this. <button class="linkbtn" data-action="faceIdSetup" ${S.pkBusy?'disabled':''}>Turn it on</button><button class="linkbtn" data-action="faceIdLater" style="color:var(--ink-3)">Not now</button></div>`;
  if (waiting) h += `<div class="banner" style="margin-bottom:16px;border-left-color:var(--accent)">${waiting} ${waiting===1?'person is':'people are'} waiting for you to approve them. <button class="linkbtn" data-action="reviewPeople">Review</button></div>`;
  if (S.profile && !Object.keys(S.profile.sports||{}).length) h += `<div class="banner" style="margin-bottom:16px">Tell me which sports you play and how, so calories and recovery fit you. <button class="linkbtn" data-action="startSetup" data-step="sports">Set up my sports</button></div>`;
  if (backupDue()) h += `<div class="banner" style="margin-bottom:16px">${prof().last_backup ? `Your last backup was on ${esc(fmtDate(prof().last_backup,{day:'numeric',month:'short'}))}.` : 'You haven’t downloaded a backup yet.'} The free database has no backups of its own, so keep a copy on your phone. <button class="linkbtn" data-action="backupNow">Download backup</button><button class="linkbtn" data-action="backupLater" style="color:var(--ink-3)">Later</button></div>`;
  for (const [k,v] of staleSports()) h += `<div class="banner" style="margin-bottom:16px">Your ${esc(v.name)} details are from ${esc(fmtDate(v.updated,{day:'numeric',month:'short',year:'numeric'}))}. Still how you play? <button class="linkbtn" data-action="updSport" data-key="${esc(k)}">Update</button><button class="linkbtn" data-action="stillRight" data-key="${esc(k)}">Still right</button></div>`;
  return h;
}

// first-run interview
function startSetup(step){
  const p = prof();
  const keys = Object.keys(p.sports||{});
  S.setup = {step: step||'about', about:{name:p.name||'', sex:p.sex, birth:p.birth||'', height_cm:p.height_cm, weight_kg:p.weight_kg, goal:p.goal, goal_rate:p.goal_rate, activity:p.activity, watch_workouts:!!p.watch_workouts},
    sports:keys, other:'', answers:Object.fromEntries(keys.map(k=>[k, Object.fromEntries(((p.sports[k]||{}).answers||[]).map(a=>[a.id,a.a]))])), qs:{}};
  S.view='setup'; render(); window.scrollTo({top:0});
}
function setupSteps(){ return ['about','sports', ...S.setup.sports.map(k=>'sport:'+k), 'done']; }
function viewSetup(){
  const su = S.setup, steps = setupSteps(), idx = steps.indexOf(su.step), a = su.about;
  const head = `<div class="panel-head"><h2>Set up</h2><span class="muted small">Step ${idx+1} of ${steps.length}</span></div>`;
  const nav = (next='Next') => `<div class="row"><button class="btn ghost" data-action="setupBack" ${idx===0?'hidden':''}>Back</button><span class="spacer"></span>${idx===0?`<button class="linkbtn" data-action="setupSkip">Skip for now</button>`:''}<button class="btn" data-action="setupNext">${next}</button></div>`;
  const sel = (key, obj) => Object.entries(obj).map(([k,v])=>`<option value="${k}" ${String(a[key])===k?'selected':''}>${esc(v.label||v)}</option>`).join('');
  if (su.step==='about') return `<section class="panel setup">${head}
    <h3>About you</h3><p class="muted small">This sets your calorie, protein, water and nutrient targets.</p>
    <div class="form">
      <label class="field full">Your name<input type="text" maxlength="40" autocomplete="given-name" data-bind="about.name" placeholder="What should the app call you?" value="${esc(a.name||'')}"></label>
      <label class="field">Sex<select data-bind="about.sex">${sel('sex',{male:'Male',female:'Female'})}</select></label>
      <label class="field">Date of birth<input type="date" data-bind="about.birth" max="${localDate()}" value="${esc(a.birth)}"></label>
      <label class="field">Height (cm)<input type="number" step="0.5" data-bind="about.height_cm" value="${esc(a.height_cm)}"></label>
      <label class="field">Weight (kg)<input type="number" step="0.1" data-bind="about.weight_kg" value="${esc(a.weight_kg)}"></label>
      <label class="field full">Daily life, not counting gym and sport<select data-bind="about.activity">${sel('activity',ACTIVITY)}</select><span class="hint">Logged training is added on the day you do it.</span></label>
      <label class="field">Goal<select data-bind="about.goal">${sel('goal',GOALS)}</select></label>
      <label class="field">Rate (kg / week)<select data-bind="about.goal_rate">${sel('goal_rate',{'0.25':'0.25','0.5':'0.5','0.75':'0.75','1':'1'})}</select></label>
      <label class="check full"><input type="checkbox" data-bind="about.watch_workouts" ${a.watch_workouts?'checked':''}> I record gym and sport sessions on an Apple Watch</label>
    </div>${nav()}</section>`;
  if (su.step==='sports') return `<section class="panel setup">${head}
    <h3>What do you play or train?</h3><p class="muted small">Pick everything you do regularly. I’ll ask a few questions about each one.</p>
    <div class="opts">${SPORT_CHOICES.map(([k,l])=>`<button class="opt" data-action="setupSport" data-key="${k}" aria-pressed="${su.sports.includes(k)}">${esc(l)}</button>`).join('')}
      ${su.sports.filter(k=>!SPORT_CHOICES.some(c=>c[0]===k)).map(k=>`<button class="opt" data-action="setupSport" data-key="${esc(k)}" aria-pressed="true">${esc(sportName(k))}</button>`).join('')}</div>
    <div class="row"><input id="setupOther" type="text" placeholder="Something else, e.g. kabaddi" style="flex:1;min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:9px 10px"><button class="btn ghost sm" data-action="setupAddOther">Add</button></div>
    ${nav()}</section>`;
  if (su.step.startsWith('sport:')) {
    const k = su.step.slice(6); const qs = SPORT_Q[k] || su.qs[k];
    su.answers[k] ||= {};
    return `<section class="panel setup">${head}<h3>${esc(sportName(k))}</h3><p class="muted small">So I can tell a hard session from an easy one without asking every time. You can change these later in Profile.</p>
      ${qs ? `<div class="qs">${qHtml(qs, su.answers[k], 'setup.'+k)}</div>` : `<div class="empty">Preparing questions…</div>`}
      ${nav()}</section>`;
  }
  return `<section class="panel setup">${head}<h3>All set</h3>
    <p>Targets and sport details are saved. From now on, just tell the log box what you ate or did. When a session needs more detail, I’ll ask, then show calories burned and how long you need to recover.</p>
    ${nav('Save and start')}</section>`;
}
async function setupLoadQuestions(k){
  if (SPORT_Q[k] || S.setup.qs[k] || !S.sample) { if (!SPORT_Q[k] && !S.setup.qs[k]) S.setup.qs[k]=[{id:'about', text:`Describe how you usually do ${sportName(k)}: level, intensity, typical session length and how often.`, type:'text'}]; return; }
  try { S.setup.qs[k] = cleanQuestions(await S.sample.json(`Write 4 to 6 short questions that profile how an amateur athlete in India does "${sportName(k)}", so a coach can later estimate calories burned and recovery from a short description of a session. Cover role or position, level, usual session format and length, intensity, and how often. Prefer multiple choice with 3-5 options. Reply with ONLY a JSON array like [{"id":"level","text":"Your level","type":"choice","options":["Beginner","Intermediate","Advanced"]}]`, {task:'questions'})); }
  catch { S.setup.qs[k] = []; }
  if (!S.setup.qs[k].length) S.setup.qs[k] = [{id:'about', text:`Describe how you usually do ${sportName(k)}: level, intensity, typical session length and how often.`, type:'text'}];
  if (S.view==='setup') render();
}
async function setupGo(dir){
  const su = S.setup, steps = setupSteps(); let i = steps.indexOf(su.step) + dir;
  if (dir>0 && su.step==='done') {
    const p = prof(); const a = su.about; const sports = {};
    for (const k of su.sports) { const qs = SPORT_Q[k] || su.qs[k] || []; const prev = (p.sports||{})[k];
      sports[k] = {name:sportName(k), answers:qs.map(q=>({id:q.id, q:q.text, a:(su.answers[k]||{})[q.id]??''})), updated:localDate()}; if (prev && JSON.stringify(prev.answers)===JSON.stringify(sports[k].answers)) sports[k].updated = prev.updated; }
    const birthOk = /^\d{4}-\d{2}-\d{2}$/.test(a.birth||'') && Calc.ageOn(a.birth, localDate())>=13;
    if (!birthOk) { toast('Add your date of birth on step 1: targets depend on age.'); su.step='about'; render(); return; }
    await saveProfile({...p, name:String(a.name||'').trim().slice(0,40), sex:a.sex, birth:a.birth, age:Calc.ageOn(a.birth, localDate()), height_cm:num(a.height_cm,250)||170, weight_kg:num(a.weight_kg,300)||70, activity:actId(a.activity), goal:a.goal, goal_rate:Number(a.goal_rate)||0.5, watch_workouts:!!a.watch_workouts, sports});
    if (num(a.weight_kg,300) && !getDay(localDate()).weight_kg) writeDay(localDate(), d => { d.weight_kg = num(a.weight_kg,300); });
    S.setup=null; S.view='today'; toast('Saved. Your targets and sport details are set.'); render(); window.scrollTo({top:0}); return;
  }
  i = Math.max(0, Math.min(steps.length-1, i)); su.step = steps[i];
  if (su.step.startsWith('sport:')) setupLoadQuestions(su.step.slice(6));
  render(); window.scrollTo({top:0});
}
function sportsProfileHtml(){
  const sp = prof().sports||{};
  const rows = Object.entries(sp).map(([k,v]) => `<div class="item"><div><div class="nm">${esc(v.name||sportName(k))}</div><div class="sub">${esc((v.answers||[]).filter(a=>a.a!==''&&a.a!=null).map(a=>a.a).join(' · ')||'No details yet')}</div><div class="sub">Updated ${esc(v.updated?fmtDate(v.updated,{day:'numeric',month:'short',year:'numeric'}):'—')}</div></div><span></span>
    <div class="acts"><button data-action="updSport" data-key="${esc(k)}">Update</button><button data-action="rmSport" data-key="${esc(k)}" aria-label="Remove ${esc(v.name)}">✕</button></div></div>`).join('');
  return `${rows || '<div class="muted small">No sports set up yet.</div>'}<div class="row"><button class="btn ghost sm" data-action="startSetup" data-step="sports">Add or change sports</button><button class="btn ghost sm" data-action="startSetup" data-step="about">Redo full setup</button></div>`;
}


/* ---------- health reports ---------- */
function recentDiet(days=7){
  const rows=[]; for (let i=0;i<days;i++){ const d=S.days.get(addDays(localDate(),-i)); if (d && (d.foods||[]).length) rows.push(dayTotals(d)); }
  if (!rows.length) return 'No food logged in the last week.';
  const avg = k => rows.reduce((s,r)=>s+(k in r ? r[k] : r.micros[k]||0),0)/rows.length;
  return `Average over ${rows.length} logged days: ${n0(avg('kcal'))} kcal, protein ${n0(avg('protein'))} g, carbs ${n0(avg('carbs'))} g, fat ${n0(avg('fat'))} g, saturated fat ${n0(avg('sat_fat_g'))} g, fibre ${n0(avg('fiber'))} g, sugar ${n0(avg('sugar'))} g, sodium ${n0(avg('sodium_mg'))} mg, cholesterol ${n0(avg('cholesterol_mg'))} mg.`;
}
function reportPrompt(nImages, total, isPdf){
  const p = prof(), W = who(localDate());
  return `You are a doctor-informed sports nutritionist in India. ${isPdf ? 'The attached PDF is one blood test / lab report.' : `The ${nImages} attached image${nImages>1?'s are pages':' is a page'} of one blood test / lab report.`}
Person: ${p.sex}, ${W.age} y, ${W.cm} cm, ${n1(W.kg)} kg, goal: ${(GOALS[p.goal]||{}).label}. Sports: ${Object.values(p.sports||{}).map(s=>s.name).join(', ')||'not set'}.
Their recent eating: ${recentDiet()}
Read every test result on the pages and reply with ONLY this JSON:
{"report_date":"YYYY-MM-DD","lab":"lab name or empty",
"markers":[{"key":"ldl_cholesterol","name":"LDL cholesterol","value":132,"value_text":null,"unit":"mg/dL","ref":"< 100","status":"high","category":"Lipids"}],
"summary":"2-3 plain sentences on the overall picture",
"findings":[{"title":"LDL cholesterol is high","detail":"what it means for this person, in plain words","severity":"watch"}],
"eating":["specific changes with Indian foods and amounts"],"training":["specific changes to training or sport"],"lifestyle":["sleep, sun, stress, alcohol, smoking etc."],
"retest":"which tests to repeat and when",
"see_doctor":false,
"target_adjustments":{"sat_fat_pct":null,"cholesterol_mg":null,"sugar_pct":null,"sodium_mg":null,"fiber_g":null,"micro_targets":{},"focus":[],"reasons":[]}}
Rules:
- key is a stable snake_case name so the same test matches across reports: total_cholesterol, ldl_cholesterol, hdl_cholesterol, triglycerides, vldl, non_hdl, hba1c, fasting_glucose, pp_glucose, fasting_insulin, hemoglobin, rbc, wbc, platelets, ferritin, serum_iron, tibc, vitamin_d, vitamin_b12, folate, tsh, t3, t4, alt, ast, alp, ggt, bilirubin, albumin, creatinine, urea, bun, egfr, uric_acid, sodium, potassium, calcium, crp, testosterone, etc.
- value is a number in the report's unit; for non-numeric results use null and put the text in value_text. ref is the reference range as printed. status is low, high, borderline or normal, judged against the printed range (or standard adult ranges if none is printed).
- findings: only the results that matter (skip normal ones unless reassuring context helps), severity "good", "watch" or "see_doctor". Set see_doctor true if anything needs a doctor soon.
- eating / training / lifestyle: 2-5 items each, concrete and tailored to this person's results, goal, sports and current eating.
- target_adjustments: only change what the results justify, and give one reason per change. sat_fat_pct 5-10 (percent of calories), cholesterol_mg 150-300, sugar_pct 3-10, sodium_mg 1200-2300, fiber_g 25-50. micro_targets may raise targets for vitamin_d_mcg, vitamin_b12_mcg, iron_mg, folate_mcg, calcium_mg, magnesium_mg, potassium_mg, zinc_mg, omega3_g. focus lists nutrient keys from ${MICROS.map(m=>m.key).join(', ')} to highlight. Leave everything null/empty if no change is needed.
- This is guidance, not a diagnosis; never suggest prescription medicine doses.`;
}
async function onReportFiles(files){
  if (!files.length) return;
  if (!S.sample) { S.repStatus='Reading reports needs AI, which isn’t set up for this app yet.'; render(); return; }
  const max = 5;
  S.repBusy=true; S.repStatus='Preparing the report…'; render();
  try {
    // PDFs go to Claude as documents (it reads the text layer and the page
    // images, which is more accurate than photos); photos are sent as images.
    let images=[], documents=[], total=0;
    for (const f of files) {
      if (f.type==='application/pdf' || /\.pdf$/i.test(f.name)) { if (!documents.length) { documents.push(f); total++; } }
      else if (images.length<max) { images.push(await toJpeg(f)); total++; }
    }
    if (!documents.length && !images.length) throw {code:'no_markers'};
    const parts = documents.length ? 'the PDF' : `${images.length} page${images.length>1?'s':''}`;
    S.repStatus = `Reading ${parts}… this can take a minute.`; render();
    const res = await S.sample.json(reportPrompt(documents.length ? 0 : images.length, total, !!documents.length), {images, documents, task:'report'});
    const rep = normalizeReport(res);
    if (!rep.markers.length) throw {code:'no_markers'};
    if (S.db) await S.db.doc('reports/'+rep.id).set(rep);
    S.reports = [rep, ...S.reports.filter(r=>r.id!==rep.id)].sort((a,b)=>b.report_date.localeCompare(a.report_date));
    S.repSel = rep.id;
    S.repStatus = `Read ${rep.markers.length} results from ${fmtDate(rep.report_date,{day:'numeric',month:'short',year:'numeric'})}.`;
  } catch(e) {
    S.repStatus = e?.code==='pdf_failed' ? 'Couldn’t open that PDF here. Take screenshots of the pages and upload those instead.'
      : e?.code==='no_markers' ? 'No test results were found in that file. Make sure the pages with the result tables are included.'
      : (AI_ERR[e?.code] || 'Couldn’t read the report. Try again, or upload clear photos of the result pages.');
  } finally { S.repBusy=false; render(); }
}
function normalizeReport(res){
  const st = ['low','high','borderline','normal'];
  const markers = (Array.isArray(res?.markers)?res.markers:[]).slice(0,120).map(m=>({key:String(m.key||m.name||'').toLowerCase().replace(/[^a-z0-9_]/g,'_').slice(0,40), name:String(m.name||m.key||'').slice(0,60),
    value: Number.isFinite(Number(m.value)) && m.value!==null && m.value!=='' ? Number(m.value) : null, value_text:m.value_text?String(m.value_text).slice(0,60):null,
    unit:String(m.unit||'').slice(0,20), ref:String(m.ref||'').slice(0,40), status:st.includes(m.status)?m.status:'normal', category:String(m.category||'Other').slice(0,30)})).filter(m=>m.key&&m.name);
  const ta = res?.target_adjustments||{}; const clamp=(v,a,b)=>{ const n=Number(v); return Number.isFinite(n)&&n>0 ? Math.min(b,Math.max(a,n)) : null; };
  const mt = {}; for (const [k,v] of Object.entries(ta.micro_targets||{})) if (MICROS.some(m=>m.key===k) && Number(v)>0) mt[k]=Number(v);
  const adjust = {sat_fat_pct:clamp(ta.sat_fat_pct,5,10), cholesterol_mg:clamp(ta.cholesterol_mg,150,300), sugar_pct:clamp(ta.sugar_pct,3,10), sodium_mg:clamp(ta.sodium_mg,1200,2300), fiber_g:clamp(ta.fiber_g,25,50),
    micro_targets:mt, focus:(Array.isArray(ta.focus)?ta.focus:[]).filter(k=>MICROS.some(m=>m.key===k)), reasons:(Array.isArray(ta.reasons)?ta.reasons:[]).slice(0,8).map(x=>String(x).slice(0,200))};
  const list = x => (Array.isArray(x)?x:[]).slice(0,6).map(v=>String(v).slice(0,300));
  const date = /^\d{4}-\d{2}-\d{2}$/.test(res?.report_date||'') ? res.report_date : localDate();
  return {id:uid(), report_date:date, lab:String(res?.lab||'').slice(0,60), markers, summary:String(res?.summary||'').slice(0,600),
    findings:(Array.isArray(res?.findings)?res.findings:[]).slice(0,10).map(f=>({title:String(f.title||'').slice(0,100), detail:String(f.detail||'').slice(0,400), severity:['good','watch','see_doctor'].includes(f.severity)?f.severity:'watch'})),
    eating:list(res?.eating), training:list(res?.training), lifestyle:list(res?.lifestyle), retest:String(res?.retest||'').slice(0,300), see_doctor:!!res?.see_doctor, adjust, created:Date.now()};
}
function adjustLines(a){
  const out=[]; if (!a) return out;
  if (a.sat_fat_pct) out.push(`Saturated fat limit: ${a.sat_fat_pct}% of calories`);
  if (a.cholesterol_mg) out.push(`Dietary cholesterol limit: ${a.cholesterol_mg} mg`);
  if (a.sugar_pct) out.push(`Added sugar limit: ${a.sugar_pct}% of calories`);
  if (a.sodium_mg) out.push(`Sodium limit: ${n0(a.sodium_mg)} mg`);
  if (a.fiber_g) out.push(`Fibre target: ${a.fiber_g} g`);
  for (const [k,v] of Object.entries(a.micro_targets||{})) { const m=MICROS.find(x=>x.key===k); if (m) out.push(`${m.label} target: ${fmtAmt(v,m.unit)} ${m.unit}`); }
  return out;
}
const sevPill = s => s==='see_doctor'?'bad':s==='good'?'good':'warn';
const sevLabel = s => s==='see_doctor'?'See a doctor':s==='good'?'Good':'Watch';
const statusPill = s => s==='high'||s==='low' ? `<span class="pill bad">${s}</span>` : s==='borderline' ? '<span class="pill warn">borderline</span>' : '<span class="pill good">normal</span>';
function viewHealth(){
  const reps = S.reports||[]; const sel = reps.find(r=>r.id===S.repSel) || reps[0]; const p = prof(); const applied = p.report_adjust;
  let h = `<div class="grid">
    <section class="panel" id="reports"><div class="panel-head"><h2>Blood tests</h2><span class="muted small">${reps.length} report${reps.length===1?'':'s'}</span></div>
      <div class="small">Upload a lab report (PDF, or photos or screenshots of the pages). AI reads each result, explains what’s out of range, and suggests changes to your eating and training that you can apply to your targets.</div>
      <div class="row"><button class="btn" data-action="pickReport" ${S.repBusy||S.aiState==='off'?'disabled':''}>${S.repBusy?'Working…':'Add a report'}</button><span class="status${/Couldn|No test|needs|can’t/.test(S.repStatus||'')?' err':''}" aria-live="polite">${esc(S.repStatus||'')}</span></div>
      ${applied ? `<div class="banner">Your targets include changes from your ${esc(fmtDate(applied.from_date||localDate(),{day:'numeric',month:'short',year:'numeric'}))} report: ${esc(adjustLines(applied).join('; ')||'highlighted nutrients')}. <button class="linkbtn" data-action="unapplyReport">Remove these changes</button></div>`:''}
    </section>`;
  if (!sel) return h + `<section class="panel"><div class="empty">No reports yet. A lipid profile, HbA1c, vitamin D, B12, iron studies, thyroid, liver and kidney tests are the most useful for someone who trains and plays sport.</div></section></div>`;
  const cats = [...new Set(sel.markers.map(m=>m.category))];
  const flagged = sel.markers.filter(m=>m.status!=='normal');
  h += `<section class="panel"><div class="panel-head"><h2>${esc(fmtDate(sel.report_date,{day:'numeric',month:'long',year:'numeric'}))}</h2><span class="muted small">${esc(sel.lab||'')} · ${sel.markers.length} results · ${flagged.length} flagged</span></div>
    ${reps.length>1?`<div class="opts">${reps.map(r=>`<button class="opt" data-action="pickRep" data-id="${r.id}" aria-pressed="${r.id===sel.id}">${esc(fmtDate(r.report_date,{day:'numeric',month:'short',year:'numeric'}))}</button>`).join('')}</div>`:''}
    ${sel.see_doctor?`<div class="banner" style="border-left-color:var(--bad)">Some results here should be discussed with a doctor soon.</div>`:''}
    <div>${esc(sel.summary)}</div>
    ${sel.findings.length?`<div class="findings">${sel.findings.map(f=>`<div class="finding"><span class="pill ${sevPill(f.severity)}">${sevLabel(f.severity)}</span><div><b>${esc(f.title)}</b><div class="small">${esc(f.detail)}</div></div></div>`).join('')}</div>`:''}
  </section>
  <div class="grid two">
    ${[['Eating','eating'],['Training','training'],['Lifestyle','lifestyle']].map(([l,k])=>sel[k].length?`<section class="panel"><h3>${l}</h3><ul class="tips">${sel[k].map(x=>`<li>${esc(x)}</li>`).join('')}</ul></section>`:'').join('')}
    <section class="panel"><h3>Changes to your targets</h3>
      ${adjustLines(sel.adjust).length||sel.adjust.focus.length ? `<ul class="tips">${adjustLines(sel.adjust).map(x=>`<li>${esc(x)}</li>`).join('')}${sel.adjust.focus.length?`<li>Highlight: ${esc(sel.adjust.focus.map(k=>MICROS.find(m=>m.key===k)?.label).join(', '))}</li>`:''}</ul>
        ${sel.adjust.reasons.length?`<div class="muted small">${esc(sel.adjust.reasons.join(' '))}</div>`:''}
        <div class="row">${applied && applied.from===sel.id ? '<span class="pill good">Applied</span>' : `<button class="btn sm" data-action="applyReport" data-id="${sel.id}">Apply to my targets</button>`}</div>`
        : '<div class="muted small">No changes needed from this report.</div>'}
      ${sel.retest?`<div class="small"><b>Retest:</b> ${esc(sel.retest)}</div>`:''}
    </section>
  </div>
  <section class="panel"><div class="panel-head"><h2>All results</h2><button class="linkbtn" data-action="delReport" data-id="${sel.id}">Delete this report</button></div>
    <div class="tablewrap" tabindex="0"><table><thead><tr><th class="l">Test</th><th class="r">Result</th><th>Range</th><th>Status</th>${reps.length>1?'<th class="r">Previous</th>':''}</tr></thead><tbody>
    ${cats.map(c=>`<tr><td colspan="${reps.length>1?5:4}" class="l" style="font-weight:700;color:var(--ink-3);font-size:12px;text-transform:uppercase;letter-spacing:.07em">${esc(c)}</td></tr>`+sel.markers.filter(m=>m.category===c).map(m=>{
      const prev = reps.filter(r=>r.report_date<sel.report_date).map(r=>r.markers.find(x=>x.key===m.key)).find(Boolean);
      return `<tr class="click" data-action="pickMarker" data-key="${esc(m.key)}"><td class="l">${esc(m.name)}</td><td class="r"><b>${m.value!==null?esc(String(m.value)):esc(m.value_text||'—')}</b> <span class="muted small">${esc(m.unit)}</span></td><td class="muted small">${esc(m.ref)}</td><td>${statusPill(m.status)}</td>${reps.length>1?`<td class="r muted">${prev&&prev.value!==null?esc(String(prev.value)):'—'}</td>`:''}</tr>`; }).join('')).join('')}
    </tbody></table></div>
    ${markerTrend(reps)}
  </section>
  <div class="muted small">This reads and explains your report; it isn’t a diagnosis. Take flagged results to your doctor, especially anything marked “See a doctor”.</div>
  </div>`;
  return h;
}
function markerTrend(reps){
  if (reps.length<2) return '<div class="muted small">Add another report later and each result will be charted over time.</div>';
  const key = S.repMarker || (reps[0].markers.find(m=>m.status!=='normal')||reps[0].markers[0]||{}).key;
  const pts = reps.slice().reverse().map(r=>({r, m:r.markers.find(x=>x.key===key)})).filter(x=>x.m&&x.m.value!==null).map(x=>({date:x.r.report_date, v:x.m.value, tip:`${x.m.value} ${x.m.unit} (${x.m.status})`}));
  const name = (reps[0].markers.find(m=>m.key===key)||{}).name || key;
  if (pts.length<2) return `<div class="muted small">${esc(name)} appears in only one report. Tap another test to see its trend.</div>`;
  return `<h3>${esc(name)} over time</h3>${lineChart({pts, unit:(reps[0].markers.find(m=>m.key===key)||{}).unit||'', color:'var(--fat)', wide:true})}`;
}

/* ---------- weekly review ---------- */
function weekDigest(){
  const lines=[]; const T=targets();
  for (let i=6;i>=0;i--){ const date=addDays(localDate(),-i); const d=S.days.get(date); if(!d) { lines.push(`${date}: nothing logged`); continue; }
    const t=dayTotals(d), H=d.health||{};
    lines.push(`${date}: ${n0(t.kcal)} kcal, P ${n0(t.protein)} C ${n0(t.carbs)} F ${n0(t.fat)} g, sat fat ${n0(t.micros.sat_fat_g)} g, fibre ${n0(t.fiber)} g, sugar ${n0(t.sugar)} g, sodium ${n0(t.micros.sodium_mg)} mg, water ${n1(t.water/1000)} L${H.sleep_min?`, slept ${fmtSleep(H.sleep_min)}`:''}${H.steps?`, ${n0(H.steps)} steps`:''}${d.weight_kg?`, weight ${n1(d.weight_kg)} kg`:''}; foods: ${(d.foods||[]).map(f=>f.name).slice(0,12).join(', ')||'none'}; training: ${[...(d.sports||[]).map(a=>`${actTitle(a)} ${n0(a.minutes||0)} min effort ${a.rpe||'?'}`), ...((d.exercises||[]).length?[`gym ${[...new Set(d.exercises.map(e=>e.muscle_group))].join('/')} ${d.exercises.reduce((s,e)=>s+(e.sets||[]).length,0)} sets`]:[])].join('; ')||'rest'}; supplements: ${(d.supplements||[]).map(x=>x.name).join(', ')||'none'}`); }
  // micronutrient gaps
  const rows=[]; for (let i=0;i<7;i++){ const d=S.days.get(addDays(localDate(),-i)); if (d&&(d.foods||[]).length) rows.push(dayTotals(d)); }
  const gaps = rows.length ? MICROS.filter(m=>m.kind!=='limit').map(m=>({m, p:rows.reduce((s,r)=>s+r.micros[m.key],0)/rows.length/(T.micros[m.key]||1)*100})).sort((a,b)=>a.p-b.p).slice(0,5).map(x=>`${x.m.label} ${Math.round(x.p)}%`).join(', ') : 'n/a';
  return {lines, gaps};
}
async function runReview(){
  if (!S.sample) return;
  S.revBusy=true; S.revStatus='Reviewing your week… this can take a minute.'; render();
  const p=prof(), T=targets(), {lines,gaps}=weekDigest(), rep=(S.reports||[])[0];
  const prompt = `You are a sports nutritionist and strength & conditioning coach in India reviewing one athlete's last 7 days.
Athlete: ${p.sex}, ${who(localDate()).age} y, ${p.height_cm} cm, ${n1(who(localDate()).kg)} kg (weight trend), goal ${(GOALS[p.goal]||{}).label}${p.goal!=='maintain'?` at ${p.goal_rate} kg/week`:''}.
${T.adaptive.ready?`Measured maintenance from their own logs: ${n0(T.adaptive.tdee)} kcal/day; weight trend ${n1(T.adaptive.kgPerWeek)} kg/week.`:''}
Daily targets (before training days' extra): ${T.kcal} kcal, protein ${T.protein} g, carbs ${T.carbs} g, fat ${T.fat} g, fibre ${T.fiber} g, water ${n1(T.water_ml/1000)} L, sleep 7-9 h, steps ${n0(p.steps_goal||10000)}.
Sports: ${Object.values(p.sports||{}).map(s=>`${s.name} (${(s.answers||[]).filter(a=>a.a).map(a=>a.a).join(', ')})`).join('; ')||'not set'}.
${rep?`Latest blood test (${rep.report_date}): ${rep.markers.filter(m=>m.status!=='normal').map(m=>`${m.name} ${m.value??m.value_text} ${m.unit} (${m.status})`).join(', ')||'all normal'}.`:'No blood test on file.'}
Lowest micronutrients this week (average % of target): ${gaps}.
Day by day:
${lines.join('\n')}
Reply with ONLY this JSON:
{"headline":"one sentence verdict on the week","going_well":["2-3 short points"],
"eating":[{"change":"what to change","why":"tied to their numbers","how":"specific Indian foods, amounts or swaps"}],
"training":[{"change":"","why":"","how":""}],
"recovery":[{"change":"","why":"","how":""}],
"sample_day":[{"meal":"Breakfast","foods":"specific foods with amounts","kcal":0,"protein_g":0}],
"focus":"the single most important thing for next week"}
Give 2-4 items for eating, 1-3 for training, 1-3 for recovery. The sample day must hit their calorie and protein targets and fix the biggest nutrient gaps, using everyday Indian food. If little was logged, say so in the headline and base advice on what exists.`;
  try {
    const res = await S.sample.json(prompt, {task:'review'});
    const L = x => (Array.isArray(x)?x:[]).slice(0,5).map(i=>({change:String(i.change||'').slice(0,200), why:String(i.why||'').slice(0,300), how:String(i.how||'').slice(0,400)}));
    const rev = {id:localDate(), date:localDate(), headline:String(res?.headline||'').slice(0,300), going_well:(Array.isArray(res?.going_well)?res.going_well:[]).slice(0,4).map(x=>String(x).slice(0,200)),
      eating:L(res?.eating), training:L(res?.training), recovery:L(res?.recovery), focus:String(res?.focus||'').slice(0,300),
      sample_day:(Array.isArray(res?.sample_day)?res.sample_day:[]).slice(0,7).map(m=>({meal:String(m.meal||'').slice(0,30), foods:String(m.foods||'').slice(0,300), kcal:num(m.kcal,3000), protein:num(m.protein_g,300)})), created:Date.now()};
    if (S.db) await S.db.doc('reviews/'+rev.id).set(rev);
    S.reviews = [rev, ...(S.reviews||[]).filter(r=>r.id!==rev.id)];
    S.revStatus='';
  } catch(e) { S.revStatus = AI_ERR[e?.code] || 'Couldn’t finish the review. Try again.'; }
  finally { S.revBusy=false; render(); }
}
function reviewPanel(){
  const r = (S.reviews||[])[0];
  const items = (l) => l.map(i=>`<li><b>${esc(i.change)}</b>${i.why?` <span class="muted">${esc(i.why)}</span>`:''}${i.how?`<div class="small">${esc(i.how)}</div>`:''}</li>`).join('');
  return `<section class="panel"><div class="panel-head"><h2>Coach review</h2>${r?`<span class="muted small">${esc(fmtDate(r.date,{day:'numeric',month:'short'}))}</span>`:''}</div>
    <div class="row"><button class="btn sm" data-action="review" ${S.revBusy||S.aiState==='off'?'disabled':''}>${S.revBusy?'Reviewing…':r?'Review my last 7 days again':'Review my last 7 days'}</button><span class="status" aria-live="polite">${esc(S.revStatus||'')}</span></div>
    ${r?`<div class="rev-head">${esc(r.headline)}</div>
      ${r.focus?`<div class="banner" style="border-left-color:var(--good)"><b>Focus next week:</b> ${esc(r.focus)}</div>`:''}
      ${r.going_well.length?`<h3>Going well</h3><ul class="tips">${r.going_well.map(x=>`<li>${esc(x)}</li>`).join('')}</ul>`:''}
      <div class="grid two">${[['Eating','eating'],['Training','training'],['Recovery','recovery']].map(([l,k])=>r[k].length?`<div><h3>${l}</h3><ul class="tips">${items(r[k])}</ul></div>`:'').join('')}</div>
      ${r.sample_day.length?`<h3>A day that fits your targets</h3><div class="tablewrap" tabindex="0"><table><tbody>${r.sample_day.map(m=>`<tr><td class="l"><b>${esc(m.meal)}</b></td><td class="l">${esc(m.foods)}</td><td class="r">${n0(m.kcal)} kcal</td><td class="r">${n0(m.protein)} g P</td></tr>`).join('')}
        <tr><td class="l"><b>Total</b></td><td></td><td class="r"><b>${n0(r.sample_day.reduce((s,m)=>s+m.kcal,0))}</b></td><td class="r"><b>${n0(r.sample_day.reduce((s,m)=>s+m.protein,0))} g</b></td></tr></tbody></table></div>`:''}`
      :'<div class="muted small">Looks at your food, nutrient gaps, sleep, training load, weight trend and any blood-test flags, then tells you what to change next week.</div>'}
  </section>`;
}

/* ---------- recent foods ---------- */
// The foods you log most often in the last 30 days (latest portion of each), most frequent first.
function recentFoods(){
  const seen=new Map();
  for (let i=0;i<30;i++){ const d=S.days.get(addDays(localDate(),-i)); if(!d) continue;
    (d.foods||[]).slice().reverse().forEach((f,j) => { const k=exKey(f.name)+'|'+exKey(f.quantity||f.grams); const e=seen.get(k);
      if (e) e.n++; else seen.set(k, {f, n:1, order:i*1000+j}); }); }
  return [...seen.values()].sort((a,b)=>b.n-a.n || a.order-b.order).slice(0,5).map(x=>x.f);
}

/* ---------- training load ---------- */
function dayLoad(d){
  if (!d) return 0; let l=0;
  for (const a of d.sports||[]) l += (a.minutes||0) * (a.rpe || 6);
  const sets = (d.exercises||[]).reduce((s,e)=>s+(e.sets||[]).length,0); if (sets) l += Math.min(120, sets*2.5+10) * 7;
  for (const e of d.exercises||[]) if (!(e.sets||[]).length && e.duration_min) l += e.duration_min*5;
  return l;
}
const dayBalls = d => (d?.sports||[]).reduce((s,a)=>s+((a.stats||{}).balls_bowled||a.balls_bowled||0),0);
function sumRange(fn, end, days){ let s=0; for (let i=0;i<days;i++) s+=fn(S.days.get(addDays(end,-i))); return s; }
function acwr(fn, end){ const acute=sumRange(fn,end,7), chronic=sumRange(fn,end,28)/4; return {acute, chronic, ratio: chronic>0 ? acute/chronic : null}; }
function acwrStatus(r){
  if (r===null) return {cls:'', label:'Not enough history', note:'Needs about 4 weeks of logging to compare this week with your usual load.'};
  if (r<0.8) return {cls:'warn', label:'Lower than usual', note:'Load is well below your 4-week average. Fine for a rest week; a long run of this loses fitness.'};
  if (r<=1.3) return {cls:'good', label:'In the sweet spot', note:'This week matches what your body is used to. Injury risk is lowest in this zone (0.8–1.3).'};
  if (r<=1.5) return {cls:'warn', label:'Climbing fast', note:'This week is noticeably above your usual. Hold here for a week before adding more.'};
  return {cls:'bad', label:'Spike: higher injury risk', note:'More than 1.5× your usual load. Spikes like this are linked to soft-tissue and back injuries, especially in fast bowlers. Ease off for a few days.'};
}
function loadPanel(){
  const end = S.date; const L = acwr(dayLoad, end); const st = acwrStatus(L.ratio);
  const weeks = Array.from({length:8},(_,i)=>{ const we=addDays(end,-7*(7-i)); return {date:addDays(we,-6), v:Math.round(sumRange(dayLoad, we, 7))}; });
  const B = acwr(dayBalls, end); const bst = acwrStatus(B.ratio);
  const hasBalls = sumRange(dayBalls, end, 56) > 0;
  return `<section class="panel" aria-label="Training load"><div class="panel-head"><h2>Training load</h2><span class="muted small">effort × minutes, all sport and gym</span></div>
    <div class="row"><span class="pill ${st.cls}">${esc(st.label)}</span><span class="small num">This week ${n0(L.acute)} · 4-week average ${n0(L.chronic)}${L.ratio!==null?` · ratio ${n1(L.ratio)}`:''}</span></div>
    <div class="small">${esc(st.note)}</div>
    ${barChart({rows:weeks, color:'var(--ink-2)', unit:'load', label:'Week load', wide:true})}
    ${hasBalls?`<h3>Bowling workload</h3><div class="row"><span class="pill ${bst.cls}">${esc(bst.label)}</span><span class="small num">${n0(B.acute)} balls this week (${n1(B.acute/6)} overs) · 4-week average ${n0(B.chronic)}${B.ratio!==null?` · ratio ${n1(B.ratio)}`:''}</span></div>
      <div class="muted small">Fast bowlers are most at risk of back stress injuries when weekly balls jump sharply. Build overs gradually and keep the ratio under 1.3.</div>`:''}
  </section>`;
}
function waterTarget(day, T){
  let min = (day.sports||[]).reduce((s,a)=>s+(a.minutes||0),0);
  const sets = (day.exercises||[]).reduce((s,e)=>s+(e.sets||[]).length,0); if (sets) min += sets*2.5+10;
  return T.water_ml + Math.round(min/60*500/250)*250;
}


/* ---------- next-session planner ---------- */
function trainingDigest(end, days=7){
  const lines=[];
  for (let i=days-1;i>=0;i--){ const date=addDays(end,-i); const d=S.days.get(date); const bits=[];
    if (d) {
      const ex = d.exercises||[];
      if (ex.length) bits.push(`gym (${[...new Set(ex.map(e=>e.muscle_group))].join(', ')}): ${ex.map(e=>`${e.name} ${(e.sets||[]).map(s=>s.weight>0?`${s.weight}x${s.reps}`:`${s.reps}`).join(',')}${e.duration_min?` ${e.duration_min} min`:''}`).join('; ')}`);
      for (const a of d.sports||[]) bits.push(`${actTitle(a)}: ${actLine(a)}${a.minutes?`, ${n0(a.minutes)} min`:''}${a.rpe?`, effort ${a.rpe}/10`:''}`);
      if (d.health&&d.health.sleep_min) bits.push(`slept ${fmtSleep(d.health.sleep_min)}`);
      if (d.health&&d.health.steps) bits.push(`${n0(d.health.steps)} steps`);
    }
    const pl = (S.plans||[]).find(p=>p.date===date);
    lines.push(`${date} (${fmtDate(date,{weekday:'short'})}): ${bits.join(' | ')||'rest / nothing logged'}${pl?` [had suggested: ${pl.focus}]`:''}`);
  }
  return lines.join('\n');
}
function lastLifts(){
  const cutoff = addDays(localDate(), -42);
  return [...buildSessions().values()].map(e=>({e, last:e.sessions[e.sessions.length-1]})).filter(x=>x.last.date>=cutoff)
    .sort((a,b)=>b.last.date.localeCompare(a.last.date)).slice(0,30)
    .map(x=>`${x.e.name} (${x.e.group}) last ${x.last.date}: ${x.last.sets.map(s=>s.weight>0?`${s.weight}x${s.reps}`:`${s.reps}`).join(', ')}${x.last.bodyweight?'':`, best est. 1RM ${n1(Math.max(...x.e.sessions.map(s=>s.best)))} kg`}`).join('\n');
}
/* An exercise's "standard": what this person did last time (their top working
   weight, its reps and how many sets), or what they last set in a plan, whichever
   is newer. New plans start from it. */
function exStandard(name){
  const key = exKey(name);
  const e = buildSessions().get(key); const last = e && e.sessions[e.sessions.length-1];
  let fromLog = null;
  if (last) {
    const top = last.top, work = last.sets.filter(x => top>0 ? (x.weight||0) >= top*0.9 : true);
    const counts = {}; for (const x of work) counts[x.reps] = (counts[x.reps]||0)+1;
    const reps = +Object.entries(counts).sort((a,b)=>b[1]-a[1] || b[0]-a[0])[0][0];
    fromLog = {sets:work.length, reps:String(reps), kg:top>0?top:0, date:last.date, from:'log', sets_text:last.sets.map(x=>x.weight>0?`${n1(x.weight)}×${x.reps}`:`${x.reps}`).join(', ')};
  }
  const saved = (prof().ex_std||{})[key];
  if (saved && (!fromLog || saved.date >= fromLog.date)) return {...saved, from:'plan', sets_text:fromLog?.sets_text||''};
  return fromLog;
}
function saveStandard(name, sets, reps, kg){
  const p = prof(); const std = {...(p.ex_std||{})};
  std[exKey(name)] = {sets:sets||null, reps:String(reps||''), kg:kg>0?kg:0, date:localDate()};
  // Keep the 150 most recent.
  const keep = Object.entries(std).sort((a,b)=>b[1].date.localeCompare(a[1].date)).slice(0,150);
  saveProfile({...p, ex_std:Object.fromEntries(keep)});
}
const planKg = e => e.kg>0 ? e.kg : +((String(e.weight||'').match(/(\d+(?:\.\d+)?)\s*kg/i)||[])[1]||0);
async function savePlan(plan){
  plan.edited = Date.now();
  S.plans = [plan, ...(S.plans||[]).filter(x=>x.id!==plan.id)].sort((a,b)=>b.date.localeCompare(a.date)); render();
  if (S.db) await S.db.doc('plans/'+plan.id).set(plan);
}
function openPlanEx(i){
  const plan = (S.plans||[]).find(p=>p.date>=localDate()); if (!plan) return;
  const isNew = i < 0; const e = isNew ? {name:'', sets:3, reps:'10', weight:'', kg:0, rest:'90 s', note:''} : plan.exercises[i]; if (!e) return;
  const d = $('#dlg');
  const render1 = () => {
    const st = e.name ? exStandard(e.name) : null;
    return st ? `Last time: ${esc(st.sets_text || `${st.sets} × ${st.reps}${st.kg?` @ ${n1(st.kg)} kg`:''}`)}${st.from==='plan'?` · your standard ${st.sets||'?'} × ${esc(st.reps)}${st.kg?` @ ${n1(st.kg)} kg`:''}`:''}` : '';
  };
  d.innerHTML = `<form class="form" id="peForm" style="gap:12px"><h2 class="full">${isNew?'Add an exercise':'Edit exercise'}</h2>
    <label class="field full">Exercise<input id="pe_name" value="${esc(e.name)}" autocomplete="off" placeholder="e.g. incline dumbbell press" required></label>
    <div class="full exres" id="pe_sug" style="max-height:160px"></div>
    <label class="field">Sets<input id="pe_sets" type="number" min="1" max="20" step="1" inputmode="numeric" value="${esc(e.sets||'')}"></label>
    <label class="field">Reps<input id="pe_reps" value="${esc(e.reps||'')}" placeholder="8 or 8-10"></label>
    <label class="field">Weight (kg)<input id="pe_kg" type="number" min="0" max="500" step="0.5" inputmode="decimal" value="${esc(planKg(e)||'')}" placeholder="0 = bodyweight"></label>
    <label class="field">Rest<input id="pe_rest" value="${esc(e.rest||'')}" placeholder="90 s"></label>
    <div class="full muted small" id="pe_last">${render1()}</div>
    <label class="check full"><input type="checkbox" id="pe_std" checked> Make this my standard for ${e.name?esc(e.name):'this exercise'} in future plans</label>
    <div class="full row">${isNew?'':'<button class="btn ghost sm" type="button" id="pe_del">Remove</button>'}<span class="spacer"></span><button class="btn ghost" type="button" id="pe_cancel">Cancel</button><button class="btn" type="submit">Save</button></div></form>`;
  d.showModal();
  const nameIn = $('#pe_name');
  const fill = () => { const st = nameIn.value.trim() && exStandard(nameIn.value.trim()); $('#pe_last').innerHTML = (e.name=nameIn.value.trim(), render1());
    if (st && isNew && !$('#pe_kg').value) { $('#pe_sets').value = st.sets||3; $('#pe_reps').value = st.reps||'10'; if (st.kg) $('#pe_kg').value = st.kg; } };
  nameIn.addEventListener('input', () => { const q = nameIn.value; $('#pe_sug').innerHTML = q.trim().length<2 ? '' : Gym.search(q, 6).map(x=>`<button type="button" class="exrow" data-n="${esc(x.name)}"><span>${esc(x.name)}</span><span class="tag">${esc(x.group)}</span></button>`).join(''); });
  nameIn.addEventListener('change', fill);
  $('#pe_sug').addEventListener('click', ev => { const b = ev.target.closest('[data-n]'); if (!b) return; nameIn.value = b.dataset.n; $('#pe_sug').innerHTML=''; fill(); });
  $('#pe_cancel').onclick = () => d.close();
  if (!isNew) $('#pe_del').onclick = async () => { plan.exercises.splice(i,1); d.close(); await savePlan(plan); toast(`Removed ${e.name} from the plan`); };
  $('#peForm').onsubmit = async ev => { ev.preventDefault();
    const name = titleCase(nameIn.value).slice(0,60); if (!name) return;
    const sets = Math.round(num($('#pe_sets').value,20))||null, reps = String($('#pe_reps').value||'').trim().slice(0,20), kg = Math.round(num($('#pe_kg').value,500)*100)/100;
    const x = {...(isNew?{}:plan.exercises[i]), name, sets, reps, kg, weight: kg>0 ? `${n1(kg)} kg` : 'bodyweight', rest:String($('#pe_rest').value||'').slice(0,20), edited:true};
    if (!isNew && x.name!==e.name) x.note = '';
    if (isNew) plan.exercises.push(x); else plan.exercises[i] = x;
    if ($('#pe_std').checked) saveStandard(name, sets, reps, kg);
    d.close(); await savePlan(plan);
  };
}
function stdLines(){
  const names = new Set([...Object.keys(prof().ex_std||{}), ...[...buildSessions().keys()]]);
  const out = []; for (const k of names) { const st = exStandard(k); if (!st) continue; const nm = buildSessions().get(k)?.name || titleCase(k);
    if (st.date >= addDays(localDate(), -60)) out.push(`${nm}: ${st.sets||'?'} x ${st.reps}${st.kg?` @ ${n1(st.kg)} kg`:' bodyweight'} (${st.from==='plan'?'set by them':'last done'} ${st.date})`); }
  return out.slice(0,40).join('\n');
}
// Keep the plan honest to the standard: a weight far from it (over 10% either way) goes back to it.
function withStandard(e){
  if (!e.name) return e; const st = exStandard(e.name); e.kg = planKg(e);
  if (st && st.kg > 0 && (!(e.kg > 0) || Math.abs(e.kg - st.kg) / st.kg > 0.1)) { e.kg = st.kg; e.weight = `${n1(st.kg)} kg (your standard)`; e.sets = st.sets || e.sets; e.reps = st.reps || e.reps; }
  return e;
}
function planTargetDate(){
  const today = localDate(), d = S.days.get(today);
  const trained = d && ((d.exercises||[]).length || (d.sports||[]).length);
  return (trained || new Date().getHours() >= 21) ? addDays(today,1) : today;
}
async function runPlan(){
  if (!S.sample) return;
  const p = prof(); const forDate = S.planFor || planTargetDate(); const note = ($('#planNote')?.value||S.planNote||'').trim();
  S.planNote = note; S.planBusy=true; S.planStatus='Planning your next session…'; render();
  const rec = latestRecovery();
  const prompt = `You are a strength and conditioning coach for an amateur athlete in India who does gym training and plays sport. Plan their session for ${forDate} (${fmtDate(forDate,{weekday:'long'})}).
Athlete: ${p.sex}, ${who(localDate()).age} y, ${n1(who(localDate()).kg)} kg, goal ${(GOALS[p.goal]||{}).label}.
How they train and play:
${Object.values(p.sports||{}).map(s=>`${s.name}: ${(s.answers||[]).filter(a=>a.a).map(a=>`${a.q} ${a.a}`).join('; ')}`).join('\n')||'No sport profile set.'}
What they actually did in the last 7 days (their real logs; where a day shows [had suggested: …] you suggested that, and if the log differs they chose something else, so plan from what they really did):
${trainingDigest(localDate(), 7)}
Latest recovery estimate: ${rec?`${rec.label}, ${rec.recovering?`recovering until ${new Date(rec.t).toISOString().slice(0,16)}`:'recovered'}`:'none'}.
Recent lifts (use these to set weights and progress them):
${lastLifts()||'No lifts logged yet.'}
${stdLines()?`Their standards (what they did or set last time; start each of these exercises from it, and only add weight when every set of the standard was completed last time, by the smallest step: 2.5 kg, or 1 kg for dumbbells):\n${stdLines()}`:''}
${note?`What they told you about their plans: "${note}"`:''}
Decide the best session for that day: which muscle groups are recovered (about 48 h for a trained muscle group, 72 h after a very hard or high-volume session), balance across the week (push, pull, legs, core), their sport load (after fast bowling or a match, protect the lower back, hamstrings and shoulders and avoid heavy legs the next day; before a match or nets keep legs fresh), sleep, and their split and goal. A rest or mobility day is a valid answer when it is the right call.
Reply with ONLY this JSON:
{"focus":"Pull + core","type":"gym","muscles":["back","biceps","core"],"readiness":"good","why":"2-3 sentences tied to what they did on specific days",
"warmup":"one line","exercises":[{"name":"Barbell Row","sets":4,"reps":"8","weight":"60 kg (you did 57.5x8 last time)","rest":"90 s","note":"short cue"}],
"finisher":"optional conditioning or mobility, one line","duration_min":60,
"if_short_on_time":"a 30-minute version in one line","avoid":["what not to do today and why, short"],"next":"one line on what should likely follow on the next day"}
type is one of gym, sport-skill, conditioning, mobility, rest. readiness is good, moderate or low. Give 4-7 exercises for a gym day (fewer for others), with weights based on their recent lifts.`;
  try {
    const res = await S.sample.json(prompt, {task:'plan'});
    const plan = {id:forDate, date:forDate, focus:String(res?.focus||'Session').slice(0,60), type:String(res?.type||'gym').slice(0,20),
      muscles:(Array.isArray(res?.muscles)?res.muscles:[]).slice(0,8).map(x=>String(x).toLowerCase().slice(0,20)), readiness:['good','moderate','low'].includes(res?.readiness)?res.readiness:'moderate',
      why:String(res?.why||'').slice(0,500), warmup:String(res?.warmup||'').slice(0,200),
      exercises:(Array.isArray(res?.exercises)?res.exercises:[]).slice(0,10).map(e=>withStandard({name:String(e.name||'').slice(0,60), sets:Math.round(num(e.sets,20))||null, reps:String(e.reps??'').slice(0,20), weight:String(e.weight||'').slice(0,80), rest:String(e.rest||'').slice(0,20), note:String(e.note||'').slice(0,120)})).filter(e=>e.name),
      finisher:String(res?.finisher||'').slice(0,200), duration:num(res?.duration_min,300)||null, short:String(res?.if_short_on_time||'').slice(0,300),
      avoid:(Array.isArray(res?.avoid)?res.avoid:[]).slice(0,4).map(x=>String(x).slice(0,160)), next:String(res?.next||'').slice(0,200), note, created:Date.now()};
    if (S.db) await S.db.doc('plans/'+plan.id).set(plan);
    S.plans = [plan, ...(S.plans||[]).filter(x=>x.id!==plan.id)].sort((a,b)=>b.date.localeCompare(a.date));
    S.planStatus=''; S.planFor=null;
  } catch(e) { S.planStatus = AI_ERR[e?.code] || 'Couldn’t plan the session. Try again.'; }
  finally { S.planBusy=false; render(); }
}
function planFollow(plan){
  const d = S.days.get(plan.date); if (!d) return null;
  const did = new Set((d.exercises||[]).map(e=>e.muscle_group)); const sports = (d.sports||[]).map(a=>actTitle(a));
  if (!did.size && !sports.length) return null;
  const hit = plan.muscles.filter(m=>did.has(m) || [...did].some(x=>x.includes(m)||m.includes(x)));
  if (plan.type==='rest' || plan.type==='mobility') return {ok:false, text:`You trained ${[...did, ...sports].join(', ')} instead of resting. The next plan will account for it.`};
  if (hit.length) return {ok:true, text:'Done as planned.'};
  return {ok:false, text:`You did ${[...did, ...sports].join(', ')} instead. Plan the next session and it will adjust.`};
}
function planCard(compact){
  const today = localDate();
  const plan = (S.plans||[]).find(p=>p.date>=today) || null;
  const last = (S.plans||[]).find(p=>p.date<=today);
  const f = last ? planFollow(last) : null;
  const forDate = S.planFor || planTargetDate();
  const head = `<div class="panel-head"><h2>Next session</h2>${plan?`<span class="muted small">${esc(plan.date===today?'Today':fmtDate(plan.date,{weekday:'long'}))}</span>`:''}</div>`;
  const controls = `<div class="row"><input id="planNote" type="text" placeholder="Anything coming up? e.g. match on Sunday, nets tomorrow" value="${esc(S.planNote||'')}" style="flex:1 1 100%;min-width:0;border:1px solid var(--line);border-radius:8px;background:var(--bg);padding:8px 10px">
      <div class="seg" role="group" aria-label="Plan for"><button data-action="planFor" data-d="${today}" aria-pressed="${forDate===today}">Today</button><button data-action="planFor" data-d="${addDays(today,1)}" aria-pressed="${forDate!==today}">Tomorrow</button></div>
      <button class="btn sm" data-action="plan" ${S.planBusy||S.aiState==='off'?'disabled':''}>${S.planBusy?'Planning…':plan?'Plan again':'Plan my next session'}</button></div>
    ${S.planStatus?`<div class="status${/Couldn/.test(S.planStatus)?' err':''}">${esc(S.planStatus)}</div>`:''}`;
  let body = '';
  if (f && last && last !== plan) body += `<div class="banner" style="border-left-color:var(--${f.ok?'good':'warn'})">${esc(fmtDate(last.date,{weekday:'short'}))}: suggested ${esc(last.focus)}. ${esc(f.text)}</div>`;
  if (plan) {
    const pf = plan.date===today ? planFollow(plan) : null;
    body += `<div class="plan-h"><div class="rev-head">${esc(plan.focus)}</div><span class="pill ${plan.readiness==='good'?'good':plan.readiness==='low'?'bad':'warn'}">readiness ${esc(plan.readiness)}</span>${plan.duration?`<span class="muted small">~${n0(plan.duration)} min</span>`:''}${pf?`<span class="pill ${pf.ok?'good':'warn'}">${pf.ok?'done':'changed'}</span>`:''}</div>
      <div class="small">${esc(plan.why)}</div>`;
    if (compact) body += plan.exercises.length ? `<div class="small muted">${esc(plan.exercises.map(e=>e.name).join(' · '))}</div><button class="linkbtn" data-action="goto" data-view="gym" style="align-self:flex-start;padding-left:0">See the full session in Train</button>` : '';
    else {
      if (plan.warmup) body += `<div class="small"><b>Warm-up:</b> ${esc(plan.warmup)}</div>`;
      body += `<div class="tablewrap" tabindex="0"><table class="plantable"><thead><tr><th class="l">Exercise</th><th class="r">Sets × reps</th><th class="l">Weight</th><th><span class="sr">Edit</span></th></tr></thead><tbody>
        ${plan.exercises.map((e,i)=>`<tr class="exrow1"><td class="l"><b>${esc(e.name)}</b>${e.edited?' <span class="tag">edited</span>':''}</td><td class="r">${e.sets?e.sets+' × ':''}${esc(e.reps)}</td><td class="l">${planKg(e)>0 ? `${n1(planKg(e))} kg` : /body/i.test(e.weight||'') ? 'bodyweight' : esc(e.weight)}</td><td class="r"><button class="editbtn" data-action="planEx" data-i="${i}" aria-label="Edit ${esc(e.name)}">✎</button></td></tr><tr class="howrow"><td colspan="4">${howtoFold(e.name)}</td></tr>`).join('')}</tbody></table></div>
        <div class="row"><button class="btn ghost sm" data-action="planEx" data-i="-1">+ Add exercise</button><span class="muted small">Your edits become the starting point for future plans.</span></div>`;
      if (plan.finisher) body += `<div class="small"><b>Finish with:</b> ${esc(plan.finisher)}</div>`;
      if (plan.short) body += `<div class="small"><b>Short on time:</b> ${esc(plan.short)}</div>`;
      if (plan.avoid.length) body += `<div><h3>Avoid today</h3><ul class="tips">${plan.avoid.map(x=>`<li>${esc(x)}</li>`).join('')}</ul></div>`;
      if (plan.next) body += `<div class="muted small"><b>After this:</b> ${esc(plan.next)}</div>`;
      if (plan.exercises.length) body += `<div class="row"><button class="btn ghost sm" data-action="planToLog">I did this, put it in the log box</button></div>`;
    }
  } else body += `<div class="muted small">Looks at what you actually did over the last 7 days (gym, nets, matches, badminton), how recovered you are, your sleep and your recent weights, then plans the session: what to train, exercises, sets, reps and target weights. If you do something else instead, the next plan adjusts to it.</div>`;
  return `<section class="panel${compact?'':' span2'}" aria-label="Next session">${head}${body}${compact?'':controls}${compact&&!plan?controls:''}</section>`;
}

function latestWeightDate(){ let d=''; for (const [k,v] of S.days) if (v.weight_kg && k>d) d=k; return d; }
function setStatus(msg, err=false){ S.status=msg; S.statusErr=err; const el=$('#logStatus'); if (el){ el.textContent=msg; el.classList.toggle('err',err);} }
function clearPhoto(){ if (S.photoUrl) URL.revokeObjectURL(S.photoUrl); S.photo=null; S.photoUrl=null; }

/* ---------- rest timer (after logging sets) ---------- */
let restT = null;
const restOn = () => prof().rest_timer !== false;
function startRest(sec){
  if (!restOn()) return;
  sec = sec || Number(prof().rest_default) || 90;
  S.rest = {end: Date.now() + sec*1000, total: sec}; tickRest();
}
function stopRest(){ S.rest = null; clearInterval(restT); restT = null; const el = $('#restbar'); if (el) el.hidden = true; document.body.classList.remove('resting'); }
function tickRest(){
  const el = $('#restbar'); if (!el || !S.rest) return;
  clearInterval(restT);
  const draw = () => {
    if (!S.rest) return;
    const left = Math.max(0, Math.round((S.rest.end - Date.now())/1000));
    el.hidden = false; document.body.classList.add('resting');
    el.innerHTML = left > 0
      ? `<span class="rt" aria-live="off">Rest <b>${Math.floor(left/60)}:${pad(left%60)}</b></span><span class="rtbar"><i style="width:${(1-left/S.rest.total)*100}%"></i></span>${[60,90,120].map(v=>`<button data-action="restSet" data-s="${v}" aria-label="Rest ${v} seconds">${v}s</button>`).join('')}<button data-action="restStop" aria-label="Stop the rest timer">✕</button>`
      : `<span class="rt" role="status"><b>Rest over</b>: next set!</span><span class="spacer"></span><button data-action="restStop">OK</button>`;
    if (left <= 0) { clearInterval(restT); restT = null; restDone(); }
  };
  draw(); restT = setInterval(draw, 500);
}
function restDone(){
  if (navigator.vibrate) navigator.vibrate([250,120,250]);
  try { const ctx = new (window.AudioContext||window.webkitAudioContext)(); const o = ctx.createOscillator(), g = ctx.createGain();
    o.frequency.value = 880; g.gain.setValueAtTime(0.15, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6);
    o.connect(g); g.connect(ctx.destination); o.start(); o.stop(ctx.currentTime + 0.6); } catch {}
  setTimeout(() => { if (S.rest && Date.now() >= S.rest.end) stopRest(); }, 15000);
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState==='visible' && S.rest) tickRest(); });
function workoutFold(){
  const p = prof();
  return `<label class="check"><input type="checkbox" data-action="restToggle" ${restOn()?'checked':''}> Show a rest timer after I log sets</label>
    <label class="field">Default rest<select data-action="restDefault">${[45,60,90,120,150,180].map(v=>`<option value="${v}" ${Number(p.rest_default||90)===v?'selected':''}>${v<60?v+' s':`${Math.floor(v/60)}:${pad(v%60)} min`}</option>`).join('')}</select></label>
    <div class="muted small">It counts down at the bottom of the screen and buzzes (and beeps) when rest is over. Tap 60s / 90s / 120s to change it for that set.</div>`;
}

/* ---------- UI bits ---------- */
let toastTimer;
function toast(msg, undo){
  const t=$('#toast'); t.innerHTML = `<span>${esc(msg)}</span>` + (undo?'<button id="undoBtn">Undo</button>':'');
  t.hidden=false; clearTimeout(toastTimer);
  if (undo) $('#undoBtn').onclick = () => { t.hidden=true; undo(); };
  toastTimer = setTimeout(()=>{t.hidden=true;}, 6000);
}
const pct = (v,t) => t>0 ? Math.min(100, v/t*100) : 0;
function meter(v,t,color,limit=false){
  const over = limit ? v>t : false;
  return `<div class="meter${over?' over':''}" role="img" aria-label="${n0(v)} of ${n0(t)}"><i style="width:${pct(v,t)}%;${over?'':`background:${color}`}"></i></div>`;
}
function delta(cur, prev, unit=''){
  if (!prev) return cur ? '<span class="delta flat">new this period</span>' : '<span class="delta flat">&nbsp;</span>';
  const ch = (cur-prev)/prev*100;
  const cls = Math.abs(ch)<0.5?'flat':ch>0?'up':'down';
  return `<span class="delta ${cls}">${ch>0?'+':''}${n1(ch)}%${unit}</span>`;
}

/* ---------- charts ---------- */
function chartW(wide){ const vw=(window.innerWidth||640)-64; return Math.round(Math.max(320, Math.min(wide?1000:560, vw))); }
function niceMax(v){ if (v<=0) return 1; const p=10**Math.floor(Math.log10(v)); const m=v/p; return (m<=1?1:m<=2?2:m<=2.5?2.5:m<=5?5:10)*p; }
function barChart({rows, target, color, unit, label, wide}){
  const W=chartW(wide),H=200,m={l:44,r:12,t:16,b:26};
  const iw=W-m.l-m.r, ih=H-m.t-m.b;
  const max = niceMax(Math.max(target||0, ...rows.map(r=>r.v))*1.08);
  const y = v => m.t + ih*(1-v/max);
  const bw = iw/rows.length; const gap = Math.min(2, bw*0.2); const w = Math.max(1, bw-gap);
  let g = '';
  for (const t of [0, max/2, max]) g += `<line class="grid-l" x1="${m.l}" x2="${W-m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l-6}" y="${y(t)+4}" text-anchor="end">${n0(t)}</text>`;
  let bars='';
  rows.forEach((r,i) => {
    const x = m.l + i*bw + gap/2; const yv=y(r.v); const h = m.t+ih-yv;
    if (h>0.5) { const rr=Math.min(4,w/2,h); bars += `<path fill="${color}" d="M${x},${m.t+ih} V${yv+rr} Q${x},${yv} ${x+rr},${yv} H${x+w-rr} Q${x+w},${yv} ${x+w},${yv+rr} V${m.t+ih} Z"/>`; }
    bars += `<rect x="${m.l+i*bw}" y="${m.t}" width="${bw}" height="${ih}" fill="transparent" data-tip="${esc(fmtDate(r.date)+'\n'+label+': '+n0(r.v)+' '+unit+(target?'\nTarget: '+n0(target)+' '+unit:''))}"/>`;
  });
  const idx = [0, Math.floor((rows.length-1)/2), rows.length-1];
  let xl=''; [...new Set(idx)].forEach(i => { const anchor = i===0?'start':i===rows.length-1?'end':'middle'; const x = i===0?m.l: i===rows.length-1? W-m.r : m.l+i*bw+bw/2; xl += `<text x="${x}" y="${H-8}" text-anchor="${anchor}">${esc(fmtDate(rows[i].date,{day:'numeric',month:'short'}))}</text>`; });
  let ref='';
  if (target) ref = `<line class="ref" x1="${m.l}" x2="${W-m.r}" y1="${y(target)}" y2="${y(target)}"/><text class="ref-t" x="${W-m.r}" y="${y(target)-5}" text-anchor="end">Target ${n0(target)}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(label)} per day">${g}${bars}${ref}${xl}</svg>`;
}
function lineChart({pts, unit, color, wide}){
  const W=chartW(wide),H=220,m={l:44,r:40,t:20,b:26}; const iw=W-m.l-m.r, ih=H-m.t-m.b;
  const vals = pts.flatMap(p=>p.raw!=null?[p.v,p.raw]:[p.v]); let lo=Math.min(...vals), hi=Math.max(...vals);
  if (hi===lo){ hi+=Math.max(1,hi*0.05); lo=Math.max(0,lo-Math.max(1,lo*0.05)); }
  const padv=(hi-lo)*0.12; lo=Math.max(0,lo-padv); hi=hi+padv;
  const x = i => pts.length===1 ? m.l+iw/2 : m.l + iw*i/(pts.length-1);
  const y = v => m.t + ih*(1-(v-lo)/(hi-lo));
  let g=''; for (const t of [lo,(lo+hi)/2,hi]) g+=`<line class="grid-l" x1="${m.l}" x2="${W-m.r}" y1="${y(t)}" y2="${y(t)}"/><text x="${m.l-6}" y="${y(t)+4}" text-anchor="end">${n1(t)}</text>`;
  const d = pts.map((p,i)=>`${i?'L':'M'}${x(i)},${y(p.v)}`).join(' ');
  const area = pts.length>1 ? `<path d="${d} L${x(pts.length-1)},${m.t+ih} L${x(0)},${m.t+ih} Z" fill="${color}" opacity=".10"/>` : '';
  let dots=''; pts.forEach((p,i)=>{ const last=i===pts.length-1; if (p.raw!=null) dots+=`<circle cx="${x(i)}" cy="${y(p.raw)}" r="3" fill="var(--ink-3)"/>`; dots+=`<circle cx="${x(i)}" cy="${y(p.v)}" r="${last?5:3.5}" fill="${last?color:'var(--surface)'}" stroke="${color}" stroke-width="2"/>`;
    dots+=`<rect x="${x(i)-Math.max(8,iw/pts.length/2)}" y="${m.t}" width="${Math.max(16,iw/pts.length)}" height="${ih}" fill="transparent" data-tip="${esc(fmtDate(p.date)+'\n'+p.tip)}"/>`; });
  const lp=pts[pts.length-1];
  const endLbl = `<text x="${Math.min(x(pts.length-1)+8,W-4)}" y="${y(lp.v)-9}" text-anchor="end" style="fill:var(--ink);font-weight:700">${n1(lp.v)} ${unit}</text>`;
  let xl=`<text x="${x(0)}" y="${H-8}" text-anchor="${pts.length===1?'middle':'start'}">${esc(fmtDate(pts[0].date,{day:'numeric',month:'short'}))}</text>`;
  if (pts.length>1) xl+=`<text x="${x(pts.length-1)}" y="${H-8}" text-anchor="end">${esc(fmtDate(lp.date,{day:'numeric',month:'short'}))}</text>`;
  return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Progress chart">${g}${area}<path d="${d}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>${dots}${endLbl}${xl}</svg>`;
}

/* ---------- views ---------- */
function loggerHtml(kind){
  const ph = kind==='gym' ? 'e.g. bench 60kg 3x8, lat pulldown 50x12 x10 x10 · badminton doubles 1 hr · cricket nets 90 min, bowled 6 overs, faced 40 balls' : 'e.g. 150g chicken breast, 200g cooked rice, 1 tbsp ghee · 500ml water · bench 60kg 3x8';
  if (S.aiState==='off') return `<div class="banner">AI isn’t set up for this app yet, so typed entries only log foods from the food table. Water, editing and everything else work. See SETUP.md to connect one.</div>`;
  return `<section class="panel logger span2" aria-label="Log an entry">
    <div class="panel-head"><h2>${kind==='gym'?'Log training':'Log food &amp; training'}</h2><span class="muted small">${esc(fmtDate(S.date,{weekday:'long',day:'numeric',month:'long'}))}</span></div>
    ${queueCard()}
    <textarea id="logText" placeholder="${esc(ph)}" ${S.busy?'disabled':''}></textarea>
    <div class="row">
      ${S.canPhoto && kind!=='gym' ? `<button class="btn ghost sm" data-action="pickPhoto" ${S.busy?'disabled':''}>Add photo</button>` : ''}
      ${kind!=='gym' ? `<button class="btn ghost sm" data-action="foodSearch" ${S.busy?'disabled':''}>Find food</button><button class="btn ghost sm" data-action="scan" ${S.busy?'disabled':''} aria-label="Scan a barcode">Scan</button>` : ''}
      ${S.photo ? `<span class="photo-pill"><img src="${S.photoUrl}" alt="Selected food photo">${esc(S.photo.name||'photo')}<button class="linkbtn" data-action="clearPhoto" aria-label="Remove photo">Remove</button></span>`:''}
      <span class="spacer"></span>
      ${S.busy ? `<button class="btn ghost sm" data-action="stop">Stop</button>` : ''}
      <button class="btn" data-action="log" ${S.busy?'disabled':''}>${S.busy?'Working…':'Log'}</button>
    </div>
    <div class="status${S.statusErr?' err':''}" id="logStatus" aria-live="polite">${esc(S.status)}</div>
    ${kind!=='gym'&&recentFoods().length?fold('d-quick', 'Quick add', `${recentFoods().length} foods you eat often`, `<div class="chips" aria-label="Frequent foods">${recentFoods().map(f=>`<button class="chip" style="border-style:solid" data-action="relog" data-id="${f.id}">${esc(f.name)}${f.quantity?' · '+esc(f.quantity):''}</button>`).join('')}</div>`, 'inline'):''}
    ${kind==='gym'||!recentFoods().length?`<div class="chips" aria-label="Examples"><span class="muted small" style="align-self:center">Try:</span>${(kind==='gym'?EXAMPLES.slice(5):EXAMPLES.slice(0,6)).map(x=>`<button class="chip" data-action="example" data-text="${esc(x)}">${esc(x)}</button>`).join('')}</div>`:''}
  </section>`;
}
function healthPanel(H){
  const p = prof(); const goal = Number(p.steps_goal)||10000;
  if (!H.steps && !H.sleep_min && !H.active_kcal && !H.resting_kcal) return `<div class="empty">No Health data for this day yet. Type something like “slept 6h 50m, 8400 steps”, add a screenshot of the Health app, or <button class="linkbtn" data-action="goto" data-view="profile">set up automatic sync</button> (iPhone).</div>`;
  const v = H.sleep_min ? sleepVerdict(H.sleep_min, who(S.date).age) : null;
  return `<div class="hgrid">
    <div><div class="l">Sleep</div><div class="big" style="font-size:36px">${H.sleep_min?fmtSleep(H.sleep_min):'—'}</div>
      ${v?`<span class="pill ${v.cls}">${v.label}</span>`:''}${H.bed_time&&H.wake_time?` <span class="muted small">${H.bed_time}–${H.wake_time}</span>`:''}</div>
    <div><div class="l">Steps</div><div class="big" style="font-size:36px">${H.steps?n0(H.steps):'—'}</div>
      ${H.steps?`${meter(H.steps,goal,'var(--water)')}<span class="muted small">${Math.round(H.steps/goal*100)}% of ${n0(goal)}</span>`:''}</div>
  </div>
  ${v?`<div class="small">${esc(v.note)}</div>`:''}
  ${(()=>{ const xs=[]; for(let i=0;i<7;i++){ const d=S.days.get(addDays(S.date,-i)); if(d&&d.health&&d.health.sleep_min) xs.push(d.health.sleep_min); }
     return xs.length>=3 ? `<div class="muted small">7-night average: <b>${fmtSleep(xs.reduce((a,b)=>a+b,0)/xs.length)}</b> over ${xs.length} nights logged.</div>` : ''; })()}
  ${(H.active_kcal||H.resting_kcal)?`<div class="kv"><span>Active energy</span><b>${H.active_kcal?n0(H.active_kcal)+' kcal':'—'}</b><span>Resting energy</span><b>${H.resting_kcal?n0(H.resting_kcal)+' kcal':'—'}</b></div>
  <div class="muted small">Gym sessions count in active energy only if your Apple Watch recorded them.</div>`:''}`;
}
function sportList(day){
  const a = day.sports||[];
  if (!a.length) return `<div class="empty">No sport logged. Try “cricket nets 90 min, bowled 6 overs pace, faced 40 balls” or “badminton doubles 1 hr”.</div>`;
  return a.map(x=>`<div class="item"><div><div class="nm">${esc(sportTitle(x))}</div><div class="sub">${esc(sportLine(x))}</div></div>
    <div class="kc">${n0(x.kcal)}<span class="muted small"> kcal</span></div>
    <div class="acts"><button data-action="editSport" data-id="${x.id}" aria-label="Edit ${esc(sportTitle(x))}">Edit</button><button data-action="delSport" data-id="${x.id}" aria-label="Delete ${esc(sportTitle(x))}">✕</button></div></div>`).join('');
}
function exerciseList(day){
  const ex = day.exercises||[];
  if (!ex.length) return `<div class="empty">No training logged. Try “squat 80x5, 85x5, 90x3”.</div>`;
  const prs = prsOn(day.date); const seenPr = new Set();
  const prTag = e => { const k = exKey(e.name), pr = prs.get(k); if (!pr || seenPr.has(k)) return ''; seenPr.add(k); return ` <span class="prbadge" title="${esc('New personal record: '+pr.text)}">PR</span>`; };
  return ex.map(e=>`<div class="item"><div><div class="nm">${esc(e.name)}${prTag(e)} <span class="tag">${esc(e.muscle_group)}</span></div>
    <div class="sub">${(e.sets||[]).length ? e.sets.map(s=>s.weight>0?`${n1(s.weight)} × ${s.reps}`:`${s.reps} reps`).join(' · ') : ''}${e.duration_min?`${(e.sets||[]).length?' · ':''}${n0(e.duration_min)} min`:''}</div></div>
    <div class="kc">${n0(e.kcal)}<span class="muted small"> kcal</span></div>
    <div class="acts"><button data-action="editEx" data-id="${e.id}" aria-label="Edit ${esc(e.name)}">Edit</button><button data-action="delEx" data-id="${e.id}" aria-label="Delete ${esc(e.name)}">✕</button></div>
    <div class="howwrap">${howtoFold(e.name)}</div></div>`).join('');
}
function sportSummary(a,b,label){
  const names = [...new Set([...Object.keys(a.sp), ...Object.keys(b.sp)])];
  if (!names.length) return `<section class="panel" aria-label="Sport"><div class="panel-head"><h2>Sport</h2></div><div class="empty">No badminton or cricket logged in this period or ${esc(label)}. Log a session above, e.g. “badminton singles 45 min”.</div></section>`;
  const hm = m => m>=60 ? `${Math.floor(m/60)}h ${pad(Math.round(m%60))}m` : `${Math.round(m)} min`;
  return `<section class="panel" aria-label="Sport"><div class="panel-head"><h2>Sport</h2><span class="muted small">compared with ${esc(label)}</span></div>
    <div class="tablewrap" tabindex="0"><table><thead><tr><th class="l">Sport</th><th class="r">Sessions</th><th class="r">Time</th><th class="r">kcal</th><th class="r">Balls bowled</th><th class="r">Balls faced</th></tr></thead><tbody>
    ${names.map(n => { const c=a.sp[n]||{sessions:0,minutes:0,kcal:0,bowled:0,faced:0}, p=b.sp[n]||{sessions:0,minutes:0,kcal:0,bowled:0,faced:0};
      const cell = (cv,pv,f) => `${f(cv)}<br>${delta(cv,pv)}`;
      return `<tr><td class="l"><b>${esc(n)}</b></td><td class="r">${cell(c.sessions,p.sessions,n0)}</td><td class="r">${cell(c.minutes,p.minutes,hm)}</td><td class="r">${cell(c.kcal,p.kcal,n0)}</td>
        <td class="r">${c.bowled||p.bowled?cell(c.bowled,p.bowled,n0):'—'}</td><td class="r">${c.faced||p.faced?cell(c.faced,p.faced,n0):'—'}</td></tr>`; }).join('')}
    </tbody></table></div></section>`;
}
function exerciseDetail(r){
  const ss = r.e.sessions.slice(-40);
  const bw = r.bw;
  const pts = ss.map(s=>({date:s.date, v: s.best, tip: s.sets.map(x=>x.weight>0?`${n1(x.weight)} × ${x.reps}`:`${x.reps} reps`).join(', ') + (bw?'':`\nBest est. 1RM ${n1(s.best)} kg`)}));
  const first = ss[0].best, last = ss[ss.length-1].best;
  return `<section class="panel" aria-label="${esc(r.e.name)} progress">
    <div class="panel-head"><h2>${esc(r.e.name)}</h2><span class="muted small">${bw?'Most reps in a set':'Best estimated one-rep max per session'}</span></div>
    ${pts.length>1 ? lineChart({pts, unit:bw?'reps':'kg', color:'var(--protein)', wide:true}) : `<div class="empty">One session so far. The chart appears after your next ${esc(r.e.name)} session.</div>`}
    <div class="kv" style="max-width:420px">
      <span>Sessions logged</span><b>${r.e.sessions.length}</b>
      <span>Heaviest set</span><b>${bw?'Bodyweight':n1(Math.max(...r.e.sessions.map(s=>s.top)))+' kg'}</b>
      ${ss.length>1?`<span>Change since ${esc(fmtDate(ss[0].date,{day:'numeric',month:'short'}))}</span><b>${delta(last,first)}</b>`:''}
    </div>
    <div class="muted small">${bw?'':'Estimated 1RM uses the Epley formula: weight × (1 + reps ÷ 30). It lets sets with different reps be compared.'}</div>
  </section>`;
}
/* ---------- shared bits for the new layout ---------- */
// How a value sits against its target, and the colour for it.
//   'range': aim for the target (calories, carbs): under → orange, within 10% → violet, over → red
//   'more' : more is fine (protein, fibre, water, steps, sleep, vitamins): over → blue instead of red
//   'limit': stay under (sugar, sodium, saturated fat…): up to the limit → violet, over → red
function goalState(v, target, kind){
  if (!(target>0)) return 'plus';
  const r = v/target;
  if (kind==='limit') return r<=1 ? 'at' : 'over';
  if (r<0.9) return 'under';
  if (r<=1.1) return 'at';
  return kind==='more' ? 'plus' : 'over';
}
const stBar = st => `var(--st-${st})`, stText = st => `var(--st-${st}-t)`;
function stateKey(){ return `<div class="stkey"><span><i style="background:var(--st-under)"></i>below target</span><span><i style="background:var(--st-at)"></i>on target</span><span><i style="background:var(--st-over)"></i>over</span><span><i style="background:var(--st-plus)"></i>over, and that’s fine</span></div>`; }
// A row that folds open. Open state survives re-renders (S.openFolds).
function fold(key, title, sub, body, cls=''){
  return `<details class="fold${cls?' '+cls:''}" data-fold="${esc(key)}" ${S.openFolds.has(key)?'open':''}><summary><span class="ttl">${title}</span>${sub?`<span class="muted small sub">${sub}</span>`:''}</summary><div class="fold-body">${body}</div></details>`;
}
function spark(vals, color){
  const v = vals.filter(x=>Number.isFinite(x)); if (v.length<2) return '';
  const W=90, H=26, lo=Math.min(...v), hi=Math.max(...v), r=hi-lo||1;
  const pts = v.map((x,i)=>`${(i/(v.length-1)*(W-4)+2).toFixed(1)},${(H-3-(x-lo)/r*(H-6)).toFixed(1)}`).join(' ');
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
}
function dashCell(label, v, target, value, kind, hasData=true){
  const pctV = target>0 ? v/target*100 : 0, st = hasData ? goalState(v, target, kind) : null;
  return `<div class="dcell"><span class="l">${label}</span><span class="p"${st?` style="color:${stText(st)}"`:''}>${hasData?Math.round(pctV):'—'}${hasData?'<small>%</small>':''}</span>
    <div class="meter"><i style="width:${Math.min(100,pctV)}%;background:${st?stBar(st):'var(--ink-3)'}"></i></div><span class="val">${value}</span></div>`;
}


// Small tinted status tag, as in "On track" / "Low" / "Over".
const ST_LABEL = {under:'Low', at:'On track', over:'Over', plus:'Above goal'};
function statePill(st, label){ return st ? `<span class="spill" style="color:${stText(st)};background:color-mix(in srgb, ${stBar(st)} 15%, transparent)">${label||ST_LABEL[st]}</span>` : ''; }
function rings(arcs){
  // arcs: [{p:0-100+, color}] outermost first
  const C = 84, sw = 11, gap = 4;
  return `<svg class="rings" viewBox="0 0 ${C*2} ${C*2}" aria-hidden="true">${arcs.map((a,i)=>{ const r = C - sw/2 - i*(sw+gap), len = 2*Math.PI*r, f = Math.max(0, Math.min(1, a.p/100));
    return `<circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="${sw}"/>
      <circle cx="${C}" cy="${C}" r="${r}" fill="none" stroke="${a.color}" stroke-width="${sw}" stroke-linecap="round" stroke-dasharray="${(len*f).toFixed(1)} ${len.toFixed(1)}" transform="rotate(-90 ${C} ${C})"/>`; }).join('')}</svg>`;
}
const ICONS = {
  water:'<path d="M12 3.2c3.2 4.1 6 7.3 6 10.6a6 6 0 0 1-12 0c0-3.3 2.8-6.5 6-10.6z"/>',
  steps:'<path d="M8.2 3.5c1.6 0 2.4 1.8 2.4 4s-.8 4-2.4 4-2.4-1.8-2.4-4 .8-4 2.4-4zM6 13.6h4.4v1.9a2.2 2.2 0 0 1-4.4 0zM15.8 7.3c1.6 0 2.4 1.8 2.4 4s-.8 4-2.4 4-2.4-1.8-2.4-4 .8-4 2.4-4zM13.6 17.4H18v1.9a2.2 2.2 0 0 1-4.4 0z"/>',
  sleep:'<path d="M19.5 14.6A7.8 7.8 0 1 1 9.4 4.5a6.3 6.3 0 0 0 10.1 10.1z"/>',
};
const icon = (k, color) => `<span class="gicon" style="color:${color};background:color-mix(in srgb, ${color} 14%, transparent)"><svg viewBox="0 0 24 24" aria-hidden="true">${ICONS[k]}</svg></span>`;
function greeting(){ const h=new Date().getHours(); return h<12?'Good morning':h<17?'Good afternoon':'Good evening'; }

/* ---------- Today ---------- */
function viewToday(){
  const day = getDay(S.date), t = dayTotals(day), T = dayTargets(day);
  const H = day.health||{}; const B = burnedTotal(day);
  const sv = H.sleep_min ? sleepVerdict(H.sleep_min, who(S.date).age) : null;
  const byMeal = MEALS.map(m => ({m, items:(day.foods||[]).filter(f=>f.meal===m)})).filter(g=>g.items.length);
  const WT = waterTarget(day, T), goal = Number(prof().steps_goal)||10000;
  const P = (v,tg) => tg>0 ? v/tg*100 : 0;
  const hasTraining = (day.sports||[]).length || (day.exercises||[]).length;
  const hasFood = (day.foods||[]).length>0;
  // A past day with nothing logged: no burn estimate, it just looks like a workout that never happened.
  const emptyDay = S.date!==localDate() && !hasFood && !hasTraining && !Object.keys(H).length;
  return `${!S.profile ? `<div class="banner" style="margin-bottom:16px">Targets below use default numbers. <button class="linkbtn" data-action="goto" data-view="profile">Add your weight, height, age and goal</button> to set your own.</div>`:''}
  ${todayBanners()}
  <div class="grid">
    ${(()=>{ const name = (prof().name||'').trim().split(/\s+/)[0]; const left = T.kcal - t.kcal;
      const nudge = !hasFood ? (S.date===localDate() ? 'Log your first meal and the day fills in here.' : 'Nothing was logged on this day.')
        : left>=0 ? `${n0(left)} kcal and ${n0(Math.max(0,T.protein-t.protein))} g protein left ${S.date===localDate()?'today':'that day'}.` : `${n0(-left)} kcal over ${S.date===localDate()?'today’s':'that day’s'} target.`;
      return `<div class="hello">${S.date===localDate()?`<h1>${greeting()}${name?`, ${esc(name)}`:''}</h1>`:`<h1>${esc(fmtDate(S.date,{weekday:'long'}))}</h1>`}<p>${esc(nudge)}${S.date===localDate()&&t.water<WT*0.5&&new Date().getHours()>=14?' Drink some water too.':''}</p></div>`; })()}
    <section class="panel nring" aria-label="Nutrition today">
      ${(()=>{ const stK = hasFood ? goalState(t.kcal, T.kcal, 'range') : null;
        const rows = [
          ['Carbs', t.carbs, T.carbs, 'g', 'range', 'var(--carbs)'],
          ['Protein', t.protein, T.protein, 'g', 'more', 'var(--protein)'],
          ['Fat', t.fat, T.fat, 'g', 'range', 'var(--fat)'],
          ['Fibre', t.fiber, T.fiber, 'g', 'more', 'var(--ink-3)'],
          ['Added sugar', t.sugar, T.sugar, 'g', 'limit', 'var(--ink-3)'],
        ];
        return `<div class="nring-top">
          <div class="ringwrap">${rings([{p:P(t.carbs,T.carbs), color:'var(--carbs)'}, {p:P(t.protein,T.protein), color:'var(--protein)'}, {p:P(t.fat,T.fat), color:'var(--fat)'}])}
            <div class="ringc"><b>${hasFood?Math.round(P(t.kcal,T.kcal)):0}%</b><span>of goal</span></div></div>
          <div class="nsum"><span class="muted small">You have eaten</span><div class="nbig"><b style="color:${stK?stText(stK):'var(--accent-text)'}">${n0(t.kcal)}</b> kcal</div><span class="muted small">of ${n0(T.kcal)} kcal</span>${statePill(stK)}</div>
        </div>
        <div class="mrows">${rows.map(([l,v,tg,u,kind,c])=>{ const st = hasFood ? goalState(v,tg,kind) : null;
          return `<div class="mrow"><span class="sw" style="background:${c}"></span><span class="ml">${l}</span><span class="mv">${n0(v)}<span class="muted"> / ${kind==='limit'?'≤':''}${n0(tg)} ${u}</span></span><span class="mp" style="color:${st?stText(st):'var(--ink-3)'}">${hasFood?Math.round(P(v,tg)):0}%</span>${statePill(st)||'<span></span>'}</div>`; }).join('')}</div>
        <div class="stat3">
          <div data-tip="${esc(burnTip(B))}"><b style="color:${stText('plus')}">${emptyDay?'—':n0(B.total)}</b><span>kcal burned</span></div>
          <div><b>${emptyDay?'—':n0(B.training)}</b><span>training</span></div>
          <div><b>${emptyDay?'—':n0(B.moving)}</b><span>${B.fromHealth?'active (Health)':'steps'}</span></div>
        </div>`; })()}
    </section>
    ${loggerHtml('today')}
    <section class="panel folds" aria-label="What I ate and trained">
      ${fold('d-food', 'What I ate today', (day.foods||[]).length?`${(day.foods||[]).length} item${(day.foods||[]).length===1?'':'s'} · ${n0(t.kcal)} kcal`:'nothing yet', `
      ${byMeal.length ? byMeal.map(g=>`<div class="meal"><div class="meal-h"><span>${g.m}</span><span class="num">${n0(g.items.reduce((s,f)=>s+f.kcal,0))} kcal</span></div>
        ${g.items.map(f=>`<div class="item"><div><div class="nm">${esc(f.name)} ${f.confidence!=='high'?`<span class="tag est" title="Estimated portion">est.</span>`:''}${f.source==='photo'?' <span class="tag">photo</span>':''}${f.check?' <span class="tag est" title="Calories don’t match the protein, carbs and fat. Tap Edit to check.">check</span>':''}</div>
          <div class="sub">${esc(f.quantity||(f.grams?n0(f.grams)+' g':''))} · P ${n0(f.protein)} · C ${n0(f.carbs)} · F ${n0(f.fat)}</div></div>
          <div class="kc">${n0(f.kcal)}</div>
          <div class="acts"><button data-action="editFood" data-id="${f.id}" aria-label="Edit ${esc(f.name)}">Edit</button><button data-action="delFood" data-id="${f.id}" aria-label="Delete ${esc(f.name)}">✕</button></div></div>`).join('')}</div>`).join('')
        : `<div class="empty">Nothing logged yet. Type a meal above, like “2 eggs, 2 slices brown bread, 1 banana”.</div>`}
      ${(day.foods||[]).length?`<label class="check muted small" style="margin-top:12px"><input type="checkbox" data-action="dayComplete" ${day.incomplete?'':'checked'}> I logged everything I ate on this day (days you untick are left out when your real maintenance is measured)</label>`:''}`)}
      ${fold('d-train', 'What I trained today', hasTraining?[...(day.exercises||[]).length?[`gym · ${(day.exercises||[]).length} exercise${(day.exercises||[]).length===1?'':'s'}`]:[], ...(day.sports||[]).map(a=>`${actTitle(a)}${a.minutes?` ${n0(a.minutes)} min`:''}`)].join(' · ')+(t.burned?` · ${n0(t.burned)} kcal`:''):'nothing yet',
        hasTraining ? activityPanel(day) : `<div class="empty">No training logged. Type it in the box above, like “bench 60kg 3x8, squat 80x5 x5 x5” or “badminton doubles 1 hr”.</div>`)}
    </section>
    <section class="panel goals" aria-label="Today's goals">
      <div class="panel-head"><h2>Today’s goals</h2></div>
      ${(()=>{ const full = Math.floor(t.water/250), glasses = Math.min(12, Math.max(4, Math.ceil(WT/250), full));
        const stW = t.water>0 ? goalState(t.water, WT, 'more') : null, stS = H.steps ? goalState(H.steps, goal, 'more') : null, stZ = H.sleep_min ? goalState(H.sleep_min, 420, 'more') : null;
        const bar = (v, tg, st) => `<div class="meter"><i style="width:${Math.min(100,P(v,tg))}%;background:${st?stBar(st):'var(--ink-3)'}"></i></div>`;
        return `<div class="grow">${icon('water','var(--water)')}<div class="gt"><b>Water</b><span class="muted small">${fmtL(t.water)} of ${fmtL(WT)} L · tap a glass to add 250 ml</span></div>${statePill(stW)}</div>
          <div class="glasses2">${Array.from({length:glasses},(_,i)=>`<button class="gl${i<full?' on':''}" ${i<full?'disabled':'data-action="water" data-ml="250"'} aria-label="${i<full?'Glass drunk':'Add a 250 ml glass'}"><svg viewBox="0 0 24 28" aria-hidden="true"><path class="cup" d="M4 3h16l-2 21a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2z"/><path class="fill" d="M5.4 10h13.2l-1.4 14a1.4 1.4 0 0 1-1.4 1.3H8.2a1.4 1.4 0 0 1-1.4-1.3z"/></svg></button>`).join('')}</div>
          <div class="row">${[500,750].map(ml=>`<button class="btn ghost sm" data-action="water" data-ml="${ml}">+ ${ml} ml</button>`).join('')}${(day.water||[]).length?`<span class="spacer"></span><button class="linkbtn" data-action="undoWater">Undo</button>`:''}</div>
          <div class="grow">${icon('steps','var(--accent)')}<div class="gt"><b>Steps</b><span class="muted small">${H.steps?n0(H.steps):'0'} of ${n0(goal)}</span></div>${statePill(stS)}</div>${bar(H.steps||0, goal, stS)}
          <div class="grow">${icon('sleep','var(--fat)')}<div class="gt"><b>Sleep</b><span class="muted small">${H.sleep_min?`${fmtSleep(H.sleep_min)} · ${sv?sv.label.toLowerCase():''}`:'not logged'} · aim 7 h+</span></div>${statePill(stZ)}</div>${bar(H.sleep_min||0, 420, stZ)}
          ${day.health_synced_at?`<div class="muted small">Synced from Apple Health at ${esc(new Date(day.health_synced_at).toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}))}.</div>`
            : !H.steps&&!H.sleep_min?`<div class="muted small">Add steps and sleep by typing “slept 7h 10m, 9200 steps” in the log box${S.hsync?.connected?'':`, or <button class="linkbtn" data-action="goto" data-view="profile">sync them from Apple Health</button> automatically (iPhone)`}.</div>`:''}`; })()}
    </section>
  </div>`;
}

/* ---------- Train ---------- */
function exerciseRows(){
  return [...buildSessions().values()].map(e => {
    const last = e.sessions[e.sessions.length-1];
    const cutoff = addDays(last.date, -28);
    const base = [...e.sessions].reverse().find(s=>s.date<=cutoff) || e.sessions[0];
    return {e, last, bw:last.bodyweight, allBest:Math.max(...e.sessions.map(s=>s.best)), base};
  }).sort((x,y)=> y.last.date.localeCompare(x.last.date) || x.e.name.localeCompare(y.e.name));
}
/* Personal records: a session that beats every earlier one for that exercise on
   heaviest weight, estimated 1-rep max, or (bodyweight moves) most reps in a set.
   The first time an exercise is logged doesn't count. */
function prsOn(date){
  const out = new Map();
  for (const [k,e] of buildSessions()) {
    const i = e.sessions.findIndex(x=>x.date===date); if (i<=0) continue;
    const s = e.sessions[i], before = e.sessions.slice(0,i);
    if (s.bodyweight) { const m = Math.max(...before.map(x=>x.best)); if (s.best > m) out.set(k, {name:e.name, text:`${n0(s.best)} reps (was ${n0(m)})`}); continue; }
    const topB = Math.max(...before.map(x=>x.top)), bestB = Math.max(...before.map(x=>x.best));
    if (s.top > topB) out.set(k, {name:e.name, text:`${n1(s.top)} kg heaviest (was ${n1(topB)})`});
    else if (s.best > bestB + 0.05) out.set(k, {name:e.name, text:`est. 1RM ${n1(s.best)} kg (was ${n1(bestB)})`});
  }
  return out;
}
function recentPrs(days=30){
  const since = addDays(localDate(), -days), out = [];
  for (const [date, d] of S.days) if (date >= since && (d.exercises||[]).length) for (const [k,v] of prsOn(date)) out.push({date, ...v});
  return out.sort((a,b)=>b.date.localeCompare(a.date));
}
function growthDash(rows){
  if (!rows.length) return `<section class="panel" aria-label="Gym progress"><div class="panel-head"><h2>Gym progress</h2></div>
    <div class="empty">Log a workout on Today, like “bench 60kg 3x8”. Each exercise then shows here with how much stronger you’re getting.</div></section>`;
  const shown = S.allEx ? rows : rows.slice(0,6);
  const month = addDays(localDate(), -30);
  const prs = rows.filter(r => r.e.sessions.length>1 && r.last.date>=month && r.last.best>=r.allBest && r.last.best>Math.max(...r.e.sessions.slice(0,-1).map(s=>s.best))).length;
  const up = rows.filter(r => r.base!==r.last && r.last.best>r.base.best).length;
  return `<section class="panel" aria-label="Gym progress"><div class="panel-head"><h2>Gym progress</h2><span class="muted small">${rows.length} exercise${rows.length===1?'':'s'}</span></div>
    <div class="row"><span class="pill good">${up} getting stronger</span>${prs?`<span class="pill">${prs} new best${prs===1?'':'s'} this month</span>`:''}</div>
    <div class="exgrid">${shown.map(r => { const ch = r.base!==r.last && r.base.best ? (r.last.best-r.base.best)/r.base.best*100 : null;
      return `<button class="excell${r.e.key===S.gymEx?' sel':''}" data-action="pickEx" data-key="${esc(r.e.key)}">
        <span class="nm">${esc(r.e.name)}</span>
        <span class="v">${r.bw?`${n0(r.last.best)} <small>reps</small>`:`${n1(r.last.best)} <small>kg</small>`}</span>
        <span class="muted small">${r.bw?'most reps':'est. 1RM'} · ${esc(fmtDate(r.last.date,{day:'numeric',month:'short'}))}</span>
        <span class="delta ${ch===null?'flat':ch>0.5?'up':ch<-0.5?'down':'flat'}">${ch===null?'first session':`${ch>0?'+':''}${n1(ch)}% ${r.base.date<=addDays(r.last.date,-28)?'vs 4 wks ago':`since ${esc(fmtDate(r.base.date,{day:'numeric',month:'short'}))}`}`}</span>
        ${spark(r.e.sessions.slice(-10).map(s=>s.best), 'var(--protein)')}</button>`; }).join('')}</div>
    ${rows.length>6?`<button class="linkbtn" data-action="allEx" style="align-self:flex-start;padding-left:0">${S.allEx?'Show fewer':`Show all ${rows.length} exercises`}</button>`:''}
    ${(()=>{ const pr = recentPrs(30); return pr.length ? `<div><h3>Personal records, last 30 days</h3>${pr.slice(0,8).map(x=>`<div class="item"><div><div class="nm"><span class="prbadge">PR</span> ${esc(x.name)}</div><div class="sub">${esc(x.text)}</div></div><span class="muted small">${esc(fmtDate(x.date,{day:'numeric',month:'short'}))}</span><span></span></div>`).join('')}</div>` : ''; })()}
    <div class="muted small">Tap an exercise for its full chart. Est. 1RM = weight × (1 + reps ÷ 30), so sets with different reps compare fairly.</div>
  </section>`;
}
function viewGym(){
  const {cur,prev,label} = periodRanges(S.date, S.gymPeriod);
  const a = periodStats(...cur), b = periodStats(...prev);
  const rows = exerciseRows();
  if (S.gymEx && !rows.find(r=>r.e.key===S.gymEx)) S.gymEx=null;
  const sel = rows.find(r=>r.e.key===S.gymEx);
  return `<div class="grid">
    <div class="panel-head"><h2>${S.gymPeriod==='week'?'This week':'This month'}</h2>
      <div class="seg" role="group" aria-label="Period"><button data-action="gymPeriod" data-p="week" aria-pressed="${S.gymPeriod==='week'}">Week</button><button data-action="gymPeriod" data-p="month" aria-pressed="${S.gymPeriod==='month'}">Month</button></div></div>
    <div class="tiles">
      <div class="tile"><span class="l">Days trained</span><span class="v">${a.days}</span>${delta(a.days,b.days)}</div>
      <div class="tile"><span class="l">Working sets</span><span class="v">${a.sets}</span>${delta(a.sets,b.sets)}</div>
      <div class="tile"><span class="l">Volume lifted</span><span class="v">${n0(a.volume)}<span class="muted" style="font-size:16px"> kg</span></span>${delta(a.volume,b.volume)}</div>
      <div class="tile"><span class="l">Training kcal</span><span class="v">${n0(a.kcal)}</span>${delta(a.kcal,b.kcal)}</div>
    </div>
    <div class="muted small">Changes compare ${S.gymPeriod==='week'?'this week so far':'this month so far'} with all of ${label}. Volume = weight × reps across every set.</div>
    ${growthDash(rows)}
    ${sel ? exerciseDetail(sel) : ''}
    ${loadPanel()}
    ${planCard(false)}
    <section class="panel folds" aria-label="Exercise library">${fold('g-lib', 'Exercise library', libCount() ? `${n0(libCount())} exercises with how-to` : 'loading…', libraryHtml())}</section>
  </div>`;
}
/* ---------- exercise library (exercises.js + data/ex-*.json) ---------- */
const libCount = () => typeof Gym==='undefined' ? 0 : Gym.EXERCISES.length + Gym.libraries().reduce((s,l)=>s+l.items.length,0);
function sourcesHtml(){
  return `<ul class="tips">
    <li><b>Foods:</b> MaxxTempo’s table (IFCT 2017 and USDA averages); Indian recipes from the <a href="https://www.anuvaad.org.in/indian-nutrient-databank/" target="_blank" rel="noopener">Indian Nutrient Databank (INDB)</a>, Vijayakumar et al. 2024, CC BY 4.0; <a href="https://fdc.nal.usda.gov" target="_blank" rel="noopener">USDA FoodData Central</a> SR Legacy, public domain.</li>
    <li><b>Packaged foods:</b> barcode lookups from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a>, © Open Food Facts contributors, <a href="https://opendatacommons.org/licenses/odbl/1-0/" target="_blank" rel="noopener">ODbL</a>. Scanning uses <a href="https://github.com/zxing-js/browser" target="_blank" rel="noopener">ZXing</a> (MIT / Apache-2.0).</li>
    <li><b>Exercises:</b> <a href="https://github.com/yuhonas/free-exercise-db" target="_blank" rel="noopener">free-exercise-db</a> (public domain); <a href="https://wger.de" target="_blank" rel="noopener">wger</a> (CC-BY-SA, authors listed on each exercise); <a href="https://oss.exercisedb.dev" target="_blank" rel="noopener">ExerciseDB</a> free version (non-commercial, animations from ExerciseDB).</li>
  </ul><div class="muted small">All free, with no accounts or keys. Food and exercise data is stored in the app, so it keeps working even if a source goes offline; only barcode lookups and exercise pictures need the internet.</div>`;
}
function libraryHtml(){
  return `<label class="field full">Find an exercise<input id="exq" type="search" placeholder="e.g. incline db, lat pulldown, rdl" value="${esc(S.exq||'')}" autocomplete="off"></label>
    <div id="exres" class="exres">${libResults(S.exq||'')}</div>
    <div class="muted small">Tap one for how to do it. Anything listed here logs without AI when you type its name with your sets, e.g. “${esc('zercher squat 60x5')}”.</div>`;
}
function libResults(q){
  if (!q.trim()) return '';
  const r = Gym.search(q, 30);
  if (!r.length) return `<div class="empty">No exercise matches “${esc(q)}”.</div>`;
  return r.map(x=>`<button class="exrow" data-action="howto" data-name="${esc(x.name)}"><span>${esc(x.name)}</span><span class="tag">${esc(x.group)}</span></button>`).join('');
}
// "How to do it" under an exercise: a fold whose content is filled the first time it opens.
const howtoFold = name => `<details class="howfold" data-how="${esc(name)}"><summary>How to do it</summary><div class="howbody"></div></details>`;
function howtoBody(name){
  const hs = Gym.howto(name);
  if (!hs.length) return `<div class="muted small">${libCount() ? 'No instructions for this exercise in the built-in libraries yet.' : 'The exercise library is still loading. Close and open this again in a moment.'}</div>`;
  const pic = hs.find(h=>h.item.img && /\.gif$/i.test(h.item.img)) || hs.find(h=>h.item.img);
  const text = hs.find(h=>(h.item.i||[]).length); const info = hs[0].item;
  const credits = [...new Map(hs.map(h=>[h.source, h])).values()].map(h => h.source==='wger'
    ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">wger.de</a> (${esc(h.item.lic||'CC-BY-SA')}, ${esc(h.item.by||'wger.de')})`
    : h.source==='ExerciseDB' ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">ExerciseDB</a> (free version, non-commercial)`
    : `<a href="${esc(h.url)}" target="_blank" rel="noopener">free-exercise-db</a> (public domain)`).join(' · ');
  return `${pic ? `<img class="howimg" src="${esc(pic.item.img)}" alt="${esc(pic.item.n)} demonstration" loading="lazy">` : ''}
    <div class="small muted">${[info.g, (info.mu||[]).join(', '), (info.s||[]).length?`also ${info.s.join(', ')}`:'', info.eq].filter(Boolean).map(esc).join(' · ')}</div>
    ${text ? `<ol class="tips howsteps">${text.item.i.slice(0,10).map(x=>`<li>${esc(x)}</li>`).join('')}</ol>` : ''}
    <div class="muted small">From ${credits}.${text && text.item.n!==name ? ` Closest match: ${esc(text.item.n)}.` : ''}</div>`;
}
document.addEventListener('toggle', ev => {
  const det = ev.target; if (!det.matches || !det.matches('details.howfold') || !det.open) return;
  const body = det.querySelector('.howbody'); if (!body || body.dataset.done) return;
  body.innerHTML = howtoBody(det.dataset.how||''); body.dataset.done = libCount() ? '1' : '';
  const img = body.querySelector('.howimg'); if (img) img.addEventListener('error', () => img.remove());
}, true);
function openHowto(name){
  const hs = Gym.howto(name); const d = $('#dlg');
  const pic = hs.find(h=>h.item.img && /\.gif$/i.test(h.item.img)) || hs.find(h=>h.item.img);
  const text = hs.find(h=>(h.item.i||[]).length);
  const info = hs[0]?.item;
  const credits = [...new Map(hs.map(h=>[h.source, h])).values()].map(h => h.source==='wger'
    ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">wger.de</a> (${esc(h.item.lic||'CC-BY-SA')}, ${esc(h.item.by||'wger.de')})`
    : h.source==='ExerciseDB' ? `<a href="${esc(h.url)}" target="_blank" rel="noopener">ExerciseDB</a> (free version, non-commercial)`
    : `<a href="${esc(h.url)}" target="_blank" rel="noopener">free-exercise-db</a> (public domain)`).join(' · ');
  d.innerHTML = `<div class="howto"><h2>${esc(name)}</h2>
    ${!hs.length ? `<p class="muted">${libCount() ? 'No instructions found for this exercise in the built-in libraries.' : 'The exercise library is still loading. Try again in a moment.'}</p>` : ''}
    ${pic ? `<img class="howimg" src="${esc(pic.item.img)}" alt="${esc(pic.item.n)} demonstration" loading="lazy">` : ''}
    ${info ? `<div class="small muted">${[info.g, (info.mu||[]).join(', '), (info.s||[]).length?`also ${info.s.join(', ')}`:'', info.eq].filter(Boolean).map(esc).join(' · ')}</div>` : ''}
    ${text ? `<ol class="tips howsteps">${text.item.i.slice(0,10).map(x=>`<li>${esc(x)}</li>`).join('')}</ol>` : ''}
    ${hs.length ? `<div class="muted small">From ${credits}.${text && text.item.n!==name ? ` Closest match: ${esc(text.item.n)}.` : ''}</div>` : ''}
    <div class="row"><span class="spacer"></span><button class="btn" id="howClose">Close</button></div></div>`;
  d.showModal(); $('#howClose').onclick = () => d.close();
  const img = d.querySelector('.howimg'); if (img) img.addEventListener('error', () => img.remove());
}
/* Built-in databases in data/ (see DATA-LICENSES.md), fetched once after sign-in
   and kept by the service worker. The app works without them. */
const DATA_VER = 1;
async function loadData(){
  const get = f => fetch(`data/${f}.json?v=${DATA_VER}`).then(r => r.ok ? r.json() : null).catch(() => null);
  const [free, wger, edb, indb] = await Promise.all([get('ex-free'), get('ex-wger'), get('ex-edb'), get('indb')]);
  Gym.setLibraries([free, wger, edb]); S.libsReady = true;
  if (indb && indb.items?.length) { S.libFoods = indb.items.map(r=>rowToFood(r,'indb')); S.indbBuiltIn = true; S.myFoodsVer=(S.myFoodsVer||0)+1; }
  render();
}
// USDA is only needed for search, so it loads the first time someone searches.
let usdaP = null;
const loadUsda = () => usdaP ||= fetch(`data/usda.json?v=${DATA_VER}`).then(r => r.ok ? r.json() : null).then(d => (d?.items||[]).map(usdaToFood)).catch(() => (usdaP = null, []));
function usdaToFood(r){
  const [name, cat, units, kcal, protein, carbs, fat, fiber, sugar, ...m] = r;
  const micros = {}; FOOD_MICRO_ORDER.forEach((k,i)=>micros[k]=m[i]||0);
  return {name:usdaName(name), aliases:[name], units:units||{}, per:{kcal,protein,carbs,fat,fiber,sugar,micros}, alcohol:m[14]||0, cat, src:'usda'};
}
// USDA names lead with a group ("Nuts, almonds, blanched"); put the food first: "Almonds, blanched (nuts)".
const USDA_GROUPS = new Set(['nuts','seeds','cereals','spices','oil','candies','beverages','snacks','soup','sauce','fast foods','restaurant','babyfood','cereals ready-to-eat','fish','crustaceans','mollusks','vegetables','fruit']);
function usdaName(n){
  const seg = String(n).split(', ');
  let out = seg.length > 1 && USDA_GROUPS.has(seg[0].toLowerCase()) ? `${seg.slice(1).join(', ')} (${seg[0].toLowerCase()})` : seg.join(', ');
  out = out.replace(/\b[A-Z]{3,}(?:'[A-Z]+)?\b/g, w => w[0] + w.slice(1).toLowerCase());   // "ALMOND JOY" → "Almond Joy"
  return out.charAt(0).toUpperCase() + out.slice(1);
}

/* ---------- food search (my foods, built-in, INDB, USDA) and portions ---------- */
async function searchFoods(q, limit=40){
  const qw = normFood(q).split(' ').filter(Boolean).map(singular); if (!qw.length) return [];
  const words = t => normFood(t).split(' ').map(singular);
  const hit = (name, aliases) => [name, ...(aliases||[])].some(a => { const ws = words(a); return qw.every((w,i) => ws.some(x => i===qw.length-1 ? x.startsWith(w) : x===w)); });
  const mine = Object.values(S.myFoods||{}).map(f => ({...f, src:'mine'}));
  const out = [], seen = new Set();
  const add = f => { const k = normFood(f.name); if (seen.has(k) || out.length >= limit*3) return; seen.add(k); out.push(f); };
  for (const f of mine) if (hit(f.name, f.aliases)) add(f);
  for (const f of FOODS) if (hit(f.name, f.aliases)) add({...f, src:'builtin'});
  for (const f of S.libFoods||[]) if (hit(f.name, f.aliases)) add(f);
  for (const f of await loadUsda()) if (hit(f.name)) add(f);
  // Relevance: exact names and names that start with what was typed first; oils, sweets and
  // baby foods only when asked for; then your own foods, the built-in table, INDB, USDA.
  const rank = {mine:0, builtin:1, indb:2, usda:3}, qs = new Set(qw);
  const score = f => { const n = normFood(f.name), ws = words(f.name); let x = rank[f.src]*6 + n.length/25;
    const qj = qw.join(' ');
    if (n === qj || words(f.name).join(' ') === qj) x -= 100;
    else if ((f.aliases||[]).some(a => words(a).join(' ') === qj)) x -= 90;
    if (ws[0] === qw[0]) x -= 20; else if (ws.slice(0,2).includes(qw[0])) x -= 8;
    for (const [re, pen] of [[/\boil\b/,40],[/\bcand(y|ies)\b/,40],[/\bbabyfood|infant\b/,60],[/\bflour\b/,12],[/\bbran\b/,12],[/\bfast food|restaurant\b/,10],[/\bbeverage\b/,8]])
      if (re.test(n) && !qw.some(w => re.test(w))) x += pen;
    return x; };
  return out.map(f => [score(f), f]).sort((a,b) => a[0]-b[0]).map(x => x[1]).slice(0, limit);
}
const SRC_LABEL = {mine:'my food', builtin:'built in', indb:'INDB', usda:'USDA', off:'Open Food Facts'};
function openFoodSearch(){
  const d = $('#dlg');
  d.innerHTML = `<div class="fsearch"><h2>Find a food</h2>
    <label class="field full">Search<input id="fq" type="search" placeholder="e.g. almonds, paneer tikka, oats" autocomplete="off"></label>
    <div id="fres" class="exres"><div class="muted small">${n0(FOODS.length + (S.libFoods||[]).length)} Indian and everyday foods, plus about 7,200 from USDA. No AI used.</div></div>
    <div class="row"><button class="btn ghost sm" id="fscan">Scan a barcode</button><span class="spacer"></span><button class="btn ghost" id="fclose">Close</button></div></div>`;
  d.showModal(); $('#fclose').onclick = () => d.close(); $('#fscan').onclick = () => openScanner();
  let t = null, list = [];
  $('#fq').addEventListener('input', ev => { clearTimeout(t); t = setTimeout(async () => {
    const q = ev.target.value; if (!q.trim()) { $('#fres').innerHTML=''; return; }
    list = await searchFoods(q);
    if ($('#fq')?.value !== q) return;
    $('#fres').innerHTML = list.length ? list.map((f,i)=>`<button class="exrow" data-i="${i}"><span>${esc(f.name)}<span class="muted small"> · ${n0(f.per.kcal)} kcal/100 g</span></span><span class="tag">${SRC_LABEL[f.src]||''}</span></button>`).join('')
      : `<div class="empty">Nothing found for “${esc(q)}”. Type it in the log box instead and AI will read it.</div>`;
  }, 180); });
  $('#fres').addEventListener('click', ev => { const b = ev.target.closest('[data-i]'); if (b) openPortion(list[+b.dataset.i]); });
  setTimeout(() => $('#fq')?.focus(), 50);
}
function foodFromPer(f, grams, label){
  const k = grams/100, per = f.per; const micros = {}; for (const m of MICROS) micros[m.key] = (per.micros[m.key]||0)*k;
  return {id:uid(), name:f.name, quantity:label, grams:Math.round(grams), meal:guessMeal(), time:nowTime(), kcal:per.kcal*k, protein:per.protein*k, carbs:per.carbs*k, fat:per.fat*k,
    fiber:(per.fiber||0)*k, sugar:(per.sugar||0)*k, added_sugar:addedPer100(f)*k, alcohol:((f.alcohol ?? FOOD_ALCOHOL[f.name]) || 0)*k, micros, confidence:'high', source:'food-'+(f.src||'db')};
}
function openPortion(f, note){
  if (!f) return;
  const d = $('#dlg'); const units = Object.entries(f.units||{}).filter(([,g])=>g>0);
  // Start from one serving; a whole packet only when it's a small one (a bar, a sachet), otherwise 100 g.
  const U = f.units||{}; const def = U.serving ? 'serving' : U.packet && U.packet<=60 ? 'packet' : units.length && !U.packet ? units[0][0] : 'g';
  const opts = [...units.map(([u,g])=>`<option value="${esc(u)}" ${u===def?'selected':''}>${esc(u)} (${n0(g)} g)</option>`), `<option value="g" ${def==='g'?'selected':''}>grams</option>`].join('');
  d.innerHTML = `<form class="form" id="pform" style="gap:12px"><h2 class="full">${esc(f.name)}</h2>
    ${note ? `<div class="full small muted">${note}</div>` : ''}
    <label class="field">Amount<input id="pq" type="number" min="0" step="any" inputmode="decimal" value="${def==='g'?100:1}"></label>
    <label class="field">Unit<select id="pu">${opts}</select></label>
    <label class="field">Meal<select id="pm">${MEALS.map(m=>`<option ${m===guessMeal()?'selected':''}>${m}</option>`).join('')}</select></label>
    <div class="full" id="pprev"></div>
    <div class="full muted small">Per 100 g: ${n0(f.per.kcal)} kcal · P ${n1(f.per.protein)} · C ${n1(f.per.carbs)} · F ${n1(f.per.fat)} g · from ${esc(SRC_LABEL[f.src]||'food table')}</div>
    <div class="full row"><span class="spacer"></span><button class="btn ghost" type="button" id="pcancel">Cancel</button><button class="btn" type="submit">Log it</button></div></form>`;
  d.showModal();
  const grams = () => { const q = num($('#pq').value, 100000), u = $('#pu').value; return u==='g' ? q : q*((f.units||{})[u]||100); };
  const upd = () => { const g = grams(), k = g/100; $('#pprev').innerHTML = `<b>${n0(f.per.kcal*k)} kcal</b> · ${n0(g)} g · protein ${n1(f.per.protein*k)} g · carbs ${n1(f.per.carbs*k)} g · fat ${n1(f.per.fat*k)} g`; };
  $('#pq').addEventListener('input', upd); $('#pu').addEventListener('change', () => { if ($('#pu').value==='g' && num($('#pq').value,1e5)<10) $('#pq').value = 100; upd(); }); upd();
  $('#pcancel').onclick = () => d.close();
  $('#pform').onsubmit = async ev => { ev.preventDefault();
    const g = grams(); if (!(g>0) || g>5000) { $('#pprev').innerHTML = '<span class="err">Enter an amount up to 5 kg.</span>'; return; }
    const q = num($('#pq').value,1e5), u = $('#pu').value;
    const x = foodFromPer(f, g, u==='g' ? `${n0(g)} g` : `${q} ${u}${q>1&&!/s$/.test(u)?'s':''}`); x.meal = $('#pm').value;
    d.close();
    await saveEntry(S.date, {foods:[x]});
    if (f.src==='usda' || f.src==='off') saveMyFood({...x, verified:f.src==='off'}, f.barcode || null);
    setStatus(`Logged ${f.name} · ${n0(x.kcal)} kcal. No AI used${f.src==='usda'||f.src==='off'?'; saved to your food list, so typing it next time works too':''}.`);
  };
}

/* ---------- barcode scanning (ZXing in the browser + Open Food Facts) ---------- */
const ZXING = { src:'https://cdn.jsdelivr.net/npm/@zxing/browser@0.2.1/umd/zxing-browser.min.js', integrity:'sha384-HRtzk9lZgkbSgvUyQrnfC/GxiXZgwaNyD7hC9wcXlsBpDhkS80ISl73juef2FRuf' };
let scanCtl = null;
function stopScan(){ try { scanCtl?.stop(); } catch {} scanCtl = null; }
async function openScanner(onCode = lookupBarcode){
  const d = $('#dlg');
  d.innerHTML = `<div class="scan"><h2>Scan a barcode</h2>
    <div class="scanbox"><video id="scanv" playsinline muted></video><div class="scanline"></div></div>
    <div class="small muted" id="scanmsg">Starting the camera…</div>
    <form class="row" id="codeform"><input id="codein" inputmode="numeric" pattern="[0-9]*" placeholder="or type the barcode number" style="flex:1"><button class="btn ghost sm" type="submit">Look up</button></form>
    <div class="muted small">Product data from <a href="https://world.openfoodfacts.org" target="_blank" rel="noopener">Open Food Facts</a>, free and open (ODbL).</div>
    <div class="row"><span class="spacer"></span><button class="btn ghost" id="scanclose">Close</button></div></div>`;
  d.showModal();
  const close = () => { stopScan(); d.close(); };
  $('#scanclose').onclick = close; d.addEventListener('close', stopScan, {once:true});
  $('#codeform').onsubmit = ev => { ev.preventDefault(); const c = ($('#codein').value||'').replace(/\D/g,''); if (c.length>=6) { stopScan(); onCode(c); } };
  try {
    await loadScript(ZXING);
    const reader = new ZXingBrowser.BrowserMultiFormatReader();
    scanCtl = await reader.decodeFromVideoDevice(undefined, $('#scanv'), (res) => {
      if (!res || !scanCtl) return; const code = res.getText(); stopScan(); if (navigator.vibrate) navigator.vibrate(60); onCode(code);
    });
    if ($('#scanmsg')) $('#scanmsg').textContent = 'Point the camera at the barcode on the packet.';
  } catch (e) {
    console.warn('scanner', e?.name, e?.message);
    if ($('#scanmsg')) $('#scanmsg').textContent = /NotAllowed|Permission/i.test(e?.name||e?.message||'') ? 'Camera permission is off. Allow the camera for this app, or type the number below.' : 'Couldn’t start the camera here. Type the barcode number below.';
  }
}
async function lookupBarcode(code){
  const d = $('#dlg'); if (!d.open) d.showModal();
  // Scanned before? It's in your food list, no network needed.
  const mine = Object.values(S.myFoods||{}).find(f => (f.aliases||[]).includes(code));
  if (mine) { openPortion({...mine, src:'mine'}, `Barcode ${esc(code)} · from your food list`); return; }
  d.innerHTML = `<div class="scan"><h2>Looking up ${esc(code)}…</h2><div class="muted small">Asking Open Food Facts.</div></div>`;
  let p = null;
  try {
    const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_en,brands,nutriments,serving_quantity,product_quantity,quantity`);
    const j = await r.json().catch(() => null); if (j && j.status === 1) p = j.product;
  } catch { d.innerHTML = `<div class="scan"><h2>Couldn’t look it up</h2><p class="muted">You seem to be offline. Try again when connected, or type what you ate in the log box.</p><div class="row"><span class="spacer"></span><button class="btn ghost" id="scanclose">Close</button></div></div>`; $('#scanclose').onclick = () => d.close(); return; }
  const f = p && offToFood(p, code);
  if (!f) {
    d.innerHTML = `<div class="scan"><h2>${p ? esc(p.product_name||'Product')+': no nutrition facts yet' : 'Product not found'}</h2>
      <p class="muted">Open Food Facts doesn’t have ${p?'the nutrition table for':''} barcode ${esc(code)} yet. Type what you ate in the log box instead, or add the product at <a href="https://world.openfoodfacts.org/cgi/product.pl?type=add&code=${esc(code)}" target="_blank" rel="noopener">Open Food Facts</a> so everyone gets it.</p>
      <div class="row"><button class="btn ghost sm" id="scanagain">Scan another</button><span class="spacer"></span><button class="btn ghost" id="scanclose">Close</button></div></div>`;
    $('#scanclose').onclick = () => d.close(); $('#scanagain').onclick = () => openScanner(); return;
  }
  openPortion(f, `Barcode ${esc(code)} · <a href="https://world.openfoodfacts.org/product/${esc(code)}" target="_blank" rel="noopener">Open Food Facts</a> (ODbL)`);
}
// Open Food Facts nutriments are per 100 g, minerals and vitamins in grams.
function offToFood(p, code){
  const n = p.nutriments||{}; const g = k => { const v = Number(n[k+'_100g']); return Number.isFinite(v) && v>=0 ? v : 0; };
  const kcal = g('energy-kcal') || (g('energy') ? g('energy')/4.184 : 0); if (!(kcal>0)) return null;
  const pn = String(p.product_name_en || p.product_name || '').trim(), brand = String(p.brands||'').split(',')[0].trim();
  const name = (brand && !pn.toLowerCase().includes(brand.toLowerCase()) ? `${pn} · ${brand}` : pn || brand).slice(0,70) || `Product ${code}`;
  const micros = { sat_fat_g:g('saturated-fat'), cholesterol_mg:g('cholesterol')*1000, sodium_mg:(g('sodium') || g('salt')/2.5)*1000, potassium_mg:g('potassium')*1000,
    calcium_mg:g('calcium')*1000, iron_mg:g('iron')*1000, magnesium_mg:g('magnesium')*1000, zinc_mg:g('zinc')*1000, vitamin_a_mcg:g('vitamin-a')*1e6, vitamin_c_mg:g('vitamin-c')*1000,
    vitamin_d_mcg:g('vitamin-d')*1e6, vitamin_b12_mcg:g('vitamin-b12')*1e6, folate_mcg:g('folates')*1e6, omega3_g:g('omega-3-fat') };
  const units = {}; const sq = Number(p.serving_quantity); if (sq>0 && sq<2000) units.serving = Math.round(sq);
  const pq = Number(p.product_quantity); if (pq>0 && pq<5000 && pq!==sq) units.packet = Math.round(pq);
  // Added sugar: from the label when given; plain milk, curd, oats, flour, rice, dal, eggs and nuts have none; other packaged foods count all their sugar.
  const plain = /\b(milk|curd|dahi|yogh?urt|paneer|cheese|egg|oats|atta|flour|rice|dal|lentil|nuts?|almond|peanut|butter|ghee|tofu|soya)\b/i.test(name) && !sweetName(name);
  const added = n['added-sugars_100g'] != null ? g('added-sugars') : plain ? 0 : g('sugars');
  return {name, aliases:[code], units, per:{kcal, protein:g('proteins'), carbs:g('carbohydrates'), fat:g('fat'), fiber:g('fiber'), sugar:g('sugars'), added_sugar:added, micros}, alcohol:g('alcohol')*0.789, src:'off', barcode:code};
}

/* ---------- Trends ---------- */
// target: a number, or a function of the row (per-day targets rise on training days)
function weekBars(rows, get, fmt, kind, target){
  const tgt = r => typeof target==='function' ? target(r) : target;
  const vals = rows.map(r=>get(r)); const have = vals.filter(v=>v>0);
  const max = Math.max(...rows.map(r=>tgt(r)||0), ...vals, 1)*1.05;
  const avg = have.length ? have.reduce((s,v)=>s+v,0)/have.length : 0;
  return {avg, html:`<div class="wbars">${rows.map((r,i)=>{ const v=vals[i]; const target = tgt(r); const h=v>0?Math.max(4, v/max*100):0; const st = goalState(v, target, kind);
    return `<div class="wb" data-tip="${esc(fmtDate(r.date)+': '+(v>0?fmt(v):'nothing logged'))}"><span class="wv">${v>0?fmt(v,true):''}</span><div class="wtrack">${target?`<i class="wt" style="bottom:${target/max*100}%"></i>`:''}<i class="wfill" style="height:${h}%;background:${stBar(st)}"></i></div><span class="wd${r.date===localDate()?' now':''}">${esc(fmtDate(r.date,{weekday:'narrow'}))}</span></div>`; }).join('')}</div>`};
}
function viewTrends(){
  const rows = Array.from({length:7},(_,i)=>{ const date=addDays(S.date, i-6); const d=S.days.get(date); return {date, d, t:d?dayTotals(d):null, T:d?dayTargets(d):targets(date)}; });
  const T = targets(); const goal = Number(prof().steps_goal)||10000;
  const k = v => v>=10000 ? n1(v/1000)+'k' : n0(v);
  const metrics = [
    ['Calories eaten', r=>r.t?r.t.kcal:0, (v,s)=>s?k(v):`${n0(v)} kcal`, 'range', r=>r.T.kcal, v=>`${n0(v)} kcal`, `target ${n0(T.kcal)}`],
    ['Protein', r=>r.t?r.t.protein:0, (v,s)=>s?n0(v):`${n0(v)} g`, 'more', r=>r.T.protein, v=>`${n0(v)} g`, `target ${n0(T.protein)} g`],
    ['Burned', r=>r.d&&((r.d.foods||[]).length||(r.d.exercises||[]).length||(r.d.sports||[]).length||Object.keys(r.d.health||{}).length)?burnedTotal(r.d).total:0, (v,s)=>s?k(v):`${n0(v)} kcal`, 'more', 0, v=>`${n0(v)} kcal`, 'training + sports + steps'],
    ['Sleep', r=>r.d&&r.d.health&&r.d.health.sleep_min?r.d.health.sleep_min/60:0, (v,s)=>s?n1(v):fmtSleep(v*60), 'more', 7, v=>fmtSleep(v*60), 'aim for 7–9 h'],
    ['Steps', r=>r.d&&r.d.health&&r.d.health.steps||0, (v,s)=>s?k(v):n0(v), 'more', goal, v=>n0(v), `goal ${n0(goal)}`],
    ['Water', r=>r.t?r.t.water/1000:0, (v,s)=>fmtL(v*1000)+(s?'':' L'), 'more', r=>waterTarget(r.d||emptyDay(r.date), r.T)/1000, v=>`${fmtL(v*1000)} L`, `target ${fmtL(T.water_ml)} L+`],
  ];
  const day = getDay(S.date), dt = dayTotals(day), DT = dayTargets(day);
  const microsHtml = `<div class="facts"><div class="dvh">% of daily target · ${esc(fmtDate(S.date,{weekday:'long',day:'numeric',month:'short'}))}</div>
      <div class="grid two" style="gap:0 24px">
      ${MICROS.map(m=>{ const v=dt.micros[m.key], tg=DT.micros[m.key]; const p=tg?v/tg*100:0; const lim=m.kind==='limit';
        const st = goalState(v, tg, lim?'limit':'more');
        return `<div class="fr"><b>${m.label}${lim?' <span class="muted small">(limit)</span>':''}${(DT.focus||[]).includes(m.key)?' <span class="tag est">blood test</span>':''}</b><span class="amt">${fmtAmt(v,m.unit)} ${m.unit}</span><span class="dv" style="color:${stText(st)}">${Math.round(p)}%</span>
          <div class="bar"><i style="width:${Math.min(100,p)}%;background:${stBar(st)}"></i></div></div>`; }).join('')}
      </div></div>
    <div class="muted small">Includes your supplements. Targets are adult daily reference intakes for your sex; values are estimates from food tables, so read them as a guide.</div>`;
  const low = MICROS.filter(m=>m.kind!=='limit'&&DT.micros[m.key]&&dt.micros[m.key]/DT.micros[m.key]<0.5).length;
  // targets reached, day by day
  const checks = [
    ['Calories', r=>r.t&&r.t.kcal ? goalState(r.t.kcal, r.T.kcal, 'range') : null],
    ['Protein', r=>r.t&&r.t.kcal ? goalState(r.t.protein, r.T.protein, 'more') : null],
    ['Carbs', r=>r.t&&r.t.kcal ? goalState(r.t.carbs, r.T.carbs, 'range') : null],
    ['Fibre', r=>r.t&&r.t.kcal ? goalState(r.t.fiber, r.T.fiber, 'more') : null],
    ['Added sugar (limit)', r=>r.t&&r.t.kcal ? goalState(r.t.sugar, r.T.sugar, 'limit') : null],
    ['Water', r=>r.t&&r.t.water ? goalState(r.t.water, waterTarget(r.d,r.T), 'more') : null],
    ['Steps', r=>r.d&&r.d.health&&r.d.health.steps ? goalState(r.d.health.steps, goal, 'more') : null],
    ['Sleep 7 h+', r=>r.d&&r.d.health&&r.d.health.sleep_min ? goalState(r.d.health.sleep_min, 420, 'more') : null],
  ];
  const ok = x => x==='at' || x==='plus';
  const hits = checks.reduce((s,[,f])=>s+rows.filter(r=>ok(f(r))).length,0), tries = checks.reduce((s,[,f])=>s+rows.filter(r=>f(r)!==null).length,0);
  const mark = x => x===null ? '<span class="muted">·</span>' : `<span class="st st-${x}">${x==='under'?'↓':x==='over'?'↑':'✓'}</span>`;
  const targetsHtml = `<div class="tablewrap" tabindex="0"><table class="hits"><thead><tr><th class="l"></th>${rows.map(r=>`<th>${esc(fmtDate(r.date,{weekday:'narrow'}))}</th>`).join('')}<th class="r">Hit</th></tr></thead><tbody>
    ${checks.map(([l,f])=>{ const res=rows.map(f); return `<tr><td class="l">${l}</td>${res.map(x=>`<td>${mark(x)}</td>`).join('')}<td class="r">${res.filter(ok).length}/${res.filter(x=>x!==null).length}</td></tr>`; }).join('')}
    </tbody></table></div><div class="muted small"><span class="st-at">✓</span> on target (within 10%) · <span class="st-plus">✓</span> over, and that’s fine · <span class="st-under">↓</span> below · <span class="st-over">↑</span> over · dot = not logged.</div>`;
  const actDays = rows.slice().reverse().filter(r=>r.d&&((r.d.sports||[]).length||(r.d.exercises||[]).length));
  const activityHtml = actDays.length ? actDays.map(r=>`<h3>${esc(fmtDate(r.date,{weekday:'long',day:'numeric',month:'short'}))}</h3>${activityPanel(r.d)}`).join('') : '<div class="empty">No gym or sport logged in these 7 days.</div>';
  const actCount = actDays.reduce((s,r)=>s+(r.d.sports||[]).length+((r.d.exercises||[]).length?1:0),0);
  const {cur,prev,label} = periodRanges(S.date, 'week'); const a = periodStats(...cur), b = periodStats(...prev);
  const sportKcal = Object.values(a.sp).reduce((s,x)=>s+x.kcal,0);
  const weights = rows.filter(r=>r.d&&r.d.weight_kg);
  const trendsW = (()=>{ const pts=trendPoints().slice(-30); if (pts.length<2) return '<div class="muted small">Log your weight a few times (type “weight 72.4”) to see your trend.</div>';
    return lineChart({pts:pts.map(x=>({date:x.date, v:x.trend, raw:x.kg, tip:`trend ${n1(x.trend)} kg`})), unit:'kg', color:'var(--water)'}) + '<div class="muted small">The line is your smoothed weight trend, which your targets use. Daily weigh-ins swing 1–2 kg with water and food.</div>'; })();
  return `<div class="grid">
    ${boardHtml()}
    <div class="panel-head"><h2>Last 7 days</h2><span class="muted small">${esc(fmtDate(rows[0].date,{day:'numeric',month:'short'}))} – ${esc(fmtDate(rows[6].date,{day:'numeric',month:'short'}))}</span></div>
    ${stateKey()}
    <div class="grid two">
    ${metrics.map(([title,get,fmt,kind,target,fmtAvg,sub])=>{ const w = weekBars(rows, get, fmt, kind, target);
      const pts = rows.map(r=>({r, v:get(r)})).filter(x=>x.v>0);
      const tg = r => typeof target==='function' ? target(r) : target;
      const score = x => kind==='range' ? -Math.abs(x.v-tg(x.r)) : x.v;
      const best = pts.length>1 ? pts.reduce((a,b)=>score(b)>score(a)?b:a) : null, worst = pts.length>1 ? pts.reduce((a,b)=>score(b)<score(a)?b:a) : null;
      const day = x => esc(fmtDate(x.r.date,{weekday:'long'}));
      return `<section class="panel wk"><div class="panel-head"><h3>${title}</h3><span class="muted small">avg ${w.avg?fmtAvg(w.avg):'—'} · ${esc(sub)}</span></div>${w.html}
        ${best&&worst&&best!==worst?`<div class="insight"><div><span class="idot" style="background:${stBar('at')}"></span><span><b>Best day</b><span class="muted small">${day(best)}</span></span><b class="num">${fmtAvg(best.v)}</b></div><div><span class="idot" style="background:${stBar('over')}"></span><span><b>${kind==='range'?'Furthest from target':'Lowest day'}</b><span class="muted small">${day(worst)}</span></span><b class="num">${fmtAvg(worst.v)}</b></div></div>`:''}</section>`; }).join('')}
    </div>
    <section class="panel folds">
      ${fold('t-micros', 'Vitamins &amp; minerals', low?`${low} low today`:'', microsHtml)}
      ${fold('t-activity', 'Activity', `${actCount} session${actCount===1?'':'s'}`, activityHtml)}
      ${fold('t-targets', 'Daily targets reached', tries?`${hits} of ${tries}`:'', targetsHtml)}
      ${fold('t-sports', 'Sports played', sportKcal?`${n0(sportKcal)} kcal this week`:'', sportSummary(a,b,label))}
      ${fold('t-weight', 'Body weight &amp; maintenance', weights.length?`${n1(weights[weights.length-1].d.weight_kg)} kg`:'', trendsW + maintenancePanel())}
    </section>
  </div>`;
}

/* ---------- Profile (coach on top, then plan, then settings) ---------- */
function recoveryItems(){
  const now=Date.now(); const act=[];
  for (let i=0;i<4;i++){ const d=S.days.get(addDays(localDate(),-i)); if(!d) continue;
    for (const a of d.sports||[]) if (a.recovery&&a.recovery.ready_at&&Date.parse(a.recovery.ready_at)>now) act.push({label:actTitle(a), date:d.date, r:a.recovery});
    if (d.gym_recovery&&d.gym_recovery.ready_at&&Date.parse(d.gym_recovery.ready_at)>now) act.push({label:'Gym: '+(d.gym_recovery.muscles||[]).join(', '), date:d.date, r:d.gym_recovery}); }
  return act;
}
function profileForm(){
  const p = prof(), T = targets();
  const opt = (obj,val) => Object.entries(obj).map(([k,v])=>`<option value="${k}" ${k===val?'selected':''}>${esc(v.label)}</option>`).join('');
  return `<form class="form profForm">
        <label class="field full">Name<input id="pf_name" name="name" type="text" maxlength="40" autocomplete="given-name" placeholder="What should the app call you?" value="${esc(p.name||'')}"></label>
        <label class="field">Sex<select id="pf_sex" name="sex"><option value="male" ${p.sex==='male'?'selected':''}>Male</option><option value="female" ${p.sex==='female'?'selected':''}>Female</option></select></label>
        <label class="field">Date of birth<input id="pf_birth" name="birth" type="date" max="${localDate()}" value="${esc(p.birth||'')}"><span class="hint">${p.birth?`Age ${ageOf(p)}`:`Using age ${esc(p.age)} until you add it`}</span></label>
        <label class="field">Height (cm)<input id="pf_height" name="height_cm" type="number" min="120" max="230" step="0.5" value="${esc(p.height_cm)}"></label>
        <label class="field">Weight (kg)<input id="pf_weight" name="weight_kg" type="number" min="30" max="250" step="0.1" value="${esc(p.weight_kg)}"><span class="hint">Trend: ${n1(who(localDate()).kg)} kg</span></label>
        <label class="field">Body fat %<input id="pf_bf" name="body_fat" type="number" min="3" max="60" step="0.1" placeholder="Optional" value="${esc(p.body_fat??'')}"><span class="hint">Only from a DEXA scan or tape measurement.</span></label>
        <label class="field">Goal<select id="pf_goal" name="goal">${opt(GOALS,p.goal)}</select></label>
        <label class="field">Rate (kg per week)<select id="pf_rate" name="goal_rate">${(p.goal==='gain'?[0.1,0.25,0.5]:[0.25,0.5,0.75,1]).map(r=>`<option value="${r}" ${Number(p.goal_rate)===r?'selected':''}>${r}</option>`).join('')}</select></label>
        <label class="field full">Daily life, not counting gym and sport<select id="pf_act" name="activity">${opt(ACTIVITY,actId(p.activity))}</select></label>
        <label class="field full">Maintenance calories<select id="pf_maint" name="maint_source"><option value="auto" ${p.maint_source!=='formula'?'selected':''}>Measured from my logs when ready (recommended)</option><option value="formula" ${p.maint_source==='formula'?'selected':''}>Always use the formula</option></select><span class="hint">${T.adaptive.ready?`Ready: your logs show you burn about ${n0(T.adaptive.tdee)} kcal a day.`:`Still learning: needs ${esc(T.adaptive.need.join(', '))}.`}</span></label>
        <label class="check full"><input type="checkbox" id="pf_eatback" ${p.eat_back!==false?'checked':''}> Add each day’s gym and sport calories to that day’s target</label>
        <div class="full row"><button class="btn" type="submit">Save</button></div>
      </form>`;
}
function goalsForm(){
  const p = prof(), T = targets(), SG = suggestedTargets();
  return `<form class="form profForm">
        <div class="full muted small">Leave a box empty to use the suggested goal.</div>
        ${[['pf_kcal','calorie_override','Calories','kcal',SG.kcal,1000,6000,10],['pf_prot','protein_override','Protein','g',SG.protein,30,400,1],['pf_carbs','carbs_override','Carbs','g',SG.carbs,0,900,1],['pf_fat','fat_override','Fat','g',SG.fat,20,300,1],['pf_fibre','fiber_override','Fibre','g',SG.fiber,10,120,1],['pf_water','water_override_ml','Water','ml',SG.water_ml,1000,8000,250]].map(([id,key,label,unit,sug,mn,mx,st])=>`
          <label class="field">${label} (${unit})<input id="${id}" name="${key}" type="number" min="${mn}" max="${mx}" step="${st}" placeholder="Suggested ${n0(sug)}" value="${esc(p[key]??'')}">
          <span class="hint">${p[key]?`Yours · suggested ${n0(sug)} <button type="button" class="linkbtn" data-action="resetGoal" data-key="${key}" style="padding:0 2px">Use suggested</button>`:`Suggested ${n0(sug)} ${unit}`}</span></label>`).join('')}
        <label class="field">Daily steps goal<input id="pf_steps" name="steps_goal" type="number" min="1000" max="50000" step="500" value="${esc(p.steps_goal??10000)}"></label>
        ${T.fat < Math.round(0.6*(Number(p.weight_kg)||70)) ? `<div class="full banner">With these goals fat drops to ${n0(T.fat)} g, below the ${n0(0.6*(Number(p.weight_kg)||70))} g your body needs. Lower carbs or protein a little, or set fat yourself.</div>` : ''}
        ${(()=>{ const mk=T.protein*4+T.carbs*4+T.fat*9; return Math.abs(mk-T.kcal)>60 ? `<div class="full banner">Your protein, carbs and fat add up to ${n0(mk)} kcal, but your calorie goal is ${n0(T.kcal)} kcal. Adjust one so they match.</div>` : ''; })()}
        <div class="full row"><button class="btn" type="submit">Save goals</button></div>
      </form>
      <div class="kv">
        <span>Resting burn (${esc(T.bmrMethod)})</span><b>${n0(T.bmr)} kcal</b>
        <span>Maintenance used</span><b>${n0(T.maint)} kcal <span class="tag">${T.maintSource}</span></b>
        <span>Goal</span><b>${T.goalDelta>0?'+':T.goalDelta<0?'−':''}${n0(Math.abs(T.goalDelta))} kcal</b>
        <span>Fibre${p.fiber_override?' <span class="tag">yours</span>':''}</span><b>${n0(T.fiber)} g</b><span>Added sugar, up to</span><b>${n0(T.sugar)} g</b>
      </div>
      <div class="muted small">Protein is ${GOALS[p.goal]?.ppk||1.6} g per kg${T.refKg<T.weight-0.5?` of ${n1(T.refKg)} kg (your weight at BMI 25)`:' of body weight'}. Fat is 25% of calories, carbs fill the rest. ${p.goal==='lose'?`Losing ${p.goal_rate} kg a week takes about ${n0(p.goal_rate*7700/7)} kcal a day under maintenance.`:p.goal==='gain'?`Gaining ${p.goal_rate} kg a week takes about ${n0(p.goal_rate*7700/7)} kcal a day over maintenance.`:''} ${T.floored?`Capped at ${n0(T.floor)} kcal for safety; pick a slower rate.`:''}</div>`;
}
const microSummary = m => MICROS.filter(x => (m||{})[x.key] > 0).slice(0,4).map(x => `${x.label} ${fmtDose((m||{})[x.key])} ${x.unit}`).join(' · ');
const fmtDose = v => v >= 100 ? n0(v) : v >= 10 ? n1(v) : String(Math.round(v*100)/100);
function supplementsFold(){
  const p = prof(), today = getDay(localDate()), st = p.stack||[];
  return `${st.length ? `<div>${st.map(x=>`<div class="item"><div><div class="nm">${esc(x.name)}</div><div class="sub">${esc([x.dose, freqText(x.freq)].filter(Boolean).join(' · '))}</div><div class="sub">${esc(microSummary(x.micros)) || 'no vitamins or minerals counted'}</div></div><span></span><div class="acts"><button data-action="editSupp" data-id="${x.id}" aria-label="Edit ${esc(x.name)}">Edit</button><button data-action="rmStack" data-id="${x.id}" aria-label="Remove ${esc(x.name)}">✕</button></div></div>`).join('')}</div>` : '<div class="muted small">Add the vitamins and supplements you take and how often. They’re added to your log on the right days, and their vitamins and minerals count toward your daily totals.</div>'}
    <div class="row"><button class="btn sm" data-action="editSupp" data-id="">+ Add supplement</button></div>
    ${st.length ? `<label class="check small"><input type="checkbox" data-action="stackAuto" ${p.stack_auto!==false?'checked':''}> Add them to my log automatically on the days they’re due</label>
      <h3>Today</h3>${supplementsPanel(today)}` : ''}`;
}
/* Nutrients from the name and dose, no AI: "Vitamin D3 60,000 IU", "Zinc 50 mg",
   "Fish oil 1000 mg" with "2 capsules". Amounts are per unit; a count in the dose multiplies them. */
const SUPP_NUT = [
  ['vitamin_d_mcg', /(?:vit(?:amin)?\.?\s*)?d3?\b|cholecalciferol/, {iu:1/40, mcg:1, mg:1000}],
  ['vitamin_b12_mcg', /b\s?12|cobalamin|methylcobalamin/, {mcg:1, mg:1000}],
  ['vitamin_c_mg', /vit(?:amin)?\.?\s*c\b|ascorbic/, {mg:1, g:1000}],
  ['vitamin_a_mcg', /vit(?:amin)?\.?\s*a\b|retinol/, {iu:0.3, mcg:1}],
  ['folate_mcg', /fol(?:ic acid|ate)|b9\b/, {mcg:1, mg:1000}],
  ['zinc_mg', /zinc/, {mg:1}], ['iron_mg', /iron|ferrous/, {mg:1}], ['magnesium_mg', /magnesium/, {mg:1, g:1000}],
  ['calcium_mg', /calcium/, {mg:1, g:1000}], ['potassium_mg', /potassium/, {mg:1, g:1000}],
  ['omega3_g', /omega\s?-?3|epa|dha/, {mg:0.001, g:1}],
];
function suppMicrosFromText(name, dose){
  const t = `${name} ${dose}`.toLowerCase().replace(/(\d),(\d{3})/g,'$1$2').replace(/µg|ug/g,'mcg');
  const out = {};
  for (const [key, kw, units] of SUPP_NUT) {
    const m = t.match(new RegExp(`(?:${kw.source})[^0-9]{0,25}(\\d+(?:\\.\\d+)?)\\s*(iu|mcg|mg|g)\\b`)) || t.match(new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(iu|mcg|mg|g)\\s*(?:of\\s*)?(?:${kw.source})`));
    if (m && units[m[2]] != null) out[key] = +m[1] * units[m[2]];
  }
  // EPA and DHA listed separately: omega-3 is their sum.
  const epa = t.match(/epa[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(mg|g)\b/), dha = t.match(/dha[^0-9]{0,10}(\d+(?:\.\d+)?)\s*(mg|g)\b/);
  if (epa || dha) out.omega3_g = [epa, dha].reduce((a, m) => a + (m ? +m[1] * (m[2]==='mg' ? 0.001 : 1) : 0), 0);
  // Fish oil without EPA/DHA amounts: about 0.3 g omega-3 per 1 g of oil.
  if (!out.omega3_g && /fish oil|cod liver/.test(t)) { const m = t.match(/(\d+(?:\.\d+)?)\s*(mg|g)\b/); out.omega3_g = m ? (+m[1] * (m[2]==='mg'?0.001:1)) * 0.3 : 0.3; }
  const c = String(dose||'').toLowerCase().match(/(\d+(?:\.\d+)?)\s*(caps?|capsules?|tabs?|tablets?|softgels?|pills?|gummies|drops?|sachets?)\b/);
  if (c && !new RegExp('\\d\\s*(iu|mcg|mg|g)\\b').test(String(dose||'').toLowerCase())) for (const k in out) out[k] *= +c[1];
  for (const k in out) out[k] = Math.round(out[k]*1000)/1000;
  return out;
}
function suppPrompt(name, dose, fromPhoto){
  return `${fromPhoto ? 'This photo shows the label of a vitamin or supplement product. Read the amount per serving from the label' : `Look up the nutrients in one dose of this supplement using standard product information: "${name}"${dose?`, dose "${dose}"`:''}`}.
Reply with ONLY this JSON (amounts for ONE dose as taken${dose?` ("${dose}")`:''}, 0 for anything not in it):
{"name":"product name","dose":"e.g. 1 capsule","per_serving":"what one serving is",${MICROS.map(m=>`"${m.key}":0`).join(',')},"note":"one short sentence, e.g. what else it contains"}
Convert units: vitamin D 1 mcg = 40 IU; vitamin A IU × 0.3 = mcg RAE; omega-3 is EPA + DHA (+ ALA) in grams.`;
}
function openSuppEdit(id, preset){
  const p = prof(); const saved = (p.stack||[]).find(x=>x.id===(preset?.id||id)); const isNew = !saved;
  const cur = preset || saved || {id:uid(), name:'', dose:'', micros:{}, freq:{type:'daily'}}; if (!cur) return;
  const f = cur.freq || {type:'daily'}; const d = $('#dlg');
  d.innerHTML = `<form class="form supform" id="suForm" style="gap:12px"><h2 class="full">${isNew?'Add a supplement':'Edit supplement'}</h2>
    <label class="field full">Name<input id="su_name" value="${esc(cur.name)}" placeholder="e.g. Vitamin D3 60,000 IU" required></label>
    <label class="field full">Dose<input id="su_dose" value="${esc(cur.dose)}" placeholder="e.g. 1 capsule, 5 g, 2 softgels"></label>
    <label class="field full">How often<select id="su_ft"><option value="daily" ${f.type==='daily'?'selected':''}>Every day</option><option value="days" ${f.type==='days'?'selected':''}>On certain days of the week</option><option value="every" ${f.type==='every'?'selected':''}>Every few days</option></select></label>
    <div class="full wdays" id="su_days" ${f.type==='days'?'':'hidden'}>${WD.map((w,i)=>`<label class="wd"><input type="checkbox" value="${i}" ${(f.days||[]).includes(i)?'checked':''}><span>${w}</span></label>`).join('')}</div>
    <div class="full row" id="su_every" ${f.type==='every'?'':'hidden'}><label class="field">Every<input id="su_n" type="number" min="2" max="60" step="1" value="${f.n||7}"></label><label class="field">starting<input id="su_start" type="date" value="${esc(f.start||localDate())}"></label></div>
    <h3 class="full">Vitamins and minerals in one dose</h3>
    <div class="full row">${S.sample?'<button type="button" class="btn ghost sm" id="su_ai">Look it up</button><button type="button" class="btn ghost sm" id="su_photo">Label photo</button>':''}<button type="button" class="btn ghost sm" id="su_scan">Scan barcode</button></div>
    <div class="full muted small" id="su_msg">Filled in from the name and dose where possible. “Look it up” and “Label photo” use AI (1 use each).</div>
    <div class="full micgrid">${MICROS.filter(m=>!['sodium_mg','cholesterol_mg','sat_fat_g'].includes(m.key)).map(m=>`<label class="field">${esc(m.label)} (${m.unit})<input data-mk="${m.key}" type="number" min="0" step="any" inputmode="decimal" value="${(cur.micros||{})[m.key]>0?fmtDose(cur.micros[m.key]).replace(/,/g,''):''}"></label>`).join('')}</div>
    <div class="full row">${isNew?'':'<button class="btn ghost sm" type="button" id="su_del">Remove</button>'}<span class="spacer"></span><button class="btn ghost" type="button" id="su_cancel">Cancel</button><button class="btn" type="submit">Save</button></div></form>`;
  d.showModal();
  const msg = t => { $('#su_msg').textContent = t; };
  const setMicros = (m, overwrite) => { for (const el of d.querySelectorAll('[data-mk]')) { const v = Number(m[el.dataset.mk]); if (v>0 && (overwrite || !el.value)) el.value = fmtDose(v).replace(/,/g,''); else if (overwrite && !(v>0)) el.value=''; } };
  const auto = () => { if ((!isNew || preset) && Object.keys(cur.micros||{}).length) return; const m = suppMicrosFromText($('#su_name').value, $('#su_dose').value); if (Object.keys(m).length) { setMicros(m, true); msg('Filled in from the name and dose. Check the numbers against the label.'); } };
  $('#su_name').addEventListener('change', auto); $('#su_dose').addEventListener('change', auto);
  $('#su_ft').onchange = () => { const v = $('#su_ft').value; $('#su_days').hidden = v!=='days'; $('#su_every').hidden = v!=='every'; };
  const fromAi = async (res, how) => {
    const m = {}; for (const x of MICROS) { const v = num(res?.[x.key], 100000); if (v>0) m[x.key] = v; }
    if (!$('#su_name').value && res?.name) $('#su_name').value = String(res.name).slice(0,60);
    if (!$('#su_dose').value && res?.dose) $('#su_dose').value = String(res.dose).slice(0,40);
    setMicros(m, true); msg(`${how}${res?.note ? ': ' + String(res.note).slice(0,160) : ''}. Check the numbers against the label.`);
  };
  if (S.sample) {
    $('#su_ai').onclick = async () => { const n = $('#su_name').value.trim(); if (!n) { msg('Type the product name first.'); return; }
      msg('Looking it up…'); try { await fromAi(await S.sample.json(suppPrompt(n, $('#su_dose').value.trim(), false), {task:'log'}), 'Looked up by name'); } catch (e) { msg(AI_ERR[e?.code] || AI_ERR.unavailable); } };
    $('#su_photo').onclick = () => { const inp = document.createElement('input'); inp.type='file'; inp.accept='image/*'; inp.setAttribute('capture','environment');
      inp.onchange = async () => { const file = inp.files?.[0]; if (!file) return; msg('Reading the label…');
        try { await fromAi(await S.sample.json(suppPrompt($('#su_name').value.trim(), $('#su_dose').value.trim(), true), {task:'log', images:[await toJpeg(file)]}), 'Read from the label photo'); } catch (e) { msg(AI_ERR[e?.code] || 'Couldn’t read that photo. Try a sharper photo of the nutrition panel.'); } };
      inp.click(); };
  }
  const collect = () => {
    const ft = $('#su_ft').value; const freq = ft==='days' ? {type:'days', days:[...d.querySelectorAll('#su_days input:checked')].map(x=>+x.value)} : ft==='every' ? {type:'every', n:Math.max(2, Math.round(num($('#su_n').value,60))||7), start:$('#su_start').value||localDate()} : {type:'daily'};
    const micros = {}; for (const el of d.querySelectorAll('[data-mk]')) { const v = num(el.value, 100000); if (v>0) micros[el.dataset.mk] = v; }
    return {...cur, name:titleCase($('#su_name').value).slice(0,60), dose:$('#su_dose').value.trim().slice(0,40), freq, micros};
  };
  $('#su_scan').onclick = () => { const keep = collect(); openScanner(code => suppFromBarcode(code, keep)); };
  $('#su_cancel').onclick = () => d.close();
  if (!isNew) $('#su_del').onclick = () => { d.close(); const pp = prof(); saveProfile({...pp, stack:pp.stack.filter(x=>x.id!==cur.id)}); toast(`Removed ${cur.name}`, () => saveProfile({...prof(), stack:[...(prof().stack||[]), cur]})); };
  $('#suForm').onsubmit = ev => { ev.preventDefault(); const x = collect(); if (!x.name) return;
    if (x.freq.type==='days' && !x.freq.days.length) { msg('Pick at least one day of the week.'); return; }
    const pp = prof(); const list = pp.stack||[]; x.since = x.since || localDate();
    saveProfile({...pp, stack: isNew ? [...list, x] : list.map(y=>y.id===x.id?x:y)});
    // Keep today's log in step: add it if it's due and not there yet, update the values if it is.
    writeDay(localDate(), dd => { dd.supplements = dd.supplements||[]; const i = dd.supplements.findIndex(y=>y.stack_id===x.id);
      if (i>=0) dd.supplements[i] = {...dd.supplements[i], name:x.name, dose:x.dose, micros:{...x.micros}};
      else if (isNew && suppDue(x, localDate()) && pp.stack_auto!==false) dd.supplements.push({id:uid(), name:x.name, dose:x.dose, micros:{...x.micros}, stack_id:x.id, time:nowTime(), auto:true}); });
    d.close(); toast(`${isNew?'Added':'Saved'} ${x.name} · ${freqText(x.freq).toLowerCase()}`);
  };
  if (isNew) setTimeout(()=>$('#su_name')?.focus(), 50);
}
// Supplement from a barcode: Open Food Facts, per serving where the label gives it.
async function suppFromBarcode(code, keep){
  const d = $('#dlg'); if (!d.open) d.showModal();
  d.innerHTML = `<div class="scan"><h2>Looking up ${esc(code)}…</h2><div class="muted small">Asking Open Food Facts.</div></div>`;
  let p = null;
  try { const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=product_name,product_name_en,brands,nutriments,serving_size`); const j = await r.json().catch(()=>null); if (j && j.status===1) p = j.product; } catch {}
  const n = p?.nutriments || {}; const per = k => { const v = Number(n[k+'_serving'] ?? n[k+'_100g']); return Number.isFinite(v) && v>0 ? v : 0; };
  const m = {vitamin_d_mcg:per('vitamin-d')*1e6, vitamin_b12_mcg:per('vitamin-b12')*1e6, vitamin_c_mg:per('vitamin-c')*1000, vitamin_a_mcg:per('vitamin-a')*1e6, folate_mcg:per('folates')*1e6,
    zinc_mg:per('zinc')*1000, iron_mg:per('iron')*1000, magnesium_mg:per('magnesium')*1000, calcium_mg:per('calcium')*1000, potassium_mg:per('potassium')*1000, omega3_g:per('omega-3-fat')};
  for (const k in m) if (!(m[k]>0)) delete m[k];
  const name = [p?.product_name_en || p?.product_name, (p?.brands||'').split(',')[0]].filter(Boolean).join(' · ');
  // Back to the form with what was found; nothing is saved until Save.
  openSuppEdit(null, {...keep, name: keep.name || titleCase(name).slice(0,60), dose: keep.dose || String(p?.serving_size||'').slice(0,40), micros: Object.keys(m).length ? m : keep.micros});
  $('#su_msg').textContent = !p ? `Barcode ${code} isn’t on Open Food Facts. Try Look it up or Label photo instead.` : Object.keys(m).length ? `Found on Open Food Facts${name?`: ${name}`:''} (ODbL). Check the numbers against the label.` : `Found ${name||'the product'} on Open Food Facts, but without vitamin and mineral values. Try Label photo.`;
}
function connectFold(){
  const p = prof();
  return `${healthSyncHtml()}
    <label class="check"><input type="checkbox" data-action="watchToggle" ${p.watch_workouts?'checked':''}> My watch records my gym and sport sessions (so they’re already in its active calories)</label>
    <ul class="tips">
      <li><b>Android, Fitbit, Samsung and others:</b> type your day into the log box, like “slept 7h 10m, 9200 steps, active 520 kcal”, or add a screenshot of the watch app’s daily summary with Add photo. The AI reads it.</li>
    </ul>
    <div class="muted small">Apple and Garmin don’t let websites read your data directly, which is why the iPhone Shortcut does the sending.</div>`;
}
function dataFold(){
  return `<div class="row"><button class="btn sm" data-action="exportExcel" ${S.xlsBusy?'disabled':''}>${S.xlsBusy?'Preparing…':'Download all my data (Excel)'}</button></div>
    <div class="muted small">One spreadsheet with a sheet each for daily totals, food, gym sets, sport, supplements and blood tests.</div>
    <div class="row"><button class="btn ghost sm" data-action="exportData">Download backup (JSON)</button><button class="btn ghost sm" data-action="importData">Restore from backup</button></div>
    <div class="muted small">The backup file can be restored into this app later. Restoring also accepts a Fuel &amp; Lift backup or an export from the claude.ai version.</div>`;
}
function securityFold(){
  return `<div class="muted small">Signed in as ${esc(S.user?.email||'')}. Set or change the password you use to sign in (including on the home-screen app).</div>
    <div class="row"><input id="newPass" type="password" autocomplete="new-password" placeholder="New password (8+ characters)" class="inp" style="flex:1;min-width:0"><button class="btn ghost sm" data-action="setPassword">Set password</button></div>
    <div class="row"><button class="btn ghost sm" data-action="signOut">Sign out on this device</button></div>`;
}
function accountFold(){
  const u = S.usage;
  return `<div class="kv"><span>Email</span><b>${esc(S.user?.email||'')}</b>
      <span>AI</span><b>${!S.sample?'Off in config.js':S.aiHealth==='ok'?'Connected':S.aiHealth?`<span style="color:var(--bad)">${esc(S.aiHealth==='unavailable'?'Can’t reach the AI service':AI_ERR[S.aiHealth]||S.aiHealth)}</span>`:'Checking…'}</b>
      <span>AI uses today</span><b>${u?`${u.count} of ${u.cap}`:'—'}</b>
      <span>Sync</span><b>${{synced:'Up to date',saving:'Saving…',offline:'Offline',error:'Retrying'}[S.sync]||'—'}${S.db&&S.db.pendingCount()?` · ${S.db.pendingCount()} waiting`:''}</b></div>
    <div class="row"><button class="btn ghost sm" data-action="refreshUsage">Check again</button></div>`;
}
function foodListHtml(){
  const list=Object.entries(S.myFoods||{}).sort((a,b)=>(b[1].updated||0)-(a[1].updated||0));
  return `${S.indbBuiltIn ? '' : `<div class="row"><button class="btn ghost sm" data-action="importIndb" ${S.libBusy?'disabled':''}>${(S.libFoods||[]).length?'Re-import INDB.xlsx':'Import 1,014 Indian recipes (INDB.xlsx)'}</button><span class="status${/isn|failed|Couldn|declined|Only|empty|Reconnect/.test(S.libStatus||'')?' err':''}">${esc(S.libStatus||'')}</span></div>`}
    <div class="muted small">${FOODS.length} foods built in${(S.libFoods||[]).length?`, ${n0((S.libFoods||[]).length)} Indian recipes from INDB`:''}, about 7,200 USDA foods to search, plus ${list.length} learned from your logs, and ${n0(libCount())} gym exercises. These log instantly without AI.</div>
    ${list.length?`<div>${list.slice(0,40).map(([k,f])=>`<div class="item"><div><div class="nm">${esc(f.name)}${f.verified?' <span class="tag">corrected</span>':''}</div><div class="sub">${n0(f.per.kcal)} kcal · P ${n1(f.per.protein)} · C ${n1(f.per.carbs)} · F ${n1(f.per.fat)} per 100 g</div></div><span></span><div class="acts"><button data-action="rmFood" data-key="${esc(k)}" aria-label="Remove ${esc(f.name)}">✕</button></div></div>`).join('')}</div>`:''}`;
}
function viewProfile(){
  const p = prof(), T = targets();
  const t=dayTotals(getDay(localDate())), TT=dayTargets(getDay(localDate()));
  const rec = recoveryItems(); const reps = S.reports||[]; const rv = (S.reviews||[])[0];
  const plan = (S.plans||[]).find(x=>x.date>=localDate());
  return `<div class="grid">
    <div class="panel-head"><h2>Coach</h2></div>
    <section class="panel"><div class="panel-head"><h3>What to train or play</h3>${plan?`<span class="muted small">${esc(plan.date===localDate()?'Today':fmtDate(plan.date,{weekday:'long'}))}</span>`:''}</div>
      ${plan ? `<div class="plan-h"><b>${esc(plan.focus)}</b><span class="pill ${plan.readiness==='good'?'good':plan.readiness==='low'?'bad':'warn'}">readiness ${esc(plan.readiness)}</span></div><div class="small">${esc(plan.why)}</div>`
        : '<div class="muted small">Plans your next gym session or sport day from what you did this week, your recovery and your recent weights.</div>'}
      <div class="row"><button class="btn sm" data-action="goto" data-view="gym">${plan?'See the full session':'Plan my next session'}</button></div>
    </section>
    <section class="panel"><div class="panel-head"><h3>Recovery</h3><span class="muted small">${rec.length?`${rec.length} still recovering`:'fresh'}</span></div>
      ${rec.length ? rec.map(x=>`<div class="act"><div class="nm">${esc(x.label)} <span class="muted small">${esc(fmtDate(x.date,{weekday:'short'}))}</span></div>${recoveryHtml(x.r)}</div>`).join('')
        : '<div class="small">Nothing is still recovering from the last few days, so you’re clear for a hard session.</div>'}
    </section>
    <h2 class="sect">My plan</h2>
    <section class="panel folds">
      ${fold('p-goals', 'Daily goals', `${n0(T.kcal)} kcal · ${n0(T.protein)} g protein`, goalsForm())}
      ${fold('p-blood', 'Blood tests', reps.length?`${reps.length} report${reps.length===1?'':'s'}`:'add a report', viewHealth())}
      ${fold('p-supps', 'Vitamins &amp; supplements', (p.stack||[]).length?`${p.stack.length} supplement${p.stack.length===1?'':'s'}${p.stack_auto!==false?' · auto-added':''}`:'add yours', supplementsFold())}
    </section>
    <h2 class="sect">Settings</h2>
    <section class="panel folds">
      ${fold('s-review', 'Coach review', rv?`last ${esc(fmtDate(rv.date,{day:'numeric',month:'short'}))}`:'weekly check-in', reviewPanel())}
      ${fold('s-profile', 'My details', `${esc(p.sex)} · ${n1(who(localDate()).kg)} kg · ${esc((GOALS[p.goal]||{}).label||'')}`, profileForm())}
      ${fold('s-data', 'Download my data', 'Excel', dataFold())}
      ${fold('s-connect', 'Watch &amp; health apps', p.watch_workouts?'watch on':'', connectFold())}
      ${fold('s-workout', 'Workout', restOn()?`rest timer ${Number(p.rest_default||90)} s`:'rest timer off', workoutFold())}
      ${fold('s-sources', 'Data sources', 'free &amp; open', sourcesHtml())}
      ${S.isAdmin ? fold('s-people', 'People &amp; approvals', (()=>{ const n=(S.members||[]).filter(x=>x.status==='pending').length; return n?`${n} waiting`:`${(S.members||[]).filter(x=>x.status==='approved').length} approved`; })(), peopleFold()) : ''}
      ${fold('s-sports', 'Sports &amp; food list', `${Object.keys(p.sports||{}).length} sport${Object.keys(p.sports||{}).length===1?'':'s'}`, `<h3>Sports you play</h3>${sportsProfileHtml()}<h3>Your food list</h3>${foodListHtml()}`)}
    </section>
  </div>`;
}

/* ---------- daily supplements, added automatically ---------- */
function autoStack(){
  const p = prof(), today = localDate();
  if (!S.dbReady || S.stackAutoDate===today || p.stack_auto===false || !(p.stack||[]).length) return;
  S.stackAutoDate = today;
  // When did each item start? Its "since" date, or the first day it appears in the log.
  const firstSeen = st => { let d=null; for (const [k,day] of S.days) if ((day.supplements||[]).some(x=>x.stack_id===st.id || exKey(x.name)===exKey(st.name)) && (!d || k<d)) d=k; return d; };
  const since = {}; for (const st of p.stack) since[st.id] = st.since || firstSeen(st) || today;
  const earliest = Object.values(since).sort()[0], limit = addDays(today, -60);
  for (let d = earliest < limit ? limit : earliest; d <= today; d = addDays(d, 1)) {
    const day = S.days.get(d); if (day && day.stack_auto) continue; // already filled (and anything unticked stays unticked)
    const due = p.stack.filter(st => since[st.id] <= d && suppDue(st, d) && !((day && day.supplements) || []).some(x=>x.stack_id===st.id));
    if (!due.length) continue;
    writeDay(d, dd => { dd.supplements = dd.supplements||[]; dd.stack_auto = true;
      for (const st of due) if (!dd.supplements.some(x=>x.stack_id===st.id)) dd.supplements.push({id:uid(), name:st.name, dose:st.dose, micros:{...st.micros}, stack_id:st.id, time:nowTime(), auto:true}); });
  }
  if (p.stack.some(st=>!st.since)) saveProfile({...p, stack:p.stack.map(st=>({...st, since: st.since || since[st.id]}))});
}

/* ---------- Pinned libraries, loaded on demand ----------
   Each is checked against its hash (subresource integrity), so a tampered
   CDN copy is refused instead of run. */
const LIBS = {
  xlsx: { src:'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js', integrity:'sha384-vtjasyidUo0kW94K5MXDXntzOJpQgBKXmE7e2Ga4LG0skTTLeBi97eFAXsqewJjw' },
  webauthn: { src:'https://cdn.jsdelivr.net/npm/@simplewebauthn/browser@14.0.0/dist/bundle/index.umd.min.js', integrity:'sha384-06g944bCm8L/wG3i0Q8PdB8jccE4GdpHdNCa1tJY8eMqoP3GIHGJdL6B5lD5OMGD' },
};
function loadScript({ src, integrity }){
  return new Promise((res, rej) => {
    const el = document.createElement('script'); el.src = src; el.integrity = integrity; el.crossOrigin = 'anonymous';
    el.onload = res; el.onerror = () => { el.remove(); rej(new Error('load failed')); }; document.head.appendChild(el);
  });
}
/* ---------- Excel export ---------- */
async function loadXlsx(){
  if (window.XLSX) return;
  await loadScript(LIBS.xlsx).catch(()=>{ throw {msg:'Couldn’t load the spreadsheet tool. Check your connection and try again.'}; });
}
async function exportExcel(){
  S.xlsBusy=true; render();
  try {
    await loadXlsx();
    const days = [...S.days.values()].sort((a,b)=>a.date.localeCompare(b.date));
    const r1 = v => Math.round((Number(v)||0)*10)/10;
    const summary=[], food=[], gym=[], sport=[], supps=[], blood=[];
    for (const d of days) {
      const t=dayTotals(d), T=dayTargets(d), H=d.health||{};
      summary.push({Date:d.date, 'Calories eaten':Math.round(t.kcal), 'Calorie target':Math.round(T.kcal), 'Protein (g)':r1(t.protein), 'Carbs (g)':r1(t.carbs), 'Fat (g)':r1(t.fat), 'Fibre (g)':r1(t.fiber), 'Added sugar (g)':r1(t.sugar),
        'Water (L)':r1(t.water/1000), 'Burned (kcal)':Math.round(burnedTotal(d).total), 'Training (kcal)':Math.round(t.burned||0), Steps:H.steps||'', 'Sleep (h)':H.sleep_min?r1(H.sleep_min/60):'', 'Weight (kg)':d.weight_kg||''});
      for (const f of d.foods||[]) food.push({Date:d.date, Meal:f.meal, Time:f.time||'', Food:f.name, Quantity:f.quantity||'', Grams:Math.round(f.grams||0), kcal:Math.round(f.kcal||0), 'Protein (g)':r1(f.protein), 'Carbs (g)':r1(f.carbs), 'Fat (g)':r1(f.fat), 'Fibre (g)':r1(f.fiber), 'Sugar (g)':r1(f.sugar), 'Added sugar (g)':r1(addedSugar(f))});
      for (const e of d.exercises||[]) { const sets=e.sets||[]; if (!sets.length) gym.push({Date:d.date, Exercise:e.name, 'Muscle group':e.muscle_group||'', Set:'', 'Weight (kg)':'', Reps:'', Minutes:e.duration_min||'', kcal:Math.round(e.kcal||0)});
        sets.forEach((s,i)=>gym.push({Date:d.date, Exercise:e.name, 'Muscle group':e.muscle_group||'', Set:i+1, 'Weight (kg)':s.weight||0, Reps:s.reps||0, Minutes:'', kcal:i===0?Math.round(e.kcal||0):''})); }
      for (const a of d.sports||[]) sport.push({Date:d.date, Activity:actTitle(a), Details:actLine(a), Minutes:Math.round(a.minutes||0), 'Effort (1-10)':a.rpe||'', kcal:Math.round(a.kcal||0)});
      for (const s of d.supplements||[]) supps.push({Date:d.date, Supplement:s.name, Dose:s.dose||''});
    }
    for (const r of S.reports||[]) for (const m of r.markers||[]) blood.push({'Report date':r.report_date, Lab:r.lab||'', Test:m.name, Value:m.value??m.value_text??'', Unit:m.unit||'', Range:m.ref||'', Status:m.status||''});
    const wb = XLSX.utils.book_new();
    for (const [name, rows] of [['Daily',summary],['Food',food],['Gym',gym],['Sport',sport],['Supplements',supps],['Blood tests',blood]])
      XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length?rows:[{Note:'Nothing logged yet'}]), name);
    XLSX.writeFile(wb, `maxxtempo-${localDate()}.xlsx`);
  } catch(e) { toast(e?.msg || 'Couldn’t build the spreadsheet. Try again.'); }
  finally { S.xlsBusy=false; render(); }
}

/* ---------- dialogs ---------- */
function openFoodEdit(id){
  const f = getDay(S.date).foods.find(x=>x.id===id); if (!f) return;
  const d=$('#dlg');
  d.innerHTML = `<form method="dialog" id="editForm" class="form" style="gap:12px">
    <h2 class="full">Edit food</h2>
    <label class="field full">Name<input id="ef_name" value="${esc(f.name)}"></label>
    <label class="field">Grams<input id="ef_grams" type="number" min="0" step="1" value="${esc(Math.round(f.grams||0))}"></label>
    <label class="field">Meal<select id="ef_meal">${MEALS.map(m=>`<option ${m===f.meal?'selected':''}>${m}</option>`).join('')}</select></label>
    <label class="check full"><input type="checkbox" id="ef_scale" checked> Scale every nutrient to the new grams</label>
    <label class="field">kcal<input id="ef_kcal" type="number" min="0" value="${esc(Math.round(f.kcal))}"></label>
    <label class="field">Protein (g)<input id="ef_p" type="number" min="0" step="0.1" value="${esc(n1(f.protein).replace(/,/g,''))}"></label>
    <label class="field">Carbs (g)<input id="ef_c" type="number" min="0" step="0.1" value="${esc(n1(f.carbs).replace(/,/g,''))}"></label>
    <label class="field">Fat (g)<input id="ef_f" type="number" min="0" step="0.1" value="${esc(n1(f.fat).replace(/,/g,''))}"></label>
    <div class="full muted small">With scaling on, changing grams recalculates everything. Turn it off to type exact numbers from a label.</div>
    <div class="full row"><span class="spacer"></span><button class="btn ghost" value="cancel" type="button" id="ef_cancel">Cancel</button><button class="btn" type="submit">Save</button></div></form>`;
  d.showModal();
  $('#ef_cancel').onclick = () => d.close();
  $('#editForm').onsubmit = (ev) => { ev.preventDefault();
    const g = num($('#ef_grams').value,5000), scale = $('#ef_scale').checked;
    writeDay(S.date, day => { const x = day.foods.find(y=>y.id===id); if (!x) return;
      x.name = $('#ef_name').value.trim()||x.name; x.meal = $('#ef_meal').value;
      if (scale && x.grams>0 && g>0 && g!==x.grams) { const k=g/x.grams;
        x.added_sugar = addedSugar(x)*k; ['kcal','protein','carbs','fat','fiber','sugar'].forEach(key=>x[key]=(x[key]||0)*k);
        for (const m of MICROS) x.micros[m.key]=(x.micros[m.key]||0)*k;
        x.quantity = `${Math.round(g)} g`;
      } else { x.kcal=num($('#ef_kcal').value,5000); x.protein=num($('#ef_p').value,500); x.carbs=num($('#ef_c').value,1000); x.fat=num($('#ef_f').value,500); if (g!==x.grams && g>0) x.quantity=`${Math.round(g)} g`; }
      x.grams = g || x.grams; x.confidence='high'; delete x.check; }).then(() => { const x2=getDay(S.date).foods.find(y=>y.id===id); if (x2) saveMyFood({...x2, verified:true}); });
    d.close(); };
}
function openExEdit(id){
  const e = getDay(S.date).exercises.find(x=>x.id===id); if (!e) return;
  const d=$('#dlg');
  const setsTxt = (e.sets||[]).map(s=>s.weight>0?`${s.weight}x${s.reps}`:`${s.reps}`).join(', ');
  d.innerHTML = `<form id="editForm" class="form" style="gap:12px">
    <h2 class="full">Edit exercise</h2>
    <label class="field full">Name<input id="ee_name" value="${esc(e.name)}"></label>
    <label class="field full">Sets<input id="ee_sets" value="${esc(setsTxt)}"><span class="hint">weight x reps, separated by commas: 60x8, 60x8, 65x6. Reps only for bodyweight: 12, 10, 8</span></label>
    <label class="field">Muscle group<select id="ee_group">${MUSCLES.map(m=>`<option ${m===e.muscle_group?'selected':''}>${m}</option>`).join('')}</select></label>
    <label class="field">Minutes<input id="ee_min" type="number" min="0" placeholder="auto" value="${esc(e.duration_min||'')}"></label>
    <div class="full status err" id="ee_err"></div>
    <div class="full row"><span class="spacer"></span><button class="btn ghost" type="button" id="ee_cancel">Cancel</button><button class="btn" type="submit">Save</button></div></form>`;
  d.showModal();
  $('#ee_cancel').onclick = () => d.close();
  $('#editForm').onsubmit = (ev) => { ev.preventDefault();
    const sets=[]; const txt=$('#ee_sets').value.toLowerCase().replace(/kg/g,'').replace(/×/g,'x');
    for (const part of txt.split(/[,;]+/)) { const s=part.trim(); if(!s) continue; let m;
      if ((m=s.match(/^(\d+(?:\.\d+)?)\s*x\s*(\d+)$/))) sets.push({weight:+m[1],reps:+m[2]});
      else if ((m=s.match(/^(\d+)$/))) sets.push({weight:0,reps:+m[1]});
      else { $('#ee_err').textContent=`Couldn’t read “${s}”. Write it as weight x reps, like 60x8.`; return; } }
    writeDay(S.date, day => { const x=day.exercises.find(y=>y.id===id); if(!x) return;
      x.name=titleCase($('#ee_name').value)||x.name; x.sets=sets; x.muscle_group=$('#ee_group').value; x.duration_min=num($('#ee_min').value,600)||null;
      x.kcal = exerciseKcal(x, S.date); });
    d.close(); };
}

function openSportEdit(id){
  const a = (getDay(S.date).sports||[]).find(x=>x.id===id); if (!a) return;
  if (a.v===2) return openActEdit(a);
  const d=$('#dlg'); const cr = a.sport==='cricket';
  const nf = (idv,label,val,hint='') => `<label class="field">${label}<input id="${idv}" type="number" min="0" placeholder="—" value="${esc(val??'')}">${hint?`<span class="hint">${hint}</span>`:''}</label>`;
  d.innerHTML = `<form id="editForm" class="form" style="gap:12px">
    <h2 class="full">Edit ${esc(sportTitle(a))}</h2>
    ${cr?`<label class="field">Session<select id="es_session">${['match','nets','practice'].map(x=>`<option ${x===a.session?'selected':''}>${x}</option>`).join('')}</select></label>`
        :a.sport==='badminton'?`<label class="field">Format<select id="es_format"><option value="">not set</option>${['singles','doubles'].map(x=>`<option ${x===a.format?'selected':''}>${x}</option>`).join('')}</select></label>`:''}
    ${nf('es_min','Total minutes',a.minutes)}
    ${cr?`${nf('es_bowled','Balls bowled',a.balls_bowled,'6 overs = 36')}
      <label class="field">Bowling style<select id="es_style"><option value="">not set</option>${['pace','medium','spin'].map(x=>`<option ${x===a.bowling_style?'selected':''}>${x}</option>`).join('')}</select></label>
      ${nf('es_faced','Balls faced',a.balls_faced)}${nf('es_batmin','Minutes batted',a.minutes_batted)}${nf('es_field','Overs fielded',a.overs_fielded)}`:''}
    <div class="full row"><span class="spacer"></span><button class="btn ghost" type="button" id="es_cancel">Cancel</button><button class="btn" type="submit">Save</button></div></form>`;
  d.showModal();
  $('#es_cancel').onclick = () => d.close();
  $('#editForm').onsubmit = ev => { ev.preventDefault();
    const g = (idv,max) => { const el=$('#'+idv); return el ? (num(el.value,max)||null) : undefined; };
    writeDay(S.date, day => { const x=(day.sports||[]).find(y=>y.id===id); if(!x) return;
      x.minutes = g('es_min',1440);
      if (cr) { x.session=$('#es_session').value; x.balls_bowled=g('es_bowled',600); x.bowling_style=$('#es_style').value||null; x.balls_faced=g('es_faced',600); x.minutes_batted=g('es_batmin',600); x.overs_fielded=g('es_field',100); }
      if ($('#es_format')) x.format = $('#es_format').value||null;
      x.kcal = sportKcal(x, S.date); });
    d.close(); };
}

function openActEdit(a){
  const d=$('#dlg');
  d.innerHTML = `<form id="editForm" class="form" style="gap:12px">
    <h2 class="full">Edit ${esc(a.title)}</h2>
    <div class="full muted small">Change the minutes or effort of each part. Calories recalculate from your weight.</div>
    ${(a.components||[]).map((c,i)=>`<label class="field full">${esc(c.part)}<span class="row"><input id="ac_m${i}" type="number" min="0" value="${esc(Math.round(c.minutes))}" style="max-width:110px"> min · MET <input id="ac_e${i}" type="number" min="1" max="16" step="0.1" value="${esc(c.met)}" style="max-width:90px"></span></label>`).join('')}
    <label class="field">Effort (1–10)<input id="ac_rpe" type="number" min="1" max="10" value="${esc(a.rpe)}"></label>
    <div class="full row"><span class="spacer"></span><button class="btn ghost" type="button" id="ac_cancel">Cancel</button><button class="btn" type="submit">Save</button></div></form>`;
  d.showModal();
  $('#ac_cancel').onclick = () => d.close();
  $('#editForm').onsubmit = ev => { ev.preventDefault(); const W=who(S.date);
    writeDay(S.date, day => { const x=(day.sports||[]).find(y=>y.id===a.id); if(!x) return;
      x.components = (x.components||[]).map((c,i)=>({...c, minutes:num($('#ac_m'+i).value,600), met:Math.min(Math.max(Number($('#ac_e'+i).value)||c.met,1),16)}));
      x.minutes = Math.round(x.components.reduce((s,c)=>s+c.minutes,0));
      x.kcal = Math.round(x.components.reduce((s,c)=>s+Calc.netKcalFromMet(c.met, W.kg, c.minutes, W.bmrKcal).net,0));
      x.kcal_gross = Math.round(x.components.reduce((s,c)=>s+Calc.netKcalFromMet(c.met, W.kg, c.minutes, W.bmrKcal).gross,0));
      x.rpe = Math.min(10,Math.max(1,Math.round(Number($('#ac_rpe').value)||x.rpe))); });
    d.close(); };
}

/* ---------- render + events ---------- */
function render(){
  const isToday = S.date===localDate();
  $('#syncDot').className = 'sync ' + (S.user ? S.sync : '');
  $('#syncDot').title = {synced:'Saved', saving:'Saving…', offline:'Offline: saved on this device', error:'Sync problem: retrying'}[S.sync]||'';
  $('#dateLabel').textContent = isToday ? 'Today, ' + fmtDate(S.date,{day:'numeric',month:'short'}) : fmtDate(S.date);
  $('#datePick').max = localDate(); $('#datePick').value = S.date;
  if (!$('#menu').hidden && $('#menuAcct')) $('#menuAcct').innerHTML = accountFold(); // leaves the password box alone
  $('#goToday').hidden = isToday;
  $('#nextDay').disabled = isToday;
  document.querySelectorAll('.tab').forEach(b => { if (b.dataset.view===S.view) b.setAttribute('aria-current','page'); else b.removeAttribute('aria-current'); });
  const ta = $('#logText'); const draft = ta ? ta.value : ''; const hadFocus = document.activeElement===ta;
  let html = '';
  if (!S.user) { $('#main').innerHTML = authView(); document.querySelector('.tabs').hidden = true; document.querySelector('.hright').hidden = true; $('#menu').hidden = true; return; }
  document.querySelector('.tabs').hidden = false; document.querySelector('.hright').hidden = false;
  if (S.sync==='offline') html += `<div class="banner" style="margin-bottom:16px">You’re offline. Everything you log is saved on this device and syncs when you’re back online.</div>`;
  else if (S.sync==='error') html += `<div class="banner" style="margin-bottom:16px">Couldn’t sync with the server. Your changes are safe on this device; retrying.</div>`;
  if (S.dbState==='connecting') html += `<div class="muted small" style="margin-bottom:12px">Loading your log…</div>`;
  if (!isToday && S.view!=='setup') html += `<div class="pastbar"><span>Viewing <b>${esc(fmtDate(S.date,{weekday:'long',day:'numeric',month:'short'}))}</b></span><span class="spacer"></span><button class="linkbtn" data-action="goToday">Back to today</button></div>`;
  html += S.view==='setup'&&S.setup?viewSetup():S.view==='gym'?viewGym():S.view==='trends'?viewTrends():S.view==='coach'||S.view==='health'?viewProfile():S.view==='profile'?viewProfile():viewToday();
  $('#main').innerHTML = html;
  const ta2 = $('#logText'); if (ta2) { ta2.value = draft; if (hadFocus) ta2.focus(); }
  document.querySelectorAll('.profForm').forEach(f => { f.onsubmit = onProfileSubmit; });
  autoStack();
  if (S.rev !== S.boardRev) { S.boardRev = S.rev; publishBoard(); }
}
function onProfileSubmit(ev){
  ev.preventDefault();
  const v = id => $(id).value;
  const optNum = (x,max) => { const n=Number(x); return x!==''&&Number.isFinite(n)&&n>0 ? Math.min(n,max) : null; };
  if (v('#pf_weight') && num(v('#pf_weight'),300) && Math.abs(num(v('#pf_weight'),300)-(Number(prof().weight_kg)||0))>0.05) writeDay(localDate(), d => { d.weight_kg = num(v('#pf_weight'),300); });
  const birth = v('#pf_birth'), bf = optNum(v('#pf_bf'),60);
  if (birth && !(Calc.ageOn(birth, localDate())>=13)) { toast('Check your date of birth.'); return; }
  if (bf!==null && bf<3) { toast('Body fat should be between 3 and 60%.'); return; }
  const p = {...prof(), name:($('#pf_name')?.value||'').trim().slice(0,40), sex:v('#pf_sex'), birth, age:birth?Calc.ageOn(birth, localDate()):prof().age, height_cm:num(v('#pf_height'),250)||170, weight_kg:num(v('#pf_weight'),300)||70,
    body_fat:bf, maint_source:v('#pf_maint'), eat_back:$('#pf_eatback').checked,
    activity:v('#pf_act'), goal:v('#pf_goal'), goal_rate:Number(v('#pf_rate'))||0.5,
    calorie_override:optNum(v('#pf_kcal'),6000), protein_override:optNum(v('#pf_prot'),400), carbs_override:optNum(v('#pf_carbs'),900), fat_override:optNum(v('#pf_fat'),300), fiber_override:optNum(v('#pf_fibre'),120), water_override_ml:optNum(v('#pf_water'),8000), steps_goal:optNum(v('#pf_steps'),50000)||10000};
  saveProfile(p); toast('Profile saved. Targets updated.');
}
function setView(v){ S.view=v; S.status=''; S.statusErr=false; render(); window.scrollTo({top:0}); if (v==='trends') loadBoard(); }

document.addEventListener('click', ev => {
  const b = ev.target.closest('[data-action],[data-view].tab'); if (!b) return;
  if (b.classList.contains('tab')) return setView(b.dataset.view);
  const a = b.dataset.action, day = getDay(S.date);
  switch (a) {
    case 'log': submitLog(); break;
    case 'stop': S.ctl?.abort(); break;
    case 'example': { const ta=$('#logText'); if (ta){ ta.value=b.dataset.text; ta.focus(); } break; }
    case 'pickPhoto': $('#photoInput').click(); break;
    case 'clearPhoto': clearPhoto(); render(); break;
    case 'goto': setView(b.dataset.view); break;
    case 'goToday': S.date=localDate(); S.status=''; render(); break;
    case 'theme': setTheme(b.dataset.t); break;
    case 'water': writeDay(S.date, d => d.water.push({id:uid(), ml:+b.dataset.ml, time:nowTime()})); break;
    case 'undoWater': { const last = day.water[day.water.length-1]; if (!last) break; writeDay(S.date, d=>d.water.pop()); toast(`Removed ${n0(last.ml)} ml`, () => writeDay(S.date, d=>d.water.push(last))); break; }
    case 'delFood': { const i = day.foods.findIndex(f=>f.id===b.dataset.id); if (i<0) break; const item=day.foods[i]; const date=S.date;
      writeDay(date, d => { d.foods = d.foods.filter(f=>f.id!==item.id); }); toast(`Deleted ${item.name}`, () => writeDay(date, d => d.foods.splice(i,0,item))); break; }
    case 'delEx': { const i = day.exercises.findIndex(f=>f.id===b.dataset.id); if (i<0) break; const item=day.exercises[i]; const date=S.date;
      writeDay(date, d => { d.exercises = d.exercises.filter(f=>f.id!==item.id); }); toast(`Deleted ${item.name}`, () => writeDay(date, d => d.exercises.splice(i,0,item))); break; }
    case 'editFood': openFoodEdit(b.dataset.id); break;
    case 'editEx': openExEdit(b.dataset.id); break;
    case 'editSport': openSportEdit(b.dataset.id); break;
    case 'ans': { const ns=b.dataset.ns, q=b.dataset.q, v=b.dataset.v;
      if (ns==='q') { const it=S.queue[0]; if (it) it.answers[q] = it.answers[q]===v ? undefined : v; }
      else if (ns.startsWith('setup.')) { const k=ns.slice(6); const o=(S.setup.answers[k] ||= {}); o[q] = o[q]===v ? undefined : v; }
      render(); break; }
    case 'qSubmit': case 'qSkip': { const it=S.queue[0]; if (!it) break;
      it.qa = a==='qSkip' ? [] : (it.questions||[]).filter(q=>it.answers[q.id]!==undefined&&it.answers[q.id]!=='').map(q=>({q:q.text, a:String(it.answers[q.id])}));
      it.submitted = true; runQueue(); break; }
    case 'qRetry': { const it=S.queue[0]; if (it) it.failed=false; runQueue(); break; }
    case 'qDiscard': S.queue.shift(); S.qStatus=''; render(); if (S.queue.length) runQueue(); break;
    case 'qSaveProfile': { const it=S.queue.shift(); saveSportProfile(it.key, it.name, it.questions||[], it.answers); toast(`Saved how you play ${it.name}`); render(); if (S.queue.length) runQueue(); break; }
    case 'qSkipProfile': { S.queue.shift(); render(); if (S.queue.length) runQueue(); break; }
    case 'updSport': { const k=b.dataset.key, sp=(prof().sports||{})[k]; if (!sp) break;
      S.queue.unshift({type:'profile', key:k, name:sp.name||sportName(k), questions:SPORT_Q[k] || (sp.answers||[]).map(x=>({id:x.id, text:x.q, type:'text'})), answers:Object.fromEntries((sp.answers||[]).map(x=>[x.id,x.a])), isNew:false});
      setView('today'); break; }
    case 'stillRight': { const k=b.dataset.key, p=prof(); const sp={...(p.sports||{})}; if (sp[k]) { sp[k]={...sp[k], updated:localDate()}; saveProfile({...p, sports:sp}); } break; }
    case 'rmSport': { const k=b.dataset.key, p=prof(); const sp={...(p.sports||{})}; const old=sp[k]; delete sp[k]; saveProfile({...p, sports:sp}); toast(`Removed ${old?.name||k}`, () => saveProfile({...prof(), sports:{...(prof().sports||{}), [k]:old}})); break; }
    case 'startSetup': startSetup(b.dataset.step); break;
    case 'setupNext': setupGo(1); break;
    case 'setupBack': setupGo(-1); break;
    case 'setupSkip': S.setup=null; S.view='today'; render(); break;
    case 'setupSport': { const k=b.dataset.key; const l=S.setup.sports; const i=l.indexOf(k); if (i>=0) l.splice(i,1); else l.push(k); render(); break; }
    case 'setupAddOther': { const v=($('#setupOther')?.value||'').trim(); if (!v) break; for (const part of v.split(',')) { const k=sportKey(part); if (k && !S.setup.sports.includes(k)) S.setup.sports.push(k); } render(); break; }
    case 'delSport': { const i=(day.sports||[]).findIndex(y=>y.id===b.dataset.id); if(i<0) break; const item=day.sports[i]; const date=S.date;
      writeDay(date, d => { d.sports=d.sports.filter(y=>y.id!==item.id); }); toast(`Deleted ${actTitle(item)}`, () => writeDay(date, d => { d.sports=d.sports||[]; d.sports.splice(i,0,item); })); break; }
    case 'gymPeriod': S.gymPeriod=b.dataset.p; render(); break;
    case 'pickEx': S.gymEx = S.gymEx===b.dataset.key ? null : b.dataset.key; render(); break;
    case 'allEx': S.allEx=!S.allEx; render(); break;
    case 'exportExcel': exportExcel(); break;
    case 'range': S.trendRange=+b.dataset.n; render(); break;
    case 'toggleStack': { const st=(prof().stack||[]).find(x=>x.id===b.dataset.id); if(!st) break;
      writeDay(S.date, d => { d.supplements = d.supplements||[]; const i=d.supplements.findIndex(x=>x.stack_id===st.id);
        if (i>=0) d.supplements.splice(i,1); else d.supplements.push({id:uid(), name:st.name, dose:st.dose, micros:{...st.micros}, stack_id:st.id, time:nowTime()}); }); break; }
    case 'addStack': { const x=(day.supplements||[]).find(y=>y.id===b.dataset.id); if(!x) break; const p=prof();
      if (findStack(x.name)) { toast(`${x.name} is already on your daily list`); break; }
      const st={id:uid(), name:x.name, dose:x.dose, micros:{...x.micros}, since:S.date};
      saveProfile({...p, stack:[...(p.stack||[]), st]});
      writeDay(S.date, d => { const y=(d.supplements||[]).find(z=>z.id===x.id); if (y) y.stack_id=st.id; });
      toast(`Added ${x.name} to your daily list`); break; }
    case 'delSupp': { const i=(day.supplements||[]).findIndex(y=>y.id===b.dataset.id); if(i<0) break; const item=day.supplements[i]; const date=S.date;
      writeDay(date, d => { d.supplements = d.supplements.filter(y=>y.id!==item.id); }); toast(`Deleted ${item.name}`, () => writeDay(date, d => { d.supplements=d.supplements||[]; d.supplements.splice(i,0,item); })); break; }
    case 'rmStack': { const p=prof(); const st=(p.stack||[]).find(x=>x.id===b.dataset.id); if(!st) break;
      saveProfile({...p, stack:p.stack.filter(x=>x.id!==st.id)}); toast(`Removed ${st.name} from your daily list`, () => saveProfile({...prof(), stack:[...(prof().stack||[]), st]})); break; }
    case 'pickReport': $('#reportInput').click(); break;
    case 'pickRep': S.repSel=b.dataset.id; S.repMarker=null; render(); break;
    case 'pickMarker': S.repMarker=b.dataset.key; render(); break;
    case 'applyReport': { const r=S.reports.find(x=>x.id===b.dataset.id); if(!r) break; saveProfile({...prof(), report_adjust:{...r.adjust, from:r.id, from_date:r.report_date}}); toast('Applied. Your targets now reflect this report.'); break; }
    case 'unapplyReport': { const p={...prof()}; delete p.report_adjust; saveProfile(p); toast('Removed the report changes from your targets.'); break; }
    case 'delReport': { const r=S.reports.find(x=>x.id===b.dataset.id); if(!r) break; S.reports=S.reports.filter(x=>x.id!==r.id); S.repSel=null; if (S.db) S.db.doc('reports/'+r.id).delete().catch(()=>{});
      if (prof().report_adjust?.from===r.id) { const p={...prof()}; delete p.report_adjust; saveProfile(p); }
      render(); toast(`Deleted the ${fmtDate(r.report_date,{day:'numeric',month:'short'})} report`, () => { S.reports=[r,...S.reports]; if (S.db) S.db.doc('reports/'+r.id).set(r); render(); }); break; }
    case 'review': runReview(); break;
    case 'plan': runPlan(); break;
    case 'planFor': S.planFor=b.dataset.d; render(); break;
    case 'planEx': openPlanEx(+b.dataset.i); break;
    case 'planToLog': { const pl=(S.plans||[]).find(x=>x.date>=localDate()); if (S.view!=='today') { S.date=localDate(); setView('today'); } const ta=$('#logText'); if (!pl||!ta) break;
      ta.value = pl.exercises.map(e=>{ const w=planKg(e); return `${e.name} ${e.sets||3}x${String(e.reps).replace(/[^\d-]/g,'').split('-').pop()||8}${w?' @'+w+'kg':''}`; }).join(', ');
      ta.focus(); ta.scrollIntoView({block:'center'}); setStatus('Edit anything you did differently, then tap Log.'); break; }
    case 'relog': { let f=null; for (const [,d] of S.days) { f=(d.foods||[]).find(y=>y.id===b.dataset.id); if (f) break; } if(!f) break;
      const copy={...structuredClone(f), id:uid(), time:nowTime(), meal:guessMeal()}; const date=S.date;
      writeDay(date, d=>d.foods.push(copy)); toast(`Logged ${f.name}`, () => writeDay(date, d => { d.foods=d.foods.filter(y=>y.id!==copy.id); })); break; }
    case 'resetGoal': { const p={...prof()}; p[b.dataset.key]=null; saveProfile(p); toast('Back to the suggested goal.'); break; }
    case 'rmFood': { const k=b.dataset.key; const f=(S.myFoods||{})[k]; if(!f) break; const m={...S.myFoods}; delete m[k]; S.myFoods=m; S.myFoodsVer++; if (S.db) S.db.doc('foods/'+k).delete().catch(()=>{}); render(); toast(`Removed ${f.name} from your food list`); break; }
    case 'importIndb': importIndb(); break;
    case 'authSend': authSend(); break;
    case 'authVerify': authVerify(); break;
    case 'authPassword': authPassword(); break;
    case 'authSignUp': authSignUp(); break;
    case 'setPassword': setPassword(); break;
    case 'authOAuth': authOAuth(b.dataset.p); break;
    case 'faceIdSignIn': authFaceId(); break;
    case 'faceIdSetup': setupFaceId(); break;
    case 'howto': openHowto(b.dataset.name||''); break;
    case 'editSupp': openSuppEdit(b.dataset.id||''); break;
    case 'restSet': startRest(+b.dataset.s); break;
    case 'restStop': stopRest(); break;
    case 'tempPw': tempPassword(b.dataset.id, b.dataset.name||'this member'); break;
    case 'mustChangeSave': mustChangeSave(); break;
    case 'forgotPw': S.auth={...S.auth, err:false, msg:'This app doesn’t send reset emails to members. Ask the owner to set a temporary password for you (they tap Password next to your name in People & approvals). Sign in with it and you’ll choose a new one. If you turned on Face ID or fingerprint, you can use that instead.'}; render(); break;
    case 'backupNow': exportData(); break;
    case 'backupLater': try { localStorage.setItem('mt:backup-later', String(Date.now())); } catch {} render(); break;
    case 'foodSearch': openFoodSearch(); break;
    case 'scan': openScanner(); break;
    case 'hsCreate': hsCreate(); break;
    case 'hsRevoke': hsRevoke(); break;
    case 'hsReload': S.hsync = undefined; render(); loadHealthSync(); break;
    case 'hsCopy': b.dataset.what==='key' ? copyText(S.hsKey||'', 'Key') : copyText(hsUrl(), 'Address'); break;
    case 'faceIdRemove': removePasskey(b.dataset.id); break;
    case 'faceIdLater': try { localStorage.setItem('mt:faceid-later:'+S.user.id, '1'); } catch {} render(); break;
    case 'recheckMember': if (S.pendingUser) startFor(S.pendingUser); break;
    case 'memberSet': setMember(b.dataset.id, b.dataset.s); break;
    case 'reviewPeople': S.openFolds.add('s-people'); setView('profile'); loadMembers(); break;
    case 'authBack': S.auth={step:'email', email:S.auth.email, msg:'', busy:false}; render(); break;
    case 'signOut': if (confirm(S.db&&S.db.pendingCount() ? `Sign out? ${S.db.pendingCount()} change(s) haven’t synced yet and will be lost.` : 'Sign out on this device? Your data stays in your account.')) signOut(); break;
    case 'exportData': exportData(); break;
    case 'importData': $('#importInput').click(); break;
    case 'refreshUsage': refreshUsage(); break;
    case 'openDay': S.date=b.dataset.date; setView('today'); break;
  }
});
document.addEventListener('change', ev => {
  const el = ev.target;
  if (el.dataset && el.dataset.action==='dayComplete') { const on = el.checked; writeDay(S.date, d => { if (on) delete d.incomplete; else d.incomplete = true; }); }
  if (el.dataset && el.dataset.action==='stackAuto') saveProfile({...prof(), stack_auto:el.checked});
  if (el.dataset && el.dataset.action==='watchToggle') saveProfile({...prof(), watch_workouts:el.checked});
  if (el.dataset && el.dataset.action==='restToggle') { saveProfile({...prof(), rest_timer:el.checked}); if (!el.checked) stopRest(); }
  if (el.dataset && el.dataset.action==='restDefault') saveProfile({...prof(), rest_default:+el.value});
  if (el.dataset && el.dataset.action==='boardToggle') { boardLast = ''; saveProfile({...prof(), leaderboard:el.checked}); }
});
document.addEventListener('toggle', ev => { const k = ev.target.dataset && ev.target.dataset.fold; if (!k) return;
  if (ev.target.open) S.openFolds.add(k); else S.openFolds.delete(k);
  try { localStorage.setItem('fl:folds', JSON.stringify([...S.openFolds])); } catch {} }, true);
document.addEventListener('input', ev => bindInput(ev.target));
document.addEventListener('change', ev => bindInput(ev.target));
function bindInput(el){
  if (el.id==='planNote') { S.planNote = el.value; return; }
  if (el.id==='exq') { S.exq = el.value; const r=$('#exres'); if (r) r.innerHTML = libResults(el.value); return; }
  const path = el.dataset && el.dataset.bind; if (!path) return;
  const v = el.type==='checkbox' ? el.checked : el.value;
  const [ns, ...rest] = path.split('.');
  if (ns==='q') { const it=S.queue[0]; if (it) it.answers[rest.join('.')] = v; return; }
  if (ns==='about') { S.setup.about[rest[0]] = v; return; }
  if (ns==='setup') { const k=rest[0]; (S.setup.answers[k] ||= {})[rest.slice(1).join('.')] = v; }
}
document.addEventListener('keydown', ev => {
  if (ev.key==='Enter' && ev.target.matches('tr.click')) ev.target.click();
  if (ev.key==='Enter' && (ev.metaKey||ev.ctrlKey) && ev.target.id==='logText') submitLog();
  if (ev.key==='Enter' && ev.target.id==='authEmail') { ev.preventDefault(); $('#authPass')?.focus(); }
  if (ev.key==='Enter' && ev.target.id==='authPass') { ev.preventDefault(); authPassword(); }
  if (ev.key==='Enter' && ev.target.id==='newPass') { ev.preventDefault(); setPassword(); }
  if (ev.key==='Enter' && ev.target.id==='authCode') { ev.preventDefault(); authVerify(); }
});
$('#reportInput').addEventListener('change', ev => { const fs=[...(ev.target.files||[])]; ev.target.value=''; onReportFiles(fs); });
$('#photoInput').addEventListener('change', ev => { const f=ev.target.files?.[0]; ev.target.value=''; if(!f) return; clearPhoto(); S.photo=f; S.photoUrl=URL.createObjectURL(f); S.status=''; render(); });
$('#indbInput').addEventListener('change', ev => { const f=ev.target.files?.[0]; ev.target.value=''; if (f) importIndb(f); });
$('#importInput').addEventListener('change', ev => { const f=ev.target.files?.[0]; ev.target.value=''; if (f) importData(f); });
$('#prevDay').onclick = () => { S.date=addDays(S.date,-1); S.status=''; render(); };
$('#nextDay').onclick = () => { if (S.date<localDate()) { S.date=addDays(S.date,1); S.status=''; render(); } };
$('#goToday').onclick = () => { S.date=localDate(); render(); };
$('#datePick').onchange = ev => { const v=ev.target.value; if (v && v<=localDate()) { S.date=v; S.status=''; render(); } };
function themePref(){ try { const t=localStorage.getItem('mt:theme'); return t==='light'||t==='dark' ? t : 'auto'; } catch { return 'auto'; } }
function setTheme(t){
  try { if (t==='auto') localStorage.removeItem('mt:theme'); else localStorage.setItem('mt:theme', t); } catch {}
  if (t==='auto') delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  syncThemeColor(); if (!$('#menu').hidden) $('#menuBody').innerHTML = menuHtml(); render();
}
function syncThemeColor(){ const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim(); const m=document.querySelector('meta[name="theme-color"]'); if (m && bg) m.content = bg; }
syncThemeColor();
try { matchMedia('(prefers-color-scheme: dark)').addEventListener('change', syncThemeColor); } catch {}
function menuHtml(){
  const th = themePref();
  return `<div class="menu-sec"><div class="menu-l">Appearance</div>
      <div class="seg" role="group" aria-label="Theme">${[['light','Light'],['dark','Dark'],['auto','Match phone']].map(([k,l])=>`<button data-action="theme" data-t="${k}" aria-pressed="${th===k}">${l}</button>`).join('')}</div></div>
    <div class="menu-sec"><div class="menu-l">Account</div><div id="menuAcct">${accountFold()}</div></div>
    <div class="menu-sec"><div class="menu-l">${bioName()} sign-in</div><div id="menuPk">${passkeyMenu()}</div></div>
    <div class="menu-sec"><div class="menu-l">Password &amp; security</div>${securityFold()}</div>`;
}
function setMenu(open){
  const m=$('#menu'); m.hidden=!open; $('#menuBtn').setAttribute('aria-expanded', String(open));
  if (open) { $('#menuBody').innerHTML = menuHtml(); if (!S.usage && S.sample) refreshUsage(); loadPasskeys(); }
}
$('#menuBtn').onclick = () => setMenu($('#menu').hidden);
$('#menuClose').onclick = () => setMenu(false);
// A tap outside closes the menu and nothing else: the same tap must not also press what's underneath.
let swallowClick = false, swallowT;
document.addEventListener('pointerdown', ev => { if (!$('#menu').hidden && !ev.target.closest('#menu,#menuBtn')) {
  setMenu(false); swallowClick = true; clearTimeout(swallowT); swallowT = setTimeout(() => { swallowClick = false; }, 600); } }, true);
document.addEventListener('click', ev => { if (swallowClick) { swallowClick = false; ev.preventDefault(); ev.stopPropagation(); } }, true);
document.addEventListener('keydown', ev => { if (ev.key==='Escape' && !$('#menu').hidden) setMenu(false); });

// chart tooltips
const tip = $('#tip');
document.addEventListener('pointermove', ev => {
  const t = ev.target.closest && ev.target.closest('[data-tip]');
  if (!t) { tip.hidden=true; return; }
  tip.textContent = t.getAttribute('data-tip'); tip.hidden=false;
  const w = tip.offsetWidth, h = tip.offsetHeight;
  tip.style.left = Math.min(window.innerWidth-w-8, Math.max(8, ev.clientX - w/2)) + 'px';
  tip.style.top = Math.max(8, ev.clientY - h - 14) + 'px';
});
document.addEventListener('pointerleave', () => { tip.hidden=true; });

let lastW = window.innerWidth, rT;
window.addEventListener('resize', () => { clearTimeout(rT); rT = setTimeout(() => { if (Math.abs(window.innerWidth-lastW)>40 && S.view!=='today' && S.view!=='profile') { lastW=window.innerWidth; render(); } }, 250); });

/* ---------- measured maintenance, account, sign-in ---------- */
function maintenancePanel(){
  const T = computeTargets(prof(), localDate()), ad = T.adaptive;
  if (ad.ready) return `<section class="panel"><div class="panel-head"><h3>Your real maintenance</h3><span class="pill ${ad.confidence==='high'?'good':'warn'}">${ad.confidence} confidence</span></div>
    <div class="kv" style="max-width:460px"><span>Measured from your logs</span><b>${n0(ad.tdee)} kcal/day</b><span>Formula estimate</span><b>${n0(T.tdee + ad.avgExercise)} kcal/day</b><span>Average eaten</span><b>${n0(ad.avgIntake)} kcal</b><span>Weight trend</span><b>${ad.kgPerWeek>0?'+':''}${n1(ad.kgPerWeek)} kg/week</b></div>
    <div class="muted small">Over the last 28 days you ate ${n0(ad.avgIntake)} kcal a day on ${ad.logged} fully logged days, and ${ad.weighIns} weigh-ins show your weight moving ${n1(ad.kgPerWeek)} kg a week. Each kg is about 7,700 kcal, so you really burn about ${n0(ad.tdee)} kcal a day${ad.avgExercise>5?`, including ${n0(ad.avgExercise)} a day of training`:''}. ${prof().maint_source==='formula'?'Your targets still use the formula; change that in Profile.':'Your targets use this number.'}</div></section>`;
  return `<section class="panel"><div class="panel-head"><h3>Your real maintenance</h3><span class="pill warn">learning</span></div>
    <div class="small">Formulas can be 10% or more off for any one person. After a few weeks of logging food and weighing in, the app measures what you actually burn from how your weight responds, and sets your targets from that.</div>
    <div class="muted small">Still needed: ${esc(ad.need.join(', '))}.</div></section>`;
}
function exportData(){
  saveProfile({...prof(), last_backup:localDate()});
  const blob = new Blob([JSON.stringify({app:'fuel-lift', v:1, exported:new Date().toISOString(), docs:S.db.dump()}, null, 1)], {type:'application/json'});
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `maxxtempo-backup-${localDate()}.json`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(()=>URL.revokeObjectURL(a.href), 1000);
}
async function importData(file){
  let j; try { j = JSON.parse(await file.text()); } catch { toast('That file isn’t a MaxxTempo backup.'); return; }
  // Accepts our own backups ({docs:{collection:{id:data}}}) or a plain {collection:{id:data}} / {collection:[{id,...}]} export.
  const docs = j && j.docs ? j.docs : j;
  const OK = ['days','profile','foods','reports','plans','reviews','foodlib'];
  let n = 0;
  if (!docs || typeof docs!=='object') { toast('That file isn’t a MaxxTempo backup.'); return; }
  if (!confirm('Add everything in this backup to your account? Days with the same date are replaced.')) return;
  for (const c of OK) {
    const coll = docs[c]; if (!coll) continue;
    const entries = Array.isArray(coll) ? coll.map(d=>[d.id||d.date, d]) : Object.entries(coll);
    for (const [id, data] of entries) { if (!id || !data) continue; await S.db.doc(c+'/'+id).set(data); n++; }
  }
  toast(`Restored ${n} item${n===1?'':'s'}.`);
}

let SB = null;
function waitingView(){
  const u = S.pendingUser, m = S.memberInfo||{}, nm = (u.user_metadata?.full_name || u.user_metadata?.name || '').split(' ')[0];
  if (m.status==='declined') return `<section class="panel setup"><h2>Access not approved</h2>
    <p>${esc(u.email||'This account')} isn’t approved to use MaxxTempo. If you think that’s a mistake, ask the owner.</p>
    <div class="row"><span class="spacer"></span><button class="btn ghost" data-action="signOut">Sign out</button></div></section>`;
  return `<section class="panel setup"><h2>${nm?`Thanks, ${esc(nm)}!`:'Almost in'}</h2>
    <p>${m.status==='unknown' ? 'Couldn’t check your access. Check your connection and try again.' : `Your request to join has been sent. You’ll be let in as soon as the owner approves <b>${esc(u.email||'your account')}</b>. After that you sign in as normal, no approval needed again.`}</p>
    <div class="row"><button class="btn ghost" data-action="signOut">Sign out</button><span class="spacer"></span><button class="btn" data-action="recheckMember">Check again</button></div></section>`;
}
function authView(){
  if (S.pendingUser) return waitingView();
  if (S.mustChange) return `<section class="panel auth" aria-label="Choose a new password"><h2>Choose a new password</h2>
    <p class="muted">You signed in with a temporary password from the owner. Pick your own now; the temporary one stops working.</p>
    <label class="field full">New password<input id="mcPass" type="password" autocomplete="new-password" minlength="8" placeholder="At least 8 characters"></label>
    <div class="row"><span class="spacer"></span><button class="btn" data-action="mustChangeSave" ${S.mcBusy?'disabled':''}>${S.mcBusy?'Saving…':'Save and continue'}</button></div>
    ${S.mcMsg?`<div class="status err">${esc(S.mcMsg)}</div>`:''}</section>`;
  const a = S.auth, cfgOk = window.FL_CONFIG && /^https:\/\//.test(FL_CONFIG.SUPABASE_URL||'') && FL_CONFIG.SUPABASE_ANON_KEY && !/YOUR_/.test(FL_CONFIG.SUPABASE_ANON_KEY);
  if (!cfgOk) return `<section class="panel setup"><h2>Almost there</h2><p>This copy of MaxxTempo isn’t connected to a database yet. Put your Supabase project URL and anon key in <b>config.js</b>, following SETUP.md.</p></section>`;
  if (a.step==='confirm') return `<section class="panel setup"><h2>Confirm your email</h2>
    <p>We sent a confirmation link to <b>${esc(a.email)}</b>. Tap it once (any browser is fine), then come back here and sign in with your password.</p>
    <div class="row"><span class="spacer"></span><button class="btn" data-action="authBack">Back to sign in</button></div></section>`;
  if (a.step==='code') return `<section class="panel setup"><h2>Check your email</h2>
    <p>We sent a sign-in email to <b>${esc(a.email)}</b>. Tap the link in it on this device, in this browser. If the email shows a code, type it here.</p>
    <label class="field">Code<input id="authCode" inputmode="numeric" autocomplete="one-time-code" maxlength="10" placeholder="123456"></label>
    <div class="row"><button class="btn ghost" data-action="authBack">Use another email</button><span class="spacer"></span><button class="btn" data-action="authVerify" ${a.busy?'disabled':''}>${a.busy?'Checking…':'Sign in'}</button></div>
    <div class="status${a.err?' err':''}">${esc(a.msg||'')}</div></section>`;
  return `<section class="panel setup"><h2>Sign in</h2>
    <p class="muted">Your food, training and health logs are private to you and sync across your phone and laptop.</p>
    ${window.PublicKeyCredential||FL_CONFIG.GOOGLE_SIGN_IN ? `<div class="authalt">
      ${window.PublicKeyCredential?`<button class="btn provider face" data-action="faceIdSignIn" ${a.busy?'disabled':''}><svg viewBox="0 0 24 24" width="19" height="19" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 8V6a2 2 0 0 1 2-2h2M16 4h2a2 2 0 0 1 2 2v2M20 16v2a2 2 0 0 1-2 2h-2M8 20H6a2 2 0 0 1-2-2v-2"/><path d="M9 9.5v1M15 9.5v1M12 9.5v3.5h-1M9.5 15.5c1.4 1.2 3.6 1.2 5 0"/></svg><span>Sign in with ${bioName()}</span></button>`:''}
      ${FL_CONFIG.GOOGLE_SIGN_IN?`<button class="btn provider" data-action="authOAuth" data-p="google" ${a.busy?'disabled':''}><svg viewBox="0 0 48 48" width="18" height="18" aria-hidden="true"><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/><path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.5z"/></svg><span>Continue with Google</span></button>`:''}
    </div><div class="ordiv"><span>or use email</span></div>`:''}
    <label class="field">Email<input id="authEmail" type="email" autocomplete="email" placeholder="you@example.com" value="${esc(a.email)}"></label>
    <label class="field">Password<input id="authPass" type="password" autocomplete="current-password" placeholder="At least 8 characters"></label>
    <div class="row"><button class="btn ghost" data-action="authSignUp" ${a.busy?'disabled':''}>Create account</button><span class="spacer"></span><button class="btn" data-action="authPassword" ${a.busy?'disabled':''}>${a.busy?'Working…':'Sign in'}</button></div>
    <button class="linkbtn" data-action="forgotPw" style="align-self:flex-start;padding-left:0">Forgot password?</button>
    <div class="row"><button class="btn ghost sm" data-action="authSend" ${a.busy?'disabled':''}>Email me a sign-in link instead</button></div>
    <div class="status${a.err?' err':''}">${esc(a.msg||'')}</div></section>`;
}
const redirectTo = () => location.origin + location.pathname;
// Supabase's error, in plain words; the fallback when it's something else.
function authErrMsg(error, fallback){
  const m = `${error?.code||''} ${error?.message||''}`;
  if (/already.?(registered|exists)/i.test(m)) return 'That email already has an account. Sign in with your password or Face ID. Never set a password (you used an email link)? Ask the owner for a temporary password.';
  if (/not.?authori[sz]ed|sending|smtp|confirmation email|magic link email/i.test(m)) return 'This app can’t send emails to new addresses yet. Create an account with a password instead, then ask the owner to approve you.';
  if (/rate|too many/i.test(m)) return 'Too many attempts. Wait a few minutes and try again.';
  if (/weak|pwned|password/i.test(m)) return error.message;
  if (/invalid.*email|email.*invalid/i.test(m)) return 'That email address doesn’t look right. Check it and try again.';
  return fallback + (error?.message ? ` (${error.message})` : '');
}
async function mustChangeSave(){
  const password = $('#mcPass')?.value||'';
  if (password.length<8) { S.mcMsg='Choose a password of at least 8 characters.'; render(); return; }
  S.mcBusy=true; S.mcMsg=''; render();
  if (await pwnedPassword(password)) { S.mcBusy=false; S.mcMsg=PWNED_MSG; render(); return; }
  const { data, error } = await SB.auth.updateUser({ password, data:{ must_change_password:false } });
  S.mcBusy=false;
  if (error) { S.mcMsg = authErrMsg(error, 'Couldn’t save the password. Try again.'); render(); return; }
  S.mustChange = null; toast('Password saved. Use it from now on.'); startFor(data.user);
}
async function authSend(){
  const email = ($('#authEmail')?.value||'').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { S.auth={...S.auth, email, msg:'Enter your email address.', err:true}; render(); return; }
  S.auth={step:'email', email, busy:true, msg:''}; render();
  const { error } = await SB.auth.signInWithOtp({ email, options:{ emailRedirectTo:redirectTo() } });
  S.auth = error ? {step:'email', email, busy:false, err:true, msg: authErrMsg(error, 'Couldn’t send the email. Check the address and try again.')}
                 : {step:'code', email, busy:false, msg:''};
  render(); if (!error) setTimeout(()=>$('#authCode')?.focus(), 50);
}
async function authVerify(){
  const token = ($('#authCode')?.value||'').replace(/\D/g,'');
  if (token.length<6) { S.auth={...S.auth, msg:'Enter the code from the email.', err:true}; render(); return; }
  S.auth={...S.auth, busy:true, msg:''}; render();
  const { error } = await SB.auth.verifyOtp({ email:S.auth.email, token, type:'email' });
  if (error) { S.auth={...S.auth, busy:false, err:true, msg:'That code didn’t work. It may have expired; send a new one.'}; render(); }
}
const authCreds = () => ({ email:($('#authEmail')?.value||'').trim().toLowerCase(), password:$('#authPass')?.value||'' });
function authCheck(email, password, minLen){
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return 'Enter your email address.';
  if (password.length<minLen) return minLen>1 ? `Choose a password of at least ${minLen} characters.` : 'Enter your password.';
}
// Has this password appeared in a known data breach? Only the first 5 characters
// of its SHA-1 hash leave the device (k-anonymity), and if the check can't run
// the password is allowed rather than blocking sign-up.
async function pwnedPassword(password){
  try {
    const buf = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(password));
    const hex = [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2,'0')).join('').toUpperCase();
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 4000);
    const res = await fetch('https://api.pwnedpasswords.com/range/' + hex.slice(0,5), { signal:ctl.signal, headers:{ 'Add-Padding':'true' }, referrerPolicy:'no-referrer' });
    clearTimeout(t); if (!res.ok) return false;
    return (await res.text()).split('\n').some(l => { const [suf, n] = l.trim().split(':'); return suf === hex.slice(5) && Number(n) > 0; });
  } catch { return false; }
}
const PWNED_MSG = 'That password has shown up in a data breach, so it’s easy to guess. Choose a different one.';
async function authPassword(){
  const { email, password } = authCreds(), bad = authCheck(email, password, 1);
  if (bad) { S.auth={...S.auth, email, msg:bad, err:true}; render(); return; }
  S.auth={step:'email', email, busy:true, msg:''}; render();
  const { error } = await SB.auth.signInWithPassword({ email, password });
  if (error) { S.auth={step:'email', email, busy:false, err:true, msg:
    /confirm/i.test(error.message) ? 'Confirm your email first: tap the link we sent you, then sign in.' :
    /invalid/i.test(error.message) ? 'Wrong email or password. New here? Tap Create account. Signed in by email link before? Use the link, then set a password under Profile → Account.' :
    'Couldn’t sign in. Check your connection and try again.' }; render(); }
}
async function authSignUp(){
  const { email, password } = authCreds(), bad = authCheck(email, password, 8);
  if (bad) { S.auth={...S.auth, email, msg:bad, err:true}; render(); return; }
  S.auth={step:'email', email, busy:true, msg:''}; render();
  if (await pwnedPassword(password)) { S.auth={step:'email', email, busy:false, err:true, msg:PWNED_MSG}; render(); return; }
  const { data, error } = await SB.auth.signUp({ email, password, options:{ emailRedirectTo:redirectTo() } });
  if (error) S.auth={step:'email', email, busy:false, err:true, msg: authErrMsg(error, 'Couldn’t create the account. Check the address and try again.')};
  else if (data.user && !data.user.identities?.length) S.auth={step:'email', email, busy:false, err:true, msg:'That email already has an account. Sign in, or use the email link and then set a password under Profile → Account.'};
  else if (!data.session) S.auth={step:'confirm', email, busy:false, msg:''};
  render();
}
async function setPassword(){
  const password = $('#newPass')?.value||'';
  if (password.length<8) { toast('Choose a password of at least 8 characters.'); return; }
  if (await pwnedPassword(password)) { toast(PWNED_MSG); return; }
  const { error } = await SB.auth.updateUser({ password });
  toast(error ? 'Couldn’t set the password: '+error.message : 'Password set. Use it to sign in on any device, including the home-screen app.');
  if (!error && $('#newPass')) $('#newPass').value='';
}
async function authOAuth(provider){
  S.auth={...S.auth, busy:true, err:false, msg:''}; render();
  const { error } = await SB.auth.signInWithOAuth({ provider, options:{ redirectTo:redirectTo() } });
  if (error) { S.auth={...S.auth, busy:false, err:true, msg:'Couldn’t open Google sign-in. Try again, or use email.'}; render(); }
}
/* ---------- Face ID / Touch ID sign-in (passkeys, see supabase/functions/passkey) ---------- */
const bioName = () => /iPhone|iPad/.test(navigator.userAgent) ? 'Face ID' : /Macintosh/.test(navigator.userAgent) ? 'Touch ID' : 'Face ID or fingerprint';
const deviceName = () => { const u = navigator.userAgent; return /iPhone/.test(u)?'iPhone':/iPad/.test(u)?'iPad':/Android/.test(u)?'Android phone':/Macintosh/.test(u)?'Mac':/Windows/.test(u)?'Windows PC':'This device'; };
async function webauthnLib(){
  if (window.SimpleWebAuthnBrowser) return window.SimpleWebAuthnBrowser;
  await loadScript(LIBS.webauthn).catch(() => { throw {code:'offline'}; });
  return window.SimpleWebAuthnBrowser;
}
const passkeyCall = (action, body) => fnCall('passkey', action, body);
async function fnCall(fn, action, body = {}){
  const cfg = FL_CONFIG; let token = cfg.SUPABASE_ANON_KEY;
  const { data:{ session } } = await SB.auth.getSession(); if (session) token = session.access_token;
  let res; try { res = await fetch(cfg.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/' + fn, { method:'POST', headers:{ 'Content-Type':'application/json', apikey:cfg.SUPABASE_ANON_KEY, Authorization:'Bearer ' + token }, body:JSON.stringify({ action, ...body }) }); }
  catch { throw { code:'offline' }; }
  let out = null; try { out = await res.json(); } catch {}
  if (!res.ok || !out || !out.ok) throw { code:(out && out.code) || 'unavailable' };
  return out;
}
async function authFaceId(){
  S.auth = {...S.auth, busy:true, err:false, msg:''}; render();
  try {
    const lib = await webauthnLib();
    const o = await passkeyCall('login-options');
    const response = await lib.startAuthentication({ optionsJSON:o.options });
    const v = await passkeyCall('login-verify', { challengeId:o.challengeId, response });
    const { error } = await SB.auth.verifyOtp({ token_hash:v.token_hash, type:'magiclink' });
    if (error) throw { code:'server_error' };
    S.auth = {step:'email', email:'', msg:'', busy:false};
  } catch (e) {
    const n = e?.name || e?.code, b = bioName();
    S.auth = {...S.auth, busy:false, err:true, msg:
      n==='NotAllowedError' || n==='AbortError' ? `${b} was cancelled, or ${b} isn’t set up for MaxxTempo on this device yet. Sign in with email or Google, then turn it on in ⚙︎ Settings.` :
      n==='unknown_passkey' ? `That ${b} sign-in was removed. Sign in with email or Google, then set it up again in ⚙︎ Settings.` :
      n==='not_approved' ? 'Your account is waiting for the owner’s approval.' :
      n==='offline' ? 'You’re offline. Connect to the internet and try again.' : 'Couldn’t sign in. Try again, or use email.'};
  }
  render();
}
/* ---------- Automatic Apple Health sync (iPhone Shortcut → supabase/functions/health-sync) ---------- */
const hsUrl = () => FL_CONFIG.SUPABASE_URL.replace(/\/$/, '') + '/functions/v1/health-sync';
async function loadHealthSync(){
  try { S.hsync = await fnCall('health-sync', 'status'); } catch { S.hsync = S.hsync || null; }
  render();
}
async function hsCreate(){
  if (S.hsync?.connected && !confirm('Make a new sync key? The Shortcut will need the new key; the old one stops working.')) return;
  S.hsBusy = true; render();
  try { const r = await fnCall('health-sync', 'create-key'); S.hsKey = r.key; S.hsync = {connected:true, last_sync_at:null}; S.openFolds.add('hs-steps'); }
  catch (e) { toast(e.code==='offline' ? 'You’re offline. Try again when connected.' : 'Couldn’t create a sync key. Try again.'); }
  S.hsBusy = false; render();
}
async function hsRevoke(){
  if (!confirm('Turn off automatic sync? The Shortcut stops working until you make a new key. Numbers already synced stay.')) return;
  try { await fnCall('health-sync', 'revoke'); S.hsync = {connected:false}; S.hsKey = null; toast('Automatic sync is off.'); }
  catch { toast('Couldn’t turn it off. Try again.'); }
  render();
}
async function copyText(text, what){
  try { await navigator.clipboard.writeText(text); toast(`${what} copied.`); }
  catch { toast(`Couldn’t copy. Press and hold the ${what.toLowerCase()} to copy it.`); }
}
function healthSyncHtml(){
  const H = S.hsync, key = S.hsKey;
  const when = t => { if (!t) return 'not yet'; const d = new Date(t); return (localDate(d)===localDate() ? 'today' : fmtDate(localDate(d),{day:'numeric',month:'short'})) + ' at ' + d.toLocaleTimeString([], {hour:'numeric', minute:'2-digit'}); };
  const state = H===undefined ? '<div class="muted small">Checking…</div>'
    : H===null ? '<div class="muted small">Couldn’t check the sync status. <button class="linkbtn" data-action="hsReload">Try again</button></div>'
    : key ? `<div class="hskey"><div class="small"><b>Your sync key</b>. Shown only now: copy it into the Shortcut (step 6). Keep it private; anyone with it can add steps and sleep to your log.</div>
        <code class="keybox">${esc(key)}</code><div class="row"><button class="btn sm" data-action="hsCopy" data-what="key">Copy key</button><button class="btn sm ghost" data-action="hsCopy" data-what="address">Copy address</button></div>
        <div class="muted small">Address: <code>${esc(hsUrl())}</code></div></div>`
    : H.connected ? `<div class="row"><span class="pill good">On</span><span class="small">Last sync: ${esc(when(H.last_sync_at))}</span></div>
        <div class="row"><button class="btn sm ghost" data-action="hsCopy" data-what="address">Copy address</button><button class="btn sm ghost" data-action="hsCreate" ${S.hsBusy?'disabled':''}>New key</button><button class="btn sm ghost" data-action="hsRevoke">Turn off</button></div>`
    : `<button class="btn sm" data-action="hsCreate" ${S.hsBusy?'disabled':''}>${S.hsBusy?'Creating…':'Set up automatic sync'}</button>`;
  const steps = `<ol class="tips hsteps">
      <li><b>Garmin?</b> In Garmin Connect: More → Settings → Connected Apps → Apple Health, and allow steps, active calories and sleep. (Apple Watch: nothing to do.)</li>
      <li>Open the <b>Shortcuts</b> app → <b>+</b> and name it “MaxxTempo sync”.</li>
      <li>Add <b>Find Health Samples</b>: Type <i>Steps</i>, Start Date <i>is today</i>, Group By <i>Day</i>. Then add <b>Calculate Statistics</b>: <i>Sum</i>.</li>
      <li>Add <b>Find Health Samples</b>: Type <i>Active Energy</i>, Start Date <i>is today</i>, Group By <i>Day</i>. Then <b>Calculate Statistics</b>: <i>Sum</i>.</li>
      <li>Add <b>Find Health Samples</b>: Type <i>Sleep Analysis</i>, End Date <i>is today</i>, Value <i>is not In Bed</i>, Value <i>is not Awake</i>. Then <b>Get Details of Health Samples</b>: <i>Duration</i>, then <b>Calculate Statistics</b>: <i>Sum</i>.</li>
      <li>Add <b>Get Contents of URL</b> with the address above. Tap the arrow: Method <i>POST</i>, Request Body <i>JSON</i>, and add four <i>Text</i> fields: <code>key</code> = your sync key, <code>steps</code> = the first Statistics, <code>active_kcal</code> = the second, <code>sleep</code> = the third.</li>
      <li>Tap ▶ to test. It answers “MaxxTempo: saved … steps …”, and Today fills in.</li>
      <li>Make it automatic: <b>Automation</b> tab → <b>+</b> → <i>Time of Day</i>, 11:45 pm, Daily → <i>Run Immediately</i> → pick “MaxxTempo sync”. Add another at 9 am to see last night’s sleep in the morning.</li>
    </ol>
    <div class="muted small">Steps look about double what the Health app shows? In step 3, add the filter Source <i>is</i> your Apple Watch. Synced numbers replace typed ones for that day.</div>`;
  return `<div class="hsync"><div class="nm">Automatic sync from Apple Health <span class="tag">iPhone</span></div>
    <div class="muted small">An iPhone Shortcut sends your steps, active calories and sleep every night, including Garmin data once Garmin Connect shares to Apple Health.</div>
    ${state}
    ${fold('hs-steps', 'Set up the Shortcut (5 minutes, once)', '', steps, 'inner')}</div>`;
}
async function loadPasskeys(){
  try { S.passkeys = (await passkeyCall('list')).passkeys; } catch { if (!S.passkeys) S.passkeys = null; }
  render(); if (!$('#menu').hidden) $('#menuBody').innerHTML = menuHtml();
}
async function setupFaceId(){
  S.pkBusy = true; render(); if (!$('#menu').hidden) $('#menuBody').innerHTML = menuHtml();
  const b = bioName();
  try {
    const lib = await webauthnLib();
    const o = await passkeyCall('register-options');
    const response = await lib.startRegistration({ optionsJSON:o.options });
    await passkeyCall('register-verify', { challengeId:o.challengeId, response, device:deviceName() });
    toast(`${b} is on. Next time, tap “Sign in with ${b}”.`);
  } catch (e) {
    const n = e?.name || e?.code;
    if (n==='InvalidStateError' || n==='already_registered') toast(`${b} is already set up on this device.`);
    else if (n!=='NotAllowedError' && n!=='AbortError') toast(n==='offline' ? 'You’re offline. Try again when you’re connected.' : `Couldn’t set up ${b}. Try again.`);
  } finally { S.pkBusy = false; await loadPasskeys(); }
}
async function removePasskey(id){
  const k = (S.passkeys||[]).find(x=>x.id===id); if (!k) return;
  if (!confirm(`Remove ${bioName()} sign-in for ${k.device_name||'this device'}? You can set it up again any time.`)) return;
  try { await passkeyCall('delete', { id }); toast('Removed.'); } catch { toast('Couldn’t remove it. Try again.'); }
  loadPasskeys();
}
function passkeyMenu(){
  if (!window.PublicKeyCredential) return '<div class="muted small">This browser can’t use Face ID or fingerprint sign-in.</div>';
  const list = S.passkeys, b = bioName();
  return `<div class="muted small">Sign in with ${b} instead of your password. Works on every device where your passkeys sync (iCloud Keychain or Google Password Manager).</div>
    ${list && list.length ? list.map(k=>`<div class="item"><div><div class="nm">${esc(k.device_name||'Passkey')}</div><div class="sub">added ${esc(fmtDate(k.created_at.slice(0,10),{day:'numeric',month:'short'}))}${k.last_used_at?` · last used ${esc(fmtDate(k.last_used_at.slice(0,10),{day:'numeric',month:'short'}))}`:''}</div></div><span></span><div class="acts"><button data-action="faceIdRemove" data-id="${esc(k.id)}">Remove</button></div></div>`).join('') : ''}
    <div class="row"><button class="btn sm" data-action="faceIdSetup" ${S.pkBusy?'disabled':''}>${S.pkBusy?'Waiting for '+b+'…':list&&list.length?`Add this device`:`Turn on ${b}`}</button></div>`;
}

/* ---------- weekly leaderboard (table "leaderboard" in schema.sql) ---------- */
// Goal each week (Mon-Sun): 3+ days with gym or sport, and protein at your own target on average.
const BOARD_WORKOUTS = 3;
function weekMonday(date){ const d = new Date(date+'T12:00:00'); const dow = (d.getDay()+6)%7; return addDays(date, -dow); }
function weekSummary(monday){
  const today = localDate(); let workouts = 0, pSum = 0, tSum = 0, logged = 0;
  for (let i=0; i<7; i++) { const date = addDays(monday, i); if (date > today) break; const d = S.days.get(date); if (!d) continue;
    if ((d.exercises||[]).length || (d.sports||[]).length) workouts++;
    if ((d.foods||[]).length) { logged++; pSum += dayTotals(d).protein; tSum += dayTargets(d).protein; } }
  const pAvg = logged ? pSum/logged : 0, pTgt = logged ? tSum/logged : targets().protein;
  const score = Math.round(50*Math.min(1, workouts/BOARD_WORKOUTS) + 50*Math.min(1, pTgt>0 ? pAvg/pTgt : 0));
  return { workouts, protein_avg: Math.round(pAvg), protein_target: Math.round(pTgt), logged_days: logged, score };
}
const boardHit = r => r.workouts >= BOARD_WORKOUTS && r.logged_days > 0 && r.protein_avg >= r.protein_target;
let boardT = null, boardLast = '';
function publishBoard(){
  if (!S.dbReady || !S.user || !SB) return;
  clearTimeout(boardT);
  boardT = setTimeout(async () => {
    const monday = weekMonday(localDate());
    if (prof().leaderboard === false) {
      if (boardLast !== 'off') { boardLast = 'off'; await SB.from('leaderboard').delete().eq('user_id', S.user.id); loadBoard(); }
      return;
    }
    const row = { user_id:S.user.id, week:monday, name:(prof().name||'').trim().slice(0,40) || (S.user.email||'').split('@')[0] || 'Member', ...weekSummary(monday) };
    const key = JSON.stringify(row); if (key === boardLast) return; boardLast = key;
    const { error } = await SB.from('leaderboard').upsert({ ...row, updated_at:new Date().toISOString() });
    if (!error) loadBoard();
  }, 2500);
}
async function loadBoard(){
  if (!SB || !S.user) return;
  const { data, error } = await SB.from('leaderboard').select('user_id,name,workouts,protein_avg,protein_target,logged_days,score,updated_at').eq('week', weekMonday(localDate()));
  if (!error) { S.board = data || []; if (S.view==='trends') render(); }
}
function boardHtml(){
  const monday = weekMonday(localDate()), me = S.user?.id, off = prof().leaderboard === false;
  const rows = (S.board||[]).slice().sort((a,b)=> (boardHit(b)-boardHit(a)) || (b.score-a.score) || (b.workouts-a.workouts) || String(a.name).localeCompare(String(b.name)));
  const line = r => `${r.workouts}/${BOARD_WORKOUTS} workouts · ${r.logged_days?`${n0(r.protein_avg)}/${n0(r.protein_target)} g protein`:'no food logged'}`;
  const tag = r => boardHit(r) ? '<span class="spill" style="color:var(--st-at-t);background:color-mix(in srgb, var(--st-at) 15%, transparent)">✓ Target hit</span>' : '';
  const top = rows.slice(0,3), rest = rows.slice(3);
  const order = top.length===3 ? [top[1], top[0], top[2]] : top;             // podium: 2nd, 1st, 3rd
  const place = r => rows.indexOf(r)+1;
  return `<section class="panel board" aria-label="Leaderboard">
    <div class="panel-head"><h2>This week’s leaderboard</h2><span class="muted small">${esc(fmtDate(monday,{day:'numeric',month:'short'}))} – ${esc(fmtDate(addDays(monday,6),{day:'numeric',month:'short'}))}</span></div>
    <div class="muted small">Goal: ${BOARD_WORKOUTS}+ workouts and your own protein target (average over days you logged food). Score = half workouts, half protein.</div>
    ${!rows.length ? `<div class="empty">${off?'You’re hidden from the leaderboard.':'Nobody is on the board yet this week. Log a workout or a meal and you’ll appear.'}</div>` : `
    <div class="podium${top.length<3?' few':''}">${order.map(r=>`<div class="pod p${place(r)}${r.user_id===me?' me':''}">
        <div class="medal">${place(r)}</div><div class="pname">${esc(r.name||'Member')}${r.user_id===me?' <span class="muted">(you)</span>':''}</div>
        <div class="pscore">${r.score}<small>/100</small></div><div class="pline">${esc(line(r))}</div>${tag(r)}<div class="pblock"></div></div>`).join('')}</div>
    ${rest.length ? fold('lb-rest', 'Everyone else', `${rest.length} ${rest.length===1?'person':'people'}`, rest.map(r=>`<div class="brow${r.user_id===me?' me':''}"><span class="brank">${place(r)}</span><div><b>${esc(r.name||'Member')}${r.user_id===me?' <span class="muted">(you)</span>':''}</b><div class="muted small">${esc(line(r))}</div></div>${tag(r)||'<span></span>'}<b class="num">${r.score}</b></div>`).join(''), 'inline') : ''}`}
    <label class="check small"><input type="checkbox" data-action="boardToggle" ${off?'':'checked'}> Show me on the leaderboard (only your name and these weekly numbers are shared)</label>
  </section>`;
}

/* ---------- approvals (owner only) ---------- */
async function loadMembers(){
  if (!S.isAdmin || !SB) return;
  const { data, error } = await SB.from('members').select('user_id,email,name,provider,status,is_admin,requested_at,decided_at').order('requested_at', {ascending:false});
  if (!error) { S.members = data||[]; render(); }
}
async function setMember(id, status){
  const m = (S.members||[]).find(x=>x.user_id===id); if (!m) return;
  if (status==='declined' && m.status==='approved' && !confirm(`Remove ${m.name||m.email}’s access? They won’t be able to open their data until you approve them again.`)) return;
  const { error } = await SB.rpc('set_member_status', { p_user:id, p_status:status });
  if (error) { toast('Couldn’t update that. Try again.'); return; }
  toast(status==='approved' ? `Approved ${m.name||m.email}` : `Declined ${m.name||m.email}`); loadMembers();
}
function peopleFold(){
  const ms = S.members||[], pend = ms.filter(x=>x.status==='pending'), appr = ms.filter(x=>x.status==='approved'), dec = ms.filter(x=>x.status==='declined');
  const who = x => `<div><div class="nm">${esc(x.name||x.email||'Unknown')}${x.is_admin?' <span class="tag">you</span>':''}</div><div class="sub">${esc(x.email||'')}${x.provider?` · ${esc(x.provider==='email'?'email':x.provider[0].toUpperCase()+x.provider.slice(1))}`:''} · ${esc(fmtDate((x.decided_at||x.requested_at).slice(0,10),{day:'numeric',month:'short'}))}</div></div>`;
  return `${pend.length ? `<h3>Waiting for you</h3>${pend.map(x=>`<div class="item">${who(x)}<span></span><div class="acts"><button class="approve" data-action="memberSet" data-id="${x.user_id}" data-s="approved">Approve</button><button data-action="memberSet" data-id="${x.user_id}" data-s="declined">Decline</button></div></div>`).join('')}` : '<div class="muted small">Nobody is waiting. When someone signs in for the first time, they appear here for you to approve.</div>'}
    <h3>Approved</h3>${appr.map(x=>`<div class="item">${who(x)}<span></span><div class="acts">${x.is_admin?'':`<button data-action="tempPw" data-id="${x.user_id}" data-name="${esc(x.name||x.email||'')}" aria-label="Set a temporary password for ${esc(x.name||x.email||'')}">Password</button><button data-action="memberSet" data-id="${x.user_id}" data-s="declined">Remove</button>`}</div></div>`).join('')}
    <div class="muted small">Forgot their password? Tap Password to make a temporary one, and give it to them privately. They choose their own next time they sign in.</div>
    ${dec.length?`<h3>Declined</h3>${dec.map(x=>`<div class="item">${who(x)}<span></span><div class="acts"><button data-action="memberSet" data-id="${x.user_id}" data-s="approved">Approve</button></div></div>`).join('')}`:''}
    <div class="row"><button class="btn ghost sm" data-action="reviewPeople">Refresh</button></div>`;
}
async function tempPassword(id, name){
  if (!confirm(`Make a temporary password for ${name}? Their current password stops working.`)) return;
  let r; try { r = await fnCall('members', 'temp-password', {user_id:id}); } catch (e) { toast(e.code==='offline' ? 'You’re offline. Try again when connected.' : 'Couldn’t set a temporary password. Try again.'); return; }
  const d = $('#dlg');
  d.innerHTML = `<div class="howto"><h2>Temporary password</h2>
    <p class="small">For <b>${esc(name)}</b>${r.email?` (${esc(r.email)})`:''}. Share it privately (in person or a direct message). They sign in with it and then choose their own.</p>
    <code class="keybox">${esc(r.password)}</code>
    <div class="row"><button class="btn sm" id="tpCopy">Copy</button><span class="spacer"></span><button class="btn ghost" id="tpClose">Done</button></div>
    <div class="muted small">It’s shown only now.</div></div>`;
  d.showModal(); $('#tpClose').onclick = () => d.close(); $('#tpCopy').onclick = () => copyText(r.password, 'Password');
}
async function signOut(){
  if (S.db) await S.db.forget();
  await SB.auth.signOut(); location.reload();
}
async function refreshUsage(){
  if (!S.sample) return;
  try { S.usage = await S.sample.usage(); S.aiHealth = 'ok'; }
  catch (e) { S.aiHealth = e?.code || 'unavailable'; }
  render();
}

// Is this person approved? Cached on the device so the app still opens offline.
async function memberStatus(user){
  const key = 'mt:member:' + user.id;
  let data = null, error = null;
  try { ({ data, error } = await SB.from('members').select('status,is_admin').eq('user_id', user.id).maybeSingle()); } catch (e) { error = e; }
  if (error) { let c=null; try { c = JSON.parse(localStorage.getItem(key)||'null'); } catch {} return c || {status:'unknown'}; }
  const m = data || {status:'pending'};
  try { if (m.status==='approved') localStorage.setItem(key, JSON.stringify(m)); else localStorage.removeItem(key); } catch {}
  return m;
}
let memberCheck = null;
async function startFor(user){
  if (S.user && S.user.id===user.id) return;
  if (memberCheck) return memberCheck;
  memberCheck = (async () => { const m = await memberStatus(user); memberCheck = null; return m; })();
  const m = await memberCheck;
  if (m.status!=='approved') { S.pendingUser = user; S.memberInfo = m; render(); return; }
  if (user.user_metadata?.must_change_password) { S.mustChange = user; render(); return; }
  S.pendingUser = null; S.isAdmin = !!m.is_admin;
  S.user = user; S.dbState='connecting'; render();
  if (S.isAdmin) loadMembers();
  loadPasskeys(); loadBoard(); loadHealthSync(); loadData();
  const db = FL.makeDb(SB, user.id, {
    onStatus: st => { if (S.sync!==st) { S.sync = st; render(); } },
    onError: code => { if (code==='too_large') toast('One change was too large to sync and was skipped.'); },
  });
  S.db = db;
  S.sample = FL_CONFIG.CLAUDE !== false ? FL.makeAI(SB, FL_CONFIG, { onUsage: u => { S.usage = u; } }) : null;
  S.aiState = S.sample ? 'on' : 'off'; S.canPhoto = !!S.sample;
  db.doc('profile/me').onSnapshot(snap => { S.profile = snap.exists ? {...snap.data()} : null; S.rev++;
    if (!S.profile && !S.setupShown && !snap.metadata?.fromCache) { S.setupShown = true; startSetup('about'); return; }
    if (S.profile) S.setupShown = true; render(); });
  db.collection('reports').orderBy('report_date','desc').limit(50).onSnapshot(snap => { S.reports = snap.docs.map(d=>({...d.data()})); render(); });
  db.collection('foodlib').onSnapshot(snap => { if (S.indbBuiltIn) return; const rows=[]; for (const d of snap.docs) { try { rows.push(...JSON.parse(d.data().rows||'[]')); } catch {} } S.libFoods = rows.map(r=>rowToFood(r,'indb')); S.myFoodsVer=(S.myFoodsVer||0)+1; });
  db.collection('foods').limit(1000).onSnapshot(snap => { const m={}; for (const d of snap.docs) m[d.id]={...d.data()}; S.myFoods=m; S.myFoodsVer=(S.myFoodsVer||0)+1; });
  db.collection('plans').orderBy('date','desc').limit(14).onSnapshot(snap => { S.plans = snap.docs.map(d=>({...d.data()})); render(); });
  db.collection('reviews').orderBy('created','desc').limit(10).onSnapshot(snap => { S.reviews = snap.docs.map(d=>({...d.data()})); render(); });
  db.collection('days').orderBy('date','desc').limit(1000).onSnapshot(snap => {
    const m = new Map(); for (const d of snap.docs) m.set(d.id, d.data());
    S.daysRaw = m; mergeDays(); S.rev++; S.dbState='on'; render();
  });
  // Numbers the Apple Health Shortcut sent (written only by the server, so
  // syncing days never overwrites them); laid over each day's own health.
  db.collection('health').onSnapshot(snap => {
    const m = new Map(); for (const d of snap.docs) m.set(d.id, d.data());
    S.healthSync = m; mergeDays(); S.rev++; render();
  });
  await db.start();
  S.dbReady = true; S.dbState='on'; render();
  refreshUsage();
}

document.addEventListener('visibilitychange', () => { if (document.visibilityState!=='visible') return;
  if (S.isAdmin) loadMembers();
  if (S.pendingUser && S.memberInfo?.status!=='declined') startFor(S.pendingUser); });
try { window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable?.().then(ok => { S.bioOK = !!ok; render(); }).catch(()=>{}); } catch {}
render();
(async () => {
  const cfg = window.FL_CONFIG || {};
  if (!window.supabase || !/^https:\/\//.test(cfg.SUPABASE_URL||'') || /YOUR_/.test(cfg.SUPABASE_ANON_KEY||'YOUR_')) { render(); return; }
  SB = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, { auth:{ persistSession:true, autoRefreshToken:true, detectSessionInUrl:true, flowType:'pkce' } });
  const { data:{ session } } = await SB.auth.getSession();
  if (session?.user) startFor(session.user); else render();
  SB.auth.onAuthStateChange((ev, sess) => {
    if (sess?.user) startFor(sess.user);
    else if (ev==='SIGNED_OUT') { S.user=null; S.pendingUser=null; S.isAdmin=false; S.passkeys=null; render(); }
  });
})();
})();
